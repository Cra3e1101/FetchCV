import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { createGraphSimulation, GRAPH_SIMULATION_DEFAULTS } from "../src/lib/interview-graph-simulation.js";
import { attachGraphSimulationWorker } from "../src/lib/interview-graph-simulation.worker.js";

function points(snapshot) {
  return new Map(snapshot.ids.map((id, index) => [id, [...snapshot.positions.slice(index * 2, index * 2 + 2)]]));
}

function assertFinite(snapshot) {
  assert.equal(snapshot.positions.length, snapshot.ids.length * 2);
  assert(snapshot.positions instanceof Float32Array);
  assert([...snapshot.positions].every(Number.isFinite));
  assert(Number.isFinite(snapshot.alpha));
}

test("uses the measured Publish force and cooling defaults", () => {
  assert.equal(GRAPH_SIMULATION_DEFAULTS.centerStrength, 0.1);
  assert.equal(GRAPH_SIMULATION_DEFAULTS.linkDistance, 250);
  assert.equal(GRAPH_SIMULATION_DEFAULTS.repelStrength, 1000);
  assert.equal(GRAPH_SIMULATION_DEFAULTS.repelDistanceMin, 30);
  assert.equal(GRAPH_SIMULATION_DEFAULTS.velocityDamping, 0.6);
  assert.equal(GRAPH_SIMULATION_DEFAULTS.collisionRadius, 60);
  assert.equal(GRAPH_SIMULATION_DEFAULTS.collisionStrength, 0.5);
  assert.equal(GRAPH_SIMULATION_DEFAULTS.alphaDecay, 1 - Math.pow(0.001, 1 / 300));
});

test("initial placement is deterministic, detached snapshots cannot mutate the simulation", () => {
  const nodes = [{ id: "a" }, { id: "b" }, { id: "孤点" }];
  const edges = [{ source: "a", target: "b" }];
  const left = createGraphSimulation();
  const right = createGraphSimulation();
  assert.deepEqual(left.setGraph(nodes, edges), right.setGraph(nodes, edges));
  assert.deepEqual(left.tick(30), right.tick(30));
  const snapshot = left.getSnapshot();
  const original = [...snapshot.positions];
  structuredClone(snapshot, { transfer: [snapshot.positions.buffer] });
  assert.equal(snapshot.positions.byteLength, 0);
  assert.deepEqual([...left.getSnapshot().positions], original);
});

test("data changes preserve retained coordinates and place new nodes beside a linked neighbour", () => {
  const simulation = createGraphSimulation();
  simulation.setGraph([{ id: "root", x: 900, y: 100 }, { id: "leaf" }], [["root", "leaf"]]);
  const before = points(simulation.tick(40));
  const added = simulation.setGraph([{ id: "root", x: 0, y: 0 }, { id: "leaf" }, { id: "new" }],
    [["root", "leaf"], ["leaf", "new"]]);
  const after = points(added);
  assert.deepEqual(after.get("root"), before.get("root"));
  assert.deepEqual(after.get("leaf"), before.get("leaf"));
  assert(Math.hypot(after.get("leaf")[0] - after.get("new")[0], after.get("leaf")[1] - after.get("new")[1]) < 46);
  const removed = points(simulation.setGraph([{ id: "root" }, { id: "new" }], []));
  assert.deepEqual(removed.get("root"), after.get("root"));
  assert.deepEqual(removed.get("new"), after.get("new"));
});

test("same topology and reordered inputs do not restart a cooled layout", () => {
  const simulation = createGraphSimulation();
  simulation.setGraph([{ id: "a" }, { id: "b" }], [["a", "b"]]);
  const settled = points(simulation.tick(300));
  assert.equal(simulation.isActive(), false);
  const unchanged = simulation.setGraph([{ id: "b", label: "renamed" }, { id: "a" }], [["b", "a"], ["a", "b"]]);
  assert.equal(unchanged.active, false);
  assert.equal(unchanged.alpha, 0);
  assert.deepEqual(points(unchanged), new Map([["b", settled.get("b")], ["a", settled.get("a")]]));
  assert.equal(simulation.reheat(), true);
  assert.equal(simulation.getSnapshot().alpha, 0.3);
});

test("invalid nodes, dangling/self/duplicate edges and isolated nodes remain finite", () => {
  const simulation = createGraphSimulation();
  const initial = simulation.setGraph([null, {}, { id: "" }, { id: "a", x: Infinity, y: NaN }, { id: "a" },
    { id: "b", x: 0, y: 0 }, { key: "island" }, 2, NaN],
  [null, {}, [], ["a", "missing"], ["a", "a"], ["a", "b"], ["b", "a"],
    { source: { id: "a" }, target: { id: "b" } }]);
  assert.deepEqual(initial.ids, ["a", "b", "island", "2"]);
  assertFinite(simulation.tick(300));
  assert.equal(simulation.isActive(), false);
});

test("drag pins exact coordinates, warms neighbours and cools after release", () => {
  const simulation = createGraphSimulation();
  simulation.setGraph([{ id: "a" }, { id: "b" }], [["a", "b"]]);
  simulation.tick(300);
  const before = points(simulation.getSnapshot()).get("b");
  assert.equal(simulation.pinNode("missing", 0, 0), false);
  assert.equal(simulation.pinNode("a", NaN, 0), false);
  assert.equal(simulation.pinNode("a", 450, 300), true);
  const dragging = simulation.tick(400);
  assert.deepEqual(points(dragging).get("a"), [450, 300]);
  assert.notDeepEqual(points(dragging).get("b"), before);
  assert.equal(dragging.active, true);
  assert.equal(dragging.alpha, 0.3);
  assert.equal(simulation.releaseNode("a"), true);
  assert.equal(simulation.releaseNode("a"), false);
  const released = simulation.tick(300);
  assert.equal(released.active, false);
  assert.notDeepEqual(points(released).get("a"), [450, 300]);
  assertFinite(released);
});

test("multiple pins and removal of the dragged node release the heat target correctly", () => {
  const simulation = createGraphSimulation();
  simulation.setGraph(["a", "b", "c"]);
  simulation.pinNode("a", 1, 2);
  simulation.pinNode("b", 3, 4);
  simulation.releaseNode("a");
  assert.equal(simulation.tick(400).active, true);
  simulation.setGraph(["a", "c"]);
  assert.equal(simulation.tick(300).active, false);
});

test("collision separates initially coincident nodes using two 60 unit radii", () => {
  const simulation = createGraphSimulation({ centerStrength: 0, repelStrength: 0, linkStrength: 0 });
  simulation.setGraph([{ id: "a", x: 0, y: 0 }, { id: "b", x: 0, y: 0 }]);
  const result = simulation.tick(60);
  const [a, b] = [...points(result).values()];
  assert(Math.hypot(a[0] - b[0], a[1] - b[1]) > 119);
  assertFinite(result);
});

test("repulsion caps close-pair impulses at the 30 unit minimum distance", () => {
  for (const distance of [0, 0.01, 1, 15, 30, 60]) {
    const simulation = createGraphSimulation({ centerStrength: 0, collisionStrength: 0,
      alphaDecay: 0, velocityDamping: 1 });
    simulation.setGraph([{ id: "a", x: -distance / 2, y: 0 }, { id: "b", x: distance / 2, y: 0 }]);
    const result = simulation.tick();
    const [a, b] = [...points(result).values()];
    const expectedImpulse = 1000 * 0.3 / Math.max(30, distance);
    assert(Math.abs(Math.hypot(a[0] + distance / 2, a[1]) - expectedImpulse) < 1e-5,
      `distance ${distance} should have a bounded ${expectedImpulse} unit impulse`);
    assert(Math.abs(Math.hypot(b[0] - distance / 2, b[1]) - expectedImpulse) < 1e-5);
    assertFinite(result);
  }
});

test("Barnes–Hut aggregate repulsion uses the same short-distance cap", () => {
  const simulation = createGraphSimulation({ centerStrength: 0, collisionStrength: 0,
    alphaDecay: 0, velocityDamping: 1 });
  simulation.setGraph([{ id: "observer", x: 0, y: 0 },
    ...Array.from({ length: 5 }, (_, index) => ({ id: `cluster-${index}`, x: 10, y: 0 }))]);
  const result = simulation.tick();
  assert.deepEqual(points(result).get("observer"), [-50, 0]);
  assertFinite(result);
});

test("a linked pair approaches the 250 unit rest length without other forces", () => {
  const simulation = createGraphSimulation({ centerStrength: 0, repelStrength: 0, collisionStrength: 0 });
  simulation.setGraph([{ id: "a", x: -500, y: 0 }, { id: "b", x: 500, y: 0 }], [["a", "b"]]);
  const [a, b] = [...points(simulation.tick(200)).values()];
  assert(Math.abs(Math.hypot(a[0] - b[0], a[1] - b[1]) - 250) < 0.1);
});

test("empty and explicitly stopped simulations perform no work", () => {
  const simulation = createGraphSimulation();
  assert.deepEqual(simulation.tick(300), { ids: [], positions: new Float32Array(), alpha: 0, active: false });
  assert.equal(simulation.reheat(), false);
  simulation.setGraph(["a"]);
  simulation.pinNode("a", 100, 100);
  simulation.stop();
  const before = simulation.getSnapshot();
  assert.equal(before.active, false);
  assert.deepEqual(simulation.tick(300), before);
  assert.equal(simulation.setGraph([]).active, false);
});

function workerHarness() {
  const listeners = new Set();
  const messages = [];
  const timers = new Map();
  let nextHandle = 0;
  const scope = {
    addEventListener(type, listener) { if (type === "message") listeners.add(listener); },
    removeEventListener(type, listener) { if (type === "message") listeners.delete(listener); },
    postMessage(message, transfer) {
      messages.push(structuredClone(message, { transfer }));
    },
  };
  const controller = attachGraphSimulationWorker(scope, {
    schedule(callback, delay) {
      assert.equal(delay, 1000 / 60);
      const handle = ++nextHandle;
      timers.set(handle, callback);
      return handle;
    },
    cancel(handle) { timers.delete(handle); },
  });
  return {
    messages, timers, listeners, controller,
    send(data) { for (const listener of listeners) listener({ data }); },
    flush(maxFrames = 1000) {
      let frames = 0;
      while (timers.size && frames < maxFrames) {
        const [handle, callback] = timers.entries().next().value;
        timers.delete(handle);
        callback();
        frames += 1;
      }
      return frames;
    },
  };
}

test("worker transfers finite revisioned snapshots at 60 Hz and idles after cooling", () => {
  const worker = workerHarness();
  worker.send({ type: "graph", nodes: ["a", "b"], edges: [["a", "b"]], revision: 5 });
  assert.equal(worker.messages.length, 1);
  assert.equal(worker.messages[0].type, "positions");
  assert.equal(worker.messages[0].revision, 5);
  assert.equal(worker.timers.size, 1);
  const frames = worker.flush();
  assert(frames > 200 && frames < 300);
  assert.equal(worker.timers.size, 0);
  assert.equal(worker.messages.at(-1).active, false);
  for (const message of worker.messages) assertFinite(message);
  worker.send({ type: "graph", nodes: ["stale"], revision: 4 });
  worker.send({ type: "pin", id: "a", x: 50, y: 60, revision: 4 });
  assert.equal(worker.messages.at(-1).revision, 5);
  assert.equal(worker.timers.size, 0);
  worker.send({ type: "pin", id: "a", x: 50, y: 60, revision: 5 });
  worker.flush(10);
  assert.deepEqual(points(worker.messages.at(-1)).get("a"), [50, 60]);
  worker.send({ type: "release", id: "a", revision: 5 });
  worker.flush();
  assert.equal(worker.messages.at(-1).active, false);
  worker.controller.dispose();
});

test("worker settle, empty update, stop and disposal cancel scheduled work", () => {
  const worker = workerHarness();
  worker.send({ type: "graph", nodes: ["a"], revision: 1 });
  worker.send({ type: "settle", revision: 1 });
  assert.equal(worker.messages.at(-1).active, false);
  assert.equal(worker.timers.size, 0);
  worker.send({ type: "reheat", revision: 1 });
  assert.equal(worker.timers.size, 1);
  worker.send({ type: "stop" });
  assert.equal(worker.timers.size, 0);
  assert.equal(worker.messages.at(-1).active, false);
  worker.send({ type: "graph", nodes: [], revision: 2 });
  assert.equal(worker.timers.size, 0);
  assert.deepEqual(worker.messages.at(-1).ids, []);
  worker.send({ type: "graph", nodes: ["a"], revision: 3 });
  assert.equal(worker.timers.size, 1);
  worker.controller.dispose();
  assert.equal(worker.timers.size, 0);
  assert.equal(worker.listeners.size, 0);
  const count = worker.messages.length;
  worker.send({ type: "reheat" });
  assert.equal(worker.messages.length, count);
});

test("500-node sparse graph remains finite and settles within an interactive work budget", t => {
  const nodes = Array.from({ length: 500 }, (_, index) => ({ id: `node-${index}` }));
  const edges = nodes.slice(1).map((node, index) => [nodes[Math.floor(index / 3)].id, node.id]);
  const simulation = createGraphSimulation();
  simulation.setGraph(nodes, edges);
  const started = performance.now();
  const result = simulation.tick(300);
  const elapsed = performance.now() - started;
  t.diagnostic(`500 nodes settled in ${elapsed.toFixed(1)} ms (${(elapsed / 248).toFixed(2)} ms per active tick)`);
  assertFinite(result);
  assert.equal(result.active, false);
  assert(elapsed < 5000, `500-node simulation took ${elapsed.toFixed(0)} ms`);
});
