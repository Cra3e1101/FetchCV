import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const workspace = read("src/components/AgentWorkspace.jsx");
const interview = read("src/components/InterviewIntelligence.jsx");
const interviewReader = read("src/components/InterviewSourceReader.jsx");
const knowledge = read("src/components/InterviewKnowledgeView.jsx");
const app = read("src/App.jsx");
const styles = read("src/styles.css");
const skill = read("backend/applyos_agent/builtin_skills/interview-research/SKILL.md");
const browserBridge = read("electron/browser-bridge.mjs");
const researchState = await import("../src/lib/interview-research.js");
const { independentQuestionCount, matchingQuestionEvidence } = await import("../src/lib/interview-evidence.js");

test("completed job workspaces expose interview intelligence as a third surface", () => {
  assert.match(workspace, /tab === "interview"/);
  assert.match(workspace, /id: "interview", label: "面试"/);
  assert.match(workspace, /<SegmentedControl[^>]*tabs=\{WORKSPACE_TABS\}/);
  assert.match(workspace, /InterviewIntelligence/);
  assert.match(workspace, /准备面试/);
});

test("interview research is model driven and requests traceable tool work", () => {
  assert.match(app, /检索本地.*面试知识库/);
  assert.match(app, /有原文引文支持的问题/);
  assert.match(app, /原帖链接是主入口，本地快照只是备用/);
  assert.match(app, /随后再检索牛客、知乎、CSDN/);
  assert.match(skill, /search_interview_knowledge/);
  assert.match(skill, /capture_interview_source/);
  assert.match(skill, /build_interview_brief/);
  assert.match(skill, /Default research must include a Nowcoder discovery attempt/);
  assert.match(skill, /Never use `search_web`/i);
});

test("interview research keeps Xiaohongshu access read-only and renders local snapshots", () => {
  const api = read("src/lib/api.js");
  const backend = read("backend/applyos_api/main.py");
  assert.match(interview, /原帖优先，快照备用/);
  assert.match(interview, /失效页不会进入简报/);
  assert.match(interviewReader, /api\.interviewSource/);
  assert.match(interviewReader, /本地备份/);
  assert.doesNotMatch(api, /xiaohongshuStatus/);
  assert.doesNotMatch(api, /startXiaohongshuLogin/);
  assert.doesNotMatch(backend, /\/api\/xiaohongshu\/login/);
  assert.match(browserBridge, /data-note-id/);
  assert.match(browserBridge, /window\.__INITIAL_STATE__/);
  assert.match(browserBridge, /noteCard/);
});

test("brief UI distinguishes recurring evidence from a single experience", () => {
  assert.match(interview, /independentQuestionCount/);
  assert.match(interview, /单一经验/);
  assert.match(interview, /currentSupportingSourceIds/);
  assert.match(interview, /来源证据库/);
  assert.match(interview, /当前岗位累计/);
  assert.match(interview, /牛客等补充来源/);
  assert.match(interview, /证据有限/);
});

test("legacy and partially verified source counts never become independent frequency", () => {
  assert.equal(independentQuestionCount({ frequency: 9, confidence: "recurring" }), null);
  const question = {frequency: 2, question_evidence: {independence_status: "partial", confirmed_independent_count: 2}};
  assert.equal(independentQuestionCount(question), null);
  question.question_evidence.independence_status = "confirmed";
  assert.equal(independentQuestionCount(question), 2);
  question.frequency = 9;
  assert.equal(independentQuestionCount(question), null);
  question.frequency = 1;
  question.question_evidence.confirmed_independent_count = 1;
  assert.equal(independentQuestionCount(question), 1);
});

test("question preview does not borrow a quotation from a substring or empty question", () => {
  const source = {extracted_questions: [{question:"SQL 优化", evidence_quote:"实际原句"}]};
  assert.equal(matchingQuestionEvidence(source, {question:"SQL"}), null);
  assert.equal(matchingQuestionEvidence(source, {question:""}), null);
  assert.equal(matchingQuestionEvidence(source, {question:"sql优化"}).evidence_quote, "实际原句");
});

test("interview evidence is assigned to a dedicated right rail", () => {
  assert.match(workspace, /InterviewRail/);
  assert.match(workspace, /tab === "interview" \? "面试情报"/);
  assert.match(interview, /interview-rail-sources/);
  assert.match(interview, /高频问题/);
});

test("interview evidence uses a readable desktop typography floor", () => {
  assert.match(styles, /--text-xs:\s*0\.75rem/);
  assert.match(styles, /--ui-type-body:\s*15px/);
  assert.match(styles, /\.interview-summary > p\s*\{\s*font-size:\s*15\.5px/);
  assert.match(styles, /\.interview-question-title strong\s*\{\s*font-size:\s*13\.5px/);
  assert.match(styles, /\.interview-rail-source strong\s*\{[\s\S]*?font-size:\s*var\(--text-xs\)/);
  assert.match(styles, /\.interview-rail-common p\s*\{[\s\S]*?font-size:\s*var\(--text-xs\)/);
  assert.match(styles, /\.agent-message\.assistant\s*\{\s*font-size:\s*var\(--ui-type-body\)/);
});

test("dedicated knowledge view keeps a complete graph while searching and retains source actions", () => {
  assert.match(app, /InterviewKnowledgeView/);
  assert.match(knowledge, /面试知识/);
  assert.match(knowledge, /搜索公司、岗位或面经正文/);
  assert.match(knowledge, /allInterviewKnowledge\(""\)/);
  assert.match(knowledge, /allInterviewKnowledge\(knowledgeQuery\)/);
  assert.match(knowledge, /buildKnowledgeGraph/);
  assert.match(knowledge, /InterviewKnowledgeGraph/);
  assert.match(knowledge, /interview_sources/);
  assert.match(knowledge, /interview_briefs/);
  assert.match(knowledge, /onDeleteInterviewSource/);
  assert.match(knowledge, /onDeleteInterviewBrief/);
  assert.match(knowledge, /openOriginalInterviewSource/);
  assert.match(knowledge, /InterviewSourceReader/);
  assert.doesNotMatch(knowledge, /knowledge\.(sources|briefs)\.map/);
});

test("completed interview research remains visible even when no brief was produced", () => {
  const legacyMessages = [
    { id: "request", role: "user", content: `${researchState.LEGACY_INTERVIEW_RESEARCH_MARKER}。先检索知识库。`, metadata_json: {} },
    { id: "answer", role: "assistant", content: "本轮没有找到可核查来源，但调研结论已经完成。", metadata_json: { runtime: { evidence: { tool_count: 4 } } } },
  ];
  const result = researchState.findLatestInterviewResearchResult(legacyMessages);
  assert.equal(result.id, "answer");
  assert.equal(researchState.resolveInterviewResearchState({ result }), "completed_without_brief");
  assert.match(interview, /ResearchOutcome/);
  assert.match(interview, /已经保留/);
});

test("ordinary assistant replies are never mistaken for interview research", () => {
  const messages = [
    { id: "request", role: "user", content: "帮我看看明天天气", metadata_json: {} },
    { id: "answer", role: "assistant", content: "明天有雨。", metadata_json: {} },
  ];
  assert.equal(researchState.findLatestInterviewResearchResult(messages), null);
});
