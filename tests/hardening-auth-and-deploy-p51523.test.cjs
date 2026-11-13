'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..');
const demo=path.join(root,'db','custom.db');
const policy=require('../scripts/gocmd-db-policy.cjs');
assert.deepEqual(policy.checkDatabaseSelection(root,demo,{}).allowed,false);
assert.match(policy.checkDatabaseSelection(root,demo,{}).reason,/démonstration/);
assert.equal(policy.checkDatabaseSelection(root,demo,{GOCMD_ALLOW_DEMO_DB:'1',HOSTNAME:'0.0.0.0'}).allowed,false);
assert.equal(policy.checkDatabaseSelection(root,demo,{GOCMD_ALLOW_DEMO_DB:'1',HOSTNAME:'127.0.0.1'}).allowed,true);
const locked=spawnSync(process.execPath,['scripts/start-gocmd-checked.cjs'],{
  cwd:root,env:{...process.env,GOCMD_DB_FILE:demo,GOCMD_ALLOW_DEMO_DB:'0'},encoding:'utf8',timeout:10000
});
assert.equal(locked.status,2,'bundled demo database must fail before Next.js startup');
assert.match(locked.stderr,/Base de démonstration/);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gocmd-authfail-'));
const dbfile=path.join(tmp,'auth.db');
try{
  fs.copyFileSync(demo,dbfile);
  assert.equal(policy.checkDatabaseSelection(root,dbfile,{}).allowed,true);
  process.env.GOCMD_DB_FILE=dbfile;
  process.env.GOCMD_REQUIRE_SQLITE_USERS='1';
  const directory=require('../src/lib/user-directory.cjs');
  const db=new DatabaseSync(dbfile);
  const {username}=db.prepare('SELECT username FROM GoCmdUser WHERE active=1 LIMIT 1').get();
  const count=()=>db.prepare("SELECT count(*) AS n FROM GoCmdAccessAudit WHERE action='session.login.failed'").get().n;
  const before=count();
  assert.equal(directory.recordLoginFailure(username,'invalid_credentials'),true);
  assert.equal(directory.recordLoginFailure('inconnu_fictif','invalid_credentials'),true);
  assert.equal(directory.recordLoginFailure(' <script>Password!secret', 'invalid_format'),true);
  assert.equal(directory.recordLoginFailure(username,'rate_limited'),true);
  const rows=db.prepare("SELECT actor,action,target,details_json FROM GoCmdAccessAudit WHERE action='session.login.failed' ORDER BY id DESC LIMIT 4").all().reverse();
  assert.equal(count(),before+4);
  assert.equal(rows[0].target,username);
  assert.equal(rows[1].target,'unknown-account');
  assert.equal(rows[2].target,'unknown-account');
  assert.equal(JSON.parse(rows[3].details_json).reason,'rate_limited');
  for (const row of rows){
    assert.equal(row.actor,'AUTH');
    assert.equal(row.action,'session.login.failed');
    assert(!JSON.stringify(row).includes('Password!secret'));
    assert(!JSON.stringify(row).includes('inconnu_fictif'));
  }
  db.close();
  console.log('PASS SEC-P51523: échecs login audités sans secrets + démarrage démo protégé + mode local autorisé');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
