import { createGraphSimulation } from "./interview-graph-simulation.js";

export const GRAPH_MIN_ZOOM = 1 / 128;
export const GRAPH_MAX_ZOOM = 8;
export const clampGraphZoom = value => Math.max(GRAPH_MIN_ZOOM, Math.min(GRAPH_MAX_ZOOM, value));
export const graphLerp = (from, to, retention, frames = 1) => to + (from - to) * Math.pow(retention, frames);

/** Worker and file: fallback share one simulation; main-thread batches yield. */
export function createGraphMotionTransport(onSnapshot, { reducedMotion = false, onEngineChange } = {}) {
  let worker = null;
  let simulation = null;
  let timer = null;
  let watchdog = null;
  let revision = 0;
  let disposed = false;
  let graph = { nodes: [], edges: [] };
  let latest = null;
  let warmup = false;
  let initialized = false;
  const pinned = new Map();
  const emit = snapshot => {
    if (disposed) return;
    latest = snapshot;
    if (snapshot.ids.length) initialized = true;
    onSnapshot(snapshot);
  };
  const cancelTimer = () => { if (timer !== null) clearTimeout(timer); timer = null; };
  const schedule = () => {
    if (disposed || timer !== null || !simulation?.isActive() || reducedMotion) return;
    timer = setTimeout(() => {
      timer = null;
      emit(simulation.tick());
      schedule();
    }, 1000 / 60);
  };
  const batchTicks = (steps, done) => {
    const expectedRevision = revision;
    const batch = () => {
      timer = null;
      if (disposed || expectedRevision !== revision) return;
      const started = performance.now();
      do { simulation.tick(); steps -= 1; }
      while (steps > 0 && simulation.isActive() && performance.now() - started < 6);
      if (steps > 0 && simulation.isActive()) timer = setTimeout(batch, 0);
      else done();
    };
    cancelTimer();
    timer = setTimeout(batch, 0);
  };
  const settleFallback = () => batchTicks(600, () => {
    simulation.stop();
    emit(simulation.getSnapshot());
  });
  const loadFallbackGraph = () => {
    cancelTimer();
    if (disposed) return;
    // Install topology before any pin can cancel the pending animation work.
    const coordinates = new Map(latest?.ids.map((id, index) => [id, { x: latest.positions[index * 2], y: latest.positions[index * 2 + 1] }]) || []);
    simulation.setGraph(graph.nodes.map(node => ({ ...node, ...coordinates.get(node.id) })), graph.edges);
    pinned.forEach((point, id) => simulation.pinNode(id, point.x, point.y));
    timer = setTimeout(() => {
      timer = null;
      if (disposed) return;
      if (reducedMotion) {
        if (!pinned.size) settleFallback();
      } else if (!initialized && graph.nodes.length) batchTicks(60, () => { emit(simulation.getSnapshot()); schedule(); });
      else { emit(simulation.getSnapshot()); schedule(); }
    }, 0);
  };
  const startFallback = () => {
    if (disposed || simulation) return;
    worker?.terminate(); worker = null; clearTimeout(watchdog);
    simulation = createGraphSimulation({
      repelStrength: 1800,
      linkDistance: 200,
      collisionRadius: 80,
      velocityDamping: 0.65,
    });
    onEngineChange?.("fallback");
    loadFallbackGraph();
  };
  try {
    worker = new Worker(new URL("./interview-graph-simulation.worker.js", import.meta.url), { type: "module" });
    onEngineChange?.("worker");
    worker.onmessage = event => {
      const message = event.data;
      if (disposed || message?.type !== "positions" || message.revision !== revision) return;
      clearTimeout(watchdog);
      if (warmup) { warmup = false; return; }
      if (reducedMotion && message.active) return;
      emit(message);
    };
    worker.onerror = event => { event.preventDefault(); startFallback(); };
    worker.onmessageerror = startFallback;
  } catch { startFallback(); }

  const send = message => {
    if (!worker) return;
    try { worker.postMessage({ ...message, revision }); }
    catch { startFallback(); }
  };
  return {
    setGraph(nodes, edges) {
      if (disposed) return;
      graph = { nodes: nodes.map(({ id, x, y }) => ({ id, x, y })), edges: edges.map(({ source, target }) => ({ source, target })) };
      revision += 1;
      if (worker) {
        warmup = !initialized && graph.nodes.length > 0 && !reducedMotion;
        send({ type: "graph", ...graph });
        if (warmup) send({ type: "settle", steps: 60 });
        if (reducedMotion) { send({ type: "settle", steps: 600 }); send({ type: "stop" }); }
        clearTimeout(watchdog);
        if (graph.nodes.length) watchdog = setTimeout(startFallback, 2000);
      } else if (simulation) loadFallbackGraph();
    },
    pinNode(id, x, y) {
      pinned.set(id, { x, y });
      if (worker) send({ type: "pin", id, x, y });
      else if (simulation) {
        if (reducedMotion) cancelTimer();
        simulation.pinNode(id, x, y);
        if (!reducedMotion) { emit(simulation.getSnapshot()); schedule(); }
      }
    },
    releaseNode(id) {
      pinned.delete(id);
      if (worker) {
        send({ type: "release", id });
        send({ type: "reheat", alpha: 0.3 });
        if (reducedMotion && !pinned.size) { send({ type: "settle", steps: 600 }); send({ type: "stop" }); }
      } else if (simulation) {
        simulation.releaseNode(id); simulation.reheat(0.3);
        if (reducedMotion && !pinned.size) settleFallback();
        else schedule();
      }
    },
    setReducedMotion(value) {
      reducedMotion = value;
      if (value && worker && !pinned.size) { send({ type: "settle", steps: 600 }); send({ type: "stop" }); }
      else if (value && simulation && !pinned.size) settleFallback();
      else if (!value && simulation) schedule();
    },
    destroy() {
      disposed = true; cancelTimer(); clearTimeout(watchdog);
      worker?.terminate(); simulation?.stop(); pinned.clear();
    },
  };
}

let measurementContext;
export function wrapGraphLabel(label, fontSize) {
  if (measurementContext === undefined) measurementContext = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  if (measurementContext) measurementContext.font = `${fontSize}px ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif`;
  const width = value => measurementContext ? measurementContext.measureText(value).width : Array.from(value).length * fontSize;
  const lines = [];
  for (const paragraph of String(label || "").split(/\r?\n/u)) {
    let line = "";
    for (const character of Array.from(paragraph)) {
      if (line && width(line + character) > 300) { lines.push(line.trimEnd()); line = character.trimStart(); }
      else line += character;
    }
    lines.push(line);
  }
  return lines;
}
