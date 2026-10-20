// FETCHCV_V2_FINAL §10: exhaustive source-table inventory, not a claim that
// domain conversion is complete. Unknown tables fail closed.
export const LEGACY_TABLES = Object.freeze({
  candidates: ['Candidate'], material_assets: ['Source', 'Document'],
  experiences: ['KnowledgeItem'], facts: ['KnowledgeItem'], jobs: ['Job', 'Source', 'Document'],
  job_profiles: ['KnowledgeItem'], interview_sources: ['Source', 'Document'],
  interview_briefs: ['Artifact', 'ArtifactVersion'], resume_versions: ['Artifact', 'ArtifactVersion'],
  portfolio_versions: ['Artifact', 'ArtifactVersion'], applications: ['Event'],
  agent_runs: ['AgentRun'], agent_messages: ['Conversation', 'Message'], agent_run_steps: ['Event'],
  agent_tasks: ['AgentRun', 'Event'], queued_agent_messages: ['Message', 'Event'],
  agent_context_snapshots: ['LegacyArchive'], agent_skills: ['SkillSnapshot'],
  mcp_server_configs: ['McpServer'], workspace_settings: ['Setting'],
  rewrite_proposals: ['ArtifactVersion', 'Event'], approvals: ['Approval'],
  tool_invocations: ['ToolCall'], version_snapshots: ['Event'], quality_reports: ['Event'],
});

export function inspectLegacySchema(db, {legacyVariant='current'} = {}) {
  const rows = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const names = rows.map(row => row.name);
  const unexpected = names.filter(name => !Object.hasOwn(LEGACY_TABLES, name) && name !== 'alembic_version');
  const missing = Object.keys(LEGACY_TABLES).filter(name => !names.includes(name));
  const knownPreInvocation=legacyVariant==='pre-tool-invocations' && missing.length===1 && missing[0]==='tool_invocations';
  if (!['current','pre-tool-invocations'].includes(legacyVariant) || unexpected.length || (missing.length && !knownPreInvocation)
    || (legacyVariant==='pre-tool-invocations' && !knownPreInvocation)) throw new Error(`legacy table mismatch: missing=${missing.join(',')}; unexpected=${unexpected.join(',')}`);
  const present=Object.keys(LEGACY_TABLES).filter(name=>names.includes(name));
  for (const name of present) {
    const columns = db.prepare(`PRAGMA table_info("${name}")`).all();
    const primary = columns.filter(column => column.pk);
    if (primary.length !== 1 || primary[0].name !== 'id') throw new Error(`legacy primary key mismatch: ${name}`);
  }
  return present;
}
