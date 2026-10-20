import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// ===========================================================================
// FetchCV M1 —— run-guarded-node **方案 C 接入候选**（candidate，尚未接入 scripts\m1）
//   candidate revision: scheme-c-candidate-2   （r2 局部修正版；r1 = scheme-c-candidate-1）
// r2 相对 r1 的四处局部修正（本轮唯一改动的地方；过滤组合、按引用消费、record_seq、
// 允许范围、就绪握手、独立 helper 与独立协议日志全部保持不变）
//   1) 收到正常 stopped 之后，**有界等待 helper 的真实退出**（watcherExitWaitMs），
//      不再因为 close 还没到就立刻强杀；只有超时才强杀并记录 watcher-helper-exit-timeout；
//      最终仍然要求 helper 的真实退出码为 0（否则本次运行不算干净收尾）。
//   2) 启动前的任何越界/失败都必须阻止 child 启动（violation 也置 fatal），
//      运行期协议解析失败/缺类型/未知消息**直接 child.kill()**，不再只等 helper 被杀后的 close；
//      已记录的错误不会被后来的 ready 或一次干净收尾清除。
//   3) 退出 JSON 明确区分 **run_verdict（整次运行的判定）** 与 **helper_teardown（监视器自身的收尾）**，
//      两者互不推导：越界可以让运行失败而 helper 收尾依然干净（反之亦然）。
//   4) 文档同步（见 40-…md / handoff）：r7 的验收与探针都是 powershell.exe -NoProfile -File 启动，
//      原先"该启动方式尚未验证"的表述已删除。
// 只替换正式版里“递归 fs.watch 监视 + 任何非许可事件即杀子进程”那一段（原第 59–92、127 行）。
// 替换内容
//   * 监视改由同目录的 watch-guard-c.ps1 承担（.NET FileSystemWatcher；过滤组合排除
//     LastAccess，保留 FileName/DirectoryName/Size/LastWrite/Attributes/CreationTime/Security）。
//     证据：w12a-watcher-fix-c-r7-* 的合成验收（14/14）与真实 watcher 探针（53 条通知全部
//     按对象引用消费、3 次编号碰撞分别保留、0 消费失败；S1 A=1/B=0、S2 0/0、S3–S7 两侧均收到）。
//   * **先确认 watcher 就绪（两个递归 watcher 各自观测到自己的就绪文件）再启动受测子进程。**
//   * helper 起不来 / 未就绪 / 中途退出 / 心跳丢失 / 协议坏行 / 审计与自述不一致
//     => 不继续、不报告成功（退出码 86），运行中的子进程按既有方式 child.kill() 停止。
//   * 越界通知（含“重命名旧路径或新路径任一侧越界”）=> child.kill()，退出码 86，与正式版一致。
// 逐条保持不变
//   * 监控根（projectRoot + approvedRoot）、允许区判定（.m1-evidence / .m1-work / tempRoot）、
//     环境隔离与两个删除守卫、NODE_OPTIONS、证据文件命名、退出码 86 的语义。
//   * 不扩大允许写入集合、不按文件名豁免、不“预热”真实文件、不关闭或放宽监视。
//   * 不用“最终哈希未变”或“文件已被恢复”豁免任何发生过的写入。
// 与正式版的差异（全部为新增或替换，不改既有字段语义）
//   * projectRoot 不再按 `../..` 推导：从本文件所在目录向上寻找标记文件（候选被复制到
//     .m1-evidence\<dir>\ 之后仍能解析到真正的项目根）。
//   * -fswatch.jsonl 的写者由 runner 变成 helper（runner 不再写它，避免两个写者互相放大通知）。
//   * 新增证据文件 <label>-watcher-protocol.jsonl（helper stdout 逐行原样）与
//     <label>-watcher-stderr.txt（helper stderr 逐行原样）。
//   * 退出 JSON 新增 watcher / run_verdict / helper_teardown 摘要；既有字段保持不变。
// ===========================================================================

const runnerDir = path.dirname(fileURLToPath(import.meta.url));

// projectRoot：**不**假设本文件位于项目下两级。向上寻找标记文件；找不到就明确报错，
// 绝不“猜”一个根，也绝不回退到 cwd。
const projectMarkers = [path.join("scripts", "m1", "guard-node-deletions.cjs"), "package.json"];
function findProjectRoot(startDir) {
  let current = path.resolve(startDir);
  for (let depth = 0; depth < 8; depth += 1) {
    if (projectMarkers.every((marker) => fs.existsSync(path.join(current, marker)))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Refusing to guess the project root: neither ${startDir} nor its parents contains ${projectMarkers.join(" + ")}`);
}
const projectRoot = findProjectRoot(runnerDir);
const projectRootSource = `marker walk-up from ${runnerDir}`;
const guard = path.join(projectRoot, "scripts", "m1", "guard-node-deletions.cjs");
if (!fs.existsSync(guard)) throw new Error(`Refusing to run without the node deletion guard: ${guard}`);

// 监视 helper 必须与 runner 同目录（正式接入 = scripts\m1\watch-guard-c.ps1）
const watcherHelperPath = path.join(runnerDir, "watch-guard-c.ps1");
const systemRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
const powershellExe = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

const approvedRoot = path.resolve("D:/hesan/Desktop/VSCODES/FetchCV_M1_work/20260910-235136");
const separator = process.argv.indexOf("--");
const args = Object.fromEntries(process.argv.slice(2, separator).map((value, index, all) =>
  value.startsWith("--") ? [value.slice(2), all[index + 1]] : ["", ""]));
if (separator < 0 || !args.label || !args["temp-root"] || separator === process.argv.length - 1) {
  throw new Error("Usage: node scripts/m1/run-guarded-node.mjs --label LABEL --temp-root PATH -- COMMAND [ARGS...]");
}
if (!/^[a-z][a-z0-9-]*$/.test(args.label)) throw new Error("Invalid evidence label");
const tempRoot = path.resolve(args["temp-root"]);
const relative = path.relative(approvedRoot, tempRoot);
if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
  throw new Error(`--temp-root must be a fresh child of ${approvedRoot}`);
}
if (!fs.statSync(approvedRoot).isDirectory()) throw new Error(`Approved root is missing: ${approvedRoot}`);
if (fs.existsSync(tempRoot)) throw new Error(`Refusing to reuse or delete existing node test root: ${tempRoot}`);
const selectedEnv = {};
const configuredPython = process.env.FETCHCV_PYTHON;
if (configuredPython) {
  const expectedPython = path.resolve(projectRoot, "backend", ".venv-m1", "Scripts", "python.exe");
  if (path.resolve(configuredPython).toLowerCase() !== expectedPython.toLowerCase()) {
    throw new Error(`FETCHCV_PYTHON must select ${expectedPython}`);
  }
  selectedEnv.FETCHCV_PYTHON = expectedPython;
}
const configuredExecutable = process.env.FETCHCV_PACKAGED_EXECUTABLE;
if (configuredExecutable) {
  const executable = path.resolve(configuredExecutable);
  const workRoot = approvedRoot;
  const executableRelative = path.relative(workRoot, executable);
  if (!executableRelative || executableRelative === ".." || executableRelative.startsWith(`..${path.sep}`)
      || path.isAbsolute(executableRelative) || path.extname(executable).toLowerCase() !== ".exe") {
    throw new Error(`FETCHCV_PACKAGED_EXECUTABLE must be an .exe inside ${workRoot}`);
  }
  selectedEnv.FETCHCV_PACKAGED_EXECUTABLE = executable;
}
const evidenceRoot = path.join(projectRoot, ".m1-evidence");
const outputPaths = {
  raw: path.join(evidenceRoot, `${args.label}-node.log`),
  exit: path.join(evidenceRoot, `${args.label}-node-exit.json`),
  deletions: path.join(evidenceRoot, `${args.label}-node-deletions.jsonl`),
  processes: path.join(evidenceRoot, `${args.label}-node-processes.jsonl`),
  watcher: path.join(evidenceRoot, `${args.label}-fswatch.jsonl`),
  watcherProtocol: path.join(evidenceRoot, `${args.label}-watcher-protocol.jsonl`),
  watcherStderr: path.join(evidenceRoot, `${args.label}-watcher-stderr.txt`),
};
for (const output of Object.values(outputPaths)) {
  if (fs.existsSync(output)) throw new Error(`Refusing to overwrite evidence: ${output}`);
}
fs.mkdirSync(tempRoot, { recursive: false, mode: 0o700 });
for (const output of [outputPaths.raw, outputPaths.deletions, outputPaths.processes, outputPaths.watcher, outputPaths.watcherProtocol, outputPaths.watcherStderr]) {
  fs.closeSync(fs.openSync(output, "wx"));
}

function trackWritable(name, stream) {
  const completed = new Promise((resolve) => {
    stream.once("finish", () => resolve({ name, status: "finish" }));
    stream.once("error", (error) => resolve({ name, status: "error", code: error.code, message: error.message }));
  });
  return { end: () => { if (!stream.destroyed) stream.end(); return completed; } };
}
function raceWithTimeout(promises, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
    const settle = (value) => { clearTimeout(timer); resolve(value); };
    for (const promise of promises) promise.then(settle, () => settle({ kind: "rejected" }));
  });
}

// ---------------------------------------------------------------- 监视（方案 C helper）
const watcherHeartbeatMs = 1000;
const watcherReadinessTimeoutMs = 15000;
const watcherStopTimeoutMs = 15000;
// r2：收到 stopped 之后等待 helper **真实退出** 的有界窗口。close 事件到达之前绝不强杀。
const watcherExitWaitMs = 10000;
const watcherKillTimeoutMs = 5000;
const watcherHeartbeatStaleMs = Math.max(5000, watcherHeartbeatMs * 4);
const expectedNotifyFilters = ["FileName", "DirectoryName", "Size", "LastWrite", "Attributes", "CreationTime", "Security"];
const excludedNotifyFilters = ["LastAccess"];
const readinessProjectPath = path.join(evidenceRoot, `${args.label}-watcher-readiness.txt`);
const readinessApprovedPath = path.join(tempRoot, "watcher-readiness.json");
const stopSentinelPath = path.join(tempRoot, "watcher-stop.json");

const rawStream = fs.createWriteStream(outputPaths.raw, { flags: "a" });
const rawOutput = trackWritable("raw", rawStream);
const protocolStream = fs.createWriteStream(outputPaths.watcherProtocol, { flags: "a" });
const protocolOutput = trackWritable("watcher-protocol", protocolStream);
const helperStderrStream = fs.createWriteStream(outputPaths.watcherStderr, { flags: "a" });
const helperStderrOutput = trackWritable("watcher-stderr", helperStderrStream);

const [command, ...commandArgs] = process.argv.slice(separator + 1);
const runnerStartedAt = Date.now();
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !key.startsWith("FETCHCV_") && !key.endsWith("API_KEY")));
Object.assign(env, selectedEnv);
Object.assign(env, {
  TEMP: tempRoot,
  TMP: tempRoot,
  TMPDIR: tempRoot,
  PWTEST_SERVER_REGISTRY: path.join(tempRoot, "playwright-server-registry"),
  PLAYWRIGHT_BROWSERS_PATH: path.join(tempRoot, "playwright-browsers"),
  PYTHONDONTWRITEBYTECODE: "1",
  PYTHONUTF8: "1",
  FETCHCV_DISABLE_TASK_WORKER: "1",
  FETCHCV_ALLOW_MOCK_RUNTIME: "1",
  FETCHCV_DATABASE_URL: `sqlite:///${path.join(tempRoot, "synthetic-packaged.db").replaceAll("\\", "/")}`,
  FETCHCV_ARTIFACT_ROOT: path.join(tempRoot, "artifacts"),
  FETCHCV_WORKSPACE_ROOT: path.join(tempRoot, "workspace"),
  FETCHCV_XHS_CREDENTIAL_FILE: path.join(tempRoot, "synthetic-credentials.bin"),
  M1_ALLOWED_DELETE_ROOT: tempRoot,
  M1_NODE_DELETE_LOG: outputPaths.deletions,
  M1_PROCESS_LOG: outputPaths.processes,
  NODE_OPTIONS: `--require=${JSON.stringify(guard)}`,
});
delete env.FETCHCV_SETTINGS_FILE;
// helper 的环境：去掉 NODE_OPTIONS 与 M1_*（监视进程不需要，也不该继承受测子进程的注入）
const helperEnv = Object.fromEntries(Object.entries(env).filter(([key]) => key !== "NODE_OPTIONS" && !key.startsWith("M1_")));

let child = null;
let helper = null;
let helperReadyInfo = null;
let helperStoppedInfo = null;
let helperFinalInfo = null;
let helperExitInfo = null;
let helperSpawnError = null;
let watcherViolation = null;
let watcherFatal = false;
let watcherPhase = "helper-spawn";
let helperKilledAfterTimeout = false;
let helperExitWaitedMs = null;
let heartbeatCount = 0;
let lastHeartbeatAt = 0;
let protocolMessageCount = 0;
let watcherAudit = null;
const watcherViolations = [];
const watcherFailures = [];
const protocolMessages = [];
let resolveHelperReady; let resolveHelperStopped; let resolveHelperExit; let resolveWatcherFatal;
const helperReadyPromise = new Promise((resolve) => { resolveHelperReady = resolve; });
const helperStoppedPromise = new Promise((resolve) => { resolveHelperStopped = resolve; });
const helperExitPromise = new Promise((resolve) => { resolveHelperExit = resolve; });
const watcherFatalPromise = new Promise((resolve) => { resolveWatcherFatal = resolve; });

function recordWatcherFailure(event, detail = {}, options = {}) {
  const failure = { event, path: detail.path ?? watcherHelperPath, ...detail };
  watcherFailures.push(failure);
  if (!watcherViolation) watcherViolation = failure;
  if (options.fatal) { watcherFatal = true; resolveWatcherFatal(failure); }
  if (options.killChild) child?.kill();
  if (options.killHelper) helper?.kill();
  return failure;
}
function handleProtocolLine(rawLine) {
  const line = rawLine.replace(/\r$/, "");
  if (!line.trim()) return;
  let message = null;
  try {
    message = JSON.parse(line);
  } catch (error) {
    // r2：协议坏行在启动前阻止 child；在运行期**直接**停止 child（不是只等 helper 被杀的 close）
    recordWatcherFailure("watcher-protocol-error", { path: watcherHelperPath, line, message: error.message }, { fatal: true, killChild: true, killHelper: true });
    return;
  }
  if (!message || typeof message.type !== "string") {
    recordWatcherFailure("watcher-protocol-error", { path: watcherHelperPath, line, reason: "the line carries no message type" }, { fatal: true, killChild: true, killHelper: true });
    return;
  }
  protocolMessageCount += 1;
  protocolMessages.push(message);
  if (message.type === "heartbeat") {
    heartbeatCount += 1;
    lastHeartbeatAt = Date.now();
    return;
  }
  if (message.type === "precondition") {
    const observed = Array.isArray(message.notify_filters) ? message.notify_filters.slice().sort() : [];
    const expected = expectedNotifyFilters.slice().sort();
    if (observed.join(",") !== expected.join(",")) {
      recordWatcherFailure("watcher-filter-mismatch", { path: watcherHelperPath, expected_notify_filters: expected, observed_notify_filters: message.notify_filters ?? null }, { fatal: true, killChild: true });
    }
    if (!Array.isArray(message.excluded_filters) || message.excluded_filters.join(",") !== excludedNotifyFilters.join(",")) {
      recordWatcherFailure("watcher-filter-mismatch", { path: watcherHelperPath, expected_excluded_filters: excludedNotifyFilters, observed_excluded_filters: message.excluded_filters ?? null }, { fatal: true, killChild: true });
    }
    return;
  }
  if (message.type === "ready") { helperReadyInfo = message; resolveHelperReady(message); return; }
  if (message.type === "violation") {
    const violation = { event: String(message.kind ?? "violation"), path: message.path ?? null, oldPath: message.old_path ?? null,
      permitted: false, permittedNew: message.permitted_new ?? null, permittedOld: message.permitted_old ?? null,
      record_seq: message.record_seq ?? null, rootKind: message.root_kind ?? null, root: message.root ?? null,
      collected_utc: message.collected_utc ?? null };
    watcherViolations.push(violation);
    // r2：violation 也是 fatal —— 启动前出现越界时**绝不允许**启动 child（后来的 ready 也清不掉它）
    recordWatcherFailure(violation.event, violation, { killChild: true, fatal: true });
    return;
  }
  if (message.type === "error") {
    recordWatcherFailure("watcher-error", { path: watcherHelperPath, helperStage: message.stage ?? null, helperReason: message.reason ?? null,
      helperMessage: message.message ?? null, errorType: message.error_type ?? null }, { killChild: true, fatal: true });
    return;
  }
  if (message.type === "stopped") { helperStoppedInfo = message; resolveHelperStopped(message); return; }
  if (message.type === "failed") {
    helperFinalInfo = message;
    if (!watcherViolation) {
      recordWatcherFailure("watcher-helper-failed", { path: watcherHelperPath, stopReason: message.stop_reason ?? null,
        exitCode: message.exit_code ?? null, failure: message.failure ?? null }, { killChild: true });
    }
    return;
  }
  recordWatcherFailure("watcher-protocol-error", { path: watcherHelperPath, line, reason: `unknown message type ${message.type}` }, { fatal: true, killChild: true, killHelper: true });
}

let helperStarted = false;
if (!fs.existsSync(watcherHelperPath)) {
  recordWatcherFailure("watcher-helper-missing", { path: watcherHelperPath, reason: "the scheme C watcher helper must sit next to the runner" });
} else if (!fs.existsSync(powershellExe)) {
  recordWatcherFailure("watcher-powershell-missing", { path: powershellExe, reason: "Windows PowerShell 5.1 is required for the .NET FileSystemWatcher helper" });
} else {
  helper = spawn(powershellExe, [
    "-NoProfile", "-NonInteractive", "-File", watcherHelperPath,
    "-ProjectRoot", projectRoot,
    "-ApprovedRoot", approvedRoot,
    "-TempRoot", tempRoot,
    "-AuditPath", outputPaths.watcher,
    "-ReadinessProjectPath", readinessProjectPath,
    "-ReadinessApprovedPath", readinessApprovedPath,
    "-StopSentinelPath", stopSentinelPath,
    "-ParentPid", String(process.pid),
    "-PollMs", "50",
    "-ReadinessMs", String(watcherReadinessTimeoutMs),
    "-FinalDrainMs", "800",
    "-HeartbeatMs", String(watcherHeartbeatMs),
  ], { cwd: projectRoot, env: helperEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  helperStarted = true;
  helper.once("error", (error) => {
    helperSpawnError = { code: error.code, message: error.message };
    recordWatcherFailure("watcher-spawn-error", { path: powershellExe, code: error.code, message: error.message }, { fatal: true });
  });
  let stdoutBuffer = "";
  helper.stdout.setEncoding("utf8");
  helper.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    protocolStream.write(chunk);
    let index;
    while ((index = stdoutBuffer.indexOf("\n")) >= 0) {
      const line = stdoutBuffer.slice(0, index);
      stdoutBuffer = stdoutBuffer.slice(index + 1);
      handleProtocolLine(line);
    }
  });
  helper.stdout.on("end", () => {
    if (stdoutBuffer.trim()) handleProtocolLine(stdoutBuffer);
    stdoutBuffer = "";
  });
  helper.stderr.setEncoding("utf8");
  helper.stderr.on("data", (chunk) => { helperStderrStream.write(chunk); process.stderr.write(chunk); });
  helper.once("close", (exitCode, signal) => {
    helperExitInfo = { exitCode, signal, error: helperSpawnError };
    resolveHelperExit(helperExitInfo);
    // helper 在受测子进程运行期间异常退出 => 立即停止子进程，并且本次运行绝不报成功
    if (watcherPhase === "running") {
      recordWatcherFailure("watcher-exit-during-run", { path: watcherHelperPath, helperExitCode: exitCode, helperSignal: signal, helperSpawnError,
        reason: "the watcher helper exited while the child process was running; the child is stopped at once and the run is never reported as success" },
        { killChild: true, fatal: true });
    }
  });
}

// ---------------------------------------------------------------- 就绪门：先确认 watcher 就绪，再启动子进程
const helperReadyOutcome = helperStarted
  ? await raceWithTimeout([
      helperReadyPromise.then((info) => ({ kind: "ready", info })),
      helperExitPromise.then((info) => ({ kind: "exit", info })),
      watcherFatalPromise.then(() => ({ kind: "fatal" })),
    ], watcherReadinessTimeoutMs)
  : { kind: "not-started" };

let childStarted = false;
if (helperReadyOutcome.kind === "ready") {
  helperReadyInfo = helperReadyOutcome.info;
  if (watcherFatal) {
    // 就绪之前已经记录了致命问题（例如越界/过滤项不符/协议坏行）：不启动子进程，只做收尾。
    // r2：`watcherFatal` 在任何后续 ready 到达时都仍然为真 —— 已记录的错误不会被 ready 清除。
  } else {
    watcherPhase = "running";
    lastHeartbeatAt = Date.now();
    child = spawn(command, commandArgs, { cwd: projectRoot, env, windowsHide: true, stdio: ["inherit", "pipe", "pipe"] });
    childStarted = true;
    child.stdout.pipe(process.stdout); child.stdout.pipe(rawStream, { end: false });
    child.stderr.pipe(process.stderr); child.stderr.pipe(rawStream, { end: false });
  }
} else if (helperReadyOutcome.kind === "exit") {
  recordWatcherFailure("watcher-not-ready", { path: watcherHelperPath, helperExitCode: helperReadyOutcome.info.exitCode,
    helperSignal: helperReadyOutcome.info.signal, helperSpawnError,
    reason: "the watcher helper exited before reporting ready; the child process was NOT started" }, { fatal: true });
} else if (helperReadyOutcome.kind === "timeout") {
  recordWatcherFailure("watcher-ready-timeout", { path: watcherHelperPath, timeoutMs: watcherReadinessTimeoutMs,
    reason: "the watcher helper did not confirm readiness in time; the child process was NOT started" }, { fatal: true, killHelper: true });
} else if (helperReadyOutcome.kind === "fatal") {
  // r2：具体原因（越界/过滤项/协议坏行/helper 自报 error）已经记录过了，这里不再补一条
  // 会让读者误解的 watcher-not-ready；只有"确实没有任何记录"时才补。
  if (watcherFailures.length === 0) {
    recordWatcherFailure("watcher-not-ready", { path: watcherHelperPath, reason: "the watcher helper reported a fatal problem before readiness; the child process was NOT started" }, { fatal: true });
  }
} else if (helperStarted) {
  recordWatcherFailure("watcher-ready-unknown", { path: watcherHelperPath, reason: "the watcher helper produced no ready signal and no exit; the child process was NOT started" }, { fatal: true, killHelper: true });
}
// helper 根本没有起来（文件缺失 / PowerShell 缺失）时，失败已经在上面记录过，这里不重复记录

// 心跳看门狗：只在"受测子进程在跑、helper 应活着"的窗口内检查
const heartbeatTimer = setInterval(() => {
  if (watcherPhase !== "running") return;
  const staleMs = Date.now() - lastHeartbeatAt;
  if (staleMs > watcherHeartbeatStaleMs) {
    recordWatcherFailure("watcher-heartbeat-timeout", { path: watcherHelperPath, stale_ms: staleMs, threshold_ms: watcherHeartbeatStaleMs,
      reason: "the watcher helper stopped sending heartbeats; a hung watcher is never reported as success" }, { killChild: true, killHelper: true });
  }
}, Math.max(250, Math.floor(watcherHeartbeatMs / 2)));

let spawnError = null;
let outcome = null;
if (childStarted) {
  outcome = await new Promise((resolve) => {
    child.once("error", (error) => { spawnError = { code: error.code, message: error.message }; });
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal, error: spawnError }));
  });
}
clearInterval(heartbeatTimer);

// ---------------------------------------------------------------- 停止 watcher（有界收尾由 helper 负责）
watcherPhase = "stopping";
let stopSentinelWritten = false;
if (helper && !helperExitInfo) {
  if (helperReadyInfo) {
    try {
      fs.writeFileSync(stopSentinelPath, JSON.stringify({ requestedAt: new Date().toISOString(), childStarted,
        childExitCode: outcome?.exitCode ?? null, childSignal: outcome?.signal ?? null }) + "\n", { flag: "wx" });
      stopSentinelWritten = true;
    } catch (error) {
      recordWatcherFailure("watcher-stop-sentinel-error", { path: stopSentinelPath, code: error.code, message: error.message });
    }
  }
  if (stopSentinelWritten) {
    const stopOutcome = await raceWithTimeout([
      helperStoppedPromise.then((info) => ({ kind: "stopped", info })),
      helperExitPromise.then((info) => ({ kind: "exit", info })),
    ], watcherStopTimeoutMs);
    if (stopOutcome.kind === "stopped") {
      helperStoppedInfo = stopOutcome.info;
    } else if (stopOutcome.kind === "exit") {
      recordWatcherFailure("watcher-exit-before-stop", { path: watcherHelperPath, helperExitCode: stopOutcome.info.exitCode,
        reason: "the watcher helper exited before reporting a clean stop" });
    } else {
      recordWatcherFailure("watcher-stop-timeout", { path: watcherHelperPath, timeoutMs: watcherStopTimeoutMs,
        reason: "the watcher helper did not finish its bounded final drain and audit flush in time" }, { killHelper: true });
    }
  }
  if (!helperExitInfo) {
    // r2 修正 1：**必须有界等待 helper 的真实退出**（close 到达之前绝不强杀）。
    // 只有在这个有界窗口用完之后才强杀，并把"超时强杀"作为一条失败记录；
    // 最终 `watcherStopClean` 仍然要求 helperExitInfo.exitCode === 0。
    const exitWaitStart = Date.now();
    const exitOutcome = await raceWithTimeout([helperExitPromise.then((info) => ({ kind: "exit", info }))], watcherExitWaitMs);
    helperExitWaitedMs = Date.now() - exitWaitStart;
    if (exitOutcome.kind !== "exit") {
      helperKilledAfterTimeout = true;
      recordWatcherFailure("watcher-helper-exit-timeout", { path: watcherHelperPath, waited_ms: helperExitWaitedMs, timeout_ms: watcherExitWaitMs,
        reason: "the watcher helper did not actually exit within the bounded wait; it is killed now and this timeout is recorded as a failure" }, { killHelper: true });
      helper.kill();
      const killOutcome = await raceWithTimeout([helperExitPromise.then((info) => ({ kind: "exit", info }))], watcherKillTimeoutMs);
      if (killOutcome.kind !== "exit") recordWatcherFailure("watcher-helper-kill-timeout", { path: watcherHelperPath, timeoutMs: watcherKillTimeoutMs });
    }
  }
}
watcherPhase = "stopped";

// ---------------------------------------------------------------- 审计一致性（只在 helper 自述"干净收尾"时作为条件）
if (helperStoppedInfo) {
  try {
    const auditText = fs.readFileSync(outputPaths.watcher, "utf8");
    const auditLines = auditText.split("\n").filter((line) => line.trim() !== "");
    const lastLine = auditLines.length > 0 ? JSON.parse(auditLines[auditLines.length - 1]) : null;
    const claimedLines = Number(helperStoppedInfo.audit_lines_total);
    const highWater = Number(helperStoppedInfo.record_seq_high_water);
    const notificationRecords = Number(helperStoppedInfo.notification_records);
    watcherAudit = { path: outputPaths.watcher, exists: true, lines: auditLines.length,
      last_line_type: lastLine?.type ?? null, last_record_seq_high_water: lastLine?.record_seq_high_water ?? null,
      last_notification_records: lastLine?.notification_records ?? null, helper_audit_lines_total: helperStoppedInfo.audit_lines_total ?? null,
      helper_record_seq_high_water: helperStoppedInfo.record_seq_high_water ?? null,
      helper_notification_records: helperStoppedInfo.notification_records ?? null,
      helper_audit_bytes: helperStoppedInfo.audit_bytes ?? null, helper_audit_flush_ok: helperStoppedInfo.audit_flush_ok ?? null };
    const consistent = Number.isFinite(claimedLines) && claimedLines === auditLines.length
      && Number.isFinite(highWater) && highWater === notificationRecords
      && Number(lastLine?.record_seq_high_water) === highWater
      && lastLine?.type === "summary";
    watcherAudit.consistent_with_helper_report = consistent;
    if (!consistent) {
      recordWatcherFailure("watcher-audit-inconsistency", { path: outputPaths.watcher,
        helper_audit_lines_total: helperStoppedInfo.audit_lines_total ?? null, actual_audit_lines: auditLines.length,
        helper_record_seq_high_water: helperStoppedInfo.record_seq_high_water ?? null,
        helper_notification_records: helperStoppedInfo.notification_records ?? null,
        last_line_type: lastLine?.type ?? null,
        reason: "the audit file on disk does not match the helper own summary; a watcher whose evidence does not reconcile is never a success" });
    }
  } catch (error) {
    recordWatcherFailure("watcher-audit-unreadable", { path: outputPaths.watcher, code: error.code ?? null, message: error.message });
  }
}

const watcherStopClean = Boolean(helperStoppedInfo) && helperStoppedInfo.stopped_cleanly === true
  && helperStoppedInfo.audit_flush_ok === true
  && helperExitInfo !== null && helperExitInfo.exitCode === 0
  && !watcherFailures.some(({ event }) => event === "watcher-exit-before-stop" || event === "watcher-stop-timeout" || event === "watcher-helper-exit-timeout");
if (helperReadyInfo && !watcherStopClean && !watcherViolation) {
  recordWatcherFailure("watcher-stop-not-clean", { path: watcherHelperPath,
    helper_exit_code: helperExitInfo?.exitCode ?? null, helper_stopped: Boolean(helperStoppedInfo),
    helper_stopped_cleanly: helperStoppedInfo?.stopped_cleanly ?? null, helper_audit_flush_ok: helperStoppedInfo?.audit_flush_ok ?? null,
    reason: "the watcher helper did not finish with a clean, reconciled stop; the run is not reported as success" });
}

const streamOutcomes = await Promise.all([rawOutput.end(), protocolOutput.end(), helperStderrOutput.end()]);
const watcherSummary = {
  mode: "dotnet-filesystemwatcher-scheme-c",
  revision: "scheme-c-candidate-2",
  helper: watcherHelperPath,
  helper_started: helperStarted,
  powershell: powershellExe,
  notify_filters: expectedNotifyFilters,
  excluded_filters: excludedNotifyFilters,
  include_subdirectories: true,
  readiness: { project_file: readinessProjectPath, approved_file: readinessApprovedPath, confirmed: Boolean(helperReadyInfo), helper_report: helperReadyInfo },
  stop_sentinel: { path: stopSentinelPath, written: stopSentinelWritten },
  heartbeat: { interval_ms: watcherHeartbeatMs, stale_threshold_ms: watcherHeartbeatStaleMs, received: heartbeatCount, last_at_ms: lastHeartbeatAt || null },
  helper_exit: helperExitInfo,
  helper_exit_wait: { waited_ms: helperExitWaitedMs, bounded_by_ms: watcherExitWaitMs, killed_after_timeout: helperKilledAfterTimeout,
    note: "the runner waits for the helper's REAL exit after a normal stopped message; only a timeout turns into a kill plus a recorded failure" },
  helper_spawn_error: helperSpawnError,
  protocol: { file: outputPaths.watcherProtocol, stderr_file: outputPaths.watcherStderr, message_count: protocolMessageCount },
  audit: Object.assign({ file: outputPaths.watcher, writer: "the watcher helper only (the runner never writes this file)" }, watcherAudit ?? { exists: fs.existsSync(outputPaths.watcher) }),
  helper_summary: helperStoppedInfo,
  helper_final: helperFinalInfo,
  notification_violations: watcherViolations,
  failures: watcherFailures,
  first_failure: watcherViolation,
  stopped_cleanly: watcherStopClean,
  level_note: "`stopped_cleanly` describes the WATCHER HELPER's own teardown. It is NOT the run verdict; see run_verdict and helper_teardown in the exit JSON.",
  policy: "a non-permitted notification kills the child at once; the run is never reported as success when the watcher failed, was not ready, exceeded its heartbeat, overflowed, or could not reconcile its audit",
};

// r2：把"整次运行的判定"和"监视器自身的收尾"分开写进退出 JSON，两者互不推导
const watcherComponentFailed = Boolean(watcherViolation) || !watcherStopClean || streamOutcomes.some(({ status }) => status === "error");
const finalExitCode = watcherComponentFailed ? 86 : (outcome?.exitCode ?? 1);
const runFailureReasons = [];
if (watcherViolation) runFailureReasons.push(`watcher:${watcherViolation.event}`);
if (!watcherStopClean) runFailureReasons.push("watcher-stop-not-clean");
if (streamOutcomes.some(({ status }) => status === "error")) runFailureReasons.push("evidence-stream-error");
if (!childStarted) runFailureReasons.push("child-not-started");
if (outcome?.error) runFailureReasons.push(`child-spawn-error:${outcome.error.code}`);
if (outcome?.signal) runFailureReasons.push(`child-signal:${outcome.signal}`);
if (typeof outcome?.exitCode === "number" && outcome.exitCode !== 0) runFailureReasons.push(`child-exit:${outcome.exitCode}`);
const runVerdict = {
  success: finalExitCode === 0,
  exit_code: finalExitCode,
  watcher_component_failed: watcherComponentFailed,
  reasons: runFailureReasons,
  note: "this is the RUN verdict. It is deliberately independent of the helper teardown: a recorded violation fails the run even when the helper stopped cleanly, and a killed helper fails the run even when no violation was found.",
};
const helperTeardown = {
  stopped_reported: Boolean(helperStoppedInfo),
  stopped_cleanly: watcherStopClean,
  helper_exit_code: helperExitInfo?.exitCode ?? null,
  helper_exit_signal: helperExitInfo?.signal ?? null,
  wait_ms: helperExitWaitedMs,
  killed_after_timeout: helperKilledAfterTimeout,
  audit_flush_ok: helperStoppedInfo?.audit_flush_ok ?? null,
  audit_reconciled: watcherAudit?.consistent_with_helper_report ?? null,
  note: "this block describes the WATCHER process only. It is NOT the run verdict and must never be read as one.",
};

fs.writeFileSync(outputPaths.exit, JSON.stringify({
  command: [command, ...commandArgs], tempRoot, projectRoot, projectRootSource,
  startedAt: runnerStartedAt, startedAtUtc: new Date(runnerStartedAt).toISOString(), durationMs: Date.now() - runnerStartedAt,
  watcherViolation,
  watcher: watcherSummary,
  run_verdict: runVerdict,
  helper_teardown: helperTeardown,
  streamOutcomes,
  childStarted,
  ...(outcome ?? {}),
}, null, 2) + "\n", { flag: "wx" });
if (outcome?.error) throw Object.assign(new Error(outcome.error.message), { code: outcome.error.code });
process.exitCode = finalExitCode;
