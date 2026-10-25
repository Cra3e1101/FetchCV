"""Prepare blinded JD/source pairs. No inferred relevance labels or gold claims."""
import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
from retrieval_eval_support import contained, hash_file, write_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset', type=Path, required=True)
    parser.add_argument('--run', action='append', help='Explicit paired-* directory names; repeatable. Default: all existing runs')
    args = parser.parse_args()
    root = args.dataset.resolve()
    cases = json.loads((root / 'cases.json').read_text(encoding='utf-8'))
    sources = {}
    provenance = {}
    inputs = {str(root / 'cases.json'): hash_file(root / 'cases.json')}
    runs = [contained(root, name) for name in args.run] if args.run else sorted(root.glob('paired-*'))
    for run in runs:
        if not (run / 'corpus.json').exists():
            continue
        corpus = json.loads((run / 'corpus.json').read_text(encoding='utf-8'))
        pairs = json.loads((run / 'pairs.json').read_text(encoding='utf-8'))
        inputs[str(run / 'corpus.json')] = hash_file(run / 'corpus.json')
        inputs[str(run / 'pairs.json')] = hash_file(run / 'pairs.json')
        for pair in pairs:
            for sid in pair['captured_source_ids']:
                provenance.setdefault(sid, []).append({'run': run.name, 'case_id': pair['case_id'],
                    'discovery_mode': pair.get('discovery_mode', 'unknown')})
        for item in corpus:
            # Exact-content grouping only. Near duplicates and common origin
            # still require review; an exact cluster is NOT independent evidence.
            key = item.get('body_sha256') or hashlib.sha256(item['source_url'].encode()).hexdigest()
            if key not in sources:
                sources[key] = {'source_id': item['id'], 'title': item['title'],
                    'url': item['source_url'], 'body_file': str(contained(run, item['file'])),
                    'exact_content_cluster': key, 'original_source_ids': []}
            sources[key]['original_source_ids'].append(item['id'])
    out = root / ('review-pool-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
    out.mkdir(exist_ok=False)
    (out / 'sources').mkdir(); (out / 'jd').mkdir()
    for i, source in enumerate(sources.values()):
        original = Path(source['body_file'])
        inputs[str(original)] = hash_file(original)
        source['body_file'] = f'sources/{i:04d}.md'
        (out / source['body_file']).write_bytes(original.read_bytes())
    rows = []
    for i, case in enumerate(cases):
        original_jd = contained(root, case['file'])
        inputs[str(original_jd)] = hash_file(original_jd)
        jd_file = f'jd/{i:03d}.md'
        (out / jd_file).write_bytes(original_jd.read_bytes())
        for source in sources.values():
            rows.append({'case_id': case['id'], 'jd_file': jd_file,
                'jd_title': case['title'], 'company': case['company'], **source,
                'relevance_0_to_3': None, 'source_kind': None, 'interview_date': None,
                'independent_origin_cluster': None, 'rationale': None, 'reviewer': None,
                'split': None, 'label_status': 'unreviewed',
                'pool_origin': 'existing_capture_pool_not_independent'})
    # Deterministic order without ranking scores or a relevance-derived order.
    rows.sort(key=lambda r: hashlib.sha256((r['case_id'] + r['source_id']).encode()).hexdigest())
    (out / 'blind-labels.jsonl').write_text(''.join(json.dumps(r, ensure_ascii=False)+'\n' for r in rows), encoding='utf-8')
    (out / 'provenance.json').write_text(json.dumps(provenance, ensure_ascii=False, indent=2), encoding='utf-8')
    (out / 'summary.json').write_text(json.dumps({'cases':len(cases), 'exact_content_groups':len(sources),
        'pairs':len(rows), 'labeled_pairs':0, 'gold_recall':None, 'ndcg':None,
        'pool_bias':'existing captures only; independent pooled search still required'}, indent=2), encoding='utf-8')
    write_json(out / 'input-manifest.json', {'schema':'blind-review-inputs-v1', 'origins': inputs,
        'files': {p.relative_to(out).as_posix(): hash_file(p) for p in out.rglob('*.md')},
        'note':'blind-labels.jsonl is editable; source/JD copies are frozen. Provenance is deliberately separate from labeling.'})
    print(out)


if __name__ == '__main__':
    main()
