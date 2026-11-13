import { NextRequest, NextResponse } from "next/server"
import { currentActor } from "@/lib/access-gate"
// R13.3 (CORR-01) : la confirmation sensible écrit son audit via le moteur
// Prisma unique ; node:sqlite reste lecture seule en mode serveur.
import { verifySensitivePassword } from "@/lib/identity-writes"

/** Only for exceptional monetary decisions, never ordinary approvals.
 * Require fresh personal password, plus session/role/permission checked by route.
 * No shared secret and no password retention. Localhost HTTP is for isolated tests only.
 */
export async function requireDirectorPriceConfirmation(req:NextRequest,password:unknown):Promise<NextResponse|null> {
  const actor=currentActor(req)
  if(!actor?.managed || actor.isRoot)return NextResponse.json({error:"Compte nominatif requis pour le visa tarifaire"},{status:403})
  const rawHost=(req.headers.get("host")||"").split(":")[0].toLowerCase()
  const local=["localhost","127.0.0.1","[::1]","::1"].includes(rawHost)
  let secure=false
  try{
    const configured=process.env.GOCMD_PUBLIC_ORIGIN?.trim()
    secure=(configured?new URL(configured).protocol:req.nextUrl.protocol)==="https:"
  }catch{}
  if(!local && !secure)return NextResponse.json({error:"HTTPS requis pour cette confirmation"},{status:403})
  if(typeof password!=="string" || !password || password.length>256)
    return NextResponse.json({error:"Mot de passe personnel requis pour autoriser ce prix"},{status:400})
  const result=await verifySensitivePassword(actor.username,password,"director.prices")
  if(result==="limited")return NextResponse.json({error:"Trop de tentatives. Réessayez dans 5 minutes."},{status:429,headers:{"Retry-After":"300","Cache-Control":"no-store"}})
  if(result==="unavailable")return NextResponse.json({error:"Confirmation indisponible, aucune décision enregistrée"},{status:503})
  if(result!=="ok")return NextResponse.json({error:"Confirmation personnelle incorrecte"},{status:403,headers:{"Cache-Control":"no-store"}})
  return null
}
