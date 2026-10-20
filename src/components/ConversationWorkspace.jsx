import {MessageSquare} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Composer } from "./AgentWorkspace";
import { AgentMessage } from "./AgentMessage";
import { api } from "../lib/api";
import "./ConversationWorkspace.css";

export function ConversationWorkspace({ conversationId, jobs, runtime, onCreated, onChanged, onModelActivated, onManageModels }) {
  const [chat, setChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(conversationId));
  const [error, setError] = useState("");
  const [quote, setQuote] = useState(null);
  const controller = useRef(null);
  const live = useRef(true);
  const bottom = useRef(null);
  useEffect(() => {
    live.current = true;
    if (conversationId) api.conversation(conversationId).then(value => {
      if (live.current) { setChat(value); setMessages(value.messages); }
    }).catch(e => live.current && setError(e.message)).finally(() => live.current && setLoading(false));
    return () => { live.current = false; controller.current?.abort(); };
  }, [conversationId]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [messages]);
  const send = async (content, options) => {
    if (controller.current || loading) return;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError("");
    let current = chat;
    // Preserve the submitted text even if local persistence or bootstrap fails.
    setMessages(items => [...items, { id: "pending-user", role: "user", content, metadata_json: { delivery_status: "streaming" } }]);
    try {
      if (!current) {
        current = await api.createConversation();
        if (!live.current) return;
        setChat(current); onCreated(current.id);
      }
      await api.streamConversation(current.id, content, { ...options, signal: abort.signal, onEvent: (event, data) => {
        if (!live.current) return;
        if (event === "user") setMessages(items => [...items.filter(m => m.id !== "pending-user"), data.message]);
        if (event === "delta") setMessages(items => {
          const previous = items.find(m => m.id === "streaming-assistant");
          return [...items.filter(m => m.id !== "streaming-assistant"), { id: "streaming-assistant", role: "assistant", content: (previous?.content || "") + data.text, metadata_json: { delivery_status: "streaming" } }];
        });
      }});
    } catch (e) {
      if (live.current) setError(e.name === "AbortError" ? "已停止生成" : e.message);
    } finally {
      if (current) {
        try {
          const saved = await api.conversation(current.id);
          if (live.current) {
            setChat(saved);
            setMessages(previous => [...saved.messages, ...previous.filter(m => m.id === "pending-user").map(m => ({...m, metadata_json: {delivery_status: "failed"}}))]);
          }
        } catch (e) { if (live.current) setError(e.message); }
        onChanged();
      }
      controller.current = null;
      if (live.current) setBusy(false);
    }
  };
  const link = async jobId => {
    setError("");
    try { const saved = await api.linkConversation(chat.id, jobId); setChat(saved); onChanged(); }
    catch (e) { setError(e.message); }
  };
  return <main className="main-pane standalone-chat" aria-label="独立对话">
    <header className="task-header"><h1>{chat?.title || "新对话"}</h1>
      {chat && jobs.length > 0 && <select aria-label="关联岗位（可选）" value={chat.job_id || ""} disabled={busy} onChange={e => link(e.target.value)}><option value="">不关联岗位</option>{jobs.map(job => <option key={job.id} value={job.id}>{job.company} · {job.role}</option>)}</select>}
    </header>
    <div className="standalone-scroll"><div className="standalone-transcript">
      {loading ? <p role="status">正在读取对话…</p> : !messages.length && <div className="standalone-home"><MessageSquare aria-hidden="true"/><h2 className="standalone-welcome">想聊些什么？</h2></div>}
      {messages.map(message => <AgentMessage key={message.id} message={message} onQuote={setQuote} />)}
      {busy && !messages.some(m => m.id === "streaming-assistant") && <p role="status">正在思考…</p>}
      {error && <div role="alert" className="dialog-error">{error}</div>}<div ref={bottom} />
    </div></div>
    <div className="standalone-composer"><Composer placeholder={messages.length ? "与 FetchCV 协作" : "随心输入"} busy={busy || loading} streaming={busy || loading} runtime={runtime} quote={quote} onClearQuote={() => setQuote(null)} onSend={send} onCancel={() => controller.current?.abort()} onAddMaterial={() => window.appRuntime?.importWorkspaceFiles?.()} onModelActivated={onModelActivated} onManageModels={onManageModels} /></div>
  </main>;
}
