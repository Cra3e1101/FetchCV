import {ContractError} from '../contracts/runtime.mjs';
export const FEATURE_REVISIONS={memory:4,search:2,personal_fact:1,extensions:1,mcp:1};
export function verifyFeatureSchemas(db){
  if(!db.prepare("SELECT name FROM sqlite_schema WHERE name='FeatureSchema'").get())return;
  for(const row of db.prepare('SELECT feature,revision FROM FeatureSchema').all())
    if(FEATURE_REVISIONS[row.feature]!==row.revision&&!(row.feature==='memory'&&[1,2,3].includes(row.revision))&&!(row.feature==='search'&&row.revision===1))throw new ContractError('unsupported_feature_schema');
}
export function ensureFeatureSchema(db,feature,ddl,upgrade){
  const revision=FEATURE_REVISIONS[feature];if(!revision)throw new ContractError('unsupported_feature_schema');
  db.exec('SAVEPOINT feature_schema');
  try{
    db.exec('CREATE TABLE IF NOT EXISTS FeatureSchema(feature TEXT PRIMARY KEY,revision INTEGER NOT NULL,created_at TEXT NOT NULL) STRICT');
    verifyFeatureSchemas(db);
    const existing=db.prepare('SELECT revision FROM FeatureSchema WHERE feature=?').get(feature);
    if(!existing){db.exec(ddl);upgrade?.(db,0);db.prepare('INSERT INTO FeatureSchema VALUES (?,?,?)').run(feature,revision,new Date().toISOString());}
    else if(existing.revision!==revision){
      if(!upgrade)throw new ContractError('unsupported_feature_schema');
      upgrade(db,existing.revision);
      db.prepare('UPDATE FeatureSchema SET revision=? WHERE feature=?').run(revision,feature);
    }
    db.exec('RELEASE feature_schema');
  }catch(error){db.exec('ROLLBACK TO feature_schema; RELEASE feature_schema');throw error;}
}
