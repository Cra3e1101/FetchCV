import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";
import { findFreePort } from "../electron/sidecar.mjs";
import { defaultUserDataPath, packagedExecutablePath } from "./platform-paths.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");
const executablePath = packagedExecutablePath(projectRoot);
const packaged = process.env.FETCHCV_PROBE_PACKAGED === "1";
const sourceUserData = process.env.FETCHCV_PROBE_SOURCE_USER_DATA
  || defaultUserDataPath();
const sourceDatabase = path.join(sourceUserData, "data", "fetchcv.db");
const liveUserData = process.env.FETCHCV_PROBE_LIVE === "1";
const userData = liveUserData ? sourceUserData : fs.mkdtempSync(path.join(os.tmpdir(), "fetchcv-xhs-probe-"));
const probeDatabase = path.join(userData, "data", "fetchcv.db");

if (packaged) assert.equal(fs.existsSync(executablePath), true, `Missing packaged app: ${executablePath}`);
assert.equal(fs.existsSync(sourceDatabase), true, `Missing source database: ${sourceDatabase}`);
if (!liveUserData) {
  fs.mkdirSync(path.dirname(probeDatabase), { recursive: true });
  fs.copyFileSync(sourceDatabase, probeDatabase);
  const sourceAccessCache = path.join(sourceUserData, "settings", "xiaohongshu-public-links.bin");
  const destinationAccessCache = path.join(userData, "settings", "xiaohongshu-public-links.bin");
  if (fs.existsSync(sourceAccessCache)) {
    fs.mkdirSync(path.dirname(destinationAccessCache), { recursive: true });
    fs.copyFileSync(sourceAccessCache, destinationAccessCache);
  }
  const sourceSession = path.join(sourceUserData, "settings", "xiaohongshu-session.bin");
  const destinationSession = path.join(userData, "settings", "xiaohongshu-session.bin");
  if (fs.existsSync(sourceSession)) {
    fs.mkdirSync(path.dirname(destinationSession), { recursive: true });
    fs.copyFileSync(sourceSession, destinationSession);
  }
}

const port = await findFreePort();
const application = await electron.launch({
  ...(packaged ? { executablePath } : { args: [projectRoot], cwd: projectRoot }),
  env: {
    ...process.env,
    FETCHCV_API_PORT: String(port),
    FETCHCV_E2E_USER_DATA: userData,
  },
  timeout: 60000,
});
application.process().stdout?.on("data", (chunk) => process.stderr.write(`[electron] ${chunk}`));
application.process().stderr?.on("data", (chunk) => process.stderr.write(`[electron:error] ${chunk}`));

try {
  const window = await application.firstWindow({ timeout: 50000 });
  await window.locator(".main-pane, .center-empty").first().waitFor({ state: "visible", timeout: 30000 });
  const runtime = await window.evaluate(() => ({
    apiBase: window.appRuntime.apiBase,
    apiToken: window.appRuntime.apiToken,
  }));
  const headers = {
    "content-type": "application/json",
    "x-fetchcv-control-token": runtime.apiToken,
  };
  const request = async (pathname, options = {}) => {
    const response = await fetch(`${runtime.apiBase}${pathname}`, {
      ...options,
      headers: { ...headers, ...(options.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${pathname}: ${JSON.stringify(body)}`);
    return body;
  };

  const workspace = await request("/api/workspace");
  const job = workspace.jobs.find((item) => (
    String(item.company || "").includes("滴滴")
    && /两轮车|策略运营/.test(String(item.role || ""))
  ));
  assert.ok(job, "The copied workspace has no Didi two-wheel strategy-operations job");
  let nowcoderReadDiagnostic = null;
  try {
    const nowcoderQuery = encodeURIComponent(`${job.company} 两轮车事业部 策略运营 面经`);
    const page = await request("/api/web/read", {
      method: "POST",
      body: JSON.stringify({
        url: `https://www.nowcoder.com/search/all?query=${nowcoderQuery}&type=all`,
        max_chars: 50000,
      }),
    });
    const text = String(page.text || "");
    nowcoderReadDiagnostic = {
      ok: true,
      title: page.title,
      text_chars: text.length,
      mentions_strategy_operations: text.includes("策略运营"),
      mentions_two_wheel: text.includes("两轮车"),
    };
  } catch (error) {
    nowcoderReadDiagnostic = { ok: false, error: error.message };
  }

  const bootstrap = await request(`/api/pi/jobs/${encodeURIComponent(job.id)}/turns`, {
    method: "POST",
    body: JSON.stringify({
      content: "先完整查找小红书中与滴滴出行两轮车事业部策略运营相关的面试经验帖，再补充牛客等公开面经。",
      thinking_level: "deep",
      task_kind: "interview_research",
      provider: {
        provider_name: "probe",
        protocol: "openai",
        base_url: "https://example.invalid",
        model: "probe",
      },
    }),
  });
  const discovery = await request(`/api/pi/runs/${encodeURIComponent(bootstrap.run_id)}/tools/discover_interview_sources`, {
    method: "POST",
    body: JSON.stringify({
      task_kind: "interview_research",
      idempotency_key: `xhs-probe-discovery-${Date.now()}`,
      arguments: {
        company: job.company,
        role: job.role,
        business_unit: "两轮车事业部",
        query_terms: ["滴滴两轮车策略运营", "滴滴策略运营", "青桔策略运营", "青桔运营"],
      },
    }),
  });

  const data = discovery.result?.data || {};
  const results = Array.isArray(data.results) ? data.results : [];
  const verbose = process.env.FETCHCV_PROBE_VERBOSE === "1";
  const captures = [];
  const requestedCaptureCount = Number(process.env.FETCHCV_PROBE_CAPTURE_COUNT);
  const captureCount = Number.isFinite(requestedCaptureCount) && requestedCaptureCount >= 0
    ? Math.min(results.length, requestedCaptureCount)
    : results.length;
  for (const [index, item] of results.slice(0, captureCount).entries()) {
    try {
      const captured = await request(`/api/pi/runs/${encodeURIComponent(bootstrap.run_id)}/tools/capture_interview_source`, {
        method: "POST",
        body: JSON.stringify({
          task_kind: "interview_research",
          idempotency_key: `xhs-probe-capture-${Date.now()}-${index}`,
          arguments: {
            url: item.url,
            company: job.company,
            role: job.role,
            business_unit: "两轮车事业部",
          },
        }),
      });
      const source = captured.result?.data?.source || {};
      captures.push({
        ok: true,
        title: source.title,
        url: source.source_url,
        status: source.status,
        provider: source.metadata_json?.provider,
        text_chars: String(source.raw_text || "").length,
      });
    } catch (error) {
      captures.push({ ok: false, url: item.url, error: error.message });
    }
  }
  console.log(JSON.stringify({
    job: { company: job.company, role: job.role },
    nowcoder_read_diagnostic: nowcoderReadDiagnostic,
    providers: data.providers || [],
    site_searches: data.site_searches || [],
    search_plan: data.search_plan || [],
    grouped_results: data.grouped_results || [],
    public_access_stopped: data.public_access_stopped,
    public_access_reason: data.public_access_reason,
    public_access_detail: data.public_access_detail,
    candidate_access_grants: data.candidate_access_grants,
    observed_search_paths: data.observed_search_paths,
    nowcoder_site_searches: data.nowcoder_site_searches,
    nowcoder_site_source_count: data.nowcoder_site_source_count,
    result_count: results.length,
    primary_source_count: data.primary_source_count,
    supplemental_source_count: data.supplemental_source_count,
    rejected_irrelevant_count: data.rejected_irrelevant_count,
    discovery_exhausted: data.discovery_exhausted,
    results: verbose ? results : results.slice(0, 30),
    results_truncated_in_probe_output: !verbose && results.length > 30,
    captures,
  }, null, 2));
} finally {
  await application.close().catch(() => {});
}
