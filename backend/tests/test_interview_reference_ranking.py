from datetime import datetime, timezone
from types import SimpleNamespace
import json
import httpx
import pytest
from sqlalchemy import select

from applyos_domain.interview_ranking import score_interview, rank_interviews, recruitment_type
from applyos_domain.models import Candidate, Job, AgentRun, InterviewSource, ToolInvocation
from applyos_agent.interview_tools import register_interview_tools
from applyos_harness.permissions import ToolGateway, ToolPermission
from applyos_harness.errors import HarnessError
from integrations.web import WebClient
from integrations.web.job_posting import JobPostingImporter

NOW=datetime(2026,10,23,tzinfo=timezone.utc)

def test_evidence_availability_cannot_buy_relevance():
    plain = score_interview(source(), company='字节跳动', role='产品经理', now=NOW)
    rich = score_interview(source(status='analyzed', extracted_questions=[{'question':'Q'}],
        metadata_json={'link_status':'verified', 'extraction':'nowcoder-public-ssr'}),
        company='字节跳动', role='产品经理', now=NOW)
    assert plain['eligible'] and rich['eligible']
    assert plain['score'] == rich['score']
    assert 'evidence' not in plain['weights']
    assert not rich['evidence_availability']['used_in_ranking']
def source(**overrides):
    values=dict(id='one',title='字节产品经理面经',company='字节跳动',role='产品经理',business_unit=None,
        published_at='2026-09-01',metadata_json={'link_status':'verified'},status='captured',
        extracted_questions=[],content_hash='hash',source_url='https://example.com/one')
    values.update(overrides)
    return SimpleNamespace(**values)
def score(s,**kw):
    return score_interview(s,company='字节跳动',role='产品经理',now=NOW,**kw)

def test_recency_never_rescues_wrong_role_or_company():
    assert score(source(title='字节Java开发面经',role='Java开发'))['eligible'] is False
    # This reproduces a real search-card false positive containing the requested
    # company in its body but a different employer in the title.
    wrong=source(title='理想AI产品面经拆解',metadata_json={'scope_origin':'request_not_verified'})
    assert score(wrong,preview='同时拿到字节和小米offer')['eligible'] is False
    cross=score(wrong,include_other_companies=True)
    assert cross['eligible'] and cross['scope']=='other_company_role_reference_only'

def test_time_department_and_unknown_dates_are_explicit():
    recent=score(source());old=score(source(published_at='2020-09-01'))
    assert recent['score']>old['score']
    missing=score(source(published_at=None));future=score(source(published_at='2027-01-01'))
    assert missing['date_basis']=='unknown' and future['date_basis']=='future_date_unverified'
    same=score(source(title='字节飞书产品经理面经'),business_unit='飞书')
    different=score(source(title='字节抖音产品经理面经'),business_unit='飞书')
    assert same['score']>different['score']
    tagged=score(source(business_unit='飞书',metadata_json={'scope_origin':'request_not_verified'}),business_unit='飞书')
    assert tagged['department_evidence']=='unconfirmed'
    inferred=score(source(metadata_json={'published_at_basis':'note_id_inferred'}))
    assert inferred['age_days'] is None

def test_ops_does_not_equal_pm_and_duplicate_body_is_diversified():
    assert score(source(title='字节产品运营面经',role='产品运营'))['eligible'] is False
    hits=[SimpleNamespace(item=source(id=str(i)),score=-i,preview='') for i in range(3)]
    assert len(rank_interviews(hits,company='字节跳动',role='产品经理',now=NOW))==1


def test_same_url_does_not_fill_top_k_when_hashes_differ():
    hits = [SimpleNamespace(item=source(id=str(i), content_hash=str(i)), preview='') for i in range(3)]
    assert len(rank_interviews(hits, company='字节跳动', role='产品经理', now=NOW)) == 1


def test_recruitment_type_is_a_small_soft_feature_not_a_gate():
    campus = score(source(title='字节产品经理校招面经'), recruitment_type_target='internship')
    internship = score(source(title='字节产品经理实习生面经'), recruitment_type_target='internship')
    unknown = score(source(), recruitment_type_target='internship')
    assert all(item['eligible'] for item in (campus, internship, unknown))
    assert internship['score'] > unknown['score'] > campus['score']
    assert internship['score'] - campus['score'] < .05
    assert campus['recruitment_type']['hard_filter'] is False
    assert 'recruitment_type' not in score(source())['components']
    # Request-side metadata cannot manufacture the source's actual job type.
    tagged = score(source(metadata_json={'recruitment_type': 'internship'}), recruitment_type_target='internship')
    assert tagged['recruitment_type']['source'] == 'unknown'
    assert recruitment_type('校园招聘产品实习生') == 'internship'
    assert recruitment_type('字节产品实习一面') == 'internship'
    assert recruitment_type('有实习经历优先') == ''

def test_technical_specialties_are_not_interchangeable():
    result=score_interview(source(title='字节后端开发面经',role='后端开发'),company='字节跳动',role='算法工程师',now=NOW)
    assert not result['eligible']
    assert not score(source(title='字节产品工程师面经',role='产品工程师'))['eligible']

def test_capture_failure_does_not_poison_later_sources(database,tmp_path):
    def respond(request):
        good=request.url.path.endswith('/123456789012345679')
        body=('字节产品经理面经：一面追问需求分析、用户分层和数据验证。'*15) if good else '内容不存在'
        state={'prefetchData':{'post':{'contentId':request.url.path.rsplit('/',1)[-1],
            'ssrCommonData':{'contentData':{'title':'字节产品经理面经','content':body}}}}}
        return httpx.Response(200,text=f'<html><script>window.__INITIAL_STATE__={json.dumps(state)}</script></html>',
                              headers={'content-type':'text/html'})
    web=WebClient(transport=httpx.MockTransport(respond),resolver=lambda h,p,**kw:[(2,1,6,'',('93.184.216.34',p))])
    class Disabled:configured=False
    with database.session() as session:
        candidate=Candidate(name='synthetic');session.add(candidate);session.flush()
        job=Job(candidate_id=candidate.id,company='字节跳动',role='产品经理');session.add(job);session.flush()
        run=AgentRun(candidate_id=candidate.id,job_id=job.id,run_type='interview_prep',current_stage='created');session.add(run);session.flush()
        gateway=ToolGateway(session,workspace_root=tmp_path)
        register_interview_tools(gateway,web_client=web,browser_client=Disabled(),firecrawl_client=Disabled())
        args=dict(tool_name='capture_interview_source',run=run,granted_permissions={ToolPermission.NETWORK_READ},
                  arguments={'company':'字节跳动','role':'产品经理','url':'https://www.nowcoder.com/discuss/123456789012345678'},idempotency_key='bad')
        with pytest.raises(HarnessError) as err:gateway.execute(**args)
        assert err.value.code=='interview_source_unreadable'
        inv=session.scalar(select(ToolInvocation).where(ToolInvocation.run_id==run.id))
        assert inv.status=='failed' and inv.error_json['rollback_proven']
        assert inv.error_json['read_cache_may_remain'] is True
        assert session.scalar(select(InterviewSource)) is None
        args.update(arguments={**args['arguments'],'url':'https://www.nowcoder.com/discuss/123456789012345679'},idempotency_key='good')
        result=gateway.execute(**args)
        assert result['data']['source']['raw_text']

@pytest.mark.parametrize('wrong_id,truncated',[ (False,False),(True,False),(False,True)])
def test_official_campus_dynamic_detail_fallback(database,wrong_id,truncated):
    called=[]
    def respond(request):
        called.append(str(request.url))
        if '/api/' not in request.url.path:
            return httpx.Response(200,text='<html><title>小米校园招聘</title></html>',headers={'content-type':'text/html'})
        description='负责产品规划与需求分析。'*50
        if truncated:description*=100
        return httpx.Response(200,json={'code':0,'data':{'job_post_detail':{
            'id':'999' if wrong_id else '123','title':'AI产品经理','description':description,
            'requirement':'2027届应届毕业生，熟悉数据分析。','city_list':[{'name':'北京'}],
            'publish_time':1786112732923}}})
    web=WebClient(transport=httpx.MockTransport(respond),resolver=lambda h,p,**kw:[(2,1,6,'',('93.184.216.34',p))])
    with database.session() as session:
        importer=JobPostingImporter(session,web_client=web)
        url='https://xiaomi.jobs.f.mioffice.cn/campus/position/123/detail'
        if wrong_id or truncated:
            assert importer.preview(url).status == 'insufficient_content'
        else:
            result=importer.preview(url)
            assert result.title=='AI产品经理' and result.structured_data and result.source_url==url
            assert result.location=='北京' and len(called)==2
