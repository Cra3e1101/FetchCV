// Synthetic file discovery and sends with the production Composer and styling.
import React from "react";
import { createRoot } from "react-dom/client";
import { Composer } from "../../src/components/AgentWorkspace";
import { api } from "../../src/lib/api";
import { applyInterfaceTheme } from "../../src/ui/interface-theme";
import "../../src/styles.css";
import "../../src/ui/workspace.css";
import "../../src/ui/replica-alignment.css";
import "../../src/ui/agent-motion.css";
import "../../src/ui/replica-components.css";

applyInterfaceTheme();
const state = window.composerFixture = {
  sends: [], uploads: 0, settings: [], fileRequests: 0, failFiles: false, delayFiles: false,
  files: [
    { name: "中文简历.pdf", workspacePath: "materials/中文简历.pdf" },
    { name: "Project Notes.md", workspacePath: "materials/Project Notes.md" },
    { name: "中文简历.pdf", workspacePath: "archive/中文简历.pdf" },
  ],
  props: {},
  reset() { this.sends = []; this.uploads = 0; },
  update(props) { this.props = { ...this.props, ...props }; render(); },
};
window.appRuntime = {
  listModelProviders: async () => ({ profiles: [] }),
  listWorkspaceFiles: async () => {
    state.fileRequests += 1;
    if (state.delayFiles) await new Promise(resolve => { state.releaseFiles = resolve; });
    if (state.failFiles) throw new Error("合成文件列表读取失败");
    return state.files;
  },
};
api.permissionSettings = async () => ({ workspace_write: "ask", file_delete: "ask", web_access: "ask", browser_bridge: "ask" });
const app = createRoot(document.getElementById("root"));
function render() {
  app.render(<div className="app-shell"><div className="app-grid source-grid fixture-grid"><main className="main-pane standalone-chat">
    <header className="task-header"><h1>输入框交互验证</h1></header>
    <div className="standalone-scroll"><button id="outside" type="button" style={{ margin: 24 }}>输入框外</button></div>
    <Composer runtime={{ configured: true, model: "Test model" }} onSend={(text, options) => state.sends.push({ text, options })} onManageModels={section => state.settings.push(section)}
      onAddMaterial={async () => { state.uploads += 1; return [{ name: "上传附件.txt", workspacePath: "uploads/上传附件.txt" }]; }} {...state.props} />
  </main></div></div>);
}
render();
