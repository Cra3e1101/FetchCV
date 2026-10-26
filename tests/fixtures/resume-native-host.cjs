const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// Exercise the production entry/preload and PDF plugin without opening a
// second visible app or sharing the user's profile, cache or SQLite database.
app.setAppPath(path.resolve(__dirname, "../.."));
BrowserWindow.prototype.show = function () {};
BrowserWindow.prototype.focus = function () {};
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.on("browser-window-created", (_event, window) => window.webContents.setBackgroundThrottling(false));
void import(pathToFileURL(path.join(app.getAppPath(), "build/electron/main.mjs")).href);
