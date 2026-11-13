import { scryptSync, timingSafeEqual } from "node:crypto"
import * as directory from "./user-directory.cjs"

type Role = "buyer" | "sales" | "approver" | "receiver" | "inventory" | "quality" | "finance" | "admin" | "director" | "production"
type Account = {salt:string, hash:string, roles:Role[]}
type Actor = {username:string,roles:Role[],legacy:boolean,managed?:boolean,isRoot?:boolean,permissions?:Record<string,boolean>,mustChangePassword?:boolean}
function accounts(): Record<string, Account> {
  try {
    const val = JSON.parse(process.env.GOCMD_USERS_JSON || "{}")
    if (!val || typeof val !== "object" || Array.isArray(val)) return {}
    return val
  } catch {return {}}
}
export function isAccessConfigured() {
  return directory.managed() || (process.env.GOCMD_REQUIRE_SQLITE_USERS!=="1" && (Object.keys(accounts()).length > 0 || (process.env.GOCMD_ACCESS_PASSWORD??"").length >= 16))
}
// Limiteur d'échecs d'authentification par identifiant (défense locale d'un processus).
// Un reverse proxy doit également limiter par IP et imposer HTTPS sur le déploiement.
const failedAttempts = new Map<string, {count:number;since:number;blockedUntil:number}>()
const WINDOW_MS = 5 * 60_000
const BLOCK_MS = 60_000
const MAX_FAILURES = 12
function blocked(name:string):boolean {
  const entry=failedAttempts.get(name)
  if(!entry)return false
  if(Date.now()-entry.since>WINDOW_MS && Date.now()>entry.blockedUntil){failedAttempts.delete(name);return false}
  return Date.now()<entry.blockedUntil
}
function recordFailure(name:string):void {
  const now=Date.now()
  if(failedAttempts.size>10000){for(const [key,entry] of failedAttempts){if(now-entry.since>WINDOW_MS){failedAttempts.delete(key)}}}
  const previous=failedAttempts.get(name)
  const entry=!previous||now-previous.since>WINDOW_MS?{count:0,since:now,blockedUntil:0}:previous
  entry.count++
  if(entry.count>=MAX_FAILURES)entry.blockedUntil=now+BLOCK_MS
  failedAttempts.set(name,entry)
}
function credentials(request:Request):{name:string,password:string}|null {
  const header=request.headers.get("authorization")??""
  if(!header.startsWith("Basic "))return null
  try {
    const raw=Buffer.from(header.slice(6),"base64").toString("utf8")
    const i=raw.indexOf(":")
    if(i<1)return null
    return {name:raw.slice(0,i), password:raw.slice(i+1)}
  } catch {return null}
}
export function currentActor(request:Request):Actor|null {
  // SQLite identities use revocable HttpOnly sessions. Browser Basic Auth
  // credentials must never allow an authenticated user to bypass logout.
  if(directory.managed()){
    const sessionCookie=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('gocmd_session='));
    const token=sessionCookie?.slice('gocmd_session='.length)||'';
    const entry=directory.readSession(token);
    if(!entry)return null;
    return {username:entry.username,roles:entry.roles as Role[],legacy:false,
      managed:true,isRoot:entry.isRoot,permissions:entry.permissions,mustChangePassword:entry.mustChangePassword};
  }
  const c=credentials(request)
  if(!c)return null
  // Dès le bootstrap, SQLite est l'unique source d'identités :
  // aucune porte démo ou GOCMD_USERS_JSON ne reste utilisable.
  // Mode obligatoire : si la table comptes disparaît, refuser toute authentification.
  if(process.env.GOCMD_REQUIRE_SQLITE_USERS==="1")return null
  const users=accounts()
  if(Object.keys(users).length){
    const entry=users[c.name]
    if(!entry || !Array.isArray(entry.roles) || !/^[a-f0-9]{32,}$/i.test(entry.salt) || !/^[a-f0-9]{64}$/i.test(entry.hash))return null
    try {
      const stored=Buffer.from(entry.hash,"hex")
      const computed=scryptSync(c.password,Buffer.from(entry.salt,"hex"),32)
      if(stored.length===computed.length && timingSafeEqual(stored,computed))return {username:c.name,roles:entry.roles,legacy:false}
    }catch{}
    return null
  }
  // Historical shared password is DEMO / READ-ONLY unless expressly enabled.
  const shared=process.env.GOCMD_ACCESS_PASSWORD??""
  if(c.name!=="gocmd"||shared.length<16)return null
  const guess=Buffer.from(c.password,"utf8"), known=Buffer.from(shared,"utf8")
  return guess.length===known.length&&timingSafeEqual(guess,known)?{username:"legacy-demo",roles:[],legacy:true}:null
}
export function authorizedAccess(request:Request){return currentActor(request)!==null}
/** Seul un compte doté EXPLICITEMENT du rôle director peut engager un prix spécial.
 * Le rôle admin et le rôle approver ne suffisent pas. */
export function isDirector(request:Request):boolean{
  const actor=currentActor(request)
  return Boolean(actor && !actor.legacy && actor.roles.includes("director"))
}
/** Permissions limitées aux rôles attribués ; un refus explicite prévaut.
 * Le prix spécial exige toujours le rôle director, même pour admin. */
export function hasPermission(request:Request,key:string):boolean{
  const actor=currentActor(request)
  if(!actor || actor.legacy)return false
  return directory.allowed(actor.roles,actor.permissions||{},key,actor.isRoot)
}
export function hasRole(request:Request,role:Role):boolean{
  const actor=currentActor(request)
  if(!actor)return false
  // V18.9.9 (SEC-LEGACY-01) : le compte partagé n'obtient JAMAIS de rôle
  // métier, quel que soit l'environnement. L'ancien drapeau
  // GOCMD_ALLOW_LEGACY_WRITES est supprimé : aucun mode de compatibilité ne
  // peut élever les privilèges du compte de démonstration.
  if(actor.legacy)return false
  return actor.roles.includes(role)
}
/** V18.9.1 (contre-audit A-09) : lecture restreinte à un ensemble de rôles.
 * Un compte démo partagé ne dispose pas de rôles nominatifs et ne peut
 * consulter les documents métier réservés aux utilisateurs habilités. */
export function hasAnyReadRole(request:Request,roles:readonly Role[]):boolean{
  const actor=currentActor(request)
  if(!actor)return false
  if(actor.legacy)return false
  return actor.roles.some(r=>r!=="admin" && roles.includes(r))
}
/** V18.9.2 (contre-audit F03) : matrice de visibilité des COÛTS MATIÈRES.
 * Même matrice que les tarifs fournisseurs (A-09) : achats (buyer),
 * approbation, finances — l'admin voit tout. Les autres rôles authentifiés
 * (qualité, magasin, réception, ventes…) reçoivent les fiches matières et les
 * documents d'approvisionnement SANS prix unitaire ni coût moyen : les
 * imbrications et agrégats financiers du tableau de bord sont filtrés
 * également : une valorisation par catégorie permettrait de déduire
 * des coûts matière même lorsque le prix unitaire est masqué. */
export const MATERIAL_COST_ROLES: readonly Role[] = ["buyer","approver","finance"]
export function canSeeMaterialCosts(request:Request):boolean{
  const actor=currentActor(request)
  // A legacy/shared demo account is never a named finance/buyer/approver.
  // Even in read-only mode it must not see procurement prices.
  return Boolean(actor && !actor.legacy &&
    (actor.managed ? hasPermission(request,"costs.read") : (actor.roles.some(r=>MATERIAL_COST_ROLES.includes(r)))))
}
export function readRoleGate(request:Request,roles:Role[]):Response|null{
  if(!isAccessConfigured())return Response.json({error:"Initialiser les comptes SQLite ou configurer explicitement un accès de démonstration"},{status:503})
  const supplied=directory.managed()?null:credentials(request)
  const name=supplied?.name??"anonymous"
  if(!directory.managed() && blocked(name))return Response.json({error:"Trop de tentatives. Réessayez plus tard."},{status:429,headers:{"Retry-After":"60","Cache-Control":"no-store"}})
  const actor=currentActor(request)
  if(!actor){
    if(directory.managed())return Response.json({error:"Session expirée : reconnectez-vous"},{status:401,headers:{"Cache-Control":"no-store"}});
    recordFailure(name);return new Response("Authentification GoCmd requise",{status:401,headers:{"WWW-Authenticate":'Basic realm="GoCmd", charset="UTF-8"',"Cache-Control":"no-store"}})
  }
  if(!directory.managed())failedAttempts.delete(name)
  if(actor.mustChangePassword)return Response.json({error:"Changer le mot de passe initial avant de continuer"},{status:403})
  if(!hasAnyReadRole(request,roles))return Response.json({error:"Lecture réservée aux rôles concernés"},{status:403})
  return null
}
/** Validate same-origin browser writes using the actual HTTP authority, not
 * Next.js's synthetic request.url (which may always be localhost).
 * For TLS termination configure GOCMD_PUBLIC_ORIGIN to the public https:// URL.
 * Forwarded Host is trusted ONLY when GOCMD_TRUST_PROXY=1 on a locked-down proxy.
 */
export function isAllowedMutationOrigin(request:Request):boolean {
  const raw = request.headers.get("origin")
  if (!raw) return true // Non-browser scripts are authenticated separately.
  let origin:URL
  try {
    origin = new URL(raw)
    if (!["http:", "https:"].includes(origin.protocol) || origin.origin !== raw || origin.username || origin.password) return false
  } catch { return false }
  const publicOrigin = (process.env.GOCMD_PUBLIC_ORIGIN ?? "").trim()
  if (publicOrigin) {
    try {return origin.origin === new URL(publicOrigin).origin} catch {return false}
  }
  let host = request.headers.get("host")
  if (process.env.GOCMD_TRUST_PROXY === "1") {
    host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || host
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim()
    if (forwardedProto && `${forwardedProto}:` !== origin.protocol) return false
  }
  if (!host || host.includes("/") || host.includes("@") || host.includes(",")) return false
  return origin.host.toLowerCase() === host.toLowerCase()
}

// Garde supplémentaire d'action pour les comptes SQLite multi-rôles.
// Le rôle reste nécessaire : les permissions ne fabriquent pas de rôles.
function permissionForOperation(request:Request):string|null{
  if(!["POST","PUT","PATCH","DELETE"].includes(request.method))return null
  const route=new URL(request.url).pathname.replace(/\/$/,"")
  if(route==="/api/purchases")return "purchases.create"
  if(/^\/api\/purchases\/\d+$/.test(route))return "purchases.approve"
  if(route==="/api/supplier-orders")return "supplier-orders.create"
  if(/^\/api\/supplier-orders\/\d+$/.test(route))return "supplier-orders.approve"
  if(route==="/api/goods-receipts")return "receipts.create"
  if(route==="/api/quality-inspections"||route==="/api/supplier-returns")return "quality.manage"
  if(route==="/api/movements")return "stock.move"
  if(route==="/api/materials"||/^\/api\/materials\/\d+$/.test(route))return "materials.manage"
  // POST fournisseurs est une union d'actions métiers : buyer crée/propose,
  // approver valide une exception. La route contrôle chaque permission APRÈS
  // discrimination de l'action ; appliquer suppliers.manage à toutes les
  // écritures ici bloquerait un approbateur légitime avant son visa.
  if(route==="/api/suppliers" && request.method==="POST")return null
  if(route==="/api/suppliers")return "suppliers.manage"
  if(route==="/api/products")return "products.create"
  if(/^\/api\/products\/\d+$/.test(route))return "products.manage"
  if(route==="/api/clients"||route==="/api/orders")return "sales.orders"
  // Les mutations OF ont des droits distincts selon action : preparation=stock.move, validation historique=sales.approve.
  // Verification fine dans chaque handler, pas une permission unique sales.approve ici.
  if(route==="/api/work-orders"||/^\/api\/work-orders\/\d+$/.test(route))return null
  if(route==="/api/supplier-invoices"||/^\/api\/supplier-invoices\/\d+$/.test(route)||route==="/api/p2p/finance")return "finance.purchases"
  if(route==="/api/p2p/replenishment")return "purchases.create"
  // More complex sub-actions are checked by their own handlers.
  return null
}
export function accessGate(request:Request, requiredRole?:Role):Response|null{
  if(!isAccessConfigured())return Response.json({error:"Initialiser les comptes SQLite ou configurer explicitement un accès de démonstration"},{status:503})
  const pathname=new URL(request.url).pathname;
  // Public endpoints for cookie-based SQLite login/logout.
  if(directory.managed() && ['/login','/api/auth/login','/api/auth/logout'].includes(pathname))return null;
  const supplied=directory.managed()?null:credentials(request)
  const name=supplied?.name??"anonymous"
  if(!directory.managed() && blocked(name))return Response.json({error:"Trop de tentatives. Réessayez plus tard."},{status:429,headers:{"Retry-After":"60","Cache-Control":"no-store"}})
  const actor=currentActor(request)
  if(!actor){
    if(directory.managed()){
      if(!pathname.startsWith('/api/') && request.method==='GET')return Response.redirect(new URL('/login',request.url),302);
      return Response.json({error:'Session expirée : reconnectez-vous'},{status:401,headers:{'Cache-Control':'no-store'}});
    }
    recordFailure(name);return new Response("Authentification GoCmd requise",{status:401,headers:{"WWW-Authenticate":'Basic realm="GoCmd", charset="UTF-8"',"Cache-Control":"no-store"}})
  }
  if(!directory.managed())failedAttempts.delete(name)
  // A pure administrator handles configuration only, with no read or write
  // access to any operational API, even those using accessGate alone.
  if(actor.managed && actor.roles.every(r=>r==='admin') && pathname.startsWith('/api/') &&
      !['/api/me','/api/me/password','/api/admin/users','/api/auth/logout'].includes(pathname))
    return Response.json({error:'Compte administration : aucune opération métier autorisée'},{status:403});
  // A client-read denial also protects copies embedded in commercial documents,
  // print exports and mutation responses. Keep existing director/approver role
  // contracts: this restriction applies to an explicit managed-account denial.
  if(actor.managed && actor.permissions?.['clients.read']===false &&
      /^\/api\/(?:clients|orders|sales)(?:\/|$)/.test(pathname))
    return Response.json({error:'Lecture des données clients désactivée pour votre compte'},{status:403});
  // L'interface et le changement de mot de passe restent accessibles, mais
  // aucune donnée métier n'est exposée avant le changement initial.
  if(actor.mustChangePassword){
    const url=new URL(request.url).pathname
    if(url.startsWith('/api/') && url!=='/api/me' && url!=='/api/me/password')
      return Response.json({error:"Changement de mot de passe initial obligatoire"},{status:403})
  }
  if(requiredRole&&!hasRole(request,requiredRole))return Response.json({error:"Autorisation insuffisante pour cette action"},{status:403})
  const permission=actor.managed?permissionForOperation(request):null
  if(permission&&!hasPermission(request,permission))return Response.json({error:"Permission désactivée pour votre compte"},{status:403})
  if(["POST","PATCH","PUT","DELETE"].includes(request.method)){
    // V18.9.9 (SEC-LEGACY-01) : le compte partagé est strictement en lecture
    // seule. Plus aucun drapeau d'environnement ne réactive ses écritures.
    if(actor.legacy)return Response.json({error:"Mode démonstration en lecture seule : configurer les utilisateurs individuels"},{status:403})
    if(request.headers.get("sec-fetch-site")==="cross-site")return Response.json({error:"Requête intersite refusée"},{status:403})
    const origin=request.headers.get("origin")
    if(actor.managed && !origin)return Response.json({error:'Origine requise pour les opérations authentifiées'},{status:403})
    if(origin && !isAllowedMutationOrigin(request))return Response.json({error:"Origine refusée"},{status:403})
  }
  return null
}
