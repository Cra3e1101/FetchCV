from applyos_domain.interview_queries import jd_query_plan
from applyos_agent.interview_tools import register_interview_tools
from applyos_domain.models import Candidate, Job, AgentRun
from applyos_harness.permissions import ToolGateway, ToolPermission
from applyos_agent.interview_tools import _candidate_relevance


def test_technical_discovery_accepts_function_not_exact_official_title():
    role = 'AI Agent多模态算法工程师'
    assert _candidate_relevance('小米', '', role, '小米算法实习面经', '微调和SFT')
    assert not _candidate_relevance('小米', '', role, '小米前端开发面经')
    assert not _candidate_relevance('小米', '', role, '其它公司算法面经')
    assert not _candidate_relevance('小米', '', role, '小米算法招聘')
    assert not _candidate_relevance('小米', '', role, '求小米相机算法面经')
    assert not _candidate_relevance('小米', '', role, '小米Java后端开发面经', '算法题和八股')


def test_jd_aliases_have_literal_evidence_and_boundaries():
    text = "负责多模态模型微调，熟悉SQL及用户研究。htmlagentx不是Agent缩写。"
    plan = jd_query_plan(text)
    assert {"VLM", "SFT", "SQL", "用户调研"} <= set(plan['terms'])
    for feature in plan['features']:
        a, b = feature['span']
        assert text[a:b] == feature['quote']
    assert not jd_query_plan('CVS SQLAlchemy htmlagentx')['terms']
    assert not jd_query_plan('沟通能力强，愿意学习')['terms']


def test_gateway_uses_linked_jd_but_preserves_explicit_query(database, tmp_path):
    with database.session() as session:
        session.add(Candidate(id='jd-owner', name='Synthetic')); session.flush()
        session.add(Job(id='jd-topic', candidate_id='jd-owner', company='小米',
                        role='多模态算法工程师', jd_raw='负责多模态模型微调。')); session.flush()
        run = AgentRun(candidate_id='jd-owner', job_id='jd-topic', run_type='conversation', current_stage='created')
        session.add(run); session.flush()
        gateway = ToolGateway(session, workspace_root=tmp_path)
        register_interview_tools(gateway)
        def search(**kw):
            return gateway.execute(tool_name='search_interview_knowledge', run=run,
                arguments={'company':'小米', 'role':'算法工程师', **kw},
                granted_permissions={ToolPermission.READ}, idempotency_key=str(kw))['data']['query_plan']
        plan = search()
        assert plan['origin'] == 'linked_job'
        assert 'VLM' in plan['effective_query'] and 'SFT' in plan['effective_query']
        assert search(query='SQL')['effective_query'] == 'SQL'
        assert search(company='其它公司')['origin'] == 'no_jd'
        assert search(jd_text='用户研究')['terms'] == ['用户研究', '用户调研']
