import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";
import { findFreePort } from "../electron/sidecar.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");
const sourceUserData = process.env.FETCHCV_PROBE_SOURCE_USER_DATA
  || path.join(process.env.APPDATA || "", "fetchcv-desktop");
const liveUserData = process.env.FETCHCV_PROBE_LIVE === "1";
const userData = liveUserData ? sourceUserData : fs.mkdtempSync(path.join(os.tmpdir(), "fetchcv-xhs-agent-probe-"));

const copy = (relativePath) => {
  const source = path.join(sourceUserData, relativePath);
  const destination = path.join(userData, relativePath);
  assert.equal(fs.existsSync(source), true, `Missing probe input: ${source}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
};
if (!liveUserData) {
  copy(path.join("data", "fetchcv.db"));
  copy(path.join("settings", "model-provider.json"));
  copy(path.join("settings", "xiaohongshu-session.bin"));
}

const port = await findFreePort();
const application = await electron.launch({
  args: [projectRoot],
  cwd: projectRoot,
  env: {
    ...process.env,
    FETCHCV_API_PORT: String(port),
    FETCHCV_E2E_USER_DATA: userData,
  },
  timeout: 60000,
});

try {
  const window = await application.firstWindow({ timeout: 50000 });
  await window.locator(".main-pane, .center-empty").first().waitFor({ state: "visible", timeout: 30000 });
  const runtime = await window.evaluate(() => ({
    apiBase: window.appRuntime.apiBase,
    apiToken: window.appRuntime.apiToken,
  }));
  const headers = { "x-fetchcv-control-token": runtime.apiToken };
  const request = async (pathname) => {
    const response = await fetch(`${runtime.apiBase}${pathname}`, { headers });
    const body = await response.json();
    if (!response.ok) throw new Error(`${pathname}: ${JSON.stringify(body)}`);
    return body;
  };
  const workspace = await request("/api/workspace");
  const job = workspace.jobs.find((item) => (
    String(item.company || "").includes("滴滴")
    && /两轮车|策略运营/.test(String(item.role || ""))
  ));
  assert.ok(job, "The copied workspace has no Didi two-wheel strategy-operations job");

  const startedAt = Date.now();
  const runResult = await window.evaluate(async ({ jobId }) => {
    const events = [];
    const result = await window.appRuntime.streamPiMessage({
      requestId: crypto.randomUUID(),
      jobId,
      content: "重新帮我找一下这个岗位的小红书面试经验帖子，并总结面试官可能会问的问题。只使用小红书原帖。",
      thinkingLevel: "deep",
      taskKind: null,
      attachmentPaths: [],
      quote: null,
    }, (name, payload) => {
      if (name === "reasoning") {
        events.push({
          label: payload?.event?.label || "",
          status: payload?.event?.status || "",
        });
      }
    });
    return { result, events };
  }, { jobId: job.id });

  const detail = await request(`/api/jobs/${encodeURIComponent(job.id)}/workspace`);
  const assistant = detail.messages.at(-1);
  const sources = (detail.interview_sources || []).filter((item) => item.platform === "xiaohongshu");
  const latestBrief = (detail.interview_briefs || [])[0];
  const briefSourceIds = new Set(latestBrief?.source_ids || []);
  const briefSources = sources.filter((item) => briefSourceIds.has(item.id));
  const exactSources = briefSources.filter((item) => item.metadata_json?.coverage_scope === "same_business_role");
  const companyRoleSources = briefSources.filter((item) => item.metadata_json?.coverage_scope !== "same_business_role");
  const toolNames = (assistant?.metadata_json?.tool_receipts || []).map((item) => item.tool_name);
  const bannedTools = toolNames.filter((name) => ["search_web", "read_web_page", "open_browser_page", "read_browser_page"].includes(name));
  assert.equal(assistant?.metadata_json?.task_kind, "interview_research", "Semantic mode switch was not persisted");
  assert.equal(bannedTools.length, 0, `Interview research used generic web tools: ${bannedTools.join(", ")}`);
  assert.equal(/https?:\/\/(?:www\.)?nowcoder/i.test(assistant?.content || ""), false, "Assistant linked a non-Xiaohongshu source");
  assert.ok(latestBrief, "Interview research finished without creating a structured brief");
  assert.ok(briefSources.length >= 10, `Expected the latest brief to use at least 10 Xiaohongshu sources, got ${briefSources.length}`);
  assert.ok(exactSources.length >= 1, "The latest brief has no same-business-unit source");
  assert.ok(companyRoleSources.length >= 1, "The latest brief did not broaden to company-level or unspecified-business-unit sources");
  assert.ok((latestBrief.common_questions || []).every((item) => (item.source_ids || []).length > 0), "A brief question has no source mapping");
  console.log(JSON.stringify({
    duration_ms: Date.now() - startedAt,
    assistant_excerpt: (assistant?.content || "").slice(0, 1200),
    task_kind: assistant?.metadata_json?.task_kind,
    tools: toolNames,
    source_count: sources.length,
    brief_source_count: briefSources.length,
    exact_business_source_count: exactSources.length,
    company_role_source_count: companyRoleSources.length,
    question_count: (latestBrief.common_questions || []).length,
    xiaohongshu_sources: briefSources.slice(0, 14).map((item) => ({
      title: item.title,
      url: item.source_url,
      status: item.status,
      coverage_scope: item.metadata_json?.coverage_scope,
    })),
    reasoning_event_count: runResult.events.length,
    reasoning_labels: [...new Set(runResult.events.map((item) => item.label).filter(Boolean))],
  }, null, 2));
} finally {
  await application.close().catch(() => {});
}
