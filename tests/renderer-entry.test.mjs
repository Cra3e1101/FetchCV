import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { rendererEntry } from "../electron/renderer-entry.mjs";
import { isTrustedFrame } from "../packages/app/runtime-rpc.mjs";
import { developmentProfile } from "../scripts/dev-profile.mjs";
const projectRoot = path.resolve(".");
const devEnv = { FETCHCV_DEV_SERVER_URL: "http://127.0.0.1:14361/", FETCHCV_DEV_USER_DATA: path.join(projectRoot, ".m1-work", "dev-profile") };
test("packaged renderer ignores development URL", () => {
  const entry = rendererEntry({ projectRoot, isPackaged: true, env: devEnv });
  assert.equal(entry.development, false);
  assert.ok(entry.url.startsWith("file:///"));
});
test("development requires exact loopback root and explicit profile", () => {
  assert.equal(rendererEntry({ projectRoot, isPackaged: false, env: devEnv }).url, devEnv.FETCHCV_DEV_SERVER_URL);
  for (const url of ["https://example.com/", "http://localhost:14361/", "http://127.0.0.1:14361/evil", "http://127.0.0.1:14361/?x=1", "http://user@127.0.0.1:14361/"]) {
    assert.throws(() => rendererEntry({ projectRoot, isPackaged: false, env: { ...devEnv, FETCHCV_DEV_SERVER_URL: url } }));
  }
  assert.throws(() => rendererEntry({ projectRoot, isPackaged: false, env: { ...devEnv, FETCHCV_DEV_USER_DATA: "" } }));
  assert.throws(() => rendererEntry({ projectRoot, isPackaged: false, env: { ...devEnv, FETCHCV_DEV_SESSION_DATA: "relative" } }));
});
test("shared development uses the installed data and session roots without a copy", () => {
  const userData = path.join(projectRoot, "installed-profile");
  assert.deepEqual(developmentProfile({ workRoot: projectRoot, userData }), { data: userData, session: userData, shared: true });
  for (const invalid of ["", "relative"]) assert.throws(() => developmentProfile({ workRoot: projectRoot, userData: invalid }));
});
test("isolated development remains available for synthetic tests", () => {
  const data = path.join(projectRoot, "user-data");
  assert.deepEqual(developmentProfile({ workRoot: projectRoot }), { data, session: path.join(data, "session"), shared: false });
});
test("development RPC still rejects other ports, documents, and subframes", () => {
  const mainFrame = { url: devEnv.FETCHCV_DEV_SERVER_URL };
  const sender = { mainFrame, isDestroyed: () => false };
  assert.ok(isTrustedFrame({ sender, senderFrame: mainFrame }, devEnv.FETCHCV_DEV_SERVER_URL));
  for (const url of ["http://127.0.0.1:14362/", "http://127.0.0.1:14361/other"]) {
    mainFrame.url = url;
    assert.equal(isTrustedFrame({ sender, senderFrame: mainFrame }, devEnv.FETCHCV_DEV_SERVER_URL), false);
  }
  assert.equal(isTrustedFrame({ sender, senderFrame: { url: devEnv.FETCHCV_DEV_SERVER_URL } }, devEnv.FETCHCV_DEV_SERVER_URL), false);
});
