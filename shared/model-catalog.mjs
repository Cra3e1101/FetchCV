// Offline snapshot: pinned @earendil-works/pi-ai catalog; DeepSeek official docs verified 2026-10-11.
// https://api-docs.deepseek.com/quick_start/pricing/
export default [
  {
    "id": "Ling-2.6-1T",
    "baseUrl": "https://api.ant-ling.com/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 65536,
    "reasoning": false
  },
  {
    "id": "Ling-2.6-flash",
    "baseUrl": "https://api.ant-ling.com/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 65536,
    "reasoning": false
  },
  {
    "id": "Ring-2.6-1T",
    "baseUrl": "https://api.ant-ling.com/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "claude-fable-5",
    "baseUrl": "https://api.anthropic.com",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "claude-haiku-4-5",
    "baseUrl": "https://api.anthropic.com",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "claude-haiku-4-5-20251001",
    "baseUrl": "https://api.anthropic.com",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "claude-opus-4-1",
    "baseUrl": "https://api.anthropic.com",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 32000,
    "reasoning": true
  },
  {
    "id": "claude-opus-4-1-20250805",
    "baseUrl": "https://api.anthropic.com",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 32000,
    "reasoning": true
  },
  {
    "id": "claude-opus-4-5",
    "baseUrl": "https://api.anthropic.com",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "claude-opus-4-5-20251101",
    "baseUrl": "https://api.anthropic.com",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "claude-opus-4-6",
    "baseUrl": "https://api.anthropic.com",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "claude-opus-4-7",
    "baseUrl": "https://api.anthropic.com",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "claude-opus-4-8",
    "baseUrl": "https://api.anthropic.com",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "claude-sonnet-4-5",
    "baseUrl": "https://api.anthropic.com",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "claude-sonnet-4-5-20250929",
    "baseUrl": "https://api.anthropic.com",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "claude-sonnet-4-6",
    "baseUrl": "https://api.anthropic.com",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "claude-sonnet-5",
    "baseUrl": "https://api.anthropic.com",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gemma-4-31b",
    "baseUrl": "https://api.cerebras.ai/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 40960,
    "reasoning": true
  },
  {
    "id": "gpt-oss-120b",
    "baseUrl": "https://api.cerebras.ai/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 40960,
    "reasoning": true
  },
  {
    "id": "zai-glm-4.7",
    "baseUrl": "https://api.cerebras.ai/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 40960,
    "reasoning": true
  },
  {
    "id": "claude-3-5-haiku",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 8192,
    "reasoning": false
  },
  {
    "id": "claude-3-haiku",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "claude-3-opus",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "claude-3-sonnet",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "claude-3.5-haiku",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 8192,
    "reasoning": false
  },
  {
    "id": "claude-3.5-sonnet",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 8192,
    "reasoning": false
  },
  {
    "id": "claude-fable-5",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "claude-haiku-4-5",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "claude-opus-4",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 32000,
    "reasoning": true
  },
  {
    "id": "claude-opus-4-1",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 32000,
    "reasoning": true
  },
  {
    "id": "claude-opus-4-5",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "claude-opus-4-6",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "claude-opus-4-7",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "claude-opus-4-8",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "claude-sonnet-4",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "claude-sonnet-4-5",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "claude-sonnet-4-6",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "claude-sonnet-5",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-4",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai",
    "protocol": "openai",
    "contextWindow": 8192,
    "maxOutputTokens": 8192,
    "reasoning": false
  },
  {
    "id": "gpt-4-turbo",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "gpt-4o",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "gpt-4o-mini",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "gpt-5.1",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.1-codex",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.2",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.2-codex",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.3-codex",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.4",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai",
    "protocol": "openai",
    "contextWindow": 1050000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.5",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai",
    "protocol": "openai",
    "contextWindow": 1050000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.6-luna",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai",
    "protocol": "openai",
    "contextWindow": 1050000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.6-sol",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai",
    "protocol": "openai",
    "contextWindow": 1050000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.6-terra",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai",
    "protocol": "openai",
    "contextWindow": 1050000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "o1",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 100000,
    "reasoning": true
  },
  {
    "id": "o3",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 100000,
    "reasoning": true
  },
  {
    "id": "o3-mini",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 100000,
    "reasoning": true
  },
  {
    "id": "o3-pro",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 100000,
    "reasoning": true
  },
  {
    "id": "o4-mini",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 100000,
    "reasoning": true
  },
  {
    "id": "workers-ai/@cf/moonshotai/kimi-k2.5",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat",
    "protocol": "openai",
    "contextWindow": 256000,
    "maxOutputTokens": 256000,
    "reasoning": true
  },
  {
    "id": "workers-ai/@cf/moonshotai/kimi-k2.6",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat",
    "protocol": "openai",
    "contextWindow": 256000,
    "maxOutputTokens": 256000,
    "reasoning": true
  },
  {
    "id": "workers-ai/@cf/nvidia/nemotron-3-120b-a12b",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat",
    "protocol": "openai",
    "contextWindow": 256000,
    "maxOutputTokens": 256000,
    "reasoning": true
  },
  {
    "id": "workers-ai/@cf/zai-org/glm-4.7-flash",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "workers-ai/@cf/zai-org/glm-5.2",
    "baseUrl": "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "@cf/google/gemma-4-26b-a4b-it",
    "baseUrl": "https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1",
    "protocol": "openai",
    "contextWindow": 256000,
    "maxOutputTokens": 16384,
    "reasoning": true
  },
  {
    "id": "@cf/ibm-granite/granite-4.0-h-micro",
    "baseUrl": "https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1",
    "protocol": "openai",
    "contextWindow": 131000,
    "maxOutputTokens": 131000,
    "reasoning": false
  },
  {
    "id": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    "baseUrl": "https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1",
    "protocol": "openai",
    "contextWindow": 24000,
    "maxOutputTokens": 24000,
    "reasoning": false
  },
  {
    "id": "@cf/meta/llama-4-scout-17b-16e-instruct",
    "baseUrl": "https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1",
    "protocol": "openai",
    "contextWindow": 131000,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "@cf/mistralai/mistral-small-3.1-24b-instruct",
    "baseUrl": "https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 128000,
    "reasoning": false
  },
  {
    "id": "@cf/moonshotai/kimi-k2.6",
    "baseUrl": "https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 256000,
    "reasoning": true
  },
  {
    "id": "@cf/moonshotai/kimi-k2.7-code",
    "baseUrl": "https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "@cf/nvidia/nemotron-3-120b-a12b",
    "baseUrl": "https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1",
    "protocol": "openai",
    "contextWindow": 256000,
    "maxOutputTokens": 256000,
    "reasoning": true
  },
  {
    "id": "@cf/openai/gpt-oss-120b",
    "baseUrl": "https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 16384,
    "reasoning": true
  },
  {
    "id": "@cf/openai/gpt-oss-20b",
    "baseUrl": "https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 16384,
    "reasoning": true
  },
  {
    "id": "@cf/qwen/qwen3-30b-a3b-fp8",
    "baseUrl": "https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1",
    "protocol": "openai",
    "contextWindow": 32768,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "@cf/zai-org/glm-4.7-flash",
    "baseUrl": "https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "@cf/zai-org/glm-5.2",
    "baseUrl": "https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "deepseek-v4-flash",
    "baseUrl": "https://api.deepseek.com",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 384000,
    "reasoning": true
  },
  {
    "id": "deepseek-v4-pro",
    "baseUrl": "https://api.deepseek.com",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 384000,
    "reasoning": true
  },
  {
    "id": "accounts/fireworks/models/deepseek-v4-flash",
    "baseUrl": "https://api.fireworks.ai/inference",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 384000,
    "reasoning": true
  },
  {
    "id": "accounts/fireworks/models/deepseek-v4-pro",
    "baseUrl": "https://api.fireworks.ai/inference",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 384000,
    "reasoning": true
  },
  {
    "id": "accounts/fireworks/models/glm-5p1",
    "baseUrl": "https://api.fireworks.ai/inference",
    "protocol": "anthropic",
    "contextWindow": 202800,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "accounts/fireworks/models/glm-5p2",
    "baseUrl": "https://api.fireworks.ai/inference/v1",
    "protocol": "openai",
    "contextWindow": 1048575,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "accounts/fireworks/models/gpt-oss-120b",
    "baseUrl": "https://api.fireworks.ai/inference",
    "protocol": "anthropic",
    "contextWindow": 131072,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "accounts/fireworks/models/gpt-oss-20b",
    "baseUrl": "https://api.fireworks.ai/inference",
    "protocol": "anthropic",
    "contextWindow": 131072,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "accounts/fireworks/models/kimi-k2p6",
    "baseUrl": "https://api.fireworks.ai/inference",
    "protocol": "anthropic",
    "contextWindow": 262000,
    "maxOutputTokens": 262000,
    "reasoning": true
  },
  {
    "id": "accounts/fireworks/models/kimi-k2p7-code",
    "baseUrl": "https://api.fireworks.ai/inference",
    "protocol": "anthropic",
    "contextWindow": 262000,
    "maxOutputTokens": 262000,
    "reasoning": true
  },
  {
    "id": "accounts/fireworks/models/minimax-m2p7",
    "baseUrl": "https://api.fireworks.ai/inference",
    "protocol": "anthropic",
    "contextWindow": 196608,
    "maxOutputTokens": 196608,
    "reasoning": true
  },
  {
    "id": "accounts/fireworks/models/minimax-m3",
    "baseUrl": "https://api.fireworks.ai/inference",
    "protocol": "anthropic",
    "contextWindow": 512000,
    "maxOutputTokens": 512000,
    "reasoning": true
  },
  {
    "id": "accounts/fireworks/models/qwen3p7-plus",
    "baseUrl": "https://api.fireworks.ai/inference",
    "protocol": "anthropic",
    "contextWindow": 262144,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "accounts/fireworks/routers/glm-5p1-fast",
    "baseUrl": "https://api.fireworks.ai/inference",
    "protocol": "anthropic",
    "contextWindow": 202800,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "accounts/fireworks/routers/glm-5p2-fast",
    "baseUrl": "https://api.fireworks.ai/inference/v1",
    "protocol": "openai",
    "contextWindow": 1048575,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "accounts/fireworks/routers/kimi-k2p6-fast",
    "baseUrl": "https://api.fireworks.ai/inference",
    "protocol": "anthropic",
    "contextWindow": 262000,
    "maxOutputTokens": 262000,
    "reasoning": true
  },
  {
    "id": "accounts/fireworks/routers/kimi-k2p6-turbo",
    "baseUrl": "https://api.fireworks.ai/inference",
    "protocol": "anthropic",
    "contextWindow": 262000,
    "maxOutputTokens": 262000,
    "reasoning": true
  },
  {
    "id": "accounts/fireworks/routers/kimi-k2p7-code-fast",
    "baseUrl": "https://api.fireworks.ai/inference",
    "protocol": "anthropic",
    "contextWindow": 262000,
    "maxOutputTokens": 262000,
    "reasoning": true
  },
  {
    "id": "claude-fable-5",
    "baseUrl": "https://api.individual.githubcopilot.com",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "claude-haiku-4.5",
    "baseUrl": "https://api.individual.githubcopilot.com",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "claude-opus-4.5",
    "baseUrl": "https://api.individual.githubcopilot.com",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 32000,
    "reasoning": true
  },
  {
    "id": "claude-opus-4.6",
    "baseUrl": "https://api.individual.githubcopilot.com",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 32000,
    "reasoning": true
  },
  {
    "id": "claude-opus-4.7",
    "baseUrl": "https://api.individual.githubcopilot.com",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 32000,
    "reasoning": true
  },
  {
    "id": "claude-opus-4.8",
    "baseUrl": "https://api.individual.githubcopilot.com",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "claude-sonnet-4",
    "baseUrl": "https://api.individual.githubcopilot.com",
    "protocol": "anthropic",
    "contextWindow": 216000,
    "maxOutputTokens": 16000,
    "reasoning": true
  },
  {
    "id": "claude-sonnet-4.5",
    "baseUrl": "https://api.individual.githubcopilot.com",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 32000,
    "reasoning": true
  },
  {
    "id": "claude-sonnet-4.6",
    "baseUrl": "https://api.individual.githubcopilot.com",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 32000,
    "reasoning": true
  },
  {
    "id": "claude-sonnet-5",
    "baseUrl": "https://api.individual.githubcopilot.com",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gemini-2.5-pro",
    "baseUrl": "https://api.individual.githubcopilot.com",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "gemini-3-flash-preview",
    "baseUrl": "https://api.individual.githubcopilot.com",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "gemini-3.1-pro-preview",
    "baseUrl": "https://api.individual.githubcopilot.com",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "gemini-3.5-flash",
    "baseUrl": "https://api.individual.githubcopilot.com",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "gpt-4.1",
    "baseUrl": "https://api.individual.githubcopilot.com",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "gpt-5-mini",
    "baseUrl": "https://api.individual.githubcopilot.com",
    "protocol": "openai",
    "contextWindow": 264000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "gpt-5.2",
    "baseUrl": "https://api.individual.githubcopilot.com",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.2-codex",
    "baseUrl": "https://api.individual.githubcopilot.com",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.3-codex",
    "baseUrl": "https://api.individual.githubcopilot.com",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.4",
    "baseUrl": "https://api.individual.githubcopilot.com",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.4-mini",
    "baseUrl": "https://api.individual.githubcopilot.com",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.4-nano",
    "baseUrl": "https://api.individual.githubcopilot.com",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.5",
    "baseUrl": "https://api.individual.githubcopilot.com",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.6-luna",
    "baseUrl": "https://api.individual.githubcopilot.com",
    "protocol": "openai",
    "contextWindow": 1050000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.6-sol",
    "baseUrl": "https://api.individual.githubcopilot.com",
    "protocol": "openai",
    "contextWindow": 1050000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.6-terra",
    "baseUrl": "https://api.individual.githubcopilot.com",
    "protocol": "openai",
    "contextWindow": 1050000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "kimi-k2.7-code",
    "baseUrl": "https://api.individual.githubcopilot.com",
    "protocol": "openai",
    "contextWindow": 256000,
    "maxOutputTokens": 32000,
    "reasoning": true
  },
  {
    "id": "mai-code-1-flash-picker",
    "baseUrl": "https://api.individual.githubcopilot.com",
    "protocol": "openai",
    "contextWindow": 256000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "llama-3.1-8b-instant",
    "baseUrl": "https://api.groq.com/openai/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 131072,
    "reasoning": false
  },
  {
    "id": "llama-3.3-70b-versatile",
    "baseUrl": "https://api.groq.com/openai/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 32768,
    "reasoning": false
  },
  {
    "id": "meta-llama/llama-4-scout-17b-16e-instruct",
    "baseUrl": "https://api.groq.com/openai/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 8192,
    "reasoning": false
  },
  {
    "id": "openai/gpt-oss-120b",
    "baseUrl": "https://api.groq.com/openai/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "openai/gpt-oss-20b",
    "baseUrl": "https://api.groq.com/openai/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "openai/gpt-oss-safeguard-20b",
    "baseUrl": "https://api.groq.com/openai/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "qwen/qwen3-32b",
    "baseUrl": "https://api.groq.com/openai/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 40960,
    "reasoning": true
  },
  {
    "id": "MiniMaxAI/MiniMax-M2",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 204800,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "MiniMaxAI/MiniMax-M2.1",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 204800,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "MiniMaxAI/MiniMax-M2.5",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 204800,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "MiniMaxAI/MiniMax-M2.7",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 204800,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "MiniMaxAI/MiniMax-M3",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 524288,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "Qwen/Qwen3-235B-A22B",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 40960,
    "maxOutputTokens": 16384,
    "reasoning": true
  },
  {
    "id": "Qwen/Qwen3-235B-A22B-Thinking-2507",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "Qwen/Qwen3-32B",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 16384,
    "reasoning": true
  },
  {
    "id": "Qwen/Qwen3-Coder-30B-A3B-Instruct",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 65536,
    "reasoning": false
  },
  {
    "id": "Qwen/Qwen3-Coder-480B-A35B-Instruct",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 66536,
    "reasoning": false
  },
  {
    "id": "Qwen/Qwen3-Coder-Next",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 65536,
    "reasoning": false
  },
  {
    "id": "Qwen/Qwen3-Next-80B-A3B-Instruct",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 66536,
    "reasoning": false
  },
  {
    "id": "Qwen/Qwen3-Next-80B-A3B-Thinking",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 131072,
    "reasoning": false
  },
  {
    "id": "Qwen/Qwen3.5-122B-A10B",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "Qwen/Qwen3.5-27B",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "Qwen/Qwen3.5-35B-A3B",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "Qwen/Qwen3.5-397B-A17B",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "Qwen/Qwen3.5-9B",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "Qwen/Qwen3.6-27B",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "Qwen/Qwen3.6-35B-A3B",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "XiaomiMiMo/MiMo-V2-Flash",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 4096,
    "reasoning": true
  },
  {
    "id": "XiaomiMiMo/MiMo-V2.5-Pro",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "deepseek-ai/DeepSeek-R1",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 64000,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "deepseek-ai/DeepSeek-R1-0528",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 163840,
    "maxOutputTokens": 163840,
    "reasoning": true
  },
  {
    "id": "deepseek-ai/DeepSeek-V3.2",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 163840,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "deepseek-ai/DeepSeek-V4-Flash",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 384000,
    "reasoning": true
  },
  {
    "id": "deepseek-ai/DeepSeek-V4-Pro",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 393216,
    "reasoning": true
  },
  {
    "id": "google/gemma-4-26B-A4B-it",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "google/gemma-4-31B-it",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "meta-llama/Llama-3.3-70B-Instruct",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "moonshotai/Kimi-K2-Instruct",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "moonshotai/Kimi-K2-Instruct-0905",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "moonshotai/Kimi-K2-Thinking",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "moonshotai/Kimi-K2.5",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "moonshotai/Kimi-K2.6",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "moonshotai/Kimi-K2.7-Code",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "openai/gpt-oss-120b",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "openai/gpt-oss-20b",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "stepfun-ai/Step-3.5-Flash",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 256000,
    "reasoning": true
  },
  {
    "id": "stepfun-ai/Step-3.7-Flash",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 256000,
    "reasoning": true
  },
  {
    "id": "zai-org/GLM-4.5",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 98304,
    "reasoning": true
  },
  {
    "id": "zai-org/GLM-4.5-Air",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 98304,
    "reasoning": true
  },
  {
    "id": "zai-org/GLM-4.5V",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 65536,
    "maxOutputTokens": 16384,
    "reasoning": true
  },
  {
    "id": "zai-org/GLM-4.6",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 204800,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "zai-org/GLM-4.7",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 204800,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "zai-org/GLM-4.7-Flash",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "zai-org/GLM-5",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 202752,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "zai-org/GLM-5.1",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 202752,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "zai-org/GLM-5.2",
    "baseUrl": "https://router.huggingface.co/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "k2p7",
    "baseUrl": "https://api.kimi.com/coding",
    "protocol": "anthropic",
    "contextWindow": 262144,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "k3",
    "baseUrl": "https://api.kimi.com/coding",
    "protocol": "anthropic",
    "contextWindow": 1048576,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "kimi-for-coding",
    "baseUrl": "https://api.kimi.com/coding",
    "protocol": "anthropic",
    "contextWindow": 262144,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "kimi-for-coding-highspeed",
    "baseUrl": "https://api.kimi.com/coding",
    "protocol": "anthropic",
    "contextWindow": 262144,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "kimi-k2-thinking",
    "baseUrl": "https://api.kimi.com/coding",
    "protocol": "anthropic",
    "contextWindow": 262144,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "MiniMax-M2.7",
    "baseUrl": "https://api.minimax.io/anthropic",
    "protocol": "anthropic",
    "contextWindow": 204800,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "MiniMax-M2.7-highspeed",
    "baseUrl": "https://api.minimax.io/anthropic",
    "protocol": "anthropic",
    "contextWindow": 204800,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "MiniMax-M3",
    "baseUrl": "https://api.minimax.io/anthropic",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "MiniMax-M2.7",
    "baseUrl": "https://api.minimaxi.com/anthropic",
    "protocol": "anthropic",
    "contextWindow": 204800,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "MiniMax-M2.7-highspeed",
    "baseUrl": "https://api.minimaxi.com/anthropic",
    "protocol": "anthropic",
    "contextWindow": 204800,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "MiniMax-M3",
    "baseUrl": "https://api.minimaxi.com/anthropic",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "kimi-k2-0711-preview",
    "baseUrl": "https://api.moonshot.ai/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "kimi-k2-0905-preview",
    "baseUrl": "https://api.moonshot.ai/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": false
  },
  {
    "id": "kimi-k2-thinking",
    "baseUrl": "https://api.moonshot.ai/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "kimi-k2-thinking-turbo",
    "baseUrl": "https://api.moonshot.ai/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "kimi-k2-turbo-preview",
    "baseUrl": "https://api.moonshot.ai/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": false
  },
  {
    "id": "kimi-k2.5",
    "baseUrl": "https://api.moonshot.ai/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "kimi-k2.6",
    "baseUrl": "https://api.moonshot.ai/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "kimi-k2.7-code",
    "baseUrl": "https://api.moonshot.ai/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "kimi-k2.7-code-highspeed",
    "baseUrl": "https://api.moonshot.ai/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "kimi-k3",
    "baseUrl": "https://api.moonshot.ai/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "kimi-k2-0711-preview",
    "baseUrl": "https://api.moonshot.cn/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "kimi-k2-0905-preview",
    "baseUrl": "https://api.moonshot.cn/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": false
  },
  {
    "id": "kimi-k2-thinking",
    "baseUrl": "https://api.moonshot.cn/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "kimi-k2-thinking-turbo",
    "baseUrl": "https://api.moonshot.cn/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "kimi-k2-turbo-preview",
    "baseUrl": "https://api.moonshot.cn/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": false
  },
  {
    "id": "kimi-k2.5",
    "baseUrl": "https://api.moonshot.cn/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "kimi-k2.6",
    "baseUrl": "https://api.moonshot.cn/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "kimi-k2.7-code",
    "baseUrl": "https://api.moonshot.cn/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "kimi-k2.7-code-highspeed",
    "baseUrl": "https://api.moonshot.cn/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "kimi-k3",
    "baseUrl": "https://api.moonshot.cn/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "meta/llama-3.1-70b-instruct",
    "baseUrl": "https://integrate.api.nvidia.com/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "meta/llama-3.1-8b-instruct",
    "baseUrl": "https://integrate.api.nvidia.com/v1",
    "protocol": "openai",
    "contextWindow": 16000,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "meta/llama-3.2-11b-vision-instruct",
    "baseUrl": "https://integrate.api.nvidia.com/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "meta/llama-3.2-90b-vision-instruct",
    "baseUrl": "https://integrate.api.nvidia.com/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 8192,
    "reasoning": false
  },
  {
    "id": "meta/llama-3.3-70b-instruct",
    "baseUrl": "https://integrate.api.nvidia.com/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "minimaxai/minimax-m3",
    "baseUrl": "https://integrate.api.nvidia.com/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 16384,
    "reasoning": true
  },
  {
    "id": "mistralai/mistral-large-3-675b-instruct-2512",
    "baseUrl": "https://integrate.api.nvidia.com/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": false
  },
  {
    "id": "mistralai/mistral-small-4-119b-2603",
    "baseUrl": "https://integrate.api.nvidia.com/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 8192,
    "reasoning": true
  },
  {
    "id": "moonshotai/kimi-k2.6",
    "baseUrl": "https://integrate.api.nvidia.com/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "nvidia/nemotron-3-nano-30b-a3b",
    "baseUrl": "https://integrate.api.nvidia.com/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
    "baseUrl": "https://integrate.api.nvidia.com/v1",
    "protocol": "openai",
    "contextWindow": 256000,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "nvidia/nemotron-3-super-120b-a12b",
    "baseUrl": "https://integrate.api.nvidia.com/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "nvidia/nemotron-3-ultra-550b-a55b",
    "baseUrl": "https://integrate.api.nvidia.com/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "nvidia/nvidia-nemotron-nano-9b-v2",
    "baseUrl": "https://integrate.api.nvidia.com/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "openai/gpt-oss-120b",
    "baseUrl": "https://integrate.api.nvidia.com/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 8192,
    "reasoning": true
  },
  {
    "id": "openai/gpt-oss-20b",
    "baseUrl": "https://integrate.api.nvidia.com/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "qwen/qwen3.5-122b-a10b",
    "baseUrl": "https://integrate.api.nvidia.com/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "stepfun-ai/step-3.5-flash",
    "baseUrl": "https://integrate.api.nvidia.com/v1",
    "protocol": "openai",
    "contextWindow": 256000,
    "maxOutputTokens": 16384,
    "reasoning": true
  },
  {
    "id": "stepfun-ai/step-3.7-flash",
    "baseUrl": "https://integrate.api.nvidia.com/v1",
    "protocol": "openai",
    "contextWindow": 256000,
    "maxOutputTokens": 16384,
    "reasoning": true
  },
  {
    "id": "z-ai/glm-5.2",
    "baseUrl": "https://integrate.api.nvidia.com/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "gpt-4",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 8192,
    "maxOutputTokens": 8192,
    "reasoning": false
  },
  {
    "id": "gpt-4-turbo",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "gpt-4.1",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 1047576,
    "maxOutputTokens": 32768,
    "reasoning": false
  },
  {
    "id": "gpt-4.1-mini",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 1047576,
    "maxOutputTokens": 32768,
    "reasoning": false
  },
  {
    "id": "gpt-4.1-nano",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 1047576,
    "maxOutputTokens": 32768,
    "reasoning": false
  },
  {
    "id": "gpt-4o",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "gpt-4o-2024-05-13",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "gpt-4o-2024-08-06",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "gpt-4o-2024-11-20",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "gpt-4o-mini",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "gpt-5",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5-chat-latest",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "gpt-5-codex",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5-mini",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5-nano",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5-pro",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.1",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.1-chat-latest",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 16384,
    "reasoning": true
  },
  {
    "id": "gpt-5.1-codex",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.1-codex-max",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.1-codex-mini",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.2",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.2-chat-latest",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 16384,
    "reasoning": true
  },
  {
    "id": "gpt-5.2-codex",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.2-pro",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.3-chat-latest",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "gpt-5.3-codex",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.3-codex-spark",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 32000,
    "reasoning": true
  },
  {
    "id": "gpt-5.4",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 272000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.4-mini",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.4-nano",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.4-pro",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 1050000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.5",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 272000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.5-pro",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 1050000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.6-luna",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 272000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.6-sol",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 272000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.6-terra",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 272000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-realtime-2.1",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 32000,
    "reasoning": true
  },
  {
    "id": "o1",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 100000,
    "reasoning": true
  },
  {
    "id": "o1-pro",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 100000,
    "reasoning": true
  },
  {
    "id": "o3",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 100000,
    "reasoning": true
  },
  {
    "id": "o3-deep-research",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 100000,
    "reasoning": true
  },
  {
    "id": "o3-mini",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 100000,
    "reasoning": true
  },
  {
    "id": "o3-pro",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 100000,
    "reasoning": true
  },
  {
    "id": "o4-mini",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 100000,
    "reasoning": true
  },
  {
    "id": "o4-mini-deep-research",
    "baseUrl": "https://api.openai.com/v1",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 100000,
    "reasoning": true
  },
  {
    "id": "big-pickle",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 32000,
    "reasoning": true
  },
  {
    "id": "claude-fable-5",
    "baseUrl": "https://opencode.ai/zen",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "claude-haiku-4-5",
    "baseUrl": "https://opencode.ai/zen",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "claude-opus-4-1",
    "baseUrl": "https://opencode.ai/zen",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 32000,
    "reasoning": true
  },
  {
    "id": "claude-opus-4-5",
    "baseUrl": "https://opencode.ai/zen",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "claude-opus-4-6",
    "baseUrl": "https://opencode.ai/zen",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "claude-opus-4-7",
    "baseUrl": "https://opencode.ai/zen",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "claude-opus-4-8",
    "baseUrl": "https://opencode.ai/zen",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "claude-sonnet-4",
    "baseUrl": "https://opencode.ai/zen",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "claude-sonnet-4-5",
    "baseUrl": "https://opencode.ai/zen",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "claude-sonnet-4-6",
    "baseUrl": "https://opencode.ai/zen",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "claude-sonnet-5",
    "baseUrl": "https://opencode.ai/zen",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "deepseek-v4-flash",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 384000,
    "reasoning": true
  },
  {
    "id": "deepseek-v4-flash-free",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "deepseek-v4-pro",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 384000,
    "reasoning": true
  },
  {
    "id": "glm-5",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 204800,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "glm-5.1",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 204800,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "glm-5.2",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "gpt-5",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5-codex",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5-nano",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.1",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.1-codex",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.1-codex-max",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.1-codex-mini",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.2",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.2-codex",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.3-codex",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.4",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 272000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.4-mini",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.4-nano",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.4-pro",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 1050000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.5",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 1050000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.5-pro",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 1050000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.6-luna",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 1050000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.6-sol",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 1050000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "gpt-5.6-terra",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 1050000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "grok-4.5",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 500000,
    "maxOutputTokens": 500000,
    "reasoning": true
  },
  {
    "id": "grok-build-0.1",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 256000,
    "maxOutputTokens": 256000,
    "reasoning": true
  },
  {
    "id": "hy3-free",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 190000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "kimi-k2.5",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "kimi-k2.6",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "kimi-k2.7-code",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "mimo-v2.5-free",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 32000,
    "reasoning": true
  },
  {
    "id": "minimax-m2.5",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 204800,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "minimax-m2.7",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 204800,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "minimax-m3",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 512000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "nemotron-3-ultra-free",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "north-mini-code-free",
    "baseUrl": "https://opencode.ai/zen/v1",
    "protocol": "openai",
    "contextWindow": 256000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "qwen3.5-plus",
    "baseUrl": "https://opencode.ai/zen",
    "protocol": "anthropic",
    "contextWindow": 262144,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "qwen3.6-plus",
    "baseUrl": "https://opencode.ai/zen",
    "protocol": "anthropic",
    "contextWindow": 262144,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "deepseek-v4-flash",
    "baseUrl": "https://opencode.ai/zen/go/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 384000,
    "reasoning": true
  },
  {
    "id": "deepseek-v4-pro",
    "baseUrl": "https://opencode.ai/zen/go/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 384000,
    "reasoning": true
  },
  {
    "id": "glm-5.1",
    "baseUrl": "https://opencode.ai/zen/go/v1",
    "protocol": "openai",
    "contextWindow": 202752,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "glm-5.2",
    "baseUrl": "https://opencode.ai/zen/go/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "grok-4.5",
    "baseUrl": "https://opencode.ai/zen/go/v1",
    "protocol": "openai",
    "contextWindow": 500000,
    "maxOutputTokens": 500000,
    "reasoning": true
  },
  {
    "id": "kimi-k2.6",
    "baseUrl": "https://opencode.ai/zen/go/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "kimi-k2.7-code",
    "baseUrl": "https://opencode.ai/zen/go/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "kimi-k3",
    "baseUrl": "https://opencode.ai/zen/go/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "mimo-v2.5",
    "baseUrl": "https://opencode.ai/zen/go/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "mimo-v2.5-pro",
    "baseUrl": "https://opencode.ai/zen/go/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "minimax-m2.7",
    "baseUrl": "https://opencode.ai/zen/go/v1",
    "protocol": "openai",
    "contextWindow": 204800,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "minimax-m3",
    "baseUrl": "https://opencode.ai/zen/go",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "qwen3.6-plus",
    "baseUrl": "https://opencode.ai/zen/go/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "qwen3.7-max",
    "baseUrl": "https://opencode.ai/zen/go",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "qwen3.7-plus",
    "baseUrl": "https://opencode.ai/zen/go",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "ai21/jamba-large-1.7",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 256000,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "aion-labs/aion-2.0",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "aion-labs/aion-3.0",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "aion-labs/aion-3.0-mini",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "amazon/nova-2-lite-v1",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 65535,
    "reasoning": true
  },
  {
    "id": "amazon/nova-lite-v1",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 300000,
    "maxOutputTokens": 5120,
    "reasoning": false
  },
  {
    "id": "amazon/nova-micro-v1",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 5120,
    "reasoning": false
  },
  {
    "id": "amazon/nova-premier-v1",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 32000,
    "reasoning": false
  },
  {
    "id": "amazon/nova-pro-v1",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 300000,
    "maxOutputTokens": 5120,
    "reasoning": false
  },
  {
    "id": "anthropic/claude-3-haiku",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "anthropic/claude-fable-5",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "anthropic/claude-haiku-4.5",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "anthropic/claude-opus-4",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 32000,
    "reasoning": true
  },
  {
    "id": "anthropic/claude-opus-4.1",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 32000,
    "reasoning": true
  },
  {
    "id": "anthropic/claude-opus-4.5",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "anthropic/claude-opus-4.6",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "anthropic/claude-opus-4.7",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "anthropic/claude-opus-4.7-fast",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "anthropic/claude-opus-4.8",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "anthropic/claude-opus-4.8-fast",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "anthropic/claude-sonnet-4",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "anthropic/claude-sonnet-4.5",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "anthropic/claude-sonnet-4.6",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "anthropic/claude-sonnet-5",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "arcee-ai/trinity-large-thinking",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 80000,
    "reasoning": true
  },
  {
    "id": "arcee-ai/virtuoso-large",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 64000,
    "reasoning": false
  },
  {
    "id": "auto",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 2000000,
    "maxOutputTokens": 30000,
    "reasoning": true
  },
  {
    "id": "bytedance-seed/seed-1.6",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "bytedance-seed/seed-1.6-flash",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "bytedance-seed/seed-2.0-lite",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "bytedance-seed/seed-2.0-mini",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "cohere/command-r-08-2024",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 4000,
    "reasoning": false
  },
  {
    "id": "cohere/command-r-plus-08-2024",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 4000,
    "reasoning": false
  },
  {
    "id": "cohere/north-mini-code:free",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 256000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "deepseek/deepseek-chat",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 16000,
    "reasoning": false
  },
  {
    "id": "deepseek/deepseek-chat-v3-0324",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 163840,
    "maxOutputTokens": 65536,
    "reasoning": false
  },
  {
    "id": "deepseek/deepseek-chat-v3.1",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 163840,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "deepseek/deepseek-r1",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 64000,
    "maxOutputTokens": 16000,
    "reasoning": true
  },
  {
    "id": "deepseek/deepseek-r1-0528",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 163840,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "deepseek/deepseek-v3.1-terminus",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "deepseek/deepseek-v3.2",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 163840,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "deepseek/deepseek-v3.2-exp",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 163840,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "deepseek/deepseek-v4-flash",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1048575,
    "maxOutputTokens": 4096,
    "reasoning": true
  },
  {
    "id": "deepseek/deepseek-v4-pro",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 384000,
    "reasoning": true
  },
  {
    "id": "google/gemini-2.5-flash",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 65535,
    "reasoning": true
  },
  {
    "id": "google/gemini-2.5-flash-lite",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 65535,
    "reasoning": true
  },
  {
    "id": "google/gemini-2.5-pro",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "google/gemini-2.5-pro-preview",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "google/gemini-2.5-pro-preview-05-06",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 65535,
    "reasoning": true
  },
  {
    "id": "google/gemini-3-flash-preview",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 65535,
    "reasoning": true
  },
  {
    "id": "google/gemini-3-pro-image",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 65536,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "google/gemini-3.1-flash-lite",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "google/gemini-3.1-flash-lite-preview",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "google/gemini-3.1-pro-preview",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "google/gemini-3.1-pro-preview-customtools",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "google/gemini-3.5-flash",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "google/gemma-3-12b-it",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "google/gemma-3-27b-it",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 131072,
    "reasoning": false
  },
  {
    "id": "google/gemma-4-26b-a4b-it",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 256000,
    "maxOutputTokens": 256000,
    "reasoning": true
  },
  {
    "id": "google/gemma-4-26b-a4b-it:free",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "google/gemma-4-31b-it",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "google/gemma-4-31b-it:free",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "ibm-granite/granite-4.1-8b",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 131072,
    "reasoning": false
  },
  {
    "id": "inception/mercury-2",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 50000,
    "reasoning": true
  },
  {
    "id": "inclusionai/ling-2.6-1t",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 32768,
    "reasoning": false
  },
  {
    "id": "inclusionai/ling-2.6-flash",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 32768,
    "reasoning": false
  },
  {
    "id": "inclusionai/ring-2.6-1t",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "kwaipilot/kat-coder-air-v2.5",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 256000,
    "maxOutputTokens": 80000,
    "reasoning": false
  },
  {
    "id": "kwaipilot/kat-coder-pro-v2",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 256000,
    "maxOutputTokens": 80000,
    "reasoning": false
  },
  {
    "id": "kwaipilot/kat-coder-pro-v2.5",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 256000,
    "maxOutputTokens": 80000,
    "reasoning": false
  },
  {
    "id": "meta-llama/llama-3.1-70b-instruct",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "meta-llama/llama-3.1-8b-instruct",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 131072,
    "reasoning": false
  },
  {
    "id": "meta-llama/llama-3.3-70b-instruct",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 128000,
    "reasoning": false
  },
  {
    "id": "meta-llama/llama-3.3-70b-instruct:free",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 65536,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "meta-llama/llama-4-maverick",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "meta-llama/llama-4-scout",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 327680,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "meta/muse-spark-1.1",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 4096,
    "reasoning": true
  },
  {
    "id": "minimax/minimax-m1",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 40000,
    "reasoning": true
  },
  {
    "id": "minimax/minimax-m2",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 204800,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "minimax/minimax-m2.1",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 204800,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "minimax/minimax-m2.5",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 196608,
    "maxOutputTokens": 196608,
    "reasoning": true
  },
  {
    "id": "minimax/minimax-m2.7",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 204800,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "minimax/minimax-m3",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 524288,
    "maxOutputTokens": 512000,
    "reasoning": true
  },
  {
    "id": "mistralai/codestral-2508",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 256000,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "mistralai/devstral-2512",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "mistralai/ministral-14b-2512",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "mistralai/ministral-3b-2512",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "mistralai/ministral-8b-2512",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "mistralai/mistral-large",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "mistralai/mistral-large-2407",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "mistralai/mistral-large-2512",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "mistralai/mistral-medium-3",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "mistralai/mistral-medium-3-5",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 4096,
    "reasoning": true
  },
  {
    "id": "mistralai/mistral-medium-3.1",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "mistralai/mistral-nemo",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "mistralai/mistral-saba",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 32768,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "mistralai/mistral-small-2603",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 4096,
    "reasoning": true
  },
  {
    "id": "mistralai/mistral-small-3.2-24b-instruct",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "mistralai/mixtral-8x22b-instruct",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 65536,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "mistralai/voxtral-small-24b-2507",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 32000,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "moonshotai/kimi-k2",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 100352,
    "reasoning": false
  },
  {
    "id": "moonshotai/kimi-k2-0905",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 100352,
    "reasoning": false
  },
  {
    "id": "moonshotai/kimi-k2-thinking",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "moonshotai/kimi-k2.5",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 4096,
    "reasoning": true
  },
  {
    "id": "moonshotai/kimi-k2.6",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 4096,
    "reasoning": true
  },
  {
    "id": "moonshotai/kimi-k2.7-code",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "moonshotai/kimi-k3",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "nex-agi/nex-n2-mini",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "nex-agi/nex-n2-pro",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "nvidia/llama-3.3-nemotron-super-49b-v1.5",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 16384,
    "reasoning": true
  },
  {
    "id": "nvidia/nemotron-3-nano-30b-a3b",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 228000,
    "reasoning": true
  },
  {
    "id": "nvidia/nemotron-3-nano-30b-a3b:free",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 256000,
    "maxOutputTokens": 4096,
    "reasoning": true
  },
  {
    "id": "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 256000,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "nvidia/nemotron-3-super-120b-a12b",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 4096,
    "reasoning": true
  },
  {
    "id": "nvidia/nemotron-3-super-120b-a12b:free",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "nvidia/nemotron-3-ultra-550b-a55b",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 512288,
    "maxOutputTokens": 4096,
    "reasoning": true
  },
  {
    "id": "nvidia/nemotron-3-ultra-550b-a55b:free",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "nvidia/nemotron-nano-12b-v2-vl:free",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "nvidia/nemotron-nano-9b-v2:free",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 4096,
    "reasoning": true
  },
  {
    "id": "openai/gpt-3.5-turbo",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 16385,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "openai/gpt-3.5-turbo-0613",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 4095,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "openai/gpt-3.5-turbo-16k",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 16385,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "openai/gpt-4",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 8191,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "openai/gpt-4-turbo",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "openai/gpt-4-turbo-preview",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "openai/gpt-4.1",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1047576,
    "maxOutputTokens": 32768,
    "reasoning": false
  },
  {
    "id": "openai/gpt-4.1-mini",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1047576,
    "maxOutputTokens": 32768,
    "reasoning": false
  },
  {
    "id": "openai/gpt-4.1-nano",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1047576,
    "maxOutputTokens": 32768,
    "reasoning": false
  },
  {
    "id": "openai/gpt-4o",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "openai/gpt-4o-2024-05-13",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "openai/gpt-4o-2024-08-06",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "openai/gpt-4o-2024-11-20",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "openai/gpt-4o-mini",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "openai/gpt-4o-mini-2024-07-18",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "openai/gpt-5",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5-codex",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5-mini",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5-nano",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5-pro",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.1",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.1-chat",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "openai/gpt-5.1-codex",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.1-codex-max",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.1-codex-mini",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 100000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.2",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.2-chat",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "openai/gpt-5.2-codex",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.2-pro",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.3-chat",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "openai/gpt-5.3-codex",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.4",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1050000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.4-mini",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.4-nano",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.4-pro",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1050000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.5",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1050000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.5-pro",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1050000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.6-luna",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1050000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.6-luna-pro",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1050000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.6-sol",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1050000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.6-sol-pro",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1050000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.6-terra",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1050000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.6-terra-pro",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1050000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-audio",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "openai/gpt-audio-mini",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "openai/gpt-chat-latest",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": false
  },
  {
    "id": "openai/gpt-oss-120b",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "openai/gpt-oss-20b",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "openai/gpt-oss-20b:free",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "openai/gpt-oss-safeguard-20b",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "openai/o1",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 100000,
    "reasoning": true
  },
  {
    "id": "openai/o3",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 100000,
    "reasoning": true
  },
  {
    "id": "openai/o3-deep-research",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 100000,
    "reasoning": true
  },
  {
    "id": "openai/o3-mini",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 100000,
    "reasoning": true
  },
  {
    "id": "openai/o3-mini-high",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 100000,
    "reasoning": true
  },
  {
    "id": "openai/o3-pro",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 100000,
    "reasoning": true
  },
  {
    "id": "openai/o4-mini",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 100000,
    "reasoning": true
  },
  {
    "id": "openai/o4-mini-deep-research",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 100000,
    "reasoning": true
  },
  {
    "id": "openai/o4-mini-high",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 100000,
    "reasoning": true
  },
  {
    "id": "openrouter/auto",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 2000000,
    "maxOutputTokens": 4096,
    "reasoning": true
  },
  {
    "id": "openrouter/free",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 4096,
    "reasoning": true
  },
  {
    "id": "openrouter/fusion",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 30000,
    "reasoning": true
  },
  {
    "id": "poolside/laguna-m.1",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "poolside/laguna-m.1:free",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "poolside/laguna-xs-2.1",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "poolside/laguna-xs-2.1:free",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "qwen/qwen-2.5-72b-instruct",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 32768,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "qwen/qwen-2.5-7b-instruct",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 32768,
    "maxOutputTokens": 32768,
    "reasoning": false
  },
  {
    "id": "qwen/qwen-plus",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 32768,
    "reasoning": false
  },
  {
    "id": "qwen/qwen-plus-2025-07-28",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 32768,
    "reasoning": false
  },
  {
    "id": "qwen/qwen-plus-2025-07-28:thinking",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "qwen/qwen3-14b",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 40960,
    "maxOutputTokens": 16384,
    "reasoning": true
  },
  {
    "id": "qwen/qwen3-235b-a22b",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 8192,
    "reasoning": true
  },
  {
    "id": "qwen/qwen3-235b-a22b-2507",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "qwen/qwen3-235b-a22b-thinking-2507",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 4096,
    "reasoning": true
  },
  {
    "id": "qwen/qwen3-30b-a3b",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 40960,
    "maxOutputTokens": 16384,
    "reasoning": true
  },
  {
    "id": "qwen/qwen3-30b-a3b-instruct-2507",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "qwen/qwen3-30b-a3b-thinking-2507",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 81920,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "qwen/qwen3-32b",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 40960,
    "maxOutputTokens": 16384,
    "reasoning": true
  },
  {
    "id": "qwen/qwen3-8b",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 8192,
    "reasoning": true
  },
  {
    "id": "qwen/qwen3-coder",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 65536,
    "reasoning": false
  },
  {
    "id": "qwen/qwen3-coder-30b-a3b-instruct",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 160000,
    "maxOutputTokens": 32768,
    "reasoning": false
  },
  {
    "id": "qwen/qwen3-coder-flash",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 65536,
    "reasoning": false
  },
  {
    "id": "qwen/qwen3-coder-next",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": false
  },
  {
    "id": "qwen/qwen3-coder-plus",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 65536,
    "reasoning": false
  },
  {
    "id": "qwen/qwen3-coder:free",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262000,
    "maxOutputTokens": 262000,
    "reasoning": false
  },
  {
    "id": "qwen/qwen3-max",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 32768,
    "reasoning": false
  },
  {
    "id": "qwen/qwen3-max-thinking",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "qwen/qwen3-next-80b-a3b-instruct",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": false
  },
  {
    "id": "qwen/qwen3-next-80b-a3b-instruct:free",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "qwen/qwen3-next-80b-a3b-thinking",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "qwen/qwen3-vl-235b-a22b-instruct",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 32768,
    "reasoning": false
  },
  {
    "id": "qwen/qwen3-vl-235b-a22b-thinking",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "qwen/qwen3-vl-30b-a3b-instruct",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 32768,
    "reasoning": false
  },
  {
    "id": "qwen/qwen3-vl-30b-a3b-thinking",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "qwen/qwen3-vl-32b-instruct",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 32768,
    "reasoning": false
  },
  {
    "id": "qwen/qwen3-vl-8b-instruct",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 32768,
    "reasoning": false
  },
  {
    "id": "qwen/qwen3-vl-8b-thinking",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "qwen/qwen3.5-122b-a10b",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "qwen/qwen3.5-27b",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "qwen/qwen3.5-35b-a3b",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "qwen/qwen3.5-397b-a17b",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "qwen/qwen3.5-9b",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "qwen/qwen3.5-flash-02-23",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "qwen/qwen3.5-plus-02-15",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "qwen/qwen3.5-plus-20260420",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "qwen/qwen3.6-27b",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "qwen/qwen3.6-35b-a3b",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "qwen/qwen3.6-flash",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "qwen/qwen3.6-max-preview",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "qwen/qwen3.6-plus",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "qwen/qwen3.7-max",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "qwen/qwen3.7-plus",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "rekaai/reka-edge",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 16384,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "relace/relace-search",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 256000,
    "maxOutputTokens": 128000,
    "reasoning": false
  },
  {
    "id": "sakana/fugu-ultra",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "sao10k/l3.1-euryale-70b",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "stepfun/step-3.5-flash",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "stepfun/step-3.7-flash",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 256000,
    "maxOutputTokens": 256000,
    "reasoning": true
  },
  {
    "id": "tencent/hy3",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "tencent/hy3-preview",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 4096,
    "reasoning": true
  },
  {
    "id": "tencent/hy3:free",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "thedrummer/unslopnemo-12b",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 32768,
    "maxOutputTokens": 32768,
    "reasoning": false
  },
  {
    "id": "upstage/solar-pro-3",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 128000,
    "maxOutputTokens": 4096,
    "reasoning": true
  },
  {
    "id": "x-ai/grok-4.20",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 2000000,
    "maxOutputTokens": 4096,
    "reasoning": true
  },
  {
    "id": "x-ai/grok-4.3",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 4096,
    "reasoning": true
  },
  {
    "id": "x-ai/grok-4.5",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 500000,
    "maxOutputTokens": 4096,
    "reasoning": true
  },
  {
    "id": "x-ai/grok-build-0.1",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 256000,
    "maxOutputTokens": 4096,
    "reasoning": true
  },
  {
    "id": "xiaomi/mimo-v2.5",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "xiaomi/mimo-v2.5-pro",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "z-ai/glm-4.5",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 98304,
    "reasoning": true
  },
  {
    "id": "z-ai/glm-4.5-air",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 98304,
    "reasoning": true
  },
  {
    "id": "z-ai/glm-4.5v",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 65536,
    "maxOutputTokens": 16384,
    "reasoning": true
  },
  {
    "id": "z-ai/glm-4.6",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 202752,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "z-ai/glm-4.6v",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "z-ai/glm-4.7",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 202752,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "z-ai/glm-4.7-flash",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "z-ai/glm-5",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 202752,
    "maxOutputTokens": 202752,
    "reasoning": true
  },
  {
    "id": "z-ai/glm-5-turbo",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 202752,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "z-ai/glm-5.1",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "z-ai/glm-5.2",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "z-ai/glm-5v-turbo",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 202752,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "~anthropic/claude-fable-latest",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "~anthropic/claude-haiku-latest",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "~anthropic/claude-opus-latest",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "~anthropic/claude-sonnet-latest",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "~google/gemini-flash-latest",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "~google/gemini-pro-latest",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "~moonshotai/kimi-latest",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "~openai/gpt-latest",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 1050000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "~openai/gpt-mini-latest",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "~x-ai/grok-latest",
    "baseUrl": "https://openrouter.ai/api/v1",
    "protocol": "openai",
    "contextWindow": 500000,
    "maxOutputTokens": 4096,
    "reasoning": true
  },
  {
    "id": "MiniMaxAI/MiniMax-M2.7",
    "baseUrl": "https://api.together.ai/v1",
    "protocol": "openai",
    "contextWindow": 202752,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "MiniMaxAI/MiniMax-M3",
    "baseUrl": "https://api.together.ai/v1",
    "protocol": "openai",
    "contextWindow": 524288,
    "maxOutputTokens": 250000,
    "reasoning": true
  },
  {
    "id": "Qwen/Qwen2.5-7B-Instruct-Turbo",
    "baseUrl": "https://api.together.ai/v1",
    "protocol": "openai",
    "contextWindow": 32768,
    "maxOutputTokens": 32768,
    "reasoning": false
  },
  {
    "id": "Qwen/Qwen3-235B-A22B-Instruct-2507-tput",
    "baseUrl": "https://api.together.ai/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": false
  },
  {
    "id": "Qwen/Qwen3.5-397B-A17B",
    "baseUrl": "https://api.together.ai/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 130000,
    "reasoning": true
  },
  {
    "id": "Qwen/Qwen3.5-9B",
    "baseUrl": "https://api.together.ai/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "Qwen/Qwen3.6-Plus",
    "baseUrl": "https://api.together.ai/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 500000,
    "reasoning": true
  },
  {
    "id": "Qwen/Qwen3.7-Max",
    "baseUrl": "https://api.together.ai/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 500000,
    "reasoning": false
  },
  {
    "id": "deepseek-ai/DeepSeek-V4-Pro",
    "baseUrl": "https://api.together.ai/v1",
    "protocol": "openai",
    "contextWindow": 512000,
    "maxOutputTokens": 384000,
    "reasoning": true
  },
  {
    "id": "essentialai/Rnj-1-Instruct",
    "baseUrl": "https://api.together.ai/v1",
    "protocol": "openai",
    "contextWindow": 32768,
    "maxOutputTokens": 32768,
    "reasoning": false
  },
  {
    "id": "google/gemma-4-31B-it",
    "baseUrl": "https://api.together.ai/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    "baseUrl": "https://api.together.ai/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 131072,
    "reasoning": false
  },
  {
    "id": "moonshotai/Kimi-K2.6",
    "baseUrl": "https://api.together.ai/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 131000,
    "reasoning": true
  },
  {
    "id": "moonshotai/Kimi-K2.7-Code",
    "baseUrl": "https://api.together.ai/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "nvidia/nemotron-3-ultra-550b-a55b",
    "baseUrl": "https://api.together.ai/v1",
    "protocol": "openai",
    "contextWindow": 512300,
    "maxOutputTokens": 512300,
    "reasoning": true
  },
  {
    "id": "openai/gpt-oss-120b",
    "baseUrl": "https://api.together.ai/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "openai/gpt-oss-20b",
    "baseUrl": "https://api.together.ai/v1",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "zai-org/GLM-5",
    "baseUrl": "https://api.together.ai/v1",
    "protocol": "openai",
    "contextWindow": 202752,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "zai-org/GLM-5.1",
    "baseUrl": "https://api.together.ai/v1",
    "protocol": "openai",
    "contextWindow": 202752,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "zai-org/GLM-5.2",
    "baseUrl": "https://api.together.ai/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 164000,
    "reasoning": true
  },
  {
    "id": "alibaba/qwen-3-14b",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 40960,
    "maxOutputTokens": 16384,
    "reasoning": true
  },
  {
    "id": "alibaba/qwen-3-235b",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 262144,
    "maxOutputTokens": 16384,
    "reasoning": true
  },
  {
    "id": "alibaba/qwen-3-30b",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 40960,
    "maxOutputTokens": 16384,
    "reasoning": true
  },
  {
    "id": "alibaba/qwen-3-32b",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 128000,
    "maxOutputTokens": 8192,
    "reasoning": true
  },
  {
    "id": "alibaba/qwen-3.6-max-preview",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 240000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "alibaba/qwen3-235b-a22b-thinking",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 131072,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "alibaba/qwen3-coder",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 262144,
    "maxOutputTokens": 65536,
    "reasoning": false
  },
  {
    "id": "alibaba/qwen3-coder-30b-a3b",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 262144,
    "maxOutputTokens": 8192,
    "reasoning": false
  },
  {
    "id": "alibaba/qwen3-coder-next",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 256000,
    "maxOutputTokens": 256000,
    "reasoning": false
  },
  {
    "id": "alibaba/qwen3-coder-plus",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 65536,
    "reasoning": false
  },
  {
    "id": "alibaba/qwen3-max",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 262144,
    "maxOutputTokens": 32768,
    "reasoning": false
  },
  {
    "id": "alibaba/qwen3-max-preview",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 262144,
    "maxOutputTokens": 32768,
    "reasoning": false
  },
  {
    "id": "alibaba/qwen3-max-thinking",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 256000,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "alibaba/qwen3-next-80b-a3b-instruct",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 131072,
    "maxOutputTokens": 32768,
    "reasoning": false
  },
  {
    "id": "alibaba/qwen3-next-80b-a3b-thinking",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 131072,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "alibaba/qwen3-vl-235b-a22b-instruct",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 131072,
    "maxOutputTokens": 129024,
    "reasoning": false
  },
  {
    "id": "alibaba/qwen3-vl-instruct",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 131072,
    "maxOutputTokens": 129024,
    "reasoning": false
  },
  {
    "id": "alibaba/qwen3-vl-thinking",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 131072,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "alibaba/qwen3.5-flash",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "alibaba/qwen3.5-plus",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "alibaba/qwen3.6-27b",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 256000,
    "maxOutputTokens": 256000,
    "reasoning": true
  },
  {
    "id": "alibaba/qwen3.6-plus",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "alibaba/qwen3.7-max",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 991000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "alibaba/qwen3.7-plus",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "amazon/nova-2-lite",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 1000000,
    "reasoning": true
  },
  {
    "id": "amazon/nova-lite",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 300000,
    "maxOutputTokens": 8192,
    "reasoning": false
  },
  {
    "id": "amazon/nova-micro",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 128000,
    "maxOutputTokens": 8192,
    "reasoning": false
  },
  {
    "id": "amazon/nova-pro",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 300000,
    "maxOutputTokens": 8192,
    "reasoning": false
  },
  {
    "id": "anthropic/claude-3-haiku",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "anthropic/claude-fable-5",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "anthropic/claude-haiku-4.5",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "anthropic/claude-opus-4",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 8192,
    "reasoning": true
  },
  {
    "id": "anthropic/claude-opus-4.1",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 32000,
    "reasoning": true
  },
  {
    "id": "anthropic/claude-opus-4.5",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "anthropic/claude-opus-4.6",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "anthropic/claude-opus-4.7",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "anthropic/claude-opus-4.7-fast",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "anthropic/claude-opus-4.8",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "anthropic/claude-opus-4.8-fast",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "anthropic/claude-sonnet-4",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 8192,
    "reasoning": true
  },
  {
    "id": "anthropic/claude-sonnet-4.5",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "anthropic/claude-sonnet-4.6",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "anthropic/claude-sonnet-5",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "arcee-ai/trinity-large-thinking",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 262100,
    "maxOutputTokens": 80000,
    "reasoning": true
  },
  {
    "id": "arcee-ai/trinity-mini",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 131072,
    "maxOutputTokens": 131072,
    "reasoning": false
  },
  {
    "id": "bytedance/seed-1.6",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 256000,
    "maxOutputTokens": 32000,
    "reasoning": true
  },
  {
    "id": "bytedance/seed-1.8",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 256000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "cohere/command-a",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 256000,
    "maxOutputTokens": 8000,
    "reasoning": false
  },
  {
    "id": "deepseek/deepseek-r1",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 128000,
    "maxOutputTokens": 8192,
    "reasoning": true
  },
  {
    "id": "deepseek/deepseek-v3",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 163840,
    "maxOutputTokens": 163840,
    "reasoning": false
  },
  {
    "id": "deepseek/deepseek-v3.1",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 163840,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "deepseek/deepseek-v3.1-terminus",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 131072,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "deepseek/deepseek-v3.2",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 128000,
    "maxOutputTokens": 8000,
    "reasoning": false
  },
  {
    "id": "deepseek/deepseek-v3.2-thinking",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 128000,
    "maxOutputTokens": 8000,
    "reasoning": true
  },
  {
    "id": "deepseek/deepseek-v4-flash",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 384000,
    "reasoning": true
  },
  {
    "id": "deepseek/deepseek-v4-pro",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 384000,
    "reasoning": true
  },
  {
    "id": "google/gemini-2.5-flash",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "google/gemini-2.5-flash-lite",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1048576,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "google/gemini-2.5-pro",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1048576,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "google/gemini-3-flash",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 65000,
    "reasoning": true
  },
  {
    "id": "google/gemini-3-pro-preview",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "google/gemini-3.1-flash-lite",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 65000,
    "reasoning": true
  },
  {
    "id": "google/gemini-3.1-flash-lite-preview",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 65000,
    "reasoning": true
  },
  {
    "id": "google/gemini-3.1-pro-preview",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "google/gemini-3.5-flash",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "google/gemma-4-26b-a4b-it",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 262144,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "google/gemma-4-31b-it",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 262144,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "inception/mercury-2",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 128000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "inception/mercury-coder-small",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 32000,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "interfaze/interfaze-beta",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 32000,
    "reasoning": true
  },
  {
    "id": "kwaipilot/kat-coder-air-v2.5",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 256000,
    "maxOutputTokens": 80000,
    "reasoning": true
  },
  {
    "id": "kwaipilot/kat-coder-pro-v1",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 256000,
    "maxOutputTokens": 32000,
    "reasoning": false
  },
  {
    "id": "kwaipilot/kat-coder-pro-v2",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 256000,
    "maxOutputTokens": 256000,
    "reasoning": true
  },
  {
    "id": "kwaipilot/kat-coder-pro-v2.5",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 256000,
    "maxOutputTokens": 80000,
    "reasoning": true
  },
  {
    "id": "meta/llama-3.1-70b",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 128000,
    "maxOutputTokens": 8192,
    "reasoning": false
  },
  {
    "id": "meta/llama-3.1-8b",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 128000,
    "maxOutputTokens": 8192,
    "reasoning": false
  },
  {
    "id": "meta/llama-3.2-11b",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 128000,
    "maxOutputTokens": 8192,
    "reasoning": false
  },
  {
    "id": "meta/llama-3.2-90b",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 128000,
    "maxOutputTokens": 8192,
    "reasoning": false
  },
  {
    "id": "meta/llama-3.3-70b",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 128000,
    "maxOutputTokens": 8192,
    "reasoning": false
  },
  {
    "id": "meta/llama-4-maverick",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 128000,
    "maxOutputTokens": 8192,
    "reasoning": false
  },
  {
    "id": "meta/llama-4-scout",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 128000,
    "maxOutputTokens": 8192,
    "reasoning": false
  },
  {
    "id": "meta/muse-spark-1.1",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1048576,
    "maxOutputTokens": 1048576,
    "reasoning": true
  },
  {
    "id": "minimax/minimax-m2",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 205000,
    "maxOutputTokens": 205000,
    "reasoning": true
  },
  {
    "id": "minimax/minimax-m2.1",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 204800,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "minimax/minimax-m2.1-lightning",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 204800,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "minimax/minimax-m2.5",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 204800,
    "maxOutputTokens": 131000,
    "reasoning": true
  },
  {
    "id": "minimax/minimax-m2.5-highspeed",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 204800,
    "maxOutputTokens": 131000,
    "reasoning": true
  },
  {
    "id": "minimax/minimax-m2.7",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 204800,
    "maxOutputTokens": 131000,
    "reasoning": true
  },
  {
    "id": "minimax/minimax-m2.7-highspeed",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 204800,
    "maxOutputTokens": 131100,
    "reasoning": true
  },
  {
    "id": "minimax/minimax-m3",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 1000000,
    "reasoning": true
  },
  {
    "id": "mistral/codestral",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 128000,
    "maxOutputTokens": 4000,
    "reasoning": false
  },
  {
    "id": "mistral/devstral-2",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 256000,
    "maxOutputTokens": 256000,
    "reasoning": false
  },
  {
    "id": "mistral/devstral-small-2",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 256000,
    "maxOutputTokens": 256000,
    "reasoning": false
  },
  {
    "id": "mistral/magistral-medium",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 128000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "mistral/magistral-small",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 128000,
    "maxOutputTokens": 64000,
    "reasoning": true
  },
  {
    "id": "mistral/ministral-14b",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 256000,
    "maxOutputTokens": 256000,
    "reasoning": false
  },
  {
    "id": "mistral/ministral-3b",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 128000,
    "maxOutputTokens": 4000,
    "reasoning": false
  },
  {
    "id": "mistral/ministral-8b",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 128000,
    "maxOutputTokens": 4000,
    "reasoning": false
  },
  {
    "id": "mistral/mistral-large-3",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 256000,
    "maxOutputTokens": 256000,
    "reasoning": false
  },
  {
    "id": "mistral/mistral-medium",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 128000,
    "maxOutputTokens": 64000,
    "reasoning": false
  },
  {
    "id": "mistral/mistral-medium-3.5",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 256000,
    "maxOutputTokens": 256000,
    "reasoning": true
  },
  {
    "id": "mistral/mistral-nemo",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 128000,
    "maxOutputTokens": 128000,
    "reasoning": false
  },
  {
    "id": "mistral/mistral-small",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 32000,
    "maxOutputTokens": 4000,
    "reasoning": false
  },
  {
    "id": "mistral/pixtral-12b",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 128000,
    "maxOutputTokens": 4000,
    "reasoning": false
  },
  {
    "id": "moonshotai/kimi-k2",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 131072,
    "maxOutputTokens": 131072,
    "reasoning": false
  },
  {
    "id": "moonshotai/kimi-k2-thinking",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 216144,
    "maxOutputTokens": 216144,
    "reasoning": true
  },
  {
    "id": "moonshotai/kimi-k2.5",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 262114,
    "maxOutputTokens": 262114,
    "reasoning": true
  },
  {
    "id": "moonshotai/kimi-k2.6",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 262000,
    "maxOutputTokens": 262000,
    "reasoning": true
  },
  {
    "id": "moonshotai/kimi-k2.7-code",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 256000,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "moonshotai/kimi-k2.7-code-highspeed",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 262144,
    "maxOutputTokens": 32768,
    "reasoning": true
  },
  {
    "id": "moonshotai/kimi-k3",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "nvidia/nemotron-3-nano-30b-a3b",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 262144,
    "maxOutputTokens": 262144,
    "reasoning": true
  },
  {
    "id": "nvidia/nemotron-3-super-120b-a12b",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 256000,
    "maxOutputTokens": 32000,
    "reasoning": true
  },
  {
    "id": "nvidia/nemotron-3-ultra-550b-a55b",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 65000,
    "reasoning": true
  },
  {
    "id": "nvidia/nemotron-nano-12b-v2-vl",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 131072,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "nvidia/nemotron-nano-9b-v2",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 131072,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "openai/gpt-3.5-turbo",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 16385,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "openai/gpt-4-turbo",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 128000,
    "maxOutputTokens": 4096,
    "reasoning": false
  },
  {
    "id": "openai/gpt-4.1",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1047576,
    "maxOutputTokens": 32768,
    "reasoning": false
  },
  {
    "id": "openai/gpt-4.1-mini",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1047576,
    "maxOutputTokens": 32768,
    "reasoning": false
  },
  {
    "id": "openai/gpt-4.1-nano",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1047576,
    "maxOutputTokens": 32768,
    "reasoning": false
  },
  {
    "id": "openai/gpt-4o",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 128000,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "openai/gpt-4o-mini",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 128000,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "openai/gpt-5",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5-chat",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 128000,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "openai/gpt-5-codex",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5-mini",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5-nano",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5-pro",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 400000,
    "maxOutputTokens": 272000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.1-codex",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.1-codex-max",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.1-codex-mini",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.1-instant",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 128000,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "openai/gpt-5.1-thinking",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.2",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.2-chat",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 128000,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "openai/gpt-5.2-codex",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.2-pro",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.3-chat",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 128000,
    "maxOutputTokens": 16384,
    "reasoning": false
  },
  {
    "id": "openai/gpt-5.3-codex",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.4",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1050000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.4-mini",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.4-nano",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 400000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.4-pro",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1050000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.5",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.5-pro",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.6-luna",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1050000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.6-sol",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1050000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-5.6-terra",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1050000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "openai/gpt-oss-120b",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 131072,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "openai/gpt-oss-20b",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 131072,
    "maxOutputTokens": 8192,
    "reasoning": true
  },
  {
    "id": "openai/gpt-oss-safeguard-20b",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 131072,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "openai/o1",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 100000,
    "reasoning": true
  },
  {
    "id": "openai/o3",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 100000,
    "reasoning": true
  },
  {
    "id": "openai/o3-deep-research",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 100000,
    "reasoning": true
  },
  {
    "id": "openai/o3-mini",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 100000,
    "reasoning": true
  },
  {
    "id": "openai/o3-pro",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 100000,
    "reasoning": true
  },
  {
    "id": "openai/o4-mini",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 100000,
    "reasoning": true
  },
  {
    "id": "sakana/fugu-ultra",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 1000000,
    "reasoning": true
  },
  {
    "id": "stepfun/step-3.5-flash",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 262114,
    "maxOutputTokens": 262114,
    "reasoning": true
  },
  {
    "id": "stepfun/step-3.7-flash",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 256000,
    "maxOutputTokens": 256000,
    "reasoning": true
  },
  {
    "id": "thinkingmachines/inkling",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 256000,
    "maxOutputTokens": 256000,
    "reasoning": true
  },
  {
    "id": "xai/grok-4.1-fast-non-reasoning",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 1000000,
    "reasoning": false
  },
  {
    "id": "xai/grok-4.1-fast-reasoning",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 1000000,
    "reasoning": true
  },
  {
    "id": "xai/grok-4.20-multi-agent",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 2000000,
    "maxOutputTokens": 2000000,
    "reasoning": true
  },
  {
    "id": "xai/grok-4.20-multi-agent-beta",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 2000000,
    "maxOutputTokens": 2000000,
    "reasoning": true
  },
  {
    "id": "xai/grok-4.20-non-reasoning",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 2000000,
    "maxOutputTokens": 2000000,
    "reasoning": false
  },
  {
    "id": "xai/grok-4.20-non-reasoning-beta",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 2000000,
    "maxOutputTokens": 2000000,
    "reasoning": false
  },
  {
    "id": "xai/grok-4.20-reasoning",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 2000000,
    "maxOutputTokens": 2000000,
    "reasoning": true
  },
  {
    "id": "xai/grok-4.20-reasoning-beta",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 2000000,
    "maxOutputTokens": 2000000,
    "reasoning": true
  },
  {
    "id": "xai/grok-4.3",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 1000000,
    "reasoning": true
  },
  {
    "id": "xai/grok-4.5",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 500000,
    "maxOutputTokens": 500000,
    "reasoning": true
  },
  {
    "id": "xai/grok-build-0.1",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 256000,
    "maxOutputTokens": 256000,
    "reasoning": true
  },
  {
    "id": "xiaomi/mimo-v2.5",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1050000,
    "maxOutputTokens": 131100,
    "reasoning": true
  },
  {
    "id": "xiaomi/mimo-v2.5-pro",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1050000,
    "maxOutputTokens": 131000,
    "reasoning": true
  },
  {
    "id": "zai/glm-4.5",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 128000,
    "maxOutputTokens": 96000,
    "reasoning": true
  },
  {
    "id": "zai/glm-4.5-air",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 128000,
    "maxOutputTokens": 96000,
    "reasoning": true
  },
  {
    "id": "zai/glm-4.5v",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 66000,
    "maxOutputTokens": 16000,
    "reasoning": true
  },
  {
    "id": "zai/glm-4.6",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 96000,
    "reasoning": true
  },
  {
    "id": "zai/glm-4.6v",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 128000,
    "maxOutputTokens": 24000,
    "reasoning": true
  },
  {
    "id": "zai/glm-4.6v-flash",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 128000,
    "maxOutputTokens": 24000,
    "reasoning": true
  },
  {
    "id": "zai/glm-4.7",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 120000,
    "reasoning": true
  },
  {
    "id": "zai/glm-4.7-flash",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 131000,
    "reasoning": true
  },
  {
    "id": "zai/glm-4.7-flashx",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "zai/glm-5",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 202800,
    "maxOutputTokens": 131100,
    "reasoning": true
  },
  {
    "id": "zai/glm-5-turbo",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 202800,
    "maxOutputTokens": 131100,
    "reasoning": true
  },
  {
    "id": "zai/glm-5.1",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 202000,
    "maxOutputTokens": 202000,
    "reasoning": true
  },
  {
    "id": "zai/glm-5.2",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1040000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "zai/glm-5.2-fast",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "zai/glm-5v-turbo",
    "baseUrl": "https://ai-gateway.vercel.sh",
    "protocol": "anthropic",
    "contextWindow": 200000,
    "maxOutputTokens": 128000,
    "reasoning": true
  },
  {
    "id": "grok-4.3",
    "baseUrl": "https://api.x.ai/v1",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 30000,
    "reasoning": true
  },
  {
    "id": "grok-4.5",
    "baseUrl": "https://api.x.ai/v1",
    "protocol": "openai",
    "contextWindow": 500000,
    "maxOutputTokens": 500000,
    "reasoning": true
  },
  {
    "id": "grok-build-0.1",
    "baseUrl": "https://api.x.ai/v1",
    "protocol": "openai",
    "contextWindow": 256000,
    "maxOutputTokens": 256000,
    "reasoning": true
  },
  {
    "id": "mimo-v2-flash",
    "baseUrl": "https://api.xiaomimimo.com/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 65536,
    "reasoning": true
  },
  {
    "id": "mimo-v2-omni",
    "baseUrl": "https://api.xiaomimimo.com/v1",
    "protocol": "openai",
    "contextWindow": 262144,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "mimo-v2-pro",
    "baseUrl": "https://api.xiaomimimo.com/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "mimo-v2.5",
    "baseUrl": "https://api.xiaomimimo.com/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "mimo-v2.5-pro",
    "baseUrl": "https://api.xiaomimimo.com/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "mimo-v2.5-pro-ultraspeed",
    "baseUrl": "https://api.xiaomimimo.com/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "mimo-v2-pro",
    "baseUrl": "https://token-plan-ams.xiaomimimo.com/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "mimo-v2.5",
    "baseUrl": "https://token-plan-ams.xiaomimimo.com/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "mimo-v2.5-pro",
    "baseUrl": "https://token-plan-ams.xiaomimimo.com/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "mimo-v2-pro",
    "baseUrl": "https://token-plan-cn.xiaomimimo.com/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "mimo-v2.5",
    "baseUrl": "https://token-plan-cn.xiaomimimo.com/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "mimo-v2.5-pro",
    "baseUrl": "https://token-plan-cn.xiaomimimo.com/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "mimo-v2-pro",
    "baseUrl": "https://token-plan-sgp.xiaomimimo.com/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "mimo-v2.5",
    "baseUrl": "https://token-plan-sgp.xiaomimimo.com/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "mimo-v2.5-pro",
    "baseUrl": "https://token-plan-sgp.xiaomimimo.com/v1",
    "protocol": "openai",
    "contextWindow": 1048576,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "glm-4.5-air",
    "baseUrl": "https://api.z.ai/api/coding/paas/v4",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 98304,
    "reasoning": true
  },
  {
    "id": "glm-4.7",
    "baseUrl": "https://api.z.ai/api/coding/paas/v4",
    "protocol": "openai",
    "contextWindow": 204800,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "glm-5-turbo",
    "baseUrl": "https://api.z.ai/api/coding/paas/v4",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "glm-5.1",
    "baseUrl": "https://api.z.ai/api/coding/paas/v4",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "glm-5.2",
    "baseUrl": "https://api.z.ai/api/coding/paas/v4",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "glm-5v-turbo",
    "baseUrl": "https://api.z.ai/api/coding/paas/v4",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "glm-4.5-air",
    "baseUrl": "https://open.bigmodel.cn/api/coding/paas/v4",
    "protocol": "openai",
    "contextWindow": 131072,
    "maxOutputTokens": 98304,
    "reasoning": true
  },
  {
    "id": "glm-4.7",
    "baseUrl": "https://open.bigmodel.cn/api/coding/paas/v4",
    "protocol": "openai",
    "contextWindow": 204800,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "glm-5-turbo",
    "baseUrl": "https://open.bigmodel.cn/api/coding/paas/v4",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "glm-5.1",
    "baseUrl": "https://open.bigmodel.cn/api/coding/paas/v4",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "glm-5.2",
    "baseUrl": "https://open.bigmodel.cn/api/coding/paas/v4",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "glm-5v-turbo",
    "baseUrl": "https://open.bigmodel.cn/api/coding/paas/v4",
    "protocol": "openai",
    "contextWindow": 200000,
    "maxOutputTokens": 131072,
    "reasoning": true
  },
  {
    "id": "deepseek-flash",
    "baseUrl": "https://api.deepseek.com",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 384000,
    "reasoning": true
  },
  {
    "id": "deepseek-v4-flash-vision-exp",
    "baseUrl": "https://api.deepseek.com",
    "protocol": "openai",
    "contextWindow": 1000000,
    "maxOutputTokens": 384000,
    "reasoning": true
  },
  {
    "id": "deepseek-v4-flash",
    "baseUrl": "https://api.deepseek.com/anthropic",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 384000,
    "reasoning": true
  },
  {
    "id": "deepseek-flash",
    "baseUrl": "https://api.deepseek.com/anthropic",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 384000,
    "reasoning": true
  },
  {
    "id": "deepseek-v4-pro",
    "baseUrl": "https://api.deepseek.com/anthropic",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 384000,
    "reasoning": true
  },
  {
    "id": "deepseek-v4-flash-vision-exp",
    "baseUrl": "https://api.deepseek.com/anthropic",
    "protocol": "anthropic",
    "contextWindow": 1000000,
    "maxOutputTokens": 384000,
    "reasoning": true
  }
];
