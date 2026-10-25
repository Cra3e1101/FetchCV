import { ArrowDown, MessageSquare } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Composer } from "./AgentWorkspace";
import { AgentMessage } from "./AgentMessage";
import { JobStartPanel } from "./JobProgressPanel";
import { useAgentMotion } from "../ui/motion";
import { conversationSessions } from "../lib/conversation-sessions";
import { createChatScrollFollower, isChatNearBottom, resolveChatScrollTop } from "../lib/chat-scroll";
import "./ConversationWorkspace.css";

const scrollPositions = new Map();

export function ConversationWorkspace({ sessionKey, conversationId, jobs, runtime, agentReady = true, startupMessage, onCreated, onChanged, onModelActivated, onManageModels, onAnalyzeJob, hasProfile }) {
  const [draftKey] = useState(() => Symbol("draft"));
  const session = useMemo(() => conversationSessions.get(sessionKey || conversationId || draftKey, conversationId), [sessionKey, conversationId, draftKey]);
  const {chat, messages, busy, stopping, finishing, loading, error} = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [quote, setQuote] = useState(null);
  const [showJump, setShowJump] = useState(false);
  const scroller = useRef(null);
  const transcript = useRef(null);
  const follower = useRef(null);
  const following = useRef(true);
  const touchY = useRef(null);
  const scrollKey = useRef(conversationId || sessionKey || draftKey);
  const announced = useRef(null);
  const motionStyle = useAgentMotion();
  useEffect(() => { void session.load(); }, [session]);
  useEffect(() => {
    if (!chat?.id) return;
    scrollKey.current = chat.id;
    if (!conversationId && announced.current !== chat.id) {
      announced.current = chat.id;
      onCreated?.(chat.id);
    }
  }, [chat?.id, conversationId, onCreated]);
  useLayoutEffect(() => {
    if (loading || !scroller.current || !transcript.current) return undefined;
    const node = scroller.current;
    node.scrollTo({ top: resolveChatScrollTop(scrollPositions.get(scrollKey.current), node.scrollHeight, node.clientHeight), behavior: "instant" });
    following.current = isChatNearBottom(node);
    setShowJump(!following.current);
    const current = createChatScrollFollower(node, { onPositionChange: position => scrollPositions.set(scrollKey.current, position) });
    follower.current = current;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      if (following.current) current.follow({ immediate: window.matchMedia("(prefers-reduced-motion: reduce)").matches });
    });
    observer?.observe(node);
    observer?.observe(transcript.current);
    return () => {
      observer?.disconnect();
      current.stop();
      if (node.isConnected) scrollPositions.set(scrollKey.current, node.scrollTop);
      if (follower.current === current) follower.current = null;
    };
  }, [conversationId, loading]);
  useEffect(() => {
    if (motionStyle.reducedMotion && following.current) follower.current?.follow({ immediate: true });
  }, [motionStyle.reducedMotion]);
  const jumpToLatest = () => {
    following.current = true;
    setShowJump(false);
    follower.current?.follow({ immediate: motionStyle.reducedMotion });
  };
  const interruptScroll = (movingDown = false) => {
    follower.current?.stop();
    following.current = movingDown && isChatNearBottom(scroller.current, 2);
    setShowJump(!following.current);
  };
  const handleScroll = () => {
    const node = scroller.current;
    scrollPositions.set(scrollKey.current, node.scrollTop);
    if (follower.current?.isRunning) return;
    following.current = isChatNearBottom(node, following.current ? 96 : 2);
    setShowJump(!following.current);
  };
  const handleKeyDown = event => {
    if (event.target.closest("input, textarea, select, [contenteditable='true']")) return;
    if (["ArrowUp", "PageUp", "Home"].includes(event.key) || (event.key === " " && event.shiftKey)) interruptScroll();
    if (["ArrowDown", "PageDown", "End"].includes(event.key) || (event.key === " " && !event.shiftKey)) interruptScroll(true);
  };
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
    <div ref={scroller} className="standalone-scroll" onScroll={handleScroll} onWheel={event => { if (event.deltaY !== 0) interruptScroll(event.deltaY > 0); }} onTouchStart={event => { touchY.current = event.touches[0]?.clientY ?? null; }} onTouchMove={event => { const next = event.touches[0]?.clientY; if (next !== undefined && touchY.current !== null && next !== touchY.current) interruptScroll(next < touchY.current); touchY.current = next ?? null; }} onTouchEnd={() => { touchY.current = null; }} onKeyDown={handleKeyDown} onPointerDown={event => { if (event.target === event.currentTarget) interruptScroll(); }} tabIndex={0} aria-label="独立对话记录"><div ref={transcript} className="standalone-transcript">
      {loading ? <p role="status">正在读取对话…</p> : !messages.length && (onAnalyzeJob ? <JobStartPanel hasProfile={hasProfile} onAnalyze={onAnalyzeJob} /> : <div className="standalone-home"><MessageSquare aria-hidden="true"/><h2 className="standalone-welcome">想聊些什么？</h2></div>)}
      {messages.map(message => <AgentMessage key={message.id} message={message} pending={message.metadata_json?.delivery_status === "sending"} animate={message.metadata_json?.delivery_status === "sending" || message.id === "streaming-assistant"} onQuote={setQuote} />)}
      {error && <div role="alert" className="dialog-error">{error}</div>}
    </div></div>
    <AnimatePresence initial={false}>{showJump && <motion.button type="button" className="jump-to-latest standalone-jump" aria-label="返回最新消息" onClick={jumpToLatest} initial={motionStyle.enter()} animate={{ opacity: 1, y: 0 }} exit={{ ...motionStyle.exit(), transition: motionStyle.transition("exit") }} transition={motionStyle.transition("enter")}><ArrowDown size={14}/></motion.button>}</AnimatePresence>
    <div className="standalone-composer"><Composer placeholder={messages.length ? "与 FetchCV 协作" : "随心输入"} busy={busy || loading} streaming={busy} stopping={stopping} finishing={finishing} agentReady={agentReady && !loading} startupMessage={loading ? "正在读取对话…" : startupMessage} runtime={runtime} quote={quote} onClearQuote={() => setQuote(null)} onSend={send} onCancel={() => session.cancel()} onAddMaterial={() => window.appRuntime?.importWorkspaceFiles?.()} onModelActivated={onModelActivated} onManageModels={onManageModels} /></div>
  </main>;
}
