import { independentQuestionCount, matchingQuestionEvidence, readInterviewEvidenceAccounting } from "./interview-evidence.js";
import { findLatestInterviewResearchResult, isInterviewResearchRequest } from "./interview-research.js";

const asList = value => Array.isArray(value) ? value : [];
const successful = status => ["completed", "completed_refresh_failed", "succeeded", "success"].includes(status);
const ident = value => String(value || "").trim();
const unique = values => [...new Set(values.map(ident).filter(Boolean))];

function receiptList(value) {
  if (Array.isArray(value)) return value;
  return value && typeof value === "object" ? Object.entries(value).map(([id, row]) => ({ tool_call_id: id, ...row })) : [];
}

function currentResearchTurn(detail) {
  const messages = asList(detail.messages);
  let requestIndex = -1;
  messages.forEach((message, index) => { if (isInterviewResearchRequest(message)) requestIndex = index; });
  const request = messages[requestIndex] || null;
  const result = findLatestInterviewResearchResult(request ? messages.slice(requestIndex + 1) : messages);
  // Legacy answers need the request in order to identify their task kind.
  const legacyResult = request && !result ? findLatestInterviewResearchResult(messages.slice(requestIndex)) : null;
  const answer = result || legacyResult;
  const receipts = [
    ...receiptList(request?.metadata_json?.tool_receipts),
    ...receiptList(answer?.metadata_json?.tool_receipts),
  ];
  const endTimes = [answer?.created_at, ...messages.slice(requestIndex + 1).filter(message => message.role === "user").map(message => message.created_at)]
    .map(value => Date.parse(value || "")).filter(Number.isFinite);
  return { request, result: answer, receipts, endedAt: endTimes.length ? Math.min(...endTimes) : null };
}

function operationRecords(detail, turn) {
  const records = new Map();
  const receiptIds = new Set(turn.receipts.map(row => ident(row.tool_call_id || row.provider_call_id)).filter(Boolean));
  const start = Date.parse(turn.request?.created_at || "");
  const runId = turn.request?.run_id || turn.result?.run_id;
  const record = (row, fallback) => {
    const id = ident(row.provider_call_id || row.tool_call_id || row.idempotency_key || row.operation_id || row.id || fallback);
    const previous = records.get(id) || {};
    records.set(id, { ...previous, ...row, id,
      result: row.result ?? row.result_json ?? previous.result,
      error: row.error_json ?? row.error ?? previous.error,
    });
  };
  turn.receipts.forEach((row, index) => record(row, `receipt:${index}`));
  asList(detail.steps).forEach((step, index) => {
    const calls = asList(step.tool_calls);
    const inReceipt = calls.some(call => receiptIds.has(ident(call.provider_call_id || call.tool_call_id || call.idempotency_key)));
    const created = Date.parse(step.created_at || "");
    const inWindow = Boolean(turn.request && Number.isFinite(start) && Number.isFinite(created) && created >= start
      && (turn.endedAt === null || created <= turn.endedAt)
      && (!runId || step.run_id === runId));
    if (!inReceipt && !inWindow) return;
    calls.forEach((call, callIndex) => record({ status: step.status, error_code: step.error_code, error: step.error, ...call }, `step:${index}:${callIndex}`));
    if ((step.error_code || step.error) && !calls.length) record({ ...step, tool_name: step.stage }, `step:${index}`);
  });
  const currentCallIds = new Set([...receiptIds, ...records.keys()]);
  asList(detail.tool_invocations).forEach((row, index) => {
    if (currentCallIds.has(ident(row.provider_call_id || row.tool_call_id))) record(row, `invocation:${index}`);
  });
  return [...records.values()];
}

function resultData(record) {
  const result = record.result;
  return result && typeof result === "object" ? (result.data && typeof result.data === "object" ? result.data : result) : {};
}

function structuredSignals(record) {
  const data = resultData(record);
  const error = typeof record.error === "object" && record.error ? record.error : {};
  const details = error.details || data.details || {};
  return [record.error_code, record.code, error.code, error.error_code, error.message,
    typeof record.error === "string" ? record.error : "", details.stop_reason, details.reason,
    data.error_code, data.stop_reason, data.nowcoder_stop_reason, data.public_access_reason,
    data.browser_availability === "unavailable" || data.browser_availability === "not_configured" ? data.browser_availability : "",
  ].filter(Boolean).join(" ");
}

function summarizeReasons(records, run) {
  const reasons = new Map();
  const add = (key, label, count, detail) => {
    const previous = reasons.get(key);
    reasons.set(key, { key, label, count: count === null ? null : (previous?.count || 0) + count, detail });
  };
  records.forEach(record => {
    const data = resultData(record);
    const tool = record.tool_name || record.tool || "";
    const signals = structuredSignals(record);
    const restricted = /captcha|login|rate.?limit|cooldown|access_protection|access_denied|public_access_limit|验证码|登录|限流|访问保护/i.test(signals);
    const incomplete = /budget|runtime_unavailable|bridge_failed|browser_busy|not_configured|unavailable|预算|运行环境/i.test(signals);
    if (restricted) add("restricted", "访问受限", 1, "来源平台要求登录、验证或暂缓访问；可以先按 JD 准备，也可补充可读取的原文。");
    else if (incomplete) add("incomplete", "调研未完成", 1, "访问预算或运行环境限制中断了本轮，不能据此认定没有相关面经。");
    else if (record.status === "failed" || /request_failed|timeout|read_failed|读取失败|超时/i.test(signals)) {
      const discovery = /discover/.test(tool);
      if (discovery) add("discovery_failed", "发现失败", 1, "来源发现操作未成功，尚不能判断有无相关来源。");
      else if (/capture_interview_source|read_web_page|read_interview_source/.test(tool)) add("read_failed", "读取失败", 1, "页面读取未成功；失败操作不计入已保存正文。");
    }
    if (Number.isInteger(data.rejected_irrelevant_count) && data.rejected_irrelevant_count > 0) {
      add("irrelevant", "证据不相关", data.rejected_irrelevant_count, "这些候选因岗位相关性被排除，不作为当前岗位的面经依据。");
    }
    if (/discover_interview_sources/.test(tool) && successful(record.status) && Array.isArray(data.results)
      && data.results.length === 0 && data.discovery_exhausted === true && !restricted && !incomplete
      && !data.stop_reason && !data.nowcoder_stop_reason && !data.public_access_reason) {
      add("not_found", "未发现候选来源", 1, "本轮已完成的来源发现返回零候选；这不代表目标公司没有相关面经。");
    }
  });
  if (!reasons.size && ["ended", "failed", "paused"].includes(run.key)) {
    add("unrecorded", "原因未记录", null, "现有结构化记录不足以区分发现、读取或相关性原因。");
  }
  return [...reasons.values()];
}

function executionState(turn, { activity, busy, error }, records) {
  const researchActivity = activity?.taskKind === "interview_research";
  const metadata = turn.result?.metadata_json || turn.request?.metadata_json || {};
  const status = metadata.processing_status || metadata.delivery_status;
  if (researchActivity && activity?.stopping) return { key: "paused", label: "本轮正在停止", active: false };
  if (researchActivity && busy && !activity?.finished) return { key: "active", label: "本轮调研进行中", active: true };
  if ((researchActivity && activity?.failed) || status === "failed" || (error && turn.request && !turn.result)) return { key: "failed", label: "本轮调研失败", active: false };
  if (["paused", "cancelled", "stopped"].includes(status)) return { key: "paused", label: "本轮调研已暂停", active: false };
  if (turn.result || status === "completed") return { key: "ended", label: "本轮调研已结束", active: false };
  if (turn.request && (status === "streaming" || records.some(row => ["running", "pending"].includes(row.status)))) return { key: "active", label: "本轮调研进行中", active: true };
  if (turn.request) return { key: "paused", label: "本轮尚未结算", active: false };
  return { key: "idle", label: "尚未开始面试调研", active: false };
}

/** Presentation accounting only. The API preview is not a full-body quotation validator. */
export function summarizeInterviewEvidence(detail = {}, options = {}) {
  const sourceById = new Map();
  asList(detail.interview_sources).forEach(source => {
    if (source?.id && (!source.job_id || !detail.job?.id || source.job_id === detail.job.id)) sourceById.set(source.id, source);
  });
  const sources = [...sourceById.values()];
  const hasBody = source => Boolean(String(source.text_preview ?? source.raw_text ?? "").trim());
  const saved = sources.filter(source => ["captured", "analyzed"].includes(source.status) && hasBody(source));
  const extracted = saved.filter(source => source.status === "analyzed" && asList(source.extracted_questions).length > 0);
  const analyzedIds = new Set(extracted.map(source => source.id));
  const brief = asList(detail.interview_briefs)[0];
  const staleBrief = ["stale", "invalid", "invalidated"].includes(brief?.metadata_json?.analysis_status);
  const evidenceAccounting = readInterviewEvidenceAccounting(brief?.metadata_json?.evidence_accounting, { stale: staleBrief });
  const allQuestions = asList(brief?.common_questions);
  const questions = (staleBrief ? [] : allQuestions).map(item => {
    const recordedIds = unique(asList(item.question_evidence?.supporting_source_ids));
    const supporting = recordedIds.filter(id => analyzedIds.has(id)
      && Boolean(matchingQuestionEvidence(sourceById.get(id), item)?.evidence_quote?.trim()));
    const claimedIndependentCount = independentQuestionCount(item);
    const currentIndependentCount = claimedIndependentCount && supporting.length >= claimedIndependentCount
      && supporting.length === recordedIds.length ? claimedIndependentCount : null;
    return { ...item, currentSupportingSourceIds: supporting, currentIndependentCount };
  }).filter(item => item.currentSupportingSourceIds.length > 0);
  const usableIds = new Set(questions.flatMap(item => item.currentSupportingSourceIds));
  const turn = currentResearchTurn(detail);
  const records = operationRecords(detail, turn);
  const run = executionState(turn, options, records);
  const currentRoundSourceIds = unique(turn.receipts.filter(receipt => receipt.tool_name === "capture_interview_source" && successful(receipt.status))
    .flatMap(receipt => asList(receipt.artifacts).filter(artifact => typeof artifact === "string" && artifact.startsWith("interview_source:"))
      .map(artifact => artifact.slice("interview_source:".length)))).filter(id => saved.some(source => source.id === id));
  const captureReceipts = turn.receipts.filter(receipt => receipt.tool_name === "capture_interview_source");
  const hasRecordedCaptureIds = captureReceipts.some(receipt => asList(receipt.artifacts).some(artifact => typeof artifact === "string" && artifact.startsWith("interview_source:")));
  const currentRoundSavedCount = hasRecordedCaptureIds ? currentRoundSourceIds.length : null;
  const ocrPendingCount = sources.filter(source => source.status === "ocr_pending" || source.metadata_json?.ocr_status === "pending").length;
  const recurringQuestionCount = questions.filter(item => item.currentIndependentCount >= 2).length;
  const pendingIndependence = questions.some(item => !item.currentIndependentCount);
  const evidence = staleBrief ? { key: "stale", label: "旧面试简报已过期" }
    : !saved.length && !questions.length ? { key: "unrecorded", label: "尚无可用面经证据" }
    : !questions.length ? { key: "saved", label: extracted.length ? "已提取问题，等待整理来源支持" : "已保存正文，等待提取问题" }
    : pendingIndependence ? { key: "independence_pending", label: "部分问题有支持，独立性待核验" }
    : { key: "limited", label: "部分问题有支持，证据仍有限" };
  const reasons = summarizeReasons(records, run).filter(reason => reason.key !== "unrecorded" || !questions.length);
  const unsupportedQuestionCount = staleBrief ? 0 : allQuestions.length - questions.length;
  const gapText = staleBrief ? "JD 正文或岗位语境已改变，旧简报需重新调研；可以先按当前 JD 准备，已保存来源仍保留。"
    : !questions.length ? saved.length ? "已保存正文尚未支持当前简报中的问题，可先按 JD 准备。" : "尚无当前来源支持的问题，可按 JD 准备或补充面经原文。"
    : pendingIndependence ? "部分问题的来源独立性待核验，不能据来源篇数推断高频。" : "现有面经只支持部分问题，尚未证明覆盖岗位要求。";
  return {
    run, evidence, sources, questions, staleBrief, evidenceAccounting,
    savedBodyCount: saved.length, extractedSourceCount: extracted.length, usableSourceCount: usableIds.size,
    ocrPendingCount, supportedQuestionCount: questions.length, recurringQuestionCount, unsupportedQuestionCount,
    currentRoundSavedCount, currentRoundSourceIds,
    currentRoundSavedLabel: currentRoundSavedCount === null ? "本轮读取/复用篇数未记录" : `本轮读取或复用 ${currentRoundSavedCount} 篇正文（按来源去重）`,
    summaryText: `当前岗位累计：已保存正文 ${saved.length} 篇，已完成问题提取 ${extracted.length} 篇，支持当前问题 ${usableIds.size} 篇。`,
    gapText, reasons,
  };
}

/** JD requirements support preparation suggestions, never personal achievements or real interview frequency. */
export function buildJdPreparation(job = {}) {
  const raw = String(job.jd_raw || "").trim();
  if (!raw) return [];
  const lines = [...new Set(raw.split(/\r?\n|(?<=[。！？；;])/u).map(line => line.trim()).filter(line => line.length >= 6))];
  const requirements = lines.filter(line => /负责|熟悉|掌握|具备|能够|能力|经验|要求|理解|了解|设计|开发|维护|分析|协作|experience|knowledge|proficien|responsib|ability|skills?/i.test(line));
  const quotes = (requirements.length ? requirements : lines).slice(0, 3);
  if (!quotes.length) quotes.push(raw);
  const tasks = [
    { title: "复习岗位要求涉及的概念", action: "围绕这条要求列出相关概念，复习定义、适用条件与常见取舍。" },
    { title: "设计一项针对性练习", action: "把这条要求改写为一个练习场景，说明解题步骤、验证方式和需要进一步了解的内容。" },
    { title: "整理本人已确认的事实", action: "对照这条要求，从本人已确认的经历中选择可核查的原句；没有相关事实时记录缺口，不补写成果。" },
  ];
  return tasks.map((task, index) => ({ ...task, id: `jd-preparation-${index + 1}`, jdQuote: quotes[index] || quotes[0] }));
}
