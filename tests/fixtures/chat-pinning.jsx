// Synthetic API data with the production workspaces, stream session and styles.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "framer-motion";
import { AgentWorkspace } from "../../src/components/AgentWorkspace";
import { ConversationWorkspace } from "../../src/components/ConversationWorkspace";
import { api } from "../../src/lib/api";
import { applyInterfaceTheme } from "../../src/ui/interface-theme";
import "../../src/styles.css";
import "../../src/ui/workspace.css";
import "../../src/ui/replica-alignment.css";
import "../../src/ui/agent-motion.css";
import "../../src/ui/replica-components.css";

applyInterfaceTheme();
localStorage.setItem("fetchcv.context-rail-collapsed", "1");
window.appRuntime = { listModelProviders: async () => ({ profiles: [] }) };
api.permissionSettings = async () => ({ workspace_write: "ask", file_delete: "ask", web_access: "ask", browser_bridge: "ask" });
const runtime = { configured: true, model: "Synthetic scroll test" };
const histories = Object.fromEntries(["first", "second"].map(id => [id,
  Array.from({ length: id === "first" ? 64 : 2 }, (_, index) => ({
    id: `${id}-history-${index}`, role: index % 2 ? "assistant" : "user",
    content: index % 2 ? `### Synthetic answer ${index}\n\nFirst paragraph for scroll testing.\n\nSecond paragraph with **formatted content**.` : `Synthetic question ${index}`,
    metadata_json: {},
  })),
]));
let sequence = 0;
api.conversation = async id => {
  if (id === "second") await new Promise(resolve => setTimeout(resolve, 400));
  return { id, title: `Scroll test ${id}`, messages: histories[id] };
};
api.streamConversation = (id, content, { signal, onEvent }) => new Promise((resolve, reject) => {
  const turn = ++sequence;
  let text = "";
  const user = { id: `${id}-user-${turn}`, role: "user", content, metadata_json: {} };
  histories[id] = [...histories[id], user];
  onEvent("user", { message: user });
  window.scrollFixture.stream = {
    emit(delta) { text += delta; onEvent("delta", { text: delta }); },
    done() {
      const assistant = { id: `${id}-answer-${turn}`, role: "assistant", content: text, metadata_json: {} };
      histories[id] = [...histories[id], assistant];
      onEvent("done", { assistant });
      resolve();
    },
  };
  signal.addEventListener("abort", () => reject(new DOMException("Test stream stopped", "AbortError")), { once: true });
});

function Job({ id }) {
  const [messageState, setMessageState] = useState(() => ({ ...histories }));
  const messages = messageState[id];
  const setMessages = value => setMessageState(previous => ({ ...previous, [id]: value }));
  const [activity, setActivity] = useState(null);
  const send = content => new Promise(resolve => {
    const turn = ++sequence;
    let text = "";
    const user = { id: `${id}-user-${turn}`, role: "user", content, metadata_json: {} };
    histories[id] = [...histories[id], user];
    setMessages(histories[id]);
    setActivity({ kind: "chat", startedAt: Date.now(), label: "Synthetic stream", events: [] });
    window.scrollFixture.stream = {
      emit(delta) {
        text += delta;
        setMessages([...histories[id], { id: "streaming-assistant", role: "assistant", content: text, metadata_json: { delivery_status: "streaming" } }]);
      },
      done() {
        histories[id] = [...histories[id], { id: `${id}-answer-${turn}`, role: "assistant", content: text, metadata_json: {} }];
        setMessages(histories[id]);
        setActivity(null);
        resolve();
      },
    };
  });
  const detail = { job: { id, company: "Synthetic", role: `Scroll test ${id}`, jd_raw: "Synthetic job description" }, messages, approvals: [], steps: [], facts: [], experiences: [], resumes: [], base_resumes: [], interview_sources: [], interview_briefs: [] };
  return <AgentWorkspace detail={detail} activity={activity} busy={Boolean(activity)} runtime={runtime} onSendMessage={send} onCancelMessage={() => window.scrollFixture.stream.done()} />;
}

window.scrollFixture = { stream: null };
function App() {
  const [id, setId] = useState("first");
  window.scrollFixture.switchConversation = setId;
  const standalone = new URLSearchParams(location.search).has("standalone");
  return <MotionConfig reducedMotion="user"><div className="app-shell"><div className="app-grid source-grid fixture-grid">
    {standalone ? <ConversationWorkspace conversationId={id} jobs={[]} runtime={runtime} /> : <Job id={id} />}
  </div></div></MotionConfig>;
}
createRoot(document.getElementById("root")).render(<App />);
