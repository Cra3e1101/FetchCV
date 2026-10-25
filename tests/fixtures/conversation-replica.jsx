// Isolated integration harness. These API responses are test data, not a backend run.
import React from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "framer-motion";
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/source-serif-4/400.css";
import "@fontsource/source-serif-4/500.css";
import "@fontsource/jetbrains-mono/400.css";
import "../../src/styles.css";
import "../../src/ui/workspace.css";
import { applyInterfaceTheme } from "../../src/ui/interface-theme";
import { ConversationWorkspace } from "../../src/components/ConversationWorkspace";
import { AgentWorkspace } from "../../src/components/AgentWorkspace";
import { api } from "../../src/lib/api";
import { motionTransitions } from "../../src/ui/motion";
// Match main.jsx: component CSS loads before these final overrides.
import "../../src/ui/replica-alignment.css";
import "../../src/ui/agent-motion.css";
import "../../src/ui/replica-components.css";
import capturedShell from "./conversation-reference-shell.json";

applyInterfaceTheme();
const params = new URLSearchParams(location.search);
const capturedCommand = capturedShell.command;
const capturedOutput = capturedShell.output;
if (!capturedCommand || !capturedOutput) throw new Error("Captured Shell source structure has changed");
const receipts = [
  { tool_call_id: "fixture-1", tool_name: "read_workspace_file", status: "completed", summary: "合成工具摘要：第一行\n第二行\n第三行", artifacts: [] },
  { tool_call_id: "fixture-2", tool_name: "web_search", status: "completed", summary: "合成搜索摘要；未执行网络请求。", artifacts: [] },
  { tool_call_id: "fixture-3", tool_name: "run_workspace_command", status: "completed", summary: "合成固定工作区检查摘要；不是 Shell 命令。", artifacts: [] },
];
if (!params.has("schema")) receipts[0] = {
  tool_call_id: "reference-shell", tool_name: "exec_command", status: "completed", artifacts: [],
  command: capturedCommand, output: capturedOutput, summary: capturedOutput,
};
const initialMessages = [
  { id: "fixture-user", role: "user", content: "请检查对话窗口的显示与折叠行为。", metadata_json: {} },
  { id: "fixture-assistant", role: "assistant", content: "这是 UI 验收会话，工具数据由测试提供。\n\n**验收说明**\n\n- 折叠保留完整记录。\n- 输入区应保持可用。\n\n```powershell\nnpx rea-agents setup\n```\n\n```\n单行无语言代码围栏\n```", metadata_json: { tool_receipts: receipts } },
];
let saved = structuredClone(initialMessages);
let pendingStream;
const runtime = { configured: true, model: "UI 测试模型", provider_name: "测试适配器" };
window.appRuntime = {
  listModelProviders: async () => ({ profiles: [] }),
  importWorkspaceFiles: async () => Array.from({ length: 8 }, (_, index) => ({ name: `测试附件-${index + 1}.txt`, workspacePath: `fixture/attachment-${index + 1}.txt` })),
};
api.conversation = async () => ({ id: "fixture-conversation", title: "UI 验收 · 测试会话", messages: structuredClone(saved) });
api.streamConversation = async (_id, content, options) => {
  const user = { id: "fixture-stream-user", role: "user", content, metadata_json: {} };
  saved.push(user);
  options.onEvent("user", { message: user });
  return new Promise((resolve, reject) => {
    pendingStream = { options, resolve, reject };
    options.signal.addEventListener("abort", () => reject(new DOMException("Test stream cancelled", "AbortError")), { once: true });
  });
};
window.__conversationFixture = {
  provenance: { command: ".codex-ui-study/shell-body.html captured command", output: ".codex-ui-study/shell-body.html captured output", shellMapping: "Test-only command/output mapping; production receipt schema currently has summaries only" },
  get pending() { return Boolean(pendingStream); },
  emit(event, data) { if (!pendingStream) throw new Error("No active test stream"); pendingStream.options.onEvent(event, data); },
  finish(assistant) {
    saved.push(assistant);
    pendingStream.options.onEvent("done", { assistant });
    pendingStream.resolve();
    pendingStream = null;
  },
};
const jobDetail = { job: { id: "fixture-job", company: "UI 测试", role: "岗位对话", jd_raw: "测试岗位描述" }, messages: initialMessages, approvals: [], steps: [], facts: [], experiences: [], materials: [], resumes: [], queued_messages: [] };
createRoot(document.getElementById("root")).render(
  <MotionConfig reducedMotion="user" transition={motionTransitions.enter}>
    <div className="app-shell"><div className="app-grid source-grid" style={{ height: "100vh", gridTemplateColumns: "0px 0px minmax(0, 1fr) 0px", gridTemplateRows: "minmax(0, 1fr)", padding: 0 }}>
      {params.has("job") ? <AgentWorkspace detail={jobDetail} runtime={runtime} onSendMessage={async () => {}} onAddMaterial={window.appRuntime.importWorkspaceFiles} />
        : <ConversationWorkspace conversationId="fixture-conversation" jobs={[]} runtime={runtime} onCreated={() => {}} onChanged={() => {}} />}
    </div></div>
  </MotionConfig>,
);
