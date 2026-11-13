'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const ts=require('typescript'); // dépendance dev du projet (npm ci)
const filename=path.join(__dirname,'../src/lib/access-gate.ts');
const js=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
let state='configured',session='valid';
const fake={
 managedState:()=>state,managed:()=>state==='configured',
 readSessionState:()=>session==='valid'?{status:'valid',user:{username:'sales01',roles:['sales'],permissions:{},isRoot:false,mustChangePassword:false}}:{status:session},
 allowed:()=>true,
};
const moduleShim={exports:{}};
new Function('require','module','exports',js)((p)=>p==='./user-directory.cjs'?fake:require(p),moduleShim,moduleShim.exports);
const gate=moduleShim.exports;
const request=()=>new Request('http://localhost/api/orders',{headers:{cookie:'gocmd_session='+'A'.repeat(48),host:'localhost'}});
async function test(){
 state='configured';session='invalid';
 assert.equal(gate.accessGate(request())?.status,401,'session revoquee doit rester 401');
 session='unavailable';
 const transient=gate.accessGate(request());
 assert.equal(transient?.status,503,'erreur SQLite ne doit pas devenir 401');
 assert.equal(transient?.headers.get('retry-after'),'1');
 assert.equal(gate.readRoleGate(request(),['sales'])?.status,503);
 state='unavailable';session='valid';
 assert.equal(gate.accessGate(request())?.status,503,'identité SQL indisponible, aucun fallback Basic');
 state='configured';session='valid';
 assert.equal(gate.accessGate(request()),null,'session valide doit conserver accès');
 assert.equal(gate.readRoleGate(request(),['sales']),null,'lecture autorisée inchangée');
 state='unconfigured';session='invalid';
 assert.equal(gate.accessGate(request())?.status,503,'absence bootstrap sans accès demo = 503');
 console.log('PASS QWEN-AUTH-GATE : 401/503 séparés, accès valide, refus sans bootstrap');
}
test().catch(e=>{console.error(e);process.exitCode=1});
