import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {remainingToOrder} from '../src/lib/purchase-availability.ts';
import {canPrepareConsultation, activeConsultations} from '../src/lib/consultation-reuse.ts';
import {supplierOfferState} from '../src/lib/supplier-response-status.ts';

const read = name => fs.readFileSync(name, 'utf8');
const ol = (status, qty, receivedQty=0) => ({qty,receivedQty,order:{status}});
const demand = (qty,receivedQty,...supplierOrderLines) => ({qty,receivedQty,supplierOrderLines});
// Exécutions réelles : aucun reliquat fictif ne doit naître de la transition BC->BR.
const rows = [
 [demand(100,0),100,'DA approuvée sans commande'],
 [demand(100,0,ol('draft',100)),100,'Brouillon BC sans réservation comptable'],
 [demand(100,0,ol('confirmed',40)),60,'BC confirmé 40'],
 [demand(100,10,ol('partial',40,10)),60,'Réception partielle sans double retrait'],
 [demand(100,40,ol('received',40,40)),60,'BC reçu, solde DA restant'],
 [demand(100,40,ol('closed',40,40)),60,'BC clôturé, reçu déjà compté'],
 [demand(100,50,ol('partial',70,50),ol('confirmed',30)),0,'Approvisionnement entièrement alloué'],
 [demand(100,95,ol('confirmed',20)),0,'Bornage zéro si sur-allocation historique'],
 [demand(12.125,2.125,ol('partial',4.125,2.125)),8,'Quantité fractionnaire'],
 [demand(100,0,ol('draft',20),ol('confirmed',15),ol('partial',30,5)),60,'Brouillon ignoré, reçu non recompté'],
 ];
for(const [input,expected,why] of rows)assert.ok(Math.abs(remainingToOrder(input)-expected)<1e-8,why);
const hist=(status)=>({status,ref:'RFQ-EXAMPLE'});
assert.equal(activeConsultations([hist('open'),hist('closed')]).length,1);
assert.equal(canPrepareConsultation([hist('open')],false,''),false);
assert.equal(canPrepareConsultation([hist('open')],true,'Expiré'),false);
assert.equal(canPrepareConsultation([hist('open')],true,'Nouvel appel justifié par un retard'),true);
assert.equal(supplierOfferState({chosen:false,confirmationStatus:'pending',hasAttachment:false},'open'),'oral_pending');
assert.equal(supplierOfferState({chosen:false,confirmationStatus:'pending',hasAttachment:true},'open'),'oral_to_confirm');
assert.equal(supplierOfferState({chosen:false,confirmationStatus:'confirmed',hasAttachment:true},'open'),'ready_to_award');
const direct=read('src/app/api/p2p/sourcing/route.ts');
const grouped=read('src/app/api/p2p/consultations/route.ts');
const orders=read('src/app/api/supplier-orders/route.ts');
const approval=read('src/app/api/supplier-orders/[id]/route.ts');
const p5=read('src/components/erp/supplier-response-flow.tsx');
const readDoc=read('src/app/api/p2p/offer-documents/[id]/route.ts');
// P5.15.20 : l'attribution directe `award` de sourcing a été remplacée par le
// comparateur/plan d'attribution (P5.15.18-19, route /api/p2p/awards). Les
// contrôles PDF/4-yeux/offre orale y sont renforcés : PDF de la RÉVISION
// COURANTE exigé à la confirmation écrite, indépendance du décideur
// (proposant, créateur RFQ et validateurs exclus), autorisation centrale
// isAuthorizedSupplierQuote (PDF écrit / traçabilité orale) avant tout BC.
const awards=read('src/app/api/p2p/awards/route.ts');
for(const [fragment,label] of [
 ['if(d.qty>remainingToOrder(l)+0.000001)throw Error(\'RFQ_DEPASSE_RESTANT\')','RFQ direct reliquat contrôlé'],
 ["if(d.deadline&&new Date(d.deadline+'T23:59:59Z')<new Date())",'Date butoir RFQ contrôlée'],
 ['rfqId_supplierId:{rfqId:d.rfqId,supplierId:d.supplierId}', 'Réponse fournisseur unique'],
 ['FOURNISSEUR_NON_INVITE','Invitations fournisseurs'],
 ["if(!offer.attachments.some(a=>a.revisionNo===offer.revisionNo))throw Error('PDF_CONFIRMATION_REQUIS')",'PDF (révision courante) pour confirmation écrite'],
 ["if(rfq.createdBy===actor.username)throw Error('AUTO_DECISION')",'Quatre yeux décision responsable (report)'],
 ["approvalIsIndependent(plan.proposedBy,actor.username,plan.rfq.createdBy,offers)",'Quatre yeux approbation plan'],
 ["if(plan.decidedBy===actor.username)throw Error('RESPONSABLE_NE_CREE_PAS_BC')",'Décideur distinct du générateur de BC'],
 ["if(!offer.chosen||!offer.approvedBy||!isAuthorizedSupplierQuote({...offer,attachments}))throw Error('OFFRE_NON_AUTORISEE')",'PDF écrit / traçabilité orale exigés avant BC'],
 ])assert.ok(direct.includes(fragment)||awards.includes(fragment),label);
assert.ok(grouped.includes('remainingToOrder(row)'), 'Relicat partagé consultations');
assert.ok(grouped.includes('serializedSQLiteWrite'),'Transaction consultations');
assert.ok(orders.includes('available:remainingToOrder(l)'),'Même calcul de disponibilité côté candidats BC');
assert.ok(orders.includes('if(line.qty>remainingToOrder(r)+0.000001)'),'Même calcul de disponibilité création BC');
for(const fragment of ['DA_OVERALLOCATED','SELF_APPROVAL','REVISER_SELF_APPROVAL','SUPPLIER_NOT_QUALIFIED','PRICE_NOT_AUTHORIZED'])assert.ok(approval.includes(fragment), `BC guard: ${fragment}`);
assert.ok(p5.includes('onAction(\'confirmOffer\''));
assert.ok(readDoc.includes("createHash('sha256')") && readDoc.includes("'Cache-Control':'private, no-store'"));
assert.ok(read('src/app/api/p2p/offer-documents/route.ts').includes("file.size>MAX_PDF_BYTES"));
assert.ok(read('src/app/api/p2p/consultations/line-status/route.ts').includes('readRoleGate'));
const req=createRequire(import.meta.url);
let ts;try{ts=req('typescript')}catch{ts=req('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript')};
const updated = ['src/lib/purchase-availability.ts','src/app/api/p2p/sourcing/route.ts','src/app/api/p2p/consultations/route.ts','src/app/api/supplier-orders/route.ts'];
for(const file of updated){const ast=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 assert.deepEqual(ast.parseDiagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')),[], `Syntaxe ${file}`)}
console.log(`PASS P5.14.8 : ${rows.length} scenarios de reliquat exécutés, reprises RFQ, justificatifs/4-yeux, routes cohérentes et AST de ${updated.length} fichiers.`);
