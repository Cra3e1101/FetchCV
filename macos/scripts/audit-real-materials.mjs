import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";
import { findFreePort } from "../electron/sidecar.mjs";

const root = path.resolve(import.meta.dirname, "..");
const sourceProvider = path.join(os.homedir(), "Library", "Application Support", "fetchcv-desktop", "settings", "model-provider.json");
const resumePath = path.join(root, "test use", "高子强的简历.pdf");
const jdText = fs.readFileSync(path.join(root, "test use", "JD.txt"), "utf8");
const nextJob = jdText.indexOf("\n\n字节跳动\nAI数据开发实习生");
const jd = jdText.slice(0, nextJob > 0 ? nextJob : undefined).trim();
const outputDir = path.join(root, "tmp", "audit");
const reportPath = path.join(outputDir, "real-materials-live-audit.json");
const conversationScreenshot = path.join(outputDir, "real-materials-conversation.png");
const resumeScreenshot = path.join(outputDir, "real-materials-resume.png");
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "fetchcv-real-audit-"));
const port = await findFreePort();

assert.equal(fs.existsSync(sourceProvider), true, "请先在 FetchCV 中保存一个可用模型连接");
fs.mkdirSync(path.join(userData, "settings"), { recursive: true });
fs.copyFileSync(sourceProvider, path.join(userData, "settings", "model-provider.json"));
fs.mkdirSync(outputDir, { recursive: true });

const report = { started_at: new Date().toISOString(), input: { resume: path.basename(resumePath), job: "字节跳动 · 策略运营实习生-TikTok Shop" }, stages: [] };
const application = await electron.launch({
  args: [root], cwd: root,
  env: { ...process.env, FETCHCV_API_PORT: String(port), FETCHCV_E2E_USER_DATA: userData },
  timeout: 45000,
});

try {
  const window = await application.firstWindow({ timeout: 35000 });
  await window.getByText("FetchCV", { exact: true }).first().waitFor({ state: "visible", timeout: 25000 });
  const desktop = await window.evaluate(() => ({ apiBase: window.appRuntime.apiBase, apiToken: window.appRuntime.apiToken }));
  const headers = { "content-type": "application/json", "X-FetchCV-Control-Token": desktop.apiToken };
  const request = async (method, url, body, extraHeaders = {}) => {
    const response = await fetch(`${desktop.apiBase}${url}`, {
      method, headers: { ...headers, ...extraHeaders }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${method} ${url} (${response.status}): ${payload?.error?.message || payload?.detail || JSON.stringify(payload)}`);
    return payload;
  };
  const get = (url) => request("GET", url);
  const post = (url, body, extraHeaders) => request("POST", url, body, extraHeaders);

  const runtime = await get("/api/runtime/status");
  assert.equal(runtime.configured, true, "复制的模型连接无法在隔离审计环境中解密");
  report.runtime = { provider: runtime.provider_name, model: runtime.model, protocol: runtime.provider_protocol };

  const preview = await post("/api/imports/resume-pdf/preview", { source_path: resumePath });
  report.import_preview = {
    pages: preview.page_count,
    profile_name: preview.profile.name,
    sections: preview.sections.map((item) => ({ key: item.key, title: item.title, entries: item.entry_count })),
    text_length: preview.text_length,
  };
  const imported = await post("/api/imports/resume-pdf", { source_path: resumePath, candidate_name: preview.profile.name });
  const job = await post("/api/jobs", { candidate_id: imported.candidate_id, company: "字节跳动", role: "策略运营实习生-TikTok Shop", jd_raw: jd, source_type: "real_material_audit" });

  let run = await post("/api/agent-runs", { candidate_id: imported.candidate_id, job_id: job.id, auto_start: true }, { "Idempotency-Key": `real-audit-${Date.now()}` });
  report.stages.push(run.current_stage);
  let workspace = await get(`/api/jobs/${job.id}/workspace`);
  report.job_analysis = {
    responsibilities: workspace.profile?.responsibilities || [],
    hard_requirements: workspace.profile?.hard_requirements || [],
    competencies: workspace.profile?.competencies || [],
    keywords: workspace.profile?.keywords || [],
  };

  const factApproval = workspace.approvals.find((item) => item.action_type === "confirm_relevant_facts" && item.status === "pending");
  assert.ok(factApproval, `没有生成经历确认请求，当前阶段为 ${run.current_stage}`);
  const ranked = factApproval.decision_payload?.items || [];
  const recommended = new Set(ranked.filter((item) => item.recommended).map((item) => item.fact_id));
  const factsByExperience = workspace.facts.reduce((map, fact) => {
    const experienceId = fact.normalized_value?.experience_id || fact.subject_id;
    if (experienceId) (map[experienceId] ||= []).push(fact.id);
    return map;
  }, {});
  const selectedExperiences = workspace.experiences.filter((experience) => experience.kind === "education" || (factsByExperience[experience.id] || experience.fact_ids || []).some((id) => recommended.has(id)));
  const selectedFactIds = [...new Set(selectedExperiences.flatMap((experience) => experience.fact_ids?.length ? experience.fact_ids : factsByExperience[experience.id] || []))];
  assert.ok(selectedFactIds.length, "模型没有推荐任何可确认经历");
  report.fact_match = {
    facts_total: ranked.length,
    facts_recommended: ranked.filter((item) => item.recommended).length,
    selected_experiences: selectedExperiences.map((item) => ({ kind: item.kind, title: item.title, organization: item.organization, role: item.role })),
    samples: ranked.filter((item) => item.recommended).slice(0, 8).map((item) => ({ category: item.category, reason: item.match_reason, requirements: item.matched_terms })),
  };
  await post(`/api/agent-runs/${run.id}/facts/review`, { approval_id: factApproval.id, fact_ids: selectedFactIds, approved_by: "real-material-audit" });

  run = await post(`/api/agent-runs/${run.id}/resume`, {});
  report.stages.push(run.current_stage);
  workspace = await get(`/api/jobs/${job.id}/workspace`);
  const proposalApproval = workspace.approvals.find((item) => item.action_type === "apply_resume_changes" && item.status === "pending");
  assert.ok(proposalApproval, `没有生成改写审批，当前阶段为 ${run.current_stage}`);
  report.proposals = workspace.proposals.map((item) => ({
    section: item.section, before: item.before, after: item.after, reason: item.reason,
    evidence: item.jd_evidence, risk: item.risk_level, fact_ids: item.fact_ids,
  }));
  const decisions = workspace.proposals.map((item) => ({ proposal_id: item.id, decision: item.risk_level === "high" ? "rejected" : "accepted" }));
  await post(`/api/agent-runs/${run.id}/proposals/review`, { approval_id: proposalApproval.id, approved_by: "real-material-audit", decisions });

  run = await post(`/api/agent-runs/${run.id}/resume`, {});
  report.stages.push(run.current_stage);
  workspace = await get(`/api/jobs/${job.id}/workspace`);
  const publishApproval = workspace.approvals.find((item) => item.action_type === "publish_assets" && item.status === "pending");
  assert.ok(publishApproval, `没有生成最终检查审批，当前阶段为 ${run.current_stage}`);
  await post(`/api/agent-runs/${run.id}/publish-approval`, { approval_id: publishApproval.id, approved_by: "real-material-audit" });
  run = await post(`/api/agent-runs/${run.id}/resume`, {});
  report.stages.push(run.current_stage);
  workspace = await get(`/api/jobs/${job.id}/workspace`);

  const resume = workspace.resumes[0];
  assert.ok(resume, "最终阶段没有岗位简历版本");
  const snapshot = resume.content_json?.editor_snapshot || {};
  report.result = {
    stage: run.current_stage,
    messages: workspace.messages.map((item) => item.content),
    proposal_count: workspace.proposals.length,
    accepted_count: decisions.filter((item) => item.decision === "accepted").length,
    resume_sections: (snapshot.sections || []).map((item) => ({ id: item.id, title: item.title, items: item.items?.length || 0 })),
    template: snapshot.template,
    generation_mode: resume.content_json?.generation_mode,
  };

  await window.reload();
  await window.getByRole("button", { name: "字节跳动 策略运营实习生-TikTok Shop" }).click();
  await window.screenshot({ path: conversationScreenshot });
  await window.getByRole("button", { name: "简历", exact: true }).click();
  await window.locator('iframe[title="FetchCV 正式 PDF 预览"]').waitFor({ state: "visible", timeout: 45000 });
  await window.screenshot({ path: resumeScreenshot });
  report.result.pdf_rendered = true;
  report.completed_at = new Date().toISOString();
} catch (error) {
  report.failure = { name: error.name, message: String(error.message || error).slice(0, 2000) };
  throw error;
} finally {
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  await application.close();
  fs.rmSync(userData, { recursive: true, force: true });
}

console.log(reportPath);
