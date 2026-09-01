const storageKey = "resume-editor-prototype-v5";

const EDITOR_SCHEMA_VERSION = 6;
const builtinSectionIds = new Set(["education", "internship", "skills", "project", "awards", "self"]);
const workbenchStorageKey = "resume-workbench-v1";
const WORKBENCH_SCHEMA_VERSION = 3;

const section = (id, tab, metaLeft, metaRight, body, visible = true, builtin = false) => ({
  id,
  tab,
  title: tab,
  visible,
  builtin,
  items: [{ id: `${id}-item-1`, metaLeft, metaRight, body }]
});

const initialState = {
  schema: EDITOR_SCHEMA_VERSION,
  profile: {
    name: "林予安",
    age: "",
    gender: "女",
    birth: "2001-08",
    political: "群众",
    phone: "138****2468",
    email: "demo***@mail.com",
    arrival: "两周内到岗",
    workYears: "不填",
    marital: "不填",
    height: "",
    weight: "",
    ethnicity: "",
    domicile: "",
    showPhoto: true,
    photo: "",
    photoFileName: "",
    custom: []
  },
  sections: [
    section("education", "教育背景", "2020-09 ~ 2024-06", "华东理工大学-信息管理与信息系统    GPA：3.62/4", "• 主修课程：数据库原理、数据可视化、商业分析、管理信息系统。\n• 校内经历：参与学院数据整理项目，负责资料清洗、图表制作与结论汇报。", true, true),
    section("internship", "实习经历", "2023-07 ~ 2023-10", "远山科技  产品运营实习生", "• 协助维护用户反馈台账，按问题类型整理需求优先级。\n• 跟进活动数据复盘，输出周报并提出页面转化优化建议。", true, true),
    section("skills", "工作技能", "工具 / 语言", "Excel、SQL、Python、Figma、PowerPoint", "• 能够完成基础数据提取、清洗、可视化和业务分析报告。\n• 熟悉原型梳理、需求拆解、会议纪要和跨团队沟通流程。", true, true),
    section("project", "项目经验", "2024-02 ~ 2024-05", "校园二手交易平台用户研究", "• 访谈 18 名目标用户，归纳交易信任、搜索效率和消息触达问题。\n• 设计信息架构与低保真原型，完成可用性测试和迭代说明。", true, true),
    section("awards", "竞赛获奖", "2023", "校级商业分析挑战赛", "团队二等奖、优秀学生干部。", false, true),
    section("self", "自我评价", "", "", "做事细致，表达清晰，能够快速理解业务目标并拆解执行路径。关注产品体验、数据分析和流程优化方向。", true, true)
  ],
  activeTab: "profile",
  activeSectionId: "education",
  activeSettings: "layout",
  drawerOpen: true,
  moduleSidebarCollapsed: false,
  activeMonthRange: null,
  birthMonthPickerMode: "month",
  birthYearPageStart: null,
  previewWidth: 56,
  previewZoom: 0.5,
  previewOffsetX: 0,
  previewOffsetY: 0,
  template: "classic",
  settings: {
    margin: 30,
    spacing: 8,
    lineHeight: 166,
    fontSize: 15,
    fontFamily: "'Microsoft YaHei', 'PingFang SC', Arial, sans-serif",
    englishLabels: false,
    themeIndex: 0,
    titleStyle: "block",
    nameSize: 28,
    cover: false,
    letter: "",
    guides: false,
    photoX: 0,
    photoY: 0,
    nameX: 0,
    infoX: 0,
    infoY: 0,
    basicHeight: 132,
    customAccent: "#1f3b5c",
    customAccent2: "#3f5f84",
    customStage: "#eef1f5",
    infoColumns: 3,
    fitScale: 1,
    verticalFillGap: 0,
    adjustPanelX: 0,
    adjustPanelY: 0
  }
};

let state = structuredClone(initialState);
let candidateDragId = "";
const FETCHCV_EMBEDDED = new URLSearchParams(window.location.search).get("embedded") === "1";
const FETCHCV_PREVIEW_ONLY = new URLSearchParams(window.location.search).get("preview") === "1";
const FETCHCV_RESUME_ID = new URLSearchParams(window.location.search).get("resumeId") || "";
const FETCHCV_API_BASE = new URLSearchParams(window.location.search).get("apiBase") || "";
const FETCHCV_API_TOKEN = new URLSearchParams(window.location.search).get("apiToken") || "";
const FETCHCV_API_HEADERS = FETCHCV_API_TOKEN ? { "X-FetchCV-Control-Token": FETCHCV_API_TOKEN } : {};
let fetchCVPendingSnapshot = null;
let fetchCVEditorInitialized = false;
let fetchCVSnapshotLoaded = false;
let fetchCVEditorError = "";

function hasUsableFetchCVSnapshot(snapshot) {
  return Boolean(
    snapshot
    && typeof snapshot === "object"
    && snapshot.profile
    && typeof snapshot.profile === "object"
    && Array.isArray(snapshot.sections)
  );
}

function reportFetchCVEditorError(stage, error) {
  const message = error instanceof Error ? error.message : String(error || "简历编辑器载入失败");
  fetchCVEditorError = `${stage}: ${message}`;
  console.error(`FetchCV editor ${stage} failed:`, error);
  window.parent.postMessage({ type: "fetchcv:editor-error", stage, message }, "*");
}

const themes = [
  { accent: "#1f3b5c", accent2: "#3f5f84", stage: "#eef1f5" },
  { accent: "#334155", accent2: "#64748b", stage: "#f3f5f8" },
  { accent: "#0f4c5c", accent2: "#3e7380", stage: "#edf3f5" },
  { accent: "#3f3f46", accent2: "#71717a", stage: "#f4f4f5" },
  { accent: "#4a5568", accent2: "#718096", stage: "#f4f6fa" },
  { accent: "#365f4b", accent2: "#5a7d6c", stage: "#edf3ef" },
  { accent: "#614c3e", accent2: "#8a6f5d", stage: "#f5f1ee" },
  { accent: "#2f4858", accent2: "#577386", stage: "#edf2f7" }
];

const labels = {
  zh: ["年龄", "性别", "政治面貌", "电话", "邮箱", "到岗情况"],
  en: ["Age", "Gender", "Political", "Phone", "Email", "Arrival"]
};

const layoutSettingPairs = [
  { key: "margin", range: "marginRange", number: "marginNumber", min: 8, max: 90 },
  { key: "spacing", range: "spacingRange", number: "spacingNumber", min: 0, max: 30 },
  { key: "lineHeight", range: "lineHeightRange", number: "lineHeightNumber", min: 118, max: 190 },
  { key: "photoX", range: "photoXRange", number: "photoXNumber", min: -220, max: 220 },
  { key: "photoY", range: "photoYRange", number: "photoYNumber", min: -160, max: 160 },
  { key: "nameX", range: "nameXRange", number: "nameXNumber", min: -220, max: 220 },
  { key: "infoX", range: "infoXRange", number: "infoXNumber", min: -220, max: 220 },
  { key: "infoY", range: "infoYRange", number: "infoYNumber", min: -180, max: 180 },
  { key: "basicHeight", range: "basicHeightRange", number: "basicHeightNumber", min: 90, max: 220 }
];
const layoutSettingMap = new Map(layoutSettingPairs.map((item) => [item.key, item]));

const sectionSchemas = {
  education: {
    toggles: [["timeRange", "时间"], ["school", "学校"], ["major", "专业"], ["degree", "学位"], ["gpa", "GPA"]],
    fields: [
      { key: "timeRange", label: "时间", type: "monthrange" },
      { key: "school", label: "学校" },
      { key: "major", label: "专业" },
      { key: "degree", label: "学位" },
      { key: "gpa", label: "GPA" }
    ],
    bodyLabel: "描述"
  },
  experience: {
    toggles: [["timeRange", "时间"], ["company", "公司"], ["role", "岗位"], ["location", "地点"]],
    fields: [
      { key: "timeRange", label: "时间", type: "monthrange" },
      { key: "company", label: "公司" },
      { key: "role", label: "岗位" },
      { key: "location", label: "地点" }
    ],
    bodyLabel: "描述"
  },
  project: {
    toggles: [["timeRange", "时间"], ["projectName", "项目名"], ["role", "角色"]],
    fields: [
      { key: "timeRange", label: "时间", type: "monthrange" },
      { key: "projectName", label: "项目名" },
      { key: "role", label: "角色" }
    ],
    bodyLabel: "项目描述"
  },
  skills: {
    toggles: [],
    fields: [],
    bodyLabel: "技能内容"
  },
  self: {
    toggles: [],
    fields: [],
    bodyLabel: "正文"
  },
  awards: {
    toggles: [["timeRange", "时间"], ["awardName", "奖项"], ["awardLevel", "等级/名次"]],
    fields: [
      { key: "timeRange", label: "时间", type: "monthrange" },
      { key: "awardName", label: "奖项名称" },
      { key: "awardLevel", label: "等级/名次" }
    ],
    bodyLabel: "描述"
  },
  custom: {
    toggles: [["timeRange", "时间"]],
    fields: [
      { key: "timeRange", label: "时间", type: "monthrange" }
    ],
    bodyLabel: "描述"
  }
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const refs = {};
let workbenchState = null;
let applicationDatePickerState = null;
let richTextSelection = null;
let richTextSelectionItemId = "";
let richTextSelectionBookmark = null;
const richTextHistories = new Map();
const RICH_HISTORY_LIMIT = 80;
const A4_PAGE_WIDTH_PX = 794;
const A4_PAGE_HEIGHT_PX = 1123;
const PREVIEW_PAGE_GAP_PX = 1;
const LOCAL_PARSE_API = "/api/parse-resume";
const LOCAL_HEALTH_API = "/api/health";
const LOCAL_ARCHIVE_PDF_API = "/api/archive-exported-pdf";
const LOCAL_ARCHIVE_MARKDOWN_API = "/api/archive-resume-markdown";
const LOCAL_OPEN_HISTORY_API = "/api/open-resume-history";
const LOCAL_WORKSPACE_STATE_API = "/api/workspace-state";
let importProgressHideTimer = 0;
let storageWarningShown = false;
let lastImportUndoSnapshot = null;
let sharedWorkspaceReady = false;
let sharedWorkspacePersistTimer = 0;
let sharedWorkspacePersistChain = Promise.resolve();

const ONE_PAGE_FIT_LIMITS = {
  margin: 8,
  spacing: 0,
  lineHeight: 118,
  itemLineHeight: 1.15,
  fontSize: 11,
  nameSize: 20,
  basicHeight: 90
};
const ONE_PAGE_FILL_LIMITS = {
  margin: 32,
  spacing: 22,
  lineHeight: 202,
  itemLineHeight: 2,
  fontSize: 16.6,
  nameSize: 30,
  basicHeight: 138,
  fitScale: 1.22
};
const ONE_PAGE_FIT_SYNC_KEYS = ["margin", "spacing", "lineHeight", "photoX", "photoY", "nameX", "infoX", "infoY", "basicHeight"];

const ARCHIVE_ROOT_FOLDER = "resume-history";
const ARCHIVE_KEEP_DAYS = 7;
const ARCHIVE_SCHEMA = 1;
const ARCHIVE_MIN_SAVE_INTERVAL_MS = 600;
const archiveRuntime = {
  busy: false,
  pendingSerialized: "",
  pendingForce: false,
  pendingReason: "autosave",
  lastSavedSerialized: "",
  lastSavedDayKey: "",
  lastSavedAt: 0,
  lastCleanupDayKey: "",
  warnedUnsupported: false
};

function pad2(value) {
  return String(value).padStart(2, "0");
}

function closeWorkbenchModal(modal, value, resolve) {
  if (!modal) return;
  const previousFocus = modal.__previousFocus;
  modal.classList.add("closing");
  window.setTimeout(() => {
    modal.remove();
    if (!document.querySelector(".workbench-modal-layer")) document.body.classList.remove("modal-open");
    if (previousFocus && typeof previousFocus.focus === "function") previousFocus.focus();
    resolve(value);
  }, 120);
}

function showWorkbenchModal(options = {}) {
  const {
    title = "操作",
    description = "",
    fields = [],
    confirmText = "确定",
    cancelText = "取消",
    danger = false,
    notice = false,
    contentHtml = ""
  } = options;
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const modal = document.createElement("div");
    const modalId = `workbench-modal-${Date.now().toString(36)}`;
    modal.className = "workbench-modal-layer";
    modal.__previousFocus = previousFocus;
    const fieldMarkup = fields.map((field) => {
      const type = field.type || "text";
      const required = field.required ? "required" : "";
      const placeholder = field.placeholder ? ` placeholder="${escapeAttr(field.placeholder)}"` : "";
      const value = field.value == null ? "" : String(field.value);
      const help = field.help ? `<small>${escapeHtml(field.help)}</small>` : "";
      const control = type === "textarea"
        ? `<textarea name="${escapeAttr(field.name)}" rows="${field.rows || 3}"${placeholder} ${required}>${escapeHtml(value)}</textarea>`
        : `<input name="${escapeAttr(field.name)}" type="${escapeAttr(type)}" value="${escapeAttr(value)}"${placeholder} ${required} />`;
      return `
        <label class="workbench-modal-field">
          <span>${escapeHtml(field.label || field.name)}</span>
          ${control}
          ${help}
        </label>
      `;
    }).join("");
    modal.innerHTML = `
      <div class="workbench-modal-backdrop" data-modal-close="true"></div>
      <form class="workbench-modal-card" role="dialog" aria-modal="true" aria-labelledby="${modalId}-title" ${description ? `aria-describedby="${modalId}-description"` : ""}>
        <div class="workbench-modal-head">
          <strong id="${modalId}-title">${escapeHtml(title)}</strong>
          ${description ? `<p id="${modalId}-description">${escapeHtml(description)}</p>` : ""}
        </div>
        ${(fieldMarkup || contentHtml) ? `<div class="workbench-modal-body">${contentHtml}${fieldMarkup}</div>` : ""}
        <div class="workbench-modal-actions">
          ${notice ? "" : `<button type="button" class="workbench-modal-cancel" data-modal-close="true">${escapeHtml(cancelText)}</button>`}
          <button type="submit" class="workbench-modal-confirm${danger ? " danger" : ""}">${escapeHtml(confirmText)}</button>
        </div>
      </form>
    `;
    document.body.classList.add("modal-open");
    document.body.appendChild(modal);
    const form = modal.querySelector("form");
    const firstInput = modal.querySelector("input, textarea, button[type='submit']");
    requestAnimationFrame(() => firstInput?.focus());
    modal.addEventListener("click", (event) => {
      if (!event.target.closest("[data-modal-close]")) return;
      closeWorkbenchModal(modal, null, resolve);
    });
    modal.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeWorkbenchModal(modal, null, resolve);
        return;
      }
      if (event.key === "Tab") {
        const focusable = [...modal.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
          .filter((node) => !node.hidden && node.getClientRects().length);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      if (notice || !fields.length) {
        closeWorkbenchModal(modal, true, resolve);
        return;
      }
      const data = Object.fromEntries(new FormData(form).entries());
      closeWorkbenchModal(modal, data, resolve);
    });
  });
}

function showWorkbenchNotice(title, description = "", confirmText = "知道了") {
  return showWorkbenchModal({ title, description, confirmText, notice: true });
}

function showWorkbenchConfirm(title, description = "", options = {}) {
  return showWorkbenchModal({
    title,
    description,
    confirmText: options.confirmText || "确认",
    cancelText: options.cancelText || "取消",
    danger: Boolean(options.danger)
  });
}

function pad3(value) {
  return String(value).padStart(3, "0");
}

function getLocalDayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function getLocalTimestampKey(date = new Date()) {
  return `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}_${pad3(date.getMilliseconds())}`;
}

function sanitizeFileStem(value) {
  const cleaned = String(value || "").replace(/[\\/:*?"<>|]+/g, "").trim();
  const compact = cleaned.replace(/\s+/g, "_");
  if (!compact) return "简历";
  return compact.slice(0, 32);
}

function supportsArchiveFolder() {
  return Boolean(globalThis.navigator?.storage?.getDirectory);
}

async function getArchiveRootDirectory() {
  if (!supportsArchiveFolder()) return null;
  const storageRoot = await navigator.storage.getDirectory();
  return storageRoot.getDirectoryHandle(ARCHIVE_ROOT_FOLDER, { create: true });
}

async function writeTextFile(dirHandle, fileName, text) {
  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(text);
  await writable.close();
}

function buildArchivePayload(serializedState, dayKey, reason, archivedAt) {
  let parsedState = null;
  try {
    parsedState = JSON.parse(serializedState);
  } catch {
    return "";
  }
  return JSON.stringify({
    archiveSchema: ARCHIVE_SCHEMA,
    dayKey,
    archivedAt,
    reason,
    profileName: String(parsedState?.profile?.name || ""),
    source: "resume-editor-prototype",
    state: parsedState
  }, null, 2);
}

function shouldDeleteArchiveDay(dayKey, nowDate = new Date()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey || ""));
  if (!match) return false;
  const dayDate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (!Number.isFinite(dayDate.getTime())) return false;
  const todayStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
  const dayStart = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate());
  const diffDays = Math.floor((todayStart.getTime() - dayStart.getTime()) / 86400000);
  return diffDays >= ARCHIVE_KEEP_DAYS;
}

async function cleanupExpiredArchiveDays(rootHandle, nowDate = new Date()) {
  for await (const [name, handle] of rootHandle.entries()) {
    if (!handle || handle.kind !== "directory") continue;
    if (!/^(\d{4})-(\d{2})-(\d{2})$/.test(name)) continue;
    if (!shouldDeleteArchiveDay(name, nowDate)) continue;
    try {
      await rootHandle.removeEntry(name, { recursive: true });
    } catch (error) {
      console.warn("Archive cleanup skipped:", name, error);
    }
  }
}

function queueArchiveSnapshot(serializedState, options = {}) {
  if (!serializedState) return;
  if (!supportsArchiveFolder()) {
    if (!archiveRuntime.warnedUnsupported) {
      archiveRuntime.warnedUnsupported = true;
      console.info("Archive folder requires browser OPFS support. Fallback to localStorage autosave only.");
    }
    return;
  }
  archiveRuntime.pendingSerialized = serializedState;
  archiveRuntime.pendingForce = archiveRuntime.pendingForce || Boolean(options.force);
  archiveRuntime.pendingReason = options.reason || "autosave";
  if (!archiveRuntime.busy) void flushArchiveSnapshotQueue();
}

async function flushArchiveSnapshotQueue() {
  if (archiveRuntime.busy) return;
  archiveRuntime.busy = true;
  try {
    while (archiveRuntime.pendingSerialized) {
      const serializedState = archiveRuntime.pendingSerialized;
      const force = archiveRuntime.pendingForce;
      const reason = archiveRuntime.pendingReason || "autosave";
      archiveRuntime.pendingSerialized = "";
      archiveRuntime.pendingForce = false;
      archiveRuntime.pendingReason = "autosave";
      await saveArchiveSnapshot(serializedState, { force, reason });
    }
  } finally {
    archiveRuntime.busy = false;
  }
}

async function saveArchiveSnapshot(serializedState, options = {}) {
  const force = Boolean(options.force);
  const reason = options.reason || "autosave";
  const now = new Date();
  const nowMs = now.getTime();
  const dayKey = getLocalDayKey(now);
  const isSameDay = dayKey === archiveRuntime.lastSavedDayKey;
  const isSameContent = serializedState === archiveRuntime.lastSavedSerialized;
  if (!force) {
    if (isSameDay && isSameContent) return;
    if (isSameDay && (nowMs - archiveRuntime.lastSavedAt) < ARCHIVE_MIN_SAVE_INTERVAL_MS) return;
  }

  const rootHandle = await getArchiveRootDirectory();
  if (!rootHandle) return;
  const dayDirHandle = await rootHandle.getDirectoryHandle(dayKey, { create: true });
  const safeName = sanitizeFileStem(state?.profile?.name || "简历");
  const stamp = getLocalTimestampKey(now);
  const fileName = `${stamp}_${safeName}.json`;
  const payload = buildArchivePayload(serializedState, dayKey, reason, now.toISOString());
  if (!payload) return;

  await writeTextFile(dayDirHandle, fileName, payload);
  await writeTextFile(dayDirHandle, "latest.json", payload);

  if (archiveRuntime.lastCleanupDayKey !== dayKey) {
    await cleanupExpiredArchiveDays(rootHandle, now);
    archiveRuntime.lastCleanupDayKey = dayKey;
  }

  archiveRuntime.lastSavedSerialized = serializedState;
  archiveRuntime.lastSavedDayKey = dayKey;
  archiveRuntime.lastSavedAt = nowMs;
}

function monthOptionsAroundNow() {
  const result = [];
  const now = new Date();
  for (let offset = -72; offset <= 24; offset += 1) {
    const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    result.push(`<option value="${value}">${formatMonthCN(value)}</option>`);
  }
  return result.join("");
}

function cacheRefs() {
  [
    "saveStatus", "previewStage", "previewViewport", "previewScaleFrame", "zoomOutBtn", "zoomInBtn", "zoomValue", "resumePage", "resumeHead", "previewName", "previewAge", "previewGender",
    "previewPolitical", "previewPhone", "previewEmail", "previewArrival",
    "previewPhoto", "photoWrap", "infoGrid", "resumeSections", "coverSheet",
    "coverName", "coverContact", "letterSheet", "letterPreview", "settingsCard", "moduleAdjustCard",
    "moduleAdjustTitle", "selectedSectionXRange", "selectedSectionLineRange",
    "selectedSectionXNumber", "selectedSectionLineNumber",
    "settingsTitle", "editorDrawer", "drawerLabel", "drawerHandle", "workspaceResizer", "moduleSidebar", "toggleModuleSidebarBtn", "moduleSidebarFloatToggle", "previewBtn", "tabStrip", "customInfo",
    "activeSectionTitle", "sectionVisibleInput", "itemList", "importProgressPanel", "importProgressStage", "importProgressPercent", "importProgressDetail", "importProgressFill", "undoImportBtn", "fitOnePageBtn",
    "dashboardShell", "workbenchSearchInput", "workbenchSearchSummary", "workbenchSearchClear", "workbenchSearchResults", "workbenchImportBtn", "newCandidateBtn", "newResumeVersionBtn", "saveHistoryBtn", "openHistoryFolderBtn", "candidateSummary", "candidateFilters", "candidateList", "candidateOverview",
    "versionPanel", "activityPanel", "applicationSummary", "addApplicationBtn", "pipelineStrip", "applicationList", "todayReminder", "backToWorkbenchBtn"
  ].forEach((id) => refs[id] = $(`#${id}`));
  refs.drawerContent = $(".drawer-content");
  refs.profilePanel = $("#profilePanel");
  refs.sectionPanel = $("#sectionPanel");
  const monthList = $("#monthShortcutList");
  if (monthList) monthList.innerHTML = monthOptionsAroundNow();
}

function makeWorkbenchId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function cloneEditorState(source = state) {
  try {
    return structuredClone(source);
  } catch {
    return JSON.parse(JSON.stringify(source || initialState));
  }
}

function getProfileSchool(snapshot = state) {
  const education = snapshot?.sections?.find((item) => item.id === "education");
  const first = education?.items?.[0];
  const school = first?.fields?.school || String(first?.metaRight || "").split(/[-\s]/)[0];
  return String(school || "未填写学校").trim();
}

function getProfileRole(snapshot = state) {
  const internship = snapshot?.sections?.find((item) => item.id === "internship");
  const first = internship?.items?.[0];
  const role = first?.fields?.role || String(first?.metaRight || "").split(/\s{2,}|  /).pop();
  return String(role || "目标岗位待补充").trim();
}

function getCandidateInitial(name) {
  const text = String(name || "候").trim();
  return text.slice(0, 1) || "候";
}

function getCandidateDisplayNote(candidate, versions = []) {
  const raw = String(candidate?.note || "").trim();
  if (!raw || raw === "主简历候选人") {
    return versions[0]?.targetRole || "目标方向待补充";
  }
  return raw;
}

const companyLogoBasePath = "./assets/company-logos/iconfont/";
const companyLogoEntries = [
  { keys: ["腾讯", "tencent"], file: "腾讯.png" },
  { keys: ["字节跳动", "字节", "bytedance", "抖音", "懂车帝"], file: "字节跳动.png" },
  { keys: ["招商银行", "招行", "cmb"], file: "招商银行.png" },
  { keys: ["华为", "huawei"], file: "华为.png" },
  { keys: ["美团", "meituan"], file: "美团.png" },
  { keys: ["阿里巴巴", "阿里", "alibaba"], file: "阿里巴巴.png" },
  { keys: ["阿里云"], file: "阿里云.png" },
  { keys: ["蚂蚁", "ant"], file: "蚂蚁集团.png" },
  { keys: ["百度", "baidu"], file: "百度.png" },
  { keys: ["京东", "jd"], file: "京东.png" },
  { keys: ["小米", "xiaomi"], file: "小米.png" },
  { keys: ["网易", "netease"], file: "网易.png" },
  { keys: ["快手", "kuaishou"], file: "快手.png" },
  { keys: ["滴滴", "didi"], file: "滴滴出行.png" },
  { keys: ["拼多多", "pdd"], file: "拼多多.png" },
  { keys: ["淘宝", "taobao"], file: "淘宝.png" },
  { keys: ["哔哩", "bilibili", "b站"], file: "哔哩哔哩.png" },
  { keys: ["小红书", "red"], file: "小红书.png" },
  { keys: ["oppo"], file: "oppo.png" },
  { keys: ["vivo"], file: "vivo.png" },
  { keys: ["boss", "直聘"], file: "BOSS直聘.png" },
  { keys: ["58"], file: "58同城.png" },
  { keys: ["工商银行", "icbc"], file: "中国工商银行.png" },
  { keys: ["建设银行", "ccb"], file: "中国建设银行.png" },
  { keys: ["中国银行", "boc"], file: "中国银行.png" },
  { keys: ["民生银行"], file: "中国民生银行.png" },
  { keys: ["平安银行"], file: "平安银行.png" },
  { keys: ["东方财富"], file: "东方财富网.png" },
  { keys: ["东方证券"], file: "东方证券.png" },
  { keys: ["中金"], file: "中金证券.png" },
  { keys: ["广发证券"], file: "广发证券.png" },
  { keys: ["长江证券"], file: "长江证券.png" },
  { keys: ["兴业证券"], file: "兴业证券.png" }
];

function normalizeCompanyLogoText(value = "") {
  return String(value || "").trim().toLowerCase().replace(/[\s·\-_/（）()]+/g, "");
}

function getCompanyLogoPath(file = "") {
  return `${companyLogoBasePath}${encodeURIComponent(file)}`;
}

function getCompanyLogoSource(company = "") {
  const raw = String(company || "").trim();
  const normalized = normalizeCompanyLogoText(raw);
  if (!normalized) return null;
  const matched = companyLogoEntries.find((item) => item.keys.some((key) => normalized.includes(normalizeCompanyLogoText(key))));
  const file = matched?.file || `${raw.replace(/[\\/:*?"<>|]/g, "").trim()}.png`;
  return file ? { src: getCompanyLogoPath(file) } : null;
}

function getCompanyLogoMarkup(company = "") {
  const initial = escapeHtml(getCandidateInitial(company));
  const source = getCompanyLogoSource(company);
  if (!source?.src) return `<span class="company-mark" aria-hidden="true"><span class="company-fallback">${initial}</span></span>`;
  return `
    <span class="company-mark with-logo" aria-hidden="true">
      <img src="${escapeAttr(source.src)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('logo-failed');this.remove();">
      <span class="company-fallback">${initial}</span>
    </span>
  `;
}

function getCompactVersionLabel(version) {
  if (!version) return "未绑定";
  const base = String(version.targetRole || version.name || "简历版本")
    .replace(/^[^-]+-/, "")
    .replace(/实习生?$/, "实习")
    .trim();
  return base.length > 8 ? `${base.slice(0, 8)}...` : base;
}

function getReminderDateLabel(app) {
  const current = globalThis.ApplicationTimelineModel?.current(app);
  if (current?.at) return formatApplicationTimelineMiniDetail(current.at);
  return formatWorkbenchTime(app?.updatedAt || Date.now());
}

function getReminderText(app) {
  const current = globalThis.ApplicationTimelineModel?.current(app);
  const detail = current?.note || (current?.at ? formatApplicationTimelineDetail(current.at, current.precision).split(" ").slice(1).join(" ") : "");
  return `${app.company} ${app.role}${detail ? ` ${detail}` : ""}`;
}

function formatWorkbenchTime(value) {
  const time = new Date(value || Date.now()).getTime();
  if (!Number.isFinite(time)) return "刚刚";
  const diff = Date.now() - time;
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `今天 ${new Date(time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
  if (diff < 172800000) return "昨天";
  return new Date(time).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function formatApplicationPickedTime(value = "") {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${month}月${day}日 ${time}`;
}

function formatApplicationTimelineMiniDetail(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  const isoDate = new Date(text);
  if (/^\d{4}-\d{2}-\d{2}T/.test(text) && Number.isFinite(isoDate.getTime())) {
    return `${isoDate.getMonth() + 1}/${isoDate.getDate()}`;
  }
  const cnDate = text.match(/(?:(\d{4})年?)?(\d{1,2})月(\d{1,2})日/);
  if (cnDate) return `${Number(cnDate[2])}/${Number(cnDate[3])}`;
  const slashDate = text.match(/(?:(\d{4})[/-])?(\d{1,2})[/-](\d{1,2})(?:\s|$)/);
  if (slashDate) return `${Number(slashDate[2])}/${Number(slashDate[3])}`;
  return text.length > 4 ? text.slice(0, 4) : text;
}

function formatApplicationTimelineDetail(value = "", precision = "datetime") {
  const text = String(value || "").trim();
  const date = new Date(text);
  if (/^\d{4}-\d{2}-\d{2}T/.test(text) && Number.isFinite(date.getTime())) {
    const day = `${date.getMonth() + 1}/${date.getDate()}`;
    return precision === "date" ? day : `${day} ${padDateUnit(date.getHours())}:${padDateUnit(date.getMinutes())}`;
  }
  return text;
}

function padDateUnit(value) {
  return String(value).padStart(2, "0");
}

function formatDatePickerDate(date) {
  return `${date.getFullYear()}-${padDateUnit(date.getMonth() + 1)}-${padDateUnit(date.getDate())}`;
}

function formatDatePickerTime(date) {
  return `${padDateUnit(date.getHours())}:${padDateUnit(date.getMinutes())}`;
}

function parseApplicationNextDate(text = "") {
  const now = new Date();
  const raw = String(text || "");
  const match = raw.match(/(?:(\d{4})[/-])?(\d{1,2})月?[-/.]?(\d{1,2})日?(?:\s+(\d{1,2})[:：](\d{1,2}))?/);
  if (!match) return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 19, 0, 0);
  const year = Number(match[1] || now.getFullYear());
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const hour = Number(match[4] || 19);
  const minute = Number(match[5] || 0);
  const date = new Date(year, month, day, hour, minute, 0);
  return Number.isFinite(date.getTime()) ? date : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 19, 0, 0);
}

function getApplicationPickerDate(app) {
  if (applicationDatePickerState?.appId === app?.id && applicationDatePickerState.date) {
    const stateDate = new Date(applicationDatePickerState.date);
    if (Number.isFinite(stateDate.getTime())) return stateDate;
  }
  const current = globalThis.ApplicationTimelineModel?.current(app);
  return current?.at ? new Date(current.at) : parseApplicationNextDate(app?.next);
}

function getApplicationNextStageOptions(app = {}) {
  const currentKey = getApplicationStageKey(app);
  const currentIndex = applicationTimelineStages.findIndex(([key]) => key === currentKey);
  const options = [];
  if (app.status === "待投递") options.push("已投递");
  applicationTimelineStages.slice(Math.max(0, currentIndex + 1)).forEach(([key, label]) => {
    const status = key === "test" ? "笔试/测评" : label;
    if (!options.includes(status)) options.push(status);
  });
  ["待跟进", "已拒绝"].forEach((status) => {
    if (status !== app.status && !options.includes(status)) options.push(status);
  });
  return options;
}

function renderApplicationDatePicker(app) {
  if (!app || applicationDatePickerState?.appId !== app.id) return "";
  const selected = getApplicationPickerDate(app);
  const monthDate = applicationDatePickerState.month
    ? new Date(`${applicationDatePickerState.month}-01T00:00:00`)
    : new Date(selected.getFullYear(), selected.getMonth(), 1);
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i += 1) cells.push({ empty: true });
  for (let day = 1; day <= daysInMonth; day += 1) cells.push({ day });
  while (cells.length % 7 !== 0) cells.push({ empty: true });
  const activeDateText = formatDatePickerDate(selected);
  const mode = applicationDatePickerState.mode || "date";
  const hour = selected.getHours();
  const minute = selected.getMinutes();
  const second = selected.getSeconds();
  const hours = Array.from({ length: 24 }, (_, index) => index);
  const minutes = Array.from({ length: 60 }, (_, index) => index);
  const seconds = Array.from({ length: 60 }, (_, index) => index);
  const nextStage = String(applicationDatePickerState.stage || "");
  const customStage = String(applicationDatePickerState.customStage || "");
  const nextStageOptions = getApplicationNextStageOptions(app);
  return `
    <div class="application-date-picker application-schedule-popover" data-date-picker-root>
      <div class="application-schedule-head">
        <div><strong>设置下一步</strong><span>先选择阶段，再安排时间</span></div>
        <button type="button" data-date-picker-action="cancel" aria-label="关闭">×</button>
      </div>
      <label class="application-stage-field">
        <span>下一阶段</span>
        <select data-application-next-stage aria-label="下一阶段">
          <option value="">请选择下一步</option>
          ${nextStageOptions.map((status) => `<option value="${escapeAttr(status)}" ${status === nextStage ? "selected" : ""}>${escapeHtml(status)}</option>`).join("")}
          <option value="__custom__" ${nextStage === "__custom__" ? "selected" : ""}>自定义阶段...</option>
        </select>
      </label>
      ${nextStage === "__custom__" ? `<label class="application-stage-field application-custom-stage"><span>阶段名称</span><input data-application-custom-stage aria-label="阶段名称" value="${escapeAttr(customStage)}" placeholder="例如：业务复试 / 主管面" maxlength="20" /></label>` : ""}
      ${nextStage ? `
      <div class="application-schedule-divider"><span>安排时间</span><small>将记录到 ${escapeHtml(nextStage === "__custom__" ? (customStage || "自定义阶段") : nextStage)} 节点</small></div>
      <div class="date-picker-head">
        <button type="button" data-date-picker-action="prev-year" aria-label="上一年">«</button>
        <button type="button" data-date-picker-action="prev-month" aria-label="上一月">‹</button>
        <strong>${year}年 ${month + 1}月</strong>
        <button type="button" data-date-picker-action="next-month" aria-label="下一月">›</button>
        <button type="button" data-date-picker-action="next-year" aria-label="下一年">»</button>
      </div>
      ${mode === "time" ? `
        <div class="time-picker-title">选择时间</div>
        <div class="time-wheel">
          <div class="time-wheel-column" data-time-wheel-column="hour" data-active-index="${hour}">
            ${hours.map((item) => `<button class="${item === hour ? "active" : ""}" type="button" data-date-picker-time="hour" data-date-picker-value="${item}">${padDateUnit(item)} 时</button>`).join("")}
          </div>
          <div class="time-wheel-column" data-time-wheel-column="minute" data-active-index="${minute}">
            ${minutes.map((item) => `<button class="${item === minute ? "active" : ""}" type="button" data-date-picker-time="minute" data-date-picker-value="${item}">${padDateUnit(item)} 分</button>`).join("")}
          </div>
          <div class="time-wheel-column" data-time-wheel-column="second" data-active-index="${second}">
            ${seconds.map((item) => `<button class="${item === second ? "active" : ""}" type="button" data-date-picker-time="second" data-date-picker-value="${item}">${padDateUnit(item)} 秒</button>`).join("")}
          </div>
        </div>
      ` : `
        <div class="date-picker-week" aria-hidden="true"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div>
        <div class="date-picker-grid">
          ${cells.map((cell) => {
            if (cell.empty) return `<span></span>`;
            const date = new Date(year, month, cell.day, hour, minute, 0);
            const dateText = formatDatePickerDate(date);
            return `<button class="${dateText === activeDateText ? "active" : ""}" type="button" data-date-picker-date="${escapeAttr(dateText)}">${cell.day}</button>`;
          }).join("")}
        </div>
      `}
      <div class="date-picker-foot">
        <button type="button" data-date-picker-action="date">▦ ${escapeHtml(activeDateText)}</button>
        <button type="button" data-date-picker-action="time">◷ ${escapeHtml(formatDatePickerTime(selected))}:${escapeHtml(padDateUnit(second))}</button>
        <button type="button" data-date-picker-action="save">保存安排</button>
      </div>
      ` : `<div class="application-schedule-empty">选择下一阶段后可设置日期和具体时间</div>`}
    </div>
  `;
}

function positionApplicationSchedulePopover() {
  const popover = refs.versionPanel?.querySelector(".application-schedule-popover");
  const trigger = refs.versionPanel?.querySelector("[data-application-schedule-open]");
  if (!popover || !trigger) return;
  const margin = 12;
  const gap = 6;
  const triggerRect = trigger.getBoundingClientRect();
  const maxHeight = Math.max(260, window.innerHeight - margin * 2);
  popover.style.maxHeight = `${maxHeight}px`;
  const popoverWidth = Math.min(300, window.innerWidth - margin * 2);
  const popoverHeight = Math.min(popover.scrollHeight, maxHeight);
  const left = Math.min(
    window.innerWidth - popoverWidth - margin,
    Math.max(margin, triggerRect.right - popoverWidth)
  );
  const roomBelow = window.innerHeight - triggerRect.bottom - margin;
  const top = roomBelow >= popoverHeight
    ? triggerRect.bottom + gap
    : Math.max(margin, Math.min(triggerRect.top - popoverHeight - gap, window.innerHeight - popoverHeight - margin));
  popover.style.width = `${popoverWidth}px`;
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

function getApplicationStatusClass(status) {
  if (status === "Offer") return "good";
  if (["待跟进", "笔试/测评", "面试中"].includes(status) || /面$|终面/i.test(status)) return "warn";
  if (["已拒绝", "已归档"].includes(status)) return "muted";
  return "";
}

function getApplicationCategory(app = {}) {
  return globalThis.ApplicationTimelineModel?.category(app) || app.status || "待投递";
}

const applicationTimelineStages = [
  ["apply", "投递"],
  ["test", "测评"],
  ["screen", "筛选"],
  ["first", "一面"],
  ["second", "二面"],
  ["third", "三面"],
  ["fourth", "四面"],
  ["fifth", "五面"],
  ["sixth", "六面"],
  ["final", "终面"],
  ["hr", "HR面"],
  ["offer", "Offer"],
  ["onboard", "入职"]
];

const applicationBaseStageKeys = ["apply", "test", "screen"];
const applicationInterviewStageKeys = ["first", "second", "third", "fourth", "fifth", "sixth"];
const applicationTerminalStageKeys = ["final", "hr", "offer", "onboard"];
const applicationStageLabelMap = new Map(applicationTimelineStages.map(([key, label]) => [key, label]));

function getApplicationStageFromText(value = "") {
  const text = String(value || "").trim();
  if (!text) return null;
  if (/hr\s*面|hr面/i.test(text)) return { key: "hr", label: "HR面" };
  if (/终面|终轮|最终面/.test(text)) return { key: "final", label: "终面" };
  const patterns = [
    ["sixth", "六面", /六面|6面|第六轮/],
    ["fifth", "五面", /五面|5面|第五轮/],
    ["fourth", "四面", /四面|4面|第四轮/],
    ["third", "三面", /三面|3面|第三轮/],
    ["second", "二面", /二面|2面|第二轮/],
    ["first", "一面", /一面|1面|初面|第一轮|面试/]
  ];
  const match = patterns.find(([, , pattern]) => pattern.test(text));
  return match ? { key: match[0], label: match[1] } : null;
}

function makeApplicationTimeline(currentKey = "apply", doneKeys = [], details = {}) {
  const done = new Set(doneKeys);
  return applicationTimelineStages.map(([key, label]) => {
    const detail = details[key] || {};
    const status = key === currentKey ? "current" : done.has(key) ? "done" : "todo";
    return { key, label, status, time: detail.time || "", note: detail.note || "" };
  });
}

function getApplicationStageKey(app = {}) {
  const canonical = globalThis.ApplicationTimelineModel?.current(app);
  if (canonical?.key) return canonical.key;
  const status = String(app.status || "").trim();
  const next = String(app.next || "").trim();
  if (status === "Offer") return "offer";
  const explicitStage = getApplicationStageFromText(`${status} ${next}`);
  if (explicitStage) return explicitStage.key;
  if (status === "笔试/测评" || /笔试|测评/.test(next)) return "test";
  if (status === "已投递" || status === "待跟进" || status === "已拒绝" || /筛选|反馈|材料|跟进/.test(next)) return "screen";
  if (status === "入职") return "onboard";
  return "apply";
}

function getDoneStagesForCurrent(currentKey) {
  const keys = applicationTimelineStages.map(([key]) => key);
  const index = keys.indexOf(currentKey);
  if (index <= 0) return [];
  return keys.slice(0, index);
}

function deriveApplicationTimeline(app = {}) {
  const currentKey = getApplicationStageKey(app);
  const detail = {};
  const next = String(app.next || "").trim();
  if (next) {
    detail[currentKey] = /\d/.test(next) ? { time: next } : { note: next };
  }
  if (app.status === "已拒绝") detail[currentKey] = { note: "已拒绝" };
  return makeApplicationTimeline(currentKey, getDoneStagesForCurrent(currentKey), detail);
}

function getApplicationStageDefinitions(app = {}) {
  const currentKey = getApplicationStageKey(app);
  const keys = new Set(applicationBaseStageKeys);
  const rawTimeline = Array.isArray(app.timeline) ? app.timeline : [];
  const addStage = (key) => {
    if (!key || !applicationStageLabelMap.has(key)) return;
    keys.add(key);
    const interviewIndex = applicationInterviewStageKeys.indexOf(key);
    if (interviewIndex >= 0) {
      applicationInterviewStageKeys.slice(0, interviewIndex + 1).forEach((item) => keys.add(item));
    }
  };
  rawTimeline.forEach((item) => {
    const parsed = getApplicationStageFromText(item.label);
    const key = item.key || parsed?.key;
    if (item.status === "current" || item.time || item.note || (!applicationInterviewStageKeys.includes(key) && item.status === "done")) addStage(key);
  });
  addStage(currentKey);
  if (app.status === "Offer") addStage("offer");
  if (app.status === "入职") addStage("onboard");
  return applicationTimelineStages.filter(([key]) => {
    if (keys.has(key)) return true;
    return applicationTerminalStageKeys.includes(key) && rawTimeline.some((item) => (
      item.key === key && (item.status === "done" || item.status === "current" || item.time || item.note)
    ));
  });
}

function getApplicationTimeline(app = {}) {
  const canonical = globalThis.ApplicationTimelineModel?.normalize(app);
  if (canonical) {
    return canonical.map((item) => ({
      ...item,
      status: item.state,
      time: item.at || "",
      note: item.note || ""
    }));
  }
  return Array.isArray(app.timeline) ? app.timeline : deriveApplicationTimeline(app);
}

function syncApplicationTimeline(app = {}, options = {}) {
  return getApplicationTimeline(app);
}

function getApplicationTimelineMeta(app = {}) {
  const timeline = getApplicationTimeline(app);
  const currentIndex = Math.max(0, timeline.findIndex((item) => item.status === "current"));
  const doneCount = timeline.filter((item) => item.status === "done").length;
  const current = timeline[currentIndex] || timeline[0];
  const ratio = timeline.length <= 1 ? 0 : currentIndex / (timeline.length - 1);
  return { timeline, current, currentIndex, doneCount, ratio };
}

  function renderApplicationProgress(app = {}) {
    const meta = getApplicationTimelineMeta(app);
    const statusClass = getApplicationStatusClass(app.status);
    return `
      <div class="application-progress-mini ${statusClass}" aria-label="投递流程 ${escapeAttr(meta.current.label)}">
        <div class="application-progress-dots" style="--progress-ratio:${meta.ratio.toFixed(3)}; grid-template-columns:repeat(${meta.timeline.length}, minmax(0, 1fr));">
          ${meta.timeline.map((stage) => {
            const detail = stage.time || stage.note || "";
            const miniDetail = formatApplicationTimelineMiniDetail(detail);
            const displayDetail = formatApplicationTimelineDetail(detail, stage.precision);
            const title = displayDetail ? `${stage.label} ${displayDetail}` : stage.label;
            return `<span class="${escapeAttr(stage.status)}" title="${escapeAttr(title)}" ${stage.status === "current" ? 'aria-current="step"' : ""}><i>${escapeHtml(stage.label)}</i>${miniDetail ? `<small>${escapeHtml(miniDetail)}</small>` : ""}</span>`;
          }).join("")}
        </div>
      </div>
    `;
  }

function renderApplicationTimeline(app = {}) {
  const meta = getApplicationTimelineMeta(app);
  return `
    <div class="application-timeline-detail" style="grid-template-columns:repeat(${meta.timeline.length}, minmax(70px, 1fr));">
      ${meta.timeline.map((item) => `
        <div class="application-timeline-step ${escapeAttr(item.status)}" ${item.status === "current" ? 'aria-current="step"' : ""}>
          <span class="timeline-dot"></span>
          <strong>${escapeHtml(item.label)}</strong>
          ${item.time ? `<small>${escapeHtml(formatApplicationTimelineDetail(item.time, item.precision))}</small>` : item.note ? `<small>${escapeHtml(item.note)}</small>` : ""}
        </div>
      `).join("")}
    </div>
  `;
}

function getVersionStatusClass(status) {
  if (/已适配|一页$/.test(status)) return "good";
  if (/待|2页|超过/.test(status)) return "warn";
  if (/历史|归档/.test(status)) return "muted";
  return "";
}

function normalizeCandidateOrder() {
  if (!workbenchState?.candidates?.length) return;
  const ordered = [...workbenchState.candidates].sort((a, b) => {
    const orderA = Number.isFinite(Number(a.order)) ? Number(a.order) : Number.MAX_SAFE_INTEGER;
    const orderB = Number.isFinite(Number(b.order)) ? Number(b.order) : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  });
  ordered.forEach((candidate, index) => {
    candidate.order = index + 1;
  });
}

function getOrderedCandidates(mode = workbenchState?.candidateFilter || "all") {
  const candidates = [...(workbenchState?.candidates || [])];
  if (mode === "recent") {
    return candidates.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  }
  return candidates.sort((a, b) => {
    const orderA = Number.isFinite(Number(a.order)) ? Number(a.order) : Number.MAX_SAFE_INTEGER;
    const orderB = Number.isFinite(Number(b.order)) ? Number(b.order) : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  });
}

function reorderCandidate(sourceId, targetId, placeAfter = false) {
  if (!sourceId || !targetId || sourceId === targetId) return false;
  const ordered = getOrderedCandidates("all");
  const sourceIndex = ordered.findIndex((item) => item.id === sourceId);
  let targetIndex = ordered.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return false;
  const [moved] = ordered.splice(sourceIndex, 1);
  if (sourceIndex < targetIndex) targetIndex -= 1;
  ordered.splice(targetIndex + (placeAfter ? 1 : 0), 0, moved);
  ordered.forEach((candidate, index) => {
    candidate.order = index + 1;
  });
  return true;
}

function selectWorkbenchCandidate(candidateId) {
  if (!candidateId) return;
  syncActiveVersionFromEditor();
  workbenchState.selectedCandidateId = candidateId;
  workbenchState.selectedVersionId = getWorkbenchVersions(candidateId)[0]?.id || "";
  workbenchState.selectedApplicationId = "";
  workbenchState.applicationFilterStatus = "all";
  workbenchState.applicationFilterVersionId = "";
}

async function deleteWorkbenchCandidate(candidateId) {
  const candidate = workbenchState.candidates.find((item) => item.id === candidateId);
  if (!candidate) return;
  if (workbenchState.candidates.length <= 1) {
    await showWorkbenchNotice("无法删除", "至少需要保留一个候选人。");
    return;
  }
  const confirmed = await showWorkbenchConfirm(
    "删除候选人",
    `确认删除「${candidate.name}」及其简历版本和投递记录？此操作不可恢复。`,
    { confirmText: "删除", danger: true }
  );
  if (!confirmed) return;
  const wasSelected = workbenchState.selectedCandidateId === candidateId;
  workbenchState.candidates = workbenchState.candidates.filter((item) => item.id !== candidateId);
  workbenchState.versions = workbenchState.versions.filter((item) => item.candidateId !== candidateId);
  workbenchState.applications = workbenchState.applications.filter((item) => item.candidateId !== candidateId);
  workbenchState.activities = workbenchState.activities.filter((item) => item.candidateId !== candidateId);
  normalizeCandidateOrder();
  if (wasSelected) {
    const nextCandidate = getOrderedCandidates("all")[0];
    workbenchState.selectedCandidateId = nextCandidate?.id || "";
    workbenchState.selectedVersionId = getWorkbenchVersions(nextCandidate?.id)[0]?.id || "";
    workbenchState.selectedApplicationId = "";
  }
  addWorkbenchActivity("删除候选人", candidate.name);
}

function buildDefaultWorkbench() {
  const now = Date.now();
  const currentSnapshot = cloneEditorState(state);
  const currentName = String(currentSnapshot?.profile?.name || "高子强").trim() || "高子强";
  const primaryCandidateId = makeWorkbenchId("candidate");
  const primaryVersionId = makeWorkbenchId("version");
  const candidates = [
    {
      id: primaryCandidateId,
      name: currentName,
      school: getProfileSchool(currentSnapshot),
      note: getProfileRole(currentSnapshot),
      status: "recent",
      order: 1,
      createdAt: new Date(now - 86400000 * 5).toISOString(),
      updatedAt: new Date(now - 120000).toISOString()
    },
    { id: makeWorkbenchId("candidate"), name: "李雨桐", school: "上海财经大学", note: "产品运营方向", status: "applied", order: 2, createdAt: new Date(now - 86400000 * 8).toISOString(), updatedAt: new Date(now - 3600000 * 6).toISOString() },
    { id: makeWorkbenchId("candidate"), name: "陈思远", school: "浙江大学", note: "算法实习方向", status: "todo", order: 3, createdAt: new Date(now - 86400000 * 11).toISOString(), updatedAt: new Date(now - 86400000).toISOString() },
    { id: makeWorkbenchId("candidate"), name: "王嘉宁", school: "南京大学", note: "金融科技方向", status: "applied", order: 4, createdAt: new Date(now - 86400000 * 14).toISOString(), updatedAt: new Date(now - 86400000 * 2).toISOString() },
    { id: makeWorkbenchId("candidate"), name: "赵明轩", school: "华中科技大学", note: "数据分析方向", status: "recent", order: 5, createdAt: new Date(now - 86400000 * 20).toISOString(), updatedAt: new Date(now - 86400000 * 4).toISOString() }
  ];
  const versions = [
    {
      id: primaryVersionId,
      candidateId: primaryCandidateId,
      name: `${currentName}-数据分析实习`,
      targetRole: getProfileRole(currentSnapshot),
      source: "PDF导入",
      pageCount: 1,
      status: "一页已适配",
      updatedAt: new Date(now - 120000).toISOString(),
      createdAt: new Date(now - 86400000 * 3).toISOString(),
      snapshot: currentSnapshot
    },
    { id: makeWorkbenchId("version"), candidateId: primaryCandidateId, name: "金融产品岗-投递版", targetRole: "金融产品部-数据分析师", source: "复制版本", pageCount: 1, status: "待检查", updatedAt: new Date(now - 3600000 * 3).toISOString(), createdAt: new Date(now - 86400000 * 2).toISOString(), snapshot: currentSnapshot },
    { id: makeWorkbenchId("version"), candidateId: primaryCandidateId, name: "国企网申精简版", targetRole: "数据分析管培生", source: "手动创建", pageCount: 1, status: "一页", updatedAt: new Date(now - 86400000).toISOString(), createdAt: new Date(now - 86400000 * 6).toISOString(), snapshot: currentSnapshot },
    { id: makeWorkbenchId("version"), candidateId: primaryCandidateId, name: "暑期实习通用版", targetRole: "商业分析实习", source: "历史版本", pageCount: 2, status: "2页", updatedAt: new Date(now - 86400000 * 4).toISOString(), createdAt: new Date(now - 86400000 * 10).toISOString(), snapshot: currentSnapshot }
  ];
  const applications = [
    { id: makeWorkbenchId("app"), candidateId: primaryCandidateId, company: "腾讯", role: "数据分析实习", versionId: primaryVersionId, status: "二面", next: "7月5日 二面", timeline: makeApplicationTimeline("second", ["apply", "test", "screen", "first"], { apply: { time: "06/28" }, test: { time: "06/30" }, screen: { time: "07/02" }, first: { time: "07/04" }, second: { time: "7月5日 二面" } }), updatedAt: new Date(now - 3600000 * 2).toISOString() },
    { id: makeWorkbenchId("app"), candidateId: primaryCandidateId, company: "字节跳动", role: "产品数据分析", versionId: primaryVersionId, status: "已投递", next: "待反馈", timeline: makeApplicationTimeline("screen", ["apply"], { apply: { time: "07/01" }, screen: { note: "待反馈" } }), updatedAt: new Date(now - 3600000 * 8).toISOString() },
    { id: makeWorkbenchId("app"), candidateId: primaryCandidateId, company: "招商银行", role: "金融科技岗", versionId: primaryVersionId, status: "笔试/测评", next: "7月4日 19:00", timeline: makeApplicationTimeline("test", ["apply"], { apply: { time: "07/01" }, test: { time: "7月4日 19:00" } }), updatedAt: new Date(now - 86400000).toISOString() },
    { id: makeWorkbenchId("app"), candidateId: primaryCandidateId, company: "华为", role: "算法产品实习", versionId: primaryVersionId, status: "待跟进", next: "补充材料", timeline: makeApplicationTimeline("screen", ["apply", "test"], { apply: { time: "06/30" }, test: { time: "07/01" }, screen: { note: "补充材料" } }), updatedAt: new Date(now - 86400000 * 2).toISOString() },
    { id: makeWorkbenchId("app"), candidateId: primaryCandidateId, company: "美团", role: "商业分析实习", versionId: primaryVersionId, status: "Offer", next: "确认入职时间", timeline: makeApplicationTimeline("offer", ["apply", "test", "screen", "first", "second", "hr"], { apply: { time: "06/20" }, first: { time: "06/26" }, second: { time: "06/28" }, hr: { time: "06/30" }, offer: { note: "确认入职时间" } }), updatedAt: new Date(now - 86400000 * 3).toISOString() }
  ];
  return {
    schema: WORKBENCH_SCHEMA_VERSION,
    view: "dashboard",
    selectedCandidateId: primaryCandidateId,
    selectedVersionId: primaryVersionId,
    candidateFilter: "all",
    activeTab: "resumes",
    search: "",
    candidates,
    versions,
    applications,
    activities: [
      { id: makeWorkbenchId("act"), candidateId: primaryCandidateId, label: "自动保存", detail: "2分钟前", createdAt: new Date(now - 120000).toISOString() },
      { id: makeWorkbenchId("act"), candidateId: primaryCandidateId, label: "压缩一页", detail: "已适配", createdAt: new Date(now - 900000).toISOString() },
      { id: makeWorkbenchId("act"), candidateId: primaryCandidateId, label: "导出 PDF", detail: "今天", createdAt: new Date(now - 3600000).toISOString() },
      { id: makeWorkbenchId("act"), candidateId: primaryCandidateId, label: "从 PDF 导入", detail: "初始版本", createdAt: new Date(now - 86400000 * 3).toISOString() }
    ]
  };
}

function ensureWorkbenchDefaults() {
  if (!workbenchState || typeof workbenchState !== "object") {
    workbenchState = buildDefaultWorkbench();
  }
  const previousSchema = Number(workbenchState.schema) || 1;
  if (previousSchema < 3 && Array.isArray(workbenchState.applications)) {
    workbenchState.applications.forEach((application) => {
      if (!Array.isArray(application.timeline)) return;
      application.timeline.forEach((item) => {
        const source = String(item.time || item.at || "").trim();
        if (!source) return;
        if (item.time && !/\d{1,2}[:：]\d{2}/.test(source)) {
          item.precision = "date";
          return;
        }
        if (!item.time && item.at) {
          const date = new Date(item.at);
          if (Number.isFinite(date.getTime()) && date.getHours() === 9 && date.getMinutes() === 0 && date.getSeconds() === 0) {
            item.precision = "date";
          }
        }
      });
    });
  }
  workbenchState.schema = WORKBENCH_SCHEMA_VERSION;
  if (!Array.isArray(workbenchState.candidates)) workbenchState.candidates = [];
  if (!Array.isArray(workbenchState.versions)) workbenchState.versions = [];
  if (!Array.isArray(workbenchState.applications)) workbenchState.applications = [];
  if (!Array.isArray(workbenchState.activities)) workbenchState.activities = [];
  if (!workbenchState.candidates.length) {
    const fresh = buildDefaultWorkbench();
    workbenchState.candidates = fresh.candidates;
    workbenchState.versions = fresh.versions;
    workbenchState.applications = fresh.applications;
    workbenchState.activities = fresh.activities;
    workbenchState.selectedCandidateId = fresh.selectedCandidateId;
    workbenchState.selectedVersionId = fresh.selectedVersionId;
  }
  workbenchState.applications.forEach((app) => {
    syncApplicationTimeline(app, { keepFutureDetails: true });
  });
  normalizeCandidateOrder();
  const candidateIds = new Set(workbenchState.candidates.map((item) => item.id));
  if (!candidateIds.has(workbenchState.selectedCandidateId)) {
    workbenchState.selectedCandidateId = workbenchState.candidates[0]?.id || "";
  }
  const candidateVersions = workbenchState.versions.filter((item) => item.candidateId === workbenchState.selectedCandidateId);
  if (!candidateVersions.some((item) => item.id === workbenchState.selectedVersionId)) {
    workbenchState.selectedVersionId = candidateVersions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0]?.id || "";
  }
  workbenchState.candidateFilter = workbenchState.candidateFilter || "all";
  workbenchState.activeTab = ["resumes", "applications"].includes(workbenchState.activeTab)
    ? workbenchState.activeTab
    : "resumes";
  workbenchState.search = String(workbenchState.search || "");
  workbenchState.selectedApplicationId = String(workbenchState.selectedApplicationId || "");
  workbenchState.applicationFilterStatus = String(workbenchState.applicationFilterStatus || "all");
  workbenchState.applicationFilterVersionId = String(workbenchState.applicationFilterVersionId || "");
}

function hydrateWorkbench() {
  const saved = globalThis.ResumeDataLayer?.readJson(workbenchStorageKey);
  workbenchState = saved?.ok ? saved.value : null;
  ensureWorkbenchDefaults();
}

function persistWorkbench() {
  if (!workbenchState) return false;
  workbenchState.schema = WORKBENCH_SCHEMA_VERSION;
  const result = globalThis.ResumeDataLayer?.writeJson(workbenchStorageKey, workbenchState);
  if (result?.ok) {
    queueSharedWorkspacePersist();
    return true;
  }
  console.warn("Workbench cache skipped:", result?.error);
  notifyStorageFailure(result);
  return false;
}

function applySharedWorkspacePayload(payload) {
  const validation = globalThis.ResumeDataLayer?.validateBackup(payload);
  if (!validation?.ok) throw new Error(validation?.reason || "共享工作台数据无效");
  sharedWorkspaceReady = false;
  state = cloneEditorState(payload.editor);
  workbenchState = cloneEditorState(payload.workbench);
  ensureStateDefaults();
  normalizeSectionBuiltinFlags();
  ensureWorkbenchDefaults();
  globalThis.ResumeDataLayer?.writeJson(storageKey, state);
  globalThis.ResumeDataLayer?.writeJson(workbenchStorageKey, workbenchState);
  syncInputsFromState();
  renderAll();
  renderWorkbench();
  applyWorkbenchRoute({ replaceEmpty: false });
  sharedWorkspaceReady = true;
}

async function postSharedWorkspace(payload, initializeOnly = false) {
  const response = await fetch(LOCAL_WORKSPACE_STATE_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload, initializeOnly })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result?.ok) throw new Error(result?.message || `共享数据保存失败（${response.status}）`);
  return result;
}

function queueSharedWorkspacePersist() {
  if (!sharedWorkspaceReady) return;
  window.clearTimeout(sharedWorkspacePersistTimer);
  sharedWorkspacePersistTimer = window.setTimeout(() => {
    sharedWorkspacePersistChain = sharedWorkspacePersistChain
      .catch(() => undefined)
      .then(() => postSharedWorkspace(buildFullProjectBackup(), false))
      .catch((error) => console.warn("Shared workspace save skipped:", error));
  }, 500);
}

async function initializeSharedWorkspace() {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(LOCAL_WORKSPACE_STATE_API, { method: "GET", cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) throw new Error(result?.message || "共享数据服务未就绪");
      if (result.data) {
        applySharedWorkspacePayload(result.data);
        return;
      }
      const initialized = await postSharedWorkspace(buildFullProjectBackup(), true);
      if (initialized.created === false && initialized.data) applySharedWorkspacePayload(initialized.data);
      else sharedWorkspaceReady = true;
      return;
    } catch (error) {
      if (attempt === 89) {
        console.warn("Shared workspace unavailable; using browser cache:", error);
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
  }
}

function notifyStorageFailure(result = {}) {
  if (storageWarningShown) return;
  storageWarningShown = true;
  const sizeMb = result.bytes ? `当前写入约 ${(result.bytes / 1024 / 1024).toFixed(1)} MB。` : "";
  window.setTimeout(() => {
    void showWorkbenchNotice(
      "自动保存未完成",
      `${result.quotaExceeded ? "浏览器本地存储空间不足。" : "浏览器拒绝了本次本地写入。"}${sizeMb}请先在工作台使用“保存历史”，再精简较大的照片或恢复浏览器存储空间。`
    );
  }, 0);
}

function buildFullProjectBackup() {
  syncActiveVersionFromEditor();
  return globalThis.ResumeDataLayer.buildBackup(state, workbenchState, {
    editor: EDITOR_SCHEMA_VERSION,
    workbench: WORKBENCH_SCHEMA_VERSION
  });
}

function downloadFullProjectBackup() {
  const payload = buildFullProjectBackup();
  const stamp = getLocalDayKey().replaceAll("-", "");
  const candidate = sanitizeFileStem(getWorkbenchCandidate()?.name || state.profile?.name || "简历");
  globalThis.ResumeDataLayer.downloadJson(`${candidate}_简历工作台备份_${stamp}.json`, payload);
  addWorkbenchActivity("备份数据", "已导出完整工作台");
  persistWorkbench();
}

async function restoreFullProjectBackup(file) {
  let payload;
  try {
    payload = await globalThis.ResumeDataLayer.readJsonFile(file);
  } catch (error) {
    await showWorkbenchNotice("无法读取备份", error?.message || "文件格式无效。");
    return;
  }
  const validation = globalThis.ResumeDataLayer.validateBackup(payload);
  if (!validation.ok) {
    await showWorkbenchNotice("无法恢复备份", validation.reason);
    return;
  }
  const candidateCount = Array.isArray(payload.workbench?.candidates) ? payload.workbench.candidates.length : 0;
  const versionCount = Array.isArray(payload.workbench?.versions) ? payload.workbench.versions.length : 0;
  const confirmed = await showWorkbenchConfirm(
    "恢复完整备份",
    `将用备份中的 ${candidateCount} 位候选人、${versionCount} 份简历覆盖当前工作台。恢复前请确认当前数据已备份。`,
    { confirmText: "确认恢复", danger: true }
  );
  if (!confirmed) return;

  const previousEditor = localStorage.getItem(storageKey);
  const previousWorkbench = localStorage.getItem(workbenchStorageKey);
  const restoredEditor = globalThis.ResumeDataLayer.clone(payload.editor);
  const restoredWorkbench = globalThis.ResumeDataLayer.clone(payload.workbench);
  restoredEditor.schema = EDITOR_SCHEMA_VERSION;
  restoredWorkbench.schema = WORKBENCH_SCHEMA_VERSION;
  const editorWrite = globalThis.ResumeDataLayer.writeJson(storageKey, restoredEditor);
  const workbenchWrite = editorWrite.ok
    ? globalThis.ResumeDataLayer.writeJson(workbenchStorageKey, restoredWorkbench)
    : { ok: false, error: editorWrite.error, quotaExceeded: editorWrite.quotaExceeded, bytes: editorWrite.bytes };
  if (!editorWrite.ok || !workbenchWrite.ok) {
    if (previousEditor == null) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, previousEditor);
    if (previousWorkbench == null) localStorage.removeItem(workbenchStorageKey);
    else localStorage.setItem(workbenchStorageKey, previousWorkbench);
    await showWorkbenchNotice("恢复失败", "浏览器未能完整写入备份，当前数据已回滚。请释放本地存储空间后重试。");
    return;
  }
  window.location.reload();
}

function getWorkbenchCandidate() {
  ensureWorkbenchDefaults();
  return workbenchState.candidates.find((item) => item.id === workbenchState.selectedCandidateId) || workbenchState.candidates[0] || null;
}

function getWorkbenchVersions(candidateId = workbenchState?.selectedCandidateId) {
  return (workbenchState?.versions || [])
    .filter((item) => item.candidateId === candidateId)
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

function getWorkbenchApplications(candidateId = workbenchState?.selectedCandidateId) {
  return (workbenchState?.applications || [])
    .filter((item) => item.candidateId === candidateId)
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

function getPrimaryVersionForCandidate(candidateId = workbenchState?.selectedCandidateId) {
  const versions = getWorkbenchVersions(candidateId);
  return versions.find((item) => item.id === workbenchState?.selectedVersionId) || versions[0] || null;
}

function setWorkbenchTab(tab, options = {}) {
  workbenchState.activeTab = ["resumes", "applications"].includes(tab) ? tab : "resumes";
  if (options.status !== undefined) workbenchState.applicationFilterStatus = options.status || "all";
  if (options.versionId !== undefined) workbenchState.applicationFilterVersionId = options.versionId || "";
  if (options.applicationId !== undefined) workbenchState.selectedApplicationId = options.applicationId || "";
  renderWorkbench();
}

function syncActiveVersionFromEditor() {
  if (!workbenchState?.selectedVersionId) return;
  const version = workbenchState.versions.find((item) => item.id === workbenchState.selectedVersionId);
  if (!version) return;
  const now = new Date().toISOString();
  version.snapshot = cloneEditorState(state);
  version.updatedAt = now;
  version.pageCount = Number(refs.resumePage?.dataset?.pageCount || version.pageCount || 1);
  const candidate = workbenchState.candidates.find((item) => item.id === version.candidateId);
  if (candidate) {
    candidate.name = state.profile?.name || candidate.name;
    candidate.school = getProfileSchool(state);
    candidate.updatedAt = now;
  }
}

function setWorkbenchMode(isDashboard) {
  document.body.classList.toggle("dashboard-mode", Boolean(isDashboard));
  if (workbenchState) {
    workbenchState.view = isDashboard ? "dashboard" : "editor";
    persistWorkbench();
  }
}

function updateWorkbenchRoute(route, options = {}) {
  const nextHash = route === "workbench" ? "#workbench" : `#editor/${encodeURIComponent(route)}`;
  if (window.location.hash === nextHash) return;
  const method = options.replace ? "replaceState" : "pushState";
  window.history[method]({ route }, "", nextHash);
}

function openWorkbenchEditor(versionId, options = {}) {
  syncActiveVersionFromEditor();
  const version = workbenchState.versions.find((item) => item.id === versionId);
  if (!version) {
    if (!options.fromRoute) updateWorkbenchRoute("workbench", { replace: true });
    return;
  }
    workbenchState.selectedVersionId = version.id;
    workbenchState.selectedCandidateId = version.candidateId;
    workbenchState.selectedApplicationId = "";
  state = cloneEditorState(version.snapshot || initialState);
  ensureStateDefaults();
  normalizeSectionBuiltinFlags();
  syncInputsFromState();
  setWorkbenchMode(false);
  renderAll();
  persistWorkbench();
  if (!options.fromRoute) updateWorkbenchRoute(version.id, options);
}

function returnToWorkbench(options = {}) {
  syncActiveVersionFromEditor();
  setWorkbenchMode(true);
  renderWorkbench();
  if (!options.fromRoute) updateWorkbenchRoute("workbench", options);
}

function applyWorkbenchRoute(options = {}) {
  const editorMatch = /^#editor\/(.+)$/.exec(window.location.hash || "");
  if (editorMatch) {
    openWorkbenchEditor(decodeURIComponent(editorMatch[1]), { fromRoute: true });
    return;
  }
  returnToWorkbench({ fromRoute: true });
  if (!window.location.hash && options.replaceEmpty !== false) updateWorkbenchRoute("workbench", { replace: true });
}

function bindWorkbenchRouting() {
  window.addEventListener("popstate", () => applyWorkbenchRoute({ replaceEmpty: false }));
  window.addEventListener("hashchange", () => applyWorkbenchRoute({ replaceEmpty: false }));
}

function renderCandidateList() {
  const query = String(workbenchState.search || "").trim().toLowerCase();
  let allCandidates = getOrderedCandidates(workbenchState.candidateFilter);
  let canDrag = workbenchState.candidateFilter !== "recent";
  let filtered = allCandidates.filter((candidate) => {
    const apps = getWorkbenchApplications(candidate.id);
    const versions = getWorkbenchVersions(candidate.id);
    const haystack = [
      candidate.name,
      candidate.school,
      candidate.note,
      ...versions.flatMap((item) => [item.name, item.targetRole, item.source, item.status]),
      ...apps.flatMap((item) => [item.company, item.role, item.status, item.next])
    ].join(" ").toLowerCase();
    if (query && !haystack.includes(query)) return false;
    if (workbenchState.candidateFilter === "applied") return apps.length > 0;
    if (workbenchState.candidateFilter === "todo") return candidate.status === "todo";
    if (workbenchState.candidateFilter === "recent") return true;
    return true;
  });
  if (!query && !filtered.length && workbenchState.candidates.length && workbenchState.candidateFilter !== "all") {
    workbenchState.candidateFilter = "all";
    allCandidates = getOrderedCandidates("all");
    canDrag = true;
    filtered = allCandidates;
  }
  if (refs.candidateSummary) refs.candidateSummary.textContent = query ? `匹配 ${filtered.length}` : `全部 ${workbenchState.candidates.length}`;
  if (!refs.candidateList) return;
  refs.candidateList.innerHTML = filtered.length ? filtered.map((candidate) => {
    const active = candidate.id === workbenchState.selectedCandidateId ? " active" : "";
    return `
      <article class="candidate-row${active}" data-candidate-id="${escapeAttr(candidate.id)}" draggable="${canDrag ? "true" : "false"}" role="button" tabindex="0" title="${canDrag ? "拖动可调整排序，点击可切换候选人" : "最近编辑视图按时间排序"}">
        <span class="candidate-main">
          <span class="candidate-name">${escapeHtml(candidate.name)}</span>
          <span class="candidate-meta">${escapeHtml(candidate.school || "学校待补充")}</span>
        </span>
        <button class="candidate-delete-btn" type="button" data-candidate-action="delete" aria-label="删除候选人 ${escapeAttr(candidate.name)}" title="删除候选人">删</button>
      </article>
    `;
  }).join("") : `<div class="empty-workbench"><div><strong>没有匹配候选人</strong><span>换个关键词或新建候选人。</span></div></div>`;
}

function getWorkbenchSearchResults(query = workbenchState?.search || "") {
  const normalized = String(query || "").trim().toLowerCase();
  if (!normalized || !workbenchState) return [];
  const results = [];
  workbenchState.candidates.forEach((candidate) => {
    const text = [candidate.name, candidate.school, candidate.note].join(" ").toLowerCase();
    if (text.includes(normalized)) {
      results.push({ kind: "candidate", id: candidate.id, candidateId: candidate.id, title: candidate.name, meta: candidate.school || "候选人" });
    }
  });
  workbenchState.versions.forEach((version) => {
    const candidate = workbenchState.candidates.find((item) => item.id === version.candidateId);
    const text = [version.name, version.targetRole, version.source, candidate?.name].join(" ").toLowerCase();
    if (text.includes(normalized)) {
      results.push({ kind: "version", id: version.id, candidateId: version.candidateId, title: version.name, meta: `${candidate?.name || "候选人"} · ${version.targetRole || "简历版本"}` });
    }
  });
  workbenchState.applications.forEach((app) => {
    const candidate = workbenchState.candidates.find((item) => item.id === app.candidateId);
    const text = [app.company, app.role, app.status, app.next, candidate?.name].join(" ").toLowerCase();
    if (text.includes(normalized)) {
      results.push({ kind: "application", id: app.id, candidateId: app.candidateId, title: `${app.company} · ${app.role}`, meta: `${candidate?.name || "候选人"} · ${app.status || "投递记录"}` });
    }
  });
  return results;
}

function renderWorkbenchSearch() {
  if (!refs.workbenchSearchInput || !refs.workbenchSearchResults) return;
  const query = String(workbenchState?.search || "").trim();
  const results = getWorkbenchSearchResults(query);
  if (refs.workbenchSearchClear) refs.workbenchSearchClear.hidden = !query;
  if (refs.workbenchSearchSummary) refs.workbenchSearchSummary.textContent = query ? `${results.length} 项` : "";
  refs.workbenchSearchResults.hidden = !query;
  refs.workbenchSearchResults.innerHTML = query ? `
    <div class="dashboard-search-result-head">${results.length ? `找到 ${results.length} 项结果` : "没有匹配结果"}</div>
    ${results.slice(0, 10).map((item) => `
      <button class="dashboard-search-result" type="button" role="option" data-search-kind="${escapeAttr(item.kind)}" data-search-id="${escapeAttr(item.id)}" data-search-candidate-id="${escapeAttr(item.candidateId)}">
        <span class="dashboard-search-result-type">${item.kind === "candidate" ? "候选人" : item.kind === "version" ? "简历" : "投递"}</span>
        <span class="dashboard-search-result-main"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.meta)}</small></span>
      </button>
    `).join("")}
    ${results.length > 10 ? `<div class="dashboard-search-result-more">还有 ${results.length - 10} 项，请继续输入缩小范围</div>` : ""}
  ` : "";
}

function renderCandidateOverview() {
  const candidate = getWorkbenchCandidate();
  if (!candidate || !refs.candidateOverview) return;
  refs.candidateOverview.innerHTML = `
    <div class="candidate-profile-card">
      <div class="candidate-profile-main">
        <div class="candidate-profile-title">
          <h1>${escapeHtml(candidate.name)}</h1>
          <button class="inline-icon-btn" type="button" title="编辑姓名、学校和备注" data-candidate-profile="true" aria-label="编辑候选人资料">✎</button>
        </div>
        <span class="candidate-profile-school">${escapeHtml(candidate.school || "学校待补充")}</span>
      </div>
    </div>
  `;
}

function renderVersionPanel() {
  if (!refs.versionPanel) return;
  const candidate = getWorkbenchCandidate();
  const versions = getWorkbenchVersions(candidate?.id);
  if (workbenchState.activeTab === "applications") {
    renderApplicationsMain();
    return;
  }
  refs.versionPanel.innerHTML = `
    <div class="version-toolbar">
      <div class="version-toolbar-left">
        <button class="version-toolbar-btn" type="button" data-toolbar-action="new-version">+ 新建简历</button>
        <button class="version-toolbar-btn" type="button" data-toolbar-action="batch">批量操作</button>
      </div>
      <div class="version-toolbar-right">
        <span>最近编辑优先 · ${versions.length} 个版本</span>
      </div>
    </div>
    <div class="version-table-head" role="row">
      <span></span>
      <span>版本信息</span>
      <span>目标岗位</span>
      <span>来源</span>
      <span>页数</span>
      <span>一页适配</span>
      <span>最近编辑</span>
      <span>操作</span>
    </div>
    <div class="version-list">
      ${versions.length ? versions.map((version) => {
        const active = version.id === workbenchState.selectedVersionId ? " active" : "";
        const statusClass = getVersionStatusClass(version.status);
        const linkedApps = getWorkbenchApplications(version.candidateId).filter((app) => app.versionId === version.id);
        return `
          <article class="version-row${active}" data-version-id="${escapeAttr(version.id)}">
            <label class="version-check" aria-label="选择 ${escapeAttr(version.name)}"><input type="checkbox" ${active ? "checked" : ""} /></label>
            <div class="version-info-cell">
              <div class="version-thumb" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>
              <div class="version-title-line">
                <span class="version-title">${escapeHtml(version.name)}</span>
                <span class="favorite-star" aria-hidden="true">☆</span>
              </div>
            </div>
            <span class="version-cell">${escapeHtml(version.targetRole || "目标岗位待补充")}</span>
            <span class="version-cell"><span class="status-chip muted">${escapeHtml(version.source || "手动创建")}</span></span>
            <span class="version-cell">${Number(version.pageCount || 1)} 页</span>
            <span class="version-cell"><span class="status-chip ${statusClass}">${escapeHtml(version.status || "未检查")}</span></span>
            <span class="version-cell">${escapeHtml(formatWorkbenchTime(version.updatedAt))}</span>
            <div class="version-actions">
              <button class="version-action-btn primary-mini" type="button" data-version-action="open" data-version-id="${escapeAttr(version.id)}">打开编辑</button>
              <div class="version-meta">
                <button class="inline-link-btn" type="button" data-version-action="apps" data-version-id="${escapeAttr(version.id)}">${linkedApps.length} 个投递</button>
                <button class="inline-link-btn" type="button" data-version-action="copy" data-version-id="${escapeAttr(version.id)}">复制</button>
                <button class="inline-link-btn" type="button" data-version-action="rename" data-version-id="${escapeAttr(version.id)}">重命名</button>
                <button class="inline-link-btn danger" type="button" data-version-action="delete" data-version-id="${escapeAttr(version.id)}">删除</button>
              </div>
            </div>
          </article>
        `;
      }).join("") : `<div class="empty-workbench"><div><strong>暂无简历版本</strong><span>在当前候选人的简历版本区域新建简历。</span></div></div>`}
    </div>
  `;
}

function renderApplicationsMain() {
  if (!refs.versionPanel) return;
  const candidate = getWorkbenchCandidate();
  const allApps = getWorkbenchApplications(candidate?.id);
  const versions = getWorkbenchVersions(candidate?.id);
  const versionOptions = versions.map((version) => `<option value="${escapeAttr(version.id)}">${escapeHtml(version.name)}</option>`).join("");
  const statuses = ["待投递", "已投递", "笔试/测评", "面试中", "Offer", "已拒绝"];
  const activeStatus = workbenchState.applicationFilterStatus || "all";
  const activeVersionId = workbenchState.applicationFilterVersionId || "";
  const apps = allApps.filter((app) => {
    const category = getApplicationCategory(app);
    const statusMatched = activeStatus === "all"
      || category === activeStatus
      || app.status === activeStatus
      ;
    const versionMatched = !activeVersionId || app.versionId === activeVersionId;
    return statusMatched && versionMatched;
  });
  const activeVersion = versions.find((version) => version.id === activeVersionId);
  const filterLabel = activeVersion
    ? `当前筛选：${activeVersion.name}`
    : activeStatus === "all" ? "全部投递" : `当前筛选：${activeStatus}`;
  const selectedApplicationId = workbenchState.selectedApplicationId && apps.some((item) => item.id === workbenchState.selectedApplicationId)
    ? workbenchState.selectedApplicationId
    : apps[0]?.id;
  refs.versionPanel.innerHTML = `
    <div class="version-toolbar">
      <span>投递进度 · ${apps.length}/${allApps.length} 个岗位</span>
      <span>${escapeHtml(filterLabel)}</span>
    </div>
    <div class="application-filter-bar" aria-label="投递筛选">
      <button class="${activeStatus === "all" && !activeVersionId ? "active" : ""}" type="button" data-application-filter-status="all">全部</button>
      ${statuses.map((status) => `<button class="${activeStatus === status ? "active" : ""}" type="button" data-application-filter-status="${escapeAttr(status)}">${escapeHtml(status)}</button>`).join("")}
      ${(activeStatus !== "all" || activeVersionId) ? `<button type="button" data-application-filter-status="all" data-application-filter-version="">清除筛选</button>` : ""}
    </div>
    <div class="application-table" role="table" aria-label="投递进度明细">
      <div class="application-table-head" role="row">
        <span>公司 / 岗位</span>
        <span>进度</span>
        <span>状态 / 下一步</span>
        <span>操作</span>
      </div>
      ${apps.length ? apps.map((app) => {
        const statusClass = getApplicationStatusClass(app.status);
        const active = app.id === selectedApplicationId ? " active" : "";
        return `
          <article class="application-table-row${active}" data-application-id="${escapeAttr(app.id)}" role="row">
            <div class="application-table-company">
              ${getCompanyLogoMarkup(app.company)}
              <div class="application-table-company-main">
                <strong>${escapeHtml(app.company)} - ${escapeHtml(app.role)}</strong>
                <label class="application-version-inline">
                  <span>版本</span>
                  <select data-application-field="versionId" title="绑定简历版本">
                    <option value="">未绑定</option>
                    ${versionOptions}
                  </select>
                </label>
              </div>
            </div>
            ${active ? `<div class="application-progress-spacer" aria-hidden="true"></div>` : renderApplicationProgress(app)}
              <div class="application-state-cell">
                <span class="application-current-status status-select ${statusClass}">${escapeHtml(app.status)}</span>
                ${active ? `
                  <div class="application-next-row">
                    <button class="application-next-trigger" type="button" data-application-schedule-open="${escapeAttr(app.id)}" title="选择下一阶段并安排时间" aria-label="设置下一步">
                      <span>设置下一步</span>
                    </button>
                    ${renderApplicationDatePicker(app)}
                  </div>
                ` : ""}
              </div>
            <div class="application-row-actions">
              <button class="version-action-btn application-action-btn resume" type="button" data-application-action="version" data-application-id="${escapeAttr(app.id)}" title="查看绑定简历">简历</button>
              <button class="version-action-btn application-action-btn danger" type="button" data-application-action="delete" data-application-id="${escapeAttr(app.id)}" title="删除这条投递记录">删除</button>
            </div>
            ${active ? renderApplicationTimeline(app) : ""}
          </article>
        `;
      }).join("") : `<div class="empty-workbench"><div><strong>暂无投递记录</strong><span>点击右侧“新增投递”开始记录岗位进展。</span></div></div>`}
    </div>
  `;
  apps.forEach((app) => {
    const row = refs.versionPanel.querySelector(`[data-application-id="${CSS.escape(app.id)}"]`);
    const versionSelect = row?.querySelector('select[data-application-field="versionId"]');
    if (versionSelect) versionSelect.value = app.versionId || "";
  });
  positionApplicationSchedulePopover();
}

function renderActivityPanel() {
  if (!refs.activityPanel) return;
  const candidateId = workbenchState.selectedCandidateId;
  const activities = workbenchState.activities
    .filter((item) => item.candidateId === candidateId && item.label !== "跟进投递")
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 4);
  refs.activityPanel.innerHTML = `
    <div class="activity-title">版本活动</div>
    <div class="activity-list">
      ${activities.map((item) => `<span class="activity-pill"><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail || formatWorkbenchTime(item.createdAt))}</small></span>`).join("") || `<span class="activity-pill">暂无活动</span>`}
    </div>
  `;
}

function renderApplications() {
  const candidate = getWorkbenchCandidate();
  const apps = getWorkbenchApplications(candidate?.id);
  if (refs.applicationSummary) refs.applicationSummary.textContent = candidate ? candidate.name : "当前候选人";
  const statuses = ["待投递", "已投递", "笔试/测评", "面试中", "Offer", "已拒绝"];
  const getStatusCount = (status) => apps.filter((item) => getApplicationCategory(item) === status).length;
  if (refs.pipelineStrip) {
    refs.pipelineStrip.innerHTML = `
      <div class="pipeline-metrics">
        ${statuses.map((status) => {
      const count = getStatusCount(status);
      const active = workbenchState.activeTab === "applications" && workbenchState.applicationFilterStatus === status ? " active" : "";
      return `<button class="pipeline-card${active}" type="button" data-pipeline-status="${escapeAttr(status)}"><strong>${count}</strong><span>${escapeHtml(status)}</span></button>`;
    }).join("")}
      </div>
      <div class="pipeline-bars" aria-hidden="true">
        ${statuses.map((status) => {
          const count = getStatusCount(status);
          const width = apps.length ? Math.max(7, Math.round((count / apps.length) * 100)) : 7;
          return `<span class="pipeline-bar ${getApplicationStatusClass(status)}" style="--bar-width:${width}%"></span>`;
        }).join("")}
      </div>
    `;
  }
  if (refs.applicationList) {
    const versionById = new Map(workbenchState.versions.map((item) => [item.id, item]));
    refs.applicationList.innerHTML = apps.length ? `
      <div class="application-board" role="table" aria-label="投递进度">
        <div class="application-list-head" role="row">
          <span>投递岗位 / 公司</span>
          <span>状态</span>
        </div>
        <div class="application-list-body">
          ${apps.map((app) => {
      const version = versionById.get(app.versionId);
      const statusClass = getApplicationStatusClass(app.status);
      const active = app.id === workbenchState.selectedApplicationId ? " active" : "";
      return `
        <button class="application-row${active}" type="button" data-application-id="${escapeAttr(app.id)}">
          <div class="application-company-cell">
            ${getCompanyLogoMarkup(app.company)}
            <span>
              <strong class="application-company-title">${escapeHtml(app.company)} - ${escapeHtml(app.role)}</strong>
              <small>${escapeHtml(app.company === "招商银行" ? "深圳 · 校招" : "北京 · 实习")}</small>
            </span>
          </div>
          <span class="status-chip ${statusClass}">${escapeHtml(app.status)}</span>
        </button>
      `;
    }).join("")}
        </div>
        <div class="application-list-footer">
          <button class="primary-mini-btn" type="button" data-application-footer="add">+ 新增投递</button>
          <button class="ghost-mini-btn" type="button" data-application-footer="all">查看全部</button>
        </div>
      </div>
    ` : `<div class="empty-workbench"><div><strong>暂无投递记录</strong><span>点击新增投递记录岗位进展。</span></div></div>`;
  }
  if (refs.todayReminder) {
    const reminders = apps
      .filter((item) => {
        const current = globalThis.ApplicationTimelineModel?.current(item);
        return Boolean(current?.at || current?.note);
      })
      .sort((a, b) => {
        const dateA = new Date(globalThis.ApplicationTimelineModel?.current(a)?.at || 8640000000000000).getTime();
        const dateB = new Date(globalThis.ApplicationTimelineModel?.current(b)?.at || 8640000000000000).getTime();
        return dateA - dateB;
      });
    refs.todayReminder.innerHTML = `
      <div class="reminder-head">
        <span class="reminder-bell" aria-hidden="true"></span>
        <strong>今日提醒</strong>
      </div>
      <div class="reminder-list">
        ${reminders.length ? reminders.map((app, index) => `
          <button class="reminder-item" type="button" data-application-id="${escapeAttr(app.id)}">
            <span class="reminder-dot dot-${index % 4}" aria-hidden="true"></span>
            <strong>${escapeHtml(getReminderDateLabel(app))}</strong>
            <span>${escapeHtml(getReminderText(app))}</span>
          </button>
        `).join("") : `<span class="reminder-empty">暂无明确截止事项，可以补充下一步时间。</span>`}
      </div>
      <button class="reminder-more" type="button" data-application-footer="all">查看全部提醒</button>
    `;
  }
}

function renderWorkbenchTabs() {
  document.querySelectorAll("[data-workbench-tab]").forEach((button) => {
    const active = button.dataset.workbenchTab === workbenchState.activeTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll("[data-candidate-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.candidateFilter === workbenchState.candidateFilter);
  });
}

function renderWorkbench() {
  if (!refs.dashboardShell || !workbenchState) return;
  ensureWorkbenchDefaults();
  renderWorkbenchTabs();
  renderCandidateList();
  renderCandidateOverview();
  renderVersionPanel();
  renderActivityPanel();
  renderApplications();
  renderWorkbenchSearch();
  persistWorkbench();
  requestAnimationFrame(syncTimeWheelColumns);
}

function addWorkbenchActivity(label, detail = "") {
  const candidate = getWorkbenchCandidate();
  if (!candidate) return;
  workbenchState.activities.unshift({
    id: makeWorkbenchId("act"),
    candidateId: candidate.id,
    label,
    detail,
    createdAt: new Date().toISOString()
  });
  workbenchState.activities = workbenchState.activities.slice(0, 80);
}

function createResumeVersionFromCurrent(candidateId, name = "") {
  const candidate = workbenchState.candidates.find((item) => item.id === candidateId);
  const snapshot = cloneEditorState(state);
  if (candidate) {
    snapshot.profile.name = candidate.name;
  }
  const now = new Date().toISOString();
  const version = {
    id: makeWorkbenchId("version"),
    candidateId,
    name: name || `${candidate?.name || "候选人"}-新简历`,
    targetRole: getProfileRole(snapshot),
    source: "手动创建",
    pageCount: 1,
    status: "待检查",
    createdAt: now,
    updatedAt: now,
    snapshot
  };
  workbenchState.versions.unshift(version);
  workbenchState.selectedVersionId = version.id;
  if (candidate) candidate.updatedAt = now;
  addWorkbenchActivity("新建简历", version.name);
  return version;
}

async function handleVersionAction(action, versionId) {
  const version = workbenchState.versions.find((item) => item.id === versionId);
  if (!version) return;
  if (action === "open") {
    openWorkbenchEditor(versionId);
    return;
  }
  if (action === "apps") {
    workbenchState.selectedVersionId = version.id;
    setWorkbenchTab("applications", { status: "all", versionId: version.id, applicationId: "" });
    return;
  }
  if (action === "copy") {
    const copy = cloneEditorState(version.snapshot || state);
    const now = new Date().toISOString();
    const next = {
      ...version,
      id: makeWorkbenchId("version"),
      name: `${version.name} 副本`,
      source: "复制版本",
      status: "待检查",
      createdAt: now,
      updatedAt: now,
      snapshot: copy
    };
    workbenchState.versions.unshift(next);
    workbenchState.selectedVersionId = next.id;
    addWorkbenchActivity("复制版本", next.name);
  }
  if (action === "rename") {
    const result = await showWorkbenchModal({
      title: "重命名简历",
      description: "修改后会同步显示在版本列表和投递绑定里。",
      confirmText: "保存",
      fields: [
        { name: "name", label: "简历名称", value: version.name, placeholder: "例如：高子强-数据分析实习", required: true }
      ]
    });
    const nextName = String(result?.name || "").trim();
    if (!nextName) return;
    version.name = nextName;
    version.updatedAt = new Date().toISOString();
    addWorkbenchActivity("重命名", version.name);
  }
  if (action === "delete") {
    const candidateVersions = getWorkbenchVersions(version.candidateId);
    if (candidateVersions.length <= 1) {
      await showWorkbenchNotice("无法删除", "至少需要保留一个简历版本。");
      return;
    }
    const confirmed = await showWorkbenchConfirm(
      "删除简历版本",
      `确认删除「${version.name}」？相关投递记录会解除绑定。`,
      { confirmText: "删除", danger: true }
    );
    if (!confirmed) return;
    workbenchState.versions = workbenchState.versions.filter((item) => item.id !== version.id);
    workbenchState.applications.forEach((app) => {
      if (app.versionId === version.id) app.versionId = "";
    });
    workbenchState.selectedVersionId = getWorkbenchVersions(version.candidateId)[0]?.id || "";
    addWorkbenchActivity("删除版本", version.name);
  }
  renderWorkbench();
}

function touchCandidateUpdated(candidateId) {
  const candidate = workbenchState.candidates.find((item) => item.id === candidateId);
  if (candidate) candidate.updatedAt = new Date().toISOString();
}

function handleApplicationFieldChange(target) {
  const row = target.closest("[data-application-id]");
  if (!row) return;
  const app = workbenchState.applications.find((item) => item.id === row.dataset.applicationId);
  if (!app) return;
  const field = target.dataset.applicationField;
  if (!field) return;
  app[field] = target.value;
  if (field === "status") {
    syncApplicationTimeline(app);
  }
  app.updatedAt = new Date().toISOString();
  touchCandidateUpdated(app.candidateId);
  const detail = field === "status" ? `${app.company}：${app.status}` : app.company;
  addWorkbenchActivity(field === "status" ? "更新投递状态" : "更新投递记录", detail);
  renderWorkbench();
}

function setApplicationNextFromDate(app, date, activityLabel = "更新投递时间", options = {}) {
  if (!app || !date || !Number.isFinite(date.getTime())) return;
  const current = globalThis.ApplicationTimelineModel?.current(app);
  if (current) {
    current.at = date.toISOString();
    current.note = "";
    globalThis.ApplicationTimelineModel.normalize(app);
  } else {
    app.next = formatApplicationPickedTime(date.toISOString());
  }
  app.updatedAt = new Date().toISOString();
  touchCandidateUpdated(app.candidateId);
  if (!options.silent) addWorkbenchActivity(activityLabel, `${app.company}：${app.next}`);
}

function openApplicationSchedule(appId) {
  const app = workbenchState.applications.find((item) => item.id === appId);
  if (!app) return;
  if (applicationDatePickerState?.appId === appId) {
    applicationDatePickerState = null;
    renderWorkbench();
    return;
  }
  const currentStage = globalThis.ApplicationTimelineModel?.current(app);
  const date = currentStage?.at ? new Date(currentStage.at) : parseApplicationNextDate(app.next);
  workbenchState.selectedApplicationId = app.id;
  applicationDatePickerState = {
    appId: app.id,
    stage: "",
    date: date.toISOString(),
    month: `${date.getFullYear()}-${padDateUnit(date.getMonth() + 1)}`,
    mode: "date"
  };
  renderWorkbench();
}

function handleApplicationDatePickerClick(target) {
  const row = target.closest("[data-application-id]");
  const app = row ? workbenchState.applications.find((item) => item.id === row.dataset.applicationId) : null;
  if (!app) return;
  const current = getApplicationPickerDate(app);
  const action = target.dataset.datePickerAction;
  if (action) {
    if (action === "cancel") {
      applicationDatePickerState = null;
      renderWorkbench();
      return;
    }
    if (action === "save") {
      const selectedStage = String(applicationDatePickerState?.stage || "").trim();
      const nextStage = selectedStage === "__custom__"
        ? String(applicationDatePickerState?.customStage || "").trim()
        : selectedStage;
      if (!nextStage) return;
      globalThis.ApplicationTimelineModel.advance(app, nextStage, current.toISOString());
      app.updatedAt = new Date().toISOString();
      touchCandidateUpdated(app.candidateId);
      addWorkbenchActivity("安排下一步", `${app.company}：${nextStage} · ${app.next}`);
      applicationDatePickerState = null;
      renderWorkbench();
      return;
    }
    if (action === "date" || action === "time") {
      applicationDatePickerState = {
        ...(applicationDatePickerState || {}),
        appId: app.id,
        date: current.toISOString(),
        month: `${current.getFullYear()}-${padDateUnit(current.getMonth() + 1)}`,
        mode: action
      };
      renderWorkbench();
      return;
    }
    const monthBase = applicationDatePickerState?.month
      ? new Date(`${applicationDatePickerState.month}-01T00:00:00`)
      : new Date(current.getFullYear(), current.getMonth(), 1);
    const deltaMap = { "prev-year": -12, "prev-month": -1, "next-month": 1, "next-year": 12 };
    const delta = deltaMap[action] || 0;
    monthBase.setMonth(monthBase.getMonth() + delta);
    applicationDatePickerState = {
      ...(applicationDatePickerState || {}),
      appId: app.id,
      date: current.toISOString(),
      month: `${monthBase.getFullYear()}-${padDateUnit(monthBase.getMonth() + 1)}`,
      mode: applicationDatePickerState?.mode || "date"
    };
    renderWorkbench();
    return;
  }
  if (target.dataset.datePickerDate) {
    const [year, month, day] = target.dataset.datePickerDate.split("-").map(Number);
    const nextDate = new Date(year, month - 1, day, current.getHours(), current.getMinutes(), 0);
    applicationDatePickerState = {
      ...(applicationDatePickerState || {}),
      appId: app.id,
      date: nextDate.toISOString(),
      month: `${year}-${padDateUnit(month)}`,
      mode: "date"
    };
    renderWorkbench();
    return;
  }
  if (target.dataset.datePickerTime) {
    const nextDate = new Date(current);
    const value = Number(target.dataset.datePickerValue);
    if (target.dataset.datePickerTime === "hour") nextDate.setHours(value);
    if (target.dataset.datePickerTime === "minute") nextDate.setMinutes(value);
    if (target.dataset.datePickerTime === "second") nextDate.setSeconds(value);
    applicationDatePickerState = {
      ...(applicationDatePickerState || {}),
      appId: app.id,
      date: nextDate.toISOString(),
      month: `${nextDate.getFullYear()}-${padDateUnit(nextDate.getMonth() + 1)}`,
      mode: "time"
    };
    renderWorkbench();
  }
}

function syncTimeWheelColumns() {
  document.querySelectorAll(".time-wheel-column").forEach((column) => {
    const index = Number(column.dataset.activeIndex || 0);
    const itemHeight = column.querySelector("button")?.offsetHeight || 32;
    column.scrollTop = Math.max(0, index * itemHeight);
  });
}

function handleApplicationTimeWheelScroll(column) {
  window.clearTimeout(Number(column.dataset.scrollTimer || 0));
  const timer = window.setTimeout(() => {
    const row = column.closest("[data-application-id]");
    const app = row ? workbenchState.applications.find((item) => item.id === row.dataset.applicationId) : null;
    if (!app) return;
    const current = getApplicationPickerDate(app);
    const itemHeight = column.querySelector("button")?.offsetHeight || 32;
    const maxValue = column.dataset.timeWheelColumn === "hour" ? 23 : 59;
    const value = Math.max(0, Math.min(maxValue, Math.round(column.scrollTop / itemHeight)));
    const nextDate = new Date(current);
    if (column.dataset.timeWheelColumn === "hour") nextDate.setHours(value);
    if (column.dataset.timeWheelColumn === "minute") nextDate.setMinutes(value);
    if (column.dataset.timeWheelColumn === "second") nextDate.setSeconds(value);
    applicationDatePickerState = {
      ...(applicationDatePickerState || {}),
      appId: app.id,
      date: nextDate.toISOString(),
      month: `${nextDate.getFullYear()}-${padDateUnit(nextDate.getMonth() + 1)}`,
      mode: "time"
    };
    const timeFoot = row.querySelector('[data-date-picker-action="time"]');
    if (timeFoot) timeFoot.textContent = `◷ ${formatDatePickerTime(nextDate)}:${padDateUnit(nextDate.getSeconds())}`;
    const dateFoot = row.querySelector('[data-date-picker-action="date"]');
    if (dateFoot) dateFoot.textContent = `▦ ${formatDatePickerDate(nextDate)}`;
    column.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("active", Number(button.dataset.datePickerValue) === value);
    });
    column.dataset.activeIndex = String(value);
  }, 140);
  column.dataset.scrollTimer = String(timer);
}

async function handleApplicationAction(action, appId) {
  const app = workbenchState.applications.find((item) => item.id === appId);
  if (!app) return;
  workbenchState.selectedApplicationId = app.id;
  if (action === "version") {
    if (app.versionId) {
      workbenchState.selectedVersionId = app.versionId;
      workbenchState.activeTab = "resumes";
      workbenchState.applicationFilterStatus = "all";
      workbenchState.applicationFilterVersionId = "";
    }
  }
  if (action === "delete") {
    const confirmed = await showWorkbenchConfirm(
      "删除投递记录",
      `确认删除「${app.company} · ${app.role}」这条投递记录？`,
      { confirmText: "删除", danger: true }
    );
    if (!confirmed) return;
    workbenchState.applications = workbenchState.applications.filter((item) => item.id !== app.id);
    touchCandidateUpdated(app.candidateId);
    addWorkbenchActivity("删除投递", `${app.company} · ${app.role}`);
  }
  renderWorkbench();
}

function bindWorkbench() {
  refs.workbenchSearchInput?.addEventListener("input", (event) => {
    workbenchState.search = event.target.value;
    renderCandidateList();
    renderWorkbenchSearch();
  });
  refs.workbenchSearchInput?.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      const firstResult = refs.workbenchSearchResults?.querySelector("[data-search-kind]");
      if (!firstResult) return;
      event.preventDefault();
      firstResult.focus();
      return;
    }
    if (event.key === "Escape") {
      workbenchState.search = "";
      event.currentTarget.value = "";
      renderCandidateList();
      renderWorkbenchSearch();
    }
  });
  refs.workbenchSearchInput?.addEventListener("focus", () => renderWorkbenchSearch());
  refs.workbenchSearchClear?.addEventListener("click", () => {
    workbenchState.search = "";
    refs.workbenchSearchInput.value = "";
    refs.workbenchSearchInput.focus();
    renderCandidateList();
    renderWorkbenchSearch();
  });
  refs.workbenchSearchResults?.addEventListener("click", (event) => {
    const result = event.target.closest("[data-search-kind]");
    if (!result) return;
    selectWorkbenchCandidate(result.dataset.searchCandidateId);
    if (result.dataset.searchKind === "version") {
      workbenchState.selectedVersionId = result.dataset.searchId;
      workbenchState.activeTab = "resumes";
    } else if (result.dataset.searchKind === "application") {
      workbenchState.selectedApplicationId = result.dataset.searchId;
      workbenchState.activeTab = "applications";
    }
    workbenchState.search = "";
    refs.workbenchSearchInput.value = "";
    renderWorkbench();
  });
  refs.workbenchSearchResults?.addEventListener("keydown", (event) => {
    const current = event.target.closest("[data-search-kind]");
    if (!current) return;
    const results = [...refs.workbenchSearchResults.querySelectorAll("[data-search-kind]")];
    const currentIndex = results.indexOf(current);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 1 : -1;
      results[(currentIndex + offset + results.length) % results.length]?.focus();
    } else if (event.key === "Escape") {
      workbenchState.search = "";
      refs.workbenchSearchInput.value = "";
      renderCandidateList();
      renderWorkbenchSearch();
      refs.workbenchSearchInput.focus();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".dashboard-search")) return;
    if (refs.workbenchSearchResults) refs.workbenchSearchResults.hidden = true;
  });
  refs.candidateFilters?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-candidate-filter]");
    if (!button) return;
    workbenchState.candidateFilter = button.dataset.candidateFilter;
    renderWorkbench();
  });
  refs.dashboardShell?.addEventListener("click", async (event) => {
    const filterButton = event.target.closest("[data-workbench-filter]");
    if (!filterButton) return;
    const type = filterButton.dataset.workbenchFilter;
    await showWorkbenchNotice(
      type === "trash" ? "回收站" : "归档",
      type === "trash"
        ? "回收站用于后续恢复误删候选人。当前版本先保留入口，删除操作会二次确认。"
        : "归档用于收起已完成候选人。当前版本先保留入口，候选人排序和筛选已可直接使用。"
    );
  });
  refs.candidateList?.addEventListener("click", async (event) => {
    const actionButton = event.target.closest("[data-candidate-action]");
    if (actionButton?.dataset.candidateAction === "delete") {
      const row = actionButton.closest("[data-candidate-id]");
      if (!row) return;
      await deleteWorkbenchCandidate(row.dataset.candidateId);
      renderWorkbench();
      return;
    }
    const row = event.target.closest("[data-candidate-id]");
    if (!row) return;
    selectWorkbenchCandidate(row.dataset.candidateId);
    renderWorkbench();
  });
  refs.candidateList?.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    if (event.target.closest("button")) return;
    const row = event.target.closest("[data-candidate-id]");
    if (!row) return;
    event.preventDefault();
    selectWorkbenchCandidate(row.dataset.candidateId);
    renderWorkbench();
  });
  refs.candidateList?.addEventListener("dragstart", (event) => {
    const row = event.target.closest("[data-candidate-id]");
    if (!row || workbenchState.candidateFilter === "recent") {
      event.preventDefault();
      return;
    }
    candidateDragId = row.dataset.candidateId;
    row.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", candidateDragId);
  });
  refs.candidateList?.addEventListener("dragover", (event) => {
    if (!candidateDragId) return;
    const row = event.target.closest("[data-candidate-id]");
    if (!row || row.dataset.candidateId === candidateDragId) return;
    event.preventDefault();
    row.classList.add("drag-over");
    const rect = row.getBoundingClientRect();
    row.classList.toggle("drag-after", event.clientY > rect.top + rect.height / 2);
  });
  refs.candidateList?.addEventListener("dragleave", (event) => {
    const row = event.target.closest("[data-candidate-id]");
    if (!row) return;
    row.classList.remove("drag-over", "drag-after");
  });
  refs.candidateList?.addEventListener("drop", (event) => {
    if (!candidateDragId) return;
    const row = event.target.closest("[data-candidate-id]");
    if (!row || row.dataset.candidateId === candidateDragId) return;
    event.preventDefault();
    const rect = row.getBoundingClientRect();
    const changed = reorderCandidate(candidateDragId, row.dataset.candidateId, event.clientY > rect.top + rect.height / 2);
    candidateDragId = "";
    refs.candidateList.querySelectorAll(".candidate-row").forEach((item) => item.classList.remove("dragging", "drag-over", "drag-after"));
    if (changed) {
      workbenchState.candidateFilter = "all";
      addWorkbenchActivity("调整候选人排序", "已保存");
      renderWorkbench();
    }
  });
  refs.candidateList?.addEventListener("dragend", () => {
    candidateDragId = "";
    refs.candidateList.querySelectorAll(".candidate-row").forEach((item) => item.classList.remove("dragging", "drag-over", "drag-after"));
  });
  refs.candidateOverview?.addEventListener("click", async (event) => {
    const profileButton = event.target.closest("[data-candidate-profile]");
    if (profileButton) {
      const candidate = getWorkbenchCandidate();
      if (!candidate) return;
      const result = await showWorkbenchModal({
        title: "编辑候选人资料",
        description: "姓名与学校会同步到该候选人的全部简历版本。备注仅用于内部检索。",
        confirmText: "保存",
        fields: [
          { name: "name", label: "姓名", value: candidate.name || "", required: true },
          { name: "school", label: "学校", value: candidate.school || "", placeholder: "例如：中南财经政法大学" },
          { name: "note", label: "备注", value: candidate.note || "", placeholder: "例如：数据分析方向", type: "textarea", rows: 3 }
        ]
      });
      if (!result) return;
      const nextName = String(result.name || "").trim();
      if (!nextName) return;
      const nextSchool = String(result.school || "").trim() || "学校待补充";
      candidate.name = nextName;
      candidate.school = nextSchool;
      candidate.note = String(result.note || "").trim();
      candidate.updatedAt = new Date().toISOString();
      getWorkbenchVersions(candidate.id).forEach((version) => {
        if (!version.snapshot) return;
        version.snapshot.profile = version.snapshot.profile || {};
        version.snapshot.profile.name = nextName;
        const education = version.snapshot.sections?.find((section) => section.id === "education");
        if (education?.items?.[0]) {
          education.items[0].fields = education.items[0].fields || {};
          education.items[0].fields.school = nextSchool;
        }
      });
      if (workbenchState.selectedCandidateId === candidate.id) {
        state.profile.name = nextName;
        const education = state.sections?.find((section) => section.id === "education");
        if (education?.items?.[0]) {
          education.items[0].fields = education.items[0].fields || {};
          education.items[0].fields.school = nextSchool;
        }
        saveState();
      }
      addWorkbenchActivity("更新候选人资料", `${nextName} · ${nextSchool}`);
      renderWorkbench();
      return;
    }
    const button = event.target.closest("[data-overview-jump]");
    if (!button) return;
    const target = button.dataset.overviewJump;
    if (target === "resumes") {
      setWorkbenchTab("resumes", { status: "all", versionId: "", applicationId: "" });
      return;
    }
    const status = button.dataset.status || "all";
    setWorkbenchTab("applications", { status, versionId: "", applicationId: "" });
  });
  document.querySelectorAll("[data-workbench-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      setWorkbenchTab(button.dataset.workbenchTab, button.dataset.workbenchTab === "applications" ? {} : { status: "all", versionId: "", applicationId: "" });
    });
  });
  document.addEventListener("click", (event) => {
    if (!applicationDatePickerState) return;
    if (event.target.closest("[data-date-picker-root], [data-application-schedule-open]")) return;
    applicationDatePickerState = null;
    renderWorkbench();
  }, true);
  refs.versionPanel?.addEventListener("click", async (event) => {
    const toolbarButton = event.target.closest("[data-toolbar-action]");
    if (toolbarButton) {
      const candidate = getWorkbenchCandidate();
      if (!candidate) return;
      if (toolbarButton.dataset.toolbarAction === "new-version") {
        createResumeVersionFromCurrent(candidate.id, `${candidate.name}-新简历`);
        renderWorkbench();
      }
      if (toolbarButton.dataset.toolbarAction === "batch") {
        const confirmed = await showWorkbenchConfirm(
          "批量检查版本",
          "将当前候选人的所有简历版本标记为待检查，方便后续逐个确认页数和一页适配状态。",
          { confirmText: "标记待检查" }
        );
        if (confirmed) {
          getWorkbenchVersions(candidate.id).forEach((version) => {
            version.status = "待检查";
            version.updatedAt = new Date().toISOString();
          });
          addWorkbenchActivity("批量操作", "所有版本已标记为待检查");
          renderWorkbench();
        }
      }
      return;
    }
    const filterButton = event.target.closest("[data-application-filter-status]");
    if (filterButton) {
      setWorkbenchTab("applications", {
        status: filterButton.dataset.applicationFilterStatus || "all",
        versionId: filterButton.hasAttribute("data-application-filter-version") ? filterButton.dataset.applicationFilterVersion : (workbenchState.applicationFilterVersionId || ""),
        applicationId: ""
      });
      return;
    }
    const scheduleOpenButton = event.target.closest("[data-application-schedule-open]");
    if (scheduleOpenButton) {
      openApplicationSchedule(scheduleOpenButton.dataset.applicationScheduleOpen);
      return;
    }
    const datePickerTarget = event.target.closest("[data-date-picker-action], [data-date-picker-date], [data-date-picker-time]");
    if (datePickerTarget) {
      handleApplicationDatePickerClick(datePickerTarget);
      return;
    }
    const applicationActionButton = event.target.closest("[data-application-action]");
    if (applicationActionButton) {
      await handleApplicationAction(applicationActionButton.dataset.applicationAction, applicationActionButton.dataset.applicationId);
      return;
    }
    const actionButton = event.target.closest("[data-version-action]");
    if (actionButton) {
      await handleVersionAction(actionButton.dataset.versionAction, actionButton.dataset.versionId);
      return;
    }
    const row = event.target.closest("[data-version-id]");
    const appRow = event.target.closest("[data-application-id]");
    if (appRow && !event.target.closest("select, input, button")) {
      workbenchState.selectedApplicationId = appRow.dataset.applicationId;
      renderWorkbench();
      return;
    }
    if (!row) return;
    workbenchState.selectedVersionId = row.dataset.versionId;
    workbenchState.applicationFilterVersionId = "";
    renderWorkbench();
  });
  refs.pipelineStrip?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-pipeline-status]");
    if (!button) return;
    setWorkbenchTab("applications", { status: button.dataset.pipelineStatus, versionId: "", applicationId: "" });
  });
  refs.applicationList?.addEventListener("click", (event) => {
    const footerButton = event.target.closest("[data-application-footer]");
    if (footerButton) {
      if (footerButton.dataset.applicationFooter === "add") {
        refs.addApplicationBtn?.click();
        return;
      }
      setWorkbenchTab("applications", { status: "all", versionId: "", applicationId: "" });
      return;
    }
    const row = event.target.closest("[data-application-id]");
    if (!row) return;
    setWorkbenchTab("applications", { status: "all", versionId: "", applicationId: row.dataset.applicationId });
  });
  refs.todayReminder?.addEventListener("click", (event) => {
    const footerButton = event.target.closest("[data-application-footer]");
    if (footerButton) {
      setWorkbenchTab("applications", { status: "all", versionId: "", applicationId: "" });
      return;
    }
    const row = event.target.closest("[data-application-id]");
    if (!row) return;
    setWorkbenchTab("applications", { status: "all", versionId: "", applicationId: row.dataset.applicationId });
  });
  refs.versionPanel?.addEventListener("change", (event) => {
    const nextStageField = event.target.closest("[data-application-next-stage]");
    if (nextStageField) {
      if (!applicationDatePickerState) return;
      applicationDatePickerState = { ...applicationDatePickerState, stage: nextStageField.value, customStage: "" };
      renderWorkbench();
      return;
    }
    const field = event.target.closest("[data-application-field]");
    if (!field) return;
    if (field.tagName === "INPUT") return;
    handleApplicationFieldChange(field);
  });
  refs.versionPanel?.addEventListener("input", (event) => {
    const customStageField = event.target.closest("[data-application-custom-stage]");
    if (!customStageField || !applicationDatePickerState) return;
    applicationDatePickerState.customStage = customStageField.value;
  });
  refs.versionPanel?.addEventListener("scroll", (event) => {
    const column = event.target.closest?.(".time-wheel-column");
    if (!column) {
      if (applicationDatePickerState) positionApplicationSchedulePopover();
      return;
    }
    handleApplicationTimeWheelScroll(column);
  }, true);
  window.addEventListener("resize", positionApplicationSchedulePopover);
  refs.newCandidateBtn?.addEventListener("click", async () => {
    const result = await showWorkbenchModal({
      title: "新建候选人",
      description: "创建后会自动生成一份基础简历版本。",
      confirmText: "创建",
      fields: [
        { name: "name", label: "候选人姓名", placeholder: "例如：高子强", required: true },
        { name: "school", label: "学校", placeholder: "例如：中南财经政法大学" },
        { name: "note", label: "方向备注", placeholder: "例如：数据分析方向" }
      ]
    });
    const name = String(result?.name || "").trim();
    if (!name) return;
    const now = new Date().toISOString();
    const candidate = {
      id: makeWorkbenchId("candidate"),
      name,
      school: String(result.school || "").trim() || "学校待补充",
      note: String(result.note || "").trim() || "新候选人",
      status: "todo",
      createdAt: now,
      updatedAt: now
    };
    workbenchState.candidates.unshift(candidate);
    workbenchState.selectedCandidateId = candidate.id;
    createResumeVersionFromCurrent(candidate.id, `${candidate.name}-基础简历`);
    renderWorkbench();
  });
  refs.newResumeVersionBtn?.addEventListener("click", () => {
    const candidate = getWorkbenchCandidate();
    if (!candidate) return;
    createResumeVersionFromCurrent(candidate.id, `${candidate.name}-新简历`);
    renderWorkbench();
  });
  refs.saveHistoryBtn?.addEventListener("click", () => archiveCurrentMarkdownHistory());
  refs.openHistoryFolderBtn?.addEventListener("click", () => openResumeHistoryFolder());
  refs.addApplicationBtn?.addEventListener("click", async () => {
    const candidate = getWorkbenchCandidate();
    if (!candidate) return;
    const result = await showWorkbenchModal({
      title: "新增投递",
      description: "记录岗位后会出现在右侧投递进度和当前候选人的进度页。",
      confirmText: "添加",
      fields: [
        { name: "company", label: "投递公司", placeholder: "例如：腾讯", required: true },
        { name: "role", label: "岗位名称", value: "数据分析实习", placeholder: "例如：数据分析实习", required: true }
      ]
    });
    const company = String(result?.company || "").trim();
    if (!company) return;
    const role = String(result.role || "").trim();
    const version = getWorkbenchVersions(candidate.id)[0];
    const application = {
      id: makeWorkbenchId("app"),
      candidateId: candidate.id,
      company: company.trim(),
      role: (role || "待补充岗位").trim(),
      versionId: version?.id || "",
      status: "待投递",
      next: "待记录",
      updatedAt: new Date().toISOString()
    };
    application.timeline = getApplicationTimeline(application);
    workbenchState.applications.unshift(application);
    addWorkbenchActivity("新增投递", company.trim());
    renderWorkbench();
  });
  refs.workbenchImportBtn?.addEventListener("click", async () => {
    await showImportPdfTutorial();
    $("#importPdfInput")?.click();
  });
  refs.backToWorkbenchBtn?.addEventListener("click", returnToWorkbench);
}

function shortenFileName(name, limit = 10) {
  const text = String(name || "").trim();
  if (!text) return "未上传";
  return text.length > limit ? `${text.slice(0, limit)}......` : text;
}

function ensureDataList(id, values = []) {
  let list = document.getElementById(id);
  if (!list) {
    list = document.createElement("datalist");
    list.id = id;
    document.body.appendChild(list);
  }
  list.innerHTML = values.map((value) => `<option value="${escapeAttr(value)}"></option>`).join("");
}

function replaceWithEditableInput(id, listId, placeholder = "") {
  const node = document.getElementById(id);
  if (!node || node.tagName === "INPUT") {
    if (node && listId) node.setAttribute("list", listId);
    if (node && placeholder) node.setAttribute("placeholder", placeholder);
    return;
  }
  const input = document.createElement("input");
  input.id = id;
  input.value = node.value || "";
  if (listId) input.setAttribute("list", listId);
  if (placeholder) input.setAttribute("placeholder", placeholder);
  node.replaceWith(input);
}

function ensureBirthMonthControl() {
  const birthInput = document.getElementById("birthInput");
  if (!birthInput || birthInput.closest(".profile-month-control")) return;
  const wrapper = document.createElement("div");
  wrapper.className = "profile-month-control";
  wrapper.id = "birthMonthControl";
  wrapper.innerHTML = `
    <input id="birthInput" class="profile-month-input" readonly placeholder="选择年月" />
    <div class="profile-month-popover" id="birthMonthPopover">
      <div class="profile-month-head">
        <button type="button" data-birth-year-shift="-1">‹</button>
        <button type="button" id="birthMonthYearLabel" class="birth-year-trigger" data-birth-year-toggle="true"></button>
        <button type="button" data-birth-year-shift="1">›</button>
      </div>
      <div class="profile-month-grid" id="birthMonthGrid"></div>
    </div>
  `;
  birthInput.replaceWith(wrapper);
}

function getBirthYearPageStart(baseYear) {
  const safeYear = Number(baseYear || new Date().getFullYear());
  return safeYear - (safeYear % 10);
}

function renderBirthMonthPopover() {
  const year = Number(state.profileMonthPickerYear || new Date().getFullYear());
  const mode = state.birthMonthPickerMode === "year" ? "year" : "month";
  const label = document.getElementById("birthMonthYearLabel");
  const grid = document.getElementById("birthMonthGrid");
  if (!label || !grid) return;
  if (mode === "year") {
    const pageStart = Number.isFinite(Number(state.birthYearPageStart))
      ? Number(state.birthYearPageStart)
      : getBirthYearPageStart(year);
    state.birthYearPageStart = pageStart;
    label.textContent = `${pageStart} - ${pageStart + 9}`;
    label.classList.add("year-mode");
    grid.classList.add("year-grid");
    grid.innerHTML = Array.from({ length: 10 }, (_, index) => {
      const itemYear = pageStart + index;
      const active = itemYear === year ? "active" : "";
      return `<button type="button" class="${active}" data-birth-year="${itemYear}">${itemYear}</button>`;
    }).join("");
    return;
  }
  label.textContent = `${year}年`;
  label.classList.remove("year-mode");
  grid.classList.remove("year-grid");
  const selected = normalizeMonthValue(state.profile.birth);
  grid.innerHTML = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const value = `${year}-${String(month).padStart(2, "0")}`;
    const active = selected === value ? "active" : "";
    return `<button type="button" class="${active}" data-birth-month="${value}">${month}月</button>`;
  }).join("");
}

function openBirthMonthPicker() {
  state.birthMonthPickerOpen = true;
  const base = normalizeMonthValue(state.profile.birth) || currentMonthValue();
  state.profileMonthPickerYear = Number(base.slice(0, 4));
  state.birthMonthPickerMode = "month";
  state.birthYearPageStart = getBirthYearPageStart(state.profileMonthPickerYear);
  renderBirthMonthPopover();
  document.getElementById("birthMonthControl")?.classList.add("open");
  requestAnimationFrame(adjustFloatingPopovers);
}

function closeBirthMonthPicker() {
  state.birthMonthPickerOpen = false;
  state.birthMonthPickerMode = "month";
  document.getElementById("birthMonthControl")?.classList.remove("open");
}

function positionHybridMenu(host, menu) {
  if (!host || !menu) return;
  const gap = 1;
  const anchor = host.querySelector(".profile-hybrid-input") || host;
  const rect = anchor.getBoundingClientRect();
  const safeLeft = 12;
  const safeTop = 12;
  const safeRight = window.innerWidth - 12;
  const safeBottom = window.innerHeight - 12;
  menu.classList.remove("align-right", "align-up");
  menu.classList.add("floating-fixed");
  menu.style.left = "0px";
  menu.style.top = "0px";
  menu.style.right = "auto";
  menu.style.bottom = "auto";
  menu.style.width = `${Math.round(rect.width)}px`;
  menu.style.minWidth = `${Math.round(rect.width)}px`;
  menu.style.maxWidth = `${Math.round(rect.width)}px`;
  let menuRect = menu.getBoundingClientRect();
  let left = rect.left;
  if (left + menuRect.width > safeRight) left = safeRight - menuRect.width;
  if (left < safeLeft) left = safeLeft;
  let top = rect.bottom + gap;
  if (top + menuRect.height > safeBottom) {
    const aboveTop = rect.top - menuRect.height - gap;
    top = aboveTop >= safeTop ? aboveTop : Math.max(safeTop, safeBottom - menuRect.height);
  }
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

function mountHybridMenu(host, menu) {
  if (!host || !menu) return;
  if (menu.parentElement !== document.body) {
    menu.__homeHost = host;
    document.body.appendChild(menu);
  }
  menu.style.display = "block";
  positionHybridMenu(host, menu);
}

function unmountHybridMenu(menu) {
  if (!menu) return;
  const host = menu.__homeHost;
  if (host && menu.parentElement !== host) host.appendChild(menu);
  menu.classList.remove("floating-fixed", "align-right", "align-up");
  menu.style.left = "";
  menu.style.top = "";
  menu.style.right = "";
  menu.style.bottom = "";
  menu.style.width = "";
  menu.style.minWidth = "";
  menu.style.maxWidth = "";
  menu.style.display = "";
}

function adjustFloatingPopover(host, popover) {
  if (!host || !popover) return;
  const gap = 2;
  const viewportPad = 12;
  const fallbackBounds = {
    left: viewportPad,
    top: viewportPad,
    right: window.innerWidth - viewportPad,
    bottom: window.innerHeight - viewportPad
  };
  const boundaryHost = host.closest(".editor-drawer, .settings-card, .module-adjust-card");
  let safeBounds = fallbackBounds;
  if (boundaryHost) {
    const rect = boundaryHost.getBoundingClientRect();
    const inset = boundaryHost.classList.contains("editor-drawer") ? 10 : 8;
    const bounded = {
      left: Math.max(fallbackBounds.left, rect.left + inset),
      top: Math.max(fallbackBounds.top, rect.top + inset),
      right: Math.min(fallbackBounds.right, rect.right - inset),
      bottom: Math.min(fallbackBounds.bottom, rect.bottom - inset)
    };
    if (bounded.right - bounded.left >= 180 && bounded.bottom - bounded.top >= 120) {
      safeBounds = bounded;
    }
  }
  popover.classList.remove("align-right", "align-up");
  popover.classList.add("floating-fixed");
  popover.style.left = "0px";
  popover.style.top = "0px";
  popover.style.right = "auto";
  popover.style.bottom = "auto";
  popover.style.maxWidth = "";
  const hostRect = host.getBoundingClientRect();
  let rect = popover.getBoundingClientRect();
  const maxSafeWidth = Math.max(180, safeBounds.right - safeBounds.left);
  const width = Math.min(rect.width || 320, maxSafeWidth);
  popover.classList.toggle("compact-layout", width < 560);
  popover.style.width = `${Math.round(width)}px`;
  popover.style.maxWidth = `${Math.round(width)}px`;
  rect = popover.getBoundingClientRect();
  let left = hostRect.left;
  if (left + rect.width > safeBounds.right) left = safeBounds.right - rect.width;
  if (left < safeBounds.left) left = safeBounds.left;
  let top = hostRect.bottom + gap;
  if (top + rect.height > safeBounds.bottom) {
    const aboveTop = hostRect.top - rect.height - gap;
    top = aboveTop >= safeBounds.top ? aboveTop : Math.max(safeBounds.top, safeBounds.bottom - rect.height);
  }
  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;
}

function adjustFloatingPopovers() {
  document.querySelectorAll(".monthrange-control.open").forEach((host) => {
    adjustFloatingPopover(host, host.querySelector(".monthrange-popover"));
  });
  document.querySelectorAll(".profile-month-control.open").forEach((host) => {
    adjustFloatingPopover(host, host.querySelector(".profile-month-popover"));
  });
  document.querySelectorAll(".profile-hybrid.open").forEach((host) => {
    if (host.__hybridMenu) positionHybridMenu(host, host.__hybridMenu);
  });
}

function normalizeEditableProfileFields() {
  ensureDataList("genderList", ["男", "女", "不限", "保密"]);
  ensureDataList("politicalList", ["不填", "中共党员", "中共预备党员", "共青团员", "普通公民", "群众"]);
  ensureDataList("maritalList", ["不填", "已婚", "未婚", "离异", "已婚已育", "已婚未育"]);
  ensureDataList("workYearsList", ["应届生", "1年", "2年", "3年", "5年", "8年", "10年"]);
  replaceWithEditableInput("genderInput", "genderList");
  replaceWithEditableInput("politicalInput", "politicalList");
  replaceWithEditableInput("maritalInput", "maritalList");
  replaceWithEditableInput("workYearsInput", "workYearsList", "如：3年 / 应届生");
  ensureBirthMonthControl();
}

function normalizeEditorLayout() {
  if (refs.moduleSidebar && refs.moduleSidebar.parentElement !== refs.editorDrawer) {
    refs.editorDrawer.insertBefore(refs.moduleSidebar, refs.editorDrawer.firstElementChild);
  }
  if (refs.moduleSidebarFloatToggle && refs.moduleSidebarFloatToggle.parentElement !== refs.editorDrawer) {
    refs.editorDrawer.insertBefore(refs.moduleSidebarFloatToggle, refs.drawerContent);
  }
}

function getActiveSection() {
  return state.sections.find((item) => item.id === state.activeSectionId) || state.sections[0];
}

function isSkillsSection(sectionItem) {
  if (!sectionItem || typeof sectionItem !== "object") return false;
  if (sectionItem.id === "skills") return true;
  if (sectionItem.sectionType === "skills") return true;
  const raw = `${sectionItem.id || ""} ${sectionItem.tab || ""} ${sectionItem.title || ""}`;
  const text = raw.toLowerCase();
  return /工作技能|专业技能/.test(raw) || text.includes("work-skill") || text.includes("skills");
}

function normalizeSkillTextPart(value = "") {
  const text = safeText(value || "");
  if (!text) return "";
  if (/^(技能|专业技能|工作技能|技能分类|skill|skills)$/i.test(text)) return "";
  return text;
}

function mergeSkillsPlainBody(fields = {}, body = "") {
  const merged = [
    normalizeSkillTextPart(fields.skillCategory || ""),
    normalizeSkillTextPart(fields.skillContent || ""),
    normalizeSkillTextPart(fields.skillLevel || ""),
    safeText(body || "")
  ].filter(Boolean).join("\n");
  const normalized = normalizeImportedBody(merged);
  const lines = String(normalized || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines[0] && /^(技能|专业技能|工作技能|技能分类|skill|skills)$/i.test(lines[0])) {
    lines.shift();
  }
  return normalizeImportedBody(lines.join("\n"));
}

function coerceSkillsSectionToPlainText(sectionItem) {
  if (!isSkillsSection(sectionItem)) return;
  sectionItem.sectionType = "skills";
  sectionItem.customFields = [];
  sectionItem.fieldOrder = [];
  sectionItem.fieldVisibility = {};
  if (!Array.isArray(sectionItem.items)) sectionItem.items = [];
  sectionItem.items.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const fields = entry.fields || {};
    entry.body = mergeSkillsPlainBody(fields, entry.body || "");
    entry.fields = {};
  });
}

function getSectionKind(sectionItem) {
  if (isSkillsSection(sectionItem)) return "skills";
  if (sectionItem.sectionType === "custom" || String(sectionItem.id || "").startsWith("custom-")) return "custom";
  const text = `${sectionItem.id || ""} ${sectionItem.tab || ""} ${sectionItem.title || ""}`;
  if (["education", "教育"].some((word) => text.includes(word))) return "education";
  if (["skill", "技能"].some((word) => text.includes(word))) return "skills";
  if (["project", "项目"].some((word) => text.includes(word))) return "project";
  if (["award", "竞赛", "获奖", "奖"].some((word) => text.includes(word))) return "awards";
  if (["self", "自我", "评价"].some((word) => text.includes(word))) return "self";
  if (["intern", "work", "实习", "工作", "经历"].some((word) => text.includes(word))) return "experience";
  return "experience";
}

function getSectionSchema(sectionItem) {
  return sectionSchemas[getSectionKind(sectionItem)] || sectionSchemas.experience;
}

function defaultFieldVisibility(schema) {
  return Object.fromEntries(schema.toggles.map(([key]) => [key, true]));
}

function getSectionToggleEntries(sectionItem, schema = getSectionSchema(sectionItem)) {
  if (isSkillsSection(sectionItem)) return [];
  const base = [...schema.toggles];
  const customFields = Array.isArray(sectionItem.customFields) ? sectionItem.customFields : [];
  const extras = customFields
    .filter((field) => field && field.key)
    .map((field) => [field.key, field.label || "自定义字段"]);
  return [...base, ...extras];
}

function ensureSectionFieldOrder(sectionItem, schema = getSectionSchema(sectionItem)) {
  const toggleEntries = getSectionToggleEntries(sectionItem, schema);
  const keys = toggleEntries.map(([key]) => key);
  const existing = Array.isArray(sectionItem.fieldOrder) ? sectionItem.fieldOrder.filter((key) => keys.includes(key)) : [];
  const merged = [...existing, ...keys.filter((key) => !existing.includes(key))];
  sectionItem.fieldOrder = merged;
  return merged;
}

function getOrderedToggleEntries(sectionItem, schema = getSectionSchema(sectionItem)) {
  const entries = getSectionToggleEntries(sectionItem, schema);
  const map = new Map(entries);
  const order = ensureSectionFieldOrder(sectionItem, schema);
  return order.map((key) => [key, map.get(key) || key]);
}

function getOrderedFieldDefs(sectionItem, schema = getSectionSchema(sectionItem)) {
  const customFieldDefs = (sectionItem.customFields || []).map((field) => ({ key: field.key, label: field.label || "自定义字段" }));
  const map = new Map([...schema.fields, ...customFieldDefs].map((field) => [field.key, field]));
  return ensureSectionFieldOrder(sectionItem, schema)
    .map((key) => map.get(key))
    .filter(Boolean);
}

function normalizeCustomFields(sectionItem) {
  if (!sectionItem || typeof sectionItem !== "object") return;
  if (!Array.isArray(sectionItem.customFields)) sectionItem.customFields = [];
  sectionItem.customFields = sectionItem.customFields
    .filter((field) => field && typeof field === "object" && String(field.key || "").trim())
    .map((field) => ({
      key: String(field.key).trim(),
      label: String(field.label || "自定义字段").trim() || "自定义字段"
    }));
}

function normalizeSectionBuiltinFlags() {
  if (!Array.isArray(state.sections)) {
    state.sections = structuredClone(initialState.sections);
    return;
  }
  const builtinKindById = {
    education: "education",
    internship: "experience",
    skills: "skills",
    project: "project",
    awards: "awards",
    self: "self"
  };
  state.sections.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const isBuiltin = builtinSectionIds.has(item.id);
    item.builtin = item.builtin === true || isBuiltin;
    if (isBuiltin) {
      item.sectionType = builtinKindById[item.id] || getSectionKind(item);
    } else if (!item.sectionType) {
      item.sectionType = String(item.id || "").startsWith("custom-") ? "custom" : getSectionKind(item);
    }
    coerceSkillsSectionToPlainText(item);
    normalizeCustomFields(item);
    if (typeof item.visible !== "boolean") item.visible = true;
  });
}

function splitDateRange(value = "") {
  const parts = String(value).split(/~|-{2}|至|到/).map((item) => item.trim());
  const normalize = (text) => {
    const match = String(text || "").match(/(\d{4})[-/.年](\d{1,2})/);
    return match ? `${match[1]}-${String(match[2]).padStart(2, "0")}` : "";
  };
  return { start: normalize(parts[0]), end: normalize(parts[1]) };
}

function normalizeMonthValue(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/(\d{4})\s*(?:[-/.年])\s*(\d{1,2})/);
  if (!match) return text;
  return `${match[1]}-${String(match[2]).padStart(2, "0")}`;
}

function safeText(value = "") {
  return String(value || "").trim();
}

function plainFieldText(value = "") {
  let text = String(value || "");
  if (!/[<&]/.test(text)) return text.trim();
  for (let pass = 0; pass < 2 && /<\/?[a-z][^>]*>|&(?:lt|gt|amp|quot|#\d+);/i.test(text); pass += 1) {
    const template = document.createElement("template");
    template.innerHTML = text;
    text = template.content.textContent || "";
  }
  return text.replace(/\u200B/g, "").replace(/\s+/g, " ").trim();
}

function isBulletLine(line = "") {
  return /^[•·▪▫●○◆◇▶►\-]\s*/.test(line) ||
    /^\d{1,2}[.)、]\s*/.test(line) ||
    /^[一二三四五六七八九十]{1,3}[、.]\s*/.test(line);
}

function isSectionHeading(line = "") {
  const normalized = String(line || "")
    .replace(/^[\s\-•·▪▫●○◆◇▶►\[\]【】()（）:：]+/, "")
    .replace(/[\s\-•·▪▫●○◆◇▶►\[\]【】()（）:：]+$/, "")
    .replace(/\s+/g, "");
  if (!normalized || normalized.length > 18) return false;
  const headings = new Set([
    "教育背景", "教育经历", "实习经验", "实习经历", "工作经历", "工作经验",
    "项目经验", "项目经历", "项目实践", "工作技能", "专业技能", "职业技能", "技能标签",
    "竞赛获奖", "获奖情况", "荣誉奖项", "自我评价", "个人评价", "个人总结"
  ]);
  return headings.has(normalized);
}

function isFieldStarter(line = "") {
  const clean = String(line || "").trim();
  if (!clean) return false;
  const keys = [
    "项目描述", "职责", "荣誉奖励", "获奖情况", "主修课程", "研究方向", "毕业论文",
    "校园经历", "学术成果", "竞赛经历", "工作内容", "成果", "说明",
    "姓名", "性别", "电话", "手机", "邮箱", "出生年月", "出生日期"
  ];
  return keys.some((k) => new RegExp(`^${k}\\s*[:：]?$`).test(clean) || new RegExp(`^${k}\\s*[:：]`).test(clean));
}

function isTimeRangeStarter(line = "") {
  const clean = String(line || "").trim();
  return /^(?:19|20)\d{2}\s*(?:年|[./-])\s*(?:1[0-2]|0?[1-9])(?:\s*月)?\s*(?:~|-|—|–|至|到)/.test(clean);
}

function endsSentence(line = "") {
  return /[。.！!?？；;]$/.test(String(line || "").trim());
}

function endsWithColon(line = "") {
  return /[:：]$/.test(String(line || "").trim());
}

function endsWithSoftPunct(line = "") {
  return /[，,、]$/.test(String(line || "").trim());
}

function looksLikeContinuation(line = "") {
  const clean = String(line || "").trim();
  if (!clean) return false;
  const starters = ["并", "及", "和", "与", "同时", "以及", "包括", "其中", "负责", "参与", "完成", "协助", "通过", "使用", "基于", "实现", "提升"];
  if (starters.some((s) => clean.startsWith(s))) return true;
  if (/^[a-z]/.test(clean)) return true;
  if (/^[)\]）】,，.。]/.test(clean)) return true;
  return false;
}

function shouldMerge(prev = "", curr = "") {
  if (!prev || !curr) return false;
  if (isBulletLine(prev) || isBulletLine(curr)) return false;
  if (isSectionHeading(curr) || isFieldStarter(curr) || isTimeRangeStarter(curr)) return false;
  if (isSectionHeading(prev) || isFieldStarter(prev) || endsWithColon(prev) || isTimeRangeStarter(prev)) return false;
  if (endsSentence(prev)) return false;
  if (endsWithSoftPunct(prev)) return true;
  if (looksLikeContinuation(curr)) return true;
  if (/[A-Za-z0-9]$/.test(prev) && /^[A-Za-z0-9(（]/.test(curr)) return true;
  if (prev.length >= 24 && curr.length >= 8) return true;
  return false;
}

function normalizeImportedBody(value = "") {
  const lines = String(value || "")
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const paragraphs = [];
  for (const line of lines) {
    const clean = line.replace(/\s*([,，.。;；:：])\s*/g, "$1").trim();
    if (!clean) continue;
    if (!paragraphs.length) {
      paragraphs.push(clean);
      continue;
    }
    const prev = paragraphs[paragraphs.length - 1];
    if (shouldMerge(prev, clean)) {
      const glue = /[A-Za-z0-9]$/.test(prev) && /^[A-Za-z0-9]/.test(clean) ? " " : "";
      paragraphs[paragraphs.length - 1] = `${prev}${glue}${clean}`.replace(/\s+/g, " ").trim();
    } else {
      paragraphs.push(clean);
    }
  }
  return paragraphs.join("\n");
}

function applyImportedBoldMarkup(value = "", styleMeta = {}) {
  const text = String(value || "");
  if (!text || /<\/?(?:strong|b)\b/i.test(text)) return text;
  const runs = Array.isArray(styleMeta.boldRuns) ? styleMeta.boldRuns : [];
  const phrases = Array.isArray(styleMeta.boldPhrases) ? styleMeta.boldPhrases : [];
  const candidates = [];
  const matchedPhrases = new Set();
  const addMatches = (phrase, start = 0, end = text.length) => {
    const target = String(phrase || "").trim();
    if (!target || target.length < 2) return 0;
    let count = 0;
    let index = text.indexOf(target, start);
    while (index >= 0 && index + target.length <= end) {
      candidates.push({ start: index, end: index + target.length, length: target.length });
      count += 1;
      index = text.indexOf(target, index + target.length);
    }
    if (count) matchedPhrases.add(target);
    return count;
  };
  runs.forEach((run) => {
    const line = normalizeImportedBody(String(run?.line || ""));
    const phrase = normalizeImportedBody(String(run?.text || ""));
    if (!line || !phrase) return;
    let lineIndex = text.indexOf(line);
    while (lineIndex >= 0) {
      addMatches(phrase, lineIndex, lineIndex + line.length);
      lineIndex = text.indexOf(line, lineIndex + line.length);
    }
  });
  if (!runs.length) phrases.forEach((rawPhrase) => {
    const phrase = String(rawPhrase || "").trim();
    if (!phrase || matchedPhrases.has(phrase)) return;
    const first = text.indexOf(phrase);
    if (first >= 0 && first === text.lastIndexOf(phrase)) addMatches(phrase);
  });
  if (!candidates.length) return text;
  const occupied = new Uint8Array(text.length);
  const selected = [];
  candidates.sort((a, b) => b.length - a.length || a.start - b.start).forEach((range) => {
    for (let index = range.start; index < range.end; index += 1) {
      if (occupied[index]) return;
    }
    for (let index = range.start; index < range.end; index += 1) occupied[index] = 1;
    selected.push(range);
  });
  selected.sort((a, b) => a.start - b.start);
  const escapeWithBreaks = (chunk) => escapeHtml(chunk).replaceAll("\n", "<br>");
  let cursor = 0;
  const html = [];
  selected.forEach((range) => {
    html.push(escapeWithBreaks(text.slice(cursor, range.start)));
    html.push(`<strong>${escapeHtml(text.slice(range.start, range.end))}</strong>`);
    cursor = range.end;
  });
  html.push(escapeWithBreaks(text.slice(cursor)));
  return html.join("");
}

function hydrateEducationFieldsFromBody(fields = {}, body = "") {
  const next = { ...fields };
  const lines = String(body || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const first = lines[0] || "";
  const text = first.replace(/(?:GPA|绩点)\s*[:：]?\s*[0-9.]+(?:\s*\/\s*[0-9.]+)?/i, "").trim();
  const parts = text.split(/[|｜\-—–]/).map((part) => part.trim()).filter(Boolean);

  if (!next.gpa) {
    const gpaMatch = String(body || "").match(/(?:GPA|绩点)\s*[:：]?\s*([0-9.]+(?:\s*\/\s*[0-9.]+)?)/i);
    if (gpaMatch) next.gpa = gpaMatch[1].replace(/\s+/g, "");
  }
  if (!next.school && parts[0] && /(大学|学院|学校|中学|研究院|University|College|School)/i.test(parts[0])) {
    next.school = parts[0];
  }
  if (!next.major && parts[1]) next.major = parts[1];
  if (!next.major) {
    const majorMatch = text.match(/[（(]([^()（）]{2,40})[)）]/);
    if (majorMatch) next.major = majorMatch[1].trim();
  }
  const majorLooksWrong = /^(?:\d{3}|211|985|双一流)$/i.test(String(next.major || "").trim());
  if (majorLooksWrong || !next.major) {
    const candidate = lines.find((line) =>
      line.length <= 26 &&
      !/(主修课程|荣誉奖励|获奖|奖学金|竞赛|校园经历|学术成果|研究方向|毕业论文|GPA|绩点)/.test(line) &&
      !/^(?:19|20)\d{2}\s*(?:[-/.年])/.test(line) &&
      !/(大学|学院|学校|University|College|School)/i.test(line)
    );
    if (candidate) next.major = candidate;
  }
  return next;
}

function normalizeImportCompareText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[：:;；,，.。·•\-—–_|｜/\\()[\]{}（）【】<>《》"'“”‘’]/g, "");
}

function stripEducationMetaFromBody(fields = {}, body = "") {
  const school = safeText(fields.school || "");
  const major = safeText(fields.major || "");
  const schoolOnly = normalizeImportCompareText(school);
  const schoolMajor = normalizeImportCompareText(`${school}${major}`);
  const majorOnly = normalizeImportCompareText(major);
  const lines = String(body || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const kept = lines.filter((line) => {
    const noGpa = line.replace(/(?:GPA|绩点)\s*[:：]?\s*[0-9.]+(?:\s*\/\s*[0-9.]+)?(?:\s*[（(][^()（）]{0,16}[)）])?/ig, "").trim();
    const normalized = normalizeImportCompareText(noGpa);
    if (!normalized) return false;
    if (schoolOnly && normalized === schoolOnly) return false;
    if (schoolMajor && normalized === schoolMajor) return false;
    if (majorOnly && normalized === majorOnly) return false;
    if (schoolOnly && majorOnly && normalized === normalizeImportCompareText(`${school}-${major}`)) return false;
    if (majorOnly && (normalized.startsWith(majorOnly) || majorOnly.startsWith(normalized)) && normalized.length <= majorOnly.length + 2) return false;
    return true;
  });
  return normalizeImportedBody(kept.join("\n"));
}

function looksLikeCompanyText(value = "") {
  const text = String(value || "").trim();
  if (!text) return false;
  return /(公司|集团|科技|有限|责任|事务所|研究院|大学|学院|银行|医院|中心|部门|政府|委员会|商贸|电子商务|企业|平台|工作室)/.test(text);
}

function looksLikeRoleText(value = "") {
  const text = String(value || "").trim();
  if (!text) return false;
  return /(实习|工程师|经理|专员|主管|顾问|助理|分析|运营|产品|测试|开发|设计|编辑|销售|行政|财务|人事|讲师|老师|研究|岗位|总监)/.test(text);
}

function looksLikeHeaderContinuationText(value = "") {
  const text = safeText(value);
  if (!text || text.length > 42) return false;
  if (/^(项目描述|项目职责|工作内容|工作职责|职责|描述|负责|参与|基于|使用|构建|完成|协助|跟进|输出|支持|建立|优化|提升|熟悉|掌握)/.test(text)) return false;
  if (/[。；;]/.test(text)) return false;
  if (/[，,]/.test(text) && !/[-—–_|｜/]/.test(text)) return false;
  const hasSeparator = /[-—–_|｜/]/.test(text);
  const hasOrgUnit = /(中心|部门|事业部|产品部|研发部|数据部|业务部|项目组|团队|小组|实验室|办公室)/.test(text);
  const hasAward = /(杯|大赛|竞赛|比赛|挑战赛|案例大赛|国一|国二|国三|省一|省二|省三|校一|校二|一等奖|二等奖|三等奖|金奖|银奖|铜奖|获奖|优秀奖|冠军|亚军|季军)/.test(text);
  return looksLikeRoleText(text) || hasAward || (hasSeparator && hasOrgUnit);
}

function splitHeaderContinuationPrefix(value = "") {
  const text = safeText(value);
  if (!text) return null;
  if (looksLikeHeaderContinuationText(text)) return { head: text, rest: "" };
  const starterPattern = /(项目描述[:：]?|项目职责[:：]?|工作内容[:：]?|工作职责[:：]?|负责|参与|基于|使用|构建|完成|协助|跟进|输出|支持|建立|优化|提升|熟悉|掌握)/g;
  let match;
  while ((match = starterPattern.exec(text))) {
    const index = match.index;
    if (index < 4) continue;
    const head = text.slice(0, index).trim();
    const rest = text.slice(index).trim();
    if (looksLikeHeaderContinuationText(head) && rest) {
      return { head, rest };
    }
  }
  return null;
}

function looksLikeProjectSideText(value = "") {
  const text = safeText(value);
  if (!text || text.length > 26) return false;
  if (/^(项目描述|项目职责|项目职责[:：]|项目描述[:：]|负责|参与|基于|使用|构建|完成)/.test(text)) return false;
  return looksLikeHeaderContinuationText(text) || /(负责人|队长|组长|成员)/.test(text);
}

function looksLikeProjectNameText(value = "") {
  const text = safeText(value);
  if (!text || text.length > 42) return false;
  if (/^(项目描述|项目职责|负责|参与|基于|使用|构建|完成)/.test(text)) return false;
  return /(项目|问题|研究|系统|平台|模型|策略|分析|诊断|识别|预测|优化|营销|调研|算法|应用|方案)/.test(text);
}

function splitCompanyRoleCandidate(value = "") {
  const text = String(value || "").trim();
  if (!text) return ["", ""];
  const parts = text.split(/\s{2,}|[|｜]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return [parts[0], parts.slice(1).join(" ")];
  const one = parts[0] || text;
  const match = one.match(/^(.*?)(实习生|工程师|经理|专员|主管|顾问|助理|分析师|运营|产品|测试|开发|设计|编辑|销售|行政|财务|人事|讲师|老师|研究员|总监)$/);
  if (match) {
    const company = match[1].trim();
    const role = match[2].trim();
    if (company) return [company, role];
  }
  return [one, ""];
}

function normalizeInternshipImportedItem(item) {
  const next = { ...item, fields: { ...(item.fields || {}) } };
  const lines = String(next.importRawBody || next.body || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  let company = safeText(next.fields.company || "");
  let role = safeText(next.fields.role || "");
  if (role === "岗位") role = "";

  if (company && !role) {
    const [c, r] = splitCompanyRoleCandidate(company);
    if (c) company = c;
    if (r) role = r;
  }
  if (role && !company && looksLikeCompanyText(role)) {
    company = role;
    role = "";
  }
  if (company && role && looksLikeRoleText(company) && looksLikeCompanyText(role) && !looksLikeRoleText(role)) {
    const temp = company;
    company = role;
    role = temp;
  }
  if (!role && lines.length) {
    const firstLine = lines[0];
    const continuation = splitHeaderContinuationPrefix(firstLine);
    if (continuation && normalizeImportCompareText(continuation.head) !== normalizeImportCompareText(company)) {
      role = continuation.head;
      if (continuation.rest) {
        lines[0] = continuation.rest;
      } else {
        lines.shift();
      }
    }
  }
  if (!company && lines.length && looksLikeCompanyText(lines[0])) {
    company = lines.shift();
  }
  if (role && lines.length && normalizeImportCompareText(lines[0]) === normalizeImportCompareText(role)) {
    lines.shift();
  }

  next.fields.company = company;
  next.fields.role = role;
  next.body = normalizeImportedBody(lines.join("\n"));
  delete next.importRawBody;
  return next;
}

function normalizeProjectImportedItem(item) {
  const next = { ...item, fields: { ...(item.fields || {}) } };
  const lines = String(next.importRawBody || next.body || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  let projectName = safeText(next.fields.projectName || "");
  let role = safeText(next.fields.role || "");

  if (!projectName && lines.length && looksLikeProjectNameText(lines[0])) {
    projectName = lines.shift();
  }
  if (!role && lines.length && looksLikeProjectSideText(lines[0])) {
    role = lines.shift();
  } else if (!role && lines.length) {
    const continuation = splitHeaderContinuationPrefix(lines[0]);
    if (continuation && looksLikeProjectSideText(continuation.head)) {
      role = continuation.head;
      if (continuation.rest) {
        lines[0] = continuation.rest;
      } else {
        lines.shift();
      }
    }
  }
  if (role && lines.length && normalizeImportCompareText(lines[0]) === normalizeImportCompareText(role)) {
    lines.shift();
  }

  next.fields.projectName = projectName;
  next.fields.role = role;
  next.body = normalizeImportedBody(lines.join("\n"));
  delete next.importRawBody;
  return next;
}

function normalizeSectionHeaderContinuations(sectionItem, schema = getSectionSchema(sectionItem)) {
  if (!sectionItem || !Array.isArray(sectionItem.items)) return;
  if (schema === sectionSchemas.project) {
    sectionItem.items.forEach((item) => Object.assign(item, normalizeProjectImportedItem(item)));
    return;
  }
  if (sectionItem.id === "internship" || schema === sectionSchemas.experience) {
    sectionItem.items.forEach((item) => Object.assign(item, normalizeInternshipImportedItem(item)));
  }
}

function normalizeImportTimeRange(timeRange = {}) {
  const start = normalizeMonthValue(timeRange.start || "");
  const end = normalizeMonthValue(timeRange.end || "");
  const current = Boolean(timeRange.current) || /至今|当前|present/i.test(String(timeRange.end || ""));
  return {
    start,
    end: current ? "" : end,
    current
  };
}

function buildImportedItem(rawItem = {}, templateFields = {}) {
  const item = blankItem();
  const fields = { ...templateFields };
  const incoming = rawItem.fields && typeof rawItem.fields === "object" ? rawItem.fields : {};
  Object.keys(incoming).forEach((key) => {
    fields[key] = safeText(incoming[key]);
  });
  if (incoming.timeRange && typeof incoming.timeRange === "object") {
    fields.timeRange = normalizeImportTimeRange(incoming.timeRange);
  } else if (rawItem.timeRange && typeof rawItem.timeRange === "object") {
    fields.timeRange = normalizeImportTimeRange(rawItem.timeRange);
  }
  if (!fields.timeRange) fields.timeRange = { start: "", end: "", current: false };
  item.fields = fields;
  item.importRawBody = String(rawItem.body || "");
  item.body = normalizeImportedBody(rawItem.body || "");
  return item;
}

function formatMonthCN(value = "") {
  const normalized = normalizeMonthValue(value);
  const match = normalized.match(/^(\d{4})-(\d{2})$/);
  return match ? `${match[1]}年${Number(match[2])}月` : normalized;
}

function formatMonthCompact(value = "") {
  return normalizeMonthValue(value);
}

function formatTimeRange(timeRange = {}, visibility = {}) {
  if (visibility.timeRange === false) return "";
  const start = normalizeMonthValue(timeRange.start);
  const end = timeRange.current ? "至今" : normalizeMonthValue(timeRange.end);
  if (start && end) return `${formatMonthCompact(start)} ~ ${end === "至今" ? "至今" : formatMonthCompact(end)}`;
  if (start) return formatMonthCompact(start);
  if (end) return end === "至今" ? "至今" : formatMonthCompact(end);
  return "";
}

function wordFontSizes() {
  return [
    ["6px", "6"],
    ["7px", "7"],
    ["8px", "8"],
    ["9px", "9"],
    ["10px", "10"],
    ["10.5px", "10.5"],
    ["11px", "11"],
    ["12px", "12"],
    ["14px", "14"],
    ["16px", "16"],
    ["18px", "18"],
    ["20px", "20"],
    ["22px", "22"],
    ["24px", "24"],
    ["28px", "28"],
    ["32px", "32"]
  ];
}

function wordLineHeights() {
  return [
    ["0.8", "紧凑 0.8"],
    ["0.9", "紧凑 0.9"],
    ["1", "单倍"],
    ["1.15", "1.15"],
    ["1.25", "1.25"],
    ["1.5", "1.5"],
    ["1.75", "1.75"],
    ["2", "2.0"],
    ["2.5", "2.5"],
    ["3", "3.0"]
  ];
}

function formatIndentLabel(value = 0) {
  return `${Number(value || 0)}字`;
}

const INDENT_STEP_VALUES = [0, 1, 2, 4];

function getNextIndentStep(currentValue = 0) {
  const current = Number(currentValue || 0);
  const hit = INDENT_STEP_VALUES.find((step) => Math.abs(step - current) < 0.001);
  const index = Math.max(0, INDENT_STEP_VALUES.indexOf(hit));
  return INDENT_STEP_VALUES[(index + 1) % INDENT_STEP_VALUES.length];
}

function normalizeAllowedFontFamily(value = "") {
  const text = String(value || "").replace(/['"]/g, "").trim().toLowerCase();
  const allowed = [
    "microsoft yahei",
    "simsun",
    "simhei",
    "kaiti",
    "times new roman",
    "arial",
    "calibri"
  ];
  const hit = allowed.find((name) => text.includes(name));
  if (!hit) return "Microsoft YaHei";
  const map = {
    "microsoft yahei": "Microsoft YaHei",
    "simsun": "SimSun",
    "simhei": "SimHei",
    "kaiti": "KaiTi",
    "times new roman": "Times New Roman",
    "arial": "Arial",
    "calibri": "Calibri"
  };
  return map[hit] || "Microsoft YaHei";
}

function fontFamilyLabel(value = "") {
  const normalized = normalizeAllowedFontFamily(value);
  const labels = {
    "Microsoft YaHei": "微软雅黑",
    "SimSun": "宋体",
    "SimHei": "黑体",
    "KaiTi": "楷体",
    "Times New Roman": "Times New Roman",
    "Arial": "Arial",
    "Calibri": "Calibri"
  };
  return labels[normalized] || normalized;
}

function fontFamilyOptions() {
  const options = [
    "Microsoft YaHei",
    "SimSun",
    "SimHei",
    "KaiTi",
    "Times New Roman",
    "Arial",
    "Calibri"
  ];
  return options.map((name) => [name, fontFamilyLabel(name)]);
}

function getMonthRangeDisplayPart(value = "") {
  return formatMonthCompact(value);
}

function openMonthRange(itemId, stage = "start", options = {}) {
  const item = getActiveSection().items.find((entry) => entry.id === itemId);
  const range = item?.fields?.timeRange || {};
  const startYear = Number((normalizeMonthValue(range.start) || currentMonthValue()).slice(0, 4));
  const endBase = normalizeMonthValue(range.end) || normalizeMonthValue(range.start) || currentMonthValue();
  const endYear = Number(endBase.slice(0, 4)) + (Number(endBase.slice(5, 7)) === 12 ? 1 : 0);
  state.activeMonthRange = {
    itemId,
    stage,
    manual: Boolean(options.manual),
    startYear: options.startYear || state.activeMonthRange?.startYear || startYear,
    endYear: options.endYear || state.activeMonthRange?.endYear || Math.max(endYear, startYear + 1),
    hoverMonth: stage === "end" ? normalizeMonthValue(options.hoverMonth || "") : "",
    suppressOpenAnimation: Boolean(options.suppressOpenAnimation)
  };
}

function closeMonthRange() {
  state.activeMonthRange = null;
}

function ensureSectionFields(sectionItem) {
  const schema = getSectionSchema(sectionItem);
  normalizeCustomFields(sectionItem);
  const toggleEntries = getOrderedToggleEntries(sectionItem, schema);
  const defaultVisible = Object.fromEntries(toggleEntries.map(([key]) => [key, true]));
  sectionItem.fieldVisibility = { ...defaultVisible, ...(sectionItem.fieldVisibility || {}) };
  sectionItem.items.forEach((item) => {
    if (!item.richStyle) {
      item.richStyle = {
        lineHeight: 1.65,
        firstIndent: 0,
        hangingIndent: 0
      };
    }
    if (item.fields) {
      Object.entries(item.fields).forEach(([key, value]) => {
        if (key === "timeRange" || typeof value !== "string") return;
        item.fields[key] = plainFieldText(value);
      });
      return;
    }
    const range = splitDateRange(item.metaLeft);
    const metaRight = String(item.metaRight || "");
    const fields = isSkillsSection(sectionItem) ? {} : {
      timeRange: {
        start: range.start,
        end: range.end,
        current: /至今|当前/.test(item.metaLeft || "")
      }
    };
    if (schema === sectionSchemas.education) {
      const gpaMatch = metaRight.match(/GPA[:：]?\s*([^\s]+)/i);
      fields.gpa = gpaMatch ? gpaMatch[1] : "";
      const left = metaRight.replace(/GPA[:：]?\s*[^\s]+/i, "").trim();
      const parts = left.split(/[-｜|]/).map((part) => part.trim()).filter(Boolean);
      fields.school = parts[0] || left;
      fields.major = parts[1] || "";
      fields.degree = parts[2] || "";
    } else if (isSkillsSection(sectionItem) || schema === sectionSchemas.skills) {
      const legacy = safeText(item.metaRight || "");
      if (legacy && !String(item.body || "").includes(legacy)) {
        item.body = [legacy, safeText(item.body || "")].filter(Boolean).join("\n");
      }
    } else if (schema === sectionSchemas.project) {
      fields.projectName = metaRight || "";
      fields.role = "";
      const lines = String(item.body || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
      if (lines.length && looksLikeProjectSideText(lines[0])) {
        fields.role = lines.shift();
        item.body = normalizeImportedBody(lines.join("\n"));
      }
    } else if (schema === sectionSchemas.awards) {
      fields.awardName = metaRight || "";
      fields.awardLevel = "";
    } else {
      const parts = metaRight.split(/\s{2,}|[-｜|]/).map((part) => part.trim()).filter(Boolean);
      fields.company = parts[0] || metaRight;
      fields.role = parts.slice(1).join(" ") || "";
      fields.location = "";
    }
    item.fields = fields;
  });
  sectionItem.items.forEach((item) => {
    if (!item.fields) item.fields = {};
    sectionItem.customFields.forEach((field) => {
      if (!(field.key in item.fields)) item.fields[field.key] = "";
    });
  });
  normalizeSectionHeaderContinuations(sectionItem, schema);
}

function setSectionItemsFromImport(sectionId, rawItems = [], styleMeta = {}) {
  const sectionItem = state.sections.find((entry) => entry.id === sectionId);
  if (!sectionItem) return false;
  ensureSectionFields(sectionItem);
  const schema = getSectionSchema(sectionItem);
  const templateFields = {};
  schema.fields.forEach((field) => {
    if (field.key === "timeRange") {
      templateFields.timeRange = { start: "", end: "", current: false };
    } else {
      templateFields[field.key] = "";
    }
  });
  sectionItem.items = (Array.isArray(rawItems) ? rawItems : [])
    .map((rawItem) => buildImportedItem(rawItem, templateFields))
    .filter(Boolean);
  if (isSkillsSection(sectionItem) || schema === sectionSchemas.skills) {
    sectionItem.items = sectionItem.items.map((item) => {
      const fields = item.fields || {};
      item.body = mergeSkillsPlainBody(fields, item.body || "");
      item.fields = {};
      return item;
    });
  }
  if (schema === sectionSchemas.education) {
    sectionItem.items = sectionItem.items.map((item) => {
      item.fields = hydrateEducationFieldsFromBody(item.fields || {}, item.body || "");
      item.body = stripEducationMetaFromBody(item.fields || {}, item.body || "");
      return item;
    });
  }
  if (schema === sectionSchemas.project) {
    sectionItem.items = sectionItem.items.map((item) => normalizeProjectImportedItem(item));
  }
  if (sectionItem.id === "internship" || schema === sectionSchemas.experience) {
    sectionItem.items = sectionItem.items.map((item) => {
      item = normalizeInternshipImportedItem(item);
      return item;
    });
  }
  const hasContent = sectionItem.items.some((item) => {
    const body = safeText(item.body || "");
    if (body) return true;
    const fields = item.fields || {};
    return Object.keys(fields).some((key) => {
      if (key === "timeRange") {
        const tr = fields.timeRange || {};
        return Boolean(normalizeMonthValue(tr.start || "") || normalizeMonthValue(tr.end || "") || tr.current);
      }
      return safeText(fields[key] || "") !== "";
    });
  });
  if (!hasContent) {
    sectionItem.visible = false;
    ensureSectionFields(sectionItem);
    return false;
  }
  sectionItem.visible = true;
  ensureSectionFields(sectionItem);
  sectionItem.items = sectionItem.items.map((item) => {
    item.body = applyImportedBoldMarkup(item.body || "", styleMeta);
    return item;
  });
  return true;
}

function applyParsedResumeData(parsed = {}) {
  const profile = parsed.profile && typeof parsed.profile === "object" ? parsed.profile : {};
  const profileKeys = ["name", "gender", "birth", "political", "phone", "email", "arrival", "workYears", "marital", "height", "weight", "ethnicity", "domicile"];
  const profileDefaults = {
    name: "",
    gender: "",
    birth: "",
    political: "",
    phone: "",
    email: "",
    arrival: "",
    workYears: "不填",
    marital: "不填",
    height: "",
    weight: "",
    ethnicity: "",
    domicile: ""
  };
  profileKeys.forEach((key) => {
    state.profile[key] = profileDefaults[key] ?? "";
  });
  profileKeys.forEach((key) => {
    if (!hasValue(profile[key])) return;
    state.profile[key] = safeText(profile[key]);
  });

  const sectionMap = {
    education: "education",
    experience: "internship",
    internship: "internship",
    project: "project",
    skills: "skills",
    awards: "awards",
    self: "self"
  };
  const importedSectionIds = new Set();
  const importStyleMeta = parsed.meta && typeof parsed.meta === "object" ? parsed.meta : {};
  if (Array.isArray(parsed.sections)) {
    parsed.sections.forEach((section) => {
      if (!section || typeof section !== "object") return;
      const key = safeText(section.kind || section.type || "").toLowerCase();
      const targetId = sectionMap[key];
      if (!targetId) return;
      if (hasValue(section.title)) {
        const target = state.sections.find((entry) => entry.id === targetId);
        if (target) {
          const nextTitle = targetId === "internship"
            ? safeText(section.title).replace(/实习经验/g, "实习经历")
            : safeText(section.title);
          target.tab = nextTitle;
          target.title = nextTitle;
        }
      }
      const imported = setSectionItemsFromImport(targetId, section.items || [], importStyleMeta);
      if (imported) importedSectionIds.add(targetId);
    });
  }
  // 导入后：PDF 未出现的内置模块自动隐藏，避免保留旧内容
  state.sections.forEach((section) => {
    if (!section || typeof section !== "object") return;
    if (builtinSectionIds.has(section.id)) {
      section.visible = importedSectionIds.has(section.id);
    }
  });
  syncInputsFromState();
  state.activeTab = "profile";
  renderAll();
}

function getItemTextBlockStyle(item) {
  const richStyle = item.richStyle || {};
  const lineHeight = Number(richStyle.lineHeight || 1.65);
  const firstIndent = Number(richStyle.firstIndent || 0);
  const hangingIndent = Number(richStyle.hangingIndent || 0);
  const textIndent = firstIndent - hangingIndent;
  return [
    `line-height:${lineHeight}`,
    `padding-left:${hangingIndent}em`,
    `text-indent:${textIndent}em`
  ].join(";");
}

function updatePreviewOnly() {
  renderProfile();
  renderSections();
  renderExtras();
  persist();
}

function getItemPreviewMeta(sectionItem, item) {
  ensureSectionFields(sectionItem);
  const schema = getSectionSchema(sectionItem);
  const skillsLike = isSkillsSection(sectionItem);
  const visible = sectionItem.fieldVisibility || {};
  const fields = item.fields || {};
  const orderedKeys = ensureSectionFieldOrder(sectionItem, schema).filter((key) => visible[key] !== false);
  const customFieldKeys = new Set((sectionItem.customFields || []).map((field) => field.key));
  const getValueByKey = (key) => {
    if (key === "timeRange") return formatTimeRange(fields.timeRange, visible);
    if (key === "gpa") return fields.gpa ? `GPA：${fields.gpa}` : "";
    if (customFieldKeys.has(key)) return String(fields[key] || "").trim();
    return String(fields[key] || "").trim();
  };
  if (skillsLike || schema === sectionSchemas.skills) return { left: "", rightParts: [] };
  if (schema === sectionSchemas.self) return { left: "", rightParts: orderedKeys.map((key) => getValueByKey(key)).filter(Boolean) };
  const rightParts = orderedKeys
    .filter((key) => key !== "timeRange")
    .map((key) => safeText(getValueByKey(key)))
    .filter((value) => value !== "");
  return {
    left: orderedKeys.includes("timeRange") ? formatTimeRange(fields.timeRange, visible) : "",
    rightParts
  };
}

function renderPreviewMeta(previewMeta) {
  const rightParts = Array.isArray(previewMeta.rightParts)
    ? previewMeta.rightParts
    : (previewMeta.right ? [previewMeta.right] : []);
  const leftPart = safeText(previewMeta.left || "");
  const normalizedParts = rightParts.map((part) => safeText(part));
  const slots = leftPart ? [leftPart, ...normalizedParts] : [...normalizedParts];
  const hasFilled = slots.some((part) => part !== "");
  if (!hasFilled) return "";
  const colCount = Math.max(1, slots.length);
  return `
    <div class="section-meta" data-col-count="${colCount}" style="--meta-col-count:${colCount}">
      ${slots.map((part, index) => {
        const empty = part ? "" : " empty";
        const slotClass = index === 0 ? " slot-start" : (index === colCount - 1 ? " slot-end" : " slot-mid");
        const ratio = colCount > 1 ? (index / (colCount - 1)) : 0;
        return `<span class="meta-part${empty}${slotClass}" style="--slot-index:${index};--slot-count:${colCount};--slot-ratio:${ratio}">${part ? escapeHtml(part) : "&nbsp;"}</span>`;
      }).join("")}
    </div>
  `;
}

const inlineFieldMeasureCanvas = document.createElement("canvas");
const inlineFieldMeasureCtx = inlineFieldMeasureCanvas.getContext("2d");

function measureInlineFieldTextWidth(text, style) {
  if (!inlineFieldMeasureCtx) return Math.max(24, String(text || "").length * 12);
  const fontStyle = style?.fontStyle || "normal";
  const fontVariant = style?.fontVariant || "normal";
  const fontWeight = style?.fontWeight || "400";
  const fontSize = style?.fontSize || "15px";
  const fontFamily = style?.fontFamily || "sans-serif";
  inlineFieldMeasureCtx.font = `${fontStyle} ${fontVariant} ${fontWeight} ${fontSize} / ${style?.lineHeight || "normal"} ${fontFamily}`;
  return Math.ceil(inlineFieldMeasureCtx.measureText(String(text || "")).width);
}

function computeInlineFieldAnchors(count, width) {
  if (count <= 0) return [];
  if (count === 1) return [0];
  if (count === 2) return [0, width * 0.5];
  return Array.from({ length: count }, (_, idx) => (width * idx) / (count - 1));
}

function applySectionMetaLayout(metaEl) {
  const parts = Array.from(metaEl.querySelectorAll(".meta-part"));
  if (!parts.length) return;
  const containerWidth = Math.max(1, metaEl.clientWidth);
  const n = parts.length;
  const anchors = computeInlineFieldAnchors(n, containerWidth);
  const defaultStyle = getComputedStyle(parts[0]);
  const baseFontSize = Number.parseFloat(defaultStyle.fontSize || "15") || 15;
  const minFontSize = Math.max(11, baseFontSize - 3);
  const lineHeightRatio = 1.35;
  const lineHeight = baseFontSize * lineHeightRatio;
  const minGap = 12;
  const maxWidthByCount = n >= 5 ? containerWidth * 0.3 : n === 4 ? containerWidth * 0.34 : n === 3 ? containerWidth * 0.42 : containerWidth * 0.48;
  const maxWidth = Math.max(110, maxWidthByCount);
  const minWidth = 18;

  const visibleParts = parts.map((part, index) => ({
    part,
    index,
    text: safeText(part.textContent || "").replace(/\u00A0/g, " ")
  }));

  const layoutAtFontSize = (fontPx) => {
    const placements = visibleParts.map(({ part, index, text }) => {
      if (!text) return { part, index, text, width: 0, left: 0, align: "center", empty: true };
      const measured = measureInlineFieldTextWidth(text, {
        fontStyle: defaultStyle.fontStyle,
        fontVariant: defaultStyle.fontVariant,
        fontWeight: defaultStyle.fontWeight,
        fontSize: `${fontPx}px`,
        fontFamily: defaultStyle.fontFamily,
        lineHeight: `${fontPx * lineHeightRatio}px`
      });
      const width = clamp(measured + 8, minWidth, maxWidth);
      const isFirst = index === 0;
      const isLast = index === n - 1 && n >= 3;
      const align = isFirst ? "left" : (isLast ? "right" : "center");
      const anchor = anchors[index] || 0;
      let left = 0;
      if (align === "left") left = 0;
      else if (align === "right") left = containerWidth - width;
      else left = anchor - (width / 2);
      left = clamp(left, 0, Math.max(0, containerWidth - width));
      return { part, index, text, width, left, align, empty: false, measured };
    });

    for (let i = 1; i < placements.length; i += 1) {
      const curr = placements[i];
      if (curr.empty) continue;
      const prev = placements[i - 1];
      if (prev.empty) continue;
      const minLeft = prev.left + prev.width + minGap;
      if (curr.left < minLeft) curr.left = minLeft;
    }
    for (let i = placements.length - 2; i >= 0; i -= 1) {
      const curr = placements[i];
      if (curr.empty) continue;
      const next = placements[i + 1];
      if (next.empty) continue;
      const maxLeft = next.left - curr.width - minGap;
      if (curr.left > maxLeft) curr.left = maxLeft;
    }
    placements.forEach((p) => {
      if (!p.empty) p.left = clamp(p.left, 0, Math.max(0, containerWidth - p.width));
    });

    let overlap = false;
    for (let i = 1; i < placements.length; i += 1) {
      const curr = placements[i];
      const prev = placements[i - 1];
      if (curr.empty || prev.empty) continue;
      if (curr.left < prev.left + prev.width + minGap - 0.5) {
        overlap = true;
        break;
      }
    }
    return { placements, overlap };
  };

  let resolved = layoutAtFontSize(baseFontSize);
  let chosenFontSize = baseFontSize;
  for (let size = baseFontSize - 0.5; size >= minFontSize && resolved.overlap; size -= 0.5) {
    resolved = layoutAtFontSize(size);
    chosenFontSize = size;
  }

  metaEl.style.height = `${Math.ceil(chosenFontSize * lineHeightRatio)}px`;
  metaEl.style.minHeight = `${Math.ceil(chosenFontSize * lineHeightRatio)}px`;

  resolved.placements.forEach((placement, index) => {
    const { part, empty, text, width, left, align } = placement;
    if (empty) {
      part.style.visibility = "hidden";
      part.style.left = `${Math.round(anchors[index] || 0)}px`;
      part.style.top = "0px";
      part.style.width = "0px";
      part.style.fontSize = `${chosenFontSize}px`;
      return;
    }
    const fontPx = resolved.overlap && index > 0 && index < n - 1 ? Math.max(minFontSize, chosenFontSize - 0.5) : chosenFontSize;
    part.style.visibility = "visible";
    part.style.left = `${Math.round(left)}px`;
    part.style.top = "0px";
    part.style.width = `${Math.round(width)}px`;
    part.style.fontSize = `${fontPx}px`;
    part.style.lineHeight = `${fontPx * lineHeightRatio}px`;
    part.style.transform = "none";
    part.style.textAlign = align;
    part.style.justifyContent = align === "left" ? "flex-start" : (align === "right" ? "flex-end" : "center");
    part.style.whiteSpace = "nowrap";
    part.style.overflow = resolved.overlap ? "hidden" : "visible";
    part.style.textOverflow = resolved.overlap ? "ellipsis" : "clip";
    part.style.wordBreak = "normal";
    part.style.overflowWrap = "normal";
    if (resolved.overlap && text) part.title = text;
    else part.removeAttribute("title");
  });
}

function applyInlineFieldLayouts() {
  refs.resumeSections.querySelectorAll(".section-meta").forEach((metaEl) => applySectionMetaLayout(metaEl));
}

function calculateAge(birth) {
  if (!birth) return "";
  const [year, month] = birth.split("-").map(Number);
  if (!year || !month) return "";
  const now = new Date();
  let age = now.getFullYear() - year;
  if (now.getMonth() + 1 < month) age -= 1;
  return `${age}岁`;
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function renderProfile() {
  refs.previewName.textContent = state.profile.name || "未填写姓名";
  refs.coverName.textContent = state.profile.name || "未填写姓名";
  refs.coverContact.textContent = [state.profile.phone, state.profile.email].filter(Boolean).join(" · ") || "联系方式未填写";
  const labelSet = state.settings.englishLabels ? labels.en : labels.zh;
  const fields = [
    { label: labelSet[0], value: state.profile.age || calculateAge(state.profile.birth) },
    { label: labelSet[1], value: state.profile.gender === "不填" ? "" : state.profile.gender },
    { label: labelSet[2], value: state.profile.political === "不填" ? "" : state.profile.political },
    { label: labelSet[3], value: state.profile.phone },
    { label: labelSet[4], value: state.profile.email },
    { label: labelSet[5], value: state.profile.arrival },
    { label: "工作年限", value: state.profile.workYears === "不填" ? "" : state.profile.workYears },
    { label: "婚姻状况", value: state.profile.marital === "不填" ? "" : state.profile.marital },
    { label: "身高", value: state.profile.height },
    { label: "体重", value: state.profile.weight },
    { label: "民族", value: state.profile.ethnicity },
    { label: "籍贯", value: state.profile.domicile }
  ].filter((item) => hasValue(item.value));
  refs.infoGrid.innerHTML = fields
    .map((item) => `<p data-profile-key="${escapeAttr(item.label)}"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></p>`)
    .join("");
  state.profile.custom.filter((item) => item.key || item.value).forEach((item) => {
    const row = document.createElement("p");
    row.className = "custom-preview";
    row.innerHTML = `<span>${escapeHtml(item.key || "自定义")}</span><strong>${escapeHtml(item.value || "")}</strong>`;
    refs.infoGrid.appendChild(row);
  });
  syncHeadInfoRowGap();

  refs.photoWrap.classList.toggle("hide-photo", !state.profile.showPhoto);
  refs.photoWrap.classList.toggle("has-photo", Boolean(state.profile.photo));
  refs.previewPhoto.src = state.profile.photo || "";
  const photoNameNode = document.getElementById("photoFileName");
  if (photoNameNode) photoNameNode.textContent = shortenFileName(state.profile.photoFileName);
}

function renderSections() {
  refs.resumeSections.innerHTML = getRenderSections()
    .map((item) => {
        if (item.type === "placeholder") {
          return `<section class="resume-section sortable-placeholder" style="height:${item.height}px"></section>`;
        }
        const items = item.items.map((entry) => {
          const previewMeta = getItemPreviewMeta(item, entry);
          const meta = renderPreviewMeta(previewMeta);
          const directEdit = FETCHCV_PREVIEW_ONLY
            ? ""
            : ` contenteditable="true" spellcheck="true" data-preview-body="true" data-item-id="${escapeAttr(entry.id)}" aria-label="直接编辑${escapeAttr(item.tab)}正文"`;
          return `<div class="section-item">${meta}<div class="section-body"${directEdit} style="${escapeAttr(getItemTextBlockStyle(entry))}">${formatBody(entry.body)}</div></div>`;
        }).join("");
      return `
        <section class="resume-section sortable-section ${item.id === state.activeSectionId ? "selected-section" : ""} ${item.id === state.draggingSectionId ? "is-dragging" : ""}" data-sortable-module="true" data-section-id="${item.id}" style="--module-x:${Number(item.offsetX || 0)}px; --module-line-height:${Number(item.lineHeight || state.settings.lineHeight) / 100}">
          <h2 class="section-title"><span>${escapeHtml(item.title || item.tab)}</span></h2>
          <div class="section-content">${items}</div>
        </section>
      `;
    })
    .join("");
  applyInlineFieldLayouts();
}

function getRenderSections() {
  const visible = state.sections.filter((item) => item.visible);
  if (!state.draggingSectionId) return visible;
  const dragged = visible.find((item) => item.id === state.draggingSectionId);
  const withoutDragged = visible.filter((item) => item.id !== state.draggingSectionId);
  const placeholder = {
    id: "__placeholder",
    type: "placeholder",
    height: state.dragPlaceholderHeight || 80
  };
  const index = clamp(Number(state.placeholderVisibleIndex || 0), 0, withoutDragged.length);
  withoutDragged.splice(index, 0, placeholder);
  return withoutDragged;
}

function renderExtras() {
  refs.coverSheet.classList.toggle("show", state.settings.cover);
  refs.letterSheet.classList.toggle("show", Boolean(state.settings.letter.trim()));
  refs.letterPreview.textContent = state.settings.letter;
}

function renderTabs() {
  refs.tabStrip.innerHTML = [
    `<button type="button" class="module-nav-item ${state.activeTab === "profile" ? "active" : ""}" data-tab="profile">
      <span>基本信息</span><small>固定</small>
    </button>`,
    ...getRenderTabSections().map((item) => {
      if (item.type === "placeholder") {
        return `<div class="module-nav-item sidebar-sortable-placeholder" style="height:${item.height}px"></div>`;
      }
      const isRenaming = state.renamingSectionId === item.id;
      const nameMarkup = isRenaming
        ? `<input class="module-rename-input" data-rename-section-id="${item.id}" value="${escapeAttr(item.tab)}" />`
        : `<span class="module-name">${escapeHtml(item.tab)}</span>`;
      return `
        <div class="module-nav-item ${item.visible ? "" : "hidden-section"} ${state.activeTab === "section" && item.id === state.activeSectionId ? "active" : ""} ${state.sidebarDraggingSectionId === item.id ? "sidebar-drag-origin" : ""}"
          data-tab="section" data-section-id="${item.id}" draggable="${isRenaming ? "false" : "true"}">
          <span class="module-drag" aria-hidden="true">
            <svg viewBox="0 0 20 20" focusable="false">
              <path d="M7 5.5v9"></path>
              <path d="M10 5.5v9"></path>
              <path d="M13 5.5v9"></path>
            </svg>
          </span>
          ${nameMarkup}
          <span class="module-actions">
            <button type="button" class="tab-tool module-menu-trigger" data-tab-menu-trigger="true" data-section-id="${item.id}" title="模块操作" aria-label="打开${escapeAttr(item.tab)}操作菜单" aria-haspopup="menu" aria-expanded="false">
              <svg class="tab-tool-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="5" cy="12" r="1.7"></circle>
                <circle cx="12" cy="12" r="1.7"></circle>
                <circle cx="19" cy="12" r="1.7"></circle>
              </svg>
            </button>
            <span class="module-action-menu" role="menu" aria-label="${escapeAttr(item.tab)}操作">
              <button type="button" role="menuitem" data-tab-action="toggle" data-section-id="${item.id}">${item.visible ? "隐藏模块" : "显示模块"}</button>
              <button type="button" role="menuitem" data-tab-action="edit" data-section-id="${item.id}">重命名</button>
              <button type="button" role="menuitem" data-tab-action="duplicate" data-section-id="${item.id}">复制模块</button>
              ${item.builtin ? "" : `<button type="button" class="danger" role="menuitem" data-tab-action="delete" data-section-id="${item.id}">删除模块</button>`}
            </span>
          </span>
        </div>
      `;
    }),
    `<button type="button" class="module-nav-item tab-add" data-tab-action="add">
      <span class="tab-add-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M12 5v14"></path>
          <path d="M5 12h14"></path>
        </svg>
      </span>
      <span>新增模块</span>
    </button>`
  ].join("");
  const renameInput = refs.tabStrip.querySelector(".module-rename-input");
  if (renameInput) {
    requestAnimationFrame(() => {
      renameInput.focus();
      renameInput.select();
    });
  }
}

function renderEditor() {
  refs.drawerContent.dataset.active = state.activeTab;
  if (state.activeTab === "profile") return;
  const active = getActiveSection();
  coerceSkillsSectionToPlainText(active);
  ensureSectionFields(active);
  const schema = getSectionSchema(active);
  refs.activeSectionTitle.textContent = active.tab;
  refs.sectionVisibleInput.checked = active.visible;
  const toggleEntries = getOrderedToggleEntries(active, schema);
  const skillsLike = isSkillsSection(active);
  const isSelfSection = active.id === "self" || getSectionKind(active) === "self";
  const supportsFieldToggles = !skillsLike && !isSelfSection;
  const toggles = supportsFieldToggles ? `<div class="field-visibility-row">
      <span>显示字段</span>
      ${toggleEntries.map(([key, label], index) => {
        const isCustom = (active.customFields || []).some((field) => field.key === key);
        const removeBtn = isCustom ? `<button class="mini-btn custom-toggle-remove" type="button" data-remove-custom-field="${key}" title="删除字段">×</button>` : "";
        const moveLeftBtn = `<button class="mini-btn field-order-btn" type="button" data-shift-field-order="${key}" data-shift-step="-1" title="左移字段" ${index === 0 ? "disabled" : ""}>‹</button>`;
        const moveRightBtn = `<button class="mini-btn field-order-btn" type="button" data-shift-field-order="${key}" data-shift-step="1" title="右移字段" ${index === toggleEntries.length - 1 ? "disabled" : ""}>›</button>`;
        return `<label class="field-toggle">${moveLeftBtn}<input type="checkbox" data-field-visible="${key}" ${active.fieldVisibility?.[key] === false ? "" : "checked"} /><span class="field-toggle-text">${label}</span>${moveRightBtn}${removeBtn}</label>`;
      }).join("")}
      <button class="ghost-btn add-field-btn" type="button" data-add-custom-field="true">+ 添加字段</button>
    </div>` : "";
  refs.itemList.innerHTML = `${active.items.map((item, index) => `
    <div class="item-card" data-item-id="${item.id}">
      <div class="item-card-head">
        <strong>${escapeHtml(active.tab)} <span class="item-sequence">${String(index + 1).padStart(2, "0")}</span></strong>
        <button type="button" class="danger-btn" data-delete-item="${item.id}">删除</button>
      </div>
        ${index === 0 ? toggles : ""}
        ${renderItemFields(active, item, schema)}
        <div class="rich-toolbar" data-toolbar-for="${item.id}" role="toolbar" aria-label="文字格式">
          <div class="toolbar-group toolbar-group-history" aria-label="编辑历史">
          <button type="button" data-command="undo" data-tooltip="撤销 Ctrl+Z" aria-keyshortcuts="Control+Z Meta+Z" aria-label="撤销 Ctrl+Z" disabled>↶</button>
          <button type="button" data-command="redo" data-tooltip="重做 Ctrl+Y" aria-keyshortcuts="Control+Y Meta+Y" aria-label="重做 Ctrl+Y" disabled>↷</button>
          </div>
          <div class="toolbar-group toolbar-group-typography">
          <select class="toolbar-select toolbar-paragraph-style" data-block-style="paragraphPreset" title="段落样式" aria-label="段落样式">
            <option value="">正文</option>
            <option value="subtitle">小标题</option>
            <option value="title">标题</option>
          </select>
          <select class="toolbar-select toolbar-size" data-command="styleFontSize" title="字号">
            <option value="">字号</option>
            ${wordFontSizes().map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}
          </select>
          <select class="toolbar-select toolbar-font" data-command="fontName" title="字体">
            <option value="">字体</option>
            ${fontFamilyOptions().map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}
          </select>
          <select class="toolbar-select toolbar-line-height" data-block-style="lineHeight" title="行距">
            <option value="">行距</option>
            ${wordLineHeights().map(([value, label]) => `<option value="${value}" ${Math.abs(Number(item.richStyle?.lineHeight || 1.65) - Number(value)) < 0.01 ? "selected" : ""}>${label}</option>`).join("")}
          </select>
          </div>
          <div class="toolbar-group toolbar-group-style">
          <button type="button" data-command="bold" data-command-label="加粗" data-shortcut="Ctrl+B" data-tooltip="加粗 Ctrl+B" aria-keyshortcuts="Control+B Meta+B" aria-label="加粗 Ctrl+B">B</button>
          <button type="button" data-command="italic" data-command-label="斜体" data-shortcut="Ctrl+I" data-tooltip="斜体 Ctrl+I" aria-keyshortcuts="Control+I Meta+I" aria-label="斜体 Ctrl+I"><i>I</i></button>
          <button type="button" data-command="underline" data-command-label="下划线" data-shortcut="Ctrl+U" data-tooltip="下划线 Ctrl+U" aria-keyshortcuts="Control+U Meta+U" aria-label="下划线 Ctrl+U"><u>U</u></button>
          <button type="button" data-command="strikeThrough" data-command-label="删除线" data-tooltip="删除线" aria-label="删除线"><s>S</s></button>
          <label class="toolbar-color-control" data-tooltip="文字颜色" aria-label="文字颜色"><span class="text-color-symbol">A</span><input type="color" data-command="foreColor" value="#17202a" /></label>
          <label class="toolbar-color-control" data-tooltip="标记颜色" aria-label="标记颜色"><span class="highlight-color-symbol">A</span><input type="color" data-command="hiliteColor" value="#f4d7a1" /></label>
          </div>
          <div class="toolbar-group toolbar-group-list">
          <button type="button" data-command="insertUnorderedList" data-command-label="项目符号" data-shortcut="Ctrl+Shift+8" data-tooltip="项目符号列表 Ctrl+Shift+8" aria-keyshortcuts="Control+Shift+8 Meta+Shift+8" aria-label="项目符号列表 Ctrl+Shift+8">•</button>
          <button type="button" data-command="insertOrderedList" data-command-label="编号列表" data-shortcut="Ctrl+Shift+7" data-tooltip="编号列表 Ctrl+Shift+7" aria-keyshortcuts="Control+Shift+7 Meta+Shift+7" aria-label="编号列表 Ctrl+Shift+7">1.</button>
          </div>
          <div class="toolbar-group toolbar-group-align">
          <button type="button" data-command="justifyLeft" data-command-label="左对齐" data-shortcut="Ctrl+Shift+L" data-tooltip="左对齐 Ctrl+Shift+L" aria-keyshortcuts="Control+Shift+L Meta+Shift+L" aria-label="左对齐 Ctrl+Shift+L"><span class="toolbar-icon align-left" aria-hidden="true"></span></button>
          <button type="button" data-command="justifyCenter" data-command-label="居中" data-shortcut="Ctrl+Shift+E" data-tooltip="居中 Ctrl+Shift+E" aria-keyshortcuts="Control+Shift+E Meta+Shift+E" aria-label="居中 Ctrl+Shift+E"><span class="toolbar-icon align-center" aria-hidden="true"></span></button>
          <button type="button" data-command="justifyRight" data-command-label="右对齐" data-shortcut="Ctrl+Shift+R" data-tooltip="右对齐 Ctrl+Shift+R" aria-keyshortcuts="Control+Shift+R Meta+Shift+R" aria-label="右对齐 Ctrl+Shift+R"><span class="toolbar-icon align-right" aria-hidden="true"></span></button>
          <button type="button" data-command="justifyFull" data-command-label="两端对齐" data-tooltip="两端对齐" aria-label="两端对齐"><span class="toolbar-icon align-justify" aria-hidden="true"></span></button>
          <button type="button" data-command="outdent" data-command-label="减少缩进" data-tooltip="减少段落缩进" aria-label="减少段落缩进">⇤</button>
          <button type="button" data-command="indent" data-command-label="增加缩进" data-tooltip="增加段落缩进" aria-label="增加段落缩进">⇥</button>
          </div>
          <div class="toolbar-group toolbar-group-clean toolbar-group-end">
          <button type="button" data-command="createLink" data-command-label="添加链接" data-tooltip="添加链接" aria-label="添加链接">链接</button>
          <button type="button" data-command="unlink" data-command-label="取消链接" data-tooltip="取消链接" aria-label="取消链接">断开</button>
          <button type="button" data-command="removeFormat" data-command-label="清除格式" data-tooltip="清除格式" aria-label="清除格式"><span class="toolbar-icon clear-format" aria-hidden="true"></span></button>
          </div>
          <div class="toolbar-meta" aria-live="polite">
            <span class="toolbar-selection-status">正文</span>
            <span class="toolbar-shortcuts"><kbd>Ctrl+B</kbd><kbd>Ctrl+Z</kbd><kbd>Ctrl+Shift+7/8</kbd></span>
          </div>
        </div>
        <div class="rich-editor" contenteditable="true" data-item-field="body" style="${escapeAttr(getItemTextBlockStyle(item))}">${formatBody(item.body)}</div>
      </div>
  `).join("")}
    <div class="row-actions item-list-actions">
      <button class="ghost-btn" id="addItemBtn" type="button">新增条目</button>
      <button class="ghost-btn" id="duplicateSectionBtn" type="button">复制模块</button>
      <button class="danger-btn" id="clearSectionBtn" type="button">清空内容</button>
    </div>
  `;
  bindItemActionButtons();
  requestAnimationFrame(adjustFloatingPopovers);
}

function renderItemFields(sectionItem, item, schema) {
  if (isSkillsSection(sectionItem) || schema === sectionSchemas.skills) return "";
  const visible = sectionItem.fieldVisibility || {};
  const fieldDefs = getOrderedFieldDefs(sectionItem, schema);
  const controls = fieldDefs
    .filter((field) => visible[field.key] !== false)
    .map((field) => {
      if (field.type === "monthrange") return renderMonthRangeField(item);
      const rawValue = item.fields?.[field.key] || "";
      const value = typeof rawValue === "string" ? plainFieldText(rawValue) : rawValue;
      if (item.fields && typeof rawValue === "string" && value !== rawValue) item.fields[field.key] = value;
      const type = field.type || "text";
      const current = field.currentKey
        ? `<label class="current-check"><input type="checkbox" data-item-field="${field.currentKey}" ${item.fields?.[field.currentKey] ? "checked" : ""} />至今</label>`
        : "";
      return `<label>${field.label}<span class="field-input-line"><input type="${type}" data-item-field="${field.key}" value="${escapeAttr(value)}" />${current}</span></label>`;
    }).join("");
  return controls ? `<div class="item-grid dynamic-fields">${controls}</div>` : "";
}

function renderMonthRangeField(item) {
  const range = item.fields?.timeRange || {};
  const pickerState = state.activeMonthRange || {};
  const isOpen = pickerState.itemId === item.id;
  const manualPart = isOpen && pickerState.manual ? pickerState.stage : "";
  const endDisabled = range.current ? "disabled" : "";
  const openStateClass = isOpen ? `open ${pickerState.suppressOpenAnimation ? "suppress-open-anim" : ""}`.trim() : "";
  return `
      <label class="monthrange-label">时间
        <div class="monthrange-control ${openStateClass}" data-monthrange-control="true" data-item-id="${item.id}" data-range-stage="${isOpen ? pickerState.stage || "start" : "start"}">
         <input class="monthrange-input ${isOpen && (pickerState.stage || "start") === "start" ? "active" : ""}" data-time-part="start" value="${escapeAttr(getMonthRangeDisplayPart(range.start))}" placeholder="开始月份" inputmode="numeric" ${manualPart === "start" ? "" : "readonly"} />
          <span class="range-separator">至</span>
         <input class="monthrange-input ${isOpen && (pickerState.stage || "start") === "end" ? "active" : ""}" data-time-part="end" value="${range.current ? "" : escapeAttr(getMonthRangeDisplayPart(range.end))}" placeholder="结束月份" inputmode="numeric" ${manualPart === "end" ? "" : "readonly"} ${endDisabled} />
          <label class="current-check"><input type="checkbox" data-time-current="true" ${range.current ? "checked" : ""} />至今</label>
          <div class="monthrange-popover" data-monthrange-popover="true">
            ${renderMonthPanels(item, pickerState)}
          </div>
        </div>
      </label>
    `;
}

function renderMonthPanels(item, pickerState = {}) {
  const range = item.fields?.timeRange || {};
  const hoverMonth = pickerState.stage === "end" ? normalizeMonthValue(pickerState.hoverMonth || "") : "";
  const dynamicEnd = hoverMonth || range.end;
  const startYear = Number(pickerState.startYear || (range.start || currentMonthValue()).slice(0, 4));
  const endYear = Number(pickerState.endYear || (dynamicEnd || range.start || currentMonthValue()).slice(0, 4)) + (pickerState.endYear ? 0 : 1);
  return `
      <div class="monthrange-panels">
       ${renderMonthPanel(startYear, "start", range.start, pickerState.stage || "start", range.start, dynamicEnd, hoverMonth)}
       ${renderMonthPanel(endYear, "end", range.end, pickerState.stage || "start", range.start, dynamicEnd, hoverMonth)}
      </div>
    `;
}

function renderMonthPanel(year, part, selected, stage = "start", rangeStart = "", rangeEnd = "", hoverMonth = "") {
  const normalizedStart = normalizeMonthValue(rangeStart);
  const normalizedEnd = normalizeMonthValue(rangeEnd);
  const hasRange = normalizedStart && normalizedEnd;
  const lower = hasRange ? (normalizedStart <= normalizedEnd ? normalizedStart : normalizedEnd) : "";
  const upper = hasRange ? (normalizedStart <= normalizedEnd ? normalizedEnd : normalizedStart) : "";
  const rows = Array.from({ length: 3 }, (_, rowIndex) => {
    const months = Array.from({ length: 4 }, (_, colIndex) => {
      const month = rowIndex * 4 + colIndex + 1;
      const value = `${year}-${String(month).padStart(2, "0")}`;
      const isHoverEnd = hoverMonth && hoverMonth === value;
      const classes = [
        normalizeMonthValue(selected) === value ? "active" : "",
        part === stage ? "panel-active" : "",
        hasRange && value > lower && value < upper ? "in-range" : "",
        normalizedStart === value ? "range-start" : "",
        normalizedEnd === value ? "range-end" : "",
        isHoverEnd ? "range-hover-end" : ""
      ].filter(Boolean).join(" ");
      return `<button type="button" class="${classes}" data-pick-month="${value}" data-time-part="${part}">${month}月</button>`;
    }).join("");
    return `<div class="month-grid-row">${months}</div>`;
  }).join("");
  return `
    <div class="month-panel" data-panel-part="${part}" data-panel-year="${year}">
      <div class="month-panel-head">
        <button type="button" data-shift-year="${part}" data-year-delta="-1">‹</button>
        <strong>${year}年</strong>
        <button type="button" data-shift-year="${part}" data-year-delta="1">›</button>
      </div>
      <div class="month-grid">${rows}</div>
    </div>
  `;
}

function renderCustomInfo() {
  refs.customInfo.innerHTML = state.profile.custom.map((item, index) => `
    <label>名称<input data-custom-key="${index}" value="${escapeAttr(item.key)}" placeholder="例如：籍贯" /></label>
    <label>内容<input data-custom-value="${index}" value="${escapeAttr(item.value)}" placeholder="例如：福建厦门" /></label>
    <button type="button" class="danger-btn" data-remove-custom="${index}">删除</button>
  `).join("");
}

function renderSettings() {
  const titleMap = { layout: "页面设置", type: "字体与字号", skin: "模板配色", title: "标题设置", cover: "封面设置", letter: "自荐信" };
  const panelChanged = refs.settingsCard.dataset.activePanel !== state.activeSettings;
  refs.settingsCard.dataset.activePanel = state.activeSettings;
  refs.settingsTitle.textContent = titleMap[state.activeSettings] || "设置";
  $$(".tool-btn[data-panel]").forEach((button) => button.classList.toggle("active", button.dataset.panel === state.activeSettings));
  $("#templateBtn").classList.toggle("active", state.template === "compact");
  $$(".settings-panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.settings === state.activeSettings));
  if (panelChanged) {
    const activePanel = refs.settingsCard.querySelector(`.settings-panel[data-settings="${state.activeSettings}"]`);
    if (activePanel) {
      activePanel.classList.remove("panel-switch-in");
      void activePanel.offsetWidth;
      activePanel.classList.add("panel-switch-in");
    }
  }
  $("#swatches").innerHTML = themes.map((theme, index) => `<button class="swatch ${index === state.settings.themeIndex ? "active" : ""}" data-theme-index="${index}" style="--swatch:${theme.accent}"></button>`).join("");
  $("#customAccentPicker").value = normalizeHexColor(state.settings.customAccent, "#1f3b5c");
  $("#customAccent2Picker").value = normalizeHexColor(state.settings.customAccent2, "#3f5f84");
  $("#customStagePicker").value = normalizeHexColor(state.settings.customStage, "#eef1f5");
  $("#customAccentInput").value = state.settings.customAccent || "#1f3b5c";
  $("#customAccent2Input").value = state.settings.customAccent2 || "#3f5f84";
  $("#customStageInput").value = state.settings.customStage || "#eef1f5";
  renderModuleAdjust();
}

function renderModuleAdjust() {
  refs.moduleAdjustCard.classList.add("hidden");
  const active = getActiveSection();
  refs.moduleAdjustTitle.textContent = `${active.tab} 位置`;
  refs.selectedSectionXRange.value = active.offsetX || 0;
  refs.selectedSectionLineRange.value = active.lineHeight || state.settings.lineHeight;
  refs.selectedSectionXNumber.value = active.offsetX || 0;
  refs.selectedSectionLineNumber.value = active.lineHeight || state.settings.lineHeight;
  updateRangeProgress(refs.selectedSectionXRange);
  updateRangeProgress(refs.selectedSectionLineRange);
  refs.moduleAdjustCard.style.transform = `translate(${Number(state.settings.adjustPanelX || 0)}px, ${Number(state.settings.adjustPanelY || 0)}px)`;
}

function getActiveThemeColors() {
  return themes[state.settings.themeIndex] || {
    accent: state.settings.customAccent || "#1f3b5c",
    accent2: state.settings.customAccent2 || "#3f5f84",
    stage: state.settings.customStage || "#eef1f5"
  };
}

function applyThemeCssVariables() {
  const theme = getActiveThemeColors();
  document.documentElement.style.setProperty("--accent", theme.accent);
  document.documentElement.style.setProperty("--accent-2", theme.accent2);
  document.documentElement.style.setProperty("--stage", theme.stage);
}

function syncSwatchActiveState() {
  const swatches = document.getElementById("swatches");
  if (!swatches) return;
  swatches.querySelectorAll("[data-theme-index]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.themeIndex) === Number(state.settings.themeIndex));
  });
}

let themeRefreshFrame = null;
function scheduleThemeCssRefresh() {
  if (themeRefreshFrame) return;
  themeRefreshFrame = requestAnimationFrame(() => {
    themeRefreshFrame = null;
    applyThemeCssVariables();
  });
}

function applyStyles() {
  applyThemeCssVariables();
  const fitScale = clamp(Number(state.settings.fitScale || 1), 0.76, ONE_PAGE_FILL_LIMITS.fitScale);
  document.documentElement.style.setProperty("--fit-scale", String(fitScale));
  document.documentElement.style.setProperty("--paper-pad", `${Number(state.settings.margin || 0) * fitScale}px`);
  document.documentElement.style.setProperty("--section-gap", `${Number(state.settings.spacing || 0) * fitScale}px`);
  document.documentElement.style.setProperty("--section-fill-gap", `${Math.max(0, Number(state.settings.verticalFillGap || 0))}px`);
  document.documentElement.style.setProperty("--resume-line-height", state.settings.lineHeight / 100);
  document.documentElement.style.setProperty("--resume-font-size", `${Number(state.settings.fontSize || 15) * fitScale}px`);
  document.documentElement.style.setProperty("--resume-font", state.settings.fontFamily);
  const basicHeight = Number(state.settings.basicHeight || 190);
  const scaledBasicHeight = basicHeight * fitScale;
  const displayNameSize = basicHeight <= 112
    ? Math.min(Number(state.settings.nameSize || 28), 24)
    : Number(state.settings.nameSize || 28);
  document.documentElement.style.setProperty("--name-size", `${displayNameSize * fitScale}px`);
  applyHeadOffsetCssVars();
  document.documentElement.style.setProperty("--basic-head-height", `${scaledBasicHeight}px`);
  const basicScale = clamp(basicHeight / 138, 0.75, 1.6);
  const photoHeight = clamp(scaledBasicHeight, 78, 220);
  const photoWidth = clamp(Math.round(photoHeight * (104 / 132)), 72, 126);
  const infoColumns = clamp(Number(state.settings.infoColumns || 3), 2, 3);
  const infoRowGap = clamp((basicHeight <= 112 ? 5 : 7) * fitScale, 4, 8);
  const infoLabelWidth = 58 * fitScale;
  const infoColumnGap = clamp(26 * fitScale, 22, 32);
  const infoFontSize = clamp(Number(state.settings.fontSize || 15), 12.2, 13.8) * fitScale;
  const nameBlockHeight = clamp(Math.round(scaledBasicHeight * 0.34), 30, 58);
  document.documentElement.style.setProperty("--basic-scale", String(basicScale));
  document.documentElement.style.setProperty("--photo-width", `${photoWidth}px`);
  document.documentElement.style.setProperty("--head-gap", `${clamp(28 * fitScale, 20, 34)}px`);
  document.documentElement.style.setProperty("--info-columns", String(infoColumns));
  document.documentElement.style.setProperty("--info-font-size", `${infoFontSize}px`);
  document.documentElement.style.setProperty("--info-label-width", `${infoLabelWidth}px`);
  document.documentElement.style.setProperty("--info-column-gap", `${infoColumnGap}px`);
  document.documentElement.style.setProperty("--info-row-gap", `${infoRowGap}px`);
  document.documentElement.style.setProperty("--name-block-height", `${nameBlockHeight}px`);
  document.documentElement.style.setProperty("--preview-column", `${Number(state.previewWidth || 56)}%`);
  setPreviewZoom(state.previewZoom || 0.5, { render: false });
  applyPreviewOffset();
  refs.resumePage.classList.toggle("template-compact", state.template === "compact");
  refs.resumePage.classList.toggle("title-line", state.settings.titleStyle === "line");
  refs.resumePage.classList.toggle("title-plain", state.settings.titleStyle === "plain");
  refs.resumePage.classList.remove("show-guides");
  refs.editorDrawer.classList.toggle("open", state.drawerOpen);
  document.body.classList.toggle("editor-collapsed", !state.drawerOpen);
  refs.drawerLabel.textContent = state.drawerOpen ? "收起填写区" : "展开填写区";
  refs.drawerHandle.setAttribute("aria-expanded", String(Boolean(state.drawerOpen)));
  document.body.classList.toggle("module-sidebar-collapsed", Boolean(state.moduleSidebarCollapsed));
  refs.drawerContent.classList.toggle("sidebar-collapsed", Boolean(state.moduleSidebarCollapsed));
  refs.moduleSidebar.classList.toggle("collapsed", Boolean(state.moduleSidebarCollapsed));
  refs.toggleModuleSidebarBtn.textContent = "‹";
  refs.toggleModuleSidebarBtn.title = "收起模块调整";
  refs.toggleModuleSidebarBtn.setAttribute("aria-label", refs.toggleModuleSidebarBtn.title);
  refs.toggleModuleSidebarBtn.setAttribute("aria-expanded", String(!state.moduleSidebarCollapsed));
  refs.moduleSidebarFloatToggle.title = "展开模块调整";
  refs.moduleSidebarFloatToggle.setAttribute("aria-label", "展开模块调整");
  refs.moduleSidebarFloatToggle.setAttribute("aria-expanded", String(!state.moduleSidebarCollapsed));
  refs.previewBtn.classList.toggle("active", !state.drawerOpen);
  refs.previewBtn.title = state.drawerOpen ? "预览简历" : "返回内容编辑";
  refs.previewBtn.setAttribute("aria-pressed", String(!state.drawerOpen));
  const previewLabel = refs.previewBtn.querySelector(":scope > span:last-child");
  if (previewLabel) previewLabel.textContent = state.drawerOpen ? "预览" : "返回编辑";
  if (FETCHCV_EMBEDDED) refs.settingsCard.style.removeProperty("transform");
  else refs.settingsCard.style.transform = `translate(${Number(state.settings.settingsPanelX || 0)}px, ${Number(state.settings.settingsPanelY || 0)}px)`;
}

function syncHeadInfoRowGap() {
  if (!refs.infoGrid) return;
  const totalRows = refs.infoGrid.querySelectorAll("p").length;
  if (!totalRows) return;
  const fitScale = clamp(Number(state.settings.fitScale || 1), 0.76, ONE_PAGE_FILL_LIMITS.fitScale);
  const basicHeight = Number(state.settings.basicHeight || 132);
  const infoColumns = clamp(Number(state.settings.infoColumns || 3), 2, 3);
  const rowCount = Math.max(1, Math.ceil(totalRows / infoColumns));
  const infoFontSize = clamp(Number(state.settings.fontSize || 15), 12.2, 13.8) * fitScale;
  const scaledBasicHeight = basicHeight * fitScale;
  const nameBlockHeight = clamp(Math.round(scaledBasicHeight * 0.34), 30, 58);
  const infoAreaHeight = Math.max(30, scaledBasicHeight - nameBlockHeight);
  const rowHeight = Math.round(infoFontSize * 1.55);
  const rowGap = rowCount <= 1
    ? 0
    : clamp(Math.round((infoAreaHeight - rowHeight * rowCount) / (rowCount - 1)), 0, 6 * fitScale);
  document.documentElement.style.setProperty("--info-row-gap", `${rowGap}px`);
}

function setPreviewZoom(value, options = {}) {
  state.previewZoom = clamp(Number(value) || 0.5, 0.3, 1.2);
  document.documentElement.style.setProperty("--preview-zoom", String(state.previewZoom));
  syncPreviewPagination();
  if (refs.zoomValue) refs.zoomValue.textContent = `${Math.round(state.previewZoom * 100)}%`;
  clampPreviewOffset();
  applyPreviewOffset();
  if (options.persist) persist();
}

function fitFetchCVCanonicalPreview() {
  if ((!FETCHCV_PREVIEW_ONLY && state.drawerOpen) || !refs.previewViewport) return;
  const availableWidth = Math.max(320, refs.previewViewport.clientWidth - 56);
  const scale = clamp(availableWidth / 794, 0.42, 0.86);
  state.previewOffsetX = 0;
  state.previewOffsetY = 0;
  setPreviewZoom(scale, { persist: false });
}

function applyPreviewOffset() {
  document.documentElement.style.setProperty("--preview-offset-x", `${Number(state.previewOffsetX || 0)}px`);
  document.documentElement.style.setProperty("--preview-offset-y", `${Number(state.previewOffsetY || 0)}px`);
}

function getLineStepFromElement(sampleEl) {
  const style = sampleEl ? getComputedStyle(sampleEl) : null;
  const fontSize = style ? Number.parseFloat(style.fontSize || "14") : 14;
  const rawLine = style ? Number.parseFloat(style.lineHeight || "") : NaN;
  return clamp(Number.isFinite(rawLine) ? rawLine : fontSize * 1.66, 14, 44);
}

function getOffsetTopRelative(node, ancestor) {
  let top = 0;
  let current = node;
  while (current && current !== ancestor) {
    top += current.offsetTop || 0;
    current = current.offsetParent;
  }
  return top;
}

function collectSafeBreakpoints(source, sourceHeight) {
  if (!source) return [];
  const marks = new Set();
  source.querySelectorAll(".body-line,.section-meta,.section-title,.section-item").forEach((el) => {
    const y = getOffsetTopRelative(el, source) + el.offsetHeight;
    if (Number.isFinite(y) && y > 0 && y < sourceHeight) {
      marks.add(Math.round(y));
    }
  });
  return [...marks].sort((a, b) => a - b);
}

function snapBreakToSafePoint(rawCut, previousCut, lineStep, safeBreaks = []) {
  const minChunk = previousCut + lineStep * 0.6;
  const beforeWindow = Math.max(lineStep * 0.7, 8);
  const afterWindow = Math.max(lineStep * 1.4, 18);
  let best = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < safeBreaks.length; i += 1) {
    const value = safeBreaks[i];
    if (value <= minChunk) continue;
    if (value < rawCut - beforeWindow) continue;
    if (value > rawCut + afterWindow) break;
    const delta = value - rawCut;
    const score = delta >= 0 ? delta * 1.35 : Math.abs(delta);
    if (score < bestScore) {
      best = value;
      bestScore = score;
    }
  }
  if (best > 0) return best;
  for (let i = safeBreaks.length - 1; i >= 0; i -= 1) {
    const value = safeBreaks[i];
    if (value <= minChunk) break;
    if (value <= rawCut) return value;
  }
  let snapped = Math.floor(rawCut / lineStep) * lineStep;
  if (snapped <= minChunk) snapped = previousCut + lineStep;
  return snapped;
}

function getPagedLayoutMetrics(totalHeight) {
  const pageHeight = A4_PAGE_HEIGHT_PX;
  const marginBase = Number(state.settings.margin || 30);
  const firstBottomInset = 0;
  const nextTopInset = 1;
  const nextBottomInset = 1;
  const sourceHeight = Math.max(totalHeight, pageHeight);
  const lineSample = refs.resumePage?.querySelector(".section-body");
  const lineStep = getLineStepFromElement(lineSample);
  const safeBreaks = collectSafeBreakpoints(refs.resumePage, sourceHeight);
  const firstCapacity = Math.max(1, pageHeight - firstBottomInset);
  const nextCapacity = Math.max(1, pageHeight - nextTopInset - nextBottomInset);
  if (sourceHeight <= pageHeight + 1) {
    return {
      pageHeight,
      firstBottomInset,
      nextTopInset,
      nextBottomInset,
      firstCapacity,
      nextCapacity,
      pageCount: 1,
      stackHeight: pageHeight,
      sourceHeight,
      lineStep,
      safeBreaks,
      offsets: [0],
      segments: [{ offset: 0, contentHeight: sourceHeight, topInset: 0 }]
    };
  }
  const offsets = [0];
  let guard = 0;
  while (guard < 500) {
    const prev = offsets[offsets.length - 1];
    const capacity = offsets.length === 1 ? firstCapacity : nextCapacity;
    if ((prev + capacity) >= (sourceHeight - 1)) break;
    const rawCut = prev + capacity;
    const nextCut = snapBreakToSafePoint(rawCut, prev, lineStep, safeBreaks);
    offsets.push(Math.min(nextCut, sourceHeight));
    guard += 1;
  }
  const pageCount = offsets.length;
  const segments = offsets.map((offset, index) => {
    const nextOffset = index + 1 < offsets.length ? offsets[index + 1] : sourceHeight;
    const contentHeight = Math.max(1, nextOffset - offset);
    return {
      offset,
      contentHeight,
      topInset: index === 0 ? 0 : nextTopInset
    };
  });
  const stackHeight = pageCount * pageHeight + Math.max(0, pageCount - 1) * PREVIEW_PAGE_GAP_PX;
  return {
    pageHeight,
    firstBottomInset,
    nextTopInset,
    nextBottomInset,
    firstCapacity,
    nextCapacity,
    pageCount,
    stackHeight,
    sourceHeight,
    lineStep,
    safeBreaks,
    offsets,
    segments
  };
}

function measureResumeContentHeight(source = refs.resumePage) {
  if (!source) return A4_PAGE_HEIGHT_PX;
  // Never use scrollHeight here: pagination deliberately increases min-height,
  // and Chromium variants round that value differently. Content bounds are
  // measured in the unscaled A4 coordinate system and can shrink again.
  const actualHeight = measureResumeActualContentHeight(source);
  return Math.max(A4_PAGE_HEIGHT_PX, Math.ceil(actualHeight + 0.5));
}

function measureResumeActualContentHeight(source = refs.resumePage) {
  const bounds = measureResumeContentBounds(source);
  return Math.max(1, Math.ceil(bounds.actualHeight));
}

function measureResumeContentBounds(source = refs.resumePage) {
  if (!source) {
    return {
      top: 0,
      contentBottom: A4_PAGE_HEIGHT_PX,
      paddingBottom: 0,
      actualHeight: A4_PAGE_HEIGHT_PX,
      visualBottomBlank: 0
    };
  }
  const candidates = [
    source.querySelector(".resume-head"),
    source.querySelector("#resumeSections"),
    source.querySelector(".letter-sheet.show"),
    source.querySelector(".cover-sheet.show"),
    ...source.querySelectorAll(".resume-section")
  ].filter(Boolean);
  let minTop = Number.POSITIVE_INFINITY;
  let maxBottom = 0;
  candidates.forEach((node) => {
    const top = getOffsetTopRelative(node, source);
    const bottom = getOffsetTopRelative(node, source) + (node.offsetHeight || 0);
    if (Number.isFinite(top)) minTop = Math.min(minTop, top);
    if (Number.isFinite(bottom)) maxBottom = Math.max(maxBottom, bottom);
  });
  const style = getComputedStyle(source);
  const paddingBottom = Number.parseFloat(style.paddingBottom || "0") || 0;
  const top = Number.isFinite(minTop) ? Math.max(0, minTop) : 0;
  const contentBottom = Math.max(0, maxBottom);
  return {
    top,
    contentBottom,
    paddingBottom,
    actualHeight: Math.max(1, contentBottom + paddingBottom),
    visualBottomBlank: Math.max(0, A4_PAGE_HEIGHT_PX - contentBottom)
  };
}

function syncPreviewPagination() {
  if (!refs.resumePage || !refs.previewScaleFrame) return;
  const zoom = Number(state.previewZoom || 0.5);
  const source = refs.resumePage;
  const frame = refs.previewScaleFrame;
  const sourceClip = frame.querySelector(".preview-source-clip");
  if (sourceClip) {
    while (sourceClip.firstChild) frame.insertBefore(sourceClip.firstChild, sourceClip);
    sourceClip.remove();
  }
  frame.querySelectorAll(".preview-page-slice").forEach((node) => node.remove());
  if (source.parentElement !== frame) {
    frame.insertBefore(source, frame.firstChild);
  }

  source.style.minHeight = `${A4_PAGE_HEIGHT_PX}px`;
  const contentHeight = measureResumeContentHeight(source);
  const layout = getPagedLayoutMetrics(contentHeight);
  source.style.minHeight = `${layout.sourceHeight}px`;
  source.dataset.pageCount = String(layout.pageCount);
  document.documentElement.style.setProperty("--resume-stack-height", `${layout.stackHeight}px`);

  const firstClip = document.createElement("div");
  firstClip.className = "preview-source-clip";
  firstClip.style.left = "0";
  firstClip.style.top = "0";
  firstClip.style.width = `${A4_PAGE_WIDTH_PX * zoom}px`;
  firstClip.style.height = `${layout.segments[0].contentHeight * zoom}px`;
  frame.insertBefore(firstClip, source);
  firstClip.appendChild(source);

  for (let index = 1; index < layout.segments.length; index += 1) {
    const segment = layout.segments[index];
    const pageTop = (index * layout.pageHeight + index * PREVIEW_PAGE_GAP_PX) * zoom;
    const slice = document.createElement("div");
    slice.className = "preview-page-slice";
    slice.style.top = `${pageTop}px`;
    slice.style.width = `${A4_PAGE_WIDTH_PX * zoom}px`;
    slice.style.height = `${layout.pageHeight * zoom}px`;

    const bodyClip = document.createElement("div");
    bodyClip.className = "preview-page-body-clip";
    bodyClip.style.top = `${segment.topInset * zoom}px`;
    bodyClip.style.height = `${segment.contentHeight * zoom}px`;

    const clone = source.cloneNode(true);
    clone.removeAttribute("id");
    clone.classList.add("preview-page-replica");
    clone.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
    clone.style.position = "absolute";
    clone.style.left = "0";
    clone.style.top = "0";
    clone.style.transform = `translateY(${-segment.offset * zoom}px) scale(${zoom})`;
    clone.style.transformOrigin = "top left";
    clone.style.minHeight = `${layout.sourceHeight}px`;
    clone.style.width = `${A4_PAGE_WIDTH_PX}px`;
    clone.style.boxShadow = "none";
    clone.style.pointerEvents = "none";

    bodyClip.appendChild(clone);
    slice.appendChild(bodyClip);
    frame.appendChild(slice);
  }
}

function getVisualPreviewPageCount() {
  const frame = refs.previewScaleFrame;
  if (!frame) return 1;
  return Math.max(1, 1 + frame.querySelectorAll(".preview-page-slice").length);
}

function getMeasuredPreviewPageCount() {
  const contentHeight = measureResumeActualContentHeight(refs.resumePage);
  return Math.max(1, Math.ceil(Math.max(1, contentHeight - 1) / A4_PAGE_HEIGHT_PX));
}

function getCurrentPreviewPageCount() {
  syncPreviewPagination();
  const count = Number(refs.resumePage?.dataset?.pageCount || 1);
  const dataCount = Number.isFinite(count) && count > 0 ? count : 1;
  return Math.max(dataCount, getVisualPreviewPageCount(), getMeasuredPreviewPageCount());
}

function waitForLayoutFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

async function waitForStableResumeLayout(maxFrames = 8) {
  try {
    if (document.fonts?.ready) await document.fonts.ready;
  } catch {}
  let previous = -1;
  let stableFrames = 0;
  for (let frame = 0; frame < maxFrames; frame += 1) {
    await waitForLayoutFrame();
    const height = measureResumeActualContentHeight(refs.resumePage);
    if (Math.abs(height - previous) <= 0.5) stableFrames += 1;
    else stableFrames = 0;
    previous = height;
    if (stableFrames >= 2) break;
  }
  return previous;
}

async function getCurrentPreviewPageCountAfterLayout() {
  syncPreviewPagination();
  if (refs.resumePage) void refs.resumePage.offsetHeight;
  await waitForStableResumeLayout();
  syncPreviewPagination();
  const count = Number(refs.resumePage?.dataset?.pageCount || 1);
  const dataCount = Number.isFinite(count) && count > 0 ? count : 1;
  return Math.max(dataCount, getVisualPreviewPageCount(), getMeasuredPreviewPageCount());
}

function setSettingTowardValue(key, nextValue, limits = ONE_PAGE_FIT_LIMITS) {
  const limit = Number(limits[key]);
  const current = Number(state.settings[key]);
  if (!Number.isFinite(current) || !Number.isFinite(nextValue)) return false;
  const next = Number.isFinite(limit) ? Math.max(limit, nextValue) : nextValue;
  const rounded = Math.round(next * 100) / 100;
  if (Math.abs(current - rounded) < 0.01) return false;
  state.settings[key] = rounded;
  return true;
}

function setSettingUpToValue(key, nextValue, limits = ONE_PAGE_FILL_LIMITS) {
  const limit = Number(limits[key]);
  const current = Number(state.settings[key]);
  if (!Number.isFinite(current) || !Number.isFinite(nextValue)) return false;
  const next = Number.isFinite(limit) ? Math.min(limit, nextValue) : nextValue;
  const rounded = Math.round(next * 100) / 100;
  if (rounded <= current + 0.01) return false;
  state.settings[key] = rounded;
  return true;
}

function tightenVisibleSectionLineHeights(
  targetLineHeight = Number(state.settings.lineHeight || ONE_PAGE_FIT_LIMITS.lineHeight),
  targetItemLineHeightValue = null
) {
  let changed = false;
  const target = Number(targetLineHeight || state.settings.lineHeight || ONE_PAGE_FIT_LIMITS.lineHeight);
  const targetItemLineHeight = clamp(
    Number(targetItemLineHeightValue || target / 100),
    ONE_PAGE_FIT_LIMITS.itemLineHeight,
    1.65
  );
  state.sections.forEach((sectionItem) => {
    if (!sectionItem || sectionItem.visible === false) return;
    const current = Number(sectionItem.lineHeight || target);
    const next = Math.max(ONE_PAGE_FIT_LIMITS.lineHeight, Math.min(current, target));
    if (sectionItem.lineHeight !== next) {
      sectionItem.lineHeight = next;
      changed = true;
    }
    if (!Array.isArray(sectionItem.items)) return;
    sectionItem.items.forEach((item) => {
      if (!item.richStyle) {
        item.richStyle = { lineHeight: targetItemLineHeight, firstIndent: 0, hangingIndent: 0 };
        changed = true;
        return;
      }
      const currentItemLineHeight = Number(item.richStyle.lineHeight || 1.65);
      const nextItemLineHeight = Math.max(ONE_PAGE_FIT_LIMITS.itemLineHeight, Math.min(currentItemLineHeight, targetItemLineHeight));
      if (Math.abs(currentItemLineHeight - nextItemLineHeight) > 0.001) {
        item.richStyle.lineHeight = nextItemLineHeight;
        changed = true;
      }
    });
  });
  return changed;
}

function loosenVisibleSectionLineHeights(
  targetLineHeight = Number(state.settings.lineHeight || initialState.settings.lineHeight),
  targetItemLineHeightValue = null
) {
  let changed = false;
  const target = Math.min(Number(targetLineHeight || state.settings.lineHeight || initialState.settings.lineHeight), ONE_PAGE_FILL_LIMITS.lineHeight);
  const targetItemLineHeight = clamp(
    Number(targetItemLineHeightValue || target / 100),
    ONE_PAGE_FIT_LIMITS.itemLineHeight,
    ONE_PAGE_FILL_LIMITS.itemLineHeight
  );
  state.sections.forEach((sectionItem) => {
    if (!sectionItem || sectionItem.visible === false) return;
    const current = Number(sectionItem.lineHeight || state.settings.lineHeight || initialState.settings.lineHeight);
    const next = Math.min(ONE_PAGE_FILL_LIMITS.lineHeight, Math.max(current, target));
    if (Math.abs(current - next) > 0.01) {
      sectionItem.lineHeight = Math.round(next * 100) / 100;
      changed = true;
    }
    if (!Array.isArray(sectionItem.items)) return;
    sectionItem.items.forEach((item) => {
      if (!item.richStyle) item.richStyle = { lineHeight: targetItemLineHeight, firstIndent: 0, hangingIndent: 0 };
      const currentItemLineHeight = Number(item.richStyle.lineHeight || 1.65);
      const nextItemLineHeight = Math.min(ONE_PAGE_FILL_LIMITS.itemLineHeight, Math.max(currentItemLineHeight, targetItemLineHeight));
      if (Math.abs(currentItemLineHeight - nextItemLineHeight) > 0.001) {
        item.richStyle.lineHeight = Math.round(nextItemLineHeight * 1000) / 1000;
        changed = true;
      }
    });
  });
  return changed;
}

function tightenInlineBodyFontSizes(maxFontSizeValue = Number(state.settings.fontSize || ONE_PAGE_FIT_LIMITS.fontSize)) {
  let changed = false;
  const maxFontSize = Number(maxFontSizeValue || state.settings.fontSize || ONE_PAGE_FIT_LIMITS.fontSize);
  state.sections.forEach((sectionItem) => {
    if (!sectionItem || sectionItem.visible === false || !Array.isArray(sectionItem.items)) return;
    sectionItem.items.forEach((item) => {
      const body = String(item.body || "");
      if (!body || !/font-size\s*:/i.test(body)) return;
      const nextBody = body.replace(/font-size\s*:\s*([0-9.]+)px/gi, (match, rawSize) => {
        const size = Number.parseFloat(rawSize);
        if (!Number.isFinite(size) || size <= maxFontSize) return match;
        changed = true;
        return `font-size:${maxFontSize}px`;
      });
      if (nextBody !== body) item.body = nextBody;
    });
  });
  return changed;
}

function recoverLegacyOnePageFitVisualStyle() {
  const looksLikeOldFit =
    state.template === "compact" &&
    state.settings.titleStyle === "plain" &&
    Number(state.settings.margin || 0) <= 10 &&
    Number(state.settings.lineHeight || 0) <= 124 &&
    Number(state.settings.fontSize || 0) <= 12;
  if (!looksLikeOldFit) return false;
  state.template = initialState.template;
  state.settings.titleStyle = initialState.settings.titleStyle;
  if (state.profile.photo && state.profile.showPhoto === false) {
    state.profile.showPhoto = true;
  }
  return true;
}

function getOnePageFitBaseline() {
  return {
    margin: Number(state.settings.margin || initialState.settings.margin),
    spacing: Number(state.settings.spacing || initialState.settings.spacing),
    lineHeight: Number(state.settings.lineHeight || initialState.settings.lineHeight),
    fontSize: Number(state.settings.fontSize || initialState.settings.fontSize),
    nameSize: Number(state.settings.nameSize || initialState.settings.nameSize),
    basicHeight: Number(state.settings.basicHeight || initialState.settings.basicHeight),
    itemLineHeight: Math.max(
      ...state.sections
        .filter((sectionItem) => sectionItem && sectionItem.visible !== false && Array.isArray(sectionItem.items))
        .flatMap((sectionItem) => sectionItem.items.map((item) => Number(item.richStyle?.lineHeight || 1.65)))
        .filter(Number.isFinite),
      1.65
    )
  };
}

function applyDynamicOnePageFitPass(contentHeight, baseline, passIndex = 0) {
  let changed = false;
  if (state.settings.cover) {
    state.settings.cover = false;
    changed = true;
  }

  const targetHeight = A4_PAGE_HEIGHT_PX - 18;
  const rawRatio = clamp(targetHeight / Math.max(contentHeight || targetHeight, targetHeight), 0.72, 1);
  const damping = passIndex < 3 ? 0.82 : 0.9;
  const ratio = clamp(1 - ((1 - rawRatio) * damping), 0.72, 1);
  const overflow = Math.max(0, contentHeight - targetHeight);
  const overflowRatio = overflow / targetHeight;

  const currentFontSize = Number(state.settings.fontSize || baseline.fontSize);
  const currentNameSize = Number(state.settings.nameSize || baseline.nameSize);
  const currentLineHeight = Number(state.settings.lineHeight || baseline.lineHeight);
  const currentSpacing = Number(state.settings.spacing || baseline.spacing);
  const currentBasicHeight = Number(state.settings.basicHeight || baseline.basicHeight);
  const currentItemLineHeights = state.sections
    .filter((sectionItem) => sectionItem && sectionItem.visible !== false && Array.isArray(sectionItem.items))
    .flatMap((sectionItem) => sectionItem.items.map((item) => Number(item.richStyle?.lineHeight || baseline.itemLineHeight || 1.65)))
    .filter(Number.isFinite);
  const currentItemLineHeight = currentItemLineHeights.length
    ? Math.max(...currentItemLineHeights)
    : Number(baseline.itemLineHeight || 1.65);
  const nextFontSize = currentFontSize * Math.pow(ratio, 0.92);
  const nextNameSize = currentNameSize * Math.pow(ratio, 0.78);
  const nextLineHeight = currentLineHeight * Math.pow(ratio, 0.72);
  const nextItemLineHeight = currentItemLineHeight * Math.pow(ratio, 0.58);
  const nextSpacing = currentSpacing * Math.pow(ratio, 1.25);
  const nextBasicHeight = currentBasicHeight * Math.pow(ratio, 0.62);
  const nextMargin = Math.max(
    ONE_PAGE_FIT_LIMITS.margin,
    Number(state.settings.margin || baseline.margin) - Math.min(Number(state.settings.margin || baseline.margin) - ONE_PAGE_FIT_LIMITS.margin, overflowRatio * 10 + 0.35)
  );

  changed = setSettingTowardValue("fontSize", nextFontSize) || changed;
  changed = setSettingTowardValue("nameSize", nextNameSize) || changed;
  changed = setSettingTowardValue("lineHeight", nextLineHeight) || changed;
  changed = setSettingTowardValue("spacing", nextSpacing) || changed;
  changed = setSettingTowardValue("basicHeight", nextBasicHeight) || changed;
  changed = setSettingTowardValue("margin", nextMargin) || changed;
  changed = tightenVisibleSectionLineHeights(nextLineHeight, nextItemLineHeight) || changed;
  changed = tightenInlineBodyFontSizes(nextFontSize) || changed;

  if (!changed && contentHeight > targetHeight + 1) {
    changed = setSettingTowardValue("fontSize", Number(state.settings.fontSize || baseline.fontSize) - 0.25) || changed;
    changed = setSettingTowardValue("lineHeight", Number(state.settings.lineHeight || baseline.lineHeight) - 1) || changed;
    changed = tightenVisibleSectionLineHeights(Number(state.settings.lineHeight || baseline.lineHeight), nextItemLineHeight) || changed;
  }
  return changed;
}

function applyContentFitScaleForOnePage(contentHeight) {
  const targetHeight = A4_PAGE_HEIGHT_PX - 20;
  const currentScale = clamp(Number(state.settings.fitScale || 1), 0.76, ONE_PAGE_FILL_LIMITS.fitScale);
  const measuredHeight = Math.max(Number(contentHeight) || targetHeight, targetHeight);
  const ratio = targetHeight / measuredHeight;
  const browserSafety = ratio < 0.995 ? 0.992 : 1;
  const nextScale = clamp(currentScale * ratio * browserSafety, 0.76, ONE_PAGE_FILL_LIMITS.fitScale);
  if (Math.abs(currentScale - nextScale) < 0.001) return false;
  state.settings.fitScale = Math.round(nextScale * 1000) / 1000;
  return true;
}

function applyDynamicOnePageFillPass(contentBounds, baseline, passIndex = 0) {
  const bounds = contentBounds && typeof contentBounds === "object"
    ? contentBounds
    : measureResumeContentBounds(refs.resumePage);
  const topBlank = clamp(Number(bounds.top || 0), 8, 32);
  const targetVisualBottomBlank = clamp(topBlank, 8, 18);
  const targetHeight = clamp(
    A4_PAGE_HEIGHT_PX - targetVisualBottomBlank + Number(bounds.paddingBottom || 0),
    A4_PAGE_HEIGHT_PX - 54,
    A4_PAGE_HEIGHT_PX - 2
  );
  const contentHeight = Math.max(Number(bounds.actualHeight) || 1, 1);
  if (contentHeight >= targetHeight - 4) return false;

  let changed = false;
  const rawRatio = clamp(targetHeight / contentHeight, 1, 1.24);
  const damping = passIndex < 5 ? 0.74 : 0.56;
  const ratio = clamp(1 + ((rawRatio - 1) * damping), 1.012, 1.16);
  const fillDeficit = clamp((targetHeight - contentHeight) / targetHeight, 0, 1);
  const currentFontSize = Number(state.settings.fontSize || baseline.fontSize);
  const currentNameSize = Number(state.settings.nameSize || baseline.nameSize);
  const currentLineHeight = Number(state.settings.lineHeight || baseline.lineHeight);
  const currentSpacing = Number(state.settings.spacing || baseline.spacing);
  const currentBasicHeight = Number(state.settings.basicHeight || baseline.basicHeight);
  const currentMargin = Number(state.settings.margin || baseline.margin);
  const currentScale = clamp(Number(state.settings.fitScale || 1), 0.76, ONE_PAGE_FILL_LIMITS.fitScale);
  const currentItemLineHeights = state.sections
    .filter((sectionItem) => sectionItem && sectionItem.visible !== false && Array.isArray(sectionItem.items))
    .flatMap((sectionItem) => sectionItem.items.map((item) => Number(item.richStyle?.lineHeight || baseline.itemLineHeight || 1.65)))
    .filter(Number.isFinite);
  const currentItemLineHeight = currentItemLineHeights.length
    ? Math.max(...currentItemLineHeights)
    : Number(baseline.itemLineHeight || 1.65);

  const nextFontSize = currentFontSize * Math.pow(ratio, 0.52);
  const nextNameSize = currentNameSize * Math.pow(ratio, 0.32);
  const nextLineHeight = currentLineHeight * Math.pow(ratio, 1.16);
  const nextItemLineHeight = currentItemLineHeight * Math.pow(ratio, 1.02);
  const nextSpacing = currentSpacing + Math.max(0.28, fillDeficit * 6.8);
  const nextBasicHeight = currentBasicHeight * Math.pow(ratio, 0.28);
  const nextMargin = currentMargin + Math.max(0.12, fillDeficit * 2.2);
  const nextScale = currentScale < 1
    ? Math.min(1, currentScale + Math.max(0.014, fillDeficit * 0.2))
    : Math.min(ONE_PAGE_FILL_LIMITS.fitScale, currentScale * Math.pow(ratio, 0.34));

  changed = setSettingUpToValue("fontSize", nextFontSize) || changed;
  changed = setSettingUpToValue("nameSize", nextNameSize) || changed;
  changed = setSettingUpToValue("lineHeight", nextLineHeight) || changed;
  changed = setSettingUpToValue("spacing", nextSpacing) || changed;
  changed = setSettingUpToValue("basicHeight", nextBasicHeight) || changed;
  changed = setSettingUpToValue("margin", nextMargin) || changed;
  changed = loosenVisibleSectionLineHeights(nextLineHeight, nextItemLineHeight) || changed;
  if (Math.abs(currentScale - nextScale) >= 0.001) {
    state.settings.fitScale = Math.round(nextScale * 1000) / 1000;
    changed = true;
  }
  return changed;
}

function applyBalancedVerticalFill() {
  const bounds = measureResumeContentBounds(refs.resumePage);
  const sections = [...refs.resumePage.querySelectorAll(".resume-section")].filter((node) => node.offsetHeight > 0);
  const gaps = Math.max(0, sections.length - 1);
  if (!gaps) {
    state.settings.verticalFillGap = 0;
    return false;
  }
  const topBlank = clamp(Number(bounds.top || 0), 8, 48);
  const bottomBlank = Math.max(0, A4_PAGE_HEIGHT_PX - Number(bounds.contentBottom || 0));
  const distributable = Math.max(0, bottomBlank - topBlank - 2);
  const next = Math.round(clamp(distributable / gaps, 0, 36) * 10) / 10;
  if (Math.abs(Number(state.settings.verticalFillGap || 0) - next) < 0.1) return false;
  state.settings.verticalFillGap = next;
  return true;
}

async function fitResumeToOnePage(options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const recoveredVisualStyle = recoverLegacyOnePageFitVisualStyle();
  if (recoveredVisualStyle) {
    renderAll();
    await waitForLayoutFrame();
  }
  const beforeCount = await getCurrentPreviewPageCountAfterLayout();

  if (refs.fitOnePageBtn) refs.fitOnePageBtn.disabled = true;
  let afterCount = beforeCount;
  let changed = recoveredVisualStyle;
  const baseline = getOnePageFitBaseline();
  try {
    state.settings.fitScale = 1;
    state.settings.verticalFillGap = 0;
    renderAll();
    await waitForLayoutFrame();
    for (let pass = 0; afterCount > 1 && pass < 24; pass += 1) {
      const contentHeight = measureResumeContentHeight(refs.resumePage);
      const passChanged = applyDynamicOnePageFitPass(contentHeight, baseline, pass);
      if (!passChanged) break;
      changed = true;
      renderAll();
      afterCount = await getCurrentPreviewPageCountAfterLayout();
      if (afterCount <= 1) break;
    }
    for (let pass = 0; afterCount > 1 && pass < 12; pass += 1) {
      const contentHeight = measureResumeContentHeight(refs.resumePage);
      if (!applyContentFitScaleForOnePage(contentHeight)) break;
      changed = true;
      renderAll();
      afterCount = await getCurrentPreviewPageCountAfterLayout();
    }
    for (let pass = 0; afterCount <= 1 && pass < 48; pass += 1) {
      const contentBounds = measureResumeContentBounds(refs.resumePage);
      if (!applyDynamicOnePageFillPass(contentBounds, baseline, pass)) break;
      changed = true;
      renderAll();
      afterCount = await getCurrentPreviewPageCountAfterLayout();
      if (afterCount > 1) {
        const contentHeight = measureResumeContentHeight(refs.resumePage);
        applyContentFitScaleForOnePage(contentHeight);
        renderAll();
        afterCount = await getCurrentPreviewPageCountAfterLayout();
        break;
      }
    }
    if (afterCount <= 1 && applyBalancedVerticalFill()) {
      changed = true;
      renderAll();
      afterCount = await getCurrentPreviewPageCountAfterLayout();
      if (afterCount > 1) {
        state.settings.verticalFillGap = Math.max(0, Number(state.settings.verticalFillGap || 0) - 2);
        renderAll();
        afterCount = await getCurrentPreviewPageCountAfterLayout();
      }
    }
    syncInputsFromState();
    syncLayoutInputsByKeys(ONE_PAGE_FIT_SYNC_KEYS);
    afterCount = await getCurrentPreviewPageCountAfterLayout();
    const fit = afterCount <= 1;
    if (!opts.silent && refs.saveStatus) {
      refs.saveStatus.textContent = fit ? "已智能适配到一页" : "已压到版式下限，仍超过一页";
      window.setTimeout(() => {
        if (refs.saveStatus.textContent.includes("一页") || refs.saveStatus.textContent.includes("下限")) {
          refs.saveStatus.textContent = "已自动保存";
        }
      }, 2200);
    }
    return { fit, changed, beforeCount, afterCount };
  } finally {
    if (refs.fitOnePageBtn) refs.fitOnePageBtn.disabled = false;
  }
}

function clampPreviewOffset() {
  if (!refs.previewViewport) return;
  const zoom = Number(state.previewZoom || 0.5);
  const frameWidth = A4_PAGE_WIDTH_PX * zoom;
  const stackHeight = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--resume-stack-height")) || A4_PAGE_HEIGHT_PX;
  const frameHeight = stackHeight * zoom;
  const viewWidth = refs.previewViewport.clientWidth;
  const viewHeight = refs.previewViewport.clientHeight;
  const visibleEdge = 96;
  const minX = Math.min(0, visibleEdge - frameWidth);
  const maxX = Math.max(0, viewWidth - visibleEdge);
  const minY = Math.min(0, visibleEdge - frameHeight);
  const maxY = Math.max(0, viewHeight - visibleEdge);
  state.previewOffsetX = clamp(Number(state.previewOffsetX || 0), minX, maxX);
  state.previewOffsetY = clamp(Number(state.previewOffsetY || 0), minY, maxY);
}

function renderAll() {
  applyStyles();
  renderProfile();
  clampHeadBlocksIntoContainer();
  renderSections();
  renderExtras();
  syncPreviewPagination();
  clampPreviewOffset();
  applyPreviewOffset();
  renderTabs();
  renderEditor();
  renderCustomInfo();
  renderSettings();
  scrollPendingItemIntoView();
  decorateRippleTargets();
  requestAnimationFrame(adjustFloatingPopovers);
  persist();
}

function clampByLayoutSetting(key, value) {
  const conf = layoutSettingMap.get(key);
  if (!conf) return Number(value) || 0;
  return clamp(Number(value) || 0, conf.min, conf.max);
}

function syncLayoutInputsByKeys(keys) {
  keys.forEach((key) => {
    const conf = layoutSettingMap.get(key);
    if (!conf) return;
    const range = document.getElementById(conf.range);
    const number = document.getElementById(conf.number);
    if (range) {
      range.value = String(state.settings[key]);
      updateRangeProgress(range);
    }
    if (number) number.value = String(state.settings[key]);
  });
}

function applyHeadOffsetCssVars() {
  document.documentElement.style.setProperty("--photo-x", `${state.settings.photoX}px`);
  document.documentElement.style.setProperty("--photo-y", `${state.settings.photoY}px`);
  document.documentElement.style.setProperty("--name-x", `${state.settings.nameX}px`);
  document.documentElement.style.setProperty("--info-x", `${state.settings.infoX}px`);
  document.documentElement.style.setProperty("--info-y", `${state.settings.infoY}px`);
}

function clampHeadBlocksIntoContainer() {
  const head = refs.resumeHead;
  if (!head) return;
  const zoom = Math.max(0.01, Number(state.previewZoom || 1));
  const headRect = head.getBoundingClientRect();
  if (!headRect.width || !headRect.height) return;
  const identity = head.querySelector(".identity");
  const nameBlock = refs.previewName?.closest(".name-block");
  const infoBlock = refs.infoGrid?.closest(".info-block");
  const adjustedKeys = new Set();
  const setSettingDelta = (key, delta) => {
    if (!key || Math.abs(delta) <= 0.2) return false;
    const next = clampByLayoutSetting(key, Number(state.settings[key] || 0) + delta);
    if (next === state.settings[key]) return false;
    state.settings[key] = next;
    adjustedKeys.add(key);
    return true;
  };
  const getRect = (node) => {
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return rect;
  };
  const adjustXY = (node, keyX, keyY, boundsRect = headRect) => {
    if (!node) return;
    const rect = getRect(node);
    if (!rect) return false;
    let dx = 0;
    let dy = 0;
    if (rect.left < boundsRect.left) dx += (boundsRect.left - rect.left) / zoom;
    if (rect.right > boundsRect.right) dx -= (rect.right - boundsRect.right) / zoom;
    if (rect.top < boundsRect.top) dy += (boundsRect.top - rect.top) / zoom;
    if (rect.bottom > boundsRect.bottom) dy -= (rect.bottom - boundsRect.bottom) / zoom;
    const changedX = keyX ? setSettingDelta(keyX, dx) : false;
    const changedY = keyY ? setSettingDelta(keyY, dy) : false;
    return changedX || changedY;
  };
  const keepPhotoOutOfIdentity = () => {
    const photoRect = getRect(refs.photoWrap);
    const identityRect = getRect(identity);
    if (!photoRect || !identityRect) return false;
    const gap = 6;
    const isCompact = refs.resumePage?.classList.contains("template-compact");
    let dx = 0;
    if (!isCompact) {
      const limitRight = identityRect.left - gap;
      if (photoRect.right > limitRight) dx -= (photoRect.right - limitRight) / zoom;
    } else {
      const limitLeft = identityRect.right + gap;
      if (photoRect.left < limitLeft) dx += (limitLeft - photoRect.left) / zoom;
    }
    return setSettingDelta("photoX", dx);
  };
  const isOverlapping = (a, b, gap = 4) => {
    if (!a || !b) return false;
    return !(a.right + gap <= b.left || b.right + gap <= a.left || a.bottom + gap <= b.top || b.bottom + gap <= a.top);
  };
  const resolvePairOverlap = (fixedNode, moveNode, keyX, keyY, prefer = "x") => {
    const fixedRect = getRect(fixedNode);
    const moveRect = getRect(moveNode);
    if (!fixedRect || !moveRect || !isOverlapping(fixedRect, moveRect)) return false;
    const gap = 6;
    const moveRight = (fixedRect.right - moveRect.left + gap) / zoom;
    const moveLeft = -((moveRect.right - fixedRect.left + gap) / zoom);
    const moveDown = (fixedRect.bottom - moveRect.top + gap) / zoom;
    const moveUp = -((moveRect.bottom - fixedRect.top + gap) / zoom);
    const candidates = [];
    if (keyX) {
      candidates.push({ key: keyX, delta: moveLeft, axis: "x" }, { key: keyX, delta: moveRight, axis: "x" });
    }
    if (keyY) {
      candidates.push({ key: keyY, delta: moveUp, axis: "y" }, { key: keyY, delta: moveDown, axis: "y" });
    }
    const ordered = candidates.sort((a, b) => {
      const pa = a.axis === prefer ? 0 : 1;
      const pb = b.axis === prefer ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return Math.abs(a.delta) - Math.abs(b.delta);
    });
    for (const candidate of ordered) {
      if (setSettingDelta(candidate.key, candidate.delta)) return true;
    }
    return false;
  };

  let changed = false;
  const nameBounds = getRect(nameBlock) || headRect;
  const infoBounds = getRect(infoBlock) || headRect;
  for (let pass = 0; pass < 6; pass += 1) {
    let passChanged = false;
    passChanged = adjustXY(refs.photoWrap, "photoX", "photoY", headRect) || passChanged;
    passChanged = keepPhotoOutOfIdentity() || passChanged;
    passChanged = adjustXY(refs.previewName, "nameX", "", nameBounds) || passChanged;
    passChanged = adjustXY(refs.infoGrid, "infoX", "infoY", infoBounds) || passChanged;
    if (passChanged) applyHeadOffsetCssVars();

    passChanged = resolvePairOverlap(refs.photoWrap, refs.previewName, "nameX", "", "x") || passChanged;
    if (passChanged) applyHeadOffsetCssVars();
    passChanged = adjustXY(refs.previewName, "nameX", "", nameBounds) || passChanged;
    passChanged = adjustXY(refs.infoGrid, "infoX", "infoY", infoBounds) || passChanged;
    if (passChanged) applyHeadOffsetCssVars();

    passChanged = resolvePairOverlap(refs.photoWrap, refs.infoGrid, "infoX", "infoY", "x") || passChanged;
    if (passChanged) applyHeadOffsetCssVars();
    passChanged = adjustXY(refs.infoGrid, "infoX", "infoY", infoBounds) || passChanged;
    if (passChanged) applyHeadOffsetCssVars();

    passChanged = resolvePairOverlap(refs.previewName, refs.infoGrid, "infoX", "infoY", "y") || passChanged;
    if (passChanged) applyHeadOffsetCssVars();
    passChanged = adjustXY(refs.infoGrid, "infoX", "infoY", infoBounds) || passChanged;
    if (passChanged) applyHeadOffsetCssVars();

    changed = changed || passChanged;
    if (!passChanged) break;
  }

  if (!changed || !adjustedKeys.size) return;
  applyHeadOffsetCssVars();
  syncLayoutInputsByKeys([...adjustedKeys]);
}

function scrollPendingItemIntoView() {
  if (!state.pendingScrollItemId) return;
  const targetId = state.pendingScrollItemId;
  state.pendingScrollItemId = "";
  requestAnimationFrame(() => {
    const target = refs.itemList.querySelector(`[data-item-id="${CSS.escape(targetId)}"]`);
    if (target) target.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

function persist(options = {}) {
  // The embedded editor starts from an internal placeholder. Never allow that
  // placeholder to overwrite the job resume before its authoritative snapshot
  // has arrived from FetchCV or the resume API.
  if (FETCHCV_EMBEDDED && !fetchCVSnapshotLoaded) return;
  const opts = (options && typeof options === "object") ? options : {};
  let serializedState = "";
  const result = globalThis.ResumeDataLayer?.writeJson(storageKey, state);
  if (result?.ok) {
    serializedState = result.serialized;
    if (workbenchState && !document.body.classList.contains("dashboard-mode")) {
      syncActiveVersionFromEditor();
      persistWorkbench();
    }
    if (!opts.silent && refs.saveStatus) refs.saveStatus.textContent = "已自动保存";
  } else {
    if (!opts.silent && refs.saveStatus) refs.saveStatus.textContent = "保存失败，请先备份数据";
    notifyStorageFailure(result);
  }
  if (!serializedState) return;
  if (FETCHCV_EMBEDDED) {
    window.parent.postMessage({ type: "fetchcv:editor-change", snapshot: cloneEditorState(state) }, "*");
    return;
  }
  queueArchiveSnapshot(serializedState, {
    force: Boolean(opts.forceArchive),
    reason: opts.reason || "autosave"
  });
}

function getRenderTabSections() {
  if (!state.sidebarDraggingSectionId) return state.sections;
  const dragged = state.sections.find((item) => item.id === state.sidebarDraggingSectionId);
  if (!dragged) return state.sections;
  const withoutDragged = state.sections.filter((item) => item.id !== state.sidebarDraggingSectionId);
  const placeholder = {
    id: "__sidebar_placeholder",
    type: "placeholder",
    height: state.sidebarDragPlaceholderHeight || 32
  };
  const insertIndex = clamp(Number(state.sidebarPlaceholderIndex || 0), 0, withoutDragged.length);
  withoutDragged.splice(insertIndex, 0, placeholder);
  return withoutDragged;
}

function ensureStateDefaults() {
  if (!state || typeof state !== "object") {
    state = structuredClone(initialState);
    return;
  }
  state.schema = EDITOR_SCHEMA_VERSION;

  state.profile = (state.profile && typeof state.profile === "object") ? state.profile : {};
  Object.entries(initialState.profile).forEach(([key, value]) => {
    if (state.profile[key] === undefined || state.profile[key] === null) {
      state.profile[key] = FETCHCV_EMBEDDED
        ? (Array.isArray(value) ? [] : typeof value === "boolean" ? false : "")
        : structuredClone(value);
    }
  });
  [
    "name", "age", "gender", "birth", "political", "phone", "email", "arrival",
    "workYears", "marital", "height", "weight", "ethnicity", "domicile",
    "photo", "photoFileName"
  ].forEach((key) => {
    state.profile[key] = String(state.profile[key] || "");
  });
  state.profile.showPhoto = state.profile.showPhoto !== false;
  if (!Array.isArray(state.profile.custom)) state.profile.custom = [];
  state.profile.custom = state.profile.custom
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      key: String(item.key || ""),
      value: String(item.value || "")
    }));

  state.settings = (state.settings && typeof state.settings === "object") ? state.settings : {};
  Object.entries(initialState.settings).forEach(([key, value]) => {
    if (state.settings[key] === undefined || state.settings[key] === null) {
      state.settings[key] = structuredClone(value);
    }
  });
  state.settings.letter = String(state.settings.letter || "");
  state.settings.fontFamily = String(state.settings.fontFamily || initialState.settings.fontFamily);
  state.settings.titleStyle = String(state.settings.titleStyle || initialState.settings.titleStyle);
  state.settings.customAccent = String(state.settings.customAccent || initialState.settings.customAccent);
  state.settings.customAccent2 = String(state.settings.customAccent2 || initialState.settings.customAccent2);
  state.settings.customStage = String(state.settings.customStage || initialState.settings.customStage);
  state.settings.fitScale = clamp(Number(state.settings.fitScale || 1), 0.76, ONE_PAGE_FILL_LIMITS.fitScale);

  if (!Array.isArray(state.sections)) state.sections = structuredClone(initialState.sections);
  state.sections = state.sections
    .filter((item) => item && typeof item === "object")
    .map((item, index) => {
      const fallback = initialState.sections[index] || initialState.sections[0];
      const id = String(item.id || fallback.id || `section-${index + 1}`);
      const tab = String(item.tab || item.title || fallback.tab || "自定义模块");
      const title = String(item.title || item.tab || tab);
      const rawItems = Array.isArray(item.items) ? item.items : [blankItem()];
      const items = rawItems
        .filter((entry) => entry && typeof entry === "object")
        .map((entry, entryIndex) => ({
          id: String(entry.id || `${id}-item-${entryIndex + 1}`),
          metaLeft: String(entry.metaLeft || ""),
          metaRight: String(entry.metaRight || ""),
          body: String(entry.body || ""),
          fields: entry.fields && typeof entry.fields === "object" ? entry.fields : {}
        }));
      return {
        ...item,
        id,
        tab,
        title,
        visible: item.visible !== false,
        items: items.length ? items : [blankItem()]
      };
    });
  if (!state.sections.length) state.sections = structuredClone(initialState.sections);

  // Recover missing builtin sections from corrupted cache snapshots.
  const builtinDefaults = initialState.sections.filter((item) => builtinSectionIds.has(item.id));
  const sectionById = new Map(state.sections.map((item) => [item.id, item]));
  const recoveredBuiltins = builtinDefaults
    .filter((item) => !sectionById.has(item.id))
    .map((item) => {
      const recovered = structuredClone(item);
      if (FETCHCV_EMBEDDED) {
        recovered.visible = false;
        recovered.items = [blankItem()];
      }
      return recovered;
    });
  if (recoveredBuiltins.length) {
    const builtins = state.sections.filter((item) => builtinSectionIds.has(item.id));
    const customs = state.sections.filter((item) => !builtinSectionIds.has(item.id));
    state.sections = [...builtins, ...recoveredBuiltins, ...customs];
  }

  // If cache leaves only one visible section, restore default builtin visibility.
  const builtinVisibilityById = new Map(builtinDefaults.map((item) => [item.id, item.visible !== false]));
  const builtinSections = state.sections.filter((item) => builtinSectionIds.has(item.id));
  const visibleBuiltinCount = builtinSections.filter((item) => item.visible !== false).length;
  const visibleSectionCount = state.sections.filter((item) => item.visible !== false).length;
  if (!FETCHCV_EMBEDDED && builtinSections.length && visibleBuiltinCount <= 1 && visibleSectionCount <= 1) {
    builtinSections.forEach((item) => {
      item.visible = builtinVisibilityById.get(item.id) ?? true;
    });
  }

  state.activeTab = state.activeTab === "section" ? "section" : "profile";
  const sectionIds = new Set(state.sections.map((item) => item.id));
  if (!sectionIds.has(state.activeSectionId)) {
    state.activeSectionId = state.sections[0]?.id || "education";
  }
  if (state.activeTab === "section") {
    const activeVisible = state.sections.some((item) => item.id === state.activeSectionId && item.visible !== false);
    if (!activeVisible) {
      const fallbackVisible = state.sections.find((item) => item.visible !== false);
      state.activeSectionId = fallbackVisible?.id || state.sections[0]?.id || "education";
    }
  }
  if (typeof state.drawerOpen !== "boolean") state.drawerOpen = true;
  if (typeof state.moduleSidebarCollapsed !== "boolean") state.moduleSidebarCollapsed = false;
  if (!["layout", "type", "skin", "title", "cover", "letter"].includes(state.activeSettings)) {
    state.activeSettings = "layout";
  }
}

function hydrate() {
  const saved = globalThis.ResumeDataLayer?.readJson(storageKey);
  const parsed = saved?.ok ? saved.value : null;
  if (parsed && typeof parsed === "object" && Number(parsed.schema || 5) <= EDITOR_SCHEMA_VERSION) {
    state = parsed;
  }
  ensureStateDefaults();
  normalizeSectionBuiltinFlags();
  state.previewWidth = clamp(Number(state.previewWidth || 56), 46, 72);
  if (state.previewWidth < 52) state.previewWidth = 56;
  state.previewZoom = clamp(Number(state.previewZoom || 0.5), 0.3, 1.2);
  state.previewOffsetX = Number(state.previewOffsetX || 0);
  state.previewOffsetY = Number(state.previewOffsetY || 0);
  layoutSettingPairs.forEach((conf) => {
    state.settings[conf.key] = clamp(Number(state.settings[conf.key] ?? initialState.settings[conf.key]), conf.min, conf.max);
  });
  state.settings.basicHeight = clamp(Number(state.settings.basicHeight || 132), 90, 220);
  if (state.settings.basicHeight === 190 || state.settings.basicHeight === 138) {
    state.settings.basicHeight = 132;
  }
}

function bindProfileInputs() {
  const bindings = [
    ["name", "#nameInput"], ["gender", "#genderInput"],
    ["political", "#politicalInput"], ["phone", "#phoneInput"],
    ["arrival", "#arrivalInput"], ["workYears", "#workYearsInput"], ["marital", "#maritalInput"],
    ["height", "#heightInput"], ["weight", "#weightInput"], ["ethnicity", "#ethnicityInput"],
    ["domicile", "#domicileInput"]
  ];
  bindings.forEach(([key, selector]) => {
    const input = $(selector);
    input.addEventListener("input", () => {
      state.profile[key] = input.value;
      // Keep the live field mounted while typing. Rebuilding the whole editor here
      // makes native inputs lose their selection and makes hybrid controls close.
      updatePreviewOnly();
    });
  });
  const syncEmail = () => {
    const value = ($("#emailInput").value || "").trim().replace(/\s+/g, "");
    state.profile.email = value;
    updatePreviewOnly();
  };
  $("#emailInput").addEventListener("input", syncEmail);
  $("#emailInput").addEventListener("focus", (event) => event.target.select());
  const emailLabel = document.getElementById("emailInput")?.closest("label");
  if (emailLabel) {
    let suffixSelect = document.getElementById("emailSuffixPreset");
    if (!suffixSelect) {
      suffixSelect = document.createElement("select");
      suffixSelect.id = "emailSuffixPreset";
      suffixSelect.className = "email-suffix-select";
      suffixSelect.innerHTML = `<option value="">常用后缀</option>${["qq.com", "163.com", "126.com", "gmail.com", "outlook.com", "hotmail.com", "foxmail.com", "aliyun.com", "yeah.net", "sina.com", "sohu.com", "vip.qq.com", "189.cn", "139.com"].map((value) => `<option value="${value}">${value}</option>`).join("")}`;
      document.getElementById("emailInput")?.after(suffixSelect);
      suffixSelect.addEventListener("change", (event) => {
        const suffix = String(event.target.value || "").trim().replace(/^@+/, "");
        const current = ($("#emailInput").value || "").trim().replace(/\s+/g, "");
        const localPart = current.includes("@") ? current.split("@")[0] : current;
        $("#emailInput").value = suffix ? `${localPart || ""}@${suffix}` : localPart;
        syncEmail();
      });
    }
  }
  const bindHybridSelect = (inputId, options, placeholder) => {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.setAttribute("placeholder", placeholder);
    input.removeAttribute("list");
    input.readOnly = true;
    let line = input.closest(".field-input-line");
    if (!line) {
      const wrapper = document.createElement("span");
      wrapper.className = "field-input-line profile-hybrid";
      input.replaceWith(wrapper);
      wrapper.appendChild(input);
      line = wrapper;
    }
    line.classList.add("profile-hybrid");
    input.classList.add("profile-hybrid-input");
    input.closest("label")?.classList.add("profile-combo-field");
    let toggle = line.querySelector(".profile-hybrid-toggle");
    if (!toggle) {
      toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "profile-hybrid-toggle";
      toggle.setAttribute("aria-label", `选择${placeholder}`);
      toggle.innerHTML = "";
      line.appendChild(toggle);
    }
    let menu = line.querySelector(".profile-hybrid-menu");
    if (!menu) {
      menu = document.createElement("div");
      menu.className = "profile-hybrid-menu";
      menu.innerHTML = options.map((value) => `<button type="button" class="profile-hybrid-option" data-value="${escapeAttr(value)}">${escapeHtml(value)}</button>`).join("");
      line.appendChild(menu);
      line.__hybridMenu = menu;
      menu.addEventListener("click", (event) => {
        const option = event.target.closest("[data-value]");
        if (!option) return;
        input.value = option.dataset.value || "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        closeMenus();
      });
    }
    const closeMenus = () => {
      document.querySelectorAll(".profile-hybrid.open").forEach((node) => {
        node.classList.remove("open");
        if (node.__hybridMenu) unmountHybridMenu(node.__hybridMenu);
      });
    };
    const openMenu = () => {
      document.querySelectorAll(".profile-hybrid.open").forEach((node) => {
        if (node !== line) {
          node.classList.remove("open");
          if (node.__hybridMenu) unmountHybridMenu(node.__hybridMenu);
        }
      });
      if (!input.readOnly) return;
      line.classList.add("open");
      mountHybridMenu(line, line.__hybridMenu || menu);
    };
    line.addEventListener("click", (event) => {
      if (event.target.closest(".profile-hybrid-menu")) return;
      if (!input.readOnly) return;
      openMenu();
    });
    line.addEventListener("dblclick", (event) => {
      event.preventDefault();
      if (line.__hybridMenu) unmountHybridMenu(line.__hybridMenu);
      line.classList.remove("open");
      input.readOnly = false;
      input.focus();
      input.select();
    });
    input.addEventListener("blur", () => {
      input.readOnly = true;
      window.setTimeout(() => {
        if (!line.contains(document.activeElement)) {
          line.classList.remove("open");
          if (line.__hybridMenu) unmountHybridMenu(line.__hybridMenu);
        }
      }, 120);
    });
    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (line.classList.contains("open")) {
        line.classList.remove("open");
        if (line.__hybridMenu) unmountHybridMenu(line.__hybridMenu);
      }
      else openMenu();
    });
  };
  bindHybridSelect("genderInput", ["男", "女", "不限", "保密"], "性别");
  bindHybridSelect("politicalInput", ["不填", "中共党员", "中共预备党员", "共青团员", "普通公民", "群众"], "政治面貌");
  bindHybridSelect("maritalInput", ["不填", "已婚", "未婚", "离异", "已婚已育", "已婚未育"], "婚姻状况");
  bindHybridSelect("workYearsInput", ["应届生", "1年", "2年", "3年", "5年", "8年", "10年"], "如：3年 / 应届生");
  document.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".profile-hybrid") || event.target.closest(".profile-hybrid-menu")) return;
    document.querySelectorAll(".profile-hybrid.open").forEach((node) => {
      node.classList.remove("open");
      if (node.__hybridMenu) unmountHybridMenu(node.__hybridMenu);
    });
  });
  const birthControl = document.getElementById("birthMonthControl");
  birthControl?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    if (!target) return;
    const yearShiftButton = target.closest("[data-birth-year-shift]");
    if (yearShiftButton) {
      const delta = Number(yearShiftButton.dataset.birthYearShift);
      if (state.birthMonthPickerMode === "year") {
        const base = Number.isFinite(Number(state.birthYearPageStart))
          ? Number(state.birthYearPageStart)
          : getBirthYearPageStart(state.profileMonthPickerYear || new Date().getFullYear());
        state.birthYearPageStart = base + delta * 10;
      } else {
        state.profileMonthPickerYear = Number(state.profileMonthPickerYear || new Date().getFullYear()) + delta;
        state.birthYearPageStart = getBirthYearPageStart(state.profileMonthPickerYear);
      }
      renderBirthMonthPopover();
      return;
    }
    if (target.closest("[data-birth-year-toggle]")) {
      if (state.birthMonthPickerMode === "year") {
        state.birthMonthPickerMode = "month";
      } else {
        state.birthMonthPickerMode = "year";
        state.birthYearPageStart = getBirthYearPageStart(state.profileMonthPickerYear || new Date().getFullYear());
      }
      renderBirthMonthPopover();
      return;
    }
    const yearButton = target.closest("[data-birth-year]");
    if (yearButton) {
      state.profileMonthPickerYear = Number(yearButton.dataset.birthYear);
      state.birthMonthPickerMode = "month";
      renderBirthMonthPopover();
      return;
    }
    const monthButton = target.closest("[data-birth-month]");
    if (monthButton) {
      const nextBirth = normalizeMonthValue(monthButton.dataset.birthMonth || "");
      state.profile.birth = nextBirth;
      const birthInput = document.getElementById("birthInput");
      if (birthInput) birthInput.value = nextBirth;
      closeBirthMonthPicker();
      renderAll();
      return;
    }
    if (target.closest("#birthInput")) {
      if (state.birthMonthPickerOpen) closeBirthMonthPicker();
      else openBirthMonthPicker();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (!state.birthMonthPickerOpen) return;
    if (event.target.closest("#birthMonthControl")) return;
    closeBirthMonthPicker();
  });
  window.addEventListener("resize", () => requestAnimationFrame(adjustFloatingPopovers));
  document.addEventListener("scroll", () => requestAnimationFrame(adjustFloatingPopovers), true);
  $("#showPhotoInput").addEventListener("change", (event) => {
    state.profile.showPhoto = event.target.checked;
    updatePreviewOnly();
  });
  $("#photoUploadField")?.addEventListener("click", () => {
    $("#photoInput")?.click();
  });
  $("#photoInput").addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      state.profile.photoFileName = "";
      renderAll();
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      state.profile.photo = String(reader.result || "");
      state.profile.photoFileName = file.name || "";
      state.profile.showPhoto = true;
      $("#showPhotoInput").checked = true;
      renderAll();
    };
    reader.readAsDataURL(file);
  });
  $("#addInfoBtn").addEventListener("click", () => {
    state.profile.custom.push({ key: "", value: "" });
    renderAll();
  });
  refs.customInfo.addEventListener("input", (event) => {
    const keyIndex = event.target.dataset.customKey;
    const valueIndex = event.target.dataset.customValue;
    if (keyIndex !== undefined) state.profile.custom[Number(keyIndex)].key = event.target.value;
    if (valueIndex !== undefined) state.profile.custom[Number(valueIndex)].value = event.target.value;
    updatePreviewOnly();
  });
  refs.customInfo.addEventListener("click", (event) => {
    const index = event.target.dataset.removeCustom;
    if (index === undefined) return;
    state.profile.custom.splice(Number(index), 1);
    renderAll();
  });
}

function bindSectionEditor() {
  refs.toggleModuleSidebarBtn.addEventListener("click", () => {
    state.moduleSidebarCollapsed = !state.moduleSidebarCollapsed;
    renderAll();
  });
  refs.moduleSidebarFloatToggle.addEventListener("click", () => {
    state.moduleSidebarCollapsed = false;
    renderAll();
  });
  refs.tabStrip.addEventListener("click", (event) => {
    if (state.justDraggedSidebarSection) {
      state.justDraggedSidebarSection = false;
      return;
    }
    const menuTrigger = event.target.closest("[data-tab-menu-trigger]");
    if (menuTrigger) {
      event.stopPropagation();
      const row = menuTrigger.closest(".module-nav-item");
      const shouldOpen = !row.classList.contains("menu-open");
      refs.tabStrip.querySelectorAll(".module-nav-item.menu-open").forEach((item) => {
        item.classList.remove("menu-open");
        item.querySelector("[data-tab-menu-trigger]")?.setAttribute("aria-expanded", "false");
      });
      row.classList.toggle("menu-open", shouldOpen);
      menuTrigger.setAttribute("aria-expanded", String(shouldOpen));
      return;
    }
    const actionButton = event.target.closest("[data-tab-action]");
    if (actionButton) {
      event.stopPropagation();
      handleTabAction(actionButton.dataset.tabAction, actionButton.dataset.sectionId);
      return;
    }
    if (event.target.closest(".module-rename-input")) return;
    const button = event.target.closest("[data-tab]");
    if (!button) return;
    state.renamingSectionId = "";
    state.activeTab = button.dataset.tab;
    if (button.dataset.sectionId) state.activeSectionId = button.dataset.sectionId;
    state.drawerOpen = true;
    renderAll();
  });
  refs.tabStrip.addEventListener("keydown", (event) => {
    const input = event.target.closest(".module-rename-input");
    if (!input) return;
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      saveSectionRename(input.dataset.renameSectionId, input.value);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      state.renamingSectionId = "";
      renderAll();
    }
  });
  refs.tabStrip.addEventListener("focusout", (event) => {
    const input = event.target.closest(".module-rename-input");
    if (!input) return;
    saveSectionRename(input.dataset.renameSectionId, input.value);
  });
  refs.tabStrip.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".module-rename-input, .tab-tool, .module-action-menu")) event.stopPropagation();
  });
  refs.tabStrip.addEventListener("pointerdown", startSidebarSectionDrag);
  document.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".module-nav-item.menu-open")) return;
    refs.tabStrip.querySelectorAll(".module-nav-item.menu-open").forEach((item) => {
      item.classList.remove("menu-open");
      item.querySelector("[data-tab-menu-trigger]")?.setAttribute("aria-expanded", "false");
    });
  });
  refs.sectionVisibleInput.addEventListener("change", (event) => {
    getActiveSection().visible = event.target.checked;
    renderAll();
  });
  refs.itemList.addEventListener("change", (event) => {
    const visibleKey = event.target.dataset.fieldVisible;
    if (visibleKey) {
      const active = getActiveSection();
      ensureSectionFields(active);
      active.fieldVisibility[visibleKey] = event.target.checked;
      renderAll();
      return;
    }
    const card = event.target.closest("[data-item-id]");
    const field = event.target.dataset.itemField;
    if (event.target.dataset.timeCurrent) {
      updateItemTimeRange(card, "current", event.target.checked);
      if (event.target.checked) closeMonthRange();
      else openMonthRange(card.dataset.itemId, "end");
      renderEditor();
      updatePreviewOnly();
      return;
    }
    const blockStyleControl = event.target.closest("[data-block-style]");
    if (blockStyleControl) {
      applyRichBlockStyle(blockStyleControl.closest("[data-item-id]"), blockStyleControl.dataset.blockStyle, blockStyleControl.value);
      return;
    }
    if (!card || !field) return;
    const activeSection = getActiveSection();
    ensureSectionFields(activeSection);
    const item = activeSection.items.find((entry) => entry.id === card.dataset.itemId);
    if (!item.fields) item.fields = {};
    const nextValue = event.target.type === "checkbox" ? event.target.checked : plainFieldText(event.target.value);
    item.fields[field] = nextValue;
    if (event.target.type !== "checkbox" && event.target.value !== nextValue) event.target.value = nextValue;
    updatePreviewOnly();
  });
  refs.itemList.addEventListener("input", (event) => {
    const card = event.target.closest("[data-item-id]");
    const timePart = event.target.dataset.timePart;
    if (timePart) {
      updateItemTimeRange(card, timePart, event.target.value);
      updatePreviewOnly();
      return;
    }
    const field = event.target.dataset.itemField;
    if (!card || !field) return;
    const activeSection = getActiveSection();
    ensureSectionFields(activeSection);
    const item = activeSection.items.find((entry) => entry.id === card.dataset.itemId);
    if (event.target.isContentEditable) {
      storeRichSelection(event.target);
      syncEditorBody(card);
      recordRichHistory(event.target, "typing");
      storeRichSelection(event.target);
      return;
    }
    if (!item.fields) item.fields = {};
    const nextValue = plainFieldText(event.target.value);
    item.fields[field] = nextValue;
    if (event.target.value !== nextValue && /<\/?[a-z][^>]*>/i.test(event.target.value)) event.target.value = nextValue;
    updatePreviewOnly();
  });
  refs.itemList.addEventListener("pointerdown", (event) => {
    const control = event.target.closest(".rich-toolbar [data-command], .rich-toolbar [data-block-style]");
    if (!control) return;
    const card = control.closest(".item-card");
    const editor = card?.querySelector(".rich-editor");
    if (editor) storeRichSelection(editor);
    if (control.tagName === "BUTTON") event.preventDefault();
  });
  refs.itemList.addEventListener("click", async (event) => {
    const shiftFieldOrderBtn = event.target.closest("[data-shift-field-order]");
    if (shiftFieldOrderBtn) {
      event.preventDefault();
      event.stopPropagation();
      const activeSection = getActiveSection();
      ensureSectionFields(activeSection);
      const fieldKey = shiftFieldOrderBtn.dataset.shiftFieldOrder;
      const step = Number(shiftFieldOrderBtn.dataset.shiftStep || 0);
      if (!fieldKey || !step) return;
      if (shiftSectionFieldOrder(activeSection, fieldKey, step)) {
        renderAll();
      }
      return;
    }
    const addCustomFieldBtn = event.target.closest("[data-add-custom-field]");
    if (addCustomFieldBtn) {
      event.preventDefault();
      const activeSection = getActiveSection();
      ensureSectionFields(activeSection);
      const result = await showWorkbenchModal({
        title: "添加字段",
        description: "字段会添加到当前模块的字段显示区。",
        confirmText: "添加",
        fields: [
          { name: "label", label: "字段名称", placeholder: "例如：部门 / 薪资 / 项目链接", required: true }
        ]
      });
      const nextLabel = String(result?.label || "").trim();
      if (!nextLabel) return;
      const key = `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      if (!Array.isArray(activeSection.customFields)) activeSection.customFields = [];
      activeSection.customFields.push({ key, label: nextLabel });
      activeSection.fieldVisibility[key] = true;
      activeSection.items.forEach((entry) => {
        if (!entry.fields) entry.fields = {};
        entry.fields[key] = "";
      });
      renderAll();
      return;
    }
    const removeCustomFieldBtn = event.target.closest("[data-remove-custom-field]");
    if (removeCustomFieldBtn) {
      event.preventDefault();
      const activeSection = getActiveSection();
      ensureSectionFields(activeSection);
      const fieldKey = removeCustomFieldBtn.dataset.removeCustomField;
      if (!fieldKey) return;
      activeSection.customFields = (activeSection.customFields || []).filter((field) => field.key !== fieldKey);
      delete activeSection.fieldVisibility[fieldKey];
      if (Array.isArray(activeSection.fieldOrder)) {
        activeSection.fieldOrder = activeSection.fieldOrder.filter((key) => key !== fieldKey);
      }
      activeSection.items.forEach((entry) => {
        if (entry.fields && Object.prototype.hasOwnProperty.call(entry.fields, fieldKey)) delete entry.fields[fieldKey];
      });
      renderAll();
      return;
    }
    const timeInput = event.target.closest(".monthrange-input");
    if (timeInput) {
      const control = timeInput.closest("[data-monthrange-control]");
      openMonthRange(control.dataset.itemId, timeInput.dataset.timePart);
      renderEditor();
      return;
    }
    const pickedMonth = event.target.closest("[data-pick-month]");
    if (pickedMonth) {
      const card = pickedMonth.closest("[data-item-id]");
      updateItemTimeRangeFromSelection(card, state.activeMonthRange?.stage || pickedMonth.dataset.timePart, pickedMonth.dataset.pickMonth);
      return;
    }
    const shift = event.target.closest("[data-shift-year]");
    if (shift) {
      const panel = shift.closest(".month-panel");
      const part = shift.dataset.shiftYear;
      const nextYear = Number(panel.dataset.panelYear) + Number(shift.dataset.yearDelta);
      const itemId = shift.closest("[data-monthrange-control]")?.dataset.itemId;
      openMonthRange(itemId, state.activeMonthRange?.stage || "start", {
        startYear: part === "start" ? nextYear : state.activeMonthRange?.startYear,
        endYear: part === "end" ? nextYear : state.activeMonthRange?.endYear
      });
      renderEditor();
      return;
    }
    const blockStyleCycleBtn = event.target.closest("[data-block-style-cycle]");
    if (blockStyleCycleBtn) {
      event.preventDefault();
      const card = blockStyleCycleBtn.closest("[data-item-id]");
      const key = blockStyleCycleBtn.dataset.blockStyleCycle;
      if (!card || !key) return;
      const item = getItemFromCard(card);
      if (!item) return;
      if (!item.richStyle) {
        item.richStyle = {
          lineHeight: 1.65,
          firstIndent: 0,
          hangingIndent: 0
        };
      }
      const nextValue = getNextIndentStep(item.richStyle[key]);
      applyRichBlockStyle(card, key, nextValue);
      return;
    }
    const commandControl = event.target.closest("[data-command]");
    if (!commandControl || commandControl.tagName !== "BUTTON") return;
    event.preventDefault();
    if (commandControl.dataset.command === "createLink") {
      const result = await showWorkbenchModal({
        title: "添加链接",
        description: "为当前选中的文字添加网页或邮箱链接。",
        confirmText: "应用",
        fields: [{ name: "url", label: "链接地址", placeholder: "https://example.com 或 mailto:name@example.com", required: true }]
      });
      const url = normalizeRichLink(result?.url || "");
      if (!url) return;
      applyRichCommand(commandControl.closest("[data-item-id]"), "createLink", url);
      return;
    }
    applyRichCommand(commandControl.closest("[data-item-id]"), commandControl.dataset.command);
  });
  refs.itemList.addEventListener("pointerover", (event) => {
    const monthBtn = event.target.closest("[data-pick-month]");
    if (!monthBtn || !state.activeMonthRange || state.activeMonthRange.stage !== "end") return;
    const control = monthBtn.closest("[data-monthrange-control]");
    if (!control || control.dataset.itemId !== state.activeMonthRange.itemId) return;
    const nextHover = normalizeMonthValue(monthBtn.dataset.pickMonth || "");
    if (!nextHover || nextHover === state.activeMonthRange.hoverMonth) return;
    state.activeMonthRange.hoverMonth = nextHover;
    state.activeMonthRange.suppressOpenAnimation = true;
    renderEditor();
  });
  refs.itemList.addEventListener("change", (event) => {
    const blockStyleControl = event.target.closest("[data-block-style]");
    if (blockStyleControl) return;
    const commandControl = event.target.closest("[data-command]");
    if (!commandControl) return;
    event.preventDefault();
    applyRichCommand(commandControl.closest("[data-item-id]"), commandControl.dataset.command, commandControl.value);
  });
  refs.itemList.addEventListener("keyup", (event) => {
    const editor = event.target.closest(".rich-editor");
    if (editor) {
      storeRichSelection(editor);
      updateRichToolbarState(editor.closest(".item-card"));
    }
  });
  refs.itemList.addEventListener("mouseup", (event) => {
    const editor = event.target.closest(".rich-editor");
    if (editor) {
      storeRichSelection(editor);
      updateRichToolbarState(editor.closest(".item-card"));
    }
  });
  refs.itemList.addEventListener("focusin", (event) => {
    const editor = event.target.closest(".rich-editor");
    if (editor) {
      getRichHistory(editor);
      storeRichSelection(editor);
      updateRichToolbarState(editor.closest(".item-card"));
    }
  });
  refs.itemList.addEventListener("keydown", (event) => {
    const editor = event.target.closest(".rich-editor");
    if (!editor) return;
    const card = editor.closest(".item-card");
    const shortcutKey = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && shortcutKey === "z") {
      event.preventDefault();
      applyRichHistory(card, event.shiftKey ? 1 : -1);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && shortcutKey === "y") {
      event.preventDefault();
      applyRichHistory(card, 1);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey) {
      const key = shortcutKey;
      if (key === "b") {
        event.preventDefault();
        applyRichCommand(card, "bold");
        return;
      }
      if (key === "i") {
        event.preventDefault();
        applyRichCommand(card, "italic");
        return;
      }
      if (key === "u") {
        event.preventDefault();
        applyRichCommand(card, "underline");
        return;
      }
    }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey) {
      const key = event.key.toLowerCase();
      if (key === "8") {
        event.preventDefault();
        applyRichCommand(card, "insertUnorderedList");
        return;
      }
      if (key === "7") {
        event.preventDefault();
        applyRichCommand(card, "insertOrderedList");
        return;
      }
      if (key === "l") {
        event.preventDefault();
        applyRichCommand(card, "justifyLeft");
        return;
      }
      if (key === "e") {
        event.preventDefault();
        applyRichCommand(card, "justifyCenter");
        return;
      }
      if (key === "r") {
        event.preventDefault();
        applyRichCommand(card, "justifyRight");
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      insertBreakAtSelection(editor, true);
      enforceEditorDefaults(editor);
      syncEditorBody(card);
      recordRichHistory(editor, "paragraph", true);
      updateRichToolbarState(card);
      return;
    }
    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      insertBreakAtSelection(editor, false);
      enforceEditorDefaults(editor);
      syncEditorBody(card);
      recordRichHistory(editor, "line-break", true);
      updateRichToolbarState(card);
    }
  });
  refs.itemList.addEventListener("paste", (event) => {
    const editor = event.target.closest(".rich-editor");
    if (!editor) return;
    event.preventDefault();
    const card = editor.closest(".item-card");
    const html = event.clipboardData?.getData("text/html") || "";
    const text = event.clipboardData?.getData("text/plain") || "";
    const content = html ? sanitizeRich(html) : sanitizeRich(text.replace(/\r/g, "").split("\n").map((line) => `<div>${escapeHtml(line)}</div>`).join(""));
    insertHtmlAtSelection(editor, content || "<br>");
    enforceEditorDefaults(editor);
    syncEditorBody(card);
    recordRichHistory(editor, "paste", true);
    updateRichToolbarState(card);
  });
  refs.itemList.addEventListener("dblclick", (event) => {
    const timeInput = event.target.closest(".monthrange-input");
    if (!timeInput) return;
    openMonthRange(timeInput.closest("[data-monthrange-control]").dataset.itemId, timeInput.dataset.timePart, { manual: true });
    renderEditor();
    requestAnimationFrame(() => {
      const activeInput = refs.itemList.querySelector(`[data-item-id="${CSS.escape(timeInput.closest("[data-item-id]").dataset.itemId)}"] .monthrange-input[data-time-part="${timeInput.dataset.timePart}"]`);
      activeInput?.focus();
      activeInput?.select();
    });
  });
  refs.itemList.addEventListener("focusout", (event) => {
    const timeInput = event.target.closest(".monthrange-input");
    if (!timeInput) return;
    const related = event.relatedTarget;
    if (related && related.closest("[data-monthrange-control]") === timeInput.closest("[data-monthrange-control]")) return;
    if (state.activeMonthRange?.manual) {
      closeMonthRange();
      renderEditor();
      updatePreviewOnly();
    }
  });
  refs.itemList.addEventListener("click", (event) => {
    const id = event.target.dataset.deleteItem;
    if (!id) return;
    const active = getActiveSection();
    active.items = active.items.filter((item) => item.id !== id);
    if (!active.items.length) active.items.push(blankItem());
    renderAll();
  });
  bindItemActionButtons();
  refs.resumeHead.addEventListener("click", handleProfilePreviewClick);
  refs.resumeSections.addEventListener("focusin", (event) => {
    const body = event.target.closest("[data-preview-body]");
    if (!body) return;
    const sectionEl = body.closest("[data-section-id]");
    if (sectionEl) {
      state.activeSectionId = sectionEl.dataset.sectionId;
      state.activeTab = "section";
    }
    body.classList.add("is-direct-editing");
  });
  refs.resumeSections.addEventListener("input", (event) => {
    const body = event.target.closest("[data-preview-body]");
    if (!body) return;
    const sectionItem = state.sections.find((item) => item.id === body.closest("[data-section-id]")?.dataset.sectionId);
    const item = sectionItem?.items?.find((entry) => entry.id === body.dataset.itemId);
    if (!item) return;
    item.body = body.innerHTML;
    const matchingEditor = refs.itemList.querySelector(`.item-card[data-item-id="${CSS.escape(item.id)}"] .rich-editor`);
    if (matchingEditor && document.activeElement !== matchingEditor) matchingEditor.innerHTML = body.innerHTML;
    persist();
  });
  refs.resumeSections.addEventListener("paste", (event) => {
    const body = event.target.closest("[data-preview-body]");
    if (!body) return;
    event.preventDefault();
    const html = event.clipboardData?.getData("text/html") || "";
    const text = event.clipboardData?.getData("text/plain") || "";
    const content = html ? sanitizeRich(html) : sanitizeRich(text.replace(/\r/g, "").split("\n").map((line) => `<div>${escapeHtml(line)}</div>`).join(""));
    insertHtmlAtSelection(body, content || "<br>");
    body.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" }));
  });
  refs.resumeSections.addEventListener("focusout", (event) => {
    const body = event.target.closest("[data-preview-body]");
    if (!body) return;
    const cleaned = sanitizeRich(body.innerHTML || "");
    if (body.innerHTML !== cleaned) body.innerHTML = cleaned;
    const sectionItem = state.sections.find((item) => item.id === body.closest("[data-section-id]")?.dataset.sectionId);
    const item = sectionItem?.items?.find((entry) => entry.id === body.dataset.itemId);
    if (item) item.body = cleaned;
    body.classList.remove("is-direct-editing");
    renderTabs();
    renderEditor();
    syncPreviewPagination();
    persist();
  });
  refs.resumeSections.addEventListener("pointerdown", startSectionDrag);
  document.addEventListener("pointerdown", (event) => {
    if (!state.activeMonthRange) return;
    if (event.target.closest("[data-monthrange-control]")) return;
    closeMonthRange();
    renderEditor();
  });
  document.addEventListener("selectionchange", () => {
    const card = getActiveRichCard();
    if (!card) return;
    updateRichToolbarState(card);
  });
}

function bindItemActionButtons() {
  const addBtn = $("#addItemBtn");
  const clearBtn = $("#clearSectionBtn");
  const duplicateBtn = $("#duplicateSectionBtn");
  if (!addBtn || !clearBtn || !duplicateBtn) return;
  addBtn.onclick = () => {
    const active = getActiveSection();
    ensureSectionFields(active);
    const next = blankItem();
    next.fields = {};
    active.items.push(next);
    state.pendingScrollItemId = next.id;
    renderAll();
  };
  clearBtn.onclick = () => {
    getActiveSection().items = [blankItem()];
    renderAll();
  };
  duplicateBtn.onclick = () => {
    duplicateSection(state.activeSectionId);
  };
}

function getItemFromCard(card) {
  if (!card) return null;
  const activeSection = getActiveSection();
  ensureSectionFields(activeSection);
  const item = activeSection.items.find((entry) => entry.id === card.dataset.itemId);
  if (item && !item.fields) item.fields = {};
  if (item && !item.fields.timeRange) item.fields.timeRange = { start: "", end: "", current: false };
  return item;
}

function captureRichSelectionBookmark(editor) {
  const range = getSelectionRangeInEditor(editor);
  if (!range) return null;
  const measure = (container, offset) => {
    const probe = document.createRange();
    probe.selectNodeContents(editor);
    probe.setEnd(container, offset);
    return probe.toString().length;
  };
  return {
    start: measure(range.startContainer, range.startOffset),
    end: measure(range.endContainer, range.endOffset)
  };
}

function restoreRichSelectionBookmark(editor, bookmark, collapseToEnd = false) {
  if (!editor || !bookmark) return false;
  const range = document.createRange();
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let consumed = 0;
  let startSet = false;
  while (node) {
    const next = consumed + node.nodeValue.length;
    if (!startSet && bookmark.start <= next) {
      range.setStart(node, Math.max(0, bookmark.start - consumed));
      startSet = true;
    }
    if (startSet && bookmark.end <= next) {
      range.setEnd(node, Math.max(0, bookmark.end - consumed));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      if (collapseToEnd) selection.collapseToEnd();
      return true;
    }
    consumed = next;
    node = walker.nextNode();
  }
  range.selectNodeContents(editor);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function getRichHistory(editor) {
  const itemId = editor?.closest("[data-item-id]")?.dataset.itemId || "";
  if (!itemId || !editor) return null;
  if (!richTextHistories.has(itemId)) {
    richTextHistories.set(itemId, {
      entries: [sanitizeRich(editor.innerHTML || "")],
      index: 0,
      lastKind: "",
      lastAt: 0
    });
  }
  return richTextHistories.get(itemId);
}

function updateRichHistoryButtons(card) {
  const editor = card?.querySelector(".rich-editor");
  const history = getRichHistory(editor);
  if (!history) return;
  const undo = card.querySelector('[data-command="undo"]');
  const redo = card.querySelector('[data-command="redo"]');
  if (undo) undo.disabled = history.index <= 0;
  if (redo) redo.disabled = history.index >= history.entries.length - 1;
}

function recordRichHistory(editor, kind = "edit", force = false) {
  const history = getRichHistory(editor);
  if (!history) return;
  const html = sanitizeRich(editor.innerHTML || "");
  if (history.entries[history.index] === html) {
    updateRichHistoryButtons(editor.closest(".item-card"));
    return;
  }
  const now = Date.now();
  const coalesce = !force && kind === "typing" && history.lastKind === "typing" && now - history.lastAt < 900 && history.index === history.entries.length - 1;
  if (coalesce) {
    history.entries[history.index] = html;
  } else {
    history.entries = history.entries.slice(0, history.index + 1);
    history.entries.push(html);
    if (history.entries.length > RICH_HISTORY_LIMIT) history.entries.shift();
    history.index = history.entries.length - 1;
  }
  history.lastKind = kind;
  history.lastAt = now;
  updateRichHistoryButtons(editor.closest(".item-card"));
}

function applyRichHistory(card, direction) {
  const editor = card?.querySelector(".rich-editor");
  const history = getRichHistory(editor);
  if (!editor || !history) return false;
  const nextIndex = clamp(history.index + direction, 0, history.entries.length - 1);
  if (nextIndex === history.index) return false;
  history.index = nextIndex;
  editor.innerHTML = history.entries[history.index];
  history.lastKind = "history";
  history.lastAt = Date.now();
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  storeRichSelection(editor);
  syncEditorBody(card);
  updateRichHistoryButtons(card);
  updateRichToolbarState(card);
  return true;
}

function syncEditorBody(card) {
  if (!card) return;
  const item = getItemFromCard(card);
  const editor = card.querySelector(".rich-editor");
  if (!item || !editor) return;
  enforceEditorDefaults(editor);
  const bookmark = captureRichSelectionBookmark(editor);
  const cleaned = sanitizeRich(editor.innerHTML || "");
  if (editor.innerHTML !== cleaned) {
    editor.innerHTML = cleaned;
    restoreRichSelectionBookmark(editor, bookmark);
  }
  item.body = cleaned;
  updatePreviewOnly();
}

function storeRichSelection(editor) {
  const selection = window.getSelection();
  if (!editor || !selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return;
  richTextSelection = range.cloneRange();
  richTextSelectionItemId = editor.closest("[data-item-id]")?.dataset.itemId || "";
  richTextSelectionBookmark = captureRichSelectionBookmark(editor);
}

function restoreRichSelection(card) {
  const editor = card?.querySelector(".rich-editor");
  if (!editor) return;
  editor.focus();
  if (richTextSelectionItemId !== card.dataset.itemId) return;
  const selection = window.getSelection();
  if (richTextSelection && editor.contains(richTextSelection.commonAncestorContainer)) {
    selection.removeAllRanges();
    selection.addRange(richTextSelection);
    return;
  }
  restoreRichSelectionBookmark(editor, richTextSelectionBookmark);
}

function getSelectionRangeInEditor(editor) {
  const selection = window.getSelection();
  if (!editor || !selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return null;
  return range;
}

function getActiveRichCard() {
  const focused = document.activeElement?.closest?.(".item-card[data-item-id]");
  if (focused) return focused;
  if (richTextSelectionItemId) {
    return refs.itemList.querySelector(`.item-card[data-item-id="${CSS.escape(richTextSelectionItemId)}"]`);
  }
  return null;
}

function getSelectedBlocks(editor) {
  const range = getSelectionRangeInEditor(editor);
  if (!range) return [];
  const blockSelectors = "p,div,li";
  const blocks = [...editor.querySelectorAll(blockSelectors)].filter((node) => {
    try {
      return range.intersectsNode(node);
    } catch {
      return false;
    }
  });
  if (blocks.length) return [...new Set(blocks)];
  const anchor = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer
    : range.startContainer.parentElement;
  let nearest = anchor?.closest?.(blockSelectors);
  if (nearest === editor) {
    const childIndex = clamp(range.startOffset, 0, Math.max(0, editor.childNodes.length - 1));
    const child = editor.childNodes[childIndex] || editor.lastChild;
    const childElement = child?.nodeType === Node.ELEMENT_NODE ? child : child?.parentElement;
    nearest = childElement?.matches?.(blockSelectors) ? childElement : childElement?.closest?.(blockSelectors);
  }
  if (nearest && nearest !== editor) return [nearest];
  const firstBlock = [...editor.children].find((child) => child.matches?.(blockSelectors));
  return firstBlock ? [firstBlock] : [];
}

function closestAllowedFontSize(px) {
  const list = wordFontSizes().map(([value]) => Number.parseFloat(value)).filter(Number.isFinite);
  if (!list.length || !Number.isFinite(px)) return "";
  const nearest = list.reduce((best, size) => Math.abs(size - px) < Math.abs(best - px) ? size : best, list[0]);
  return `${nearest}px`;
}

function getSelectionStyleSnapshot(editor) {
  const range = getSelectionRangeInEditor(editor);
  if (!range) return null;
  const node = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer
    : range.startContainer.parentElement;
  if (!node) return null;
  const el = node.closest("span,strong,b,em,i,u,li,p,div") || editor;
  const style = getComputedStyle(el);
  const fontSize = Number.parseFloat(style.fontSize || "");
  const lineHeight = Number.parseFloat(style.lineHeight || "");
  const ratio = fontSize > 0 && Number.isFinite(lineHeight) ? (lineHeight / fontSize) : NaN;
  const alignNode = el.closest("li,p,div") || editor;
  const align = (alignNode.style.textAlign || style.textAlign || "left").toLowerCase();
  return {
    fontSize: closestAllowedFontSize(fontSize),
    fontFamily: normalizeAllowedFontFamily(style.fontFamily || ""),
    lineHeight: Number.isFinite(ratio) ? wordLineHeights().reduce((best, [value]) => {
      const target = Number(value);
      return Math.abs(target - ratio) < Math.abs(Number(best || target) - ratio) ? value : best;
    }, "1.5") : "",
    align
  };
}

function selectionHasInlineFormat(editor, format) {
  const range = getSelectionRangeInEditor(editor);
  if (!range) return false;
  const node = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
  const style = getComputedStyle(node || editor);
  if (format === "bold") return Number.parseInt(style.fontWeight, 10) >= 600 || /bold/i.test(style.fontWeight);
  if (format === "italic") return style.fontStyle === "italic";
  if (format === "underline") return String(style.textDecorationLine || style.textDecoration || "").includes("underline");
  if (format === "strikeThrough") return String(style.textDecorationLine || style.textDecoration || "").includes("line-through");
  return false;
}

function updateRichToolbarState(card) {
  if (!card) return;
  const editor = card.querySelector(".rich-editor");
  const toolbar = card.querySelector(".rich-toolbar");
  if (!editor || !toolbar) return;
  const focusedInEditor = document.activeElement === editor || editor.contains(document.activeElement);
  const focusedInToolbar = toolbar.contains(document.activeElement);
  if (!focusedInEditor && !focusedInToolbar && richTextSelectionItemId !== card.dataset.itemId) return;
  const commandButtons = [...toolbar.querySelectorAll("button[data-command]")];
  commandButtons.forEach((btn) => {
    btn.classList.remove("active");
    if (btn.hasAttribute("aria-pressed")) btn.setAttribute("aria-pressed", "false");
  });
  const markActive = (command) => {
    const btn = toolbar.querySelector(`[data-command="${command}"]`);
    if (!btn) return;
    btn.classList.add("active");
    btn.setAttribute("aria-pressed", "true");
  };
  if (selectionHasInlineFormat(editor, "bold")) markActive("bold");
  if (selectionHasInlineFormat(editor, "italic")) markActive("italic");
  if (selectionHasInlineFormat(editor, "underline")) markActive("underline");
  if (selectionHasInlineFormat(editor, "strikeThrough")) markActive("strikeThrough");
  const selectionRange = getSelectionRangeInEditor(editor);
  const selectionNode = selectionRange?.startContainer?.nodeType === Node.ELEMENT_NODE
    ? selectionRange.startContainer
    : selectionRange?.startContainer?.parentElement;
  if (selectionNode?.closest?.("ul")) markActive("insertUnorderedList");
  if (selectionNode?.closest?.("ol")) markActive("insertOrderedList");
  const snapshot = getSelectionStyleSnapshot(editor);
  if (!snapshot) {
    markActive("justifyLeft");
    return;
  }
  if (snapshot.align.includes("center")) markActive("justifyCenter");
  else if (snapshot.align.includes("right")) markActive("justifyRight");
  else if (snapshot.align.includes("justify")) markActive("justifyFull");
  else markActive("justifyLeft");
  const sizeSelect = toolbar.querySelector('.toolbar-size[data-command="styleFontSize"]');
  const fontSelect = toolbar.querySelector('.toolbar-font[data-command="fontName"]');
  const lineSelect = toolbar.querySelector('.toolbar-line-height[data-block-style="lineHeight"]');
  const presetSelect = toolbar.querySelector('.toolbar-paragraph-style[data-block-style="paragraphPreset"]');
  if (sizeSelect) sizeSelect.value = snapshot.fontSize || "";
  if (fontSelect) fontSelect.value = snapshot.fontFamily || "";
  if (lineSelect) lineSelect.value = snapshot.lineHeight || "";
  if (presetSelect) {
    const range = getSelectionRangeInEditor(editor);
    const node = range?.startContainer?.nodeType === Node.ELEMENT_NODE ? range.startContainer : range?.startContainer?.parentElement;
    const block = node?.closest?.("p,div,li");
    presetSelect.value = block?.dataset?.paragraphPreset || "";
  }
  const activeRange = getSelectionRangeInEditor(editor);
  const selectedText = activeRange && !activeRange.collapsed ? activeRange.toString() : "";
  const bookmarkedLength = richTextSelectionItemId === card.dataset.itemId && richTextSelectionBookmark
    ? Math.max(0, richTextSelectionBookmark.end - richTextSelectionBookmark.start)
    : 0;
  const selectedLength = selectedText.length || bookmarkedLength;
  const status = toolbar.querySelector(".toolbar-selection-status");
  if (status) status.textContent = selectedLength ? `已选 ${selectedLength} 字` : (presetSelect?.selectedOptions?.[0]?.textContent || "正文");
  updateRichHistoryButtons(card);
}

function applyInlineStyleToSelection(editor, styleMap = {}) {
  const range = getSelectionRangeInEditor(editor);
  if (!range) return false;
  if (range.collapsed) {
    const marker = document.createElement("span");
    Object.entries(styleMap).forEach(([key, value]) => {
      if (safeText(value) !== "") marker.style.setProperty(key, String(value));
    });
    marker.appendChild(document.createTextNode("\u200B"));
    range.insertNode(marker);
    setSelectionAfterNode(marker, true);
    return true;
  }
  const wrapper = document.createElement("span");
  Object.entries(styleMap).forEach(([k, v]) => {
    if (safeText(v) !== "") wrapper.style.setProperty(k, String(v));
  });
  try {
    range.surroundContents(wrapper);
  } catch {
    const fragment = range.extractContents();
    wrapper.appendChild(fragment);
    range.insertNode(wrapper);
  }
  return true;
}

function setSelectionAfterNode(node, inside = false) {
  if (!node) return;
  const selection = window.getSelection();
  const range = document.createRange();
  if (inside) range.selectNodeContents(node);
  else range.setStartAfter(node);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function stripInlineFormatFromFragment(fragment, formats = ["bold", "italic", "underline", "strikeThrough"]) {
  const selectors = [];
  if (formats.includes("bold")) selectors.push("strong", "b");
  if (formats.includes("italic")) selectors.push("em", "i");
  if (formats.includes("underline")) selectors.push("u");
  if (formats.includes("strikeThrough")) selectors.push("s", "strike");
  if (selectors.length) fragment.querySelectorAll?.(selectors.join(",")).forEach((node) => node.replaceWith(...node.childNodes));
  fragment.querySelectorAll?.("[style]").forEach((node) => {
    if (formats.includes("bold")) node.style.removeProperty("font-weight");
    if (formats.includes("italic")) node.style.removeProperty("font-style");
    if (formats.includes("underline")) node.style.removeProperty("text-decoration");
    if (formats.includes("strikeThrough")) node.style.removeProperty("text-decoration");
    if (!node.getAttribute("style")) node.removeAttribute("style");
  });
}

function toggleInlineFormat(editor, format) {
  const range = getSelectionRangeInEditor(editor);
  if (!range) return false;
  const activeStyle = {
    bold: { "font-weight": "700" },
    italic: { "font-style": "italic" },
    underline: { "text-decoration": "underline" },
    strikeThrough: { "text-decoration": "line-through" }
  }[format];
  const inactiveStyle = {
    bold: { "font-weight": "400" },
    italic: { "font-style": "normal" },
    underline: { "text-decoration": "none" },
    strikeThrough: { "text-decoration": "none" }
  }[format];
  if (!activeStyle || !inactiveStyle) return false;
  const active = selectionHasInlineFormat(editor, format);
  if (range.collapsed) {
    const mark = document.createElement("span");
    Object.entries(active ? inactiveStyle : activeStyle).forEach(([key, value]) => mark.style.setProperty(key, value));
    mark.appendChild(document.createTextNode("\u200B"));
    range.insertNode(mark);
    setSelectionAfterNode(mark, true);
    return true;
  }
  const fragment = range.extractContents();
  const mark = document.createElement("span");
  Object.entries(active ? inactiveStyle : activeStyle).forEach(([key, value]) => mark.style.setProperty(key, value));
  mark.appendChild(fragment);
  range.insertNode(mark);
  const selection = window.getSelection();
  const nextRange = document.createRange();
  nextRange.selectNodeContents(mark);
  selection.removeAllRanges();
  selection.addRange(nextRange);
  return true;
}

function insertHtmlAtSelection(editor, html) {
  const range = getSelectionRangeInEditor(editor);
  if (!range) return false;
  range.deleteContents();
  const template = document.createElement("template");
  template.innerHTML = html;
  const fragment = template.content;
  const last = fragment.lastChild;
  range.insertNode(fragment);
  if (last) setSelectionAfterNode(last);
  return true;
}

function insertBreakAtSelection(editor, paragraph = false) {
  const range = getSelectionRangeInEditor(editor);
  if (!range) return false;
  range.deleteContents();
  const node = paragraph ? document.createElement("div") : document.createElement("br");
  if (paragraph) node.appendChild(document.createElement("br"));
  range.insertNode(node);
  setSelectionAfterNode(node, paragraph);
  return true;
}

function applyParagraphCommand(card, key, value) {
  const editor = card?.querySelector(".rich-editor");
  if (!editor) return;
  const blocks = getSelectedBlocks(editor);
  if (!blocks.length) return;
  if (key === "lineHeight") {
    blocks.forEach((block) => block.style.lineHeight = String(value || ""));
    const item = getItemFromCard(card);
    if (item?.richStyle) item.richStyle.lineHeight = Number(value || item.richStyle.lineHeight || 1.65);
    return;
  }
  if (key === "textAlign") {
    blocks.forEach((block) => block.style.textAlign = String(value || "left"));
    return;
  }
  if (key === "paragraphPreset") {
    const preset = String(value || "");
    const presetStyle = {
      body: { fontSize: "", fontWeight: "", lineHeight: "1.5" },
      subtitle: { fontSize: "16px", fontWeight: "700", lineHeight: "1.5" },
      title: { fontSize: "18px", fontWeight: "700", lineHeight: "1.35" }
    }[preset] || { fontSize: "", fontWeight: "", lineHeight: "" };
    blocks.forEach((block) => {
      if (presetStyle.fontSize) block.style.fontSize = presetStyle.fontSize;
      else block.style.removeProperty("font-size");
      if (presetStyle.fontWeight) block.style.fontWeight = presetStyle.fontWeight;
      else block.style.removeProperty("font-weight");
      if (presetStyle.lineHeight) block.style.lineHeight = presetStyle.lineHeight;
      else block.style.removeProperty("line-height");
      block.dataset.paragraphPreset = preset;
    });
  }
}

function adjustParagraphIndent(card, delta = 0) {
  const editor = card?.querySelector(".rich-editor");
  if (!editor) return;
  getSelectedBlocks(editor).forEach((block) => {
    const inlineValue = Number.parseFloat(block.style.marginLeft || "");
    const computed = getComputedStyle(block);
    const fontSize = Number.parseFloat(computed.fontSize || "16") || 16;
    const current = Number.isFinite(inlineValue)
      ? inlineValue
      : (Number.parseFloat(computed.marginLeft || "0") || 0) / fontSize;
    const next = clamp(Math.round((current + delta) * 10) / 10, 0, 8);
    if (next) block.style.marginLeft = `${next}em`;
    else block.style.removeProperty("margin-left");
  });
}

function clearInlineStyles(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
  const allowedKeep = new Set(["ul", "ol", "li", "p", "div", "br"]);
  if (!allowedKeep.has(el.tagName.toLowerCase())) {
    el.style.removeProperty("font-size");
    el.style.removeProperty("font-family");
    el.style.removeProperty("font-weight");
    el.style.removeProperty("font-style");
    el.style.removeProperty("text-decoration");
    el.style.removeProperty("line-height");
    el.style.removeProperty("text-align");
    el.style.removeProperty("margin-left");
    el.style.removeProperty("text-indent");
    el.style.removeProperty("color");
    el.style.removeProperty("background");
    el.style.removeProperty("background-color");
  } else {
    el.style.removeProperty("line-height");
    el.style.removeProperty("text-align");
    el.style.removeProperty("margin-left");
    el.style.removeProperty("text-indent");
  }
}

function applyRemoveFormat(card) {
  const editor = card?.querySelector(".rich-editor");
  if (!editor) return;
  restoreRichSelection(card);
  const range = getSelectionRangeInEditor(editor);
  if (range && !range.collapsed) {
    const fragment = range.extractContents();
    stripInlineFormatFromFragment(fragment);
    fragment.querySelectorAll?.("[style]").forEach((node) => node.removeAttribute("style"));
    const last = fragment.lastChild;
    range.insertNode(fragment);
    if (last) setSelectionAfterNode(last);
  }
  const candidates = range
    ? [...editor.querySelectorAll("*")].filter((node) => {
        try { return range.intersectsNode(node); } catch { return false; }
      })
    : getSelectedBlocks(editor);
  if (candidates.length) candidates.forEach(clearInlineStyles);
  else clearInlineStyles(editor);
}

function enforceEditorDefaults(editor) {
  if (!editor) return;
  const blocks = [...editor.querySelectorAll("p,div,li")];
  if (!blocks.length) return;
  blocks.forEach((block) => {
    const textAlign = (block.style.textAlign || "").trim().toLowerCase();
    if (!textAlign) block.style.textAlign = "left";
  });
}

function normalizeRichLink(value = "") {
  const input = String(value || "").trim();
  if (!input) return "";
  if (/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(input)) return input;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`;
  try {
    const parsed = new URL(candidate);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function applyLinkToSelection(editor, href) {
  const safeHref = normalizeRichLink(href);
  const range = getSelectionRangeInEditor(editor);
  if (!safeHref || !range) return false;
  const link = document.createElement("a");
  link.href = safeHref;
  if (range.collapsed) link.textContent = safeHref.replace(/^mailto:/i, "");
  else link.appendChild(range.extractContents());
  range.insertNode(link);
  const selection = window.getSelection();
  const nextRange = document.createRange();
  nextRange.selectNodeContents(link);
  selection.removeAllRanges();
  selection.addRange(nextRange);
  return true;
}

function removeLinksFromSelection(editor) {
  const range = getSelectionRangeInEditor(editor);
  if (!range) return false;
  const anchors = [...editor.querySelectorAll("a")].filter((node) => {
    try { return range.intersectsNode(node); } catch { return false; }
  });
  const startNode = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
  const closest = startNode?.closest?.("a");
  if (closest && editor.contains(closest) && !anchors.includes(closest)) anchors.push(closest);
  anchors.forEach((anchor) => anchor.replaceWith(...anchor.childNodes));
  return anchors.length > 0;
}

function applyRichCommand(card, command, value = null) {
  if (!card) return;
  if (command === "undo") {
    applyRichHistory(card, -1);
    return;
  }
  if (command === "redo") {
    applyRichHistory(card, 1);
    return;
  }
  restoreRichSelection(card);
  const editor = card.querySelector(".rich-editor");
  if (!editor) return;
  getRichHistory(editor);
  const range = getSelectionRangeInEditor(editor);
  const isCollapsed = !range || range.collapsed;
  let deferSync = false;
  if (["bold", "italic", "underline", "strikeThrough"].includes(command)) {
    toggleInlineFormat(editor, command);
    deferSync = isCollapsed;
  } else if (command === "styleFontSize" && value) {
    applyInlineStyleToSelection(editor, { "font-size": value });
    deferSync = isCollapsed;
  } else if (command === "fontName" && value) {
    const normalized = normalizeAllowedFontFamily(value);
    applyInlineStyleToSelection(editor, { "font-family": normalized });
    deferSync = isCollapsed;
  } else if (command === "foreColor" && value) {
    applyInlineStyleToSelection(editor, { color: value });
    deferSync = isCollapsed;
  } else if (command === "hiliteColor" && value) {
    applyInlineStyleToSelection(editor, { "background-color": value });
    deferSync = isCollapsed;
  } else if (command === "createLink" && value) {
    applyLinkToSelection(editor, value);
  } else if (command === "unlink") {
    removeLinksFromSelection(editor);
  } else if (command === "justifyLeft") {
    applyParagraphCommand(card, "textAlign", "left");
  } else if (command === "justifyCenter") {
    applyParagraphCommand(card, "textAlign", "center");
  } else if (command === "justifyRight") {
    applyParagraphCommand(card, "textAlign", "right");
  } else if (command === "justifyFull") {
    applyParagraphCommand(card, "textAlign", "justify");
  } else if (command === "indent") {
    adjustParagraphIndent(card, 1);
  } else if (command === "outdent") {
    adjustParagraphIndent(card, -1);
  } else if (command === "removeFormat") {
    applyRemoveFormat(card);
  } else {
    document.execCommand(command, false, value);
  }
  if (deferSync) {
    storeRichSelection(editor);
    updateRichToolbarState(card);
    return;
  }
  enforceEditorDefaults(editor);
  syncEditorBody(card);
  recordRichHistory(editor, command, true);
  storeRichSelection(editor);
  updateRichToolbarState(card);
}

function applyRichBlockStyle(card, key, value) {
  const item = getItemFromCard(card);
  const editor = card?.querySelector(".rich-editor");
  if (!item || !editor) return;
  restoreRichSelection(card);
  getRichHistory(editor);
  if (!item.richStyle) {
    item.richStyle = {
      lineHeight: 1.65,
      firstIndent: 0,
      hangingIndent: 0
    };
  }
  if (key === "lineHeight") {
    applyParagraphCommand(card, "lineHeight", Number(value || item.richStyle.lineHeight || 1.5));
    editor.style.cssText = getItemTextBlockStyle(item);
    syncEditorBody(card);
    recordRichHistory(editor, key, true);
    updateRichToolbarState(card);
    return;
  }
  if (key === "paragraphPreset") {
    applyParagraphCommand(card, "paragraphPreset", value);
    syncEditorBody(card);
    recordRichHistory(editor, key, true);
    updateRichToolbarState(card);
    return;
  }
  item.richStyle[key] = Number(value || 0);
  editor.style.cssText = getItemTextBlockStyle(item);
  const indentChip = card?.querySelector(`[data-indent-value="${key}"]`);
  if (indentChip) indentChip.textContent = formatIndentLabel(item.richStyle[key]);
  syncEditorBody(card);
  updateRichToolbarState(card);
}

function updateItemTimeRange(card, part, value) {
  const item = getItemFromCard(card);
  if (!item) return;
  const next = { ...(item.fields.timeRange || {}) };
  if (part === "current") {
    next.current = Boolean(value);
    if (next.current) next.end = "";
  } else {
    next[part] = normalizeMonthValue(value);
    if (part === "end" && next.current) next.current = false;
  }
  item.fields.timeRange = next;
}

function updateItemTimeRangeFromSelection(card, stage, pickedMonth) {
  const item = getItemFromCard(card);
  if (!item) return;
  const current = { ...(item.fields.timeRange || {}) };
  const value = normalizeMonthValue(pickedMonth);
  if (stage === "start") {
    current.start = value;
    if (current.end && current.end < current.start) current.end = "";
    current.current = false;
    item.fields.timeRange = current;
    openMonthRange(item.id, "end", {
      startYear: Number(value.slice(0, 4)),
      endYear: Math.max(Number(value.slice(0, 4)), Number((state.activeMonthRange?.endYear || value.slice(0, 4))))
    });
    renderEditor();
    updatePreviewOnly();
    return;
  }
  if (current.start && value < current.start) {
    current.end = current.start;
    current.start = value;
  } else {
    current.end = value;
  }
  current.current = false;
  item.fields.timeRange = current;
  closeMonthRange();
  renderEditor();
  updatePreviewOnly();
}

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function handleProfilePreviewClick() {
  state.activeTab = "profile";
  state.drawerOpen = true;
  refs.moduleAdjustCard.classList.add("hidden");
  renderAll();
}

function openSectionFromPointer(sectionId) {
  state.activeSectionId = sectionId;
  state.activeTab = "section";
  state.drawerOpen = true;
  refs.moduleAdjustCard.classList.add("hidden");
  renderAll();
}

function bindSettings() {
  $$(".tool-btn[data-panel]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const isSamePanelOpen = state.activeSettings === button.dataset.panel && !refs.settingsCard.classList.contains("hidden");
      state.activeSettings = button.dataset.panel;
      refs.settingsCard.classList.toggle("hidden", isSamePanelOpen);
      if (!isSamePanelOpen) pulseSettingsCard();
      renderAll();
    });
  });
  $("#closeSettingsBtn").addEventListener("click", () => refs.settingsCard.classList.add("hidden"));
  document.addEventListener("pointerdown", (event) => {
    if (refs.settingsCard.classList.contains("hidden")) return;
    if (event.target.closest("#settingsCard, .tool-btn[data-panel]")) return;
    refs.settingsCard.classList.add("hidden");
  });
  $("#drawerHandle").addEventListener("click", () => {
    state.drawerOpen = !state.drawerOpen;
    renderAll();
  });
  let zoomBeforePreview = null;
  $("#previewBtn").addEventListener("click", () => {
    const enteringPreview = state.drawerOpen;
    if (enteringPreview) zoomBeforePreview = state.previewZoom;
    state.drawerOpen = !state.drawerOpen;
    refs.settingsCard.classList.add("hidden");
    renderAll();
    requestAnimationFrame(() => {
      if (!state.drawerOpen) fitFetchCVCanonicalPreview();
      else if (zoomBeforePreview !== null) {
        setPreviewZoom(zoomBeforePreview, { persist: false });
        zoomBeforePreview = null;
      }
    });
  });
  layoutSettingPairs.forEach(bindLayoutSettingPair);
  [
    ["fontSizeRange", "fontSize"], ["nameSizeRange", "nameSize"]
  ].forEach(([id, key]) => bindSettingInput(id, key, Number));
  bindSettingInput("fontFamilyInput", "fontFamily", String);
  bindSettingInput("titleStyleInput", "titleStyle", String);
  bindSettingInput("letterInput", "letter", String);
  $("#languageInput").addEventListener("change", (event) => {
    state.settings.englishLabels = event.target.checked;
    renderAll();
  });
  $("#coverInput").addEventListener("change", (event) => {
    state.settings.cover = event.target.checked;
    renderAll();
  });
  $("#swatches").addEventListener("click", (event) => {
    const button = event.target.closest("[data-theme-index]");
    if (!button) return;
    state.settings.themeIndex = Number(button.dataset.themeIndex);
    renderAll();
  });
  bindColorSetting("customAccent", "customAccentPicker", "customAccentInput");
  bindColorSetting("customAccent2", "customAccent2Picker", "customAccent2Input");
  bindColorSetting("customStage", "customStagePicker", "customStageInput");
  $("#templateBtn").addEventListener("click", () => {
    state.template = state.template === "classic" ? "compact" : "classic";
    renderAll();
  });
  $("#closeModuleAdjustBtn").addEventListener("click", () => refs.moduleAdjustCard.classList.add("hidden"));
  bindModuleNumberPair(refs.selectedSectionXRange, refs.selectedSectionXNumber, "offsetX");
  bindModuleNumberPair(refs.selectedSectionLineRange, refs.selectedSectionLineNumber, "lineHeight");
  refs.moduleAdjustCard.addEventListener("click", (event) => {
    const button = event.target.closest("[data-selected-action]");
    if (!button) return;
    handleTabAction(button.dataset.selectedAction, state.activeSectionId);
  });
  bindFloatingPanelDrag();
  if (!FETCHCV_EMBEDDED) bindSettingsPanelDrag();
}

function normalizeHexColor(value, fallback = "#1f3b5c") {
  const text = String(value || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return text;
  return fallback;
}

function isValidCssColor(value) {
  return typeof value === "string" && value.trim() !== "" && CSS.supports("color", value.trim());
}

function bindColorSetting(key, pickerId, inputId) {
  const picker = document.getElementById(pickerId);
  const input = document.getElementById(inputId);
  if (!picker || !input) return;
  const applyPreviewThemeQuickly = () => {
    state.settings.themeIndex = -1;
    syncSwatchActiveState();
    scheduleThemeCssRefresh();
  };
  picker.addEventListener("input", (event) => {
    state.settings[key] = event.target.value;
    input.value = event.target.value;
    applyPreviewThemeQuickly();
  });
  const commit = (value) => {
    if (!isValidCssColor(value)) {
      input.value = state.settings[key];
      picker.value = normalizeHexColor(state.settings[key], picker.value);
      return;
    }
    state.settings[key] = value.trim();
    picker.value = normalizeHexColor(state.settings[key], picker.value);
    applyPreviewThemeQuickly();
    persist();
  };
  picker.addEventListener("change", (event) => commit(event.target.value));
  input.addEventListener("change", (event) => commit(event.target.value));
  input.addEventListener("blur", (event) => commit(event.target.value));
}

function bindSettingInput(id, key, transform) {
  const input = $(`#${id}`);
  input.addEventListener("input", (event) => {
    state.settings[key] = transform(event.target.value);
    renderAll();
  });
}

function bindLayoutSettingPair(config) {
  const range = $(`#${config.range}`);
  const number = $(`#${config.number}`);
  if (range) {
    range.min = String(config.min);
    range.max = String(config.max);
  }
  if (number) {
    number.min = String(config.min);
    number.max = String(config.max);
  }
  const normalize = (value) => clamp(Number.isFinite(Number(value)) ? Number(value) : state.settings[config.key], config.min, config.max);
  const sync = (value) => {
    const normalized = normalize(value);
    state.settings[config.key] = normalized;
    if (config.key === "lineHeight") {
      const nextLineHeight = normalized / 100;
      state.sections.forEach((sectionItem) => {
        if (!Array.isArray(sectionItem.items)) return;
        sectionItem.items.forEach((item) => {
          if (!item.richStyle) {
            item.richStyle = { lineHeight: nextLineHeight, firstIndent: 0, hangingIndent: 0 };
            return;
          }
          item.richStyle.lineHeight = nextLineHeight;
        });
      });
    }
    range.value = normalized;
    number.value = normalized;
    updateRangeProgress(range);
    renderAll();
  };
  range.addEventListener("input", (event) => sync(event.target.value));
  number.addEventListener("input", (event) => sync(event.target.value));
  number.addEventListener("blur", (event) => sync(event.target.value));
  number.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
  });
}

function updateRangeProgress(range) {
  const min = Number(range.min || 0);
  const max = Number(range.max || 100);
  const value = Number(range.value || 0);
  const progress = max === min ? 0 : ((value - min) / (max - min)) * 100;
  range.style.setProperty("--range-progress", `${clamp(progress, 0, 100)}%`);
}

function bindModuleNumberPair(range, number, key) {
  const update = (value) => {
    const parsed = Number(value);
    getActiveSection()[key] = parsed;
    range.value = parsed;
    number.value = parsed;
    updateRangeProgress(range);
    renderAll();
  };
  range.addEventListener("input", (event) => update(event.target.value));
  number.addEventListener("input", (event) => update(event.target.value));
}

function bindWorkspaceResizer() {
  let frame = null;
  const updateFromPointer = (clientX) => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = null;
      const editorRect = refs.editorDrawer.getBoundingClientRect();
      const previewRect = refs.resumePage.closest(".workspace").getBoundingClientRect();
      const left = editorRect.left;
      const right = previewRect.right;
      const width = Math.max(1, right - left);
      const raw = ((clientX - left) / width) * 100;
      const minEditor = Math.min(46, (620 / width) * 100);
      const maxEditor = Math.max(52, ((width - 360) / width) * 100);
      state.previewWidth = clamp(raw, minEditor, Math.min(72, maxEditor));
      document.documentElement.style.setProperty("--preview-column", `${state.previewWidth}%`);
      applyInlineFieldLayouts();
    });
  };
  refs.workspaceResizer.addEventListener("pointerdown", (event) => {
    if (!state.drawerOpen) return;
    event.preventDefault();
    refs.workspaceResizer.setPointerCapture(event.pointerId);
    document.body.classList.add("workspace-resizing");
    updateFromPointer(event.clientX);
    const move = (moveEvent) => updateFromPointer(moveEvent.clientX);
    const up = (upEvent) => {
      refs.workspaceResizer.releasePointerCapture(upEvent.pointerId);
      document.body.classList.remove("workspace-resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      persist();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
}

function bindPreviewZoomControls() {
  refs.zoomOutBtn.addEventListener("click", () => setPreviewZoom(state.previewZoom - 0.05, { persist: true }));
  refs.zoomInBtn.addEventListener("click", () => setPreviewZoom(state.previewZoom + 0.05, { persist: true }));
  refs.previewScaleFrame.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest("[data-preview-resize-handle]");
    if (handle) {
      startPreviewResize(event, handle.dataset.previewCorner);
      return;
    }
    if (event.target.closest("[data-sortable-module], [data-module-drag-handle]") || state.isModuleDragging) {
      return;
    }
    if (state.draggingSectionId) return;
    if (event.button !== 0 || event.target.closest("button, input, textarea, select, a, [contenteditable]")) return;
    startPreviewPan(event);
  });
  refs.previewScaleFrame.addEventListener("click", (event) => {
    if (!state.justPannedPreview) return;
    event.preventDefault();
    event.stopPropagation();
  }, true);
}

function startPreviewResize(event, corner) {
  if (state.draggingSectionId) return;
  event.preventDefault();
  event.stopPropagation();
  const handle = event.target.closest("[data-preview-resize-handle]");
  state.isPreviewResizing = true;
  handle.setPointerCapture(event.pointerId);
  document.body.classList.add("preview-zoom-dragging");
  const startX = event.clientX;
  const startY = event.clientY;
  const startZoom = state.previewZoom;
  const directions = {
    nw: { x: -1, y: -1 },
    ne: { x: 1, y: -1 },
    sw: { x: -1, y: 1 },
    se: { x: 1, y: 1 }
  };
  const direction = directions[corner] || directions.se;
  const move = (moveEvent) => {
    moveEvent.preventDefault();
    const projected = (moveEvent.clientX - startX) * direction.x + (moveEvent.clientY - startY) * direction.y;
    setPreviewZoom(startZoom + projected / 900);
  };
  const up = (upEvent) => {
    handle.releasePointerCapture(upEvent.pointerId);
    state.isPreviewResizing = false;
    document.body.classList.remove("preview-zoom-dragging");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    persist();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

function startPreviewPan(event) {
  if (state.draggingSectionId || state.isPreviewResizing) return;
  event.preventDefault();
  event.stopPropagation();
  const startX = event.clientX;
  const startY = event.clientY;
  const originX = Number(state.previewOffsetX || 0);
  const originY = Number(state.previewOffsetY || 0);
  let moved = false;
  refs.previewScaleFrame.setPointerCapture(event.pointerId);
  const move = (moveEvent) => {
    moveEvent.preventDefault();
    const dx = moveEvent.clientX - startX;
    const dy = moveEvent.clientY - startY;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    moved = true;
    state.isPreviewPanning = true;
    document.body.classList.add("preview-panning");
    window.getSelection()?.removeAllRanges();
    state.previewOffsetX = originX + dx;
    state.previewOffsetY = originY + dy;
    clampPreviewOffset();
    applyPreviewOffset();
  };
  const up = (upEvent) => {
    refs.previewScaleFrame.releasePointerCapture(upEvent.pointerId);
    state.isPreviewPanning = false;
    document.body.classList.remove("preview-panning");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    if (!moved) {
      const section = event.target.closest("[data-section-id]");
      if (section) openSectionFromPointer(section.dataset.sectionId);
    } else {
      state.justPannedPreview = true;
      window.setTimeout(() => {
        state.justPannedPreview = false;
      }, 120);
    }
    persist();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

function updateImportProgress(stage, detail, percent = 0) {
  if (!refs.importProgressPanel) return;
  if (importProgressHideTimer) {
    window.clearTimeout(importProgressHideTimer);
    importProgressHideTimer = 0;
  }
  const safePercent = clamp(Math.round(Number(percent) || 0), 0, 100);
  refs.importProgressPanel.hidden = false;
  if (refs.importProgressStage) refs.importProgressStage.textContent = stage || "处理中";
  if (refs.importProgressDetail) refs.importProgressDetail.textContent = detail || "";
  if (refs.importProgressPercent) refs.importProgressPercent.textContent = `${safePercent}%`;
  if (refs.importProgressFill) refs.importProgressFill.style.width = `${safePercent}%`;
}

function hideImportProgress(delayMs = 1500) {
  if (!refs.importProgressPanel) return;
  if (importProgressHideTimer) window.clearTimeout(importProgressHideTimer);
  importProgressHideTimer = window.setTimeout(() => {
    refs.importProgressPanel.hidden = true;
    importProgressHideTimer = 0;
  }, Math.max(0, Number(delayMs) || 0));
}

function resetImportProgressPanel() {
  if (!refs.importProgressPanel) return;
  if (importProgressHideTimer) {
    window.clearTimeout(importProgressHideTimer);
    importProgressHideTimer = 0;
  }
  refs.importProgressPanel.hidden = true;
  if (refs.importProgressStage) refs.importProgressStage.textContent = "准备导入";
  if (refs.importProgressDetail) refs.importProgressDetail.textContent = "等待开始...";
  if (refs.importProgressPercent) refs.importProgressPercent.textContent = "0%";
  if (refs.importProgressFill) refs.importProgressFill.style.width = "0%";
  if (refs.undoImportBtn) refs.undoImportBtn.hidden = true;
}

function summarizeParsedResume(parsed = {}) {
  const profile = parsed.profile && typeof parsed.profile === "object" ? parsed.profile : {};
  const sections = Array.isArray(parsed.sections) ? parsed.sections : [];
  const items = sections.reduce((sum, section) => sum + (Array.isArray(section?.items) ? section.items.length : 0), 0);
  const profileKeys = ["name", "phone", "email", "birth", "gender", "arrival"];
  const profileFilled = profileKeys.filter((key) => hasValue(profile[key])).length;
  const boldCount = Array.isArray(parsed.meta?.boldRuns) ? parsed.meta.boldRuns.length : 0;
  const warnings = [];
  if (!hasValue(profile.name)) warnings.push("未识别到姓名");
  if (!sections.length || !items) warnings.push("未识别到经历模块");
  if (!boldCount) warnings.push("未检测到可映射的加粗文本");
  const confidence = Math.round(clamp((profileFilled / profileKeys.length) * 45 + Math.min(sections.length, 5) / 5 * 35 + Math.min(items, 8) / 8 * 20, 0, 100));
  return { sections, items, profileFilled, boldCount, warnings, confidence };
}

function confirmParsedResumeImport(parsed = {}, fileName = "PDF") {
  const summary = summarizeParsedResume(parsed);
  const sectionNames = summary.sections.map((section) => safeText(section.title || section.kind || "未命名模块")).filter(Boolean);
  const warningMarkup = summary.warnings.length
    ? `<div class="import-preview-warning"><strong>请重点检查</strong><span>${summary.warnings.map(escapeHtml).join("、")}</span></div>`
    : `<div class="import-preview-ok">结构完整度较好，导入后仍建议逐项核对。</div>`;
  return showWorkbenchModal({
    title: "确认导入识别结果",
    description: `${fileName} 已完成本地解析，确认后才会覆盖当前编辑内容。`,
    confirmText: "应用到简历",
    cancelText: "取消导入",
    contentHtml: `
      <div class="import-preview-summary">
        <div><strong>${summary.confidence}%</strong><span>结构完整度</span></div>
        <div><strong>${summary.sections.length}</strong><span>识别模块</span></div>
        <div><strong>${summary.items}</strong><span>经历条目</span></div>
        <div><strong>${summary.boldCount}</strong><span>加粗片段</span></div>
      </div>
      <div class="import-preview-sections"><span>模块</span><strong>${escapeHtml(sectionNames.join(" / ") || "暂无")}</strong></div>
      ${warningMarkup}
    `
  });
}

function postResumePdfWithProgress(file, onUploadProgress) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", LOCAL_PARSE_API, true);
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || typeof onUploadProgress !== "function") return;
      onUploadProgress(event.loaded / event.total);
    };
    xhr.onerror = () => reject(new Error("网络请求失败（无法连接本地解析服务）"));
    xhr.ontimeout = () => reject(new Error("请求超时（解析服务响应过慢）"));
    xhr.onload = () => {
      const payload = xhr.response && typeof xhr.response === "object"
        ? xhr.response
        : (() => {
            try {
              return JSON.parse(xhr.responseText || "{}");
            } catch {
              return {};
            }
          })();
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(payload?.message || `解析失败（${xhr.status}）`));
        return;
      }
      if (!payload || !payload.ok || !payload.data) {
        reject(new Error(payload?.message || "解析服务返回数据异常"));
        return;
      }
      resolve(payload);
    };
    xhr.send(formData);
  });
}

async function archiveExportedPdf(blob, fileName) {
  syncActiveVersionFromEditor();
  const candidate = getWorkbenchCandidate();
  const version = getPrimaryVersionForCandidate(candidate?.id);
  const formData = new FormData();
  formData.append("file", blob, fileName);
  formData.append("fileName", fileName);
  formData.append("candidateName", candidate?.name || state.profile?.name || "未命名候选人");
  formData.append("versionName", version?.name || "当前简历");
  formData.append("markdown", buildResumeMarkdown(version?.snapshot || state));
  const response = await fetch(LOCAL_ARCHIVE_PDF_API, {
    method: "POST",
    body: formData
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message || `归档失败（${response.status}）`);
  }
  return payload?.data || {};
}

function richHtmlToMarkdown(value = "") {
  const template = document.createElement("template");
  template.innerHTML = String(value || "");
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const tag = node.tagName.toLowerCase();
    const content = Array.from(node.childNodes).map(walk).join("");
    if (tag === "br") return "\n";
    if (tag === "strong" || tag === "b") return content.trim() ? `**${content.trim()}**` : "";
    if (tag === "em" || tag === "i") return content.trim() ? `*${content.trim()}*` : "";
    if (tag === "li") return `- ${content.trim()}\n`;
    if (["p", "div", "ul", "ol"].includes(tag)) return `${content.trim()}\n`;
    return content;
  };
  return Array.from(template.content.childNodes)
    .map(walk)
    .join("")
    .replace(/\u200B/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildResumeMarkdown(snapshot = state) {
  const profile = snapshot?.profile || {};
  const lines = [`# ${profile.name || "未填写姓名"}`];
  const profileRows = [
    ["学校", getProfileSchool(snapshot)],
    ["电话", profile.phone],
    ["邮箱", profile.email],
    ["政治面貌", profile.political],
    ["到岗情况", profile.arrival]
  ].filter(([, value]) => String(value || "").trim());
  profileRows.forEach(([label, value]) => lines.push(`- ${label}：${plainFieldText(value)}`));
  (profile.custom || []).forEach((item) => {
    if (item?.key && item?.value) lines.push(`- ${plainFieldText(item.key)}：${plainFieldText(item.value)}`);
  });

  (snapshot?.sections || []).filter((section) => section?.visible !== false).forEach((section) => {
    lines.push("", `## ${plainFieldText(section.tab || section.title || "未命名模块")}`);
    const schema = sectionSchemas[getSectionKind(section)] || sectionSchemas.custom;
    const labelsByKey = new Map((schema.fields || []).map((field) => [field.key, field.label]));
    (section.items || []).forEach((item, index) => {
      const formatMarkdownField = (value) => {
        if (Array.isArray(value)) return value.map((entry) => formatMarkdownField(entry)).filter(Boolean).join("、");
        if (value && typeof value === "object") {
          if (value.year && value.month) return `${value.year}-${String(value.month).padStart(2, "0")}`;
          const start = formatMarkdownField(value.start || value.from || "");
          const end = formatMarkdownField(value.end || value.to || "");
          if (start || end) return `${start}${start && end ? " ~ " : ""}${end || (value.present ? "至今" : "")}`.trim();
          return Object.values(value).map((entry) => formatMarkdownField(entry)).filter(Boolean).join("、");
        }
        return plainFieldText(value);
      };
      const fields = Object.entries(item?.fields || {})
        .map(([key, value]) => [labelsByKey.get(key) || key, formatMarkdownField(value)])
        .filter(([, value]) => value);
      if ((section.items || []).length > 1) lines.push("", `### ${fields[0]?.[1] || `条目 ${index + 1}`}`);
      fields.forEach(([label, value]) => lines.push(`- **${label}**：${value}`));
      const body = richHtmlToMarkdown(item?.body || "");
      if (body) lines.push(body);
    });
  });
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

async function archiveCurrentMarkdownHistory() {
  syncActiveVersionFromEditor();
  const candidate = getWorkbenchCandidate();
  const version = getPrimaryVersionForCandidate(candidate?.id);
  try {
    const response = await fetch(LOCAL_ARCHIVE_MARKDOWN_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateName: candidate?.name || state.profile?.name || "未命名候选人",
        versionName: version?.name || "当前简历",
        markdown: buildResumeMarkdown(version?.snapshot || state)
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.ok) throw new Error(payload?.message || `保存失败（${response.status}）`);
    addWorkbenchActivity("保存历史", version?.name || "当前简历");
    renderWorkbench();
    await showWorkbenchNotice("历史版本已保存", `Markdown 已保存到：\n${payload.data.savedFile}`);
  } catch (error) {
    await showWorkbenchNotice("无法保存历史", `${error?.message || "本地归档服务不可用"}\n请确认通过 start_all.bat 启动项目。`);
  }
}

async function openResumeHistoryFolder() {
  try {
    const response = await fetch(LOCAL_OPEN_HISTORY_API, { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.ok) throw new Error(payload?.message || "无法打开历史文件夹");
  } catch (error) {
    await showWorkbenchNotice("无法打开历史文件夹", `${error?.message || "本地归档服务不可用"}\n请确认通过 start_all.bat 启动项目。`);
  }
}

async function importResumeFromPdf(file) {
  updateImportProgress("导入准备", `正在检查本地解析服务（${file.name}）`, 5);
  refs.saveStatus.textContent = "检查解析服务...";
  const serviceReady = await waitForParserServiceReady(300, 1000, (attempt, total) => {
    const ratio = total > 0 ? attempt / total : 0;
    updateImportProgress("连接服务", `尝试连接解析服务（${attempt}/${total}）`, 5 + Math.round(ratio * 15));
  });
  if (!serviceReady) {
    updateImportProgress("导入失败", "本地解析服务未启动或未就绪", 0);
    hideImportProgress(4500);
    throw new Error("本地解析服务仍未就绪（可能还在首次安装依赖），请稍后重试");
  }
  updateImportProgress("上传文件", "正在上传 PDF 到本地解析服务...", 22);
  refs.saveStatus.textContent = "正在解析 PDF...";
  const payload = await postResumePdfWithProgress(file, (progress) => {
    const p = clamp(progress || 0, 0, 1);
    updateImportProgress("上传文件", "正在上传 PDF 到本地解析服务...", 22 + Math.round(p * 38));
  });
  updateImportProgress("解析内容", "正在识别文本结构、字段与原始加粗样式...", 70);
  const confirmed = await confirmParsedResumeImport(payload.data, file.name);
  if (!confirmed) {
    updateImportProgress("已取消", "当前简历内容未发生变化", 0);
    hideImportProgress(1800);
    return { applied: false, fit: false };
  }
  lastImportUndoSnapshot = cloneEditorState(state);
  applyParsedResumeData(payload.data);
  updateImportProgress("自动压缩", "正在调整边距、行距和字号...", 86);
  const fitResult = await fitResumeToOnePage({ silent: true, source: "import" });
  const fitDetail = fitResult.fit ? "已自动填充并压缩到一页" : "已自动填充，内容较多，已压到版式下限";
  updateImportProgress("回填完成", fitDetail, 100);
  if (refs.undoImportBtn) refs.undoImportBtn.hidden = false;
  hideImportProgress(10000);
  refs.saveStatus.textContent = fitResult.fit ? "已从 PDF 自动填充并压缩到一页" : "已从 PDF 自动填充（超过一页）";
  return { applied: true, fit: fitResult.fit };
}

async function waitForParserServiceReady(maxAttempts = 15, delayMs = 800, onAttempt = null) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const attempt = i + 1;
    if (typeof onAttempt === "function") onAttempt(attempt, maxAttempts);
    try {
      const res = await fetch(LOCAL_HEALTH_API, { method: "GET" });
      if (res.ok) {
        const payload = await res.json().catch(() => ({}));
        if (payload?.ok) return true;
      }
    } catch {}
    if (i < maxAttempts - 1) {
      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    }
  }
  return false;
}

function showImportPdfTutorial() {
  return showWorkbenchNotice(
    "导入 PDF 使用说明",
    "先双击项目根目录的 start_all.bat，等待本地服务启动完成。首次会安装依赖，完成后回到页面选择 PDF，进度条到 100% 后会自动回填。",
    "选择 PDF"
  );
}

function bindActions() {
  const importInput = $("#importPdfInput");
  const importBtn = $("#importPdfBtn");
  if (importBtn && importInput) {
    importBtn.addEventListener("click", async () => {
      await showImportPdfTutorial();
      importInput.click();
    });
    importInput.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) {
        resetImportProgressPanel();
        return;
      }
      try {
        const importResult = await importResumeFromPdf(file);
        if (!importResult?.applied) return;
        if (document.body.classList.contains("dashboard-mode") && workbenchState) {
          const candidate = getWorkbenchCandidate();
          if (candidate) {
            const now = new Date().toISOString();
            candidate.name = state.profile?.name || candidate.name;
            candidate.school = getProfileSchool(state);
            candidate.updatedAt = now;
            const version = createResumeVersionFromCurrent(candidate.id, `${candidate.name}-PDF导入版`);
            version.source = "PDF导入";
            version.status = Number(refs.resumePage?.dataset?.pageCount || 1) <= 1 ? "一页已适配" : "超过一页";
            version.pageCount = Number(refs.resumePage?.dataset?.pageCount || 1);
            addWorkbenchActivity("从 PDF 导入", version.name);
            renderWorkbench();
          }
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        updateImportProgress("导入失败", detail, 0);
        hideImportProgress(5000);
        refs.saveStatus.textContent = "PDF 解析失败";
        await showWorkbenchNotice(
          "PDF 解析失败",
          `错误信息：${detail}。请先在项目根目录运行 start_all.bat，等待本地解析服务启动完成后重试。`
        );
      } finally {
        event.target.value = "";
        window.setTimeout(() => {
          if (refs.saveStatus.textContent.includes("PDF")) refs.saveStatus.textContent = "已自动保存";
        }, 2600);
      }
    });
  }
  if (refs.fitOnePageBtn) {
    refs.fitOnePageBtn.addEventListener("click", async () => {
      try {
        refs.saveStatus.textContent = "正在智能适配一页...";
        await fitResumeToOnePage();
      } catch (error) {
        console.error("Fit to one page failed:", error);
        refs.saveStatus.textContent = "压缩失败，请刷新后重试";
      }
    });
  }
  refs.undoImportBtn?.addEventListener("click", () => {
    if (!lastImportUndoSnapshot) return;
    state = cloneEditorState(lastImportUndoSnapshot);
    lastImportUndoSnapshot = null;
    ensureStateDefaults();
    syncInputsFromState();
    renderAll();
    refs.undoImportBtn.hidden = true;
    updateImportProgress("已撤销导入", "已恢复导入前的简历内容", 100);
    hideImportProgress(2200);
  });
  $("#downloadBtn").addEventListener("click", () => exportResumePdf());
  $("#doneBtn").addEventListener("click", () => {
    state.drawerOpen = false;
    refs.settingsCard.classList.add("hidden");
    renderAll();
  });
  $("#resetBtn").addEventListener("click", () => {
    localStorage.removeItem(storageKey);
    state = structuredClone(initialState);
    syncInputsFromState();
    renderAll();
  });
}

const rippleTargetSelector = ".tool-btn, .icon-btn, .primary-btn, .round-btn, .ghost-btn, .danger-btn, .mini-btn, .tab-tool, .drawer-handle, .module-nav-item";
let settingsCardPulseTimer = 0;

function decorateRippleTargets() {
  document.querySelectorAll(rippleTargetSelector).forEach((node) => node.classList.add("with-ripple"));
}

function spawnRipple(target, event) {
  if (!target) return;
  const rect = target.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ripple = document.createElement("span");
  ripple.className = "ui-ripple";
  const maxSide = Math.max(rect.width, rect.height);
  const size = Math.max(24, Math.round(maxSide * 1.9));
  const left = Number(event.clientX) - rect.left;
  const top = Number(event.clientY) - rect.top;
  ripple.style.width = `${size}px`;
  ripple.style.height = `${size}px`;
  ripple.style.left = `${left}px`;
  ripple.style.top = `${top}px`;
  target.appendChild(ripple);
  window.setTimeout(() => ripple.remove(), 560);
}

function pulseSettingsCard() {
  if (!refs.settingsCard || refs.settingsCard.classList.contains("hidden")) return;
  refs.settingsCard.classList.remove("panel-spotlight");
  void refs.settingsCard.offsetWidth;
  refs.settingsCard.classList.add("panel-spotlight");
  window.clearTimeout(settingsCardPulseTimer);
  settingsCardPulseTimer = window.setTimeout(() => refs.settingsCard?.classList.remove("panel-spotlight"), 360);
}

function bindInteractionEnhancements() {
  document.addEventListener("pointerdown", (event) => {
    const target = event.target.closest(rippleTargetSelector);
    if (!target || target.disabled) return;
    spawnRipple(target, event);
  });
  requestAnimationFrame(() => {
    requestAnimationFrame(() => document.body.classList.add("ui-ready"));
  });
}

function exportFileName(ext) {
  const safeName = String(state.profile.name || "简历").replace(/[\\/:*?"<>|]+/g, "").trim() || "简历";
  return `${safeName}-简历.${ext}`;
}

function collectRuntimeStyleText() {
  const blocks = [];
  [...document.styleSheets].forEach((sheet) => {
    try {
      const rules = [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
      if (rules) blocks.push(rules);
    } catch {}
  });
  return blocks.join("\n");
}

function buildExportResumeHtml() {
  const styleText = collectRuntimeStyleText();
  const resumeMarkup = createSanitizedResumeNode().outerHTML;
  return `<!doctype html>
<html lang="zh-CN" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <title>${escapeHtml(state.profile.name || "简历")}</title>
  <style>
${styleText}
html, body {
  margin: 0;
  padding: 0;
  background: #ffffff;
}
body {
  font-family: ${state.settings.fontFamily};
}
.resume-page {
  position: static !important;
  left: auto !important;
  top: auto !important;
  transform: none !important;
  box-shadow: none !important;
  margin: 0 auto !important;
  min-height: var(--resume-page-height) !important;
  width: var(--resume-page-width) !important;
}
.resume-section,
.resume-section.selected-section,
.resume-section.sortable-section,
.resume-section.drag-lift,
.resume-section.drag-return {
  transform: none !important;
  outline: 0 !important;
  box-shadow: none !important;
  opacity: 1 !important;
  margin-bottom: 0 !important;
}
  </style>
</head>
<body>${resumeMarkup}</body>
</html>`;
}

function downloadBlob(blob, fileName) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1500);
}

function createSanitizedResumeNode() {
  const clone = refs.resumePage.cloneNode(true);
  clone.removeAttribute("id");
  clone.querySelectorAll(".selected-section, .drag-lift, .drag-return, .sortable-section").forEach((node) => {
    node.classList.remove("selected-section", "drag-lift", "drag-return", "sortable-section");
  });
  clone.querySelectorAll("[contenteditable]").forEach((node) => node.removeAttribute("contenteditable"));
  clone.querySelectorAll("[data-preview-resize-handle], .preview-resize-handle, .preview-zoom-control").forEach((node) => node.remove());
  clone.style.position = "static";
  clone.style.left = "auto";
  clone.style.top = "auto";
  clone.style.transform = "none";
  clone.style.boxShadow = "none";
  clone.style.margin = "0 auto";
  clone.style.width = "794px";
  clone.style.minHeight = "1123px";
  return clone;
}

function createExportRenderHost() {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-20000px";
  host.style.top = "0";
  host.style.width = "794px";
  host.style.padding = "0";
  host.style.margin = "0";
  host.style.background = "#fff";
  host.style.zIndex = "-1";
  host.style.pointerEvents = "none";
  const style = document.createElement("style");
  style.textContent = `${collectRuntimeStyleText()}
html,body{margin:0;padding:0;background:#fff;}
.resume-page{position:static !important;left:auto !important;top:auto !important;transform:none !important;box-shadow:none !important;margin:0 auto !important;width:794px !important;min-height:1123px !important;}
.resume-section,.resume-section.selected-section,.resume-section.sortable-section,.resume-section.drag-lift,.resume-section.drag-return{transform:none !important;outline:0 !important;box-shadow:none !important;opacity:1 !important;margin-bottom:0 !important;}`;
  host.appendChild(style);
  host.appendChild(createSanitizedResumeNode());
  document.body.appendChild(host);
  return host;
}

function ensureExportLibraries() {
  const hasCanvas = typeof window.html2canvas === "function";
  const hasPdf = Boolean(window.jspdf?.jsPDF);
  if (!hasCanvas || !hasPdf) {
    throw new Error("导出依赖未加载，无法生成文件");
  }
}

async function renderResumePagesToCanvas() {
  ensureExportLibraries();
  const host = createExportRenderHost();
  try {
    const page = host.querySelector(".resume-page");
    const pageWidth = 794;
    const pageHeight = 1123;
    page.style.height = "auto";
    page.style.minHeight = `${pageHeight}px`;
    const totalHeight = Math.max(page.scrollHeight, pageHeight);
    const sourceHeight = Math.max(totalHeight, pageHeight);
    const exportInsetTop = clamp(Math.round(Number(state.settings.margin || 30) * 0.25), 8, 14);
    const exportInsetBottom = exportInsetTop;
    const firstCapacity = Math.max(1, pageHeight - exportInsetTop - exportInsetBottom);
    const nextCapacity = firstCapacity;
    const lineSample = page.querySelector(".section-body");
    const lineStep = getLineStepFromElement(lineSample);
    const safeBreaks = collectSafeBreakpoints(page, sourceHeight);
    const offsets = [0];
    if (sourceHeight > pageHeight + 1) {
      let guard = 0;
      while (guard < 500) {
        const prev = offsets[offsets.length - 1];
        const capacity = offsets.length === 1 ? firstCapacity : nextCapacity;
        if ((prev + capacity) >= (sourceHeight - 1)) break;
        const rawCut = prev + capacity;
        const nextCut = snapBreakToSafePoint(rawCut, prev, lineStep, safeBreaks);
        offsets.push(Math.min(nextCut, sourceHeight));
        guard += 1;
      }
    }
    const segments = offsets.map((offset, index) => {
      const nextOffset = index + 1 < offsets.length ? offsets[index + 1] : sourceHeight;
      const contentHeight = Math.max(1, nextOffset - offset);
      return {
        offset,
        contentHeight,
        topInset: exportInsetTop
      };
    });
    const layout = {
      pageCount: offsets.length,
      offsets,
      sourceHeight,
      exportInsetTop,
      exportInsetBottom,
      firstCapacity,
      nextCapacity,
      segments
    };
    const canvases = [];
    for (let index = 0; index < layout.segments.length; index += 1) {
      const segment = layout.segments[index];
      const slice = document.createElement("div");
      slice.style.width = `${pageWidth}px`;
      slice.style.height = `${pageHeight}px`;
      slice.style.overflow = "hidden";
      slice.style.background = "#fff";
      slice.style.position = "relative";
      const bodyClip = document.createElement("div");
      bodyClip.style.position = "absolute";
      bodyClip.style.left = "0";
      bodyClip.style.top = `${segment.topInset}px`;
      bodyClip.style.width = `${pageWidth}px`;
      bodyClip.style.height = `${segment.contentHeight}px`;
      bodyClip.style.overflow = "hidden";
      bodyClip.style.zIndex = "1";
      const clone = page.cloneNode(true);
      clone.style.position = "static";
      clone.style.left = "auto";
      clone.style.top = "auto";
      clone.style.transform = "none";
      clone.style.boxShadow = "none";
      clone.style.margin = "0";
      clone.style.minHeight = `${Math.max(totalHeight, pageHeight)}px`;
      const offset = document.createElement("div");
      offset.style.position = "absolute";
      offset.style.left = "0";
      offset.style.top = `${-segment.offset}px`;
      offset.style.width = `${pageWidth}px`;
      offset.style.height = `${layout.sourceHeight}px`;
      offset.appendChild(clone);
      bodyClip.appendChild(offset);
      slice.appendChild(bodyClip);
      host.appendChild(slice);
      const canvas = await window.html2canvas(slice, {
        backgroundColor: "#ffffff",
        // A 2x canvas can terminate Electron's renderer for dense multi-page
        // resumes. Embedded desktop exports use a crisp but bounded raster;
        // the standalone editor keeps its original print-oriented setting.
        scale: FETCHCV_EMBEDDED ? 1.25 : 2,
        useCORS: true,
        logging: false
      });
      canvases.push(canvas);
      slice.remove();
    }
    return canvases;
  } finally {
    host.remove();
  }
}

async function confirmExportReadiness() {
  ensureExportLibraries();
  await waitForStableResumeLayout();
  const warnings = [];
  if (!String(state.profile?.name || "").trim()) warnings.push("姓名为空");
  const visibleSections = state.sections.filter((sectionItem) => sectionItem?.visible !== false);
  if (!visibleSections.length) warnings.push("没有可见的简历模块");
  const pageCount = await getCurrentPreviewPageCountAfterLayout();
  if (pageCount > 1) warnings.push(`当前内容为 ${pageCount} 页`);
  if (!warnings.length) return true;
  if (FETCHCV_EMBEDDED) return true;
  return showWorkbenchConfirm(
    "导出前检查",
    `${warnings.join("；")}。仍要继续导出 PDF 吗？`,
    { confirmText: "继续导出" }
  );
}

async function exportResumePdf(options = {}) {
  const shouldDownload = options.download !== false;
  refs.saveStatus.textContent = "正在导出 PDF";
  const downloadButton = $("#downloadBtn");
  try {
    if (!await confirmExportReadiness()) {
      refs.saveStatus.textContent = "已取消导出";
      return;
    }
    if (downloadButton) {
      downloadButton.disabled = true;
      downloadButton.setAttribute("aria-busy", "true");
    }
    const canvases = await renderResumePagesToCanvas();
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "p", unit: "pt", format: "a4", compress: true });
    canvases.forEach((canvas, index) => {
      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      if (index > 0) pdf.addPage();
      pdf.addImage(imgData, "JPEG", 0, 0, pageWidth, pageHeight, undefined, "FAST");
    });
    const exportName = exportFileName("pdf");
    const pdfBlob = pdf.output("blob");
    if (shouldDownload) downloadBlob(pdfBlob, exportName);
    let archiveError = "";
    try {
      if (FETCHCV_EMBEDDED && FETCHCV_RESUME_ID && FETCHCV_API_BASE) {
        const response = await fetch(`${FETCHCV_API_BASE}/api/resumes/${encodeURIComponent(FETCHCV_RESUME_ID)}/pdf`, {
          method: "PUT",
          headers: { "Content-Type": "application/pdf", "X-FetchCV-Page-Count": String(canvases.length), ...FETCHCV_API_HEADERS },
          body: pdfBlob
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result?.error?.message || result?.detail || `保存失败（${response.status}）`);
        window.parent.postMessage({ type: "fetchcv:pdf-saved", resumeId: FETCHCV_RESUME_ID, pageCount: canvases.length, pdfUrl: result.pdf_url }, "*");
      } else {
        await archiveExportedPdf(pdfBlob, exportName);
      }
    } catch (error) {
      archiveError = error instanceof Error ? error.message : String(error || "归档失败");
      console.warn("PDF archive failed:", archiveError);
    }
    refs.saveStatus.textContent = archiveError ? "PDF 已导出（保存失败）" : FETCHCV_EMBEDDED ? "PDF 已导出并保存" : "PDF 已导出并归档";
    if (archiveError) return { ok: false, message: archiveError };
    return { ok: true, pageCount: canvases.length, fileName: exportName };
  } catch (error) {
    console.error(error);
    refs.saveStatus.textContent = "PDF 导出失败";
    if (FETCHCV_EMBEDDED) window.parent.postMessage({ type: "fetchcv:pdf-error", message: error instanceof Error ? error.message : "PDF 导出失败" }, "*");
    return { ok: false, message: error instanceof Error ? error.message : "PDF 导出失败" };
  } finally {
    if (downloadButton) {
      downloadButton.disabled = false;
      downloadButton.removeAttribute("aria-busy");
    }
    window.setTimeout(() => {
      refs.saveStatus.textContent = "已自动保存";
    }, 1400);
  }
}

function syncInputsFromState() {
  $("#nameInput").value = state.profile.name;
  $("#genderInput").value = state.profile.gender;
  $("#birthInput").value = normalizeMonthValue(state.profile.birth || "");
  $("#politicalInput").value = state.profile.political;
  $("#phoneInput").value = state.profile.phone;
  const emailValue = String(state.profile.email || "");
  $("#emailInput").value = emailValue;
  const emailSuffix = emailValue.includes("@") ? emailValue.split("@")[1] : "";
  const emailSuffixPreset = document.getElementById("emailSuffixPreset");
  if (emailSuffixPreset) emailSuffixPreset.value = emailSuffix || "";
  $("#arrivalInput").value = state.profile.arrival;
  $("#workYearsInput").value = state.profile.workYears;
  $("#maritalInput").value = state.profile.marital;
  const workYearsPreset = document.getElementById("workYearsPreset");
  if (workYearsPreset) workYearsPreset.value = "";
  const maritalPreset = document.getElementById("maritalPreset");
  if (maritalPreset) maritalPreset.value = "";
  $("#heightInput").value = state.profile.height;
  $("#weightInput").value = state.profile.weight;
  $("#ethnicityInput").value = state.profile.ethnicity;
  $("#domicileInput").value = state.profile.domicile;
  $("#showPhotoInput").checked = state.profile.showPhoto;
  const photoNameNode = document.getElementById("photoFileName");
  if (photoNameNode) photoNameNode.textContent = shortenFileName(state.profile.photoFileName);
  Object.entries({
    marginRange: "margin", spacingRange: "spacing", lineHeightRange: "lineHeight",
    fontSizeRange: "fontSize", fontFamilyInput: "fontFamily", titleStyleInput: "titleStyle",
    nameSizeRange: "nameSize", letterInput: "letter", photoXRange: "photoX", photoYRange: "photoY",
    nameXRange: "nameX", infoXRange: "infoX", infoYRange: "infoY", basicHeightRange: "basicHeight",
    customAccentInput: "customAccent", customAccent2Input: "customAccent2", customStageInput: "customStage"
  }).forEach(([id, key]) => $(`#${id}`).value = state.settings[key]);
  layoutSettingPairs.forEach((config) => {
    $(`#${config.range}`).value = state.settings[config.key];
    $(`#${config.number}`).value = state.settings[config.key];
    updateRangeProgress($(`#${config.range}`));
  });
  $("#languageInput").checked = state.settings.englishLabels;
  $("#coverInput").checked = state.settings.cover;
}

function moveActiveSection(direction) {
  const index = state.sections.findIndex((item) => item.id === state.activeSectionId);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= state.sections.length) return;
  const [item] = state.sections.splice(index, 1);
  state.sections.splice(next, 0, item);
  renderAll();
}

function handleTabAction(action, sectionId) {
  if (action === "add") {
    addSection();
    return;
  }
  if (!sectionId) return;
  state.activeSectionId = sectionId;
  state.activeTab = "section";
  if (action === "edit") {
    state.renamingSectionId = sectionId;
    state.drawerOpen = true;
    renderAll();
    return;
  }
  if (action === "toggle") {
    const active = getActiveSection();
    active.visible = !active.visible;
  }
  if (action === "up") moveActiveSection(-1);
  if (action === "down") moveActiveSection(1);
  if (action === "duplicate") duplicateSection(sectionId);
  if (action === "delete") deleteSection(sectionId);
  renderAll();
}

function saveSectionRename(sectionId, value) {
  const target = state.sections.find((item) => item.id === sectionId);
  if (!target) return;
  const nextTitle = String(value || "").trim();
  if (nextTitle) {
    target.tab = nextTitle;
    target.title = nextTitle;
  }
  state.renamingSectionId = "";
  renderAll();
}

function addSection() {
  const id = `custom-${Date.now()}`;
  state.sections.push({
    id,
    sectionType: "custom",
    tab: "自定义模块",
    title: "自定义模块",
    visible: true,
    builtin: false,
    customFields: [],
    offsetX: 0,
    items: [blankItem()]
  });
  state.activeTab = "section";
  state.activeSectionId = id;
  state.drawerOpen = true;
  renderAll();
}

function duplicateSection(sectionId) {
  const source = state.sections.find((item) => item.id === sectionId);
  if (!source) return;
  const copy = structuredClone(source);
  copy.id = `${copy.id}-${Date.now()}`;
  copy.tab = `${copy.tab}副本`;
  copy.title = `${copy.title}副本`;
  copy.builtin = false;
  copy.items.forEach((item, index) => item.id = `${copy.id}-item-${index}-${Date.now()}`);
  const index = state.sections.findIndex((item) => item.id === sectionId);
  state.sections.splice(index + 1, 0, copy);
  state.activeTab = "section";
  state.activeSectionId = copy.id;
  renderAll();
}

function deleteSection(sectionId) {
  const index = state.sections.findIndex((item) => item.id === sectionId);
  if (index < 0) return;
  const target = state.sections[index];
  if (target?.builtin) {
    target.visible = false;
    if (state.activeSectionId === sectionId) {
      const fallback = state.sections.find((item) => item.id !== sectionId && item.visible)
        || state.sections.find((item) => item.id !== sectionId)
        || target;
      state.activeSectionId = fallback.id;
    }
    state.activeTab = "section";
    return;
  }
  if (state.sections.length <= 1) return;
  state.sections.splice(index, 1);
  const next = state.sections[Math.min(index, state.sections.length - 1)];
  state.activeSectionId = next.id;
  state.activeTab = "section";
}

function shiftSectionFieldOrder(sectionItem, fieldKey, step) {
  if (!sectionItem || !fieldKey || !Number.isFinite(Number(step))) return false;
  const schema = getSectionSchema(sectionItem);
  const order = [...ensureSectionFieldOrder(sectionItem, schema)];
  const from = order.indexOf(fieldKey);
  if (from < 0) return false;
  const to = clamp(from + Number(step), 0, order.length - 1);
  if (from === to) return false;
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  sectionItem.fieldOrder = order;
  return true;
}

function moveSectionTo(fromId, toId) {
  const from = state.sections.findIndex((item) => item.id === fromId);
  const to = state.sections.findIndex((item) => item.id === toId);
  if (from < 0 || to < 0) return;
  moveSectionToIndex(fromId, to, { render: false });
  state.activeSectionId = fromId;
  state.activeTab = "section";
  renderAll();
}

function moveSectionToIndex(sectionId, targetIndex, options = {}) {
  const from = state.sections.findIndex((item) => item.id === sectionId);
  if (from < 0) return;
  let boundedTarget = clamp(targetIndex, 0, options.insertion ? state.sections.length : state.sections.length - 1);
  if (options.insertion && from < boundedTarget) boundedTarget -= 1;
  if (from === boundedTarget) return;
  const [item] = state.sections.splice(from, 1);
  state.sections.splice(boundedTarget, 0, item);
  state.activeSectionId = sectionId;
  if (options.render !== false) renderAll();
}

function getInsertionIndexFromPointer(clientY, activeId) {
  const activeSectionIndex = state.sections.findIndex((item) => item.id === activeId);
  const nodes = [...refs.resumeSections.querySelectorAll("[data-section-id]")].filter((node) => node.dataset.sectionId !== activeId);
  if (!nodes.length) return activeSectionIndex;
  let insertionPosition = 0;
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    if (clientY > rect.top + rect.height / 2) insertionPosition += 1;
  }
  if (insertionPosition >= nodes.length) {
    const lastVisibleId = nodes[nodes.length - 1].dataset.sectionId;
    return state.sections.findIndex((item) => item.id === lastVisibleId) + 1;
  }
  const beforeId = nodes[insertionPosition].dataset.sectionId;
  const targetIndex = state.sections.findIndex((item) => item.id === beforeId);
  return targetIndex < 0 ? activeSectionIndex : targetIndex;
}

function getPlaceholderVisibleIndex(dragCenterY) {
  const nodes = [...refs.resumeSections.querySelectorAll("[data-section-id]")].filter((node) => node.dataset.sectionId !== state.draggingSectionId);
  if (!nodes.length) return 0;
  let index = 0;
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    if (dragCenterY > rect.top + rect.height * 0.58) index += 1;
  }
  return clamp(index, 0, nodes.length);
}

function applyMagneticOffsets(dragTop, dragHeight) {
  const dragCenterY = dragTop + dragHeight / 2;
  const nodes = [...refs.resumeSections.querySelectorAll("[data-section-id]")].filter((node) => node.dataset.sectionId !== state.draggingSectionId);
  nodes.forEach((node) => {
    const rect = node.getBoundingClientRect();
    const itemCenterY = rect.top + rect.height / 2;
    const distance = Math.abs(itemCenterY - dragCenterY);
    const influenceRange = Math.max(rect.height * 1.2, 90);
    if (distance > influenceRange) {
      node.style.setProperty("--magnetic-offset-y", "0px");
      return;
    }
    const strength = 1 - distance / influenceRange;
    const direction = dragCenterY < itemCenterY ? 1 : -1;
    const offset = Math.round(direction * strength * 14);
    node.style.setProperty("--magnetic-offset-y", `${offset}px`);
  });
}

function clearMagneticOffsets() {
  refs.resumeSections.querySelectorAll("[data-section-id]").forEach((node) => {
    node.style.setProperty("--magnetic-offset-y", "0px");
  });
}

function commitSortDrag(sectionId) {
  const visible = state.sections.filter((item) => item.visible);
  const hidden = state.sections.filter((item) => !item.visible);
  const dragged = visible.find((item) => item.id === sectionId);
  if (!dragged) {
    cleanupSortDrag();
    return;
  }
  const orderedVisible = visible.filter((item) => item.id !== sectionId);
  const insertIndex = clamp(Number(state.placeholderVisibleIndex || 0), 0, orderedVisible.length);
  orderedVisible.splice(insertIndex, 0, dragged);
  state.sections = [...orderedVisible, ...hidden];
  cleanupSortDrag();
  state.activeSectionId = sectionId;
  state.activeTab = "section";
  persist();
}

function cleanupSortDrag() {
  state.draggingSectionId = "";
  state.placeholderVisibleIndex = 0;
  state.dragPlaceholderHeight = 0;
  clearMagneticOffsets();
}

function startSectionDrag(event) {
  if (event.button !== 0) return;
  if (state.isPreviewPanning || state.isPreviewResizing) return;
  if (event.target.closest("[data-preview-resize-handle]")) return;
  const sectionEl = event.target.closest("[data-section-id]");
  if (!sectionEl) return;
  if (event.target.closest("a, button, input, textarea, select, [contenteditable]")) return;
  const active = state.sections.find((item) => item.id === sectionEl.dataset.sectionId);
  if (!active) return;
  event.preventDefault();
  state.activeSectionId = active.id;
  const startX = event.clientX;
  const startY = event.clientY;
  const startRect = sectionEl.getBoundingClientRect();
  const pointerOffsetX = startX - startRect.left;
  const pointerOffsetY = startY - startRect.top;
  let overlay = null;
  let raf = 0;
  let dragged = false;
  const move = (moveEvent) => {
    moveEvent.preventDefault();
    const deltaX = moveEvent.clientX - startX;
    const deltaY = moveEvent.clientY - startY;
    if (!dragged && Math.hypot(deltaX, deltaY) < 6) return;
    dragged = true;
    state.isModuleDragging = true;
    document.body.classList.add("dragging-section");
    window.getSelection()?.removeAllRanges();
    if (!overlay) {
      overlay = beginSortDrag(active.id, sectionEl, startRect);
    }
    const overlayLeft = moveEvent.clientX - pointerOffsetX;
    const overlayTop = moveEvent.clientY - pointerOffsetY;
    overlay.style.setProperty("--overlay-x", `${overlayLeft}px`);
    overlay.style.setProperty("--overlay-y", `${overlayTop}px`);
    if (!raf) {
      raf = requestAnimationFrame(() => {
        raf = 0;
        const dragCenterY = overlayTop + startRect.height / 2;
        const nextPlaceholder = getPlaceholderVisibleIndex(dragCenterY);
        if (nextPlaceholder !== state.placeholderVisibleIndex) {
          state.placeholderVisibleIndex = nextPlaceholder;
          renderSections();
          applyMagneticOffsets(overlayTop, startRect.height);
        }
        applyMagneticOffsets(overlayTop, startRect.height);
      });
    }
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    document.body.classList.remove("dragging-section");
    state.isModuleDragging = false;
    if (raf) cancelAnimationFrame(raf);
    if (dragged) {
      state.justDraggedSection = true;
      clearMagneticOffsets();
      commitSortDrag(active.id);
      if (overlay) {
        renderSections();
        renderTabs();
        animateOverlayToFinalPosition(overlay, active.id);
      } else {
        renderAll();
      }
    } else {
      cleanupSortDrag();
      openSectionFromPointer(active.id);
    }
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);

  function animateOverlayToFinalPosition(overlayEl, sectionId) {
    requestAnimationFrame(() => {
      const finalEl = [...refs.resumeSections.querySelectorAll("[data-section-id]")].find((node) => node.dataset.sectionId === sectionId);
      const finalRect = finalEl && finalEl.getBoundingClientRect();
      overlayEl.classList.add("drop-settle");
      if (finalRect) {
        overlayEl.style.width = `${finalRect.width}px`;
        overlayEl.style.maxWidth = `${finalRect.width}px`;
        overlayEl.style.setProperty("--overlay-x", `${finalRect.left}px`);
        overlayEl.style.setProperty("--overlay-y", `${finalRect.top}px`);
        overlayEl.style.opacity = "0.98";
      } else {
        overlayEl.style.opacity = "0";
      }
      window.setTimeout(() => {
        overlayEl.remove();
        renderAll();
      }, 220);
    });
  }

  function beginSortDrag(sectionId, sourceEl, rect) {
    if (!overlay) {
      const previewScale = clamp(Number(state.previewZoom || 1), 0.3, 1.2);
      const logicalWidth = rect.width / previewScale;
      const logicalHeight = rect.height / previewScale;
      overlay = document.createElement("div");
      overlay.className = "drag-overlay-shell";
      const card = sourceEl.cloneNode(true);
      card.classList.add("drag-overlay-card");
      card.classList.remove("selected-section", "is-dragging", "drag-lift", "drag-return");
      card.style.removeProperty("--magnetic-offset-y");
      card.style.width = `${logicalWidth}px`;
      card.style.minHeight = `${logicalHeight}px`;
      card.style.maxWidth = `${logicalWidth}px`;
      card.style.transformOrigin = "top left";
      card.style.transform = `scale(${previewScale})`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.maxWidth = `${rect.width}px`;
      overlay.style.minWidth = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
      overlay.style.maxHeight = `${rect.height}px`;
      overlay.style.minHeight = `${rect.height}px`;
      overlay.style.setProperty("--drag-card-width", `${logicalWidth}px`);
      overlay.style.setProperty("--drag-card-height", `${logicalHeight}px`);
      overlay.style.setProperty("--overlay-x", `${rect.left}px`);
      overlay.style.setProperty("--overlay-y", `${rect.top}px`);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
    }
    if (!state.draggingSectionId) {
      state.draggingSectionId = sectionId;
      state.dragPlaceholderHeight = rect.height;
      state.placeholderVisibleIndex = state.sections.filter((item) => item.visible).findIndex((item) => item.id === sectionId);
      renderSections();
    }
    return overlay;
  }
}

function cleanupSidebarSortDrag() {
  state.sidebarDraggingSectionId = "";
  state.sidebarPlaceholderIndex = 0;
  state.sidebarDragPlaceholderHeight = 0;
  state.sidebarDropTargetId = "";
  state.sidebarDropAfter = false;
  clearSidebarMagneticOffsets();
}

function getSidebarDropTarget(clientY) {
  const nodes = [...refs.tabStrip.querySelectorAll("[data-section-id]")].filter((node) => node.dataset.sectionId !== state.sidebarDraggingSectionId);
  if (!nodes.length) return { targetId: "", after: false, index: 0 };
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    if (clientY < mid) {
      const ordered = state.sections.filter((item) => item.id !== state.sidebarDraggingSectionId);
      return {
        targetId: node.dataset.sectionId,
        after: false,
        index: clamp(ordered.findIndex((item) => item.id === node.dataset.sectionId), 0, ordered.length)
      };
    }
  }
  const lastId = nodes[nodes.length - 1].dataset.sectionId;
  const ordered = state.sections.filter((item) => item.id !== state.sidebarDraggingSectionId);
  const lastIndex = ordered.findIndex((item) => item.id === lastId);
  return {
    targetId: lastId,
    after: true,
    index: clamp(lastIndex + 1, 0, ordered.length)
  };
}

function applySidebarMagneticOffsets(overlayTop, height) {
  const dragCenterY = overlayTop + height / 2;
  [...refs.tabStrip.querySelectorAll("[data-section-id]")].forEach((node) => {
    if (node.dataset.sectionId === state.sidebarDraggingSectionId) return;
    const rect = node.getBoundingClientRect();
    const itemCenterY = rect.top + rect.height / 2;
    const distance = Math.abs(itemCenterY - dragCenterY);
    const influenceRange = rect.height * 1.35;
    if (distance > influenceRange) {
      node.style.setProperty("--sidebar-magnetic-y", "0px");
      return;
    }
    const strength = 1 - distance / influenceRange;
    const direction = dragCenterY < itemCenterY ? 1 : -1;
    node.style.setProperty("--sidebar-magnetic-y", `${Math.round(direction * strength * 8)}px`);
  });
}

function clearSidebarMagneticOffsets() {
  [...document.querySelectorAll(".module-nav-item")].forEach((node) => node.style.removeProperty("--sidebar-magnetic-y"));
}

function commitSidebarSortDrag(sectionId) {
  const dragged = state.sections.find((item) => item.id === sectionId);
  if (!dragged) {
    cleanupSidebarSortDrag();
    return;
  }
  const ordered = state.sections.filter((item) => item.id !== sectionId);
  let targetIndex = clamp(Number(state.sidebarPlaceholderIndex || 0), 0, ordered.length);
  if (state.sidebarDropTargetId) {
    const foundIndex = ordered.findIndex((item) => item.id === state.sidebarDropTargetId);
    if (foundIndex >= 0) {
      targetIndex = clamp(foundIndex + (state.sidebarDropAfter ? 1 : 0), 0, ordered.length);
    }
  }
  ordered.splice(targetIndex, 0, dragged);
  state.sections = ordered;
  cleanupSidebarSortDrag();
  state.activeSectionId = sectionId;
  state.activeTab = "section";
  persist();
}

function startSidebarSectionDrag(event) {
  if (event.button !== 0) return;
  if (event.target.closest(".module-rename-input, .tab-tool, .module-action-menu")) return;
  const itemEl = event.target.closest("[data-section-id]");
  if (!itemEl) return;
  event.preventDefault();
  const sectionId = itemEl.dataset.sectionId;
  const active = state.sections.find((item) => item.id === sectionId);
  if (!active) return;
  const startX = event.clientX;
  const startY = event.clientY;
  const startRect = itemEl.getBoundingClientRect();
  const pointerOffsetX = startX - startRect.left;
  const pointerOffsetY = startY - startRect.top;
  let overlay = null;
  let dragged = false;
  let raf = 0;

  const move = (moveEvent) => {
    const deltaX = moveEvent.clientX - startX;
    const deltaY = moveEvent.clientY - startY;
    if (!dragged && Math.hypot(deltaX, deltaY) < 6) return;
    moveEvent.preventDefault();
    dragged = true;
    state.isSidebarDragging = true;
    document.body.classList.add("dragging-section");
    window.getSelection()?.removeAllRanges();
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "drag-overlay-shell drag-overlay-shell-sidebar";
      const card = itemEl.cloneNode(true);
      card.classList.add("drag-overlay-card", "drag-overlay-card-sidebar");
      card.style.width = `${startRect.width}px`;
      card.style.minHeight = `${startRect.height}px`;
      overlay.style.width = `${startRect.width}px`;
      overlay.style.maxWidth = `${startRect.width}px`;
      overlay.style.minWidth = `${startRect.width}px`;
      overlay.style.height = `${startRect.height}px`;
      overlay.style.maxHeight = `${startRect.height}px`;
      overlay.style.minHeight = `${startRect.height}px`;
      overlay.style.setProperty("--drag-card-width", `${startRect.width}px`);
      overlay.style.setProperty("--drag-card-height", `${startRect.height}px`);
      overlay.style.setProperty("--overlay-x", `${startRect.left}px`);
      overlay.style.setProperty("--overlay-y", `${startRect.top}px`);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      state.sidebarDraggingSectionId = sectionId;
      state.sidebarDragPlaceholderHeight = startRect.height;
      state.sidebarPlaceholderIndex = state.sections.findIndex((item) => item.id === sectionId);
      renderTabs();
    }
    const overlayLeft = moveEvent.clientX - pointerOffsetX;
    const overlayTop = moveEvent.clientY - pointerOffsetY;
    overlay.style.setProperty("--overlay-x", `${overlayLeft}px`);
    overlay.style.setProperty("--overlay-y", `${overlayTop}px`);
    if (!raf) {
      raf = requestAnimationFrame(() => {
        raf = 0;
        const nextTarget = getSidebarDropTarget(overlayTop + startRect.height / 2);
        if (
          nextTarget.index !== state.sidebarPlaceholderIndex ||
          nextTarget.targetId !== state.sidebarDropTargetId ||
          nextTarget.after !== state.sidebarDropAfter
        ) {
          state.sidebarPlaceholderIndex = nextTarget.index;
          state.sidebarDropTargetId = nextTarget.targetId;
          state.sidebarDropAfter = nextTarget.after;
          renderTabs();
        }
        applySidebarMagneticOffsets(overlayTop, startRect.height);
      });
    }
  };

  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    document.body.classList.remove("dragging-section");
    state.isSidebarDragging = false;
    if (raf) cancelAnimationFrame(raf);
    if (dragged) {
      state.justDraggedSidebarSection = true;
      clearSidebarMagneticOffsets();
      commitSidebarSortDrag(sectionId);
      if (overlay) {
        requestAnimationFrame(() => {
          const finalEl = [...refs.tabStrip.querySelectorAll("[data-section-id]")].find((node) => node.dataset.sectionId === sectionId);
          const finalRect = finalEl?.getBoundingClientRect();
          overlay.classList.add("drop-settle");
          if (finalRect) {
            overlay.style.width = `${finalRect.width}px`;
            overlay.style.maxWidth = `${finalRect.width}px`;
            overlay.style.setProperty("--overlay-x", `${finalRect.left}px`);
            overlay.style.setProperty("--overlay-y", `${finalRect.top}px`);
          } else {
            overlay.style.opacity = "0";
          }
          window.setTimeout(() => {
            overlay.remove();
            renderTabs();
          }, 220);
        });
      } else {
        renderTabs();
      }
      window.setTimeout(() => {
        state.justDraggedSidebarSection = false;
      }, 120);
    } else {
      cleanupSidebarSortDrag();
    }
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function bindFloatingPanelDrag() {
  refs.moduleAdjustCard.addEventListener("pointerdown", (event) => {
    if (event.target.closest("input, button, select, textarea")) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = Number(state.settings.adjustPanelX || 0);
    const originY = Number(state.settings.adjustPanelY || 0);
    refs.moduleAdjustCard.setPointerCapture(event.pointerId);
    const move = (moveEvent) => {
      state.settings.adjustPanelX = Math.round(originX + moveEvent.clientX - startX);
      state.settings.adjustPanelY = Math.round(originY + moveEvent.clientY - startY);
      renderModuleAdjust();
      persist();
    };
    const up = () => {
      refs.moduleAdjustCard.removeEventListener("pointermove", move);
      refs.moduleAdjustCard.removeEventListener("pointerup", up);
    };
    refs.moduleAdjustCard.addEventListener("pointermove", move);
    refs.moduleAdjustCard.addEventListener("pointerup", up);
  });
}

function bindSettingsPanelDrag() {
  refs.settingsCard.addEventListener("pointerdown", (event) => {
    if (event.target.closest("input, button, select, textarea")) return;
    refs.settingsCard.classList.add("panel-dragging");
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = Number(state.settings.settingsPanelX || 0);
    const originY = Number(state.settings.settingsPanelY || 0);
    refs.settingsCard.setPointerCapture(event.pointerId);
    const move = (moveEvent) => {
      state.settings.settingsPanelX = Math.round(originX + moveEvent.clientX - startX);
      state.settings.settingsPanelY = Math.round(originY + moveEvent.clientY - startY);
      refs.settingsCard.style.transform = `translate(${state.settings.settingsPanelX}px, ${state.settings.settingsPanelY}px) scale(1.01)`;
    };
    const up = () => {
      refs.settingsCard.classList.remove("panel-dragging");
      refs.settingsCard.style.transform = `translate(${Number(state.settings.settingsPanelX || 0)}px, ${Number(state.settings.settingsPanelY || 0)}px)`;
      refs.settingsCard.removeEventListener("pointermove", move);
      refs.settingsCard.removeEventListener("pointerup", up);
      persist();
    };
    refs.settingsCard.addEventListener("pointermove", move);
    refs.settingsCard.addEventListener("pointerup", up);
  });
}

function blankItem() {
  return {
    id: `item-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    metaLeft: "",
    metaRight: "",
    body: "",
    richStyle: {
      lineHeight: 1.65,
      firstIndent: 0,
      hangingIndent: 0
    }
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function formatBody(value) {
  const raw = String(value || "");
  if (/<\/?[a-z][\s\S]*>/i.test(raw)) {
    return sanitizeRich(raw);
  }
  const lines = raw.split("\n");
  return lines
    .map((line) => `<div class="body-line">${line ? escapeHtml(line) : "&nbsp;"}</div>`)
    .join("");
}

function sanitizeRich(value) {
  const template = document.createElement("template");
  template.innerHTML = value;
  template.content.querySelectorAll("script,style,iframe,object,meta,link").forEach((node) => node.remove());
  const allowedTags = new Set(["p", "div", "br", "span", "b", "strong", "i", "em", "u", "s", "strike", "a", "ul", "ol", "li"]);
  const allowedStyles = new Set(["font-size", "font-family", "font-weight", "font-style", "text-decoration", "line-height", "text-align", "margin-left", "text-indent", "color", "background-color"]);
  const normalizeStyleValue = (prop, rawValue) => {
    const value = String(rawValue || "").trim();
    if (!value) return "";
    if (/mso-|expression\(|javascript:|url\(/i.test(value)) return "";
    if (prop === "font-size") {
      const n = Number.parseFloat(value);
      if (!Number.isFinite(n)) return "";
      return `${clamp(n, 6, 40)}px`;
    }
    if (prop === "font-family") {
      return normalizeAllowedFontFamily(value);
    }
    if (prop === "font-weight") {
      if (/^(bold|bolder|[5-9]00)$/i.test(value)) return "700";
      if (/^(normal|[1-4]00)$/i.test(value)) return "400";
      return "";
    }
    if (prop === "font-style") {
      return /italic/i.test(value) ? "italic" : "normal";
    }
    if (prop === "text-decoration") {
      const decorations = [];
      if (/underline/i.test(value)) decorations.push("underline");
      if (/line-through/i.test(value)) decorations.push("line-through");
      return decorations.join(" ") || "none";
    }
    if (prop === "line-height") {
      const n = Number.parseFloat(value);
      if (!Number.isFinite(n)) return "";
      return String(clamp(n, 0.6, 3));
    }
    if (prop === "text-align") {
      const lower = value.toLowerCase();
      if (["left", "center", "right", "justify"].includes(lower)) return lower;
      return "";
    }
    if (prop === "color" || prop === "background-color") {
      if (/^#[0-9a-f]{3,8}$/i.test(value) || /^(rgb|rgba)\([\d\s.,%]+\)$/i.test(value)) return value;
      return "";
    }
    if (prop === "margin-left" || prop === "text-indent") {
      const n = Number.parseFloat(value);
      if (!Number.isFinite(n)) return "";
      const unit = /em$/i.test(value) ? "em" : "px";
      return `${clamp(n, prop === "text-indent" ? -8 : 0, unit === "em" ? 8 : 120)}${unit}`;
    }
    return "";
  };
  const sanitizeStyleAttr = (styleText = "") => {
    const result = [];
    String(styleText).split(";").forEach((chunk) => {
      const [rawProp, rawVal] = chunk.split(":");
      if (!rawProp || rawVal === undefined) return;
      const prop = rawProp.trim().toLowerCase();
      if (!allowedStyles.has(prop)) return;
      const normalized = normalizeStyleValue(prop, rawVal);
      if (!normalized) return;
      result.push(`${prop}:${normalized}`);
    });
    return result.join(";");
  };
  const unwrapNode = (node) => {
    const parent = node.parentNode;
    if (!parent) return;
    while (node.firstChild) parent.insertBefore(node.firstChild, node);
    parent.removeChild(node);
  };
  const walk = (node) => {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
    [...node.childNodes].forEach((child) => walk(child));
    const tag = node.tagName.toLowerCase();
    if (!allowedTags.has(tag)) {
      unwrapNode(node);
      return;
    }
    [...node.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || name === "class" || name === "id" || name === "src" || name === "width" || name === "height" || name === "data-mce-style") {
        node.removeAttribute(attr.name);
        return;
      }
      if (name === "href") {
        if (tag !== "a" || !normalizeRichLink(attr.value)) node.removeAttribute(attr.name);
        else node.setAttribute("href", normalizeRichLink(attr.value));
        return;
      }
      if (name === "data-paragraph-preset") {
        if (!["body", "subtitle", "title"].includes(attr.value)) node.removeAttribute(attr.name);
        return;
      }
      if (name !== "style") node.removeAttribute(attr.name);
    });
    if (node.hasAttribute("style")) {
      const cleanStyle = sanitizeStyleAttr(node.getAttribute("style"));
      if (cleanStyle) node.setAttribute("style", cleanStyle);
      else node.removeAttribute("style");
    }
    if (tag === "span" && !node.attributes.length && !node.textContent?.trim()) {
      node.remove();
    }
  };
  [...template.content.childNodes].forEach((node) => walk(node));
  const html = template.innerHTML
    .replace(/\u200B/g, "")
    .replace(/<span>\s*<\/span>/g, "")
    .replace(/<(div|p)>\s*<\/\1>/g, "<br>");
  return html;
}


/* =========================================================
   Anime.js Interaction Animations
   ========================================================= */
function bindAnimeInteractions() {
  const anime = window.animejs;
  if (!anime || typeof anime.animate !== "function") return;
  const { animate, createTimeline, stagger } = anime;
  if (!animate) return;

  /* --- Page load: CSS handles entrance, no anime.js override needed --- */

  /* --- Tool button click animation --- */
  function animateToolBtnClick(btn) {
    animate(btn, {
      scale: [1, 0.95, 1],
      duration: 280,
      ease: 'out(3)'
    });
  }

  /* --- Button press feedback --- */
  function animateBtnPress(btn) {
    animate(btn, {
      scale: [1, 0.96, 1],
      duration: 200,
      ease: 'out(2)'
    });
  }

  /* --- Settings panel switch animation --- */
  function animateSettingsPanel(panel) {
    if (!panel) return;
    animate(panel, {
      opacity: [0, 1],
      y: [8, 0],
      duration: 280,
      ease: 'out(3)'
    });
  }

  /* --- Settings card show animation --- */
  function animateSettingsCardShow(card) {
    if (!card) return;
    animate(card, {
      opacity: [0, 1],
      scale: [0.96, 1],
      y: [-10, 0],
      duration: 320,
      ease: 'out(3)'
    });
  }

  /* --- Sidebar nav item click animation --- */
  function animateNavItemClick(item) {
    animate(item, {
      scale: [1, 0.97, 1],
      duration: 220,
      ease: 'out(2)'
    });
  }

  /* --- Item card enter animation --- */
  function animateItemCardEnter(card) {
    if (!card) return;
    animate(card, {
      opacity: [0, 1],
      y: [15, 0],
      scale: [0.98, 1],
      duration: 350,
      ease: 'out(3)'
    });
  }

  /* --- Drawer toggle animation --- */
  function animateDrawerToggle(isOpen) {
    const drawer = document.getElementById('editorDrawer');
    if (!drawer) return;
    if (isOpen) {
      animate(drawer, {
        x: [20, 0],
        opacity: [0.5, 1],
        duration: 300,
        ease: 'out(3)'
      });
    }
  }

  /* --- Zoom control button animation --- */
  function animateZoomBtn(btn) {
    animate(btn, {
      scale: [1, 0.88, 1],
      duration: 220,
      ease: 'out(2)'
    });
  }

  /* --- Swatch selection animation --- */
  function animateSwatchSelect(swatch) {
    animate(swatch, {
      scale: [1, 1.15, 1],
      duration: 300,
      ease: 'out(3)'
    });
  }

  /* --- Preview page subtle bounce on zoom --- */
  function animatePreviewBounce() {
    const frame = document.getElementById('previewScaleFrame');
    if (!frame) return;
    animate(frame, {
      scale: [0.98, 1],
      duration: 350,
      ease: 'out(3)'
    });
  }

  /* --- Bind all event listeners --- */
  document.addEventListener('pointerdown', (e) => {
    const toolBtn = e.target.closest('.tool-btn');
    if (toolBtn) animateToolBtnClick(toolBtn);

    const iconBtn = e.target.closest('.icon-btn, .primary-btn, .round-btn, .ghost-btn, .danger-btn, .mini-btn');
    if (iconBtn) animateBtnPress(iconBtn);

    const navItem = e.target.closest('.module-nav-item');
    if (navItem) animateNavItemClick(navItem);

    const zoomBtn = e.target.closest('#zoomInBtn, #zoomOutBtn');
    if (zoomBtn) animateZoomBtn(zoomBtn);

    const swatch = e.target.closest('.swatch');
    if (swatch) animateSwatchSelect(swatch);
  });

  /* --- Observer for new item cards --- */
  const itemList = document.getElementById('itemList');
  if (itemList) {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        m.addedNodes.forEach((node) => {
          if (node.classList && node.classList.contains('item-card')) {
            animateItemCardEnter(node);
          }
        });
      });
    });
    observer.observe(itemList, { childList: true });
  }

  /* --- Observer for settings panel changes --- */
  const settingsCard = document.getElementById('settingsCard');
  if (settingsCard) {
    const panelObserver = new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        if (m.type === 'attributes' && m.attributeName === 'class') {
          const target = m.target;
          if (target.classList.contains('settings-panel') && target.classList.contains('active')) {
            animateSettingsPanel(target);
          }
          if (target === settingsCard && !target.classList.contains('hidden')) {
            animateSettingsCardShow(settingsCard);
          }
        }
      });
    });
    panelObserver.observe(settingsCard, { attributes: true, subtree: true, attributeFilter: ['class'] });
  }

  /* --- Entrance handled by CSS ui-enter animations --- */
}

function bindArchiveLifecycle() {
  const flushDailyLatest = () => persist({ silent: true, forceArchive: true, reason: "lifecycle-flush" });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushDailyLatest();
  });
  window.addEventListener("beforeunload", flushDailyLatest);
  window.addEventListener("pagehide", flushDailyLatest);
}


function init() {
  if (FETCHCV_EMBEDDED) {
    document.body.classList.add("fetchcv-embedded", "fetchcv-snapshot-loading");
    if (FETCHCV_PREVIEW_ONLY) document.body.classList.add("fetchcv-preview-only");
    state = structuredClone(initialState);
    ensureStateDefaults();
    normalizeSectionBuiltinFlags();
  }
  try {
    if (!FETCHCV_EMBEDDED) {
      hydrate();
      hydrateWorkbench();
      bindArchiveLifecycle();
    }
    cacheRefs();
    if (FETCHCV_EMBEDDED && !FETCHCV_PREVIEW_ONLY) refs.editorDrawer.appendChild(refs.settingsCard);
    resetImportProgressPanel();
    normalizeEditableProfileFields();
    normalizeEditorLayout();
    // Render sidebar entries before binding to avoid an empty sidebar if a later init step fails.
    renderTabs();
    syncInputsFromState();
    bindProfileInputs();
    bindSectionEditor();
    bindSettings();
    bindWorkspaceResizer();
    bindPreviewZoomControls();
    bindActions();
    if (!FETCHCV_EMBEDDED) {
      bindWorkbench();
      bindWorkbenchRouting();
    }
    bindInteractionEnhancements();
    window.addEventListener("resize", () => {
      requestAnimationFrame(() => applyInlineFieldLayouts());
      requestAnimationFrame(fitFetchCVCanonicalPreview);
    });
    if (FETCHCV_EMBEDDED) setWorkbenchMode(false);
    renderAll();
    if (!FETCHCV_EMBEDDED) {
      renderWorkbench();
      applyWorkbenchRoute();
    }
    try {
      bindAnimeInteractions();
    } catch (error) {
      console.warn("Anime interactions disabled:", error);
    }
  } catch (error) {
    reportFetchCVEditorError("initialize", error);
  } finally {
    fetchCVEditorInitialized = true;
    if (FETCHCV_EMBEDDED) {
      if (hasUsableFetchCVSnapshot(fetchCVPendingSnapshot)) applyFetchCVSnapshot(fetchCVPendingSnapshot);
      window.parent.postMessage({ type: "fetchcv:editor-ready" }, "*");
    } else if (!fetchCVEditorError) {
      void initializeSharedWorkspace();
    }
  }
}

function applyFetchCVSnapshot(snapshot) {
  if (!hasUsableFetchCVSnapshot(snapshot)) return false;
  fetchCVPendingSnapshot = snapshot;
  if (!fetchCVEditorInitialized) return false;
  try {
    state = structuredClone(snapshot);
    fetchCVSnapshotLoaded = true;
    ensureStateDefaults();
    normalizeSectionBuiltinFlags();
    normalizeEditableProfileFields();
    normalizeEditorLayout();
    syncInputsFromState();
    setWorkbenchMode(false);
    renderAll();
    fetchCVEditorError = "";
    document.body.classList.remove("fetchcv-snapshot-loading");
    window.parent.postMessage({ type: "fetchcv:snapshot-applied", profileName: state.profile.name, sectionCount: state.sections.length }, "*");
    requestAnimationFrame(fitFetchCVCanonicalPreview);
    return true;
  } catch (error) {
    fetchCVSnapshotLoaded = false;
    reportFetchCVEditorError("apply-snapshot", error);
    return false;
  }
}

async function loadFetchCVResume() {
  if (!FETCHCV_EMBEDDED || !FETCHCV_RESUME_ID) return;
  if (fetchCVSnapshotLoaded) return;
  try {
    let snapshot = null;
    if (typeof window.appRuntime?.getResumeSnapshot === "function") {
      snapshot = await window.appRuntime.getResumeSnapshot(FETCHCV_RESUME_ID);
    } else if (FETCHCV_API_BASE) {
      const response = await fetch(`${FETCHCV_API_BASE}/api/resumes/${encodeURIComponent(FETCHCV_RESUME_ID)}`, { headers: FETCHCV_API_HEADERS });
      if (!response.ok) throw new Error(`FetchCV resume request failed (${response.status})`);
      const resume = await response.json();
      snapshot = resume.content_json?.editor_snapshot;
    }
    if (!hasUsableFetchCVSnapshot(snapshot)) throw new Error("当前简历缺少可编辑快照");
    if (!fetchCVSnapshotLoaded) applyFetchCVSnapshot(hasUsableFetchCVSnapshot(fetchCVPendingSnapshot) ? fetchCVPendingSnapshot : snapshot);
  } catch (error) {
    reportFetchCVEditorError("load-snapshot", error);
  }
}

window.addEventListener("message", (event) => {
  const payload = event.data || {};
  if (payload.type === "fetchcv:load-snapshot") {
    fetchCVPendingSnapshot = payload.snapshot;
    if (fetchCVEditorInitialized && hasUsableFetchCVSnapshot(payload.snapshot)) applyFetchCVSnapshot(payload.snapshot);
  }
  if (payload.type === "fetchcv:export-pdf") void exportResumePdf({ download: payload.download !== false });
  if (payload.type === "fetchcv:request-snapshot") {
    window.parent.postMessage({ type: "fetchcv:editor-change", snapshot: cloneEditorState(state) }, "*");
  }
});

// Local desktop bridge. postMessage remains as a fallback, while this direct
// same-origin API removes the race between React mounting and the editor boot.
window.fetchCVBridge = {
  loadSnapshot(snapshot) {
    fetchCVPendingSnapshot = snapshot;
    return hasUsableFetchCVSnapshot(snapshot) ? applyFetchCVSnapshot(snapshot) : false;
  },
  exportPdf(options = {}) {
    return exportResumePdf(options);
  },
  snapshot() {
    return cloneEditorState(state);
  },
  status() {
    return {
      initialized: fetchCVEditorInitialized,
      loaded: fetchCVSnapshotLoaded,
      profileName: fetchCVSnapshotLoaded ? state.profile?.name || "" : "",
      sectionCount: fetchCVSnapshotLoaded ? state.sections?.length || 0 : 0,
      error: fetchCVEditorError,
    };
  },
};

init();
void loadFetchCVResume();

