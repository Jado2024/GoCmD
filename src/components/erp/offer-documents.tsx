"use client"
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

type Attachment={id:number;originalName:string;bytes:number}
export function OfferDocuments({offerId,items,canUpload=true,onUploaded}:{offerId:number;items:Attachment[];canUpload?:boolean;onUploaded?:()=>void}){
 const [recent,setRecent]=useState<Attachment[]>([])
 const uploads=[...items,...recent.filter(r=>!items.some(i=>i.id===r.id))]
 const [busy,setBusy]=useState(false),[error,setError]=useState('')
 const ref=useRef<HTMLInputElement>(null)
 async function upload(file:File){
  setBusy(true);setError('')
  try{
   const form=new FormData();form.set('file',file);form.set('offerId',String(offerId))
   const res=await fetch('/api/p2p/offer-documents',{method:'POST',body:form})
   const data=await res.json()
   if(!res.ok)throw Error(data.error||'Envoi refusé')
   setRecent(p=>[...p,data.item])
   onUploaded?.()
  }catch(e){setError(e instanceof Error?e.message:'Envoi impossible')}finally{setBusy(false);if(ref.current)ref.current.value=''}
 }
 return <div className="mt-2 space-y-2 rounded-lg border p-2 text-xs">
   <strong>Justificatifs PDF</strong>
   <div className="flex flex-wrap gap-2">{uploads.length?uploads.map(a=><a key={a.id} className="underline text-[#bd202a]" href={`/api/p2p/offer-documents/${a.id}`}>{a.originalName} ({Math.ceil(a.bytes/1024)} Ko)</a>):<span className="text-slate-500">Aucun document joint</span>}</div>
   {canUpload&&<input ref={ref} aria-label={`Importer un devis PDF pour l'offre ${offerId}`} type="file" accept=".pdf,application/pdf" className="block w-full min-w-0 max-w-full text-xs" onChange={e=>{const f=e.target.files?.[0];if(f)void upload(f)}} disabled={busy}/> }
   <span className="text-slate-500">PDF 8 Mo maximum. Stockage privé ; téléchargement réservé aux comptes habilités.</span>
   {error&&<p role="alert" className="text-rose-700">{error}</p>}
 </div>
}
