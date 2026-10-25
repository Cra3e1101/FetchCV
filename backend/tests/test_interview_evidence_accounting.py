from types import SimpleNamespace
from hashlib import sha256
from applyos_agent.interview_evidence import evidence_summary, ready_for_brief, evidence_status, question_evidence_summary


def source(i, **kw):
    values = dict(id=str(i), raw_text=f'original body {i}', source_url=f'https://example.com/{i}',
                  content_hash='', title='面经', status='analyzed', metadata_json={})
    values.update(kw)
    values.setdefault('extracted_questions', [{'question':'Q', 'evidence_quote':values['raw_text']}])
    return SimpleNamespace(**values)


def test_reposts_and_compilations_do_not_inflate_readiness():
    items = [source(i, raw_text='same original') for i in range(4)]
    assert evidence_summary(items)['source_group_count'] == 1
    assert not ready_for_brief(items)
    items = [source(i, metadata_json={'source_kind':'compilation'}) for i in range(4)]
    assert evidence_summary(items)['source_group_count'] == 0


def test_unknown_independence_is_not_sufficiency():
    items = [source(i) for i in range(4)]
    assert ready_for_brief(items)
    assert evidence_status(items) == 'limited'
    assert evidence_summary(items)['confirmed_independent_count'] == 0


def reviewed(i, **kw):
    item = source(i, **kw)
    item.metadata_json = {'evidence_review': {
        'reviewer': 'user', 'content_hash': sha256(item.raw_text.encode()).hexdigest(),
        'source_kind': 'first_person', 'quote': item.raw_text,
        'origin_cluster': str(i), 'origin_url': item.source_url}}
    return item


def test_confirmed_origins_merge_transitively_without_inventing_coverage():
    items = [reviewed(i) for i in range(4)]
    for item in items:
        item.metadata_json['evidence_review']['origin_cluster'] = 'one'
    assert evidence_summary(items)['confirmed_independent_count'] == 1
    assert not evidence_summary(items)['coverage_verified']


def test_boolean_origin_claim_and_stale_review_never_establish_independence():
    legacy = source(0, metadata_json={'source_kind': 'first_person', 'origin_verified': True,
                                     'independent_origin_cluster': 'old'})
    stale = reviewed(1)
    stale.raw_text += 'changed after review'
    machine = reviewed(2)
    machine.metadata_json['evidence_review']['reviewer'] = 'model'
    invented_quote = reviewed(3)
    invented_quote.metadata_json['evidence_review']['quote'] = 'not in source'
    result = evidence_summary([legacy, stale, machine, invented_quote])
    assert result['confirmed_independent_count'] == 0
    assert result['invalidated_review_source_ids'] == ['1', '2', '3']


def test_four_human_confirmed_origins_do_not_imply_jd_coverage():
    items = [reviewed(i) for i in range(4)]
    assert evidence_summary(items)['confirmed_independent_count'] == 4
    assert evidence_status(items) == 'limited'


def test_same_original_url_connects_alias_groups_transitively():
    first, second, bridge = [reviewed(i) for i in range(3)]
    bridge.metadata_json['evidence_review']['origin_cluster'] = '0'
    bridge.metadata_json['evidence_review']['origin_url'] = second.source_url
    for order in ([first, second, bridge], [bridge, second, first]):
        summary = evidence_summary(order)
        assert summary['source_group_count'] == 1
        assert summary['confirmed_independent_count'] == 1


def test_similar_questions_and_stale_hashes_do_not_merge_distinct_posts():
    items = [source(0, raw_text='一面问了为什么转行。我之前做客服。', content_hash='stale'),
             source(1, raw_text='一面问了为什么转行。我之前做技术。', content_hash='stale')]
    assert evidence_summary(items)['source_group_count'] == 2


def test_generic_query_document_ids_are_preserved_and_bad_urls_do_not_crash():
    items = [source(i, raw_text='', source_url=f'https://example.com/view?id={i}') for i in range(2)]
    assert evidence_summary(items)['source_group_count'] == 2
    broken = source(2, raw_text='', source_url='https://[broken')
    assert evidence_summary([broken])['source_group_count'] == 0


def test_frequency_requires_this_question_and_a_current_quote():
    first = reviewed(1)
    first.extracted_questions = [{'question': '目标问题', 'evidence_quote': first.raw_text}]
    unrelated = reviewed(2)
    unrelated.extracted_questions = [{'question': '其他问题', 'evidence_quote': unrelated.raw_text}]
    stale = reviewed(3)
    stale.extracted_questions = [{'question': '目标问题', 'evidence_quote': '不存在的引用', 'evidence_valid': True}]
    missing_quote = reviewed(4)
    missing_quote.extracted_questions = [{'question': '目标问题', 'evidence_valid': True}]
    summary = question_evidence_summary([first, unrelated, stale, missing_quote, first], '目标问题')
    assert summary == dict(observed_source_group_count=1, confirmed_independent_count=1,
                          supporting_source_ids=['1'], independence_status='confirmed')
    assert question_evidence_summary([first], '模型泛化后的其他问题')['independence_status'] == 'unsupported'


def test_frequency_reports_unknown_and_partial_instead_of_claiming_exact_count():
    unknown = source(0, extracted_questions=[{'question': 'Q', 'evidence_quote': 'original body'}])
    known = reviewed(1)
    known.extracted_questions = [{'question': 'Q', 'evidence_quote': known.raw_text}]
    assert question_evidence_summary([unknown], ' q ')['independence_status'] == 'unverified'
    summary = question_evidence_summary([known, unknown], 'Q')
    assert summary['observed_source_group_count'] == 2
    assert summary['confirmed_independent_count'] == 1
    assert summary['independence_status'] == 'partial'
    unknown.metadata_json = {'source_kind': 'compilation'}
    summary = question_evidence_summary([unknown], 'Q')
    assert summary['observed_source_group_count'] == 0
    assert summary['supporting_source_ids'] == ['0']
    assert summary['independence_status'] == 'not_independent'
