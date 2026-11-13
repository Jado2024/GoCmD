#!/usr/bin/env node
/* Orchestrateur V18.9.9 : démarre UN serveur de production local sur une base
 * SQLite jetable avec des comptes nominatifs distincts, exécute TOUTES les
 * recettes HTTP déclarées, puis arrête le serveur. Localhost uniquement.
 * CASCADE3 (11/11/2026) : `--only script1.cjs,script2.cjs` restreint l'exécution
 * aux recettes listées — les scripts npm `test:http:*` routent désormais par
 * cet orchestrateur : une recette exécutée seule refuserait de tourner sans
 * son environnement isolé (garde GOCMD_E2E_CONFIRM conservée). */
const assert=require('node:assert/strict');
const {createAccounts}=require('./qa-managed-accounts.cjs');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gocmd-v1899-recipes-'));
const testDB=path.join(dir,'recipes.db');
fs.copyFileSync(path.join(root,'db','custom.db'),testDB);

// Rôle métier de chaque compte de recette (CHIEF cumule buyer+approver).
// P5.15.23 (correctif droits OF) : SALES_APPROVER conserve deux rôles pour
// la compatibilité de la recette ; seul approver est désormais obligatoire, avec le
// quatre-yeux createdBy≠acteur (le créateur de la CMD reste le compte SALES).
const SPEC={
 BUYER:['buyer'],APPROVER:['approver'],RECEIVER:['receiver'],QUALITY:['quality'],
 FINANCE_A:['finance'],FINANCE_B:['finance'],FINANCE_C:['finance'],
 INVENTORY:['inventory'],SALES:['sales'],CHIEF:['buyer','approver'],
 SALES_APPROVER:['sales','approver'],
 // C4 (contre-audit CASCADE4) : directeur dont la permission révocable
 // director.prices est désactivée ; compte « frais » conservant le changement
 // de mot de passe initial obligatoire.
 DIRECTOR:{roles:['director']},
 DIRECTOR_NO_PRICE:{roles:['director'],permissions:{'director.prices':false}},
 // REV1 : compte possédant le bon rôle mais dont stock.read est explicitement révoquée.
 INVENTORY_NO_STOCK_READ:{roles:['inventory'],permissions:{'stock.read':false}},
 QUALITY_NO_STOCK_READ:{roles:['quality'],permissions:{'stock.read':false}},
 FRESH:{roles:['sales'],fresh:true},
}
const accounts=createAccounts(testDB,'e2e',SPEC);const env={GOCMD_E2E_CONFIRM:'ISOLATED_DB_ONLY'};
for(const [name,roles] of Object.entries(SPEC)){
 void roles;
 env[`GOCMD_E2E_${name}_NAME`]=accounts[name].username;
 env[`GOCMD_E2E_${name}_PASSWORD`]=accounts[name].password;
}
function freePort(){return new Promise((resolve,reject)=>{const srv=net.createServer();srv.on('error',reject);srv.listen(0,'127.0.0.1',()=>{const port=srv.address().port;srv.close(()=>resolve(port))})})}
function run(script){
 return new Promise(resolve=>{
  const p=spawn(process.execPath,[path.join(root,'tests',script)],{
   cwd:root,env:{...process.env,...env,GOCMD_E2E_URL:url},stdio:['ignore','pipe','pipe']});
  let out='';for(const k of ['stdout','stderr'])p[k].on('data',d=>{out+=d.toString();process.stdout.write(script+': '+d.toString())});
  p.on('exit',code=>resolve({script,code,out}));
 });
}
let url;
(async()=>{
 const port=await freePort();url=`http://127.0.0.1:${port}`;
 const server=spawn(process.execPath,['scripts/start-gocmd-checked.cjs'],{
  cwd:root,env:{...process.env,GOCMD_DB_FILE:testDB,GOCMD_REQUIRE_SQLITE_USERS:'1',
   GOCMD_REQUIRE_RBAC:'1',GOCMD_ACCESS_PASSWORD:'',GOCMD_ALLOW_DEMO_DB:'1',
   // P5.15.22 (CLT-05) : même correctif que FA-06 (http-purchasing-dmaic.cjs) —
   // sans barème explicite, la recette ventes échoue en environnement propre
   // (facturation 409 « Taux de TVA absent de la configuration ») dès lors
   // qu'aucun .env local n'est présent. Barème de démonstration réservé aux
   // tests automatisés, jamais applicable fiscalement.
   GOCMD_SALES_TAX_RATES_BPS:process.env.GOCMD_SALES_TAX_RATES_BPS||'0,2000',
   GOCMD_PUBLIC_ORIGIN:url,HOSTNAME:'127.0.0.1',PORT:String(port),NODE_ENV:'production'},
  detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
 let output='';for(const k of ['stdout','stderr'])server[k].on('data',x=>{output+=x.toString().slice(0,2000)});
 const abort=()=>{if(server.exitCode!==null)return;try{if(process.platform!=='win32')process.kill(-server.pid,'SIGTERM');else server.kill('SIGTERM')}catch{try{server.kill('SIGTERM')}catch{}}};
 const results=[];
 try{
  let ready=false;
  for(let i=0;i<140;i++){
   if(server.exitCode!==null)throw Error(`Server exited ${server.exitCode}: ${output.slice(-2000)}`);
   try{const r=await fetch(`${url}/api/me`,{signal:AbortSignal.timeout(1200)});if(r.status===401){ready=true;break}}catch{}
   await new Promise(r=>setTimeout(r,350));
  }
  assert(ready,'serveur non prêt');
  // CASCADE3 : toutes les recettes par défaut, ou le sous-ensemble --only.
  const allRecipes=['http-p2p-recipe.cjs','http-sales-recipe.cjs','http-concurrent-orders.cjs',
    'http-v184-credit-approval.cjs','http-v189-remediation.cjs','http-v1891-remediation.cjs','http-v1892-remediation.cjs',
    'c4-counter-audit.test.cjs'];
  const onlyIdx=process.argv.indexOf('--only');
  const requested=onlyIdx>=0&&process.argv[onlyIdx+1]?process.argv[onlyIdx+1].split(',').map(x=>x.trim()).filter(Boolean):null;
  if(requested){
    const unknown=requested.filter(x=>!allRecipes.includes(x));
    if(unknown.length)throw Error('Recette inconnue (autorisees: '+allRecipes.join(', ')+') : '+unknown.join(', '));
  }
  for(const script of requested??allRecipes){
   results.push(await run(script));
  }
 }finally{abort()}
 const failed=results.filter(r=>r.code!==0);
 for(const r of results)console.log(`${r.code===0?'PASS':'FAIL'} ${r.script} (exit ${r.code})`);
 if(failed.length){console.error(`ÉCHEC de ${failed.length} recette(s)`);process.exitCode=1}
 else console.log(`PASS — ${results.length} recette(s) HTTP réussissent sur la base corrigée V18.9.9`);
 try{fs.rmSync(dir,{recursive:true,force:true})}catch{}
})().catch(e=>{console.error('FAIL orchestrateur:',e.stack||e);process.exitCode=1});
