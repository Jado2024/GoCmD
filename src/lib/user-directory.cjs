/* GoCmd V18.9.13 — SQLite identity directory. All writes are parameterized and audited.
 * Never initialize tables during a web request: run scripts/bootstrap-admin.cjs explicitly.
 * Requires Node.js 24+ (node:sqlite).
 * R13.3 (CORR-01) : en mode serveur (GOCMD_SERVER_RUNTIME=1, posé par next.config.ts
 * et scripts/start-gocmd-checked.cjs), cette connexion node:sqlite est STRICTEMENT
 * lecture seule et toute fonction d'écriture refuse fail-closed. Deux moteurs
 * SQLite écrivains dans un même processus ne se verrouillent pas entre eux
 * (verrous POSIX par processus) et corrompent le fichier : les écritures
 * serveur passent par le client Prisma unique (src/lib/identity-writes.ts).
 * Les scripts CLI (serveur arrêté) conservent l'implémentation node:sqlite :
 * entre processus distincts, les verrous POSIX s'appliquent normalement. */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {scryptSync,randomBytes,timingSafeEqual,createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
// Figé au chargement du module : next.config.ts injecte la variable AVANT le
// chargement des routes ; le starter vérifié la pose également explicitement.
const SERVER_RUNTIME=process.env.GOCMD_SERVER_RUNTIME==='1';
function serverWriteRefused(name){
 throw Error('R13.3 CORR-01 : écriture identités interdite en mode serveur (un seul moteur SQLite écrivain). Utiliser src/lib/identity-writes.ts — '+name);
}
const ROLES=Object.freeze(['admin','director','buyer','sales','approver','receiver','inventory','quality','finance','production']);
const RIGHTS=Object.freeze({
 'users.read':['admin'],'users.manage':['admin'],
 'purchases.create':['buyer'],'purchases.approve':['approver'],
 'supplier-orders.create':['buyer'],'supplier-orders.approve':['approver'],
 'suppliers.manage':['buyer'],'materials.manage':['buyer'],
 'receipts.create':['receiver'],'quality.manage':['quality'],
 'stock.read':['buyer','approver','receiver','inventory','quality','finance','director'],
 'p2p.overview.read':['buyer','approver','receiver','inventory','quality','finance','director'],
 'stock.move':['inventory'],'stock.count':['inventory'],'stock.count.approve':['approver'],
 'production.propose':['production'],'production.approve':['production'],
 'production.plan':['production'],'production.start':['production'],'production.finish':['production'],'production.close':['production'],
 'products.create':['sales'],'products.manage':['approver'],
 'sales.quotes':['sales'],'sales.orders':['sales'],'sales.approve':['approver'],'sales.deliveries':['sales'],
 'sales.invoices':['finance'],'sales.payments':['finance'],'sales.credits':['finance'],
 'director.prices':['director'],
 'finance.purchases':['finance'],'finance.export':['finance'],
 'costs.read':['buyer','approver','finance'],
 'clients.read':['sales','finance','approver','director'],
});
function dbFilename(){
 const forced=process.env.GOCMD_DB_FILE;
 if(forced && !forced.startsWith('file:'))return path.resolve(process.cwd(),forced);
 const raw=(process.env.DATABASE_URL||'').trim();
 if(!raw.startsWith('file:'))return null;
 const p=decodeURIComponent(raw.slice(5).split('?')[0]);
 return path.isAbsolute(p)?p:path.resolve(process.cwd(),'prisma',p);
}
let cache=null, cacheFile='';
function connection(write=false){
 const filename=dbFilename();
 if(!filename || !fs.existsSync(filename))return null;
 if(cache && cacheFile===filename)return cache;
 if(cache){try{cache.close()}catch{}}
 cacheFile=filename;
 try{
   // R13.3 (CORR-01) : lecture seule stricte en mode serveur — le moteur
   // node:sqlite ne peut plus écrire, même par un chemin oublié.
   cache=new DatabaseSync(filename,{readOnly:SERVER_RUNTIME});
   cache.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');
   // P5.15.28 P1 : jamais d'écriture identités sur une base WAL non qualifiée.
   const mode=String(cache.prepare('PRAGMA journal_mode').get()?.journal_mode||'').toLowerCase();
   if(mode!=='delete')throw Error('GOCMD_SQLITE_UNSAFE_WAL');
   return cache;
  }
 catch(e){try{cache?.close()}catch{} console.error('[user-directory] SQLite indisponible:',e&&typeof e.code==='string'&&/^SQLITE_[A-Z_]+$/.test(e.code)?e.code:'DB_OPEN_ERROR');cache=null;return null}
}
function installed(db){return !!db && !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='GoCmdUser'").get()}
function managed(){try{const db=connection();return installed(db) && Number(db.prepare('SELECT COUNT(*) AS n FROM GoCmdUser').get().n)>0}catch{return false}}
function safeJson(raw,fallback){try{const value=JSON.parse(raw);return value&&typeof value==='object'?value:fallback}catch{return fallback}}
function normalize(row){if(!row)return null;return {
 username:row.username,roles:(Boolean(row.is_root)?["admin"]:safeJson(row.roles_json,[]).filter(r=>ROLES.includes(r))),
 permissions:safeJson(row.permissions_json,{}),active:Boolean(row.active),isRoot:Boolean(row.is_root),mustChangePassword:Boolean(row.must_change_password),
 salt:row.salt,hash:row.password_hash,createdAt:row.created_at
}}
function readUser(username){try{const db=connection();if(!installed(db))return null;return normalize(db.prepare('SELECT * FROM GoCmdUser WHERE username=? COLLATE NOCASE').get(username))}catch{return null}}
function checkPassword(password,salt,hash){try{const known=Buffer.from(hash,'hex'),test=scryptSync(password,Buffer.from(salt,'hex'),32);return known.length===test.length&&timingSafeEqual(known,test)}catch{return false}}
function hashPassword(password){if(typeof password!=='string'||password.length<16||password.length>256)throw Error('Mot de passe requis : 16 à 256 caractères');const salt=randomBytes(16).toString('hex');return {salt,hash:scryptSync(password,Buffer.from(salt,'hex'),32).toString('hex')}}
function validateIdentity(username){if(!/^[a-z][a-z0-9._-]{2,49}$/.test(username||''))throw Error('Identifiant : 3 à 50 caractères, lettres minuscules, chiffres, point, tiret');}
function cleanRoles(roles){if(!Array.isArray(roles)||!roles.length||roles.some(x=>!ROLES.includes(x)))throw Error('Au moins un rôle connu est requis');return [...new Set(roles)]}
function cleanPermissions(perms,roles){if(!perms||typeof perms!=='object'||Array.isArray(perms))throw Error('Autorisations invalides');const cleaned={};for(const [key,value] of Object.entries(perms)){
 if(!(key in RIGHTS)||typeof value!=='boolean')throw Error('Permission inconnue : '+key);
 // Denials allowed for role permissions. Explicit grants cannot produce a role that has not been assigned.
 if(value===true && !RIGHTS[key].some(r=>roles.includes(r)))throw Error('Attribuer le rôle associé avant cette permission : '+key);
 cleaned[key]=value;
 }return cleaned}
function withTx(db,fn){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value}catch(e){db.exec('ROLLBACK');throw e}}
function audit(db,actor,action,target,details){db.prepare('INSERT INTO GoCmdAccessAudit(actor,action,target,details_json) VALUES (?,?,?,?)').run(actor,action,target,JSON.stringify(details||{}))}
// Security events: fail safely if the audit table/database is unavailable.
// Never store password, cookie, network address, or arbitrary submitted text.
// Unknown usernames are deliberately anonymized to avoid building a personal-data directory.
function recordLoginFailure(username,reason='invalid_credentials'){
 if(SERVER_RUNTIME)serverWriteRefused('recordLoginFailure');
 try {
   const db=connection(true);
   if(!installed(db) || !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='GoCmdAccessAudit'").get())return false;
   const candidate=typeof username==='string' ? username.trim().toLowerCase() : '';
   const valid=/^[a-z][a-z0-9._-]{2,49}$/.test(candidate);
   const user=valid ? db.prepare('SELECT username FROM GoCmdUser WHERE username=? COLLATE NOCASE').get(candidate) : null;
   const target=user ? user.username : 'unknown-account';
   const safeReason=['invalid_credentials','invalid_format','rate_limited'].includes(reason) ? reason : 'invalid_credentials';
   audit(db,'AUTH','session.login.failed',target,{reason:safeReason});
   return true;
 }catch{return false;}
}
/** Personal reauthentication for exceptional price approvals.
 * 5 failures/5 minutes per account, recorded in SQLite (cross-process).
 * Passwords are NEVER retained, logged or reflected into responses.
 */
function verifySensitivePassword(username,password,scope){
 if(SERVER_RUNTIME)serverWriteRefused('verifySensitivePassword');
 if(scope!=='director.prices' || typeof password!=='string' || !password || password.length>256)return 'invalid';
 try{
  const db=connection(true);
  if(!installed(db))return 'unavailable';
  return withTx(db,()=>{
   const row=db.prepare('SELECT username,salt,password_hash,active,is_root,must_change_password FROM GoCmdUser WHERE username=? COLLATE NOCASE').get(username);
   if(!row || !row.active || row.is_root || row.must_change_password)return 'invalid';
   const failCount=Number(db.prepare("SELECT COUNT(*) AS n FROM GoCmdAccessAudit WHERE actor=? AND action='sensitive.confirm.failed' AND at >= datetime('now','-5 minutes')").get(row.username).n);
   if(failCount>=5)return 'limited';
   if(!checkPassword(password,row.salt,row.password_hash)){
    audit(db,row.username,'sensitive.confirm.failed',scope,{});
    return 'invalid';
   }
   audit(db,row.username,'sensitive.confirm.ok',scope,{});
   return 'ok';
  });
 }catch{return 'unavailable'}
}
function ensureSchema(db){db.exec(`
CREATE TABLE IF NOT EXISTS GoCmdUser (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 salt TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 roles_json TEXT NOT NULL,
 permissions_json TEXT NOT NULL DEFAULT '{}',
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 is_root INTEGER NOT NULL DEFAULT 0 CHECK(is_root IN (0,1)),
 must_change_password INTEGER NOT NULL DEFAULT 1 CHECK(must_change_password IN (0,1)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS GoCmdAccessAudit (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 actor TEXT NOT NULL,
 action TEXT NOT NULL,
 target TEXT NOT NULL,
 details_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS GoCmdAccessAudit_at_idx ON GoCmdAccessAudit(at);
CREATE TABLE IF NOT EXISTS GoCmdSession (
 token_hash TEXT PRIMARY KEY,
 username TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(username) REFERENCES GoCmdUser(username) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS GoCmdSession_expires_idx ON GoCmdSession(expires_at);
`)}
function prepareSchema(){if(SERVER_RUNTIME)serverWriteRefused('prepareSchema');const db=connection(true);if(!db)throw Error("Base SQLite introuvable");return withTx(db,()=>{ensureSchema(db);return true})}
function bootstrap(username,password){if(SERVER_RUNTIME)serverWriteRefused('bootstrap');validateIdentity(username);const p=hashPassword(password);const db=connection(true);if(!db)throw Error('Base SQLite introuvable (GOCMD_DB_FILE ou DATABASE_URL)');return withTx(db,()=>{
 ensureSchema(db);
 if(Number(db.prepare('SELECT COUNT(*) AS n FROM GoCmdUser').get().n)>0)throw Error('Un administrateur existe déjà. Bootstrap refusé.');
 // The initial root is a configuration account, not an operational employee.
 const roles=["admin"];
 db.prepare('INSERT INTO GoCmdUser(username,salt,password_hash,roles_json,permissions_json,active,is_root,must_change_password) VALUES (?,?,?,?,?,1,1,0)').run(username,p.salt,p.hash,JSON.stringify(roles),'{}');
 audit(db,'SYSTEM','bootstrap',username,{roles});return {username,roles};
})}
function listUsers(){const db=connection();if(!installed(db))return [];return db.prepare('SELECT username,roles_json,permissions_json,active,is_root,must_change_password,created_at FROM GoCmdUser ORDER BY is_root DESC,username').all().map(r=>{
 const x=normalize(r);return {username:x.username,roles:x.roles,permissions:x.permissions,active:x.active,isRoot:x.isRoot,mustChangePassword:x.mustChangePassword,createdAt:x.createdAt}
})}
function createUser(actor,username,password,roles,permissions){if(SERVER_RUNTIME)serverWriteRefused('createUser');validateIdentity(username);roles=cleanRoles(roles);permissions=cleanPermissions(permissions,roles);const p=hashPassword(password);const db=connection(true);if(!installed(db))throw Error('Gestion des comptes non initialisée');return withTx(db,()=>{
 db.prepare('INSERT INTO GoCmdUser(username,salt,password_hash,roles_json,permissions_json,active,is_root,must_change_password) VALUES (?,?,?,?,?,1,0,1)').run(username,p.salt,p.hash,JSON.stringify(roles),JSON.stringify(permissions));
 audit(db,actor,'user.create',username,{roles,permissions});return {username}
})}
function updateUser(actor,username,changes){if(SERVER_RUNTIME)serverWriteRefused('updateUser');const db=connection(true);if(!installed(db))throw Error('Gestion des comptes non initialisée');return withTx(db,()=>{
 const row=readUser(username);if(!row)throw Error('Compte introuvable');
 if(row.isRoot && ('roles' in changes || 'active' in changes || 'permissions' in changes))throw Error('Le compte principal est protégé');
 if(username.toLowerCase()===actor.toLowerCase() && changes.active===false)throw Error('Vous ne pouvez pas désactiver votre propre compte');
 const roles=('roles' in changes)?cleanRoles(changes.roles):row.roles;
 const perms=('permissions' in changes)?cleanPermissions(changes.permissions,roles):cleanPermissions(row.permissions,roles);
 // AUDIT P5.15.27-A (SEC-06) : Boolean('false') valait true -> une desactivation
 // envoyee en chaine reactiverait le compte. Exiger un booleen strict.
 let active=row.active;
 if('active' in changes){
   if(typeof changes.active!=='boolean')throw Error('Statut actif invalide : booléen requis');
   active=changes.active;
 }
 if('password' in changes){const p=hashPassword(changes.password);db.prepare('UPDATE GoCmdUser SET salt=?,password_hash=?,must_change_password=1,updated_at=CURRENT_TIMESTAMP WHERE username=?').run(p.salt,p.hash,username)}
 db.prepare('UPDATE GoCmdUser SET roles_json=?,permissions_json=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE username=?').run(JSON.stringify(roles),JSON.stringify(perms),active?1:0,username);
 if('password' in changes || !active || 'roles' in changes || 'permissions' in changes)db.prepare('DELETE FROM GoCmdSession WHERE username=?').run(username);
 audit(db,actor,'user.update',username,{roles,permissions:perms,active,passwordReset:'password' in changes});return {username}
})}
function changeOwnPassword(username,oldPassword,newPassword){if(SERVER_RUNTIME)serverWriteRefused('changeOwnPassword');const db=connection(true);if(!installed(db))throw Error('Gestion non initialisée');const row=readUser(username);if(!row||!row.active||!checkPassword(oldPassword,row.salt,row.hash))throw Error('Ancien mot de passe incorrect');const p=hashPassword(newPassword);if(oldPassword===newPassword)throw Error('Le nouveau mot de passe doit être différent');return withTx(db,()=>{db.prepare('UPDATE GoCmdUser SET salt=?,password_hash=?,must_change_password=0,updated_at=CURRENT_TIMESTAMP WHERE username=?').run(p.salt,p.hash,username);db.prepare('DELETE FROM GoCmdSession WHERE username=?').run(username);audit(db,username,'password.change',username,{});return {ok:true}})}
function recentAudit(limit=50){const db=connection();if(!installed(db))return [];return db.prepare('SELECT id,at,actor,action,target,details_json FROM GoCmdAccessAudit ORDER BY id DESC LIMIT ?').all(Math.max(1,Math.min(limit,200))).map(x=>({...x,details:safeJson(x.details_json,{}) ,details_json:undefined}))}
function allowed(roles,permissions,key,isRoot=false){
 if(!(key in RIGHTS))return false;
 // Explicit director permission is NEVER implied by admin alone.
 if(key==='director.prices'&&!roles.includes('director'))return false;
 // A root account is reserved for configuration. Never inherit operational
 // rights, even if its legacy database row still contains obsolete roles.
 if(isRoot)return key==='users.read'||key==='users.manage';
 const defaultGrant=RIGHTS[key].some(r=>roles.includes(r));
 return defaultGrant && permissions?.[key]!==false;
}
const SESSION_SECONDS=8*60*60;
function sessionHash(token){return createHash('sha256').update(token).digest('hex')}
function createSession(username){
 if(SERVER_RUNTIME)serverWriteRefused('createSession');
 const db=connection(true);if(!installed(db))throw Error('Comptes non initialisés');
 const user=readUser(username);if(!user?.active)throw Error('Compte désactivé');
 const token=randomBytes(32).toString('base64url');
 return withTx(db,()=>{
   // Session table is installed offline: run upgrade-admin-session.cjs on existing databases.
   if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='GoCmdSession'").get())throw Error('Migration sessions manquante : exécutez scripts/upgrade-admin-session.cjs');
   db.prepare('DELETE FROM GoCmdSession WHERE expires_at<=?').run(Math.floor(Date.now()/1000));
   db.prepare('INSERT INTO GoCmdSession(token_hash,username,expires_at) VALUES (?,?,?)').run(sessionHash(token),username,Math.floor(Date.now()/1000)+SESSION_SECONDS);
   audit(db,username,'session.login',username,{});
   return {token,maxAge:SESSION_SECONDS};
 })
}
function readSession(token){
 if(!/^[A-Za-z0-9_-]{40,100}$/.test(token||''))return null;
 try{
   const db=connection();if(!installed(db))return null;
   const row=db.prepare('SELECT username FROM GoCmdSession WHERE token_hash=? AND expires_at>?').get(sessionHash(token),Math.floor(Date.now()/1000));
   if(!row)return null;
   const user=readUser(row.username);return user?.active?user:null;
 }catch{return null}
}
function revokeSession(token){
 if(SERVER_RUNTIME)serverWriteRefused('revokeSession');
 if(!/^[A-Za-z0-9_-]{40,100}$/.test(token||''))return false;
 const db=connection(true);if(!installed(db))return false;
 return withTx(db,()=>{
   const row=db.prepare('SELECT username FROM GoCmdSession WHERE token_hash=?').get(sessionHash(token));
   const changes=db.prepare('DELETE FROM GoCmdSession WHERE token_hash=?').run(sessionHash(token));
   if(row)audit(db,row.username,'session.logout',row.username,{});
   return changes.changes>0;
 });
}
function migrateRootAndSessions(){
 if(SERVER_RUNTIME)serverWriteRefused('migrateRootAndSessions');
 const db=connection(true);if(!db)throw Error('Base SQLite introuvable');
 return withTx(db,()=>{
   ensureSchema(db);
   const roots=db.prepare('SELECT username,roles_json FROM GoCmdUser WHERE is_root=1').all();
   if(roots.length!==1)throw Error('Un compte principal unique est requis');
   const root=roots[0];
   db.prepare("UPDATE GoCmdUser SET roles_json=?,permissions_json='{}',updated_at=CURRENT_TIMESTAMP WHERE is_root=1").run(JSON.stringify(["admin"]));
   db.prepare('DELETE FROM GoCmdSession WHERE username=?').run(root.username);
   audit(db,'SYSTEM','root.admin-only',root.username,{previousRoles:safeJson(root.roles_json,[]),roles:['admin']});
   return {username:root.username};
 });
}
module.exports={ROLES,RIGHTS,dbFilename,managed,readUser,checkPassword,hashPassword,validateIdentity,cleanRoles,cleanPermissions,prepareSchema,bootstrap,listUsers,createUser,updateUser,changeOwnPassword,recentAudit,recordLoginFailure,verifySensitivePassword,allowed,createSession,readSession,revokeSession,migrateRootAndSessions,isServerRuntime:()=>SERVER_RUNTIME};
