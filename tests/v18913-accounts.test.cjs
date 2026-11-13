'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const store=require('../src/lib/user-directory.cjs');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'gocmd-v18913-'));
const pathDb=path.join(temp,'isolated.db');
const originalDb=path.join(__dirname,'../db/custom.db');
fs.copyFileSync(originalDb,pathDb);process.env.GOCMD_DB_FILE=pathDb;
// P5.15.20 : la base livrée contient les 9 comptes de démonstration (référence
// P5.15.7+, attestée par scripts/verify_demo_base_p51517.py). Le bootstrap se
// vérifie sur un annuaire NON initialisé : on ne vide que les tables de comptes
// de la COPIE temporaire (jamais de l'originale) pour rétablir la précondition
// d'origine « données métier présentes, annuaire vide ».
{const {DatabaseSync}=require('node:sqlite');const wipe=new DatabaseSync(pathDb);
 wipe.exec('DELETE FROM GoCmdSession; DELETE FROM GoCmdUser;');wipe.close();}
const pwd='Root-Initial_2026!GOCMD';
try{
 assert.equal(store.managed(),false,'uninitialized directory is not managed');
 const admin=store.bootstrap('administrateur',pwd);
 assert.ok(store.managed());assert.ok(admin.roles.includes('admin'));assert.ok(!admin.roles.includes('director'));
 assert.throws(()=>store.bootstrap('autre','Impossible!Personne2026'));
 let root=store.readUser('administrateur');assert.ok(root.isRoot && root.active);assert.equal(store.checkPassword(pwd,root.salt,root.hash),true);
 assert.equal(store.checkPassword('erreur',root.salt,root.hash),false);
 const id='youssef';const first='Temporaire_2026!YsQ';
 store.createUser('administrateur',id,first,['buyer','receiver','inventory'],{'receipts.create':false});
 let user=store.readUser(id);assert.deepEqual(user.roles,['buyer','receiver','inventory']);
 assert.ok(store.allowed(user.roles,user.permissions,'purchases.create'));
 assert.equal(store.allowed(user.roles,user.permissions,'receipts.create'),false);
 assert.equal(store.allowed(user.roles,user.permissions,'director.prices'),false);
 assert.ok(!store.allowed(['admin'],{},'director.prices'));
 assert.throws(()=>store.createUser('administrateur','oops','LongPasswordExample_2026',['buyer'],{'director.prices':true}));
 store.updateUser('administrateur',id,{roles:['buyer','receiver','inventory','approver'],permissions:{'receipts.create':false}});
 user=store.readUser(id);assert.ok(user.roles.includes('approver'));
 store.changeOwnPassword(id,first,'NouvelleCleLongue_2026!');user=store.readUser(id);
 assert.equal(user.mustChangePassword,false);assert.ok(store.checkPassword('NouvelleCleLongue_2026!',user.salt,user.hash));
 store.updateUser('administrateur',id,{active:false});assert.equal(store.readUser(id).active,false);
 assert.throws(()=>store.updateUser('administrateur','administrateur',{roles:['buyer']}),'protection du root');
 assert.throws(()=>store.updateUser('administrateur','administrateur',{active:false}));
 const audit=store.recentAudit();assert.ok(audit.length>=5);assert.ok(!JSON.stringify(audit).includes(first));assert.ok(!JSON.stringify(audit).includes(pwd));
 assert.deepEqual(store.listUsers().map(a=>a.username).sort(),['administrateur','youssef']);
 const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(pathDb,{readOnly:true});
 assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 const source=new DatabaseSync(originalDb,{readOnly:true});
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM Material').get().n,source.prepare('SELECT COUNT(*) AS n FROM Material').get().n,'Catalogue preserve au bootstrap');
 source.close();
 db.close();
 console.log('PASS V18.9.13 comptes SQLite : bootstrap unique, multi-rôles, permissions restrictives, visa directeur explicite, blocage admin root, password, désactivation, audit et données métier préservées');
}catch(e){console.error('FAIL',e);process.exitCode=1}finally{fs.rmSync(temp,{recursive:true,force:true})}
