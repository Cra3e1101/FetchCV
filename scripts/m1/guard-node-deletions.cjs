// Preload only for M1 tests. Application and test sources remain unchanged.
const fs = require('node:fs');
const path = require('node:path');
const { syncBuiltinESMExports } = require('node:module');
const childProcess = require('node:child_process');
const log = process.env.M1_NODE_DELETE_LOG;
function receipt(status, operation, target) {
  fs.appendFileSync(log, JSON.stringify({ status, operation, path: target, pid: process.pid }) + '\n');
}
function resolveForGuard(value) {
  const normalized = path.resolve(path.normalize(String(value)));
  try {
    return fs.realpathSync(normalized);
  } catch (error) {
    receipt('realpath_fallback', error.code || 'realpath', normalized);
    return normalized;
  }
}
const approvedRoot = resolveForGuard('D:\\hesan\\Desktop\\VSCODES\\FetchCV_M1_work\\20260910-235136');
const root = resolveForGuard(process.env.M1_ALLOWED_DELETE_ROOT);
const rootRelative = path.relative(approvedRoot, root);
if (!rootRelative || rootRelative === '..' || rootRelative.startsWith('..' + path.sep) || path.isAbsolute(rootRelative)) {
  throw new Error(`M1_ALLOWED_DELETE_ROOT must be a child of ${approvedRoot}`);
}
if (process.env.M1_PROCESS_LOG) {
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = function (command, args, options) {
    const child = originalSpawn.call(childProcess, command, args, options);
    const record = value => fs.appendFileSync(process.env.M1_PROCESS_LOG, JSON.stringify(value) + '\n');
    record({event: 'spawn', parent: process.pid, pid: child.pid, command: String(command)});
    child.on('error', error => record({event: 'error', pid: child.pid, code: error.code, message: error.message}));
    child.on('exit', (code, signal) => record({event: 'exit', pid: child.pid, code, signal}));
    return child;
  };
}
function check(value, operation) {
  const target = path.resolve(String(value));
  const parent = resolveForGuard(path.dirname(target));
  const resolved = path.join(parent, path.basename(target));
  const relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    receipt('blocked', operation, resolved);
    process.exit(86);
  }
  return resolved;
}
for (const name of ['unlinkSync', 'rmdirSync', 'rmSync']) {
  const original = fs[name];
  fs[name] = function (target, ...args) {
    const resolved = check(target, name);
    const existed = fs.existsSync(target);
    const result = original.call(fs, target, ...args);
    if (existed) receipt('deleted', name, resolved);
    return result;
  };
}
for (const name of ['unlink', 'rmdir', 'rm']) {
  const original = fs[name];
  fs[name] = function (target, ...args) {
    const resolved = check(target, name);
    const existed = fs.existsSync(target);
    const callback = args.pop();
    return original.call(fs, target, ...args, (error, ...values) => {
      if (!error && existed) receipt('deleted', name, resolved);
      callback(error, ...values);
    });
  };
  const originalPromise = fs.promises[name];
  fs.promises[name] = async function (target, ...args) {
    const resolved = check(target, name);
    const existed = fs.existsSync(target);
    const result = await originalPromise.call(fs.promises, target, ...args);
    if (existed) receipt('deleted', name, resolved);
    return result;
  };
}
syncBuiltinESMExports();
