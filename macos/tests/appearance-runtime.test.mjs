import assert from "node:assert/strict";
import test from "node:test";
import { applyAppearance, normalizeAppearance, resolvedTheme } from "../src/lib/appearance.js";
import { resolveAgentRuntimeState } from "../src/lib/runtime-state.js";

function fakeRoot() {
  const properties = new Map();
  return {
    dataset: {},
    style: { setProperty: (name, value) => properties.set(name, value) },
    properties,
  };
}

test("appearance normalizes persisted settings and resolves system theme", () => {
  assert.deepEqual(normalizeAppearance({ accent: "invalid", density: "wide", theme: "night" }), {
    accent: "coral", density: "comfortable", theme: "system",
  });
  assert.equal(resolvedTheme("system", { matches: true }), "dark");
  assert.equal(resolvedTheme("system", { matches: false }), "light");
  assert.equal(resolvedTheme("light", { matches: true }), "light");
});

test("appearance applies theme, density and one accent source to the root", () => {
  const root = fakeRoot();
  const appearance = applyAppearance({ accent: "sage", density: "compact", theme: "dark" }, root);
  assert.equal(appearance.theme, "dark");
  assert.equal(root.dataset.theme, "dark");
  assert.equal(root.dataset.density, "compact");
  assert.equal(root.properties.get("--coral"), "#688b78");
  assert.equal(root.properties.get("--coral-dark"), "#4f715f");
});

test("runtime state prioritizes errors and approvals over generic busy flags", () => {
  assert.equal(resolveAgentRuntimeState({ error: "network failed", task: { status: "running" } }).id, "error");
  assert.equal(resolveAgentRuntimeState({ approvals: [{ status: "pending" }], task: { status: "running" } }).id, "awaiting_approval");
  assert.equal(resolveAgentRuntimeState({ task: { status: "paused" } }).id, "paused");
});

test("runtime state distinguishes model streaming from real tool execution", () => {
  const toolState = resolveAgentRuntimeState({
    activity: { kind: "chat", events: [{ id: "tool", kind: "tool", status: "active", label: "读取招聘网页" }] },
  });
  assert.equal(toolState.id, "tool_running");
  assert.equal(toolState.label, "读取招聘网页");
  assert.equal(resolveAgentRuntimeState({ activity: { kind: "chat", label: "正在形成回答", events: [] } }).id, "streaming");
  assert.equal(resolveAgentRuntimeState({}).id, "idle");
});
