import assert from "node:assert/strict";
import test from "node:test";

import * as aiModule from "@earendil-works/pi-ai";
import * as coreModule from "@earendil-works/pi-agent-core";
import * as nodeModule from "@earendil-works/pi-agent-core/node";

import { createFetchCVHarness } from "../electron/pi/fetchcv-harness.mjs";
import { sanitizeOutboundMessages, sanitizeOutboundText, sanitizeOutboundValue } from "../electron/pi/context-policy.mjs";
import {assembleContext} from '../electron/pi/context-budget.mjs';
import { createProviderAdapter } from "../electron/pi/provider-adapter.mjs";

const streams = { stream() { throw new Error("not used"); }, streamSimple() { throw new Error("not used"); } };
const openAiModule = { openAICompletionsApi: () => streams };
const anthropicModule = { anthropicMessagesApi: () => streams };
const provider = { providerName: "Test provider", protocol: "openai", baseUrl: "https://api.example.com/v1", model: "test-model", contextWindow: 8192, apiKey: "secret-key" };

test("FetchCV uses Pi Models for request-time provider authentication", async () => {
  const runtime = createProviderAdapter(provider, aiModule, openAiModule, anthropicModule);
  const auth = await runtime.models.getAuth(runtime.model);

  assert.equal(runtime.model.provider, "fetchcv-openai");
  assert.equal(auth.auth.apiKey, "secret-key");
  assert.equal(runtime.streamOptions.metadata.runtime, "fetchcv-pi-harness");
});

test("FetchCV creates a real Pi AgentHarness with restored session history", async () => {
  const bootstrap = {
    session_id: "pi:test-harness",
    system_prompt: "Use FetchCV tools and verified evidence.",
    history: [
      { role: "user", content: "Earlier question", timestamp: 1 },
      { role: "assistant", content: "Earlier answer", timestamp: 2 },
    ],
  };
  const { harness, session } = await createFetchCVHarness({
    bootstrap,
    provider,
    thinkingLevel: "deep",
    tools: [],
    modules: [coreModule, nodeModule, aiModule, openAiModule, anthropicModule],
  });
  const context = await session.buildContext();

  assert.equal(harness.constructor.name, "AgentHarness");
  assert.equal(harness.getThinkingLevel(), "high");
  assert.equal(context.messages.length, 2);
  assert.equal(context.messages[1].content[0].text, "Earlier answer");
});

test("context policy removes entire old turns while retaining the active turn and provider-required thinking", () => {
  const messages = [
    {role:'user',content:[{type:'text',text:'old '.repeat(3000)}]},
    { role: "assistant", content: [{ type: "thinking", thinking: "old" }, { type: "text", text: "old answer" }] },
    {role:'user',content:[{type:'text',text:'current'}]},
    { role: "assistant", content: [{ type: "thinking", thinking: "recent" },{type:'toolCall',id:'r',name:'read',arguments:{}}] },
    { role: "toolResult",toolCallId:'r', content: [{ type: "text", text: "LATEST-EVIDENCE" }] },
  ];
  const compacted=assembleContext(messages,{model:{contextWindow:8192,maxTokens:1024},tools:[],systemPrompt:'',protectedFrom:2}).messages;
  assert.equal(compacted.at(-1).content[0].text, "LATEST-EVIDENCE");
  assert.equal(compacted.length,3);assert.equal(compacted[1].content[0].thinking,'recent');
});

test("outbound privacy policy redacts stable identity values in every model message", () => {
  const profile = {
    mode: "redacted_remote",
    literals: ["高子强", "北京市海淀区"],
  };
  const input = "高子强 13812345678 user@example.com 110101199901011234 北京市海淀区 D:\\resume\\private.pdf";
  const redacted = sanitizeOutboundText(input, profile);
  assert.doesNotMatch(redacted, /高子强|13812345678|user@example\.com|110101199901011234|北京市海淀区|private\.pdf/);
  assert.match(redacted, /<PRIVATE_1>|<PHONE>|<EMAIL>|<IDENTITY_NUMBER>|<LOCAL_PATH>/);

  const messages = sanitizeOutboundMessages([
    { role: "user", content: [{ type: "text", text: input }] },
    { role: "assistant", content: [{ type: "thinking", thinking: input }] },
  ], profile);
  assert.doesNotMatch(JSON.stringify(messages), /高子强|13812345678|user@example\.com|110101199901011234|private\.pdf/);
});

test("outbound privacy policy removes credentials from text, URLs, headers and nested tool data", () => {
  const profile = { mode: "redacted_remote", literals: [] };
  const privateKey = "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----";
  const payload = {
    headers: {
      Authorization: "Bearer bearer-secret-value",
      Cookie: "session=secret-cookie",
    },
    input_schema: {
      description: `password=hunter2 api_key=key-123 ${privateKey}`,
      callback: "https://example.com/path?access_token=query-secret&safe=visible",
    },
    content: [{ type: "text", text: "Bearer free-text-token-123456 /Users/person/private/resume.pdf \\\\server\\private\\resume.pdf" }],
  };
  const redacted = sanitizeOutboundValue(payload, profile);
  const encoded = JSON.stringify(redacted);

  assert.doesNotMatch(encoded, /bearer-secret-value|secret-cookie|hunter2|key-123|abc123|query-secret|person|server\\\\private/);
  assert.match(encoded, /<CREDENTIAL>|<PRIVATE_KEY>|<LOCAL_PATH>/);
  assert.match(encoded, /safe=visible/);
});
