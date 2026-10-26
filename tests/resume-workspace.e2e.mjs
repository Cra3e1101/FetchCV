import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const artifactRoot = path.resolve("artifacts/resume-refresh");
await fs.mkdir(artifactRoot, { recursive: true });
const candidate = { id: "candidate-test", name: "林知远", resume_count: 1, fact_count: 7 };
const job = { id: "job-resume-test", candidate_id: candidate.id, company: "远山科技", role: "策略运营", jd_raw: "负责策略运营与数据分析。" };
const snapshot = { schema: 6, profile: { name: candidate.name, phone: "13800000000", email: "lin@example.com", age: "24", gender: "男", website: "https://example.com", summary: "善于分析问题、沟通协作并推动方案落地。", showPhoto: false }, sections: [
  { id: "education", title: "教育背景", tab: "教育背景", visible: true, builtin: true, items: [{ id: "edu-1", fields: { school: "南山大学", major: "数量经济学 | 硕士", gpa: "3.8 / 4", timeRange: { start: "2024.09", end: "2027.06" } }, metaLeft: "2024.09 — 2027.06", metaRight: "南山大学  数量经济学 | 硕士", body: "<strong>国家奖学金</strong>、数学建模竞赛二等奖" }] },
  { id: "internship", title: "实习经验", tab: "实习经验", visible: true, builtin: true, items: [{ id: "work-1", fields: { company: "远山科技有限公司", role: "策略运营", timeRange: { start: "2026.07", end: "至今" } }, metaLeft: "2026.07 — 至今", metaRight: "远山科技有限公司 策略运营", body: "<strong>策略优化：</strong>梳理城市业务流程，建立监测与反馈机制。<br><strong>数据分析：</strong>使用 SQL 与 Python 分析任务数据，支持团队制定优化方案。" }] },
  { id: "project", title: "项目经历", tab: "项目经历", visible: true, builtin: true, items: [{ id: "project-1", fields: { projectName: "消费者行为与产品体验研究", role: "研究负责人" }, metaLeft: "2025.06 — 2025.10", metaRight: "消费者行为与产品体验研究 研究负责人", body: "结合问卷与用户访谈分析购买决策，整理研究报告与产品建议。" }] },
  { id: "skills", title: "工作技能", tab: "工作技能", visible: true, builtin: true, items: [{ id: "skill-1", fields: {}, metaLeft: "", metaRight: "", body: "<strong>数据分析：</strong>SQL | Python | R | Excel<br><strong>AI 应用：</strong>Prompt Engineering | Workflow | RAG" }] },
] };
let resume = { id: "resume-test-001", name: "基础简历", content_hash: "hash-initial", pdf_path: "source.pdf", content_json: { source_asset_id: "material-test", source_pdf_fidelity: true, editor_snapshot: snapshot }, updated_at: "2026-10-26T10:00:00Z" };
let previewFormat = "pdf";
let previewCalls = [];
let importCalls = [];
let renderCalls = [];
let pdfRequests = 0;
let previewFailure = false;
let nativePreviews = [];
// A real, minimal PDF exercises the iframe boundary without a backend fixture.
const pdfObjects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.276 841.89] /Resources << >> >>"];
let pdfSource = "%PDF-1.4\n";
const offsets = [0];
for (const [index, object] of pdfObjects.entries()) { offsets.push(Buffer.byteLength(pdfSource)); pdfSource += `${index + 1} 0 obj\n${object}\nendobj\n`; }
const xref = Buffer.byteLength(pdfSource);
pdfSource += `xref\n0 4\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
await page.exposeFunction("selectTestResume", () => `C:/synthetic/resume.${previewFormat}`);
await page.exposeFunction("renderTestResume", id => { renderCalls.push(id); return { ok: false, message: "测试：证据已过期，请重新核验。" }; });
await page.addInitScript(() => { window.appRuntime = { selectResumeFile: () => window.selectTestResume(), renderResumePdf: id => window.renderTestResume(id) }; });
await page.route("**/api/**", async route => {
  const url = new URL(route.request().url());
  const routePath = url.pathname;
  if (routePath.endsWith("/workspace") && routePath.includes("/jobs/")) return route.fulfill({ json: { job, candidate, run: null, profile: null, messages: [], tasks: [], steps: [], approvals: [], proposals: [], resumes: [], base_resumes: [resume], portfolios: [], facts: [], experiences: [], materials: [], applications: [], queued_messages: [], interview_sources: [], interview_briefs: [] } });
  if (routePath === `/api/resumes/${resume.id}`) return route.fulfill({ json: resume });
  if (routePath === `/api/resumes/${resume.id}/preview.pdf`) {
    nativePreviews.push(url.searchParams.get("v"));
    if (previewFailure) return route.fulfill({ status: 422, json: { code: "resume_latex_failed", message: "测试：排版引擎不可用。" } });
    return route.fulfill({ contentType: "application/pdf", body: Buffer.from(pdfSource) });
  }
  if (routePath === `/api/resumes/${resume.id}/editor`) {
    const body = route.request().postDataJSON();
    resume = { ...resume, content_hash: "hash-edited", updated_at: "2026-10-26T11:00:00Z", content_json: { ...resume.content_json, editor_snapshot: body.editor_snapshot } };
    return route.fulfill({ json: resume });
  }
  if (routePath.endsWith("/pdf")) { pdfRequests += 1; return route.fulfill({ status: 422, json: { code: "resume_export_unverified", message: "测试：证据已过期，请重新核验。" } }); }
  if (routePath === "/api/imports/resume/preview") {
    previewCalls.push(route.request().postDataJSON());
    return route.fulfill({ json: { source_path: `C:/synthetic/resume.${previewFormat}`, filename: `resume.${previewFormat}`, source_format: previewFormat, source_sha256: "abc", source_photo_sha256: "photo-hash", size_bytes: 10240, page_count: previewFormat === "pdf" ? 1 : null, text_length: 120, text_preview: "林知远\n教育背景\n南山大学 数量经济学 2024.09—2027.06\n国家奖学金\n实习经验\n远山科技有限公司 策略运营\n使用 SQL 与 Python 分析任务数据。", profile: { name: candidate.name, email: "lin@example.com" }, sections: [{ key: "education", title: "教育背景", entry_count: 1 }], experiences: [{ kind: "education", section: "教育背景", title: "南山大学", organization: "南山大学", role: "数量经济学", start_date: "2024.09", end_date: "2027.06", summary: "国家奖学金", details: {} }], warnings: [], recognition_mode: "local", outbound_preview: "候选人\n教育背景\n南山大学 数量经济学", redacted_fields: ["name", "email"] } });
  }
  if (routePath === "/api/imports/resume") { importCalls.push(route.request().postDataJSON()); return route.fulfill({ json: { candidate_id: candidate.id, facts_created: 1, preview: { experiences: [1] } } }); }
  const responses = {
    "/api/workspace": { candidates: [candidate], jobs: [job] },
    "/api/runtime/status": { configured: true, model: "test-model", provider_name: "Test" },
    "/api/settings/general": { theme: "light", accent: "coral", density: "comfortable" },
    [`/api/candidates/${candidate.id}/library`]: { candidate, resumes: [resume], experiences: [], materials: [] },
  };
  return route.fulfill({ json: responses[routePath] || [] });
});
const openResume = async () => {
  await page.getByRole("button", { name: "远山科技 策略运营", exact: true }).click();
  await page.getByRole("button", { name: "简历", exact: true }).click();
  await page.locator('iframe[title="FetchCV PDF 预览"]').waitFor();
  await page.waitForFunction(() => !document.querySelector(".resume-preview-loading"));
};
const openImport = async () => {
  await page.keyboard.press("Control+k");
  await page.getByRole("option", { name: /导入简历/ }).click();
  await page.getByRole("heading", { name: "导入简历", exact: true }).waitFor();
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector(".import-dialog")).opacity) === 1);
};
try {
  await page.goto("http://127.0.0.1:5188/");
  await openResume();
  assert.equal(pdfRequests, 0, "unverified imported PDF never enters iframe or export endpoint");
  assert.equal(renderCalls.length, 0, "viewing a draft never auto-generates an export");
  assert.equal(await page.getByRole("button", { name: "导出基础 PDF" }).isDisabled(), true);
  assert.ok((await page.locator(".canonical-resume-preview").boundingBox()).height > 650);
  await page.screenshot({ path: path.join(artifactRoot, "resume-desktop.png") });
  await page.getByRole("button", { name: "待核对", exact: true }).click();
  await page.locator(".workspace-tabs button.active").filter({ hasText: "对话" }).waitFor();
  await page.getByRole("button", { name: "简历", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".resume-preview-loading"));
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.frameLocator('iframe[title="FetchCV 简历编辑器"]');
  await editor.locator("#previewName").filter({ hasText: candidate.name }).waitFor();
  await editor.locator("#nameInput").fill("林知远（已编辑）");
  await page.getByRole("button", { name: "返回简历", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".resume-preview-loading"));
  await page.locator(".resume-editor-overlay").waitFor({ state: "detached" });
  assert.equal(resume.content_json.editor_snapshot.profile.name, "林知远（已编辑）");
  assert.ok(nativePreviews.includes("hash-edited"), "saving refreshes the native PDF for the edited revision");
  assert.match(await page.locator('iframe[title="FetchCV PDF 预览"]').getAttribute("src"), /^blob:/);
  for (const width of [1000, 800]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.locator(".resume-studio-v2").evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
    assert.ok((await page.locator(".canonical-resume-preview").boundingBox()).height > 500);
  }
  await page.screenshot({ path: path.join(artifactRoot, "resume-compact.png") });
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const format of ["pdf", "docx", "tex", "json"]) {
    previewFormat = format;
    await openImport();
    if (format === "pdf") await page.screenshot({ path: path.join(artifactRoot, "import-select.png") });
    await page.getByRole("button", { name: /选择简历文件/ }).click();
    await page.getByRole("heading", { name: "核对简历", exact: true }).waitFor();
    await page.getByLabel("姓名", { exact: true }).fill(candidate.name);
    assert.equal(await page.getByRole("textbox", { name: "组织 / 学校", exact: true }).inputValue(), "南山大学");
    assert.equal(await page.locator(".outbound-preview[open]").count(), 0);
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector(".import-review")).opacity) === 1);
    if (format === "tex") await page.screenshot({ path: path.join(artifactRoot, "import-review.png") });
    await page.getByRole("button", { name: "确认导入", exact: true }).click();
    await page.getByRole("heading", { name: "简历已导入", exact: true }).waitFor();
    await page.getByRole("button", { name: "完成", exact: true }).click();
  }
  assert.deepEqual(previewCalls.map(value => value.source_path.split(".").at(-1)), ["pdf", "docx", "tex", "json"]);
  assert.ok(previewCalls.every(value => value.ai_enhanced === false));
  assert.equal(importCalls.length, 4);
  assert.ok(importCalls.every(value => value.reviewed_preview.source_sha256 === "abc"));
  assert.ok(importCalls.every(value => value.reviewed_preview.source_photo_sha256 === "photo-hash"));
  resume = { ...resume, content_json: { ...resume.content_json, verification_status: "verified", pdf_sha256: "test" } };
  await page.reload();
  await openResume();
  await page.getByRole("button", { name: "导出基础 PDF", exact: true }).click();
  await page.getByText("测试：证据已过期，请重新核验。", { exact: true }).waitFor();
  assert.equal(await page.locator('iframe[src*="/api/resumes/"]').count(), 0, "failed JSON is never used as iframe source");
  await page.waitForFunction(() => !document.querySelector(".resume-preview-loading"));
  assert.ok((await page.locator(".resume-notice").boundingBox()).height < 80);
  assert.ok((await page.locator(".canonical-resume-preview").boundingBox()).height > 600);
  previewFailure = true;
  await page.reload();
  await page.getByRole("button", { name: "远山科技 策略运营", exact: true }).click();
  await page.getByRole("button", { name: "简历", exact: true }).click();
  await page.getByText("测试：排版引擎不可用。", { exact: true }).waitFor();
  assert.equal(await page.locator('iframe[title="FetchCV PDF 预览"]').count(), 0);
  previewFailure = false;
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await page.locator('iframe[title="FetchCV PDF 预览"]').waitFor();
  assert.deepEqual(errors, []);
  console.log("Resume UI passed: draft preview, save/return, 3 widths, four import formats, explicit AI action, error fallback.");
} catch (error) { await page.screenshot({ path: path.join(artifactRoot, "failure.png") }); console.error((await page.locator("body").innerText()).slice(0, 2500)); throw error; } finally { await browser.close(); }
