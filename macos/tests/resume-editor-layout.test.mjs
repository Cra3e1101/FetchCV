import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import postcss from "postcss";

const root = path.resolve(import.meta.dirname, "..");
const html = fs.readFileSync(path.join(root, "public/resume-editor/index.html"), "utf8");
const legacyCss = fs.readFileSync(path.join(root, "public/resume-editor/styles.css"), "utf8");
const css = fs.readFileSync(path.join(root, "public/resume-editor/editor-layout.css"), "utf8");
const fetchcvTheme = fs.readFileSync(path.join(root, "public/resume-editor/fetchcv-theme.css"), "utf8");
const app = fs.readFileSync(path.join(root, "public/resume-editor/app.js"), "utf8");

test("resume editor keeps the structure sidebar inside its layout grid", () => {
  const drawerStart = html.indexOf('id="editorDrawer"');
  const drawerEnd = html.indexOf("</section>", drawerStart);
  const sidebarStart = html.indexOf('id="moduleSidebar"');
  const contentStart = html.indexOf('class="drawer-content"');
  assert.ok(drawerStart >= 0 && drawerEnd > drawerStart);
  assert.ok(sidebarStart > drawerStart && sidebarStart < drawerEnd);
  assert.ok(contentStart > sidebarStart && contentStart < drawerEnd);
  assert.match(html, /id="moduleSidebarFloatToggle"[^>]*type="button"/);
  assert.match(html, /id="drawerHandle"[^>]*type="button"[^>]*aria-expanded="true"/);
  assert.match(html, /<strong>内容模块<\/strong>/);
  assert.doesNotMatch(html, /拖动调整顺序/);
  assert.match(html, /class="profile-panel-head"[\s\S]*?默认保留，不随岗位改写/);
  assert.match(html, /class="section-heading-copy"[\s\S]*?当前编辑模块/);
  assert.match(html, /class="settings-section-label">页面排版/);
  assert.match(html, /class="settings-section-label">元素定位/);
});

test("resume editor has a single responsive layout contract", () => {
  assert.doesNotThrow(() => postcss.parse(legacyCss));
  assert.doesNotThrow(() => postcss.parse(css));
  assert.doesNotThrow(() => postcss.parse(fetchcvTheme));
  assert.match(css, /grid-template-areas:\s*"modules editorContent"/);
  assert.match(css, /module-sidebar-float-toggle\s*\{[\s\S]*?position:\s*absolute/);
  assert.match(css, /@media \(max-width: 980px\)[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?grid-template-areas:[\s\S]*?"modules"[\s\S]*?"editorContent"/);
assert.match(css, /body\.fetchcv-preview-only\s*\{[\s\S]*?display:\s*block\s*!important/);
assert.match(css, /body\.fetchcv-embedded:not\(\.fetchcv-preview-only\):not\(\.dashboard-mode\)\s*\{[\s\S]*?grid-template-columns:\s*minmax\(520px,\s*1\.08fr\)\s+8px\s+minmax\(440px,\s*\.92fr\)\s*!important/);
assert.match(css, /@media \(max-width: 980px\)[\s\S]*?body\.fetchcv-embedded:not\(\.fetchcv-preview-only\):not\(\.dashboard-mode\) \.editor-drawer[\s\S]*?grid-template-areas:[\s\S]*?"modules"[\s\S]*?"editorContent"/);
assert.match(css, /body\.fetchcv-embedded:not\(\.fetchcv-preview-only\):not\(\.dashboard-mode\) \.form-grid[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s*!important/);
assert.match(css, /module-sidebar-collapsed \.editor-drawer\s*\{[\s\S]*?grid-template-columns:\s*44px minmax\(0, 1fr\)\s*!important/);
assert.match(css, /module-sidebar-collapsed \.module-sidebar-float-toggle\s*\{[\s\S]*?position:\s*static\s*!important/);
assert.match(css, /editor-collapsed\s*\{[\s\S]*?grid-template-areas:[\s\S]*?"preview"\s*!important/);
assert.match(css, /editor-collapsed \.editor-drawer,[\s\S]*?editor-collapsed \.workspace-resizer[\s\S]*?display:\s*none\s*!important/);
assert.ok(html.indexOf("editor-layout.css") < html.indexOf("fetchcv-theme.css"));
assert.match(fetchcvTheme, /--fetchcv-editor-accent:\s*#bd6548/);
assert.match(fetchcvTheme, /--editor-sidebar-width:\s*174px/);
assert.match(fetchcvTheme, /\.module-actions\s*\{[\s\S]*?display:\s*inline-flex[\s\S]*?gap:\s*2px/);
assert.match(fetchcvTheme, /\.module-nav-item\.tab-add\s*\{[\s\S]*?justify-content:\s*flex-start/);
assert.match(fetchcvTheme, /\.editor-drawer \.toolbar-meta\s*\{[\s\S]*?display:\s*none/);
assert.match(fetchcvTheme, /\.settings-card\s*\{[\s\S]*?right:\s*16px[\s\S]*?transform:\s*none\s*!important/);
assert.match(fetchcvTheme, /\.item-grid > label,[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
assert.match(fetchcvTheme, /input\[type="range"\]::-webkit-slider-runnable-track[\s\S]*?var\(--fetchcv-editor-accent\)/);
  assert.doesNotMatch(css, /content:\s*"濡/);
});

test("resume module actions have a stable non-overlapping layout", () => {
  assert.match(app, /<span class="module-actions">[\s\S]*?module-menu-trigger[\s\S]*?module-action-menu[\s\S]*?data-tab-action="toggle"[\s\S]*?data-tab-action="edit"[\s\S]*?data-tab-action="duplicate"[\s\S]*?<\/span>/);
  assert.match(app, /function startSidebarSectionDrag\(event\)[\s\S]*?closest\("\.module-rename-input, \.tab-tool, \.module-action-menu"\)/);
  assert.match(fetchcvTheme, /grid-template-columns:\s*10px minmax\(0, 1fr\) auto/);
  assert.match(fetchcvTheme, /\.module-menu-trigger\s*\{[\s\S]*?position:\s*static/);
  assert.match(fetchcvTheme, /\.module-nav-item\.active\s*\{[\s\S]*?box-shadow:\s*none/);
  assert.match(fetchcvTheme, /\.module-nav-item\.menu-open \.module-action-menu\s*\{[\s\S]*?display:\s*grid/);
  assert.match(fetchcvTheme, /\.module-name[\s\S]*?text-overflow:\s*ellipsis/);
});

test("embedded settings use an anchored agent-style panel", () => {
  assert.match(app, /if \(FETCHCV_EMBEDDED\) refs\.settingsCard\.style\.removeProperty\("transform"\)/);
  assert.match(app, /if \(!FETCHCV_EMBEDDED\) bindSettingsPanelDrag\(\)/);
  assert.match(app, /layout: "页面设置"/);
  assert.match(app, /skin: "模板配色"/);
  assert.match(app, /refs\.editorDrawer\.appendChild\(refs\.settingsCard\)/);
  assert.match(fetchcvTheme, /\.editor-drawer > \.settings-card\s*\{[\s\S]*?position:\s*absolute[\s\S]*?width:\s*284px/);
});

test("embedded editor waits for the authoritative resume snapshot", () => {
  assert.match(app, /FETCHCV_EMBEDDED && !fetchCVSnapshotLoaded/);
  assert.match(app, /fetchCVEditorInitialized = true/);
  assert.match(app, /if \(!FETCHCV_EMBEDDED\) \{[\s\S]*?void initializeSharedWorkspace\(\)/);
  assert.match(app, /fetchcv-snapshot-loading/);
  const cacheRefs = app.slice(app.indexOf("function cacheRefs"), app.indexOf("function makeWorkbenchId"));
  for (const id of ["drawerHandle", "toggleModuleSidebarBtn", "moduleSidebarFloatToggle"]) {
    assert.match(cacheRefs, new RegExp(`"${id}"`), `${id} must be cached before applyStyles`);
  }
});

test("embedded snapshots do not expose demo content for missing PDF sections", () => {
  assert.match(app, /if \(FETCHCV_EMBEDDED\) \{\s*recovered\.visible = false;\s*recovered\.items = \[blankItem\(\)\];/);
  assert.match(app, /if \(!FETCHCV_EMBEDDED && builtinSections\.length/);
  assert.match(app, /state\.profile\[key\] = FETCHCV_EMBEDDED\s*\? \(Array\.isArray\(value\) \? \[\] : typeof value === "boolean" \? false : ""\)/);
});

test("every resume editor ref is initialized before rendering", () => {
  const used = new Set([...app.matchAll(/refs\.([A-Za-z0-9_]+)/g)].map((match) => match[1]));
  const cacheRefs = app.slice(app.indexOf("function cacheRefs"), app.indexOf("function makeWorkbenchId"));
  const initialized = new Set([
    ...[...cacheRefs.matchAll(/"([A-Za-z0-9_]+)"/g)].map((match) => match[1]),
    ...[...app.matchAll(/refs\.([A-Za-z0-9_]+)\s*=/g)].map((match) => match[1]),
  ]);
  const missing = [...used].filter((name) => !initialized.has(name));
  assert.deepEqual(missing, [], `uncached editor refs: ${missing.join(", ")}`);
  const cachedIds = [...cacheRefs.matchAll(/"([A-Za-z0-9_]+)"/g)].map((match) => match[1]);
  const absentIds = cachedIds.filter((id) => new RegExp(`refs\\.${id}\\.`).test(app) && !html.includes(`id="${id}"`));
  assert.deepEqual(absentIds, [], `cached refs missing from HTML: ${absentIds.join(", ")}`);
});

test("profile typing updates the preview without remounting the form", () => {
  const profileBinding = app.slice(app.indexOf("function bindProfileInputs"), app.indexOf("function bindSectionEditor"));
  assert.match(profileBinding, /state\.profile\[key\] = input\.value;[\s\S]*?updatePreviewOnly\(\);/);
  assert.match(profileBinding, /state\.profile\.email = value;\s*updatePreviewOnly\(\);/);
  assert.match(app, /refs\.drawerHandle\.setAttribute\("aria-expanded"/);
});

test("profile preview uses separated text columns without decorative icons", () => {
  assert.doesNotMatch(app, /class="profile-icon"/);
  assert.match(app, /data-profile-key=.*?<span>\$\{escapeHtml\(item\.label\)\}<\/span><strong>/);
  assert.match(fetchcvTheme, /\.info-grid p\s*\{[\s\S]*?grid-template-columns:\s*minmax\(var\(--info-label-width\), max-content\) minmax\(0, 1fr\)[\s\S]*?gap:\s*12px/);
  assert.match(app, /const infoLabelWidth = 58 \* fitScale/);
});

test("resume body can be edited directly and keeps Word-like formatting controls", () => {
  assert.match(app, /data-preview-body="true"/);
  assert.match(app, /refs\.resumeSections\.addEventListener\("input"/);
  assert.match(app, /data-command="strikeThrough"/);
  assert.match(app, /data-command="foreColor"/);
  assert.match(app, /data-command="hiliteColor"/);
  assert.match(app, /data-command="createLink"/);
  assert.match(app, /function normalizeRichLink/);
  assert.match(app, /const allowedTags = new Set\(\[.*?"a"/s);
  assert.match(app, /"background-color"/);
  assert.match(fetchcvTheme, /section-body\[contenteditable="true"\]/);
  assert.match(fetchcvTheme, /rich-toolbar \{[\s\S]*?flex-wrap:\s*wrap/);
});

test("toolbar preview toggles a reversible full-width document mode", () => {
  assert.match(app, /refs\.previewBtn\.classList\.toggle\("active", !state\.drawerOpen\)/);
  assert.match(app, /state\.drawerOpen = !state\.drawerOpen/);
  assert.match(app, /if \(!state\.drawerOpen\) fitFetchCVCanonicalPreview\(\)/);
  assert.match(app, /previewLabel\.textContent = state\.drawerOpen \? "预览" : "返回编辑"/);
});
