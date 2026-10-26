import fs from "node:fs/promises";
import path from "node:path";

// Fetch through the verified export route before offering a destination.
export async function saveResumeFile({ apiBase, controlToken, resumeId, format, downloadsPath, showSaveDialog, fetchImpl = fetch, writeFile = fs.writeFile }) {
  if (!/^[a-z0-9_-]{8,128}$/i.test(String(resumeId || "")) || !["pdf", "docx"].includes(format)) throw new Error("简历导出参数无效");
  if (!apiBase) throw new Error("本地简历服务尚未启动");
  const response = await fetchImpl(`${apiBase}/api/resumes/${encodeURIComponent(resumeId)}/${format}`, {
    headers: { "x-fetchcv-control-token": controlToken },
  });
  const mime = format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (!response.ok || !(response.headers.get("content-type") || "").includes(mime)) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error?.message || payload?.message || "简历导出失败，请重新核验后重试");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const result = await showSaveDialog({
    title: format === "pdf" ? "导出 PDF 简历" : "导出 Word 简历",
    defaultPath: path.join(downloadsPath, `简历.${format}`),
    filters: [{ name: format === "pdf" ? "PDF" : "Word", extensions: [format] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  await writeFile(result.filePath, bytes);
  return { ok: true, path: result.filePath };
}
