import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { _electron as electron } from "playwright";
import { resolveElectronRuntime } from "../scripts/electron-runtime.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "fetchcv-toolbar-"));
const snapshot = {
  template: "didi",
  profile: { name: "格式验收", showPhoto: false },
  sections: [
    { id: "project", tab: "项目经历", visible: true, items: [{ id: "project-item", fields: { projectName: "格式验收" }, body: "Alpha Beta R2" }] },
    { id: "skills", tab: "专业技能", visible: true, lineHeight: 150, items: [{ id: "skill-item", fields: {}, richStyle: { lineHeight: 2 }, body: "分析工具：Python | SQL" }] },
  ],
};
const application = await electron.launch({
  executablePath: (await resolveElectronRuntime({ projectRoot: root })).executable,
  args: [path.join(root, "tests/fixtures/resume-template-host.cjs")], cwd: root,
  env: { ...process.env, FETCHCV_TEMPLATE_TEST_PROFILE: temporary },
});
try {
  const page = await application.firstWindow();
  await page.goto(page.url().replace("preview=1", "preview=0"));
  await page.waitForFunction(() => window.fetchCVBridge?.status().initialized);
  // A hidden test window does not advance Chromium visibility transitions.
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  await page.evaluate(value => window.fetchCVBridge.loadSnapshot(value), snapshot);
  await page.locator('.module-nav-item[data-section-id="project"]').click();
  const toolbar = page.locator('.item-card[data-item-id="project-item"] .rich-toolbar');
  const editor = page.locator('.item-card[data-item-id="project-item"] .rich-editor');
  const visibleCommands = await toolbar.locator("[data-command]").evaluateAll(controls => controls.filter(node => !node.hidden).map(node => node.dataset.command).sort());
  assert.deepEqual(visibleCommands, ["undo", "redo", "bold", "italic", "superscript", "removeFormat"].sort());
  const hiddenControls = await toolbar.locator("[data-command]").evaluateAll(controls => controls.filter(node => node.hidden).map(node => ({ disabled: node.disabled, display: getComputedStyle(node).display })));
  assert.ok(hiddenControls.every(control => control.disabled && control.display === "none"));
  assert.equal(await toolbar.locator('[data-block-style="paragraphPreset"]').isVisible(), false);
  const lineHeight = toolbar.locator('[data-block-style="lineHeight"]');
  assert.equal(await lineHeight.isVisible(), true);
  assert.ok((await lineHeight.locator("option").evaluateAll(options => options.map(option => option.value).filter(Boolean))).every(value => Number(value) >= 1.05 && Number(value) <= 2.2));

  // Use the isolated renderer's selection API; never focus or control a user app.
  const selectText = async text => editor.evaluate((node, target) => {
    node.focus();
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let child;
    while ((child = walker.nextNode())) {
      const start = child.textContent.indexOf(target);
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(child, start); range.setEnd(child, start + target.length);
      const selection = window.getSelection();
      selection.removeAllRanges(); selection.addRange(range);
      node.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
      return;
    }
    throw new Error(`Selection text not found: ${target}`);
  }, text);
  const body = () => page.evaluate(() => window.fetchCVBridge.snapshot().sections[0].items[0].body);

  await selectText("Alpha");
  await toolbar.locator('[data-command="bold"]').click();
  assert.match(await body(), /<(?:b|strong)(?:\s[^>]*)?>Alpha<\//);
  await selectText("Beta");
  await toolbar.locator('[data-command="italic"]').click();
  assert.match(await body(), /<(?:i|em)(?:\s[^>]*)?>Beta<\//, "Italic must be persisted using native-supported semantic HTML");
  await selectText("2");
  await toolbar.locator('[data-command="superscript"]').click();
  assert.match(await body(), /<sup(?:\s[^>]*)?>2<\/sup>/, "Sanitization must retain superscript");
  const formatted = await page.evaluate(() => window.fetchCVBridge.snapshot());
  await page.evaluate(value => window.fetchCVBridge.loadSnapshot(value), formatted);
  await page.locator('.module-nav-item[data-section-id="project"]').click();
  assert.equal(await editor.locator("sup").textContent(), "2", "Formatting must survive snapshot reload");

  await selectText("Beta");
  await toolbar.locator('[data-command="italic"]').click();
  assert.equal(await editor.locator("i,em").count(), 0, "Toggling italic off must remove the native markup");
  await selectText("Alpha");
  await toolbar.locator('[data-command="bold"]').click();
  assert.equal(await editor.locator("b,strong").count(), 0, "Toggling bold off must restore regular text");
  const beforeUnsupported = await body();
  await editor.press("Control+u");
  await editor.press("Control+Shift+7");
  assert.equal(await body(), beforeUnsupported, "Hidden unsupported formatting shortcuts must not modify the document");
  await selectText("2");
  await toolbar.locator('[data-command="removeFormat"]').click();
  assert.equal(await editor.locator("sup").count(), 0, "Clear formatting must restore normal baseline");

  await selectText("Alpha");
  await lineHeight.selectOption("1.5");
  const spaced = await page.evaluate(() => window.fetchCVBridge.snapshot());
  assert.equal(spaced.sections[0].items[0].richStyle.lineHeight, 1.5);
  assert.equal(await editor.locator('[style*="line-height"]').count(), 0, "Entry leading must not create unsupported per-paragraph styles");
  const leading = await page.locator('#resumePage [data-section-id="project"] .section-body').evaluate(node => Number.parseFloat(getComputedStyle(node).lineHeight) / Number.parseFloat(getComputedStyle(node).fontSize));
  assert.ok(Math.abs(leading - 1.5 * 1.3) < .01, "Screen leading must apply the same ctex baseline multiplier");
  await selectText("Beta");
  assert.equal(await lineHeight.inputValue(), "1.5", "Selection changes must not replace the saved source leading with the stretched CSS ratio");

  await page.locator('.module-nav-item[data-section-id="skills"]').click();
  assert.equal(await page.locator('.item-card[data-item-id="skill-item"] [data-block-style="lineHeight"]').isVisible(), false, "Skills only expose supported module/global leading");
  const skillLeading = await page.locator('#resumePage [data-section-id="skills"] .section-body').evaluate(node => Number.parseFloat(getComputedStyle(node).lineHeight) / Number.parseFloat(getComputedStyle(node).fontSize));
  assert.ok(Math.abs(skillLeading - 1.5 * 1.3) < .01, "Skills must follow section leading instead of an unsupported item override");
  await page.locator('.tool-btn[data-panel="type"]').click();
  await page.locator("#fontSizeRange").waitFor({ state: "visible", timeout: 3000 });
  assert.equal(await page.locator("#fontSizeRange").isVisible(), true, "Global body size remains available");
  await page.locator('.tool-btn[data-panel="layout"]').click();
  assert.equal(await page.locator("#lineHeightRange").isVisible(), true, "Global leading remains available");

  // Check the native parser's actual output without compiling or touching a
  // live desktop. This catches controls that merely look right in Chromium.
  const nativeInput = path.join(temporary, "formatted.json");
  const nativeSnapshot = structuredClone(formatted);
  nativeSnapshot.sections[0].items[0].richStyle = spaced.sections[0].items[0].richStyle;
  fs.writeFileSync(nativeInput, JSON.stringify(nativeSnapshot));
  const python = process.env.FETCHCV_NATIVE_TEST_PYTHON || path.join(root, "backend/.venv-m1/Scripts/python.exe");
  const nativeText = execFileSync(python, ["-c", "import json,sys;sys.path.insert(0,sys.argv[1]);from integrations.resume.latex_renderer import build_tex;s=json.load(open(sys.argv[2],encoding='utf-8'));print(build_tex(s))", path.join(root, "backend"), nativeInput], { encoding: "utf8", windowsHide: true });
  assert.match(nativeText, /\\textbf\{Alpha\}/);
  assert.match(nativeText, /\\textit\{Beta\}/);
  assert.match(nativeText, /\\textsuperscript\{2\}/);
  assert.match(nativeText, /\\fontsize\{10\.200000pt\}\{15\.300000pt\}/, "The saved item leading must reach the native template");
  console.log("Native-compatible rich toolbar, formatting roundtrip, safe shortcuts and leading controls passed.");
} finally {
  await application.close();
}
