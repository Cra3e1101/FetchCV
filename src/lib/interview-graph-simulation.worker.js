import { createGraphSimulation } from "./interview-graph-simulation.js";

/**
 * Inputs: graph {nodes, edges, revision}, pin {id,x,y}, release {id},
 * reheat {alpha?}, settle {steps?}, stop. Non-graph commands may include a
 * revision and are ignored when it is stale. Every output carries revision.
 * The only recurring work is a 60 Hz timer while the simulation is active.
 */
export function attachGraphSimulationWorker(scope, scheduler = {}) {
  const simulation = createGraphSimulation({
    repelStrength: 1800,
    linkDistance: 200,
    collisionRadius: 80,
    velocityDamping: 0.65,
  });
  const schedule = scheduler.schedule ?? ((callback, delay) => setTimeout(callback, delay));
  const cancel = scheduler.cancel ?? (handle => clearTimeout(handle));
  let revision = 0;
  let timer = null;
  let disposed = false;

  function publish(snapshot = simulation.getSnapshot()) {
    if (disposed) return;
    scope.postMessage({ type: "positions", revision, ...snapshot }, [snapshot.positions.buffer]);
  }

  function cancelTimer() {
    if (timer !== null) cancel(timer);
    timer = null;
  }

  function start() {
    if (disposed || timer !== null || !simulation.isActive()) return;
    timer = schedule(() => {
      timer = null;
      publish(simulation.tick());
      start();
    }, 1000 / 60);
  }

  function onMessage(event) {
    const message = event?.data;
    if (disposed || !message || typeof message !== "object") return;
    if (message.type !== "graph" && message.revision !== undefined && message.revision !== revision) return;
    switch (message.type) {
      case "graph": {
        if (Number.isFinite(message.revision) && message.revision < revision) return;
        revision = Number.isFinite(message.revision) ? message.revision : revision + 1;
        cancelTimer();
        publish(simulation.setGraph(message.nodes, message.edges));
        start();
        break;
      }
      case "pin":
        if (simulation.pinNode(message.id, message.x, message.y)) {
          publish();
          start();
        }
        break;
      case "release":
        if (simulation.releaseNode(message.id)) start();
        break;
      case "reheat":
        simulation.reheat(message.alpha);
        start();
        break;
      case "settle":
        cancelTimer();
        publish(simulation.tick(message.steps ?? 300));
        start();
        break;
      case "stop":
        cancelTimer();
        simulation.stop();
        publish();
        break;
      default:
        break;
    }
  }

  scope.addEventListener("message", onMessage);
  return {
    dispose() {
      disposed = true;
      cancelTimer();
      simulation.stop();
      scope.removeEventListener("message", onMessage);
    },
  };
}

if (typeof self !== "undefined" && typeof self.postMessage === "function" && typeof self.document === "undefined") {
  attachGraphSimulationWorker(self);
}
