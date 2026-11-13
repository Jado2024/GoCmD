"use client"
import type { OrderDTO, OrderPieceDTO } from "@/lib/erp-types"
import { gabaritByCode } from "@/lib/gabarits"
import { geometryPointes } from "@/lib/geometry-engine"
import { Button } from "@/components/ui/button"
import { Printer } from "lucide-react"

// Code 39 (ASCII 0-9 A-Z - . espace $ / + %) ; autoportant sans librairie externe.
const PATTERNS:Record<string,string>={
  "0":"nnnwwnwnn","1":"wnnwnnnnw","2":"nnwwnnnnw","3":"wnwwnnnnn","4":"nnnwwnnnw","5":"wnnwwnnnn","6":"nnwwwnnnn","7":"nnnwnnwnw","8":"wnnwnnwnn","9":"nnwwnnwnn",
  "A":"wnnnnwnnw","B":"nnwnnwnnw","C":"wnwnnwnnn","D":"nnnnwwnnw","E":"wnnnwwnnn","F":"nnwnwwnnn","G":"nnnnnwwnw","H":"wnnnnwwnn","I":"nnwnnwwnn","J":"nnnnwwwnn",
  "K":"wnnnnnnww","L":"nnwnnnnww","M":"wnwnnnnwn","N":"nnnnwnnww","O":"wnnnwnnwn","P":"nnwnwnnwn","Q":"nnnnnnwww","R":"wnnnnnwwn","S":"nnwnnnwwn","T":"nnnnwnwwn",
  "U":"wwnnnnnnw","V":"nwwnnnnnw","W":"wwwnnnnnn","X":"nwnnwnnnw","Y":"wwnnwnnnn","Z":"nwwnwnnnn","-":"nwnnnnwnw",".":"wwnnnnwnn"," ":"nwwnnnwnn","$":"nwnwnwnnn","/":"nwnwnnnwn","+":"nwnnnwnwn","%":"nnnwnwnwn","*":"nwnnwnwnn"
}
function Barcode({value}:{value:string}){
  const chars=`*${value.toUpperCase().replace(/[^A-Z0-9. $/+%\-]/g,"")}*`
  let x=0;const bars:{x:number,w:number}[]=[]
  for(const char of chars){ const pattern=PATTERNS[char]??PATTERNS["-"];for(let i=0;i<pattern.length;i++){const w=pattern[i]==="w"?3:1;if(i%2===0)bars.push({x,w});x+=w}x+=1 }
  return <svg viewBox={`0 0 ${x} 47`} preserveAspectRatio="none" className="h-12 w-full" role="img" aria-label={`Code-barres ${value}`}>
    <rect x="0" y="0" width={x} height="47" fill="white"/>
    {bars.map((b,i)=><rect key={i} x={b.x} y="0" width={b.w} height="37" fill="#111"/>)}
  </svg>
}
function PieceLabel({o,p,productName,family,technicalDetails}:{o:OrderDTO;p:OrderPieceDTO;productName:string;family:string;technicalDetails?:string}){
  const extra=(()=>{try{return JSON.parse(p.dimensionsExtra||"{}") as Record<string,number>}catch{return {}}})()
  const gab=gabaritByCode(p.gabaritCode??"")
  const pointes=(()=>{
    if (p.gabaritCode!=='41'&&p.gabaritCode!=='51') return null
    try {return geometryPointes(p.gabaritCode,{J:extra.J,D:extra.D,K:extra.K,L:extra.L,H:extra.H})}
    catch {return null}
  })()
  const mini=pointes && (()=>{
    const w=pointes.distancePointesM,h=pointes.profondeurBruteM
    const scale=Math.min(104/w,62/h)
    const x=(v:number)=>8+(104-w*scale)/2+v*scale
    const y=(v:number)=>5+pointes.hauteurHautM*scale-v*scale
    return pointes.verticesM.map(v=>`${x(v.x)},${y(v.y)}`).join(' ')
  })()
  return <article className="label-card break-inside-avoid rounded border-2 border-slate-700 bg-white p-3 text-black">
    <div className="flex justify-between border-b border-slate-400 pb-1 text-[10px]"><span>ORDRE DE FABRICATION · {o.ref}</span><span>{new Date(o.createdAt).toLocaleDateString("fr-FR")}</span></div>
    <p className="mt-2 text-center text-base font-black uppercase">{productName}</p>
    <p className="text-center text-xs font-semibold">{p.lengthCm} × {p.widthCm} × {p.heightCm} cm</p>
    {technicalDetails&&<p className="mt-1 max-h-12 overflow-hidden text-[10px] font-semibold">HORS CATALOGUE : {technicalDetails.slice(0,150)}{technicalDetails.length>150?"… Voir OF":""}</p>}
    <div className="mt-2 flex items-center justify-between gap-2 border-y border-slate-400 py-1">
      <div><p className="text-xs">{o.client.name}</p><p className="text-lg font-bold">{o.client.city}</p></div>
      <div className="text-right"><p className="text-base font-bold">{p.partRef ?? `L${p.elementNo}`}{family === "SALON" ? ` · Salon ${p.salonNo}` : ""}</p><p className="text-xs">{p.linearMeters!=null?`${p.linearMeters.toLocaleString("fr-FR")} ml`:"À l'unité"}</p><p className="text-xs">{gab?`Gabarit ${gab.code}`:"Droit"}</p></div>
    </div>
    {gab && gab.code !== "STD" && <div className="my-1 flex items-center gap-3">
      <svg viewBox="0 0 122 80" className="h-14 w-28 shrink-0" aria-label={`Schéma indicatif du gabarit ${gab.code}`}>
        {mini ? <polygon points={mini} fill="#fef08a" stroke="#334155" strokeWidth="2" strokeLinejoin="round"/> : <path d={gab.path} fill="#fef08a" stroke="#334155" strokeWidth="2" strokeLinejoin="round"/>}
      </svg>
      <span className="text-[10px]">Gabarit {gab.code}<span className="block">{pointes ? "Contour reconstruit à partir de H et des côtés ; valeurs ci-dessous." : "Croquis indicatif : se référer aux cotes de la fiche."}</span></span>
    </div>}
    {Object.keys(extra).length>0 && <p className="my-1 text-xs">Cotes de fabrication : {Object.entries(extra).filter(([k])=>["D","J","L","S","T","B","P","K","H","W"].includes(k)).map(([k,v])=>`${k}=${v} m`).join(" · ")}</p>}
    {/* V18.9.10 (UX-022) : consignes de sécurité portées à 12 px — les valeurs
        (angles, cotes, W) sont inchangées, seule la lisibilité est corrigée. */}
    {['41','51'].includes(p.gabaritCode??'') && <p className="my-1 text-xs">Angles obligatoires à 45° : K={Number(extra.angleHautKDegres).toLocaleString('fr-FR',{maximumFractionDigits:1})}° · L={Number(extra.angleBasLDegres).toLocaleString('fr-FR',{maximumFractionDigits:1})}° · W={Number(extra.W).toLocaleString('fr-FR',{maximumFractionDigits:3})} m. Vérifier la fiche avant découpe.</p>}
    {extra.cotesCoherentes===0 && <p className="my-1 rounded border-2 border-rose-700 bg-white px-2 py-1 text-xs font-bold text-rose-900" role="alert">ATTENTION : écart géométrique D/J — contrôle atelier obligatoire avant découpe.</p>}
    <div className="mt-1"><Barcode value={p.code}/><p className="text-center font-mono text-[9px]">{p.code}</p></div>
    <p className="mt-1 text-right text-sm font-black">{p.sequence}/{o.lines.reduce((n,l)=>n+(l.pieces?.length??0),0)}</p>
  </article>
}
export function LabelSheet({order}:{order:OrderDTO}){
  const pieces=order.lines.flatMap(l=>(l.pieces??[]).map(p=>{
    let technicalDetails:string|undefined
    if(l.kind==="GENERIC")try{technicalDetails=(JSON.parse(l.technicalSnapshotJson??"null") as {specifications?:string})?.specifications}catch{technicalDetails="Spécifications à vérifier sur l'OF"}
    return {p,productName:l.productNameSnapshot??l.product.name,family:l.product.family,technicalDetails}
  }))
  if(order.status==="pending_validation"||order.status==="rejected"||order.lines.some(l=>l.priceApprovalStatus==="pending" || (l.product.status&&l.product.status!=="active")))
    return <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Étiquettes bloquées : la commande spéciale doit être validée avant toute fabrication ou impression.</p>
  return <div className="space-y-3">
    <div className="flex items-center justify-between print:hidden"><p className="text-xs text-slate-500">{pieces.length} étiquette(s) individuelles — format A4, avec code-barres Code 39.</p><Button disabled={!pieces.length} onClick={()=>window.print()}><Printer className="mr-2 size-4"/> Imprimer</Button></div>
    {pieces.length ? <div className="label-print-area grid grid-cols-1 gap-3 sm:grid-cols-2">{pieces.map(({p,productName,family,technicalDetails})=><PieceLabel key={p.code} o={order} p={p} productName={productName} family={family} technicalDetails={technicalDetails}/>)}</div> : <p className="rounded-lg border border-dashed p-4 text-sm text-slate-500">Cette commande historique ne possède pas encore de pièces individualisées. Ses étiquettes ne peuvent pas être générées automatiquement.</p>}
  </div>
}

// OF 2026 : planches 2 colonnes × 4 rangées, 8 pièces physiques par page.
// Ne pas réutiliser les métrages commerciaux comme décompte des étiquettes.
import { hasTechnicalDrawing, paginateWorkOrderPieces } from "@/lib/work-order-labels"

export interface WorkOrderPrintSnapshot {
  orderRef:string
  orderDate:string
  client:{name:string;city:string}
  product:{name:string;family:string;modelRef:string|null;configRef:string|null;
    coreType?:string|null;foamComposition?:string|null;mattressFinish?:string|null;
    specialNotes?:string|null;technicalInstructions?:string|null;
    dimensions?:{lengthCm:number;widthCm:number;heightCm:number}|null}
  pieces:OrderPieceDTO[]
  quantity?:number // quantité vendue ; étiquette de préparation pour les articles sans pièces
  unit?:string
  stockTrade?:boolean
}
export interface WorkOrderPrintDTO {
  id:number;ref:string;orderId:number;orderLineId:number;productId?:number;remainingToReceive?:number
  totalPieces:number;status:"draft"|"approved"|"in_progress"|"completed"|"cancelled"
  createdBy:string;approvedBy:string|null;createdAt:string
  snapshot:WorkOrderPrintSnapshot
}

function WorkOrderPieceLabel({of,p,index}:{of:WorkOrderPrintDTO;p:OrderPieceDTO;index:number}){
  const s=of.snapshot
  const g=hasTechnicalDrawing(s.product.family,p.gabaritCode)?gabaritByCode(p.gabaritCode??""):null
  let measures:Record<string,number>={}
  try {
    const value:unknown=JSON.parse(p.dimensionsExtra??"{}")
    if(value && typeof value==="object" && !Array.isArray(value))measures=value as Record<string,number>
  } catch { /* anciennes cotes invalides : l'atelier conserve la fiche d'origine */ }
  const keys=["D","J","L","S","T","B","P","K","H","W"] as const
  const coords=keys.filter(k=>Number.isFinite(measures[k])).map(k=>`${k}=${measures[k].toLocaleString("fr-FR",{maximumFractionDigits:3})} m`)
  const isMatelas=s.product.family.toUpperCase()==="MATELAS"
  return <article className="of-label border border-black bg-[#fff8b2] p-[2.5mm] text-black" aria-label={`Étiquette ${index+1} sur ${s.pieces.length}`}>
    <header className="flex justify-between gap-1 border-b border-black pb-1 text-[9px] font-bold">
      <span>SODEPI · GoCmd</span><span>{of.ref}</span><span>{index+1}/{s.pieces.length}</span>
    </header>
    <div className="flex justify-between gap-2 pt-1 text-[9px]">
      <span>CMD {s.orderRef}</span><span>Cfg. {s.product.configRef??"—"}</span>
    </div>
    <div className="my-1 border-y border-black py-0.5">
      <p className="of-product-name truncate text-[12px] font-black uppercase">{s.product.name}</p>
      <p className="text-[12px] font-black">{p.lengthCm} × {p.widthCm} × {p.heightCm} cm</p>
    </div>
    <div className="flex items-start justify-between gap-2 text-[10px] leading-snug">
      <div className="min-w-0 flex-1">
        <p className="truncate">Client : <strong>{s.client.name}</strong></p>
        <p className="truncate">Ville : <strong>{s.client.city}</strong></p>
        <p className="font-bold">{p.partRef??`Pièce ${p.elementNo}`} {s.product.family==="SALON"?`· Salon ${p.salonNo}`:""}</p>
      </div>
      <div className="text-right text-[10px] font-bold">{p.linearMeters!=null?`${p.linearMeters.toLocaleString("fr-FR")} ml`:"1 pièce"}</div>
    </div>
    {g ? <div className="mt-1 flex items-center gap-2 border-t border-black pt-1">
      <svg viewBox="0 0 122 80" className="h-[15mm] w-[26mm] shrink-0" role="img" aria-label={`Croquis indicatif gabarit ${g.code}`}>
        <path d={g.path} stroke="#111" strokeWidth="2.3" fill="none" strokeLinejoin="round"/>
      </svg>
      <div className="min-w-0 flex-1 text-[9px] leading-tight">
        <strong>Gabarit {g.code} · {g.name}</strong>
        <p>{coords.length?coords.join(" · "):"Vérifier les cotes atelier"}</p>
        <p className="text-[8px]">Schéma indicatif, cotes contractuelles ci-dessus.</p>
      </div>
    </div> : isMatelas ? <div className="mt-1 border-t border-black pt-1 text-[9px]">
      <strong>MATELAS — sans dessin</strong>
      <p>{[s.product.coreType,s.product.foamComposition,s.product.mattressFinish].filter(Boolean).join(" · ")||"Contrôler dimensions et finition"}</p>
    </div> : <p className="mt-1 border-t border-black pt-1 text-[9px] font-bold">Pièce standard / droite — sans gabarit</p>}
    {(s.product.technicalInstructions||s.product.specialNotes)&&<p className="mt-0.5 max-h-[10mm] overflow-hidden border border-black px-1 text-[9px] font-bold">SPÉCIAL : {(s.product.technicalInstructions||s.product.specialNotes)?.slice(0,130)}{(s.product.technicalInstructions||s.product.specialNotes||"").length>130?"… Voir OF complet":""}</p>}
    <div className="of-barcode mt-auto pt-1"><Barcode value={p.code}/><p className="text-center font-mono text-[8px]">{p.code}</p></div>
  </article>
}

/** Une ligne de négoce n'a PAS de pièce fabriquée en base. Son étiquette
 * identifie l'ordre et sa quantité de préparation, sans simuler de fabrication.
 */
function WorkOrderPreparationLabel({of}:{of:WorkOrderPrintDTO}){
  const s=of.snapshot
  return <article className="of-label border border-black bg-[#fff8b2] p-[2.5mm] text-black" aria-label="Étiquette préparation 1 sur 1">
    <header className="flex justify-between gap-1 border-b border-black pb-1 text-[9px] font-bold">
      <span>SODEPI · GoCmd</span><span>{of.ref}</span><span>1/1</span>
    </header>
    <p className="mt-1 text-[9px] font-bold">CMD {s.orderRef} · Préparation / sortie de stock</p>
    <p className="mt-2 border-y border-black py-2 text-[12px] font-black uppercase">{s.product.name}</p>
    <p className="text-[11px] font-bold">Quantité à préparer : {s.quantity?.toLocaleString("fr-FR")??"—"} {s.unit??""}</p>
    <p className="mt-1 text-[10px]">Client : <strong>{s.client.name}</strong></p>
    <p className="text-[10px]">Ville : <strong>{s.client.city}</strong></p>
    {(s.product.technicalInstructions||s.product.specialNotes)&&<p className="mt-1 text-[9px] font-bold">Consignes : {(s.product.technicalInstructions||s.product.specialNotes)?.slice(0,200)}</p>}
    <p className="mt-1 text-[9px]">Sans fabrication ni dessin de gabarit. Contrôler le lot au prélèvement.</p>
    <div className="of-barcode mt-auto pt-1"><Barcode value={of.ref}/><p className="text-center font-mono text-[8px]">{of.ref}</p></div>
  </article>
}

/** Impression A4 (2 × 4), matelas sans dessin, 1 étiquette de préparation par ligne de négoce. */
export function WorkOrderLabelSheet({of}:{of:WorkOrderPrintDTO}){
  const pages=paginateWorkOrderPieces(of.snapshot.pieces)
  if(of.status==="draft" || of.status==="cancelled")
    return <p className="rounded border border-amber-300 p-3 text-sm text-amber-800">Impression interdite : OF en brouillon ou annulé.</p>
  const isPreparation=of.snapshot.stockTrade===true && of.snapshot.pieces.length===0
  if(!isPreparation && !pages.length)return <p className="text-sm text-rose-700">Aucune pièce à étiqueter : vérifier les données de l'OF.</p>
  return <section className="of-print-stage">
    {(of.snapshot.product.technicalInstructions || of.snapshot.product.specialNotes || of.snapshot.product.dimensions) &&
      <div className="print:hidden mb-2 rounded border border-amber-500 bg-amber-50 p-3 text-sm">
        <strong>Consignes contractuelles pour l'atelier</strong>
        {of.snapshot.product.dimensions&&<p>Dimensions : {of.snapshot.product.dimensions.lengthCm} × {of.snapshot.product.dimensions.widthCm} × {of.snapshot.product.dimensions.heightCm} cm</p>}
        {of.snapshot.product.specialNotes&&<p>Produit spécial : {of.snapshot.product.specialNotes}</p>}
        {of.snapshot.product.technicalInstructions&&<p>Client : {of.snapshot.product.technicalInstructions}</p>}
      </div>}
    <div className="print:hidden mb-2 flex items-center justify-between gap-2">
      <p className="text-xs text-slate-500">{isPreparation?"1 étiquette de préparation":`${of.totalPieces} étiquettes`} · {isPreparation?1:pages.length} page(s) A4 · 8/page · {of.ref}</p>
      <Button type="button" onClick={()=>window.print()}><Printer className="mr-2 size-4"/> Imprimer cet OF</Button>
    </div>
    {isPreparation?<div className="of-print-page grid grid-cols-2 gap-2 border border-dashed border-slate-300 p-2 print:border-0 print:p-0">
      <WorkOrderPreparationLabel of={of}/>
    </div>:pages.map((page,pi)=><div key={pi} className="of-print-page grid grid-cols-2 gap-2 border border-dashed border-slate-300 p-2 print:border-0 print:p-0">
      {page.map((piece,index)=><WorkOrderPieceLabel key={piece.code} of={of} p={piece} index={pi*8+index}/>) }
    </div>)}
  </section>
}
