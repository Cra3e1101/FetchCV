import { assertToolPairs, contextMemoryBlock, hydratedMessages, sanitizeOutboundMessages, sanitizeOutboundText } from "./context-policy.mjs";
import { createProviderAdapter, THINKING_LEVEL } from "./provider-adapter.mjs";
import { prepareRequestRecord } from "./request-record.mjs";
import {assembleContext} from './context-budget.mjs';
import {compatiblePayload} from './compatible-payload.mjs';

export async function createFetchCVHarness({
  bootstrap,
  provider,
  thinkingLevel,
  tools,
  modules,
  taskMode = false,
  recordRequest = async () => {},
  onContext = async () => {},
  getInputReferences = () => [],
  assertCapabilities = () => {},
}) {
  const [coreModule, nodeModule, aiModule, openAiModule, anthropicModule] = modules;
  const { AgentHarness, InMemorySessionRepo } = coreModule;
  const { NodeExecutionEnv } = nodeModule;
  const { protocol, model, models, streamOptions } = createProviderAdapter(provider, aiModule, openAiModule, anthropicModule);
  const repo = new InMemorySessionRepo();
  const session = await repo.create({ id: bootstrap.session_id });

  const history=taskMode?[]:sanitizeOutboundMessages(hydratedMessages(bootstrap, model), bootstrap.outbound_privacy);
  for (const message of history) await session.appendMessage(message);
  let systemPrompt=sanitizeOutboundText(bootstrap.system_prompt, bootstrap.outbound_privacy);
  const memory=contextMemoryBlock(bootstrap);
  const pinnedMessages=memory?[{role:"user",content:[{type:"text",text:sanitizeOutboundText(memory,bootstrap.outbound_privacy)}],timestamp:0}]:[];
  let activeTools = tools;

  const harness = new AgentHarness({
    env: new NodeExecutionEnv({ cwd: process.cwd() }),
    session,
    models,
    model,
    systemPrompt: (context) => {
      assertCapabilities();
      activeTools = context.activeTools;
      if (Array.isArray(bootstrap.system_prompt_sections)) {
        const names=new Set(activeTools.map(tool=>tool.name));
        systemPrompt=sanitizeOutboundText(bootstrap.system_prompt_sections.filter(part=>(part.requires_all??[]).every(name=>names.has(name))&&!(part.excludes??[]).some(name=>names.has(name))).map(part=>part.text).filter(Boolean).join("\n"),bootstrap.outbound_privacy);
      }
      return systemPrompt;
    },
    tools,
    activeToolNames: tools.map((tool) => tool.name),
    thinkingLevel: THINKING_LEVEL[thinkingLevel] || "medium",
    steeringMode: "one-at-a-time",
    followUpMode: "one-at-a-time",
    streamOptions,
  });

  let contextManifest=null,selectedMessages=[],assemblyError=null;
  harness.on("context", async (event) => {
    try{
    assertToolPairs(event.messages);
    const trustedInputs=getInputReferences().map(input=>({...input,text:sanitizeOutboundText(input.text,bootstrap.outbound_privacy)}));
    const assembled=assembleContext(sanitizeOutboundMessages(event.messages,bootstrap.outbound_privacy),{model,tools:activeTools,systemPrompt,protectedFrom:history.length,trustedInputs,pinnedMessages});
    contextManifest=assembled.manifest;selectedMessages=assembled.messages;
    return { messages:selectedMessages };
    }catch(error){assemblyError=error;throw error;}
  });
  let requestSequence = 0;
  harness.on("before_provider_payload", async event => {
    try{
    const prepared = prepareRequestRecord(compatiblePayload(event.payload,provider), { model: event.model, privacy: bootstrap.outbound_privacy, tools:activeTools, sequence: ++requestSequence,contextManifest });
    await recordRequest(prepared.record);
    await onContext(selectedMessages);
    return { payload: prepared.payload };
    }catch(error){assemblyError=error;throw error;}
  });
  return { harness, session, protocol, model,assertAssembly:()=>{if(assemblyError)throw assemblyError;} };
}
