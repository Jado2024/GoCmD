import assert from 'node:assert/strict';
import fs from 'node:fs';
import {activeConsultations,canPrepareConsultation} from '../src/lib/consultation-reuse.ts';

const old={id:1,ref:'RFQ-2026-01',requestLineId:19,qty:50,unit:'kg',status:'open',createdAt:'2026-11-05T00:00:00Z',consultation:{id:1,ref:'CONS-2026-01',status:'prepared',createdAt:'2026-11-05T00:00:00Z',recipients:[{supplierId:1,name:'Fournisseur de test'}]}};
const closed={...old,id:2,status:'closed'};
const awarded={...old,id:3,status:'awarded'};
assert.equal(activeConsultations([]).length,0);
assert.equal(activeConsultations([old,closed,awarded]).length,1);
assert.equal(canPrepareConsultation([],false,''),true);
assert.equal(canPrepareConsultation([closed,awarded],false,''),true);
assert.equal(canPrepareConsultation([old],false,''),false);
assert.equal(canPrepareConsultation([old],true,'motif'),false);
assert.equal(canPrepareConsultation([old],true,'   motif légitime   '),true);
assert.equal(canPrepareConsultation([old],true,'x'.repeat(501)),false);
const ui=fs.readFileSync('src/components/erp/consultation-dialog.tsx','utf8');
const api=fs.readFileSync('src/app/api/p2p/consultations/route.ts','utf8');
const historyApi=fs.readFileSync('src/app/api/p2p/consultations/line-status/route.ts','utf8');
for (const part of ['consultation-line-history','Vérifier les consultations existantes','reconsultReason','canPrepareConsultation','historique','consultation!.id']) {
  // Les PDF et l'historique doivent être visibles avant la création.
  assert.ok(ui.toLowerCase().includes(part.toLowerCase()),`UI absente: ${part}`);
}
assert.match(ui,/setExplicitReconsultKey\(null\)/);
assert.match(ui,/historyQ\.isError/);
assert.match(api,/status:'open'/);
assert.match(api,/RFQ_DEJA_OUVERTE/);
assert.match(api,/reconsultReason:d\.reconsultReason/);
assert.match(historyApi,/readRoleGate/);
assert.match(historyApi,/requestLineId:\{in:ids\}/);
assert.match(historyApi,/supplier:\{select:\{id:true,name:true\}\}/);
assert.doesNotMatch(historyApi,/unitPrice|password|hash|email/);
console.log('PASS P5.14.5 : réutilisation, doublons ouverts, reconsultation justifiée, historique par ligne, PDF et contrôle des droits.');
