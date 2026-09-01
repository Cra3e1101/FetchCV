import { compactToolMessages, contextMemoryBlock, hydratedMessages, sanitizeOutboundMessages, sanitizeOutboundText } from "./context-policy.mjs";
import { createProviderAdapter, THINKING_LEVEL } from "./provider-adapter.mjs";

export async function createFetchCVHarness({
  bootstrap,
  provider,
  thinkingLevel,
  tools,
  modules,
  taskMode = false,
}) {
  const [coreModule, nodeModule, aiModule, openAiModule, anthropicModule] = modules;
  const { AgentHarness, InMemorySessionRepo } = coreModule;
  const { NodeExecutionEnv } = nodeModule;
  const { protocol, model, models, streamOptions } = createProviderAdapter(provider, aiModule, openAiModule, anthropicModule);
  const repo = new InMemorySessionRepo();
  const session = await repo.create({ id: bootstrap.session_id });

  if (!taskMode) {
    for (const message of sanitizeOutboundMessages(hydratedMessages(bootstrap, model), bootstrap.outbound_privacy)) await session.appendMessage(message);
  }

  const harness = new AgentHarness({
    env: new NodeExecutionEnv({ cwd: process.cwd() }),
    session,
    models,
    model,
    systemPrompt: sanitizeOutboundText(`${bootstrap.system_prompt}${contextMemoryBlock(bootstrap)}`, bootstrap.outbound_privacy),
    tools,
    activeToolNames: tools.map((tool) => tool.name),
    thinkingLevel: THINKING_LEVEL[thinkingLevel] || "medium",
    steeringMode: "one-at-a-time",
    followUpMode: "one-at-a-time",
    streamOptions,
  });

  harness.on("context", async (event) => ({
    messages: sanitizeOutboundMessages(await compactToolMessages(event.messages), bootstrap.outbound_privacy),
  }));
  return { harness, session, protocol, model };
}
