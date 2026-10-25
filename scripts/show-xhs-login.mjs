import { resolveElectronRuntime } from "./electron-runtime.mjs";
import { _electron as electron } from "playwright";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
// Explicit interactive login helper; reuses the project browser profile and account state.
// Do not include this in unattended or isolated smoke tests.
const app = await electron.launch({ executablePath: (await resolveElectronRuntime({ projectRoot: root })).executable, args: [path.join(root, "scripts/xhs-login-window.mjs")], cwd: root, timeout: 60000 });
const page = await app.firstWindow({ timeout: 60000 });
await page.waitForLoadState("domcontentloaded");
await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.show(); win.focus(); });
const login = page.getByText("登录", { exact: true }).first();
await login.waitFor({ state: "visible", timeout: 30000 });
await login.click();
await page.locator('.qrcode-img').waitFor({ state: "visible", timeout: 30000 });
await page.screenshot({ path: path.join(root, "artifacts/didi-live/login-window.png") });
console.log("LOGIN_WINDOW_VISIBLE", await page.title());
await new Promise(resolve => app.on("close", resolve));
