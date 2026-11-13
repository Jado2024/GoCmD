import { safeErrorMetadata } from "@/lib/safe-server-error"
import {NextRequest,NextResponse} from "next/server"
import {accessGate,currentActor,hasPermission,hasRole} from "@/lib/access-gate"
import {db} from "@/lib/db"
import {buildClientStatement,type ClientLedgerEvent} from "@/lib/client-statement"
export const dynamic="force-dynamic"
const noStore={"Cache-Control":"private, no-store"}
const isoDate=(s:string|null)=>{
 if(!s||!/^\d{4}-\d{2}-\d{2}$/.test(s))return null
 const d=new Date(s+"T00:00:00Z")
 return Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==s?null:s
}
/** Relevé client : réservé aux finances, jamais aux commerciaux sans droit financier. */
export async function GET(req:NextRequest){
 const denied=accessGate(req,"finance");if(denied)return denied
 const actor=currentActor(req)
 if(actor?.managed&&!hasPermission(req,"sales.payments"))return NextResponse.json({error:"Accès financier interdit"},{status:403,headers:noStore})
 if(!hasRole(req,"finance"))return NextResponse.json({error:"Rôle finance requis"},{status:403,headers:noStore})
 const q=req.nextUrl.searchParams,clientId=Number(q.get("clientId"))
 if(!Number.isSafeInteger(clientId)||clientId<1)return NextResponse.json({error:"clientId requis"},{status:400,headers:noStore})
 const f=q.get("from"),t=q.get("to"),from=isoDate(f),to=isoDate(t)
 if((f&&!from)||(t&&!to)||(from&&to&&from>to))return NextResponse.json({error:"Période invalide (AAAA-MM-JJ)"},{status:400,headers:noStore})
 const page=Math.max(1,Math.min(100000,Math.trunc(Number(q.get("page")||1)||1)))
 const pageSize=Math.max(1,Math.min(100,Math.trunc(Number(q.get("pageSize")||50)||50)))
 try{
  const client=await db.client.findUnique({where:{id:clientId},select:{id:true,name:true}})
  if(!client)return NextResponse.json({error:"Client introuvable"},{status:404,headers:noStore})
  const count=await db.salesInvoice.count({where:{clientId}})
  // Éviter de produire un état partiel présenté à tort comme exhaustif.
  if(count>10000)return NextResponse.json({error:"Volume trop élevé : exporter par une procédure comptable dédiée (aucun solde partiel fourni)"},{status:413,headers:noStore})
  const invoices=await db.salesInvoice.findMany({where:{clientId},select:{
    id:true,ref:true,totalCents:true,issuedAt:true,
    payments:{select:{id:true,ref:true,paidAt:true,amountCents:true}},
    credits:{where:{status:"approved"},select:{id:true,ref:true,decidedAt:true,createdAt:true,amountCents:true}}
  }})
  const events:ClientLedgerEvent[]=invoices.flatMap(inv=>[
    {kind:"invoice" as const,id:inv.id,invoiceId:inv.id,ref:inv.ref,invoiceRef:inv.ref,date:inv.issuedAt.toISOString(),amountCents:inv.totalCents},
    ...inv.payments.map(p=>({kind:"payment" as const,id:p.id,invoiceId:inv.id,ref:p.ref,invoiceRef:inv.ref,date:p.paidAt.toISOString(),amountCents:p.amountCents})),
    ...inv.credits.map(c=>({kind:"credit" as const,id:c.id,invoiceId:inv.id,ref:c.ref,invoiceRef:inv.ref,date:(c.decidedAt??c.createdAt).toISOString(),amountCents:c.amountCents}))
  ])
  const ledger=buildClientStatement(events,from??undefined,to??undefined)
  const total=ledger.rows.length
  return NextResponse.json({client,from,to,openingBalanceCents:ledger.openingBalanceCents,closingBalanceCents:ledger.closingBalanceCents,total,page,pageSize,items:ledger.rows.slice((page-1)*pageSize,page*pageSize)}, {headers:noStore})
 }catch(e){console.error("[client-statement]",safeErrorMetadata(e));return NextResponse.json({error:"État de compte indisponible"},{status:500,headers:noStore})}
}
