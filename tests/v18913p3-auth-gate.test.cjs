'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const ts=require('typescript');
const Module=require('node:module');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gocmd-gate-p3-'));
const filename=path.join(tmp,'demo.db');
fs.copyFileSync(path.join(__dirname,'../db/custom.db'),filename);
// A-003 (recette nov. 2026) : la base livrée porte désormais les 11 comptes de
// recette. Le scénario historique suppose un répertoire de comptes NON initialisé
// (bootstrap du premier administrateur). On retire uniquement les tables de
// comptes de la copie temporaire — les données métier restent intactes.
{
 const {DatabaseSync}=require('node:sqlite');
 const sanitize=new DatabaseSync(filename);
 sanitize.exec('DROP TABLE IF EXISTS GoCmdSession; DROP TABLE IF EXISTS GoCmdAccessAudit; DROP TABLE IF EXISTS GoCmdUser');
 sanitize.close();
}
process.env.GOCMD_DB_FILE=filename;
process.env.GOCMD_REQUIRE_SQLITE_USERS='1';
const directory=require('../src/lib/user-directory.cjs');
const text=fs.readFileSync(path.join(__dirname,'../src/lib/access-gate.ts'),'utf8');
const compiled=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const sourceFile=path.join(__dirname,'../src/lib/access-gate.cjs');
const mod=new Module(sourceFile,module);mod.filename=sourceFile;mod.paths=Module._nodeModulePaths(path.dirname(sourceFile));mod._compile(compiled,sourceFile);
const {currentActor,accessGate,hasRole,hasAnyReadRole,isDirector}=mod.exports;
try{
  directory.bootstrap('administrateur','Admin-Temporary!2026');
  const session=directory.createSession('administrateur');
  const cookie=`gocmd_session=${session.token}`;
  const basic='Basic '+Buffer.from('administrateur:Admin-Temporary!2026').toString('base64');
  const url='http://127.0.0.1:3001';
  const req=(route,headers={})=>new Request(url+route,{headers});
  assert.equal(currentActor(req('/api/me',{cookie})).username,'administrateur');
  assert.equal(currentActor(req('/api/me',{authorization:basic})),null,'Basic cached credentials must not bypass signout');
  assert.equal(hasRole(req('/api/me',{cookie}),'admin'),true);
  assert.equal(hasRole(req('/api/me',{cookie}),'director'),false);
  assert.equal(hasRole(req('/api/me',{cookie}),'finance'),false);
  assert.equal(isDirector(req('/api/me',{cookie})),false);
  assert.equal(hasAnyReadRole(req('/api/me',{cookie}),['buyer','finance']),false);
  assert.equal(accessGate(req('/api/admin/users',{cookie})),null);
  assert.equal(accessGate(req('/api/materials',{cookie})).status,403);
  assert.equal(accessGate(req('/api/dashboard',{cookie})).status,403);
  assert.equal(accessGate(req('/api/clients',{cookie})).status,403);
  assert.equal(accessGate(req('/api/products',{cookie})).status,403);
  assert.equal(accessGate(req('/login')),null);
  assert.equal(accessGate(req('/api/auth/login')),null);
  assert.equal(accessGate(req('/api/me',{authorization:basic})).status,401);
  assert.equal(accessGate(req('/')).status,302);
  directory.revokeSession(session.token);
  assert.equal(currentActor(req('/api/me',{cookie})),null);
  assert.equal(accessGate(req('/api/me',{cookie,authorization:basic})).status,401);
  console.log('PASS V18.9.13-p3 access gate: admin-only API, explicit director, Basic bypass blocked, login redirect, session logout');
}catch(e){console.error(e);process.exitCode=1}finally{fs.rmSync(tmp,{recursive:true,force:true})}
