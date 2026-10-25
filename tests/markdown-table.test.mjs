import assert from "node:assert/strict";
import test from "node:test";
import { markdownTableRows, serializeTable } from "../src/lib/markdown-table.js";

test("spreadsheet export preserves Chinese, delimiters, quotes and line breaks", () => {
  const rows = [["城市", "说明"], ["上海", 'A,B "团队"\n第二行'], ["北京", "两\t列"]];
  assert.equal(serializeTable(rows), '城市,说明\r\n上海,"A,B ""团队""\n第二行"\r\n北京,两\t列');
  assert.equal(serializeTable(rows, "\t"), '城市\t说明\r\n上海\t"A,B ""团队""\n第二行"\r\n北京\t"两\t列"');
});

test("untrusted cell text cannot become spreadsheet formulas; signed numbers remain numeric", () => {
  const row = ['=HYPERLINK("https://example.com")', " +cmd", "@SUM(A1)", "-cmd", "-12.5", "+4", "-2.3%", "未核实"];
  assert.equal(serializeTable([row]), '"\'=HYPERLINK(""https://example.com"")",\' +cmd,\'@SUM(A1),\'-cmd,-12.5,+4,-2.3%,未核实');
});

test("AST extraction keeps inline formatting text and original source URLs", () => {
  const text = value => ({ type: "text", value });
  const element = (tagName, children, properties = {}) => ({ type: "element", tagName, children, properties });
  const ast = element("table", [element("tbody", [element("tr", [
    element("td", [element("strong", [text("上海")]), text(" | 城区")]),
    element("td", [element("a", [text("来源")], { href: "https://example.com/data" }), element("br", []), element("code", [text("示例")])]),
  ])])]);
  assert.deepEqual(markdownTableRows(ast), [["上海 | 城区", "来源 (https://example.com/data)\n示例"]]);
  assert.deepEqual(markdownTableRows(undefined), []);
});
