import assert from "node:assert/strict";
import test from "node:test";
import { buildModelsUrlCandidates, parseModelsResponse, redactProviderError } from "../electron/provider-utils.mjs";

test("derives OpenAI-compatible model endpoints", () => {
  assert.deepEqual(buildModelsUrlCandidates("https://api.example.com"), ["https://api.example.com/v1/models"]);
  assert.deepEqual(buildModelsUrlCandidates("https://api.example.com/v1"), ["https://api.example.com/v1/models"]);
  assert.deepEqual(buildModelsUrlCandidates("https://open.bigmodel.cn/api/coding/paas/v4"), [
    "https://open.bigmodel.cn/api/coding/paas/v4/models",
    "https://open.bigmodel.cn/api/coding/paas/v4/v1/models",
  ]);
});

test("strips known Anthropic-compatible suffixes as fallbacks", () => {
  assert.deepEqual(buildModelsUrlCandidates("https://api.deepseek.com/anthropic"), [
    "https://api.deepseek.com/anthropic/v1/models",
    "https://api.deepseek.com/v1/models",
    "https://api.deepseek.com/models",
  ]);
});

test("honors an explicit models URL", () => {
  assert.deepEqual(buildModelsUrlCandidates("https://api.example.com", { modelsUrlOverride: "https://catalog.example.com/models/" }), [
    "https://catalog.example.com/models",
  ]);
});

test("rejects insecure or credential-bearing model catalog URLs", () => {
  assert.throws(() => buildModelsUrlCandidates("https://api.example.com", { modelsUrlOverride: "http://models.example.com/v1/models" }), /HTTPS/);
  assert.throws(() => buildModelsUrlCandidates("https://api.example.com", { modelsUrlOverride: "https://user:secret@models.example.com/v1/models" }), /credentials/);
  assert.deepEqual(buildModelsUrlCandidates("http://127.0.0.1:11434", { modelsUrlOverride: "http://127.0.0.1:11434/v1/models" }), ["http://127.0.0.1:11434/v1/models"]);
});

test("normalizes and de-duplicates common model response shapes", () => {
  assert.deepEqual(parseModelsResponse({ data: [
    { id: "model-b", owned_by: "acme" },
    { id: "model-a" },
    { id: "model-a" },
  ] }), [
    { id: "model-a", ownedBy: "" },
    { id: "model-b", ownedBy: "acme" },
  ]);
  assert.deepEqual(parseModelsResponse({ models: ["zeta", "alpha"] }), [
    { id: "alpha", ownedBy: "" },
    { id: "zeta", ownedBy: "" },
  ]);
});

test("redacts credentials from provider errors", () => {
  assert.equal(redactProviderError('{"error":{"message":"bad sk-secret"}}', "sk-secret"), "bad [已隐藏]");
});
