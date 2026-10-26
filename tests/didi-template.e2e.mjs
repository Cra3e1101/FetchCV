import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";
import { resolveElectronRuntime } from "../scripts/electron-runtime.mjs";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, ".tmp/resume-template-qa");
fs.mkdirSync(output, { recursive: true });
const snapshot = {
  template: "didi",
  settings: { templatePreset: "didi-v1", fitScale: .78, fontSize: 12, lineHeight: 165, verticalFillGap: 18 },
  profile: { name: "模板验收", age: "24岁", phone: "13800000000", email: "resume@example.test", website: "https://example.test", summary: "通过数据分析推进产品改进。", showPhoto: true, photo: "" },
  sections: [
    { id: "education", tab: "教育背景", visible: true, items: [{ id: "edu", fields: { school: "示例大学（211）", major: "数量经济学", degree: "硕士", timeRange: { start: "2024-09", end: "2027-06" } }, metaRich: { title: '<strong>示例大学</strong><span style="font-weight:400">（211）</span>' }, body: "• 数据分析、统计建模与研究方法。" }] },
    { id: "internship", tab: "实习经验", visible: true, items: [{ id: "work", richStyle: { lineHeight: 1.65 }, fields: { company: "示例科技有限公司", role: "策略运营", timeRange: { start: "2026-07", end: "至今" } }, body: "• <strong>业务分析：</strong>跟踪业务指标并维护运营看板。\n• 协同团队完成策略分析与方案迭代。" }] },
    { id: "project", tab: "项目经历", visible: true, items: [{ id: "project", richStyle: { lineHeight: 1.5 }, fields: { projectName: "多源数据融合视角下的无人驾驶技术消费者意愿研究", role: "研究负责人", timeRange: { start: "2025-06", end: "2025-10" } }, body: "• 整理问卷与公开文本，分析影响用户决策的因素。" }] },
    { id: "skills", tab: "工作技能", visible: true, items: [{ id: "skills", fields: {}, body: "数据分析： SQL | Python | Excel\nAI 应用： <strong>Claude Code</strong> | 工作流设计" }] },
  ],
};
const application = await electron.launch({
  executablePath: (await resolveElectronRuntime({ projectRoot: root })).executable,
  args: [path.join(root, "tests/fixtures/resume-template-host.cjs")], cwd: root,
  env: { ...process.env, FETCHCV_TEMPLATE_TEST_PROFILE: fs.mkdtempSync(path.join(os.tmpdir(), "fetchcv-template-")) },
});
try {
  const page = await application.firstWindow();
  const screenshot = async name => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const bytes = await application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString("base64"));
    fs.writeFileSync(path.join(output, name), Buffer.from(bytes, "base64"));
  };
  await page.waitForFunction(() => window.fetchCVBridge?.status().initialized);
  await page.evaluate(() => { window.changeMessages = []; window.addEventListener("message", event => { if (event.data?.type === "fetchcv:editor-change") window.changeMessages.push(event.data); }); });
  await page.evaluate(value => window.fetchCVBridge.loadSnapshot(value), snapshot);
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator("#resumePage").getAttribute("class").then(value => value.includes("template-didi")), true);
  assert.equal(await page.locator("#previewSummary").textContent(), snapshot.profile.summary);
  assert.equal(await page.locator("#infoGrid").textContent().then(value => value.includes(snapshot.profile.website)), true);
  assert.deepEqual(await page.evaluate(() => window.changeMessages), [], "Read-only preview must never emit save messages");
  const migrated = await page.evaluate(() => window.fetchCVBridge.snapshot());
  assert.equal(migrated.settings.templatePreset, "didi-v2");
  assert.equal(migrated.settings.fitScale, 1, "Legacy page fitting must not shrink the new template");
  assert.equal(migrated.settings.verticalFillGap, 0);
  assert.equal(migrated.sections[1].items[0].richStyle.lineHeight, undefined, "Remove only known automatic leading");
  assert.equal(migrated.sections[2].items[0].richStyle.lineHeight, 1.5, "Keep deliberate item formatting");
  assert.equal(migrated.sections[1].items[0].body, snapshot.sections[1].items[0].body, "Layout migration must not rewrite resume content");
  assert.equal(await page.locator('#resumePage [data-section-id="internship"] .didi-bullet').count(), 2, "Inline bold must not swallow paragraph breaks");
  assert.equal(await page.locator('#resumePage .didi-skill-row').count(), 2, "Skills use a fixed label column");
  assert.equal(await page.locator('#resumePage [data-section-id="education"] .didi-meta-0 span').evaluate(node => getComputedStyle(node).fontWeight), "400", "Source mdseries emphasis must survive import");
  const layout = await page.evaluate(() => {
    const page = document.querySelector("#resumePage");
    const photo = document.querySelector("#photoWrap").getBoundingClientRect();
    const name = document.querySelector("#previewName").getBoundingClientRect();
    const headings = [...document.querySelectorAll(".didi-meta-part")].map(node => ({ text: node.textContent, clipped: node.scrollWidth > node.clientWidth + 1, overflow: getComputedStyle(node).overflow }));
    const workBody = document.querySelector('[data-section-id="internship"] .section-body');
    const projectTitle = document.querySelector('#resumePage [data-section-id="project"] .didi-meta-0');
    return { width: page.offsetWidth, font: getComputedStyle(page).fontFamily, photoRight: photo.left > name.right, headings, leading: Number.parseFloat(getComputedStyle(workBody).lineHeight), projectTitleHeight: projectTitle.offsetHeight, projectTitleLeading: Number.parseFloat(getComputedStyle(projectTitle).lineHeight) };
  });
  assert.equal(layout.width, 794);
  assert.match(layout.font, /SimSun/);
  assert.equal(layout.photoRight, true);
  assert.ok(Math.abs(layout.leading - 14.6 * 96 / 72.27 * 1.3) < .02, "Body leading must include the source ctex baseline stretch and TeX point units");
  assert.ok(layout.headings.every(item => !item.clipped && item.overflow !== "hidden"), "Long entry titles must wrap without truncation");
  assert.ok(layout.projectTitleHeight < layout.projectTitleLeading + 1, "The reference project title must fit on one line");
  await screenshot("preview.png");
  const changedMetadata = structuredClone(migrated);
  changedMetadata.sections[0].items[0].fields.school = "更新后的大学";
  await page.evaluate(value => window.fetchCVBridge.loadSnapshot(value), changedMetadata);
  assert.equal(await page.locator('#resumePage [data-section-id="education"] .didi-meta-0').textContent(), "更新后的大学", "Stale imported emphasis must never override edited fields");
  await page.goto(page.url().replace("preview=1", "preview=0"));
  await page.waitForFunction(() => window.fetchCVBridge?.status().initialized);
  await page.evaluate(value => window.fetchCVBridge.loadSnapshot(value), snapshot);
  await page.locator("#websiteInput").fill("https://updated.example.test");
  assert.ok(await page.locator("#infoGrid").textContent().then(value => value.includes("updated.example.test")));
  assert.equal(await page.locator("#templateBtn").isVisible(), false, "Do not offer template controls that the PDF renderer cannot apply");
  await screenshot("editor.png");
  for (const width of [900, 640]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `No horizontal overflow at ${width}px`);
    await screenshot(`editor-${width}.png`);
  }
  await page.locator("#previewBtn").click();
  await page.locator("#resumePage").waitFor({ state: "visible" });
  assert.equal(await page.locator(".editor-drawer").isVisible(), false);
  await page.locator("#previewBtn").click();
  assert.equal(await page.locator("#websiteInput").isVisible(), true);
  const longSnapshot = structuredClone(snapshot);
  longSnapshot.sections[1].items[0].body = Array.from({ length: 45 }, (_, index) => `• 第${index + 1}项：保留正文默认字号与行距，让较长简历自然分页。`).join("\n");
  await page.evaluate(value => window.fetchCVBridge.loadSnapshot(value), longSnapshot);
  await page.locator("#previewBtn").click();
  await page.waitForFunction(() => Number(document.querySelector("#resumePage").dataset.pageCount) > 1);
  assert.ok(Number(await page.locator("#resumePage").getAttribute("data-page-count")) > 1, "Long resumes should flow to more pages");
  assert.ok(Math.abs(await page.locator('#resumePage .section-content').first().evaluate(node => Number.parseFloat(getComputedStyle(node).fontSize)) - 10.2 * 96 / 72.27) < .01, "Pagination must not shrink body type");
  await page.evaluate(() => window.fetchCVBridge.loadSnapshot({ profile: { name: "空白简历" }, sections: [] }));
  assert.equal(await page.locator("#resumePage .resume-section").count(), 0, "An empty imported resume must not pick up example experience");
  console.log("Didi template preview, long metadata, read-only loading, live edits and responsive layout passed.");
} finally { await application.close(); }
