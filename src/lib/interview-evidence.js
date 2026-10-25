export function independentQuestionCount(item) {
  const evidence = item?.question_evidence;
  if (evidence?.independence_status !== "confirmed") return null;
  const count = evidence.confirmed_independent_count;
  return Number.isInteger(count) && count > 0 && item.frequency === count ? count : null;
}

export function matchingQuestionEvidence(source, item) {
  const normalize = value => String(value || "").replace(/\s+/g, "").toLocaleLowerCase();
  const target = normalize(item?.question);
  if (!target) return null;
  return (source?.extracted_questions || source?.questions || []).find(question =>
    normalize(question?.question) === target
  ) || null;
}

const evidenceCount = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Counts are a server evidence contract, never an inference from saved articles. */
export function readInterviewEvidenceAccounting(accounting, { stale = false } = {}) {
  const current = !stale && accounting?.evidence_contract_version === "evidence-v2";
  const counts = current ? [accounting.usable_document_group_count, accounting.confirmed_origin_count, accounting.unresolved_origin_count].map(evidenceCount) : [];
  const complete = counts.length === 3 && counts.every(value => value !== null);
  const [usableDocumentGroupCount, confirmedOriginCount, unresolvedOriginCount] = complete ? counts : [null, null, null];
  const minimum = current ? evidenceCount(accounting.minimum_documents_for_limited_brief) : null;
  const minimumDocumentsForLimitedBrief = minimum > 0 ? minimum : null;
  const limitedBriefReady = current && complete && minimumDocumentsForLimitedBrief !== null
    && typeof accounting.limited_brief_ready === "boolean"
    ? accounting.limited_brief_ready && usableDocumentGroupCount >= minimumDocumentsForLimitedBrief : null;
  const metrics = [
    { key: "documents", label: "可用文档组", count: usableDocumentGroupCount, unit: "组", unknownLabel: "未记录" },
    { key: "confirmed", label: "已确认独立来源", count: confirmedOriginCount, unit: "个", unknownLabel: "未核实" },
    { key: "unresolved", label: "待核实组", count: unresolvedOriginCount, unit: "组", unknownLabel: "未记录" },
  ].map(metric => ({ ...metric, display: metric.count === null ? stale ? "需更新" : metric.unknownLabel : `${metric.count} ${metric.unit}` }));
  return {
    contractVersion: current && complete ? "evidence-v2" : null,
    usableDocumentGroupCount, confirmedOriginCount, unresolvedOriginCount,
    minimumDocumentsForLimitedBrief, limitedBriefReady,
    briefReadiness: current && complete && typeof accounting.brief_readiness === "string" ? accounting.brief_readiness : null,
    nextActions: current && complete && Array.isArray(accounting.next_actions) ? accounting.next_actions : [],
    metrics,
    summaryText: metrics.map(metric => `${metric.label} ${metric.display}`).join("，") + "。",
    readinessText: stale ? "旧简报需更新后重新核对文档门槛。"
      : limitedBriefReady === true ? "已达到有限简报的文档门槛；来源独立性仍需分别核实。"
      : limitedBriefReady === false ? "有限简报尚未就绪；可继续补充正文或核对来源。"
      : "简报文档门槛未记录，来源篇数不能代替独立性核验。",
  };
}

/** Consume only the server's current read projection, never raw metadata or hash guesses. */
export function readInterviewSourceHints(source) {
  const hints = source?.source_hints;
  const classification = hints?.classification_v1;
  const similarity = hints?.similarity_v1;
  const classificationCurrent = classification?.status === "current" && classification.schema_version === 1
    && classification.mode === "review_hint_only";
  const similarityCurrent = similarity?.status === "current" && similarity.schema_version === 1
    && similarity.mode === "review_candidates_only";
  const kindLabels = {
    suspected_compilation: "疑似汇编（待核实）",
    suspected_repost: "疑似转载（待核实）",
    first_person_candidate: "疑似作者亲历（待核实）",
    unknown: "来源类型待核实",
  };
  const classificationLabel = classificationCurrent
    ? kindLabels[classification.predicted_kind] || "来源类型待核实" : "类型提示待更新";
  const signals = classificationCurrent && Array.isArray(classification.signals)
    ? classification.signals.filter(signal => typeof signal?.quote === "string" && signal.quote.trim())
      .slice(0, 2).map(signal => signal.quote.trim().slice(0, 400)) : [];
  const candidateIds = new Set();
  const candidates = similarityCurrent && Array.isArray(similarity.candidates)
    ? similarity.candidates.filter(candidate => {
      const id = typeof candidate?.source_id === "string" ? candidate.source_id.trim() : "";
      if (!id || id === source?.id || candidateIds.has(id)) return false;
      candidateIds.add(id);
      return true;
    }).slice(0, 8).map(candidate => {
      const region = ["whole_body", "interview_narrative", "shared_jd", "shared_template"].includes(candidate.region) ? candidate.region : null;
      const strength = ["weak", "review_candidate"].includes(candidate.strength) ? candidate.strength : null;
      const label = region === "shared_jd" ? "仅岗位描述重叠（待核实）"
        : region === "shared_template" ? "模板重叠（待核实）"
        : strength === "weak" ? "弱相似提示（待核实）"
        : region ? "正文相似（待核实）" : "相似内容待核实";
      return { sourceId: candidate.source_id.trim(), region, strength, label };
    }) : [];
  const similarityLabel = !similarityCurrent ? "相似性提示待更新"
    : candidates.length ? `内容重叠候选 ${candidates.length} 个（待核实）` : "本次比对未列出相似候选";
  return {
    classification: { current: classificationCurrent, label: classificationLabel, signals },
    similarity: { current: similarityCurrent, label: similarityLabel, candidates,
      poolTruncated: similarityCurrent && similarity.pool_truncated === true },
    preview: [classificationLabel, candidates.length || !similarityCurrent ? similarityLabel : ""].filter(Boolean).join(" · "),
  };
}
