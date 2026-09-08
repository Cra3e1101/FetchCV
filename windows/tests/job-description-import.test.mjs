import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { splitJobDescriptions } from "../src/lib/job-description.js";

const root = path.resolve(import.meta.dirname, "..");

test("splits the real multi-job JD fixture without hard-coded company names", (context) => {
  const fixture = path.join(root, "test use", "JD.txt");
  if (!fs.existsSync(fixture)) return context.skip("private real-JD fixture is not present");
  const source = fs.readFileSync(fixture, "utf8");
  const jobs = splitJobDescriptions(source);
  assert.equal(jobs.length, 7);
  assert.deepEqual(jobs.slice(0, 3).map((item) => [item.company, item.role]), [
    ["字节跳动", "策略运营实习生-TikTok Shop"],
    ["字节跳动", "AI数据开发实习生-国际支付"],
    ["字节跳动", "数据分析实习生-抖音"],
  ]);
  assert.equal(jobs.at(-1).company, "快手");
  assert.match(jobs.at(-1).jd, /独立完成SQL取数/);
});

test("returns no guessed company for a single unstructured description", () => {
  assert.deepEqual(splitJobDescriptions("负责数据分析与指标建设，熟练使用 SQL。"), []);
});
