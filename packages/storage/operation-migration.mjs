import { randomUUID } from 'node:crypto';
import { OPERATION_SCHEMA } from './operation-schema.mjs';
import { projectionContext, utc } from './projection-context.mjs';
import { canonicalJSON } from './legacy-archive.mjs';
import { contentHash } from './blob-store.mjs';
import { assertIntegrity } from './snapshot.mjs';

export function projectOperations(db) {
  const c = projectionContext(db), invocations = c.rows('tool_invocations');
  const runId = row => row.run_id ? c.mapped('agent_runs', row.run_id, 'AgentRun') : null;
  db.exec('SAVEPOINT operation_projection');
  try {
    db.exec(OPERATION_SCHEMA);
    for (const row of invocations) {
      const run = runId(row);
      const state = ['running','unknown'].includes(row.status) ? 'unknown' : ['completed','failed','cancelled'].includes(row.status) ? row.status : 'interrupted';
      const result = canonicalJSON({ schemaVersion: 1, legacyResult: row.result_json, providerCallId: row.provider_call_id });
      const values = { ...c.base(row), run_id: run, call_id: `legacy:${row.id}`, invocation_id: randomUUID(), tool_id: row.tool_name, tool_revision: 'legacy-unknown',
        operation_hash: contentHash(canonicalJSON([c.workspace, run, row.operation_id, row.arguments_hash, 'legacy-history-only'])),
        args_json: canonicalJSON({ schemaVersion: 1, legacySummary: row.arguments_summary, completeArgumentsKnown: false }),
        target_json: '{"schemaVersion":1,"binding":"legacy_unverified"}', state, result_json: result,
        receipt_hash: state === 'completed' ? contentHash(result) : null, started_at: null, ended_at: null,
        error_json: canonicalJSON(row.error_json), policy_revision: 'legacy-history-only' };
      c.insert('ToolCall', values); c.map('tool_invocations', row, 'ToolCall', values.id);
    }
    for (const row of c.rows('approvals')) {
      const matches = invocations.filter(item => item.run_id === row.run_id && item.operation_id === row.target_id);
      if (matches.length === 1) {
        const call = db.prepare('SELECT * FROM ToolCall WHERE id=?').get(c.mapped('tool_invocations', matches[0].id, 'ToolCall'));
        const values = { ...c.base(row), tool_call_id: call.id, operation_hash: call.operation_hash,
          decision: row.status === 'rejected' ? 'rejected' : 'expired', actor: row.approved_by || 'legacy-unknown',
          decided_at: row.approved_at ? utc(row.approved_at) : null, expires_at: utc(row.updated_at),
          scope_json: canonicalJSON({ schemaVersion: 1, legacyStatus: row.status, historicalOnly: true }), policy_revision: 'legacy-history-only' };
        c.insert('Approval', values); c.map('approvals', row, 'Approval', values.id);
      } else {
        c.insert('MigrationIssue', { id: randomUUID(), migration_id: c.migration.id, old_table: 'approvals', old_id: row.id,
          code: 'legacy_approval_without_exact_invocation', detail_json: '{"resolution":"read-only archive and event; never authorize"}' });
      }
      c.event('approvals', row, 'legacy_approval_history', { legacyStatus: row.status, activeAuthorization: false }, runId(row));
    }
    for (const table of ['applications','agent_run_steps','agent_tasks','queued_agent_messages','agent_context_snapshots','version_snapshots','quality_reports']) for (const row of c.rows(table)) {
      if (table === 'applications') {
        const scope = c.scope(row);
        if (row.submitted_at) db.prepare('UPDATE Job SET applied_at=coalesce(applied_at,?) WHERE workspace_id=? AND id=?').run(utc(row.submitted_at), c.workspace, scope.job_id);
      }
      if (table === 'agent_tasks') {
        // Task execution lives under the already interrupted/completed old run;
        // never recreate the worker lease or enqueue a runnable task.
        c.map(table, row, 'AgentRun', runId(row));
      }
      c.event(table, row, `legacy_${table}`, { legacyStatus: row.status ?? null, automaticExecution: false,
        ...(table === 'agent_tasks' ? { leaseOwner: null, attempt: row.attempt } : {}),
        ...(table === 'quality_reports' ? { evaluatorRevision: 'legacy-unknown' } : {}) }, runId(row));
    }
    assertIntegrity(db); db.exec('RELEASE operation_projection');
    return { stage: 'operations_projected', activationAllowed: false,
      historicalIssues: db.prepare('SELECT count(*) AS n FROM MigrationIssue').get().n };
  } catch (error) { db.exec('ROLLBACK TO operation_projection; RELEASE operation_projection'); throw error; }
}
