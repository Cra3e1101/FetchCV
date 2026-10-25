"""Compare owned T3 source snapshot; no application imports or settings reads."""
import ast
import difflib
import hashlib
import json
from pathlib import Path

repo=Path(__file__).resolve().parents[3]
output=repo/"artifacts/t3-independent"
baseline=json.loads((repo/".tmp/t3-synthetic/source-baseline.json").read_text(encoding="utf-8-sig"))
rows=[]
for item in baseline:
    after=hashlib.sha256((repo/item["path"]).read_bytes()).hexdigest()
    rows.append({"path":item["path"],"before":item["sha256"].lower(),"after":after,"unchanged":item["sha256"].lower()==after})
core=["backend/applyos_harness/validation.py","backend/applyos_harness/gates.py","backend/applyos_harness/approval.py","backend/applyos_agent/application_tools.py","backend/integrations/resume/renderer.py","public/resume-editor/app.js","src/components/ConversationWorkspace.jsx"]
assert all(row["unchanged"] for row in rows if row["path"] in core)
def assignments(filename):
    tree=ast.parse(filename.read_text(encoding="utf-8-sig"))
    return {node.targets[0].id:ast.dump(node.value,include_attributes=False) for node in tree.body if isinstance(node,ast.Assign) and isinstance(node.targets[0],ast.Name)}
ranking="backend/applyos_domain/interview_ranking.py"
old=assignments(repo/".tmp/t3-synthetic/source-before"/ranking)
new=assignments(repo/ranking)
unchanged_policy={key:old[key]==new[key] for key in ("WEIGHTS","HALF_LIFE_DAYS","POLICY_VERSION")}
assert all(unchanged_policy.values())
diffs={}
for filename in ["backend/applyos_harness/pipeline.py","backend/applyos_agent/pi_domain_tools.py"]:
    before=(repo/".tmp/t3-synthetic/source-before"/filename).read_text(encoding="utf-8-sig").splitlines()
    after=(repo/filename).read_text(encoding="utf-8-sig").splitlines()
    diffs[filename]="\n".join(difflib.unified_diff(before,after,fromfile="T3 source baseline",tofile="current",n=3))
result={"sources":rows,"core_rule_files":core,"core_rule_hashes_unchanged":True,"ranking_policy_constants_unchanged":unchanged_policy,"analysis_marker_only_diffs_for_review":diffs}
(output/"source-audit.json").write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps({"core_rule_hashes_unchanged":True,"ranking_policy_constants_unchanged":unchanged_policy,"changed_files":[row["path"] for row in rows if not row["unchanged"]]},ensure_ascii=False))
