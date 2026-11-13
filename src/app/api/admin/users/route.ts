import { NextRequest, NextResponse } from "next/server"
import {accessGate,currentActor,hasPermission,hasRole} from "@/lib/access-gate"
import * as directory from "@/lib/user-directory.cjs"
import { createUser, updateUser } from "@/lib/identity-writes"
import {safeUserDirectoryMessage} from "@/lib/user-admin-errors"
export const dynamic="force-dynamic"

// Autoriser HTTP uniquement pour l'origine explicitement locale.
// L'ancien contrôle refusait tout GOCMD_PUBLIC_ORIGIN=http://...,
// y compris http://127.0.0.1:3001, et bloquait l'administration.
function secure(req:NextRequest):boolean{
  const configured=(process.env.GOCMD_PUBLIC_ORIGIN||"").trim()
  const host=(req.headers.get("host")||"").trim().toLowerCase()
  const loopbacks=new Set(["localhost","127.0.0.1","[::1]","::1"])
  if(configured){
    try{
      const url=new URL(configured)
      if(url.protocol==="https:")return true
      // Ne jamais accepter une origine HTTP publique, ni un autre port/hôte.
      return url.protocol==="http:" && loopbacks.has(url.hostname.toLowerCase()) && host===url.host.toLowerCase()
    }catch{return false}
  }
  try{
    const url=new URL(`http://${host}`)
    return loopbacks.has(url.hostname.toLowerCase())
  }catch{return false}
}
function authorized(req:NextRequest,write=false){
  const failure=accessGate(req)
  if(failure)return failure
  const actor=currentActor(req)
  if(!actor?.managed||actor.legacy||!hasRole(req,"admin")||!hasPermission(req,write?"users.manage":"users.read"))return NextResponse.json({error:"Administration des comptes réservée aux administrateurs habilités"},{status:403})
  if(!secure(req))return NextResponse.json({error:"Administration des comptes : HTTPS requis hors localhost. Configurez GOCMD_PUBLIC_ORIGIN en https."},{status:403})
  return null
}
function roleAllowed(actor:{isRoot?:boolean},roles:string[]):boolean{
  // Seul le compte principal peut déléguer les rôles privilégiés.
  return Boolean(actor.isRoot) || !roles.some(role=>["admin","director","finance"].includes(role))
}
function fail(e:unknown){
  // Audit 10/11/2026 (SEC-ERR-01) : liste blanche stricte des messages métier ;
  // toute erreur d'infrastructure (SQLite, verrou, chemin) devient générique.
  const message=e instanceof Error?e.message:""
  const translated=message.includes("UNIQUE")?"Identifiant déjà utilisé":null
  return NextResponse.json({error:translated??safeUserDirectoryMessage(e)},{status:400,headers:{"Cache-Control":"no-store"}})
}
export async function GET(req:NextRequest){
  const denied=authorized(req);if(denied)return denied
  return NextResponse.json({users:directory.listUsers(),audit:directory.recentAudit(80),roles:directory.ROLES,rights:directory.RIGHTS},{headers:{"Cache-Control":"private, no-store"}})
}
export async function POST(req:NextRequest){
  const denied=authorized(req,true);if(denied)return denied
  const actor=currentActor(req)!
  try{
    const body=await req.json()
    const roles=body.roles
    if(!Array.isArray(roles)||!roleAllowed(actor,roles))return NextResponse.json({error:"Attribution des rôles sensibles réservée à l'administrateur principal"},{status:403})
    const result=await createUser(actor.username,body.username,body.password,roles,body.permissions||{})
    return NextResponse.json(result,{status:201,headers:{"Cache-Control":"no-store"}})
  }catch(e){return fail(e)}
}
export async function PATCH(req:NextRequest){
  const denied=authorized(req,true);if(denied)return denied
  const actor=currentActor(req)!
  try{
    const body=await req.json()
    const original=directory.readUser(body.username)
    if(!original)return NextResponse.json({error:"Utilisateur introuvable"},{status:404})
    if(!actor.isRoot && (original.isRoot || original.roles.some((role:string)=>["admin","director","finance"].includes(role))))return NextResponse.json({error:"Modification d'un compte sensible réservée à l'administrateur principal"},{status:403})
    const roles=body.roles??original.roles
    if(!Array.isArray(roles)||!roleAllowed(actor,roles))return NextResponse.json({error:"Attribution des rôles sensibles réservée à l'administrateur principal"},{status:403})
    const changes: {roles?:string[];permissions?:Record<string,boolean>;active?:boolean;password?:string}={}
    for(const key of ["roles","permissions","active","password"] as const)if(Object.prototype.hasOwnProperty.call(body,key)){
      if(key==="roles")changes.roles=body.roles
      if(key==="permissions")changes.permissions=body.permissions
      if(key==="active")changes.active=body.active
      if(key==="password")changes.password=body.password
    }
    return NextResponse.json(await updateUser(actor.username,body.username,changes),{headers:{"Cache-Control":"no-store"}})
  }catch(e){return fail(e)}
}
