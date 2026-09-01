import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");

test("job sidebar groups roles into collapsible company drawers", () => {
  const sidebar = source.slice(source.indexOf("function JobSidebar"), source.indexOf("function EmptyWorkspace"));
  assert.match(sidebar, /const companyGroups = useMemo/);
  assert.match(sidebar, /className="company-group-toggle"/);
  assert.match(sidebar, /aria-expanded=\{!collapsed\}/);
  assert.match(sidebar, /className="company-job-list"/);
  assert.match(sidebar, /aria-label=\{`\$\{job\.company\} \$\{job\.role\}`\}/);
});

test("selected jobs use a neutral surface without an accent rail", () => {
  assert.match(css, /\.company-job-list \.job-row-shell\.active\s*\{[\s\S]*?border-color:\s*#ded9d1/);
  assert.match(css, /\.company-job-list \.job-row-shell\.active::before,[\s\S]*?content:\s*none/);
  assert.match(css, /\.company-job-group\.collapsed \.company-job-list\s*\{[\s\S]*?max-height:\s*0/);
});
