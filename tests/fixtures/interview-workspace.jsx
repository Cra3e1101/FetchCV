// Synthetic interview evidence, with production components and real UI events.
import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/source-serif-4/400.css";
import "@fontsource/source-serif-4/500.css";
import "@fontsource/jetbrains-mono/400.css";
import "../../src/styles.css";
import "../../src/ui/workspace.css";
import "../../src/ui/replica-alignment.css";
import "../../src/ui/replica-components.css";
import "../../src/ui/agent-motion.css";
import { InterviewIntelligence, InterviewRail } from "../../src/components/InterviewIntelligence";
import { api } from "../../src/lib/api";
import { applyInterfaceTheme } from "../../src/ui/interface-theme";

const job = {
  id: "fixture-job", company: "百度", role: "AI 产品经理",
  jd_raw: "负责 AI 产品的需求分析与方案设计，理解大模型的能力边界。\n熟悉用户研究与数据分析，能够设计指标评估产品效果。\n具备跨团队协作能力，推动产品从验证到落地。",
};
const questions = ["如何评估一个 AI 搜索产品的回答质量？", "模型效果和产品体验发生冲突时，如何取舍？"];
const sources = [
  ["source-a", "xiaohongshu", "百度 AI 产品经理 · 一面记录"],
  ["source-b", "nowcoder", "AI 产品经理面试复盘：从需求到评估"],
  ["source-c", "nowcoder", "百度产品岗二面：方案取舍与团队协作"],
].map(([id, platform, title], index) => ({
  id, job_id: job.id, company: job.company, role: job.role, title, platform, status: "analyzed",
  source_url: `https://example.com/interview/${id}`, published_at: `2026-10-${23 + index}T10:00:00Z`,
  text_preview: `第 ${index + 1} 篇合成面经正文。面试官讨论了 AI 产品的效果评估、体验和团队协作。`,
  raw_text: `第 ${index + 1} 篇合成面经正文。\n${questions.join("\n")}\n以上均为浏览器测试的合成内容。`,
  extracted_questions: questions.map(question => ({ question, evidence_quote: question })),
  metadata_json: { coverage_scope: "same_business_role" },
}));
const capture = (id, sourceId, status = "completed") => ({
  tool_call_id: id, tool_name: "capture_interview_source", status,
  artifacts: sourceId ? [`interview_source:${sourceId}`] : [],
});
const receipts = [
  ...sources.map(source => capture(`read-${source.id}`, source.id)),
  capture("read-failed-a", null, "failed"), capture("read-failed-b", null, "failed"), capture("read-restricted", null, "failed"),
  { tool_call_id: "discover", tool_name: "discover_interview_sources", status: "completed", result: { rejected_irrelevant_count: 64 } },
];
const messages = [
  { id: "request", role: "user", run_id: "fixture-run", created_at: "2026-10-27T01:00:00Z", content: "合成面经调研请求", metadata_json: { task_kind: "interview_research", delivery_status: "completed" } },
  { id: "answer", role: "assistant", run_id: "fixture-run", created_at: "2026-10-27T01:05:00Z", content: "合成调研记录，正文已经保留。", metadata_json: { task_kind: "interview_research", tool_receipts: receipts } },
];
const unsupported = Array.from({ length: 39 }, (_, index) => ({
  id: `unsupported-${index}`, question: `旧简报未验证的问题 ${index + 1}`,
  frequency: 9, source_ids: ["removed"],
  question_evidence: { supporting_source_ids: ["removed"], independence_status: "confirmed", confirmed_independent_count: 9 },
}));
const supported = questions.map((question, index) => ({
  id: `question-${index}`, question, category: index ? "产品判断" : "效果评估", frequency: index ? 1 : 2,
  source_ids: index ? ["source-c"] : ["source-a", "source-b"],
  question_evidence: { supporting_source_ids: index ? ["source-c"] : ["source-a", "source-b"], independence_status: "confirmed", confirmed_independent_count: index ? 1 : 2 },
}));

function makeScenario(name) {
  const detail = {
    job: structuredClone(job), interview_sources: structuredClone(sources),
    interview_briefs: [{ id: "fixture-brief", common_questions: structuredClone(unsupported), metadata_json: {} }],
    messages: structuredClone(messages), approvals: [], steps: [],
    tool_invocations: [
      { provider_call_id: "read-failed-a", tool_name: "capture_interview_source", status: "failed", error_json: { code: "read_failed" } },
      { provider_call_id: "read-failed-b", tool_name: "capture_interview_source", status: "failed", error_json: { code: "read_failed" } },
      { provider_call_id: "read-restricted", tool_name: "capture_interview_source", status: "failed", error_json: { code: "access_denied", details: { stop_reason: "captcha" } } },
    ],
  };
  const props = { detail, busy: false, error: "", activity: null, runtime: { configured: true } };
  if (["supported", "stale"].includes(name)) detail.interview_briefs[0].common_questions = structuredClone(supported);
  if (name === "stale") detail.interview_briefs[0].metadata_json.analysis_status = "stale";
  if (["idle", "unconfigured", "no-jd"].includes(name)) {
    detail.interview_sources = []; detail.interview_briefs = []; detail.messages = []; detail.tool_invocations = [];
  }
  if (name === "no-jd") detail.job.jd_raw = "";
  if (name === "unconfigured") props.runtime = { configured: false };
  if (name === "active") {
    detail.messages = [structuredClone(messages[0])];
    detail.messages[0].metadata_json.delivery_status = "streaming";
    props.busy = true;
    props.activity = { kind: "chat", taskKind: "interview_research", label: "正在读取面经原文" };
  }
  if (name === "approval") {
    detail.approvals = [{ id: "approval", status: "pending", action_type: "permission:web_access", decision_payload: { items: [{ tool_name: "capture_interview_source" }] } }];
    props.waitingForApproval = true;
  }
  if (name === "resume-approval") detail.approvals = [{ id: "resume-approval", status: "pending", action_type: "apply_resume_changes" }];
  return props;
}

const params = new URLSearchParams(location.search);
const state = window.interviewFixture = {
  scenario: params.get("scenario") || "saved", generation: 0,
  researches: 0, conversations: 0, edits: 0, loginBegins: 0, loginFinishes: 0, originals: [], reads: [],
  setScenario(name) { this.scenario = name; this.generation += 1; render(); },
  setTheme(theme) { applyInterfaceTheme(theme); },
};
window.appRuntime = {
  async beginXiaohongshuLogin() { state.loginBegins += 1; return { connected: false, message: "请在独立窗口扫码登录。" }; },
  async finishXiaohongshuLogin() { state.loginFinishes += 1; return { connected: true, message: "已连接小红书。" }; },
  async openInterviewSource(source) { state.originals.push(source); return { opened: true }; },
};
api.interviewSource = async id => { state.reads.push(id); return structuredClone(sources.find(source => source.id === id)); };
applyInterfaceTheme(params.get("theme") || "white");
const app = createRoot(document.getElementById("root"));
function render() {
  const props = { ...makeScenario(state.scenario), onResearch: () => { state.researches += 1; }, onOpenConversation: () => { state.conversations += 1; }, onEditJob: () => { state.edits += 1; } };
  app.render(<div className="app-shell"><div className="source-grid source-nav-closed fixture-interview-shell">
    <main className="main-pane">
      <header className="task-header"><h1>百度 AI产品经理</h1><span className="fixture-interview-context">面试</span></header>
      <InterviewIntelligence key={state.generation} {...props} />
    </main>
    {params.has("rail") && <aside className="fixture-interview-rail"><InterviewRail key={state.generation} {...props} /></aside>}
  </div></div>);
}
render();
