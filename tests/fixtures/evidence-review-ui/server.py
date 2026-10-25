"""Real API, synthetic source, isolated SQLite. Never loads user data."""
import argparse
import json
import os
from pathlib import Path
import socket
import sqlite3
import sys

parser = argparse.ArgumentParser()
parser.add_argument('--run-root', required=True)
parser.add_argument('--inspect', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parents[3]
run = Path(args.run_root).resolve()
run.relative_to(root / '.m1-evidence')
database_path = run / 'fixture.db'
if args.inspect:
    with sqlite3.connect(database_path.as_uri() + '?mode=ro', uri=True) as db:
        row = db.execute("SELECT metadata_json FROM interview_sources WHERE id='ui-source'").fetchone()
        print(row[0])
    raise SystemExit(0)

sys.path.insert(0, str(root / 'backend'))
os.environ['FETCHCV_WORKSPACE_ROOT'] = str(run / 'workspace')
os.environ['FETCHCV_DATABASE_URL'] = 'sqlite:///' + database_path.as_posix()
os.environ['FETCHCV_AGENT_RUNTIME'] = 'mock'
os.environ['FETCHCV_ALLOW_MOCK_RUNTIME'] = '1'
assert os.environ['FETCHCV_ALLOWED_ORIGINS'].startswith('http://127.0.0.1:')
assert os.environ['FETCHCV_CONTROL_TOKEN']

from applyos_domain.database import Database
from applyos_domain.models import Candidate, InterviewSource
from applyos_api.main import create_app
import uvicorn

db = Database(os.environ['FETCHCV_DATABASE_URL'])
db.create_schema()
with db.session() as session:
    session.add(Candidate(id='ui-owner', name='合成验收'))
    session.flush()
    session.add(InterviewSource(
        id='ui-source', candidate_id='ui-owner', company='合成公司', role='产品经理',
        title='产品经理面经（合成验收）', platform='synthetic', source_url='https://example.com/original',
        url_hash='f' * 64, raw_text='我参加了产品面试。面试官问如何开展用户研究。',
        status='analyzed', extracted_questions=[{
            'question': '如何开展用户研究', 'evidence_quote': '面试官问如何开展用户研究。'}]))

# Bind an OS-selected port and retain the socket; no free-port handoff race.
sock = socket.socket()
sock.bind(('127.0.0.1', 0))
app = create_app(db)
(run / 'api-address.json').write_text(json.dumps({'port': sock.getsockname()[1]}), encoding='utf-8')
server = uvicorn.Server(uvicorn.Config(app, log_level='warning'))
server.run(sockets=[sock])
