import { lstat, opendir, realpath } from "node:fs/promises";
import path from "node:path";

const IGNORED_NAMES = new Set(["node_modules", "__pycache__"]);
const MAX_FILES = 2000;
const MAX_DEPTH = 8;
const MAX_ENTRIES = 20000;
const missing = error => error?.code === "ENOENT" || error?.code === "ENOTDIR";
const withinRoot = (root, target) => {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

/** List metadata for user files only; never follow links or read file contents. */
export async function listWorkspaceFiles(workspaceRoot, { maxFiles = MAX_FILES, maxDepth = MAX_DEPTH, maxEntries = MAX_ENTRIES } = {}) {
  if (!path.isAbsolute(workspaceRoot)) throw new Error("工作区路径必须为绝对路径");
  const limit = Math.max(1, Math.min(MAX_FILES, Math.floor(maxFiles) || MAX_FILES));
  const depthLimit = Math.max(1, Math.min(MAX_DEPTH, Math.floor(maxDepth) || MAX_DEPTH));
  const entryLimit = Math.max(1, Math.min(MAX_ENTRIES, Math.floor(maxEntries) || MAX_ENTRIES));
  let root;
  try {
    const stat = await lstat(workspaceRoot);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("工作区路径必须是普通目录");
    root = await realpath(workspaceRoot);
  } catch (error) {
    if (missing(error)) return [];
    throw error;
  }

  const files = [];
  const directories = [{ absolutePath: root, depth: 0 }];
  let inspected = 0;
  for (let index = 0; index < directories.length && files.length < limit && inspected < entryLimit; index += 1) {
    const { absolutePath, depth } = directories[index];
    try {
      // Recheck queued directories in case a file operation replaced one with a link.
      const directoryStat = await lstat(absolutePath);
      if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory() || !withinRoot(root, await realpath(absolutePath))) continue;
      const directory = await opendir(absolutePath);
      for await (const entry of directory) {
        inspected += 1;
        if (!entry.name.startsWith(".") && !IGNORED_NAMES.has(entry.name.toLowerCase()) && !entry.isSymbolicLink()) {
          const target = path.join(absolutePath, entry.name);
          try {
            const stat = await lstat(target);
            if (!stat.isSymbolicLink() && withinRoot(root, await realpath(target))) {
              if (stat.isDirectory() && depth + 1 < depthLimit) {
                directories.push({ absolutePath: target, depth: depth + 1 });
              } else if (stat.isFile()) {
                files.push({ name: entry.name, workspacePath: path.relative(root, target).split(path.sep).join("/"), sizeBytes: stat.size });
              }
            }
          } catch (error) {
            // Imports and agent operations may move files while this snapshot is read.
            if (!missing(error) && error?.code !== "EACCES" && error?.code !== "EPERM") throw error;
          }
        }
        if (files.length >= limit || inspected >= entryLimit) break;
      }
    } catch (error) {
      if (!missing(error) && error?.code !== "EACCES" && error?.code !== "EPERM") throw error;
    }
  }
  return files.sort((left, right) => left.workspacePath.localeCompare(right.workspacePath));
}
