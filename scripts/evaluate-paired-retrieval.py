"""Audit a frozen paired run and optionally evaluate independent reviewed labels."""
import argparse
from pathlib import Path
import json
from retrieval_eval_support import read_json, hash_file, contained, SnapshotReplay, summarize_stages, evaluate_labels


def audit_run(root, labels=None):
    root = Path(root)
    problems = []
    manifest_path = root / 'input-manifest.json'
    if manifest_path.exists():
        manifest = read_json(manifest_path)
        for name, digest in manifest['files'].items():
            path = contained(root, name)
            if not path.exists() or hash_file(path) != digest:
                problems.append('input hash mismatch: ' + name)
        input_status = 'verified' if not problems else 'invalid'
    else:
        input_status = 'legacy_run_without_frozen_inputs'
    responses = root / 'evidence/responses.jsonl'
    snapshots = 'not_recorded'
    if responses.exists():
        try:
            SnapshotReplay(root)
            snapshots = 'body_hashes_verified'
        except (ValueError, KeyError, OSError) as exc:
            problems.append(str(exc)); snapshots = 'invalid'
    pairs = read_json(root / 'pairs.json')
    events = read_json(root / 'evidence/events.json')
    corpus = read_json(root / 'corpus.json')
    for item in corpus:
        # Existing Markdown includes a title/URL prefix, so validate full files
        # against new artifact manifests; never compare it to raw body_sha256.
        if not contained(root, item['file']).is_file():
            problems.append('missing corpus file: ' + item['file'])
    artifact_path = root / 'artifact-manifest.json'
    if artifact_path.exists():
        for name, digest in read_json(artifact_path)['files'].items():
            path = contained(root, name)
            if not path.exists() or hash_file(path) != digest:
                problems.append('artifact hash mismatch: ' + name)
    report = {'integrity_ok': not problems, 'problems': problems, 'inputs': input_status,
              'http_snapshots': snapshots, 'stages': summarize_stages(pairs, events)}
    report['replay'] = read_json(root / 'replay-report.json') if (root / 'replay-report.json').exists() else None
    if report['replay'] and not report['replay']['complete_for_requested_urls']:
        report['quality'] = {'status': 'withheld', 'reasons': ['offline snapshots incomplete'],
                             'pool_recall': None, 'ndcg_at_5': None}
    else:
        report['quality'] = evaluate_labels(pairs, labels or []) if not problems else {
            'status': 'withheld', 'reasons': ['input/artifact integrity failed'], 'pool_recall': None, 'ndcg_at_5': None}
    report['boundary'] = 'No labels are inferred. Stage counts are not quality metrics. Offline timing is not network P95.'
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', type=Path, required=True)
    parser.add_argument('--labels', type=Path)
    parser.add_argument('--output', type=Path, help='New report path; existing file is never overwritten')
    args = parser.parse_args()
    labels = [json.loads(line) for line in args.labels.read_text(encoding='utf-8-sig').splitlines() if line.strip()] if args.labels else None
    report = audit_run(args.run, labels)
    content = json.dumps(report, ensure_ascii=False, indent=2) + '\n'
    if args.output:
        with args.output.open('x', encoding='utf-8') as stream:
            stream.write(content)
    else:
        print(content)
    if not report['integrity_ok']:
        raise SystemExit(2)


if __name__ == '__main__':
    main()
