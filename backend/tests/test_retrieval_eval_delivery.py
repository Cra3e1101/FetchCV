"""Offline delivery contracts: no network fallback, frozen evidence, honest metrics."""
from hashlib import sha256
import importlib.util
import json
from pathlib import Path
import socket
import sys

import pytest

SCRIPTS = Path(__file__).resolve().parents[2] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
from retrieval_eval_support import (SnapshotReplay, no_network, freeze_inputs, hash_file,
                                    evaluate_labels, summarize_stages)


def snapshot(root, url='https://example.com/post', body=b'<html>fixture</html>'):
    evidence = root / 'evidence'
    evidence.mkdir(exist_ok=True)
    digest = sha256(body).hexdigest()
    (evidence / (digest + '.body')).write_bytes(body)
    row = dict(requested_url=url, final_url=url, content_type='text/html', status=200,
               sha256=digest, body_file=digest + '.body')
    (evidence / 'responses.jsonl').write_text(json.dumps(row) + '\n', encoding='utf-8')
    return row


def test_snapshot_replay_is_consuming_and_rejects_changed_content(tmp_path):
    row = snapshot(tmp_path)
    replay = SnapshotReplay(tmp_path)
    assert replay.read_body(replay.take(row['requested_url'])) == b'<html>fixture</html>'
    with pytest.raises(LookupError):
        replay.take(row['requested_url'])
    assert not replay.report()['complete_for_requested_urls']
    (tmp_path / 'evidence' / row['body_file']).write_bytes(b'changed')
    with pytest.raises(ValueError, match='hash mismatch'):
        SnapshotReplay(tmp_path)


def test_snapshot_cannot_escape_evidence_directory(tmp_path):
    row = snapshot(tmp_path)
    row['body_file'] = '../../outside'
    (tmp_path / 'evidence/responses.jsonl').write_text(json.dumps(row), encoding='utf-8')
    with pytest.raises(ValueError, match='escapes'):
        SnapshotReplay(tmp_path)


def test_missing_snapshot_is_not_an_empty_page_and_network_is_blocked(tmp_path):
    snapshot(tmp_path)
    replay = SnapshotReplay(tmp_path)
    with no_network():
        with pytest.raises(LookupError):
            replay.take('https://unrecorded.example/')
        with pytest.raises(RuntimeError, match='forbidden'):
            socket.create_connection(('example.com', 443))
        with pytest.raises(RuntimeError, match='forbidden'):
            socket.getaddrinfo('example.com', 443)


def test_recorded_transport_failure_is_preserved(tmp_path):
    snapshot(tmp_path)
    with (tmp_path / 'evidence/responses.jsonl').open('a', encoding='utf-8') as stream:
        stream.write(json.dumps({'requested_url': 'https://example.com/fail', 'error_code':'web_rate_limited'}) + '\n')
    assert SnapshotReplay(tmp_path).take('https://example.com/fail')['error_code'] == 'web_rate_limited'


def test_replaying_prior_snapshot_gap_does_not_turn_it_into_verified_response(tmp_path):
    snapshot(tmp_path)
    with (tmp_path / 'evidence/responses.jsonl').open('a', encoding='utf-8') as stream:
        stream.write(json.dumps({'requested_url':'https://example.com/missing',
                                 'error_code':'offline_snapshot_missing'}) + '\n')
    replay = SnapshotReplay(tmp_path)
    replay.take('https://example.com/missing')
    assert replay.report()['complete_for_requested_urls'] is False


def test_frozen_jd_is_independent_of_subsequent_source_edit(tmp_path):
    dataset = tmp_path / 'dataset'; dataset.mkdir()
    (dataset / 'jd.md').write_text('original JD', encoding='utf-8')
    out = tmp_path / 'out'; out.mkdir()
    cases, frozen = freeze_inputs(out, [{'id':'a','file':'jd.md'}], dataset, {}, tmp_path)
    (dataset / 'jd.md').write_text('changed JD', encoding='utf-8')
    assert (frozen / cases[0]['file']).read_text() == 'original JD'
    manifest = json.loads((out / 'input-manifest.json').read_text())
    assert all(hash_file(out / p) == h for p, h in manifest['files'].items())


def pair(**kwargs):
    return dict(case_id='a', discovery_mode='production_discovery', automatic_urls=['https://a'],
                external_seed_urls=['https://b'], captured_source_ids=['a'],
                matches=[{'source_url':'https://a'}], status='retrieved_candidates_need_labels', **kwargs)


def labels():
    return [{'case_id':'a', 'url':'https://' + url, 'relevance_0_to_3':3,
             'reviewer':'human', 'rationale':'read source', 'split':'test',
             'independent_origin_cluster':url, 'pool_origin':'independent_search_pool'} for url in ['a','b']]


def test_seed_links_never_count_in_automatic_recall():
    result = evaluate_labels([pair()], labels())
    assert result['cases'][0]['automatic_discovery_pool_recall'] == 0.5
    assert 0 < result['cases'][0]['ndcg_at_5'] < 1
    only_seeds = pair(); only_seeds['discovery_mode'] = 'external_search_seeds'
    assert evaluate_labels([only_seeds], labels())['cases'][0]['automatic_discovery_pool_recall'] is None


@pytest.mark.parametrize('mutation', ['pending', 'not_independent', 'unjudged', 'cluster_leak', 'boolean_grade', 'duplicate'])
def test_metrics_withheld_for_unusable_labels(mutation):
    rows = labels(); current = pair()
    if mutation == 'pending': rows[0]['relevance_0_to_3'] = None
    if mutation == 'not_independent': rows[0]['pool_origin'] = 'existing_capture_pool_not_independent'
    if mutation == 'unjudged': current['matches'].append({'source_url':'https://unknown'})
    if mutation == 'cluster_leak': rows[1].update(independent_origin_cluster='a', split='train')
    if mutation == 'boolean_grade': rows[0]['relevance_0_to_3'] = True
    if mutation == 'duplicate': rows.append(dict(rows[0]))
    report = evaluate_labels([current], rows)
    assert report['status'] == 'withheld'
    assert report['pool_recall'] is None and report['ndcg_at_5'] is None


def test_zero_positive_pool_has_undefined_recall_not_perfect_score():
    rows = labels()
    for row in rows: row['relevance_0_to_3'] = 0
    result = evaluate_labels([pair()], rows)['cases'][0]
    assert result['automatic_discovery_pool_recall'] is None
    assert result['ndcg_at_5'] is None


def test_shared_origin_counts_once():
    rows = labels(); rows[1]['independent_origin_cluster'] = 'a'
    result = evaluate_labels([pair()], rows)['cases'][0]
    assert result['positive_origin_clusters'] == 1
    assert result['automatic_discovery_pool_recall'] == result['ndcg_at_5'] == 1


def test_stage_failures_are_distinct_from_zero_results():
    events = [dict(case_id='a', tool='capture_interview_source', ok=False, code='unreadable'),
              dict(case_id='a', tool='search_interview_knowledge', ok=True)]
    report = summarize_stages([pair()], events)
    row = report['cases'][0]
    assert row['capture_failures'] == 1
    assert row['retrieval_tool_failures'] == 0
    assert row['discovery_executed'] is False
    assert report['automatic_discovery_recall'] is None


def test_artifact_tampering_withholds_quality_metrics(tmp_path):
    spec = importlib.util.spec_from_file_location('paired_audit', SCRIPTS / 'evaluate-paired-retrieval.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    (tmp_path / 'evidence').mkdir()
    (tmp_path / 'pairs.json').write_text(json.dumps([pair()]), encoding='utf-8')
    (tmp_path / 'corpus.json').write_text('[]', encoding='utf-8')
    (tmp_path / 'evidence/events.json').write_text('[]', encoding='utf-8')
    (tmp_path / 'artifact-manifest.json').write_text(json.dumps({'files':{'pairs.json':'bad-hash'}}))
    report = module.audit_run(tmp_path, labels())
    assert not report['integrity_ok']
    assert report['quality']['status'] == 'withheld'


def test_incomplete_offline_run_cannot_get_quality_score_even_with_labels(tmp_path):
    spec = importlib.util.spec_from_file_location('paired_audit', SCRIPTS / 'evaluate-paired-retrieval.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    (tmp_path / 'evidence').mkdir()
    (tmp_path / 'pairs.json').write_text(json.dumps([pair()]), encoding='utf-8')
    (tmp_path / 'corpus.json').write_text('[]', encoding='utf-8')
    (tmp_path / 'evidence/events.json').write_text('[]', encoding='utf-8')
    (tmp_path / 'replay-report.json').write_text(json.dumps({'complete_for_requested_urls':False}))
    report = module.audit_run(tmp_path, labels())
    assert report['quality']['status'] == 'withheld'
    assert 'offline snapshots incomplete' in report['quality']['reasons']
