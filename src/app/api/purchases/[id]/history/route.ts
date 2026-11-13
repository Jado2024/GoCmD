import { NextRequest, NextResponse } from "next/server";
import { readRoleGate } from "@/lib/access-gate";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
/** Décisions de la DA : pagination stable par id d'événement, sans coupure à 3 000.
 * Aucune donnée de devis/prix n'est exposée dans ce journal.
 */
export async function GET(req:NextRequest,ctx:{params:Promise<{id:string}>}) {
  const denied=readRoleGate(req,["buyer","approver"]);
  if(denied)return denied;
  const {id}=await ctx.params;
  const requestId=Number(id);
  if(!Number.isSafeInteger(requestId)||requestId<=0)return NextResponse.json({error:"DA invalide"},{status:400});
  const rawCursor=req.nextUrl.searchParams.get("cursor");
  const cursor=rawCursor===null?null:Number(rawCursor);
  if(rawCursor!==null&&(!Number.isSafeInteger(cursor)||cursor===null||cursor<=0))return NextResponse.json({error:"Curseur invalide"},{status:400});
  const rawLimit=Number(req.nextUrl.searchParams.get("limit")??30);
  if(!Number.isSafeInteger(rawLimit)||rawLimit<1||rawLimit>100)return NextResponse.json({error:"Limite invalide (1–100)"},{status:400});
  const found=await db.purchaseRequest.findUnique({where:{id:requestId},select:{id:true,lines:{select:{id:true}}}});
  if(!found)return NextResponse.json({error:"DA introuvable"},{status:404});
  const lineIds=found.lines.map(l=>String(l.id));
  const events=await db.auditEvent.findMany({where:{
    action:{in:["PURCHASE_REQUEST_DECIDED","PURCHASE_LINE_DECIDED"]},
    OR:[{entity:"PurchaseRequest",entityId:String(requestId)},
      ...(lineIds.length?[{entity:"PurchaseRequestLine",entityId:{in:lineIds}}]:[])],
    ...(cursor===null?{}:{id:{lt:cursor}}),
  },orderBy:{id:"desc"},take:rawLimit+1,
    select:{id:true,actor:true,action:true,entity:true,entityId:true,details:true,createdAt:true}});
  const hasMore=events.length>rawLimit;
  const page=events.slice(0,rawLimit);
  return NextResponse.json({items:page.map(e=>({...e,createdAt:e.createdAt.toISOString()})),
    nextCursor:hasMore?page[page.length-1].id:null,hasMore},
    {headers:{"Cache-Control":"private, no-store"}});
}
