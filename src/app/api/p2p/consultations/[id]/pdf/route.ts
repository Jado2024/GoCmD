import {NextRequest,NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {readRoleGate} from '@/lib/access-gate';
import {pdfDownload,renderProcurementPdf} from '@/lib/procurement-pdf';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 const denied=readRoleGate(req,['buyer','approver']);if(denied)return denied;
 const {id}=await params;const supplierId=Number(req.nextUrl.searchParams.get('supplierId'));
 if(!/^\d+$/.test(id)||!Number.isSafeInteger(supplierId)||supplierId<=0)return NextResponse.json({error:'Dossier ou fournisseur invalide'},{status:400});
 const consultation=await db.supplierConsultation.findUnique({where:{id:Number(id)},include:{recipients:{include:{supplier:true,lines:true}},lines:{include:{rfq:{include:{material:true}}}}}});
 if(!consultation)return NextResponse.json({error:'Consultation introuvable'},{status:404});
 const recipient=consultation.recipients.find(r=>r.supplierId===supplierId);
 if(!recipient)return NextResponse.json({error:'Fournisseur non destinataire'},{status:404});
 const ids=new Set(recipient.lines.map(l=>l.rfqId));
 const lines=consultation.lines.filter(l=>ids.has(l.rfqId));if(!lines.length)return NextResponse.json({error:'Aucune ligne pour ce fournisseur'},{status:404});
 const sourceIds=lines.map(l=>l.rfq.requestLineId).filter((v):v is number=>v!==null);
 const requests=await db.purchaseRequestLine.findMany({where:{id:{in:sourceIds}},select:{id:true,request:{select:{ref:true}}}});
 const refs=new Map(requests.map(r=>[r.id,r.request.ref]));
 const date=(x:Date)=>new Intl.DateTimeFormat('fr-FR',{timeZone:'UTC',dateStyle:'short'}).format(x);
 const doc=renderProcurementPdf({title:'DEMANDE DE PRIX',reference:consultation.ref,subtitle:'Consultation confidentielle : réponse demandée au fournisseur désigné.',
  details:[['Fournisseur',recipient.supplier.name],['Référence fournisseur',recipient.supplier.code],['Date de création',date(consultation.createdAt)],['Réponse souhaitée avant',consultation.deadline?date(consultation.deadline):'À convenir']],
  columns:['Réf. article','Désignation','DA source','Qté','Unité'],
  rows:lines.map(l=>[l.rfq.material.ref,l.rfq.material.name,l.rfq.requestLineId?refs.get(l.rfq.requestLineId)??'—':'—',String(l.rfq.qty),l.rfq.unit]),
  note:'Merci de confirmer pour chaque ligne : prix, disponibilité, délai de livraison, frais annexes, conditions de paiement et validité de votre offre. Aucun tarif indicatif interne ne figure sur ce document.',
 });
 return pdfDownload(doc,`SODEPI_RFQ_${consultation.ref}_${recipient.supplier.code}.pdf`);
}
