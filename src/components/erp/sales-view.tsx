"use client"

import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Printer } from "lucide-react"
import { api } from "./hooks"
import { hasRole, type SessionActor } from "@/lib/role-navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { fmtMAD } from "@/lib/erp-types"
import { isValidPurchaseQuantity } from "@/lib/purchase-quantity"
import { LoadError } from "./bits"
import { ListSearch, useListSort } from "./list-controls"
import { ClientStatementPanel } from "./client-statement-panel"
import { ClientCreditLines } from "./client-credit-lines"

// Tous les montants fiscaux sont configurables. La valeur 0 n'est pas une
// déclaration d'exonération et doit être revue avant émission réelle.
// V18.9.10 (UX-015) : le formatage est centralisé dans fmtMAD ; cet
// adaptateur convertit uniquement les centimes de l'API vers l'unité MAD
// (centimes conservés — documents financiers).
const fmtMADCents=(c:number)=>fmtMAD(c/100,{cents:true})
type Person={id:number,name:string,city?:string}
type PageResponse<T>={items:T[];pagination:{total:number;skip:number;take:number;pages:number}}
function Pager({total,skip,take,onChange,label}:{total:number;skip:number;take:number;onChange:(page:number)=>void;label:string}){
  const page=Math.floor(skip/take)+1,pages=Math.max(1,Math.ceil(total/take))
  return <nav className="flex flex-wrap items-center justify-between gap-2 rounded border bg-slate-50 p-2 text-xs" aria-label={`Pagination ${label}`}>
    <span aria-live="polite">{total?`${skip+1}–${Math.min(total,skip+take)} sur ${total}`:`0 ${label}`} · page {page}/{pages}</span>
    <div className="flex gap-2"><Button size="sm" variant="outline" disabled={page<=1} onClick={()=>onChange(page-1)}>Précédent</Button>
      <Button size="sm" variant="outline" disabled={page>=pages} onClick={()=>onChange(page+1)}>Suivant</Button></div>
  </nav>
}

type Piece={id:number,code:string,partRef:string|null,linearMeters:number|null,label:string,status:string}
type SaleLine={id:number,qty:number,unit:string,unitPrice:number,product:{name:string,family?:string,materialId?:number|null},pieces:Piece[]}
type DeliveryLine={id:number,orderLineId:number,qty:number,unit:string,pieceIds:string,invoiceLine?:{id:number}|null,orderLine?:SaleLine}
type SalesOrder={id:number,ref:string,status:string,fulfillmentStatus?:string,client:Person,lines:SaleLine[],salesDeliveries:{id:number,ref:string,lines:DeliveryLine[]}[],salesInvoices:{id:number,ref:string,status:string}[]}
type Quote={id:number,ref:string,status:string,approvalLines?:{index:number;approved:boolean;required:boolean;label:string}[],priceReviewRequired?:boolean,approvalPlanValid?:boolean,priceApprovedBy?:string|null,client:Person,subtotalCents:number,acceptanceRef:string|null,order?:{id:number,ref:string,status:string}|null,createdAt:string,payload:string,productsSnapshotJson?:string|null,clientNameSnapshot?:string|null}
type Delivery={id:number,ref:string,order:{ref:string,client:Person},status:string,deliveredAt:string,lines:(DeliveryLine&{orderLine:SaleLine})[],clientNameSnapshot?:string|null}
type Invoice={id:number,ref:string,status:string,totalCents:number,subtotalCents:number,taxCents:number,taxRateBps:number,client:Person,clientNameSnapshot?:string|null,order:{ref:string},lines:{id:number,qty:number,unit:string,amountCents:number,productNameSnapshot?:string|null,deliveryLine:{orderLine:{product:{name:string}}}}[],payments:{id:number,amountCents:number,ref:string,method?:string}[],credits:{id:number,amountCents:number,ref:string,reason:string,status:string,actor:string,decisionActor?:string|null,decisionReason?:string|null}[],financeDetailsMasked?:boolean}
const QUOTE_STATUS: Record<string,string>={draft:"Brouillon",sent:"Envoyé",accepted:"Accepté",rejected:"Refusé",converted:"Converti en commande"}
const SALES_INVOICE_STATUS: Record<string,string>={issued:"Émise",partial:"Partiellement réglée ou créditée",paid:"Payée",settled:"Soldée"}
const rowClass="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3"
function ListSkeleton({label}:{label:string}){
  return <div className="space-y-2" role="status" aria-label={`Chargement : ${label}`}>{[0,1,2].map(i=><Skeleton key={i} className="h-20 rounded-lg"/>)}</div>
}

export function SalesView({mode,onNewQuote}:{mode:"quotes"|"deliveries"|"invoices",onNewQuote:()=>void}){
  const qc=useQueryClient()
  const [busy,setBusy]=useState(false)
  const [orderId,setOrderId]=useState("")
  const [pickedPieces,setPickedPieces]=useState<number[]>([])
  const [stockQuantities,setStockQuantities]=useState<Record<number,string>>({})
  const [reservationQuantities,setReservationQuantities]=useState<Record<number,string>>({})
  const [pickedDeliveries,setPickedDeliveries]=useState<number[]>([])
  const [taxBps,setTaxBps]=useState("")
  const [visible,setVisible]=useState<number|null>(null)
  const [salesDialog,setSalesDialog]=useState<null|{kind:"accept";quoteId:number}|{kind:"payment"|"credit";invoiceId:number;maxCents:number}>(null)
  const [dialogAmount,setDialogAmount]=useState("")
  const [dialogDetail,setDialogDetail]=useState("")
  const [paymentMethod,setPaymentMethod]=useState("")
  const [dialogError,setDialogError]=useState("")
  const [reason,setReason]=useState("")
  const [creditDecisionReasons,setCreditDecisionReasons]=useState<Record<number,string>>({})
  // V18.9.10 (UX-017) : le refus d'un devis demande une confirmation explicite
  // (dernière action destructive sans garde) — aucun seuil métier nouveau.
  const [confirmRejectQuote,setConfirmRejectQuote]=useState<Quote|null>(null)
  // P5.15.27 (AN-V184-01) : l'autorisation tarifaire d'un devis utilise un
  // dialog contrôlé et accessible (contrat v184 : jamais d'invite navigateur).
  const [quotePriceApproval,setQuotePriceApproval]=useState<{quote:Quote;lineIndex:number}|null>(null)
  const [quotePriceReason,setQuotePriceReason]=useState("")
  const [quotePricePassword,setQuotePricePassword]=useState("")
  const [quoteDuplicate,setQuoteDuplicate]=useState<null|{quoteId:number;token:string;matches:Array<{ref:string;status:string}>}>(null)
  const [quoteDuplicateReason,setQuoteDuplicateReason]=useState("")
  // V18.9.10 (UX-019) : recherche locale + tri sur les listes chargées.
  const [quoteSearch,setQuoteSearch]=useState("")
  const quoteSort=useListSort<"date"|"montant">("date")
  const [quotePage,setQuotePage]=useState(1)
  const [deliveryPage,setDeliveryPage]=useState(1)
  const [invoicePage,setInvoicePage]=useState(1)
  const [orderSearch,setOrderSearch]=useState("")
  const [orderPage,setOrderPage]=useState(1)
  const [selectedBlPage,setSelectedBlPage]=useState(1)
  const [deliverySearch,setDeliverySearch]=useState("")
  const deliverySort=useListSort<"date">("date")
  const [invoiceSearch,setInvoiceSearch]=useState("")
  const invoiceSort=useListSort<"montant"|"ref">("montant")
  const quotes=useQuery({queryKey:["sales-quotes",quotePage,quoteSearch,quoteSort.sort.key,quoteSort.sort.dir],queryFn:()=>api<PageResponse<Quote>&{productNames?:Record<number,string>;catalogPrices?:Record<number,number>}>(`/api/sales?${new URLSearchParams({type:"quotes",take:"50",skip:String((quotePage-1)*50),q:quoteSearch,sort:quoteSort.sort.key,dir:quoteSort.sort.dir})}`),enabled:mode==="quotes"})
  const orders=useQuery({queryKey:["sales-orders",orderPage,orderSearch],queryFn:()=>api<PageResponse<SalesOrder>>(`/api/sales?${new URLSearchParams({type:"orders",take:"50",skip:String((orderPage-1)*50),q:orderSearch})}`),enabled:mode!=="quotes"})
  const selectedOrder=useQuery({queryKey:["sales-order-selected",orderId],queryFn:()=>api<PageResponse<SalesOrder>>(`/api/sales?type=orders&orderId=${Number(orderId)}&take=1`),enabled:mode!=="quotes"&&Number(orderId)>0})
  const deliveries=useQuery({queryKey:["sales-deliveries",deliveryPage,deliverySearch,deliverySort.sort.dir],queryFn:()=>api<PageResponse<Delivery>>(`/api/sales?${new URLSearchParams({type:"deliveries",take:"50",skip:String((deliveryPage-1)*50),q:deliverySearch,dir:deliverySort.sort.dir})}`),enabled:mode==="deliveries"})
  const selectedOrderDeliveries=useQuery({queryKey:["sales-order-deliveries",orderId,selectedBlPage],queryFn:()=>api<PageResponse<Delivery>>(`/api/sales?${new URLSearchParams({type:"deliveries",orderId,skip:String((selectedBlPage-1)*100),take:"100"})}`),enabled:mode==="invoices"&&Number(orderId)>0})
  const actorQ=useQuery({queryKey:["me"],queryFn:()=>api<SessionActor>("/api/me"),enabled:mode==="invoices"||mode==="quotes"})
  const canFinance=hasRole(actorQ.data,"finance")
  const canDirector=hasRole(actorQ.data,"director")
  const canSales=hasRole(actorQ.data,"sales")
  const taxPolicy=useQuery({queryKey:["sales-tax-policy"],queryFn:()=>api<{configured:boolean,rates:number[],warning:string}>("/api/sales/tax-rates"),enabled:mode==="invoices"&&canFinance})
  const invoices=useQuery({queryKey:["sales-invoices",invoicePage,invoiceSearch,invoiceSort.sort.key,invoiceSort.sort.dir],queryFn:()=>api<PageResponse<Invoice>>(`/api/sales?${new URLSearchParams({type:"invoices",take:"50",skip:String((invoicePage-1)*50),q:invoiceSearch,sort:invoiceSort.sort.key,dir:invoiceSort.sort.dir})}`),enabled:mode==="invoices"})
  // Une décision peut réduire le nombre de pages entre deux rafraîchissements.
  useEffect(()=>{const max=quotes.data?.pagination.pages;if(max && quotePage>max)setQuotePage(max)},[quotes.data?.pagination.pages,quotePage])
  useEffect(()=>{const max=orders.data?.pagination.pages;if(max && orderPage>max)setOrderPage(max)},[orders.data?.pagination.pages,orderPage])
  useEffect(()=>{const max=deliveries.data?.pagination.pages;if(max && deliveryPage>max)setDeliveryPage(max)},[deliveries.data?.pagination.pages,deliveryPage])
  useEffect(()=>{const max=invoices.data?.pagination.pages;if(max && invoicePage>max)setInvoicePage(max)},[invoices.data?.pagination.pages,invoicePage])
  useEffect(()=>{const max=selectedOrderDeliveries.data?.pagination.pages;if(max && selectedBlPage>max)setSelectedBlPage(max)},[selectedOrderDeliveries.data?.pagination.pages,selectedBlPage])
  const order=selectedOrder.data?.items[0]??orders.data?.items.find(o=>o.id===Number(orderId))
  const reservationAlerts=useQuery({queryKey:["sales-reservation-alerts",orderId],queryFn:()=>api<{configured:boolean,items:{id:number,state:string,expiresAt:string|null}[]}>(`/api/sales/reservation-alerts?orderId=${Number(orderId)}`),enabled:mode==="deliveries"&&Number(orderId)>0})
  const availability=useQuery({queryKey:["sales-availability",orderId],queryFn:()=>api<{items:{orderLineId:number;remaining:number;unit:string;physicalStockQty:number;blockedStockQty:number;freeStockQty:number;reservedStockQty:number;lots:{lotCode:string;freeQty:number;reservedForOrderQty:number}[]}[]}>(`/api/sales?type=availability&orderId=${Number(orderId)}`),enabled:mode==="deliveries"&&Number(orderId)>0})
  const alreadyDelivered=useMemo(()=>new Set(order?.salesDeliveries.flatMap(d=>d.lines.flatMap(l=>JSON.parse(l.pieceIds) as number[]))??[]),[order])
  const remaining=useMemo(()=>order?.lines.flatMap(l=>l.pieces.filter(p=>!alreadyDelivered.has(p.id)).map(p=>({...p,orderLineId:l.id,unit:l.unit,quantity:l.unit==="ml"?(p.linearMeters??0):1,productName:l.product.name})))??[],[order,alreadyDelivered])
  const tradeRemaining=useMemo(()=>order?.lines.filter(l=>l.product.materialId!=null||(l.product.materialId==null&&l.unit==="u")).map(l=>({
    ...l,remaining:Math.max(0,Math.round((l.qty-(order.salesDeliveries.flatMap(d=>d.lines).filter(x=>x.orderLineId===l.id).reduce((a,row)=>a+row.qty,0)))*1000)/1000)
  })).filter(l=>l.remaining>1e-7)??[],[order])
  const stockLines=tradeRemaining.filter(l=>Number(stockQuantities[l.id]??0)>0).map(l=>({orderLineId:l.id,qty:Number((stockQuantities[l.id]??"").replace(",","."))}))
  const duplicateSourceSelection=stockLines.some(s=>remaining.some(piece=>piece.orderLineId===s.orderLineId&&pickedPieces.includes(piece.id)))
  const stockSelectionValid=stockLines.every(l=>{
    const line=tradeRemaining.find(x=>x.id===l.orderLineId)!
    return isValidPurchaseQuantity(l.qty,line.unit)&&l.qty<=line.remaining+1e-7
  })
  const eligibleDeliveries=useMemo(()=>selectedOrderDeliveries.data?.items.filter(d=>d.order.ref===order?.ref&&d.lines.length>0&&d.lines.every(l=>!l.invoiceLine))??[],[selectedOrderDeliveries.data,order])
  const selectionTotal=useMemo(()=>remaining.filter(p=>pickedPieces.includes(p.id)).reduce((s,p)=>s+p.quantity,0),[remaining,pickedPieces])
  // R7 : le filtrage et le tri sont désormais assurés par SQL sur l'ensemble du catalogue.
  const filteredQuotes=quotes.data?.items??[]
  const filteredDeliveries=deliveries.data?.items??[]
  const filteredInvoices=invoices.data?.items??[]
  const refresh=()=>{for(const x of ["sales-quotes","sales-orders","sales-deliveries","sales-invoices","orders","dashboard","sales-availability","sales-reservation-alerts","sales-order-selected","sales-order-deliveries"])qc.invalidateQueries({queryKey:[x]})}
  async function act(payload:Record<string,unknown>){
    setBusy(true)
    try{
      const data=await api<Record<string,unknown>>("/api/sales",{method:"POST",body:JSON.stringify(payload)})
      toast.success("Opération commerciale enregistrée et tracée")
      if(payload.action==="convert") {setQuoteDuplicate(null);setQuoteDuplicateReason("")}
      refresh();setPickedPieces([]);setStockQuantities({});setPickedDeliveries([])
      return data
    }catch(e){
      const problem=(e as Error & {body?:{code?:string;token?:string;matches?:Array<{ref:string;status:string}>}}).body
      if(payload.action==="convert"&&problem?.code==="DUPLICATE_ORDER_POTENTIAL"&&problem.token){
        setQuoteDuplicate({quoteId:Number(payload.id),token:problem.token,matches:problem.matches??[]})
        setQuoteDuplicateReason("")
      }
      toast.error(e instanceof Error?e.message:"Opération refusée");return null
    }
    finally{setBusy(false)}
  }
  const selectOrder=(id:string)=>{setOrderId(id);setSelectedBlPage(1);setPickedPieces([]);setStockQuantities({});setReservationQuantities({});setPickedDeliveries([])}
  const openSalesDialog=(next:NonNullable<typeof salesDialog>)=>{setDialogAmount("");setDialogDetail("");setDialogError("");setPaymentMethod("");setSalesDialog(next)}
  async function submitSalesDialog(){
    if(!salesDialog||busy)return
    let payload:Record<string,unknown>
    const note=dialogDetail.trim()
    if(salesDialog.kind==="accept"){
      if(note.length<3||note.length>180){setDialogError("Référence d’acceptation : 3 à 180 caractères obligatoires.");return}
      payload={action:"quote-state",id:salesDialog.quoteId,state:"accepted",acceptanceRef:note}
    }else{
      const normalized=dialogAmount.trim().replace(",",".")
      if(!/^\d+(?:\.\d{1,2})?$/.test(normalized)){setDialogError("Saisir un montant positif avec deux décimales au maximum.");return}
      const [whole,decimal=""]=normalized.split(".")
      const amountCents=Number(whole)*100+Number(decimal.padEnd(2,"0"))
      if(!Number.isSafeInteger(amountCents)||amountCents<=0||amountCents>salesDialog.maxCents){setDialogError("Montant supérieur au solde ou invalide.");return}
      if(salesDialog.kind==="payment"){
        if(!["virement","especes","cheque","carte","autre"].includes(paymentMethod)){setDialogError("Choisir le mode de règlement réel.");return}
        if(note.length<3||note.length>120){setDialogError("Référence du règlement : 3 à 120 caractères (reçu, chèque, TPE ou virement).");return}
        payload={action:"payment",invoiceId:salesDialog.invoiceId,amountCents,reference:note,method:paymentMethod}
      }else{
        if(note.length<5||note.length>500){setDialogError("Motif de l’avoir : 5 à 500 caractères.");return}
        payload={action:"credit",invoiceId:salesDialog.invoiceId,amountCents,reason:note}
      }
    }
    if(await act(payload))setSalesDialog(null)
  }
  const salesDialogUI=<Dialog open={salesDialog!==null} onOpenChange={open=>{if(!open&&!busy)setSalesDialog(null)}}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{salesDialog?.kind==="accept"?"Confirmer l’acceptation du devis":salesDialog?.kind==="payment"?"Enregistrer un règlement":"Préparer un avoir client"}</DialogTitle>
        <DialogDescription>{salesDialog?.kind==="accept"?"Indiquez la preuve écrite d’acceptation (PO, courriel, date et signature).":`Solde maximal autorisé : ${salesDialog?fmtMADCents(salesDialog.maxCents):"—"}. Le montant sera contrôlé une nouvelle fois par le serveur.`}</DialogDescription>
      </DialogHeader>
      {salesDialog?.kind==="payment"&&<div className="space-y-1"><label htmlFor="sales-payment-method" className="text-sm font-medium">Mode de règlement réel *</label>
        {/* V18.9.10 (UX-005) : Select du design system */}
        <Select value={paymentMethod} onValueChange={v=>{setPaymentMethod(v);setDialogError("")}}>
          <SelectTrigger id="sales-payment-method" className="w-full"><SelectValue placeholder="Choisir le mode"/></SelectTrigger>
          <SelectContent>
            <SelectItem value="virement">Virement</SelectItem>
            <SelectItem value="especes">Espèces</SelectItem>
            <SelectItem value="cheque">Chèque</SelectItem>
            <SelectItem value="carte">Carte bancaire / TPE</SelectItem>
            <SelectItem value="autre">Autre</SelectItem>
          </SelectContent>
        </Select></div>}
      {salesDialog&&salesDialog.kind!=="accept"&&<div className="space-y-1"><label htmlFor="sales-dialog-amount" className="text-sm font-medium">Montant en MAD</label><Input id="sales-dialog-amount" inputMode="decimal" placeholder="Ex. 125,50" value={dialogAmount} onChange={e=>{setDialogAmount(e.target.value);setDialogError("")}}/></div>}
      <div className="space-y-1"><label htmlFor="sales-dialog-detail" className="text-sm font-medium">{salesDialog?.kind==="accept"?"Référence d’acceptation":salesDialog?.kind==="payment"?"Référence unique du règlement":"Motif détaillé de l’avoir"}</label><Input id="sales-dialog-detail" value={dialogDetail} maxLength={salesDialog?.kind==="accept"?180:salesDialog?.kind==="payment"?120:500} onChange={e=>{setDialogDetail(e.target.value);setDialogError("")}}/></div>
      {dialogError&&<p className="text-sm text-rose-700" role="alert">{dialogError}</p>}
      <DialogFooter><Button variant="outline" disabled={busy} onClick={()=>setSalesDialog(null)}>Annuler</Button><Button variant="primary" disabled={busy} onClick={()=>void submitSalesDialog()}>Confirmer</Button></DialogFooter>
    </DialogContent>
  </Dialog>
  // V18.9.10 (UX-017) : confirmation avant refus d'un devis (action définitive).
  const rejectQuoteDialog=<Dialog open={confirmRejectQuote!==null} onOpenChange={open=>{if(!open&&!busy)setConfirmRejectQuote(null)}}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Refuser le devis {confirmRejectQuote?.ref} ?</DialogTitle>
        <DialogDescription>Le devis passera au statut « Refusé » et ne pourra plus être accepté ni converti en commande. La décision est enregistrée avec votre compte.</DialogDescription>
      </DialogHeader>
      <DialogFooter><Button variant="outline" disabled={busy} onClick={()=>setConfirmRejectQuote(null)}>Annuler</Button><Button variant="destructive" disabled={busy} onClick={async()=>{if(!confirmRejectQuote)return;if(await act({action:"quote-state",id:confirmRejectQuote.id,state:"rejected"}))setConfirmRejectQuote(null)}}>Confirmer le refus</Button></DialogFooter>
    </DialogContent>
  </Dialog>
  // P5.15.27 (AN-V184-01) : dialog contrôlé pour l'autorisation tarifaire
  // d'un devis — remplace l'invite native du navigateur (contrat v184).
  const quotePriceDialog=<Dialog open={quotePriceApproval!==null} onOpenChange={open=>{if(!open&&!busy){setQuotePriceApproval(null);setQuotePricePassword("")}}}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Autoriser le prix de la ligne {(quotePriceApproval?.lineIndex??0)+1} — {quotePriceApproval?.quote.ref} ?</DialogTitle>
        <DialogDescription>Un visa nominatif pour une seule ligne et sa configuration exacte. Les autres lignes doivent être autorisées séparément.</DialogDescription>
      </DialogHeader>
      <div className="space-y-1">
        <label htmlFor="quote-price-reason" className="text-sm font-medium">Motif d'autorisation tarifaire (8 caractères minimum)</label>
        <Input id="quote-price-reason" maxLength={500} value={quotePriceReason} onChange={e=>setQuotePriceReason(e.target.value)} placeholder="Ex. Remise accordée pour commande ferme de 20 matelas"/>
        {quotePriceReason.trim().length>0&&quotePriceReason.trim().length<8&&<p className="text-sm text-rose-700" role="alert">Le motif doit contenir au moins 8 caractères.</p>}
      </div>
      <div className="space-y-1">
        <label htmlFor="quote-price-password" className="text-sm font-medium">Mot de passe personnel du directeur</label>
        <Input id="quote-price-password" type="password" autoComplete="current-password" value={quotePricePassword} onChange={e=>setQuotePricePassword(e.target.value)}/>
      </div>
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={()=>{setQuotePriceApproval(null);setQuotePricePassword("")}}>Annuler</Button>
        <Button variant="primary" disabled={busy||!quotePricePassword||quotePriceReason.trim().length<8} onClick={async()=>{if(!quotePriceApproval)return;const ok=await act({action:"approve-quote-prices",id:quotePriceApproval.quote.id,lineIndex:quotePriceApproval.lineIndex,reason:quotePriceReason.trim(),sensitivePassword:quotePricePassword});setQuotePricePassword("");if(ok)setQuotePriceApproval(null)}}>Autoriser le tarif</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
  if(mode==="quotes")return <div className="space-y-4">
    {salesDialogUI}{rejectQuoteDialog}{quotePriceDialog}
    <div className={rowClass}><div><strong>Devis → acceptation → commande</strong><p className="text-xs text-slate-500">Même éditeur de pièces et gabarits que la commande · montant MAD figé à l'acceptation</p></div>{canSales&&<Button variant="primary" onClick={onNewQuote}>Créer un devis</Button>}</div>
    {/* V18.9.10 (UX-019) : recherche + tri locaux sur les devis chargés. */}
    <ListSearch global value={quoteSearch} onChange={v=>{setQuoteSearch(v);setQuotePage(1)}} placeholder="Rechercher tous les devis (réf., client, statut)…" shown={filteredQuotes.length} total={quotes.data?.pagination.total??0} unit="devis"/>
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label htmlFor="quote-sort" className="text-xs font-medium text-slate-600">Trier par</label>
      <Select value={quoteSort.sort.key} onValueChange={v=>{quoteSort.setSort({key:v as "date"|"montant",dir:"desc"});setQuotePage(1)}}>
        <SelectTrigger id="quote-sort" className="h-8 w-44"><SelectValue/></SelectTrigger>
        <SelectContent>
          <SelectItem value="date">Date (plus récent)</SelectItem>
          <SelectItem value="montant">Montant</SelectItem>
        </SelectContent>
      </Select>
      <Button variant="ghost" size="sm" onClick={()=>{quoteSort.setSort(s=>({...s,dir:s.dir==="asc"?"desc":"asc"}));setQuotePage(1)}} aria-label={quoteSort.sort.dir==="asc"?"Inverser : tri décroissant":"Inverser : tri croissant"}>
        {quoteSort.sort.dir==="asc"?"Croissant ↓":"Décroissant ↑"}
      </Button>
    </div>
    {quotes.data&&<Pager total={quotes.data.pagination.total} skip={quotes.data.pagination.skip} take={quotes.data.pagination.take} onChange={setQuotePage} label="devis"/>}
    {quotes.isLoading&&<ListSkeleton label="devis"/>}
    {quotes.isError&&<LoadError message="Erreur de chargement des devis." onRetry={()=>void quotes.refetch()}/>}
    {quoteDuplicate&&<div role="alert" className="space-y-2 rounded border border-amber-400 bg-amber-50 p-3 text-sm">
      <strong>Devis accepté — commande similaire déjà existante</strong>
      <p>Une nouvelle commande sera distincte des commandes suivantes :</p>
      <ul className="list-disc pl-5">{quoteDuplicate.matches.map(x=><li key={x.ref}>{x.ref} — {x.status}</li>)}</ul>
      <label htmlFor="quote-duplicate-reason" className="block font-medium">Motif de nouvelle commande</label>
      <Input id="quote-duplicate-reason" value={quoteDuplicateReason} onChange={e=>setQuoteDuplicateReason(e.target.value)} maxLength={300} placeholder="Nouvelle demande client distincte (12 caractères minimum)"/>
      <div className="flex gap-2"><Button size="sm" disabled={busy||quoteDuplicateReason.trim().length<12} onClick={()=>void act({action:"convert",id:quoteDuplicate.quoteId,duplicateReview:{token:quoteDuplicate.token,reason:quoteDuplicateReason.trim()}})}>Confirmer avec justification</Button><Button size="sm" variant="outline" onClick={()=>setQuoteDuplicate(null)}>Annuler</Button></div>
    </div>}
    {filteredQuotes.map(q=><div key={q.id} className="rounded-lg border bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><strong>{q.ref}</strong> · {q.clientNameSnapshot??q.client.name}<p className="text-xs text-slate-500">{new Date(q.createdAt).toLocaleDateString("fr-FR")} · {QUOTE_STATUS[q.status] ?? q.status} {q.order?`· converti : ${q.order.ref}`:""}</p></div><strong>{fmtMADCents(q.subtotalCents)}</strong></div>
      <div className="mt-3 flex flex-wrap gap-2">
        {q.approvalPlanValid===false&&<p role="alert" className="text-sm font-semibold text-rose-700">Plan de validation du devis manquant ou incohérent : émission bloquée. Recréer le devis après contrôle.</p>}
        {q.approvalLines?.some(l=>l.required&&!l.approved)&&<span className="text-xs font-semibold text-amber-800" role="status">Prix à autoriser : {q.approvalLines.filter(l=>l.required&&!l.approved).length} ligne(s)</span>}
        {q.status==="draft"&&q.approvalLines?.some(l=>l.required)&&<div className="w-full space-y-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs">
          <strong>Visas tarifaires individuels (directeur distinct du commercial) :</strong>
          {q.approvalLines.filter(l=>l.required).map(l=><div key={l.index} className="flex flex-wrap items-center justify-between gap-2 rounded bg-white p-2">
            <span>Ligne {l.index+1} · {l.label} · {l.approved?"Autorisée":"En attente"}</span>
            {!l.approved&&canDirector&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>{setQuotePriceReason("");setQuotePriceApproval({quote:q,lineIndex:l.index})}}>Autoriser cette ligne</Button>}
          </div>)}
        </div>}
        {q.status==="draft"&&canSales&&<Button size="sm" variant="outline" disabled={busy||q.approvalPlanValid===false||Boolean(q.approvalLines?.some(l=>l.required&&!l.approved))} onClick={()=>act({action:"quote-state",id:q.id,state:"sent"})}>Marquer envoyé</Button>}
        {/* V18.9.10 (UX-017) : refus confirmé ; (UX-031) impression en Button outline. */}
        {q.status==="sent"&&canSales&&<><Button size="sm" variant="primary" disabled={busy} onClick={()=>openSalesDialog({kind:"accept",quoteId:q.id})}>Accepté par le client</Button><Button size="sm" variant="outline" disabled={busy} onClick={()=>setConfirmRejectQuote(q)}>Refusé</Button></>}
        {q.status==="accepted"&&canSales&&<Button size="sm" disabled={busy} onClick={()=>act({action:"convert",id:q.id})}>Transformer en commande (suivi atelier simplifié)</Button>}
        <Button size="sm" variant="outline" asChild><a href={`/api/sales/print?type=quote&id=${q.id}`} target="_blank" rel="noreferrer"><Printer className="size-4"/>Imprimer le devis</a></Button>
        <Button size="sm" variant="outline" onClick={()=>setVisible(visible===q.id?null:q.id)}>Voir les articles</Button>
      </div>
      {visible===q.id&&<div className="mt-3 rounded bg-slate-50 p-3 text-sm">{(JSON.parse(q.payload) as {lines:{productId:number,qty:number,unitPrice:number,parts?:{partRef?:string}[]}[]}).lines.map((l,i)=><p key={i}>{(()=>{try{return (JSON.parse(q.productsSnapshotJson??"[]") as {name?:string}[])[i]?.name??quotes.data?.productNames?.[l.productId]??`Produit #${l.productId}`}catch{return quotes.data?.productNames?.[l.productId]??`Produit #${l.productId}`}})()} · {l.qty} × {l.unitPrice.toLocaleString("fr-FR")} MAD · {l.parts?.length??0} type(s) de pièce</p>)}<p className="mt-2 text-xs">Acceptation : {q.acceptanceRef||"non enregistrée"}</p></div>}
    </div>)}
    {!quotes.isLoading&&!quotes.isError&&!quoteSearch&&!quotes.data?.pagination.total&&<p className="rounded-lg border border-dashed p-6 text-center text-slate-500">Aucun devis. Créez-en un à partir du catalogue produits et des gabarits.</p>}
    {!quotes.isLoading&&!quotes.isError&&quoteSearch&&!quotes.data?.pagination.total&&<p className="rounded-lg border border-dashed p-6 text-center text-slate-500">Aucun devis ne correspond à « {quoteSearch} ».</p>}
  </div>
  if(mode==="deliveries")return <div className="space-y-4">
    <section className="space-y-3 rounded-lg border bg-white p-4"><h2 className="font-semibold">Créer un bon de livraison client</h2>
      <p className="text-sm text-slate-500">Pièces fabriquées : sélectionner leurs étiquettes. Négoce ou matelas déjà en stock : saisir une quantité à prélever. Un BL peut contenir plusieurs sources.</p>
      <ListSearch global value={orderSearch} onChange={v=>{setOrderSearch(v);setOrderPage(1)}} placeholder="Rechercher une commande à livrer (réf., client)…" shown={orders.data?.items.length??0} total={orders.data?.pagination.total??0} unit="commandes"/>
      {orders.data&&<Pager total={orders.data.pagination.total} skip={orders.data.pagination.skip} take={orders.data.pagination.take} onChange={setOrderPage} label="commandes"/>}
      {orders.isError&&<LoadError message="Commandes indisponibles." onRetry={()=>void orders.refetch()}/>}
      {orders.isLoading&&<ListSkeleton label="commandes"/>}
      {/* V18.9.10 (UX-005) : Select du design system */}
      <Select value={orderId} onValueChange={selectOrder}>
        <SelectTrigger aria-label="Commande à livrer" className="w-full"><SelectValue placeholder="Choisir une commande validée"/></SelectTrigger>
        <SelectContent>
          {(order?[order]:[]).concat((orders.data?.items??[]).filter(o=>o.id!==order?.id)).filter(o=>["new","production","ready","shipped"].includes(o.status)&&o.fulfillmentStatus!=="closed"&&o.fulfillmentStatus!=="on_hold").map(o=><SelectItem key={o.id} value={String(o.id)}>{o.ref} — {o.client.name}</SelectItem>)}
        </SelectContent>
      </Select>
      {order&&<div className="max-h-72 space-y-2 overflow-y-auto">{remaining.length?remaining.map(p=><label key={p.id} className="flex cursor-pointer items-center gap-3 rounded border p-2 text-sm"><input type="checkbox" className="size-6 accent-emerald-700" checked={pickedPieces.includes(p.id)} onChange={e=>setPickedPieces(old=>e.target.checked?[...old,p.id]:old.filter(x=>x!==p.id))}/><span className="flex-1">{p.partRef||p.code} — {p.productName}</span><span className="font-medium">{p.quantity} {p.unit}</span></label>):<p className="text-sm text-slate-500">Toutes les pièces sont déjà livrées.</p>}</div>}
      {reservationAlerts.data?.items.some(r=>r.state==="expiring-soon"||r.state==="expired")&&<p role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">Réservation à échéance proche ou dépassée : avertir le responsable commercial avant sa libération planifiée ({reservationAlerts.data.items.filter(r=>r.state==="expiring-soon"||r.state==="expired").length} ligne(s)).</p>}
      {tradeRemaining.length>0&&<div className="space-y-2 rounded-md border border-emerald-200 p-3">
        <h3 className="text-sm font-semibold">Stock — articles achetés et matelas finis (prélèvement des lots au BL)</h3>
        {tradeRemaining.map(l=><div key={l.id} className="space-y-2 border-b border-slate-100 pb-2"><label className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="flex-1">{l.product.name} — reste à livrer : <strong>{l.remaining} {l.unit}</strong></span>
          <Input className="w-32" type="number" min="0" step="any" aria-label={`Quantité à livrer ${l.product.name}`}
            value={stockQuantities[l.id]??""} placeholder="Quantité"
            onChange={e=>setStockQuantities(v=>({...v,[l.id]:e.target.value}))}/>
        </label>
          {(()=>{const available=availability.data?.items.find(a=>a.orderLineId===l.id);return <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            {available&&<span>Stock physique : {available.physicalStockQty} · bloqué/expiré : {available.blockedStockQty} · libre : {available.freeStockQty} · réservé pour cette ligne : {available.reservedStockQty} (unité de stock)</span>}
            {l.product.materialId!=null&&<Input className="w-24" type="number" min="0" step="any" aria-label={`Quantité à réserver ${l.product.name}`} value={reservationQuantities[l.id]??""} placeholder="Réserver" onChange={e=>setReservationQuantities(v=>({...v,[l.id]:e.target.value}))}/>}
            {l.product.materialId!=null&&<Button size="sm" variant="outline" disabled={busy||!Number.isFinite(Number(reservationQuantities[l.id]))||Number(reservationQuantities[l.id])<=0} onClick={()=>act({action:"reserve-stock",orderId:order!.id,orderLineId:l.id,qty:Number(reservationQuantities[l.id])})}>Réserver</Button>}
            {l.product.materialId!=null&&<Button size="sm" variant="outline" disabled={busy||!(available?.reservedStockQty)} onClick={()=>act({action:"release-stock",orderId:order!.id,orderLineId:l.id})}>Libérer</Button>}
          </div>})()}
        </div>)}
        <p className="text-xs text-slate-600">GoCmd prélève les lots disponibles FEFO dans une transaction. Pour un matelas, choisir les pièces fabriquées OU le stock fini, jamais les deux sur la même ligne. Un stock insuffisant annule tout le BL.</p>
      </div>}
      <Input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Note transport / réception client (facultative)" aria-label="Note transport / réception client (facultative)"/>
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm">{pickedPieces.length} pièce(s) · métrage/quantité cumulée {selectionTotal.toLocaleString("fr-FR")}</p><Button variant="primary" disabled={busy||!order||!["ready","shipped"].includes(order.status)||(!pickedPieces.length&&!stockLines.length)||!stockSelectionValid||duplicateSourceSelection} onClick={()=>act({action:"delivery",orderId:order!.id,pieceIds:pickedPieces,stockLines,note:reason,requestKey:crypto.randomUUID()})}>Valider le BL</Button></div>
    </section>
    <ListSearch global value={deliverySearch} onChange={v=>{setDeliverySearch(v);setDeliveryPage(1)}} placeholder="Rechercher tous les BL (réf., commande, client)…" shown={filteredDeliveries.length} total={deliveries.data?.pagination.total??0} unit="BL"/>
    {deliveries.data&&<Pager total={deliveries.data.pagination.total} skip={deliveries.data.pagination.skip} take={deliveries.data.pagination.take} onChange={setDeliveryPage} label="BL"/>}
    {deliveries.isLoading&&<ListSkeleton label="bons de livraison"/>}
    {deliveries.isError&&<LoadError message="Bons de livraison indisponibles." onRetry={()=>void deliveries.refetch()}/>}
    <h2 className="font-semibold">Bons de livraison émis</h2>
    {filteredDeliveries.map(d=><div className={rowClass} key={d.id}><div><strong>{d.ref}</strong> · {d.clientNameSnapshot??d.order.client.name}<p className="text-xs text-slate-500">Commande {d.order.ref} · {new Date(d.deliveredAt).toLocaleDateString("fr-FR")}</p></div><Button size="sm" variant="outline" asChild><a href={`/api/sales/print?type=delivery&id=${d.id}`} target="_blank" rel="noreferrer"><Printer className="size-4"/>Imprimer le BL</a></Button><p className="text-sm">{d.lines.reduce((a,l)=>a+JSON.parse(l.pieceIds).length,0)} pièce(s) identifiée(s) · {d.lines.map(l=>`${l.qty} ${l.unit}`).join(" / ")}</p></div>)}
    {!deliveries.isLoading&&!deliveries.isError&&deliverySearch&&!deliveries.data?.pagination.total&&<p className="rounded-lg border border-dashed p-6 text-center text-slate-500">Aucun BL ne correspond à « {deliverySearch} ».</p>}
  </div>
  const taxValid=/^(\d+)([.,]\d{1,2})?$/.test(taxBps.trim())&&(taxPolicy.data?.rates??[]).includes(Math.round(Number(taxBps.replace(",","."))*100))
  return <div className="space-y-4">
    {salesDialogUI}
    {orders.isError&&<LoadError message="Commandes indisponibles." onRetry={()=>void orders.refetch()}/>}
    {orders.isLoading&&<ListSkeleton label="commandes"/>}
    {invoices.isError&&<LoadError message={`Factures indisponibles : ${invoices.error instanceof Error?invoices.error.message:"erreur réseau"}.`} onRetry={()=>void invoices.refetch()}/>}
    {canFinance&&<ClientStatementPanel/>}
    {canFinance&&<section className="space-y-3 rounded-lg border bg-white p-4"><h2 className="font-semibold">Créer une facture à partir de BL non facturés</h2>
      <ListSearch global value={orderSearch} onChange={v=>{setOrderSearch(v);setOrderPage(1)}} placeholder="Rechercher une commande à facturer (réf., client)…" shown={orders.data?.items.length??0} total={orders.data?.pagination.total??0} unit="commandes"/>
      {orders.data&&<Pager total={orders.data.pagination.total} skip={orders.data.pagination.skip} take={orders.data.pagination.take} onChange={setOrderPage} label="commandes"/>}
      <Select value={orderId} onValueChange={selectOrder}>
        <SelectTrigger aria-label="Commande à facturer" className="w-full"><SelectValue placeholder="Choisir une commande"/></SelectTrigger>
        <SelectContent>
          {(order?[order]:[]).concat((orders.data?.items??[]).filter(o=>o.id!==order?.id)).map(o=><SelectItem key={o.id} value={String(o.id)}>{o.ref} — {o.client.name}</SelectItem>)}
        </SelectContent>
      </Select>
      {order&&selectedOrderDeliveries.data&&<Pager total={selectedOrderDeliveries.data.pagination.total} skip={selectedOrderDeliveries.data.pagination.skip} take={selectedOrderDeliveries.data.pagination.take} onChange={setSelectedBlPage} label="BL de cette commande"/>}
      {order&&<div className="space-y-2">{eligibleDeliveries.length?eligibleDeliveries.map(d=><label key={d.id} className="flex cursor-pointer items-center gap-3 rounded border p-2 text-sm"><input type="checkbox" className="size-6 accent-emerald-700" checked={pickedDeliveries.includes(d.id)} onChange={e=>setPickedDeliveries(old=>e.target.checked?[...old,d.id]:old.filter(x=>x!==d.id))}/>{d.ref} · {d.lines.map(l=>`${l.qty} ${l.unit}`).join(" / ")}</label>):<p className="text-sm text-slate-500">Aucun BL non facturé pour cette commande.</p>}</div>}
      <label className="block max-w-xs text-sm" htmlFor="sales-tax">TVA / taxe applicable (%) — choisir un taux autorisé après validation comptable<Select value={taxBps} onValueChange={setTaxBps}><SelectTrigger id="sales-tax" aria-label="Taux de TVA pour la facture"><SelectValue placeholder="Sélectionner le taux"/></SelectTrigger><SelectContent>{(taxPolicy.data?.rates??[]).map(bps=><SelectItem key={bps} value={String(bps/100)}>{(bps/100).toLocaleString("fr-FR")} %</SelectItem>)}</SelectContent></Select></label>
      {taxPolicy.data&&!taxPolicy.data.configured&&<p role="alert" className="text-sm text-amber-700">Aucun taux validé configuré : émission des factures bloquée. Renseigner GOCMD_SALES_TAX_RATES_BPS après contrôle comptable.</p>}
      <div className="space-y-1.5">
        <Button variant="primary" disabled={busy||!order||!pickedDeliveries.length||!taxValid} onClick={()=>act({action:"invoice",orderId:order!.id,deliveryIds:pickedDeliveries,taxRateBps:Math.round(Number(taxBps.replace(",","."))*100)})}>Émettre la facture client</Button>
        {/* V18.9.10 (UX-023) : la raison du blocage est affichée en contexte. */}
        {(!order||!pickedDeliveries.length||!taxValid)&&<p className="text-xs text-slate-500" role="note">
          {!order?"Sélectionnez une commande.":!pickedDeliveries.length?"Cochez au moins un BL non facturé.":!taxValid?"Choisissez un taux figurant dans la configuration validée par la comptabilité.":""}
        </p>}
      </div>
    </section>}
    {!canFinance&&<p className="rounded border bg-slate-50 p-3 text-sm">Consultation des factures uniquement. Les règlements, avoirs et émissions de factures sont réservés au service finances.</p>}
    <div className="flex flex-wrap items-end justify-between gap-3">
      <h2 className="font-semibold">Factures, avoirs et règlements</h2>
    </div>
    <ListSearch global value={invoiceSearch} onChange={v=>{setInvoiceSearch(v);setInvoicePage(1)}} placeholder="Rechercher toutes les factures (réf., client, commande)…" shown={filteredInvoices.length} total={invoices.data?.pagination.total??0} unit="factures"/>
    {invoices.data&&<Pager total={invoices.data.pagination.total} skip={invoices.data.pagination.skip} take={invoices.data.pagination.take} onChange={setInvoicePage} label="factures"/>}
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label htmlFor="invoice-sort" className="text-xs font-medium text-slate-600">Trier par</label>
      <Select value={invoiceSort.sort.key} onValueChange={v=>{invoiceSort.setSort({key:v as "montant"|"ref",dir:"desc"});setInvoicePage(1)}}>
        <SelectTrigger id="invoice-sort" className="h-8 w-44"><SelectValue/></SelectTrigger>
        <SelectContent>
          <SelectItem value="montant">Montant</SelectItem>
          <SelectItem value="ref">Référence</SelectItem>
        </SelectContent>
      </Select>
      <Button variant="ghost" size="sm" onClick={()=>{invoiceSort.setSort(s=>({...s,dir:s.dir==="asc"?"desc":"asc"}));setInvoicePage(1)}} aria-label={invoiceSort.sort.dir==="asc"?"Inverser : tri décroissant":"Inverser : tri croissant"}>
        {invoiceSort.sort.dir==="asc"?"Croissant ↓":"Décroissant ↑"}
      </Button>
    </div>
    {invoices.isLoading&&<ListSkeleton label="factures"/>}
    {!invoices.isError&&!invoiceSearch&&!invoices.data?.pagination.total&&!invoices.isLoading&&<p className="text-slate-500">Aucune facture client enregistrée.</p>}
    {filteredInvoices.map(inv=>{
      const outstanding=inv.totalCents-inv.payments.reduce((a,p)=>a+p.amountCents,0)-inv.credits.filter(c=>c.status==="approved").reduce((a,p)=>a+p.amountCents,0)
      const pending=inv.credits.filter(c=>c.status==="draft")
      const available=Math.max(0,outstanding-pending.reduce((a,c)=>a+c.amountCents,0))
      return <section className="rounded-lg border bg-white p-4" key={inv.id}>
        <div className="flex flex-wrap items-center justify-between gap-3"><div><strong>{inv.ref}</strong> — {inv.clientNameSnapshot??inv.client.name}<p className="text-xs text-slate-500">Commande {inv.order.ref} · {SALES_INVOICE_STATUS[inv.status] ?? inv.status} · taxe {inv.taxRateBps/100}%</p></div><div className="text-right"><strong>{fmtMADCents(inv.totalCents)}</strong>{inv.financeDetailsMasked?<p className="text-sm text-slate-500">Règlements et avoirs : service finance</p>:<p className="text-sm text-slate-500">Solde {fmtMADCents(outstanding)}</p>}</div></div>
        <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" asChild><a href={`/api/sales/print?type=invoice&id=${inv.id}`} target="_blank" rel="noreferrer"><Printer className="size-4"/>Imprimer la facture</a></Button><Button size="sm" variant="outline" onClick={()=>setVisible(visible===inv.id?null:inv.id)}>Détails</Button>
          {canFinance&&available>0&&<><Button size="sm" disabled={busy} onClick={()=>openSalesDialog({kind:"payment",invoiceId:inv.id,maxCents:available})}>Enregistrer un paiement</Button>
          </>}
        </div>
        {canFinance&&pending.length>0&&<div className="mt-3 space-y-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm"><p className="font-medium">Avoirs en attente de validation indépendante ({pending.length}) — {fmtMADCents(pending.reduce((a,c)=>a+c.amountCents,0))} réservé</p>{pending.map(c=><div key={c.id} className="flex flex-wrap items-center gap-2"><span>{c.ref} · {fmtMADCents(c.amountCents)} · préparé par {c.actor}</span>{c.actor!==actorQ.data?.username&&<Button size="sm" disabled={busy||!actorQ.data?.username} onClick={()=>act({action:"approve-credit",creditId:c.id})}>Approuver</Button>}<Input aria-label={`Motif décision ${c.ref}`} className="w-56" placeholder="Motif (10 caractères min.)" value={creditDecisionReasons[c.id]??""} onChange={e=>setCreditDecisionReasons(old=>({...old,[c.id]:e.target.value}))}/><Button size="sm" variant="outline" disabled={busy||(creditDecisionReasons[c.id]??"").trim().length<10} onClick={()=>act({action:c.actor===actorQ.data?.username?"cancel-credit":"reject-credit",creditId:c.id,reason:creditDecisionReasons[c.id]})}>{c.actor===actorQ.data?.username?"Annuler mon brouillon":"Refuser"}</Button></div>)}</div>}
        {visible===inv.id&&canFinance&&available>0&&<ClientCreditLines invoiceId={inv.id} lines={inv.lines} onComplete={refresh}/>}
        {visible===inv.id&&<div className="mt-3 space-y-1 rounded bg-slate-50 p-3 text-sm">{inv.lines.map(l=><p key={l.id}>{l.productNameSnapshot??l.deliveryLine.orderLine.product.name} · {l.qty} {l.unit} : {fmtMADCents(l.amountCents)}</p>)}<p>Sous-total : {fmtMADCents(inv.subtotalCents)} · Taxe : {fmtMADCents(inv.taxCents)}</p>{inv.financeDetailsMasked?<p className="text-slate-500">Détail des règlements et avoirs : accès réservé au service finance.</p>:<>{inv.payments.map(p=><p key={p.id}>Règlement {p.ref} ({p.method??"mode non renseigné"}) : {fmtMADCents(p.amountCents)}</p>)}{inv.credits.map(c=><p key={c.id}>Avoir {c.ref} : {fmtMADCents(c.amountCents)} — {c.status==="draft"?"En attente":c.status==="approved"?"Approuvé":c.status==="cancelled"?"Annulé":"Rejeté"} — {c.reason} {c.decisionActor?`· décision : ${c.decisionActor}`:""} {c.decisionReason?`· motif : ${c.decisionReason}`:""}</p>)}</>}<p className="pt-2 text-xs">Document de démonstration : mentions et traitement fiscal à valider au Maroc avant émission légale.</p></div>}
      </section>
    })}
    {invoiceSearch&&!invoices.isLoading&&!invoices.isError&&!invoices.data?.pagination.total&&<p className="rounded-lg border border-dashed p-6 text-center text-slate-500">Aucune facture ne correspond à « {invoiceSearch} ».</p>}
  </div>
}
