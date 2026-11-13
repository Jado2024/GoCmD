"use client"
import {useState} from "react"
import {useQuery,useQueryClient} from "@tanstack/react-query"
import {Button} from "@/components/ui/button"
import {Input} from "@/components/ui/input"
import {Skeleton} from "@/components/ui/skeleton"
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select"
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from "@/components/ui/table"
import {toast} from "sonner"
import {api} from "./hooks"
import {hasRole,type SessionActor} from "@/lib/role-navigation"
import {fmtMAD} from "@/lib/erp-types"
import {LoadError} from "./bits"
import {ListSearch, SortableTh, useListSort} from "./list-controls"

import {DocumentPager} from "./document-pager"
import {useDocumentRegister} from "./use-document-register"

type Lot={id:number;materialId:number;lotCode:string;status:string;qty:number;material:{name:string;unit:string}}
type Receipt={id:number;ref:string;deliveryRef:string;supplierOrder:{supplier:{id:number;name:string};ref:string};lines:{id:number;acceptedQty:number;returnedQty?:number;supplierOrderLineId:number;supplierOrderLine:{unitPrice:number;material:{name:string;unit:string}}}[]}
const LOT_STATUS:Record<string,string>={available:"Disponible",quarantine:"En quarantaine",returned:"Retourné",legacy_unverified:"Historique non confirmé"}
const INVOICE_STATUS:Record<string,string>={blocked:"Bloquée",matched:"Rapprochée",approved:"Approuvée",paid:"Payée",draft:"Brouillon",rejected:"Rejetée"}
type Inv={id:number;invoiceNumber:string;status:string;totalAmount:string;currency:string;discrepancy:string|null;createdBy:string;supplier:{id:number;name:string};replacesInvoice?:{id:number;invoiceNumber:string}|null;replacedBy?:{id:number;invoiceNumber:string}[]}
type SupplierCredit={id:number;ref:string;invoiceId:number;amount:string;reason:string;status:string;kind?:string;remainingCents?:number;actor:string;decisionActor?:string|null;decisionReason?:string|null;decidedAt?:string|null;createdAt:string}
type SupplierRefund={id:number;creditNoteId:number;supplierId:number;amount:string;status:string;method?:string|null;reference?:string|null;refundActor?:string|null;refundedAt?:string|null;createdAt:string}
type FinanceOverview={credits:SupplierCredit[];refunds?:SupplierRefund[];balances:{invoiceId:number;status?:string;total:string;paid:string;credited:string;outstanding:string;availableToReserve:string;pendingCredits:number;refundPending?:string;refundDraft?:string;refundable?:string}[]}
// V18.9.10 (UX-015) : formatage monétaire centralisé (centimes conservés pour
// la finance fournisseur) ; (UX-036) : les messages d'écart de rapprochement
// sont traduits dans la couche de présentation — l'API et ses codes restent
// inchangés (tests et intégrations préservés).
const madAmount=(a:string|number)=>fmtMAD(typeof a==="number"?a:Number(a),{cents:true})
function translateDiscrepancy(d:string|null|undefined):string{
  if(!d)return ""
  return d
    .replace(/^BR line (\d+): quantity above accepted$/,"Ligne de réception $1 : quantité facturée supérieure à la quantité acceptée")
    .replace(/^BR line (\d+): price variance above 1%$/,"Ligne de réception $1 : écart de prix supérieur à 1 % par rapport au BC")
}
function TableSkeleton({rows=3}:{rows?:number}){
  return <div className="space-y-2" role="status" aria-label="Chargement du tableau">{Array.from({length:rows}).map((_,i)=><Skeleton key={i} className="h-10 rounded-md"/>)}</div>
}
function EmptyRow({colSpan,label}:{colSpan:number;label:string}){
  // V18.9.10 (UX-028) : état vide explicite pour chaque tableau.
  return <TableRow><TableCell colSpan={colSpan} className="py-8 text-center text-sm text-slate-500">{label}</TableCell></TableRow>
}
export function P2PControlView({section}:{section:"stock-lots"|"supplier-invoices"}){
 const qc=useQueryClient()
 const session=useQuery({queryKey:["me"],queryFn:()=>api<SessionActor>("/api/me")})
 const canQuality=hasRole(session.data,"quality")
 const returnQ=useQuery({queryKey:["supplier-returns"],queryFn:()=>api<{items:unknown[]}>("/api/supplier-returns"),enabled:section==="stock-lots"})
 const financeQ=useQuery({queryKey:["p2p-finance"],queryFn:()=>api<FinanceOverview>("/api/p2p/finance"),enabled:section==="supplier-invoices"})
 const actorQ=useQuery({queryKey:["me"],queryFn:()=>api<{username:string}>("/api/me"),enabled:section==="supplier-invoices"})
 const [busy,setBusy]=useState(false)
 const [qty,setQty]=useState<Record<number,string>>({})
 const [reason,setReason]=useState<Record<number,string>>({})
 const [lotSearch,setLotSearch]=useState("")
 const [lotPage,setLotPage]=useState(1)
 const [lotStatus,setLotStatus]=useState("all")
 const lotSort=useListSort<"matiere"|"qty">("matiere","asc")
 const lotQ=useDocumentRegister<Lot>("stock-lots",lotSearch,lotPage,section==="stock-lots",{sort:lotSort.sort.key,dir:lotSort.sort.dir,status:lotStatus})
 const filteredLots=lotQ.data?.items??[]
 const [invSearch,setInvSearch]=useState("")
 const [invPage,setInvPage]=useState(1)
 const [invStatus,setInvStatus]=useState("all")
 const invSort=useListSort<"facture"|"total">("facture")
 const iQ=useDocumentRegister<Inv>("supplier-invoices",invSearch,invPage,section==="supplier-invoices",{sort:invSort.sort.key,dir:invSort.sort.dir,status:invStatus})
 const filteredInvoices=iQ.data?.items??[]
 const [invoiceNo,setInvoiceNo]=useState("")
 const [invoiceDate,setInvoiceDate]=useState(new Date().toISOString().slice(0,10))
 const [supplierId,setSupplierId]=useState("")
 const [receiptSearch,setReceiptSearch]=useState("")
 const [receiptPage,setReceiptPage]=useState(1)
 const [replacementSearch,setReplacementSearch]=useState("")
 const suppliersQ=useQuery({queryKey:["suppliers","choices"],queryFn:({signal})=>api<{items:{id:number;name:string}[]}>("/api/suppliers?view=choices",{signal}),enabled:section==="supplier-invoices"})
 const rQ=useDocumentRegister<Receipt>("goods-receipts",receiptSearch,receiptPage,section==="supplier-invoices"&&!!supplierId,{supplierId})
 const replacementQ=useDocumentRegister<Inv>("supplier-invoices",replacementSearch,1,section==="supplier-invoices"&&!!supplierId,{supplierId,status:"rejected"})

 const [selected,setSelected]=useState<Record<number,{qty:string;price:string;tax:string}>>({})
 const [payments,setPayments]=useState<Record<number,{ref:string;amount:string}>>({})
 const [creditInvoiceId,setCreditInvoiceId]=useState("")
 const [creditAmount,setCreditAmount]=useState("")
 const [creditReason,setCreditReason]=useState("")
 const [creditRejectReason,setCreditRejectReason]=useState<Record<number,string>>({})
 // V18.9.1 (contre-audit A-05) : rejet motivé d'une facture bloquée par écart.
 const [invoiceRejectReason,setInvoiceRejectReason]=useState<Record<number,string>>({})
 // V18.9.2 (contre-audit F06) : la saisie rectifiée déclare la facture remplacée.
 const [replacesInvoiceId,setReplacesInvoiceId]=useState("")
 // V18.9.2 (contre-audit F02) : rapprochement des remboursements fournisseurs.
 const [refundRef,setRefundRef]=useState<Record<number,string>>({})
 const [refundMethod,setRefundMethod]=useState<Record<number,string>>({})
 async function post(path:string,body:unknown,method="POST"){
  setBusy(true)
  try{
   const res=await api(path,{method,body:JSON.stringify(body)})
   for(const key of ["stock-lots","supplier-returns","supplier-invoices","goods-receipts","supplier-orders","materials","movements","dashboard","purchases","p2p-finance"])await qc.invalidateQueries({queryKey:[key]})
   toast.success("Opération enregistrée")
   return res
  }catch(e){toast.error(e instanceof Error?e.message:"Action refusée");return null}
  finally{setBusy(false)}
 }
 const availableReceipts=rQ.data?.items??[]
 const supplierOptions=suppliersQ.data?.items??[]
 const selectedBalance=financeQ.data?.balances.find(x=>x.invoiceId===Number(creditInvoiceId))
 const creditAmountValid=/^\d+(?:\.\d{1,2})?$/.test(creditAmount)&&Number(creditAmount)>0
 const creditForSoldeOk=Boolean(creditInvoiceId)&&creditAmountValid&&Number(creditAmount)<=Number(selectedBalance?.availableToReserve??0)&&creditReason.trim().length>=10
 const creditRefundOk=Boolean(creditInvoiceId)&&selectedBalance?.status==="paid"&&Number(selectedBalance?.outstanding??1)<=0&&creditAmountValid&&Number(creditAmount)<=Number(selectedBalance?.refundable??0)&&creditReason.trim().length>=10
 return <div className="space-y-5 pb-10">
  {section==="stock-lots"&&<>
   <section className="rounded-xl border bg-white p-4"><h2 className="text-lg font-semibold">Traçabilité des lots et décisions qualité</h2>
    <p className="my-2 text-sm text-slate-600">Simulation : les stocks et inventaires initiaux sont supposés validés ; en exploitation réelle, la réception et le contrôle qualité restent obligatoires. Un lot en quarantaine n'est pas disponible.</p>
    {lotQ.isError&&<LoadError message="Erreur de chargement des lots : vérifier la migration." onRetry={()=>void lotQ.refetch()}/>}
    {/* V18.9.10 (UX-019) : recherche + tri locaux sur les lots chargés. */}
    <ListSearch className="mb-3" value={lotSearch} onChange={v=>{setLotSearch(v);setLotPage(1)}} placeholder="Rechercher un lot par matière ou code…" shown={filteredLots.length} total={lotQ.data?.pagination.total??0} global unit="lots"/>
    <p className="text-xs text-slate-500 md:hidden">Faire glisser le tableau horizontalement pour afficher toutes les informations.</p>
    <label className="mb-3 block w-52 text-xs">Statut du lot<Select value={lotStatus} onValueChange={v=>{setLotStatus(v);setLotPage(1)}}><SelectTrigger className="mt-1" aria-label="Statut du lot"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">Tous les statuts</SelectItem>{Object.entries(LOT_STATUS).map(([value,label])=><SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></label>
    {lotQ.isPending?<TableSkeleton rows={4}/>:<div className="overflow-x-auto">
    <Table className="min-w-[850px] w-full">
      <TableHeader><TableRow>
        <SortableTh label="Matière" field="matiere" sort={lotSort.sort} onToggle={field=>{lotSort.toggle(field);setLotPage(1)}}/>
        <TableHead>Lot</TableHead><TableHead>Statut</TableHead>
        <SortableTh label="Qté" field="qty" sort={lotSort.sort} onToggle={field=>{lotSort.toggle(field);setLotPage(1)}} align="right"/>
        <TableHead>Action qualité</TableHead>
      </TableRow></TableHeader>
      <TableBody>
    {filteredLots.map(l=><TableRow key={l.id}><TableCell>{l.material.name}</TableCell><TableCell className="font-mono">{l.lotCode}</TableCell><TableCell>{LOT_STATUS[l.status] ?? l.status}</TableCell><TableCell className="text-right tabular-nums">{l.qty.toLocaleString("fr-FR",{maximumFractionDigits:3})} {l.material.unit}</TableCell><td className="p-2 align-middle">{canQuality&&l.qty>0&&["available","quarantine","legacy_unverified"].includes(l.status)&&<div className="flex flex-wrap items-center gap-2 py-2"><Input aria-label={`Quantité à traiter pour le lot ${l.lotCode}`} type="number" step="any" min="0.001" max={l.qty} className="w-24" placeholder="Qté" value={qty[l.id]??""} onChange={e=>setQty(p=>({...p,[l.id]:e.target.value}))}/><Input aria-label={`Motif de décision sur le lot ${l.lotCode}`} className="w-48" placeholder="Motif (10 caractères min.)" value={reason[l.id]??""} onChange={e=>setReason(p=>({...p,[l.id]:e.target.value}))}/>{l.status==="available"?<Button disabled={busy||!(Number(qty[l.id])>0&&Number(qty[l.id])<=l.qty)||(reason[l.id]??"").trim().length<10} size="sm" variant="outline" onClick={()=>post("/api/quality-inspections",{stockLotId:l.id,qty:Number(qty[l.id]),decision:"reject",reason:reason[l.id]})}>Bloquer</Button>:<Button disabled={busy||!(Number(qty[l.id])>0&&Number(qty[l.id])<=l.qty)||(reason[l.id]??"").trim().length<10} size="sm" onClick={()=>post("/api/quality-inspections",{stockLotId:l.id,qty:Number(qty[l.id]),decision:"release",reason:reason[l.id]})}>Libérer</Button>}{l.status!=="legacy_unverified"&&<Button size="sm" variant="outline" disabled={busy||!(Number(qty[l.id])>0&&Number(qty[l.id])<=l.qty)||(reason[l.id]??"").trim().length<10} onClick={()=>post("/api/supplier-returns",{stockLotId:l.id,qty:Number(qty[l.id]),reason:reason[l.id],creditExpected:true})}>Retour fournisseur</Button>}</div>}</td></TableRow>)}
    {!filteredLots.length&&<EmptyRow colSpan={5} label={lotSearch?`Aucun lot ne correspond à « ${lotSearch} ».`:"Aucun lot enregistré."}/>}
    </TableBody></Table></div>}
    <DocumentPager page={lotPage} data={lotQ.data?.pagination} onPage={setLotPage} label="Lots"/>
    {!canQuality&&<p className="text-sm text-slate-600">Consultation uniquement : décisions réservées au service qualité.</p>}<p className="mt-2 text-xs text-slate-500">Retours enregistrés : {returnQ.data?.items.length??0}. Seules les personnes autorisées « qualité » peuvent libérer ou retourner des lots.</p>
   </section>
  </>}
  {section==="supplier-invoices"&&<>
   <section className="rounded-xl border bg-white p-4 space-y-3">
    <h2 className="text-lg font-semibold">Avoirs fournisseurs — validation à deux personnes</h2>
    <p className="text-sm text-slate-600">La préparation d’un avoir ne modifie pas le solde. Son approbation exige un second compte du service finances ; le solde est vérifié de nouveau avant validation.</p>
    {financeQ.isError&&<LoadError message="Impossible de charger le suivi des avoirs fournisseurs." onRetry={()=>void financeQ.refetch()}/>}
    {/* V18.9.11 (contre-audit) : débordement 25 px à 768×1024 — la colonne md (165 px)
        était plus étroite que le bouton « Préparer l'avoir post-règlement » (226 px,
        whitespace-nowrap du design system) qui restait alors coupé à droite.
        2 colonnes de md à xl (≈341 px à 768) puis 4 colonnes au-delà de 1280 px. */}
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {/* V18.9.10 (UX-005) : Selects du design system. */}
      <div><label htmlFor="credit-invoice" className="text-xs font-medium">Facture fournisseur</label>
        <Select value={creditInvoiceId} onValueChange={setCreditInvoiceId}><SelectTrigger id="credit-invoice" className="mt-1 w-full"><SelectValue placeholder="Sélectionner"/></SelectTrigger><SelectContent>{(iQ.data?.items??[]).filter(i=>["approved","paid"].includes(i.status)).map(i=><SelectItem key={i.id} value={String(i.id)}>{i.invoiceNumber}</SelectItem>)}</SelectContent></Select></div>
      <div><label htmlFor="credit-amount" className="text-xs font-medium">Montant (MAD)</label><Input id="credit-amount" type="number" min="0.01" step="0.01" className="mt-1" value={creditAmount} onChange={e=>setCreditAmount(e.target.value)}/></div>
      <div><label htmlFor="credit-reason" className="text-xs font-medium">Motif (10 caractères minimum)</label><Input id="credit-reason" className="mt-1" value={creditReason} maxLength={500} onChange={e=>setCreditReason(e.target.value)}/></div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Button disabled={busy||!creditForSoldeOk} onClick={async()=>{const ok=await post("/api/p2p/finance",{action:"credit",invoiceId:Number(creditInvoiceId),amount:Number(creditAmount),reason:creditReason});if(ok){setCreditAmount("");setCreditReason("");setCreditInvoiceId("")}}}>Préparer l’avoir (solde)</Button>
          <Button variant="outline" disabled={busy||!creditRefundOk} onClick={async()=>{const ok=await post("/api/p2p/finance",{action:"refund-credit",invoiceId:Number(creditInvoiceId),amount:Number(creditAmount),reason:creditReason});if(ok){setCreditAmount("");setCreditReason("");setCreditInvoiceId("")}}}>Préparer l’avoir post-règlement</Button>
        </div>
        <span className="text-xs text-slate-500">V18.9.2 : l’avoir post-règlement s’emploie sur une facture ENTIÈREMENT payée ; son approbation ouvre une créance de remboursement fournisseur.</span>
      </div>
    </div>
    {/* V18.9.10 (UX-023) : raisons de blocage affichées en contexte. */}
    {creditInvoiceId&&<p className="text-xs text-slate-500" role="note">
      {!creditAmountValid?"Saisir un montant positif (deux décimales maximum).":!creditForSoldeOk&&!creditRefundOk?`Avoir sur solde : requiert un montant ≤ au montant non réservé et un motif de 10 caractères minimum. Avoir post-règlement : facture entièrement payée et montant ≤ au remboursable.`:creditForSoldeOk?"Avoir sur solde prêt à être préparé.":"Avoir post-règlement prêt à être préparé."}
    </p>}
    {creditInvoiceId&&<p className="text-sm">Solde à payer : {selectedBalance?.outstanding??"—"} MAD · Montant non réservé : {selectedBalance?.availableToReserve??"—"} MAD · Remboursable (post-règlement) : {selectedBalance?.refundable??"—"} MAD</p>}
    <h3 className="font-medium">Avoirs en attente d’une deuxième personne</h3>
    {financeQ.isLoading?<TableSkeleton/>:<div className="overflow-x-auto">
    <Table className="w-full min-w-[700px]">
      <TableHeader><TableRow><TableHead>Référence</TableHead><TableHead>Facture</TableHead><TableHead>Préparé par</TableHead><TableHead className="text-right">Montant</TableHead><TableHead>Motif</TableHead><TableHead>Décision</TableHead></TableRow></TableHeader>
      <TableBody>{(financeQ.data?.credits??[]).filter(c=>c.status==="draft").map(c=><TableRow key={c.id}><TableCell>{c.ref}{c.kind==="refund"?<span className="ml-1 rounded bg-amber-100 px-1 text-xs">post-règlement</span>:null}</TableCell><td className="p-2">{(iQ.data?.items??[]).find(i=>i.id===c.invoiceId)?.invoiceNumber??c.invoiceId}</td><td className="p-2">{c.actor}</td><td className="p-2 text-right tabular-nums">{madAmount(c.amount)}</td><td className="p-2">{c.reason}</td><td className="p-2"><div className="flex flex-wrap gap-2 py-2">{c.actor===actorQ.data?.username?<span className="text-xs text-amber-700">Préparé par vous : validation par une autre personne requise. Vous pouvez annuler ce brouillon.</span>:null}<Button size="sm" disabled={busy||!actorQ.data?.username||c.actor===actorQ.data.username} onClick={()=>post("/api/p2p/finance",{action:"approve-credit",creditId:c.id})}>Approuver</Button><Input aria-label={`Motif du refus de ${c.ref}`} className="w-48" placeholder="Motif de refus (10 caractères min.)" value={creditRejectReason[c.id]??""} onChange={e=>setCreditRejectReason(v=>({...v,[c.id]:e.target.value}))}/><Button size="sm" variant="outline" disabled={busy||!actorQ.data?.username||c.actor===actorQ.data.username||(creditRejectReason[c.id]??"").trim().length<10} onClick={()=>post("/api/p2p/finance",{action:"reject-credit",creditId:c.id,reason:creditRejectReason[c.id]})}>Refuser</Button>{c.actor===actorQ.data?.username&&<Button size="sm" variant="outline" disabled={busy||(creditRejectReason[c.id]??"").trim().length<10} onClick={()=>post("/api/p2p/finance",{action:"cancel-credit",creditId:c.id,reason:creditRejectReason[c.id]})}>Annuler mon brouillon</Button>}</div></td></TableRow>)}
      {!financeQ.isLoading&&!(financeQ.data?.credits??[]).some(c=>c.status==="draft")&&<EmptyRow colSpan={6} label="Aucun avoir en attente."/>}
      </TableBody></Table></div>}
    <h3 className="font-medium">Créances de remboursement fournisseur (V18.9.2)</h3>
    <p className="text-sm text-slate-600">Chaque avoir post-règlement approuvé ouvre une créance à obtenir du fournisseur. Son solder exige un compte DIFFÉRENT du préparateur de l’avoir, avec méthode et référence de rapprochement.</p>
    {(financeQ.data?.refunds??[]).filter(r=>r.status==="pending").length===0&&<p className="text-sm text-slate-500">Aucune créance en attente.</p>}
    {(financeQ.data?.refunds??[]).filter(r=>r.status==="pending").map(r=><div key={r.id} className="flex flex-wrap items-center gap-2 rounded border p-2 text-sm"><strong>Remboursement #{r.id}</strong> · avoir #{r.creditNoteId} · fournisseur #{r.supplierId} · {madAmount(r.amount)}
      <Select value={refundMethod[r.id]??"bank"} onValueChange={v=>setRefundMethod(p=>({...p,[r.id]:v}))}><SelectTrigger aria-label={`Méthode du remboursement ${r.id}`} className="h-9 w-44"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="bank">Virement</SelectItem><SelectItem value="offset">Imputation / transaction ultérieure</SelectItem></SelectContent></Select>
      <Input aria-label={`Référence du remboursement ${r.id}`} className="w-44" placeholder="Référence (3 car. min.)" value={refundRef[r.id]??""} onChange={e=>setRefundRef(p=>({...p,[r.id]:e.target.value}))}/><Button size="sm" disabled={busy||!(refundRef[r.id]??"").trim()||((refundRef[r.id]??"").trim().length<3)} onClick={()=>post("/api/p2p/finance",{action:"settle-refund",refundId:r.id,method:(refundMethod[r.id]??"bank") as "bank"|"offset",reference:refundRef[r.id]})}>Marquer remboursé</Button></div>)}
    {(financeQ.data?.refunds??[]).filter(r=>r.status==="refunded").slice(0,10).map(r=><p key={r.id} className="text-sm text-slate-500">Remboursement #{r.id} soldé le {r.refundedAt?new Date(r.refundedAt).toLocaleDateString("fr-FR"):"—"} par {r.refundActor??"—"} ({r.method==="offset"?"imputation":"virement"} {r.reference??""}) · {madAmount(r.amount)}</p>)}
    <h3 className="font-medium">Historique des décisions sur les avoirs</h3>
    <div className="space-y-1 text-sm">{(financeQ.data?.credits??[]).filter(c=>c.status!=="draft").slice(0,30).map(c=><p key={c.id} className="rounded border p-2"><strong>{c.ref}</strong> · {c.status==="approved"?"Approuvé":c.status==="cancelled"?"Annulé":"Rejeté"} · {madAmount(c.amount)} · décision : {c.decisionActor??"historique"}{c.decisionReason?` · motif : ${c.decisionReason}`:""}</p>)}
    {!financeQ.isLoading&&!(financeQ.data?.credits??[]).some(c=>c.status!=="draft")&&<p className="text-sm text-slate-500">Aucune décision d’avoir enregistrée.</p>}</div>
   </section>
   <section className="rounded-xl border bg-white p-4 space-y-3">{iQ.isError && <LoadError message={(iQ.error as Error & {status?:number})?.status===403 ? "Accès réservé au service finances : aucune donnée de facture n’a été chargée." : `Erreur de chargement des factures : ${iQ.error instanceof Error ? iQ.error.message : "inconnue"}.`} onRetry={()=>void iQ.refetch()}/>}<h2 className="text-lg font-semibold">Enregistrer une facture fournisseur — rapprochement BR/BC</h2>
    <p className="text-sm text-slate-600">La facture doit être justifiée par des quantités acceptées sur chaque ligne de BR. Les écarts de prix supérieurs à 1 % bloquent le bon à payer.</p>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      <div><label className="text-xs font-medium" htmlFor="inv-supplier">Fournisseur</label>
        <Select value={supplierId} onValueChange={v=>{setSupplierId(v);setSelected({});setReceiptPage(1);setReceiptSearch("");setReplacesInvoiceId("");setReplacementSearch("")}}><SelectTrigger id="inv-supplier" className="mt-1 w-full"><SelectValue placeholder="Sélectionner"/></SelectTrigger><SelectContent>{supplierOptions.map(s=><SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent></Select></div>
      <div><label className="text-xs font-medium" htmlFor="inv-number">N° facture</label><Input id="inv-number" className="mt-1" value={invoiceNo} onChange={e=>setInvoiceNo(e.target.value)} placeholder="FAC-2026-001"/></div>
      <div><label className="text-xs font-medium" htmlFor="inv-date">Date facture</label><Input id="inv-date" type="date" className="mt-1" value={invoiceDate} onChange={e=>setInvoiceDate(e.target.value)}/></div></div>
   <div className="grid grid-cols-1 sm:grid-cols-2 gap-2"><div><label htmlFor="replaces-invoice" className="text-xs font-medium">Remplace la facture rejetée (facultatif)</label>
    <Input className="my-1" type="search" placeholder="Chercher le numéro rejeté…" aria-label="Chercher une facture rejetée" value={replacementSearch} onChange={e=>{setReplacementSearch(e.target.value);setReplacesInvoiceId("")}} disabled={!supplierId}/><Select value={replacesInvoiceId} onValueChange={setReplacesInvoiceId}><SelectTrigger id="replaces-invoice" className="mt-1 w-full"><SelectValue placeholder="Aucune"/></SelectTrigger><SelectContent>{(replacementQ.data?.items??[]).map(i=><SelectItem key={i.id} value={String(i.id)}>{i.invoiceNumber}</SelectItem>)}</SelectContent></Select></div><p className="self-end text-xs text-slate-500">V18.9.2 : une facture rejetée garde son numéro et son historique ; la rectification porte un numéro DIFFÉRENT et pointe la facture remplacée (traçabilité comptable).</p></div>
    {supplierId?<><ListSearch value={receiptSearch} onChange={v=>{setReceiptSearch(v);setReceiptPage(1)}} placeholder="Chercher un BR ou un BL du fournisseur…" shown={availableReceipts.length} total={rQ.data?.pagination.total??0} unit="BR" global/>
    <div className="flex items-center gap-2 text-xs"><span>{Object.keys(selected).length} ligne(s) sélectionnée(s) sur les pages</span>{Object.keys(selected).length>0&&<Button size="sm" variant="ghost" onClick={()=>setSelected({})}>Effacer la sélection</Button>}</div>
    {rQ.isError&&<LoadError message="Impossible de charger les réceptions du fournisseur." onRetry={()=>void rQ.refetch()}/>}
    {rQ.isPending?<TableSkeleton/>:<div className="overflow-x-auto">
    <Table className="min-w-[740px] w-full">
      <TableHeader><TableRow><TableHead>Choisir</TableHead><TableHead>BR / BC</TableHead><TableHead>Matière</TableHead><TableHead className="text-right">Accepté</TableHead><TableHead>À facturer</TableHead><TableHead>PU</TableHead><TableHead>TVA %</TableHead></TableRow></TableHeader>
      <TableBody>{availableReceipts.flatMap(r=>r.lines.filter(l=>l.acceptedQty-(l.returnedQty??0)>0).map(l=><TableRow key={l.id}>
        {/* V18.9.10 (UX-011) : case à cocher 24 px avec aria-label explicite. */}
        <td className="p-2 align-middle"><label className="flex cursor-pointer items-center justify-center py-1"><input type="checkbox" className="size-6 accent-emerald-700" aria-label={`Choisir la ligne ${r.ref} — ${l.supplierOrderLine.material.name}`} checked={Boolean(selected[l.id])} onChange={e=>setSelected(p=>{const n={...p};if(e.target.checked)n[l.id]={qty:String(l.acceptedQty-(l.returnedQty??0)),price:String(l.supplierOrderLine.unitPrice),tax:"0"};else delete n[l.id];return n})}/></label></td>
        <td className="p-2">{r.ref} / {r.supplierOrder.ref}</td><td className="p-2">{l.supplierOrderLine.material.name}</td><td className="p-2 text-right tabular-nums">{l.acceptedQty-(l.returnedQty??0)}</td>
        <td className="p-2"><Input type="number" min="0" step="any" className="w-24" disabled={!selected[l.id]} value={selected[l.id]?.qty??""} onChange={e=>setSelected(p=>({...p,[l.id]:{...p[l.id],qty:e.target.value}}))}/></td>
        <td className="p-2"><Input type="number" min="0" step="any" className="w-24" disabled={!selected[l.id]} value={selected[l.id]?.price??""} onChange={e=>setSelected(p=>({...p,[l.id]:{...p[l.id],price:e.target.value}}))}/></td>
        <td className="p-2"><Input type="number" min="0" max="100" step="any" className="w-20" disabled={!selected[l.id]} value={selected[l.id]?.tax??""} onChange={e=>setSelected(p=>({...p,[l.id]:{...p[l.id],tax:e.target.value}}))}/></td>
      </TableRow>))}
      {!availableReceipts.some(r=>r.lines.some(l=>l.acceptedQty-(l.returnedQty??0)>0))&&<EmptyRow colSpan={7} label="Aucune ligne de réception à facturer pour ce fournisseur."/>}
      </TableBody></Table></div>}
    <DocumentPager page={receiptPage} data={rQ.data?.pagination} onPage={setReceiptPage} label="Réceptions à rapprocher"/>
    </>:<p className="text-sm text-slate-500">Choisissez un fournisseur pour afficher ses réceptions.</p>}

    <Button variant="primary" disabled={busy||!supplierId||invoiceNo.length<2||!Object.keys(selected).length} onClick={async()=>{const lines=Object.entries(selected).map(([id,v])=>({receiptLineId:Number(id),qty:Number(v.qty),unitPrice:Number(v.price),taxRate:Number(v.tax)}));const done=await post("/api/supplier-invoices",{supplierId:Number(supplierId),invoiceNumber:invoiceNo,invoiceDate,currency:"MAD",...(replacesInvoiceId?{replacesInvoiceId:Number(replacesInvoiceId)}:{}),lines});if(done){setSelected({});setInvoiceNo("");setReplacesInvoiceId("")}}}>Enregistrer et rapprocher la facture</Button>
   </section>
   <section className="rounded-xl border bg-white p-4">
     <h2 className="mb-3 font-semibold">Factures fournisseurs ({iQ.data?.pagination.total??0})</h2>
     {/* V18.9.10 (UX-019) : recherche + tri locaux sur les factures chargées. */}
     <ListSearch className="mb-3" value={invSearch} onChange={v=>{setInvSearch(v);setInvPage(1)}} placeholder="Rechercher une facture par numéro ou fournisseur…" shown={filteredInvoices.length} total={iQ.data?.pagination.total??0} global unit="factures"/>
     <label className="mb-3 block w-52 text-xs">Statut de la facture<Select value={invStatus} onValueChange={v=>{setInvStatus(v);setInvPage(1)}}><SelectTrigger className="mt-1" aria-label="Statut de la facture"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">Tous les statuts</SelectItem>{Object.entries(INVOICE_STATUS).map(([value,label])=><SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></label>
     {iQ.isPending?<TableSkeleton rows={3}/>:<div className="overflow-x-auto">
     <Table className="w-full min-w-[800px]">
       <TableHeader><TableRow>
         <SortableTh label="Facture" field="facture" sort={invSort.sort} onToggle={field=>{invSort.toggle(field);setInvPage(1)}}/>
         <TableHead>Fournisseur</TableHead><TableHead>Statut</TableHead>
         <SortableTh label="Total" field="total" sort={invSort.sort} onToggle={field=>{invSort.toggle(field);setInvPage(1)}} align="right"/>
         <TableHead>Écart / Paiement</TableHead></TableRow></TableHeader>
       <TableBody>{filteredInvoices.map(i=><TableRow key={i.id}>
         <td className="p-2">{i.invoiceNumber}{i.replacesInvoice?<span className="ml-1 text-xs text-slate-500">(remplace {i.replacesInvoice.invoiceNumber})</span>:null}</td><td className="p-2">{i.supplier.name}</td><td className="p-2">{INVOICE_STATUS[i.status] ?? i.status}</td><td className="p-2 text-right tabular-nums">{madAmount(i.totalAmount)}</td>
         <td className="p-2">{i.status==="blocked"?<div className="flex flex-wrap items-center gap-2 py-1"><span className="text-rose-700" title={i.discrepancy??undefined}>{translateDiscrepancy(i.discrepancy)}</span><Input aria-label={`Motif de rejet de la facture ${i.invoiceNumber}`} className="w-48" placeholder="Motif de rejet (10 caractères min.)" value={invoiceRejectReason[i.id]??""} onChange={e=>setInvoiceRejectReason(p=>({...p,[i.id]:e.target.value}))}/><Button size="sm" variant="outline" disabled={busy||(invoiceRejectReason[i.id]?? "").trim().length<10} onClick={()=>post(`/api/supplier-invoices/${i.id}`,{action:"reject",reason:invoiceRejectReason[i.id]},"PATCH")}>Rejeter la facture</Button><span className="text-xs text-slate-500">Rejet réservé à un autre comptable ; la facture rectifiée pourra être ressaisie.</span></div>:i.status==="rejected"?<span className="text-slate-500" title={i.discrepancy??undefined}>Rejetée ({translateDiscrepancy(i.discrepancy)||i.discrepancy})</span>:i.status==="matched"?<Button size="sm" disabled={busy} onClick={()=>post(`/api/supplier-invoices/${i.id}`,{action:"approve"},"PATCH")}>Approuver</Button>:i.status==="approved"?<div className="flex gap-2 py-1"><Input aria-label={`Référence du règlement de la facture ${i.invoiceNumber}`} className="w-40" placeholder="Réf règlement" value={payments[i.id]?.ref??""} onChange={e=>setPayments(p=>({...p,[i.id]:{...p[i.id],ref:e.target.value,amount:p[i.id]?.amount??""}}))}/><Input aria-label={`Montant du règlement de la facture ${i.invoiceNumber}`} type="number" min="0.01" step="0.01" placeholder="Montant" className="w-28" value={payments[i.id]?.amount??""} onChange={e=>setPayments(p=>({...p,[i.id]:{...p[i.id],ref:p[i.id]?.ref??"",amount:e.target.value}}))}/><Button size="sm" disabled={busy} onClick={()=>post(`/api/supplier-invoices/${i.id}`,{action:"payment",reference:payments[i.id]?.ref,amount:Number(payments[i.id]?.amount)},"PATCH")}>Enregistrer</Button></div>:"—"}</td>
       </TableRow>)}
       {!filteredInvoices.length&&<EmptyRow colSpan={5} label={invSearch?`Aucune facture ne correspond à « ${invSearch} ».`:"Aucune facture fournisseur enregistrée."}/>}
       </TableBody></Table></div>}
     <DocumentPager page={invPage} data={iQ.data?.pagination} onPage={setInvPage} label="Factures fournisseurs"/>
   </section>
  </>}
 </div>
}
