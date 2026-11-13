import { NextRequest, NextResponse } from "next/server"
import { accessGate, currentActor } from "@/lib/access-gate"
export const dynamic = "force-dynamic"
export async function GET(req:NextRequest) {
 const denied=accessGate(req);if(denied)return denied
 const actor=currentActor(req)
 if(!actor)return NextResponse.json({error:"Non authentifié"},{status:401})
 return NextResponse.json({username:actor.username,roles:actor.roles,legacy:actor.legacy,managed:Boolean(actor.managed),isRoot:Boolean(actor.isRoot),permissions:actor.permissions||{},mustChangePassword:Boolean(actor.mustChangePassword)},{headers:{"Cache-Control":"private, no-store"}})
}
