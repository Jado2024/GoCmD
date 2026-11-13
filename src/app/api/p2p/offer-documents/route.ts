import { NextRequest, NextResponse } from 'next/server'
import { randomUUID, createHash } from 'node:crypto'
import { writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { db } from '@/lib/db'
import { serializedSQLiteWrite } from '@/lib/sqlite-write'
import { accessGate, readRoleGate, currentActor, hasPermission, canSeeMaterialCosts } from '@/lib/access-gate'
import { ensureOfferDocumentsRoot, safeOriginalFilename } from '@/lib/private-offer-documents'

export const runtime='nodejs'
export const dynamic='force-dynamic'
const MAX_PDF_BYTES=8*1024*1024
function err(error:string,status=400){return NextResponse.json({error},{status})}
export async function GET(req:NextRequest){
 const denied=readRoleGate(req,['buyer','approver','finance']);if(denied)return denied
 if(!canSeeMaterialCosts(req))return err('Accès non autorisé',403)
 const offerId=Number(req.nextUrl.searchParams.get('offerId'))
 if(!Number.isSafeInteger(offerId)||offerId<1)return err('Offre invalide')
 const items=await db.supplierOfferAttachment.findMany({where:{offerId},select:{id:true,originalName:true,bytes:true,uploadedBy:true,uploadedAt:true},orderBy:{uploadedAt:'desc'}})
 return NextResponse.json({items})
}
export async function POST(req:NextRequest){
 const denied=accessGate(req,'buyer');if(denied)return denied
 if(!hasPermission(req,'purchases.create')||!canSeeMaterialCosts(req))return err('Permission insuffisante',403)
 const length=Number(req.headers.get('content-length')||0)
 if(length>MAX_PDF_BYTES+64*1024)return err('Document trop volumineux',413)
 const body=await req.formData().catch(()=>null)
 const file=body?.get('file'),offerId=Number(body?.get('offerId'))
 if(!Number.isSafeInteger(offerId)||offerId<=0||!(file instanceof File))return err('Fichier ou offre manquants')
 if(file.size<8||file.size>MAX_PDF_BYTES)return err('PDF limité à 8 Mo',413)
 if(!file.name.toLowerCase().endsWith('.pdf'))return err('Extension PDF obligatoire')
 const buffer=Buffer.from(await file.arrayBuffer())
 if(buffer.subarray(0,5).toString('ascii')!=='%PDF-')return err('Fichier non reconnu comme PDF')
 const offer=await db.supplierQuoteOffer.findUnique({where:{id:offerId},select:{id:true,revisionNo:true,rfq:{select:{status:true}}}})
 if(!offer||offer.rfq.status!=='open')return err('Offre introuvable ou consultation clôturée',409)
 const storedName=`${randomUUID()}.pdf`,root=await ensureOfferDocumentsRoot(),filePath=path.join(root,storedName)
 const hash=createHash('sha256').update(buffer).digest('hex')
 await writeFile(filePath,buffer,{flag:'wx',mode:0o600})
 try{
  const item=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
   const check=await tx.supplierQuoteOffer.findUnique({where:{id:offerId},include:{rfq:{select:{status:true}}}})
   if(!check||check.rfq.status!=='open'||check.revisionNo!==offer.revisionNo)throw Error('OFFRE_FERMEE')
   if(await tx.supplierAwardPlan.count({where:{rfqId:check.rfqId,status:{in:['pending','approved']}}}))throw Error('PLAN_EN_ATTENTE')
   const row=await tx.supplierOfferAttachment.create({data:{offerId,originalName:safeOriginalFilename(file.name),storedName,sha256:hash,bytes:buffer.length,revisionNo:offer.revisionNo,uploadedBy:currentActor(req)!.username}})
   await tx.auditEvent.create({data:{actor:currentActor(req)!.username,action:'SUPPLIER_QUOTE_PDF_ATTACHED',entity:'SupplierQuoteOffer',entityId:String(offerId),details:JSON.stringify({attachmentId:row.id,sha256:hash,bytes:buffer.length})}})
   return row
  }))
  return NextResponse.json({item:{id:item.id,originalName:item.originalName,bytes:item.bytes}},{status:201})
 }catch(e){await unlink(filePath).catch(()=>{});return err('Impossible de conserver le justificatif',409)}
}
