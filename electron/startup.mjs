import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const pythonStages = new Set(["python.entry", "python.imports_complete", "python.schema_ready", "python.index_ready", "python.lifespan_ready"]);

// One file per launch, with durations only. Never include provider config,
// document titles, URLs, environment dumps or exception messages in this log.
export function createStartupTrace({ directory, kind = "unclassified", write, now = () => process.uptime() * 1000 } = {}) {
  const id = randomUUID();
  const file = directory ? path.join(directory, `startup-${id}.jsonl`) : null;
  const launchKind = ["cold", "warm"].includes(kind) ? kind : "unclassified";
  const seen = new Set();
  let pending = Promise.resolve();
  const append = write || (async row => {
    await fs.mkdir(directory, { recursive: true });
    await fs.appendFile(file, JSON.stringify(row) + "\n");
  });
  function mark(stage, timing = {}) {
    if (!/^[a-z][a-z_.-]{1,63}$/.test(stage) || seen.has(stage)) return;
    seen.add(stage);
    const row = { v: 1, runId: id, kind: launchKind, stage, elapsedMs: Math.round(now() * 1000) / 1000 };
    for (const key of ["pythonElapsedMs", "durationMs", "timestampMs"]) {
      if (Number.isFinite(timing[key]) && timing[key] >= 0) row[key] = timing[key];
    }
    pending = pending.then(() => append(row)).catch(() => {});
  }
  function python(line) {
    if (!line.startsWith("FETCHCV_STARTUP ")) return false;
    try {
      const event = JSON.parse(line.slice("FETCHCV_STARTUP ".length));
      if (event.traceId !== id || !pythonStages.has(event.stage)) return false;
      mark(event.stage, { pythonElapsedMs: event.elapsedMs, durationMs: event.durationMs, timestampMs: event.timestampMs });
      return true;
    } catch { return false; }
  }
  return { id, file, mark, python, flush: () => pending };
}

export function createStartupState({ mark = () => {}, notify = () => {}, warm = async () => {} } = {}) {
  let dataReady = false, agentReady = false, dataError = "", agentError = "", painted = false;
  let warming;
  const snapshot = () => ({ state: dataReady ? "ready" : dataError ? "error" : "starting", dataReady, agentReady, message: dataError, agentError });
  const publish = () => notify(snapshot());
  const warmNow = () => {
    if (!warming) {
      mark("pi.warm_start");
      warming = Promise.resolve().then(warm).then(value => { mark("pi.warm_ready"); return value; }, error => { mark("pi.warm_failed"); throw error; });
    }
    return warming;
  };
  const scheduleWarm = () => { if (painted && agentReady) void warmNow().catch(() => {}); };
  return {
    snapshot, warmNow,
    dataReady() { dataReady = true; mark("data.ready"); publish(); },
    agentReady() {
      if (!dataReady) throw new Error("data_not_ready");
      agentReady = true; mark("agent.ready"); publish(); scheduleWarm();
    },
    fail(error) {
      if (dataReady) { agentReady = false; agentError = String(error?.message || "Agent 初始化失败"); mark("agent.failed"); }
      else { dataError = String(error?.message || "本地服务启动失败"); mark("data.failed"); }
      publish();
    },
    painted() { painted = true; mark("renderer.first_paint"); scheduleWarm(); },
    interactive() { if (dataReady) mark("renderer.interactive"); },
  };
}
