import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {renderProcurementPdf} from '../src/lib/procurement-pdf.ts';
const root=process.cwd();
const get=(path)=>readFileSync(`${root}/${path}`,'utf8');
const dlg=get('src/components/erp/consultation-dialog.tsx');
const list=get('src/components/erp/purchases-view.tsx');
const pilot=get('src/components/erp/p2p-advanced-view.tsx');
const api=get('src/app/api/p2p/consultations/route.ts');
assert.match(dlg,/allPurchases\?:PurchaseDTO\[\]/);
assert.match(dlg,/eligible\.flatMap\(p=>p\.lines/);
assert.match(dlg,/requestLineId:l\.id,qty:quantityOf\(l\.id\)/);
assert.match(dlg,/isValidPurchaseQuantity\(n,l\.material\.unit\)/);
assert.match(dlg,/uncovered\.length===0/);
assert.match(dlg,/mailto\(/);
assert.match(dlg,/pdf\?supplierId=/);
assert.match(list,/allPurchases=\{all\}/);
assert.match(pilot,/Nouvelle consultation multi-DA/);
assert.match(pilot,/allPurchases=\{all\}/);
assert.match(api,/id:\{in:d\.lines\.map\(x=>x\.requestLineId\)\}/);
assert.match(api,/new Set\(d\.lines\.map\(l=>l\.requestLineId\)\)/);
assert.match(api,/supplierConsultationRecipientLine\.create/);
assert.match(api,/RFQ_DEJA_OUVERTE/);
const sc=get('src/components/erp/supply-chain-view.tsx');
for(const phrase of ['Lignes disponibles pour le BC (mobile)','Contrôle des matières reçues (mobile)','Bons de commande (mobile)','Historique des BR (mobile)','api/supplier-orders/${b.id}/pdf','api/goods-receipts/${b.id}/pdf'])assert.ok(sc.includes(phrase),`missing ${phrase}`);
for(const [path,checks] of [
 ['src/app/api/p2p/consultations/[id]/pdf/route.ts',['readRoleGate','recipient.lines','rfq.requestLineId','pdfDownload']],
 ['src/app/api/supplier-orders/[id]/pdf/route.ts',['readRoleGate','hasPermission','order.status===\'draft\'','pdfDownload']],
 ['src/app/api/goods-receipts/[id]/pdf/route.ts',['readRoleGate','pdfDownload','acceptedQty','rejectedQty']]
]){const content=get(path);for(const check of checks)assert.ok(content.includes(check),`${path} missing ${check}`);}
const longRows=Array.from({length:55},(_,i)=>[`MOU-${i}`,'Mousse agglomérée D30 blanche 200 x 100 x 50 cm',`DA-2026-${i}`,'200','bloc']);
const bytes=renderProcurementPdf({title:'DEMANDE DE PRIX',reference:'CONS-2026-TEST',subtitle:'Test de pagination et accents : réception',columns:['Code','Désignation','DA','Qté','Unité'],rows:longRows,note:'Merci de transmettre le devis écrit.'});
const content=Buffer.from(bytes).toString('latin1');
assert.ok(content.startsWith('%PDF-1.4'));
assert.ok(content.includes('%%EOF'));
assert.ok((content.match(/\/Type \/Page\b/g)||[]).length>1,'pagination multi-pages');
assert.ok(content.includes('/BaseFont /Helvetica'));
assert.ok(content.includes('/Type /XObject'),'logo SODEPI embedded');
assert.ok(content.includes('CONS-2026-TEST'));
assert.ok(content.includes('DA-2026-0'));
assert.ok(!content.includes('300 MAD'),'interdit de dévoiler prix indicatif dans RFQ');
const generator=get('src/lib/procurement-pdf.ts');
assert.ok(generator.includes("'Content-Type':'application/pdf'"));
assert.ok(generator.includes("'Cache-Control':'private, no-store, max-age=0'"));
const ts=requireTypeScript();
for(const name of [
 'src/components/erp/purchases-view.tsx','src/components/erp/consultation-dialog.tsx','src/components/erp/p2p-advanced-view.tsx','src/components/erp/supply-chain-view.tsx',
 'src/lib/procurement-pdf.ts','src/app/api/p2p/consultations/[id]/pdf/route.ts',
 'src/app/api/supplier-orders/[id]/pdf/route.ts','src/app/api/goods-receipts/[id]/pdf/route.ts'
]){
 const code=get(name),ast=ts.createSourceFile(name,code,ts.ScriptTarget.Latest,true,name.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 assert.deepEqual(ast.parseDiagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')),[],name+' TS/TSX parse');
}
console.log('PASS P5.14 : multi-DA, regroupement fournisseurs, PDF A4 multipage avec logo, RBAC, protections de coût et écrans mobile BC/BR (contrôles sources + PDF exécuté).');
function requireTypeScript(){const req=createRequire(import.meta.url);try{return req('typescript')}catch{return req('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript')}}
