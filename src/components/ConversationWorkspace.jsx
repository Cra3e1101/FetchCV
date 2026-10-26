import { ArrowDown, MessageSquare } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Composer } from "./AgentWorkspace";
import { AgentMessage } from "./AgentMessage";
import { JobStartPanel } from "./JobProgressPanel";
import { useAgentMotion } from "../ui/motion";
import { ContentSkeleton } from "../ui/Skeleton";
import { conversationSessions } from "../lib/conversation-sessions";
import { useChatScrollPinning } from "../lib/use-chat-scroll-pinning";
import "./ConversationWorkspace.css";

const scrollPositions = new WeakMap();

export function ConversationWorkspace({ sessionKey, conversationId, jobs, runtime, agentReady = true, startupMessage, onCreated, onChanged, onModelActivated, onManageModels, onAnalyzeJob, hasProfile }) {
  const [draftKey] = useState(() => Symbol("draft"));
  const session = useMemo(() => conversationSessions.get(sessionKey || conversationId || draftKey, conversationId), [sessionKey, conversationId, draftKey]);
  const {chat, messages, busy, stopping, finishing, loading, error} = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [quote, setQuote] = useState(null);
  const { containerRef: scroller, contentRef: transcript, showJumpControl: showJump, scrollToBottom: jumpToLatest } = useChatScrollPinning({
    scrollKey: session, positions: scrollPositions, enabled: !loading,
  });
  const announced = useRef(null);
  const motionStyle = useAgentMotion();
  useEffect(() => { void session.load(); }, [session]);
  useEffect(() => {
    if (!chat?.id) return;
    if (!conversationId && announced.current !== chat.id) {
      announced.current = chat.id;
      onCreated?.(chat.id);
    }
  }, [chat?.id, conversationId, onCreated]);
  const send = (content, options) => {
    if (busy || loading || !agentReady) return;
    jumpToLatest();
    return session.send(content, options, onChanged);
  };
  const link = jobId => session.link(jobId, onChanged);
  return <main className="main-pane standalone-chat" aria-label="独立对话">
    <header className="task-header"><h1>{chat?.title || "新对话"}</h1>
      {chat && jobs.length > 0 && <select aria-label="关联岗位（可选）" value={chat.job_id || ""} disabled={busy || !agentReady} onChange={e => link(e.target.value)}><option value="">不关联岗位</option>{jobs.map(job => <option key={job.id} value={job.id}>{job.company} · {job.role}</option>)}</select>}
    </header>
    <div ref={scroller} className="standalone-scroll" tabIndex={0} aria-label="独立对话记录"><div ref={transcript} className="standalone-transcript">
      {loading ? <ContentSkeleton label="正在读取对话…" /> : !messages.length && (onAnalyzeJob ? <JobStartPanel hasProfile={hasProfile} onAnalyze={onAnalyzeJob} /> : <div className="standalone-home"><MessageSquare aria-hidden="true"/><h2 className="standalone-welcome">想聊些什么？</h2></div>)}
      {messages.map(message => <AgentMessage key={message.id} message={message} pending={message.metadata_json?.delivery_status === "sending"} animate={message.metadata_json?.delivery_status === "sending" || message.id === "streaming-assistant"} onQuote={setQuote} />)}
      {error && <div role="alert" className="dialog-error">{error}</div>}
    </div></div>
    <AnimatePresence initial={false}>{showJump && <motion.button type="button" className="jump-to-latest standalone-jump" aria-label="回到底部" title="回到底部并继续跟随新消息" onClick={jumpToLatest} initial={motionStyle.enter()} animate={{ opacity: 1, y: 0 }} exit={{ ...motionStyle.exit(), transition: motionStyle.transition("exit") }} transition={motionStyle.transition("enter")}><ArrowDown size={14} aria-hidden="true"/><span>回到底部</span></motion.button>}</AnimatePresence>
    <div className="standalone-composer"><Composer placeholder={messages.length ? "与 FetchCV 协作" : "随心输入"} busy={busy || loading} streaming={busy} stopping={stopping} finishing={finishing} agentReady={agentReady && !loading} startupMessage={loading ? "正在读取对话…" : startupMessage} runtime={runtime} contextMessages={messages} quote={quote} onClearQuote={() => setQuote(null)} onSend={send} onCancel={() => session.cancel()} onAddMaterial={() => window.appRuntime?.importWorkspaceFiles?.()} onModelActivated={onModelActivated} onManageModels={onManageModels} /></div>
  </main>;
}
