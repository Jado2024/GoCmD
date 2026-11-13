'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const directory=require('../src/lib/user-directory.cjs');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gocmd-admin-p3-'));
const dbFile=path.join(tmp,'demo.db');
fs.copyFileSync(path.join(__dirname,'../db/custom.db'),dbFile);
// P5.15.20 : la base livrée contient les 9 comptes de démonstration (référence
// P5.15.7+, attestée par scripts/verify_demo_base_p51517.py). Le bootstrap exige
// un annuaire vide : on ne vide que les tables de comptes de la COPIE temporaire
// (jamais de l'originale) pour rétablir la précondition d'origine.
{const wipe=new DatabaseSync(dbFile);
 wipe.exec('DELETE FROM GoCmdSession; DELETE FROM GoCmdUser;');wipe.close();}
process.env.GOCMD_DB_FILE=dbFile;
const rootPassword='Test-Local!Sodepi_2026';
try {
  const root=directory.bootstrap('administrateur',rootPassword);
  assert.deepEqual(root.roles,['admin'],'Bootstrap must be admin-only');
  assert.equal(directory.allowed(['admin'],{},'finance.purchases',true),false,'Root must never inherit finance');
  assert.equal(directory.allowed(['admin'],{},'sales.orders',true),false,'Root must never inherit sales');
  assert.equal(directory.allowed(['admin'],{},'users.manage',true),true);
  assert.equal(directory.allowed(['admin'],{},'director.prices',true),false);
  assert.equal(directory.readUser('administrateur').isRoot,true);

  const one=directory.createSession('administrateur');
  assert.ok(one.token.length>40);
  assert.equal(directory.readSession(one.token).username,'administrateur');
  assert.equal(directory.readSession('totally-invalid'),null);
  assert.equal(directory.revokeSession(one.token),true);
  assert.equal(directory.readSession(one.token),null,'Logout must immediately revoke cookie token');
  assert.equal(directory.revokeSession(one.token),false);

  directory.createUser('administrateur','acheteurtest','Acheteur-Local!2026',['buyer','receiver'],{});
  const buyer=directory.createSession('acheteurtest');
  assert.deepEqual(directory.readSession(buyer.token).roles,['buyer','receiver']);
  directory.updateUser('administrateur','acheteurtest',{roles:['inventory']});
  assert.equal(directory.readSession(buyer.token),null,'Changing permissions revokes previous sessions');
  const buyer2=directory.createSession('acheteurtest');
  directory.updateUser('administrateur','acheteurtest',{active:false});
  assert.equal(directory.readSession(buyer2.token),null,'Disabled account cannot retain sessions');

  // Simulate old p2 installation: root row still stored with all legacy roles.
  const db=new DatabaseSync(dbFile);
  db.prepare('UPDATE GoCmdUser SET roles_json=? WHERE username=?').run(JSON.stringify(directory.ROLES),'administrateur');
  assert.deepEqual(directory.readUser('administrateur').roles,['admin'],'Old root must already be clamped at read time');
  const migration=directory.migrateRootAndSessions();
  assert.equal(migration.username,'administrateur');
  const stored=JSON.parse(db.prepare("SELECT roles_json FROM GoCmdUser WHERE is_root=1").get().roles_json);
  assert.deepEqual(stored,['admin'],'Upgrade must normalize stored root roles');
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  const sourceDb=new DatabaseSync(path.join(__dirname,'../db/custom.db'),{readOnly:true});
  assert.equal(db.prepare('SELECT COUNT(*) n FROM Material').get().n,sourceDb.prepare('SELECT COUNT(*) n FROM Material').get().n,'Business data preserved');
  sourceDb.close();
  db.close();
  console.log('PASS V18.9.13-p3 : admin-only, director protection, session login/logout revocation, roles change, disable, migration, SQLite integrity');
} catch(e){console.error(e);process.exitCode=1}
finally{fs.rmSync(tmp,{recursive:true,force:true})}
