import assert from "node:assert/strict";
import test from "node:test";
import { buildKnowledgeGraph } from "../src/lib/interview-knowledge-graph.js";

const byKind = (graph, kind) => graph.nodes.filter(node => node.kind === kind);
const source = (id, extra = {}) => ({ id, company: "星云科技", business_unit: "商业化", role: "产品经理", title: `面经 ${id}`, ...extra });
const brief = (id, extra = {}) => ({ id, company: "星云科技", business_unit: "商业化", role: "产品经理", source_ids: [], ...extra });
const edgeTo = (graph, role, sourceId) => graph.edges.find(edge => edge.source === role.id && edge.target === `source:${sourceId}`);

test("repeated company and role records share one entity while preserving brief versions and original source IDs", () => {
  const older = brief("b-old", { source_ids: ["s1", "s1"], updated_at: "2026-01-01T00:00:00Z", common_questions: [{ question: "指标如何定义？", frequency: 9 }] });
  const newer = brief("b-new", { source_ids: ["s1", "s2"], created_at: "2026-10-20T00:00:00Z" });
  const s1 = source("s1", { extracted_questions: [{ question: "指标如何定义？", evidence_quote: "实际问题" }] });
  const graph = buildKnowledgeGraph({ sources: [s1, source("s2")], briefs: [older, newer] });
  const [company] = byKind(graph, "company"), [role] = byKind(graph, "role");
  assert.equal(byKind(graph, "company").length, 1);
  assert.equal(byKind(graph, "role").length, 1);
  assert.deepEqual(role.sourceIds, ["s1", "s2"]);
  assert.deepEqual(company.briefIds, ["b-new", "b-old"]);
  assert.deepEqual(role.briefs, [newer, older]);
  assert.equal(role.briefs[1], older);
  assert.deepEqual(edgeTo(graph, role, "s1").briefIds, ["b-new", "b-old"]);
  assert.equal(graph.nodes.find(node => node.id === "source:s1").source, s1);
  assert.equal(graph.edges.length, 3);
  assert.equal(graph.nodes.some(node => node.kind === "question"), false);
  assert.equal(role.frequency, undefined);
});

test("entity normalization is exact, separates business units, and never merges aliases or related keywords", () => {
  const graph = buildKnowledgeGraph({ sources: [
    source("a", { company: "  ＡＣＭＥ   Inc ", role: "ＰＭ", business_unit: "商业化" }),
    source("b", { company: "acme inc", role: "pm", business_unit: "商业化" }),
    source("c", { company: "ACME Inc", role: "PM", business_unit: "国际业务" }),
    source("d", { company: "ACME", role: "产品经理", business_unit: "商业化" }),
  ] });
  assert.equal(byKind(graph, "company").length, 2);
  assert.equal(byKind(graph, "role").length, 3);
  assert.deepEqual(graph.nodes.find(node => node.id === 'role:["acme inc","商业化","pm"]').sourceIds, ["a", "b"]);
  assert.equal(graph.edges.filter(edge => edge.kind === "role-source").length, 4);
});

test("IDs and relationships survive reordering and adding unrelated records without delimiter collisions", () => {
  const sources = [source("a", { company: "A|B", business_unit: "C", role: "D" }), source("b", { company: "A", business_unit: "B|C", role: "D" })];
  const briefs = [brief("z", { source_ids: ["a"] }), brief("a", { source_ids: ["b"] })];
  const graph = buildKnowledgeGraph({ sources, briefs });
  assert.deepEqual(buildKnowledgeGraph({ sources: [...sources].reverse(), briefs: [...briefs].reverse() }), graph);
  const extended = buildKnowledgeGraph({ sources: [source("unrelated", { company: "Elsewhere" }), ...sources], briefs });
  for (const node of graph.nodes) assert.ok(extended.nodes.some(item => item.id === node.id));
  for (const edge of graph.edges) assert.ok(extended.edges.some(item => item.id === edge.id));
  assert.notEqual(byKind(graph, "role").find(node => node.sourceIds.includes("a") && node.company === "A|B").id,
    byKind(graph, "role").find(node => node.sourceIds.includes("b") && node.company === "A").id);
});

test("explicit shared references can cross companies without changing a source's recorded company or inventing missing sources", () => {
  const shared = source("shared", { company: "甲公司", role: "分析师" });
  const graph = buildKnowledgeGraph({ sources: [shared], briefs: [
    brief("b1", { company: "乙公司", source_ids: ["shared", "missing", "shared"] }),
    brief("b2", { company: "丙公司", source_ids: ["shared"] }),
    brief("b3", { company: "丁公司", common_questions: [{ question: "分析师", source_ids: ["shared"] }] }),
  ] });
  const node = graph.nodes.find(item => item.id === "source:shared");
  assert.equal(node.company, "甲公司");
  assert.equal(node.source, shared);
  assert.deepEqual(node.briefIds, ["b1", "b2"]);
  assert.equal(byKind(graph, "source").length, 1);
  assert.equal(graph.nodes.some(item => item.id === "source:missing"), false);
  assert.equal(graph.edges.filter(edge => edge.target === node.id).length, 3);
  const unrelatedRole = byKind(graph, "role").find(item => item.company === "丁公司");
  assert.deepEqual(unrelatedRole.sourceIds, []);
});

test("uncategorized sources and briefs without sources remain reachable without merging unknown roles across companies", () => {
  const graph = buildKnowledgeGraph({ sources: [
    { id: "orphan" }, { id: "a", company: "甲公司" }, { id: "b", company: "乙公司" },
    { id: "named", company: "未归类", role: "未指定岗位" },
  ], briefs: [brief("empty", { source_ids: ["unavailable"] })] });
  assert.equal(byKind(graph, "source").length, 4);
  assert.equal(byKind(graph, "role").length, 5);
  const orphan = graph.nodes.find(item => item.id === "source:orphan");
  assert.equal(orphan.company, "未归类");
  assert.equal(orphan.role, "未指定岗位");
  assert.ok(graph.edges.some(edge => edge.target === orphan.id));
  const emptyRole = byKind(graph, "role").find(item => item.briefIds.includes("empty"));
  assert.deepEqual(emptyRole.sourceIds, []);
  assert.equal(emptyRole.briefs.length, 1);
});

test("building never mutates input records, evidence, arrays, or their ordering", () => {
  const input = {
    sources: [source("s", { extracted_questions: [{ question: "A", question_evidence: { independence_status: "partial" } }] })],
    briefs: [brief("b", { source_ids: ["s", "s"], common_questions: [{ question: "A", frequency: 9 }] })],
  };
  const before = structuredClone(input);
  const freeze = value => {
    if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  };
  freeze(input);
  buildKnowledgeGraph(input);
  assert.deepEqual(input, before);
});

test("duplicate record IDs produce one node or brief version, choosing the latest stored revision", () => {
  const oldSource = source("s", { updated_at: "2026-01-01", title: "旧版" });
  const newSource = source("s", { updated_at: "2026-10-01", title: "新版" });
  const older = brief("b", { updated_at: "invalid", created_at: "2026-01-01" });
  const newer = brief("b", { updated_at: "2026-10-01", source_ids: ["s"] });
  const graph = buildKnowledgeGraph({ sources: [oldSource, newSource], briefs: [older, newer] });
  assert.equal(byKind(graph, "source").length, 1);
  assert.equal(byKind(graph, "source")[0].source, newSource);
  assert.deepEqual(byKind(graph, "role")[0].briefs, [newer]);
});

test("empty and malformed record collections are safe and the full graph is never capped", () => {
  assert.deepEqual(buildKnowledgeGraph(), { nodes: [], edges: [] });
  assert.deepEqual(buildKnowledgeGraph({ sources: null, briefs: [null, {}, "bad"] }), { nodes: [], edges: [] });
  const graph = buildKnowledgeGraph({ sources: Array.from({ length: 250 }, (_, index) => source(`s${index}`)) });
  assert.equal(byKind(graph, "source").length, 250);
  assert.equal(byKind(graph, "role")[0].sourceIds.length, 250);
});
