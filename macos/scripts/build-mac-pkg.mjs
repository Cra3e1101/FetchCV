import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { packagedExecutablePath } from "./platform-paths.mjs";

const projectRoot = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const arch = process.arch === "x64" ? "x64" : "arm64";
const executablePath = packagedExecutablePath(projectRoot);
const appPath = path.dirname(path.dirname(path.dirname(executablePath)));
const outputPath = path.join(projectRoot, "release", `FetchCV-${packageJson.version}-${arch}.pkg`);

if (!fs.existsSync(appPath)) {
  console.error(`Missing packaged app: ${appPath}`);
  process.exit(1);
}

const result = spawnSync("pkgbuild", ["--component", appPath, "--install-location", "/Applications", outputPath], {
  cwd: projectRoot,
  stdio: "inherit",
});

if (result.error) {
  console.error(`Unable to create the macOS installer: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
