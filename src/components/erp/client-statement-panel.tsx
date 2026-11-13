"use client"
import {useState} from "react"
import {useQuery} from "@tanstack/react-query"
import {Input} from "@/components/ui/input"
import {Button} from "@/components/ui/button"
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from "@/components/ui/select"
import {api,useClients} from "./hooks"
import {fmtMAD} from "@/lib/erp-types"

type Row={event:{id:number,kind:"invoice"|"payment"|"credit",ref:string,invoiceRef:string,date:string,amountCents:number},balanceCents:number}
type Statement={client:{id:number,name:string},openingBalanceCents:number,closingBalanceCents:number,total:number,page:number,pageSize:number,items:Row[]}
const money=(v:number)=>fmtMAD(v/100,{cents:true})
const labels={invoice:"Facture",payment:"Règlement",credit:"Avoir approuvé"} as const
export function ClientStatementPanel(){
 const [clientId,setClientId]=useState("")
 const [clientQuery,setClientQuery]=useState("")
 const [clientPage,setClientPage]=useState(1)
 const [selectedClientLabel,setSelectedClientLabel]=useState("")
 const [from,setFrom]=useState("")
 const [to,setTo]=useState("")
 const [page,setPage]=useState(1)
 const clients=useClients(clientQuery,clientPage,40)
 const statement=useQuery({queryKey:["client-statement",clientId,from,to,page],queryFn:()=>api<Statement>(`/api/sales/statement?clientId=${clientId}&page=${page}&pageSize=50${from?`&from=${from}`:""}${to?`&to=${to}`:""}`),enabled:!!clientId&&(!from||!to||from<=to)})
 const reset=()=>setPage(1)
 return <section className="space-y-3 rounded-lg border bg-white p-4" aria-label="État de compte client">
  <h2 className="font-semibold">État de compte client · Finance</h2>
  <p className="text-xs text-slate-600">Factures, règlements et avoirs approuvés ; les avoirs en attente ne diminuent pas le solde. Montants en MAD.</p>
  <div className="grid gap-3 md:grid-cols-3">
   <div className="space-y-1">
    <label htmlFor="statement-client-search" className="mb-1 block text-xs font-medium">Client</label>
    <Input id="statement-client-search" placeholder="Rechercher par nom ou ville…" maxLength={120} value={clientQuery} onChange={e=>{setClientQuery(e.target.value);setClientPage(1)}}/>
    <Select value={clientId} onValueChange={v=>{setClientId(v);setSelectedClientLabel(clients.data?.items.find(c=>c.id===Number(v))?.name??selectedClientLabel);reset()}}><SelectTrigger aria-label="Client pour état de compte"><SelectValue placeholder="Sélectionner un client"/></SelectTrigger><SelectContent>
      {clientId&&!clients.data?.items.some(c=>c.id===Number(clientId))&&<SelectItem value={clientId}>{selectedClientLabel||`Client #${clientId}`}</SelectItem>}
      {(clients.data?.items??[]).map(c=><SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
    </SelectContent></Select>
    <div className="flex items-center justify-between gap-2 text-xs text-slate-600"><span>{clients.data?.pagination.total??0} client(s) · page {clientPage}/{clients.data?.pagination.pages??1}</span><div className="flex gap-1"><Button size="sm" variant="outline" disabled={clientPage<=1} onClick={()=>setClientPage(p=>p-1)}>Précédent</Button><Button size="sm" variant="outline" disabled={clientPage>=(clients.data?.pagination.pages??1)} onClick={()=>setClientPage(p=>p+1)}>Suivant</Button></div></div>
   </div>
   <label className="text-xs font-medium">Du (facultatif)<Input aria-label="Relevé depuis" type="date" value={from} onChange={e=>{setFrom(e.target.value);reset()}}/></label>
   <label className="text-xs font-medium">Au (facultatif)<Input aria-label="Relevé jusqu'au" type="date" value={to} onChange={e=>{setTo(e.target.value);reset()}}/></label>
  </div>
  {from&&to&&from>to&&<p role="alert" className="text-sm text-red-700">La date de début doit précéder la date de fin.</p>}
  {clients.isError&&<p role="alert">Liste clients indisponible.</p>}
  {statement.isLoading&&<p role="status">Calcul du relevé en cours…</p>}
  {statement.isError&&<p role="alert" className="text-red-700">Impossible de charger le relevé. Vérifiez les droits et la période.</p>}
  {statement.data&&<>
   <div className="flex flex-wrap gap-4 rounded bg-slate-50 p-3 text-sm"><span>Solde d'ouverture : <strong>{money(statement.data.openingBalanceCents)}</strong></span><span>Solde de clôture : <strong>{money(statement.data.closingBalanceCents)}</strong></span><span>Écritures : {statement.data.total}</span></div>
   <div className="overflow-x-auto"><table className="min-w-[640px] w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">Date</th><th className="p-2">Nature</th><th className="p-2">Référence</th><th className="p-2">Facture</th><th className="p-2 text-right">Débit</th><th className="p-2 text-right">Crédit</th><th className="p-2 text-right">Solde</th></tr></thead><tbody>{statement.data.items.map(r=><tr className="border-b" key={`${r.event.kind}-${r.event.id}`}><td className="p-2">{r.event.date.slice(0,10)}</td><td className="p-2">{labels[r.event.kind]}</td><td className="p-2">{r.event.ref}</td><td className="p-2">{r.event.invoiceRef}</td><td className="p-2 text-right">{r.event.kind==="invoice"?money(r.event.amountCents):"—"}</td><td className="p-2 text-right">{r.event.kind!=="invoice"?money(r.event.amountCents):"—"}</td><td className="p-2 text-right">{money(r.balanceCents)}</td></tr>)}</tbody></table></div>
   {!statement.data.total&&<p className="text-sm text-slate-600">Aucune écriture sur cette période.</p>}
   <div className="flex items-center gap-3 text-sm"><Button size="sm" variant="outline" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Précédent</Button><span>Page {page} / {Math.max(1,Math.ceil(statement.data.total/statement.data.pageSize))}</span><Button size="sm" variant="outline" disabled={page*statement.data.pageSize>=statement.data.total} onClick={()=>setPage(p=>p+1)}>Suivant</Button></div>
  </>}
 </section>
}
