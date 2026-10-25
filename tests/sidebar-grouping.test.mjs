import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
const source=fs.readFileSync(new URL("../src/ui/WorkspaceSidebar.jsx",import.meta.url),"utf8");
const css=fs.readFileSync(new URL("../src/ui/replica-components.css",import.meta.url),"utf8");
test("source sidebar retains job selection, search and separate management actions",()=>{
 assert.match(source,/onSelect\(job.id\)/);assert.match(source,/onManage\(job\)/);
 assert.match(source,/aria-label="搜索侧栏岗位"/);assert.match(source,/job.company/);assert.match(source,/job.role/);
 assert.match(source,/className="rp-row source-job-item"/);
});
test("reference sidebar retains inset rows and readable single-line labels",()=>{
 assert.match(css,/padding:0 10px 12px/);assert.match(css,/rp-row[^}]*font:400 14px\/22px/);
 assert.match(css,/rp-row\[aria-current=page\]/);
});
