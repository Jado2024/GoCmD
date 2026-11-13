import {accessGate,currentActor,hasAnyReadRole,hasPermission} from '@/lib/access-gate';
import {db} from '@/lib/db';
import {NextRequest,NextResponse} from 'next/server';
import {safeCsvCell} from '@/lib/export-csv';
import {moneyToCents} from '@/lib/supplier-invoice-balance';
export async function GET(req:NextRequest){
 const denied=accessGate(req);if(denied)return denied;
 // DMAIC AUD-02 : les indicateurs d'approvisionnement et le suivi fournisseur
 // appartiennent aux fonctions habilitées, pas à tout utilisateur authentifié.
 if(!hasAnyReadRole(req,['buyer','approver','receiver','inventory','quality','finance','director']) ||
    (currentActor(req)?.managed && !hasPermission(req,'p2p.overview.read')))
  return NextResponse.json({error:'Lecture du pilotage achats non autorisée'},{status:403,headers:{'Cache-Control':'no-store'}});
 const now=new Date(),format=req.nextUrl.searchParams.get('format');
 if(format==='csv'){
  const finance=accessGate(req,'finance');if(finance)return finance;
  if(currentActor(req)?.managed && !hasPermission(req,'finance.export'))
   return NextResponse.json({error:'Permission export financier refusée'},{status:403,headers:{'Cache-Control':'no-store'}});
  const invoices=await db.supplierInvoice.findMany({include:{supplier:true,payments:true,credits:true},orderBy:{invoiceDate:'desc'},take:2000});
  const rows=[['Fournisseur','Facture','Date','Devise','Total','Avoirs','Paiements','Solde','Statut'].map(safeCsvCell).join(';')];
  for(const i of invoices){
   const paidCents=i.payments.reduce((x,p)=>x+moneyToCents(p.amount),0);
   const creditCents=i.credits.filter(c=>c.status==='approved'&&c.kind==='balance').reduce((x,c)=>x+moneyToCents(c.amount),0);
   const centsToMad=(cents:number)=>(cents/100).toFixed(2);
   rows.push([i.supplier.name,i.invoiceNumber,i.invoiceDate.toISOString().slice(0,10),i.currency,centsToMad(moneyToCents(i.totalAmount)),centsToMad(creditCents),centsToMad(paidCents),centsToMad(moneyToCents(i.totalAmount)-paidCents-creditCents),i.status].map(safeCsvCell).join(';'));
  }
  return new Response('\uFEFF'+rows.join('\r\n'),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="gocmd_factures_fournisseurs.csv"','Cache-Control':'no-store'}});
 }
 if(req.nextUrl.searchParams.get('view')==='summary'){
  const open={status:{in:['confirmed','partial']}};
  const overdueWhere={...open,expectedDate:{lt:now},lines:{some:{qty:{gt:db.supplierOrderLine.fields.receivedQty}}}};
  const [openSupplierOrders,overdueCount,overdueRows,openRFQs,openDisputes,legacyLotsToCount]=await db.$transaction([
   db.supplierOrder.count({where:open}),
   db.supplierOrder.count({where:overdueWhere}),
   db.supplierOrder.findMany({where:overdueWhere,orderBy:[{expectedDate:'asc'},{id:'asc'}],take:10,
    select:{id:true,ref:true,expectedDate:true,supplier:{select:{name:true}},lines:{select:{qty:true,receivedQty:true}}}}),
   db.supplierRFQ.count({where:{status:'open'}}),
   db.supplierDispute.count({where:{status:'open'}}),
   db.stockLot.count({where:{status:'legacy_unverified'}}),
  ]);
  return NextResponse.json({openSupplierOrders,overdueCount,openRFQs,openDisputes,legacyLotsToCount,
   overdue:overdueRows.map(row=>({id:row.id,ref:row.ref,supplier:row.supplier.name,date:row.expectedDate,
    remaining:row.lines.reduce((sum,line)=>sum+Math.max(0,line.qty-line.receivedQty),0)}))});
 }
 // V18.9.1 (contre-audit A-12) : alertes et métriques calculées sur des
 // requêtes ciblées (statuts ouverts) et des agrégats exacts, sans dépendre
 // d'un échantillon plafonné (500/3000) qui pouvait masquer des documents.
 const [orders,deliveredCounts,receiptCount,returnCount,quarantineAgg,anomalies,openDisputes,openRFQs]=await Promise.all([
  db.supplierOrder.findMany({where:{status:{in:['confirmed','partial']}},include:{supplier:true,lines:true},orderBy:{createdAt:'desc'}}),
  db.supplierOrder.groupBy({by:['supplierId'],where:{status:'received'},_count:{_all:true}}),
  db.goodsReceipt.count(),
  db.supplierReturn.count(),
  db.stockLot.aggregate({where:{status:'quarantine'},_sum:{qty:true}}),
  db.stockLot.count({where:{status:'legacy_unverified'}}),
  db.supplierDispute.count({where:{status:'open'}}),
  db.supplierRFQ.count({where:{status:'open'}}),
 ]);
 const overdue=orders.filter(o=>['confirmed','partial'].includes(o.status)&&o.expectedDate&&o.expectedDate<now&&o.lines.some(l=>l.receivedQty<l.qty-1e-6)).map(o=>({id:o.id,ref:o.ref,supplier:o.supplier.name,date:o.expectedDate,remaining:o.lines.reduce((s,l)=>s+Math.max(0,l.qty-l.receivedQty),0)}));
 const deliveredBySupplier=new Map(deliveredCounts.map(g=>[g.supplierId,g._count._all] as const))
 const overdueIds=new Set(overdue.map(order=>order.id));
 const supplierMetrics=orders.reduce((acc,o)=>{const s=acc.get(o.supplierId)??{supplier:o.supplier.name,orders:0,delivered:0,overdue:0};s.orders++;s.delivered+=deliveredBySupplier.get(o.supplierId)??0;deliveredBySupplier.delete(o.supplierId);s.overdue+=overdueIds.has(o.id)?1:0;acc.set(o.supplierId,s);return acc},new Map<number,{supplier:string,orders:number,delivered:number,overdue:number}>());
 for(const [supplierId,delivered] of deliveredBySupplier)if(!supplierMetrics.has(supplierId))supplierMetrics.set(supplierId,{supplier:`#${supplierId}`,orders:0,delivered,overdue:0})
 return NextResponse.json({overdue,openSupplierOrders:orders.length,openDisputes,openRFQs,receiptCount,returnCount,quarantine:quarantineAgg._sum.qty??0,legacyLotsToCount:anomalies,supplierMetrics:[...supplierMetrics.values()]});
}
