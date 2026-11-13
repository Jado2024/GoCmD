import { NextRequest, NextResponse } from 'next/server';
import { readRoleGate } from '@/lib/access-gate';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Historique ciblé sur des lignes de DA, y compris anciennes RFQ hors dossier groupé.
 * Aucun montant, tarif ou contact privé n'est exposé par ce point de lecture. */
export async function GET(req: NextRequest) {
 const denied = readRoleGate(req, ['buyer', 'approver', 'finance']);
 if (denied) return denied;
 const raw = new URL(req.url).searchParams.get('lineIds') ?? '';
 if (!/^\d+(,\d+)*$/.test(raw)) return NextResponse.json({error:'Identifiants de lignes invalides'}, {status:400});
 const ids = [...new Set(raw.split(',').map(Number))];
 if (ids.length < 1 || ids.length > 50 || ids.some(id=>!Number.isSafeInteger(id) || id <= 0))
  return NextResponse.json({error:'Sélection de lignes invalide'}, {status:400});
 const rfqs = await db.supplierRFQ.findMany({
  where:{requestLineId:{in:ids}},
  orderBy:{createdAt:'desc'},take:300,
  include:{
   consultationLine:{
    include:{
     consultation:{
      include:{
       recipients:{
        include:{
         supplier:{select:{id:true,name:true}},
         lines:{select:{rfqId:true}}
        }
       }
      }
     }
    }
   }
  }
 });
 return NextResponse.json({items:rfqs.map(r=>{
  const c=r.consultationLine?.consultation;
  return {id:r.id,ref:r.ref,requestLineId:r.requestLineId,qty:r.qty,unit:r.unit,status:r.status,createdAt:r.createdAt.toISOString(),
   consultation:c?{id:c.id,ref:c.ref,status:c.status,createdAt:c.createdAt.toISOString(),
    recipients:c.recipients.filter(rec=>rec.lines.some(line=>line.rfqId===r.id)).map(rec=>({supplierId:rec.supplierId,name:rec.supplier.name}))}:null};
 })});
}
