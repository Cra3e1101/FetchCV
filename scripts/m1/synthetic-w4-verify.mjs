#!/usr/bin/env node
// M1 W4 subprocess-fix: synthetic verification driver.
//
// Two kinds of test live here:
//   * pure-function tests over in-memory inventory objects (no filesystem side effects), and
//   * real subprocess tests that use the SAME createRealCommandRunner as the orchestrator,
//     launching a harmless Node fixture that actually loads the same guard across a real
//     process boundary. stdout/stderr are captured to files by descriptor, never stdio:ignore.
//
// It never runs npm ci, never downloads Electron, and never targets the real project
// node_modules: every write path is validated to be inside the synthetic root first, and the
// synthetic root itself must be a brand-new directory under the fixed stable root.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  EXIT,
  FIXED_PROJECT_ROOT,
  FIXED_ROOTS,
  FIXED_STABLE_ROOT,
  GUARD_PATH,
  buildInventory,
  buildNodeOptions,
  canonicalizePath,
  compareInventories,
  createRealCommandRunner,
  descendantAuditKey,
  isInside,
  isStrictlyInside,
  normalizeAuditPath,
  preflightFixedRoots,
  probeGuardLoad,
  resolveNpmCli,
  runIsolatedInstall,
  spawnToFiles,
  summarizeDeletionLogs,
  validateEnvironment,
  validateTargetAncestors,
} from './run-isolated-node-install.mjs';

const ROOT = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!ROOT) {
  process.stderr.write('usage: node synthetic-w4-verify.mjs <syntheticRoot>\n');
  process.exit(2);
}

// ---- input validation happens BEFORE any mkdir ------------------------------------------------
const preflightProblems = [];
// A1: the fixed stable root must exist, be readable and be a directory before anything is created.
const fixed = preflightFixedRoots();
if (!fixed.ok) preflightProblems.push(...fixed.problems.map((p) => `fixed root preflight: ${p}`));
if (!isStrictlyInside(ROOT, FIXED_STABLE_ROOT)) preflightProblems.push(`synthetic root must be strictly inside the fixed stable root (${FIXED_STABLE_ROOT}): ${ROOT}`);
if (isInside(ROOT, FIXED_PROJECT_ROOT)) preflightProblems.push(`synthetic root must never be inside the fixed project root: ${ROOT}`);
if (fs.existsSync(ROOT)) preflightProblems.push(`synthetic root already exists; refusing to reuse or clear it: ${ROOT}`);
// A2: ancestors of the synthetic root itself are validated before mkdir.
const rootAncestors = validateTargetAncestors([ROOT]);
if (!rootAncestors.ok) preflightProblems.push(...rootAncestors.problems);
if (preflightProblems.length > 0) {
  process.stderr.write(`${JSON.stringify({ refused: preflightProblems, created_anything: false }, null, 2)}\n`);
  process.exit(3);
}
fs.mkdirSync(ROOT, { recursive: true });

// The verifier process itself is NOT guarded. Every deletion it performs during fixture cleanup
// is recorded here so the audit can name exactly which deletions happened outside any guard log.
const verifierCleanupDeletions = [];

// Cheap, repeatable fingerprint of the real project. Reading a directory's entry list and mtime is
// O(1)-ish, unlike a full 41k-file rescan, and any entry add/remove/rename under node_modules or
// .m1-quarantine changes it. Used to assert that no synthetic scenario wrote under the real root.
function realProjectState() {
  const quarantine = path.join(FIXED_PROJECT_ROOT, '.m1-quarantine');
  const nodeModules = path.join(FIXED_PROJECT_ROOT, 'node_modules');
  const state = {
    quarantine_exists: fs.existsSync(quarantine),
    quarantine_entries: null,
    node_modules_exists: fs.existsSync(nodeModules),
    node_modules_top_level: null,
    node_modules_mtime_ms: null,
  };
  if (state.quarantine_exists) state.quarantine_entries = fs.readdirSync(quarantine).length;
  if (state.node_modules_exists) {
    state.node_modules_top_level = fs.readdirSync(nodeModules).length;
    state.node_modules_mtime_ms = fs.statSync(nodeModules).mtimeMs;
  }
  return state;
}
const REAL_STATE_BEFORE = realProjectState();

const results = [];
function record(name, passed, detail) {
  results.push({ name, passed: Boolean(passed), detail });
}
function confined(target, label) {
  if (!isInside(target, ROOT)) throw new Error(`${label} outside synthetic root: ${target}`);
  return target;
}
function shaFile(p) { return createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
// Unguarded cleanup, confined to the synthetic root and always recorded.
function cleanup(target, label) {
  confined(target, label);
  if (!fs.existsSync(target)) return;
  verifierCleanupDeletions.push({ label, path: target });
  fs.rmSync(target, { recursive: true, force: true });
}
// The guarded children in this file each allow exactly one directory under their scenario root.
function allowedRootForAudit(base) {
  return path.join(base, 'allowed');
}
// JSONL serialization, kept out of template literals so escapes stay unambiguous. Accepts objects
// or already-serialized strings.
function writeJsonlFile(filePath, items) {
  const lines = items.map((item) => (typeof item === 'string' ? item : JSON.stringify(item)));
  fs.writeFileSync(filePath, `${lines.join(String.fromCharCode(10))}${String.fromCharCode(10)}`, 'utf8');
}
// Every path a scenario deletes must be inside the synthetic root, and the synthetic root must
// never be inside the real project. Asserted here so the whole file inherits the guarantee.

// ---- the harmless fixture, written into the synthetic root ------------------------------------
const FIXTURE = path.join(ROOT, 'fixture.mjs');
const FIXTURE_SOURCE = `#!/usr/bin/env node
// Harmless synthetic command fixture. Stands in for npm ci / electron install.js.
// It only writes inside M1_FIXTURE_ROOT and is loaded with the same guard preloaded.
import fs from 'node:fs';
import path from 'node:path';

const role = process.argv[2];
const root = path.resolve(process.env.M1_FIXTURE_ROOT);
function inside(target) {
  const rel = path.relative(root, path.resolve(target));
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}
function guarded(target) { if (!inside(target)) throw new Error('fixture refused path outside synthetic root: ' + target); return target; }

const project = guarded(path.join(root, 'project'));
fs.mkdirSync(guarded(path.join(root, 'markers')), { recursive: true });

fs.writeFileSync(guarded(path.join(root, 'markers', role + '.marker.json')), JSON.stringify({
  role,
  cwd: process.cwd(),
  argv: process.argv.slice(2),
  node_options: process.env.NODE_OPTIONS || '',
  npm_config_cache: process.env.npm_config_cache || '',
  electron_config_cache: process.env.electron_config_cache || '',
  ELECTRON_BUILDER_CACHE: process.env.ELECTRON_BUILDER_CACHE || '',
  TEMP: process.env.TEMP || '', TMP: process.env.TMP || '', TMPDIR: process.env.TMPDIR || '',
  delete_log: process.env.M1_INSTALL_DELETE_LOG || '',
  mode: process.env.M1_INSTALL_MODE || '',
  remote_checksum_keys: Object.keys(process.env).filter((k) => /electron_use_remote_checksums/i.test(k)),
}, null, 2));

process.stdout.write('fixture:' + role + ':head\\n');
for (let i = 0; i < 40; i += 1) process.stdout.write('fixture:' + role + ':line:' + i + '\\n');
process.stdout.write('TAIL-MARKER:' + role + ':stdout:end\\n');
process.stderr.write('fixture:' + role + ':stderr:head\\n');
process.stderr.write('TAIL-MARKER:' + role + ':stderr:end\\n');

const exitCode = Number(process.env['M1_FIXTURE_EXIT_' + role.toUpperCase()] || '0');
if (exitCode === 0) {
  if (role === 'npm') {
    for (const name of ['electron', 'electron-builder', 'electron-winstaller', 'playwright', 'playwright-core']) {
      const dir = guarded(path.join(project, 'node_modules', name));
      fs.mkdirSync(dir, { recursive: true });
      const version = name === 'electron' ? '43.1.1' : name === 'electron-builder' ? '26.15.3' : name === 'electron-winstaller' ? '5.4.0' : '1.61.1';
      fs.writeFileSync(guarded(path.join(dir, 'package.json')), JSON.stringify({ name, version }), 'utf8');
    }
  }
  if (role === 'electron') {
    const dist = guarded(path.join(project, 'node_modules', 'electron', 'dist'));
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(guarded(path.join(dist, 'version')), '43.1.1', 'utf8');
    const binary = process.env.M1_FIXTURE_SKIP_BINARY === '1' ? 'electron.exe.missing' : 'electron.exe';
    if (binary !== 'electron.exe.missing') fs.writeFileSync(guarded(path.join(dist, binary)), 'MZ-stub', 'utf8');
    fs.writeFileSync(guarded(path.join(project, 'node_modules', 'electron', 'path.txt')), binary, 'utf8');
  }
}
process.exit(exitCode);
`;
fs.writeFileSync(FIXTURE, FIXTURE_SOURCE, 'utf8');

function seedProject(base, { skipBinary = false } = {}) {
  const projectRoot = confined(path.join(base, 'project'), 'project');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({ name: 'synthetic', version: '0.0.0' }), 'utf8');
  fs.writeFileSync(path.join(projectRoot, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3 }), 'utf8');
  const nodeModulesPath = confined(path.join(projectRoot, 'node_modules'), 'node_modules');
  fs.mkdirSync(path.join(nodeModulesPath, 'keep', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(nodeModulesPath, 'keep', 'a.txt'), 'alpha', 'utf8');
  fs.writeFileSync(path.join(nodeModulesPath, 'keep', 'nested', 'b.txt'), 'bravo', 'utf8');
  fs.mkdirSync(path.join(nodeModulesPath, 'empty-one'), { recursive: true });
  fs.mkdirSync(path.join(nodeModulesPath, 'empty-two'), { recursive: true });
  return {
    projectRoot,
    nodeModulesPath,
    expectedPackageHashes: {
      'package.json': shaFile(path.join(projectRoot, 'package.json')),
      'package-lock.json': shaFile(path.join(projectRoot, 'package-lock.json')),
    },
    skipBinary,
  };
}

function baseOptions(base, seed, overrides = {}) {
  const stableRoot = confined(path.join(base, 'stable'), 'stable');
  return {
    mode: 'synthetic',
    projectRoot: seed.projectRoot,
    stableRoot,
    syntheticRoot: base,
    nodeModulesPath: seed.nodeModulesPath,
    // Quarantine target must sit inside the project's .m1-quarantine directory (uniform rule).
    quarantineTarget: confined(path.join(seed.projectRoot, '.m1-quarantine', 'node_modules'), 'quarantine'),
    // Scratch directories must live inside the stable root.
    cacheDirs: {
      npm: confined(path.join(stableRoot, 'cache', 'npm'), 'cache'),
      electron: confined(path.join(stableRoot, 'cache', 'electron'), 'cache'),
      electronBuilder: confined(path.join(stableRoot, 'cache', 'electron-builder'), 'cache'),
    },
    tmpDir: confined(path.join(stableRoot, 'tmp'), 'tmp'),
    expectedPackageHashes: seed.expectedPackageHashes,
    logDir: confined(path.join(base, 'logs'), 'logs'),
    execPath: process.execPath,
    ...overrides,
  };
}

function fixtureInvocations() {
  return {
    npmInvocation: { command: process.execPath, args: [FIXTURE, 'npm'] },
    electronInvocation: { command: process.execPath, args: [FIXTURE, 'electron'] },
  };
}

function scenarioDir(name) {
  const base = confined(path.join(ROOT, name), name);
  fs.mkdirSync(base, { recursive: true });
  return base;
}

// ================= pure-function: inventory comparison =========================================
{
  const makeInventory = (files, dirs, empty) => ({
    root: 'synthetic', file_count: files.length,
    total_bytes: files.reduce((sum, f) => sum + f.bytes, 0),
    directory_count: dirs.length, empty_directories: [...empty].sort(),
    files: [...files].sort((a, b) => (a.relative < b.relative ? -1 : 1)), directories: [...dirs].sort(),
  });
  const f = (relative, bytes, content) => ({ relative, type: 'file', bytes, sha256: createHash('sha256').update(content).digest('hex') });
  const base = makeInventory([f('a.txt', 3, 'aaa'), f('d/b.txt', 3, 'bbb')], ['d'], ['empty-one']);

  record('P1 identical in-memory inventories are equal', compareInventories(base, JSON.parse(JSON.stringify(base))).equal === true, {});
  record('P2 losing one empty directory makes them unequal',
    compareInventories(base, makeInventory([f('a.txt', 3, 'aaa'), f('d/b.txt', 3, 'bbb')], ['d'], [])).equal === false, {});
  record('P3 content change makes them unequal',
    compareInventories(base, makeInventory([f('a.txt', 3, 'aaa'), f('d/b.txt', 3, 'ccc')], ['d'], ['empty-one'])).equal === false, {});
  record('P4 size change makes them unequal',
    compareInventories(base, makeInventory([f('a.txt', 4, 'aaaa'), f('d/b.txt', 3, 'bbb')], ['d'], ['empty-one'])).equal === false, {});
  record('P5 missing file makes them unequal',
    compareInventories(base, makeInventory([f('a.txt', 3, 'aaa')], ['d'], ['empty-one'])).equal === false, {});
  record('P6 extra file makes them unequal',
    compareInventories(base, makeInventory([f('a.txt', 3, 'aaa'), f('d/b.txt', 3, 'bbb'), f('c.txt', 1, 'c')], ['d'], ['empty-one'])).equal === false, {});
  record('P7 directory set change makes them unequal',
    compareInventories(base, makeInventory([f('a.txt', 3, 'aaa'), f('d/b.txt', 3, 'bbb')], [], ['empty-one'])).equal === false, {});
  record('P8 equal implies digests match', (() => { const c = compareInventories(base, JSON.parse(JSON.stringify(base))); return c.equal === true && c.digestsMatch === true; })(), {});
}

// ================= pure-function: environment scope ============================================
{
  const projectRoot = path.join(ROOT, 'p9', 'project');
  const stableRoot = path.join(ROOT, 'p9', 'stable');
  const synthetic = path.join(ROOT, 'p9');
  const cases = [
    ['P9a project root cannot be an allowed root', { allowedRoots: [projectRoot], deniedRoots: [path.join(synthetic, 'q')] }, false],
    ['P9b stable root cannot be an allowed root', { allowedRoots: [stableRoot], deniedRoots: [path.join(synthetic, 'q')] }, false],
    ['P9c outside path cannot be an allowed root', { allowedRoots: [path.join(FIXED_STABLE_ROOT, 'p9-outside')], deniedRoots: [path.join(synthetic, 'q')] }, false],
    ['P9d a protected directory cannot be an allowed root', { allowedRoots: [path.join(projectRoot, 'src')], deniedRoots: [path.join(synthetic, 'q')] }, false],
    ['P9e empty denylist is refused', { allowedRoots: [path.join(synthetic, 'nm')], deniedRoots: [] }, false],
    ['P9f overlapping deny and allow is refused', { allowedRoots: [path.join(synthetic, 'nm')], deniedRoots: [path.join(synthetic, 'nm', 'sub')] }, false],
    ['P9g a valid synthetic configuration is accepted', { allowedRoots: [path.join(synthetic, 'nm')], deniedRoots: [path.join(synthetic, 'q')] }, true],
  ];
  for (const [label, config, expectOk] of cases) {
    const verdict = validateEnvironment({ mode: 'synthetic', projectRoot, stableRoot, syntheticRoot: synthetic, ...config });
    record(label, verdict.ok === expectOk, { problems: verdict.problems });
  }
  const badQuarantine = validateEnvironment({
    mode: 'synthetic', projectRoot, stableRoot, syntheticRoot: synthetic,
    allowedRoots: [path.join(synthetic, 'nm')], deniedRoots: [path.join(synthetic, 'q')],
    quarantineTarget: path.join(synthetic, 'not-quarantine', 'nm'),
  });
  record('P9h quarantine target outside .m1-quarantine is refused', badQuarantine.ok === false, { problems: badQuarantine.problems });
}

// ================= pure-function: NODE_OPTIONS construction ====================================
{
  const options = buildNodeOptions(GUARD_PATH, '');
  record('P10 NODE_OPTIONS uses forward slashes for the preload path', options.includes('--require') && !options.includes('\\\\') && options.includes('scripts/m1/guard-install-deletions.cjs'), { options });
  const withExisting = buildNodeOptions(GUARD_PATH, '--max-old-space-size=4096');
  record('P11 existing NODE_OPTIONS are preserved', withExisting.includes('--max-old-space-size=4096') && withExisting.includes('guard-install-deletions'), { withExisting });
  const deDuplicated = buildNodeOptions(GUARD_PATH, `--require "${GUARD_PATH.split(path.sep).join('/')}"`);
  record('P12 a pre-existing guard preload is not duplicated', (deDuplicated.match(/guard-install-deletions/g) || []).length === 1, { deDuplicated });
}

// ================= real subprocess: happy path through the orchestrator ========================
scenarioDir('r1-happy');
{
  const base = path.join(ROOT, 'r1-happy');
  const seed = seedProject(base);
  const invocations = fixtureInvocations();
  const options = baseOptions(base, seed, {});
  // Regression: a regular file already sitting at the deletion-log path must not make the guard
  // refuse. This is exactly what happened when the pre-move probe shared the install log path.
  const preexistingLog = path.join(options.logDir, 'install-deletions.jsonl');
  fs.mkdirSync(options.logDir, { recursive: true });
  fs.writeFileSync(preexistingLog, '{"event":"prior_phase_placeholder"}\n', 'utf8');
  const result = runIsolatedInstall({
    ...options,
    commandRunner: createRealCommandRunner(),
    npmInvocation: invocations.npmInvocation,
    electronInvocation: invocations.electronInvocation,
    extraEnv: { M1_FIXTURE_ROOT: base },
  });

  record('R1 orchestration succeeds with real subprocesses', result.ok === true && result.exitCode === EXIT.OK, { ok: result.ok, exitCode: result.exitCode });
  record('R1 an existing regular file at the deletion-log path does not block the install',
    fs.readFileSync(preexistingLog, 'utf8').startsWith('{"event":"prior_phase_placeholder"}')
      && fs.readFileSync(preexistingLog, 'utf8').includes('"event":"guard_start"'),
    { head: fs.readFileSync(preexistingLog, 'utf8').split('\n').slice(0, 2) });
  record('R1 step log was appended per step', fs.existsSync(result.stepsLog) && fs.readFileSync(result.stepsLog, 'utf8').split('\n').filter((l) => l.trim()).length >= 10,
    { steps: result.steps.length });

  const npmStep = result.steps.find((s) => s.step === 'npm_ci');
  const electronStep = result.steps.find((s) => s.step === 'electron_install');
  record('R1 npm stdout tail marker captured from a real process', String(npmStep?.stdout_tail || '').includes('TAIL-MARKER:npm:stdout:end'), { tail: npmStep?.stdout_tail });
  record('R1 npm stderr tail marker captured', String(npmStep?.stderr_tail || '').includes('TAIL-MARKER:npm:stderr:end'), {});
  record('R1 npm stdout head captured', String(npmStep?.stdout_head || '').includes('fixture:npm:head'), {});
  record('R1 electron stdout tail marker captured', String(electronStep?.stdout_tail || '').includes('TAIL-MARKER:electron:stdout:end'), {});
  record('R1 subprocess stdout files exist and are non-empty',
    fs.existsSync(npmStep?.stdout) && fs.statSync(npmStep.stdout).size > 100 && fs.existsSync(electronStep?.stdout) && fs.statSync(electronStep.stdout).size > 100,
    { npm: npmStep?.stdout, electron: electronStep?.stdout });

  const markerPath = path.join(base, 'markers', 'npm.marker.json');
  if (!fs.existsSync(markerPath)) {
    record('R1 fixture wrote its marker', false, { markerPath, steps: result.steps.map((s) => s.step) });
  } else {
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    record('R1 fixture ran with the synthetic project as cwd', path.resolve(marker.cwd) === path.resolve(seed.projectRoot), { cwd: marker.cwd });
    record('R1 guard preload reached the real child', String(marker.node_options).includes('guard-install-deletions'), { node_options: marker.node_options });
    record('R1 cache and temp env reached the real child',
      isInside(marker.npm_config_cache, base) && isInside(marker.electron_config_cache, base) && isInside(marker.ELECTRON_BUILDER_CACHE, base) && isInside(marker.TEMP, base) && isInside(marker.TMP, base) && isInside(marker.TMPDIR, base),
      { marker });
    record('R1 remote checksum override absent in the real child', Array.isArray(marker.remote_checksum_keys) && marker.remote_checksum_keys.length === 0, { keys: marker.remote_checksum_keys });
  }

  const guardProbe = result.steps.find((s) => s.step === 'guard_load_probe');
  record('R1 guard load probe passed against the same guard', guardProbe?.ok === true && guardProbe?.guard_loaded === true, { guardProbe });
  const npmProbe = result.steps.find((s) => s.step === 'npm_version_probe');
  record('R1 npm --version probe passed using the resolved CLI', npmProbe?.ok === true, { npmProbe, npm_cli: resolveNpmCli() });

  const comparisonStep = result.steps.find((s) => s.step === 'inventory_compare');
  record('R1 full inventories persisted before and after the move',
    fs.existsSync(path.join(options.logDir, 'inventory-original.json')) && fs.existsSync(path.join(options.logDir, 'inventory-quarantine.json')) && fs.existsSync(path.join(options.logDir, 'inventory-comparison.json')),
    { comparison: comparisonStep });
  record('R1 real node_modules inside the synthetic root was the only target', isInside(options.nodeModulesPath, base) && isInside(options.quarantineTarget, base), {});

  // The fixture could not see M1_FIXTURE_ROOT unless it was passed; verify it was, else the
  // scenario would have failed loudly rather than silently passing.
  record('R1 fixture environment was provided (scenario is meaningful)', fs.existsSync(path.join(base, 'markers', 'npm.marker.json')), {});

  // Whole-run rollup: recomputed from the raw log records of every pid, and cross-checked against
  // the per-process summaries the guard itself wrote.
  const rollup = result.deletionSummary;
  record('R1 the run-level deletion rollup was produced from the raw logs',
    rollup && rollup.run.processes >= 2
      && rollup.per_process.filter((item) => item.attributed).length === rollup.run.processes
      && rollup.per_process.length === rollup.run.processes + 1
      && rollup.run.unattributed_records === 1,
    { processes: rollup?.run?.processes, per_process: rollup?.per_process, unattributed: rollup?.run?.unattributed_records });
  record('R1 a log line without a pid is reported as unattributed, not merged into a real pid',
    rollup?.run?.unattributed_lines_are_counted_in_totals_but_not_cross_checked === true
      && rollup.cross_check.every((item) => item.pid !== 'unattributed'),
    { flag: rollup?.run?.unattributed_lines_are_counted_in_totals_but_not_cross_checked });
  record('R1 the rollup cross-check agrees with every per-process summary',
    rollup && rollup.cross_check.length > 0 && rollup.cross_check_mismatches.length === 0,
    { mismatches: rollup?.cross_check_mismatches });
  record('R1 the rollup declares pid-free dedup and top-level-only call counts',
    rollup?.run?.dedup_key.includes('pid is not part of the key') && rollup?.run?.call_count_scope === 'top_level_deletion_api_calls_only',
    { dedup_key: rollup?.run?.dedup_key, scope: rollup?.run?.call_count_scope });
}

// ================= real subprocess: npm failure stops before Electron ==========================
scenarioDir('r2-npm-fail');
{
  const base = path.join(ROOT, 'r2-npm-fail');
  const seed = seedProject(base);
  const options = baseOptions(base, seed, {});
  const result = runIsolatedInstall({
    ...options,
    commandRunner: createRealCommandRunner(),
    npmInvocation: { command: process.execPath, args: [FIXTURE, 'npm'] },
    electronInvocation: { command: process.execPath, args: [FIXTURE, 'electron'] },
    extraEnv: { M1_FIXTURE_ROOT: base, M1_FIXTURE_EXIT_NPM: '69' },
  });
  record('R2 npm failure exits non-zero', result.exitCode === EXIT.COMMAND_FAILED, { exitCode: result.exitCode });
  record('R2 Electron marker was never written', !fs.existsSync(path.join(base, 'markers', 'electron.marker.json')), {});
  record('R2 failedStep is npm_ci', result.failedStep === 'npm_ci', {});
}

// ================= real subprocess: missing Electron binary must fail ==========================
scenarioDir('r3-missing-binary');
{
  const base = path.join(ROOT, 'r3-missing-binary');
  const seed = seedProject(base);
  const options = baseOptions(base, seed, {});
  const result = runIsolatedInstall({
    ...options,
    commandRunner: createRealCommandRunner(),
    npmInvocation: { command: process.execPath, args: [FIXTURE, 'npm'] },
    electronInvocation: { command: process.execPath, args: [FIXTURE, 'electron'] },
    extraEnv: { M1_FIXTURE_ROOT: base, M1_FIXTURE_SKIP_BINARY: '1' },
  });
  const verify = result.steps.find((s) => s.step === 'post_install_verification');
  record('R3 verification reports electron problems', Array.isArray(verify?.electron_problems), { problems: verify?.electron_problems });
  record('R3 path.txt pointing at a missing binary fails the run',
    result.ok === false && result.exitCode === EXIT.VERIFICATION_FAILED && (verify?.electron_problems || []).length > 0,
    { exitCode: result.exitCode, problems: verify?.electron_problems });
}

// ================= real subprocess: illegal root rejected before any write ====================
scenarioDir('r4-illegal-root');
{
  const base = path.join(ROOT, 'r4-illegal-root');
  const seed = seedProject(base);
  // An illegal cache root must live OUTSIDE the synthetic root, otherwise it would legitimately
  // be inside the permitted synthetic scope.
  const outsideCache = path.join(FIXED_STABLE_ROOT, 'r4-illegal-outside-cache');
  const options = baseOptions(base, seed, { cacheDirs: { npm: outsideCache, electron: path.join(base, 'cache', 'electron'), electronBuilder: path.join(base, 'cache', 'electron-builder') } });
  const result = runIsolatedInstall({
    ...options,
    commandRunner: createRealCommandRunner(),
    npmInvocation: { command: process.execPath, args: [FIXTURE, 'npm'] },
    electronInvocation: { command: process.execPath, args: [FIXTURE, 'electron'] },
  });
  record('R4 illegal cache root exits before any write', result.exitCode === EXIT.ENVIRONMENT_INVALID, { exitCode: result.exitCode });
  record('R4 the refusal reports log_written:false and no step-log path',
    result.log_written === false && result.stepsLog === null && result.refused_before_write === true,
    { log_written: result.log_written, stepsLog: result.stepsLog, refused_before_write: result.refused_before_write });
  // The pre-write contract: nothing at all may be created, not even the step log that describes the
  // refusal. Validation results are returned in memory instead.
  record('R4 no step log and no log directory were created',
    !fs.existsSync(options.logDir) && !fs.existsSync(path.join(options.logDir, 'steps.jsonl')),
    { logDirExists: fs.existsSync(options.logDir) });
  record('R4 no scratch directory was created', !fs.existsSync(outsideCache) && !fs.existsSync(options.tmpDir), { outsideCacheExists: fs.existsSync(outsideCache), tmpExists: fs.existsSync(options.tmpDir) });
  record('R4 no marker was written by any fixture', !fs.existsSync(path.join(base, 'markers', 'npm.marker.json')), {});
  record('R4 quarantine target was not created', !fs.existsSync(options.quarantineTarget), {});
  record('R4 nothing beyond the pre-seeded project exists under the scenario root',
    fs.readdirSync(base).sort().join(',') === 'project',
    { entries: fs.readdirSync(base).sort() });
  record('R4 the refusal reason is returned, not only logged',
    Array.isArray(result.pre_write_problems) && result.pre_write_problems.length > 0
      && result.pre_write_problems.some((item) => item.includes('not strictly inside the stable root')),
    { pre_write_problems: result.pre_write_problems });
}

// ================= real subprocess: guard refuses a bad configuration =========================
scenarioDir('r5-guard-refuses');
{
  const base = path.join(ROOT, 'r5-guard-refuses');
  const allowed = path.join(base, 'allowed');
  fs.mkdirSync(allowed, { recursive: true });
  const probe = probeGuardLoad({
    execPath: process.execPath,
    guardPath: GUARD_PATH,
    logDir: base,
    env: {
      ...process.env,
      // The guard only runs if it is actually preloaded, so NODE_OPTIONS must carry it.
      NODE_OPTIONS: buildNodeOptions(GUARD_PATH, ''),
      M1_INSTALL_DELETE_LOG: path.join(base, 'refuse.jsonl'),
      M1_INSTALL_DESCENDANT_LOG: path.join(base, 'refuse.descendants.jsonl'),
      M1_INSTALL_MODE: 'synthetic',
      M1_INSTALL_PROJECT_ROOT: base,
      M1_INSTALL_STABLE_ROOT: base,
      M1_INSTALL_SYNTHETIC_ROOT: base,
      M1_INSTALL_ALLOWED_ROOTS: JSON.stringify([base]),
      M1_INSTALL_DENIED_ROOTS: JSON.stringify([path.join(base, 'q')]),
    },
  });
  record('R5 guard load probe fails when the stable root is the allowed root', probe.ok === false && probe.status === 78, { status: probe.status, ok: probe.ok });
  // A configuration refusal must be reported on stderr and must NOT open the deletion log: an
  // invalid run may not leave an audit file behind that looks like a real (empty) audit.
  const r5Refusal = (() => {
    try { return JSON.parse(fs.readFileSync(probe.stderr_path, 'utf8')); } catch { return null; }
  })();
  record('R5 refusal is reported on stderr with reasons and without writing the log',
    r5Refusal !== null && r5Refusal.guard === 'refused' && Array.isArray(r5Refusal.root_problems) && r5Refusal.root_problems.length > 0
      && r5Refusal.log_written === false && !fs.existsSync(probe.log),
    { refusal: r5Refusal, logExists: fs.existsSync(probe.log) });
  // The guard must also refuse when it is not preloaded at all, because then nothing is protected.
  const noPreload = probeGuardLoad({
    execPath: process.execPath,
    guardPath: GUARD_PATH,
    logDir: base,
    env: {
      ...process.env,
      NODE_OPTIONS: '',
      M1_INSTALL_DELETE_LOG: path.join(base, 'no-preload.jsonl'),
      M1_INSTALL_DESCENDANT_LOG: path.join(base, 'no-preload.descendants.jsonl'),
      M1_INSTALL_MODE: 'synthetic',
      M1_INSTALL_PROJECT_ROOT: base,
      M1_INSTALL_STABLE_ROOT: base,
      M1_INSTALL_SYNTHETIC_ROOT: base,
      M1_INSTALL_ALLOWED_ROOTS: JSON.stringify([allowed]),
      M1_INSTALL_DENIED_ROOTS: JSON.stringify([path.join(base, 'q')]),
    },
  });
  record('R5 the probe is meaningful: without the preload no guard log is produced',
    noPreload.ok === false && !fs.existsSync(noPreload.log), { status: noPreload.status, log: noPreload.log });
}

// ================= real subprocess: callback recursive audit + full counts =====================
scenarioDir('r6-callback-audit');
{
  const base = path.join(ROOT, 'r6-callback-audit');
  const allowed = path.join(base, 'allowed');
  const denied = path.join(base, 'denied');
  fs.mkdirSync(allowed, { recursive: true });
  fs.mkdirSync(denied, { recursive: true });
  const logFile = path.join(base, 'guard.jsonl');
  const descendants = path.join(base, 'guard.descendants.jsonl');

  const tree = path.join(allowed, 'tree');
  for (let index = 0; index < 6; index += 1) {
    fs.mkdirSync(path.join(tree, 'd', String(index)), { recursive: true });
    fs.writeFileSync(path.join(tree, 'd', String(index), `f${index}.txt`), `v${index}`, 'utf8');
  }
  fs.writeFileSync(path.join(allowed, 'single.txt'), 'single', 'utf8');
  const missing = path.join(allowed, 'absent.txt');

  const env = {
    ...process.env,
    M1_INSTALL_DELETE_LOG: logFile,
    M1_INSTALL_DESCENDANT_LOG: descendants,
    M1_INSTALL_MODE: 'synthetic',
    M1_INSTALL_PROJECT_ROOT: base,
    M1_INSTALL_STABLE_ROOT: base,
    M1_INSTALL_SYNTHETIC_ROOT: base,
    M1_INSTALL_ALLOWED_ROOTS: JSON.stringify([allowed]),
    M1_INSTALL_DENIED_ROOTS: JSON.stringify([denied]),
  };

  // Real child process. stdout/stderr go to files by descriptor: piped stdio is refused in this
  // environment, and stdio:ignore would hide the evidence.
  const shaBefore = shaFile(path.join(allowed, 'single.txt'));
  const childStdout = path.join(base, 'child.stdout.txt');
  const childStderr = path.join(base, 'child.stderr.txt');
  const child = spawnToFiles(process.execPath, ['--require', GUARD_PATH, '-e', `
    const fs = require('node:fs');
    fs.rm(${JSON.stringify(missing)}, { force: true }, () => {});
    fs.rm(${JSON.stringify(tree)}, { recursive: true }, (error) => {
      if (error) { process.stderr.write('callback-error:' + error.code + '\\n'); process.exit(9); }
      process.stdout.write('TAIL-MARKER:callback:stdout:end\\n');
      fs.unlinkSync(${JSON.stringify(path.join(allowed, 'single.txt'))});
    });
  `], { env, stdoutPath: childStdout, stderrPath: childStderr });

  record('R6 child exited zero', child.status === 0, { status: child.status, stderr: fs.readFileSync(childStderr, 'utf8').slice(0, 200), error: child.error ? child.error.code : null });
  record('R6 child stdout tail marker captured to file', fs.readFileSync(childStdout, 'utf8').includes('TAIL-MARKER:callback:stdout:end'), {});
  record('R6 guard log was produced by the real child', fs.existsSync(logFile), { logFile });

  const records = fs.readFileSync(logFile, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const deleted = records.filter((r) => r.event === 'deleted');
  const noop = records.filter((r) => r.event === 'noop');
  const recursive = deleted.filter((r) => r.recursive);
  const single = deleted.filter((r) => !r.recursive);

  record('R6 callback rm with recursive:true is detected as recursive', recursive.length === 1 && recursive[0].resolved === tree, { recursive: recursive.map((r) => r.resolved) });
  record('R6 callback rm with force only is a noop and not recursive', noop.length === 1 && !noop[0].recursive, { noop: noop.map((r) => ({ p: r.resolved, rec: r.recursive })) });
  record('R6 unlinkSync is not recursive', single.length === 1 && single[0].operation === 'unlinkSync', { single: single.map((r) => r.operation) });
  record('R6 single-file content is gone', !fs.existsSync(path.join(allowed, 'single.txt')) && shaBefore.length === 64, {});

  const descendantLines = fs.readFileSync(descendants, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  // Two kinds of descendant line now exist: the pre-deletion listing written before the removal,
  // and the confirmed-gone listing written after it. They must be counted separately, otherwise a
  // single recursive call looks like twice as many vanished paths.
  const preDeletionLines = descendantLines.filter((l) => l.phase === 'pre_deletion');
  const confirmedGoneLines = descendantLines.filter((l) => l.phase !== 'pre_deletion');
  const persisted = confirmedGoneLines.reduce((sum, item) => sum + item.count, 0);
  record('R6 full descendant path list persisted (not truncated to 50)', confirmedGoneLines.length >= 1 && persisted >= 13,
    { persisted, lines: confirmedGoneLines.length, entries_sample: confirmedGoneLines[0]?.entries?.slice(0, 3) });
  record('R6 the pre-deletion listing of the whole tree was persisted before the removal',
    preDeletionLines.length === 1 && preDeletionLines[0].count === 13 && preDeletionLines[0].resolved === tree,
    { preDeletion: preDeletionLines.map((l) => ({ count: l.count, resolved: l.resolved })) });
  record('R6 descendant entries carry relative path and type', (confirmedGoneLines[0]?.entries || []).every((e) => e.includes('\u0000')), {});
  record('R6 the pre-deletion listing also carries relative path and type', (preDeletionLines[0]?.entries || []).every((e) => e.includes('\u0000')), {});
  record('R6 the recursive call reports the same descendant count it persisted', recursive[0]?.confirmed_paths_gone === persisted, { confirmed: recursive[0]?.confirmed_paths_gone, persisted });

  const summary = records.find((r) => r.event === 'summary');
  record('R6 the summary distinguishes top-level calls, deletions, noops and failures',
    summary && summary.call_count === deleted.length + noop.length + summary.failed_attempts
      && summary.call_count_scope === 'top_level_deletion_api_calls_only'
      && summary.successful_deletions === deleted.length
      && summary.noop_calls === noop.length
      && typeof summary.unknown_outcomes === 'number',
    { call_count: summary?.call_count, scope: summary?.call_count_scope, deleted: deleted.length, noop: noop.length });

  // Descendants and deletion targets are reported as two separate layers, then combined into one
  // path total that is still deduplicated by normalized absolute path.
  record('R6 the summary separates descendant counts from deletion-target counts',
    summary?.descendant_paths_gone_observed === persisted
      && summary?.distinct_descendant_paths_gone === persisted
      && summary?.deletion_targets_confirmed_gone === 2
      && summary?.distinct_deletion_target_paths_gone === 2,
    { summary: summary && { observed: summary.descendant_paths_gone_observed, distinct_descendants: summary.distinct_descendant_paths_gone, targets: summary.deletion_targets_confirmed_gone, distinct_targets: summary.distinct_deletion_target_paths_gone } });
  record('R6 the combined path total equals descendants plus distinct targets',
    summary?.distinct_confirmed_paths_gone === persisted + 2,
    { combined: summary?.distinct_confirmed_paths_gone, expected: persisted + 2 });
  record('R6 the summary states that call_count excludes internal steps',
    summary?.api_calls_total_including_internal_steps === summary.call_count + summary.internal_step_records
      && summary.dedup_key.includes('normalized absolute path'),
    { api_total: summary?.api_calls_total_including_internal_steps, call_count: summary?.call_count, internal: summary?.internal_step_records });
  record('R6 sequence numbers are unique and monotonic across every record type',
    (() => {
      const sequences = records.map((r) => r.sequence);
      return sequences.every((value, index) => typeof value === 'number' && (index === 0 || value > sequences[index - 1]));
    })(), { sequences: records.map((r) => r.sequence) });

  // The same rollup the orchestrator produces must agree with what this child wrote.
  const rollup = summarizeDeletionLogs({ logPath: logFile, descendantPath: descendants });
  record('R6 the cross-PID rollup recomputes this child correctly and cross-checks clean',
    rollup.run.processes === 1 && rollup.cross_check_mismatches.length === 0
      && rollup.run.distinct_descendant_paths_gone === persisted
      && rollup.run.distinct_deletion_target_paths_gone === 2,
    { run: rollup.run, mismatches: rollup.cross_check_mismatches });
}

// ================= real subprocess: guard blocks an out-of-scope deletion ======================
scenarioDir('r7-blocked');
{
  const base = path.join(ROOT, 'r7-blocked');
  const allowed = path.join(base, 'allowed');
  const denied = path.join(base, 'quarantine');
  fs.mkdirSync(allowed, { recursive: true });
  fs.mkdirSync(denied, { recursive: true });
  const protectedFile = path.join(denied, 'rollback-artifact.txt');
  fs.writeFileSync(protectedFile, 'must survive', 'utf8');
  const logFile = path.join(base, 'guard.jsonl');
  const childStderr7 = path.join(base, 'child.stderr.txt');
  const child = spawnToFiles(process.execPath, ['--require', GUARD_PATH, '-e', `require('node:fs').unlinkSync(${JSON.stringify(protectedFile)});`], {
    env: {
      ...process.env,
      M1_INSTALL_DELETE_LOG: logFile,
      M1_INSTALL_DESCENDANT_LOG: path.join(base, 'd.jsonl'),
      M1_INSTALL_MODE: 'synthetic',
      M1_INSTALL_PROJECT_ROOT: base,
      M1_INSTALL_STABLE_ROOT: base,
      M1_INSTALL_SYNTHETIC_ROOT: base,
      M1_INSTALL_ALLOWED_ROOTS: JSON.stringify([allowed]),
      M1_INSTALL_DENIED_ROOTS: JSON.stringify([denied]),
    },
    stdoutPath: path.join(base, 'child.stdout.txt'),
    stderrPath: childStderr7,
  });
  const records = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];
  record('R7 guard blocks deletion inside the denied root', child.status === EXIT.GUARD_BLOCKED, { status: child.status, stderr: fs.readFileSync(childStderr7, 'utf8').slice(0, 200) });
  record('R7 blocked target survived', fs.existsSync(protectedFile), {});
  record('R7 blocked record carries the verdict', records.some((r) => r.event === 'blocked' && r.verdict === 'denied'), {});
}

// ================= real subprocess: read-failure contract (no ACL damage) ======================
scenarioDir('r8-read-failure');
{
  // The read-failure branch is verified with a no-side-effect mock INSIDE a real child process:
  // readdirSync is made to throw EACCES for one call, so no real permissions are touched and no
  // real file is made unreadable.
  const base = path.join(ROOT, 'r8-read-failure');
  const allowed = path.join(base, 'allowed');
  fs.mkdirSync(path.join(allowed, 'tree'), { recursive: true });
  fs.writeFileSync(path.join(allowed, 'tree', 'x.txt'), 'x', 'utf8');
  const outFile = path.join(base, 'readtree.json');

  const childStdout8 = path.join(base, 'child.stdout.txt');
  const childStderr8 = path.join(base, 'child.stderr.txt');
  const child = spawnToFiles(process.execPath, ['--require', GUARD_PATH, '-e', `
    const fs = require('node:fs');
    const guard = require(${JSON.stringify(GUARD_PATH)});
    const absent = guard.readTree(${JSON.stringify(path.join(base, 'does-not-exist'))});
    const present = guard.readTree(${JSON.stringify(path.join(allowed, 'tree'))});
    const originalReaddir = fs.readdirSync;
    fs.readdirSync = function () { const e = new Error('denied'); e.code = 'EACCES'; throw e; };
    const unreadable = guard.readTree(${JSON.stringify(path.join(allowed, 'tree'))});
    fs.readdirSync = originalReaddir;
    fs.writeFileSync(${JSON.stringify(outFile)}, JSON.stringify({ absent, present, unreadable }), 'utf8');
  `], {
    env: {
      ...process.env,
      M1_INSTALL_DELETE_LOG: path.join(base, 'guard.jsonl'),
      M1_INSTALL_DESCENDANT_LOG: path.join(base, 'guard.descendants.jsonl'),
      M1_INSTALL_MODE: 'synthetic',
      M1_INSTALL_PROJECT_ROOT: base,
      M1_INSTALL_STABLE_ROOT: base,
      M1_INSTALL_SYNTHETIC_ROOT: base,
      M1_INSTALL_ALLOWED_ROOTS: JSON.stringify([allowed]),
      M1_INSTALL_DENIED_ROOTS: JSON.stringify([path.join(base, 'denied')]),
    },
    stdoutPath: childStdout8,
    stderrPath: childStderr8,
  });

  record('R8 readTree child exited zero', child.status === 0, { status: child.status, stderr: fs.readFileSync(childStderr8, 'utf8').slice(0, 300), error: child.error ? child.error.code : null });
  if (fs.existsSync(outFile)) {
    const data = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    record('R8 absence is reported as absent, not as empty', data.absent.state === 'absent', { absent: data.absent });
    record('R8 a readable tree reports present_tree with entries', data.present.state === 'present_tree' && data.present.entries.length === 1, { present_state: data.present.state, count: data.present.entries.length });
    record('R8 a permission failure is distinguished from absence', data.unreadable.state === 'unreadable' && data.unreadable.error_code === 'EACCES', { unreadable: { state: data.unreadable.state, code: data.unreadable.error_code } });
  } else {
    record('R8 readTree results were written', false, { outFile });
  }
}

// ================= real subprocess: guard aborts when a target is unreadable ===================
scenarioDir('r9-unreadable-abort');
{
  const base = path.join(ROOT, 'r9-unreadable-abort');
  const allowed = path.join(base, 'allowed');
  const tree = path.join(allowed, 'tree');
  fs.mkdirSync(path.join(tree, 'deep'), { recursive: true });
  fs.writeFileSync(path.join(tree, 'deep', 'x.txt'), 'x', 'utf8');
  const logFile = path.join(base, 'guard.jsonl');

  // Monkey-patch readdirSync to fail only for the nested directory, so the preflight cannot
  // complete and the guard must abort instead of deleting.
  const childStderr9 = path.join(base, 'child.stderr.txt');
  const child = spawnToFiles(process.execPath, ['--require', GUARD_PATH, '-e', `
    const fs = require('node:fs');
    const target = ${JSON.stringify(path.join(tree, 'deep'))};
    const original = fs.readdirSync;
    fs.readdirSync = function (p, ...rest) {
      if (String(p).toLowerCase().startsWith(target.toLowerCase())) { const e = new Error('denied'); e.code = 'EACCES'; throw e; }
      return original.call(fs, p, ...rest);
    };
    try { fs.rmSync(${JSON.stringify(tree)}, { recursive: true }); } catch (e) { process.stderr.write('unexpected:' + e.code + '\\n'); }
    fs.readdirSync = original;
  `], {
    env: {
      ...process.env,
      M1_INSTALL_DELETE_LOG: logFile,
      M1_INSTALL_DESCENDANT_LOG: path.join(base, 'guard.descendants.jsonl'),
      M1_INSTALL_MODE: 'synthetic',
      M1_INSTALL_PROJECT_ROOT: base,
      M1_INSTALL_STABLE_ROOT: base,
      M1_INSTALL_SYNTHETIC_ROOT: base,
      M1_INSTALL_ALLOWED_ROOTS: JSON.stringify([allowed]),
      M1_INSTALL_DENIED_ROOTS: JSON.stringify([path.join(base, 'denied')]),
    },
    stdoutPath: path.join(base, 'child.stdout.txt'),
    stderrPath: childStderr9,
  });
  const records = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];
  record('R9 guard aborts (exit 80) when the target cannot be fully read', child.status === 80, { status: child.status, stderr: fs.readFileSync(childStderr9, 'utf8').slice(0, 200) });
  record('R9 abort is recorded with a reason', records.some((r) => r.event === 'guard_aborted' && String(r.reason).includes('unreadable')), {});
  record('R9 nothing was deleted', fs.existsSync(path.join(tree, 'deep', 'x.txt')), {});
}

// ================= pure-function: target ancestor/kind contract ================================
{
  const dir = path.join(ROOT, 'a0-ancestors');
  fs.mkdirSync(dir, { recursive: true });
  const existingFile = path.join(dir, 'already-a-file.jsonl');
  fs.writeFileSync(existingFile, 'placeholder\n', 'utf8');
  const missing = path.join(dir, 'not-created-yet', 'nested');

  record('A0 a missing target whose ancestors exist is accepted',
    validateTargetAncestors([missing]).ok === true, { problems: validateTargetAncestors([missing]).problems });
  record('A0 an existing regular file is accepted as a file target',
    validateTargetAncestors([{ path: existingFile, kind: 'file' }]).ok === true,
    { problems: validateTargetAncestors([{ path: existingFile, kind: 'file' }]).problems });
  record('A0 an existing regular file is refused as a directory target',
    validateTargetAncestors([{ path: existingFile, kind: 'directory' }]).ok === false,
    { problems: validateTargetAncestors([{ path: existingFile, kind: 'directory' }]).problems });
  record('A0 an existing directory is refused as a file target',
    validateTargetAncestors([{ path: dir, kind: 'file' }]).ok === false,
    { problems: validateTargetAncestors([{ path: dir, kind: 'file' }]).problems });
  record('A0 a plain string target keeps directory semantics',
    validateTargetAncestors([dir]).ok === true && validateTargetAncestors([existingFile]).ok === false,
    { dir: validateTargetAncestors([dir]).problems, file: validateTargetAncestors([existingFile]).problems });
}

// ================= in-memory: the audit accounting contract ====================================
// The partial-failure accounting used to be demonstrated with a real Windows EPERM (a nested
// directory pinned as another process's CWD). That evidence is historical and is kept in the
// previous round's evidence directory; it is NOT re-created here. These checks inject the same
// situations as in-memory records instead: no file locks, no broken ACLs, no real EPERM, and no
// verifier-side cleanup.
{
  // (a) Identically named files under different deletion roots must stay two distinct paths.
  const treeA = path.join(ROOT, 'audit-a', 'treeA');
  const treeB = path.join(ROOT, 'audit-a', 'treeB');
  const keyA = descendantAuditKey(treeA, 'same.txt\u0000file');
  const keyB = descendantAuditKey(treeB, 'same.txt\u0000file');
  record('R10a the same relative name under two roots produces two different keys',
    keyA !== keyB && keyA.endsWith('treea\\same.txt') && keyB.endsWith('treeb\\same.txt'),
    { keyA, keyB });
  record('R10a normalizeAuditPath is case-insensitive and absolute',
    normalizeAuditPath(treeA) === normalizeAuditPath(treeA.toUpperCase()), { normalized: normalizeAuditPath(treeA) });

  const distinctFixture = {
    logPath: path.join(ROOT, 'audit-a', 'distinct.jsonl'),
    descendantPath: path.join(ROOT, 'audit-a', 'distinct.descendants.jsonl'),
  };
  const distinctRollup = summarizeDeletionLogs({
    logPath: null,
    descendantPath: null,
  });
  record('R10a an empty/missing log pair yields an empty rollup instead of throwing',
    distinctRollup.run.processes === 0 && distinctRollup.run.distinct_confirmed_paths_gone === 0 && distinctRollup.cross_check.length === 0,
    { run: distinctRollup.run });

  // The same reasoning is then checked against real JSONL fixtures written by the verifier itself,
  // through the same public entry point the orchestrator uses.
  fs.mkdirSync(path.dirname(distinctFixture.logPath), { recursive: true });
  const pidA = 42001;
  const pidB = 42002;
  const sharedLog = [
    { pid: pidA, event: 'guard_start', guard_loaded: true },
    { pid: pidA, event: 'deleted', operation: 'rmSync', recursive: true, existed_before: true, exists_after: false, resolved: treeA, confirmed_paths_gone: 3, outcome: 'recursive_all_gone' },
    { pid: pidA, event: 'summary', call_count: 1, successful_deletion_calls: 1, noop_calls: 0, failed_attempts: 0, descendant_paths_gone_observed: 3, distinct_descendant_paths_gone: 3, distinct_deletion_target_paths_gone: 1, distinct_confirmed_paths_gone: 4, unknown_outcomes: 0 },
    { pid: pidB, event: 'guard_start', guard_loaded: true },
    { pid: pidB, event: 'deleted', operation: 'rmSync', recursive: true, existed_before: true, exists_after: false, resolved: treeB, confirmed_paths_gone: 3, outcome: 'recursive_all_gone' },
    { pid: pidB, event: 'summary', call_count: 1, successful_deletion_calls: 1, noop_calls: 0, failed_attempts: 0, descendant_paths_gone_observed: 3, distinct_descendant_paths_gone: 3, distinct_deletion_target_paths_gone: 1, distinct_confirmed_paths_gone: 4, unknown_outcomes: 0 },
  ];
  const sharedDescendants = [
    { pid: pidA, resolved: treeA, count: 3, entries: ['same.txt\u0000file', 'a\u0000directory', 'a/other.txt\u0000file'] },
    // (b) A foreign-pid line sits in the SAME shared descendant log and must not leak into pid A.
    { pid: pidB, resolved: treeB, count: 3, entries: ['same.txt\u0000file', 'b\u0000directory', 'b/other.txt\u0000file'] },
  ];
  writeJsonlFile(distinctFixture.logPath, sharedLog);
  writeJsonlFile(distinctFixture.descendantPath, sharedDescendants);
  const sharedRollup = summarizeDeletionLogs(distinctFixture);
  const pidAEntry = sharedRollup.per_process.find((item) => item.pid === pidA);
  const pidBEntry = sharedRollup.per_process.find((item) => item.pid === pidB);
  record('R10a same-named files in two trees are two distinct descendants, not one',
    sharedRollup.run.distinct_descendant_paths_gone === 6
      && sharedRollup.run.distinct_deletion_target_paths_gone === 2
      && sharedRollup.run.distinct_confirmed_paths_gone === 8,
    { run: sharedRollup.run });
  record('R10b a shared log file does not pollute the per-process numbers',
    pidAEntry?.distinct_descendant_paths_gone === 3 && pidBEntry?.distinct_descendant_paths_gone === 3
      && pidAEntry?.distinct_confirmed_paths_gone === 4 && pidBEntry?.distinct_confirmed_paths_gone === 4,
    { pidA: pidAEntry, pidB: pidBEntry });
  record('R10b the rollup groups by pid and cross-checks against each declared summary',
    sharedRollup.run.processes === 2 && sharedRollup.cross_check.length === 18 && sharedRollup.cross_check_mismatches.length === 0,
    { cross_check_count: sharedRollup.cross_check.length, mismatches: sharedRollup.cross_check_mismatches });

  // (c) A recursive call that threw after removing part of the tree still counts what vanished.
  const partial = summarizeDeletionLogs({
    logPath: null,
    descendantPath: null,
  });
  const partialFixture = path.join(ROOT, 'audit-a', 'partial.jsonl');
  const partialDescendants = path.join(ROOT, 'audit-a', 'partial.descendants.jsonl');
  writeJsonlFile(partialFixture, [
    JSON.stringify({ pid: 5001, event: 'attempt_failed', operation: 'rmSync', recursive: true, existed_before: true, exists_after: true, resolved: treeA, error_code: 'EPERM', confirmed_paths_gone: 5, confirmed_paths_remaining: 1, outcome: 'failed_partial_deletion' }),
    JSON.stringify({ pid: 5001, event: 'summary', call_count: 1, successful_deletion_calls: 0, noop_calls: 0, failed_attempts: 1, descendant_paths_gone_observed: 5, distinct_descendant_paths_gone: 5, distinct_deletion_target_paths_gone: 0, distinct_confirmed_paths_gone: 5, unknown_outcomes: 0 }),
  ]);
  fs.writeFileSync(partialDescendants, `${JSON.stringify({ pid: 5001, resolved: treeA, count: 5, entries: ['a\u0000file', 'b\u0000file', 'c\u0000file', 'd\u0000file', 'e\u0000file'] })}\n`, 'utf8');
  const partialRollup = summarizeDeletionLogs({ logPath: partialFixture, descendantPath: partialDescendants });
  record('R10c a failed partial deletion still counts the paths that disappeared',
    partialRollup.run.descendant_paths_gone_observed === 5
      && partialRollup.run.confirmed_paths_gone_from_failed_calls === 5
      && partialRollup.run.distinct_confirmed_paths_gone === 5
      && partialRollup.run.successful_deletion_calls === 0
      && partialRollup.run.distinct_deletion_target_paths_gone === 0,
    { run: partialRollup.run });
  record('R10c the partially deleted root is not counted as a vanished target',
    partialRollup.cross_check_mismatches.length === 0, { mismatches: partialRollup.cross_check_mismatches });
  record('R10c the unused in-memory fixture helper stays side-effect free', partial.run.processes === 0, {});

  // (d) An unreadable-after outcome is an unknown result, not a zero-deletion success.
  const unknownFixture = path.join(ROOT, 'audit-a', 'unknown.jsonl');
  writeJsonlFile(unknownFixture, [
    JSON.stringify({ pid: 6001, event: 'attempt_failed', operation: 'rmSync', recursive: true, existed_before: true, exists_after: true, resolved: treeA, error_code: 'EPERM', outcome: 'failed_unknown_after', paths_indeterminate: 4 }),
    JSON.stringify({ pid: 6001, event: 'attempt_failed', operation: 'rmSync', recursive: true, existed_before: true, exists_after: true, resolved: treeB, error_code: 'EACCES', outcome: 'unknown_unreadable_after', paths_indeterminate: 2 }),
    JSON.stringify({ pid: 6001, event: 'summary', call_count: 2, successful_deletion_calls: 0, noop_calls: 0, failed_attempts: 2, descendant_paths_gone_observed: 0, distinct_descendant_paths_gone: 0, distinct_deletion_target_paths_gone: 0, distinct_confirmed_paths_gone: 0, unknown_outcomes: 2 }),
  ]);
  const unknownRollup = summarizeDeletionLogs({ logPath: unknownFixture, descendantPath: null });
  record('R10d failed_unknown_after and unknown_unreadable_after both count as unknown',
    unknownRollup.run.unknown_outcomes === 2 && unknownRollup.run.distinct_confirmed_paths_gone === 0,
    { run: unknownRollup.run });
  record('R10d unknown results are never presented as confirmed deletions',
    unknownRollup.run.successful_deletion_calls === 0 && unknownRollup.run.descendant_paths_gone_observed === 0, { run: unknownRollup.run });

  // The guard's own per-process aggregator is exercised in a guarded child process, still purely on
  // in-memory records: the only file written is the child's result file.
  const base = path.join(ROOT, 'r10-in-memory-fault');
  fs.mkdirSync(base, { recursive: true });
  const resultPath = path.join(base, 'guard-aggregate.json');
  const childStdout = path.join(base, 'child.stdout.txt');
  const childStderr = path.join(base, 'child.stderr.txt');
  const child = spawnToFiles(process.execPath, ['--require', GUARD_PATH, '-e', `
    const fs = require('node:fs');
    const guard = require(${JSON.stringify(GUARD_PATH)});
    const rootA = ${JSON.stringify(treeA)};
    const rootB = ${JSON.stringify(treeB)};
    const records = [
      // this process
      { pid: 7001, event: 'deleted', resolved: rootA, recursive: true, existed_before: true, exists_after: false, confirmed_paths_gone: 2, outcome: 'recursive_all_gone' },
      { pid: 7001, event: 'attempt_failed', resolved: rootB, recursive: true, existed_before: true, exists_after: true, error_code: 'EPERM', confirmed_paths_gone: 3, outcome: 'failed_partial_deletion' },
      { pid: 7001, event: 'attempt_failed', resolved: rootB, recursive: true, existed_before: true, exists_after: true, error_code: 'EPERM', outcome: 'failed_unknown_after', paths_indeterminate: 4 },
      { pid: 7001, event: 'internal_step', resolved: rootA + '\\\\inner.txt', associated_root: rootA },
      // another process sharing the same log
      { pid: 9999, event: 'deleted', resolved: rootB, recursive: true, existed_before: true, exists_after: false, confirmed_paths_gone: 99, outcome: 'recursive_all_gone' },
      { pid: 9999, event: 'internal_step', resolved: rootB + '\\\\x.txt', associated_root: rootB },
    ];
    const descendantLines = [
      { pid: 7001, resolved: rootA, count: 2, entries: ['same.txt\\u0000file', 'd\\u0000directory'] },
      { pid: 7001, resolved: rootB, count: 3, entries: ['same.txt\\u0000file', 'e\\u0000directory', 'e/x.txt\\u0000file'] },
      { pid: 9999, resolved: rootB, count: 99, entries: ['foreign\\u0000file'] },
    ];
    const mine = guard.summarizeRecords({ records, descendantLines, pid: 7001 });
    const other = guard.summarizeRecords({ records, descendantLines, pid: 9999 });
    fs.writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({
      mine, other,
      keyA: guard.descendantAuditKey(rootA, 'same.txt\\u0000file'),
      keyB: guard.descendantAuditKey(rootB, 'same.txt\\u0000file'),
      unknownFlagForFailedUnknown: guard.outcomeIsUnknown('failed_unknown_after'),
      unknownFlagForPartial: guard.outcomeIsUnknown('failed_partial_deletion'),
    }), 'utf8');
  `], {
    env: {
      ...process.env,
      M1_INSTALL_DELETE_LOG: path.join(base, 'guard.jsonl'),
      M1_INSTALL_DESCENDANT_LOG: path.join(base, 'guard.descendants.jsonl'),
      M1_INSTALL_MODE: 'synthetic',
      M1_INSTALL_PROJECT_ROOT: base,
      M1_INSTALL_STABLE_ROOT: base,
      M1_INSTALL_SYNTHETIC_ROOT: base,
      M1_INSTALL_ALLOWED_ROOTS: JSON.stringify([allowedRootForAudit(base)]),
      M1_INSTALL_DENIED_ROOTS: JSON.stringify([path.join(base, 'denied')]),
    },
    stdoutPath: childStdout,
    stderrPath: childStderr,
  });

  const aggregate = fs.existsSync(resultPath) ? JSON.parse(fs.readFileSync(resultPath, 'utf8')) : null;
  record('R10 the guard aggregator child completed', child.status === 0 && aggregate !== null,
    { status: child.status, stderr: fs.readFileSync(childStderr, 'utf8').slice(0, 300) });
  record('R10 the guard per-process aggregator ignores records from other pids',
    aggregate?.mine.records_counted === 4 && aggregate?.mine.successful_deletion_calls === 1
      && aggregate?.mine.failed_attempts === 2 && aggregate?.mine.internal_step_records === 1
      && aggregate?.other.records_counted === 2 && aggregate?.other.successful_deletion_calls === 1,
    { mine: aggregate?.mine, other: aggregate?.other });
  record('R10 the guard aggregator keeps same-named descendants under different roots distinct',
    aggregate && aggregate.keyA !== aggregate.keyB
      && aggregate.mine.distinct_descendant_paths_gone === 5
      && aggregate.mine.distinct_confirmed_paths_gone === 6,
    { keyA: aggregate?.keyA, keyB: aggregate?.keyB, mine: aggregate?.mine });
  record('R10 the guard aggregator counts a failed partial deletion and an unknown result separately',
    aggregate?.mine.descendant_paths_gone_observed === 5
      && aggregate?.mine.confirmed_paths_gone_from_failed_calls === 3
      && aggregate?.mine.unknown_outcomes === 1
      && aggregate?.unknownFlagForFailedUnknown === true
      && aggregate?.unknownFlagForPartial === false,
    { mine: aggregate?.mine, unknownFlag: aggregate?.unknownFlagForFailedUnknown, partialFlag: aggregate?.unknownFlagForPartial });
  record('R10 the guard aggregator documents the call-count scope and the dedup key',
    aggregate?.mine.call_count === 3 && aggregate?.mine.call_count_scope === 'top_level_deletion_api_calls_only'
      && aggregate?.mine.api_calls_total_including_internal_steps === 4
      && String(aggregate?.mine.dedup_key).includes('normalized absolute path'),
    { mine: aggregate?.mine });
}

// ================= real subprocess: suppression scope and internal-step counting ===============
// While a recursive removal is in flight, guard-internal calls to the same primitives are passed
// through without their own deletion record. Two things must hold: a call INSIDE the active root is
// counted as an internal step (not as a separate deletion), and a call OUTSIDE it is still a full
// top-level deletion with its own record.
scenarioDir('r11-suppression-scope');
{
  const base = path.join(ROOT, 'r11-suppression-scope');
  const allowed = path.join(base, 'allowed');
  const denied = path.join(base, 'denied');
  const tree = path.join(allowed, 'tree');
  const inner = path.join(tree, 'sub', 'inner.txt');
  const sibling = path.join(allowed, 'sibling.txt');
  fs.mkdirSync(path.join(tree, 'sub'), { recursive: true });
  fs.mkdirSync(denied, { recursive: true });
  fs.writeFileSync(inner, 'inner', 'utf8');
  fs.writeFileSync(path.join(tree, 'other.txt'), 'other', 'utf8');
  fs.writeFileSync(sibling, 'sibling', 'utf8');

  const logFile = path.join(base, 'guard.jsonl');
  const descendants = path.join(base, 'guard.descendants.jsonl');
  const stdoutPath = path.join(base, 'child.stdout.txt');
  const stderrPath = path.join(base, 'child.stderr.txt');

  const child = spawnToFiles(process.execPath, ['--require', GUARD_PATH, '-e', `
    const fs = require('node:fs');
    const tree = ${JSON.stringify(tree)};
    const inner = ${JSON.stringify(inner)};
    const sibling = ${JSON.stringify(sibling)};
    const descendantLog = ${JSON.stringify(descendants)};
    const originalAppend = fs.appendFileSync;
    let injected = false;
    // Hook the exact moment the pre-deletion listing has been persisted: the outer recursive call
    // is inside its guarded wrapper and its root is registered as active.
    fs.appendFileSync = function (target, data, ...rest) {
      const result = originalAppend.call(fs, target, data, ...rest);
      if (!injected && String(target) === descendantLog && typeof data === 'string' && data.includes('"phase":"pre_deletion"')) {
        injected = true;
        fs.unlinkSync(inner);    // inside the active recursive root
        fs.unlinkSync(sibling);  // outside it, so a separate top-level record is required
      }
      return result;
    };
    fs.rmSync(tree, { recursive: true });
    fs.appendFileSync = originalAppend;
    fs.writeFileSync(${JSON.stringify(path.join(base, 'child.result.json'))}, JSON.stringify({ inner_exists: fs.existsSync(inner), sibling_exists: fs.existsSync(sibling), tree_exists: fs.existsSync(tree) }), 'utf8');
  `], {
    env: {
      ...process.env,
      M1_INSTALL_DELETE_LOG: logFile,
      M1_INSTALL_DESCENDANT_LOG: descendants,
      M1_INSTALL_MODE: 'synthetic',
      M1_INSTALL_PROJECT_ROOT: base,
      M1_INSTALL_STABLE_ROOT: base,
      M1_INSTALL_SYNTHETIC_ROOT: base,
      M1_INSTALL_ALLOWED_ROOTS: JSON.stringify([allowed]),
      M1_INSTALL_DENIED_ROOTS: JSON.stringify([denied]),
    },
    stdoutPath,
    stderrPath,
  });

  const resultPath = path.join(base, 'child.result.json');
  const childResult = fs.existsSync(resultPath) ? JSON.parse(fs.readFileSync(resultPath, 'utf8')) : null;
  record('R11 injection child completed', child.status === 0 && childResult !== null, { status: child.status, childResult, stderr: fs.readFileSync(stderrPath, 'utf8').slice(0, 300) });

  const records = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];
  const deleted = records.filter((r) => r.event === 'deleted');
  const internal = records.filter((r) => r.event === 'internal_step');
  const summary = records.find((r) => r.event === 'summary');
  const samePath = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

  record('R11 the suppressed inner call was still executed', childResult?.inner_exists === false, { childResult });
  record('R11 the inner call is counted as an internal step of the outer root',
    internal.length === 1 && samePath(internal[0].resolved, inner) && samePath(internal[0].associated_root, tree) && internal[0].operation === 'unlinkSync',
    { internal });
  record('R11 the inner call did NOT produce its own deletion record',
    deleted.filter((r) => samePath(r.resolved, inner)).length === 0, { deleted: deleted.map((r) => r.resolved) });
  record('R11 a call outside the active root is a full recorded deletion',
    deleted.length === 2 && deleted.some((r) => samePath(r.resolved, sibling) && r.recursive === false) && deleted.some((r) => samePath(r.resolved, tree) && r.recursive === true),
    { deleted: deleted.map((r) => ({ p: r.resolved, rec: r.recursive, outcome: r.outcome })) });
  record('R11 the summary counts internal steps separately from deletion calls',
    summary?.call_count === 2
      && summary?.call_count_scope === 'top_level_deletion_api_calls_only'
      && summary?.api_calls_total_including_internal_steps === 3
      && summary?.distinct_deletion_targets_attempted === 2
      && summary?.internal_suppressed_calls === 1 && summary?.internal_suppressed_recorded === 1
      && summary?.internal_recording_truncated === false,
    { call_count: summary?.call_count, api_total: summary?.api_calls_total_including_internal_steps, attempted: summary?.distinct_deletion_targets_attempted, internal: summary?.internal_suppressed_calls });
  record('R11 internal steps share the same monotonic sequence generator as deletion records',
    (() => {
      const sequences = records.map((r) => r.sequence);
      return sequences.every((value, index) => typeof value === 'number' && (index === 0 || value > sequences[index - 1]));
    })(), { sequences: records.map((r) => ({ s: r.sequence, e: r.event })) });

  // Static invariant. The suppressed branch must still call admit() before returning, so a nested
  // call can never bypass the scope check. Because the configuration validator refuses any overlap
  // between the allowlist and the denylist, a suppressed call that is out of scope is unreachable
  // by construction; this asserts the defense-in-depth line is actually present in the source.
  const guardSource = fs.readFileSync(GUARD_PATH, 'utf8');
  const beginWrapBody = guardSource.slice(guardSource.indexOf('function beginWrap'), guardSource.indexOf('function endWrap'));
  const admitIndex = beginWrapBody.indexOf('admit(canonical.requested, operation)');
  const suppressedIndex = beginWrapBody.indexOf('return { suppressed: true');
  record('R11 the suppression branch still calls admit() before returning (source invariant)',
    admitIndex !== -1 && suppressedIndex !== -1 && admitIndex < suppressedIndex, { admitIndex, suppressedIndex });
  record('R11 the orchestrator refuses an allow/deny overlap that could make a suppressed call out of scope',
    validateEnvironment({
      mode: 'synthetic', projectRoot: path.join(ROOT, 'r11-suppression-scope', 'project'), stableRoot: path.join(ROOT, 'r11-suppression-scope', 'stable'),
      syntheticRoot: base,
      allowedRoots: [allowed], deniedRoots: [path.join(allowed, 'denied-inside-allowed')],
    }).ok === false, {});

  cleanup(path.join(allowed, 'tree'), 'r11 tree');
}

// ================= production scope rules (pure) ===============================================
// These calls are pure: validateEnvironment never creates anything. They pin the production
// allowlist to the fixed roots and to node_modules, and they are the negatives that earlier rounds
// only asserted for synthetic mode.
{
  const realNodeModules = path.join(FIXED_PROJECT_ROOT, 'node_modules');
  const quarantineTarget = path.join(FIXED_PROJECT_ROOT, '.m1-quarantine', 'node_modules');
  const stableCache = path.join(FIXED_STABLE_ROOT, 'cache', 'npm');
  const base = {
    mode: 'production',
    projectRoot: FIXED_PROJECT_ROOT,
    stableRoot: FIXED_STABLE_ROOT,
    deniedRoots: [quarantineTarget],
  };
  const cases = [
    ['B3a production accepts the project node_modules as the only in-project target', { allowedRoots: [realNodeModules] }, true],
    ['B3b production accepts a scratch directory under the fixed stable root', { allowedRoots: [stableCache] }, true],
    ['B3c production refuses a non-node_modules directory inside the project', { allowedRoots: [path.join(FIXED_PROJECT_ROOT, 'backend')] }, false],
    ['B3d production refuses the project root itself', { allowedRoots: [FIXED_PROJECT_ROOT] }, false],
    ['B3e production refuses a protected directory inside the project', { allowedRoots: [path.join(FIXED_PROJECT_ROOT, 'src')] }, false],
    ['B3f production refuses the quarantine area as a target', { allowedRoots: [path.join(FIXED_PROJECT_ROOT, '.m1-quarantine')] }, false],
    ['B3g production refuses a path outside both fixed roots', { allowedRoots: [path.join(FIXED_STABLE_ROOT, '..', 'elsewhere')] }, false],
    ['B3h production refuses a non-fixed project root', { projectRoot: path.join(FIXED_STABLE_ROOT, 'pretend-project'), allowedRoots: [realNodeModules] }, false],
    ['B3i production refuses a non-fixed stable root', { stableRoot: path.join(FIXED_PROJECT_ROOT, '.m1-evidence'), allowedRoots: [realNodeModules] }, false],
    ['B3j production refuses a synthetic root', { syntheticRoot: path.join(FIXED_STABLE_ROOT, 'synthetic'), allowedRoots: [realNodeModules] }, false],
    ['B3k production refuses an empty denylist', { allowedRoots: [realNodeModules], deniedRoots: [] }, false],
    ['B3l production refuses a quarantine target outside .m1-quarantine', { allowedRoots: [realNodeModules], quarantineTarget: path.join(FIXED_PROJECT_ROOT, 'node_modules-quarantine') }, false],
  ];
  for (const [label, overrides, expectOk] of cases) {
    const verdict = validateEnvironment({ ...base, ...overrides, quarantineTarget: overrides.quarantineTarget || quarantineTarget });
    record(label, verdict.ok === expectOk, { problems: verdict.problems, expected_ok: expectOk });
  }
  record('B3m the fixed roots exist, so the production negatives above are meaningful',
    fs.existsSync(FIXED_PROJECT_ROOT) && fs.existsSync(FIXED_STABLE_ROOT) && fs.existsSync(realNodeModules), {});
  record('B3n the production acceptance cases did not depend on a real quarantine target that already exists',
    !fs.existsSync(quarantineTarget), { quarantineTarget });
}

// ================= production scope rules (real guard process) =================================
// The production negatives are also exercised against the real guard, because the guard has its
// own copy of the scope rules. Nothing is deleted: the refusal happens at load time, before the
// guard patches any filesystem API.
{
  const base = path.join(ROOT, 'b3-production-guard');
  fs.mkdirSync(base, { recursive: true });
  const realNodeModules = path.join(FIXED_PROJECT_ROOT, 'node_modules');
  const quarantineTarget = path.join(FIXED_PROJECT_ROOT, '.m1-quarantine', 'node_modules');
  const refusals = [
    ['B3o the guard refuses the probe phase when node_modules is in the allowlist', { M1_INSTALL_PHASE: 'probe' }],
    ['B3p the guard refuses a non-node_modules project directory as an allowed root', { M1_INSTALL_PHASE: 'install', M1_INSTALL_ALLOWED_ROOTS: JSON.stringify([path.join(FIXED_PROJECT_ROOT, 'backend')]) }],
    ['B3q the guard refuses a filesystem-level broad allowed root', { M1_INSTALL_PHASE: 'install', M1_INSTALL_ALLOWED_ROOTS: JSON.stringify([path.parse(FIXED_PROJECT_ROOT).root]) }],
  ];
  for (const [label, overrides] of refusals) {
    const logPath = path.join(base, `${label.slice(0, 3)}.jsonl`);
    const stdoutPath = path.join(base, `${label.slice(0, 3)}.stdout.txt`);
    const stderrPath = path.join(base, `${label.slice(0, 3)}.stderr.txt`);
    const child = spawnToFiles(process.execPath, ['--require', GUARD_PATH, '-e', 'process.stdout.write("guard-must-not-run\\n")'], {
      env: {
        ...process.env,
        M1_INSTALL_DELETE_LOG: logPath,
        M1_INSTALL_DESCENDANT_LOG: `${logPath}.descendants.jsonl`,
        M1_INSTALL_MODE: 'production',
        M1_INSTALL_PROJECT_ROOT: FIXED_PROJECT_ROOT,
        M1_INSTALL_STABLE_ROOT: FIXED_STABLE_ROOT,
        M1_INSTALL_ALLOWED_ROOTS: JSON.stringify([realNodeModules]),
        M1_INSTALL_DENIED_ROOTS: JSON.stringify([quarantineTarget]),
        ...overrides,
      },
      stdoutPath,
      stderrPath,
    });
    const stderrText = fs.readFileSync(stderrPath, 'utf8');
    let refusal = null;
    try { refusal = JSON.parse(stderrText); } catch { refusal = null; }
    record(label, child.status === 78 && refusal && refusal.guard === 'refused' && refusal.log_written === false, { status: child.status, refusal });
    record(`${label.slice(0, 3)}-clean the refusal left no log file behind`, !fs.existsSync(logPath) && fs.readFileSync(stdoutPath, 'utf8').includes('guard-must-not-run') === false, { logExists: fs.existsSync(logPath) });
  }

  // Positive control: the same production configuration must LOAD when the phase is install, so
  // the refusals above cannot be explained by the guard failing for an unrelated reason.
  const acceptLog = path.join(base, 'accept.jsonl');
  const stdoutPath = path.join(base, 'accept.stdout.txt');
  const stderrPath = path.join(base, 'accept.stderr.txt');
  const accept = spawnToFiles(process.execPath, ['--require', GUARD_PATH, '-e', 'process.stdout.write("guard-loaded-child-ok\\n")'], {
    env: {
      ...process.env,
      M1_INSTALL_DELETE_LOG: acceptLog,
      M1_INSTALL_DESCENDANT_LOG: `${acceptLog}.descendants.jsonl`,
      M1_INSTALL_MODE: 'production',
      M1_INSTALL_PHASE: 'install',
      M1_INSTALL_PROJECT_ROOT: FIXED_PROJECT_ROOT,
      M1_INSTALL_STABLE_ROOT: FIXED_STABLE_ROOT,
      M1_INSTALL_ALLOWED_ROOTS: JSON.stringify([realNodeModules]),
      M1_INSTALL_DENIED_ROOTS: JSON.stringify([quarantineTarget]),
    },
    stdoutPath,
    stderrPath,
  });
  const acceptRecords = fs.existsSync(acceptLog) ? fs.readFileSync(acceptLog, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];
  const acceptSummary = acceptRecords.find((r) => r.event === 'summary');
  record('B3r the same configuration loads in the install phase (positive control)',
    accept.status === 0 && acceptRecords.some((r) => r.event === 'guard_start' && r.guard_loaded === true) && fs.readFileSync(stdoutPath, 'utf8').includes('guard-loaded-child-ok'),
    { status: accept.status, stderr: fs.readFileSync(stderrPath, 'utf8').slice(0, 300) });
  record('B3s the positive control deleted nothing', acceptSummary?.call_count === 0 && acceptSummary?.successful_deletion_calls === 0, { acceptSummary });
}

// ================= A4: preflight refusals create nothing at all ================================
// The verifier is invoked again as a child process with a root it must refuse. Both cases exit
// during the preflight, before any mkdir and before any scenario runs, so no recursive re-run and
// no filesystem write can happen.
{
  const selfPath = fileURLToPath(import.meta.url);
  const outsideRoot = path.join(path.dirname(FIXED_STABLE_ROOT), 'synthetic-a4-must-not-be-created');
  const insideProjectRoot = path.join(FIXED_PROJECT_ROOT, 'synthetic-a4-must-not-be-created');
  const fixedCheck = preflightFixedRoots();
  record('A4 the fixed stable root and the fixed project root pass preflight', fixedCheck.ok === true && fixedCheck.problems.length === 0, { fixedCheck });

  const cases = [
    ['A4a a root outside the fixed stable root is refused', outsideRoot, () => !fs.existsSync(outsideRoot)],
    ['A4b a root inside the fixed project root is refused', insideProjectRoot, () => !fs.existsSync(insideProjectRoot)],
    ['A4c an existing root is refused rather than reused or cleared', ROOT, () => fs.existsSync(ROOT) && fs.existsSync(path.join(ROOT, 'r1-happy'))],
  ];
  for (const [label, candidate, postCondition] of cases) {
    const stdoutPath = path.join(ROOT, `a4-${label.slice(0, 3)}.stdout.txt`);
    const stderrPath = path.join(ROOT, `a4-${label.slice(0, 3)}.stderr.txt`);
    const child = spawnToFiles(process.execPath, [selfPath, candidate], { env: process.env, stdoutPath, stderrPath });
    let refusal = null;
    try { refusal = JSON.parse(fs.readFileSync(stderrPath, 'utf8')); } catch { refusal = null; }
    record(label, child.status === 3 && refusal && refusal.created_anything === false && Array.isArray(refusal.refused) && refusal.refused.length > 0,
      { candidate, status: child.status, refusal });
    record(`${label.slice(0, 3)}-post the refusal left the filesystem as it was`, postCondition(), { candidate });
  }
}

// ================= A4d: nothing was written under the real project root ========================
{
  const after = realProjectState();
  record('A4d the real node_modules entry count is unchanged',
    after.node_modules_exists === REAL_STATE_BEFORE.node_modules_exists && after.node_modules_top_level === REAL_STATE_BEFORE.node_modules_top_level,
    { before: REAL_STATE_BEFORE.node_modules_top_level, after: after.node_modules_top_level });
  record('A4d the real node_modules directory mtime is unchanged',
    after.node_modules_mtime_ms === REAL_STATE_BEFORE.node_modules_mtime_ms,
    { before: REAL_STATE_BEFORE.node_modules_mtime_ms, after: after.node_modules_mtime_ms });
  record('A4d the real .m1-quarantine state is unchanged',
    after.quarantine_exists === REAL_STATE_BEFORE.quarantine_exists && after.quarantine_entries === REAL_STATE_BEFORE.quarantine_entries,
    { before: REAL_STATE_BEFORE, after });
  record('A4e the synthetic root is not inside the real project root', !isInside(ROOT, FIXED_PROJECT_ROOT), { ROOT, FIXED_PROJECT_ROOT });
  record('A4f every verifier-side cleanup deletion stayed inside the synthetic root',
    verifierCleanupDeletions.every((item) => isInside(item.path, ROOT)), { verifierCleanupDeletions });
  record('A4f this round added no new verifier-side cleanup deletions',
    verifierCleanupDeletions.length === 0, { verifierCleanupDeletions });
}

// ================= logDirectory scope (pure) ===================================================
// The step log is the only artifact a refusal might want to describe, so where it may live is part
// of the scope contract. These cases are pure: validateEnvironment never creates anything.
{
  const syntheticRoot = path.join(ROOT, 'logdir-scope');
  const projectRoot = path.join(syntheticRoot, 'project');
  const stableRoot = path.join(syntheticRoot, 'stable');
  const realNodeModules = path.join(FIXED_PROJECT_ROOT, 'node_modules');
  const quarantineTarget = path.join(FIXED_PROJECT_ROOT, '.m1-quarantine', 'node_modules');

  const syntheticBase = {
    mode: 'synthetic', projectRoot, stableRoot, syntheticRoot,
    allowedRoots: [path.join(projectRoot, 'node_modules')],
    deniedRoots: [path.join(projectRoot, '.m1-quarantine', 'node_modules')],
    quarantineTarget: path.join(projectRoot, '.m1-quarantine', 'node_modules'),
  };
  const cases = [
    ['L1 a synthetic log directory inside the synthetic root is accepted', { ...syntheticBase, logDir: path.join(syntheticRoot, 'logs') }, true],
    ['L2 a synthetic log directory outside the synthetic root is refused', { ...syntheticBase, logDir: path.join(FIXED_STABLE_ROOT, 'logdir-outside', 'logs') }, false],
    ['L3 a synthetic log directory inside the quarantine area is refused', { ...syntheticBase, logDir: path.join(projectRoot, '.m1-quarantine', 'logs') }, false],
    ['L4 a production log directory inside the fixed project .m1-evidence is accepted',
      { mode: 'production', projectRoot: FIXED_PROJECT_ROOT, stableRoot: FIXED_STABLE_ROOT, allowedRoots: [realNodeModules], deniedRoots: [quarantineTarget], quarantineTarget, logDir: path.join(FIXED_PROJECT_ROOT, '.m1-evidence', 'w5-exec-placeholder') }, true],
    ['L5 a production log directory elsewhere in the project is refused',
      { mode: 'production', projectRoot: FIXED_PROJECT_ROOT, stableRoot: FIXED_STABLE_ROOT, allowedRoots: [realNodeModules], deniedRoots: [quarantineTarget], quarantineTarget, logDir: path.join(FIXED_PROJECT_ROOT, 'logs') }, false],
    ['L6 a production log directory under the stable root is refused',
      { mode: 'production', projectRoot: FIXED_PROJECT_ROOT, stableRoot: FIXED_STABLE_ROOT, allowedRoots: [realNodeModules], deniedRoots: [quarantineTarget], quarantineTarget, logDir: path.join(FIXED_STABLE_ROOT, 'logs') }, false],
    ['L7 a production log directory inside the quarantine area is refused',
      { mode: 'production', projectRoot: FIXED_PROJECT_ROOT, stableRoot: FIXED_STABLE_ROOT, allowedRoots: [realNodeModules], deniedRoots: [quarantineTarget], quarantineTarget, logDir: path.join(FIXED_PROJECT_ROOT, '.m1-quarantine', 'logs') }, false],
  ];
  for (const [label, config, expectOk] of cases) {
    const verdict = validateEnvironment(config);
    record(label, verdict.ok === expectOk, { problems: verdict.problems, expected_ok: expectOk });
  }
  record('L8 the production log directory rule points at the fixed project, not at a caller-supplied root',
    validateEnvironment({ ...cases[3][1], fixedRoots: FIXED_ROOTS }).ok === true
      && validateEnvironment({ ...cases[3][1], logDir: path.join(FIXED_STABLE_ROOT, 'logdir-fake-project', '.m1-evidence', 'x') }).ok === false, {});
}

// ================= entry-point side-effect regression (real child process) =====================
// Called directly, with no CLI wrapper involved, a refused run must perform ZERO mkdir, ZERO file
// writes, ZERO child processes and ZERO moves. The counters are installed on the fs and
// child_process modules before the orchestrator is imported, and a liveness phase afterwards proves
// the same instrumentation does register a write and a spawn when they really happen.
{
  const base = path.join(ROOT, 'r13-entry-regression');
  fs.mkdirSync(base, { recursive: true });
  const fixturePath = path.join(base, 'entry-point-regression.mjs');
  const resultPath = path.join(base, 'entry-regression-result.json');
  const livenessDir = path.join(base, 'liveness');
  // probeNpmVersion writes its own stdout/stderr files, so the directory must already exist.
  fs.mkdirSync(livenessDir, { recursive: true });
  const orchestratorUrl = new URL('./run-isolated-node-install.mjs', import.meta.url).href;

  fs.writeFileSync(fixturePath, `import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cp = require('node:child_process');
const counters = {
  mkdirSync: 0, writeFileSync: 0, appendFileSync: 0, openSync: 0, openSyncWrite: 0, renameSync: 0,
  rmSync: 0, unlinkSync: 0, rmdirSync: 0, rm: 0, unlink: 0, rmdir: 0,
  spawn: 0, spawnSync: 0,
};
for (const name of ['mkdirSync', 'writeFileSync', 'appendFileSync', 'openSync', 'renameSync', 'rmSync', 'unlinkSync', 'rmdirSync', 'rm', 'unlink', 'rmdir']) {
  const original = fs[name];
  if (typeof original !== 'function') continue;
  fs[name] = function counted(...args) {
    counters[name] += 1;
    // A write-capable open is a write even though it is spelled openSync; a read-only open is not.
    if (name === 'openSync') {
      const flags = String(args[1] === undefined ? 'r' : args[1]);
      if (/[wa+]/.test(flags)) counters.openSyncWrite += 1;
    }
    return original.apply(fs, args);
  };
}
for (const name of ['spawn', 'spawnSync']) {
  const original = cp[name];
  if (typeof original !== 'function') continue;
  cp[name] = function counted(...args) { counters[name] += 1; return original.apply(cp, args); };
}
require('node:module').syncBuiltinESMExports();

const orchestrator = await import(${JSON.stringify(orchestratorUrl)});
const BASE = ${JSON.stringify(base)};
const snapshot = () => JSON.parse(JSON.stringify(counters));

let runnerCalls = 0;
let moverCalls = 0;
let inventoryCalls = 0;
const countingRunner = { kind: 'counting', run(args) { runnerCalls += 1; return { step: args.step, command: args.command, args: args.args, status: 0, signal: null, error: null }; } };
const countingMover = () => { moverCalls += 1; };
const countingInventory = () => { inventoryCalls += 1; return { root: 'stub', file_count: 0, total_bytes: 0, directory_count: 0, empty_directories: [], files: [], directories: [] }; };

function options(overrides) {
  return {
    mode: 'synthetic',
    projectRoot: path.join(BASE, 'case', 'project'),
    stableRoot: path.join(BASE, 'case', 'stable'),
    syntheticRoot: path.join(BASE, 'case'),
    nodeModulesPath: path.join(BASE, 'case', 'project', 'node_modules'),
    quarantineTarget: path.join(BASE, 'case', 'project', '.m1-quarantine', 'node_modules'),
    cacheDirs: { npm: path.join(BASE, 'case', 'stable', 'cache', 'npm'), electron: path.join(BASE, 'case', 'stable', 'cache', 'electron'), electronBuilder: path.join(BASE, 'case', 'stable', 'cache', 'electron-builder') },
    tmpDir: path.join(BASE, 'case', 'stable', 'tmp'),
    logDir: path.join(BASE, 'case', 'logs'),
    expectedPackageHashes: { 'package.json': 'deadbeef', 'package-lock.json': 'deadbeef' },
    commandRunner: countingRunner,
    npmInvocation: { command: process.execPath, args: ['-e', '0'] },
    electronInvocation: { command: process.execPath, args: ['-e', '0'] },
    inventoryBuilder: countingInventory,
    mover: countingMover,
    extraEnv: { M1_FIXTURE_ROOT: BASE },
    ...overrides,
  };
}

const results = {};

// Case 1: an illegal log directory (outside the synthetic root) must be refused with no side effects.
const before1 = snapshot();
results.illegalLogDir = orchestrator.runIsolatedInstall(options({ logDir: path.join(${JSON.stringify(FIXED_STABLE_ROOT)}, 'r13-logdir-must-not-be-created', 'logs') }));
results.illegalLogDirCounters = { before: before1, after: snapshot() };

// Case 2: a missing fixed root, injected in memory. The real fixed root is never touched.
const before2 = snapshot();
results.missingFixedRoot = orchestrator.runIsolatedInstall(options({
  fixedRoots: {
    projectRoot: path.join(BASE, 'absent-fixed-project'),
    stableRoot: path.join(BASE, 'absent-fixed-stable'),
  },
  syntheticRoot: path.join(BASE, 'absent-fixed-stable', 'synthetic'),
  projectRoot: path.join(BASE, 'absent-fixed-stable', 'synthetic', 'project'),
  stableRoot: path.join(BASE, 'absent-fixed-stable', 'synthetic', 'stable'),
  nodeModulesPath: path.join(BASE, 'absent-fixed-stable', 'synthetic', 'project', 'node_modules'),
  quarantineTarget: path.join(BASE, 'absent-fixed-stable', 'synthetic', 'project', '.m1-quarantine', 'node_modules'),
  cacheDirs: { npm: path.join(BASE, 'absent-fixed-stable', 'synthetic', 'stable', 'cache', 'npm'), electron: path.join(BASE, 'absent-fixed-stable', 'synthetic', 'stable', 'cache', 'electron'), electronBuilder: path.join(BASE, 'absent-fixed-stable', 'synthetic', 'stable', 'cache', 'electron-builder') },
  tmpDir: path.join(BASE, 'absent-fixed-stable', 'synthetic', 'stable', 'tmp'),
  logDir: path.join(BASE, 'absent-fixed-stable', 'synthetic', 'logs'),
}));
results.missingFixedRootCounters = { before: before2, after: snapshot() };
results.stubCallsAfterRefusals = { runnerCalls, moverCalls, inventoryCalls };

// Liveness phase: the same instrumentation must register a real write and a real spawn. This runs
// through the orchestrator's own probe helper, so it also proves the orchestrator uses the same
// (patched) modules the counters observe.
const before3 = snapshot();
results.liveness = orchestrator.probeNpmVersion({ execPath: process.execPath, npmCli: orchestrator.resolveNpmCli(), env: { ...process.env }, logDir: ${JSON.stringify(livenessDir)} });
results.livenessCounters = { before: before3, after: snapshot() };

fs.writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ results, countersAfterCapture: snapshot() }, null, 2), 'utf8');
`, 'utf8');

  const stdoutPath = path.join(base, 'entry-regression.stdout.txt');
  const stderrPath = path.join(base, 'entry-regression.stderr.txt');
  const child = spawnToFiles(process.execPath, [fixturePath], { env: process.env, stdoutPath, stderrPath });
  const output = fs.existsSync(resultPath) ? JSON.parse(fs.readFileSync(resultPath, 'utf8')) : null;
  record('R13 the entry-point regression fixture completed', child.status === 0 && output !== null,
    { status: child.status, stderr: fs.readFileSync(stderrPath, 'utf8').slice(0, 400) });

  // Every counter that could create, write or move anything, plus child-process creation. Measured
  // as a delta across the refused call, so instrumentation that fires for other reasons cannot mask
  // a real side effect (and read-only opens are reported separately rather than being ignored).
  const zeroKeys = ['mkdirSync', 'writeFileSync', 'appendFileSync', 'renameSync', 'rmSync', 'unlinkSync', 'rmdirSync', 'rm', 'unlink', 'rmdir', 'openSyncWrite', 'spawn', 'spawnSync'];
  const deltaOf = (counters) => Object.fromEntries(zeroKeys.map((key) => [key, counters.after[key] - counters.before[key]]));
  const nonzero = (deltas) => zeroKeys.filter((key) => deltas[key] !== 0);
  record('R13 an illegal log directory is refused before any mkdir/write/spawn/move',
    output?.results.illegalLogDir.ok === false
      && output.results.illegalLogDir.exitCode === EXIT.ENVIRONMENT_INVALID
      && output.results.illegalLogDir.log_written === false
      && output.results.illegalLogDir.stepsLog === null
      && output.results.illegalLogDir.refused_before_write === true
      && nonzero(deltaOf(output.results.illegalLogDirCounters)).length === 0,
    { refusal: output?.results.illegalLogDir && { exitCode: output.results.illegalLogDir.exitCode, log_written: output.results.illegalLogDir.log_written, problems: output.results.illegalLogDir.pre_write_problems }, deltas: output && deltaOf(output.results.illegalLogDirCounters), nonzero: output && nonzero(deltaOf(output.results.illegalLogDirCounters)) });
  record('R13 a missing fixed root is refused before any mkdir/write/spawn/move',
    output?.results.missingFixedRoot.ok === false
      && output.results.missingFixedRoot.exitCode === EXIT.ENVIRONMENT_INVALID
      && output.results.missingFixedRoot.log_written === false
      && output.results.missingFixedRoot.refused_before_write === true
      && (output.results.missingFixedRoot.fixed_root_problems || []).length === 2
      && nonzero(deltaOf(output.results.missingFixedRootCounters)).length === 0,
    { refusal: output?.results.missingFixedRoot && { exitCode: output.results.missingFixedRoot.exitCode, fixed_root_problems: output.results.missingFixedRoot.fixed_root_problems }, deltas: output && deltaOf(output.results.missingFixedRootCounters), nonzero: output && nonzero(deltaOf(output.results.missingFixedRootCounters)) });
  record('R13 the refusal path never reached the injected runner, mover or inventory builder',
    output?.results.stubCallsAfterRefusals.runnerCalls === 0
      && output.results.stubCallsAfterRefusals.moverCalls === 0
      && output.results.stubCallsAfterRefusals.inventoryCalls === 0,
    { stubCalls: output?.results.stubCallsAfterRefusals });
  record('R13 the instrumentation is live: a real probe does register a spawn and write-capable opens',
    output?.results.liveness.ok === true
      && output.results.livenessCounters.after.spawnSync > output.results.livenessCounters.before.spawnSync
      && output.results.livenessCounters.after.openSyncWrite > output.results.livenessCounters.before.openSyncWrite,
    { liveness: output?.results.liveness?.ok, spawnSyncDelta: output && output.results.livenessCounters.after.spawnSync - output.results.livenessCounters.before.spawnSync, openSyncWriteDelta: output && output.results.livenessCounters.after.openSyncWrite - output.results.livenessCounters.before.openSyncWrite });
  record('R13 the refusal left no directory behind, not even the illegal log directory',
    !fs.existsSync(path.join(FIXED_STABLE_ROOT, 'r13-logdir-must-not-be-created'))
      && !fs.existsSync(path.join(base, 'case'))
      && !fs.existsSync(path.join(base, 'absent-fixed-stable')),
    { entries: fs.readdirSync(base).sort() });
}


// ================= W7: Windows extended-length path compatibility ==============================
// Everything below targets exactly one defect: the guard judged a target passed in the Win32
// extended-length form (\\?\D:\...) as a different path from its ordinary drive form, so npm's
// legitimate removal of the approved node_modules root was blocked with exit 86.
//
// The real strings from that failure are used verbatim. No test in this group arms a deletion right
// over any real path: the guarded children always run with a synthetic allow/deny configuration,
// and the only deletions performed anywhere in this group are inside the fresh synthetic root.

// ---- E: path identity and scope decisions (orchestrator implementation, pure) -----------------
{
  const project = FIXED_PROJECT_ROOT;
  const nodeModules = path.join(project, 'node_modules');
  const EXT = '\\\\?\\';
  const extended = (value) => `${EXT}${value}`;

  // The exact string from the blocked record of the real run.
  const actualFailingString = '\\\\?\\D:\\hesan\\Desktop\\VSCODES\\FetchCV_Windows\\node_modules';
  record('E1 the actual failing string is the extended form of the real node_modules path',
    actualFailingString === extended(nodeModules), { actualFailingString, expected: extended(nodeModules) });
  record('E2 the actual failing string and the ordinary path share one identity',
    canonicalizePath(actualFailingString).ok === true
      && canonicalizePath(actualFailingString).identity === canonicalizePath(nodeModules).identity
      && canonicalizePath(actualFailingString).form === 'extended_drive'
      && canonicalizePath(nodeModules).form === 'drive',
    { extended: canonicalizePath(actualFailingString), plain: canonicalizePath(nodeModules) });
  record('E3 containment works from the extended form in both directions',
    isInside(actualFailingString, nodeModules) === true
      && isInside(actualFailingString, project) === true
      && isStrictlyInside(actualFailingString, project) === true,
    {});
  record('E4 the normalized result and the requested string are both preserved',
    (() => {
      const canonical = canonicalizePath(actualFailingString);
      return canonical.requested === actualFailingString && canonical.fs_path === nodeModules;
    })(), { canonical: canonicalizePath(actualFailingString) });

  // Audit dedup must collapse the two spellings of one file into a single key.
  record('E5 audit dedup treats the two spellings of one file as one path',
    normalizeAuditPath(`${nodeModules}\\pkg\\index.js`) === normalizeAuditPath(`${extended(nodeModules)}\\pkg\\index.js`)
      && descendantAuditKey(nodeModules, 'pkg/index.js\u0000file') === descendantAuditKey(extended(nodeModules), 'pkg/index.js\u0000file'),
    { plain: normalizeAuditPath(`${nodeModules}\\pkg\\index.js`), extended: normalizeAuditPath(`${extended(nodeModules)}\\pkg\\index.js`) });

  // Different directories with similar names must stay outside.
  record('E6 names that merely look similar are still outside the allowed root',
    isInside(path.join(project, 'node_modules-old'), nodeModules) === false
      && isInside(path.join(project, 'node_modules-evil'), nodeModules) === false
      && isInside(`${nodeModules}2`, nodeModules) === false
      && isInside(path.join(project, '.m1-quarantine', 'node_modules-2026-09-12T16-54-41-967Z'), nodeModules) === false,
    {});
  record('E7 the project itself is not inside node_modules and external paths stay outside',
    isInside(project, nodeModules) === false
      && isInside(path.join(project, 'src'), nodeModules) === false
      && isInside('D:\\somewhere-else\\node_modules', nodeModules) === false,
    {});

  // Unsupported namespaces never gain permission, in either spelling.
  const refused = [
    ['\\\\.\\GLOBALROOT\\Device\\HarddiskVolume1', 'device'],
    ['\\\\?\\GLOBALROOT\\Device\\HarddiskVolume1', 'device'],
    ['\\\\?\\Volume{12345678-1234-1234-1234-123456789abc}\\', 'device'],
    ['\\\\?\\UNC\\server\\share\\node_modules', 'unc'],
    ['\\\\server\\share\\node_modules', 'unc'],
  ];
  for (const [value, namespace] of refused) {
    const canonical = canonicalizePath(value);
    record(`E8 ${namespace} path form is refused and is inside nothing: ${value.slice(0, 28)}...`,
      canonical.ok === false && canonical.namespace === namespace && Boolean(canonical.reason)
        && isInside(value, nodeModules) === false && isInside(value, path.join(project, 'node_modules')) === false,
      { canonical });
  }
  record('E9 extended forms that cannot be proven equivalent are refused',
    canonicalizePath(`${EXT}D:\\hesan\\..\\Windows`).ok === false
      && String(canonicalizePath(`${EXT}D:\\hesan\\..\\Windows`).reason).includes('relative component')
      && canonicalizePath(`${EXT}D:\\a\\b.`).ok === false
      && String(canonicalizePath(`${EXT}D:\\a\\b.`).reason).includes('trailing dot or space')
      && canonicalizePath(`${EXT}relative\\path`).ok === false
      && canonicalizePath(`${EXT}D:`).ok === true
      && canonicalizePath(`${EXT}D:`).identity === path.resolve('D:\\').toLowerCase(),
    {
      relative: canonicalizePath(`${EXT}D:\\hesan\\..\\Windows`),
      trailing: canonicalizePath(`${EXT}D:\\a\\b.`),
      relativeNoDrive: canonicalizePath(`${EXT}relative\\path`),
      bareDrive: canonicalizePath(`${EXT}D:`),
    });

  // Scope decisions are identical for equivalent spellings; nothing is widened.
  const syntheticRoot = path.join(ROOT, 'w7-path-identity');
  const syntheticProject = path.join(syntheticRoot, 'project');
  const syntheticStable = path.join(syntheticRoot, 'stable');
  const syntheticBase = {
    mode: 'synthetic', projectRoot: syntheticProject, stableRoot: syntheticStable, syntheticRoot,
    allowedRoots: [path.join(syntheticProject, 'node_modules')],
    deniedRoots: [path.join(syntheticProject, '.m1-quarantine', 'node_modules')],
    quarantineTarget: path.join(syntheticProject, '.m1-quarantine', 'node_modules'),
  };
  record('E10 a legitimate extended-length log directory is accepted exactly like its ordinary form',
    validateEnvironment({ ...syntheticBase, logDir: path.join(syntheticRoot, 'logs') }).ok === true
      && validateEnvironment({ ...syntheticBase, logDir: extended(path.join(syntheticRoot, 'logs')) }).ok === true,
    { plain: validateEnvironment({ ...syntheticBase, logDir: path.join(syntheticRoot, 'logs') }).problems, extended: validateEnvironment({ ...syntheticBase, logDir: extended(path.join(syntheticRoot, 'logs')) }).problems });
  record('E11 the extended-length quarantine area is refused exactly like its ordinary form',
    validateEnvironment({ ...syntheticBase, allowedRoots: [path.join(syntheticProject, '.m1-quarantine', 'node_modules')] }).ok === false
      && validateEnvironment({ ...syntheticBase, allowedRoots: [extended(path.join(syntheticProject, '.m1-quarantine', 'node_modules'))] }).ok === false,
    {});
  record('E12 an extended-length protected directory is refused exactly like its ordinary form',
    validateEnvironment({ ...syntheticBase, allowedRoots: [path.join(syntheticProject, 'src')] }).ok === false
      && validateEnvironment({ ...syntheticBase, allowedRoots: [extended(path.join(syntheticProject, 'src'))] }).ok === false,
    {});
  record('E13 unsupported forms are refused by the configuration validator in either spelling',
    validateEnvironment({ ...syntheticBase, logDir: '\\\\?\\UNC\\server\\share\\logs' }).ok === false
      && validateEnvironment({ ...syntheticBase, logDir: '\\\\.\\GLOBALROOT\\Device\\HarddiskVolume1\\logs' }).ok === false
      && validateEnvironment({ ...syntheticBase, allowedRoots: ['\\\\?\\UNC\\server\\share\\nm'] }).ok === false,
    {});
  record('E14 a production configuration still requires the fixed roots, in either spelling',
    validateEnvironment({
      mode: 'production', projectRoot: FIXED_PROJECT_ROOT, stableRoot: FIXED_STABLE_ROOT,
      allowedRoots: [extended(nodeModules)], deniedRoots: [path.join(FIXED_PROJECT_ROOT, '.m1-quarantine', 'node_modules')],
      quarantineTarget: path.join(FIXED_PROJECT_ROOT, '.m1-quarantine', 'node_modules'),
      logDir: extended(path.join(FIXED_PROJECT_ROOT, '.m1-evidence', 'w7-placeholder')),
    }).ok === true
      && validateEnvironment({
        mode: 'production', projectRoot: extended(path.join(FIXED_STABLE_ROOT, 'not-the-project')), stableRoot: FIXED_STABLE_ROOT,
        allowedRoots: [nodeModules], deniedRoots: [path.join(FIXED_PROJECT_ROOT, '.m1-quarantine', 'node_modules')],
      }).ok === false,
    {});

  // Ancestor validation must handle the extended form rather than failing on it.
  const ancestorDir = path.join(ROOT, 'w7-path-identity');
  record('E15 ancestor validation accepts an extended-length target and refuses a device form',
    validateTargetAncestors([extended(path.join(ancestorDir, 'not-created-yet'))]).ok === true
      && validateTargetAncestors(['\\\\.\\GLOBALROOT\\Device\\HarddiskVolume1\\x']).ok === false
      && validateTargetAncestors(['\\\\?\\UNC\\server\\share\\x']).ok === false,
    { extendedTarget: validateTargetAncestors([extended(path.join(ancestorDir, 'not-created-yet'))]).problems, device: validateTargetAncestors(['\\\\.\\GLOBALROOT\\Device\\HarddiskVolume1\\x']).problems });
}

// ---- EG: the same checks against the guard's own implementation, in a guarded child -----------
// The child runs with a synthetic allow/deny configuration that points at paths under the fixed
// stable root, so no real path ever carries a deletion right. Only pure functions are called.
{
  const base = path.join(ROOT, 'w7-guard-path-identity');
  fs.mkdirSync(base, { recursive: true });
  const guardSynthetic = path.join(base, 'synthetic');
  const guardProject = path.join(guardSynthetic, 'project');
  const guardAllowed = path.join(guardProject, 'node_modules');
  const guardDenied = path.join(guardProject, '.m1-quarantine', 'node_modules');
  // The guard preflights its configured stable/project roots before loading, so the synthetic ones
  // it is pointed at must exist. Nothing is created outside this fresh synthetic directory.
  fs.mkdirSync(guardProject, { recursive: true });
  const resultPath = path.join(base, 'guard-path-identity.json');
  const childStdout = path.join(base, 'child.stdout.txt');
  const childStderr = path.join(base, 'child.stderr.txt');

  const nodeModules = path.join(FIXED_PROJECT_ROOT, 'node_modules');
  const actualFailingString = '\\\\?\\D:\\hesan\\Desktop\\VSCODES\\FetchCV_Windows\\node_modules';
  const guardInputs = {
    nodeModules,
    actualFailingString,
    allowed: guardAllowed,
    denied: guardDenied,
    similar: [
      path.join(FIXED_PROJECT_ROOT, 'node_modules-old'),
      path.join(FIXED_PROJECT_ROOT, 'src'),
      'D:\\somewhere-else\\node_modules',
    ],
    unsupported: [
      '\\\\.\\GLOBALROOT\\Device\\HarddiskVolume1',
      '\\\\?\\GLOBALROOT\\Device\\HarddiskVolume1',
      '\\\\?\\Volume{12345678-1234-1234-1234-123456789abc}\\',
      '\\\\?\\UNC\\server\\share\\node_modules',
      '\\\\server\\share\\node_modules',
    ],
  };

  const child = spawnToFiles(process.execPath, ['--require', GUARD_PATH, '-e', `
    const fs = require('node:fs');
    const path = require('node:path');
    const guard = require(${JSON.stringify(GUARD_PATH)});
    // Built from character codes so no escaping layer can corrupt the prefix.
    const EXT = String.fromCharCode(92, 92, 63, 92);
    const ext = (value) => EXT + value;
    const INPUT = JSON.parse(${JSON.stringify(JSON.stringify(guardInputs))});
    const classify = (value) => { const verdict = guard.classify(value); return { verdict: verdict.verdict, form: verdict.form, reason: verdict.reason, resolved: verdict.resolved, requested: verdict.requested }; };
    const out = {
      actual_identity: guard.canonicalizePath(INPUT.actualFailingString).identity,
      plain_identity: guard.canonicalizePath(INPUT.nodeModules).identity,
      actual_form: guard.canonicalizePath(INPUT.actualFailingString).form,
      actual_requested: guard.canonicalizePath(INPUT.actualFailingString).requested,
      actual_fs_path: guard.canonicalizePath(INPUT.actualFailingString).fs_path,
      inside_from_extended: guard.isInside(INPUT.actualFailingString, INPUT.nodeModules),
      dedup_key_equal: guard.normalizeAuditPath(path.join(INPUT.nodeModules, 'pkg', 'i.js')) === guard.normalizeAuditPath(path.join(ext(INPUT.nodeModules), 'pkg', 'i.js')),
      descendant_key_equal: guard.descendantAuditKey(INPUT.nodeModules, 'pkg/i.js' + String.fromCharCode(0) + 'file') === guard.descendantAuditKey(ext(INPUT.nodeModules), 'pkg/i.js' + String.fromCharCode(0) + 'file'),
      allowed_plain: guard.classify(INPUT.allowed).verdict,
      allowed_extended: guard.classify(ext(INPUT.allowed)).verdict,
      denied_plain: guard.classify(INPUT.denied).verdict,
      denied_extended: guard.classify(ext(INPUT.denied)).verdict,
      similar_verdicts: INPUT.similar.map((value) => ({ value, verdict: guard.classify(value).verdict })),
      unsupported_verdicts: INPUT.unsupported.map((value) => classify(value)),
      unsupported_inside: INPUT.unsupported.map((value) => guard.isInside(value, INPUT.nodeModules)),
    };
    fs.writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify(out, null, 2), 'utf8');
  `], {
    env: {
      ...process.env,
      M1_INSTALL_DELETE_LOG: path.join(base, 'guard.jsonl'),
      M1_INSTALL_DESCENDANT_LOG: path.join(base, 'guard.descendants.jsonl'),
      M1_INSTALL_MODE: 'synthetic',
      M1_INSTALL_PROJECT_ROOT: guardProject,
      M1_INSTALL_STABLE_ROOT: guardSynthetic,
      M1_INSTALL_SYNTHETIC_ROOT: guardSynthetic,
      M1_INSTALL_ALLOWED_ROOTS: JSON.stringify([guardAllowed]),
      M1_INSTALL_DENIED_ROOTS: JSON.stringify([guardDenied]),
    },
    stdoutPath: childStdout,
    stderrPath: childStderr,
  });

  const guardOut = fs.existsSync(resultPath) ? JSON.parse(fs.readFileSync(resultPath, 'utf8')) : null;
  record('EG1 the guard child completed with a synthetic-only configuration',
    child.status === 0 && guardOut !== null,
    { status: child.status, stderr: fs.readFileSync(childStderr, 'utf8').slice(0, 300) });
  record('EG2 the guard gives the actual failing string the same identity as the ordinary path',
    guardOut !== null
      && guardOut.actual_identity === guardOut.plain_identity
      && guardOut.actual_form === 'extended_drive'
      && guardOut.actual_requested === actualFailingString
      && guardOut.actual_fs_path === nodeModules,
    { actual_identity: guardOut?.actual_identity, plain_identity: guardOut?.plain_identity, form: guardOut?.actual_form });
  record('EG3 the guard agrees with the orchestrator on identity, containment and dedup keys',
    guardOut !== null
      && guardOut.actual_identity === canonicalizePath(actualFailingString).identity
      && guardOut.inside_from_extended === true
      && guardOut.dedup_key_equal === true
      && guardOut.descendant_key_equal === true,
    { guard: guardOut && { identity: guardOut.actual_identity, inside: guardOut.inside_from_extended, dedup: guardOut.dedup_key_equal } });
  record('EG4 the guard allows the extended form of an allowed root exactly like the ordinary form',
    guardOut !== null && guardOut.allowed_plain === 'allowed' && guardOut.allowed_extended === 'allowed',
    { plain: guardOut?.allowed_plain, extended: guardOut?.allowed_extended });
  record('EG5 the guard denies the extended form of the quarantine area exactly like the ordinary form',
    guardOut !== null && guardOut.denied_plain === 'denied' && guardOut.denied_extended === 'denied',
    { plain: guardOut?.denied_plain, extended: guardOut?.denied_extended });
  record('EG6 the guard still refuses project originals, external paths and similar names',
    Array.isArray(guardOut?.similar_verdicts) && guardOut.similar_verdicts.length === 3
      && guardOut.similar_verdicts.every((item) => item.verdict === 'out_of_scope'),
    { similar: guardOut?.similar_verdicts });
  record('EG7 the guard gives UNC and device namespaces no permission in either spelling',
    Array.isArray(guardOut?.unsupported_verdicts) && guardOut.unsupported_verdicts.length === 5
      && guardOut.unsupported_verdicts.every((item) => item.verdict === 'unsupported_path_form' && Boolean(item.reason))
      && Array.isArray(guardOut?.unsupported_inside) && guardOut.unsupported_inside.every((value) => value === false),
    { unsupported: guardOut?.unsupported_verdicts });
}

// ---- R14: real subprocess, real guard, deletions only inside the fresh synthetic root ---------
{
  const base = path.join(ROOT, 'r14-extended-path-removal');
  fs.mkdirSync(base, { recursive: true });
  const allowedRoot = path.join(base, 'allowed');
  const deniedRoot = path.join(base, 'denied');
  const tree = path.join(allowedRoot, 'tree');
  const protectedFile = path.join(deniedRoot, 'protected.txt');
  fs.mkdirSync(allowedRoot, { recursive: true });
  fs.mkdirSync(deniedRoot, { recursive: true });

  const logFile = path.join(base, 'guard.jsonl');
  const descendants = path.join(base, 'guard.descendants.jsonl');
  const childEnv = {
    ...process.env,
    M1_INSTALL_DELETE_LOG: logFile,
    M1_INSTALL_DESCENDANT_LOG: descendants,
    M1_INSTALL_MODE: 'synthetic',
    M1_INSTALL_PROJECT_ROOT: base,
    M1_INSTALL_STABLE_ROOT: base,
    M1_INSTALL_SYNTHETIC_ROOT: base,
    M1_INSTALL_ALLOWED_ROOTS: JSON.stringify([allowedRoot]),
    M1_INSTALL_DENIED_ROOTS: JSON.stringify([deniedRoot]),
  };

  // Child 1: build its own tree, remove it through the extended-length form with the callback API,
  // then re-issue the same logical target in the ordinary form (a no-op) to prove the two spellings
  // dedup to one target.
  const result1 = path.join(base, 'child1.result.json');
  const r14Paths = { tree, result: result1 };
  const child1 = spawnToFiles(process.execPath, ['--require', GUARD_PATH, '-e', `
    const fs = require('node:fs');
    const path = require('node:path');
    const guard = require(${JSON.stringify(GUARD_PATH)});
    const P = JSON.parse(${JSON.stringify(JSON.stringify(r14Paths))});
    const EXT = String.fromCharCode(92, 92, 63, 92);
    const tree = P.tree;
    fs.mkdirSync(path.join(tree, 'a'), { recursive: true });
    fs.mkdirSync(path.join(tree, 'b', 'c'), { recursive: true });
    fs.writeFileSync(path.join(tree, 'a', 'one.txt'), '1');
    fs.writeFileSync(path.join(tree, 'b', 'c', 'two.txt'), '2');
    fs.writeFileSync(path.join(tree, 'top.txt'), '3');
    const before = guard.readTree(tree);
    const extended = EXT + tree;
    fs.rm(extended, { recursive: true }, (error) => {
      if (error) {
        fs.writeFileSync(P.result, JSON.stringify({ step: 'extended_rm', error_code: error.code }), 'utf8');
        process.exit(9);
      }
      // Same logical target, ordinary spelling, now absent: must be a no-op, not a second target.
      fs.rm(tree, { recursive: true, force: true }, (secondError) => {
        fs.writeFileSync(P.result, JSON.stringify({
          step: 'done',
          extended_used: extended,
          before_entries: before.entries,
          after_exists: fs.existsSync(tree),
          second_error_code: secondError ? secondError.code : null,
        }), 'utf8');
      });
    });
  `], { env: childEnv, stdoutPath: path.join(base, 'child1.stdout.txt'), stderrPath: path.join(base, 'child1.stderr.txt') });

  const child1Out = fs.existsSync(result1) ? JSON.parse(fs.readFileSync(result1, 'utf8')) : null;
  record('R14 the extended-length recursive removal via the callback API succeeded',
    child1.status === 0 && child1Out?.step === 'done' && child1Out.after_exists === false,
    { status: child1.status, child1Out, stderr: fs.readFileSync(path.join(base, 'child1.stderr.txt'), 'utf8').slice(0, 300) });
  record('R14 the tree really existed with the expected shape before the removal',
    Array.isArray(child1Out?.before_entries) && child1Out.before_entries.length === 6,
    { before_entries: child1Out?.before_entries });

  const records1 = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];
  const deleted1 = records1.filter((r) => r.event === 'deleted');
  const noops1 = records1.filter((r) => r.event === 'noop');
  const internal1 = records1.filter((r) => r.event === 'internal_step');
  const blocked1 = records1.filter((r) => r.event === 'blocked');
  const summary1 = records1.find((r) => r.event === 'summary');
  const extendedRecord = deleted1.find((r) => r.recursive === true);

  record('R14 the removal was recorded as allowed, with both spellings kept for review',
    blocked1.length === 0 && deleted1.length === 1 && extendedRecord?.resolved === tree
      && extendedRecord?.requested === `\\\\?\\${tree}`
      && extendedRecord?.canonical_identity === tree.toLowerCase()
      && extendedRecord?.outcome === 'recursive_all_gone'
      && extendedRecord?.confirmed_paths_gone === 6,
    { deleted: deleted1.map((r) => ({ requested: r.requested, resolved: r.resolved, outcome: r.outcome, gone: r.confirmed_paths_gone })) });
  record('R14 the internal steps of the extended-form removal were recognised, not blocked',
    internal1.length > 0 && internal1.every((r) => r.associated_root === tree),
    { internal_count: internal1.length, associated_roots: [...new Set(internal1.map((r) => r.associated_root))] });
  record('R14 the second call on the same logical target in the ordinary form is a no-op',
    noops1.length === 1 && child1Out?.second_error_code === null,
    { noop: noops1.map((r) => ({ requested: r.requested, resolved: r.resolved, outcome: r.outcome })) });
  record('R14 the two spellings dedup to a single deletion target',
    summary1?.distinct_deletion_targets_attempted === 1
      && summary1?.call_count === 2
      && summary1?.distinct_deletion_target_paths_gone === 1,
    { summary: summary1 && { call_count: summary1.call_count, attempted: summary1.distinct_deletion_targets_attempted, targets_gone: summary1.distinct_deletion_target_paths_gone } });

  const descendantLines1 = fs.existsSync(descendants) ? fs.readFileSync(descendants, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];
  const preDeletion1 = descendantLines1.filter((l) => l.phase === 'pre_deletion');
  const confirmed1 = descendantLines1.filter((l) => l.phase !== 'pre_deletion');
  record('R14 the pre-deletion listing and the confirmed-gone list are persisted in the ordinary form',
    // Both recursive calls persist a pre-deletion listing (the second call finds an absent target,
    // so its listing is empty); only the successful removal has a confirmed-gone list.
    preDeletion1.length === 2
      && preDeletion1[0].count === 6 && preDeletion1[0].resolved === tree && preDeletion1[0].requested === `\\\\?\\${tree}`
      && preDeletion1[1].count === 0 && preDeletion1[1].requested === tree
      && confirmed1.length === 1 && confirmed1[0].resolved === tree && confirmed1[0].count === 6,
    { preDeletion: preDeletion1.map((l) => ({ requested: l.requested, resolved: l.resolved, count: l.count })), confirmed: confirmed1.map((l) => ({ resolved: l.resolved, count: l.count })) });

  const rollup14 = summarizeDeletionLogs({ logPath: logFile, descendantPath: descendants });
  // No log line may keep the extended spelling as its resolved path or identity.
  const allRecordedPaths = [...records1, ...descendantLines1].flatMap((r) => [r.resolved, r.canonical_identity, r.associated_root]).filter(Boolean);
  record('R14 the cross-PID rollup counts the extended-form removal exactly once per path',
    rollup14.run.processes === 1 && rollup14.cross_check_mismatches.length === 0
      && rollup14.run.distinct_descendant_paths_gone === 6
      && rollup14.run.distinct_deletion_target_paths_gone === 1
      && rollup14.run.distinct_confirmed_paths_gone === 7,
    { run: rollup14.run, mismatches: rollup14.cross_check_mismatches });
  record('R14 no recorded path keeps the extended spelling once it has been canonicalized',
    allRecordedPaths.length > 0 && allRecordedPaths.every((value) => !String(value).startsWith('\\\\?\\')),
    { sample: allRecordedPaths.slice(0, 4), extended_count: allRecordedPaths.filter((value) => String(value).startsWith('\\\\?\\')).length });

  // Child 2: a protected file inside the DENIED area, accessed through the extended-length form,
  // must still be blocked and must survive.
  const before2 = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
  const child2Inputs = { protectedFile, unexpected: path.join(base, 'child2.unexpected.json') };
  const child2 = spawnToFiles(process.execPath, ['--require', GUARD_PATH, '-e', `
    const fs = require('node:fs');
    const path = require('node:path');
    const P = JSON.parse(${JSON.stringify(JSON.stringify(child2Inputs))});
    const EXT = String.fromCharCode(92, 92, 63, 92);
    fs.mkdirSync(path.dirname(P.protectedFile), { recursive: true });
    fs.writeFileSync(P.protectedFile, 'must survive', 'utf8');
    fs.unlinkSync(EXT + P.protectedFile);
    fs.writeFileSync(P.unexpected, 'reached', 'utf8');
  `], { env: childEnv, stdoutPath: path.join(base, 'child2.stdout.txt'), stderrPath: path.join(base, 'child2.stderr.txt') });

  const records2 = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').slice(before2.length).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];
  const blocked2 = records2.filter((r) => r.event === 'blocked');
  record('R14 the protected file accessed through the extended form is still blocked',
    child2.status === EXIT.GUARD_BLOCKED && blocked2.length === 1
      && blocked2[0].verdict === 'denied'
      && blocked2[0].requested === `\\\\?\\${protectedFile}`
      && blocked2[0].resolved === protectedFile
      && blocked2[0].canonical_identity === protectedFile.toLowerCase(),
    { status: child2.status, blocked: blocked2 });
  record('R14 the blocked attempt left the protected file untouched and never reached the next statement',
    fs.existsSync(protectedFile) && fs.readFileSync(protectedFile, 'utf8') === 'must survive'
      && !fs.existsSync(path.join(base, 'child2.unexpected.json')),
    { exists: fs.existsSync(protectedFile) });
  record('R14 the blocked diagnostic carries a bounded caller stack and no environment data',
    Array.isArray(blocked2[0]?.caller_stack) && blocked2[0].caller_stack.length > 0
      && blocked2[0].caller_stack.length <= 12
      && String(blocked2[0].caller_stack_note).includes('no environment'),
    { stack: blocked2[0]?.caller_stack, note: blocked2[0]?.caller_stack_note });

  // Every deletion in this group stayed inside the fresh synthetic root.
  const allDeleted = [...deleted1, ...records2.filter((r) => r.event === 'deleted')].map((r) => r.resolved.toLowerCase());
  record('R14 every deletion performed by this group stayed inside the fresh synthetic root',
    allDeleted.length > 0
      && allDeleted.every((value) => value.startsWith(base.toLowerCase()))
      && fs.existsSync(deniedRoot) === true,
    { allDeleted: [...new Set(allDeleted)], base, denied_root_still_exists: fs.existsSync(deniedRoot) });
}


// ---- report -----------------------------------------------------------------------------------
const passed = results.filter((item) => item.passed).length;
const report = {
  synthetic_root: ROOT,
  generated_at: new Date().toISOString(),
  total: results.length,
  passed,
  failed: results.length - passed,
  fixed_project_root: FIXED_PROJECT_ROOT,
  fixed_stable_root: FIXED_STABLE_ROOT,
  real_project_state_before: REAL_STATE_BEFORE,
  real_project_state_after: realProjectState(),
  // The verifier process is not guarded. These are the only deletions it performed, all inside the
  // synthetic root; they appear in no guard log by construction.
  verifier_side_cleanup_deletions: verifierCleanupDeletions,
  verifier_side_deletion_count: verifierCleanupDeletions.length,
  guard_coverage_limitation: 'The guard intercepts the in-process Node fs API only. CPython and native child processes that do not inherit the guard are not covered, so a clean run cannot prove that zero deletions happened anywhere.',
  results,
};
const reportPath = path.join(ROOT, 'synthetic-subprocess-report.json');
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ report: reportPath, total: report.total, passed: report.passed, failed: report.failed }, null, 2)}\n`);
process.exit(report.failed === 0 ? 0 : 1);
