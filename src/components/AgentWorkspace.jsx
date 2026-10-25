
import {ApprovalModeMenu} from "../ui/ApprovalModeMenu";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle, ArrowDown, ArrowLeft, ArrowUp, Check, CheckCircle2, ChevronDown, ChevronRight,
  BookOpenCheck, Copy, Download, FileSignature, FileText, Gauge, MessageSquare, Pencil, Quote,
  PanelRightClose, PanelRightOpen, Pause, Play, Plus, RotateCcw, Settings2, ShieldCheck, Sparkles, Square, X, XCircle,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AgentActivity } from "./AgentActivity";
import { AGENT_EFFORT_LEVELS, AgentEffortControl, getAgentEffortApiLevel, getStoredAgentEffort } from "./AgentEffortControl";
import { AgentMessage } from "./AgentMessage";
import { JobProgressPanel } from "./JobProgressPanel";
import { JobContextSummary, JobInputStaleNotice } from "./JobContextCard";
import { api } from "../lib/api";
import { createChatScrollFollower, isChatNearBottom, resolveChatScrollTop } from "../lib/chat-scroll";
import { useModalFocusTrap } from "../lib/modal-focus";
import { resolveAgentRuntimeState } from "../lib/runtime-state";
import { summarizeInterviewEvidence } from "../lib/interview-progress";
import { ActivityIndicator } from "../ui/ActivityIndicator";
import { AnimatedCollapse } from "../ui/AnimatedCollapse";
import { motionTokens, useAgentMotion } from "../ui/motion";

const InterviewIntelligence = lazy(() => import("./InterviewIntelligence").then((module) => ({ default: module.InterviewIntelligence })));
const InterviewRail = lazy(() => import("./InterviewIntelligence").then((module) => ({ default: module.InterviewRail })));

const EMPTY_ITEMS = Object.freeze([]);

const labels = {
  created: "准备任务", input_validating: "核对输入", jd_analyzing: "理解岗位",
  facts_matching: "匹配经历", awaiting_fact_review: "确认经历", strategy_generating: "制定简历策略",
  draft_generating: "生成改写建议", awaiting_user_review: "等待审阅", approved_changes_applying: "应用修改",
  fact_validating: "核验事实", portfolio_building: "组织作品材料", consistency_checking: "一致性检查",
  awaiting_publish_approval: "最终检查", ready_to_publish: "简历处理已完成", published: "已记录投递",
  frozen: "已记录投递", failed: "运行失败", blocked: "需要处理", cancelled: "已取消",
};

const approvalCopy = {
  workspace_write: "写入本地文件",
  workspace_move: "移动或重命名文件",
  workspace_delete: "删除本地文件",
  rollback_version_snapshot: "恢复先前版本",
};

function pendingToolApprovals(approvals = []) {
  return approvals.filter((item) => {
    if (item.status !== "pending") return false;
    const request = item.decision_payload?.items?.[0] || {};
    return Boolean(
      request.tool_name
      || request.operation_id
      || item.action_type?.startsWith("workspace_")
      || item.action_type?.startsWith("permission:")
      || item.action_type?.startsWith("mcp_write:")
      || item.action_type === "rollback_version_snapshot"
    );
  });
}

function approvalDetails(approval) {
  const request = approval.decision_payload?.items?.[0] || {};
  const argumentsValue = request.arguments || {};
  const pathCopy = argumentsValue.path || [argumentsValue.source_path, argumentsValue.destination_path].filter(Boolean).join(" → ");
  const isMcp = approval.action_type?.startsWith("mcp_write:") || request.source === "mcp";
  const permissionCopy = request.tool_name === "search_web" ? "搜索公开网页"
    : request.tool_name === "read_web_page" ? "读取公开网页"
      : request.tool_name === "open_browser_page" ? "打开受控浏览器"
        : request.tool_name === "read_browser_page" ? "读取受控浏览器"
          : isMcp ? "MCP 外部写入" : "本地文件操作";
  const safeArguments = Object.entries(argumentsValue).slice(0, 4).map(([key, raw]) => {
    const hidden = /secret|password|token|api.?key/i.test(key);
    const value = hidden ? "••••••" : typeof raw === "string" ? raw : JSON.stringify(raw);
    return `${key}: ${String(value).slice(0, 100)}`;
  }).join(" · ");
  return {
    request,
    title: approvalCopy[approval.action_type] || permissionCopy,
    summary: pathCopy || safeArguments || request.tool_name || approval.target_id,
    operationCopy: request.operation_id ? `操作 ${request.operation_id.slice(-8)}` : "",
  };
}

const conversationScrollPositions = new Map();
const workspaceTabs = new Map();

function InterviewLoading({ compact = false }) {
  return <div className={compact ? "interview-rail-loading" : "interview-workspace-loading"} aria-live="polite"><ActivityIndicator active priority={5} label="正在载入面试情报" /><span>正在载入面试情报…</span></div>;
}

function proposalEvidenceReview(item, factsById) {
  const contract = item.claim_contract || {};
  const claims = Array.isArray(contract.claims) ? contract.claims : [];
  const issues = Array.isArray(contract.issues) ? contract.issues : [];
  const stale = claims.some((claim) => (claim.evidence || []).some((ref) => {
    const current = factsById.get(ref.fact_id);
    return !current || !current.verified || current.version !== ref.fact_version || current.candidate_id !== ref.candidate_id;
  }));
  const needsEvidence = item.section !== "no_change" && (contract.needs_evidence !== false || !claims.length
    || claims.some((claim) => claim.verification_status !== "verified" || !claim.evidence?.length) || stale);
  const followups = [...new Set([
    ...(Array.isArray(contract.followups) ? contract.followups : []),
    ...issues.map((issue) => issue.details?.follow_up).filter(Boolean),
    ...(stale ? ["事实已修订、未确认或当前不可见，请重新读取当前版本并审阅支持原句。"] : []),
    ...(needsEvidence && !issues.length && !stale ? ["请补充并确认能完整支持这条陈述的本人事实，再重新准备改写审阅。"] : []),
  ])];
  return { claims, issues, needsEvidence, followups };
}

function proposalEvidenceTodoCount(proposals, factsById) {
  return proposals.filter(item => item.approval_status !== "rejected" && proposalEvidenceReview(item, factsById).needsEvidence).length;
}

function ProposalEvidence({ review, factsById }) {
  return <div className="proposal-fact-source" aria-label="逐条个人事实证据">
    <small>{review.needsEvidence ? "待补证 · 当前不能直接采用" : "个人事实已核验 · 采用前仍会复验"}</small>
    {review.claims.map((claim, claimIndex) => <div key={claimIndex}>
      <p><strong>陈述 {claimIndex + 1}</strong> · {claim.verification_status === "verified" ? "已核验" : "待补证"}<br />{claim.text}</p>
      <p>动作：{claim.action || "待补充"} · 对象：{claim.object || "待补充"} · 指标：{claim.metrics?.join("、") || "无"} · 状态：{claim.status || "无"}</p>
      {(claim.evidence || []).map((ref, refIndex) => {
        const current = factsById.get(ref.fact_id);
        return <p key={`${ref.fact_id}-${refIndex}`}><strong>支持原句 · {ref.fact_id} · v{ref.fact_version}</strong>{current?.version !== ref.fact_version && `（当前 ${current ? `v${current.version}` : "版本不可见"}）`}<br />{ref.source_quote || "支持原句缺失"}</p>;
      })}
    </div>)}
    {review.issues.map((issue, index) => <p key={`${issue.code}-${index}`}>{issue.message}</p>)}
    {review.followups.map((followup, index) => <p key={index}><strong>追问 / 补证：</strong>{followup}</p>)}
  </div>;
}

function proposalReviewError(error) {
  const code = error?.payload?.code || error?.code;
  if (code === "approval_revision_conflict") return "这轮审阅已在其他窗口更新。请重新载入最新建议后再处理；当前输入尚未覆盖其他窗口的决定。";
  if (code === "approval_target_changed") return "当前简历正文已变更。请重新载入并核对最新建议后再应用。";
  if (code === "approval_already_decided") return "这轮审阅已在其他窗口完成，请重新载入岗位最新状态。";
  if (code === "proposal_rewrite_request_changed") return "这次重写已完成或取消，请重新载入最新建议后继续。";
  if (code === "proposal_rewrite_pending") return "选中条目正在重写，请等待完成，或取消重写并保留原建议。";
  return error?.message || "操作未完成，请重试。";
}

function isProposalReviewConflict(error) {
  return ["approval_revision_conflict", "approval_target_changed", "approval_already_decided", "proposal_rewrite_request_changed"].includes(error?.payload?.code || error?.code);
}

function ProposalPanel({ detail, busy, taskBusy, onSubmit, onRewrite, onCancelRewrite, onResumeRewrite, onReload, closeGuardRef }) {
  const runKey = detail.run?.id || detail.job.id;
  const incomingApproval = detail.approvals?.find((item) => item.action_type === "apply_resume_changes" && item.status === "pending");
  const persistedDraft = incomingApproval?.decision_payload?.draft || {};
  const [approval, setApproval] = useState(incomingApproval);
  const [decisions, setDecisions] = useState(() => persistedDraft.decisions || {});
  const [draftRevision, setDraftRevision] = useState(() => Number(persistedDraft.revision || 0));
  const [draftState, setDraftState] = useState("saved");
  const [proposals, setProposals] = useState(detail.proposals || []);
  const [selectedIds, setSelectedIds] = useState([]);
  const [instruction, setInstruction] = useState("");
  const [working, setWorking] = useState("");
  const [actionError, setActionError] = useState("");
  const draftSession = useRef({
    approvalId: incomingApproval?.id, runKey, revision: Number(persistedDraft.revision || 0),
    targetHash: incomingApproval?.decision_payload?.target_content_hash || "",
    decisions: persistedDraft.decisions || {}, saved: JSON.stringify(persistedDraft.decisions || {}), conflict: false,
  });
  const saveQueue = useRef(Promise.resolve());
  const saveTimer = useRef(null);
  const saving = useRef(false);
  const actionLock = useRef(false);
  const mounted = useRef(true);
  const rewriteRequest = approval?.decision_payload?.rework_request;
  const rewritePending = rewriteRequest?.status === "pending";
  const factsById = useMemo(() => new Map((detail.facts || []).map((item) => [item.id, item])), [detail.facts]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; window.clearTimeout(saveTimer.current); };
  }, []);
  const restoreDraft = useCallback((nextApproval, nextProposals) => {
    const draft = nextApproval?.decision_payload?.draft || {};
    const nextDecisions = draft.decisions || {};
    draftSession.current = {
      approvalId: nextApproval?.id, runKey, revision: Number(draft.revision || 0),
      targetHash: nextApproval?.decision_payload?.target_content_hash || "",
      decisions: nextDecisions, saved: JSON.stringify(nextDecisions), conflict: false,
    };
    window.clearTimeout(saveTimer.current);
    setApproval(nextApproval);
    setProposals(nextProposals || []);
    setDecisions(nextDecisions);
    setDraftRevision(Number(draft.revision || 0));
    setDraftState("saved");
    setSelectedIds([]);
    setInstruction("");
    setActionError("");
  }, [runKey]);
  // Polling and other windows may advance the same approval without changing its id.
  // Our own saves advance the local revision first, so a repeated read never
  // replaces edits typed while that save was in flight.
  useEffect(() => {
    let active = true;
    const reconcile = () => {
      if (!active) return;
      const session = draftSession.current;
      if (incomingApproval?.id !== session.approvalId || session.runKey !== runKey) {
        restoreDraft(incomingApproval, detail.proposals);
        return;
      }
      const incomingRevision = Number(incomingApproval?.decision_payload?.draft?.revision || 0);
      if (incomingRevision < session.revision) return;
      const targetChanged = (incomingApproval?.decision_payload?.target_content_hash || "") !== session.targetHash;
      if (incomingRevision === session.revision && !targetChanged) {
        setProposals(detail.proposals || []);
        return;
      }
      if (JSON.stringify(session.decisions) !== session.saved) {
        session.conflict = true;
        setDraftState("conflict");
        setActionError("这轮建议已有更新。当前输入仍保留在本窗口，请重新载入最新审阅后继续。");
        return;
      }
      restoreDraft(incomingApproval, detail.proposals);
    };
    // A read can observe our committed save before its response arrives.
    if (saving.current) void saveQueue.current.then(reconcile);
    else reconcile();
    return () => { active = false; };
  }, [incomingApproval, detail.proposals, runKey, restoreDraft]);
  const reviewContext = useCallback(() => {
    const session = draftSession.current;
    return { run_id: session.runKey, job_id: detail.job.id, approval_id: session.approvalId,
      expected_revision: session.revision, expected_target_content_hash: session.targetHash };
  }, [detail.job.id]);
  const flushDraft = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    const session = draftSession.current;
    const nextSave = saveQueue.current.then(async () => {
      if (draftSession.current !== session || session.conflict) throw new Error("请重新载入最新审阅后再提交。");
      const serialized = JSON.stringify(session.decisions);
      if (!session.approvalId || serialized === session.saved) return;
      saving.current = true;
      if (mounted.current) setDraftState("saving");
      try {
        const saved = await api.saveApprovalDraft(session.runKey, session.approvalId, {
          base_revision: session.revision, decisions: JSON.parse(serialized), edited_by: "local_user",
        });
        if (draftSession.current !== session) throw new Error("审阅内容已更新，请核对最新建议。");
        session.revision = Number(saved?.decision_payload?.draft?.revision ?? session.revision + 1);
        session.saved = serialized;
        if (mounted.current) {
          setDraftRevision(session.revision);
          setDraftState(session.conflict ? "conflict" : JSON.stringify(session.decisions) === serialized ? "saved" : "saving");
        }
      } catch (error) {
        if (isProposalReviewConflict(error)) session.conflict = true;
        if (mounted.current && draftSession.current === session) {
          setDraftState(session.conflict ? "conflict" : "error");
          setActionError(proposalReviewError(error));
        }
        throw error;
      } finally { saving.current = false; }
    });
    saveQueue.current = nextSave.catch(() => {});
    return nextSave;
  }, []);
  useEffect(() => {
    if (rewritePending || draftSession.current.conflict || JSON.stringify(decisions) === draftSession.current.saved) return undefined;
    saveTimer.current = window.setTimeout(() => { void flushDraft().catch(() => {}); }, 500);
    return () => window.clearTimeout(saveTimer.current);
  }, [decisions, rewritePending, flushDraft]);
  useEffect(() => {
    closeGuardRef.current = async () => {
      if (actionLock.current) return false;
      actionLock.current = true;
      setWorking("close");
      try { await flushDraft(); return true; } catch { return false; }
      finally { actionLock.current = false; if (mounted.current) setWorking(""); }
    };
    return () => { closeGuardRef.current = null; };
  }, [closeGuardRef, flushDraft]);
  const locked = busy || Boolean(working) || taskBusy || rewritePending || draftState === "conflict" || !approval;
  const decide = (id, decision, edited_after) => {
    if (locked || actionLock.current) return;
    const nextDecisions = { ...draftSession.current.decisions, [id]: { decision, edited_after } };
    draftSession.current.decisions = nextDecisions;
    setDecisions(nextDecisions);
    setDraftState("saving");
    setActionError("");
  };
  const perform = async (kind, operation, { save = true } = {}) => {
    if (actionLock.current || busy) return;
    actionLock.current = true;
    window.clearTimeout(saveTimer.current);
    setWorking(kind);
    setActionError("");
    try {
      if (save) await flushDraft();
      await operation(reviewContext());
    } catch (error) {
      if (isProposalReviewConflict(error)) {
        draftSession.current.conflict = true;
        setDraftState("conflict");
      }
      if (mounted.current) setActionError(proposalReviewError(error));
    } finally {
      actionLock.current = false;
      if (mounted.current) setWorking("");
    }
  };
  const reload = () => perform("reload", async () => {
    // Await any request already sent before replacing the local draft.
    await saveQueue.current;
    const fresh = await onReload();
    const nextApproval = fresh.approvals?.find(item => item.action_type === "apply_resume_changes" && item.status === "pending");
    restoreDraft(nextApproval, fresh.proposals);
  }, { save: false });
  const requestRewrite = () => perform("rewrite", async (context) => {
    await onRewrite(selectedIds, instruction.trim(), context);
    setSelectedIds([]);
    setInstruction("");
  });
  const cancelRewrite = () => perform("cancel", (context) => onCancelRewrite(rewriteRequest.request_id, context), { save: false });
  const resumeRewrite = () => perform("resume", onResumeRewrite, { save: false });
  const submit = () => perform("submit", (context) => onSubmit(draftSession.current.decisions, context));
  const complete = proposals.length > 0 && proposals.every((item) => decisions[item.id]
    && !(decisions[item.id].decision === "accepted" && proposalEvidenceReview(item, factsById).needsEvidence));
  const decidedCount = proposals.filter((item) => decisions[item.id]).length;
  return <section className="proposal-panel" aria-busy={Boolean(working)}>
    <header><small>简历改写</small><h3>逐条确认，不覆盖原始资料</h3><p>教育背景与身份信息已原样保留；选择保留原文会沿用原句。需要模型修改时，请单独选中条目并填写修改意见。</p><span role="status" className={`proposal-draft-state ${draftState}`}>{draftState === "saving" ? "正在保存审批草稿…" : draftState === "conflict" ? "审阅版本已更新，请重新载入" : draftState === "error" ? "草稿保存失败，当前修改尚未持久化" : `审批草稿已保存 · v${draftRevision}`}</span></header>
    {actionError && <p role="alert" className="inline-error">{actionError}</p>}
    {(draftState === "conflict" || draftState === "error") && <button type="button" disabled={busy || Boolean(working)} onClick={reload}>重新载入最新审阅</button>}
    {rewritePending && <section className="workflow-evidence-help" role="status"><p>{taskBusy ? `正在重写选中的 ${rewriteRequest.proposal_ids?.length || 0} 条建议。` : "重写请求已保留，任务暂未运行。可继续本次重写，或取消并保留原建议。"}完成后需重新审阅这些条目，其余决定会保留。</p><p>修改意见：{rewriteRequest.instruction}</p><div>{!taskBusy && <button type="button" disabled={busy || Boolean(working) || draftState === "conflict"} onClick={resumeRewrite}>{working === "resume" ? "正在继续重写…" : "继续本次重写"}</button>}<button type="button" disabled={busy || Boolean(working) || draftState === "conflict"} onClick={cancelRewrite}>{working === "cancel" ? "正在取消重写…" : "取消重写，保留原建议"}</button></div></section>}
    {rewriteRequest?.status === "completed" && <p role="status">选中条目已重写，请重新审阅后再应用；其余条目的决定已保留。</p>}
    <div className="proposal-list">{proposals.map((item) => {
      const review = proposalEvidenceReview(item, factsById);
      const edited = decisions[item.id]?.decision === "edited_accepted";
      return <article key={item.id} className={`${decisions[item.id]?.decision ? "decided" : ""} ${item.section === "no_change" ? "no-change" : ""}`}>
      <div className="proposal-reason"><span>{item.section === "no_change" ? "无需改写" : item.section}</span><p>{item.reason}</p></div>
      <label><input type="checkbox" disabled={locked} checked={selectedIds.includes(item.id)} onChange={(event) => setSelectedIds(value => event.target.checked ? [...value, item.id] : value.filter(id => id !== item.id))} /> 选择重写此条</label>
      {item.job_relevance?.analysis_status === "stale" && <p className="proposal-relevance-stale" role="status">岗位相关性已过期：这条建议依据旧 JD 或旧语境。采用前请按当前岗位重新复核；个人事实仍按原证据核验。</p>}
      <div className="proposal-compare"><div><small>原文</small><p>{item.before}</p></div><div><small>{item.section === "no_change" ? "判断" : "岗位化表达"}</small><p>{item.after}</p></div></div>
      {!!item.jd_evidence?.[0] && item.section !== "no_change" && <div className="proposal-evidence"><small>对应 JD</small><p>{item.jd_evidence[0]}</p></div>}
      {item.section !== "no_change" && <ProposalEvidence review={review} factsById={factsById} />}
      {edited && <><textarea autoFocus disabled={locked} value={decisions[item.id].edited_after ?? item.after} onChange={(event) => decide(item.id, "edited_accepted", event.target.value)} /><p role="status">人工编辑内容尚未核验；提交时将按同一事实合同重新校验，缺少支持会保留为待补证。</p></>}
      <footer><button type="button" disabled={locked} className={decisions[item.id]?.decision === "rejected" ? "active" : ""} onClick={() => decide(item.id, "rejected")}>保留原文</button><button type="button" disabled={locked} onClick={() => decide(item.id, "edited_accepted", item.after)}>编辑后采用</button><button type="button" disabled={locked || review.needsEvidence} title={review.needsEvidence ? "请先补齐证据并重新准备审阅" : "提交时将复验当前事实版本"} className={decisions[item.id]?.decision === "accepted" ? "active accent" : "accent"} onClick={() => decide(item.id, "accepted")}>采用建议</button></footer>
    </article>;
    })}</div>
    {!rewritePending && <section className="workflow-evidence-help" style={{ marginTop: 16 }} aria-label="重写选中条目"><label htmlFor={`proposal-rewrite-${approval?.id || "review"}`}>修改意见 · 已选 {selectedIds.length} 条</label><textarea id={`proposal-rewrite-${approval?.id || "review"}`} rows={3} maxLength={8000} disabled={locked} style={{ display: "block", width: "100%", margin: "8px 0", resize: "vertical" }} value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="例如：突出协作过程，保留原有指标，缩短到两句话。" /><button type="button" disabled={locked || !selectedIds.length || !instruction.trim()} onClick={requestRewrite}>{working === "rewrite" ? "正在提交重写…" : "仅重写选中条目"}</button><p>重写完成前无法应用本轮修改；未选中的建议和审批决定会保留。</p></section>}
    <button type="button" className="panel-submit" disabled={!complete || locked || selectedIds.length > 0} title={selectedIds.length ? "请先完成选中条目的重写，或取消勾选后应用当前建议" : undefined} onClick={submit}>{busy || working === "submit" ? <ActivityIndicator active priority={10} label="正在处理已确认操作" /> : <Check size={14} />}{rewritePending ? "重写完成后继续审阅" : complete ? "应用已确认修改" : `已处理 ${decidedCount}/${proposals.length}`}</button>
  </section>;
}

function EvidenceFollowUp({ busy, onAddMaterial, onRestart }) {
  return <section className="workflow-evidence-help" aria-label="补证下一步"><p>待补证建议需要本人事实的完整支持。先补充材料并确认事实，再重新规划；本轮也可以逐条选择保留原文。JD 与他人面经不能作为个人经历的证明。</p><div><button type="button" disabled={busy} onClick={onAddMaterial}>补充本人材料</button><button type="button" disabled={busy} onClick={onRestart}>补充事实后重新选择经历</button></div></section>;
}

function ProposalReviewOverlay({ detail, busy, onClose, onSubmit, onRewrite, onCancelRewrite, onResumeRewrite, onReload, needsEvidenceCount, onAddMaterial, onRestart, replanningBusy }) {
  const { transition, enter, exit } = useAgentMotion();
  const dialog = useRef(null);
  const closeGuardRef = useRef(null);
  useModalFocusTrap(dialog);
  const closeReview = useCallback(async () => {
    if (busy) return;
    if (!closeGuardRef.current || await closeGuardRef.current()) onClose();
  }, [busy, onClose]);
  useEffect(() => {
    const close = (event) => { if (event.key === "Escape") void closeReview(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [closeReview]);
  return <motion.section ref={dialog} role="dialog" aria-modal="true" aria-label="简历改写审阅" tabIndex={-1} className="workspace-review-overlay" initial={enter()} animate={{ opacity: 1, y: 0 }} exit={{ ...exit(), transition: transition("exit") }} transition={transition("enter")}>
    <header><div><small>简历改写审阅</small><strong>确认模型建议后再应用到当前版本</strong></div><button disabled={busy} onClick={closeReview} aria-label="关闭改写审阅"><X size={15} /></button></header>
    <div className="workspace-review-scroll">{needsEvidenceCount > 0 && <EvidenceFollowUp busy={busy || replanningBusy} onAddMaterial={onAddMaterial} onRestart={onRestart} />}<ProposalPanel detail={detail} busy={busy} taskBusy={replanningBusy} onSubmit={onSubmit} onRewrite={onRewrite} onCancelRewrite={onCancelRewrite} onResumeRewrite={onResumeRewrite} onReload={onReload} closeGuardRef={closeGuardRef} /></div>
  </motion.section>;
}

function WorkflowOverlay({ title, busy, onClose, children }) {
  const { transition, enter, exit } = useAgentMotion();
  const dialog = useRef(null);
  useModalFocusTrap(dialog);
  useEffect(() => {
    const close = event => event.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [busy, onClose]);
  return <motion.section ref={dialog} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className="workspace-review-overlay workflow-overlay" initial={enter()} animate={{ opacity: 1, y: 0 }} exit={{ ...exit(), transition: transition("exit") }} transition={transition("enter")}>
    <header><div><small>岗位准备</small><strong>{title}</strong></div><button type="button" onClick={onClose} aria-label={`关闭${title}`}><X size={15} /></button></header>
    <div className="workspace-review-scroll"><div className="workflow-overlay-content">{children}</div></div>
  </motion.section>;
}

function hasUsableResumeSnapshot(snapshot) {
  return Boolean(
    snapshot
    && typeof snapshot === "object"
    && snapshot.profile
    && typeof snapshot.profile === "object"
    && Array.isArray(snapshot.sections)
  );
}

function ResumeEditorOverlay({ resume, onClose, onSave, onPdfSaved }) {
  const { transition } = useAgentMotion();
  const frame = useRef(null);
  const latest = useRef(resume.content_json?.editor_snapshot || {});
  const saveTimer = useRef(null);
  const editorReady = useRef(false);
  const [status, setStatus] = useState("正在载入原编辑器…");
  const editorSrc = `./resume-editor/index.html?embedded=1&resumeId=${encodeURIComponent(resume.id)}&apiBase=${encodeURIComponent(window.appRuntime?.apiBase || "http://127.0.0.1:8766")}&apiToken=${encodeURIComponent(window.appRuntime?.apiToken || "")}`;
  const loadSnapshot = useCallback(async () => {
    if (!hasUsableResumeSnapshot(latest.current)) {
      try {
        const fresh = await api.getResume(resume.id);
        const snapshot = fresh?.content_json?.editor_snapshot;
        if (hasUsableResumeSnapshot(snapshot)) latest.current = snapshot;
      } catch { /* editor bootstrap remains the fallback */ }
    }
    if (!hasUsableResumeSnapshot(latest.current)) {
      setStatus("当前简历数据尚未就绪");
      return;
    }
    const editorWindow = frame.current?.contentWindow;
    editorWindow?.postMessage({ type: "fetchcv:load-snapshot", snapshot: latest.current }, "*");
    try { editorWindow?.fetchCVBridge?.loadSnapshot(latest.current); } catch { /* file:// frames use opaque origins */ }
    setStatus("正在同步当前简历版本…");
  }, [resume.id]);
  const exportPdf = () => {
    setStatus("正在生成正式 PDF…");
    clearTimeout(saveTimer.current);
    void (async () => {
      try {
        await onSave(latest.current);
        const result = await window.appRuntime?.renderResumePdf?.(resume.id);
        if (!result?.ok) throw new Error(result?.message || "PDF 生成失败");
        setStatus("正式 PDF 已保存，与当前预览一致");
        await onPdfSaved?.();
      } catch (error) { setStatus(error.message || "PDF 生成失败"); }
    })();
  };
  useEffect(() => {
    let bridgeAttempts = 0;
    const bridgeTimer = window.setInterval(() => {
      if (editorReady.current) {
        window.clearInterval(bridgeTimer);
        return;
      }
      bridgeAttempts += 1;
      loadSnapshot();
      if (bridgeAttempts >= 40) {
        window.clearInterval(bridgeTimer);
      }
    }, 250);
    const receive = (event) => {
      if (event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === "fetchcv:request-verified-pdf" && event.data.resumeId === resume.id) {
        clearTimeout(saveTimer.current);
        const editorWindow = event.source;
        const requestId = event.data.requestId;
        setStatus("正在核验当前正文并生成 PDF…");
        void (async () => {
          try {
            if (!window.appRuntime?.renderResumePdf) throw new Error("桌面 PDF 渲染器不可用，请返回 FetchCV 重试");
            const result = await window.appRuntime.renderResumePdf(resume.id, event.data.resumeHash);
            if (!result?.ok) throw new Error(result?.message || "PDF 事实核验失败");
            editorWindow.postMessage({ type: "fetchcv:verified-pdf-result", requestId, ...result }, "*");
          } catch (error) {
            setStatus(error.message || "PDF 生成失败");
            editorWindow.postMessage({ type: "fetchcv:verified-pdf-result", requestId, ok: false, message: error.message || "PDF 生成失败" }, "*");
          }
        })();
      }
      if (event.data?.type === "fetchcv:editor-ready") {
        editorReady.current = true;
        window.clearInterval(bridgeTimer);
        loadSnapshot();
      }
      if (event.data?.type === "fetchcv:editor-change") {
        if (!editorReady.current || !hasUsableResumeSnapshot(event.data.snapshot)) return;
        latest.current = event.data.snapshot;
        setStatus("正在保存…");
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(async () => {
          try { await onSave(event.data.snapshot); setStatus("已自动保存 · 正文修改需重新核验后导出"); }
          catch (error) { setStatus(error.message || "正文保存失败，请重试"); }
        }, 700);
      }
      if (event.data?.type === "fetchcv:snapshot-applied") {
        editorReady.current = true;
        setStatus(`已载入 ${event.data.profileName || "当前简历"}`);
      }
      if (event.data?.type === "fetchcv:editor-error") {
        setStatus(event.data.message || "简历编辑器载入失败");
      }
      if (event.data?.type === "fetchcv:pdf-saved") {
        setStatus("正式 PDF 已保存，与当前预览一致");
        onPdfSaved?.();
      }
      if (event.data?.type === "fetchcv:pdf-error") setStatus(event.data.message || "PDF 生成失败");
    };
    window.addEventListener("message", receive);
    return () => { window.clearInterval(bridgeTimer); window.removeEventListener("message", receive); clearTimeout(saveTimer.current); };
  }, [loadSnapshot, onPdfSaved, onSave, resume.id]);
  const close = async () => { clearTimeout(saveTimer.current); await onSave(latest.current); onClose(); };
  return <motion.div className="resume-editor-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: transition("exit") }} transition={transition("enter")}>
    <header><div><button onClick={close}><ArrowLeft size={15} />返回 FetchCV</button><span /><strong>{resume.name}</strong><small>{status}</small></div><div><button onClick={exportPdf}><Download size={14} />导出 PDF</button><button aria-label="关闭编辑器" onClick={close}><X size={15} /></button></div></header>
    <iframe ref={frame} title="FetchCV 简历编辑器" src={editorSrc} onLoad={loadSnapshot} />
  </motion.div>;
}

function CanonicalResumePreview({ pdfUrl, frameRef, onReady }) {
  const pdfSrc = pdfUrl ? `${pdfUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH` : "";
  if (!pdfSrc) {
    return <div className="canonical-preview-empty"><FileText size={22} /><strong>正式 PDF 尚未生成</strong><p>完成编辑后生成 PDF，这里只展示最终导出文件。</p></div>;
  }
  return <iframe ref={frameRef} className="canonical-resume-frame source-pdf-frame" title="FetchCV 正式 PDF 预览" src={pdfSrc} onLoad={() => onReady?.(true)} />;
}

function ResumeStudio({ detail, onSaveResumeEditor, onResumePdfSaved }) {
  const jobResume = detail.resumes?.[0];
  const resume = jobResume || detail.base_resumes?.[0];
  const isBaseResume = Boolean(resume && !jobResume);
  const [editing, setEditing] = useState(false);
  const [previewReady, setPreviewReady] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const previewFrame = useRef(null);
  const autoRenderKey = useRef("");
  const editorPdfVersion = Number(resume?.content_json?.pdf_renderer_version || 0);
  const staleEditorPdf = resume?.content_json?.pdf_renderer === "resume-editor-prototype" && editorPdfVersion < 2;
  const pdfSaved = useCallback(async () => { setExporting(false); await onResumePdfSaved?.(); }, [onResumePdfSaved]);
  const saveSnapshot = useCallback((snapshotValue) => onSaveResumeEditor(resume?.id, snapshotValue), [onSaveResumeEditor, resume?.id]);
  const handlePreviewReady = useCallback((ready, message) => {
    setPreviewReady(ready);
    if (message) { setPreviewError(message); setExporting(false); }
  }, []);
  useEffect(() => {
    const needsRender = !resume?.pdf_path || staleEditorPdf;
    const renderKey = `${resume?.id || ""}:${editorPdfVersion}`;
    if (!resume?.id || !needsRender || autoRenderKey.current === renderKey) return;
    if (!window.appRuntime?.renderResumePdf) return;
    autoRenderKey.current = renderKey;
    setExporting(true);
    setPreviewError("");
    void (async () => {
      try {
        const result = await window.appRuntime.renderResumePdf(resume.id);
        if (!result?.ok) throw new Error(result?.message || "正式 PDF 生成失败");
        setExporting(false);
        await onResumePdfSaved?.();
      } catch (error) {
        autoRenderKey.current = "";
        setExporting(false);
        setPreviewError(error.message || "正式 PDF 生成失败");
      }
    })();
  }, [editorPdfVersion, onResumePdfSaved, resume?.id, resume?.pdf_path, staleEditorPdf]);
  if (!resume) return <div className="resume-empty"><FileText size={22} /><h3>还没有可预览的简历</h3><p>先在个人资料库导入基础简历；岗位版生成后会自动替换为本次定制版本。</p></div>;
  const pdfVersion = encodeURIComponent(resume.updated_at || resume.content_hash || "current");
  const pdfUrl = resume.pdf_path && !staleEditorPdf ? api.assetUrl(`/api/resumes/${resume.id}/pdf?v=${pdfVersion}`) : "";
  const docxUrl = api.assetUrl(`/api/resumes/${resume.id}/docx?v=${pdfVersion}`);
  const exportPdf = () => {
    if (resume.content_json?.source_pdf_fidelity && !resume.content_json?.pdf_renderer && pdfUrl) {
      window.open(pdfUrl, "_blank", "noopener,noreferrer");
      return;
    }
    setExporting(true); setPreviewError("");
    void (async () => {
      try {
        const result = await window.appRuntime?.renderResumePdf?.(resume.id);
        if (!result?.ok) throw new Error(result?.message || "PDF 生成失败");
        await pdfSaved();
      } catch (error) { setExporting(false); setPreviewError(error.message || "PDF 生成失败"); }
    })();
  };
  const hasCanonicalPdf = Boolean(pdfUrl);
  return <div className="resume-studio-v2">
    <div className="resume-toolbar-v2"><div><i />{isBaseResume ? "基础简历预览" : hasCanonicalPdf ? "岗位版 PDF 预览" : "等待岗位版 PDF"}<small>{isBaseResume ? "岗位版尚未生成；这里明确展示资料库原简历，不代表 Agent 已完成优化" : hasCanonicalPdf ? "这里只展示已生成的岗位版最终文件" : "编辑完成后生成岗位版 PDF"}</small></div><div>{hasCanonicalPdf && <a href={pdfUrl} target="_blank" rel="noreferrer"><FileText size={14} />打开已保存 PDF</a>}<a href={docxUrl} target="_blank" rel="noreferrer" title={isBaseResume ? "当前导出的是资料库基础简历" : "单栏可编辑岗位版本"}><FileSignature size={14} />{isBaseResume ? "基础 Word" : "岗位版 Word"}</a><button onClick={() => setEditing(true)}><Pencil size={14} />{isBaseResume ? "编辑基础简历" : "编辑内容与排版"}</button><button className="accent" disabled={!previewReady || exporting} onClick={exportPdf}>{exporting ? <ActivityIndicator active priority={10} label="正在生成 PDF" /> : <Download size={14} />}{exporting ? "正在生成" : isBaseResume ? "导出基础 PDF" : "导出岗位版 PDF"}</button></div></div>
    {resume.content_json?.verification_status !== "verified" && <div className="canonical-preview-error" role="status"><ShieldCheck size={14} />未核验草稿：正文或事实版本需重新核验后才能导出。人工编辑不会自动成为已确认事实。</div>}
    {resume.job_relevance?.analysis_status === "stale" && <div className="canonical-preview-error" role="status">岗位相关性已过期：这是依据旧 JD 或旧语境保存的简历，请按当前岗位重新复核。个人事实的核验状态单独保留。</div>}
    {previewError && <div className="canonical-preview-error"><AlertCircle size={14} />{previewError}</div>}
    <div className="canonical-resume-preview"><CanonicalResumePreview pdfUrl={pdfUrl} frameRef={previewFrame} onReady={handlePreviewReady} /></div>
    <AnimatePresence>{editing && <ResumeEditorOverlay resume={resume} onClose={() => setEditing(false)} onSave={saveSnapshot} onPdfSaved={onResumePdfSaved} />}</AnimatePresence>
  </div>;
}

function ToolApprovalInterrupt({ approvals, busy, onDecision }) {
  const { transition, enter, exit } = useAgentMotion();
  const pending = pendingToolApprovals(approvals);
  return <AnimatePresence>{pending.length > 0 && <motion.section
    key="pending-approval"
    className="tool-approval-interrupt"
    aria-label="需要确认的关键操作"
    initial={enter()}
    animate={{ opacity: 1, y: 0 }}
    exit={{ ...exit(), transition: transition("exit") }}
    transition={transition("enter")}
  >
    <header><span><ShieldCheck size={16} /></span><div><small>AGENT PAUSED</small><strong>继续前需要你的确认</strong><p>Agent 已暂停在实际执行之前。请核对目标和作用范围；拒绝不会影响已经完成的只读工作。</p></div></header>
    <div className="pending-approval-list">{pending.map((approval) => {
      const { request, title, summary, operationCopy } = approvalDetails(approval);
      return <article key={approval.id}>
        <div><strong>{title}</strong><small>{summary}</small></div>
        <p>{[request.tool_name, request.permission, operationCopy, request.recoverable === false ? "不可自动恢复" : ""].filter(Boolean).join(" · ") || "只授权这一次具体操作；其他操作仍需确认。"}</p>
        <footer><button type="button" disabled={busy} onClick={() => onDecision?.(approval.id, "rejected")}>拒绝</button><button type="button" className="approve" disabled={busy} onClick={() => onDecision?.(approval.id, "approved")}>允许此操作</button></footer>
      </article>;
    })}</div>
  </motion.section>}</AnimatePresence>;
}

export function Composer({ busy, streaming, stopping = false, finishing = false, queued, runtime, agentReady = true, startupMessage, quote, onClearQuote, onSend, onCancel, onAddMaterial, onModelActivated, onManageModels, placeholder = "与 FetchCV 协作" }) {
  const { reducedMotion, transition, enter, exit } = useAgentMotion();
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [profiles, setProfiles] = useState([]);
  const [agentEffort, setAgentEffort] = useState(getStoredAgentEffort);
  const [modelBusy, setModelBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState(null);
  const [modelError, setModelError] = useState("");
  const input = useRef(null);
  const controls = useRef(null);
  useLayoutEffect(() => {
    const composer = controls.current;
    const workspace = composer?.closest("main");
    if (!composer || !workspace) return undefined;
    // Keep the floating surface clear of messages as attachments or text grow.
    const measure = () => workspace.style.setProperty("--conversation-composer-height", `${composer.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(composer);
    return () => { observer.disconnect(); workspace.style.removeProperty("--conversation-composer-height"); };
  }, []);
  useLayoutEffect(() => {
    if (!input.current) return;
    input.current.style.height = "0px";
    input.current.style.height = `${Math.min(input.current.scrollHeight, 126)}px`;
  }, [value]);
  useEffect(() => {
    window.appRuntime?.listModelProviders?.().then((store) => setProfiles(store?.profiles || [])).catch(() => {});
  }, [runtime?.model]);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { if (quote) input.current?.focus(); }, [quote]);
  useEffect(() => {
    if (!settingsOpen) return undefined;
    const close = (event) => {
      if (event.key === "Escape" || (event.type === "pointerdown" && !controls.current?.contains(event.target))) {
        setSettingsOpen(false);
        setSettingsSection(null);
      }
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", close); };
  }, [settingsOpen]);
  const activeProfile = profiles.find((profile) => profile.id === runtime?.provider_id)
    || profiles.find((profile) => profile.providerName === runtime?.provider_name && profile.model === runtime?.model)
    || profiles.find((profile) => profile.model === runtime?.model)
    || null;
  const activeProfileId = activeProfile?.id || "";
  const selectModel = async (profile, model) => {
    if (!agentReady || !profile?.id || !model || !window.appRuntime?.activateModelProvider) return;
    if (profile.id === activeProfileId && model === runtime?.model) { setSettingsSection(null); return; }
    setModelBusy(true);
    setModelError("");
    try {
      const result = await window.appRuntime.activateModelProvider(profile.id, model);
      setProfiles(result.store?.profiles || profiles.map((item) => item.id === profile.id ? { ...item, model } : item));
      onModelActivated?.(result.runtime);
      setSettingsSection(null);
    } catch (error) { setModelError(error.message || "模型切换失败"); } finally { setModelBusy(false); }
  };
  const thinkingLevel = getAgentEffortApiLevel(agentEffort);
  const submit = async () => {
    if (!agentReady || (!value.trim() && !attachments.length) || streaming) return;
    const content = value.trim() || "请读取并处理这些附件。";
    const attachmentPaths = attachments.map((item) => item.workspacePath);
    const submittedQuote = quote;
    setValue(""); setAttachments([]); onClearQuote?.();
    if (input.current) input.current.style.height = "";
    await onSend(content, { thinkingLevel, attachmentPaths, quote: submittedQuote });
  };
  const update = (event) => setValue(event.target.value);
  const handlePaste = (event) => {
    // Electron normally forwards Cmd/Ctrl+V through the native window hook.
    // Keep a DOM fallback for browser preview and sandboxed iframe contexts.
    if (event.clipboardData?.getData("text/plain")) return;
    if (!window.appRuntime?.readClipboardText) return;
    event.preventDefault();
    window.appRuntime.readClipboardText().then((text) => {
      if (!text) return;
      const start = input.current?.selectionStart ?? value.length;
      const end = input.current?.selectionEnd ?? start;
      setValue((current) => `${current.slice(0, start)}${text}${current.slice(end)}`);
    }).catch(() => {});
  };
  const currentEffort = AGENT_EFFORT_LEVELS.find((item) => item.id === agentEffort) || AGENT_EFFORT_LEVELS[1];
  const currentModel = modelBusy ? "正在切换" : activeProfile?.displayName || runtime?.model || activeProfile?.model || "选择模型";
  const openSettings = () => {
    setSettingsOpen((value) => {
      const next = !value;
      setSettingsSection(null);
      return next;
    });
  };
  const addAttachments = async () => {
    if (!agentReady || attachmentBusy) return;
    setAttachmentBusy(true);
    try {
      const files = await onAddMaterial?.();
      if (files?.length) setAttachments((current) => [...new Map([...current, ...files].map((item) => [item.workspacePath, item])).values()]);
    } catch (error) { setModelError(error.message || "文件导入失败"); } finally { setAttachmentBusy(false); }
  };
  return <section ref={controls} className={`agent-composer-v2 source-composer rp-composer-wrap ${busy ? "working" : ""}`} data-replica-part="composer">
    <div className="rp-composer"><div className="source-composer-editor rp-editor">
    {quote && <div className="composer-quote"><span><Quote size={13} /></span><p><strong>引用 Agent</strong><small>{quote.text}</small></p><button type="button" aria-label="移除引用" onClick={onClearQuote}><X size={13} /></button></div>}
    {!!attachments.length && <div className="composer-attachments">{attachments.map((file) => <span key={file.workspacePath}><FileText size={13} /><b>{file.name}</b><button type="button" aria-label={`移除 ${file.name}`} onClick={() => setAttachments((current) => current.filter((item) => item.workspacePath !== file.workspacePath))}><X size={12} /></button></span>)}</div>}
    <textarea ref={input} value={value} onChange={update} onPaste={handlePaste} aria-keyshortcuts="Enter Shift+Enter" onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.isComposing) return;
      if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        submit();
      }
    }} aria-label="消息" placeholder={queued ? "补充当前任务…" : placeholder} />
    {!agentReady && <div role="status" className="composer-error">{startupMessage || "本地 Agent 正在准备，已有资料可浏览；就绪后即可发送。"}</div>}
    {modelError && <div className="composer-error"><AlertCircle size={12} />{modelError}</div>}
    </div>
    <div className="rp-controls"><div className="rp-controls-start"><button type="button" className="composer-add" aria-label="上传内容" title="上传内容" disabled={!agentReady || attachmentBusy} onClick={addAttachments}>{attachmentBusy ? <ActivityIndicator active priority={10} label="正在导入附件" /> : <Plus size={18}/>}</button><ApprovalModeMenu disabled={!agentReady||busy||streaming}/></div>
    <div className="rp-controls-end">
        <div className="composer-control-wrap composer-model-wrap">
        <button type="button" className="composer-control-button model-effort-trigger" aria-label="选择模型和推理强度" disabled={!agentReady} aria-haspopup="dialog" aria-expanded={settingsOpen} onClick={openSettings}>
          <i className={runtime?.configured ? "online" : ""} />
          <span className="composer-trigger-copy"><strong>{currentModel}</strong><small>{currentEffort.label}</small></span>
          {modelBusy ? <ActivityIndicator active priority={10} label="正在切换模型" /> : <ChevronDown size={12} />}
        </button>
        <AnimatePresence>{settingsOpen && <motion.div role="dialog" aria-label="模型与推理设置" className="composer-popover model-effort-popover" data-view={settingsSection === "model" ? "models" : "effort"} initial={enter()} animate={{ opacity: 1, y: 0 }} exit={{ ...exit(), transition: transition("exit") }} transition={transition("enter")}>
          {settingsSection !== "model" && <AgentEffortControl disabled={busy} value={agentEffort} onChange={setAgentEffort} model={currentModel} onModelMenu={() => {setSettingsSection("model");setModelError("");}} />}
          {settingsSection === "model" && <button type="button" className="model-list-back" aria-label="收起模型选择" onClick={() => setSettingsSection(null)}><ChevronDown size={16}/>选择模型</button>}
          {settingsSection === "model" && <div className="model-choice-list">{profiles.map((profile) => {
            const models = profile.availableModels?.length ? profile.availableModels : [{ id: profile.model }];
            const uniqueModels = [...new Map(models.filter((item) => item?.id).map((item) => [item.id, item])).values()];
            return <section key={profile.id}><div className="model-choice-provider"><span className={`provider-status-dot ${profile.health}`} />{profile.providerName}<small>{uniqueModels.length > 1 ? `${uniqueModels.length} 个` : ""}</small></div>{uniqueModels.map((item) => {
              const active = profile.id === activeProfileId && item.id === runtime?.model;
              return <button type="button" role="menuitemradio" aria-checked={active} key={`${profile.id}-${item.id}`} onClick={() => selectModel(profile, item.id)}><span><strong>{item.id===profile.model && profile.displayName || item.id}</strong>{item.ownedBy && <small>{item.ownedBy}</small>}</span>{active && <Check size={13} />}</button>;
            })}</section>;
          })}{!profiles.length && <p className="model-menu-empty">还没有已保存的模型连接</p>}<button type="button" className="manage-models-button" onClick={() => { setSettingsOpen(false); setSettingsSection(null); onManageModels?.(); }}><Settings2 size={13} />管理模型连接</button></div>}
          {!!modelError && <p className="settings-error"><AlertCircle size={12} />{modelError}</p>}
        </motion.div>}</AnimatePresence>
        </div>
        <button className={`composer-send ${streaming ? "stop" : ""}`} disabled={!agentReady || stopping || finishing || (!streaming && !value.trim() && !attachments.length)} onClick={streaming ? onCancel : submit} aria-label={stopping ? "正在停止生成" : finishing ? "正在结束本轮" : streaming ? "停止生成" : queued ? "补充当前任务" : "发送消息"}><span className="composer-action-icon"><AnimatePresence initial={false}><motion.span key={streaming ? "stop" : "send"} initial={{ opacity: 0, scale: reducedMotion ? 1 : motionTokens.pressScale }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: reducedMotion ? 1 : motionTokens.pressScale }} transition={transition("micro")}>{streaming ? <Square size={11} fill="currentColor" /> : <ArrowUp size={18} strokeWidth={2.1} />}</motion.span></AnimatePresence></span></button>    </div></div></div>
  </section>;
}

function ExperienceSelector({ detail, busy, onSubmit }) {
  const experiences = detail.experiences || [];
  const approval = detail.approvals.find((item) => item.action_type === "confirm_relevant_facts" && item.status === "pending");
  const ranked = approval?.decision_payload?.items || [];
  const factsByExperience = useMemo(() => detail.facts.reduce((map, fact) => { const id = fact.normalized_value?.experience_id || fact.subject_id; if (id) (map[id] ||= []).push(fact); return map; }, {}), [detail.facts]);
  const idsFor = (experience) => experience.fact_ids?.length ? experience.fact_ids : (factsByExperience[experience.id] || []).map((fact) => fact.id);
  const fixed = experiences.filter((item) => item.kind === "education");
  const adjustable = experiences.filter((item) => item.kind !== "education");
  const recommended = new Set(ranked.filter((item) => item.recommended).map((item) => item.fact_id));
  const initial = adjustable.filter((item) => idsFor(item).some((id) => recommended.has(id))).map((item) => item.id);
  const [selected, setSelected] = useState(() => new Set(initial.length ? initial : adjustable.slice(0, 3).map((item) => item.id)));
  const submit = () => onSubmit([...fixed, ...adjustable.filter((item) => selected.has(item.id))].flatMap(idsFor));
  return <div className="rail-selector">
    <header><small>本次简历</small><strong>选择要重点表达的经历</strong><p>教育与基础信息固定保留；这里只决定哪些实习、项目和技能参与岗位化表达。</p></header>
    {!!fixed.length && <section><div className="rail-selector-title"><span>固定保留</span><small>{fixed.length}</small></div>{fixed.map((item) => <article className="fixed" key={item.id}><span><Check size={11} /></span><div><strong>{item.organization || item.title}</strong><small>{[item.start_date, item.end_date].filter(Boolean).join(" – ")}</small></div></article>)}</section>}
    <section><div className="rail-selector-title"><span>岗位相关经历</span><small>{selected.size}/{adjustable.length}</small></div>{adjustable.map((item) => { const active = selected.has(item.id); const suggested = idsFor(item).some((id) => recommended.has(id)); return <button key={item.id} className={`rail-experience-choice ${active ? "active" : ""}`} onClick={() => setSelected((current) => { const next = new Set(current); active ? next.delete(item.id) : next.add(item.id); return next; })}><span>{active && <Check size={11} />}</span><div><strong>{item.organization || item.title}</strong><small>{item.role || item.kind}</small></div>{suggested && <em>建议</em>}</button>; })}</section>
    <button className="rail-confirm" disabled={busy || !approval} onClick={submit}>{busy ? <ActivityIndicator active priority={10} label="正在处理已确认操作" /> : <Check size={14} />}确认并生成策略</button>
  </div>;
}

function RunEvidence({ evaluation }) {
  const [expanded, setExpanded] = useState(false);
  if (!evaluation?.checks?.length) return null;
  const priority = ["warning", "pending", "passed"];
  const sorted = [...evaluation.checks]
    .sort((left, right) => priority.indexOf(left.status) - priority.indexOf(right.status));
  const renderChecks = items => items.map((item) => <div key={item.code} className={item.status} title={(item.evidence || []).join("\n")}>
    {item.status === "passed" ? <Check size={11} /> : <AlertCircle size={11} />}
    <span>{item.label}</span><small>{item.status === "passed" ? "已核验" : item.status === "warning" ? "需处理" : "进行中"}</small>
  </div>);
  return <section className="rail-evidence">
    <div className="rail-evidence-head"><small>运行证据</small><span>{evaluation.passed}/{evaluation.total} 已核验</span></div>
    <div className="rail-evidence-list">{renderChecks(sorted.slice(0, 4))}</div>
    <AnimatedCollapse open={expanded}><div className="rail-evidence-list">{renderChecks(sorted.slice(4))}</div></AnimatedCollapse>
    {sorted.length > 4 && <button type="button" className="rail-evidence-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "收起证据" : `查看全部 ${sorted.length} 项`}<ChevronDown size={12} /></button>}
  </section>;
}

function ContextInventory({ detail }) {
  const verifiedFacts = detail.facts.filter((item) => item.verified).length;
  const items = [
    { label: "岗位 JD", value: detail.job.jd_raw ? "已载入" : "未提供", ready: Boolean(detail.job.jd_raw) },
    { label: "基础简历", value: `${detail.base_resumes?.length || 0} 份`, ready: Boolean(detail.base_resumes?.length) },
    { label: "补充材料", value: `${detail.materials?.length || 0} 项`, ready: true },
    { label: "已验证事实", value: `${verifiedFacts} 条`, ready: verifiedFacts > 0 },
  ];
  return <section className="rail-context-inventory">
    <small>本轮依据</small>
    <div>{items.map((item) => <p key={item.label} className={item.ready ? "ready" : ""}><span><i />{item.label}</span><b>{item.value}</b></p>)}</div>
  </section>;
}

function AtsReadiness({ value, onImprove, onOpenResume }) {
  const { transition, enter, exit } = useAgentMotion();
  const [expanded, setExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  if (!value) return null;
  if (value.status === "not_ready") {
    return <section className="rail-ats-readiness pending"><div className="rail-ats-head"><span><Gauge size={13} />岗位要求覆盖</span><small>等待岗位版</small></div><p>{value.summary}</p></section>;
  }
  const allRequirements = value.requirements || [];
  const selected = allRequirements.find((item) => item.requirement_id === selectedId);
  const statusCopy = { supported: "有证据", partial: "部分支持", unsupported: "缺少证据" };
  const renderRequirements = items => items.map((item) => {
    const supportStatus = item.support_status || (item.matched ? "supported" : item.evidence ? "partial" : "unsupported");
    const active = selectedId === item.requirement_id;
    return <button type="button" key={item.requirement_id || item.text} data-requirement-id={item.requirement_id || undefined} className={`${supportStatus} ${active ? "active" : ""}`} aria-pressed={active} onClick={() => setSelectedId((current) => current === item.requirement_id ? null : item.requirement_id)}><i /><span><strong title={item.text}>{item.text}</strong><small>{item.evidence?.length ? `简历证据：${item.evidence.join("、")}` : "当前简历没有可定位证据"}</small></span><b>{active ? "收起" : statusCopy[supportStatus]}</b></button>;
  });
  return <section className={`rail-ats-readiness ${value.status}`}>
    <div className="rail-ats-head"><span><Gauge size={13} />岗位要求覆盖</span><small>{value.requirements?.length || 0} 项要求</small></div>
    {!!allRequirements.length && <div className="rail-requirement-matrix">{renderRequirements(allRequirements.slice(0, 4))}</div>}
    <AnimatedCollapse open={expanded}><div className="rail-requirement-matrix">{renderRequirements(allRequirements.slice(4))}</div></AnimatedCollapse>
    <AnimatePresence initial={false} mode="wait">{selected && <motion.div key={selected.requirement_id} className="rail-requirement-inspector" initial={enter(motionTokens.distanceSubtle)} animate={{ opacity: 1, y: 0 }} exit={{ ...exit(), transition: transition("exit") }} transition={transition("enter")}>
      <header><div><small>EVIDENCE</small><strong>为什么这样判断</strong></div><button type="button" aria-label="关闭证据定位" onClick={() => setSelectedId(null)}><X size={13} /></button></header>
      <div className="requirement-jd-source"><span>JD 原文</span>{selected.jd_context ? <blockquote>{selected.jd_context.before && <>{selected.jd_context.before} </>}<mark>{selected.jd_context.match}</mark>{selected.jd_context.after && <> {selected.jd_context.after}</>}</blockquote> : <p>当前岗位要求来自结构化分析，但在原始 JD 中没有找到可稳定定位的连续原文。</p>}</div>
      <div className="requirement-resume-sources"><span>简历落点</span>{selected.resume_evidence?.length ? selected.resume_evidence.map((source) => <article key={`${source.section_id}:${source.item_id}`}><div><strong>{source.section_label} · {source.item_label}</strong><small>{source.matched_terms.join(" · ")}</small></div><p>{source.snippet}</p></article>) : <p>当前岗位版简历中没有找到能直接支撑这项要求的文本。Agent 可以改善表达，但不能补造经历。</p>}</div>
      {!!selected.resume_evidence?.length && <button type="button" className="open-evidence-resume" onClick={onOpenResume}>打开简历核对上下文</button>}
    </motion.div>}</AnimatePresence>
    {allRequirements.length > 4 && <button type="button" className="rail-requirement-toggle" onClick={() => setExpanded((current) => !current)}>{expanded ? "收起其他要求" : `查看其余 ${allRequirements.length - 4} 项要求`}</button>}
    {!!value.document_checks?.length && <div className="rail-document-checks">{value.document_checks.map((item) => <span key={item.code} className={item.passed ? "passed" : ""}>{item.passed ? <Check size={10} /> : <X size={10} />}{item.label}</span>)}</div>}
    {!!value.gaps?.length && <div className="rail-ats-gaps">{value.gaps.slice(0, 3).map((item) => <span key={item}>{item}</span>)}</div>}
    {!!value.gaps?.length && <button type="button" onClick={onImprove}>让 Agent 基于事实补强缺口</button>}
    <small className="rail-ats-disclaimer">只检查当前 JD 的证据覆盖，不预测招聘系统通过率。</small>
  </section>;
}

function CoverLetterReview({ material, onClose }) {
  const { transition, enter, exit } = useAgentMotion();
  const [copied, setCopied] = useState(false);
  const dialog = useRef(null);
  useModalFocusTrap(dialog);
  const content = material?.metadata_json?.content || "";
  const copy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  return <motion.div className="cover-letter-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: transition("exit") }} transition={transition("enter")} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <motion.section ref={dialog} tabIndex={-1} className="cover-letter-review" role="dialog" aria-modal="true" aria-labelledby="cover-letter-title" initial={enter()} animate={{ opacity: 1, y: 0 }} exit={{ ...exit(), transition: transition("exit") }} transition={transition("enter")}>
      <header><div><small>APPLICATION LETTER</small><h2 id="cover-letter-title">{material.name}</h2><p>由当前 JD 与已确认事实生成；复制前请完成最终人工审阅。</p></div><button type="button" onClick={onClose} aria-label="关闭求职信"><X size={15} /></button></header>
      <article>{content.split(/\n{2,}/).filter(Boolean).map((paragraph, index) => index === 0 ? <h3 key={index}>{paragraph}</h3> : <p key={index}>{paragraph}</p>)}</article>
      <footer><span>{material.metadata_json?.source_fact_ids?.length || 0} 条事实 · {material.metadata_json?.jd_evidence?.length || 0} 条 JD 证据</span><button type="button" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "已复制" : "复制全文"}</button></footer>
    </motion.section>
  </motion.div>;
}

function ApplicationCollateral({ detail, busy, onGenerate, onOpen }) {
  const coverLetters = (detail.materials || []).filter((item) => item.kind === "cover_letter" && item.metadata_json?.job_id === detail.job.id);
  const latest = coverLetters[0];
  const canGenerate = Boolean(detail.resumes?.length || detail.base_resumes?.length);
  return <section className="rail-application-assets">
    <div className="rail-application-head"><span><FileSignature size={13} />投递材料</span><small>{coverLetters.length ? `${coverLetters.length} 个版本` : "未生成求职信"}</small></div>
    {latest ? <button type="button" className="rail-cover-letter" onClick={() => onOpen(latest)}><div><strong>{latest.name}</strong><small>{latest.status === "draft" ? "Agent 草稿 · 待人工审阅" : latest.status}</small></div><ChevronRight size={13} /></button> : <p>简历完成后，Agent 可以基于同一证据链起草求职信。</p>}
    <button type="button" className="rail-generate-letter" disabled={busy || !canGenerate} onClick={onGenerate} title={canGenerate ? "由 Agent 基于事实与 JD 起草" : "请先导入基础简历"}>{latest ? "重新生成一版" : "让 Agent 起草求职信"}</button>
  </section>;
}

function checkpointCopy(task) {
  const savedAt = task?.result_json?.checkpoint?.saved_at;
  if (!savedAt) return task?.status === "queued" ? "等待 Agent 接管" : "正在建立可恢复检查点";
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(savedAt)) / 1000));
  return seconds < 8 ? "检查点刚刚保存" : `检查点 ${seconds}s 前保存`;
}

function StandardRail({ detail, runtime, runtimeState, busy, task, cancellingTask = false, onStart, onRestart, onOpenResume, onOpenInterview, onOpenReview, onPublishApproval, onFinalize, onRetry, onPauseTask, onResumeTask, onCancelTask, onResolveInvocation, onOpenModelSettings, onImproveAts, onGenerateCoverLetter, onOpenCoverLetter }) {
  const run = detail.run;
  const profile = detail.profile;
  const stage = run?.current_stage;
  const unknownInvocation = (detail.tool_invocations || []).find((item) => item.status === "outcome_unknown");
  const canRun = runtime?.configured || runtime?.allow_mock_runtime;
  let action = null;
  if (!run && canRun) action = <section className="rail-next-action"><small>下一步</small><div><Sparkles size={15} /><strong>让 Agent 理解岗位</strong><p>读取 JD 并形成岗位重点与经历匹配。</p><button disabled={busy || !detail.job.jd_raw} onClick={onStart}>理解岗位</button></div></section>;
  if (!run && !canRun) action = <section className="rail-next-action"><small>开始之前</small><div><Settings2 size={15} /><strong>连接一个模型</strong><p>岗位理解和简历改写必须由你选择的模型完成。</p><button disabled={busy} onClick={onOpenModelSettings}>连接模型</button></div></section>;
  if (stage === "awaiting_user_review") action = <section className="rail-next-action"><small>需要确认</small><div><Pencil size={15} /><strong>审阅 {detail.proposals.length} 条改写建议</strong><p>建议不会自动覆盖基础简历。若岗位理解或经历组合不对，可以保留本轮并重新规划。</p><button onClick={onOpenReview}>打开改写审阅</button><button className="secondary" disabled={busy} onClick={onRestart}>重新选择经历</button></div></section>;
  if (stage === "awaiting_publish_approval") action = <section className="rail-next-action"><small>下一步</small><div><ShieldCheck size={15} /><strong>事实检查已通过</strong><p>确认后进入简历编辑和导出；也可以保留当前草稿后重新规划。</p><button disabled={busy} onClick={onPublishApproval}>进入导出检查</button><button className="secondary" disabled={busy} onClick={onRestart}>重新规划新版本</button></div></section>;
  if (["ready_to_publish", "published", "frozen"].includes(stage)) action = <section className="rail-next-action ready"><small>{stage === "ready_to_publish" ? "可用操作" : "投递记录"}</small><div><CheckCircle2 size={15} /><strong>{stage === "ready_to_publish" ? "草稿已保存，导出前复验" : "已保存本次投递快照"}</strong><p>当前版本会保留；完成简历后可以继续调研真实面经。</p><button onClick={onOpenResume}>打开简历</button><button className="secondary" onClick={onOpenInterview}><BookOpenCheck size={13} />准备面试</button><button className="secondary" disabled={busy} onClick={onRestart}>重新规划新版本</button>{stage === "ready_to_publish" && <button className="secondary" onClick={onFinalize}>记录为已投递</button>}</div></section>;
  if (["failed", "blocked"].includes(stage)) action = <section className="rail-next-action error"><small>需要处理</small><div><AlertCircle size={15} /><strong>{labels[stage]}</strong><p>{(() => { try { return JSON.parse(run.error || "{}").message; } catch { return run.error || "本轮运行中断"; } })()}</p><button disabled={busy} onClick={onRetry}><RotateCcw size={13} />从中断处重试</button></div></section>;
  if (stage === "cancelled") action = <section className="rail-next-action error"><small>本轮已结束</small><div><XCircle size={15} /><strong>任务已取消</strong><p>取消是终态，不会继续复用旧任务。你可以保留现有材料，基于同一岗位创建一轮新规划。</p><button disabled={busy} onClick={onRestart}><RotateCcw size={13} />创建新一轮任务</button></div></section>;
  if (unknownInvocation) {
    const target = unknownInvocation.arguments_summary?.path || unknownInvocation.arguments_summary?.resume_id || unknownInvocation.arguments_summary?.target_id || "外部目标";
    const source = unknownInvocation.tool_name?.startsWith("mcp_") ? "MCP 工具" : unknownInvocation.tool_name === "read_skill" ? "Skill" : "FetchCV 内置工具";
    const occurredAt = unknownInvocation.updated_at || unknownInvocation.created_at;
    action = <section className="rail-next-action error invocation-unknown"><small>需要人工核对</small><div><AlertCircle size={15} /><strong>操作结果尚不确定</strong><p>应用在收到最终回执前中断。为避免重复写入，Agent 已停止自动重试。</p><dl><div><dt>操作</dt><dd>{unknownInvocation.tool_name}</dd></div><div><dt>来源</dt><dd>{source}</dd></div><div><dt>目标</dt><dd>{String(target)}</dd></div><div><dt>发生时间</dt><dd>{occurredAt ? new Date(occurredAt).toLocaleString() : "未记录"}</dd></div><div><dt>最后状态</dt><dd>请求可能已经发出，未保存完成回执</dd></div></dl><small>请先打开目标文件或系统记录核对：选择“已成功”会登记完成；选择“没有执行”才允许后续重试；不确定时保持停止最安全。</small><code>{unknownInvocation.operation_id}</code><button disabled={busy} onClick={() => onResolveInvocation(unknownInvocation.operation_id, "completed")}>已核对：操作成功</button><button className="secondary" disabled={busy} onClick={() => onResolveInvocation(unknownInvocation.operation_id, "not_executed")}>已核对：没有执行</button><button className="secondary" disabled={busy} onClick={() => onResolveInvocation(unknownInvocation.operation_id, "keep_stopped")}>尚不确定，保持停止</button></div></section>;
  }
  const taskRunning = ["queued", "running"].includes(task?.status);
  const visibleState = runtimeState?.active || runtimeState?.attention
    ? runtimeState
    : { label: run ? labels[stage] || run.status : "等待开始", detail: run ? `${detail.steps.filter((item) => item.event_type === "stage" || item.event_type === "tool").length} 条真实执行记录` : "提供 JD 后开始" };
  return <div className="standard-rail"><section className="rail-runtime"><small>当前状态</small><div className={`rail-state ${runtimeState?.id || "idle"}`}><span>{runtimeState?.active ? <ActivityIndicator active priority={10} label={visibleState.label} /> : <Sparkles size={14} />}</span><div><strong>{visibleState.label}</strong><p>{taskRunning && runtimeState?.id === "running" ? checkpointCopy(task) : visibleState.detail}</p></div></div>{task && <div className="task-controls">{taskRunning && <button aria-label="暂停当前 Agent 任务" disabled={cancellingTask} onClick={onPauseTask} title="暂停任务"><Pause size={13} />暂停</button>}{task?.status === "paused" && !["awaiting_fact_review", "awaiting_user_review", "awaiting_publish_approval"].includes(stage) && <button aria-label="从最近检查点恢复任务" onClick={onResumeTask} title="恢复任务"><Play size={13} />恢复</button>}{taskRunning && <button aria-label={cancellingTask ? "正在请求取消" : "取消当前 Agent 任务"} className="danger" disabled={cancellingTask} onClick={onCancelTask} title="取消任务"><XCircle size={13} />{cancellingTask ? "正在请求取消" : "取消"}</button>}</div>}{taskRunning && runtime?.model && <div className="task-runtime-snapshot"><ShieldCheck size={13} /><span><small>本任务已锁定</small><strong>{runtime.provider_name || "当前连接"} · {runtime.model}</strong></span></div>}</section>{action}<AtsReadiness value={detail.ats_readiness} onImprove={onImproveAts} onOpenResume={onOpenResume} /><ApplicationCollateral detail={detail} busy={busy} onGenerate={onGenerateCoverLetter} onOpen={onOpenCoverLetter} /><ContextInventory detail={detail} /><RunEvidence evaluation={detail.run_evaluation} />{profile && <section><small>岗位重点</small><strong className="rail-heading">{profile.competencies?.slice(0, 3).join(" · ") || "等待形成岗位重点"}</strong><div className="rail-tags">{(profile.keywords || []).slice(0, 7).map((item) => <span key={item}>{item}</span>)}</div></section>}</div>;
}

export function AgentWorkspace({ requestedTab, detail, runtime, agentReady = true, startupMessage, busy, error, activity, task, onStart, onRestart, onFactReview, onReview, onRewriteProposals, onCancelProposalRewrite, onResumeProposalRewrite, onReloadReview, onPublishApproval, onRetry, onPauseTask, onResumeTask, onCancelTask, onResolveInvocation, onFinalize, onSendMessage, onResearchInterviews, onCancelMessage, onAddMaterial, onApprovalDecision, onModelActivated, onOpenModelSettings, onSaveResumeEditor, onResumePdfSaved, onEditJob }) {
  const { reducedMotion, transition, enter, exit } = useAgentMotion();
  const [tab, setTab] = useState(() => workspaceTabs.get(detail.job.id) || "conversation");
  const [pendingPrompt, setPendingPrompt] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [workflowOverlay, setWorkflowOverlay] = useState(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [quotedReply, setQuotedReply] = useState(null);
  const [coverLetterOpen, setCoverLetterOpen] = useState(null);
  const [cancelRequest, setCancelRequest] = useState(null);
  const cancelRequestRef = useRef(null);
  useEffect(() => {
    cancelRequestRef.current = null;
    setCancelRequest(null);
    return () => { cancelRequestRef.current = null; };
  }, [detail.job.id, task?.id]);
  const requestTaskCancellation = async () => {
    if (!task?.id || !onCancelTask || cancelRequestRef.current) return;
    const request = { jobId: detail.job.id, taskId: task.id };
    cancelRequestRef.current = request;
    setCancelRequest(request);
    try {
      return await onCancelTask();
    } catch {
      // The action owner reports errors; only the temporary view state lives here.
      return null;
    } finally {
      if (cancelRequestRef.current === request) {
        cancelRequestRef.current = null;
        setCancelRequest(null);
      }
    }
  };
  const [railCollapsed, setRailCollapsed] = useState(() => window.localStorage.getItem("fetchcv.context-rail-collapsed") !== "0");
  const [railWidth, setRailWidth] = useState(() => {
    const stored = Number(window.localStorage.getItem("fetchcv.context-rail-width"));
    return Number.isFinite(stored) && stored >= 268 && stored <= 420 ? stored : 306;
  });
  const conversationScroll = useRef(null);
  const conversationStream = useRef(null);
  const userIsNearBottom = useRef(true);
  const scrollFollower = useRef(null);
  const touchPosition = useRef(null);
  useEffect(() => {
    if (reducedMotion && userIsNearBottom.current) scrollFollower.current?.follow({ immediate: true });
  }, [reducedMotion]);
  const run = detail.run;
  useLayoutEffect(() => {
    const grid = document.querySelector(".app-grid");
    if (!grid) return undefined;
    grid.style.setProperty("--context-rail-width", railCollapsed ? "0px" : `${railWidth}px`);
    return () => grid.style.removeProperty("--context-rail-width");
  }, [railCollapsed, railWidth]);
  useEffect(() => {
    window.localStorage.setItem("fetchcv.context-rail-collapsed", railCollapsed ? "1" : "0");
    window.localStorage.setItem("fetchcv.context-rail-width", String(railWidth));
  }, [railCollapsed, railWidth]);
  const beginRailResize = (event) => {
    if (railCollapsed || event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = railWidth;
    document.body.classList.add("resizing-context-rail");
    const move = (moveEvent) => setRailWidth(Math.max(268, Math.min(420, startWidth + startX - moveEvent.clientX)));
    const stop = () => {
      document.body.classList.remove("resizing-context-rail");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  };
  useEffect(() => { setTab(workspaceTabs.get(detail.job.id) || "conversation"); }, [detail.job.id]);
  useEffect(() => {
    if (requestedTab?.jobId === detail.job.id && ["conversation", "resume", "interview"].includes(requestedTab.tab)) setTab(requestedTab.tab);
  }, [requestedTab, detail.job.id]);

  useEffect(() => { workspaceTabs.set(detail.job.id, tab); }, [detail.job.id, tab]);
  useEffect(() => { if (run?.current_stage !== "awaiting_user_review") setReviewOpen(false); }, [run?.current_stage]);
  useEffect(() => {
    if (workflowOverlay === "facts" && run?.current_stage !== "awaiting_fact_review") setWorkflowOverlay(null);
    if (workflowOverlay === "approval" && !pendingToolApprovals(detail.approvals).length) setWorkflowOverlay(null);
    if (workflowOverlay === "recovery" && !(detail.tool_invocations || []).some(item => item.status === "outcome_unknown")) setWorkflowOverlay(null);
  }, [run?.current_stage, workflowOverlay, detail.approvals, detail.tool_invocations]);
  const scrollToLatest = (behavior = "smooth") => {
    const follower = scrollFollower.current;
    if (!follower) return;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    userIsNearBottom.current = true;
    setShowJumpToLatest(false);
    follower.follow({ immediate: reducedMotion || behavior !== "smooth" });
  };
  useLayoutEffect(() => {
    if (tab !== "conversation") return undefined;
    const node = conversationScroll.current;
    const stream = conversationStream.current;
    if (!node || !stream) return undefined;
    const saved = conversationScrollPositions.get(detail.job.id);
    node.scrollTo({ top: resolveChatScrollTop(saved, node.scrollHeight, node.clientHeight), behavior: "instant" });
    userIsNearBottom.current = isChatNearBottom(node);
    setShowJumpToLatest(!userIsNearBottom.current);
    const follower = createChatScrollFollower(node, {
      // Scroll events can arrive a frame later than a write. Save immediately
      // so switching tabs mid-animation restores the last visible position.
      onPositionChange: (position) => conversationScrollPositions.set(detail.job.id, position),
    });
    scrollFollower.current = follower;
    const followGrowth = () => {
      if (!userIsNearBottom.current) return;
      follower.follow({ immediate: Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) });
    };
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(followGrowth) : null;
    observer?.observe(node);
    observer?.observe(stream);
    return () => {
      observer?.disconnect();
      follower.stop();
      // A tab switch can detach the scroller before cleanup, at which point
      // Chromium reports zero. Keep the position captured by onScroll instead.
      if (node.isConnected) conversationScrollPositions.set(detail.job.id, node.scrollTop);
      if (scrollFollower.current === follower) scrollFollower.current = null;
      touchPosition.current = null;
    };
  }, [detail.job.id, tab]);
  const handleConversationScroll = () => {
    const node = conversationScroll.current;
    if (!node) return;
    conversationScrollPositions.set(detail.job.id, node.scrollTop);
    if (scrollFollower.current?.isRunning) {
      if (isChatNearBottom(node)) setShowJumpToLatest(false);
      return;
    }
    // Once interrupted, do not pull the reader back while still within the
    // normal 96px following threshold; resume only when they reach the bottom.
    userIsNearBottom.current = isChatNearBottom(node, userIsNearBottom.current ? 96 : 2);
    setShowJumpToLatest(!userIsNearBottom.current);
  };
  const stopAutoFollowing = (movingDown = false) => {
    scrollFollower.current?.stop();
    userIsNearBottom.current = movingDown && isChatNearBottom(conversationScroll.current, 2);
    setShowJumpToLatest(!userIsNearBottom.current);
  };
  const handleConversationTouchMove = (event) => {
    const nextY = event.touches[0]?.clientY;
    if (touchPosition.current !== null && nextY !== undefined && nextY !== touchPosition.current) stopAutoFollowing(nextY < touchPosition.current);
    touchPosition.current = nextY ?? null;
  };
  const handleConversationKeyDown = (event) => {
    if (event.target.closest("input, textarea, select, [contenteditable='true']")) return;
    if (["ArrowUp", "PageUp", "Home"].includes(event.key) || (event.key === " " && event.shiftKey)) stopAutoFollowing();
    if (["ArrowDown", "PageDown", "End"].includes(event.key) || (event.key === " " && !event.shiftKey)) stopAutoFollowing(true);
  };
  const send = async (content, options) => {
    setPendingPrompt(content);
    scrollToLatest("smooth");
    await onSendMessage(content, options);
    setPendingPrompt("");
  };
  const messages = detail.messages || [];
  const pendingAlreadyStored = pendingPrompt && messages.slice(-2).some((message) => message.role === "user" && message.content === pendingPrompt);
  const streamingMessage = messages.find((message) => message.id === "streaming-assistant");
  const settledMessages = messages.filter((message) => message.id !== "streaming-assistant");
  const queuedMessages = (detail.queued_messages || []).filter((message) => ["queued", "processing"].includes(message.status));
  const taskRunning = ["queued", "running"].includes(task?.status);
  const cancellingTask = taskRunning && cancelRequest?.jobId === detail.job.id && cancelRequest?.taskId === task?.id;
  const displayActivity = cancellingTask ? { ...activity, stopping: true, label: "正在请求取消" } : activity;
  const runtimeState = cancellingTask
    ? { id: "stopping", label: "正在请求取消", detail: "等待任务确认取消，当前执行记录保持不变。", active: false, attention: true }
    : resolveAgentRuntimeState({ activity, task, approvals: detail.approvals, error });
  const factsById = new Map((detail.facts || []).map(item => [item.id, item]));
  const needsEvidenceCount = proposalEvidenceTodoCount(detail.proposals || [], factsById);
  const interviewProgress = summarizeInterviewEvidence(detail, { activity, busy, error });
  const evidenceSummary = {
    result: interviewProgress.summaryText,
    missing: interviewProgress.gapText,
    status: `${interviewProgress.run.label} · ${interviewProgress.evidence.label}。来源情况与个人事实核验分别检查。`,
  };
  const openReview = () => {
    if (run?.current_stage === "awaiting_user_review") setReviewOpen(true);
    else setWorkflowOverlay("evidence");
  };
  const handleProgressAction = key => {
    if (key === "start") return !taskRunning && !busy && onStart();
    if (key === "restart") return !taskRunning && !busy && onRestart();
    if (key === "facts") return setWorkflowOverlay("facts");
    if (key === "review") return openReview();
    if (["evidence", "recovery", "approval", "profile"].includes(key)) return setWorkflowOverlay(key);
    if (key === "resume") return setTab("resume");
    if (key === "interview") return setTab("interview");
    if (key === "publish") return onPublishApproval();
    if (key === "retry") return onRetry();
    if (key === "resumeTask") return onResumeTask();
    if (key === "settings") return onOpenModelSettings();
  };
  const unknownInvocation = (detail.tool_invocations || []).find(item => item.status === "outcome_unknown");
  return <>
    <main className="main-pane agent-workspace-v2">
      <header className="task-header"><div><span>{detail.job.company}</span><h1>{detail.job.role}</h1></div><nav className="workspace-tabs"><button className={tab === "conversation" ? "active" : ""} onClick={() => setTab("conversation")}><MessageSquare size={14} />对话</button><button className={tab === "resume" ? "active" : ""} onClick={() => setTab("resume")}><FileText size={14} />简历</button><button className={tab === "interview" ? "active" : ""} onClick={() => setTab("interview")}><BookOpenCheck size={14} />面试</button></nav><button type="button" className="source-icon source-context-toggle" aria-label={railCollapsed ? "展开任务上下文" : "折叠任务上下文"} onClick={() => setRailCollapsed(value => !value)}>{railCollapsed ? <PanelRightOpen size={16}/> : <PanelRightClose size={16}/>}</button><div className={`task-meta runtime-${runtimeState.id}`} title={runtimeState.detail}><i className={runtimeState.active ? "running" : ""} />{runtimeState.active || runtimeState.attention ? runtimeState.label : run ? labels[run.current_stage] || run.status : "尚未开始"}</div></header>
      <JobInputStaleNotice detail={detail} />
      {tab === "conversation" && <JobProgressPanel detail={detail} runtime={runtime} runtimeState={runtimeState} task={task} busy={busy} needsEvidenceCount={needsEvidenceCount} toolApprovalCount={pendingToolApprovals(detail.approvals).length} evidenceSummary={evidenceSummary} contextCard={<JobContextSummary job={detail.job} onEdit={onEditJob} disabled={busy} />} onAction={handleProgressAction} />}
      {tab === "resume" ? <div className="content-scroll studio-scroll"><ResumeStudio detail={detail} onSaveResumeEditor={onSaveResumeEditor} onResumePdfSaved={onResumePdfSaved} /></div> : tab === "interview" ? <Suspense fallback={<InterviewLoading />}><InterviewIntelligence detail={detail} activity={activity} busy={busy} error={error} runtime={runtime} onResearch={onResearchInterviews} onOpenConversation={() => setTab("conversation")} /></Suspense> : <>
        <div ref={conversationScroll} onScroll={handleConversationScroll} onWheel={(event) => { if (event.deltaY !== 0) stopAutoFollowing(event.deltaY > 0); }} onTouchStart={(event) => { touchPosition.current = event.touches[0]?.clientY ?? null; }} onTouchMove={handleConversationTouchMove} onTouchEnd={() => { touchPosition.current = null; }} onKeyDown={handleConversationKeyDown} onPointerDown={(event) => { if (event.target === event.currentTarget) stopAutoFollowing(); }} tabIndex={0} aria-label="Agent 对话记录" className="content-scroll conversation-scroll-v2"><div ref={conversationStream} className="conversation-stream">
          {settledMessages.map((message) => <AgentMessage key={message.id} message={message} onQuote={setQuotedReply} interviewSources={detail.interview_sources || EMPTY_ITEMS} interviewBriefs={detail.interview_briefs || EMPTY_ITEMS} />)}
          {pendingPrompt && !pendingAlreadyStored && <AgentMessage message={{ id: "pending-user", role: "user", content: pendingPrompt }} pending animate />}
          <AgentActivity activity={displayActivity} run={run} task={task} steps={detail.steps} waitingForApproval={runtimeState.id === "awaiting_approval"} />
          <ToolApprovalInterrupt approvals={detail.approvals || []} busy={busy} onDecision={onApprovalDecision} />
          {queuedMessages.map((message) => <div className="queued-message" key={message.id}><span><MessageSquare size={12} /></span><p>{message.content}</p><small>历史待处理消息 · 不会自动发送</small></div>)}
          {streamingMessage && <AgentMessage key={streamingMessage.id} message={streamingMessage} animate onQuote={setQuotedReply} interviewSources={detail.interview_sources || EMPTY_ITEMS} interviewBriefs={detail.interview_briefs || EMPTY_ITEMS} />}
          {error && <div className="inline-error"><AlertCircle size={14} />{error}</div>}
        </div></div>
        <AnimatePresence>{showJumpToLatest && <motion.button type="button" className="jump-to-latest" aria-label="返回最新消息" title="返回最新消息" onClick={() => scrollToLatest("smooth")} initial={enter()} animate={{ opacity: 1, y: 0 }} exit={{ ...exit(), transition: transition("exit") }} transition={transition("enter")}><ArrowDown size={14} /></motion.button>}</AnimatePresence>
        {detail.job.jd_raw && <Composer busy={busy} agentReady={agentReady} startupMessage={startupMessage} streaming={activity?.kind === "chat"} stopping={Boolean(activity?.stopping)} finishing={Boolean(activity?.finished)} queued={taskRunning} runtime={runtime} quote={quotedReply} onClearQuote={() => setQuotedReply(null)} onSend={send} onCancel={onCancelMessage} onAddMaterial={onAddMaterial} onModelActivated={onModelActivated} onManageModels={onOpenModelSettings} />}
      </>}
      <AnimatePresence>{reviewOpen && <ProposalReviewOverlay detail={detail} busy={busy} replanningBusy={taskRunning} needsEvidenceCount={needsEvidenceCount} onAddMaterial={onAddMaterial} onRestart={onRestart} onClose={() => setReviewOpen(false)} onRewrite={onRewriteProposals} onCancelRewrite={onCancelProposalRewrite} onResumeRewrite={onResumeProposalRewrite} onReload={onReloadReview} onSubmit={async (decisions, context) => { const result = await onReview(decisions, context); if (result) setReviewOpen(false); }} />}</AnimatePresence>
      <AnimatePresence>{workflowOverlay && <WorkflowOverlay title={{ facts: "确认本次经历", evidence: needsEvidenceCount ? "处理待补证" : "改写证据记录", approval: "审阅待授权操作", recovery: "核对未完成操作", profile: "岗位重点与原始 JD" }[workflowOverlay]} busy={busy} onClose={() => setWorkflowOverlay(null)}>
        {workflowOverlay === "evidence" && <JobInputStaleNotice detail={detail} />}
        {workflowOverlay === "facts" && <ExperienceSelector key={run?.id || detail.job.id} detail={detail} busy={busy} onSubmit={onFactReview} />}
        {workflowOverlay === "approval" && <ToolApprovalInterrupt approvals={detail.approvals || []} busy={busy} onDecision={onApprovalDecision} />}
        {workflowOverlay === "evidence" && <>{needsEvidenceCount > 0 && <EvidenceFollowUp busy={busy || taskRunning} onAddMaterial={onAddMaterial} onRestart={onRestart} />}{(detail.proposals || []).map(item => <article key={item.id} className="workflow-evidence-item"><h3>{item.section} · {item.after}</h3>{item.approval_status === "rejected" && <p>已保留原文 · 此历史建议不再作为补证待办。</p>}<ProposalEvidence review={proposalEvidenceReview(item, factsById)} factsById={factsById} /></article>)}<p>这里展示当前证据与历史决定。可采用的改写仍须进入本轮审批，完成事实复验。</p></>}
        {workflowOverlay === "recovery" && unknownInvocation && <section className="workflow-evidence-help"><p>应用在收到最终回执前中断。先核对目标文件或系统记录，再登记这次操作的实际结果。</p><dl><dt>工具</dt><dd>{unknownInvocation.tool_name}</dd><dt>目标</dt><dd>{String(unknownInvocation.arguments_summary?.path || unknownInvocation.arguments_summary?.resume_id || unknownInvocation.arguments_summary?.target_id || "请按操作记录核对")}</dd><dt>操作标识</dt><dd>{unknownInvocation.operation_id}</dd></dl><div><button disabled={busy} onClick={() => onResolveInvocation(unknownInvocation.operation_id, "completed")}>已核对：操作成功</button><button disabled={busy} onClick={() => onResolveInvocation(unknownInvocation.operation_id, "not_executed")}>已核对：没有执行</button><button disabled={busy} onClick={() => onResolveInvocation(unknownInvocation.operation_id, "keep_stopped")}>尚不确定，保持停止</button></div></section>}
        {workflowOverlay === "profile" && <section className="workflow-profile">{detail.profile?.business_context?.analysis_status === "stale" && <p role="status">以下岗位重点已过期，保留供核对历史；请按当前 JD 与语境重新分析。</p>}{[["岗位职责", detail.profile?.responsibilities], ["任职要求", detail.profile?.hard_requirements], ["能力重点", detail.profile?.competencies], ["仍待确认", detail.profile?.uncertain_items]].map(([title, items]) => items?.length ? <div key={title}><h3>{title}</h3><ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null)}<h3>当前 JD</h3><p style={{whiteSpace:"pre-wrap"}}>{detail.job.jd_raw}</p></section>}
      </WorkflowOverlay>}</AnimatePresence>
    </main>
    <aside className={`context-rail agent-rail-v2 ${railCollapsed ? "collapsed" : ""}`}>
      {!railCollapsed && <button type="button" className="context-rail-resizer" aria-label="调整任务上下文宽度" title="拖动调整宽度" onPointerDown={beginRailResize} />}
      <div className="rail-head">
        {!railCollapsed && <span>{tab === "interview" ? "面试情报" : run?.current_stage === "awaiting_fact_review" ? "经历决策" : "任务上下文"}</span>}
        <button type="button" className="context-rail-collapse" aria-label={railCollapsed ? "展开任务上下文" : "折叠任务上下文"} title={railCollapsed ? "展开任务上下文" : "折叠任务上下文"} onClick={() => setRailCollapsed((value) => !value)}>{railCollapsed ? <PanelRightOpen size={15} /> : <PanelRightClose size={15} />}</button>
      </div>
      {!railCollapsed && <motion.div className="rail-view-switch" key={tab === "interview" ? "interview" : run?.current_stage === "awaiting_fact_review" ? "facts" : "context"} initial={enter()} animate={{ opacity: 1, y: 0 }} transition={transition("enter")}>{tab === "interview"
        ? <Suspense fallback={<InterviewLoading compact />}><InterviewRail detail={detail} activity={activity} busy={busy} runtime={runtime} onResearch={onResearchInterviews} /></Suspense>
        : run?.current_stage === "awaiting_fact_review"
          ? <ExperienceSelector key={run.id} detail={detail} busy={busy} onSubmit={onFactReview} />
          : <StandardRail detail={detail} runtime={runtime} runtimeState={runtimeState} busy={busy} task={task} onStart={onStart} onRestart={onRestart} onOpenResume={() => setTab("resume")} onOpenInterview={() => setTab("interview")} onOpenReview={() => setReviewOpen(true)} onPublishApproval={onPublishApproval} onFinalize={onFinalize} onRetry={onRetry} onPauseTask={onPauseTask} onResumeTask={onResumeTask} onCancelTask={requestTaskCancellation} cancellingTask={cancellingTask} onResolveInvocation={onResolveInvocation} onOpenModelSettings={onOpenModelSettings} onImproveAts={() => void send("请读取当前 ATS 文本覆盖缺口，在不新增或夸大事实的前提下提出可审阅的简历改写建议；先说明哪些缺口可以由已有事实补强，哪些不能。", { thinkingLevel: "balanced" })} onGenerateCoverLetter={() => void send("请基于当前 JD、岗位简历和已确认事实生成一份克制、具体、非模板化的求职信草稿。必须调用 save_cover_letter_draft 保存；每段绑定支持它的 fact_id 和 JD 原文证据，不得新增任何数字、日期或经历。", { thinkingLevel: "balanced" })} onOpenCoverLetter={setCoverLetterOpen} />}</motion.div>}
    </aside>
    <AnimatePresence>{coverLetterOpen && <CoverLetterReview material={coverLetterOpen} onClose={() => setCoverLetterOpen(null)} />}</AnimatePresence>
  </>;
}
