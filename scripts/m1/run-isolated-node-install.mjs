#!/usr/bin/env node
// M1 W4 subprocess-fix: isolated Node install orchestrator.
//
// This module contains the real orchestration, including real subprocess construction. It is not
// a plan. What this round does NOT do is invoke it against the real project: the execute path is
// reached only through an explicit switch, and without that switch the tool exits non-zero.
//
// Modes
//   --mode=dry-run    (default) verify environment, resolve tooling, inventory node_modules. No mutation.
//   --mode=execute    the real flow. Requires --i-understand-this-mutates. Non-zero exit without it.
//
// What has been verified this round is the synthetic path, which drives the SAME orchestration with
// a confined fixture command runner that crosses a real process boundary. Real installation has NOT
// been run and is NOT claimed to have passed.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const GUARD_PATH = path.join(__dirname, 'guard-install-deletions.cjs');

// Audited constants. These are the reviewed values, NOT read from disk and then treated as the
// expectation. Reading a value and immediately comparing it to itself would prove nothing.
export const FIXED_PROJECT_ROOT = 'D:\\hesan\\Desktop\\VSCODES\\FetchCV_Windows';
export const FIXED_STABLE_ROOT = 'D:\\hesan\\Desktop\\VSCODES\\FetchCV_M1_work\\20260910-235136';
export const AUDITED_PACKAGE_HASHES = Object.freeze({
  'package.json': 'fe771d3a804358bf248fe8ba652110fcb5a58b5b0604f33fdf41786d577a0b84',
  'package-lock.json': 'e640fd2b15d9f575ebcddd6817ce5b327cd7efe34d04a148940f62afa8240fbc',
});
export const KEY_DEPENDENCIES = ['electron', 'electron-builder', 'electron-winstaller', 'playwright', 'playwright-core'];
export const EXPECTED_VERSIONS = Object.freeze({ electron: '43.1.1', 'electron-builder': '26.15.3' });

// The fixed roots as a single injectable object. Production always uses these exact values; the
// injection point exists so the entry-point regressions can exercise a missing fixed root entirely
// in memory, without ever moving or renaming the real fixed root.
export const FIXED_ROOTS = Object.freeze({
  projectRoot: FIXED_PROJECT_ROOT,
  stableRoot: FIXED_STABLE_ROOT,
});

export const EXIT = {
  OK: 0,
  REFUSED_NO_SWITCH: 64,
  ENVIRONMENT_INVALID: 65,
  INVENTORY_INCOMPLETE: 66,
  QUARANTINE_MISMATCH: 67,
  PACKAGE_HASH_CHANGED: 68,
  COMMAND_FAILED: 69,
  VERIFICATION_FAILED: 70,
  TOOLING_UNAVAILABLE: 71,
  GUARD_PROBE_FAILED: 72,
  GUARD_BLOCKED: 86,
};

export function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function sha256Text(value) {
  return createHash('sha256').update(Buffer.from(String(value), 'utf8')).digest('hex');
}

// ---------------------------------------------------------------------------------------------
// Path identity (kept identical to the guard's implementation)
// ---------------------------------------------------------------------------------------------
// The guard is a CJS preload that cannot be imported without executing it, so this rule is
// duplicated here on purpose. The two implementations are cross-checked against each other by the
// targeted tests, so a divergence would be caught rather than assumed away.
//
// SUPPORTED: ordinary drive paths (D:\a\b) and the explicitly equivalent extended-length drive
// form (\\?\D:\a\b) -> one shared identity (lowercase, resolved).
// REFUSED, never converted into an ordinary path and allowed: \\.\ device namespaces,
// \\?\GLOBALROOT, \\?\Volume{...}, \\?\UNC\..., plain \\server\share UNC, and any extended form
// that cannot be proven equivalent (no drive letter, '.'/'..' segment, trailing dot or space).
export function canonicalizePath(requested) {
  const raw = requested === undefined || requested === null ? '' : String(requested);
  const result = { requested: raw, ok: false, identity: null, fs_path: null, form: 'unknown', namespace: 'unknown', reason: null };
  const refuse = (reason, form, namespace) => {
    result.reason = reason;
    result.form = form;
    result.namespace = namespace;
    return result;
  };
  if (raw.trim() === '') return refuse('empty path', 'empty', 'none');
  if (raw.startsWith('\\\\.\\')) return refuse(`device namespace paths are refused: ${raw}`, 'device_namespace', 'device');

  let body = raw;
  let form = 'drive';
  if (raw.startsWith('\\\\?\\')) {
    body = raw.slice(4);
    form = 'extended_drive';
    if (/^GLOBALROOT([\\/]|$)/i.test(body)) return refuse(`GLOBALROOT device paths are refused: ${raw}`, 'device_namespace', 'device');
    if (/^Volume\{/i.test(body)) return refuse(`volume device paths are refused: ${raw}`, 'extended_volume', 'device');
    if (/^UNC([\\/])/i.test(body)) return refuse(`UNC paths are refused (no network share delete rights): ${raw}`, 'extended_unc', 'unc');
    if (!/^[A-Za-z]:([\\/]|$)/.test(body)) return refuse(`extended path is not a drive-absolute path and cannot be proven equivalent: ${raw}`, 'extended_unknown', 'unknown');
    // '\\?\D:' names the volume root, not the process's current directory on D:, so a bare drive
    // letter is completed to its root before the ordinary normalization runs.
    if (/^[A-Za-z]:$/.test(body)) body = `${body}\\`;
    const components = body.split(/[\\/]+/).slice(1).filter((part) => part !== '');
    if (components.some((part) => part === '.' || part === '..')) {
      return refuse(`extended path contains a relative component, which is not equivalent in the two namespaces: ${raw}`, form, 'drive');
    }
    if (components.some((part) => /[ .]$/.test(part))) {
      return refuse(`extended path contains a component with a trailing dot or space, which is not equivalent in the two namespaces: ${raw}`, form, 'drive');
    }
  } else if (/^\\\\/.test(raw)) {
    return refuse(`UNC paths are refused (no network share delete rights): ${raw}`, 'unc', 'unc');
  }

  const resolved = path.resolve(body);
  result.identity = resolved.toLowerCase();
  result.fs_path = resolved;
  result.form = form;
  result.namespace = 'drive';
  result.ok = true;
  return result;
}

export function isInside(child, root) {
  const childCanonical = canonicalizePath(child);
  const rootCanonical = canonicalizePath(root);
  if (!childCanonical.ok || !rootCanonical.ok) return false;
  const rel = path.relative(rootCanonical.identity, childCanonical.identity);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

export function isStrictlyInside(child, root) {
  const childCanonical = canonicalizePath(child);
  const rootCanonical = canonicalizePath(root);
  if (!childCanonical.ok || !rootCanonical.ok) return false;
  return childCanonical.identity !== rootCanonical.identity && isInside(childCanonical.identity, rootCanonical.identity);
}

// ---------------------------------------------------------------------------------------------
// Tooling resolution
// ---------------------------------------------------------------------------------------------

// `npm` on this machine resolves to D:\Nodev\npm.ps1, which cannot be spawned directly. The
// launcher therefore must use process.execPath together with the resolved npm CLI entry point.
export function resolveNpmCli(execPath = process.execPath) {
  const nodeDir = path.dirname(execPath);
  const candidates = [
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return path.resolve(candidate);
    } catch {
      // keep looking
    }
  }
  return null;
}

// NODE_OPTIONS preload path. Forward slashes are used so that a Windows drive path cannot
// interact with backslash quoting inside NODE_OPTIONS parsing.
export function buildNodeOptions(guardPath, existing = '') {
  const normalized = path.resolve(guardPath).split(path.sep).join('/');
  const tokens = String(existing || '').match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  const filtered = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--require' && tokens[index + 1] && tokens[index + 1].includes('guard-install-deletions')) { index += 1; continue; }
    if (token.includes('guard-install-deletions')) continue;
    filtered.push(token);
  }
  filtered.push('--require', `"${normalized}"`);
  return filtered.join(' ');
}

// Deletes env keys case-insensitively, because Windows environment variable names are
// case-insensitive and a leftover override must not survive.
function deleteEnvKeyCaseInsensitive(env, name) {
  const target = name.toLowerCase();
  for (const key of Object.keys(env)) if (key.toLowerCase() === target) delete env[key];
}

export function buildChildEnv({ mode, projectRoot, stableRoot, syntheticRoot, allowedRoots, deniedRoots, cacheDirs, tmpDir, guardPath, logDir, baseEnv = process.env, extraEnv = null, phase = 'install' }) {
  const env = { ...baseEnv };
  env.NODE_OPTIONS = buildNodeOptions(guardPath, env.NODE_OPTIONS);

  // All M1_INSTALL_* values are set explicitly; nothing is inherited from a previous run.
  env.M1_INSTALL_DELETE_LOG = path.join(logDir, 'install-deletions.jsonl');
  env.M1_INSTALL_DESCENDANT_LOG = path.join(logDir, 'install-deletions.descendants.jsonl');
  env.M1_INSTALL_MODE = mode;
  env.M1_INSTALL_PROJECT_ROOT = path.resolve(projectRoot);
  env.M1_INSTALL_STABLE_ROOT = path.resolve(stableRoot);
  if (syntheticRoot) env.M1_INSTALL_SYNTHETIC_ROOT = path.resolve(syntheticRoot);
  else deleteEnvKeyCaseInsensitive(env, 'M1_INSTALL_SYNTHETIC_ROOT');
  env.M1_INSTALL_ALLOWED_ROOTS = JSON.stringify(allowedRoots.map((item) => path.resolve(item)));
  env.M1_INSTALL_DENIED_ROOTS = JSON.stringify(deniedRoots.map((item) => path.resolve(item)));
  env.M1_INSTALL_PHASE = phase;

  if (cacheDirs?.npm) env.npm_config_cache = cacheDirs.npm;
  if (cacheDirs?.electron) env.electron_config_cache = cacheDirs.electron;
  if (cacheDirs?.electronBuilder) env.ELECTRON_BUILDER_CACHE = cacheDirs.electronBuilder;
  env.TEMP = tmpDir;
  env.TMP = tmpDir;
  env.TMPDIR = tmpDir;

  // The in-package checksums.json must be used: any remote-checksum override is removed
  // case-insensitively so a differently-cased leftover cannot re-enable it.
  deleteEnvKeyCaseInsensitive(env, 'electron_use_remote_checksums');
  deleteEnvKeyCaseInsensitive(env, 'npm_config_electron_use_remote_checksums');
  deleteEnvKeyCaseInsensitive(env, 'ELECTRON_USE_REMOTE_CHECKSUMS');

  // Extra variables (used by the synthetic fixture). Applied last so they cannot be clobbered,
  // except that the M1_INSTALL_* contract above is never overridden.
  if (extraEnv) {
    for (const [key, value] of Object.entries(extraEnv)) {
      if (key.startsWith('M1_INSTALL_')) continue;
      env[key] = value;
    }
  }
  return env;
}

// ---------------------------------------------------------------------------------------------
// Environment validation (scope and preconditions)
// ---------------------------------------------------------------------------------------------

// Preflight of the fixed roots. Must be called before creating any directory, log, or child
// process. A missing fixed root is a hard stop: never rebuild it and never fall back to TEMP.
export function preflightFixedRoots({ stableRoot = FIXED_STABLE_ROOT, projectRoot = FIXED_PROJECT_ROOT } = {}) {
  const problems = [];
  for (const [label, root] of [['stable root', stableRoot], ['project root', projectRoot]]) {
    let stat;
    try {
      stat = fs.lstatSync(root);
    } catch (error) {
      problems.push(`${label} is not accessible: ${root} (${error.code || error.message})`);
      continue;
    }
    if (stat.isSymbolicLink()) { problems.push(`${label} is a reparse point: ${root}`); continue; }
    if (!stat.isDirectory()) { problems.push(`${label} is not a directory: ${root}`); continue; }
    try {
      fs.readdirSync(root);
    } catch (error) {
      problems.push(`${label} is not readable: ${root} (${error.code || error.message})`);
    }
  }
  return { ok: problems.length === 0, problems };
}

// Ancestors of every target that will be created are validated before any mkdir. Checks the
// specific targets' own ancestor chains, not only the project and stable roots. A target may be
// given as a string (directory semantics) or as { path, kind: 'file' | 'directory' }: a regular
// file already sitting at a log path is legitimate, a reparse point or a wrong kind is not.
export function validateTargetAncestors(targets) {
  const problems = [];
  for (const item of targets) {
    if (!item) continue;
    const spec = typeof item === 'string' ? { path: item } : item;
    if (!spec.path) continue;
    const kind = spec.kind === 'file' ? 'file' : 'directory';
    // Walk the canonical drive-form path: an extended-length input must never be handed to lstat
    // as-is, and an unsupported form is a refusal rather than a skipped check.
    const canonical = canonicalizePath(spec.path);
    if (!canonical.ok) {
      problems.push(`target uses a path form that cannot be validated: ${canonical.requested} (${canonical.reason})`);
      continue;
    }
    const resolved = canonical.fs_path;
    const parts = resolved.split(path.sep);
    let current = parts[0] + path.sep;
    for (let index = 1; index < parts.length; index += 1) {
      current = path.join(current, parts[index]);
      const isTarget = index === parts.length - 1;
      let stat;
      try {
        stat = fs.lstatSync(current);
      } catch (error) {
        if (error.code === 'ENOENT') break;
        problems.push(`ancestor not readable: ${current} (${error.code || error.message})`);
        break;
      }
      if (stat.isSymbolicLink()) { problems.push(`reparse point on ${isTarget ? 'target' : 'ancestor'} path: ${current}`); break; }
      if (isTarget) {
        if (kind === 'file' && !stat.isFile()) { problems.push(`target exists but is not a regular file: ${current}`); break; }
        if (kind === 'directory' && !stat.isDirectory()) { problems.push(`target exists but is not a directory: ${current}`); break; }
        break;
      }
      if (!stat.isDirectory()) { problems.push(`ancestor is not a directory: ${current}`); break; }
    }
  }
  return { ok: problems.length === 0, problems };
}

export function validateEnvironment({ mode, projectRoot, stableRoot, syntheticRoot, allowedRoots, deniedRoots, quarantineTarget, logDir, fixedRoots = FIXED_ROOTS }) {
  const problems = [];
  if (mode !== 'production' && mode !== 'synthetic') problems.push(`invalid mode: ${mode}`);
  if (!projectRoot) problems.push('project root is required');
  if (!stableRoot) problems.push('stable root is required');
  if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) problems.push('at least one allowed root is required');
  if (!Array.isArray(deniedRoots) || deniedRoots.length === 0) problems.push('at least one denied root is required (fail closed)');
  if (mode === 'synthetic' && !syntheticRoot) problems.push('synthetic mode requires a synthetic root');

  // Scope rules differ by mode. Production is pinned to the fixed project and the fixed stable
  // root. Synthetic mode is confined to a synthetic root that must itself live under the fixed
  // stable root, so a synthetic run can never widen anything onto the real project.
  //
  // Every path is compared by canonical identity, so an extended-length spelling is accepted where
  // an ordinary drive path would be and refused where it would be - it never adds permission.
  const identityOf = (value) => {
    const canonical = canonicalizePath(value);
    return canonical.ok ? canonical.identity : null;
  };
  const requireSupported = (label, value) => {
    if (!value) return null;
    const canonical = canonicalizePath(value);
    if (!canonical.ok) {
      problems.push(`${label} uses a path form that cannot be proven equivalent to an ordinary drive path: ${value} (${canonical.reason})`);
      return null;
    }
    if (canonical.form !== 'drive' && canonical.form !== 'extended_drive') {
      problems.push(`${label} must be a drive path: ${value}`);
      return null;
    }
    return canonical;
  };
  const projectIdentity = requireSupported('project root', projectRoot)?.identity ?? null;
  const stableIdentity = requireSupported('stable root', stableRoot)?.identity ?? null;
  requireSupported('synthetic root', syntheticRoot);
  requireSupported('log directory', logDir);
  requireSupported('quarantine target', quarantineTarget);

  if (mode === 'production') {
    if (projectRoot && identityOf(fixedRoots.projectRoot) !== projectIdentity) {
      problems.push(`project root must be the fixed project root: ${projectRoot}`);
    }
    if (stableRoot && identityOf(fixedRoots.stableRoot) !== stableIdentity) {
      problems.push(`stable root must be the fixed stable root: ${stableRoot}`);
    }
    if (syntheticRoot) problems.push('production mode must not be given a synthetic root');
  } else {
    if (syntheticRoot && !isStrictlyInside(syntheticRoot, fixedRoots.stableRoot)) {
      problems.push(`synthetic root must be strictly inside the fixed stable root (${fixedRoots.stableRoot}): ${syntheticRoot}`);
    }
    if (syntheticRoot && projectRoot && !isStrictlyInside(projectRoot, syntheticRoot)) {
      problems.push(`synthetic project root must be inside the synthetic root: ${projectRoot}`);
    }
  }

  // The step log is the one artifact a refusal may still want to describe, so where it is allowed
  // to live is part of the scope contract and is validated before anything is created.
  if (logDir) {
    if (mode === 'production') {
      const allowedEvidenceDir = path.join(fixedRoots.projectRoot, '.m1-evidence');
      if (!isStrictlyInside(logDir, allowedEvidenceDir)) {
        problems.push(`production log directory must be strictly inside the fixed project's .m1-evidence (${allowedEvidenceDir}): ${logDir}`);
      }
    } else if (syntheticRoot) {
      if (!isStrictlyInside(logDir, syntheticRoot)) {
        problems.push(`synthetic log directory must be strictly inside the synthetic root (${syntheticRoot}): ${logDir}`);
      }
    }
    if (projectRoot && isInside(logDir, path.join(projectRoot, '.m1-quarantine'))) {
      problems.push(`log directory must not be inside the quarantine area: ${logDir}`);
    }
  }

  const norm = (v) => {
    const canonical = canonicalizePath(v);
    return canonical.ok ? canonical.identity : null;
  };
  for (const root of allowedRoots || []) {
    const canonicalRoot = requireSupported('allowed root', root);
    if (!canonicalRoot) continue;
    if (norm(root) === norm(projectRoot)) problems.push(`allowed root equals the project root: ${root}`);
    if (norm(root) === norm(stableRoot)) problems.push(`allowed root equals the stable root: ${root}`);
    for (const protectedName of ['src', 'tests', 'electron']) {
      const guarded = path.join(projectRoot, protectedName);
      if (norm(root) === norm(guarded) || isInside(guarded, root)) problems.push(`allowed root covers protected directory ${protectedName}: ${root}`);
    }
    // The entire quarantine area is protected, not only this round's target.
    const quarantineArea = path.join(projectRoot, '.m1-quarantine');
    if (isInside(root, quarantineArea)) problems.push(`allowed root is inside the quarantine area: ${root}`);

    if (mode === 'production') {
      const insideProject = isStrictlyInside(root, projectRoot);
      const insideStable = isStrictlyInside(root, stableRoot);
      if (!insideProject && !insideStable) problems.push(`allowed root is neither inside the project nor inside the stable root: ${root}`);
      // Strict allowlist: inside the project ONLY node_modules may be a deletion target. Being
      // "somewhere inside the project" is explicitly not a permission.
      if (insideProject && canonicalRoot.identity !== identityOf(path.join(projectRoot, 'node_modules'))) {
        problems.push(`production mode only permits the project node_modules inside the project: ${root}`);
      }
    } else if (syntheticRoot && !isStrictlyInside(root, syntheticRoot)) {
      problems.push(`synthetic mode only permits roots inside the synthetic root: ${root}`);
    }
  }
  for (const denied of deniedRoots || []) {
    if (!requireSupported('denied root', denied)) continue;
    if (norm(denied) === norm(projectRoot)) problems.push(`denied root equals the project root: ${denied}`);
    if (norm(denied) === norm(stableRoot)) problems.push(`denied root equals the stable root: ${denied}`);
    if (mode === 'synthetic' && syntheticRoot && !isStrictlyInside(denied, syntheticRoot)) {
      problems.push(`synthetic denied root must be inside the synthetic root: ${denied}`);
    }
    for (const allowed of allowedRoots || []) {
      if (isInside(denied, allowed) || isInside(allowed, denied)) problems.push(`denied root ${denied} conflicts with allowed root ${allowed}`);
    }
  }

  if (quarantineTarget) {
    // Uniform in both modes: the quarantine target must sit inside the project's .m1-quarantine
    // directory and must not already exist. The original copy is never a deletion target.
    const quarantineRoot = path.join(projectRoot, '.m1-quarantine');
    if (!isStrictlyInside(quarantineTarget, quarantineRoot)) {
      problems.push(`quarantine target must be strictly inside ${quarantineRoot}: ${quarantineTarget}`);
    }
    const quarantineCanonical = canonicalizePath(quarantineTarget);
    if (quarantineCanonical.ok && fs.existsSync(quarantineCanonical.fs_path)) {
      problems.push(`quarantine target already exists: ${quarantineTarget}`);
    }
  }

  return { ok: problems.length === 0, problems };
}

// Reparse points are refused anywhere along the path from the drive root to the target, so a
// junction cannot be used to escape the validated scope.
export function assertNoReparsePointsOnPath(target) {
  const resolved = path.resolve(target);
  const parts = resolved.split(path.sep);
  let current = parts[0] + path.sep;
  for (const part of parts.slice(1)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) continue;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`reparse point on path (refused): ${current}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------------------------

export function buildInventory(root) {
  const resolvedRoot = path.resolve(root);
  if (!fs.existsSync(resolvedRoot)) throw new Error(`inventory root does not exist: ${resolvedRoot}`);
  const rootStat = fs.lstatSync(resolvedRoot);
  if (rootStat.isSymbolicLink()) throw new Error(`inventory root is a reparse point: ${resolvedRoot}`);
  if (!rootStat.isDirectory()) throw new Error(`inventory root is not a directory: ${resolvedRoot}`);

  const files = [];
  const directories = [];
  const emptyDirectories = [];
  const stack = [resolvedRoot];

  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      throw new Error(`unreadable path during inventory: ${current} (${error.code || error.message})`);
    }
    if (current !== resolvedRoot) directories.push(relativeOf(resolvedRoot, current));
    if (entries.length === 0 && current !== resolvedRoot) emptyDirectories.push(relativeOf(resolvedRoot, current));
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error(`reparse point encountered during inventory (not followed): ${full}`);
      if (stat.isDirectory()) { stack.push(full); continue; }
      if (!stat.isFile()) throw new Error(`unexpected entry type during inventory: ${full}`);
      files.push({ relative: relativeOf(resolvedRoot, full), type: 'file', bytes: stat.size, sha256: sha256File(full) });
    }
  }

  files.sort((a, b) => (a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0));
  directories.sort();
  emptyDirectories.sort();
  return {
    root: resolvedRoot,
    file_count: files.length,
    total_bytes: files.reduce((sum, item) => sum + item.bytes, 0),
    directory_count: directories.length,
    empty_directories: emptyDirectories,
    files,
    directories,
  };
}

export function inventoryDigest(inventory) {
  const payload = {
    file_count: inventory.file_count,
    total_bytes: inventory.total_bytes,
    directory_count: inventory.directory_count,
    empty_directories: inventory.empty_directories,
    files: inventory.files.map((item) => `${item.relative}\u0000${item.type}\u0000${item.bytes}\u0000${item.sha256}`),
  };
  return sha256Text(JSON.stringify(payload));
}

// Pure comparison. It is a plain function over two inventory objects, so comparison cases can be
// exercised in memory without deleting anything from disk.
export function compareInventories(left, right) {
  const differences = [];
  if (!left || !right) return { equal: false, digestsMatch: false, differences: ['inventory missing'], digestLeft: null, digestRight: null };

  if (left.file_count !== right.file_count) differences.push(`file_count ${left.file_count} -> ${right.file_count}`);
  if (left.total_bytes !== right.total_bytes) differences.push(`total_bytes ${left.total_bytes} -> ${right.total_bytes}`);
  if (left.directory_count !== right.directory_count) differences.push(`directory_count ${left.directory_count} -> ${right.directory_count}`);

  const leftFiles = new Map(left.files.map((item) => [item.relative, item]));
  const rightFiles = new Map(right.files.map((item) => [item.relative, item]));
  for (const [key, value] of leftFiles) {
    const other = rightFiles.get(key);
    if (!other) { differences.push(`missing after move: ${key}`); continue; }
    if (value.type !== other.type) differences.push(`type changed: ${key}`);
    if (value.bytes !== other.bytes) differences.push(`size changed: ${key}`);
    if (value.sha256 !== other.sha256) differences.push(`hash changed: ${key}`);
  }
  for (const key of rightFiles.keys()) if (!leftFiles.has(key)) differences.push(`unexpected after move: ${key}`);

  const leftDirs = new Set(left.directories);
  const rightDirs = new Set(right.directories);
  for (const dir of leftDirs) if (!rightDirs.has(dir)) differences.push(`directory missing after move: ${dir}`);
  for (const dir of rightDirs) if (!leftDirs.has(dir)) differences.push(`unexpected directory after move: ${dir}`);

  const leftEmpty = new Set(left.empty_directories);
  const rightEmpty = new Set(right.empty_directories);
  for (const dir of leftEmpty) if (!rightEmpty.has(dir)) differences.push(`empty directory lost: ${dir}`);
  for (const dir of rightEmpty) if (!leftEmpty.has(dir)) differences.push(`unexpected empty directory: ${dir}`);

  const digestLeft = inventoryDigest(left);
  const digestRight = inventoryDigest(right);
  const digestsMatch = digestLeft === digestRight;
  if (!digestsMatch && differences.length === 0) differences.push('inventory digests differ');

  return {
    equal: differences.length === 0 && digestsMatch,
    digestsMatch,
    differences,
    digestLeft,
    digestRight,
    directories_compared: leftDirs.size,
    empty_directories_compared: leftEmpty.size,
  };
}

export function moveDirectorySameVolume(source, target) {
  const resolvedSource = path.resolve(source);
  const resolvedTarget = path.resolve(target);
  if (!fs.existsSync(resolvedSource)) throw new Error(`move source does not exist: ${resolvedSource}`);
  if (fs.existsSync(resolvedTarget)) throw new Error(`move target already exists; refusing to overwrite: ${resolvedTarget}`);
  const sourceRoot = path.parse(resolvedSource).root;
  const targetRoot = path.parse(resolvedTarget).root;
  if (sourceRoot.toLowerCase() !== targetRoot.toLowerCase()) {
    throw new Error(`refusing cross-volume move ${sourceRoot} -> ${targetRoot}: renameSync fails with EXDEV and copy-then-delete is not permitted`);
  }
  fs.mkdirSync(path.dirname(resolvedTarget), { recursive: true });
  fs.renameSync(resolvedSource, resolvedTarget);
  return { source: resolvedSource, target: resolvedTarget };
}

export function assertPackageHashesUnchanged(projectRoot, expected) {
  const results = {};
  for (const name of Object.keys(expected)) {
    const filePath = path.join(projectRoot, name);
    try {
      const actual = sha256File(filePath);
      results[name] = { expected: expected[name], actual, match: expected[name] === actual };
    } catch (error) {
      // A missing or unreadable manifest is a failed comparison, not a crash: the entry point must
      // be able to return a refusal result instead of throwing.
      results[name] = { expected: expected[name], actual: null, match: false, error: error.code || String(error.message) };
    }
  }
  const mismatches = Object.entries(results).filter(([, value]) => !value.match).map(([name]) => name);
  return { ok: mismatches.length === 0, results, mismatches, problems: mismatches.map((name) => `package file does not match the audited hash: ${name} (${results[name].error || 'content changed'})`) };
}

export function installGate({ inventoryEqual, packageHashesOk, targetExists }) {
  const blockers = [];
  if (!inventoryEqual) blockers.push('quarantine inventory does not match the original');
  if (!packageHashesOk) blockers.push('package file hash changed');
  if (targetExists) blockers.push('install target already exists');
  return { proceed: blockers.length === 0, blockers };
}

// ---------------------------------------------------------------------------------------------
// Probes that must pass before any real directory is moved
// ---------------------------------------------------------------------------------------------

// All child output is captured through file descriptors rather than pipes. Piped stdio for a child
// process is refused in this environment, so a pipe-based probe reports a sandbox denial that has
// nothing to do with the tool being probed.
export function spawnToFiles(execPath, args, { env, cwd, stdoutPath, stderrPath }) {
  const outFd = fs.openSync(stdoutPath, 'w');
  const errFd = fs.openSync(stderrPath, 'w');
  try {
    return spawnSync(execPath, args, { env, cwd, stdio: ['ignore', outFd, errFd] });
  } finally {
    fs.closeSync(outFd);
    fs.closeSync(errFd);
  }
}

// Loads the guard in a child process that deletes nothing. The guard emits guard_loaded:true only
// after its configuration validates, so a missing line means the guard refused.
export function probeGuardLoad({ execPath = process.execPath, guardPath = GUARD_PATH, env, logDir }) {
  const probeLog = path.join(logDir, 'guard-load-probe.jsonl');
  const probeEnv = { ...env, M1_INSTALL_DELETE_LOG: probeLog, M1_INSTALL_DESCENDANT_LOG: `${probeLog}.descendants.jsonl` };
  const stdoutPath = path.join(logDir, 'guard-load-probe.stdout.txt');
  const stderrPath = path.join(logDir, 'guard-load-probe.stderr.txt');
  const result = spawnToFiles(execPath, ['-e', 'process.stdout.write("guard-probe-ok")'], { env: probeEnv, stdoutPath, stderrPath });
  let loaded = false;
  let refused = false;
  if (fs.existsSync(probeLog)) {
    for (const line of fs.readFileSync(probeLog, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const record = JSON.parse(line);
      if (record.event === 'guard_start' && record.guard_loaded === true) loaded = true;
      if (record.event === 'guard_refused') refused = true;
    }
  }
  return {
    ok: result.status === 0 && loaded && !refused,
    status: result.status,
    stdout: readHead(stdoutPath, 200),
    stderr: readTail(stderrPath, 400),
    error: result.error ? result.error.code || String(result.error.message) : null,
    guard_loaded: loaded,
    guard_refused: refused,
    log: probeLog,
    stdout_path: stdoutPath,
    stderr_path: stderrPath,
  };
}

export function probeNpmVersion({ execPath = process.execPath, npmCli, env, logDir = null }) {
  if (!npmCli) return { ok: false, status: null, stdout: '', stderr: 'npm CLI could not be resolved', error: 'TOOLING_UNAVAILABLE' };
  const dir = logDir || path.dirname(npmCli);
  const stdoutPath = path.join(dir, 'npm-version-probe.stdout.txt');
  const stderrPath = path.join(dir, 'npm-version-probe.stderr.txt');
  const result = spawnToFiles(execPath, [npmCli, '--version'], { env, stdoutPath, stderrPath });
  const stdout = readHead(stdoutPath, 200).trim();
  return {
    ok: result.status === 0 && /^\d+\.\d+\.\d+/.test(stdout),
    status: result.status,
    stdout,
    stderr: readTail(stderrPath, 400).trim(),
    error: result.error ? result.error.code || String(result.error.message) : null,
    stdout_path: stdoutPath,
    stderr_path: stderrPath,
  };
}

// ---------------------------------------------------------------------------------------------
// Command runners
// ---------------------------------------------------------------------------------------------

// Real runner. stdout/stderr go to files by descriptor rather than pipes, and the parent waits
// for exit before reading them back.
export function createRealCommandRunner() {
  return {
    kind: 'real',
    run({ step, command, args, cwd, env, stdoutPath, stderrPath }) {
      fs.mkdirSync(path.dirname(stdoutPath), { recursive: true });
      const outFd = fs.openSync(stdoutPath, 'a');
      const errFd = fs.openSync(stderrPath, 'a');
      try {
        const result = spawnSync(command, args, { cwd, env, stdio: ['ignore', outFd, errFd] });
        return {
          step, command, args, cwd,
          status: result.status,
          signal: result.signal,
          error: result.error ? result.error.code || String(result.error.message) : null,
        };
      } finally {
        fs.closeSync(outFd);
        fs.closeSync(errFd);
      }
    },
  };
}

export function readTail(filePath, limit = 400) {
  if (!fs.existsSync(filePath)) return '';
  const text = fs.readFileSync(filePath, 'utf8');
  return text.length <= limit ? text : text.slice(-limit);
}

export function readHead(filePath, limit = 200) {
  if (!fs.existsSync(filePath)) return '';
  const text = fs.readFileSync(filePath, 'utf8');
  return text.length <= limit ? text : text.slice(0, limit);
}

// ---------------------------------------------------------------------------------------------
// The orchestration
// ---------------------------------------------------------------------------------------------

export function runIsolatedInstall(options) {
  let {
    mode,
    projectRoot,
    stableRoot,
    syntheticRoot = null,
    nodeModulesPath,
    quarantineTarget,
    cacheDirs,
    tmpDir,
    expectedPackageHashes,
    commandRunner,
    npmInvocation,
    electronInvocation,
    guardPath = GUARD_PATH,
    logDir,
    expectedVersions = EXPECTED_VERSIONS,
    inventoryBuilder = buildInventory,
    mover = moveDirectorySameVolume,
    probeGuard = true,
    execPath = process.execPath,
    npmCli = null,
    extraEnv = null,
    // Injectable fixed roots. Production passes nothing and therefore always gets the exact
    // audited constants; the injection point exists only so the entry-point regressions can
    // simulate a missing fixed root in memory, without touching the real fixed root.
    fixedRoots = FIXED_ROOTS,
  } = options;

  // -------------------------------------------------------------------------------------------
  // PATH CANONICALIZATION. Every path this run touches is reduced to one canonical drive-form
  // path up front, so the scope decision, the pre/post inventories, the move and the audit all use
  // the same identity. An input written in the equivalent extended-length form is accepted and
  // normalized; an unsupported form (UNC, device namespace, or an extended form that cannot be
  // proven equivalent) is refused here rather than being silently carried around.
  // -------------------------------------------------------------------------------------------
  const canonicalTargets = {
    projectRoot,
    stableRoot,
    syntheticRoot,
    nodeModulesPath,
    quarantineTarget,
    logDir,
    tmpDir,
  };
  const pathFormProblems = [];
  const canonicalPaths = {};
  for (const [label, value] of Object.entries(canonicalTargets)) {
    if (!value) continue;
    const canonical = canonicalizePath(value);
    if (!canonical.ok) {
      pathFormProblems.push(`${label} uses a path form that cannot be proven equivalent to an ordinary drive path: ${value} (${canonical.reason})`);
      continue;
    }
    canonicalPaths[label] = canonical;
  }
  const canonicalCacheDirs = {};
  for (const [label, value] of Object.entries(cacheDirs || {})) {
    if (!value) continue;
    const canonical = canonicalizePath(value);
    if (!canonical.ok) {
      pathFormProblems.push(`cache directory ${label} uses a path form that cannot be proven equivalent to an ordinary drive path: ${value} (${canonical.reason})`);
      continue;
    }
    canonicalCacheDirs[label] = canonical.fs_path;
  }

  // From here on, every path is the canonical drive-form path. `path_form_inputs` keeps what the
  // caller actually asked for, for review.
  const path_form_inputs = Object.fromEntries(Object.entries(canonicalTargets).filter(([, value]) => value).map(([label]) => [label, canonicalPaths[label] ? canonicalPaths[label].requested : canonicalTargets[label]]));
  const path_form_normalized = Object.fromEntries(Object.entries(canonicalPaths).map(([label, canonical]) => [label, { requested: canonical.requested, resolved: canonical.fs_path, form: canonical.form, equivalence_proven: canonical.ok }]));
  if (canonicalPaths.projectRoot) projectRoot = canonicalPaths.projectRoot.fs_path;
  if (canonicalPaths.stableRoot) stableRoot = canonicalPaths.stableRoot.fs_path;
  if (canonicalPaths.syntheticRoot) syntheticRoot = canonicalPaths.syntheticRoot.fs_path;
  if (canonicalPaths.nodeModulesPath) nodeModulesPath = canonicalPaths.nodeModulesPath.fs_path;
  if (canonicalPaths.quarantineTarget) quarantineTarget = canonicalPaths.quarantineTarget.fs_path;
  if (canonicalPaths.logDir) logDir = canonicalPaths.logDir.fs_path;
  if (canonicalPaths.tmpDir) tmpDir = canonicalPaths.tmpDir.fs_path;
  if (cacheDirs) cacheDirs = canonicalCacheDirs;

  const steps = [];
  const logPath = logDir ? path.join(logDir, 'steps.jsonl') : null;
  // The step log is written lazily. Until validation has passed, a step is only buffered in memory:
  // a refused run must not create a log (or any directory) just to describe its own refusal.
  let logReady = false;
  const append = (entry) => {
    const record = { at: new Date().toISOString(), ...entry };
    steps.push(record);
    if (logReady) fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`);
    return record;
  };
  const finish = (ok, exitCode, extra = {}) => ({ ok, exitCode, steps, stepsLog: logReady ? logPath : null, ...extra, log_written: logReady });
  // The single write barrier of this function: everything before it is validation only.
  const openStepLog = () => {
    fs.mkdirSync(logDir, { recursive: true });
    logReady = true;
    // Flush the buffered validation records in order, then keep appending.
    for (const record of steps) fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`);
  };

  // -------------------------------------------------------------------------------------------
  // PRE-WRITE VALIDATION. No mkdir, no log write, no child process, no move happens before this
  // block has fully passed. This lives inside the entry point on purpose: validation must not
  // depend on the CLI wrapper in main() being the caller.
  // -------------------------------------------------------------------------------------------
  const allowedRoots = [nodeModulesPath || path.join(projectRoot || '', 'node_modules'), ...Object.values(cacheDirs || {}), tmpDir].filter(Boolean);
  const deniedRoots = [quarantineTarget].filter(Boolean);

  // 1. Fixed roots must exist, be readable directories and not be reparse points. Read-only.
  const fixedRootProblems = preflightFixedRoots({ stableRoot: fixedRoots.stableRoot, projectRoot: fixedRoots.projectRoot }).problems;
  append({ step: 'fixed_root_preflight', ok: fixedRootProblems.length === 0, problems: fixedRootProblems, fixed_roots: { ...fixedRoots } });
  append({ step: 'path_form', ok: pathFormProblems.length === 0, problems: pathFormProblems, inputs: path_form_inputs, normalized: path_form_normalized });

  // 2. Mode, path scope, quarantine target and log directory placement.
  const environment = validateEnvironment({ mode, projectRoot, stableRoot, syntheticRoot, allowedRoots, deniedRoots, quarantineTarget, logDir, fixedRoots });
  append({ step: 'validate_environment', ok: environment.ok, problems: environment.problems, allowed_roots: allowedRoots, denied_roots: deniedRoots, log_dir: logDir });

  // 3. Reparse points along the stable root and the project path.
  const reparseProblems = [];
  for (const [label, target] of [['stable root', stableRoot], ['project root', projectRoot]]) {
    if (!target) continue;
    try {
      assertNoReparsePointsOnPath(target);
    } catch (error) {
      reparseProblems.push(`${label}: ${error.message}`);
    }
  }
  append({ step: 'reparse_point_check', ok: reparseProblems.length === 0, problems: reparseProblems });

  // 4. Scratch directories must be inside the stable root.
  const scratchProblems = [];
  for (const [name, dir] of Object.entries({ ...(cacheDirs || {}), tmpDir })) {
    if (!dir) continue;
    if (!stableRoot || !isStrictlyInside(dir, stableRoot)) scratchProblems.push(`${name} is not strictly inside the stable root: ${dir}`);
  }
  if (!logDir) scratchProblems.push('log directory is required');

  // 5. Ancestors of every path this run may create or move, validated before anything exists.
  const writeTargets = [
    logDir,
    ...Object.values(cacheDirs || {}),
    tmpDir,
    quarantineTarget,
  ].filter(Boolean);
  const ancestorProblems = validateTargetAncestors(writeTargets).problems;
  append({ step: 'write_scope', ok: scratchProblems.length === 0 && ancestorProblems.length === 0, scratch_problems: scratchProblems, ancestor_problems: ancestorProblems, targets: writeTargets });

  // 6. Audited package hashes (read-only). Only meaningful once the scope checks have passed, so a
  // scope refusal is reported without reading unrelated paths.
  const scopeProblems = [...pathFormProblems, ...fixedRootProblems, ...environment.problems, ...reparseProblems, ...scratchProblems, ...ancestorProblems];
  let beforeHashes = { ok: false, skipped: true, results: {}, mismatches: [], problems: [] };
  if (scopeProblems.length === 0) {
    beforeHashes = assertPackageHashesUnchanged(projectRoot, expectedPackageHashes);
    append({ step: 'package_hashes_before', ...beforeHashes });
  } else {
    append({ step: 'package_hashes_before', ok: false, skipped: true, reason: 'scope validation failed first' });
  }

  if (scopeProblems.length > 0 || !beforeHashes.ok) {
    // Classification keeps the exit codes meaningful: a scope/entry problem is ENVIRONMENT_INVALID,
    // a changed package manifest is PACKAGE_HASH_CHANGED.
    const exitCode = scopeProblems.length > 0 ? EXIT.ENVIRONMENT_INVALID : EXIT.PACKAGE_HASH_CHANGED;
    return finish(false, exitCode, {
      refused_before_write: true,
      log_written: false,
      pre_write_problems: [...scopeProblems, ...beforeHashes.problems],
      fixed_root_problems: fixedRootProblems,
      environment,
      reparse_problems: reparseProblems,
      scratch_problems: scratchProblems,
      ancestor_problems: ancestorProblems,
      before_hashes: beforeHashes,
    });
  }

  // ---- write barrier: validation passed, so the run may now create its directories ----
  openStepLog();
  append({ step: 'log_written', ok: true, log_dir: logDir, log_file: logPath, buffered_records: steps.length - 1 });
  for (const dir of [...Object.values(cacheDirs || {}), tmpDir]) if (dir) fs.mkdirSync(dir, { recursive: true });
  append({ step: 'scratch_created', ok: true, dirs: { ...(cacheDirs || {}), tmpDir } });

  // Step 4: probe tooling. The PRE-MOVE probe phase deliberately excludes node_modules from the
  // guard's allowlist: nothing may hold deletion rights over the old tree before the quarantined
  // copy's inventory has been verified.
  const probeAllowedRoots = allowedRoots.filter((root) => path.resolve(root) !== path.resolve(path.join(projectRoot, 'node_modules')));
  const probeEnv = buildChildEnv({ mode, projectRoot, stableRoot, syntheticRoot, allowedRoots: probeAllowedRoots, deniedRoots, cacheDirs, tmpDir, guardPath, logDir, extraEnv, phase: 'probe' });
  // The probe phase writes to its own log files. Sharing one log path across phases mixed a
  // probe-phase summary into the install-phase audit, and (before the ancestor fix) a log file
  // created by the probe made the install-phase guard refuse its own existing log.
  const npmProbeEnv = {
    ...probeEnv,
    M1_INSTALL_DELETE_LOG: path.join(logDir, 'npm-version-probe.deletions.jsonl'),
    M1_INSTALL_DESCENDANT_LOG: path.join(logDir, 'npm-version-probe.deletions.descendants.jsonl'),
  };
  const resolvedNpmCli = npmCli || resolveNpmCli(execPath);
  append({ step: 'resolve_tooling', npm_cli: resolvedNpmCli, exec_path: execPath, ok: Boolean(resolvedNpmCli) });
  if (!resolvedNpmCli && !npmInvocation) return finish(false, EXIT.TOOLING_UNAVAILABLE, { error: 'npm CLI entry point could not be resolved' });

  if (probeGuard) {
    const guardProbe = probeGuardLoad({ execPath, guardPath, env: probeEnv, logDir });
    append({ step: 'guard_load_probe', phase: 'probe', allowed_roots: probeAllowedRoots, ...guardProbe });
    if (!guardProbe.ok) return finish(false, EXIT.GUARD_PROBE_FAILED, { guardProbe });
  }

  const npmProbe = probeNpmVersion({ execPath, npmCli: resolvedNpmCli, env: npmProbeEnv, logDir });
  append({ step: 'npm_version_probe', ...npmProbe });
  if (!npmProbe.ok) return finish(false, EXIT.TOOLING_UNAVAILABLE, { npmProbe });

  // Step 7: full inventory of the original tree, persisted before anything moves.
  let originalInventory;
  try {
    originalInventory = inventoryBuilder(nodeModulesPath);
  } catch (error) {
    append({ step: 'inventory_original', ok: false, error: String(error.message) });
    return finish(false, EXIT.INVENTORY_INCOMPLETE, { error: String(error.message) });
  }
  const originalInventoryPath = path.join(logDir, 'inventory-original.json');
  fs.writeFileSync(originalInventoryPath, JSON.stringify(originalInventory), 'utf8');
  append({
    step: 'inventory_original', ok: true, file_count: originalInventory.file_count, total_bytes: originalInventory.total_bytes,
    directory_count: originalInventory.directory_count, empty_directories: originalInventory.empty_directories.length,
    digest: inventoryDigest(originalInventory), persisted: originalInventoryPath,
  });

  // Step 8: same-volume rename to a non-existent quarantine target.
  try {
    mover(nodeModulesPath, quarantineTarget);
  } catch (error) {
    append({ step: 'quarantine_move', ok: false, error: String(error.message) });
    return finish(false, EXIT.QUARANTINE_MISMATCH, { error: String(error.message) });
  }
  append({ step: 'quarantine_move', ok: true, source: nodeModulesPath, target: quarantineTarget });

  // Step 9: full inventory of the quarantined copy, persisted, then compared.
  let quarantineInventory;
  try {
    quarantineInventory = inventoryBuilder(quarantineTarget);
  } catch (error) {
    append({ step: 'inventory_quarantine', ok: false, error: String(error.message) });
    return finish(false, EXIT.INVENTORY_INCOMPLETE, { error: String(error.message), quarantine_kept: true });
  }
  const quarantineInventoryPath = path.join(logDir, 'inventory-quarantine.json');
  fs.writeFileSync(quarantineInventoryPath, JSON.stringify(quarantineInventory), 'utf8');
  const comparison = compareInventories(originalInventory, quarantineInventory);
  fs.writeFileSync(path.join(logDir, 'inventory-comparison.json'), JSON.stringify(comparison), 'utf8');
  append({
    step: 'inventory_compare', equal: comparison.equal, digests_match: comparison.digestsMatch,
    difference_count: comparison.differences.length, differences: comparison.differences.slice(0, 50),
    directories_compared: comparison.directories_compared, empty_directories_compared: comparison.empty_directories_compared,
    persisted: path.join(logDir, 'inventory-comparison.json'),
  });
  if (!comparison.equal) return finish(false, EXIT.QUARANTINE_MISMATCH, { comparison, quarantine_kept: true });

  const gate = installGate({ inventoryEqual: comparison.equal, packageHashesOk: beforeHashes.ok, targetExists: fs.existsSync(nodeModulesPath) });
  append({ step: 'install_gate', ...gate });
  if (!gate.proceed) return finish(false, EXIT.QUARANTINE_MISMATCH, { gate });

  // Only now, after the quarantined copy's inventory has been verified, is the install-phase
  // configuration built. This is the first moment node_modules gains deletion rights.
  const installEnv = buildChildEnv({ mode, projectRoot, stableRoot, syntheticRoot, allowedRoots, deniedRoots, cacheDirs, tmpDir, guardPath, logDir, extraEnv, phase: 'install' });
  append({ step: 'install_phase_config', phase: 'install', allowed_roots: allowedRoots });

  // Step 10: npm ci.
  const npmArgs = npmInvocation ? npmInvocation.args : [resolvedNpmCli, 'ci', '--include=dev', '--no-audit', '--no-fund', '--logs-max=0', '--prefer-offline'];
  const npmCommand = npmInvocation ? npmInvocation.command : execPath;
  const npmStdout = path.join(logDir, 'npm-ci.stdout.txt');
  const npmStderr = path.join(logDir, 'npm-ci.stderr.txt');
  const npmResult = commandRunner.run({ step: 'npm_ci', command: npmCommand, args: npmArgs, cwd: projectRoot, env: installEnv, stdoutPath: npmStdout, stderrPath: npmStderr });
  append({
    step: 'npm_ci', status: npmResult.status, signal: npmResult.signal, error: npmResult.error,
    stdout: npmStdout, stderr: npmStderr, stdout_head: readHead(npmStdout), stdout_tail: readTail(npmStdout), stderr_tail: readTail(npmStderr),
  });
  if (npmResult.status !== 0) {
    return finish(false, npmResult.status === EXIT.GUARD_BLOCKED ? EXIT.GUARD_BLOCKED : EXIT.COMMAND_FAILED, { failedStep: 'npm_ci', quarantine_kept: true });
  }

  // Step 11: Electron binary. npm ci does not fetch it, so it is fetched explicitly.
  const electronArgs = electronInvocation ? electronInvocation.args : [path.join('node_modules', 'electron', 'install.js')];
  const electronCommand = electronInvocation ? electronInvocation.command : execPath;
  const electronStdout = path.join(logDir, 'electron-install.stdout.txt');
  const electronStderr = path.join(logDir, 'electron-install.stderr.txt');
  const electronResult = commandRunner.run({ step: 'electron_install', command: electronCommand, args: electronArgs, cwd: projectRoot, env: installEnv, stdoutPath: electronStdout, stderrPath: electronStderr });
  append({
    step: 'electron_install', status: electronResult.status, signal: electronResult.signal, error: electronResult.error,
    stdout: electronStdout, stderr: electronStderr, stdout_head: readHead(electronStdout), stdout_tail: readTail(electronStdout), stderr_tail: readTail(electronStderr),
  });
  if (electronResult.status !== 0) {
    return finish(false, electronResult.status === EXIT.GUARD_BLOCKED ? EXIT.GUARD_BLOCKED : EXIT.COMMAND_FAILED, { failedStep: 'electron_install', quarantine_kept: true });
  }

  // Step 12: verification.
  const afterHashes = assertPackageHashesUnchanged(projectRoot, expectedPackageHashes);
  const versionProblems = [];
  for (const [name, expected] of Object.entries(expectedVersions)) {
    const manifest = path.join(projectRoot, 'node_modules', name, 'package.json');
    if (!fs.existsSync(manifest)) { versionProblems.push(`${name}: not installed`); continue; }
    const actual = JSON.parse(fs.readFileSync(manifest, 'utf8')).version;
    if (actual !== expected) versionProblems.push(`${name}: expected ${expected}, found ${actual}`);
  }

  // Electron is verified through path.txt pointing at a real file inside dist, plus dist/version.
  const electronDir = path.join(projectRoot, 'node_modules', 'electron');
  const pathTxtFile = path.join(electronDir, 'path.txt');
  const distDir = path.join(electronDir, 'dist');
  const versionFile = path.join(distDir, 'version');
  const electronProblems = [];
  if (!fs.existsSync(pathTxtFile)) electronProblems.push('path.txt missing');
  else {
    const binaryName = fs.readFileSync(pathTxtFile, 'utf8').trim();
    if (!binaryName) electronProblems.push('path.txt is empty');
    else {
      const binaryPath = path.join(distDir, binaryName);
      if (!isStrictlyInside(binaryPath, distDir)) electronProblems.push(`path.txt escapes dist: ${binaryName}`);
      else if (!fs.existsSync(binaryPath) || !fs.statSync(binaryPath).isFile()) electronProblems.push(`binary named by path.txt is missing: ${binaryPath}`);
    }
  }
  if (!fs.existsSync(versionFile)) electronProblems.push('dist/version missing');
  else if (fs.readFileSync(versionFile, 'utf8').trim() !== expectedVersions.electron) {
    electronProblems.push(`dist/version content mismatch: ${fs.readFileSync(versionFile, 'utf8').trim()}`);
  }

  let quarantineStillMatches = false;
  try {
    quarantineStillMatches = compareInventories(originalInventory, inventoryBuilder(quarantineTarget)).equal;
  } catch {
    quarantineStillMatches = false;
  }

  append({
    step: 'post_install_verification', package_hashes_ok: afterHashes.ok, version_problems: versionProblems,
    electron_problems: electronProblems, quarantine_still_matches: quarantineStillMatches,
  });

  if (!afterHashes.ok || versionProblems.length > 0 || electronProblems.length > 0 || !quarantineStillMatches) {
    return finish(false, EXIT.VERIFICATION_FAILED, { afterHashes, versionProblems, electronProblems, quarantineStillMatches, quarantine_kept: true });
  }

  // Whole-run deletion rollup. Computed separately from the per-process summaries the guard writes:
  // it is derived from the raw log records of every pid that wrote to this run's logs, and pid is
  // never part of a path dedup key.
  const deletionSummary = summarizeDeletionLogs({
    logPath: path.join(logDir, 'install-deletions.jsonl'),
    descendantPath: path.join(logDir, 'install-deletions.descendants.jsonl'),
  });
  append({
    step: 'deletion_audit_rollup',
    processes: deletionSummary.run.processes,
    call_count: deletionSummary.run.call_count,
    call_count_scope: deletionSummary.run.call_count_scope,
    descendant_paths_gone_observed: deletionSummary.run.descendant_paths_gone_observed,
    distinct_descendant_paths_gone: deletionSummary.run.distinct_descendant_paths_gone,
    distinct_deletion_target_paths_gone: deletionSummary.run.distinct_deletion_target_paths_gone,
    distinct_confirmed_paths_gone: deletionSummary.run.distinct_confirmed_paths_gone,
    cross_check_mismatches: deletionSummary.cross_check.filter((item) => !item.matches).length,
  });

  return finish(true, EXIT.OK, { quarantineKept: true, deletionSummary });
}

// ---------------------------------------------------------------------------------------------
// Whole-run deletion rollup (cross-PID)
// ---------------------------------------------------------------------------------------------
// The guard writes a per-process summary. This computes the run-level view from the RAW log
// records of every pid, so the two are independent and can be cross-checked against each other.
//
// Dedup rules, shared with the guard's pure helpers (the guard is a CJS preload and cannot be
// imported without executing it, so the three-line normalization rule is repeated deliberately):
//   * a path key is always a normalized absolute path (path.resolve + lowercase);
//   * a descendant's key is the deletion target root joined with its persisted relative path, so
//     identically named files under different roots stay distinct;
//   * a pid is never part of any path key, and the run-level set is a union across pids.

export function normalizeAuditPath(value) {
  const canonical = canonicalizePath(value);
  if (canonical.ok) return canonical.identity;
  // An unsupported form keeps its own raw key: it is never merged with an ordinary path.
  return `unsupported::${String(value).toLowerCase()}`;
}

export function descendantAuditKey(root, entry) {
  const relative = String(entry).split('\u0000')[0];
  return normalizeAuditPath(path.join(String(root), relative));
}

function readJsonlRecords(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { records: [], unparsable_lines: 0 };
  const records = [];
  let unparsable = 0;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      unparsable += 1;
    }
  }
  return { records, unparsable_lines: unparsable };
}

export function summarizeDeletionLogs({ logPath, descendantPath = null }) {
  const log = readJsonlRecords(logPath);
  const descendants = readJsonlRecords(descendantPath);
  const summaryByPid = new Map();
  const recordsByPid = new Map();
  // A line without a pid cannot be attributed to a process, so it can never be cross-checked
  // against a per-process summary. Such lines are still counted in the run totals, but they are
  // reported as their own unattributed group instead of being silently merged into a real pid.
  const UNATTRIBUTED = 'unattributed';
  const pidOf = (value) => (value === undefined || value === null ? UNATTRIBUTED : value);

  for (const record of log.records) {
    const pid = pidOf(record.pid);
    if (record.event === 'summary') { summaryByPid.set(pid, record); continue; }
    if (record.event === 'guard_start') continue;
    if (!recordsByPid.has(pid)) recordsByPid.set(pid, []);
    recordsByPid.get(pid).push(record);
  }

  const pids = new Set([...recordsByPid.keys(), ...summaryByPid.keys(), ...descendants.records.map((item) => pidOf(item.pid))]);
  const runDescendantKeys = new Set();
  const runTargetKeys = new Set();
  const perProcess = [];

  for (const pid of pids) {
    const ownRecords = recordsByPid.get(pid) || [];
    const ownLines = descendants.records.filter((item) => pidOf(item.pid) === pid && item.phase !== 'pre_deletion');
    const descendantKeys = new Set();
    for (const line of ownLines) {
      for (const entry of line.entries || []) {
        const key = descendantAuditKey(line.resolved, entry);
        descendantKeys.add(key);
        runDescendantKeys.add(key);
      }
    }
    const deleted = ownRecords.filter((item) => item.event === 'deleted');
    const noop = ownRecords.filter((item) => item.event === 'noop');
    const failed = ownRecords.filter((item) => item.event === 'attempt_failed');
    const internal = ownRecords.filter((item) => item.event === 'internal_step');
    // A target counts only when it existed before the call and no longer exists after it.
    const targetKeys = new Set(ownRecords.filter((item) => item.existed_before === true && item.exists_after === false).map((item) => normalizeAuditPath(item.resolved)));
    for (const key of targetKeys) runTargetKeys.add(key);
    perProcess.push({
      pid,
      attributed: pid !== UNATTRIBUTED,
      records: ownRecords.length,
      call_count: deleted.length + noop.length + failed.length,
      call_count_scope: 'top_level_deletion_api_calls_only',
      internal_step_records: internal.length,
      successful_deletion_calls: deleted.length,
      noop_calls: noop.length,
      failed_attempts: failed.length,
      descendant_paths_gone_observed: ownRecords.reduce((sum, item) => sum + (item.confirmed_paths_gone || 0), 0),
      confirmed_paths_gone_from_failed_calls: failed.reduce((sum, item) => sum + (item.confirmed_paths_gone || 0), 0),
      distinct_descendant_paths_gone: descendantKeys.size,
      distinct_deletion_target_paths_gone: targetKeys.size,
      distinct_confirmed_paths_gone: new Set([...descendantKeys, ...targetKeys]).size,
      unknown_outcomes: ownRecords.filter((item) => typeof item.outcome === 'string' && item.outcome.includes('unknown')).length,
    });
  }

  // Cross-check every attributed per-process number against the summary that process wrote itself.
  // Unattributed lines have no summary to compare against, so they are excluded here and counted
  // separately in the run totals.
  const crossCheck = [];
  for (const entry of perProcess) {
    if (!entry.attributed) continue;
    const declared = summaryByPid.get(entry.pid);
    if (!declared) { crossCheck.push({ pid: entry.pid, field: '*', matches: false, note: 'no per-process summary line' }); continue; }
    for (const field of ['call_count', 'successful_deletion_calls', 'noop_calls', 'failed_attempts', 'descendant_paths_gone_observed', 'distinct_descendant_paths_gone', 'distinct_deletion_target_paths_gone', 'distinct_confirmed_paths_gone', 'unknown_outcomes']) {
      crossCheck.push({ pid: entry.pid, field, declared: declared[field], recomputed: entry[field], matches: declared[field] === entry[field] });
    }
  }

  const unattributedRecords = perProcess.filter((item) => !item.attributed).reduce((sum, item) => sum + item.records, 0);

  const run = {
    processes: perProcess.filter((item) => item.attributed).length,
    pids: [...pids].filter((pid) => pid !== UNATTRIBUTED),
    unattributed_records: unattributedRecords,
    unattributed_lines_are_counted_in_totals_but_not_cross_checked: true,
    call_count: perProcess.reduce((sum, item) => sum + item.call_count, 0),
    call_count_scope: 'top_level_deletion_api_calls_only',
    internal_step_records: perProcess.reduce((sum, item) => sum + item.internal_step_records, 0),
    successful_deletion_calls: perProcess.reduce((sum, item) => sum + item.successful_deletion_calls, 0),
    noop_calls: perProcess.reduce((sum, item) => sum + item.noop_calls, 0),
    failed_attempts: perProcess.reduce((sum, item) => sum + item.failed_attempts, 0),
    descendant_paths_gone_observed: perProcess.reduce((sum, item) => sum + item.descendant_paths_gone_observed, 0),
    confirmed_paths_gone_from_failed_calls: perProcess.reduce((sum, item) => sum + item.confirmed_paths_gone_from_failed_calls, 0),
    distinct_descendant_paths_gone: runDescendantKeys.size,
    distinct_deletion_target_paths_gone: runTargetKeys.size,
    distinct_confirmed_paths_gone: new Set([...runDescendantKeys, ...runTargetKeys]).size,
    unknown_outcomes: perProcess.reduce((sum, item) => sum + item.unknown_outcomes, 0),
    dedup_key: 'normalized absolute path = canonical identity (path.resolve + lowercase; an extended-length drive path maps to the same identity as its ordinary form); pid is not part of the key',
    unparsable_log_lines: log.unparsable_lines + descendants.unparsable_lines,
  };

  return {
    per_process: perProcess,
    run,
    cross_check: crossCheck,
    cross_check_mismatches: crossCheck.filter((item) => !item.matches),
    log_path: logPath || null,
    descendant_log_path: descendantPath || null,
  };
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

export function parseArgs(argv) {
  const out = { mode: 'dry-run', flags: new Set() };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith('--mode=')) out.mode = token.slice('--mode='.length);
    else if (token === '--project-root') out.projectRoot = argv[++index];
    else if (token === '--stable-root') out.stableRoot = argv[++index];
    else if (token === '--quarantine-target') out.quarantineTarget = argv[++index];
    else if (token === '--i-understand-this-mutates') out.flags.add('mutate');
  }
  return out;
}

export function resolveDefaults(args) {
  const projectRoot = path.resolve(args.projectRoot || FIXED_PROJECT_ROOT);
  const stableRoot = path.resolve(args.stableRoot || FIXED_STABLE_ROOT);
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    projectRoot,
    stableRoot,
    cacheDirs: {
      npm: path.join(stableRoot, `npm-cache-${runId}`),
      electron: path.join(stableRoot, `electron-cache-${runId}`),
      electronBuilder: path.join(stableRoot, `electron-builder-cache-${runId}`),
    },
    tmpDir: path.join(stableRoot, `tmp-${runId}`),
    quarantineTarget: args.quarantineTarget ? path.resolve(args.quarantineTarget) : path.join(projectRoot, '.m1-quarantine', `node_modules-${runId}`),
    logDir: path.join(projectRoot, '.m1-evidence', `w4-exec-${runId}`),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const defaults = resolveDefaults(args);
  const report = { mode: args.mode, node: process.version, cwd: process.cwd(), platform: process.platform };

  // Preflight the fixed roots before creating anything at all. A missing fixed root is a hard
  // stop: nothing is rebuilt and nothing falls back to TEMP.
  const fixed = preflightFixedRoots({ stableRoot: defaults.stableRoot, projectRoot: defaults.projectRoot });
  report.fixed_root_preflight = fixed;
  if (!fixed.ok) {
    report.error = 'fixed root preflight failed';
    process.stderr.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(EXIT.ENVIRONMENT_INVALID);
  }

  if (args.mode === 'dry-run') {
    const npmCli = resolveNpmCli(process.execPath);
    report.project_root = defaults.projectRoot;
    report.stable_root = defaults.stableRoot;
    report.quarantine_target = defaults.quarantineTarget;
    report.npm_cli = npmCli;
    report.exec_path = process.execPath;
    report.node_options_preload = buildNodeOptions(GUARD_PATH, '');
    // dry-run is NOT side-effect free: the two probes below write files into a scratch directory
    // under the stable root. The same scope and ancestor checks are applied before writing.
    report.side_effects = 'dry-run writes probe stdout/stderr files into a scratch directory under the stable root; it does not touch the project or node_modules';
    report.node_modules_exists = fs.existsSync(path.join(defaults.projectRoot, 'node_modules'));
    if (report.node_modules_exists) {
      const inventory = buildInventory(path.join(defaults.projectRoot, 'node_modules'));
      report.inventory = {
        file_count: inventory.file_count, total_bytes: inventory.total_bytes,
        directory_count: inventory.directory_count, empty_directories: inventory.empty_directories.length,
        digest: inventoryDigest(inventory),
      };
    }
    // Probes need a scratch location for child stdout/stderr. Dry-run keeps it inside the stable
    // root, applies the same scope and ancestor checks, and reports the side effect explicitly.
    const probeDir = path.join(defaults.stableRoot, `dry-run-probe-${Date.now()}`);
    const probeScope = isStrictlyInside(probeDir, defaults.stableRoot);
    const probeAncestors = validateTargetAncestors([probeDir]);
    report.probe_scope = { inside_stable_root: probeScope, ancestors_ok: probeAncestors.ok, problems: probeAncestors.problems };
    if (!probeScope || !probeAncestors.ok) {
      report.error = 'dry-run probe directory failed scope validation';
      process.stderr.write(`${JSON.stringify(report, null, 2)}\n`);
      process.exit(EXIT.ENVIRONMENT_INVALID);
    }
    fs.mkdirSync(probeDir, { recursive: true });
    const probe = npmCli ? probeNpmVersion({ npmCli, env: process.env, logDir: probeDir }) : { ok: false, error: 'npm CLI not resolved' };
    report.npm_version_probe = probe;
    report.probe_dir = probeDir;
    report.audited_package_hashes = AUDITED_PACKAGE_HASHES;
    report.actual_package_hashes = Object.fromEntries(Object.keys(AUDITED_PACKAGE_HASHES).map((n) => [n, sha256File(path.join(defaults.projectRoot, n))]));
    report.note = 'dry-run: no move and no install performed, but it is NOT side-effect free - probe files were written under the stable root';
  } else if (args.mode === 'execute') {
    if (!args.flags.has('mutate')) {
      report.refused = 'execute mode requires --i-understand-this-mutates';
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.exit(EXIT.REFUSED_NO_SWITCH);
    }
    const result = runIsolatedInstall({
      mode: 'production',
      projectRoot: defaults.projectRoot,
      stableRoot: defaults.stableRoot,
      nodeModulesPath: path.join(defaults.projectRoot, 'node_modules'),
      quarantineTarget: defaults.quarantineTarget,
      cacheDirs: defaults.cacheDirs,
      tmpDir: defaults.tmpDir,
      expectedPackageHashes: AUDITED_PACKAGE_HASHES,
      commandRunner: createRealCommandRunner(),
      logDir: defaults.logDir,
    });
    report.result = result;
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(result.exitCode);
  } else {
    report.error = `unknown mode: ${args.mode}`;
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(EXIT.ENVIRONMENT_INVALID);
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function relativeOf(root, full) {
  return path.relative(root, full).split(path.sep).join('/');
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main();
