(function initResumeDataLayer(global) {
  "use strict";

  const SOURCE = "resume-editor-prototype";

  function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function parseJson(text, fallback = null) {
    try {
      return JSON.parse(text);
    } catch {
      return fallback;
    }
  }

  function byteLength(text) {
    return new Blob([String(text || "")]).size;
  }

  function writeJson(key, value) {
    const serialized = JSON.stringify(value);
    try {
      localStorage.setItem(key, serialized);
      return { ok: true, serialized, bytes: byteLength(serialized), error: null };
    } catch (error) {
      const quotaExceeded = error?.name === "QuotaExceededError" || error?.code === 22 || error?.code === 1014;
      return { ok: false, serialized, bytes: byteLength(serialized), quotaExceeded, error };
    }
  }

  function readJson(key) {
    const serialized = localStorage.getItem(key);
    if (!serialized) return { ok: true, value: null, serialized: "", error: null };
    const value = parseJson(serialized, undefined);
    if (value === undefined) {
      return { ok: false, value: null, serialized, error: new Error(`Invalid JSON in ${key}`) };
    }
    return { ok: true, value, serialized, error: null };
  }

  function buildBackup(editor, workbench, versions = {}) {
    return {
      source: SOURCE,
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      schemaVersions: {
        editor: Number(versions.editor || editor?.schema || 0),
        workbench: Number(versions.workbench || workbench?.schema || 0)
      },
      editor: clone(editor),
      workbench: clone(workbench)
    };
  }

  function validateBackup(payload) {
    if (!payload || typeof payload !== "object") return { ok: false, reason: "备份文件不是有效对象" };
    if (payload.source !== SOURCE) return { ok: false, reason: "不是本项目生成的备份文件" };
    if (Number(payload.formatVersion) !== 1) return { ok: false, reason: "备份格式版本不受支持" };
    if (!payload.editor || typeof payload.editor !== "object") return { ok: false, reason: "备份中缺少简历编辑数据" };
    if (!payload.workbench || typeof payload.workbench !== "object") return { ok: false, reason: "备份中缺少工作台数据" };
    return { ok: true, reason: "" };
  }

  function downloadJson(fileName, value) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function readJsonFile(file) {
    if (!file) throw new Error("未选择备份文件");
    const text = await file.text();
    const value = parseJson(text, undefined);
    if (value === undefined) throw new Error("备份文件 JSON 格式无效");
    return value;
  }

  global.ResumeDataLayer = Object.freeze({
    SOURCE,
    clone,
    parseJson,
    byteLength,
    writeJson,
    readJson,
    buildBackup,
    validateBackup,
    downloadJson,
    readJsonFile
  });
})(globalThis);
