const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const os=require('node:os')
// A-001 (recette nov. 2026) : test rendu hermétique. En présence d'une base
// SQLite avec comptes gérés (DATABASE_URL ambiante), directory.managed() est
// vrai et le scénario historique « aucune configuration » ne peut plus être
// exercé. On force un fichier de comptes absent : managed() reste faux et les
// chemins hérités (démo partagée, GOCMD_USERS_JSON) sont testés isolément.
process.env.GOCMD_DB_FILE=path.join(os.tmpdir(),'gocmd-security-regression-absent.db')
if(fs.existsSync(process.env.GOCMD_DB_FILE))fs.rmSync(process.env.GOCMD_DB_FILE)
const ts=require('typescript'),{Module}=require('node:module')
const original=fs.readFileSync(path.join(__dirname,'../src/lib/access-gate.ts'),'utf8')
const mod=new Module('gocmd-access-gate',module);mod.filename='gocmd-access-gate.js';mod.paths=module.paths
// V18.9.13 : le test historique transpile access-gate.ts isolément.
// Il faut résoudre son nouveau registre SQLite sans modifier le code produit.
mod.require=function(id){if(id==='./user-directory.cjs' || id==='@/lib/user-directory.cjs')return require('../src/lib/user-directory.cjs');return Module.prototype.require.call(this,id)}
mod._compile(ts.transpileModule(original,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,mod.filename)
const {accessGate,currentActor}=mod.exports
const pwd='TEST_SUPER_LONG_PASSWORD_1234'
const basic=(user,password)=>'Basic '+Buffer.from(`${user}:${password}`).toString('base64')
const req=(user,password,method='GET',more={})=>new Request('http://localhost:3000/api/orders',{method,headers:{authorization:basic(user,password),...more}})
let count=0
function check(cond,msg){assert.ok(cond,msg);count++}
delete process.env.GOCMD_USERS_JSON;delete process.env.GOCMD_ALLOW_LEGACY_WRITES;delete process.env.GOCMD_REQUIRE_RBAC
process.env.GOCMD_ACCESS_PASSWORD=''
check(accessGate(new Request('http://localhost:3000')).status===503,'fail closed on missing configuration')
process.env.GOCMD_ACCESS_PASSWORD=pwd
check(accessGate(req('gocmd','bad')).status===401,'reject wrong password')
check(accessGate(req('gocmd',pwd))===null,'allow demo reads')
check(accessGate(req('gocmd',pwd,'POST')).status===403,'demo cannot write')
process.env.GOCMD_ALLOW_LEGACY_WRITES='1'
// V18.9.9 (SEC-LEGACY-01) : même avec l'ancien drapeau de compatibilité,
// le compte partagé n'écrit pas et n'obtient aucun rôle métier ou financier.
check(accessGate(req('gocmd',pwd,'POST')).status===403,'legacy writes denied even with legacy flag')
check(accessGate(req('gocmd',pwd,'POST'),'sales').status===403,'legacy account never gets sales role')
check(accessGate(req('gocmd',pwd,'POST'),'finance').status===403,'legacy account never gets finance role')
check(accessGate(req('gocmd',pwd,'POST'),'buyer').status===403,'legacy account never gets buyer role')
check(accessGate(req('gocmd',pwd,'GET'),'finance').status===403,'legacy account never reads finance endpoints')
process.env.GOCMD_REQUIRE_RBAC='1'
check(accessGate(req('gocmd',pwd,'POST')).status===403,'enforced RBAC denies legacy')
delete process.env.GOCMD_ALLOW_LEGACY_WRITES
const secret='P@ss-unique-account-2026!';const salt=crypto.randomBytes(16).toString('hex')
const hash=crypto.scryptSync(secret,Buffer.from(salt,'hex'),32).toString('hex')
process.env.GOCMD_USERS_JSON=JSON.stringify({alice:{salt,hash,roles:['buyer']}})
check(accessGate(req('alice',secret))===null,'authenticated personal user')
check(accessGate(req('alice',secret,'POST'),'buyer')===null,'buyer role authorized')
check(accessGate(req('alice',secret,'POST'),'approver').status===403,'no approval as buyer')
check(accessGate(req('alice','bad')).status===401,'wrong user secret denied')
check(accessGate(req('alice',secret,'POST',{origin:'http://evil.example'})).status===403,'cross origin denied')
check(accessGate(req('alice',secret,'POST',{host:'192.168.1.5:3000',origin:'http://192.168.1.5:3000'}))===null,'legitimate LAN browser origin accepted')
check(accessGate(req('alice',secret,'POST',{host:'intranet.sodepi.test',origin:'http://intranet.sodepi.test'}))===null,'legitimate internal DNS accepted')
check(accessGate(req('alice',secret,'POST',{host:'intranet.sodepi.test',origin:'http://evil.test'})).status===403,'foreign origin denied even with DNS host')
process.env.GOCMD_PUBLIC_ORIGIN='https://gocmd.example.test'
check(accessGate(req('alice',secret,'POST',{host:'localhost:3000',origin:'https://gocmd.example.test'}))===null,'explicit trusted TLS reverse-proxy origin accepted')
check(accessGate(req('alice',secret,'POST',{host:'localhost:3000',origin:'http://gocmd.example.test'})).status===403,'https public origin rejects downgrade')
delete process.env.GOCMD_PUBLIC_ORIGIN

check(accessGate(req('alice',secret,'PATCH',{'sec-fetch-site':'cross-site'})).status===403,'browser cross-site denied')
check(currentActor(req('alice',secret)).username==='alice','real actor set server side')
console.log(`PASS: ${count} tests sécurité (rôles nominatifs, démo lecture seule, contrôle d'origine)`) 
