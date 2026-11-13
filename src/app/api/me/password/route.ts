import {NextRequest,NextResponse} from "next/server"
import {accessGate,currentActor} from "@/lib/access-gate"
import * as directory from "@/lib/user-directory.cjs"
import { changeOwnPassword } from "@/lib/identity-writes"
import {safeUserDirectoryMessage} from "@/lib/user-admin-errors"
export const dynamic="force-dynamic"
export async function POST(req:NextRequest){
  const denied=accessGate(req);if(denied)return denied
  const actor=currentActor(req)
  if(!actor?.managed||actor.legacy)return NextResponse.json({error:"Compte individuel requis"},{status:403})
  try{
    const body=await req.json()
    await changeOwnPassword(actor.username,body.oldPassword,body.newPassword)
    return NextResponse.json({ok:true,message:"Mot de passe changé. Rechargez l'application et reconnectez-vous avec le nouveau mot de passe."},{headers:{"Cache-Control":"no-store"}})
  }catch(e){return NextResponse.json({error:safeUserDirectoryMessage(e)},{status:400})}
}
