/** Démarre GoCmd sans ambiguïté de résolution relative du chemin SQLite.
 * Un chemin de base explicite est obligatoire ; ne jamais choisir la DEMO par défaut.
 * Exemple : GOCMD_DB_FILE=/srv/gocmd/data/gocmd.db node scripts/start-gocmd-checked.cjs
 */
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync, spawn } = require('node:child_process');
const root = path.resolve(__dirname,'..');
const nodeMajor=Number(process.versions.node.split('.')[0]);
if(!Number.isSafeInteger(nodeMajor)||nodeMajor<24){
  console.error('Node.js 24+ requis pour node:sqlite et le service SODEPI : démarrage refusé.');
  process.exit(2);
}

const {checkDatabaseSelection}=require('./gocmd-db-policy.cjs');
const raw = process.env.GOCMD_DB_FILE;
if (!raw || raw.startsWith('file:')) {
  console.error('Définir GOCMD_DB_FILE vers un FICHIER SQLite existant (chemin absolu conseillé).');
  process.exit(2);
}
const database = path.resolve(root,raw);
if (!fs.existsSync(database) || !fs.statSync(database).isFile()) {
  console.error(`Base SQLite inexistante: ${database}`); process.exit(2);
}
const policy=checkDatabaseSelection(root,database,process.env);
if(!policy.allowed){console.error(policy.reason);process.exit(2);}
if(policy.demo)console.warn(policy.reason);
// The database may have been COPIED or RENAMED. Detect the embedded DEMO marker.
const identify = spawnSync(process.env.GOCMD_PYTHON||'python',
  [path.join(root,'scripts','identify_demo_sqlite.py'),'--db',database],
  {cwd:root,encoding:'utf8'});
if(identify.error||identify.status!==0){
  console.error('Impossible de déterminer le type de base, démarrage refusé : '+(identify.stderr||identify.error?.message||''));
  process.exit(2);
}
const isDemoContent=(identify.stdout||'').trim()==='DEMO';
if(isDemoContent){
  const host=process.env.HOSTNAME||'127.0.0.1';
  if(process.env.GOCMD_ALLOW_DEMO_DB!=='1'||!['localhost','127.0.0.1','::1','[::1]'].includes(host)){
    console.error('Base DEMO détectée par son contenu (même renommée) : usage production interdit. Pour une recette locale uniquement, GOCMD_ALLOW_DEMO_DB=1 et HOSTNAME=127.0.0.1.');
    process.exit(2);
  }
  console.warn('BASE DE DEMONSTRATION : données fictives et usage local uniquement.');
}
const head=Buffer.alloc(16);const fd=fs.openSync(database,'r');fs.readSync(fd,head,0,16,0);fs.closeSync(fd);
if (head.toString('utf8')!=='SQLite format 3\0') {
  console.error('GOCMD_DB_FILE ne désigne pas une base SQLite valide.');process.exit(2);
}
// P5.15.7 : ne pas lancer Next.js sur un schema incomplet.
const python=process.env.GOCMD_PYTHON||'python';
const check=spawnSync(python,[path.join(root,'scripts','check_sqlite_schema_p5157.py'),'--db',database],{cwd:root,encoding:'utf8'});
if(check.error||check.status!==0){
  console.error('Verification du schema SQLite echouee.');
  console.error(check.stderr||check.error?.message||'Python ou migration manquante');
  process.exit(2);
}
console.log((check.stdout||'').trim());
// Fail-closed for ALL checked starts, including locally copied demonstration DBs.
// No production database is migrated automatically at startup.
const guardCheck=spawnSync(python,[path.join(root,'scripts','verify_operational_guards_p51523.py'),'--db',database],{cwd:root,encoding:'utf8'});
if(guardCheck.error || guardCheck.status!==0){
  console.error('Protections historiques/factures absentes : lancer les migrations avec sauvegarde externe.');
  process.exit(2);
}
console.log((guardCheck.stdout||'').trim());
// P5.15.28 P1 : fail-closed before launching the HTTP listener.
// WAL is explicitly refused until the SQLite engines are certified/patched.
const journalCheck=spawnSync(python,[path.join(root,'scripts','verify_sqlite_runtime.py'),'--db',database],
  {cwd:root,encoding:'utf8'});
if(journalCheck.error || journalCheck.status!==0){
  console.error('Journal SQLite non sûr ou contrôle d’intégrité échoué — démarrage refusé.');
  console.error(journalCheck.stderr||journalCheck.error?.message||'');
  process.exit(2);
}
console.log('Contrôle SQLite P1 : '+(journalCheck.stdout||'').trim());

// P6 : seul le lanceur vérifié est autorisé pour la base SQLite locale.
// Création atomique O_EXCL ; verrou vivant => refus ; PID mort => reprise
// conservatrice. N'utilisez pas directement `next start` sur la base SODEPI.
let instanceLock;
try { instanceLock=require('./gocmd-instance-lock.cjs').acquireInstanceLock(database); }
catch(e) {console.error('GOCMD_INSTANCE_LOCK: '+(e?.message||e));process.exit(3);}
const releaseInstance = () => {try{instanceLock.release();}catch(e){console.error('Erreur libération verrou : '+e.message);}};
const nextScript = require.resolve('next/dist/bin/next',{paths:[root]});
const env = {...process.env, DATABASE_URL:'file:'+database, GOCMD_REQUIRE_SQLITE_USERS:'1', GOCMD_REQUIRE_OF_FOR_PRODUCTION:'1', GOCMD_SERVER_RUNTIME:'1'};
const args = ['start', '-p', process.env.PORT||'3000', '-H', process.env.HOSTNAME||'127.0.0.1'];
console.log(`Base sélectionnée: ${database} ; serveur en mode production`);
// Le verrou couvre aussi le serveur enfant. En cas de décès du lanceur,
// le PID enfant reste enregistré et empêche de démarrer un second serveur.
let child;
try {
  child=spawn(process.execPath,[nextScript,...args],{cwd:root,env,stdio:'inherit'});
  instanceLock.setChildPid(child.pid);
} catch(e) {
  if(child?.pid)try{child.kill('SIGTERM')}catch{}
  releaseInstance();console.error('Démarrage serveur échoué : '+e.message);process.exit(3);
}
let terminating=false;
for(const signal of ['SIGINT','SIGTERM','SIGBREAK']){
  process.on(signal,()=>{
    if(terminating)return;
    terminating=true;
    try{child.kill(signal==='SIGBREAK'?'SIGTERM':signal)}catch(e){console.error('Arrêt enfant échoué : '+e.message)}
  });
}
child.on('error',e=>{console.error('Erreur processus Next.js : '+e.message);releaseInstance();process.exitCode=3;});
child.on('exit',(code,signal)=>{
  releaseInstance();
  process.exitCode=typeof code==='number'?code:signal==='SIGINT'?130:signal==='SIGTERM'?143:1;
});
process.on('exit',releaseInstance);
