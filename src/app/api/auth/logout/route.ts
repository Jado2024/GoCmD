import { NextRequest, NextResponse } from "next/server"
import * as directory from "@/lib/user-directory.cjs"
import { revokeSession } from "@/lib/identity-writes"
import {isAllowedMutationOrigin} from "@/lib/access-gate"
export const dynamic = "force-dynamic"
export async function POST(req:NextRequest) {
  if(req.headers.get("sec-fetch-site")==="cross-site" || !req.headers.get("origin") || !isAllowedMutationOrigin(req))
    return NextResponse.json({error:"Origine non autorisée"},{status:403})
  const token=req.cookies.get("gocmd_session")?.value||""
  if(token)await revokeSession(token)
  const response=NextResponse.json({ok:true},{headers:{"Cache-Control":"no-store","Clear-Site-Data":'"cache"'}})
  response.cookies.set("gocmd_session","",{
    httpOnly:true,path:"/",sameSite:"lax",maxAge:0,expires:new Date(0),
    secure:req.nextUrl.protocol==="https:" || (process.env.GOCMD_PUBLIC_ORIGIN||"").startsWith("https://")
  })
  return response
}
