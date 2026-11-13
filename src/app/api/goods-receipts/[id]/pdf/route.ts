import {NextRequest,NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {readRoleGate} from '@/lib/access-gate';
import {pdfDownload,renderProcurementPdf} from '@/lib/procurement-pdf';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 const denied=readRoleGate(req,['receiver','inventory','quality','buyer','approver','finance']);if(denied)return denied;
 const {id}=await params;if(!/^\d+$/.test(id))return NextResponse.json({error:'BR invalide'},{status:400});
 const br=await db.goodsReceipt.findUnique({where:{id:Number(id)},include:{supplierOrder:{include:{supplier:true}},lines:{include:{supplierOrderLine:{include:{material:true}}}}}});
 if(!br)return NextResponse.json({error:'BR introuvable'},{status:404});
 const date=new Intl.DateTimeFormat('fr-FR',{timeZone:'UTC',dateStyle:'short'}).format(br.createdAt);
 const pdf=renderProcurementPdf({title:'BON DE RÉCEPTION',reference:br.ref,subtitle:'Document interne de réception des matières premières.',
  details:[['Fournisseur',br.supplierOrder.supplier.name],['Bon de commande',br.supplierOrder.ref],['BL fournisseur',br.deliveryRef],['Date de réception',date],['Réceptionnaire',br.operator]],
  columns:['Réf. article','Matière','Qté acceptée','Qté refusée','Lot'],
  rows:br.lines.map(l=>[l.supplierOrderLine.material.ref,l.supplierOrderLine.material.name,`${l.acceptedQty} ${l.supplierOrderLine.material.unit}`,`${l.rejectedQty} ${l.supplierOrderLine.material.unit}`,l.lot??'—']),
  note:'Seules les quantités acceptées alimentent le stock disponible. Les quantités refusées font l’objet du traitement qualité.',
 });
 return pdfDownload(pdf,`SODEPI_BR_${br.ref}.pdf`);
}
