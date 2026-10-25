import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { buildJdPreparation, summarizeInterviewEvidence } from "../src/lib/interview-progress.js";
import { resolveInterviewResearchState } from "../src/lib/interview-research.js";
import { compactProcessingEvents } from "../src/lib/processing.js";

const request = { id: "request", role: "user", run_id: "run", created_at: "2026-10-25T00:00:00Z", content: "合成调研请求", metadata_json: { task_kind: "interview_research", delivery_status: "completed" } };
function source(id = "source-a", extra = {}) {
  return { id, job_id: "job", status: "analyzed", text_preview: "合成保存正文的前800字预览。", extracted_questions: [{ question: "如何分析 SQL 查询？", evidence_quote: "合成正文末尾的问题原句。" }], ...extra };
}
function question(ids = ["source-a"], count = 1) {
  return { question: "如何分析 SQL 查询？", frequency: count, source_ids: ids, question_evidence: { supporting_source_ids: ids, independence_status: "confirmed", confirmed_independent_count: count } };
}
function fixture({ sources = [source()], questions = [question()], receipts = [], calls = [], invocations = [], content = "合成历史回答" } = {}) {
  return {
    job: { id: "job", jd_raw: "熟悉 SQL 查询与性能分析。\n能够解释方案的适用条件。\n具备可核查的项目经历。" },
    interview_sources: sources,
    interview_briefs: [{ id: "brief", summary: "旧简报伪高频99次", recommendations: [{ title: "旧建议", action: "我主导了99个项目" }], common_questions: questions }],
    messages: [structuredClone(request), { id: "answer", role: "assistant", run_id: "run", content, metadata_json: { task_kind: "interview_research", tool_receipts: receipts, research_result: { source_count: 99, status: "brief_ready" }, runtime: { evidence: { tool_count: 7 } } } }],
    steps: calls.length ? [{ id: "step", run_id: "run", created_at: "2026-10-25T00:01:00Z", status: "completed", tool_calls: calls }] : [],
    tool_invocations: invocations,
  };
}
const capture = (id, sourceId = "source-a", status = "completed") => ({ tool_call_id: id, tool_name: "capture_interview_source", status, artifacts: ["interview_source:" + sourceId] });

test("current source ids and successful capture receipts are deduplicated independently of tool operations", () => {
  const detail = fixture({ sources: [source(), source(), source("ocr", { status: "ocr_pending", text_preview: "", extracted_questions: [] })], receipts: [capture("one"), capture("two"), capture("three", "source-a", "completed_refresh_failed")] });
  const result = summarizeInterviewEvidence(detail);
  assert.equal(result.savedBodyCount, 1);
  assert.equal(result.extractedSourceCount, 1);
  assert.equal(result.usableSourceCount, 1);
  assert.equal(result.currentRoundSavedCount, 1);
  assert.equal(result.ocrPendingCount, 1);
  assert.match(result.currentRoundSavedLabel, /读取或复用 1 篇/);
  assert.equal(result.run.key, "ended");
  assert.equal(result.evidence.key, "limited");
  assert.equal(result.recurringQuestionCount, 0);
});

test("missing successful capture artifact ids remain unknown rather than borrowing counts or update times", () => {
  const detail = fixture({ sources: [source("source-a", { updated_at: "2026-10-25T00:02:00Z" })], receipts: [{ tool_call_id: "one", tool_name: "capture_interview_source", status: "completed", artifacts: [] }] });
  const result = summarizeInterviewEvidence(detail);
  assert.equal(result.currentRoundSavedCount, null);
  assert.match(result.currentRoundSavedLabel, /未记录/);
  assert.equal(result.savedBodyCount, 1);
  detail.messages[1].metadata_json.tool_receipts = [capture("failed", "source-a", "failed")];
  assert.equal(summarizeInterviewEvidence(detail).currentRoundSavedCount, 0);
});

test("analyzed status alone cannot support a legacy question without a body or extraction", () => {
  for (const invalid of [{ text_preview: "" }, { extracted_questions: [] }, { extracted_questions: [{ question: "另一问题", evidence_quote: "另一原句" }] }, { extracted_questions: [{ question: question().question, evidence_quote: "" }] }]) {
    const result = summarizeInterviewEvidence(fixture({ sources: [source("source-a", invalid)] }));
    assert.equal(result.usableSourceCount, 0);
    assert.equal(result.supportedQuestionCount, 0);
    assert.equal(result.recurringQuestionCount, 0);
  }
});

test("the preview is not mistaken for full body revalidation when the quote is beyond its first800 chars", () => {
  const result = summarizeInterviewEvidence(fixture());
  assert.equal(result.supportedQuestionCount, 1);
  assert.equal(source().text_preview.includes(source().extracted_questions[0].evidence_quote), false);
});

test("source deletion or recapture removes independent frequency even while one question retains support", () => {
  const detail = fixture({ sources: [source(), source("source-b")], questions: [question(["source-a", "source-b"], 2)] });
  assert.equal(summarizeInterviewEvidence(detail).recurringQuestionCount, 1);
  detail.interview_sources[1].status = "captured";
  const partial = summarizeInterviewEvidence(detail);
  assert.equal(partial.supportedQuestionCount, 1);
  assert.equal(partial.questions[0].currentIndependentCount, null);
  assert.equal(partial.recurringQuestionCount, 0);
  assert.equal(partial.evidence.key, "independence_pending");
  detail.interview_sources = [];
  assert.equal(summarizeInterviewEvidence(detail).supportedQuestionCount, 0);
  assert.equal(resolveInterviewResearchState({ briefs: detail.interview_briefs, sources: [] }), "idle");
});

test("only the current research request scopes operation errors, never unrelated historical failed invocations", () => {
  const detail = fixture({ sources: [], questions: [], receipts: [capture("current", "missing")], invocations: [{ provider_call_id: "old", tool_name: "capture_interview_source", status: "failed", error_json: { code: "browser_rate_limited" } }] });
  detail.steps = [{ run_id: "run", created_at: "2026-10-24T00:01:00Z", status: "failed", error_code: "browser_rate_limited", tool_calls: [{ provider_call_id: "old", tool_name: "capture_interview_source" }] }];
  const result = summarizeInterviewEvidence(detail);
  assert.deepEqual(result.reasons.map(reason => reason.key), ["unrecorded"]);
});

test("a truly completed zero-candidate discovery has its own reason and does not establish source sufficiency", () => {
  const detail = fixture({ sources: [], questions: [], calls: [{ provider_call_id: "discover", tool_name: "discover_interview_sources", result: { data: { results: [], discovery_exhausted: true } } }] });
  const result = summarizeInterviewEvidence(detail);
  assert.deepEqual(result.reasons.map(reason => reason.key), ["not_found"]);
  assert.equal(result.run.key, "ended");
  assert.equal(result.evidence.key, "unrecorded");
  detail.steps[0].tool_calls[0].result.data.discovery_exhausted = false;
  assert.deepEqual(summarizeInterviewEvidence(detail).reasons.map(reason => reason.key), ["unrecorded"]);
});

test("a later ordinary conversation and unrelated build failure do not become research reading failures", () => {
  const detail = fixture({ sources: [], questions: [] });
  detail.messages[1].created_at = "2026-10-25T00:02:00Z";
  detail.steps = [{ run_id: "run", created_at: "2026-10-25T00:03:00Z", status: "failed", error_code: "browser_rate_limited", tool_calls: [{ provider_call_id: "later", tool_name: "capture_interview_source" }] }];
  assert.deepEqual(summarizeInterviewEvidence(detail).reasons.map(reason => reason.key), ["unrecorded"]);
  detail.steps[0].created_at = "2026-10-25T00:01:00Z";
  detail.steps[0].tool_calls[0].tool_name = "build_interview_brief";
  detail.steps[0].error_code = "brief_insufficient_sources";
  assert.deepEqual(summarizeInterviewEvidence(detail).reasons.map(reason => reason.key), ["unrecorded"]);
});

test("real _record_failure step shape propagates step-level code through idempotency-key tool calls", () => {
  const detail = fixture({ sources: [], questions: [], receipts: [{ tool_call_id: "read", tool_name: "capture_interview_source", status: "failed", artifacts: [] }] });
  detail.steps = [{ run_id: "run", status: "failed", error_code: "xiaohongshu_public_access_cooldown", error: "合成访问暂停", tool_calls: [{ tool_name: "capture_interview_source", idempotency_key: "read" }] }];
  assert.deepEqual(summarizeInterviewEvidence(detail).reasons.map(reason => reason.key), ["restricted"]);
  detail.steps[0].error_code = "interview_source_unreadable";
  assert.deepEqual(summarizeInterviewEvidence(detail).reasons.map(reason => reason.key), ["read_failed"]);
});

test("structured captcha and runtime or budget stops remain separate from missing candidates", () => {
  for (const [signal, expected] of [["captcha", "restricted"], ["login_required", "restricted"], ["access_protection", "restricted"], ["page_budget", "incomplete"], ["time_budget", "incomplete"], ["browser_runtime_unavailable", "incomplete"]]) {
    const detail = fixture({ sources: [], questions: [], receipts: [capture("read", "missing", "failed")], invocations: [{ provider_call_id: "read", tool_name: "capture_interview_source", status: "failed", error_json: { code: "browser_read_stopped", details: { stop_reason: signal } } }] });
    assert.deepEqual(summarizeInterviewEvidence(detail).reasons.map(reason => reason.key), [expected]);
  }
});

test("rejected irrelevant counts use real structured fields and never assistant claims", () => {
  const detail = fixture({ sources: [], questions: [], content: "未发现、验证码、读取失败、不相关20篇", calls: [{ provider_call_id: "discover", tool_name: "discover_interview_sources", result: { data: { results: [{ url: "https://synthetic.invalid" }], rejected_irrelevant_count: 2 } } }] });
  const reasons = summarizeInterviewEvidence(detail).reasons;
  assert.deepEqual(reasons.map(reason => [reason.key, reason.count]), [["irrelevant", 2]]);
  detail.steps = [];
  assert.deepEqual(summarizeInterviewEvidence(detail).reasons.map(reason => reason.key), ["unrecorded"]);
});

test("run execution state is independent of current accumulated evidence", () => {
  const detail = fixture();
  assert.equal(summarizeInterviewEvidence(detail, { busy: true, activity: { kind: "chat", taskKind: "interview_research" } }).run.key, "active");
  detail.messages = [structuredClone(request)];
  const failed = summarizeInterviewEvidence(detail, { error: "合成错误" });
  assert.equal(failed.run.key, "failed");
  assert.equal(failed.savedBodyCount, 1);
  assert.equal(failed.supportedQuestionCount, 1);
});

test("JD preparation contains exact requirement excerpts and no invented achievements or company interview frequency", () => {
  const detail = fixture();
  const items = buildJdPreparation(detail.job);
  assert.equal(items.length, 3);
  for (const item of items) assert.equal(detail.job.jd_raw.includes(item.jdQuote), true);
  assert.match(items[2].action, /本人已确认/);
  assert.doesNotMatch(JSON.stringify(items), /我主导|高频|真题/);
  assert.deepEqual(buildJdPreparation({}), []);
});

test("processing operation summaries never convert operations into saved or extracted article counts", () => {
  for (const label of ["读取面经原文", "提取面试问题"]) {
    const rows = compactProcessingEvents([{ id: "1", label, status: "completed" }, { id: "2", label, status: "failed" }]);
    assert.match(rows[0].detail, /2 次操作，其中 1 次完成、1 次失败/);
    assert.doesNotMatch(rows[0].detail, /[12] 篇/);
  }
});

const compiled = await build({ entryPoints: [new URL("../src/components/InterviewIntelligence.jsx", import.meta.url).pathname.replace(/^\/(\w:)/, "$1")], bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic", loader: { ".css": "empty" }, packages: "external", define: { "import.meta.env": "{}" } });
const compiledModule = { exports: {} };
vm.runInNewContext(compiled.outputFiles[0].text, { module: compiledModule, exports: compiledModule.exports, require: createRequire(import.meta.url), window: { appRuntime: {}, matchMedia: () => ({ matches: true }) }, console, setTimeout, clearTimeout, URL, AbortController });
const { InterviewIntelligence, InterviewRail } = compiledModule.exports;
const render = (Component, detail) => renderToStaticMarkup(React.createElement(Component, { detail, runtime: { configured: true }, onResearch() {}, onOpenConversation() {} }));

test("actual interview JSX hides unsupported legacy reports and shows central JD actions with exact basis", () => {
  const detail = fixture({ sources: [], questions: [question(["deleted"], 9)] });
  const html = render(InterviewIntelligence, detail);
  assert.match(html, /aria-label="面试证据状态"/);
  assert.match(html, /aria-label="基于 JD 推导的准备建议"/);
  assert.match(html, /JD 依据/);
  assert.match(html, /按 JD 准备/);
  assert.doesNotMatch(html, /旧简报伪高频99次|我主导了99个项目|个多源共性|9 个独立来源/);
  assert.doesNotMatch(render(InterviewRail, detail), /高频问题|情报已就绪|达到多源交叉验证门槛/);
});

test("actual JSX distinguishes saved text, OCR pending and still-supported single experience", () => {
  const detail = fixture({ sources: [source(), source("ocr", { status: "ocr_pending", text_preview: "", extracted_questions: [] })] });
  const html = render(InterviewIntelligence, detail);
  assert.match(html, /累计已保存正文 1 篇/);
  assert.match(html, /已完成问题提取 1 篇/);
  assert.match(html, /图片 OCR 待核对 1 篇/);
  assert.match(html, /单一经验/);
  assert.doesNotMatch(html, /旧简报伪高频99次|我主导了99个项目/);
});

test("actual JSX exposes restricted reason plus JD and original-text alternatives", () => {
  const detail = fixture({ sources: [], questions: [], receipts: [capture("read", "missing", "failed")], invocations: [{ provider_call_id: "read", tool_name: "capture_interview_source", status: "failed", error_json: { code: "browser_rate_limited", details: { stop_reason: "captcha" } } }] });
  const html = render(InterviewIntelligence, detail);
  assert.match(html, /data-reason="restricted"/);
  assert.match(html, /访问受限/);
  assert.match(html, /按 JD 准备/);
  assert.match(html, /补充原文或查看历史对话/);
});

test("source implementation does not render unvalidated assistant report or legacy recommendation text as evidence", () => {
  const sourceText = fs.readFileSync(new URL("../src/components/InterviewIntelligence.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(sourceText, /brief\.summary|brief\.recommendations|AgentMarkdown|message\?\.content/);
});
