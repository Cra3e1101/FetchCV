import assert from "node:assert/strict";
import test from "node:test";
import { createStartupState, createStartupTrace } from "../electron/startup.mjs";
import { startupMetrics, summarizeStartup } from "../scripts/startup-report.mjs";

test("startup trace keeps only timing fields and validates Python launch identity", async () => {
  const rows = [];
  const trace = createStartupTrace({ kind: "warm", now: () => 42.1234, write: row => rows.push(row) });
  trace.mark("main.ready", { password: "never logged", durationMs: 2 });
  trace.mark("main.ready");
  assert.equal(trace.python('FETCHCV_STARTUP {"traceId":"another","stage":"python.entry"}'), false);
  assert.equal(trace.python(`FETCHCV_STARTUP ${JSON.stringify({ traceId: trace.id, stage: "python.entry", elapsedMs: 1, token: "never logged" })}`), true);
  await trace.flush();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].elapsedMs, 42.123);
  assert.equal(rows[1].pythonElapsedMs, 1);
  assert.equal(JSON.stringify(rows).includes("never logged"), false);
});

for (const paintFirst of [true, false]) test(`data is readable before Agent; warmup waits paint + Agent (paintFirst=${paintFirst})`, async () => {
  const stages = [], states = [];
  let warms = 0, release;
  const state = createStartupState({ mark: name => stages.push(name), notify: value => states.push(value), warm: () => { warms++; return new Promise(resolve => { release = resolve; }); } });
  assert.equal(state.snapshot().agentReady, false);
  state.dataReady();
  assert.equal(state.snapshot().dataReady, true);
  assert.equal(state.snapshot().agentReady, false);
  if (paintFirst) state.painted(); else state.agentReady();
  await Promise.resolve();
  assert.equal(warms, 0);
  if (paintFirst) state.agentReady(); else state.painted();
  const first = state.warmNow(), second = state.warmNow();
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(warms, 1);
  release(); await first;
  assert.equal(stages.at(-1), "pi.warm_ready");
  assert.equal(states.at(-1).agentReady, true);
});

test("Agent failure preserves data access and prevents Agent readiness", () => {
  const state = createStartupState();
  state.dataReady(); state.fail(new Error("reconcile failed"));
  assert.deepEqual(state.snapshot(), { state: "ready", dataReady: true, agentReady: false, message: "", agentError: "reconcile failed" });
});

test("warmup errors are observed by the first message without a second import", async () => {
  const state = createStartupState({ warm: async () => { throw Error("SDK failure"); } });
  state.dataReady(); state.painted(); state.agentReady();
  await assert.rejects(state.warmNow(), /SDK failure/);
  assert.equal(state.warmNow(), state.warmNow());
});

test("timing reports separate cold/warm/unknown and never treat missing stages as zero", () => {
  const metrics = startupMetrics([{ stage: "sidecar.spawn", elapsedMs: 100 }, { stage: "sidecar.healthy", elapsedMs: 500 }]);
  assert.deepEqual(metrics, { sidecarHealthMs: 400 });
  const report = summarizeStartup([{ kind: "cold", metrics }, { kind: "warm", metrics: { sidecarHealthMs: 10 } }, { kind: "warm", metrics: { sidecarHealthMs: 20 } }, { kind: "warm", metrics: {} }]);
  assert.equal(report.cold.metrics.sidecarHealthMs.medianMs, 400);
  assert.deepEqual(report.warm.metrics.sidecarHealthMs, { n: 2, medianMs: 15, p95Ms: 20 });
  assert.equal(report.warm.launches, 3);
  assert.equal(report.unclassified.launches, 0);
});
