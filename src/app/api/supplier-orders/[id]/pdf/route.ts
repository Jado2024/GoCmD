import {NextRequest,NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {readRoleGate,hasPermission} from '@/lib/access-gate';
import {pdfDownload,renderProcurementPdf} from '@/lib/procurement-pdf';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 const denied=readRoleGate(req,['buyer','approver','finance']);if(denied)return denied;
 if(!hasPermission(req,'costs.read'))return NextResponse.json({error:'Lecture des prix non autorisée'},{status:403});
 const {id}=await params;if(!/^\d+$/.test(id))return NextResponse.json({error:'BC invalide'},{status:400});
 const order=await db.supplierOrder.findUnique({where:{id:Number(id)},include:{supplier:true,lines:{include:{material:true,requestLine:{include:{request:true}}}}}});
 if(!order)return NextResponse.json({error:'BC introuvable'},{status:404});
 if(order.status==='draft')return NextResponse.json({error:'Le BC doit être approuvé avant de produire le PDF officiel'},{status:409});
 const date=(v:Date)=>new Intl.DateTimeFormat('fr-FR',{timeZone:'UTC',dateStyle:'short'}).format(v);
 const total=order.lines.reduce((n,l)=>n+l.qty*l.unitPrice,0);
 const pdf=renderProcurementPdf({title:'BON DE COMMANDE FOURNISSEUR',reference:order.ref,
  subtitle:'Commande approuvée. Mentionner la référence du BC sur le bon de livraison et la facture.',
  details:[['Fournisseur',order.supplier.name],['Date commande',date(order.createdAt)],['Livraison souhaitée',order.expectedDate?date(order.expectedDate):'À confirmer'],['Montant estimatif hors taxes',`${total.toFixed(2)} MAD`],['Approuvé par',order.approvedBy??'À vérifier']],
  columns:['Réf. article','Matière','DA','Qté','PU MAD','Total MAD'],
  rows:order.lines.map(l=>[l.material.ref,l.material.name,l.requestLine?.request.ref??'—',`${l.qty} ${l.material.unit}`,l.unitPrice.toFixed(2),(l.qty*l.unitPrice).toFixed(2)]),
  note:`Total des lignes : ${total.toFixed(2)} MAD. Vérifier taxes, frais de livraison et conditions contractuelles avant facturation. ${order.note??''}`,
 });
 return pdfDownload(pdf,`SODEPI_BC_${order.ref}.pdf`);
}
