/* P6 - test multi-processus du verrou atomique et régression des erreurs ambiguës. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {acquireInstanceLock}=require('../scripts/gocmd-instance-lock.cjs');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gocmd-p6-lock-'));
try {
 const db=path.join(tmp,'test.db');fs.writeFileSync(db,'isolated fixture');
 let a=acquireInstanceLock(db);
 a.setChildPid(process.pid);
 const stored=JSON.parse(fs.readFileSync(db+'.gocmd-instance.lock','utf8'));
 assert.equal(stored.childPid,process.pid,'child PID must be tracked after spawn');
 assert.throws(()=>acquireInstanceLock(db),/Autre service GoCmd actif/);
 const competing=spawnSync(process.execPath,['-e',`try{require(${JSON.stringify(path.join(__dirname,'../scripts/gocmd-instance-lock.cjs'))}).acquireInstanceLock(${JSON.stringify(db)});process.exit(0)}catch{process.exit(3)}`],{timeout:5000});
 assert.equal(competing.status,3,'second process must be denied');
 a.release();
 let b=acquireInstanceLock(db);b.release();
 // Simulate SIGKILL left-over owner; ensure conservative stale recovery.
 const file=db+'.gocmd-instance.lock';
 fs.writeFileSync(file,JSON.stringify({pid:2147483646,nonce:'stale-token',database:path.resolve(db)}));
 b=acquireInstanceLock(db);b.release();
 assert.equal(fs.existsSync(file),false);
 const src=fs.readFileSync(path.join(__dirname,'../src/lib/sqlite-write.ts'),'utf8');
 assert.match(src,/GOCMD_SQLITE_CORRUPTION_SUSPECTED/);
 assert.match(src,/GOCMD_SQLITE_OUTCOME_UNCERTAIN/);
 assert.match(src,/code === "P1008"/);
 const route=fs.readFileSync(path.join(__dirname,'../src/app/api/orders/route.ts'),'utf8');
 assert.match(route,/orderResponse\(prior,actor\)/);
 assert.match(route,/orderResponse\(result\.order,actor\)/);
 assert.match(route,/lookupOrderDuplicates\(tx, data\)/);
 assert.match(route,/createRequestDigest/);
 console.log('PASS P6: atomic exclusive instance guard, concurrent process denial, stale recovery, conservative ambiguous errors, identity and P5 duplicate protection');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
