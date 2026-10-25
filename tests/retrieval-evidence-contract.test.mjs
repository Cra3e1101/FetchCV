import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { independentQuestionCount, readInterviewEvidenceAccounting, readInterviewSourceHints } from "../src/lib/interview-evidence.js";
import { summarizeInterviewEvidence } from "../src/lib/interview-progress.js";

const accounting = extra => ({
  evidence_contract_version: "evidence-v2",
  usable_document_group_count: 4,
  confirmed_origin_count: 0,
  unresolved_origin_count: 4,
  minimum_documents_for_limited_brief: 4,
  limited_brief_ready: true,
  brief_readiness: "limited_ready",
  next_actions: [],
  ...extra,
});
const source = id => ({ id, job_id: "synthetic-job", status: "analyzed", text_preview: "合成公开正文。",
  extracted_questions: [{ question: "如何验证检索结果？", evidence_quote: "合成问题的原文依据。" }] });
const sourceHints = () => ({ status: "current",
  classification_v1: { status: "current", schema_version: 1, mode: "review_hint_only", predicted_kind: "suspected_compilation",
    signals: [{ rule_id: "numbered_interviews", quote: "合成面经01" }] },
  similarity_v1: { status: "current", schema_version: 1, mode: "review_candidates_only", pool_truncated: false,
    candidates: [{ source_id: "b", region: "interview_narrative", jaccard: 0.99, strength: "review_candidate" }] },
});
const question = extra => ({ question: "如何验证检索结果？", frequency: 2,
  question_evidence: { supporting_source_ids: ["a", "b"], independence_status: "confirmed", confirmed_independent_count: 2 }, ...extra });
function fixture(contract) {
  return {
    job: { id: "synthetic-job", jd_raw: "能够验证检索结果并解释证据范围。" },
    interview_sources: [source("a"), source("b")],
    interview_briefs: [{ id: "synthetic-brief", common_questions: [question()],
      metadata_json: contract ? { evidence_accounting: contract } : {} }],
    messages: [],
  };
}

test("legacy counts and document totals do not manufacture confirmed independent origins", () => {
  const detail = fixture();
  detail.interview_briefs[0].source_count = 99;
  detail.interview_briefs[0].metadata_json.evidence_accounting = { source_count: 99, confirmed_origin_count: 99 };
  const result = summarizeInterviewEvidence(detail);
  assert.equal(result.savedBodyCount, 2);
  assert.equal(result.evidenceAccounting.confirmedOriginCount, null);
  assert.equal(result.evidenceAccounting.usableDocumentGroupCount, null);
  assert.equal(result.evidenceAccounting.limitedBriefReady, null);
  assert.match(result.evidenceAccounting.summaryText, /已确认独立来源 未核实/);
});

test("v2 separates usable documents, confirmed origins and unresolved groups, preserving zero", () => {
  const result = readInterviewEvidenceAccounting(accounting());
  assert.equal(result.usableDocumentGroupCount, 4);
  assert.equal(result.confirmedOriginCount, 0);
  assert.equal(result.unresolvedOriginCount, 4);
  assert.equal(result.limitedBriefReady, true);
  assert.match(result.summaryText, /可用文档组 4 组，已确认独立来源 0 个，待核实组 4 组/);
  assert.doesNotMatch(result.readinessText, /多源交叉验证|高频|独立来源已充足/);
});

test("independent origin and document group counts use different units", () => {
  const result = readInterviewEvidenceAccounting(accounting({ usable_document_group_count: 1, confirmed_origin_count: 2,
    unresolved_origin_count: 0, limited_brief_ready: false }));
  assert.equal(result.usableDocumentGroupCount, 1);
  assert.equal(result.confirmedOriginCount, 2);
  assert.equal(result.unresolvedOriginCount, 0);
  assert.equal(result.limitedBriefReady, false);
});

test("missing, invalid, string, negative and unversioned fields remain unknown", () => {
  for (const value of [undefined, null, "4", -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    const result = readInterviewEvidenceAccounting(accounting({ confirmed_origin_count: value }));
    assert.equal(result.confirmedOriginCount, null);
    assert.equal(result.usableDocumentGroupCount, null);
    assert.equal(result.limitedBriefReady, null);
  }
  for (const version of [undefined, "legacy", "evidence-v1", "evidence-v3"]) {
    assert.equal(readInterviewEvidenceAccounting(accounting({ evidence_contract_version: version })).confirmedOriginCount, null);
  }
});

test("readiness requires the explicit v2 boolean and its recorded document minimum", () => {
  assert.equal(readInterviewEvidenceAccounting(accounting({ limited_brief_ready: "true" })).limitedBriefReady, null);
  assert.equal(readInterviewEvidenceAccounting(accounting({ minimum_documents_for_limited_brief: undefined })).limitedBriefReady, null);
  assert.equal(readInterviewEvidenceAccounting(accounting({ minimum_documents_for_limited_brief: 0 })).limitedBriefReady, null);
  assert.equal(readInterviewEvidenceAccounting(accounting({ usable_document_group_count: 3 })).limitedBriefReady, false);
});

test("stale briefs with recorded v2 counts cannot keep current counts or readiness", () => {
  for (const status of ["stale", "invalid", "invalidated"]) {
    const detail = fixture(accounting());
    detail.interview_briefs[0].metadata_json.analysis_status = status;
    const result = summarizeInterviewEvidence(detail);
    assert.equal(result.evidenceAccounting.confirmedOriginCount, null);
    assert.equal(result.evidenceAccounting.limitedBriefReady, null);
    assert.equal(result.supportedQuestionCount, 0);
    assert.match(result.evidenceAccounting.summaryText, /需更新/);
  }
});

test("v2 brief document readiness never upgrades per-question independent frequency", () => {
  const detail = fixture(accounting({ confirmed_origin_count: 4, unresolved_origin_count: 0 }));
  detail.interview_briefs[0].common_questions[0].question_evidence.independence_status = "partial";
  assert.equal(summarizeInterviewEvidence(detail).recurringQuestionCount, 0);
  assert.equal(independentQuestionCount(detail.interview_briefs[0].common_questions[0]), null);
  detail.interview_briefs[0].common_questions[0] = question();
  detail.interview_sources[1].extracted_questions[0].evidence_quote = "";
  const result = summarizeInterviewEvidence(detail);
  assert.equal(result.supportedQuestionCount, 1);
  assert.equal(result.questions[0].currentIndependentCount, null);
  assert.equal(result.recurringQuestionCount, 0);
});

test("classification and similarity current statuses are consumed independently", () => {
  const row = { ...source("a"), source_hints: sourceHints() };
  row.source_hints.status = "stale";
  row.source_hints.similarity_v1.status = "stale";
  let result = readInterviewSourceHints(row);
  assert.equal(result.classification.current, true);
  assert.match(result.classification.label, /疑似汇编.*待核实/);
  assert.deepEqual(result.classification.signals, ["合成面经01"]);
  assert.equal(result.similarity.current, false);
  assert.deepEqual(result.similarity.candidates, []);
  assert.match(result.similarity.label, /待更新/);
  row.source_hints.classification_v1.status = "stale";
  row.source_hints.similarity_v1.status = "current";
  result = readInterviewSourceHints(row);
  assert.equal(result.classification.current, false);
  assert.deepEqual(result.classification.signals, []);
  assert.deepEqual(result.similarity.candidates.map(candidate => candidate.sourceId), ["b"]);
});

test("missing and stale hints never fall back to raw metadata or matching hashes", () => {
  const row = { ...source("a"), metadata_json: sourceHints() };
  row.metadata_json.classification_v1.status = "current";
  let result = readInterviewSourceHints(row);
  assert.equal(result.classification.current, false);
  assert.deepEqual(result.similarity.candidates, []);
  assert.match(result.preview, /待更新/);
  row.source_hints = sourceHints();
  row.source_hints.similarity_v1.status = "stale";
  row.source_hints.similarity_v1.input_body_hash = "same-hash";
  row.source_hints.similarity_v1.candidates[0].other_body_hash = "same-hash";
  result = readInterviewSourceHints(row);
  assert.deepEqual(result.similarity.candidates, []);
});

test("similarity candidates remain review hints, deduplicated for display without mutating source records", () => {
  const row = { ...source("a"), source_hints: sourceHints() };
  row.source_hints.similarity_v1.pool_truncated = true;
  row.source_hints.similarity_v1.candidates.push({ source_id: "b" }, { source_id: "a" }, {}, { source_id: "c" });
  const before = structuredClone(row);
  const result = readInterviewSourceHints(row);
  assert.deepEqual(result.similarity.candidates.map(candidate => candidate.sourceId), ["b", "c"]);
  assert.equal(result.similarity.poolTruncated, true);
  assert.match(result.similarity.label, /内容重叠候选 2 个.*待核实/);
  assert.deepEqual(row, before);
  const detail = fixture(accounting());
  detail.interview_sources[0] = row;
  assert.equal(summarizeInterviewEvidence(detail).evidenceAccounting.confirmedOriginCount, 0);
});

test("unknown hint versions or modes cannot masquerade as current review evidence", () => {
  for (const extra of [{ schema_version: 2 }, { mode: "confirmed" }]) {
    const row = { ...source("a"), source_hints: sourceHints() };
    Object.assign(row.source_hints.classification_v1, extra);
    Object.assign(row.source_hints.similarity_v1, extra);
    const result = readInterviewSourceHints(row);
    assert.equal(result.classification.current, false);
    assert.deepEqual(result.similarity.candidates, []);
  }
});

test("shared JD, templates and weak matches are distinguished from narrative similarity", () => {
  const row = { ...source("a"), source_hints: sourceHints() };
  row.source_hints.similarity_v1.candidates = [
    { source_id: "jd", region: "shared_jd", strength: "weak", jaccard: 1 },
    { source_id: "template", region: "shared_template", strength: "review_candidate", jaccard: 1 },
    { source_id: "short", region: "whole_body", strength: "weak", jaccard: 1 },
    { source_id: "body", region: "interview_narrative", strength: "review_candidate", jaccard: 0.8 },
  ];
  const candidates = readInterviewSourceHints(row).similarity.candidates;
  assert.deepEqual(candidates.map(candidate => candidate.region), ["shared_jd", "shared_template", "whole_body", "interview_narrative"]);
  assert.deepEqual(candidates.map(candidate => candidate.strength), ["weak", "review_candidate", "weak", "review_candidate"]);
  assert.match(candidates[0].label, /仅岗位描述重叠.*待核实/);
  assert.match(candidates[1].label, /模板重叠.*待核实/);
  assert.match(candidates[2].label, /弱相似提示.*待核实/);
  assert.match(candidates[3].label, /正文相似.*待核实/);
  assert.doesNotMatch(JSON.stringify(candidates), /已确认|独立来源|同源认证/);
});

// In-memory JSX compilation and static rendering only: no app, effects, API or browser is started.
const compiled = await build({ entryPoints: [new URL("../src/components/InterviewIntelligence.jsx", import.meta.url).pathname.replace(/^\/(\w:)/, "$1")],
  bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic", loader: { ".css": "empty" },
  packages: "external", define: { "import.meta.env": "{}" } });
const compiledModule = { exports: {} };
vm.runInNewContext(compiled.outputFiles[0].text, { module: compiledModule, exports: compiledModule.exports,
  require: createRequire(import.meta.url), window: { appRuntime: {}, matchMedia: () => ({ matches: true }) },
  console, setTimeout, clearTimeout, URL, AbortController });
const render = (Component, detail) => renderToStaticMarkup(React.createElement(Component, {
  detail, runtime: { configured: true }, onResearch() {}, onOpenConversation() {},
}));

test("actual main UI and rail show the three distinct v2 counts", () => {
  const detail = fixture(accounting());
  const html = render(compiledModule.exports.InterviewIntelligence, detail);
  assert.match(html, /可用文档组 4 组/);
  assert.match(html, /已确认独立来源 0 个/);
  assert.match(html, /待核实组 4 组/);
  assert.match(html, /已达到有限简报的文档门槛/);
  const rail = render(compiledModule.exports.InterviewRail, detail);
  assert.match(rail, /<b>0<\/b><small>已确认独立来源<\/small>/);
  assert.match(rail, /<b>4<\/b><small>待核实组<\/small>/);
});

test("actual legacy UI reports unknown independent accounting rather than borrowing article counts", () => {
  const detail = fixture();
  const html = render(compiledModule.exports.InterviewIntelligence, detail);
  assert.match(html, /已确认独立来源 未核实/);
  assert.match(html, /可用文档组 未记录/);
  assert.doesNotMatch(html, /已确认独立来源 2 个/);
});

const reviewCompiled = await build({ entryPoints: [new URL("../src/components/InterviewEvidenceReview.jsx", import.meta.url).pathname.replace(/^\/(\w:)/, "$1")],
  bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic", packages: "external", define: { "import.meta.env": "{}" } });
const reviewModule = { exports: {} };
vm.runInNewContext(reviewCompiled.outputFiles[0].text, { module: reviewModule, exports: reviewModule.exports,
  require: createRequire(import.meta.url), window: { appRuntime: {} }, console, URL, AbortController });
const renderReview = row => renderToStaticMarkup(React.createElement(reviewModule.exports.InterviewEvidenceReview, { source: row, onSaved() {} }));

test("actual review shows hints without preselecting a source kind, origin or quotation", () => {
  const row = { ...source("a"), source_hints: sourceHints() };
  row.source_hints.classification_v1.predicted_kind = "first_person_candidate";
  const html = renderReview(row);
  assert.match(html, /疑似作者亲历（待核实）/);
  assert.match(html, /内容重叠候选 1 个（待核实）/);
  assert.match(html, /打开候选原帖 1/);
  assert.match(html, /正文相似（待核实）/);
  assert.match(html, /不会自动合并来源或填写下方核验记录/);
  assert.match(html, /<option value="unknown" selected="">/);
  assert.doesNotMatch(html, /<option value="first_person" selected/);
  assert.match(html, /type="url"[^>]*value=""/);
  assert.match(html, /<textarea[^>]*><\/textarea>/);
  assert.match(html, /来源核验 · 未核验/);
});

test("actual review handles legacy records with no review hash and visibly withholds stale candidates", () => {
  const row = { ...source("a"), source_hints: sourceHints() };
  row.source_hints.similarity_v1.status = "stale";
  const html = renderReview(row);
  assert.match(html, /疑似汇编（待核实）/);
  assert.match(html, /相似性提示待更新/);
  assert.doesNotMatch(html, /打开候选原帖/);
  assert.match(html, /button type="submit" disabled/);
});

test("actual review labels copied JD and template candidates without calling them duplicate interviews", () => {
  const row = { ...source("a"), source_hints: sourceHints() };
  row.source_hints.similarity_v1.candidates = [
    { source_id: "jd", region: "shared_jd", strength: "review_candidate" },
    { source_id: "template", region: "shared_template", strength: "weak" },
  ];
  const html = renderReview(row);
  assert.match(html, /打开候选原帖 1 · 仅岗位描述重叠（待核实）/);
  assert.match(html, /打开候选原帖 2 · 模板重叠（待核实）/);
  assert.doesNotMatch(html, /疑似近重复|同源认证|相似度.*%/);
});
