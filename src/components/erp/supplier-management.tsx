"use client"

import { useEffect, useMemo, useState } from "react"
import { Building2, Plus, Pencil, Search, Package, Star, Ban, CheckCircle2, ArrowRightLeft, X, Phone, Mail, MapPin, ChevronDown } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SearchableCombobox } from "@/components/ui/searchable-combobox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { fmtMAD } from "@/lib/erp-types"
import { ListSearch } from "./list-controls"

export type SupplierMaterialRef = {id:number;ref:string;name:string;unit:string}
export type SupplierOffer = {
 id:number;materialId:number;supplierSku:string|null;unitPrice:number|null;leadTimeDays:number|null;
 preferred:boolean;material:SupplierMaterialRef;purchaseUnit?:string|null;unitsPerPurchase?:number
}
export type SupplierEntry = {
 id:number;code:string;name:string;phone:string|null;email:string|null;address:string|null;active:boolean;
 city?:string|null;country?:string|null;ice?:string|null;taxId?:string|null;
 tradeRegister?:string|null;paymentTerms?:string|null;
 qualificationStatus?:"pending"|"approved"|"expired"|"rejected"|"suspended";
 qualificationExpiresAt?:string|null;materials:SupplierOffer[]
}
export type SupplierAudit={id:number;actor:string;action:string;entityId:string;details:string|null;createdAt:string}
type Submit=(path:string,body:unknown,method?:"POST"|"PATCH")=>Promise<boolean>
type Fields={name:string;phone:string;email:string;address:string;city:string;country:string;ice:string;taxId:string;tradeRegister:string;paymentTerms:string}
const blank:Fields={name:"",phone:"",email:"",address:"",city:"",country:"Maroc",ice:"",taxId:"",tradeRegister:"",paymentTerms:""}
const fromSupplier=(s:SupplierEntry):Fields=>({
 name:s.name,phone:s.phone??"",email:s.email??"",address:s.address??"",city:s.city??"",country:s.country??"",
 ice:s.ice??"",taxId:s.taxId??"",tradeRegister:s.tradeRegister??"",paymentTerms:s.paymentTerms??"",
})
const label="mb-1.5 block text-xs font-semibold text-slate-700"
const clean=(s:string)=>s.trim()

export function SupplierManagement({suppliers,materials,history,busy,loading,canManage,canApprove,canSeePrices,submit}:{
 suppliers:SupplierEntry[];materials:SupplierMaterialRef[];history:SupplierAudit[];busy:boolean;loading:boolean;canManage:boolean;canApprove:boolean;canSeePrices:boolean;submit:Submit
}){
 const [supplierSearch,setSupplierSearch]=useState("")
 const [supplierStatus,setSupplierStatus]=useState("all")
 const [qualification,setQualification]=useState("all")
 const [supplierSort,setSupplierSort]=useState("name")

 const [selectedId,setSelectedId]=useState<number|null>(null)
 const [editing,setEditing]=useState<SupplierEntry|"new"|null>(null)
 const [draft,setDraft]=useState<Fields>(blank)
 const [showAdmin,setShowAdmin]=useState(false)
 const [linkSupplier,setLinkSupplier]=useState("")
 const [linkMaterial,setLinkMaterial]=useState("")
 const [sku,setSku]=useState("")
 const [exceptionReason,setExceptionReason]=useState("")
 const [exceptionDecisionReasons,setExceptionDecisionReasons]=useState<Record<number,string>>({})
 const [price,setPrice]=useState("")
 const [days,setDays]=useState("")
 const [preferred,setPreferred]=useState(false)
 const [purchaseUnit,setPurchaseUnit]=useState("")
 const [factor,setFactor]=useState("1")
 const [moreConversion,setMoreConversion]=useState(false)
 const [compareMaterial,setCompareMaterial]=useState("")
 const [compareOnlyActive,setCompareOnlyActive]=useState(true)
 const selected=suppliers.find(s=>s.id===selectedId)
 const qualificationLabel=(s:SupplierEntry)=>({pending:"À qualifier",approved:"Qualifié",expired:"Qualification expirée",rejected:"Qualification refusée",suspended:"Non habilité"}[s.qualificationStatus??"pending"])
 const qualificationClass=(s:SupplierEntry)=>s.qualificationStatus==="approved"?"bg-emerald-50 text-emerald-800":"bg-amber-50 text-amber-900"
 const chosenMaterial=materials.find(m=>String(m.id)===linkMaterial)
 const chosenSupplier=suppliers.find(s=>String(s.id)===linkSupplier)
 const existingLink=chosenSupplier?.materials.find(l=>String(l.materialId)===linkMaterial)
 const offers=useMemo(()=>suppliers.filter(s=>!compareOnlyActive||s.active).flatMap(s=>s.materials.filter(l=>String(l.materialId)===compareMaterial).map(l=>({supplier:s,link:l}))).sort((a,b)=>{
   const pA=a.link.unitPrice??Number.POSITIVE_INFINITY,pB=b.link.unitPrice??Number.POSITIVE_INFINITY
   return pA-pB||(a.link.leadTimeDays??9999)-(b.link.leadTimeDays??9999)
 }),[suppliers,compareMaterial,compareOnlyActive])
 const filtered=useMemo(()=>{
  const q=supplierSearch.trim().normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
  return suppliers.filter(s=>
    (supplierStatus==="all"||s.active===(supplierStatus==="active"))&&
    (qualification==="all"||(s.qualificationStatus??"pending")===qualification)&&
    (!q||[s.name,s.code,s.city??"",s.country??"",...s.materials.flatMap(l=>[l.material.name,l.material.ref,l.supplierSku??""])].join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().includes(q))
  ).sort((a,b)=>(supplierSort==="code"?a.code.localeCompare(b.code):a.name.localeCompare(b.name,"fr"))||a.id-b.id)
 },[suppliers,supplierSearch,supplierStatus,qualification,supplierSort])
 useEffect(()=>{
  setSku(existingLink?.supplierSku??"")
  setPrice(existingLink?.unitPrice==null?"":String(existingLink.unitPrice))
  setDays(existingLink?.leadTimeDays==null?"":String(existingLink.leadTimeDays))
  setPreferred(existingLink?.preferred??false)
  setPurchaseUnit(existingLink?.purchaseUnit??chosenMaterial?.unit??"")
  setFactor(String(existingLink?.unitsPerPurchase??1))
 },[existingLink,chosenMaterial])
 function openNew(){setDraft(blank);setShowAdmin(false);setEditing("new")}
 function openEdit(s:SupplierEntry){setDraft(fromSupplier(s));setShowAdmin(Boolean(s.ice||s.taxId||s.tradeRegister||s.paymentTerms));setEditing(s)}
 const setField=(key:keyof Fields)=>(value:string)=>setDraft(d=>({...d,[key]:value}))
 async function saveSupplier(){
  if(draft.name.trim().length<2){toast.error("Saisissez une raison sociale valide");return}
  const payload=Object.fromEntries(Object.entries(draft).map(([k,v])=>[k,clean(v)]))
  const ok=editing==="new"?await submit("/api/suppliers",payload):await submit("/api/suppliers",{...payload,supplierId:(editing as SupplierEntry).id},"PATCH")
  if(ok)setEditing(null)
 }
 async function toggleActive(s:SupplierEntry){
  const ok=await submit("/api/suppliers",{supplierId:s.id,active:!s.active},"PATCH")
  if(ok)toast.message(s.active?"Fournisseur suspendu : aucun nouveau BC possible":"Fournisseur réactivé")
 }
 async function saveLink(){
  if(!chosenSupplier||!chosenMaterial){toast.error("Choisissez un fournisseur et une matière");return}
  if(!chosenSupplier.active){toast.error("Réactivez le fournisseur avant d'ajouter une matière");return}
  const p=price.trim()===""?null:Number(price),d=days.trim()===""?null:Number(days),f=Number(factor)
  if(p!==null&&(!Number.isFinite(p)||p<0)){toast.error("Prix indicatif (sans contrat) incorrect");return}
  if(d!==null&&(!Number.isInteger(d)||d<0||d>365)){toast.error("Délai incorrect (0 à 365 jours)");return}
  if(!Number.isFinite(f)||f<=0){toast.error("Conversion d'unité incorrecte");return}
  const ok=await submit("/api/suppliers",{action:"link",supplierId:chosenSupplier.id,materialId:chosenMaterial.id,
   supplierSku:sku.trim(),...(canSeePrices?{unitPrice:p}:{}),leadTimeDays:d,preferred,purchaseUnit:purchaseUnit.trim()||chosenMaterial.unit,unitsPerPurchase:f})
  if(ok){setCompareMaterial(String(chosenMaterial.id));setSelectedId(chosenSupplier.id)}
 }
 const materialOptions=materials.map(m=>({value:String(m.id),label:`${m.ref} — ${m.name} (${m.unit})`}))
 const pendingExceptions=history.filter(h=>h.action==="SUPPLIER_SKU_EXCEPTION_REQUESTED"&&!history.some(decision=>{
   if(decision.action!=="SUPPLIER_SKU_EXCEPTION_APPROVED")return false
   try{return JSON.parse(decision.details||"{}").requestId===h.id}catch{return false}
 }))
 const supplierOptions=suppliers.map(s=>({value:String(s.id),label:`${s.name} · ${s.code}${s.active?"":" · Suspendu"}`}))
 return <div className="space-y-4">
  <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
   <div className="flex flex-wrap items-start justify-between gap-3">
    <div>
     <div className="flex items-center gap-2"><Building2 className="size-5 text-rose-700"/><h2 className="text-lg font-semibold">Fournisseurs</h2></div>
     <p className="mt-1 text-sm text-slate-600">Créez une fiche, puis référencez les matières proposées. Le choix définitif intervient au BC.</p>
    </div>
    {canManage&&<Button type="button" variant="primary" onClick={openNew}><Plus className="size-4"/> Nouveau fournisseur</Button>}
   </div>
   <p className="mt-2 text-xs text-amber-800">Actif = fiche utilisable pour le référencement. La qualification validée par un approbateur est nécessaire pour approuver un BC.</p>
   <div className="mt-4 grid gap-3 sm:grid-cols-3">
    <div className="rounded-lg border bg-slate-50 px-4 py-3"><div className="text-xs text-slate-500">Fournisseurs</div><div className="text-xl font-semibold tabular-nums">{suppliers.length}</div></div>
    <div className="rounded-lg border bg-slate-50 px-4 py-3"><div className="text-xs text-slate-500">Actifs</div><div className="text-xl font-semibold tabular-nums">{suppliers.filter(s=>s.active).length}</div></div>
    <div className="rounded-lg border bg-slate-50 px-4 py-3"><div className="text-xs text-slate-500">Référencements</div><div className="text-xl font-semibold tabular-nums">{suppliers.reduce((n,s)=>n+s.materials.length,0)}</div></div>
   </div>
  </section>

  {canManage&&  <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
   <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
    <h2 className="flex items-center gap-2 font-semibold"><Package className="size-4 text-rose-700"/> Associer une matière</h2>
    <span className="text-xs text-slate-500">Plusieurs fournisseurs possibles par matière</span>
   </div>
   <div className="grid gap-3 md:grid-cols-2">
    <div><label className={label} htmlFor="sc-link-supplier-p510">Fournisseur *</label><SearchableCombobox label="Fournisseur" value={linkSupplier} onChange={setLinkSupplier} options={supplierOptions} placeholder="Rechercher un fournisseur…" /></div>
    <div><label className={label} htmlFor="sc-link-material-p510">Matière *</label><SearchableCombobox label="Matière" value={linkMaterial} onChange={setLinkMaterial} options={materialOptions} placeholder="Référence ou désignation…" /></div>
    <div><label className={label} htmlFor="sc-link-sku-p510">Référence chez le fournisseur</label><Input id="sc-link-sku-p510" value={sku} maxLength={80} placeholder="Référence du catalogue fournisseur" onChange={e=>setSku(e.target.value)}/></div>
    <div className="grid grid-cols-2 gap-3">
     <div><label className={label} htmlFor="sc-link-price-p510">Prix indicatif (sans contrat) {chosenMaterial?`MAD/${chosenMaterial.unit}`:"MAD/unité stock"}</label><Input id="sc-link-price-p510" type="number" min="0" step="any" value={price} onChange={e=>setPrice(e.target.value)} placeholder="Facultatif" disabled={!canSeePrices}/></div>
     <div><label className={label} htmlFor="sc-link-days-p510">Délai (jours)</label><Input id="sc-link-days-p510" type="number" min="0" max="365" step="1" value={days} onChange={e=>setDays(e.target.value)} placeholder="Facultatif"/></div>
    </div>
   </div>
   <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
    <button type="button" aria-expanded={moreConversion} onClick={()=>setMoreConversion(v=>!v)} className="flex min-h-9 items-center gap-2 text-sm text-slate-600 underline-offset-4 hover:underline"><ChevronDown className={`size-4 transition-transform ${moreConversion?"rotate-180":""}`}/> Unité d'achat et conversion (facultatif)</button>
    <label className="flex min-h-9 items-center gap-2 text-sm text-slate-700"><input type="checkbox" className="size-6 shrink-0 accent-rose-700" checked={preferred} onChange={e=>setPreferred(e.target.checked)}/> Fournisseur préféré pour cette matière</label>
   </div>
   {moreConversion&&<div className="mt-3 grid gap-3 rounded-lg border bg-slate-50 p-3 sm:grid-cols-2">
     <div><label className={label} htmlFor="sc-link-purchase-unit-p510">Unité d'achat</label><Input id="sc-link-purchase-unit-p510" maxLength={20} value={purchaseUnit} onChange={e=>setPurchaseUnit(e.target.value)} placeholder="kg, rouleau, carton…"/></div>
     <div><label className={label} htmlFor="sc-link-factor-p510">Quantité en unité de stock par unité achetée</label><Input id="sc-link-factor-p510" type="number" min="0.000001" step="any" value={factor} onChange={e=>setFactor(e.target.value)}/></div>
     <p className="text-xs text-slate-600 sm:col-span-2">Exemple : 1 carton acheté contient 20 pièces en stock → conversion 20. Le prix indicatif ci-dessus reste exprimé dans l'unité de stock affichée.</p>
   </div>}
   <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
    <p className="text-xs text-slate-500">Les prix sont indicatifs : le prix définitif est confirmé au BC.</p>
    <Button type="button" variant="primary" disabled={busy||!linkSupplier||!linkMaterial||!chosenSupplier?.active} onClick={()=>void saveLink()}>{existingLink?"Mettre à jour le référencement":"Associer la matière"}</Button>
   </div>
   {canManage&&<div className="mt-3 space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
      <p className="font-medium">Référence fournisseur identique pour plusieurs matières ?</p>
      <p className="text-xs text-slate-700">Une collision bloque le référencement normal. Une exception exige une demande justifiée, puis l'accord d'un responsable distinct. Les codes d'origine restent visibles et ambigus à la recherche.</p>
      <label className={label} htmlFor="sku-exception-reason">Justification de l'exception (minimum 12 caractères)</label>
      <Input id="sku-exception-reason" maxLength={500} value={exceptionReason} onChange={e=>setExceptionReason(e.target.value)}/>
      <Button type="button" size="sm" variant="outline" disabled={busy||!chosenSupplier||!chosenMaterial||!sku.trim()||exceptionReason.trim().length<12}
        onClick={()=>void submit("/api/suppliers",{action:"request-sku-exception",supplierId:chosenSupplier!.id,materialId:chosenMaterial!.id,supplierSku:sku.trim(),reason:exceptionReason.trim()})}>Soumettre une exception au responsable</Button>
   </div>}
  </section>}

  {(canApprove||canManage)&&pendingExceptions.length>0&&<section className="rounded-xl border border-amber-200 bg-white p-4 shadow-sm sm:p-5">
    <h2 className="font-semibold">Exceptions de références fournisseurs en attente ({pendingExceptions.length})</h2>
    <p className="mt-1 text-xs text-slate-600">Le responsable vérifie les conditionnements et l'ambiguïté, puis statue sans pouvoir autoriser sa propre demande.</p>
    <div className="mt-3 space-y-3">{pendingExceptions.map(h=>{
      let detail:{supplierId?:number;materialId?:number;supplierSku?:string;reason?:string}={}
      try{detail=JSON.parse(h.details??"{}") as typeof detail}catch{}
      return <div key={h.id} className="rounded border bg-slate-50 p-3 text-sm">
        <p className="font-medium">Demande #{h.id} · {suppliers.find(s=>s.id===detail.supplierId)?.name??`Fournisseur #${detail.supplierId}`} · Matière #{detail.materialId}</p>
        <p>Code : <span className="font-mono">{detail.supplierSku}</span> · Initiateur : {h.actor}</p>
        <p className="text-xs">Motif : {detail.reason}</p>
        {canApprove&&<div className="mt-2 flex flex-wrap gap-2"><Input aria-label={`Justification du visa ${h.id}`} className="min-w-56 flex-1" maxLength={500} placeholder="Motif de décision (12 caractères)" value={exceptionDecisionReasons[h.id]??""} onChange={e=>setExceptionDecisionReasons(v=>({...v,[h.id]:e.target.value}))}/>
          <Button size="sm" disabled={busy||(exceptionDecisionReasons[h.id]??"").trim().length<12} onClick={()=>void submit("/api/suppliers",{action:"approve-sku-exception",requestId:h.id,reason:(exceptionDecisionReasons[h.id]??"").trim()})}>Approuver cette exception</Button></div>}
      </div>
    })}</div>
  </section>}
  <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
   <h2 className="mb-1 flex items-center gap-2 font-semibold"><ArrowRightLeft className="size-4 text-rose-700"/> Comparer les fournisseurs — tarifs indicatifs</h2>
   <p className="mb-3 text-sm text-slate-600">Recherche par matière : prix indicatifs et délais. La comparaison n'impose aucun fournisseur.</p>
   <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
    <div><label className={label}>Matière à comparer</label><SearchableCombobox label="Matière à comparer" value={compareMaterial} onChange={setCompareMaterial} options={materialOptions} placeholder="Choisir une matière…"/></div>
    <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" className="size-6 shrink-0 accent-rose-700" checked={compareOnlyActive} onChange={e=>setCompareOnlyActive(e.target.checked)}/> Actifs uniquement</label>
   </div>
   {compareMaterial&&<div className="mt-3 space-y-2" aria-live="polite">
    <p className="text-xs text-slate-500">{offers.length} fournisseur{offers.length>1?"s":""} référencé{offers.length>1?"s":""} pour cette matière.</p>
    {offers.map(({supplier,link})=><div key={link.id} className="grid gap-2 rounded-lg border p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
     <div className="min-w-0"><p className="font-semibold break-words">{supplier.name}{link.preferred&&<Star className="ml-1 inline size-4 fill-amber-400 text-amber-500" aria-label="Préféré"/>}</p><p className="text-xs text-slate-500">{link.supplierSku?`Réf. fournisseur : ${link.supplierSku}`:supplier.code}</p></div>
     <span className="text-xs sm:text-sm">Délai : {link.leadTimeDays==null?"Non renseigné":`${link.leadTimeDays} j`}</span>
     {canSeePrices&&<span className="font-medium tabular-nums">{link.unitPrice==null?"Prix non renseigné":`${fmtMAD(link.unitPrice)} / ${link.material.unit}`}</span>}
    </div>)}
    {!offers.length&&<p className="rounded-lg border border-dashed px-3 py-4 text-sm text-slate-500">Aucun référencement pour cette matière. Ajoutez une association ci-dessus.</p>}
   </div>}
  </section>

  <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
   <h2 className="mb-3 font-semibold">Fournisseurs enregistrés ({suppliers.length})</h2>
   <ListSearch className="mb-3" value={supplierSearch} onChange={setSupplierSearch} placeholder="Nom, code, ville, matière, référence fournisseur…" shown={filtered.length} total={suppliers.length} unit="fournisseurs"/>
   <div className="mb-3 grid gap-2 sm:grid-cols-3">
    <SearchableCombobox label="État du fournisseur" value={supplierStatus} onChange={setSupplierStatus} options={[{value:"all",label:"Tous les états"},{value:"active",label:"Actifs"},{value:"inactive",label:"Suspendus"}]}/>
    <SearchableCombobox label="Qualification fournisseur" value={qualification} onChange={setQualification} options={[{value:"all",label:"Toutes les qualifications"},{value:"approved",label:"Qualifiés"},{value:"pending",label:"À qualifier"},{value:"expired",label:"Expirées"},{value:"rejected",label:"Refusées"},{value:"suspended",label:"Non habilités"}]}/>
    <SearchableCombobox label="Tri des fournisseurs" value={supplierSort} onChange={setSupplierSort} options={[{value:"name",label:"Nom A–Z"},{value:"code",label:"Code A–Z"}]}/>
   </div>
   {loading?<p className="text-sm text-slate-500">Chargement des fournisseurs…</p>:<div className="grid gap-3 lg:grid-cols-2">
    {filtered.map(s=><article key={s.id} className="min-w-0 rounded-lg border border-slate-200 bg-white p-4">
     <div className="flex items-start justify-between gap-2">
      <div className="min-w-0"><h3 className="break-words font-semibold text-slate-900">{s.name}</h3><p className="mt-1 break-all font-mono text-xs text-slate-500">{s.code}</p></div>
      <div className="flex shrink-0 flex-col items-end gap-1">
       <span className={`rounded-full px-2 py-1 text-xs font-medium ${s.active?"bg-emerald-50 text-emerald-800":"bg-amber-50 text-amber-900"}`}>{s.active?"Actif":"Suspendu"}</span>
       <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${qualificationClass(s)}`}>{qualificationLabel(s)}</span>
      </div>
     </div>
     <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      {(s.city||s.country)&&<span className="flex items-center gap-1"><MapPin className="size-3"/>{[s.city,s.country].filter(Boolean).join(", ")}</span>}
      {s.phone&&<span className="flex items-center gap-1"><Phone className="size-3"/>{s.phone}</span>}
      {s.email&&<span className="flex items-center gap-1 break-all"><Mail className="size-3"/>{s.email}</span>}
     </div>
     {s.active&&s.qualificationStatus!=="approved"&&<p className="mt-2 text-xs text-amber-800">Qualification nécessaire avant l'approbation d'un BC. <a href="/?vue=p2p-advanced" className="font-semibold underline">Ouvrir Pilotage achats avancé</a></p>}
     <p className="mt-3 text-xs text-slate-500">{s.materials.length} matière{s.materials.length>1?"s":""} référencée{s.materials.length>1?"s":""}</p>
     <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
      <Button type="button" size="sm" variant="outline" onClick={()=>setSelectedId(s.id)}><Search className="size-4"/> Voir fiche</Button>
      {canManage&&<>      <Button type="button" size="sm" variant="outline" onClick={()=>openEdit(s)}><Pencil className="size-4"/> Modifier</Button>
      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={()=>void toggleActive(s)}>{s.active?<Ban className="size-4"/>:<CheckCircle2 className="size-4"/>}{s.active?"Suspendre":"Réactiver"}</Button></>}
     </div>
    </article>)}
    {!filtered.length&&<p className="py-5 text-sm text-slate-500">Aucun fournisseur ne correspond à la recherche.</p>}
   </div>}
  </section>

  <Dialog open={editing!==null} onOpenChange={open=>{if(!open&&!busy)setEditing(null)}}>
   <DialogContent className="flex h-[min(92dvh,800px)] w-[min(94vw,800px)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-[800px]" showCloseButton={false}>
    <DialogHeader className="shrink-0 border-b px-5 py-4 text-left">
     <div className="flex items-start justify-between gap-3"><div><DialogTitle>{editing==="new"?"Nouveau fournisseur":"Modifier le fournisseur"}</DialogTitle><DialogDescription className="mt-2">Seule la raison sociale est obligatoire. Le code fournisseur est généré et reste stable.</DialogDescription></div>
      <Button type="button" variant="ghost" size="icon" aria-label="Fermer" disabled={busy} onClick={()=>setEditing(null)}><X className="size-4"/></Button></div>
    </DialogHeader>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
     <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2"><label className={label} htmlFor="sc-name-p510">Raison sociale *</label><Input id="sc-name-p510" maxLength={120} value={draft.name} onChange={e=>setField("name")(e.target.value)} placeholder="Nom officiel du fournisseur" required/></div>
      <div><label className={label} htmlFor="sc-phone-p510">Téléphone</label><Input id="sc-phone-p510" maxLength={40} type="tel" value={draft.phone} onChange={e=>setField("phone")(e.target.value)}/></div>
      <div><label className={label} htmlFor="sc-email-p510">Email</label><Input id="sc-email-p510" maxLength={180} type="email" value={draft.email} onChange={e=>setField("email")(e.target.value)} placeholder="contact@exemple.ma"/></div>
      <div className="sm:col-span-2"><label className={label} htmlFor="sc-address-p510">Adresse</label><Input id="sc-address-p510" maxLength={300} value={draft.address} onChange={e=>setField("address")(e.target.value)} placeholder="Rue, zone industrielle…"/></div>
      <div><label className={label} htmlFor="sc-city-p510">Ville</label><Input id="sc-city-p510" maxLength={100} value={draft.city} onChange={e=>setField("city")(e.target.value)}/></div>
      <div><label className={label} htmlFor="sc-country-p510">Pays</label><Input id="sc-country-p510" maxLength={100} value={draft.country} onChange={e=>setField("country")(e.target.value)}/></div>
     </div>
     <div className="rounded-lg border border-slate-200">
      <button type="button" aria-expanded={showAdmin} className="flex min-h-11 w-full items-center justify-between px-3 text-left text-sm font-medium" onClick={()=>setShowAdmin(v=>!v)}>Informations administratives et paiement (facultatives) <ChevronDown className={`size-4 ${showAdmin?"rotate-180":""}`}/></button>
      {showAdmin&&<div className="grid gap-3 border-t p-3 sm:grid-cols-2">
       <div><label className={label} htmlFor="sc-ice-p510">ICE (Maroc)</label><Input id="sc-ice-p510" maxLength={40} value={draft.ice} onChange={e=>setField("ice")(e.target.value)}/></div>
       <div><label className={label} htmlFor="sc-tax-p510">Identifiant fiscal (IF)</label><Input id="sc-tax-p510" maxLength={40} value={draft.taxId} onChange={e=>setField("taxId")(e.target.value)}/></div>
       <div><label className={label} htmlFor="sc-rc-p510">Registre de commerce (RC)</label><Input id="sc-rc-p510" maxLength={80} value={draft.tradeRegister} onChange={e=>setField("tradeRegister")(e.target.value)}/></div>
       <div><label className={label} htmlFor="sc-payment-p510">Conditions de paiement</label><Input id="sc-payment-p510" maxLength={180} value={draft.paymentTerms} onChange={e=>setField("paymentTerms")(e.target.value)} placeholder="Ex. : à 30 jours"/></div>
      </div>}
     </div>
    </div>
    <div className="flex shrink-0 items-center justify-between gap-2 border-t bg-white px-5 py-3">
     <span className="text-xs text-slate-500">* Champ obligatoire</span>
     <div className="flex gap-2"><Button variant="outline" type="button" disabled={busy} onClick={()=>setEditing(null)}>Annuler</Button><Button variant="primary" type="button" disabled={busy||draft.name.trim().length<2} onClick={()=>void saveSupplier()}>{editing==="new"?"Créer le fournisseur":"Enregistrer"}</Button></div>
    </div>
   </DialogContent>
  </Dialog>

  <Dialog open={Boolean(selected)} onOpenChange={open=>{if(!open)setSelectedId(null)}}>
   <DialogContent className="flex h-[min(88dvh,760px)] w-[min(94vw,850px)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-[850px]" showCloseButton={false}>
    <DialogHeader className="shrink-0 border-b px-5 py-4 text-left">
     <div className="flex items-start justify-between gap-3"><div><DialogTitle>{selected?.name??"Fournisseur"}</DialogTitle><DialogDescription className="mt-2">{selected?.code} · {selected?.active?"Actif":"Suspendu"} · {selected?qualificationLabel(selected):""}</DialogDescription></div><Button size="icon" variant="ghost" aria-label="Fermer" onClick={()=>setSelectedId(null)}><X className="size-4"/></Button></div>
    </DialogHeader>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
     {selected&&selected.qualificationStatus!=="approved"&&<p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Ce fournisseur ne peut pas encore servir à l'approbation d'un BC. Un responsable doit qualifier sa fiche dans <a href="/?vue=p2p-advanced" className="font-semibold underline">Pilotage achats avancé</a>.</p>}
     <div className="grid gap-2 text-sm sm:grid-cols-2"><p><span className="text-slate-500">Téléphone :</span> {selected?.phone||"Non renseigné"}</p><p><span className="text-slate-500">Email :</span> {selected?.email||"Non renseigné"}</p><p><span className="text-slate-500">Ville / pays :</span> {[selected?.city,selected?.country].filter(Boolean).join(", ")||"Non renseigné"}</p><p><span className="text-slate-500">Adresse :</span> {selected?.address||"Non renseigné"}</p><p><span className="text-slate-500">ICE :</span> {selected?.ice||"—"}</p><p><span className="text-slate-500">IF / RC :</span> {[selected?.taxId,selected?.tradeRegister].filter(Boolean).join(" / ")||"—"}</p><p className="sm:col-span-2"><span className="text-slate-500">Paiement :</span> {selected?.paymentTerms||"Non renseigné"}</p></div>
     <div className="border-t pt-3"><h3 className="font-semibold">Matières référencées ({selected?.materials.length??0})</h3><div className="mt-3 space-y-2">{selected?.materials.map(l=><div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3 text-sm" key={l.id}>
      <div className="min-w-0 flex-1"><div className="font-medium break-words">{l.material.name}{l.preferred&&<Star className="ml-1 inline size-4 fill-amber-400 text-amber-500"/>}</div><div className="mt-1 break-all font-mono text-xs text-slate-500">{l.material.ref}</div>{l.supplierSku&&<div className="mt-1 text-xs text-slate-600">Réf. fournisseur : {l.supplierSku}</div>}</div>
      <div className="text-right text-xs sm:text-sm"><div>{canSeePrices&&l.unitPrice!=null?`${fmtMAD(l.unitPrice)} / ${l.material.unit}`:"Prix non renseigné"}</div><div className="text-slate-500">Délai : {l.leadTimeDays==null?"—":`${l.leadTimeDays} j`}</div><Button type="button" variant="outline" size="sm" className="mt-2" onClick={()=>{setLinkSupplier(String(selected?.id??""));setLinkMaterial(String(l.materialId));setSelectedId(null)}}>Modifier le tarif</Button></div>
     </div>)}{!selected?.materials.length&&<p className="text-sm text-slate-500">Aucune matière référencée.</p>}</div></div>
     {canSeePrices&&selected&&<div className="border-t pt-3">
      <h3 className="font-semibold">Historique des référencements</h3>
      <p className="mt-1 text-xs text-slate-500">Dernières modifications disponibles dans le journal d'audit (maximum 300 événements récents au total).</p>
      <div className="mt-3 space-y-2">{history.filter(h=>h.entityId.startsWith(`${selected.id}:`)).slice(0,8).map(h=>{
       let info:{materialRef?:string;unitPrice?:number|null;leadTimeDays?:number|null;preferred?:boolean}={}
       try{info=JSON.parse(h.details||"{}")||{}}catch{}
       return <div key={h.id} className="rounded-lg border bg-slate-50 p-3 text-xs">
        <p className="font-medium">{h.action==="SUPPLIER_MATERIAL_LINKED"?"Matière associée":"Référencement modifié"} · {info.materialRef??`Matière #${h.entityId.split(":")[1]}`}</p>
        <p className="mt-1 text-slate-600">{new Date(h.createdAt).toLocaleString("fr-FR")} · {h.actor}</p>
        <p className="mt-1">Prix indicatif (sans contrat) : {info.unitPrice==null?"Non renseigné":fmtMAD(info.unitPrice)} · Délai : {info.leadTimeDays==null?"—":`${info.leadTimeDays} j`}</p>
       </div>
      })}{!history.some(h=>h.entityId.startsWith(`${selected.id}:`))&&<p className="text-sm text-slate-500">Aucun historique de référencement disponible.</p>}</div>
     </div>}
    </div>
    <div className="flex shrink-0 justify-end gap-2 border-t bg-white px-5 py-3"><Button variant="outline" onClick={()=>setSelectedId(null)}>Fermer</Button><Button variant="primary" onClick={()=>{if(selected){openEdit(selected);setSelectedId(null)}}}><Pencil className="size-4"/> Modifier fiche</Button></div>
   </DialogContent>
  </Dialog>
 </div>
}
