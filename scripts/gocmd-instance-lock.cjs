/** Exclusive single-instance guard for a single SQLite database.
 * Local filesystem only. All supported deployments must use start-gocmd-checked.cjs.
 * Atomic exclusive create ('wx') prevents simultaneous healthy launches.
 * A dead-owner lock is reclaimed by a serialized reclaim directory.
 * Never clear a lock whose owner may be running. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms); }
function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid,0); return true; }
  catch(e) { return e?.code === 'EPERM'; }
}
function acquireInstanceLock(database) {
  const abs = path.resolve(database);
  const filename = abs + '.gocmd-instance.lock';
  const reclaim = filename + '.reclaim';
  const nonce = crypto.randomBytes(16).toString('hex');
  let ownerRecord = {pid:process.pid, nonce, database:abs, createdAt:new Date().toISOString()};
  let content = JSON.stringify(ownerRecord);
  // Do not start when a previous lock-reclamation operation was interrupted;
  // operator intervention is preferable to risking two active SQLite writers.
  for (let attempt=0; attempt<20; attempt++) {
    if (fs.existsSync(reclaim)) {
      if(attempt===19) throw new Error('Reprise de verrou interrompue : vérifier puis supprimer manuellement '+reclaim);
      sleep(70); continue;
    }
    try {
      const fd=fs.openSync(filename,'wx',0o600);
      try { fs.writeFileSync(fd,content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      // If another process was in the middle of a stale-lock recovery, the
      // new owner must not begin while recovery may still touch the lock.
      if(fs.existsSync(reclaim)) {
        try {if(fs.readFileSync(filename,'utf8')===content) fs.unlinkSync(filename);}catch{}
        sleep(70); continue;
      }
      let released=false;
      function owned() {
        try {return JSON.parse(fs.readFileSync(filename,'utf8'))?.nonce===nonce;}
        catch{return false;}
      }
      return {
        file:filename,
        setChildPid(pid) {
          if(released || !Number.isSafeInteger(pid) || pid<1 || !owned()) throw new Error('Propriétaire du verrou non vérifiable');
          ownerRecord={...ownerRecord,childPid:pid};
          content=JSON.stringify(ownerRecord);
          const fd=fs.openSync(filename,'r+');
          try{fs.ftruncateSync(fd,0);fs.writeFileSync(fd,content);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
        },
        release() {
          if (released) return;
          released=true;
          try { if(owned()) fs.unlinkSync(filename); } catch(e) { if(e?.code!=='ENOENT') throw e; }
        },
      };
    } catch(e) {
      if(e?.code!=='EEXIST') throw e;
    }
    let raw, owner;
    try {raw=fs.readFileSync(filename,'utf8');owner=JSON.parse(raw);}
    catch(e){
      if (e?.code==='ENOENT' || attempt<3) {sleep(70);continue;}
      throw new Error('Verrou illisible : intervention nécessaire : '+filename);
    }
    if (!Number.isSafeInteger(owner?.pid) || typeof owner?.nonce!=='string' || owner?.database!==abs)
      throw new Error('Verrou invalide : intervention nécessaire : '+filename);
    if(alive(owner.pid) || alive(owner.childPid)) throw new Error('Autre service GoCmd actif sur cette base (PID '+owner.pid+(owner.childPid?', serveur '+owner.childPid:'')+'). Démarrage refusé.');
    try {fs.mkdirSync(reclaim, {mode:0o700});}
    catch(e) {if(e?.code==='EEXIST'){sleep(70);continue;} throw e;}
    try {
      // Check ownership *again* while exclusive reclamation is held.
      let now;
      try {now=fs.readFileSync(filename,'utf8');}catch(e){if(e?.code!=='ENOENT')throw e;}
      if(now===raw && !alive(owner.pid) && !alive(owner.childPid)) fs.unlinkSync(filename);
    } finally {fs.rmdirSync(reclaim);}
  }
  throw new Error('Impossible de prendre le verrou de service SQLite : '+filename);
}
module.exports = {acquireInstanceLock};
