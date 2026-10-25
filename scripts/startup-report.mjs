import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const phases = {
  mainReadyMs: [null, "main.ready"],
  windowPaintMs: ["window.create", "renderer.first_paint"],
  windowInteractiveMs: [null, "renderer.interactive"],
  dataReadyMs: [null, "data.ready"],
  agentReadyMs: [null, "agent.ready"],
  sidecarHealthMs: ["sidecar.spawn", "sidecar.healthy"],
  providerMs: ["provider.configure_start", "provider.configured"],
  reconcileMs: ["agent.reconcile_start", "agent.reconciled"],
  piWarmMs: ["pi.warm_start", "pi.warm_ready"],
};

export function startupMetrics(rows) {
  const byName = new Map(rows.map(row => [row.stage, row]));
  const metrics = {};
  for (const [name, [from, to]] of Object.entries(phases)) {
    const end = byName.get(to)?.elapsedMs, start = from ? byName.get(from)?.elapsedMs : 0;
    if (Number.isFinite(end) && Number.isFinite(start) && end >= start) metrics[name] = end - start;
  }
  for (const stage of ["imports_complete", "schema_ready", "index_ready"]) {
    const row = byName.get(`python.${stage}`);
    if (Number.isFinite(row?.durationMs)) metrics[`python_${stage}Ms`] = row.durationMs;
  }
  const entry = byName.get("python.entry")?.pythonElapsedMs;
  const imports = byName.get("python.imports_complete")?.pythonElapsedMs;
  if (Number.isFinite(entry) && Number.isFinite(imports) && imports >= entry) metrics.pythonImportsMs = imports - entry;
  return metrics;
}

export function summarizeStartup(runs) {
  return Object.fromEntries(["cold", "warm", "unclassified"].map(kind => {
    const selected = runs.filter(run => run.kind === kind);
    const keys = new Set(selected.flatMap(run => Object.keys(run.metrics)));
    return [kind, { launches: selected.length, metrics: Object.fromEntries([...keys].map(key => {
      const values = selected.map(run => run.metrics[key]).filter(Number.isFinite).sort((a, b) => a - b);
      const middle = Math.floor(values.length / 2);
      const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
      return [key, { n: values.length, medianMs: +median.toFixed(3), p95Ms: +values[Math.ceil(values.length * .95) - 1].toFixed(3) }];
    })) }];
  }));
}

export async function readStartupLogs(directory) {
  const files = (await fs.readdir(directory)).filter(name => /^startup-[\da-f-]+\.jsonl$/.test(name));
  return Promise.all(files.map(async name => {
    const rows = (await fs.readFile(path.join(directory, name), "utf8")).trim().split(/\r?\n/).flatMap(line => {
      try { return [JSON.parse(line)]; } catch { return []; } // Interrupted final log write.
    });
    return { runId: rows[0]?.runId, kind: rows[0]?.kind || "unclassified", metrics: startupMetrics(rows) };
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const directories = process.argv.slice(2);
  if (!directories.length) throw new Error("Usage: node scripts/startup-report.mjs <startup log directory> [...]");
  const runs = (await Promise.all(directories.map(readStartupLogs))).flat();
  console.log(JSON.stringify({ note: "Cold/warm labels are operator supplied; missing stages are omitted, never zero. P95 uses nearest rank; inspect n.", runs, summary: summarizeStartup(runs) }, null, 2));
}
