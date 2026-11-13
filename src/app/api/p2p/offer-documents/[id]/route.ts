import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { db } from '@/lib/db'
import { serializedSQLiteWrite } from '@/lib/sqlite-write'
import { readRoleGate, canSeeMaterialCosts, currentActor } from '@/lib/access-gate'
import { offerDocumentsRoot, safeDocumentName } from '@/lib/private-offer-documents'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 const denied=readRoleGate(req,['buyer','approver','finance']);if(denied)return denied
 const actor=currentActor(req)
 if(!actor)return NextResponse.json({error:'Session expirée'},{status:401})
 if(!canSeeMaterialCosts(req))return NextResponse.json({error:'Accès refusé'},{status:403})
 const {id}=await params
 if(!/^\d+$/.test(id)||!Number.isSafeInteger(Number(id)))return NextResponse.json({error:'Pièce invalide'},{status:400})
 const record=await db.supplierOfferAttachment.findUnique({where:{id:Number(id)}})
 if(!record||!safeDocumentName(record.storedName))return NextResponse.json({error:'Pièce introuvable'},{status:404})
 let buffer:Buffer
 try{buffer=await readFile(path.join(offerDocumentsRoot(),record.storedName))}catch{return NextResponse.json({error:'PDF absent du stockage ; vérifier les sauvegardes'},{status:404})}
 if(buffer.length!==record.bytes||createHash('sha256').update(buffer).digest('hex')!==record.sha256)return NextResponse.json({error:'PDF altéré ou incomplet : téléchargement refusé'},{status:409})
 try {
  await serializedSQLiteWrite(()=>db.auditEvent.create({data:{actor:actor.username,action:'SUPPLIER_QUOTE_PDF_READ',entity:'SupplierOfferAttachment',entityId:String(record.id),details:JSON.stringify({offerId:record.offerId})}}))
 } catch {
  // Fail closed: no private PDF is returned if its read cannot be attributed.
  return NextResponse.json({error:'Journalisation indisponible : téléchargement temporairement suspendu'},{status:503})
 }
 return new NextResponse(new Uint8Array(buffer),{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="devis-fournisseur-${record.id}.pdf"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}})
}
