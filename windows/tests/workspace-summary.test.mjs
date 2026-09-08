import assert from "node:assert/strict";
import test from "node:test";
import { jobProgress, summarizeJobs } from "../src/lib/workspace-summary.js";

test("exported resumes are not counted as submitted applications", () => {
  const jobs = ["published", "frozen", "awaiting_user_review", "failed", null].map((current_stage) => ({ latest_run: current_stage ? { current_stage } : null }));
  assert.deepEqual(summarizeJobs(jobs), { total: 5, review: 1, submitted: 1, preparing: 3 });
  assert.equal(jobProgress(jobs[0]).label, "已导出");
});

test("empty workspaces and cancelled jobs do not imply running tasks", () => {
  assert.deepEqual(summarizeJobs(), { total: 0, review: 0, submitted: 0, preparing: 0 });
  assert.equal(jobProgress({}).key, "new");
  assert.equal(jobProgress({ latest_run: { current_stage: "cancelled" } }).label, "已取消");
});
