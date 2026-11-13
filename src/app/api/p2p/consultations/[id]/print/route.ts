import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readRoleGate } from '@/lib/access-gate';

export const dynamic='force-dynamic';
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]!));

export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 const denied=readRoleGate(req,['buyer','approver']);if(denied)return denied;
 const {id}=await params;
 if(!/^\d+$/.test(id))return NextResponse.json({error:'Dossier invalide'},{status:400});
 const supplierId=Number(req.nextUrl.searchParams.get('supplierId'));
 if(!Number.isSafeInteger(supplierId)||supplierId<=0)return NextResponse.json({error:'Fournisseur invalide'},{status:400});
 const consultation=await db.supplierConsultation.findUnique({where:{id:Number(id)},
  include:{recipients:{include:{supplier:true,lines:{select:{rfqId:true}}}},lines:{include:{rfq:{include:{material:true}}}}}});
 if(!consultation)return NextResponse.json({error:'Consultation introuvable'},{status:404});
 const invited=consultation.recipients.find(r=>r.supplierId===supplierId);
 if(!invited)return NextResponse.json({error:'Destinataire non invité à ce dossier'},{status:404});
 // Snapshot immuable : la liste des matières par fournisseur reste identique,
 // même si son référencement matière est modifié après la consultation.
 const invitedRfqs=new Set(invited.lines.map(l=>l.rfqId));
 const lines=consultation.lines.filter(l=>invitedRfqs.has(l.rfqId));
 if(!lines.length)return NextResponse.json({error:'Aucune ligne liée au fournisseur'},{status:404});
 const trs=lines.map((l,i)=>`<tr><td>${i+1}</td><td>${esc(l.rfq.material.ref)}<p>${esc(l.rfq.material.name)}</p></td><td>${esc(l.rfq.qty)}</td><td>${esc(l.rfq.unit)}</td><td></td><td></td></tr>`).join('');
 const deadline=consultation.deadline?new Intl.DateTimeFormat('fr-FR',{timeZone:'UTC',dateStyle:'short'}).format(consultation.deadline):'À convenir';
 const html=`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(consultation.ref)} - ${esc(invited.supplier.name)}</title><style>
 body{font:15px/1.5 Arial,sans-serif;color:#1f2937;padding:36px;max-width:1100px;margin:auto}header{border-bottom:3px solid #bd202a;padding-bottom:18px;display:flex;justify-content:space-between;align-items:center}h1{font-size:23px;margin:25px 0 8px}img.brand{max-width:175px;max-height:55px;object-fit:contain}strong.brand{font-size:25px;color:#bd202a}table{border-collapse:collapse;width:100%;margin-top:20px}th,td{border:1px solid #cbd5e1;padding:10px;text-align:left;vertical-align:top}th{background:#f1f5f9}td p{margin:5px 0 0;color:#64748b} .notice{padding:12px;background:#f8fafc;border-left:3px solid #bd202a;margin-top:22px}.print{margin-bottom:24px;border:0;background:#bd202a;color:white;padding:10px 16px;border-radius:6px}@media print{.print{display:none}body{padding:0}header{break-after:avoid}} </style></head><body>
 <p class="print">Pour conserver ce document : navigateur → Imprimer (Ctrl+P) → Enregistrer en PDF. Aucun email n'a été envoyé automatiquement.</p>
 <header><img class="brand" src="/branding/sodepi-logo.png" alt="SODEPI" /><span>DEMANDE DE PRIX — ${esc(consultation.ref)}</span></header>
 <h1>Consultation fournisseur</h1><p><b>À l'attention de :</b> ${esc(invited.supplier.name)}</p><p><b>Date de création :</b> ${esc(consultation.createdAt.toISOString().slice(0,10))} · <b>Réponse souhaitée :</b> ${esc(deadline)}</p>
 <p>Merci de nous transmettre votre meilleure offre pour les matières ci-dessous, en précisant la disponibilité, les délais, le prix et ses conditions, le transport et la validité de votre proposition.</p>
 <table><thead><tr><th>N°</th><th>Référence / désignation</th><th>Quantité</th><th>Unité</th><th>Prix proposé</th><th>Délai proposé</th></tr></thead><tbody>${trs}</tbody></table>
 <div class="notice">Cette demande de prix n'est pas un bon de commande. Aucune commande n'est passée avant l'émission d'un BC approuvé. Les prix indicatifs internes et les fournisseurs concurrents ne sont pas divulgués.</div>
 <p>Veuillez rappeler la référence ${esc(consultation.ref)} dans votre réponse.</p></body></html>`;
 return new NextResponse(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"}});
}
