import assert from "node:assert/strict";
import test from "node:test";
import { saveResumeFile } from "../electron/resume-files.mjs";

const base = { apiBase: "http://127.0.0.1:8766", controlToken: "test-token", resumeId: "resume-test-1", format: "pdf", downloadsPath: "C:/Downloads" };
test("resume export saves verified bytes to the user-selected path", async () => {
  let written;
  const result = await saveResumeFile({ ...base,
    fetchImpl: async (url, options) => {
      assert.ok(url.endsWith("/api/resumes/resume-test-1/pdf"));
      assert.equal(options.headers["x-fetchcv-control-token"], "test-token");
      return new Response("%PDF-1.7\nfixture", { headers: { "content-type": "application/pdf" } });
    },
    showSaveDialog: async options => { assert.deepEqual(options.filters[0].extensions, ["pdf"]); return { canceled: false, filePath: "C:/chosen/resume.pdf" }; },
    writeFile: async (target, bytes) => { written = { target, bytes }; },
  });
  assert.equal(result.ok, true);
  assert.equal(written.target, "C:/chosen/resume.pdf");
  assert.equal(written.bytes.toString(), "%PDF-1.7\nfixture");
});
test("canceling the Word destination writes nothing", async () => {
  const result = await saveResumeFile({ ...base, format: "docx",
    fetchImpl: async () => new Response("word", { headers: { "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } }),
    showSaveDialog: async options => { assert.deepEqual(options.filters[0].extensions, ["docx"]); return { canceled: true }; },
    writeFile: async () => assert.fail("canceled export wrote a file"),
  });
  assert.deepEqual(result, { canceled: true });
});
test("export errors never become files or open a save dialog", async () => {
  for (const status of [200, 422]) {
    await assert.rejects(saveResumeFile({ ...base,
      fetchImpl: async () => Response.json({ code: "resume_export_unverified", message: "请重新核验" }, { status }),
      showSaveDialog: async () => assert.fail("invalid artifact opened save dialog"),
      writeFile: async () => assert.fail("error JSON saved as PDF"),
    }), /请重新核验/);
  }
});
