from hashlib import sha256
from fastapi.testclient import TestClient
from applyos_api.main import create_app
from applyos_agent.interview_evidence import evidence_summary
from applyos_domain.models import Candidate, InterviewSource, InterviewBrief, Job
import pytest


def test_user_review_is_bound_to_body_and_can_be_withdrawn(database):
    body = '我参加了产品面试。面试官问如何开展用户研究。'
    with database.session() as session:
        session.add(Candidate(id='review-owner', name='Synthetic')); session.flush()
        session.add(InterviewSource(id='review-source', candidate_id='review-owner',
            company='示例公司', role='产品经理', title='产品面经', raw_text=body, source_url='https://example.com/original', url_hash='a'*64,
            status='analyzed', extracted_questions=[{'question':'如何开展用户研究', 'evidence_quote':'面试官问如何开展用户研究。'}]))
    with TestClient(create_app(database)) as client:
        url = '/api/interview-sources/review-source'
        snapshot = client.get(url).json()
        assert snapshot['review_content_hash'] == sha256(body.encode()).hexdigest()
        payload = dict(content_hash=snapshot['review_content_hash'], source_kind='first_person',
            origin_url='https://example.com/original', quote='我参加了产品面试。', confirmed=True)
        assert client.post(url+'/review', json=payload | {'quote':'编造的原句'}).status_code >= 400
        assert client.post(url+'/review', json=payload | {'content_hash':'0'*64}).status_code >= 400
        assert client.post(url+'/review', json=payload | {'confirmed':False}).status_code >= 400
        assert client.post(url+'/review', json=payload).status_code == 200
        with database.session() as session:
            source = session.get(InterviewSource, 'review-source')
            assert evidence_summary([source])['confirmed_independent_count'] == 1
            source.raw_text += '正文已更新。'
        assert client.post(url+'/review', json=payload).status_code >= 400
        snapshot = client.get(url).json()
        payload.update(content_hash=snapshot['review_content_hash'], source_kind='unknown', quote='', origin_url='')
        assert client.post(url+'/review', json=payload).status_code == 200
        with database.session() as session:
            assert evidence_summary([session.get(InterviewSource, 'review-source')])['confirmed_independent_count'] == 0


def test_topic_coverage_never_promotes_literal_hits_to_requirement_proof():
    from types import SimpleNamespace
    from applyos_domain.interview_queries import jd_topic_coverage
    source = SimpleNamespace(id='s', raw_text='讲解VLM', extracted_questions=[{'evidence_quote':'讲解VLM'}])
    result = jd_topic_coverage('负责多模态模型，熟悉SQL。', [source])
    assert result['coverage_verified'] is False
    assert result['topics'][0]['source_ids'] == ['s']
    assert result['topics'][1]['status'] == 'not_observed'


def seed_brief(database, *, source_count=1):
    with database.session() as session:
        session.add(Candidate(id='owner', name='Synthetic'))
        session.flush()
        session.add(Job(id='job', candidate_id='owner', company='示例公司', role='产品经理', jd_raw='需要用户研究能力。'))
        session.flush()
        ids = []
        for index in range(source_count):
            ident = f'source-{index}'
            ids.append(ident)
            session.add(InterviewSource(id=ident, candidate_id='owner', job_id='job', company='示例公司',
                role='产品经理', title='产品面经', source_url=f'https://example.com/{index}',
                url_hash=sha256(ident.encode()).hexdigest(), raw_text=f'我参加了第{index}轮面试。面试官问如何开展用户研究。',
                status='analyzed', extracted_questions=[{'question':'如何开展用户研究', 'evidence_quote':'面试官问如何开展用户研究。'}]))
        session.add(InterviewBrief(id='brief', candidate_id='owner', job_id='job', company='示例公司', role='产品经理',
            source_ids=ids, common_questions=[{'question':'如何开展用户研究', 'source_ids':ids, 'frequency':99, 'confidence':'recurring'}],
            metadata_json={'jd_topic_coverage':{'coverage_verified':True, 'topics':[{'term':'old', 'source_ids':['stale']}]}}))


def submit_review(client, ident, *, kind='first_person'):
    url = '/api/interview-sources/' + ident
    snapshot = client.get(url).json()
    payload = dict(content_hash=snapshot['review_content_hash'], source_kind=kind,
        origin_url=snapshot['source_url'] if kind != 'unknown' else '',
        quote='面试官问如何开展用户研究。' if kind != 'unknown' else '', confirmed=True)
    assert client.post(url+'/review', json=payload).status_code == 200


def read_coverage(database):
    with database.session() as session:
        return session.get(InterviewBrief, 'brief').metadata_json['jd_topic_coverage']


def test_review_recomputes_current_jd_and_delete_removes_topic_support(database):
    seed_brief(database)
    with TestClient(create_app(database)) as client:
        submit_review(client, 'source-0')
        coverage = read_coverage(database)
        assert coverage['coverage_verified'] is False
        assert coverage['topics'][0]['term'] == '用户研究'
        assert coverage['topics'][0]['source_ids'] == ['source-0']
        with database.session() as session:
            session.get(Job, 'job').jd_raw = '需要用户研究和SQL能力。'
        submit_review(client, 'source-0')
        coverage = read_coverage(database)
        assert [t['term'] for t in coverage['topics']] == ['用户研究', 'SQL']
        assert coverage['topics'][1]['status'] == 'not_observed'
        assert client.delete('/api/interview-sources/source-0').status_code == 204
        coverage = read_coverage(database)
        assert all(t['source_ids'] == [] and t['status'] == 'not_observed' for t in coverage['topics'])
        assert coverage['coverage_verified'] is False


def test_jd_edit_recomputes_observations_without_another_source_review(database):
    seed_brief(database)
    with TestClient(create_app(database)) as client:
        response = client.patch('/api/jobs/job', json={'jd_raw':'熟悉SQL和Python。'})
        assert response.status_code == 200
    coverage = read_coverage(database)
    assert coverage['jd_content_hash'] == sha256('熟悉SQL和Python。'.encode()).hexdigest()
    assert [topic['term'] for topic in coverage['topics']] == ['SQL', 'Python']
    assert all(topic['status'] == 'not_observed' for topic in coverage['topics'])
    assert coverage['coverage_verified'] is False


def test_agent_web_import_invalidates_previous_jd_observations(database, monkeypatch):
    from integrations.web.job_posting import JobPostingImporter, ParsedJobPosting
    seed_brief(database)
    posting = ParsedJobPosting(description='熟悉SQL。', company='示例公司', title='产品经理', location='',
        source_url='https://example.com/jd', structured_data=True, page_title='职位')
    monkeypatch.setattr(JobPostingImporter, 'preview', lambda self, url: posting)
    with database.session() as session:
        importer = JobPostingImporter(session)
        job = session.get(Job, 'job')
        result = importer.import_into_job(job, url=posting.source_url, overwrite=False)
        assert result['conflict'] is True
        assert session.get(InterviewBrief, 'brief').metadata_json['jd_topic_coverage']['topics'][0]['term'] == 'old'
        result = importer.import_into_job(job, url=posting.source_url, overwrite=True)
        assert result['imported'] is True
    with database.session() as session:
        metadata = session.get(InterviewBrief, 'brief').metadata_json
        assert metadata['analysis_status'] == 'stale'
        assert metadata['stale_reason'] == 'jd_import_changed'
        assert metadata['current_input_revision'] == session.get(Job, 'job').input_revision
        # T3 retains the historical analysis and marks its input revision stale.
        assert metadata['jd_topic_coverage']['topics'][0]['term'] == 'old'


@pytest.mark.parametrize('foreign_job', [False, True])
def test_missing_or_other_candidate_jd_invalidates_old_observations(database, foreign_job):
    seed_brief(database)
    with database.session() as session:
        brief = session.get(InterviewBrief, 'brief')
        if foreign_job:
            session.add(Candidate(id='other', name='Other')); session.flush()
            session.add(Job(id='other-job', candidate_id='other', company='其他公司', role='算法工程师', jd_raw='多模态'))
            session.flush()
            brief.job_id = 'other-job'
        else:
            brief.job_id = None
    with TestClient(create_app(database)) as client:
        submit_review(client, 'source-0')
    coverage = read_coverage(database)
    assert coverage['topics'] == []
    assert coverage['context_status'] == 'jd_unavailable'
    assert coverage['coverage_verified'] is False
    assert coverage['jd_content_hash'] is None


def test_ocr_confirmation_does_not_reuse_pre_update_analysis_coverage(database):
    seed_brief(database)
    with database.session() as session:
        source = session.get(InterviewSource, 'source-0')
        source.status = 'ocr_pending'
        source.metadata_json = {'ocr_status':'completed', 'ocr_text':'补充图片文字'}
    with TestClient(create_app(database)) as client:
        response = client.post('/api/interview-sources/source-0/confirm-ocr', json={'confirmed':True, 'reviewed_text':'补充图片文字'})
        assert response.status_code == 200
    coverage = read_coverage(database)
    assert coverage['topics'][0]['source_ids'] == []
    assert coverage['topics'][0]['status'] == 'not_observed'
    assert coverage['coverage_verified'] is False


def test_partial_independence_cannot_be_called_recurring_even_with_two_confirmed_sources(database):
    seed_brief(database, source_count=3)
    with TestClient(create_app(database)) as client:
        submit_review(client, 'source-0')
        submit_review(client, 'source-1')
        with database.session() as session:
            brief = session.get(InterviewBrief, 'brief')
            question = brief.common_questions[0]
            assert question['question_evidence']['confirmed_independent_count'] == 2
            assert question['question_evidence']['independence_status'] == 'partial'
            assert question['frequency'] is None
            assert question['confidence'] == 'independence_unverified'
            assert brief.metadata_json['recurring_question_count'] == 0
        submit_review(client, 'source-2')
        with database.session() as session:
            brief = session.get(InterviewBrief, 'brief')
            assert brief.common_questions[0]['frequency'] == 3
            assert brief.common_questions[0]['confidence'] == 'recurring'
            assert brief.metadata_json['recurring_question_count'] == 1


@pytest.mark.parametrize('new_questions,expected_rejected', [([], 0),
    ([{'question':'如何开展用户研究', 'evidence_quote':'当前原文不存在的引用'}], 1),
    ([{'question':'请说明本轮面试', 'evidence_quote':'我参加了第0轮面试。'}], 0)])
def test_reanalyze_existing_source_invalidates_old_brief_frequency(database, tmp_path, new_questions, expected_rejected):
    from applyos_agent.interview_tools import register_interview_tools
    from applyos_domain.models import AgentRun
    from applyos_harness.errors import HarnessError
    from applyos_harness.permissions import ToolGateway, ToolPermission

    seed_brief(database, source_count=2)
    with TestClient(create_app(database)) as client:
        submit_review(client, 'source-0')
        submit_review(client, 'source-1')
    with database.session() as session:
        assert session.get(InterviewBrief, 'brief').common_questions[0]['frequency'] == 2
        run = AgentRun(candidate_id='owner', job_id='job', run_type='conversation', current_stage='created')
        session.add(run); session.flush()
        class Disabled:
            configured = False
        gateway = ToolGateway(session, workspace_root=tmp_path)
        register_interview_tools(gateway, browser_client=Disabled(), firecrawl_client=Disabled())
        arguments = {'source_id':'source-0', 'mode':'replace', 'summary':'重新分析', 'questions':new_questions}
        if expected_rejected:
            with pytest.raises(HarnessError) as invalid:
                gateway.execute(tool_name='analyze_interview_source', run=run, arguments=arguments,
                    granted_permissions={ToolPermission.DRAFT_WRITE}, idempotency_key='reanalyze')
            assert invalid.value.code == 'interview_analysis_quotes_invalid'
            assert invalid.value.details['rejected_questions'] == [
                {'question_index':0, 'field':'evidence_quote', 'reason':'quote_not_in_current_source'}]
            assert session.get(InterviewSource, 'source-0').extracted_questions == [
                {'question':'如何开展用户研究', 'evidence_quote':'面试官问如何开展用户研究。'}]
        else:
            result = gateway.execute(tool_name='analyze_interview_source', run=run, arguments=arguments,
                granted_permissions={ToolPermission.DRAFT_WRITE}, idempotency_key='reanalyze')
            assert result['data']['rejected_count'] == expected_rejected
            assert result['data']['analysis_mode'] == 'replace'
            assert result['data']['analysis_status'] == ('complete' if new_questions else 'no_questions')
    # Observe committed tool effects, without another review or refresh API call.
    with database.session() as session:
        brief = session.get(InterviewBrief, 'brief')
        question = brief.common_questions[0]
        assert question['frequency'] == (2 if expected_rejected else 1)
        assert question['confidence'] == ('recurring' if expected_rejected else 'independence_unverified')
        expected_ids = ['source-0', 'source-1'] if expected_rejected else ['source-1']
        assert question['question_evidence']['supporting_source_ids'] == expected_ids
        assert brief.metadata_json['recurring_question_count'] == (1 if expected_rejected else 0)
        assert brief.metadata_json['jd_topic_coverage']['topics'][0]['source_ids'] == expected_ids
