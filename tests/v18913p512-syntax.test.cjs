const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const files=['src/lib/purchase-suggestions.ts','src/lib/erp-types.ts','src/components/erp/purchase-dialog.tsx','src/components/erp/consultation-dialog.tsx','src/components/erp/purchases-view.tsx','src/components/erp/p2p-advanced-view.tsx','src/app/api/p2p/consultations/route.ts','src/app/api/p2p/consultations/[id]/print/route.ts','src/app/api/materials/route.ts','src/app/api/p2p/sourcing/route.ts'];
for(const file of files){const src=fs.readFileSync(path.join(root,file),'utf8');const result=ts.transpileModule(src,{fileName:file,reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});const errors=(result.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error);assert.deepEqual(errors.map(e=>`${file}: ${ts.flattenDiagnosticMessageText(e.messageText,' ')}`),[]);}
const schema=fs.readFileSync(path.join(root,'prisma/schema.prisma'),'utf8');
for(const model of ['SupplierConsultation','SupplierConsultationLine','SupplierConsultationRecipient','SupplierConsultationRecipientLine'])assert.ok(schema.includes('model '+model+' {'),model);
assert.ok(schema.includes('consultationLine SupplierConsultationLine?'),'Relation RFQ -> consultation absente');
assert.ok(schema.includes('invitationLines SupplierConsultationRecipientLine[]'),'Relation RFQ -> destinataires absente');
console.log('PASS P5.12 : 10 sources TS/TSX transpilables ; 4 modèles relationnels déclarés');
