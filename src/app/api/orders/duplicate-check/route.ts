import { NextRequest, NextResponse } from "next/server"
import { accessGate } from "@/lib/access-gate"
import { db } from "@/lib/db"
import { OrderCreateSchema } from "@/lib/order-create-schema"
import { lookupOrderDuplicates } from "@/lib/order-duplicate"

export const dynamic="force-dynamic"

/** Contrôle informatif AVANT création ; le POST /api/orders le refait dans la transaction. */
export async function POST(req:NextRequest){
  const denied=accessGate(req,"sales")
  if(denied)return denied
  const input=OrderCreateSchema.safeParse(await req.json().catch(()=>null))
  if(!input.success)return NextResponse.json({error:"Commande invalide"},{status:400})
  try {
    const check=await db.$transaction(tx=>lookupOrderDuplicates(tx,input.data))
    return NextResponse.json(check,{headers:{"Cache-Control":"private, no-store"}})
  } catch {
    return NextResponse.json({error:"Vérification de doublons indisponible : création suspendue"},{status:503})
  }
}
