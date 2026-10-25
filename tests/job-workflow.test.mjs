import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformSync } from "esbuild";
import { deriveJobProgress } from "../src/lib/job-progress.js";

function fixture(stage) {
  return {
    job: { id: "synthetic-job", jd_raw: "使用 SQL 清洗数据，参与需求评审。" },
    run: stage ? { id: "synthetic-run", current_stage: stage } : null,
    approvals: [], facts: [{ id: "synthetic-fact", verified: true }], base_resumes: [{}],
    proposals: [], resumes: [],
  };
}

const runtime = { configured: true };
const progress = (detail, other = {}) => deriveJobProgress({ detail, runtime, ...other });

test("unknown operation and pending tool permission precede factual and rewrite approvals", () => {
  const detail = fixture("awaiting_fact_review");
  detail.tool_invocations = [{ status: "outcome_unknown" }];
  assert.equal(progress(detail, { toolApprovalCount: 1 }).action.key, "recovery");
  detail.tool_invocations = [];
  assert.equal(progress(detail, { toolApprovalCount: 1 }).action.key, "approval");
  detail.approvals = [{ action_type: "apply_resume_changes", status: "pending" }];
  assert.equal(progress(detail, { needsEvidenceCount: 1 }).action.key, "facts");
});

test("rewrite review has a central action and evidence gaps stay explicit", () => {
  const detail = fixture("awaiting_user_review");
  assert.equal(progress(detail).action.label, "审阅改写建议");
  const missing = progress(detail, { needsEvidenceCount: 2 });
  assert.equal(missing.action.label, "处理待补证");
  assert.ok(missing.missing.includes("2 条改写待补证，当前不能直接采用"));
  assert.equal(missing.executionLabel, "等待你的确认");
});

test("keeping original text clears rejected evidence todos while accepted stale claims remain visible", () => {
  const workspace = fs.readFileSync(new URL("../src/components/AgentWorkspace.jsx", import.meta.url), "utf8");
  const source = workspace.slice(workspace.indexOf("function proposalEvidenceReview("), workspace.indexOf("function ProposalEvidence("));
  const countEvidenceTodos = vm.runInNewContext(`(() => { ${source}; return proposalEvidenceTodoCount; })()`);
  const facts = new Map([["fact", { id: "fact", candidate_id: "candidate", version: 3, verified: true }]]);
  const claim = { verification_status: "verified", evidence: [{ fact_id: "fact", candidate_id: "candidate", fact_version: 3, source_quote: "参与合成数据分析。" }] };
  const unsupported = { section: "经历", approval_status: "rejected", claim_contract: { needs_evidence: true } };
  const accepted = { section: "经历", approval_status: "accepted", claim_contract: { needs_evidence: false, claims: [claim] } };
  const detail = fixture("ready_to_publish");
  detail.proposals = [unsupported, accepted];
  const count = () => countEvidenceTodos(detail.proposals, facts);
  assert.equal(count(), 0);
  assert.ok(!progress(detail, { needsEvidenceCount: count() }).missing.some(item => item.includes("条改写待补证")));
  assert.equal(unsupported.claim_contract.needs_evidence, true, "rejection does not mark a claim verified");
  unsupported.approval_status = "pending";
  assert.equal(count(), 1);
  unsupported.approval_status = "rejected";
  facts.get("fact").version = 4;
  assert.equal(count(), 1);
  accepted.approval_status = "edited_accepted";
  assert.equal(count(), 1);
});

test("running jobs cannot start another analysis and paused or stopped jobs have distinct continuations", () => {
  const running = progress(fixture(), { task: { status: "running" } });
  assert.equal(running.action.key, "waiting");
  assert.equal(running.action.disabled, true);
  assert.equal(progress(fixture("jd_analyzing"), { task: { status: "paused" } }).action.key, "resumeTask");
  assert.equal(progress(fixture("failed")).action.key, "retry");
  assert.equal(progress(fixture("cancelled")).action.key, "restart");
});

test("an ended run does not turn a manually edited resume into a verified result", () => {
  const detail = fixture("ready_to_publish");
  detail.resumes = [{ content_json: { verification_status: "unverified" } }];
  const value = progress(detail);
  assert.equal(value.stage, "简历处理已完成");
  assert.equal(value.executionLabel, "本轮执行已结束");
  assert.equal(value.action.key, "resume");
  assert.equal(value.results.find(item => item.key === "resume").value, "未核验");
  assert.ok(value.missing.includes("岗位简历正文或事实版本仍需核验"));
});

test("model setup and a complete JD are required by the primary analysis action", () => {
  assert.equal(progress(fixture()).action.key, "start");
  assert.equal(deriveJobProgress({ detail: fixture(), runtime: {} }).action.key, "settings");
  const detail = fixture();
  detail.job.jd_raw = "  ";
  assert.equal(progress(detail).action.disabled, true);
  assert.ok(progress(detail).missing.includes("还没有完整岗位描述"));
});

test("a failed stage exposes its recorded reason and does not erase saved products", () => {
  const detail = fixture("blocked");
  detail.run.error = JSON.stringify({ message: "合成事实版本已改变，需要重新审阅。" });
  detail.profile = { competencies: ["SQL"] };
  const value = progress(detail);
  assert.equal(value.notice, "合成事实版本已改变，需要重新审阅。");
  assert.equal(value.executionLabel, "本轮已中断");
  assert.ok(value.results.some(item => item.key === "profile"));
});

function components() {
  const source = fs.readFileSync(new URL("../src/components/JobProgressPanel.jsx", import.meta.url), "utf8")
    .replace(/^import .*;$/gm, "").replace(/export function /g, "function ");
  const compiled = transformSync(source, { loader: "jsx", jsx: "transform" }).code;
  const icon = () => React.createElement("span");
  return vm.runInNewContext(`(() => { ${compiled}; return {JobStartPanel, JobProgressPanel}; })()`, {
    React, deriveJobProgress, ArrowRight: icon, BriefcaseBusiness: icon, CheckCircle2: icon, CircleAlert: icon, LoaderCircle: icon,
  });
}

test("the first screen names the job path, explains its resume prerequisite, and keeps chat visible", () => {
  const { JobStartPanel } = components();
  const html = renderToStaticMarkup(React.createElement(JobStartPanel, { hasProfile: false, onAnalyze() {} }));
  assert.match(html, /分析一个岗位/);
  assert.match(html, /先导入本人的基础简历/);
  assert.match(html, /也可以在下方继续聊天/);
});

test("central progress separates real saved products, evidence gaps and the next action", () => {
  const { JobProgressPanel } = components();
  const html = renderToStaticMarkup(React.createElement(JobProgressPanel, {
    detail: fixture("awaiting_user_review"), runtime, needsEvidenceCount: 1,
    evidenceSummary: { result: "已保存正文 0 篇", missing: "没有可用于当前问题的面经依据", status: "本轮已结束 · 当前证据不足" }, onAction() {},
  }));
  assert.match(html, /aria-label="岗位进度"/);
  for (const label of ["当前阶段", "已有结果", "还缺什么", "下一步", "处理待补证", "已保存正文 0 篇", "本轮已结束 · 当前证据不足"]) assert.ok(html.includes(label));
  assert.equal((html.match(/class="primary-button"/g) || []).length, 1);
});
