import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {isAuthorizedSupplierQuote} from '../src/lib/supplier-quote-authorization.ts';
import {consultationRisk} from '../src/lib/consultation-priority.ts';
import {supplierOfferState,supplierOfferLabel} from '../src/lib/supplier-response-status.ts';
const f=p=>readFileSync(p,'utf8');
const ts=(()=>{const require=createRequire(import.meta.url);try{return require('typescript')}catch{return require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript')}})();
const now=new Date('2026-11-07T13:00:00Z');
const phone={chosen:true,confirmationStatus:'confirmed',responseChannel:'phone',quoteRef:'TEL-41',validUntil:new Date('2026-11-15T23:59:59Z'),attachments:[],contactName:'Service devis',callSummary:'Prix annoncé pour 60 kg de colle, délai 7 jours',respondedAt:new Date('2026-11-07T10:00:00Z'),buyerValidatedBy:'acheteur1',buyerValidatedAt:new Date('2026-11-07T10:05:00Z'),approvedBy:'responsable2',approvedAt:new Date('2026-11-07T11:00:00Z')};
assert.equal(isAuthorizedSupplierQuote(phone,now),true,'Une offre orale approuvée peut créer un BC sans PDF');
for(const k of ['buyerValidatedBy','buyerValidatedAt','approvedBy','approvedAt','contactName','callSummary','respondedAt']){
 assert.equal(isAuthorizedSupplierQuote({...phone,[k]:null},now),false,'refuser offre non traçable : '+k);
}
assert.equal(isAuthorizedSupplierQuote({...phone,approvedBy:'acheteur1'},now),false,'quatre yeux');
assert.equal(isAuthorizedSupplierQuote({...phone,chosen:false},now),false,'pas attribuée');
assert.equal(isAuthorizedSupplierQuote({...phone,confirmationStatus:'pending'},now),false,'pas validée');
assert.equal(isAuthorizedSupplierQuote({...phone,validUntil:new Date('2026-11-01')},now),false,'expire');
assert.equal(isAuthorizedSupplierQuote({...phone,responseChannel:'written'},now),false,'PDF toujours requis pour écrit');
assert.equal(isAuthorizedSupplierQuote({...phone,responseChannel:'written',attachments:[{id:21}],buyerValidatedBy:null,approvedBy:null},now),false,'un PDF écrit sans approbation explicite ne peut plus créer un BC');
assert.equal(isAuthorizedSupplierQuote({...phone,responseChannel:'written',attachments:[{id:21}],buyerValidatedBy:null,recordedBy:'acheteur1'},now),true,'devis écrit avec PDF et approbation distincte');
assert.equal(supplierOfferState({chosen:false,confirmationStatus:'pending',responseChannel:'phone',hasAttachment:false},'open'),'oral_pending');
assert.equal(supplierOfferState({chosen:false,confirmationStatus:'confirmed',responseChannel:'phone',hasAttachment:false,buyerValidatedBy:'acheteur1',buyerValidatedAt:'2026-11-07'},'open'),'ready_to_award');
assert.equal(supplierOfferState({chosen:false,confirmationStatus:'confirmed',responseChannel:'written',hasAttachment:false},'open'),'written_pdf_missing');
assert.match(supplierOfferLabel('oral_pending'),/validation acheteur/);
const mk=(stockQty,minStock)=>[{material:{stockQty,minStock},targetDate:null}];
assert.equal(consultationRisk(mk(0,10),null,now),'rupture');
assert.equal(consultationRisk(mk(5,10),null,now),'low_stock');
assert.equal(consultationRisk(mk(12,10),'2026-11-08',now),'due_soon');
assert.equal(consultationRisk(mk(12,10),'2026-11-25',now),'normal');
const sourcing=f('src/app/api/p2p/sourcing/route.ts');
// P5.15.20 : le contrôle « PDF pour devis écrit » a été renforcé en P5.15.15 :
// la confirmation exige désormais le PDF de la RÉVISION COURANTE de l'offre
// (attachments.some(a=>a.revisionNo===offer.revisionNo)) et non plus un simple
// décompte writtenEvidence. L'autorisation centrale (PDF écrit/traçabilité
// orale) est vérifiée ci-dessus via isAuthorizedSupplierQuote.
for(const tag of ["action:z.literal('validatePhoneOffer')",'buyerValidatedBy:actor.username','approvedBy:actor.username','AUTO_APPROBATION_OFFRE',"if(!offer.attachments.some(a=>a.revisionNo===offer.revisionNo))throw Error('PDF_CONFIRMATION_REQUIS')",'P2P_${action.toUpperCase()}'])assert.ok(sourcing.includes(tag),tag);
const order=f('src/app/api/supplier-orders/route.ts');
assert.equal((order.match(/isAuthorizedSupplierQuote\(\{\.\.\.q/g)||[]).length,2,'source list and BC POST, PDF de la version courante');
assert.match(f('src/app/api/supplier-orders/[id]/route.ts'),/isAuthorizedSupplierQuote\(\{\.\.\.q/,'BC approbation controlee');
const cons=f('src/app/api/p2p/consultations/route.ts');
// P5.15.20 : le tri des consultations est désormais calculé côté serveur par
// l'assistant consultationListQuery (SQL déterministe `order:sortSql`) au lieu
// de l'ancien `metadata.sort` embarqué dans la réponse.
for(const tag of ['supplierId','category','priority','status','sort','order:sortSql','stockQty:true','minStock:true','buyerValidatedBy:costVisible?',"'Cache-Control':'private, no-store'"])assert.ok(cons.includes(tag),tag);
const ui=f('src/components/erp/p2p-advanced-view.tsx');
for(const tag of ['Appliquer les filtres','Rupture de stock','Famille de matière','Société / fournisseur','Comparer les offres','Valider une offre téléphonique sans PDF'])assert.ok(ui.includes(tag),tag);
for(const file of ['src/app/api/p2p/sourcing/route.ts','src/app/api/supplier-orders/route.ts','src/app/api/p2p/consultations/route.ts','src/lib/supplier-quote-authorization.ts','src/lib/supplier-response-status.ts','src/lib/consultation-priority.ts','src/components/erp/p2p-advanced-view.tsx','src/components/erp/supplier-response-flow.tsx','src/app/api/suppliers/route.ts']){
 const source=ts.createSourceFile(file,f(file),ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 assert.deepEqual(source.parseDiagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')),[],file+' syntaxe TS');
}
console.log('PASS P5.15.15 : circuit offres téléphoniques, quatre yeux, validité, pièces écrites, UI et priorités.');
