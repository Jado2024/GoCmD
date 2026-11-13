import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {supplierOfferState,supplierOfferLabel} from '../src/lib/supplier-response-status.ts';
const read=(p)=>fs.readFileSync(p,'utf8');
// P5.14.7 adapté aux règles P5.15.15 : trois canaux, téléphone sans PDF
// après validation acheteur ET approbation distincte du responsable.
const scenarios=[
 [{chosen:false,confirmationStatus:'pending',responseChannel:'phone',hasAttachment:false},'open','oral_pending'],
 [{chosen:false,confirmationStatus:'pending',responseChannel:'phone',hasAttachment:true},'open','oral_to_confirm'],
 [{chosen:false,confirmationStatus:'confirmed',responseChannel:'phone',hasAttachment:false},'open','oral_pending'],
 [{chosen:false,confirmationStatus:'confirmed',responseChannel:'phone',hasAttachment:false,buyerValidatedBy:'acheteur1',buyerValidatedAt:'2026-11-07T10:00:00Z'},'open','ready_to_award'],
 [{chosen:false,confirmationStatus:'confirmed',responseChannel:'written',hasAttachment:false},'open','written_pdf_missing'],
 [{chosen:false,confirmationStatus:'confirmed',responseChannel:'written',hasAttachment:true},'open','ready_to_award'],
 [{chosen:false,confirmationStatus:'confirmed',responseChannel:'email',hasAttachment:false,hasEmailEvidence:false},'open','written_pdf_missing'],
 [{chosen:false,confirmationStatus:'confirmed',responseChannel:'email',hasAttachment:false,hasEmailEvidence:true},'open','ready_to_award'],
 [{chosen:true,confirmationStatus:'confirmed',responseChannel:'phone',hasAttachment:false},'awarded','awarded'],
 [{chosen:false,confirmationStatus:'pending',responseChannel:'phone',hasAttachment:false},'closed','closed'],
];
for (const [offer,rfq,expected] of scenarios){
 assert.equal(supplierOfferState(offer,rfq),expected,JSON.stringify(offer));
 assert.ok(supplierOfferLabel(expected).length>5);
}
const panel=read('src/components/erp/supplier-response-flow.tsx');
// Vérifier actions et canal transmis, sans épingler l'ancien libellé retiré.
for (const text of [
 "onAction('oralOffer'", "onAction('offer'", "evidenceChannel:'written'",
 "evidenceChannel:'email'", "onAction('validatePhoneOffer'",
 "onAction('confirmOffer'", "onAction('reviseOffer'",
 'canRecord&&canSeePrices', 'canAward&&canSeePrices',
 'OfferDocuments', 'onUploaded={onUpdated}', 'supplierOfferState',
 'Valider l’offre téléphonique sans PDF', 'Saisir le devis PDF', 'Saisir l’offre e-mail'
 ])assert.ok(panel.includes(text),`Parcours actuel: ${text}`);
assert.match(panel,/offers\.map\(o=>/,'historique multi-offres conservé');
assert.match(panel,/status==='oral_pending'&&o\.responseChannel==='phone'/,'validation orale sans PDF');
assert.match(panel,/status==='oral_to_confirm'/,'confirmation PDF');
assert.match(panel,/status==='ready_to_award'/,'attribution après validation');
const p2p=read('src/components/erp/p2p-advanced-view.tsx');
assert.match(p2p,/SupplierResponseFlow/);assert.match(p2p,/onAction=\{openResponseAction\}/);
const api=read('src/app/api/p2p/consultations/route.ts');
assert.match(api,/canSeeMaterialCosts\(req\)/);
assert.match(api,/unitPrice:costVisible\?String\(o\.unitPrice\):null/);
assert.match(api,/attachments:\{select:\{id:true,originalName:true,bytes:true,revisionNo:true\}\}/);
assert.match(api,/callSummary:costVisible\?o\.callSummary:null/);
const sourcing=read('src/app/api/p2p/sourcing/route.ts');
for(const text of ["action:z.literal('validatePhoneOffer')",'buyerValidatedBy:actor.username','approvedBy:actor.username','AUTO_APPROBATION_OFFRE'])assert.ok(sourcing.includes(text),text);
assert.match(sourcing,/PDF_CONFIRMATION_REQUIS/,'offres écrites protégées');
assert.match(read('src/app/api/supplier-orders/route.ts'),/isAuthorizedSupplierQuote/,'garde création BC');
assert.match(read('src/app/api/supplier-orders/[id]/route.ts'),/isAuthorizedSupplierQuote/,'garde approbation BC');
assert.match(read('src/app/api/p2p/offer-documents/route.ts'),/canSeeMaterialCosts\(req\)/);
const req=createRequire(import.meta.url),ts=(()=>{try{return req('typescript')}catch{return req('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript')}})();
for(const file of ['src/components/erp/supplier-response-flow.tsx','src/components/erp/p2p-advanced-view.tsx','src/components/erp/offer-documents.tsx','src/lib/supplier-response-status.ts','src/app/api/p2p/consultations/route.ts','src/app/api/p2p/sourcing/route.ts']){
 const source=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 assert.deepEqual(source.parseDiagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')),[],file);
}
console.log('PASS P5.14.7 maintenu : téléphone sans PDF avec validation, PDF/e-mail, permissions, API, historique.');
