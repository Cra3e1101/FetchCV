"""Bounded official-JD -> public interview -> FTS/readback evaluation.

Run with --cases <local cases.json>. Creates a NEW isolated DB, never opens the
desktop user database. No LLM, account session, OCR or application submission.
Cases must come from verified official JD import, not personal target guesses.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import sys
import time
from types import SimpleNamespace
from contextlib import nullcontext
from retrieval_eval_support import SnapshotReplay, no_network, freeze_inputs, summarize_stages, hash_file

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from applyos_domain.database import Database
from applyos_domain.models import Candidate, Job, AgentRun
from applyos_domain.interview_ranking import score_interview
from applyos_harness.permissions import ToolGateway, ToolPermission
from applyos_agent.interview_tools import register_interview_tools, _candidate_relevance
from applyos_agent.browser_tools import BrowserBridgeClient
from integrations.web import WebClient, FirecrawlClient
from applyos_harness.errors import HarnessError


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cases', type=Path, required=True)
    parser.add_argument('--case-id', help='Run one explicit case for a bounded smoke check')
    parser.add_argument('--max-posts', type=int, default=3, choices=range(1, 6))
    parser.add_argument('--seed-links', type=Path, help='Externally discovered URLs, by case ID; provenance must be supplied')
    parser.add_argument('--skip-discovery', action='store_true', help='Capture-only replay of the explicit seed list')
    parser.add_argument('--replay-from', type=Path, help='Replay recorded HTTP responses strictly offline; no network fallback')
    parser.add_argument('--output-dir', type=Path, help='New isolated output directory; must not exist')
    args = parser.parse_args()
    cases = json.loads(args.cases.read_text(encoding='utf-8'))
    if args.case_id:
        cases = [c for c in cases if c['id'] == args.case_id]
        if not cases: parser.error('unknown --case-id')
    seeds = json.loads(args.seed_links.read_text(encoding='utf-8')) if args.seed_links else {}
    if args.skip_discovery and not seeds:
        parser.error('--skip-discovery requires --seed-links')
    replay = SnapshotReplay(args.replay_from) if args.replay_from else None
    out = args.output_dir or args.cases.parent / ('paired-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
    out.mkdir(); (out / 'interviews').mkdir(); (out / 'evidence').mkdir()
    cases, frozen_root = freeze_inputs(out, cases, args.cases.parent, seeds, ROOT, replay_from=args.replay_from)
    db = Database('sqlite:///' + (out / 'evaluation.db').as_posix()); db.create_schema()
    class RecordingWeb(WebClient):
        def __init__(self):
            # Offline URL validation retains syntax/private-literal protections,
            # but does not consult DNS. No real requests can use this resolver.
            super().__init__(**({'resolver': lambda *a, **kw: [(2, 1, 6, '', ('8.8.8.8', 443))]} if replay else {}))
            self.search_endpoints = ['https://www.bing.com/search', 'https://html.duckduckgo.com/html/']

        def record(self, row):
            with (out / 'evidence' / 'responses.jsonl').open('a', encoding='utf-8') as log:
                log.write(json.dumps(row, ensure_ascii=False)+'\n')

        def read(self, url, **kwargs):
            try:
                if replay:
                    try:
                        row = replay.take(url)
                    except LookupError as exc:
                        raise HarnessError('offline_snapshot_missing', str(exc)) from exc
                    if 'error_code' in row:
                        raise HarnessError(row['error_code'], row.get('error_message', 'recorded network error'),
                                           retryable=row.get('retryable', False))
                    result = (row['final_url'], replay.read_body(row), row['content_type'], row['status'])
                else:
                    result = super().read(url, **kwargs)
            except HarnessError as exc:
                self.record(dict(requested_url=url, error_code=exc.code, error_message=exc.message,
                                 retryable=exc.retryable))
                raise
            final_url, raw, content_type, status = result
            digest = sha256(raw).hexdigest()
            (out / 'evidence' / (digest + '.body')).write_bytes(raw)
            self.record(dict(requested_url=url, final_url=final_url,
                    content_type=content_type, status=status, sha256=digest,
                    body_file=digest+'.body'))
            return result
    web = RecordingWeb()
    permissions = {ToolPermission.READ, ToolPermission.NETWORK_READ, ToolPermission.DRAFT_WRITE}
    events, pairs, corpus = [], [], {}

    def save(name, data):
        (out / name).write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str), encoding='utf-8')

    def call(run_id, name, arguments, key):
        start = time.perf_counter()
        event = dict(case_id=current['id'], tool=name, arguments=arguments,
                     time=datetime.now(timezone.utc).isoformat())
        try:
            with (no_network() if replay else nullcontext()), db.session() as session:
                gateway = ToolGateway(session, workspace_root=out)
                register_interview_tools(gateway, web_client=web,
                    browser_client=BrowserBridgeClient(base_url='', token=''),
                    firecrawl_client=FirecrawlClient(base_url='', api_key='', web_client=web))
                result = gateway.execute(tool_name=name, run=session.get(AgentRun, run_id),
                    arguments=arguments, granted_permissions=permissions, idempotency_key=key)
                event.update(ok=True, result=result)
        except Exception as exc:
            event.update(ok=False, code=getattr(exc, 'code', type(exc).__name__), error=str(exc))
        event['duration_ms'] = round((time.perf_counter() - start) * 1000, 2)
        events.append(event); save('evidence/events.json', events)
        return event

    with db.session() as session:
        candidate = Candidate(name='Representative evaluation — no personal resume')
        session.add(candidate); session.flush(); candidate_id = candidate.id
    for current in cases:
        scope = dict(company=current['company'], role=current['title'], business_unit=current['business_unit'])
        jd = (frozen_root / current['file']).read_text(encoding='utf-8')
        with db.session() as session:
            job = Job(candidate_id=candidate_id, company=current['company'], role=current['title'], jd_raw=jd)
            session.add(job); session.flush()
            run = AgentRun(candidate_id=candidate_id, job_id=job.id, run_type='conversation', current_stage='created')
            session.add(run); session.flush(); run_id = run.id
        query = ' '.join([current['company'], current['title'], '面经'])
        seed_candidates = list(seeds.get(current['id'], []))
        automatic_candidates = []
        candidates = list(seed_candidates)
        if not args.skip_discovery:
            discovered = call(run_id, 'discover_interview_sources', {**scope, 'platforms':['nowcoder'],
                'nowcoder_page_limit':1}, current['id']+'-discover')
            automatic_candidates = discovered.get('result', {}).get('data', {}).get('results', [])
            candidates += automatic_candidates
        pair = dict(case_id=current['id'], official_jd='inputs/'+current['file'], jd_url=current['source_url'],
                    jd_online_status=current['online_status'], query=query, discovered=len(automatic_candidates),
                    automatic_urls=sorted({x['url'] for x in automatic_candidates}),
                    external_seed_urls=sorted({x['url'] for x in seed_candidates}),
                    captured_source_ids=[], capture_records=[], excluded_candidates=[], matches=[], human_labels='pending',
                    discovery_mode='external_search_seeds' if args.skip_discovery else 'production_plus_external_seeds' if seed_candidates else 'production_discovery',
                    seed_provenance=seeds.get(current['id'], []))
        attempts = 0
        attempted_urls = set()
        for item in candidates:
            if item['url'] in attempted_urls: continue
            attempted_urls.add(item['url'])
            if attempts >= args.max_posts: break
            # Discovery cards are provisional. Do not apply title-only corpus
            # ranking before reading: generic titles can have informative snippets.
            if not _candidate_relevance(scope['company'], scope['business_unit'], scope['role'],
                                        item.get('title',''), item.get('snippet','')):
                pair['excluded_candidates'].append(dict(url=item['url'], title=item.get('title'),
                    reason='discovery_card_scope_not_supported')); continue
            attempts += 1
            if not replay: time.sleep(1)
            event = call(run_id, 'capture_interview_source', {**scope,'url':item['url']}, current['id']+f'-capture-{attempts}')
            pair['capture_records'].append(dict(url=item['url'], ok=event['ok'], error_code=event.get('code'),
                found_automatically=item['url'] in pair['automatic_urls'],
                supplied_as_seed=item['url'] in pair['external_seed_urls']))
            if not event['ok']:
                if event.get('code') in {'interview_source_public_access_stopped','web_rate_limited','tool_outcome_unknown'}: break
                continue
            source = event['result']['data']['source']; sid = source['id']
            body = source.pop('raw_text', '')
            corpus[sid] = {**source, 'file':f'interviews/{sid}.md','body_sha256':sha256(body.encode()).hexdigest(),
                           'body_chars':len(body),'label_status':'unreviewed_author_claims'}
            (out / corpus[sid]['file']).write_text('# '+source['title']+'\n\n来源：'+source['source_url']+'\n\n'+body+'\n', encoding='utf-8')
            pair['captured_source_ids'].append(sid)
            print('CAPTURE',current['id'],source['title'],len(body),flush=True)
        searched = call(run_id, 'search_interview_knowledge', {**scope,'max_results':10}, current['id']+'-search')
        for hit in searched.get('result',{}).get('data',{}).get('sources',[]):
            pair['matches'].append(dict(source_id=hit['id'], title=hit['title'],
                source_url=hit['source_url'], ranking=hit['reference_ranking'],label='machine_candidate_not_gold'))
        if pair['matches']:
            first = pair['matches'][0]['source_id']
            read = call(run_id,'read_interview_source',dict(source_id=first,limit=1000),current['id']+'-read')
            pair['readback_ok'] = read['ok']
        else: pair['readback_ok'] = None
        pair['capture_attempts'] = attempts
        pair['status'] = ('retrieval_tool_failed' if not searched['ok'] else
                          'retrieved_candidates_need_labels' if pair['matches'] else
                          'capture_failed_or_unreadable' if attempts and not pair['captured_source_ids'] else
                          'captured_but_not_retrieved' if pair['captured_source_ids'] else 'no_eligible_candidate_found')
        pairs.append(pair); save('pairs.json',pairs); save('corpus.json',list(corpus.values()))
        print('CASE',current['title'],len(pair['matches']),pair['status'],flush=True)
    save('summary.json',dict(cases=len(pairs),with_matches=sum(bool(p['matches']) for p in pairs),
        execution='offline_replay' if replay else 'live_anonymous_http',
        automatic_discovery_case_coverage=sum(bool(p['automatic_urls']) for p in pairs),
        automatic_relevance_recall=None, relevance_labels='pending',
        unique_sources=len(corpus),tool_calls=len(events),failed_calls=sum(not e['ok'] for e in events),
        no_model_calls=True,no_resume_uploads=True,no_account_session=True,
        scope=('external seed discovery; ' if args.skip_discovery else 'production discovery; ') +
              'actual gateway capture/FTS/rerank/readback; no generated brief; no gold relevance claims',
        xiaohongshu='not exercised in this nowcoder-only run; bridge disabled explicitly'))
    save('stage-report.json', summarize_stages(pairs, events))
    save('run-config.json', dict(max_posts=args.max_posts, skip_discovery=args.skip_discovery,
        case_ids=[c['id'] for c in cases], execution='offline_replay' if replay else 'live_anonymous_http',
        cases='inputs/cases.json', seeds='inputs/seeds.json',
        search_endpoints=web.search_endpoints))
    if replay:
        save('replay-report.json', replay.report())
    save('artifact-manifest.json', {'schema':'retrieval-artifacts-v1', 'files':{
        p.relative_to(out).as_posix(): hash_file(p) for p in sorted(out.rglob('*'))
        if p.is_file() and p.suffix not in {'.db', '.body'} and p.name != 'artifact-manifest.json'},
        'note':'DB is disposable; HTTP bodies have their own recorded SHA256. Manifest is an integrity record, not an external signature.'})
    db.engine.dispose()
    print('OUTPUT='+str(out),flush=True)
    if replay and replay.missing:
        print('INCOMPLETE: requested URLs missing from snapshots; no live network fallback', file=sys.stderr)
        raise SystemExit(2)


if __name__ == '__main__': main()
