// M1 W4 subprocess-fix: deletion guard for the isolated Node install.
//
// Coverage statement
//   This is a Node preload. It patches the Node fs API surface only. It does NOT intercept
//   CPython, and it does NOT intercept native file operations performed by child processes that
//   do not inherit this environment. A clean run shows that no in-process Node fs deletion
//   outside the approved roots was observed. It does not prove that zero deletions happened
//   anywhere, and the guard's own log is not a complete filesystem event record.
//
// Fail-closed configuration
//   The allowlist, denylist, project root, stable root and mode are all required. A missing
//   variable is a hard failure at load time so that quarantine protection cannot silently
//   disappear because a variable was forgotten.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Hard limit on how many descendant paths a single recursive operation may persist.
// Exceeding it stops the process rather than silently truncating the audit.
const MAX_DESCENDANT_RECORDS = 200000;

function required(name) {
  const value = process.env[name];
  if (value === undefined || String(value).trim() === '') {
    throw new Error(`${name} is required; the guard refuses to load without it`);
  }
  return String(value);
}

function optional(name) {
  const value = process.env[name];
  return value === undefined || String(value).trim() === '' ? null : String(value);
}

function parseJsonArray(name) {
  let parsed;
  try {
    parsed = JSON.parse(required(name));
  } catch (error) {
    throw new Error(`${name} must be a JSON array: ${error.message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`${name} must be a non-empty JSON array`);
  }
  return parsed.map((item) => path.resolve(String(item)));
}

const LOG_PATH = required('M1_INSTALL_DELETE_LOG');
const DESCENDANT_PATH = optional('M1_INSTALL_DESCENDANT_LOG') || `${LOG_PATH}.descendants.jsonl`;
const MODE = required('M1_INSTALL_MODE');
const PROJECT_ROOT = path.resolve(required('M1_INSTALL_PROJECT_ROOT'));
const STABLE_ROOT = path.resolve(required('M1_INSTALL_STABLE_ROOT'));
const ALLOWED_ROOTS = parseJsonArray('M1_INSTALL_ALLOWED_ROOTS');
const DENIED_ROOTS = parseJsonArray('M1_INSTALL_DENIED_ROOTS');
const SYNTHETIC_ROOT = optional('M1_INSTALL_SYNTHETIC_ROOT')
  ? path.resolve(process.env.M1_INSTALL_SYNTHETIC_ROOT)
  : null;

if (MODE !== 'production' && MODE !== 'synthetic') {
  throw new Error(`M1_INSTALL_MODE must be 'production' or 'synthetic', got: ${MODE}`);
}

const PHASE = optional('M1_INSTALL_PHASE') || 'install';
if (PHASE !== 'probe' && PHASE !== 'install') {
  throw new Error(`M1_INSTALL_PHASE must be 'probe' or 'install', got: ${PHASE}`);
}

// ---------------------------------------------------------------------------------------------
// Path identity
// ---------------------------------------------------------------------------------------------
// Exactly one function decides what a path IS. Scope decisions, recursive-internal association,
// before/after inventories and audit dedup all key off the identity produced here, so a path written
// in an equivalent form can never be treated as two different paths.
//
// SUPPORTED
//   * ordinary drive paths:              D:\a\b          -> identity d:\a\b
//   * extended-length drive paths:       \\?\D:\a\b      -> identity d:\a\b   (explicitly equivalent)
//
// EXPLICITLY REFUSED (never converted into an ordinary path and allowed)
//   * \\.\...                    device namespace
//   * \\?\GLOBALROOT\...         global root device namespace
//   * \\?\Volume{...}\...        volume device namespace
//   * \\?\UNC\server\share\...   UNC: recognised, then refused - no network share delete rights
//   * \\server\share\...         UNC: refused for the same reason
//   * any other \\?\ form that cannot be proven equivalent to an ordinary drive path
//     (no drive letter, a '.'/'..' segment, or a component with a trailing dot or space)
//
// The '\\?\' prefix is NOT stripped blindly: it is matched exactly, the body must then be a
// drive-absolute path, and every remaining component must be free of the constructs whose meaning
// the extended namespace changes. Anything else is refused with a reason.
const EXTENDED_PREFIX = '\\\\?\\';
const DEVICE_PREFIX = '\\\\.\\';

function canonicalizePath(requested) {
  const raw = requested === undefined || requested === null ? '' : String(requested);
  const result = {
    requested: raw,
    ok: false,
    identity: null,
    fs_path: null,
    form: 'unknown',
    namespace: 'unknown',
    reason: null,
  };
  const refuse = (reason, form, namespace) => {
    result.reason = reason;
    result.form = form;
    result.namespace = namespace;
    return result;
  };

  if (raw.trim() === '') return refuse('empty path', 'empty', 'none');
  if (raw.startsWith(DEVICE_PREFIX)) return refuse(`device namespace paths are refused: ${raw}`, 'device_namespace', 'device');

  let body = raw;
  let form = 'drive';

  if (raw.startsWith(EXTENDED_PREFIX)) {
    body = raw.slice(EXTENDED_PREFIX.length);
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

  // From here the path is a drive-form path in either namespace, so the ordinary normalization is
  // the shared identity (lowercase: Windows compares case-insensitively).
  const resolved = path.resolve(body);
  result.identity = resolved.toLowerCase();
  result.fs_path = resolved;
  result.form = form;
  result.namespace = 'drive';
  result.ok = true;
  return result;
}

// Identity-based containment. A path whose form cannot be proven equivalent is never inside
// anything, so an unsupported form can only ever be refused (fail closed, never widen permission).
function isInside(child, root) {
  const childCanonical = canonicalizePath(child);
  const rootCanonical = canonicalizePath(root);
  if (!childCanonical.ok || !rootCanonical.ok) return false;
  const rel = path.relative(rootCanonical.identity, childCanonical.identity);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

function isStrictlyInside(child, root) {
  const childCanonical = canonicalizePath(child);
  const rootCanonical = canonicalizePath(root);
  if (!childCanonical.ok || !rootCanonical.ok) return false;
  return childCanonical.identity !== rootCanonical.identity && isInside(childCanonical.identity, rootCanonical.identity);
}

// Kept for callers that only need a comparison key. Unsupported forms return null so they can
// never compare equal to a supported root.
const norm = (value) => {
  const canonical = canonicalizePath(value);
  return canonical.ok ? canonical.identity : null;
}

// Preflight of the fixed roots. This runs BEFORE any log is opened or created, so a missing or
// unusable fixed root reports to stderr and exits non-zero without leaving any file behind.
function preflightFixedRoots() {
  const problems = [];
  for (const [label, root] of [['stable root', STABLE_ROOT], ['project root', PROJECT_ROOT]]) {
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
  return problems;
}

const FIXED_ROOT_PROBLEMS = preflightFixedRoots();
if (FIXED_ROOT_PROBLEMS.length > 0) {
  // No log file is touched here: the log path itself has not been validated yet.
  process.stderr.write(`${JSON.stringify({ guard: 'preflight_failed', problems: FIXED_ROOT_PROBLEMS }, null, 2)}\n`);
  process.exit(73);
}

// Ancestor validation for every target this run may write to. Each existing ancestor must be a
// directory and must not be a reparse point, so a junction cannot redirect a validated path.
//
// The target itself is checked according to its kind. An earlier version demanded that the target
// be a directory, which wrongly refused a legitimate case: the deletion log is a regular file that
// already exists by the time a later phase appends to it. A regular file at a log path is normal
// and is accepted; a reparse point or a directory at that path is still refused.
function validateTargetAncestors(targets) {
  const problems = [];
  for (const item of targets) {
    if (!item) continue;
    const spec = typeof item === 'string' ? { path: item } : item;
    if (!spec.path) continue;
    const kind = spec.kind === 'file' ? 'file' : 'directory';
    // Ancestors are walked on the canonical drive-form path: an extended-length input must not be
    // handed to lstat as-is, and an unsupported form is a refusal rather than a skipped check.
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
        if (error.code === 'ENOENT') break; // deeper ancestors simply do not exist yet
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
  return problems;
}

const QUARANTINE_ROOT = path.join(PROJECT_ROOT, '.m1-quarantine');

function validateRoots() {
  const problems = [];
  const forbidden = ['src', 'tests', 'electron'];
  for (const root of ALLOWED_ROOTS) {
    // Only drive-form paths may ever be a deletion root. An extended-length drive path is accepted
    // because it is provably equivalent; UNC and device forms are refused here as well as in
    // classify(), so no configuration can grant a network or device namespace any permission.
    const canonical = canonicalizePath(root);
    if (!canonical.ok) {
      problems.push(`allowed root uses an unsupported path form: ${root} (${canonical.reason})`);
      continue;
    }
    if (canonical.form !== 'drive' && canonical.form !== 'extended_drive') {
      problems.push(`allowed root must be a drive path: ${root}`);
      continue;
    }
    if (norm(root) === norm(PROJECT_ROOT)) problems.push(`allowed root equals the project root: ${root}`);
    if (norm(root) === norm(STABLE_ROOT)) problems.push(`allowed root equals the stable root: ${root}`);
    if (norm(root) === norm(path.parse(canonical.fs_path).root)) problems.push(`allowed root equals a filesystem root: ${root}`);
    if (isInside(PROJECT_ROOT, root) && norm(root) !== norm(PROJECT_ROOT)) problems.push(`allowed root is an ancestor of the project root: ${root}`);
    if (isInside(STABLE_ROOT, root) && norm(root) !== norm(STABLE_ROOT)) problems.push(`allowed root is an ancestor of the stable root: ${root}`);

    // The entire quarantine area is protected, not only this round's target.
    if (isInside(root, QUARANTINE_ROOT)) problems.push(`allowed root is inside the quarantine area: ${root}`);

    // Containment rule differs by mode. In production the only legitimate deletion targets are the
    // project's own node_modules and this round's scratch directories. In synthetic mode the whole
    // exercise is confined to the synthetic root, where project/cache/tmp are siblings.
    if (MODE === 'production') {
      const insideProject = isStrictlyInside(root, PROJECT_ROOT);
      const insideStable = isStrictlyInside(root, STABLE_ROOT);
      if (!insideProject && !insideStable) problems.push(`allowed root is neither inside the project nor inside the stable root: ${root}`);
      if (SYNTHETIC_ROOT && isInside(root, SYNTHETIC_ROOT)) problems.push(`production mode must not use a synthetic root: ${root}`);
      // Strict allowlist: inside the project, ONLY node_modules is a legitimate target. Being
      // "somewhere inside the project" is explicitly NOT a permission.
      if (insideProject && norm(root) !== norm(path.join(PROJECT_ROOT, 'node_modules'))) {
        problems.push(`production mode only permits the project node_modules inside the project: ${root}`);
      }
      // The pre-move probe must not already carry deletion rights over the old node_modules.
      if (PHASE === 'probe' && norm(root) === norm(path.join(PROJECT_ROOT, 'node_modules'))) {
        problems.push(`probe phase must not include node_modules in the allowlist: ${root}`);
      }
    } else {
      if (!SYNTHETIC_ROOT) problems.push('synthetic mode requires M1_INSTALL_SYNTHETIC_ROOT');
      else if (!isStrictlyInside(root, SYNTHETIC_ROOT)) problems.push(`synthetic mode only permits roots inside M1_INSTALL_SYNTHETIC_ROOT: ${root}`);
      if (!isStrictlyInside(PROJECT_ROOT, SYNTHETIC_ROOT) && norm(PROJECT_ROOT) !== norm(SYNTHETIC_ROOT)) {
        problems.push(`synthetic project root must be inside the synthetic root: ${PROJECT_ROOT}`);
      }
    }

    for (const name of forbidden) {
      const guarded = path.join(PROJECT_ROOT, name);
      if (norm(root) === norm(guarded) || isInside(guarded, root)) problems.push(`allowed root covers the protected directory ${name}: ${root}`);
    }
  }

  if (MODE === 'synthetic' && !SYNTHETIC_ROOT) problems.push('synthetic mode requires M1_INSTALL_SYNTHETIC_ROOT');

  for (const denied of DENIED_ROOTS) {
    const canonical = canonicalizePath(denied);
    if (!canonical.ok) {
      problems.push(`denied root uses an unsupported path form: ${denied} (${canonical.reason})`);
      continue;
    }
    if (norm(denied) === norm(PROJECT_ROOT)) problems.push(`denied root equals the project root: ${denied}`);
    if (norm(denied) === norm(STABLE_ROOT)) problems.push(`denied root equals the stable root: ${denied}`);
    for (const allowed of ALLOWED_ROOTS) {
      if (isInside(denied, allowed) || isInside(allowed, denied)) problems.push(`denied root ${denied} conflicts with allowed root ${allowed}`);
    }
  }
  return problems;
}

const ROOT_PROBLEMS = validateRoots();
// Ancestors of every path this guard may write to or delete from are validated before any log
// is opened, so a trailing junction cannot redirect an otherwise-validated target. The two log
// paths are regular files by design; every deletion root is a directory.
const ANCESTOR_PROBLEMS = validateTargetAncestors([
  { path: LOG_PATH, kind: 'file' },
  { path: DESCENDANT_PATH, kind: 'file' },
  ...ALLOWED_ROOTS,
  ...DENIED_ROOTS,
]);
const records = [];
let sequence = 0;

function emit(event) {
  sequence += 1;
  const record = { sequence, pid: process.pid, cwd: process.cwd(), time: new Date().toISOString(), ...event };
  records.push(record);
  fs.appendFileSync(LOG_PATH, `${JSON.stringify(record)}\n`);
  return record;
}

// ---------------------------------------------------------------------------------------------
// Pure audit aggregation
// ---------------------------------------------------------------------------------------------
// These helpers are deliberately side-effect free so the accounting rules can be exercised on
// in-memory record arrays, with no real filesystem fault of any kind.

// A single normalized absolute path is the only dedup key used anywhere in the audit. Using the
// descendant's relative path alone would merge identically named files that live in different
// deletion targets (treeA/same.txt and treeB/same.txt would collapse into one). Canonicalization
// runs through the same function as the scope check, so an equivalent spelling of the same file
// (extended-length vs ordinary drive path) also collapses into one key.
function normalizeAuditPath(value) {
  const canonical = canonicalizePath(value);
  if (canonical.ok) return canonical.identity;
  // An unsupported form is NOT merged with anything: it keeps its own raw key so it can never be
  // silently counted as an ordinary path.
  return `unsupported::${String(value).toLowerCase()}`;
}

// The key of a persisted descendant entry: deletion target root + descendant relative path, run
// through the same canonicalization used for every other path decision.
function descendantAuditKey(root, entry) {
  const relative = String(entry).split('\u0000')[0];
  return normalizeAuditPath(path.join(String(root), relative));
}

// "Unknown" means the audit could not determine what happened, as opposed to a partial deletion
// whose vanished paths were actually observed. failed_unknown_after belongs here: the call failed
// AND the post-deletion listing could not be read.
function outcomeIsUnknown(outcome) {
  return typeof outcome === 'string' && outcome.includes('unknown');
}

// Per-process aggregation. Only records and descendant lines belonging to `pid` are counted: a
// shared log file can contain lines written by other processes, and those must never leak into a
// per-process summary. The whole-run (cross-PID) rollup is computed separately, elsewhere.
function summarizeRecords({ records: recordList = [], descendantLines = [], pid = process.pid } = {}) {
  const own = recordList.filter((item) => (item && item.pid) === pid);
  const deleted = own.filter((item) => item.event === 'deleted');
  const noop = own.filter((item) => item.event === 'noop');
  const failed = own.filter((item) => item.event === 'attempt_failed');
  const blocked = own.filter((item) => item.event === 'blocked');
  const internal = own.filter((item) => item.event === 'internal_step');
  const unknown = own.filter((item) => outcomeIsUnknown(item.outcome));

  const withGone = own.filter((item) => typeof item.confirmed_paths_gone === 'number');
  const descendantPathsObserved = withGone.reduce((sum, item) => sum + item.confirmed_paths_gone, 0);

  const ownLines = (descendantLines || []).filter((line) => line && line.pid === pid && line.phase !== 'pre_deletion');
  const descendantKeys = new Set();
  for (const line of ownLines) {
    for (const entry of line.entries || []) descendantKeys.add(descendantAuditKey(line.resolved, entry));
  }

  // Deletion targets that are confirmed gone: the roots of recursive calls plus single-file
  // deletions. A target is counted only when it existed before the call and no longer exists after
  // it, so a failed partial deletion contributes its vanished descendants but not its root.
  const vanishedTargets = own.filter((item) => item.existed_before === true && item.exists_after === false);
  const targetKeys = new Set(vanishedTargets.map((item) => normalizeAuditPath(item.resolved)));

  const allPaths = new Set([...descendantKeys, ...targetKeys]);
  const outcomeCounts = {};
  for (const item of own) {
    if (typeof item.outcome !== 'string') continue;
    outcomeCounts[item.outcome] = (outcomeCounts[item.outcome] || 0) + 1;
  }

  return {
    pid,
    // Records counted here are only this process's records.
    records_counted: own.length,
    pid_filter_applied: true,
    // call_count counts TOP-LEVEL deletion API calls only (success + noop + failure). Calls made
    // internally by a recursive removal (internal_step) are counted separately and are NOT part of
    // this number; api_calls_total_including_internal_steps is the figure that includes them.
    call_count: deleted.length + noop.length + failed.length,
    call_count_scope: 'top_level_deletion_api_calls_only',
    internal_step_records: internal.length,
    api_calls_total_including_internal_steps: deleted.length + noop.length + failed.length + internal.length,
    successful_deletion_calls: deleted.length,
    successful_deletions: deleted.length,
    noop_calls: noop.length,
    failed_attempts: failed.length,
    blocked_out_of_scope: blocked.length,
    // Path accounting, in two clearly separated layers.
    descendant_paths_gone_observed: descendantPathsObserved,
    confirmed_paths_gone_from_failed_calls: failed.reduce((sum, item) => sum + (item.confirmed_paths_gone || 0), 0),
    distinct_descendant_paths_gone: descendantKeys.size,
    deletion_targets_confirmed_gone: vanishedTargets.length,
    distinct_deletion_target_paths_gone: targetKeys.size,
    // Descendants plus deletion targets, still deduplicated by normalized absolute path. This is
    // the total number of distinct paths observed to have disappeared, not just descendants.
    distinct_confirmed_paths_gone: allPaths.size,
    dedup_key: 'normalized absolute path = canonical identity (path.resolve + lowercase; an extended-length drive path maps to the same identity as its ordinary form), deletion-target root joined with the descendant relative path',
    // Distinct top-level deletion targets that were attempted at all (success + noop + failure).
    distinct_deletion_targets_attempted: new Set([...deleted, ...noop, ...failed].map((item) => normalizeAuditPath(item.resolved))).size,
    unique_paths_deleted: new Set(deleted.map((item) => normalizeAuditPath(item.resolved))).size,
    paths_indeterminate: own.reduce((sum, item) => sum + (item.paths_indeterminate || 0), 0),
    unknown_outcomes: unknown.length,
    unknown_outcome_names: [...new Set(unknown.map((item) => item.outcome))].sort(),
    outcome_counts: outcomeCounts,
    recursive_calls: deleted.filter((item) => item.recursive).length,
    recursive_failed_calls: failed.filter((item) => item.recursive).length,
  };
}

function persistDescendants(operation, resolved, entries) {
  if (entries.length > MAX_DESCENDANT_RECORDS) {
    emit({ event: 'guard_aborted', reason: 'descendant record limit exceeded', operation, resolved, count: entries.length, limit: MAX_DESCENDANT_RECORDS });
    process.exit(79);
  }
  fs.appendFileSync(DESCENDANT_PATH, `${JSON.stringify({ pid: process.pid, time: new Date().toISOString(), operation, resolved, count: entries.length, entries })}\n`);
}

// Configuration refusal happens BEFORE the log is opened: an invalid configuration must not
// leave a log file behind, and the reason belongs on stderr where a supervisor can read it.
if (ROOT_PROBLEMS.length > 0 || ANCESTOR_PROBLEMS.length > 0) {
  process.stderr.write(`${JSON.stringify({
    guard: 'refused',
    mode: MODE,
    phase: PHASE,
    root_problems: ROOT_PROBLEMS,
    ancestor_problems: ANCESTOR_PROBLEMS,
    allowed_roots: ALLOWED_ROOTS,
    denied_roots: DENIED_ROOTS,
    log_path: LOG_PATH,
    log_written: false,
  }, null, 2)}\n`);
  process.exit(78);
}

// The path a filesystem call should use, plus the realpath-based reparse defence. The reparse
// check is best effort but can never widen permission: if it succeeds and the resolved parent
// differs, the caller still runs the ordinary scope check on the resolved location, and if it
// fails the string identity (already canonical) is used unchanged.
function resolveFilesystemPath(canonical) {
  let realParent = null;
  let realpathOk = false;
  try {
    const parent = path.dirname(canonical.fs_path);
    if (fs.existsSync(parent)) {
      realParent = fs.realpathSync(parent);
      realpathOk = true;
    }
  } catch {
    realParent = null;
    realpathOk = false;
  }
  return realpathOk ? { fs_path: path.join(realParent, path.basename(canonical.fs_path)), realpath_ok: true } : { fs_path: canonical.fs_path, realpath_ok: false };
}

// Kept for callers that want the resolved path as a plain string.
function normalizeTarget(target) {
  const canonical = canonicalizePath(target);
  if (!canonical.ok) return canonical.requested;
  return resolveFilesystemPath(canonical).fs_path;
}

// The requested raw string and the canonical result are both preserved, so a reviewer can see
// exactly what was asked for and what it was understood to be.
function classify(rawTarget) {
  const canonical = canonicalizePath(rawTarget);
  if (!canonical.ok) {
    return { ...canonical, resolved: canonical.fs_path || canonical.requested, verdict: 'unsupported_path_form' };
  }
  const filesystem = resolveFilesystemPath(canonical);
  const resolved = filesystem.fs_path;
  const base = {
    ...canonical,
    resolved,
    canonical_identity: canonical.identity,
    realpath_ok: filesystem.realpath_ok,
  };
  for (const root of DENIED_ROOTS) if (isInside(resolved, root)) return { ...base, verdict: 'denied' };
  for (const root of ALLOWED_ROOTS) if (isInside(resolved, root)) return { ...base, verdict: 'allowed' };
  return { ...base, verdict: 'out_of_scope' };
}

// A bounded call stack is attached to blocked/aborted diagnostics so the caller can be identified.
// It contains only file paths and function names from this process - never environment variables,
// and never any configuration value.
function diagnosticStack() {
  const stack = new Error('guard diagnostic').stack || '';
  return stack.split('\n').slice(1, 13).map((line) => line.trim().slice(0, 300));
}

function admit(rawTarget, operation) {
  const verdict = classify(rawTarget);
  if (verdict.verdict !== 'allowed') {
    emit({
      event: 'blocked',
      operation,
      // Both forms are recorded: what was requested, and what it was canonicalized to.
      requested: verdict.requested,
      requested_form: verdict.form,
      requested_namespace: verdict.namespace,
      resolved: verdict.resolved,
      canonical_identity: verdict.canonical_identity || null,
      realpath_ok: verdict.realpath_ok === undefined ? null : verdict.realpath_ok,
      verdict: verdict.verdict,
      reason: verdict.verdict === 'unsupported_path_form'
        ? `path form cannot be proven equivalent to an ordinary drive path: ${verdict.reason}`
        : 'target outside approved install roots',
      caller_stack: diagnosticStack(),
      caller_stack_note: 'bounded to this process; contains no environment or secret values',
    });
    process.exit(86);
  }
  return verdict;
}

// Reads the full descendant inventory. Distinguishes "does not exist" from "exists but cannot
// be read": the latter must stop the operation rather than being treated as an empty tree.
function readTree(target) {
  const canonical = canonicalizePath(target);
  if (!canonical.ok) {
    return { state: 'unsupported_form', entries: [], error_code: 'UNSUPPORTED_PATH_FORM', error_message: canonical.reason };
  }
  const root = canonical.fs_path;
  let rootStat;
  try {
    rootStat = fs.lstatSync(root);
  } catch (error) {
    if (error.code === 'ENOENT') return { state: 'absent', entries: [] };
    return { state: 'unreadable', entries: [], error_code: error.code || null, error_message: error.message };
  }
  if (!rootStat.isDirectory()) return { state: 'present_single', entries: [`${path.basename(root)}\u0000${rootStat.isFile() ? 'file' : 'other'}`] };

  const entries = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let children;
    try {
      children = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      return { state: 'unreadable', entries, error_code: error.code || null, error_message: error.message, failed_at: current };
    }
    for (const child of children) {
      const full = path.join(current, child.name);
      let type = 'unknown';
      try {
        const st = fs.lstatSync(full);
        type = st.isDirectory() ? 'directory' : st.isFile() ? 'file' : st.isSymbolicLink() ? 'symlink' : 'other';
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        return { state: 'unreadable', entries, error_code: error.code || null, error_message: error.message, failed_at: full };
      }
      entries.push(`${path.relative(root, full).split(path.sep).join('/')}\u0000${type}`);
      if (entries.length > MAX_DESCENDANT_RECORDS) return { state: 'too_large', entries };
      if (type === 'directory') stack.push(full);
    }
  }
  entries.sort();
  return { state: 'present_tree', entries };
}

// Recursive is decided from the ACTUAL call arguments. Callback-style rm/rmdir pass the callback
// as the final argument, so it must be skipped before inspecting the options object.
function isRecursiveCall(name, args) {
  if (!['rm', 'rmSync', 'rmdir', 'rmdirSync'].includes(name)) return false;
  const rest = args.filter((item) => typeof item !== 'function');
  const options = rest.length > 0 ? rest[rest.length - 1] : undefined;
  if (options && typeof options === 'object' && options.recursive === true) return true;
  return false;
}

// Pure tree-difference helper. Exported so the partial-failure contract can be verified entirely
// in memory, without deleting anything from disk.
function diffTreeEntries(beforeEntries, afterEntries) {
  const afterSet = new Set(afterEntries || []);
  const beforeSet = new Set(beforeEntries || []);
  return {
    confirmed_gone: (beforeEntries || []).filter((entry) => !afterSet.has(entry)),
    still_present: (beforeEntries || []).filter((entry) => afterSet.has(entry)),
    appeared: (afterEntries || []).filter((entry) => !beforeSet.has(entry)),
  };
}

function finishRecord({ event, operation, resolved, requested, canonicalIdentity, existedBefore, recursive, before, error, target }) {
  let gone = null;
  let remaining = null;
  let indeterminate = null;
  let after = null;
  let outcome;
  const unreadableBefore = Boolean(before && (before.state === 'unreadable' || before.state === 'unsupported_form'));

  if (unreadableBefore) {
    outcome = 'unknown_unreadable_before';
  } else if (!existedBefore && !error) {
    outcome = 'noop_target_absent';
  } else if (recursive) {
    // A feasible post-deletion pass runs for recursive calls whether the call succeeded OR threw,
    // so a partially completed removal is still fully accounted for.
    const post = readTree(target);
    if (post.state === 'too_large') {
      outcome = 'unknown_too_large_after';
      indeterminate = post.entries.length;
    } else if (post.state === 'unreadable' || post.state === 'unsupported_form') {
      outcome = error ? 'failed_unknown_after' : 'unknown_unreadable_after';
      indeterminate = (before.entries || []).length;
    } else {
      const diff = diffTreeEntries(before.entries, post.entries);
      gone = diff.confirmed_gone;
      remaining = diff.still_present;
      after = { state: post.state, count: post.entries.length };
      if (gone.length > 0) persistDescendants(operation, resolved, gone);
      if (error) outcome = gone.length > 0 ? 'failed_partial_deletion' : 'failed_nothing_deleted';
      else outcome = gone.length === before.entries.length ? 'recursive_all_gone' : gone.length === 0 ? 'recursive_none_gone' : 'recursive_partial';
    }
  } else {
    outcome = error ? 'failed' : 'single_path';
  }

  emit({
    event,
    operation,
    // Both the raw request and the canonical identity are recorded, so an equivalent form can
    // never look like a different path during review or dedup.
    requested: requested === undefined ? null : requested,
    requested_form: canonicalIdentity ? canonicalIdentity.form : null,
    resolved,
    canonical_identity: canonicalIdentity ? canonicalIdentity.identity : null,
    existed_before: existedBefore,
    exists_after: fs.existsSync(resolved),
    recursive,
    before_state: before ? before.state : null,
    descendants_before: before ? before.entries.length : null,
    descendants_after: after && typeof after.count === 'number' ? after.count : null,
    confirmed_paths_gone: gone ? gone.length : null,
    confirmed_paths_remaining: remaining ? remaining.length : null,
    paths_indeterminate: indeterminate,
    confirmed_paths_log: gone && gone.length > 0 ? DESCENDANT_PATH : null,
    outcome,
    // The original error is preserved, never replaced by the audit result.
    error_name: error ? error.name : null,
    error_code: error && error.code ? error.code : null,
  });
}

// Re-entrancy suppression. fs.rm/fs.rmSync implement their tree walk by calling the very
// primitives this guard also patches (unlink/rmdir). Without suppression those internal calls
// would each be logged, inflating the deletion count and hiding the real one-call-per-target
// shape of the audit. Nested calls are passed straight through: the outer call already passed
// the scope check for the whole subtree.
// Suppression of self-inflicted nested calls.
//
// fs.rm implements its tree walk by calling the same unlink/rmdir primitives this guard patches.
// A plain recursion-depth counter does NOT work here: callback APIs return before their internals
// run, so two overlapping async rm calls would leave the counter raised and cause the second
// top-level call to be misclassified as nested and skipped entirely.
//
// Instead we track the set of paths currently being removed recursively. Any call targeting a path
// inside an active recursive root is an internal step of that operation and is passed through
// without a separate record. A top-level call is never suppressed by its own root because the
// check runs before the root is registered.
// Active recursive roots are keyed by canonical IDENTITY (not by the string that was passed in), so
// a removal started with an extended-length path still recognises its own internal steps, and two
// equivalent spellings never register as two different roots. The map value keeps the canonical
// filesystem path for readable diagnostics.
const activeRecursiveRoots = new Map();
let internalSuppressedCalls = 0;
let internalSuppressedRecorded = 0;
const MAX_INTERNAL_RECORDS = 5000;

function activeRootFor(canonical) {
  if (!canonical.ok) return null;
  for (const identity of activeRecursiveRoots.keys()) {
    if (isInside(canonical.identity, identity)) return identity;
  }
  return null;
}

// Suppression never bypasses the scope check. A suppressed (internal) call is still validated
// against the allow/deny lists, so a nested call cannot reach outside the approved roots. It is
// only the ordinary deletion record that is skipped, and the association is still counted and
// (bounded) recorded so call counts and deduplicated path counts can both be reported.
function beginWrap(canonical, registerRoot, operation) {
  const owner = activeRootFor(canonical);
  if (owner) {
    admit(canonical.requested, operation); // scope validation still applies to internal calls
    internalSuppressedCalls += 1;
    if (internalSuppressedRecorded < MAX_INTERNAL_RECORDS) {
      internalSuppressedRecorded += 1;
      // Same monotonic sequence generator as every other record, so sequence numbers are unique
      // and ordered across deletion records and internal steps alike.
      emit({
        event: 'internal_step',
        operation,
        requested: canonical.requested,
        resolved: canonical.fs_path || canonical.requested,
        canonical_identity: canonical.identity,
        associated_root: activeRecursiveRoots.get(owner),
      });
    }
    return { suppressed: true, registered: null };
  }
  const registered = registerRoot && canonical.ok ? canonical.identity : null;
  if (registered) activeRecursiveRoots.set(registered, canonical.fs_path);
  return { suppressed: false, registered };
}

function endWrap(state) {
  if (state && state.registered) activeRecursiveRoots.delete(state.registered);
}

// A target that cannot be fully read before a recursive deletion must NOT be deleted. The full
// pre-deletion listing is persisted first so a partial removal can be reconciled after an
// interruption, not only after a clean return.
//
// `canonical` is the already-validated canonical form: the path handed to the filesystem is the
// canonical drive-form path, and the pre-deletion listing is persisted under that same identity so
// a removal started with an extended-length path is reconciled against ordinary paths.
function preflight(canonical, recursive) {
  if (!recursive) return null;
  const tree = readTree(canonical.fs_path);
  if (tree.state === 'unreadable' || tree.state === 'unsupported_form') {
    emit({
      event: 'guard_aborted',
      reason: tree.state === 'unsupported_form' ? 'target path form cannot be proven equivalent before recursive deletion' : 'target unreadable before recursive deletion',
      requested: canonical.requested,
      resolved: canonical.fs_path,
      canonical_identity: canonical.identity,
      error_code: tree.error_code || null,
      caller_stack: diagnosticStack(),
      caller_stack_note: 'bounded to this process; contains no environment or secret values',
    });
    process.exit(80);
  }
  if (tree.state === 'too_large') {
    emit({ event: 'guard_aborted', reason: 'descendant record limit exceeded during preflight', requested: canonical.requested, resolved: canonical.fs_path, canonical_identity: canonical.identity, count: tree.entries.length });
    process.exit(79);
  }
  fs.appendFileSync(DESCENDANT_PATH, `${JSON.stringify({ pid: process.pid, time: new Date().toISOString(), phase: 'pre_deletion', operation: 'preflight', requested: canonical.requested, resolved: canonical.fs_path, canonical_identity: canonical.identity, count: tree.entries.length, entries: tree.entries })}\n`);
  return tree;
}

function wrapSync(name) {
  const original = fs[name];
  if (typeof original !== 'function') return;
  fs[name] = function guarded(target, ...args) {
    const canonical = canonicalizePath(target);
    const recursive = isRecursiveCall(name, args);
    const state = beginWrap(canonical, recursive, name);
    if (state.suppressed) return original.call(fs, target, ...args);
    try {
      const verdict = admit(target, name);
      // The filesystem call itself is made with the ORIGINAL argument (the OS may accept forms the
      // guard only understands for comparison), but every observation - existence, inventory,
      // persistence - uses the canonical drive-form path so all of them share one identity.
      const observed = verdict.resolved;
      const existedBefore = fs.existsSync(observed);
      const before = preflight(verdict, recursive);
      let error = null;
      try {
        return original.call(fs, target, ...args);
      } catch (caught) {
        error = caught;
        throw caught;
      } finally {
        const event = error ? 'attempt_failed' : existedBefore ? 'deleted' : 'noop';
        finishRecord({ event, operation: name, resolved: observed, requested: verdict.requested, canonicalIdentity: verdict, existedBefore, recursive, before, error, target: observed });
      }
    } finally {
      endWrap(state);
    }
  };
}

function wrapCallback(name) {
  const original = fs[name];
  if (typeof original !== 'function') return;
  fs[name] = function guarded(target, ...args) {
    const canonical = canonicalizePath(target);
    const recursive = isRecursiveCall(name, args);
    const state = beginWrap(canonical, recursive, name);
    if (state.suppressed) return original.call(fs, target, ...args);
    let released = false;
    const release = () => { if (!released) { released = true; endWrap(state); } };
    let observed;
    let verdict;
    let existedBefore;
    let before;
    try {
      verdict = admit(target, name);
      observed = verdict.resolved;
      existedBefore = fs.existsSync(observed);
      before = preflight(verdict, recursive);
    } catch (setupError) {
      release();
      throw setupError;
    }
    const callback = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    let result;
    try {
      result = original.call(fs, target, ...args, (error, ...values) => {
        const event = error ? 'attempt_failed' : existedBefore ? 'deleted' : 'noop';
        try {
          finishRecord({ event, operation: name, resolved: observed, requested: verdict.requested, canonicalIdentity: verdict, existedBefore, recursive, before, error, target: observed });
        } finally {
          release();
          if (callback) callback(error, ...values);
        }
      });
    } catch (caught) {
      // A synchronous throw from the call itself must still be audited.
      try {
        finishRecord({ event: 'attempt_failed', operation: name, resolved: observed, requested: verdict.requested, canonicalIdentity: verdict, existedBefore, recursive, before, error: caught, target: observed });
      } finally {
        release();
      }
      throw caught;
    }
    return result;
  };
}

function wrapPromise(name) {
  if (!fs.promises || typeof fs.promises[name] !== 'function') return;
  const original = fs.promises[name];
  fs.promises[name] = async function guarded(target, ...args) {
    const canonical = canonicalizePath(target);
    const recursive = isRecursiveCall(name, args);
    const state = beginWrap(canonical, recursive, name);
    if (state.suppressed) return original.call(fs.promises, target, ...args);
    try {
      const verdict = admit(target, name);
      const observed = verdict.resolved;
      const existedBefore = fs.existsSync(observed);
      const before = preflight(verdict, recursive);
      let error = null;
      try {
        return await original.call(fs.promises, target, ...args);
      } catch (caught) {
        error = caught;
        throw caught;
      } finally {
        const event = error ? 'attempt_failed' : existedBefore ? 'deleted' : 'noop';
        finishRecord({ event, operation: `promises.${name}`, resolved: observed, requested: verdict.requested, canonicalIdentity: verdict, existedBefore, recursive, before, error, target: observed });
      }
    } finally {
      endWrap(state);
    }
  };
}

['unlinkSync', 'rmdirSync', 'rmSync'].forEach(wrapSync);
['unlink', 'rmdir', 'rm'].forEach(wrapCallback);
['unlink', 'rmdir', 'rm'].forEach(wrapPromise);

try {
  const { syncBuiltinESMExports } = require('node:module');
  if (typeof syncBuiltinESMExports === 'function') syncBuiltinESMExports();
} catch {
  // Best effort; the CJS surface above is already patched.
}

emit({
  event: 'guard_start',
  mode: MODE,
  allowed_roots: ALLOWED_ROOTS,
  denied_roots: DENIED_ROOTS,
  project_root: PROJECT_ROOT,
  stable_root: STABLE_ROOT,
  // Emitted only after the configuration passed validation, so this doubles as a load probe:
  // if the guard refuses, the process exits 78 and this line never appears.
  guard_loaded: true,
  coverage_limit: 'in-process Node fs API only; CPython and native child-process operations are not intercepted',
});

let summaryWritten = false;

function readDescendantLines() {
  if (!fs.existsSync(DESCENDANT_PATH)) return [];
  const lines = [];
  for (const line of fs.readFileSync(DESCENDANT_PATH, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      lines.push(JSON.parse(line));
    } catch {
      // A truncated final line must not break the summary.
    }
  }
  return lines;
}

function writeSummary(reason) {
  if (summaryWritten) return;
  summaryWritten = true;
  // The per-process summary is computed from THIS process's records only. Descendant lines that
  // belong to other processes (the log path can be shared) are filtered out by pid inside
  // summarizeRecords. The whole-run, cross-PID rollup is a separate calculation, not this one.
  const aggregate = summarizeRecords({ records, descendantLines: readDescendantLines(), pid: process.pid });

  const summary = {
    // Same monotonic sequence generator as every other record in this log.
    sequence: (sequence += 1),
    event: 'summary',
    pid: process.pid,
    reason,
    mode: MODE,
    phase: PHASE,
    cwd: process.cwd(),
    time: new Date().toISOString(),
    ...aggregate,
    internal_suppressed_calls: internalSuppressedCalls,
    internal_suppressed_recorded: internalSuppressedRecorded,
    internal_recording_truncated: internalSuppressedCalls > internalSuppressedRecorded,
    descendant_log: DESCENDANT_PATH,
    limitation: 'This summary covers this process only (pid-scoped). Counts come from in-process Node fs API records: native operations and child processes that do not inherit this environment are not covered. call_count is top-level deletion API calls only; internal steps taken by a recursive removal are reported separately. A recursive call cannot be counted as a specific number of files; the *_paths_gone fields are bounded observations of paths that disappeared, not a guarantee about every file. The whole-run rollup is computed separately across pids.',
    counts_derived_from: LOG_PATH,
  };
  fs.appendFileSync(LOG_PATH, `${JSON.stringify(summary)}\n`);
}

process.on('exit', (code) => writeSummary(`process_exit_${code}`));
process.on('SIGINT', () => { writeSummary('sigint'); process.exit(130); });
process.on('SIGTERM', () => { writeSummary('sigterm'); process.exit(143); });

module.exports = {
  classify,
  classifyForTest: classify,
  isInside,
  isStrictlyInside,
  normalizeTarget,
  isRecursiveCall,
  readTree,
  diffTreeEntries,
  validateTargetAncestors,
  // Pure aggregation surface, exercised with in-memory records and no filesystem faults.
  normalizeAuditPath,
  descendantAuditKey,
  outcomeIsUnknown,
  summarizeRecords,
  // Path identity surface, exercised with in-memory strings and no filesystem operations.
  canonicalizePath,
  resolveFilesystemPath,
};
