import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createHttpClient } from "../src/lib/http-client.js";

test("HTTP client preserves authentication and handles empty responses", async () => {
  const request = createHttpClient({ baseUrl: "http://localhost", token: "test-token", fetchImpl: async (url, options) => {
    assert.equal(url, "http://localhost/api/example");
    assert.equal(options.headers["X-FetchCV-Control-Token"], "test-token");
    return new Response(null, { status: 204 });
  } });
  assert.equal(await request("/api/example"), "");
});

test("validation errors retain readable messages without retrying writes", async () => {
  let calls = 0;
  const request = createHttpClient({ baseUrl: "", fetchImpl: async () => {
    calls += 1;
    return Response.json({ detail: [{ msg: "岗位不能为空" }] }, { status: 422 });
  } });
  await assert.rejects(request("/jobs", { method: "POST" }), (error) => error instanceof ApiError && error.status === 422 && error.message === "岗位不能为空");
  assert.equal(calls, 1);
});

test("hung requests time out and caller cancellation remains distinguishable", async () => {
  const request = createHttpClient({ baseUrl: "", timeoutMs: 10, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }) });
  await assert.rejects(request("/slow"), /响应超时/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(request("/cancel", { signal: controller.signal }), { name: "AbortError" });
});
