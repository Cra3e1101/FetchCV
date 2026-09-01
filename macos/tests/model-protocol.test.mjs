import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeAssistantContent } from "../src/lib/model-protocol.js";

test("removes DSML tool protocol from persisted assistant content", () => {
  const raw = '<|DSML|tool_calls><|DSML|invoke name="search_web"><|DSML|parameter name="query" string="true">北京天气</|DSML|parameter></|DSML|invoke></|DSML|tool_calls>';
  assert.equal(sanitizeAssistantContent(raw), "");
  assert.equal(sanitizeAssistantContent(`先查询。\n${raw}\n查询完成。`), "先查询。\n\n查询完成。");
});

test("removes full-width double-pipe DSML returned by compatible providers", () => {
  const raw = '<｜｜DSML｜｜tool_calls>\n<｜｜DSML｜｜invoke name="search_web">\n<｜｜DSML｜｜parameter name="query" string="true">昌平天气</｜｜DSML｜｜parameter>\n</｜｜DSML｜｜invoke>\n</｜｜DSML｜｜tool_calls>';
  assert.equal(sanitizeAssistantContent(raw), "");
});

test("leaves normal assistant content unchanged", () => {
  assert.equal(sanitizeAssistantContent("北京明天预计有雨。"), "北京明天预计有雨。");
});
