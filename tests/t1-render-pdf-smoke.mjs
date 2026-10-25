import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveElectronRuntime } from "../scripts/electron-runtime.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");
const output = path.resolve(process.env.FETCHCV_T1_RENDER_OUTPUT || path.join(projectRoot, ".tmp/t1-surfaces-electron"));
assert.ok(output.startsWith(`${projectRoot}${path.sep}`), "Synthetic output must stay inside the workspace");
for (const folder of ["appdata", "localappdata", "tmp"]) fs.mkdirSync(path.join(output, folder), { recursive: true });
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS"].includes(key)));
Object.assign(env, {
  APPDATA: path.join(output, "appdata"), LOCALAPPDATA: path.join(output, "localappdata"), TEMP: path.join(output, "tmp"), TMP: path.join(output, "tmp"),
  FETCHCV_T1_RENDER_OUTPUT: output, FETCHCV_DATABASE_URL: `sqlite:///${path.join(output, "runtime.sqlite").replaceAll("\\", "/")}`,
  FETCHCV_SETTINGS_FILE: path.join(output, "settings.json"), FETCHCV_ARTIFACT_ROOT: path.join(output, "artifacts"), FETCHCV_WORKSPACE_ROOT: path.join(output, "workspace"),
  FETCHCV_ALLOW_MOCK_RUNTIME: "1",
});
function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: projectRoot, env, encoding: "utf8", timeout: 60000, windowsHide: true });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `Isolated smoke process failed: ${result.status}`);
}
const runtime = await resolveElectronRuntime({ projectRoot });
run(runtime.executable, [path.join(projectRoot, "tests/fixtures/t1-resume-text-render.cjs")]);
run(process.execPath, ["scripts/run-python.mjs", "-c", `
from pathlib import Path
import json, os, sys
sys.path.insert(0, str(Path.cwd() / 'backend'))
from pypdf import PdfReader
from applyos_harness.gates import require_pdf_text_matches_resume
from applyos_harness.validation import grounded_claim
from applyos_harness.versioning import canonical_hash
from applyos_domain.database import Database
from applyos_domain.models import Candidate, Fact, ResumeVersion
from applyos_api.main import create_app
from fastapi.testclient import TestClient
root = Path(os.environ['FETCHCV_T1_RENDER_OUTPUT'])
snapshot = json.loads((root / 'synthetic-snapshot.json').read_text(encoding='utf8'))
text = '\\n'.join(page.extract_text() or '' for page in PdfReader(root / 'synthetic-editor.pdf').pages)
assert '整理订单项目的数据' in text, repr(text)
require_pdf_text_matches_resume(ResumeVersion(candidate_id='synthetic-only', name='synthetic', content_json={'editor_snapshot': snapshot}), text)
db = Database(os.environ['FETCHCV_DATABASE_URL']); db.create_schema()
try:
    with db.session() as session:
        candidate = Candidate(name=snapshot['profile']['name']); session.add(candidate); session.flush()
        fact = Fact(candidate_id=candidate.id, category='synthetic', content='整理订单项目的数据。', verified=True, allowed_outputs=['resume']); session.add(fact); session.flush()
        content = {'editor_snapshot': snapshot, 'claims': [grounded_claim(fact).model_dump(mode='json')], 'verification_status': 'verified'}
        stored = ResumeVersion(candidate_id=candidate.id, name='synthetic', content_json=content, content_hash=canonical_hash(content), source_fact_ids=[fact.id]); session.add(stored); session.flush()
        resume_id, version = stored.id, stored.content_hash
    with TestClient(create_app(db)) as client:
        response = client.put(f'/api/resumes/{resume_id}/pdf', content=(root/'synthetic-editor.pdf').read_bytes(), headers={'Content-Type':'application/pdf','X-FetchCV-Resume-Hash':version})
        assert response.status_code == 200, response.text
        downloaded = client.get(f'/api/resumes/{resume_id}/pdf')
        assert downloaded.status_code == 200, downloaded.text
        assert downloaded.content == (root/'synthetic-editor.pdf').read_bytes()
    report = json.loads((root/'render-report.json').read_text(encoding='utf8'))
    report.update({'backendTextGuard':True,'putStatus':response.status_code,'getStatus':downloaded.status_code,'samePdfBytes':True,'extractedChars':len(text)})
    (root/'render-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps(report,ensure_ascii=False))
finally:
    db.engine.dispose()
`]);
