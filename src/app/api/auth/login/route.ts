import { NextRequest, NextResponse } from "next/server"
import * as directory from "@/lib/user-directory.cjs"
// R13.3 (CORR-01) : écritures identités via le moteur Prisma unique.
import { createSession, recordLoginFailure } from "@/lib/identity-writes"
import { isAllowedMutationOrigin } from "@/lib/access-gate"

export const dynamic = "force-dynamic"

// App-level rate limiter complements required reverse-proxy/IP protection.
// Its per-process state is not a distributed rate limit.
const attempts = new Map<string, {count:number, until:number}>()
const LIMIT = 10
const WINDOW = 5*60*1000
// AUDIT P5.15.27-A (SEC-05) : la map n'est purgee qu'a la reussite ; des
// identifiants distincts au format valide la faisaient croitre sans borne.
// Meme garde que le limiteur Basic de access-gate.ts (10 000 entrees).
const MAX_TRACKED_KEYS = 10000
function pruneAttempts(now:number){
  if(attempts.size<=MAX_TRACKED_KEYS)return
  for(const [k,v] of attempts){if(now>=v.until)attempts.delete(k)}
  // Garantie de borne : si des fenetres actives restent au-dessus de la limite,
  // evicter les plus anciennes jusqu'a revenir sous le plafond memoire.
  while(attempts.size>MAX_TRACKED_KEYS){
    let oldestKey:string|null=null,oldestUntil=Infinity
    for(const [k,v] of attempts){if(v.until<oldestUntil){oldestUntil=v.until;oldestKey=k}}
    if(oldestKey===null)break
    attempts.delete(oldestKey)
  }
}

function safeTransport(req: NextRequest): boolean {
  const host = (req.headers.get("host")||"").split(":")[0].toLowerCase()
  const local = ["localhost","127.0.0.1","[::1]","::1"].includes(host)
  const publicOrigin = process.env.GOCMD_PUBLIC_ORIGIN||""
  if (publicOrigin) { try {return new URL(publicOrigin).protocol==="https:" || local} catch {return false} }
  return local || req.nextUrl.protocol === "https:"
}

export async function POST(req:NextRequest) {
  if (directory.managedState()==='unavailable') return NextResponse.json({error:'Service d’authentification temporairement indisponible'},{status:503,headers:{'Retry-After':'1'}})
  if (!directory.managed()) return NextResponse.json({error:"Gestion SQLite non initialisée"},{status:503})
  if (!safeTransport(req)) return NextResponse.json({error:"Connexion HTTPS requise hors de cet ordinateur"},{status:403})
  if (req.headers.get("sec-fetch-site")==="cross-site" || !req.headers.get("origin") || !isAllowedMutationOrigin(req))
    return NextResponse.json({error:"Origine non autorisée"},{status:403})
  const body = await req.json().catch(()=>null)
  const username = typeof body?.username==="string" ? body.username.trim().toLowerCase() : ""
  const password = typeof body?.password==="string" ? body.password : ""
  if (!/^[a-z][a-z0-9._-]{2,49}$/.test(username) || password.length>256) {
    await recordLoginFailure(username,'invalid_format')
    return NextResponse.json({error:"Identifiants incorrects"},{status:401,headers:{"Cache-Control":"no-store"}})
  }
  // RR-04: an account-only limiter lets a remote attacker lock every user.
  // When a LOCKED-DOWN trusted reverse proxy rewrites X-Forwarded-For,
  // isolate the limit per client AND account. Never trust client-provided XFF
  // unless the operator explicitly enables this mode behind that proxy.
  const forwarded = process.env.GOCMD_TRUST_PROXY === "1"
    ? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() : null
  const trustedClient = forwarded && /^[0-9a-fA-F.:]{3,45}$/.test(forwarded) ? forwarded : null
  const key = trustedClient ? `ip:${trustedClient}:account:${username}` : `account:${username}`
  const now=Date.now()
  pruneAttempts(now)
  const state=attempts.get(key)
  if(state && now<state.until && state.count>=LIMIT)
    return NextResponse.json({error:"Trop de tentatives. Réessayez plus tard."},{status:429,headers:{"Retry-After":"300","Cache-Control":"no-store"}})
  const lookup=directory.readUserState(username)
  if(lookup.status==='unavailable')return NextResponse.json({error:'Service d’authentification temporairement indisponible'},{status:503,headers:{'Retry-After':'1','Cache-Control':'no-store'}})
  const user=lookup.status==='valid'?lookup.user:null
  if(!user?.active || !directory.checkPassword(password,user.salt,user.hash)) {
    const count=state&&now<state.until?state.count+1:1
    attempts.set(key,{count,until:now+WINDOW})
    await recordLoginFailure(username,'invalid_credentials')
    if(count===LIMIT)await recordLoginFailure(username,'rate_limited')
    return NextResponse.json({error:"Identifiants incorrects"},{status:401,headers:{"Cache-Control":"no-store"}})
  }
  attempts.delete(key)
  try {
    const session=await createSession(user.username)
    const response=NextResponse.json({ok:true},{headers:{"Cache-Control":"no-store"}})
    response.cookies.set("gocmd_session",session.token,{
      httpOnly:true,sameSite:"lax",secure:req.nextUrl.protocol==="https:" ||
        (process.env.GOCMD_PUBLIC_ORIGIN||"").startsWith("https://"),
      path:"/",maxAge:session.maxAge
    })
    return response
  } catch {
    return NextResponse.json({error:"Session indisponible : vérifier la mise à niveau de la base SQLite"},{status:503})
  }
}
