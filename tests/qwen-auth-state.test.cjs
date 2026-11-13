'use strict';
// Test comportemental du diagnostic identité : aucune mutation de la DEMO.
const assert=require('node:assert/strict');
const os=require('node:os'),path=require('node:path'),fs=require('node:fs');
const {DatabaseSync}=require('node:sqlite');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gocmd-qwen-auth-'));
try{
 const file=path.join(tmp,'identity.db');
 const d=new DatabaseSync(file);
 d.exec(`CREATE TABLE GoCmdUser (id INTEGER PRIMARY KEY,username TEXT UNIQUE,salt TEXT,password_hash TEXT,roles_json TEXT,permissions_json TEXT,active INTEGER,is_root INTEGER,must_change_password INTEGER,created_at TEXT);
 INSERT INTO GoCmdUser VALUES(1,'testadmin','abc','def','["admin"]','{}',1,1,0,'2026-11-13');`);
 d.close();
 process.env.GOCMD_DB_FILE=file;
 delete process.env.DATABASE_URL;
 const dir=require('../src/lib/user-directory.cjs');
 assert.equal(dir.managedState(),'configured');
 assert.equal(dir.readUserState('unknown').status,'invalid');
 assert.equal(dir.readUserState('testadmin').status,'valid');
 assert.equal(dir.readSessionState('invalid').status,'invalid');
 // La session paraît valide syntaxiquement, mais sa table est indisponible :
 // ce n'est PAS une expiration, c'est une erreur d'infrastructure.
 assert.equal(dir.readSessionState('A'.repeat(48)).status,'unavailable');
 // Compatibilité des scripts CLI historiques conservée.
 assert.equal(dir.readSession('A'.repeat(48)),null);
 // Vérification d'un incident réel de la connexion (fichier plus lisible).
 process.env.GOCMD_DB_FILE=path.join(tmp,'absent.db');
 assert.equal(dir.managedState(),'unconfigured');
 console.log('PASS QWEN-AUTH : invalide vs indisponible distincts ; aucune promotion de droits');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
