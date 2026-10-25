import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformSync } from "esbuild";

const workspace = fs.readFileSync(new URL("../src/components/AgentWorkspace.jsx", import.meta.url), "utf8");
const editor = fs.readFileSync(new URL("../public/resume-editor/app.js", import.meta.url), "utf8");

function reviewPanel() {
  const source = workspace.slice(workspace.indexOf("function proposalEvidenceReview("), workspace.indexOf("function ProposalReviewOverlay("));
  const compiled = transformSync(source, { loader: "jsx", jsx: "transform" }).code;
  const icon = () => React.createElement("span");
  return vm.runInNewContext(`(() => { ${compiled}; return ProposalPanel; })()`, {
    React, ...React, api: {}, Check: icon, ActivityIndicator: icon,
  });
}

function reviewFixture() {
  const fact = { id: "fact-synthetic", candidate_id: "candidate-synthetic", version: 3, verified: true };
  const text = "参与 SQL 数据分析。";
  const claim = { text, verification_status: "verified", action: "参与", object: "SQL 数据分析", metrics: [], status: "参与", evidence: [{ candidate_id: fact.candidate_id, fact_id: fact.id, fact_version: 3, source_quote: text }] };
  return {
    job: { id: "job-synthetic" }, facts: [fact],
    approvals: [{ id: "approval-synthetic", action_type: "apply_resume_changes", status: "pending", decision_payload: {} }],
    proposals: [{ id: "proposal-synthetic", section: "经历", before: text, after: text, reason: "保留已确认事实", claim_contract: { claims: [claim], issues: [], needs_evidence: false } }],
  };
}

test("review shows each source quote and fact version, and blocks stale or missing evidence", () => {
  const Panel = reviewPanel();
  const detail = reviewFixture();
  const render = () => renderToStaticMarkup(React.createElement(Panel, { detail, busy: false, onSubmit() {} }));
  const verified = render();
  assert.match(verified, /支持原句/);
  assert.match(verified, /fact-synthetic.*v3/);
  assert.match(verified, /参与 SQL 数据分析/);
  assert.doesNotMatch(verified, /disabled=""[^>]*>采用建议/);
  detail.facts[0].version = 4;
  const stale = render();
  assert.match(stale, /当前 v4/);
  assert.match(stale, /事实已修订/);
  assert.match(stale, /disabled=""[^>]*>采用建议/);
  detail.proposals[0].claim_contract = {};
  assert.match(render(), /待补证.*当前不能直接采用/);
  detail.approvals = [{ id: "approval-synthetic", action_type: "apply_resume_changes", status: "pending", decision_payload: { draft: { revision: 2, decisions: { "proposal-synthetic": { decision: "edited_accepted", edited_after: "主导 SQL 数据分析。" } } } } }];
  assert.match(render(), /人工编辑内容尚未核验/);
});

test("verified evidence without a pending approval cannot be applied", () => {
  const Panel = reviewPanel();
  const detail = reviewFixture();
  detail.approvals = [];
  const markup = renderToStaticMarkup(React.createElement(Panel, { detail, busy: false, onSubmit() {} }));
  assert.match(markup, /disabled=""[^>]*>采用建议/);
});

function exportHarness({ patchOk = true, getOk = true, renderOk = true, mutateDuringRender = false } = {}) {
  const events = [];
  const state = { profile: { name: "合成候选人" }, sections: [] };
  const button = { disabled: false, setAttribute() {}, removeAttribute() {} };
  class Pdf {
    internal = { pageSize: { getWidth: () => 595, getHeight: () => 842 } };
    addPage() {}
    addImage() {}
    output() { return new Blob(["synthetic pdf"]); }
  }
  const context = {
    state, Blob, JSON, String, Error, FETCHCV_EMBEDDED: true,
    FETCHCV_RESUME_ID: "resume-synthetic", FETCHCV_API_BASE: "http://synthetic.invalid", FETCHCV_API_HEADERS: {}, fetchCVSnapshotLoaded: true,
    refs: { saveStatus: { textContent: "" } }, $: () => button,
    console: { warn() {}, error() {} }, confirmExportReadiness: async () => true,
    cloneEditorState: (value) => structuredClone(value), exportFileName: () => "synthetic.pdf",
    renderResumePagesToCanvas: async () => {
      events.push("render");
      if (mutateDuringRender) state.profile.name = "已编辑合成候选人";
      return [{ toDataURL: () => "data:image/jpeg;base64,synthetic" }];
    },
    window: {
      jspdf: { jsPDF: Pdf }, parent: { postMessage: (message) => events.push(message.type) }, setTimeout() {},
      appRuntime: { renderResumePdf: async (resumeId, expectedHash) => {
        assert.equal(resumeId, "resume-synthetic");
        assert.equal(expectedHash, "synthetic-version");
        events.push("trusted-render");
        if (mutateDuringRender) state.profile.name = "已编辑合成候选人";
        return { ok: renderOk, pageCount: 1, pdfUrl: "/synthetic.pdf", message: "事实待补证" };
      } },
    },
    fetch: async (_url, options) => {
      events.push(options.method || "GET");
      if (options.method === "PATCH") {
        assert.deepEqual(JSON.parse(options.body).editor_snapshot, state);
        return { ok: patchOk, status: patchOk ? 200 : 409, json: async () => patchOk ? { content_hash: "synthetic-version" } : { error: { message: "正文保存失败" } } };
      }
      assert.equal(options.method, undefined);
      return { ok: getOk, status: getOk ? 200 : 409, blob: async () => new Blob(["verified synthetic pdf"]), json: async () => ({ error: { message: "事实待补证" } }) };
    },
    downloadBlob: () => events.push("download"),
  };
  context.window.postMessage = (message) => events.push(message.type);
  context.window.parent = context.window;
  const source = editor.slice(editor.indexOf("async function renderVerifiedFetchCVPdf("), editor.indexOf("function syncInputsFromState("));
  const run = vm.runInNewContext(`${source}; exportResumePdf`, context);
  return { run, events, button, context };
}

test("embedded PDF downloads only after exact body save and successful backend validation", async () => {
  const harness = exportHarness();
  assert.equal((await harness.run()).ok, true);
  assert.deepEqual(harness.events.filter((event) => ["PATCH", "trusted-render", "GET", "download"].includes(event)), ["PATCH", "trusted-render", "GET", "download"]);
  assert.equal(harness.events.includes("render"), false);
  assert.equal(harness.button.disabled, false);
});

test("embedded iframe requests the parent text renderer with the saved version", async () => {
  const harness = exportHarness();
  const browser = harness.context.window;
  browser.appRuntime = undefined;
  let listener;
  browser.addEventListener = (_name, callback) => { listener = callback; };
  browser.removeEventListener = () => { listener = undefined; };
  browser.clearTimeout = () => {};
  browser.parent = { postMessage: (message) => {
    harness.events.push(message.type);
    if (message.type !== "fetchcv:request-verified-pdf") return;
    assert.equal(message.resumeHash, "synthetic-version");
    listener({ source: browser.parent, data: { type: "fetchcv:verified-pdf-result", requestId: message.requestId, ok: true, pageCount: 1, pdfUrl: "/synthetic.pdf" } });
  } };
  assert.equal((await harness.run()).ok, true);
  assert.equal(harness.events.includes("fetchcv:request-verified-pdf"), true);
  assert.equal(harness.events.includes("download"), true);
  assert.equal(harness.events.includes("render"), false);
  assert.equal(listener, undefined);
});

for (const [name, options] of [
  ["body save rejected", { patchOk: false }],
  ["text renderer fact/version guard rejected", { renderOk: false }],
  ["download GET fact/version guard rejected", { getOk: false }],
  ["visible body edited during render", { mutateDuringRender: true }],
]) test(`embedded PDF emits no download when ${name}`, async () => {
  const harness = exportHarness(options);
  assert.equal((await harness.run()).ok, false);
  assert.equal(harness.events.includes("download"), false);
  assert.equal(harness.events.includes("fetchcv:pdf-error"), true);
  assert.match(harness.context.refs.saveStatus.textContent, /导出失败/);
});
