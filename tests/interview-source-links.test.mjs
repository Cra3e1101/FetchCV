import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  derivedInterviewSourceDate,
  findInterviewSourceByUrl,
  formatInterviewSourceDate,
  sortInterviewSourcesNewest,
} from "../src/lib/interview-sources.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const older = {
  id: "older",
  title: "较早面经",
  source_url: "https://www.xiaohongshu.com/explore/65a58b24000000001a035e5d?xsec_token=discarded",
};
const newer = {
  id: "newer",
  title: "较新面经",
  source_url: "https://www.xiaohongshu.com/discovery/item/69a58b24000000001a035e5d",
};

test("Xiaohongshu note ids provide a stable publication-date fallback", () => {
  assert.equal(derivedInterviewSourceDate(newer.source_url), "2026-03-02T13:05:40.000Z");
  assert.equal(formatInterviewSourceDate(newer), "2026/03/02");
});

test("interview sources are sorted newest first and tokenized URLs resolve locally", () => {
  assert.deepEqual(sortInterviewSourcesNewest([older, newer]).map((item) => item.id), ["newer", "older"]);
  assert.equal(
    findInterviewSourceByUrl(
      "https://www.xiaohongshu.com/explore/69a58b24000000001a035e5d?source=webshare&xsec_token=secret",
      [older, newer],
    )?.id,
    "newer",
  );
});

test("conversation citations open original interview posts with a local backup as secondary action", () => {
  const markdown = read("src/components/AgentMarkdown.jsx");
  const message = read("src/components/AgentMessage.jsx");
  const reader = read("src/components/InterviewSourceReader.jsx");
  const bridge = read("electron/browser-bridge.mjs");

  assert.match(markdown, /isXiaohongshuSourceUrl/);
  assert.match(markdown, /onOpenInterviewSource/);
  assert.match(markdown, /formatInterviewSourceDate/);
  assert.match(markdown, /查看原帖/);
  assert.match(markdown, /openOriginalInterviewSource/);
  assert.match(message, /sortInterviewSourcesNewest/);
  assert.match(message, /本轮公开面经来源/);
  assert.match(reader, /打开原帖/);
  assert.match(reader, /navigator\.clipboard\.writeText/);
  assert.match(bridge, /published_at: xhsPublishedAt/);
  assert.match(bridge, /resolveExternal/);
});
