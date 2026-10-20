import {ContractError} from '../contracts/runtime.mjs';
import {upgradeMemoryEvidence} from './memory-evidence.mjs';

export function upgradeMemoryTime(db,from){
  if(![0,1,2,3].includes(from))throw new ContractError('unsupported_feature_schema');
  if(from<3)upgradeMemoryEvidence(db,from);
  db.exec(`ALTER TABLE Memory ADD COLUMN activated_at TEXT;
    ALTER TABLE Memory ADD COLUMN time_basis TEXT NOT NULL DEFAULT 'explicit_or_unknown'
      CHECK(time_basis IN ('explicit_or_unknown','legacy_start_unclassified'));
    UPDATE Memory SET time_basis='legacy_start_unclassified';`);
  // No invented activation timestamp: old valid_from is retained verbatim;
  // only an existing confirmation audit event can establish authorization time.
  for(const row of db.prepare('SELECT id,workspace_id FROM Memory').all()){
    const event=db.prepare("SELECT timestamp FROM Event WHERE workspace_id=? AND entity_id=? AND type='memory.confirmed' ORDER BY sequence LIMIT 1").get(row.workspace_id,row.id);
    if(event)db.prepare('UPDATE Memory SET activated_at=? WHERE id=?').run(event.timestamp,row.id);
  }
}

export const effectiveMemoryStart=row=>row.valid_from??row.activated_at;
export const MEMORY_VALID_SQL=`(status='active' OR status='superseded' AND valid_to IS NOT NULL)
 AND coalesce(valid_from,activated_at) IS NOT NULL AND coalesce(valid_from,activated_at)<=?
 AND (valid_to IS NULL OR valid_to>?)`;
