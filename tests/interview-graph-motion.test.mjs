import assert from "node:assert/strict";
import test from "node:test";
import { createGraphMotionTransport } from "../src/lib/interview-graph-motion.js";
import { createGraphSimulation } from "../src/lib/interview-graph-simulation.js";
import { attachGraphSimulationWorker } from "../src/lib/interview-graph-simulation.worker.js";

test("worker and fallback warmup produce the same tuned physical trajectory", async context => {
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  context.after(() => {
    if (originalWorker) Object.defineProperty(globalThis, "Worker", originalWorker);
    else delete globalThis.Worker;
  });
  const nodes = [
    { id: "company", x: -280, y: 40 }, { id: "role", x: -40, y: -80 },
    { id: "source-a", x: 5, y: 15 }, { id: "source-b", x: 8, y: 16 },
    { id: "source-c", x: 260, y: 180 }, { id: "island", x: -120, y: 240 },
  ];
  const edges = [
    { source: "company", target: "role" }, { source: "role", target: "source-a" },
    { source: "role", target: "source-b" }, { source: "role", target: "source-c" },
  ];
  // Run the real worker handler with a controlled clock so the transport's
  // 60-tick warmup is compared before either path receives another timer tick.
  class InProcessWorker {
    constructor() {
      this.listeners = new Set();
      this.controller = attachGraphSimulationWorker({
        addEventListener: (_type, listener) => this.listeners.add(listener),
        removeEventListener: (_type, listener) => this.listeners.delete(listener),
        postMessage: (message, transfer) => { const data = structuredClone(message, { transfer }); queueMicrotask(() => this.onmessage?.({ data })); },
      }, { schedule: () => 1, cancel: () => {} });
    }
    postMessage(data) { for (const listener of this.listeners) listener({ data }); }
    terminate() { this.controller.dispose(); }
  }
  async function warmup(Worker, expectedEngine) {
    Object.defineProperty(globalThis, "Worker", { configurable: true, value: Worker });
    let transport, timeout, engine;
    try {
      return await new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`${expectedEngine} warmup timed out`)), 2000);
        transport = createGraphMotionTransport(snapshot => {
          assert.equal(engine, expectedEngine);
          resolve(snapshot);
        }, { onEngineChange: value => { engine = value; } });
        transport.setGraph(nodes, edges);
      });
    } finally { clearTimeout(timeout); transport?.destroy(); }
  }
  const worker = await warmup(InProcessWorker, "worker");
  const fallback = await warmup(class { constructor() { throw new Error("Worker unavailable"); } }, "fallback");
  const tuned = createGraphSimulation({ repelStrength: 1800, linkDistance: 200, collisionRadius: 80, velocityDamping: 0.65 });
  tuned.setGraph(nodes, edges);
  const expected = tuned.tick(60);
  assert.deepEqual(worker.ids, expected.ids);
  assert.deepEqual(worker.positions, expected.positions);
  assert.deepEqual(fallback.positions, expected.positions);
  const defaults = createGraphSimulation();
  defaults.setGraph(nodes, edges);
  assert.notDeepEqual(expected.positions, defaults.tick(60).positions, "the fixture must distinguish tuning from untouched defaults");
});

test("a reduced-motion fallback keeps graph changes when a drag immediately follows", async context => {
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    value: class { constructor() { throw new Error("Worker unavailable in this renderer"); } },
  });
  context.after(() => {
    if (originalWorker) Object.defineProperty(globalThis, "Worker", originalWorker);
    else delete globalThis.Worker;
  });
  let publish = null;
  let timeout = null;
  let engine;
  const transport = createGraphMotionTransport(snapshot => publish?.(snapshot), {
    reducedMotion: true,
    onEngineChange: value => { engine = value; },
  });
  context.after(() => { transport.destroy(); clearTimeout(timeout); });
  const nextSnapshot = () => new Promise((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error("The graph did not settle")), 2000);
    publish = snapshot => { clearTimeout(timeout); publish = null; resolve(snapshot); };
  });

  const initial = nextSnapshot();
  transport.setGraph([{ id: "a" }, { id: "b" }], [{ source: "a", target: "b" }]);
  assert.deepEqual((await initial).ids, ["a", "b"]);
  assert.equal(engine, "fallback");

  // All three commands share one event turn; pin must not cancel graph installation.
  const updated = nextSnapshot();
  transport.setGraph([{ id: "a" }, { id: "b" }, { id: "c" }], [
    { source: "a", target: "b" }, { source: "b", target: "c" },
  ]);
  transport.pinNode("a", 400, 200);
  transport.releaseNode("a");
  const snapshot = await updated;
  assert.deepEqual(snapshot.ids, ["a", "b", "c"]);
  assert.equal(snapshot.active, false);
  assert.equal(snapshot.positions.length, 6);
  assert([...snapshot.positions].every(Number.isFinite));
});
