"use client";
import {useState} from "react"
import {Check,Plus,ShoppingCart,Truck,CircleCheck,Inbox} from "lucide-react"
import {Button} from "@/components/ui/button"
import {Card,CardContent,CardDescription,CardHeader,CardTitle} from "@/components/ui/card"
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from "@/components/ui/dialog"
import {Input} from "@/components/ui/input"
import {Label} from "@/components/ui/label"
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from "@/components/ui/table"
import {Tabs,TabsList,TabsTrigger} from "@/components/ui/tabs"
import {fmtDate,fmtMAD,fmtNum,type MaterialDTO,type PurchaseDTO,type PurchaseStatus} from "@/lib/erp-types"
import {DocumentPager} from "./document-pager"
import {PurchaseStatusBadge,LoadError} from "./bits"
import {ConsultationDialog} from "./consultation-dialog"
import {useAdvancePurchase,useClosePurchase,useCancelPurchase,usePurchases,api} from "./hooks"
import {useInfiniteQuery,useQuery} from "@tanstack/react-query"
import {hasRole,type SessionActor} from "@/lib/role-navigation"
import {isValidPurchaseQuantity} from "@/lib/purchase-quantity"


export function PurchasesView({onNewPurchase}:{onNewPurchase:(prefill?:MaterialDTO)=>void}) {
 const [tab,setTab]=useState<"all"|PurchaseStatus>("all")
 const [page,setPage]=useState(1)
 const [query,setQuery]=useState("")
 const [detailId,setDetailId]=useState<number|null>(null)
 const [consultationId,setConsultationId]=useState<number|null>(null)
 const [approvingId,setApprovingId]=useState<number|null>(null)
 const [lineChoices,setLineChoices]=useState<Record<number,{decision:'approve'|'reduce'|'reject';qty:string;reason:string}>>({})
 function openApproval(p:PurchaseDTO){
  setLineChoices(Object.fromEntries(p.lines.map(l=>[l.id,{decision:'approve',qty:String(l.qty),reason:''}])));
  setApprovingId(p.id);
 }

 
 const [closing,setClosing]=useState<number|null>(null)
 const [cancelling,setCancelling]=useState<number|null>(null)
 const [reason,setReason]=useState("")
 const list=usePurchases(page,tab,query,40)
 const {data}=list
 const session=useQuery({queryKey:["me"],queryFn:()=>api<SessionActor>("/api/me")})
 const canApprove=hasRole(session.data,"approver")
 const canBuy=hasRole(session.data,"buyer")
 const advance=useAdvancePurchase(),close=useClosePurchase(),cancel=useCancelPurchase()
 const all=data?.items??[]
 const filtered=all
 const selected=all.find(p=>p.id===detailId)??null
 const history=useInfiniteQuery({
  queryKey:["purchase-history",detailId],
  enabled:detailId!==null,
  initialPageParam:null as number|null,
  queryFn:({pageParam})=>api<{items:NonNullable<PurchaseDTO["approvalHistory"]>;nextCursor:number|null;hasMore:boolean}>(
    `/api/purchases/${detailId}/history?limit=30${pageParam===null?"":`&cursor=${pageParam}`}`),
  getNextPageParam:last=>last.nextCursor??undefined,
 });
 const historyEvents=history.data?.pages.flatMap(page=>page.items)??[];
 const approving=all.find(p=>p.id===approvingId)??null

 const counts=(s:PurchaseStatus)=>data?.statusCounts?.[s]??0
 const receivable=(p:PurchaseDTO)=>p.status==="ordered"||p.status==="partial"
 const approvalDecisions=approving?.lines.map(l=>{
  const c=lineChoices[l.id]??{decision:'approve' as const,qty:String(l.qty),reason:''};
  return {lineId:l.id,decision:c.decision,approvedQty:c.decision==='approve'?l.qty:c.decision==='reject'?0:Number(c.qty.replace(',','.')),reason:c.reason.trim()};
 })??[];
 const approvalValid=approving!==null&&approvalDecisions.length===approving.lines.length&&approvalDecisions.every(d=>{
  const line=approving.lines.find(l=>l.id===d.lineId)!;
  if(d.decision==='approve')return true;
  if(d.reason.length<10)return false;
  if(d.decision==='reject')return true;
  return isValidPurchaseQuantity(d.approvedQty,line.material.unit)&&d.approvedQty>0&&d.approvedQty<line.qty-0.000001;
 });

 return <div className="space-y-4">
  <div className="grid gap-3 sm:grid-cols-4">
   <Card><CardContent className="p-4">{canBuy&&<Button variant="primary" onClick={()=>onNewPurchase()}><Plus className="mr-1 size-4"/> Nouvelle DA</Button>}</CardContent></Card>
   {([ ["À valider",counts("pending"),Inbox],["Commandées",counts("ordered"),Truck],["Partielles",counts("partial"),CircleCheck] ] as const).map(([label,value,Icon])=><Card key={label}><CardContent className="flex items-center gap-3 p-4"><Icon className="size-5 text-slate-600"/><div><p className="text-xs text-slate-500">{label}</p><p className="text-xl font-bold">{value}</p></div></CardContent></Card>)}
  </div>
  <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShoppingCart className="size-4"/> {canBuy&&!canApprove?"Suivi des demandes d’achat (DA)":"Demandes d’achat (DA)"}</CardTitle><CardDescription>DA = expression de besoin. Après validation, ouvrez BC fournisseurs, puis Réceptions MP pour les BR. Pas de réception directe sur DA.</CardDescription>
   <form className="flex flex-wrap items-center gap-2" key={query} onSubmit={e=>{e.preventDefault();setQuery(String(new FormData(e.currentTarget).get("q")??"").trim());setPage(1)}}>
    <Input name="q" type="search" aria-label="Rechercher une DA" placeholder="Référence DA ou matière" maxLength={100} defaultValue={query} className="min-w-0 sm:max-w-xs"/>
    <Button size="sm" type="submit" variant="outline">Rechercher</Button>
    {query&&<Button size="sm" type="button" variant="ghost" onClick={()=>{setQuery("");setPage(1)}}>Effacer</Button>}
   </form>
   <Tabs value={tab} onValueChange={v=>{setTab(v as typeof tab);setPage(1)}}><TabsList className="flex h-auto flex-wrap"><TabsTrigger value="all">Toutes</TabsTrigger><TabsTrigger value="pending">{canBuy&&!canApprove?"En attente de décision":"À valider"}</TabsTrigger><TabsTrigger value="approved">Validées</TabsTrigger><TabsTrigger value="partially_approved">Validées partiellement</TabsTrigger><TabsTrigger value="rejected">Refusées</TabsTrigger><TabsTrigger value="ordered">Commandées</TabsTrigger><TabsTrigger value="partial">Partielles</TabsTrigger><TabsTrigger value="received">Reçues</TabsTrigger><TabsTrigger value="closed">Clôturées</TabsTrigger><TabsTrigger value="cancelled">Annulées</TabsTrigger></TabsList></Tabs>
  </CardHeader><CardContent>
   {list.isPending&&<p role="status">Chargement des demandes…</p>}
   {list.isError&&<LoadError message="Impossible de charger les demandes." onRetry={()=>void list.refetch()}/>} 
   <div className="space-y-3 md:hidden" aria-label="Demandes d'achat (affichage mobile)">
    {filtered.map(p=>{
      const receivedLines=p.lines.filter(l=>(l.approvedQty>0&&(l.receivedQty??0)>=l.approvedQty-0.000001)).length
      return <article key={p.id} className="space-y-2 rounded-xl border bg-white p-3 shadow-sm">
       <div className="flex flex-wrap items-center justify-between gap-2"><button className="font-mono font-semibold underline" type="button" onClick={()=>setDetailId(p.id)}>{p.ref}</button><PurchaseStatusBadge status={p.status}/></div>
       <p className="text-sm text-slate-600">{p.lines.length} ligne(s) · {receivedLines}/{p.lines.length} soldées</p>
       <p className="text-xs text-slate-600">Date souhaitée : {fmtDate(p.expectedDate)} · Estimation : {fmtMAD(p.total)}</p>
       <div className="flex flex-wrap gap-2 border-t pt-2">
        {canApprove&&p.status==="pending"&&<Button size="sm" disabled={advance.isPending} onClick={()=>openApproval(p)}>Vérifier / valider</Button>}
        {canApprove&&receivable(p)&&<Button size="sm" variant="outline" onClick={()=>{setClosing(p.id);setReason("")}}>Clôturer</Button>}
        {canApprove&&["pending","approved","partially_approved","rejected"].includes(p.status)&&<Button size="sm" variant="outline" onClick={()=>{setCancelling(p.id);setReason("")}}>Annuler</Button>}
        {canBuy&&["approved","partially_approved","ordered","partial"].includes(p.status)&&<Button size="sm" variant="outline" onClick={()=>setConsultationId(p.id)}>Consulter plusieurs DA</Button>}
        <Button size="sm" variant="outline" onClick={()=>setDetailId(p.id)}>Détails</Button>
       </div>
      </article>
    })}
    {list.isSuccess&&!filtered.length&&<p className="py-7 text-center text-sm text-slate-500">Aucune demande.</p>}
   </div>
   <div className="hidden overflow-x-auto md:block"><Table className="min-w-[850px]"><TableHeader><TableRow><TableHead>Référence</TableHead><TableHead>Statut</TableHead><TableHead>Fournisseur</TableHead><TableHead>Réception</TableHead><TableHead>Date souhaitée</TableHead><TableHead>Estimation interne</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody>
   {filtered.map(p=>{const receivedLines=p.lines.filter(l=>(l.approvedQty>0&&(l.receivedQty??0)>=l.approvedQty-0.000001)).length;return <TableRow key={p.id}>
     <TableCell><button type="button" className="font-mono text-xs font-semibold underline" onClick={()=>setDetailId(p.id)}>{p.ref}</button></TableCell>
     <TableCell><div className="flex flex-wrap items-center gap-1.5"><PurchaseStatusBadge status={p.status}/>{p.note?.startsWith("URGENT —")&&<span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-[#bd202a]">Urgente</span>}</div></TableCell><TableCell>{p.supplier??"—"}</TableCell>
     <TableCell><span className="text-xs">{receivedLines} / {p.lines.length} lignes soldées</span></TableCell>
     <TableCell>{fmtDate(p.expectedDate)}</TableCell><TableCell>{fmtMAD(p.total)}</TableCell>
     <TableCell><div className="flex flex-wrap gap-1">
      {canApprove&&p.status==="pending"&&<Button size="sm" variant="outline" disabled={advance.isPending} onClick={()=>openApproval(p)}><Check className="mr-1 size-3"/>Vérifier / valider</Button>}
      {canApprove&&receivable(p)&&<Button variant="outline" size="sm" onClick={()=>{setClosing(p.id);setReason("")}}>Clôturer solde</Button>}
      {canApprove&&["pending","approved","partially_approved","rejected"].includes(p.status)&&<Button size="sm" variant="outline" className="text-rose-700" onClick={()=>{setCancelling(p.id);setReason("")}}>Annuler</Button>}
      {canBuy&&["approved","partially_approved","ordered","partial"].includes(p.status)&&<Button size="sm" variant="outline" onClick={()=>setConsultationId(p.id)}>Consulter plusieurs DA</Button>}
      <Button variant="ghost" size="sm" onClick={()=>setDetailId(p.id)}>Détails</Button>
     </div></TableCell></TableRow>})}
    {list.isSuccess&&!filtered.length&&<TableRow><TableCell colSpan={7} className="py-10 text-center">Aucune demande.</TableCell></TableRow>}
  </TableBody></Table></div>
   <DocumentPager page={page} data={data?.pagination} onPage={setPage} label="Demandes d’achat"/>
  </CardContent></Card>
  {consultationId!==null&&all.find(p=>p.id===consultationId)&&<ConsultationDialog purchase={all.find(p=>p.id===consultationId)!} onClose={()=>setConsultationId(null)}/>}
  <Dialog open={approvingId!==null} onOpenChange={open=>!open&&setApprovingId(null)}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
   <DialogHeader><DialogTitle>Contrôler avant d'approuver</DialogTitle><DialogDescription>L'approbation confirme le besoin, pas le choix du fournisseur ni son prix. L'auteur de la DA ne peut pas s'auto-approuver.</DialogDescription></DialogHeader>
   {approving&&<div className="space-y-2 text-sm">
    <p className="font-semibold">{approving.ref} — {approving.lines.length} matière(s)</p>
    <div className="space-y-3">{approving.lines.map(l=>{const c=lineChoices[l.id]??{decision:'approve',qty:String(l.qty),reason:''};return <div key={l.id} className="space-y-2 rounded-lg border p-3">
      <p className="font-medium">{l.material.name}</p>
      <p className="text-xs text-slate-600">Demandé : <strong>{fmtNum(l.qty)} {l.material.unit}</strong> · Stock inchangé tant qu'aucun BR n'est réceptionné</p>
      <label className="block text-xs font-medium">Décision sur cette ligne
       <select aria-label={`Décision pour ${l.material.name}`} className="mt-1 block w-full rounded-md border border-slate-300 bg-white p-2 text-sm" value={c.decision}
        onChange={e=>setLineChoices(old=>({...old,[l.id]:{...c,decision:e.target.value as 'approve'|'reduce'|'reject'}}))}>
        <option value="approve">Approuver la quantité demandée</option><option value="reduce">Approuver une quantité réduite</option><option value="reject">Refuser cette ligne</option>
       </select>
      </label>
      {c.decision==='reduce'&&<label className="block text-xs font-medium">Quantité autorisée ({l.material.unit})
       <Input type="number" min="0" max={l.qty} step="any" value={c.qty} className="mt-1" onChange={e=>setLineChoices(old=>({...old,[l.id]:{...c,qty:e.target.value}}))}/>
       <span className="text-slate-500">Une augmentation nécessite une nouvelle DA.</span></label>}
      {c.decision!=='approve'&&<label className="block text-xs font-medium">Motif obligatoire (10 caractères minimum)
       <Input maxLength={500} value={c.reason} className="mt-1" placeholder="Pourquoi réduire ou refuser ce besoin ?"
        onChange={e=>setLineChoices(old=>({...old,[l.id]:{...c,reason:e.target.value}}))}/></label>}
    </div>})}</div>
    <p className="text-xs text-slate-600">Motif de DA : {approving.note||"Non précisé"} · Date souhaitée : {fmtDate(approving.expectedDate)}</p>
    <p className="text-xs text-slate-600">Les décisions seront journalisées avec l'identité du compte, les quantités initiales et approuvées, la date et le motif. Les lignes refusées ne pourront pas être consultées ni commandées.</p>
    <p className="text-xs text-slate-600">Estimation du besoin initial : {fmtMAD(approving.total)}</p>
   </div>}
   <DialogFooter><Button variant="outline" onClick={()=>setApprovingId(null)}>Retour</Button><Button disabled={advance.isPending||!approvalValid} onClick={()=>{if(approvingId!==null)advance.mutate({id:approvingId,decisions:approvalDecisions},{onSuccess:()=>setApprovingId(null)})}}>Enregistrer les décisions</Button></DialogFooter>
  </DialogContent></Dialog>
  <Dialog open={selected!==null} onOpenChange={o=>!o&&setDetailId(null)}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
    {selected&&<><DialogHeader><DialogTitle>{selected.ref} <PurchaseStatusBadge status={selected.status}/></DialogTitle><DialogDescription>{selected.supplier??"Aucun fournisseur suggéré"} — date souhaitée : {selected.expectedDate?fmtDate(selected.expectedDate):"non précisée"}</DialogDescription></DialogHeader>
    <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Matière</TableHead><TableHead>Demandé</TableHead><TableHead>Approuvé</TableHead><TableHead>BC validés</TableHead><TableHead>Reçu</TableHead><TableHead>À recevoir</TableHead></TableRow></TableHeader><TableBody>{selected.lines.map(l=><TableRow key={l.id}>
      <TableCell><div className="min-w-44">{l.material.name}</div>{l.approvalDecision!=='pending'&&<span className="text-xs text-slate-500">{l.approvalDecision==='rejected'?'Refusée':l.approvalDecision==='reduced'?'Réduite':'Approuvée'}</span>}</TableCell>
      <TableCell>{fmtNum(l.qty)} {l.material.unit}</TableCell><TableCell>{fmtNum(l.approvedQty)} {l.material.unit}</TableCell>
      <TableCell>{fmtNum(l.orderedQty??0)} {l.material.unit}</TableCell><TableCell>{fmtNum(l.receivedQty??0)} {l.material.unit}</TableCell>
      <TableCell className="font-semibold">{fmtNum(l.openOrderRemainingQty??0)} {l.material.unit}</TableCell>
     </TableRow>)}</TableBody></Table></div>
    <p className="text-xs text-slate-500">« Demandé » = besoin initial · « Approuvé » = quantité autorisée · « BC validés » = bons confirmés · « À recevoir » = BC ouverts confirmés non réceptionnés, hors BC clôturés. Aucun montant n'est ajouté au stock par une DA.</p>
    <div className="space-y-2"><h3 className="text-sm font-semibold">Décisions et motifs par ligne</h3>{selected.lines.filter(l=>l.approvalDecision!=='pending').map(l=><p key={l.id} className="rounded border border-slate-200 p-2 text-xs">
      <strong>{l.material.name}</strong> : {fmtNum(l.qty)} → {fmtNum(l.approvedQty)} {l.material.unit} · {l.decisionBy??'Ancienne approbation'} · {l.decisionAt?fmtDate(l.decisionAt):'Date antérieure'} {l.approvalReason?`· ${l.approvalReason}`:''}
    </p>)}<h3 className="text-sm font-semibold">Journal des validations (les plus récentes d’abord)</h3>
    {historyEvents.map(e=><p key={e.id} className="rounded bg-slate-50 p-2 text-xs">{fmtDate(e.createdAt)} · {e.actor} · {e.action} · {e.details}</p>)}
    {history.isPending&&<p className="text-xs text-slate-500">Chargement du journal…</p>}
    {history.isError&&<p role="alert" className="text-xs text-rose-700">Journal indisponible. Réessayer après actualisation.</p>}
    {!history.isPending&&!history.isError&&!historyEvents.length&&<p className="text-xs text-slate-500">Aucune décision enregistrée.</p>}
    {history.hasNextPage&&<Button variant="outline" size="sm" disabled={history.isFetchingNextPage} onClick={()=>history.fetchNextPage()}>{history.isFetchingNextPage?"Chargement…":"Charger 30 événements plus anciens"}</Button>}</div>
    {selected.note&&<p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm"><strong>Motif / priorité :</strong> {selected.note}</p>}
    <div className="space-y-1 text-sm"><strong>Historique des BL</strong>{(selected.receipts??[]).map(b=><p key={b.id} className="rounded border p-2">{b.deliveryRef} — {fmtDate(b.createdAt)} — {b.operator} : {b.lines.map(l=>`+${fmtNum(l.acceptedQty)} accepté, ${fmtNum(l.rejectedQty)} refusé`).join(" ; ")}</p>)}{!selected.receipts?.length&&<p className="text-slate-500">Aucune réception enregistrée.</p>}{selected.closedReason&&<p>{selected.status==="cancelled"?`Annulation : ${selected.closedReason} (par ${selected.closedBy})`:`Clôture anticipée : ${selected.closedReason} (par ${selected.closedBy})`}</p>}</div>
    <DialogFooter><Button variant="outline" onClick={()=>setDetailId(null)}>Fermer</Button></DialogFooter></>}
  </DialogContent></Dialog>

  <Dialog open={closing!==null} onOpenChange={o=>!o&&setClosing(null)}><DialogContent><DialogHeader><DialogTitle>Clôture anticipée du solde</DialogTitle><DialogDescription>Le restant ne sera pas réceptionné. Cette action n'ajoute aucune matière au stock. La décision est attribuée au compte connecté.</DialogDescription></DialogHeader>
   <div className="space-y-2"><Label htmlFor="close-reason">Motif de clôture (10 caractères minimum)</Label><Input id="close-reason" maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></div>
   <DialogFooter><Button variant="outline" onClick={()=>setClosing(null)}>Annuler</Button><Button disabled={reason.trim().length<10||close.isPending} onClick={()=>closing!==null&&close.mutate({id:closing,reason:reason.trim()},{onSuccess:()=>setClosing(null)})}>Confirmer la clôture</Button></DialogFooter>
  </DialogContent></Dialog>
  <Dialog open={cancelling!==null} onOpenChange={o=>!o&&setCancelling(null)}><DialogContent><DialogHeader><DialogTitle>Annulation de la demande d'achat</DialogTitle><DialogDescription>La DA doit être à valider ou validée sans aucune ligne rattachée à un BC. Une DA validée doit être annulée par un autre responsable que son demandeur. La matière redevient proposable au réapprovisionnement.</DialogDescription></DialogHeader>
   <div className="space-y-2"><Label htmlFor="cancel-reason">Motif d'annulation (10 caractères minimum)</Label><Input id="cancel-reason" maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></div>
   <DialogFooter><Button variant="outline" onClick={()=>setCancelling(null)}>Annuler</Button><Button variant="destructive" disabled={reason.trim().length<10||cancel.isPending} onClick={()=>cancelling!==null&&cancel.mutate({id:cancelling,reason:reason.trim()},{onSuccess:()=>setCancelling(null)})}>Confirmer l'annulation</Button></DialogFooter>
  </DialogContent></Dialog>
 </div>
}
