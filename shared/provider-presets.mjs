// Official API connection templates, checked against linked vendor docs on 2026-10-25.
// These are editable drafts, not a model catalogue or a claim of live compatibility.
// Plan-specific endpoints must be explicit; no model limits or health results are inferred.
export const PROVIDER_PRESETS = [
  {
    id: 'openai', label: 'OpenAI', scope: '官方 API', providerName: 'OpenAI',
    website: 'https://platform.openai.com', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', model: '',
    docsUrl: 'https://platform.openai.com/docs/api-reference/chat/create',
    description: '使用 OpenAI API Key 和支持 Chat Completions 的模型。此预设不使用 Responses，也不使用 ChatGPT 订阅凭证。',
  },
  {
    id: 'anthropic', label: 'Anthropic', scope: '官方 API', providerName: 'Anthropic',
    website: 'https://platform.claude.com', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', model: '',
    docsUrl: 'https://platform.claude.com/docs/en/api/overview',
    description: '使用 Claude API 平台的 API Key，通过 Messages 接口调用；Claude 订阅与 API 单独管理。',
  },
  {
    id: 'gemini', label: 'Google Gemini', scope: 'OpenAI 兼容', providerName: 'Google Gemini',
    website: 'https://aistudio.google.com', protocol: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: '',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/openai',
    description: '使用 Google AI Studio 的 Gemini API Key，通过官方 OpenAI 兼容接口接入（Beta）。不使用原生 Gemini 或 Vertex AI 协议。',
  },
  {
    id: 'deepseek', label: 'DeepSeek', scope: '官方 API', providerName: 'DeepSeek',
    website: 'https://platform.deepseek.com', protocol: 'openai', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash',
    docsUrl: 'https://api-docs.deepseek.com/',
    description: '使用 DeepSeek 开放平台的 API Key。默认模型 ID 来自官方快速开始；模型权限及参数以你的账户和文档为准。',
  },
  {
    id: 'bailian', label: '阿里云百炼', scope: '北京 · 按量 API', providerName: '阿里云百炼（北京）',
    website: 'https://bailian.console.aliyun.com', protocol: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: '',
    docsUrl: 'https://help.aliyun.com/zh/model-studio/base-url',
    description: '默认北京地域的按量 API，需使用北京 API Key。共享地址仍可用，也可改为控制台的业务空间专属地址。新加坡等地域、Coding Plan / Token Plan 请按文档配套配置。',
  },
  {
    id: 'ark', label: '火山方舟', scope: '北京 · 普通 API', providerName: '火山方舟（北京）',
    website: 'https://console.volcengine.com/ark', protocol: 'openai', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: '',
    docsUrl: 'https://docs.volcengine.com/docs/ark/chat-api?lang=en',
    description: '使用方舟北京地域普通 API Key，模型填写已开通的模型 ID 或推理接入点 ID。此地址不用于 Coding Plan；不要填入 Access Key / Secret Key。',
    modelHint: '填写控制台已开通的模型 ID，或你的推理接入点 ID（ep-…）；不预填部署占位值。',
  },
  {
    id: 'hunyuan', label: '腾讯混元', scope: '国内 · TokenHub', providerName: '腾讯混元（TokenHub）',
    website: 'https://cloud.tencent.com/product/tokenhub', protocol: 'openai', baseUrl: 'https://tokenhub.tencentmaas.com/v1', model: '',
    docsUrl: 'https://cloud.tencent.com/document/product/1823/132252',
    description: '新连接使用国内 TokenHub API Key。原混元平台已迁移，请在 TokenHub 开通模型并获取凭证；旧平台、国际站和套餐配置需按各自文档核对。',
  },
  {
    id: 'qianfan', label: '百度千帆', scope: '国内 · v2 API', providerName: '百度千帆',
    website: 'https://console.bce.baidu.com/qianfan', protocol: 'openai', baseUrl: 'https://qianfan.baidubce.com/v2', model: '',
    docsUrl: 'https://cloud.baidu.com/doc/qianfan-docs/s/Fm9l6ocai',
    description: '使用千帆 v2 API Key（Bearer）和已开通模型。不要填入旧版 OAuth access_token 或 AK/SK；套餐凭证请按对应接入文档核对。',
  },
  {
    id: 'kimi', label: 'Kimi', scope: '国内 · 开放平台', providerName: 'Kimi',
    website: 'https://platform.kimi.com', protocol: 'openai', baseUrl: 'https://api.moonshot.cn/v1', model: '',
    docsUrl: 'https://platform.kimi.com/docs/get-api-key',
    description: '使用国内 Kimi API 开放平台的 API Key。Kimi Code 与国际站使用各自的接入配置，请勿直接套用此地址和凭证。',
  },
  {
    id: 'zhipu', label: '智谱', scope: '国内 · 普通 API', providerName: '智谱',
    website: 'https://bigmodel.cn', protocol: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: '',
    docsUrl: 'https://docs.bigmodel.cn/cn/guide/develop/openai/introduction',
    description: '使用国内 BigModel 普通 API。GLM Coding Plan 使用专属接入配置，国际 Z.AI 也有独立地址，请勿混用。',
  },
  {
    id: 'minimax', label: 'MiniMax', scope: '国内 · Messages 兼容', providerName: 'MiniMax（国内）',
    website: 'https://platform.minimax.cn', protocol: 'anthropic', baseUrl: 'https://api.minimax.cn/anthropic', model: '',
    docsUrl: 'https://platform.minimax.cn/docs/api-reference/text-anthropic-api',
    description: '使用国内开放平台普通 API Key，通过 Anthropic Messages 兼容接口接入。国际站和 Coding Plan 请使用各自配套配置；仅选文档列出的兼容模型。',
  },
  {
    id: 'mimo', label: '小米 MiMo', scope: '按量 · 普通 API', providerName: '小米 MiMo',
    website: 'https://platform.xiaomimimo.com', protocol: 'openai', baseUrl: 'https://api.xiaomimimo.com/v1', model: '',
    docsUrl: 'https://mimo.mi.com/docs/zh-CN/quick-start/summary/first-api-call',
    description: '使用小米 MiMo 实时推理的按量 API Key（sk-）。Token Plan 的 tp- / ttp- 凭证和批量推理使用各自专用地址，请勿混用。',
  },
  {
    id: 'opencode-go', label: 'OpenCode Go', scope: 'Go / Go Plus 套餐', providerName: 'OpenCode Go',
    website: 'https://opencode.ai', protocol: 'openai', baseUrl: 'https://opencode.ai/inference/go/openai/v1', model: '',
    modelsUrlOverride: 'https://opencode.ai/inference/go/v1/models',
    docsUrl: 'https://opencode.ai/v2/docs/console/go/',
    description: '使用已订阅 Go / Go Plus 工作区的 Console API Key 和套餐专用地址。默认仅接入支持 Chat Completions 的模型；模型列表可能包含其他协议，请按官方端点表核对。',
    modelHint: '填写 Go 端点表中支持 Chat Completions 的模型 ID，不加 opencode-go/ 前缀；仅支持 Responses 或原生 Gemini 的模型暂不可用。',
  },
  {
    id: 'xai', label: 'xAI (Grok)', scope: '官方推理 API', providerName: 'xAI (Grok)',
    website: 'https://console.x.ai', protocol: 'openai', baseUrl: 'https://api.x.ai/v1', model: '',
    docsUrl: 'https://docs.x.ai/developers/rest-api-reference/inference/chat-completions',
    description: '使用 xAI 控制台创建的推理 API Key，通过 Chat Completions 接入。请勿使用 Management API Key；此预设不接入 Grok 订阅登录或 Responses。',
  },
  {
    id: 'custom', label: '自定义配置', scope: '手动填写', providerName: '',
    website: '', protocol: 'openai', baseUrl: '', model: '', docsUrl: '',
    description: '手动填写服务商配置。可在高级选项中选择 OpenAI Chat Completions 或 Anthropic Messages。',
  },
];

// Visible capability notices are deliberately not accepted by createProviderDraft.
// Copilot requires an authentication lifecycle that FetchCV has not integrated.
export const UNSUPPORTED_PROVIDER_PRESETS = [
  {
    id: 'github-copilot', label: 'GitHub Copilot', scope: '暂不支持直连',
    docsUrl: 'https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/authenticate',
    description: 'FetchCV 尚未接入 Copilot 授权与令牌管理，不能用 GitHub token 直接填写普通 API Key。',
  },
];

// Always allocate a fresh draft. Never merge a previous connection's identity,
// credentials, request overrides, discovered models or validation state.
export function createProviderDraft(presetId = 'custom') {
  const preset = PROVIDER_PRESETS.find(item => item.id === presetId);
  if (!preset) throw new Error('未知的供应商预设');
  return {
    id: '', providerName: preset.providerName, website: preset.website,
    protocol: preset.protocol, baseUrl: preset.baseUrl, model: preset.model,
    apiKey: '', hasApiKey: false, notes: '', displayName: '', authMode: 'auto',
    userAgent: '', requestHeaders: {}, requestBody: {}, modelsUrlOverride: preset.modelsUrlOverride || '',
    modelsEndpoint: '', availableModels: [], modelProfiles: {},
    health: 'unknown', latencyMs: null, lastTestedAt: '',
  };
}
