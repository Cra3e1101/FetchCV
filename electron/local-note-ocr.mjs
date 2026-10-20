import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);

// The queue processes local files only. It never navigates or fetches URLs.
export function createLocalNoteOcr({ directory, binary, recognize, concurrency = 2 }) {
  const queue = [];
  const jobs = new Map();
  let active = 0;
  const read = recognize || (async file => {
    const { stdout } = await runFile(binary, [file, "stdout", "-l", "chi_sim+eng", "--psm", "6"],
      { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024, encoding: "utf8" });
    return stdout.trim().slice(0, 12000);
  });
  function save(job) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `${job.id}.json`), JSON.stringify(job), "utf8");
  }
  function pump() {
    while (active < concurrency && queue.length) {
      const { job, file, index } = queue.shift();
      active++;
      job.status = "running";
      Promise.resolve().then(() => read(file)).then(text => {
        job.pages[index] = { index: index + 1, text, status: text ? "needs_review" : "no_text" };
        fs.writeFileSync(`${file}.txt`, text, "utf8");
      }).catch(() => { job.pages[index] = { index: index + 1, text: "", status: "failed" }; }).finally(() => {
        active--;
        job.completed++;
        if (job.completed === job.total) job.status = "completed";
        save(job);
        pump();
      });
    }
  }
  return {
    enqueue(id, files) {
      if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("invalid_ocr_id");
      if (jobs.has(id)) return jobs.get(id);
      if (queue.length + files.length > 120) return { id, status: "busy", total: 0, completed: 0, pages: [] };
      const job = { id, status: files.length ? "queued" : "no_images", total: files.length, completed: 0, pages: [] };
      jobs.set(id, job);
      save(job);
      files.forEach((file, index) => queue.push({ job, file, index }));
      pump();
      return { ...job };
    },
    result(id) {
      if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("invalid_ocr_id");
      if (jobs.has(id)) return jobs.get(id);
      try {
        const job = JSON.parse(fs.readFileSync(path.join(directory, `${id}.json`), "utf8"));
        return job.status === "queued" || job.status === "running" ? { ...job, status: "interrupted" } : job;
      } catch { return { id, status: "not_found", pages: [] }; }
    },
  };
}
