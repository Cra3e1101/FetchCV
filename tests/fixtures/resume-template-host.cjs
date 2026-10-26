const { app, BrowserWindow } = require("electron");
const path = require("node:path");
app.setPath("userData", process.env.FETCHCV_TEMPLATE_TEST_PROFILE);
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { contextIsolation: false, nodeIntegration: false, backgroundThrottling: false } });
  await window.loadFile(path.resolve(__dirname, "../../public/resume-editor/index.html"), { query: { embedded: "1", preview: "1" } });
});
app.on("window-all-closed", () => app.quit());
