// Synthetic, local-only comparison. Run: node scripts/benchmark-context.mjs
// This immutable baseline was HEAD before the reference-first context change.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {assembleContext} from '../electron/pi/context-budget.mjs';
import {trimToolResult} from '../electron/pi/context-policy.mjs';

const baselineCommit = 'b79301fa1b2ea91bed542476cb4d8a2cd71fd71c';
const root = fileURLToPath(new URL('../', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '');
const sourcePaths = ['electron/pi/context-budget.mjs', 'electron/pi/context-policy.mjs'];
const gitSource = path => execFileSync('git', [
  '-c', `safe.directory=${root}`, 'show', `${baselineCommit}:${path}`,
], {cwd:root, encoding:'utf8', windowsHide:true});
const moduleURL = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const baselinePolicyURL = moduleURL(gitSource(sourcePaths[1]));
const baselineSource = gitSource(sourcePaths[0]).replace("'./context-policy.mjs'", JSON.stringify(baselinePolicyURL));
assert(!baselineSource.includes("'./context-policy.mjs'"), 'Baseline module import could not be resolved');
const baseline = await import(moduleURL(baselineSource));
const currentSourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [
  path, createHash('sha256').update(await readFile(new URL(`../${path}`, import.meta.url))).digest('hex'),
])));

const user = text => ({role:'user', content:[{type:'text', text}]});
const reference = {tool:'read_tool_result', arguments:{result_id:'b'.repeat(64)}};
const old = [
  user('沿用已经确认的岗位方向；不要虚构业绩'),
  {role:'assistant', content:[{type:'toolCall', id:'history', name:'read', arguments:{}}]},
  {role:'toolResult', toolCallId:'history', content:[{type:'text', text:JSON.stringify({data:{text:'长材料'.repeat(4000)}, _result_reference:reference})}]},
  {role:'assistant', content:[{type:'text', text:'已确认岗位方向'}]},
];
const messages = [...old, user('请继续修改')];
const options = {model:{contextWindow:8192, maxTokens:1024}, tools:[], systemPrompt:'rules', protectedFrom:old.length};
const metrics = assembled => ({
  selectedMessages:assembled.messages.length,
  visibleUserMessages:assembled.messages.filter(message => message.role === 'user').length,
  estimatedInputBytes:assembled.manifest.estimatedInputBytes,
  inputAllowance:assembled.manifest.inputAllowance,
  droppedTurns:assembled.manifest.droppedGroups.length,
});
const before = baseline.assembleContext(messages, options);
const after = assembleContext(messages, options);
assert(after.manifest.estimatedInputBytes <= after.manifest.inputAllowance);
const historyCase = {
  scenario:'historical-rereadable-result', inputBytes:Buffer.byteLength(JSON.stringify(messages)),
  before:metrics(before), after:{...metrics(after), toolBytesSaved:after.manifest.trimmedToolResults.reduce((sum, result) => sum + result.savedBytes, 0)},
};

const ids = Array.from({length:120}, (_, i) => `fact_${i}`);
// Both assemblers receive exactly the same gateway preview.
const view = trimToolResult({data:{fact_ids:ids, jd:'JD'.repeat(50000)}}, 50000, reference);
const active = [
  user('inspect'),
  {role:'assistant', content:[{type:'toolCall', id:'call', name:'inspect', arguments:{}}]},
  {role:'toolResult', toolCallId:'call', content:[{type:'text', text:view}]},
];
const settings = {...options, model:{contextWindow:12000, maxTokens:2000}, protectedFrom:0};
const factsBefore = baseline.assembleContext(active, settings);
const factsAfter = assembleContext(active, settings);
assert(factsAfter.manifest.estimatedInputBytes <= factsAfter.manifest.inputAllowance);
const factsMetrics = assembled => ({
  factIdsVisible:JSON.parse(assembled.messages.at(-1).content[0].text).fact_ids?.length ?? 0,
  estimatedInputBytes:assembled.manifest.estimatedInputBytes,
  inputAllowance:assembled.manifest.inputAllowance,
});

console.log(JSON.stringify({
  synthetic:true, baselineCommit, currentSourceHashes,
  cases:[historyCase, {scenario:'second-stage-fact-index', before:factsMetrics(factsBefore), after:factsMetrics(factsAfter)}],
  limitations:[
    'Synthetic fixtures only; no personal database, external service or language model is accessed.',
    'Counts measure visible messages, fact identifiers and serialized UTF-8 bytes, not tokenizer output or answer accuracy.',
    'The new context may use more bytes because it retains constraints and structured facts that the baseline discarded.',
    'Requires the pinned baseline commit in local Git history; it never downloads missing history.',
  ],
}, null, 2));
