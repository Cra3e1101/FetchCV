import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { listWorkspaceFiles } from "../electron/workspace-files.mjs";

async function fixture(t) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const directory = await mkdtemp(path.join(temporaryRoot, "fetchcv-workspace-files-"));
  t.after(async () => {
    assert.equal(path.dirname(directory), temporaryRoot);
    assert.ok(path.basename(directory).startsWith("fetchcv-workspace-files-"));
    await rm(directory, { recursive: true, force: true });
  });
  const root = path.join(directory, "workspace");
  await mkdir(root);
  const file = async (relativePath, content = "fixture") => {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
    return absolutePath;
  };
  return { directory, root, file };
}

test("workspace file references expose relative paths and sizes for nested imports", async t => {
  const { root, file } = await fixture(t);
  await file("imports/batch/中文 简历.pdf", "pdf");
  await file("notes.md", "notes");
  assert.deepEqual(await listWorkspaceFiles(root), [
    { name: "中文 简历.pdf", workspacePath: "imports/batch/中文 简历.pdf", sizeBytes: 3 },
    { name: "notes.md", workspacePath: "notes.md", sizeBytes: 5 },
  ]);
});

test("hidden files and dependency directories are excluded at every level", async t => {
  const { root, file } = await fixture(t);
  for (const name of [".env", ".git/config", "imports/.secrets/token", "node_modules/pkg/index.js", "imports/__pycache__/secret.pyc", "safe/notes.md"]) await file(name);
  assert.deepEqual((await listWorkspaceFiles(root)).map(item => item.workspacePath), ["safe/notes.md"]);
});

test("file count, depth, and traversal budgets bound a listing", async t => {
  const { root, file } = await fixture(t);
  await file("a.txt"); await file("b.txt"); await file("one/two/deep.txt");
  assert.equal((await listWorkspaceFiles(root, { maxFiles: 1 })).length, 1);
  assert.deepEqual((await listWorkspaceFiles(root, { maxDepth: 2 })).map(item => item.workspacePath), ["a.txt", "b.txt"]);
  assert.ok((await listWorkspaceFiles(root, { maxEntries: 1 })).length <= 1);
});

test("directory links cannot expose outside files or duplicate in-scope files", async t => {
  const { directory, root, file } = await fixture(t);
  await file("safe/notes.md");
  const outside = path.join(directory, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "private.txt"), "private");
  await symlink(outside, path.join(root, "outside-link"), "junction");
  await symlink(path.join(root, "safe"), path.join(root, "inside-link"), "junction");
  assert.ok((await lstat(path.join(root, "outside-link"))).isSymbolicLink());
  assert.deepEqual((await listWorkspaceFiles(root)).map(item => item.workspacePath), ["safe/notes.md"]);
  await assert.rejects(listWorkspaceFiles(path.join(root, "outside-link")), /普通目录/);
});

test("a new missing workspace is empty and relative roots are refused", async t => {
  const { directory } = await fixture(t);
  assert.deepEqual(await listWorkspaceFiles(path.join(directory, "not-created")), []);
  await assert.rejects(listWorkspaceFiles("workspace"), /绝对路径/);
});
