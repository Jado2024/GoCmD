"use client"

import { useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { Check, Copy, Info, Plus, Search, Trash2, UserPlus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { fmtMAD, type ProductDTO } from "@/lib/erp-types"
import { MEASURE_NAMES, measureLabelForGabarit, gabaritByCode, billingIsManual, type GabaritCode } from "@/lib/gabarits"
import { automaticBilledLength, geometryTrapeze, geometryStep, geometryPointes } from "@/lib/geometry-engine"
import { GabaritPicker } from "./gabarit-picker"
import { PointesGeometryPreview } from "./pointes-geometry-preview"
import { isValidPurchaseQuantity } from "@/lib/purchase-quantity"
import { GENERIC_TEMPLATES, type GenericSpec, type GenericTemplate } from "@/lib/generic-templates"
import { api, useClients, useCreateClient, useCreateOrder, useCreateProduct, useProducts, type CommandPartInput, type CreateOrderInput } from "./hooks"

const number = (raw: string): number => Number(raw.replace(",", ".").trim())
const formatMl = (n:number) => n.toLocaleString("fr-FR", {maximumFractionDigits:3})
function previewPointes(p:PartUI) {
  if (p.code !== "41" && p.code !== "51") return null
  try {
    return geometryPointes(p.code,{
      D:number(p.measures.D ?? ""), J:number(p.measures.J ?? ""),
      K:number(p.measures.K ?? ""), L:number(p.measures.L ?? ""),
      H:number(p.measures.H ?? ""),
    })
  } catch { return null }
}
function previewTrapeze(p:PartUI, widthCm:number) {
  if (!["11","12","13","14","21","22","23","24"].includes(p.code)) return null
  try {
    return geometryTrapeze(p.code, {
      D: number(p.measures.D ?? ""), J: number(p.measures.J ?? ""), L: widthCm / 100,
      S: number(p.measures.S ?? ""), T: number(p.measures.T ?? ""),
    })
  } catch { return null }
}
function billFor(p:PartUI, widthCm:number):number {
  if (p.code === "41" || p.code === "51") return previewPointes(p)?.distancePointesM ?? NaN
  if (!billingIsManual(p.code)) {
    try {
      return automaticBilledLength(p.code, {
        D:number(p.measures.D ?? ''),J:number(p.measures.J ?? ''),
        L:widthCm/100,S:number(p.measures.S ?? ''),T:number(p.measures.T ?? ''),
        K:number(p.measures.K ?? ''),H:number(p.measures.H ?? ''),
      }) ?? NaN
    } catch { return NaN }
  }
  return number(p.billing)
}

interface PartUI {
  uid: number
  partRef: string
  code: GabaritCode
  billing: string
  count: string
  measures: Record<string,string>
  note: string
}
interface LineUI {
  uid: number
  product: ProductDTO
  generic?: GenericSpec
  copies: string
  unitPrice: string
  technicalInstructions: string
  lengthCm: string
  widthCm: string
  heightCm: string
  modelRef: string
  configRef: string
  parts: PartUI[]
}
let nextUiId = 1
function newPart(ref = "L01", billing = "2,60"):PartUI {
  return { uid: nextUiId++, partRef: ref, code:"STD", billing, count:"1", measures:{J:billing}, note:"" }
}
function newLine(product:ProductDTO):LineUI {
  return { uid:nextUiId++, product, copies:"1", unitPrice:String(product.unitPrice), technicalInstructions:"",
    lengthCm:String(product.length),widthCm:String(product.width),heightCm:String(product.height), modelRef:"", configRef:"", parts:product.materialId!=null?[]:[newPart("L01", product.unit === "ml" ? "2,60" : "1")] }
}
function lineMeterage(line:LineUI): number {
  const total = line.parts.reduce((sum,p)=>sum+(billFor(p,line.product.width)||0)*(number(p.count)||0),0)
  return total * (line.product.family === "SALON" ? number(line.copies) : 1)
}
function validateLine(line:LineUI):string | null {
  if(line.generic && (line.generic.description.trim().length<5||line.generic.specifications.trim().length<12))
    return "Article hors catalogue : désignation et spécifications techniques requises"
  if(line.generic && number(line.unitPrice)<=0)return "Article hors catalogue : prix positif soumis au directeur obligatoire"
  if(line.technicalInstructions.length>1200)return "Instructions trop longues"
  if(line.product.materialId!=null){
    if(!isValidPurchaseQuantity(number(line.copies),line.product.unit))return "Quantité de négoce incompatible avec l'unité vendue"
    if(!Number.isFinite(number(line.unitPrice))||number(line.unitPrice)<0)return "Prix de vente invalide"
    return null
  }
  const dimensionless=line.generic?.template==="GEN-DIV"&&line.generic.lengthCm===undefined
  if(!dimensionless&&[line.lengthCm,line.widthCm,line.heightCm].some(v=>!Number.isFinite(number(v))||number(v)<=0||number(v)>1500))
    return "Dimensions personnalisées invalides"
  if(line.technicalInstructions.length>1200)return "Instructions trop longues"
  const price = number(line.unitPrice)
  if (!Number.isFinite(price) || price < 0) return "Prix invalide"
  if (["MATELAS","PLAQUE_MOUSSE","OUATE"].includes(line.product.family) && price === 0) return "Renseigner un prix positif dans l’unité de vente"
  if (line.product.family === "SALON" && price === 0) return "Renseigner un prix positif pour le salon en MAD/ml"
  if (line.product.family === "SALON" && line.product.unit !== "ml") return "Référence salon encore à l’unité : installer la base mise à jour"
  if (["BANQUETTE","GAUFRETTE"].includes(line.product.family) && line.product.unit !== "ml") return "Produit linéaire avec une unité incorrecte"
  if (line.product.unit === "kg") {
    if (!Number.isFinite(number(line.copies)) || number(line.copies) <= 0 || number(line.copies) > 10000)
      return "Poids d'ouate invalide (kg)"
    if (line.parts.length !== 1 || line.parts[0].code !== "STD" || number(line.parts[0].count) !== 1)
      return "Ouate : une étiquette de lot par ligne commerciale"
  } else if (!Number.isInteger(number(line.copies)) || number(line.copies) < 1 || number(line.copies) > 50) return "Quantité d'ensembles invalide (1–50)"
  if(dimensionless){
    if(!Number.isInteger(number(line.copies))||number(line.copies)<1||number(line.copies)>50)return "Quantité GEN-DIV invalide (1–50)"
    return null // pièces tracées automatiquement, sans dimensions fictives
  }
  if (!line.parts.length) return "Ajouter au moins une pièce"
  for (const [index,p] of line.parts.entries()) {
    const desc = `Pièce ${index+1}`
    if (!p.partRef.trim()) return `${desc} : repère obligatoire`
    if (!Number.isInteger(number(p.count)) || number(p.count) < 1 || number(p.count) > 50) return `${desc} : nombre de pièces invalide`
    if (line.product.unit === "ml" && (!Number.isFinite(billFor(p,line.product.width)) || billFor(p,line.product.width) <= 0 || billFor(p,line.product.width) > 1000)) return `${desc} : longueur facturable obligatoire`
    const g = gabaritByCode(p.code)
    if (!g) return `${desc} : gabarit inconnu`
    for (const field of g.fields) {
      if (p.code === "06") continue // libre : les cotes utilisées dépendent du plan
      if (!Number.isFinite(number(p.measures[field] ?? "")) || number(p.measures[field] ?? "") <= 0) return `${desc} : saisir ${MEASURE_NAMES[field] ?? field}`
    }
    if (["31","32","33","34"].includes(p.code)) {
      try { const geo=geometryStep(p.code,{D:number(p.measures.D??""),J:number(p.measures.J??""),
        L:line.product.width/100,P:number(p.measures.P??""),S:number(p.measures.S??""),B:number(p.measures.B??"")})
        if (!geo.coherent) return `${desc} : longueur J incohérente avec D et S` }
      catch(e){return `${desc} : ${(e as Error).message}`}
    }
    if (["41","51"].includes(p.code)) {
      try { geometryPointes(p.code as '41'|'51',{
        D:number(p.measures.D??''),J:number(p.measures.J??''),K:number(p.measures.K??''),
        L:number(p.measures.L??''),H:number(p.measures.H??'')}) }
      catch(e) { return `${desc} : ${(e as Error).message}` }
    }
    if (["11","12","13","14","21","22","23","24"].includes(p.code)) {
      try {
        const geo=geometryTrapeze(p.code, {D:number(p.measures.D ?? ""), J:number(p.measures.J ?? ""), L:line.product.width / 100,
          S:number(p.measures.S ?? ""), T:number(p.measures.T ?? "")})
        if (!geo.coherent) return `${desc} : écart géométrique D/J/S/T de ${formatMl(Math.abs(geo.gapD))} m ; vérifier les cotes`
      } catch(e) { return `${desc} : ${(e as Error).message}` }
    }
  }
  return null
}
function ProductLineEditor({line,onChange,onRemove}: {
  line:LineUI; onChange:(next:LineUI)=>void; onRemove:()=>void
}) {
  const [expanded, setExpanded] = useState(true)
  const isMl = line.product.unit === "ml"
  const totalMl = lineMeterage(line)
  const quantity = line.product.materialId!=null ? number(line.copies) : isMl ? Math.round(totalMl*1000)/1000 : number(line.copies)
  const valid = validateLine(line)
  function editPart(uid:number,patch:Partial<PartUI>) {
    onChange({...line,parts:line.parts.map(p=>p.uid===uid?{...p,...patch}:p)})
  }
  return <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <button type="button" className="text-left" onClick={()=>setExpanded(!expanded)} aria-expanded={expanded}>
        <p className="text-sm font-semibold text-slate-800">{line.product.name}</p>
        {line.product.status==="pending_validation" && <span className="mt-1 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Produit spécial · validation requise</span>}
        {line.generic && <span className="mt-1 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">{line.generic.template} · Hors catalogue · visa directeur par ligne</span>}
        <p className="text-xs text-slate-500">{line.generic?"Référence article non attribuée":line.product.sku} · {line.product.materialId!=null ? "Négoce — article prélevé dans le stock" : line.generic?.template==="GEN-DIV"&&line.generic.lengthCm===undefined ? "Dimensions non applicables · pièces tracées par commande" : line.product.unit === "kg" ? "Lot vendu au poids (kg)" : `${line.product.length} × ${line.product.width} × ${line.product.height} cm · ${line.parts.reduce((s,p)=>s+(number(p.count)||0),0)} pièce(s)`}</p>
      </button>
      <div className="flex items-center gap-2">
        <span className="rounded bg-emerald-50 px-2 py-1 text-sm font-semibold text-emerald-800">{`${formatMl(quantity)} ${line.product.unit}`} · {fmtMAD(quantity * (number(line.unitPrice)||0))}</span>
        <Button size="sm" variant="outline" onClick={()=>setExpanded(!expanded)}>{expanded?"Réduire":"Détailler"}</Button>
        <Button size="sm" variant="ghost" onClick={onRemove} aria-label="Retirer le produit"><Trash2 className="size-4 text-rose-600"/></Button>
      </div>
    </div>
    {expanded && <div className="mt-3 space-y-4 border-t pt-3">
      {line.generic && <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3">
        <p className="text-xs font-semibold text-amber-950">Configuration unique à cette commande — aucune référence catalogue permanente</p>
        <Label>Désignation contractuelle *</Label>
        <Input maxLength={200} value={line.generic.description} onChange={e=>onChange({...line,product:{...line.product,name:e.target.value},generic:{...line.generic!,description:e.target.value}})}/>
        <Label>Spécifications / finition / composition *</Label>
        <Textarea maxLength={2000} value={line.generic.specifications} onChange={e=>onChange({...line,generic:{...line.generic!,specifications:e.target.value}})}/>
        <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-amber-950">
          <input type="checkbox" checked={line.generic.requiresPreparation} onChange={e=>onChange({...line,generic:{...line.generic!,requiresPreparation:e.target.checked}})} className="size-6 accent-amber-800" />
          Fabrication ou préparation nécessaire après approbation (OF)
        </label>
      </div>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="space-y-1"><Label>Référence modèle</Label><Input value={line.modelRef} onChange={e=>onChange({...line,modelRef:e.target.value})} placeholder="F111XY"/></div>
        <div className="space-y-1"><Label>Référence configuration</Label><Input value={line.configRef} onChange={e=>onChange({...line,configRef:e.target.value})} placeholder="CG"/></div>
        {(line.product.materialId!=null || line.product.family === "SALON" || !isMl) && <div className="space-y-1"><Label>{line.product.materialId!=null ? `Quantité à vendre (${line.product.unit})` : line.product.unit === "kg" ? "Quantité pesée (kg)" : line.product.family === "SALON" ? "Nombre de salons identiques" : "Nombre d’articles identiques"}</Label><Input inputMode="numeric" value={line.copies} onChange={e=>onChange({...line,copies:e.target.value})}/></div>}
        <div className="space-y-1"><Label>Prix unitaire MAD/{line.product.unit}</Label><Input inputMode="decimal" value={line.unitPrice} onChange={e=>onChange({...line,unitPrice:e.target.value})}/></div>
      </div>
      {number(line.unitPrice)!==line.product.unitPrice&&<p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs">Prix différent du catalogue ({fmtMAD(line.product.unitPrice)}) : visa du directeur obligatoire avant confirmation de la commande ou émission du devis.</p>}
      {line.generic?.template==="GEN-DIV"&&line.generic.lengthCm===undefined&&<p className="rounded border bg-slate-50 p-2 text-sm">Dimensions non applicables. Les pièces seront identifiées individuellement après approbation, sans cotes artificielles.</p>}
      {line.product.materialId==null&&!(line.generic?.template==="GEN-DIV"&&line.generic.lengthCm===undefined)&&<div className="space-y-2 rounded border border-slate-200 p-3">
        <p className="text-xs font-semibold">Dimensions et pièces de cette commande (sans modifier le catalogue)</p>
        {["MATELAS","PLAQUE_MOUSSE"].includes(line.product.family)&&<div className="grid grid-cols-3 gap-2">
          <label className="text-xs">Longueur (cm)<Input inputMode="decimal" value={line.lengthCm} onChange={e=>onChange({...line,lengthCm:e.target.value})}/></label>
          <label className="text-xs">Largeur (cm)<Input inputMode="decimal" value={line.widthCm} onChange={e=>onChange({...line,widthCm:e.target.value})}/></label>
          <label className="text-xs">Hauteur (cm)<Input inputMode="decimal" value={line.heightCm} onChange={e=>onChange({...line,heightCm:e.target.value})}/></label>
        </div>}
        <Label>Instructions particulières (tissu, mousse, finition...)</Label>
        <Textarea placeholder="Ex. Tissu gris ; mousse HR35 ; autres caractéristiques du modèle identiques" maxLength={1200} value={line.technicalInstructions} onChange={e=>onChange({...line,technicalInstructions:e.target.value})}/>
        <p className="text-xs text-slate-600">Les différences seront contrôlées techniquement et recopiées dans l'OF.</p>
      </div>}
      {line.product.family === "SALON" && <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">Salon facturé au mètre linéaire : {formatMl(totalMl / Math.max(1,number(line.copies)||1))} ml par salon × {line.copies||"?"} salon(s) = <strong>{Number.isFinite(totalMl)?formatMl(totalMl):"—"} ml au total</strong>. Chaque L01, L02… possède son gabarit et son étiquette. Prix fictif du catalogue en MAD/ml, modifiable avant validation.</div>}
      <div className="space-y-3">
        {line.product.materialId!=null ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">Revente directe depuis les lots disponibles. Pas de pièce/gabarit atelier. Débit du stock uniquement lors de la validation du BL.</p> : line.product.unit === "kg" ? <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">Ouate : {line.copies || "?"} kg. Une étiquette identifie ce lot commercial. La livraison de ce lot s'effectue en totalité ; division en plusieurs lots ou traçabilité de fabrication seront traitées ultérieurement.</p> : line.parts.map((p,i)=>{
          const gab=gabaritByCode(p.code)!
          return <div key={p.uid} className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <strong className="text-sm">Pièce {i+1} · {p.partRef || "Repère à saisir"}</strong>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" onClick={()=>onChange({...line,parts:[...line.parts.slice(0,i+1),{...p,uid:nextUiId++,partRef:`L${String(line.parts.length+1).padStart(2,"0")}`},...line.parts.slice(i+1)]})}><Copy className="mr-1 size-3"/> Dupliquer</Button>
                <Button size="sm" variant="ghost" aria-label={`Retirer pièce ${i+1}`} onClick={()=>onChange({...line,parts:line.parts.filter(q=>q.uid!==p.uid)})}><Trash2 className="size-4 text-rose-600"/></Button>
              </div>
            </div>
            <div className="mb-3 grid gap-2 sm:grid-cols-3">
              <div className="space-y-1"><Label>Repère physique (L01, L02…)</Label><Input value={p.partRef} onChange={e=>editPart(p.uid,{partRef:e.target.value})} maxLength={40}/></div>
              <div className="space-y-1"><Label>Nombre de pièces identiques</Label><Input inputMode="numeric" value={p.count} onChange={e=>editPart(p.uid,{count:e.target.value})}/></div>
              <div className="space-y-1"><Label>Longueur à facturer (ml){isMl?" *":""}</Label><Input inputMode="decimal" readOnly={!billingIsManual(p.code)} className={!billingIsManual(p.code) ? "bg-emerald-50 font-semibold text-emerald-900" : ""} value={!billingIsManual(p.code) ? (Number.isFinite(billFor(p,line.product.width)) && billFor(p,line.product.width)>0 ? formatMl(billFor(p,line.product.width)) : "") : p.billing} onChange={e=>editPart(p.uid,{billing:e.target.value})} placeholder={!billingIsManual(p.code) ? "Calcul après saisie des cotes" : "Ex. 2,60"}/></div>
            </div>
            <p className="mb-2 text-xs font-semibold text-slate-700">Choisissez visuellement le gabarit de cette pièce :</p>
            <GabaritPicker value={p.code} onChange={code=>editPart(p.uid,{code,measures:code==="STD"?{J:p.billing}:
              Object.fromEntries(Object.entries(p.measures).filter(([key])=>(gabaritByCode(code)?.fields as readonly string[]).includes(key))),billing:billingIsManual(code)?p.billing:""})}/>
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
              <strong>{p.code==="06" ? "Gabarit 06 · métrage manuel" : p.code==="STD"?"Banquette droite":`Gabarit ${p.code}`}</strong> — {"hint" in gab ? gab.hint : "Cotes du plan de fabrication"}.
              {p.code==='11' && ' Longueur facturée automatiquement = cote D (dos).'}
              {['21','22'].includes(p.code) && ' Longueur facturée calculée automatiquement : MAX(D,J).'}
              {['23','24'].includes(p.code) && ' Longueur facturée calculée avec J et la projection de l’oblique T ou S.'}
              {['31','32','33','34'].includes(p.code) && ' Longueur facturée calculée automatiquement : J.'}
              {p.code !== 'STD' && billingIsManual(p.code) && ' Le métrage reste manuel tant que la règle de facturation n’est pas validée.'}
            </div>
            {p.code!=="STD" && <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {["11","12","13","14","21","22","23","24"].includes(p.code) && <div className="space-y-1">
                <Label>L · Largeur depuis la fiche article</Label>
                <Input readOnly value={formatMl(line.product.width / 100)} className="bg-slate-100 font-semibold" aria-label="Largeur L automatique en mètres"/>
              </div>}
              {gab.fields.map(field=><div className="space-y-1" key={field}>
                <Label>{measureLabelForGabarit(p.code,field)}{p.code!=="06"?" *":""}</Label>
                <Input inputMode="decimal" placeholder="en mètres" value={p.measures[field]??""} onChange={e=>editPart(p.uid,{measures:{...p.measures,[field]:e.target.value}})}/>
              </div>)}
              {["31","32","33","34"].includes(p.code) && <div className="col-span-full rounded-md bg-slate-100 p-2 text-xs text-slate-700">Largeur L issue du code article : {formatMl(line.product.width / 100)} m. Pour 31/32 : B = position de l’encoche, S = largeur d’encoche, P = profondeur. Pour 33/34 : S = dépassement horizontal, P = hauteur du retrait.</div>}
              {["41","51"].includes(p.code) && <div className="col-span-full rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">Saisir H (hauteur totale) : pour 41, entre J et le sommet supérieur ; pour 51, entre J et D. W sera calculé automatiquement à partir de D/J/K/L/H en supposant une symétrie gauche-droite. Les côtés K/L sont toujours à 45° par rapport à l’horizontale et symétriques. K/L/H/D/J doivent être géométriquement cohérents. Le L du dessin est une oblique, pas la largeur catalogue.</div>}
              {p.code==="06" && <p className="col-span-full text-xs text-slate-500">Pour une forme libre, joignez le plan coté à votre dossier de fabrication ; les cotes D/J sont indicatives.</p>}
              {previewTrapeze(p,line.product.width) && (()=>{
                const geo=previewTrapeze(p,line.product.width)!
                return <div className={`col-span-full rounded-md border p-3 text-xs ${geo.coherent?"border-emerald-200 bg-emerald-50 text-emerald-900":"border-amber-400 bg-amber-50 text-amber-950"}`}>
                  <p className="font-semibold">Contrôle géométrique — gabarit {p.code}</p>
                  <p>Dos D saisi : {formatMl(number(p.measures.D ?? ""))} m · Assise J saisie : {formatMl(number(p.measures.J ?? ""))} m · L catalogue : {formatMl(line.product.width/100)} m</p>
                  {["21","22","23","24"].includes(p.code) && <>
                    <p>Obliques SAISIES : S = {formatMl(geo.slopeLeftM!)} m · T = {formatMl(geo.slopeRightM!)} m</p>
                    <p>Projections horizontales CALCULÉES : sₕ = {formatMl(geo.horizontalLeftM)} m · tₕ = {formatMl(geo.horizontalRightM)} m</p>
                    <p>D théorique (contrôle uniquement) : {formatMl(geo.expectedD!)} m · écart = {formatMl(Math.abs(geo.gapD))} m</p>
                    <p className="font-semibold">{geo.coherent?"✓ Cotes cohérentes avec le modèle théorique":"⚠ Écart de cotes : vérifier le dessin et les dimensions avant fabrication"}</p>
                  </>}
                  {["11","12","13","14"].includes(p.code) && <p>Oblique calculée : {formatMl(geo.slopeLeftM ?? geo.slopeRightM ?? 0)} m</p>}
                  <p>Longueur brute avec chutes (Xmax - Xmin) : <strong>{formatMl(geo.grossLengthM)} m</strong> · surface de chute théorique : {formatMl(geo.wasteAreaM2)} m².</p>
                  <p>Angles des flancs par rapport à l’horizontale : gauche {geo.angleLeftDegrees == null ? "—" : `${formatMl(geo.angleLeftDegrees)}°`} · droite {geo.angleRightDegrees == null ? "—" : `${formatMl(geo.angleRightDegrees)}°`}.</p>
                  <p className="mt-1">{p.code==='11' ? 'Facturation automatique : D.' : ['21','22'].includes(p.code) ? 'Facturation automatique : MAX(D,J).' : ['23','24'].includes(p.code) ? 'Facturation automatique : J + projection de la chute.' : 'La facturation reste manuelle tant que la règle commerciale n’est pas validée.'} Le brut de découpe est une information séparée.</p>
                </div>
              })()}
              {['31','32','33','34'].includes(p.code) && Number.isFinite(billFor(p,line.product.width)) && billFor(p,line.product.width)>0 && <p className="col-span-full rounded-md bg-emerald-50 p-2 text-xs font-semibold text-emerald-900">Règle atelier : facturation automatique = assise J = {formatMl(billFor(p,line.product.width))} ml.</p>}
              {['23','24'].includes(p.code) && Number.isFinite(billFor(p,line.product.width)) && <p className="col-span-full rounded-md bg-emerald-50 p-2 text-xs font-semibold text-emerald-900">Facturation confirmée : {p.code==='23'?'J + projection horizontale T':'J + projection horizontale S'} = {formatMl(billFor(p,line.product.width))} ml.</p>}
              {['41','51'].includes(p.code) && previewPointes(p) && <PointesGeometryPreview
                code={p.code as '41'|'51'}
                geo={previewPointes(p)!}
                D={number(p.measures.D??'')}
                J={number(p.measures.J??'')}
                K={number(p.measures.K??'')}
                L={number(p.measures.L??'')}
                H={number(p.measures.H??'')}
              />}
              {['41','51'].includes(p.code) && !previewPointes(p) && <p className="col-span-full rounded-md bg-slate-100 p-2 text-xs text-slate-700">Renseignez les cotes D/J/K/L/H demandées : le dessin, les angles et W apparaîtront après vérification géométrique.</p>}
            </div>}
            <div className="mt-2"><Label>Instructions atelier (facultatif)</Label><Input maxLength={300} placeholder="Ex. angle gauche, plan client à joindre" value={p.note} onChange={e=>editPart(p.uid,{note:e.target.value})}/></div>
          </div>
        })}
      </div>
      {line.product.materialId==null && line.product.unit !== "kg" && <Button variant="outline" className="gap-1 border-emerald-300 text-emerald-800" onClick={()=>onChange({...line,parts:[...line.parts,newPart(`L${String(line.parts.length+1).padStart(2,"0")}`)]})}><Plus className="size-4"/> Ajouter une banquette / pièce</Button>}
      {valid && <p className="rounded bg-rose-50 p-2 text-xs font-medium text-rose-700">{valid}</p>}
    </div>}
  </section>
}

export function NewOrderDialog({ onClose, presetProduct, launchMode="order" }: { onClose:()=>void; presetProduct?:ProductDTO | null; launchMode?:"order"|"quote" }) {
  const [savingQuote,setSavingQuote] = useState(false)
  const [lines,setLines] = useState<LineUI[]>(()=>presetProduct?[newLine(presetProduct)]:[])
  const [clientId,setClientId] = useState<number|null>(null)
  const [clientQuery,setClientQuery] = useState("")
  const [clientPage,setClientPage] = useState(1)
  // L'identité choisie reste visible même quand la recherche change de page.
  const [selectedClientLabel,setSelectedClientLabel] = useState("")
  const [dueDate,setDueDate] = useState(()=>new Date(Date.now()+14*86400000).toISOString().slice(0,10))
  const [priority,setPriority] = useState<"normale"|"haute">("normale")
  const [note,setNote] = useState("")
  const [customerOrderNo,setCustomerOrderNo] = useState("")
  const [pickerQ,setPickerQ] = useState("")
  const [newProductOpen,setNewProductOpen]=useState(false)
  const [genericOpen,setGenericOpen]=useState(false)
  const [genericTemplate,setGenericTemplate]=useState<GenericTemplate>("GEN-MAT")
  const [genericDescription,setGenericDescription]=useState("")
  const [genericSpecs,setGenericSpecs]=useState("")
  const [genericLength,setGenericLength]=useState("190")
  const [genericWidth,setGenericWidth]=useState("90")
  const [genericHeight,setGenericHeight]=useState("25")
  const [genericPrice,setGenericPrice]=useState("")
  const [genericRequiresPreparation,setGenericRequiresPreparation]=useState(true)
  const [genericHasDimensions,setGenericHasDimensions]=useState(true)
  // D-GEN-01 (option D) : champs taxonomiques exigés par le trigger V16 pour
  // les fiches internes INT-GEN (MATELAS / PLAQUE_MOUSSE).
  const [gCore,setGCore]=useState<"SANS_RESSORTS"|"BONNELL"|"ENSACHES">("SANS_RESSORTS")
  const [gFoam,setGFoam]=useState<"PURE"|"MELANGE"|"AGGLO">("PURE")
  const [gFinish,setGFinish]=useState<"SANS"|"TOPPER"|"ALESE">("SANS")
  const [gNature,setGNature]=useState<"PURE"|"AGGLO">("PURE")
  const [gGrade,setGGrade]=useState("")
  const [gDensity,setGDensity]=useState("")
  const [gPureDensity,setGPureDensity]=useState("")
  const [gAggloDensity,setGAggloDensity]=useState("")
  const [gPureThickness,setGPureThickness]=useState("")
  const [gAggloThickness,setGAggloThickness]=useState("")
  const [npModel,setNpModel]=useState("")
  const [npAbbreviation,setNpAbbreviation]=useState("")
  const [npBrand,setNpBrand]=useState("")
  const [npManufacturer,setNpManufacturer]=useState("")
  const [npDesignation,setNpDesignation]=useState("")
  const [npFamily,setNpFamily]=useState<"BANQUETTE"|"SALON"|"GAUFRETTE"|"MATELAS"|"PLAQUE_MOUSSE"|"OUATE">("BANQUETTE")
  const [npSubCategory,setNpSubCategory]=useState("Droit")
  const [npNearQ,setNpNearQ]=useState("")
  const [npNear,setNpNear]=useState<ProductDTO|null>(null)
  const [npSpecialNotes,setNpSpecialNotes]=useState("")
  const [npLength,setNpLength]=useState("100")
  const [npWidth,setNpWidth]=useState("65")
  const [npHeight,setNpHeight]=useState("25")
  const [npPrice,setNpPrice]=useState("0")
  const [npCore,setNpCore]=useState<"SANS_RESSORTS"|"BONNELL"|"ENSACHES">("SANS_RESSORTS")
  const [npFoam,setNpFoam]=useState<"PURE"|"MELANGE"|"AGGLO">("PURE")
  const [npFinish,setNpFinish]=useState<"SANS"|"TOPPER"|"ALESE">("SANS")
  const [npUpholstery,setNpUpholstery]=useState<"NUE"|"TISSU">("NUE")
  const [npNature,setNpNature]=useState<"PURE"|"AGGLO">("PURE")
  const [npGrade,setNpGrade]=useState("")
  const [npDensity,setNpDensity]=useState("")
  const [npPureDensity,setNpPureDensity]=useState("")
  const [npAggloDensity,setNpAggloDensity]=useState("")
  const [npPureThickness,setNpPureThickness]=useState("")
  const [npAggloThickness,setNpAggloThickness]=useState("")
  const hasFoamOptions=npFamily==="MATELAS"||npFamily==="BANQUETTE"
  const foamLayersReady=npFoam!=="MELANGE" || [npPureDensity,npAggloDensity,npPureThickness,npAggloThickness].every(x=>Number(x)>0&&Number.isFinite(Number(x)))
  const singleDensityReady=!hasFoamOptions || npFoam==="MELANGE" || Number(npDensity)>0
  const plaqueReady=npFamily!=="PLAQUE_MOUSSE" || (npGrade.trim().length>=2 && Number(npDensity)>0)
  // D-GEN-01 : contrôle de complétude taxonomique du gabarit générique courant.
  const gIsMat=genericTemplate==="GEN-MAT", gIsMou=genericTemplate==="GEN-MOU", gIsDiv=genericTemplate==="GEN-DIV"
  const gSingleDensityOk=Number(gDensity)>0&&Number.isFinite(Number(gDensity))
  const gLayersOk=[gPureDensity,gAggloDensity,gPureThickness,gAggloThickness].every(x=>Number(x)>0&&Number.isFinite(Number(x)))
    && Number(gPureThickness)+Number(gAggloThickness)<=number(genericHeight)+0.001
  const gTaxonomyOk=!gIsMat&&!gIsMou ? true
    : gIsMat ? (gFoam==="MELANGE" ? gLayersOk : gSingleDensityOk)
    : (gGrade.trim().length>=2 && gSingleDensityOk)

  const [newClientOpen,setNewClientOpen] = useState(false)
  const [ncName,setNcName] = useState("")
  const [ncCity,setNcCity] = useState("")
  const [ncPhone,setNcPhone] = useState("")
  const nearProducts=useProducts({q:npNearQ,family:npFamily})
  const clients=useClients(clientQuery,clientPage,40), picker=useProducts({q:pickerQ}), createClient=useCreateClient(), createOrder=useCreateOrder(), createProduct=useCreateProduct()
  const effectiveClientId=clientId
  // Une même intention conserve sa clé lors d'un retry réseau ; modifier le
  // formulaire constitue une nouvelle intention, donc génère une autre clé.
  const submittedIntent = useRef<{payload:string;key:string;attempted:boolean}|null>(null)
  const [closeWarning,setCloseWarning]=useState(false)
  const [checkingDuplicates,setCheckingDuplicates]=useState(false)
  const [duplicateNotice,setDuplicateNotice]=useState<null|{
    payload:string; existingReference?:{ref:string}; matches:Array<{id:number;ref:string;status:string;dueDate:string|null}>;token:string|null
  }>(null)
  const [duplicateReason,setDuplicateReason]=useState("")
  const hasUnsavedChanges=Boolean(lines.length || clientId || note.trim() || customerOrderNo.trim() || newProductOpen || genericOpen || newClientOpen)
  function requestClose(){if(hasUnsavedChanges){setCloseWarning(true);return}onClose()}
  const invalid=lines.map(validateLine).find(Boolean)
  // V2 R4 : le devis hors catalogue conserve la configuration par ligne et
  // attend le visa directeur avant émission. Le bouton ne bloque plus GEN-*.
  const canSubmit=lines.length>0 && !invalid && !!effectiveClientId && !!dueDate && !createOrder.isPending && !savingQuote && !checkingDuplicates
  const totals=useMemo(()=>lines.map(l=>{
    const qty=l.product.materialId!=null ? number(l.copies) : l.product.unit==="ml" ? Math.round(lineMeterage(l)*1000)/1000 : number(l.copies)
    return {qty,total:qty*number(l.unitPrice)}
  }),[lines])
  async function submit(asQuote=false){
    if(!canSubmit || effectiveClientId==null)return
    const orderPayload:CreateOrderInput={clientId:effectiveClientId,dueDate:new Date(dueDate).toISOString(),priority,note:note||null,customerOrderNo:customerOrderNo||null,
      lines:lines.map((l,i)=>({productId:l.generic?-(i+1):l.product.id,
        generic:l.generic?(l.generic.template==="GEN-DIV"&&l.generic.lengthCm===undefined
          ? {...l.generic,lengthCm:undefined,widthCm:undefined,heightCm:undefined}
          : {...l.generic,lengthCm:number(l.lengthCm),widthCm:number(l.widthCm),heightCm:number(l.heightCm)}):undefined,
        qty:totals[i].qty,unitPrice:number(l.unitPrice),modelRef:l.modelRef||undefined,configRef:l.configRef||undefined,
        technicalInstructions:l.technicalInstructions.trim()||undefined,
        dimensions:l.product.materialId==null && (number(l.lengthCm)!==l.product.length||number(l.widthCm)!==l.product.width||number(l.heightCm)!==l.product.height)
          ?{lengthCm:number(l.lengthCm),widthCm:number(l.widthCm),heightCm:number(l.heightCm)}:undefined,
        ensembleCount:l.product.family==="SALON"?number(l.copies):undefined,
        parts:l.product.materialId!=null||l.generic?.template==="GEN-DIV"&&l.generic.lengthCm===undefined?undefined:l.parts.map((p):CommandPartInput=>({label:l.product.name,partRef:p.partRef.trim(),count:number(p.count),shape:p.code==="STD"?"rectangle":"gabarit",gabaritCode:p.code,billingMode:billingIsManual(p.code)?"manual":"computed",linearMeters:Number.isFinite(billFor(p,l.product.width)) && billFor(p,l.product.width)>0 ? billFor(p,l.product.width) : undefined,
          lengthCm:number(l.lengthCm),widthCm:number(l.widthCm),heightCm:number(l.heightCm),
          extra:Object.fromEntries(Object.entries(p.measures).filter(([,v])=>v.trim() && Number.isFinite(number(v)) && number(v)>0).map(([key,v])=>[key,number(v)])),note:p.note||undefined}))
      }))}
    if(asQuote){
      setSavingQuote(true)
      try{
        const result=await api<{quote:{ref:string}}>("/api/sales",{method:"POST",body:JSON.stringify({action:"quote",payload:orderPayload})})
        toast.success(`Devis ${result.quote.ref} enregistré. Vous pouvez l’envoyer et enregistrer son acceptation.`)
        onClose()
      }catch(e){toast.error(e instanceof Error?e.message:"Impossible de créer le devis")}
      finally{setSavingQuote(false)}
    }else {
      const serialized=JSON.stringify(orderPayload)
      if (!submittedIntent.current || submittedIntent.current.payload !== serialized)
        submittedIntent.current={payload:serialized,key:crypto.randomUUID(),attempted:false}
      const key=submittedIntent.current.key
      const submitActual=(duplicateReview?:{token:string;reason:string})=>{
        if(submittedIntent.current?.payload===serialized)submittedIntent.current.attempted=true
        createOrder.mutate({...orderPayload,requestKey:key,...(duplicateReview?{duplicateReview}:{})},{
          onSuccess:()=>onClose(),
          onError:(error)=>{
            const problem=(error as Error & {body?:{
              code?:string;existing?:{ref:string};matches?:Array<{id:number;ref:string;status:string;dueDate:string|null}>;token?:string
            }}).body
            if(problem?.code==="DUPLICATE_ORDER_POTENTIAL" || problem?.code==="CUSTOMER_ORDER_NUMBER_EXISTS"){
              setDuplicateNotice({payload:serialized,existingReference:problem.existing,matches:problem.matches??[],token:problem.token??null})
              setDuplicateReason("")
            }
          },
        })
      }
      // La vérification visuelle n'est qu'un pré-contrôle : le serveur refait
      // l'opération dans la transaction avec création de commande et des OF.
      if(duplicateNotice?.payload===serialized){
        if(duplicateNotice.existingReference)return
        if(!duplicateNotice.token||duplicateReason.trim().length<12){toast.error("Justifiez la nouvelle commande (12 caractères minimum)");return}
        submitActual({token:duplicateNotice.token,reason:duplicateReason.trim()})
        return
      }
      // Après un timeout réseau, renvoyer directement la même intention et
      // laisser la clé d'idempotence retrouver l'opération déjà validée.
      if(submittedIntent.current?.payload===serialized&&submittedIntent.current.attempted){
        submitActual();return
      }
      setDuplicateNotice(null)
      setDuplicateReason("")
      // Après un timeout réseau, laisser l'idempotence retrouver la première
      // écriture plutôt que lancer un nouveau contrôle sur la même intention.
      // La même clé est conservée dans submittedIntent jusqu'au succès.
      setCheckingDuplicates(true)
      try {
        const check=await api<{existingReference:{ref:string}|null;matches:Array<{id:number;ref:string;status:string;dueDate:string|null}>;token:string|null}>(
          "/api/orders/duplicate-check",{method:"POST",body:serialized})
        if(check.existingReference || check.matches.length){
          setDuplicateNotice({payload:serialized,existingReference:check.existingReference??undefined,matches:check.matches,token:check.token})
          return
        }
        submitActual()
      }catch(e){toast.error(e instanceof Error?e.message:"Contrôle de doublon indisponible")}
      finally{setCheckingDuplicates(false)}
    }
  }
  return <Dialog open onOpenChange={open=>!open&&requestClose()}>
    <DialogContent className="max-h-[94vh] w-full overflow-y-auto sm:max-w-6xl">
      <DialogHeader><DialogTitle className="flex items-center gap-2"><Plus className="size-5 text-emerald-600"/> {launchMode==="quote"?"Nouveau devis · pièces & gabarits":"Nouvelle commande · pièces & gabarits"}</DialogTitle>
        <DialogDescription>Une commande peut contenir plusieurs produits. Chaque pièce conserve son repère L01, son métrage, son gabarit et sa future étiquette.</DialogDescription></DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {newClientOpen ? <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 sm:col-span-2 lg:col-span-4">
          <strong className="text-sm">Nouveau client</strong>
          <div className="grid gap-2 sm:grid-cols-3"><Input placeholder="Nom du client" value={ncName} onChange={e=>setNcName(e.target.value)}/><Input placeholder="Ville" value={ncCity} onChange={e=>setNcCity(e.target.value)}/><Input placeholder="Téléphone" value={ncPhone} onChange={e=>setNcPhone(e.target.value)}/></div>
          <div className="flex gap-2"><Button disabled={ncName.trim().length<2||ncCity.trim().length<2||createClient.isPending} onClick={()=>createClient.mutate({name:ncName,city:ncCity,phone:ncPhone||null},{onSuccess:r=>{setClientId(r.client.id);setSelectedClientLabel(`${r.client.name} — ${r.client.city}`);setClientQuery("");setClientPage(1);setNewClientOpen(false)}})}><Check className="mr-1 size-4"/> Enregistrer</Button><Button variant="ghost" onClick={()=>setNewClientOpen(false)}><X className="mr-1 size-4"/> Annuler</Button></div>
        </div> : <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="order-client-search">Client</Label>
          <Input id="order-client-search" aria-label="Rechercher un client par nom ou ville" placeholder="Rechercher dans tous les clients…" value={clientQuery} onChange={e=>{setClientQuery(e.target.value);setClientPage(1)}} maxLength={120}/>
          <div className="flex gap-2"><Select value={effectiveClientId?String(effectiveClientId):""} onValueChange={v=>{const item=clients.data?.items.find(c=>c.id===Number(v));setClientId(Number(v));if(item)setSelectedClientLabel(`${item.name} — ${item.city}`)}}><SelectTrigger className="flex-1"><SelectValue placeholder="Choisir un client"/></SelectTrigger><SelectContent>
            {effectiveClientId && !clients.data?.items.some(c=>c.id===effectiveClientId) && <SelectItem value={String(effectiveClientId)}>{selectedClientLabel||`Client #${effectiveClientId}`}</SelectItem>}
            {(clients.data?.items??[]).map(c=><SelectItem key={c.id} value={String(c.id)}>{c.name} — {c.city}</SelectItem>)}
          </SelectContent></Select><Button variant="outline" title="Créer un client" onClick={()=>setNewClientOpen(true)}><UserPlus className="size-4"/></Button></div>
          <div className="flex items-center justify-between gap-2 text-xs text-slate-600" aria-live="polite">
            <span>{clients.isError?"Recherche indisponible":`${clients.data?.pagination.total??0} client(s) · page ${clientPage}/${clients.data?.pagination.pages??1}`}</span>
            <div className="flex gap-1"><Button size="sm" variant="outline" disabled={clientPage<=1} onClick={()=>setClientPage(p=>p-1)}>Précédent</Button><Button size="sm" variant="outline" disabled={clientPage>=(clients.data?.pagination.pages??1)} onClick={()=>setClientPage(p=>p+1)}>Suivant</Button></div>
          </div>
        </div>}
        <div className="space-y-1"><Label>Date souhaitée</Label><Input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}/></div>
        <div className="space-y-1"><Label>Priorité</Label><Select value={priority} onValueChange={v=>setPriority(v as "normale"|"haute")}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="normale">Normale</SelectItem><SelectItem value="haute">Haute</SelectItem></SelectContent></Select></div>
        <div className="space-y-1 sm:col-span-2"><Label>N° de commande client (facultatif)</Label><Input value={customerOrderNo} onChange={e=>setCustomerOrderNo(e.target.value)} placeholder="Ex. 1111 / BC 3656/21" maxLength={80}/></div>
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>Choisir l'article de la commande</Label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={()=>{setGenericOpen(!genericOpen);setNewProductOpen(false)}}><Plus className="mr-1 size-4"/> Hors catalogue · GEN-*</Button>
            <Button size="sm" variant="outline" onClick={()=>{setNewProductOpen(!newProductOpen);setGenericOpen(false)}}><Plus className="mr-1 size-4"/> Créer référence spéciale fixe</Button>
          </div>
        </div>
        {genericOpen && <section className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3" aria-label="Article générique hors catalogue">
          <p className="text-sm font-semibold">Article ponctuel — aucune création de référence permanente</p>
          <p className="text-xs text-amber-900">La description, les dimensions et le tarif sont propres à cette ligne. Le directeur approuve le prix, puis un autre responsable valide la commande. Aucun OF avant cette validation.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label>Modèle générique *</Label><Select value={genericTemplate} onValueChange={v=>{setGenericTemplate(v as GenericTemplate);setGenericHasDimensions(v!=="GEN-DIV")}}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>
              <SelectItem value="GEN-MAT">GEN-MAT · Matelas sur mesure</SelectItem><SelectItem value="GEN-MOU">GEN-MOU · Mousse spéciale</SelectItem><SelectItem value="GEN-SAL">GEN-SAL · Salon / ensemble</SelectItem><SelectItem value="GEN-DIV">GEN-DIV · Divers à l’unité</SelectItem>
            </SelectContent></Select></div>
            <div className="space-y-1"><Label>Prix proposé au directeur (MAD/{GENERIC_TEMPLATES[genericTemplate].unit}) *</Label><Input inputMode="decimal" value={genericPrice} onChange={e=>setGenericPrice(e.target.value)} placeholder="Prix propre à cette ligne"/></div>
            <div className="space-y-1 sm:col-span-2"><Label>Désignation libre *</Label><Input maxLength={200} value={genericDescription} onChange={e=>setGenericDescription(e.target.value)} placeholder="Ex. Matelas sur mesure pour commande client…"/></div>
            <div className="space-y-1 sm:col-span-2"><Label>Composition, qualité, finition et consignes *</Label><Textarea maxLength={2000} rows={3} value={genericSpecs} onChange={e=>setGenericSpecs(e.target.value)} placeholder="Préciser les matériaux, le noyau, la qualité, le revêtement, les particularités de fabrication…"/></div>
          </div>
          <label className="flex min-h-11 items-center gap-2 rounded-md border border-amber-300 bg-white p-2 text-sm text-amber-950">
            <input type="checkbox" className="size-6 accent-amber-800" checked={genericRequiresPreparation} onChange={e=>setGenericRequiresPreparation(e.target.checked)}/>
            Fabrication / préparation nécessaire (création d'un OF seulement après validation de la commande)
          </label>
          {genericTemplate==="GEN-DIV"&&<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={genericHasDimensions} onChange={e=>setGenericHasDimensions(e.target.checked)} className="size-6 shrink-0"/> Dimensions pertinentes pour cet article</label>}
          {(genericTemplate!=="GEN-DIV"||genericHasDimensions)&&<div className="grid grid-cols-3 gap-2">
            <label className="space-y-1 text-xs">Longueur (cm)<Input inputMode="decimal" value={genericLength} onChange={e=>setGenericLength(e.target.value)}/></label>
            <label className="space-y-1 text-xs">Largeur (cm)<Input inputMode="decimal" value={genericWidth} onChange={e=>setGenericWidth(e.target.value)}/></label>
            <label className="space-y-1 text-xs">Hauteur / ép. (cm)<Input inputMode="decimal" value={genericHeight} onChange={e=>setGenericHeight(e.target.value)}/></label>
          </div>}
          {gIsDiv&&<p role="alert" className="rounded border border-rose-300 bg-rose-50 p-2 text-sm text-rose-900">Gabarit suspendu : la famille DIVERS est absente de la taxonomie V16. Un ajout GEN-DIV est refusé jusqu'à la décision métier SODEPI (D-GEN-01/E).</p>}
          {gIsMat&&<div className="space-y-2 rounded-md border border-amber-300 bg-white p-3">
            <p className="text-sm font-semibold">Caractéristiques techniques obligatoires (fiche interne du matelas)</p>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="space-y-1"><Label>Type de noyau *</Label><Select value={gCore} onValueChange={v=>setGCore(v as typeof gCore)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="SANS_RESSORTS">Sans ressorts</SelectItem><SelectItem value="BONNELL">Ressorts Bonnell</SelectItem><SelectItem value="ENSACHES">Ressorts ensachés</SelectItem></SelectContent></Select></div>
              <div className="space-y-1"><Label>Composition mousse *</Label><Select value={gFoam} onValueChange={v=>setGFoam(v as typeof gFoam)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="PURE">100 % mousse pure</SelectItem><SelectItem value="MELANGE">Mélange pure + agglomérée</SelectItem><SelectItem value="AGGLO">100 % mousse agglomérée</SelectItem></SelectContent></Select></div>
              <div className="space-y-1"><Label>Finition *</Label><Select value={gFinish} onValueChange={v=>setGFinish(v as typeof gFinish)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="SANS">Sans</SelectItem><SelectItem value="TOPPER">Avec topper</SelectItem><SelectItem value="ALESE">Avec alèse</SelectItem></SelectContent></Select></div>
            </div>
            {gFoam!=="MELANGE"&&<div className="space-y-1"><Label>Densité de mousse (kg/m³) *</Label><Input inputMode="decimal" value={gDensity} onChange={e=>setGDensity(e.target.value)} placeholder="Saisir la densité réelle"/></div>}
            {gFoam==="MELANGE"&&<div className="grid grid-cols-2 gap-2"><div className="space-y-1"><Label>Densité pure (kg/m³) *</Label><Input inputMode="decimal" value={gPureDensity} onChange={e=>setGPureDensity(e.target.value)}/></div><div className="space-y-1"><Label>Épaisseur pure (cm) *</Label><Input inputMode="decimal" value={gPureThickness} onChange={e=>setGPureThickness(e.target.value)}/></div><div className="space-y-1"><Label>Densité agglo (kg/m³) *</Label><Input inputMode="decimal" value={gAggloDensity} onChange={e=>setGAggloDensity(e.target.value)}/></div><div className="space-y-1"><Label>Épaisseur agglo (cm) *</Label><Input inputMode="decimal" value={gAggloThickness} onChange={e=>setGAggloThickness(e.target.value)}/></div><p className="col-span-2 text-xs text-amber-800">Les proportions et densités ne sont pas présumées. L'épaisseur totale des couches ne doit pas dépasser la hauteur du matelas.</p></div>}
          </div>}
          {gIsMou&&<div className="space-y-2 rounded-md border border-amber-300 bg-white p-3">
            <p className="text-sm font-semibold">Caractéristiques techniques obligatoires (fiche interne de la plaque)</p>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="space-y-1"><Label>Nature *</Label><Select value={gNature} onValueChange={v=>setGNature(v as typeof gNature)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="PURE">Mousse pure</SelectItem><SelectItem value="AGGLO">Mousse agglomérée</SelectItem></SelectContent></Select></div>
              <div className="space-y-1"><Label>Type / qualité *</Label><Input value={gGrade} onChange={e=>setGGrade(e.target.value)} placeholder="Code qualité"/></div>
              <div className="space-y-1"><Label>Densité (kg/m³) *</Label><Input inputMode="decimal" value={gDensity} onChange={e=>setGDensity(e.target.value)} placeholder="Saisir la densité réelle"/></div>
            </div>
          </div>}
          <Button size="sm" disabled={gIsDiv||!gTaxonomyOk||genericDescription.trim().length<5||genericSpecs.trim().length<12||
            ((!gIsDiv||genericHasDimensions)&&[genericLength,genericWidth,genericHeight].some(x=>!Number.isFinite(number(x))||number(x)<=0||number(x)>1500))||
            !Number.isFinite(number(genericPrice))||number(genericPrice)<=0} onClick={()=>{
            const g:GenericSpec={template:genericTemplate,description:genericDescription.trim(),specifications:genericSpecs.trim(),
              lengthCm:genericTemplate==="GEN-DIV"&&!genericHasDimensions?undefined:number(genericLength),
              widthCm:genericTemplate==="GEN-DIV"&&!genericHasDimensions?undefined:number(genericWidth),
              heightCm:genericTemplate==="GEN-DIV"&&!genericHasDimensions?undefined:number(genericHeight),requiresPreparation:genericRequiresPreparation,
              // D-GEN-01 : champs taxonomiques réels transmis à la fiche INT-GEN.
              ...(gIsMat?{coreType:gCore,foamComposition:gFoam,mattressFinish:gFinish,
                ...(gFoam==="MELANGE"?{foamLayers:[{nature:"PURE" as const,densityKgM3:Number(gPureDensity),thicknessCm:Number(gPureThickness)},{nature:"AGGLO" as const,densityKgM3:Number(gAggloDensity),thicknessCm:Number(gAggloThickness)}]}:{foamDensity:Number(gDensity)})}:{}),
              ...(gIsMou?{foamNature:gNature,foamDensity:Number(gDensity),foamGrade:gGrade.trim()}:{}),
            }
            const family=GENERIC_TEMPLATES[genericTemplate]
            const virtual={id:-1,sku:"HORS CATALOGUE",name:g.description,model:genericTemplate,family:family.family,
              variant:"STD",length:g.lengthCm??0,width:g.widthCm??0,height:g.heightCm??0,unit:family.unit,unitPrice:number(genericPrice),
              status:"active",materialId:null} as ProductDTO
            setLines(old=>[...old,{...newLine(virtual),generic:g,
              ...(g.lengthCm===undefined?{parts:[],lengthCm:"0",widthCm:"0",heightCm:"0"}:{}),
            }]);setGenericOpen(false)
            setGenericDescription("");setGenericSpecs("");setGenericPrice("")
            setGDensity("");setGGrade("");setGPureDensity("");setGAggloDensity("");setGPureThickness("");setGAggloThickness("")
          }}><Plus className="mr-1 size-4"/> Ajouter cette ligne ponctuelle</Button>
        </section>}
        {newProductOpen && <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50/60 p-3">
          <p className="text-sm font-semibold text-slate-900">Produit absent : fiche provisoire soumise à validation</p>
          <p className="text-xs text-amber-900">Le code sera généré automatiquement. Cette référence et sa commande resteront en attente ; aucune fabrication ni impression d'étiquette avant validation du responsable.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1"><Label>Famille *</Label><Select value={npFamily} onValueChange={v=>{const next=v as typeof npFamily;setNpFamily(next);setNpNear(null);setNpNearQ("");setNpSubCategory(({BANQUETTE:"Banquette",GAUFRETTE:"Gaufrette",SALON:"Ensemble",MATELAS:"Adulte",PLAQUE_MOUSSE:"Plaque",OUATE:"Ouate"} as const)[next])}}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{["BANQUETTE","SALON","GAUFRETTE","MATELAS","PLAQUE_MOUSSE","OUATE"].map(f=><SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1"><Label>Sous-famille *</Label><Input value={npSubCategory} maxLength={80} onChange={e=>setNpSubCategory(e.target.value)} placeholder="Ex. sur mesure, angle, bébé…"/></div>
            <div className="space-y-1"><Label>Nom provisoire du modèle *</Label><Input value={npModel} maxLength={120} onChange={e=>setNpModel(e.target.value)} placeholder="Ex. modèle client spécial"/></div>
            <div className="space-y-1"><Label>Abréviation commerciale (modifiable)</Label><Input value={npAbbreviation} maxLength={24} onChange={e=>setNpAbbreviation(e.target.value)} placeholder={npModel.trim().replace(/[^a-zA-Z0-9]/g,"").slice(0,8).toUpperCase() || "Ex. BTRATH"}/><Button variant="outline" size="sm" onClick={()=>setNpAbbreviation(npModel.trim().replace(/[^a-zA-Z0-9]/g,"").slice(0,8).toUpperCase())}>Proposer une abréviation</Button></div>
            <div className="space-y-1"><Label>Marque vendue</Label><Input value={npBrand} maxLength={120} onChange={e=>setNpBrand(e.target.value)} placeholder="Ex. Simmons"/></div>
            <div className="space-y-1"><Label>Fabricant effectif</Label><Input value={npManufacturer} maxLength={120} onChange={e=>setNpManufacturer(e.target.value)} placeholder="Ex. Richbond"/></div>
            <div className="space-y-1 sm:col-span-2"><Label>Désignation commerciale (proposée, modifiable)</Label><Input value={npDesignation} maxLength={200} onChange={e=>setNpDesignation(e.target.value)} placeholder={`${npFamily} ${npModel || "modèle"} ${npLength}×${npWidth}×${npHeight}`}/></div>
          </div>
          {(hasFoamOptions||npFamily==="PLAQUE_MOUSSE") && <div className="space-y-3 rounded-lg border border-emerald-200 bg-white p-3">
            <p className="text-sm font-semibold">Caractéristiques techniques obligatoires</p>
            {hasFoamOptions && <>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1"><Label>Type de noyau</Label><Select value={npCore} onValueChange={v=>setNpCore(v as typeof npCore)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="SANS_RESSORTS">Sans ressorts</SelectItem><SelectItem value="BONNELL">Ressorts Bonnell</SelectItem><SelectItem value="ENSACHES">Ressorts ensachés</SelectItem></SelectContent></Select></div>
                <div className="space-y-1"><Label>Composition mousse</Label><Select value={npFoam} onValueChange={v=>setNpFoam(v as typeof npFoam)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="PURE">100 % mousse pure</SelectItem><SelectItem value="MELANGE">Mélange pure + agglomérée</SelectItem><SelectItem value="AGGLO">100 % mousse agglomérée</SelectItem></SelectContent></Select></div>
                {npFamily==="MATELAS"?<div className="space-y-1"><Label>Configuration exclusive</Label><Select value={npFinish} onValueChange={v=>setNpFinish(v as typeof npFinish)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="SANS">Sans</SelectItem><SelectItem value="TOPPER">Avec topper</SelectItem><SelectItem value="ALESE">Avec alèse</SelectItem></SelectContent></Select></div>:<div className="space-y-1"><Label>Habillage</Label><Select value={npUpholstery} onValueChange={v=>setNpUpholstery(v as typeof npUpholstery)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="NUE">Nue</SelectItem><SelectItem value="TISSU">Avec tissu</SelectItem></SelectContent></Select></div>}
              </div>
            </>}
            {npFamily==="PLAQUE_MOUSSE" && <div className="grid gap-2 sm:grid-cols-2"><div className="space-y-1"><Label>Nature</Label><Select value={npNature} onValueChange={v=>setNpNature(v as typeof npNature)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="PURE">Mousse pure</SelectItem><SelectItem value="AGGLO">Mousse agglomérée</SelectItem></SelectContent></Select></div><div className="space-y-1"><Label>Type / qualité</Label><Input value={npGrade} onChange={e=>setNpGrade(e.target.value)} placeholder="Code qualité" /></div></div>}
            {(npFamily==="PLAQUE_MOUSSE" || (hasFoamOptions&&npFoam!=="MELANGE")) && <div className="space-y-1"><Label>Densité de mousse (kg/m³)</Label><Input inputMode="decimal" value={npDensity} onChange={e=>setNpDensity(e.target.value)} placeholder="Saisir la densité réelle" /></div>}
            {hasFoamOptions&&npFoam==="MELANGE" && <div className="grid grid-cols-2 gap-2"><div className="space-y-1"><Label>Densité pure (kg/m³)</Label><Input value={npPureDensity} onChange={e=>setNpPureDensity(e.target.value)}/></div><div className="space-y-1"><Label>Épaisseur pure (cm)</Label><Input value={npPureThickness} onChange={e=>setNpPureThickness(e.target.value)}/></div><div className="space-y-1"><Label>Densité agglo (kg/m³)</Label><Input value={npAggloDensity} onChange={e=>setNpAggloDensity(e.target.value)}/></div><div className="space-y-1"><Label>Épaisseur agglo (cm)</Label><Input value={npAggloThickness} onChange={e=>setNpAggloThickness(e.target.value)}/></div><p className="col-span-2 text-xs text-amber-800">Les proportions et densités ne sont pas présumées. Saisir les couches prévues pour cette référence.</p></div>}
          </div>}
          <div className="space-y-2 rounded-lg border bg-white p-3">
            <Label>Connaissez-vous un produit proche ? (facultatif)</Label>
            <Input value={npNearQ} onChange={e=>setNpNearQ(e.target.value)} placeholder="Chercher le nom ou le code d'un modèle comparable"/>
            {npNear && <div className="flex items-center justify-between gap-2 rounded bg-emerald-50 p-2 text-xs"><span>Référence proche : <strong>{npNear.name}</strong> · {npNear.sku}</span><Button size="sm" variant="outline" onClick={()=>setNpNear(null)}>Retirer</Button></div>}
            {npNearQ.trim().length>=2 && <div className="max-h-36 overflow-y-auto rounded border">{(nearProducts.data?.items??[]).slice(0,8).map(x=><button type="button" key={x.id} onClick={()=>{setNpNear(x);setNpNearQ("");setNpLength(String(x.length));setNpWidth(String(x.width));setNpHeight(String(x.height));setNpPrice(String(x.unitPrice))}} className="block w-full border-b px-2 py-1.5 text-left text-xs hover:bg-emerald-50">{x.name} · {x.sku} ({x.length}×{x.width}×{x.height} cm)</button>)}{!nearProducts.isPending&&!nearProducts.data?.items?.length&&<p className="p-2 text-xs text-slate-500">Aucun modèle proche trouvé. Vous pouvez continuer sans référence.</p>}</div>}
            <p className="text-xs text-slate-500">Le choix d'un produit proche préremplit dimensions et tarif ; vérifiez les valeurs avant de continuer.</p>
          </div>
          {npFamily === "OUATE" && <p className="text-xs text-indigo-800">Ouate : prix par kilogramme, une étiquette par lot vendu. Les dimensions ci-dessous décrivent uniquement le conditionnement éventuel ; aucune consommation matière ni OF automatique.</p>}
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <div className="space-y-1"><Label>{npFamily === "OUATE" ? "Longueur du conditionnement (cm)" : "Longueur profil (cm)"}</Label><Input inputMode="numeric" value={npLength} onChange={e=>setNpLength(e.target.value)}/></div>
            <div className="space-y-1"><Label>Largeur profil (cm)</Label><Input inputMode="numeric" value={npWidth} onChange={e=>setNpWidth(e.target.value)}/></div>
            <div className="space-y-1"><Label>Épaisseur (cm)</Label><Input inputMode="numeric" value={npHeight} onChange={e=>setNpHeight(e.target.value)}/></div>
            <div className="space-y-1"><Label>Prix proposé au directeur (MAD/{npFamily==="OUATE"?"kg":["MATELAS","PLAQUE_MOUSSE"].includes(npFamily)?"pièce":"ml"})</Label><Input inputMode="decimal" value={npPrice} onChange={e=>setNpPrice(e.target.value)}/></div>
          </div>
          <div className="space-y-1"><Label>Description libre / spécifications client *</Label><textarea className="min-h-24 w-full rounded-md border border-slate-300 bg-white p-2 text-sm" maxLength={2000} value={npSpecialNotes} onChange={e=>setNpSpecialNotes(e.target.value)} placeholder="Indiquer le produit demandé, les différences avec le modèle proche, la composition souhaitée, les contraintes de fabrication, les détails à confirmer…"/><p className="text-xs text-slate-500">15 caractères minimum. Ce texte accompagne la demande de validation.</p></div>
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-600">Code automatique · unité : {npFamily==="OUATE"?"kg":["MATELAS","PLAQUE_MOUSSE"].includes(npFamily)?"pièce":"ml"}</p><Button size="sm" disabled={createProduct.isPending||npModel.trim().length<2||npSubCategory.trim().length<2||npSpecialNotes.trim().length<15||[npLength,npWidth,npHeight].some(v=>!Number.isInteger(number(v))||number(v)<=0)||!Number.isFinite(number(npPrice))||number(npPrice)<0||!singleDensityReady||!foamLayersReady||!plaqueReady} onClick={()=>createProduct.mutate({
            ...(hasFoamOptions?{coreType:npCore,foamComposition:npFoam,...(npFamily==="MATELAS"?{mattressFinish:npFinish}:{upholstery:npUpholstery}),
              ...(npFoam==="MELANGE"?{foamLayers:JSON.stringify([{nature:"PURE",densityKgM3:Number(npPureDensity),thicknessCm:Number(npPureThickness)},{nature:"AGGLO",densityKgM3:Number(npAggloDensity),thicknessCm:Number(npAggloThickness)}])}:{foamDensity:Number(npDensity),foamGrade:npGrade||"Qualité à confirmer"})}:{}),
            ...(npFamily==="PLAQUE_MOUSSE"?{foamNature:npNature,foamDensity:Number(npDensity),foamGrade:npGrade}:{}),
            model:npModel.trim(),family:npFamily,commercialAbbreviation:npAbbreviation.trim()||undefined,commercialBrand:npBrand.trim()||undefined,actualManufacturer:npManufacturer.trim()||undefined,descriptionOverride:npDesignation.trim()||undefined,subCategory:npSubCategory.trim(),similarProductId:npNear?.id,specialNotes:npSpecialNotes.trim(),length:number(npLength),width:number(npWidth),height:number(npHeight),unitPrice:number(npPrice)},{onSuccess:r=>{setLines(ls=>[...ls,newLine(r.product)]);setNewProductOpen(false);setPickerQ("");setNpSpecialNotes("");setNpNear(null)}})}>Ajouter provisoirement à la commande</Button></div>
        </div>}
        <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"/><Input className="pl-9" placeholder="Arvena, Lunoria, dimensions, code article…" value={pickerQ} onChange={e=>setPickerQ(e.target.value)}/></div>
        {pickerQ.trim().length>=2 && <div className="max-h-44 overflow-y-auto rounded-md border">{(picker.data?.items??[]).slice(0,12).map(p=><button key={p.id} type="button" className="flex w-full justify-between gap-2 border-b p-2 text-left text-sm hover:bg-emerald-50" onClick={()=>{setLines(old=>[...old,newLine(p)]);setPickerQ("")}}><span>{p.name}</span><span className="shrink-0 text-xs text-slate-500">{p.sku} <Plus className="inline size-3"/></span></button>)}{!picker.isPending && !picker.data?.items?.length && <p className="p-3 text-sm text-slate-500">Aucune référence trouvée. Ajoutez d'abord ce modèle au catalogue.</p>}</div>}
      </div>
      <div className="space-y-3">{lines.map(l=><ProductLineEditor key={l.uid} line={l} onChange={next=>setLines(ls=>ls.map(x=>x.uid===l.uid?next:x))} onRemove={()=>setLines(ls=>ls.filter(x=>x.uid!==l.uid))}/>)}{!lines.length && <p className="rounded-lg border border-dashed p-5 text-center text-sm text-slate-500">Choisissez un article du catalogue ou créez une ligne hors catalogue GEN-*.</p>}</div>
      <div className="rounded-lg border bg-slate-50 p-3 text-sm">
        <div className="flex justify-between"><strong>{lines.length} ligne(s) produit · {lines.reduce((sum,l)=>sum+l.parts.reduce((s,p)=>s+(number(p.count)||0),0)*(l.product.family==="SALON"||l.product.unit==="u"?(number(l.copies)||0):1),0)} pièce(s)</strong><strong>Total : {fmtMAD(totals.reduce((s,l)=>s+(Number.isFinite(l.total)?l.total:0),0))}</strong></div>
        <div className="mt-2 flex items-start gap-2 text-xs text-slate-600"><Info className="size-4 shrink-0"/><span>Banquettes, gaufrettes et salons sont facturés en ml (somme des pièces, multipliée par le nombre de salons identiques). Les matelas et plaques de mousse sont à l’unité (plaques : hypothèse de simulation à confirmer). Formes Richbond (croquis indicatifs). L est lu depuis la fiche produit. D/J et, pour 21–24, les obliques S/T sont saisis. Pour 21 et 22, facturation = MAX(D,J) ; pour 31 à 34, facturation = J. Pour 41/51, côtés K/L à 45° obligatoires : H est saisie et W calculé automatiquement. Le gabarit 06 conserve le métrage manuel ; le 52 n’appartient plus au catalogue.</span></div>
      </div>
      <div className="space-y-1"><Label>Remarque de commande</Label><Input value={note} maxLength={300} onChange={e=>setNote(e.target.value)}/></div>
      {launchMode==="quote" && lines.some(l=>!!l.generic || (l.product.specialNotes && l.product.specialPriceStatus!=="approved")) && <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">Les articles hors catalogue sont sauvegardés dans le devis avec leur configuration, sans créer de SKU. Un directeur habilité doit autoriser chaque prix spécifique avant l'envoi.</p>}
      {lines.some(l=>l.product.status==="pending_validation") && <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-900">Cette commande sera enregistrée « À valider ». Pour un produit spécial, le directeur doit d’abord approuver le prix, puis le responsable valide la commande. Aucune production ni étiquette avant les deux décisions.</p>}

      {invalid && <p role="alert" className="text-sm font-medium text-rose-700">{invalid}</p>}
      {!effectiveClientId&&<p role="alert" className="text-sm text-amber-800">Sélectionnez explicitement le client avant d’enregistrer.</p>}
      <div className="rounded-md border bg-white p-3 text-sm" aria-label="Récapitulatif avant validation"><strong>À vérifier avant validation</strong> · Client : {selectedClientLabel||clients.data?.items.find(c=>c.id===effectiveClientId)?.name||"Non sélectionné"} · {lines.length} produit(s) · {fmtMAD(totals.reduce((s,l)=>s+(Number.isFinite(l.total)?l.total:0),0))} · livraison souhaitée : {dueDate||"Non définie"}</div>
      {duplicateNotice&&<div role="alert" aria-label="Détection de commande potentiellement en doublon" className="space-y-2 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm">
        <strong className="text-amber-900">Commande existante détectée</strong>
        {duplicateNotice.existingReference ? <p className="text-rose-800">Le numéro de commande client est déjà utilisé par <strong>{duplicateNotice.existingReference.ref}</strong>. La création est bloquée : vérifiez ce document ou changez la référence externe.</p> : <>
          <p>Même client, mêmes références et quantités, même jour de livraison. Vérifiez avant de créer une nouvelle commande :</p>
          <ul className="list-disc pl-5">{duplicateNotice.matches.map(x=><li key={x.id}><strong>{x.ref}</strong> — {x.status} — livraison {x.dueDate?new Date(x.dueDate).toLocaleDateString("fr-FR"):"non renseignée"}</li>)}</ul>
          <Label htmlFor="duplicate-order-reason">Justification de cette nouvelle commande distincte (12 caractères minimum)</Label>
          <Textarea id="duplicate-order-reason" value={duplicateReason} maxLength={300} onChange={e=>setDuplicateReason(e.target.value)} placeholder="Ex. Nouvelle demande expresse du client, après vérification de CMD-…"/>
          <p className="text-xs text-amber-900">La justification et les références comparées seront conservées dans le journal d'audit. Si vous modifiez la commande, la recherche sera relancée.</p>
        </>}
        <Button variant="outline" onClick={()=>{setDuplicateNotice(null);setDuplicateReason("")}}>Revenir à la vérification</Button>
      </div>}
      {closeWarning&&<div role="alertdialog" aria-label="Abandonner les modifications" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm"><p className="font-medium">Abandonner les modifications non enregistrées ?</p><div className="mt-2 flex gap-2"><Button variant="outline" onClick={()=>setCloseWarning(false)}>Continuer la saisie</Button><Button variant="destructive" onClick={onClose}>Abandonner</Button></div></div>}
      <DialogFooter><Button variant="ghost" onClick={requestClose}>Annuler</Button>
        {launchMode==="quote"?<Button variant="primary" disabled={!canSubmit} onClick={()=>void submit(true)}>{savingQuote?"Enregistrement…":"Enregistrer le devis (brouillon)"}</Button>:
        <Button variant="primary" disabled={!canSubmit} onClick={()=>void submit(false)}>{createOrder.isPending?"Enregistrement…":checkingDuplicates?"Vérification des doublons…":duplicateNotice?.token?"Confirmer la nouvelle commande justifiée":"Confirmer / soumettre la commande"}</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
