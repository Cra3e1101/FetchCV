(function initApplicationTimelineModel(global) {
  "use strict";

  const KNOWN_STAGES = [
    ["apply", "投递"], ["test", "测评"], ["screen", "筛选"],
    ["first", "一面"], ["second", "二面"], ["third", "三面"],
    ["fourth", "四面"], ["fifth", "五面"], ["sixth", "六面"],
    ["final", "终面"], ["hr", "HR面"], ["offer", "Offer"], ["onboard", "入职"]
  ];
  const LABELS = new Map(KNOWN_STAGES);
  const ORDER = new Map(KNOWN_STAGES.map(([key], index) => [key, index]));

  function knownKey(label = "") {
    const text = String(label).trim();
    const direct = KNOWN_STAGES.find(([, knownLabel]) => knownLabel.toLowerCase() === text.toLowerCase());
    if (direct) return direct[0];
    if (/笔试|测评/.test(text)) return "test";
    if (/筛选|已投递|待跟进/.test(text)) return "screen";
    if (/hr\s*面/i.test(text)) return "hr";
    if (/终面|最终面/.test(text)) return "final";
    const interviews = [["sixth", /六面|6面/], ["fifth", /五面|5面/], ["fourth", /四面|4面/], ["third", /三面|3面/], ["second", /二面|2面/], ["first", /一面|1面|初面|面试/]];
    return interviews.find(([, pattern]) => pattern.test(text))?.[0] || "";
  }

  function customKey(label = "") {
    let hash = 2166136261;
    for (const char of String(label)) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return `custom-${(hash >>> 0).toString(36)}`;
  }

  function parseDate(value, now = new Date()) {
    if (!value) return "";
    const direct = new Date(value);
    if (Number.isFinite(direct.getTime()) && /T|\d{4}-\d{2}-\d{2}/.test(String(value))) return direct.toISOString();
    const text = String(value).trim();
    const match = text.match(/(?:(\d{4})[年/-])?(\d{1,2})[月/-](\d{1,2})日?(?:\s+(\d{1,2})[:：](\d{1,2}))?/);
    if (!match) return "";
    const date = new Date(Number(match[1] || now.getFullYear()), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 9), Number(match[5] || 0), 0);
    return Number.isFinite(date.getTime()) ? date.toISOString() : "";
  }

  function getDatePrecision(value, explicit = "", legacyCanonical = false) {
    if (explicit === "date" || explicit === "datetime") return explicit;
    const text = String(value || "").trim();
    if (!text) return "";
    if (legacyCanonical && /^\d{4}-\d{2}-\d{2}T/.test(text)) {
      const date = new Date(text);
      if (Number.isFinite(date.getTime()) && date.getHours() === 9 && date.getMinutes() === 0 && date.getSeconds() === 0) {
        return "date";
      }
    }
    return /T\d{2}:\d{2}|\d{1,2}[:：]\d{2}/.test(text) ? "datetime" : "date";
  }

  function formatLegacyDate(iso = "", precision = "datetime") {
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return "";
    const day = `${date.getMonth() + 1}月${date.getDate()}日`;
    if (precision === "date") return day;
    return `${day} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  function inferLegacyCurrent(app = {}) {
    const text = `${app.status || ""} ${app.next || ""}`;
    if (app.status === "Offer") return "offer";
    if (app.status === "入职") return "onboard";
    if (/已拒绝/.test(text)) return "screen";
    return knownKey(text) || (app.status === "待投递" ? "apply" : "screen");
  }

  function normalize(app = {}) {
    if (app.status === "已拒绝") app.outcome = "rejected";
    const raw = Array.isArray(app.timeline) ? app.timeline.filter(Boolean) : [];
    const legacyCurrent = inferLegacyCurrent(app);
    let nodes = raw.map((item, index) => {
      const label = String(item.label || LABELS.get(item.key) || `阶段 ${index + 1}`).trim();
      const key = String(item.key || knownKey(label) || customKey(label));
      const sourceDate = item.at || item.time;
      const at = parseDate(sourceDate);
      return {
        id: String(item.id || `${key}-${index + 1}`),
        key,
        label,
        state: item.state || item.status || "todo",
        at,
        precision: at ? getDatePrecision(sourceDate, item.precision, Boolean(item.at && !item.time && !item.precision)) : "",
        note: String(item.note || (item.time && !at ? item.time : "")).trim()
      };
    });
    if (!nodes.length) {
      const currentIndex = Math.max(0, ORDER.get(legacyCurrent) ?? 0);
      nodes = KNOWN_STAGES.slice(0, Math.max(3, currentIndex + 1)).map(([key, label], index) => ({
        id: `${key}-${index + 1}`,
        key,
        label,
        state: index < currentIndex ? "done" : index === currentIndex ? "current" : "todo",
        at: index === currentIndex ? parseDate(app.next) : "",
        precision: index === currentIndex ? getDatePrecision(app.next) : "",
        note: index === currentIndex && !parseDate(app.next) ? String(app.next || "") : ""
      }));
    }
    nodes = nodes.filter((item, index) => index < 3 || item.state !== "todo" || item.at || item.note || !ORDER.has(item.key));
    let currentIndex = nodes.findIndex((item) => item.state === "current");
    if (currentIndex < 0) currentIndex = Math.max(0, nodes.findIndex((item) => item.key === legacyCurrent));
    if (currentIndex < 0) currentIndex = 0;
    nodes = nodes.map((item, index) => ({
      ...item,
      state: index < currentIndex ? "done" : index === currentIndex ? "current" : "todo"
    }));
    const current = nodes[currentIndex];
    app.timeline = nodes;
    app.currentStageId = current?.id || "";
    if (app.outcome === "rejected") app.status = "已拒绝";
    else if (current?.key === "apply") app.status = current.at ? "已投递" : "待投递";
    else if (current?.key === "screen") app.status = "已投递";
    else if (current?.key === "test") app.status = "笔试/测评";
    else app.status = current?.label || "待投递";
    app.next = current?.at ? formatLegacyDate(current.at, current.precision) : current?.note || "";
    return nodes;
  }

  function advance(app, label, at = "", note = "") {
    const nodes = normalize(app);
    const currentIndex = Math.max(0, nodes.findIndex((item) => item.state === "current"));
    const cleanLabel = String(label || "").trim();
    const key = knownKey(cleanLabel) || customKey(cleanLabel);
    let targetIndex = nodes.findIndex((item) => item.key === key && item.label === cleanLabel);
    if (targetIndex < 0) {
      const targetOrder = ORDER.get(key);
      targetIndex = nodes.length;
      if (targetOrder != null) {
        const found = nodes.findIndex((item) => (ORDER.get(item.key) ?? Number.MAX_SAFE_INTEGER) > targetOrder);
        if (found >= 0) targetIndex = found;
      }
      nodes.splice(targetIndex, 0, { id: `${key}-${Date.now().toString(36)}`, key, label: cleanLabel, state: "todo", at: "", precision: "", note: "" });
    }
    const effectiveIndex = Math.max(targetIndex, currentIndex);
    nodes.forEach((item, index) => {
      item.state = index < effectiveIndex ? "done" : index === effectiveIndex ? "current" : "todo";
    });
    nodes[effectiveIndex].at = parseDate(at) || "";
    nodes[effectiveIndex].precision = nodes[effectiveIndex].at ? getDatePrecision(at) : "";
    nodes[effectiveIndex].note = String(note || "").trim();
    app.timeline = nodes;
    app.currentStageId = nodes[effectiveIndex].id;
    return normalize(app);
  }

  function current(app = {}) {
    const timeline = normalize(app);
    return timeline.find((item) => item.state === "current") || timeline[0] || null;
  }

  function category(app = {}) {
    const item = current(app);
    if (!item) return "待投递";
    if (app.outcome === "rejected") return "已拒绝";
    if (item.key === "offer") return "Offer";
    if (item.key === "onboard") return "入职";
    if (["first", "second", "third", "fourth", "fifth", "sixth", "final", "hr"].includes(item.key) || /面试|面$/.test(item.label)) return "面试中";
    if (item.key === "test") return "笔试/测评";
    if (item.key === "screen") return "已投递";
    return item.at || item.state === "done" ? "已投递" : "待投递";
  }

  global.ApplicationTimelineModel = Object.freeze({ KNOWN_STAGES, parseDate, getDatePrecision, formatLegacyDate, normalize, advance, current, category, knownKey });
})(globalThis);
