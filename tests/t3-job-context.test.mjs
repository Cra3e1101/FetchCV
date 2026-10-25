import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformSync } from "esbuild";
import { JOB_CONTEXT_BASIS, JOB_CONTEXT_FIELDS, RECRUITMENT_TYPES, jobPostingPreviewState, normalizeJobContext, staleJobResults, updateJobContextField } from "../src/lib/job-description.js";
import { deriveJobProgress } from "../src/lib/job-progress.js";
import { summarizeInterviewEvidence } from "../src/lib/interview-progress.js";

const body = "合成岗位：后端研发。\n招聘类型：实习。\n业务线：合成支付。\n发布日期：2026-10-01。";
const field = (value, basis, quote = "") => ({ value, basis, source_quote: quote, source_span: null });
const context = () => ({ schema_version: 1, fields: {
  function: field("研发", "source", "合成岗位：后端研发。"),
  sub_direction: field("后端开发", "inferred", "合成岗位：后端研发。"),
  recruitment_type: field("internship", "source", "招聘类型：实习。"),
  business_unit: field("合成支付", "user_confirmed"),
  published_at: field(null, "unknown"),
} });

test("missing or legacy context stays unknown and never defaults to campus recruitment", () => {
  for (const input of [null, {}, { fields: { recruitment_type: { value: "campus" }, function: "研发" } }]) {
    const result = normalizeJobContext(input, body);
    assert.equal(result.schema_version, 1);
    for (const value of Object.values(result.fields)) assert.deepEqual(value, field(null, "unknown"));
  }
});

test("all four basis states and explicit recruitment values survive the context contract", () => {
  const value = normalizeJobContext(context(), body);
  assert.deepEqual(Object.values(value.fields).map(item => item.basis), ["source", "inferred", "source", "user_confirmed", "unknown"]);
  for (const type of Object.keys(RECRUITMENT_TYPES)) {
    assert.equal(updateJobContextField(value, "recruitment_type", type, body).fields.recruitment_type.value, type);
  }
  assert.equal(updateJobContextField(value, "recruitment_type", "", body).fields.recruitment_type.value, null);
  assert.equal(updateJobContextField(value, "recruitment_type", "graduate", body).fields.recruitment_type.value, null);
});

test("a manual correction records user confirmation and preserves the inspectable original quote", () => {
  const value = updateJobContextField(context(), "sub_direction", "Java 后端", body);
  assert.equal(value.fields.sub_direction.basis, "user_confirmed");
  assert.equal(value.fields.sub_direction.value, "Java 后端");
  assert.equal(value.fields.sub_direction.source_quote, "合成岗位：后端研发。");
  assert.equal(updateJobContextField(value, "sub_direction", "Java ", body).fields.sub_direction.value, "Java ", "typing a space must remain possible");
});

test("changing the JD drops unsupported source and inferred values while keeping explicit user choices", () => {
  const edited = normalizeJobContext(context(), "新的岗位正文，未注明招聘类型。");
  assert.equal(edited.fields.function.basis, "unknown");
  assert.equal(edited.fields.sub_direction.value, null);
  assert.equal(edited.fields.recruitment_type.value, null);
  assert.equal(edited.fields.business_unit.value, "合成支付");
  const confirmed = updateJobContextField(context(), "function", "研发", body);
  assert.deepEqual(normalizeJobContext(confirmed, "新 JD").fields.function, field("研发", "user_confirmed"));
});

test("source positions follow Unicode characters and relocate after text is inserted", () => {
  const raw = "😀\n职能：研发。";
  const value = { fields: { function: field("研发", "source", "职能：研发。") } };
  assert.deepEqual(normalizeJobContext(value, raw).fields.function.source_span, [2, 8]);
  assert.deepEqual(normalizeJobContext(value, `合成\n${raw}`).fields.function.source_span, [5, 11]);
});

test("publication remains unknown when only a fetch time is supplied", () => {
  const value = normalizeJobContext({ ...context(), fetched_at: "2026-10-25T12:00:00Z" }, body);
  assert.equal(value.fields.published_at.value, null);
});

test("preview statuses remain distinct and an unusable response cannot supply a usable JD", () => {
  assert.equal(jobPostingPreviewState({ status: "ok", body, description: "旧正文" }).body, body);
  assert.equal(jobPostingPreviewState({ status: "ok", body: "", description: body }).usable, false);
  for (const status of ["requires_user_action", "timeout", "insufficient_content", "error"]) {
    const value = jobPostingPreviewState({ status, body: "暂不可用", warnings: ["合成警告"] });
    assert.equal(value.status, status);
    assert.equal(value.usable, false);
    assert.deepEqual(value.warnings, ["合成警告"]);
  }
});

test("preview warnings keep raw codes for diagnostics and show only concise actions to users", () => {
  const warnings = ["browser:insufficient_content", "firecrawl:insufficient_content", "static:web_timeout", "browser:requires_user_action", "published_at:structured_metadata_not_in_body", "synthetic:unknown_code"];
  const result = jobPostingPreviewState({ status: "ok", body, warnings });
  assert.deepEqual(result.warnings, warnings);
  assert.equal(result.warningMessages.length, 5, "equivalent fallback warnings are deduplicated");
  const displayed = result.warningMessages.join(" ");
  assert.match(displayed, /发布日期.*手动确认/);
  assert.match(displayed, /超时.*重试/);
  assert.doesNotMatch(displayed, /browser:|firecrawl:|static:|structured_metadata|unknown_code/);
});

function cardComponents() {
  const source = fs.readFileSync(new URL("../src/components/JobContextCard.jsx", import.meta.url), "utf8")
    .replace(/^import .*;$/gm, "").replace(/export function /g, "function ");
  return vm.runInNewContext(`(() => { ${transformSync(source, { loader: "jsx", jsx: "transform" }).code}; return { JobContextEditor, JobContextSummary, JobInputStaleNotice }; })()`, {
    React, JOB_CONTEXT_BASIS, JOB_CONTEXT_FIELDS, RECRUITMENT_TYPES, normalizeJobContext, updateJobContextField, staleJobResults,
  });
}

test("actual context editor JSX exposes each field, basis and original evidence", () => {
  const { JobContextEditor } = cardComponents();
  const html = renderToStaticMarkup(React.createElement(JobContextEditor, { value: context(), body, onChange() {} }));
  for (const label of ["确认岗位语境", "职能", "子方向", "招聘类型", "部门 / 业务线", "JD 发布日期", "原文依据", "推断", "用户确认", "未知", "确认此项"]) assert.ok(html.includes(label));
  assert.match(html, /value="internship" selected=""/);
  assert.ok(html.includes("合成岗位：后端研发。"));
  assert.equal((html.match(/<option value="campus" selected/g) || []).length, 0);
});

test("stored context reopens with evidence and separately labelled fetch and publication dates", () => {
  const { JobContextSummary } = cardComponents();
  const html = renderToStaticMarkup(React.createElement(JobContextSummary, { job: {
    jd_raw: body, context_json: JSON.parse(JSON.stringify(context())),
    jd_provenance: { fetched_at: "2026-10-25T12:00:00Z", source_url: "https://example.invalid/synthetic-job" },
  }, onEdit() {} }));
  for (const label of ["岗位语境", "实习", "后端开发", "合成支付", "JD 发布日期", "网页抓取时间", "2026-10-25", "编辑岗位与语境"]) assert.ok(html.includes(label));
  assert.match(html, /<dt>JD 发布日期<\/dt><dd><span>未知<\/span>/);
});

test("a user correction keeps the old quote as comparison instead of claiming it supports the new value", () => {
  const { JobContextEditor } = cardComponents();
  const corrected = updateJobContextField(context(), "recruitment_type", "social", body);
  const html = renderToStaticMarkup(React.createElement(JobContextEditor, { value: corrected, body, onChange() {} }));
  assert.match(html, /value="social" selected=""/);
  assert.ok(html.includes("招聘类型：实习。"), "the original context stays inspectable");
  assert.ok(html.includes("查看原文对照"));
  assert.ok(html.includes("查看推断依据"));
  assert.equal(corrected.fields.recruitment_type.basis, "user_confirmed");
});

function staleDetail() {
  return {
    job: { id: "synthetic", jd_raw: body }, run: { current_stage: "awaiting_user_review" },
    profile: { competencies: ["历史能力"], business_context: { analysis_status: "stale" } },
    facts: [{ id: "synthetic-fact", verified: true }], approvals: [], proposals: [], resumes: [],
    interview_sources: [{ id: "source", status: "analyzed", text_preview: "合成正文", extracted_questions: [{ question: "历史问题", evidence_quote: "合成引文" }] }],
    interview_briefs: [{ metadata_json: { analysis_status: "stale" }, common_questions: [{ question: "历史问题", frequency: 9, question_evidence: { supporting_source_ids: ["source"] } }] }],
  };
}

test("stale derived results offer a new analysis without overriding safety interruptions or personal facts", () => {
  const detail = staleDetail();
  const result = deriveJobProgress({ detail, runtime: { configured: true } });
  assert.equal(result.action.key, "restart");
  assert.equal(result.results.find(item => item.key === "profile").value, "旧结果已过期");
  assert.equal(result.results.find(item => item.key === "facts").value, "1 条");
  assert.equal(deriveJobProgress({ detail, runtime: {}, toolApprovalCount: 1 }).action.key, "approval");
  detail.tool_invocations = [{ status: "outcome_unknown" }];
  assert.equal(deriveJobProgress({ detail, runtime: {}, toolApprovalCount: 1 }).action.key, "recovery");
});

test("a stale brief never contributes current supported questions or frequency while saved sources remain", () => {
  const detail = staleDetail();
  const summary = summarizeInterviewEvidence(detail);
  assert.equal(summary.evidence.key, "stale");
  assert.deepEqual(summary.questions, []);
  assert.equal(summary.usableSourceCount, 0);
  assert.equal(summary.recurringQuestionCount, 0);
  assert.equal(summary.savedBodyCount, 1);
  assert.match(summary.gapText, /旧简报需重新调研/);
  const { JobInputStaleNotice } = cardComponents();
  const html = renderToStaticMarkup(React.createElement(JobInputStaleNotice, { detail }));
  assert.match(html, /aria-label="岗位结果过期提示"/);
  assert.match(html, /已确认的个人事实仍按原证据核验/);
  detail.profile.business_context.analysis_status = "current";
  detail.interview_briefs.unshift({ metadata_json: {}, common_questions: [] });
  assert.deepEqual(staleJobResults(detail), [], "historical stale briefs do not invalidate the new current brief");
});

test("an updated profile routes the remaining stale brief to interview research instead of repeating resume analysis", () => {
  const detail = staleDetail();
  detail.profile.business_context.analysis_status = "current";
  detail.run.current_stage = "ready_to_publish";
  assert.equal(deriveJobProgress({ detail, runtime: { configured: true } }).action.key, "interview");
});

test("older resume and rewrite relevance remains marked after profile regeneration without changing factual verification", () => {
  const detail = staleDetail();
  detail.profile.business_context.analysis_status = "current";
  detail.interview_briefs = [];
  detail.run.current_stage = "ready_to_publish";
  detail.resumes = [{ content_json: { verification_status: "verified" }, job_relevance: { analysis_status: "stale" } }];
  detail.proposals = [{ job_relevance: { analysis_status: "stale" }, claim_contract: { needs_evidence: false } }];
  const result = deriveJobProgress({ detail, runtime: { configured: true } });
  assert.equal(result.action.key, "resume", "historical relevance does not trap the new run in repeated restarts");
  assert.match(result.results.find(item => item.key === "resume").value, /岗位相关性已过期/);
  assert.match(result.results.find(item => item.key === "proposals").value, /1 条岗位相关性已过期/);
  assert.equal(detail.resumes[0].content_json.verification_status, "verified");
  assert.equal(detail.facts[0].verified, true);
  assert.deepEqual(staleJobResults(detail), ["旧岗位简历", "旧改写建议"]);
});

function modalHarness(name, end, globals = {}) {
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const source = app.slice(app.indexOf(`function ${name}(`), app.indexOf(`function ${end}(`));
  const states = [], dependencies = [];
  let cursor = 0;
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial; return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return states[index] ||= { current: initial }; },
    useEffect(callback, deps) { const index = cursor++; if (!dependencies[index] || deps.some((dep, i) => dep !== dependencies[index][i])) { dependencies[index] = deps; callback(); } },
  };
  const icon = () => null;
  const component = vm.runInNewContext(`(() => { ${transformSync(source, { loader: "jsx", jsx: "transform" }).code}; return ${name}; })()`, {
    ...hooks, React, motion: { form: "form" }, window: { addEventListener() {}, removeEventListener() {} },
    normalizeJobContext, splitJobDescriptions: () => [], jobPostingPreviewState, JobContextEditor: () => null,
    AbortController, X: icon, FileUp: icon, Globe2: icon, LoaderCircle: icon, AlertCircle: icon, Trash2: icon, ...globals,
  });
  return props => { cursor = 0; return component(props); };
}

function find(element, predicate) {
  if (!element || typeof element !== "object") return null;
  if (predicate(element)) return element;
  for (const child of React.Children.toArray(element.props?.children)) {
    const match = find(child, predicate);
    if (match) return match;
  }
  return null;
}

test("actual new-job modal only saves after submit and forwards preview context and provenance", async () => {
  const created = [];
  const posting = { status: "ok", title: "合成后端", company: "合成公司", body, source_url: "https://example.invalid/job", context_json: context(), jd_provenance: { adapter: "synthetic", fetched_at: "2026-10-25T12:00:00Z" } };
  const render = modalHarness("NewJobModal", "JobManageDialog", { api: { previewJobPosting: async () => posting } });
  const props = { open: true, candidates: [{ id: "synthetic-candidate", name: "合成同学" }], onClose() {}, onCreate: value => created.push(value) };
  render(props);
  let tree = render(props);
  find(tree, item => item.props?.["aria-label"] === "招聘网页 URL").props.onChange({ target: { value: posting.source_url } });
  tree = render(props);
  await find(tree, item => item.type === "button" && React.Children.toArray(item.props.children).includes("读取网页")).props.onClick();
  assert.equal(created.length, 0, "preview must not create a job");
  tree = render(props);
  find(tree, item => item.type === "form").props.onSubmit({ preventDefault() {} });
  assert.equal(created.length, 1);
  assert.equal(created[0].jd_raw, body);
  assert.equal(created[0].context_json.fields.recruitment_type.value, "internship");
  assert.equal(created[0].jd_provenance.adapter, "synthetic");
});

test("actual manage modal reads saved context and sends edited context through the existing save callback", () => {
  const saved = [];
  const render = modalHarness("JobManageDialog", "FreezeConfirm");
  const props = { job: { company: "合成公司", role: "合成岗位", jd_raw: body, context_json: context() }, onClose() {}, onSave: value => saved.push(value) };
  render(props);
  let tree = render(props);
  const editor = find(tree, item => item.props?.body === body && item.props?.value?.schema_version === 1);
  assert.equal(editor.props.value.fields.recruitment_type.value, "internship");
  editor.props.onChange(updateJobContextField(editor.props.value, "recruitment_type", "social", body));
  tree = render(props);
  find(tree, item => item.type === "form").props.onSubmit({ preventDefault() {} });
  assert.equal(saved[0].context_json.fields.recruitment_type.value, "social");
  assert.equal(saved[0].context_json.fields.recruitment_type.basis, "user_confirmed");
});

test("changing the URL during a preview cancels its late result and drops the prior fetch provenance", async () => {
  let finish;
  const created = [];
  const render = modalHarness("NewJobModal", "JobManageDialog", { api: { previewJobPosting: () => new Promise(resolve => { finish = resolve; }) } });
  const props = { open: true, candidates: [{ id: "synthetic-candidate" }], onClose() {}, onCreate: value => created.push(value) };
  render(props);
  let tree = render(props);
  find(tree, item => item.props?.["aria-label"] === "招聘网页 URL").props.onChange({ target: { value: "https://example.invalid/first" } });
  tree = render(props);
  const pending = find(tree, item => item.type === "button" && React.Children.toArray(item.props.children).includes("读取网页")).props.onClick();
  tree = render(props);
  find(tree, item => item.props?.["aria-label"] === "招聘网页 URL").props.onChange({ target: { value: "https://example.invalid/second" } });
  finish({ status: "ok", body, context_json: context(), jd_provenance: { adapter: "late-preview" } });
  await pending;
  tree = render(props);
  find(tree, item => item.type === "form").props.onSubmit({ preventDefault() {} });
  assert.equal(created[0].source_url, "https://example.invalid/second");
  assert.equal(created[0].jd_raw, "");
  assert.equal(created[0].jd_provenance.adapter, undefined);
});
