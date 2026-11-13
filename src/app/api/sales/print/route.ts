import { NextRequest } from "next/server"
import { accessGate, hasRole } from "@/lib/access-gate"
import { db } from "@/lib/db"
export const dynamic="force-dynamic"
// Documents de recette imprimables : les mentions fiscales et l'identité juridique
// doivent être paramétrées et validées avant émission réelle.
const escape=(x:unknown)=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]!)
const mad=(c:number)=>((c||0)/100).toLocaleString("fr-MA",{minimumFractionDigits:2,maximumFractionDigits:2})+" MAD"
const row=(cells:unknown[])=>`<tr>${cells.map(x=>`<td>${escape(x)}</td>`).join("")}</tr>`
const table=(heading:string[],lines:string[])=>`<table><thead><tr>${heading.map(h=>`<th>${escape(h)}</th>`).join("")}</tr></thead><tbody>${lines.join("")}</tbody></table>`
const date=(v:Date)=>new Intl.DateTimeFormat("fr-FR",{dateStyle:"long",timeZone:"Africa/Casablanca"}).format(v)
// Les GEN n'ont aucun catalogue permanent. La désignation et la configuration
// imprimées sont celles acceptées dans la commande, jamais une fiche commune.
function outboundDescription(name:string,orderLine:{kind?:string;technicalSnapshotJson?:string|null}):string {
 if(orderLine.kind!=="GENERIC")return name
 try {
  const data=JSON.parse(orderLine.technicalSnapshotJson??"null") as {description?:string;specifications?:string;dimensions?:{lengthCm?:number;widthCm?:number;heightCm?:number}}
  if(!data)return name
  const dims=data.dimensions?`${data.dimensions.lengthCm} × ${data.dimensions.widthCm} × ${data.dimensions.heightCm} cm`:null
  return [data.description??name,dims,data.specifications].filter(Boolean).join(" — ")
 }catch{return name}
}

// La démo ne doit pas produire un document présenté comme une facture légale.
// En mode réel, le responsable habilité doit attester la validation comptable
// et fournir l'identité de l'émetteur, sans inventer les identifiants SODEPI.
const issuer={
 name:process.env.GOCMD_ISSUER_LEGAL_NAME?.trim()??"",
 address:process.env.GOCMD_ISSUER_ADDRESS?.trim()??"",
 ice:process.env.GOCMD_ISSUER_ICE?.trim()??"",
 taxId:process.env.GOCMD_ISSUER_IF?.trim()??"",
 tradeRegister:process.env.GOCMD_ISSUER_RC?.trim()??"",
}
const issuerConfigured=Object.values(issuer).every(Boolean)
const realInvoicingEnabled=process.env.GOCMD_REAL_INVOICES==="1"&&
  process.env.GOCMD_INVOICE_COMPLIANCE_APPROVED==="1"&&issuerConfigured
const issuerTitle=()=>escape(issuer.name||"GoCmd · Gestion commerciale — DÉMO")
const issuerLegalLines=()=>issuerConfigured
 ? `<small>${escape(issuer.address)} · ICE ${escape(issuer.ice)} · IF ${escape(issuer.taxId)} · RC ${escape(issuer.tradeRegister)}</small>`
 : `<small>Émetteur non paramétré — simulation non valable comme document fiscal</small>`
const page=(title:string,ref:string,client:string,content:string)=>`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(title)} ${escape(ref)}</title><style>body{font:14px Arial,sans-serif;color:#172334;margin:36px auto;max-width:840px;line-height:1.5}header{border-bottom:3px solid #14856d;padding:0 0 15px;display:flex;justify-content:space-between}h1{font-size:22px;margin:0}h2{font-size:16px}table{width:100%;border-collapse:collapse;margin-top:22px}th,td{border-bottom:1px solid #ccc;padding:9px;text-align:left}th{background:#eff9f4}.meta{margin:24px 0}.foot{margin-top:45px;font-size:11px;color:#636c7b}.right{text-align:right}.signature{margin:70px 0 0;display:flex;justify-content:space-between}@media print{body{margin:14mm}button{display:none}} </style></head><body><header><div><strong>${issuerTitle()}</strong><div>${issuerLegalLines()}</div></div><div><h1>${escape(title)}</h1><b>${escape(ref)}</b></div></header><div class="meta"><strong>Client :</strong> ${escape(client)}</div>${content}<div class="foot">${realInvoicingEnabled?"Émetteur configuré. Conserver les validations et justificatifs réglementaires applicables.":"DOCUMENT DE SIMULATION — NON VALABLE COMME FACTURE FISCALE. Numérotation, identité émetteur et client, TVA et mentions obligatoires à faire approuver avant toute émission réelle."}</div></body></html>`
export async function GET(req:NextRequest){
 const denied=accessGate(req);if(denied)return denied
 if(!hasRole(req,"sales")&&!hasRole(req,"finance"))return Response.json({error:"Accès réservé aux ventes et à la finance"},{status:403})
 const type=req.nextUrl.searchParams.get("type"),id=Number(req.nextUrl.searchParams.get("id"))
 if(!Number.isInteger(id)||id<1)return Response.json({error:"Identifiant invalide"},{status:400})
 let html=""
 if(type==="invoice" && process.env.GOCMD_REAL_INVOICES==="1" && !realInvoicingEnabled){
   return Response.json({error:"Facturation réelle bloquée : identité juridique complète et validation comptable obligatoires",code:"INVOICE_ISSUER_NOT_APPROVED"},{status:503})
 }
 if(type==="quote"){
  const q=await db.salesQuote.findUnique({where:{id},include:{client:true}})
  if(!q)return Response.json({error:"Devis introuvable"},{status:404})
  const payload=JSON.parse(q.payload) as {lines:{productId:number,qty:number,unitPrice:number,generic?:{description:string;specifications:string;lengthCm:number;widthCm:number;heightCm:number},parts?:{partRef?:string}[]}[]}
  const products=await db.product.findMany({where:{id:{in:payload.lines.map(l=>l.productId)},isOrderScoped:false},select:{id:true,name:true,unit:true}})
  const byId=new Map(products.map(p=>[p.id,p]))
  const frozen=(() => {try {return JSON.parse(q.productsSnapshotJson??"[]") as {name:string;sku:string;unit:string}[]}catch{return []}})()
  const lines=payload.lines.map((l,i)=>row([l.generic?"HORS CATALOGUE":frozen[i]?.sku??`#${l.productId}`,
    l.generic?`${l.generic.description}${l.generic.lengthCm===undefined?" — dimensions non applicables":` — ${l.generic.lengthCm} × ${l.generic.widthCm} × ${l.generic.heightCm} cm`} — ${l.generic.specifications}`:frozen[i]?.name??byId.get(l.productId)?.name??`Produit #${l.productId}`,
    l.qty,frozen[i]?.unit??byId.get(l.productId)?.unit??"",mad(Math.round(l.unitPrice*100)),mad(Math.round(l.qty*l.unitPrice*100))]))
  html=page("Devis client",q.ref,q.clientNameSnapshot??q.client.name,`${q.status==="draft"?"<p><strong>BROUILLON — NON TRANSMISSIBLE AU CLIENT</strong></p>":""}<p>Créé le ${escape(date(q.createdAt))} · Statut : ${escape(q.status)} · Acceptation : ${escape(q.acceptanceRef||"non enregistrée")}</p>`+table(["Référence","Produit","Qté","Unité","PU","Total"],lines)+`<h2 class="right">Total HT indicatif : ${escape(mad(q.subtotalCents))}</h2><p>Dimensions et gabarits liés au devis et transférés à la commande lors de l'acceptation.</p>`)
 }else if(type==="delivery"){
  const d=await db.salesDelivery.findUnique({where:{id},include:{order:{include:{client:true}},lines:{include:{orderLine:{include:{product:true}},stockAllocations:{include:{stockLot:true}},finishedAllocations:{include:{lot:true}}}}}})
  if(!d)return Response.json({error:"BL introuvable"},{status:404})
  html=page("Bon de livraison",d.ref,d.clientNameSnapshot??d.order.client.name,`<p>Commande ${escape(d.order.ref)} · Livré le ${escape(date(d.deliveredAt))}</p>`+table(["Référence","Produit","Quantité livrée","Unité","Pièces et lots tracés"],d.lines.map(l=>row([l.productSkuSnapshot??l.orderLine.product.sku,outboundDescription(l.productNameSnapshot??l.orderLine.product.name,l.orderLine),l.qty,l.unit,
    [((JSON.parse(l.pieceIds) as number[]).length?`Pièces : ${(JSON.parse(l.pieceIds) as number[]).join(", ")}`:null),
     ...l.stockAllocations.map(a=>`Lot matière : ${a.stockLot.lotCode} (${a.qty} ${a.unit})`),
     ...l.finishedAllocations.map(a=>`Lot produit fini : ${a.lot.lotCode} (${a.qty} u)`)].filter(Boolean).join(" ; ")||"Aucun lot associé"])))+`<div class="signature"><span>Livré par : ________________</span><span>Reçu par : ________________</span></div>`)
 }else if(type==="invoice"){
  const i=await db.salesInvoice.findUnique({where:{id},include:{client:true,order:true,lines:{include:{deliveryLine:{include:{orderLine:{include:{product:true}}}}}},payments:true,credits:true}})
  if(!i)return Response.json({error:"Facture introuvable"},{status:404})
  // Une FACTURE émise est un document figé. Paiements, avoirs et statut actuel
  // appartiennent à l'état de compte, et ne doivent pas modifier sa version imprimée.
  html=page("Facture client",i.ref,i.clientNameSnapshot??i.client.name,`<p>Commande ${escape(i.order.ref)} · Émise le ${escape(date(i.issuedAt))}</p>`+table(["Référence","Article","Qté","Unité","PU","Montant"],i.lines.map(l=>row([l.productSkuSnapshot??l.deliveryLine.productSkuSnapshot??l.deliveryLine.orderLine.product.sku,
    outboundDescription(l.productNameSnapshot??l.deliveryLine.productNameSnapshot??l.deliveryLine.orderLine.product.name,l.deliveryLine.orderLine),l.qty,l.unit,mad(l.unitPriceCents),mad(l.amountCents)])))+`<p class="right">Sous-total : ${escape(mad(i.subtotalCents))}<br>Taxe (${escape((i.taxRateBps/100).toFixed(2))} %) : ${escape(mad(i.taxCents))}<br><strong>Total : ${escape(mad(i.totalCents))}</strong></p><p>Pour le solde actuel et les règlements, consulter l'état de compte client.</p>`)
 }else return Response.json({error:"Type inconnu"},{status:400})
 return new Response(html,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"}})
}
