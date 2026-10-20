import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLocalNoteOcr } from "../electron/local-note-ocr.mjs";

test("local OCR returns immediately, runs two workers, preserves order and survives restart", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fetchcv-local-ocr-"));
  let active = 0, peak = 0;
  const queue = createLocalNoteOcr({ directory, recognize: async file => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 15));
    active--; return path.basename(file);
  } });
  const id = "a".repeat(64);
  const files = ["1.png", "2.png", "3.png"].map(name => path.join(directory, name));
  const job = queue.enqueue(id, files);
  assert.equal(job.completed, 0);
  while (queue.result(id).status !== "completed") await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(peak, 2);
  assert.deepEqual(queue.result(id).pages.map(page => page.text), ["1.png", "2.png", "3.png"]);
  const restored = createLocalNoteOcr({ directory });
  assert.equal(restored.result(id).completed, 3);
  assert.throws(() => restored.result("../secret"), /invalid_ocr_id/);
});
