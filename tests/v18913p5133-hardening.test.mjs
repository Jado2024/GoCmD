import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { presentPurchase } from '../src/lib/purchase-response.ts'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const get=(file)=>fs.readFileSync(path.join(root,file),'utf8')
const require=createRequire(import.meta.url)
const ts=require('typescript')

// Executable regression: no restricted-cost fields anywhere in returned purchase data.
const fixture={id:42,ref:'DA-TEST',status:'pending',lines:[{id:1,qty:2,unitPrice:40,receivedQty:0,material:{id:12,name:'D30',unitPrice:55,averageCost:'29.8',stockQty:0,unit:'bloc'}}]}
const denied=presentPurchase(fixture,false)
assert.equal(denied.total,null)
assert.equal(denied.lines[0].unitPrice,null)
assert.equal(denied.lines[0].material.unitPrice,null)
assert.equal(denied.lines[0].material.averageCost,null)
assert.equal(denied.lines[0].material.name,'D30')
assert.equal(fixture.lines[0].unitPrice,40,'DTO may not mutate DB input')
const granted=presentPurchase(fixture,true)
assert.equal(granted.total,80)
assert.equal(granted.lines[0].unitPrice,40)
assert.equal(granted.lines[0].material.averageCost,'29.8')
assert.equal(presentPurchase({...fixture,lines:[{...fixture.lines[0],unitPrice:null}]},true).total,110)

const purchaseApi=get('src/app/api/purchases/route.ts')
const purchasePatch=get('src/app/api/purchases/[id]/route.ts')
assert.match(purchaseApi,/presentPurchase\(p,\s*canReadCosts\)/)
assert.match(purchaseApi,/presentPurchase\(pr,\s*canSeeMaterialCosts\(req\)\)/)
assert.match(purchasePatch,/presentPurchase\(result\.purchase,\s*canSeeMaterialCosts\(req\)\)/)
const suppliers=get('src/app/api/suppliers/route.ts')
const supplierUI=get('src/components/erp/supplier-management.tsx')
assert.match(suppliers,/qualifications:\{select:\{status:true,expiresAt:true\}/)
assert.match(supplierUI,/Qualification nécessaire avant l'approbation d'un BC/)
assert.match(supplierUI,/qualificationStatus/)
const dialog=get('src/components/erp/purchase-dialog.tsx')
// AUDIT P5.15.27-A (resynchronisation stock cible P5.15.26, precedent AN-01..AN-06) :
// la proposition vise desormais le stock cible sinon le seuil minimum ; le
// double-min historique reste interdit. Intention conservee.
assert.match(dialog,/Math\.max\(\(material\.targetStock\?\?material\.minStock\) - material\.stockQty, 1\)/)
assert.doesNotMatch(dialog,/minStock \* 2 - material\.stockQty/)
assert.match(dialog,/setMaxSuggestions\(n=>n\+8\)/)
const view=get('src/components/erp/purchases-view.tsx')
assert.match(view,/Contrôler avant d'approuver/)
assert.match(view,/Demandes d'achat \(affichage mobile\)/)
const sourcing=get('src/components/erp/p2p-advanced-view.tsx')
// P5.15.18 : l'attribution multi-sources vit dans AwardPlanPanel (comparateur dédié),
// plus dans un formulaire générique de la vue avancée.
const awardPanel=get('src/components/erp/award-plan-panel.tsx')
assert.match(awardPanel,/allocations=selected\.map/)
assert.match(awardPanel,/Retenir ces sources/)
assert.match(sourcing, /label:'Offre orale à confirmer',source:'offers',kind:'select'/)
const supply=get('src/components/erp/supply-chain-view.tsx')
assert.match(supply,/localeCompare\(b\.expectedDate\?\?b\.createdAt\?\?""\)/)

for(const name of [
 'src/lib/purchase-response.ts','src/app/api/purchases/route.ts','src/app/api/purchases/[id]/route.ts',
 'src/app/api/suppliers/route.ts','src/components/erp/purchase-dialog.tsx',
 'src/components/erp/supplier-management.tsx','src/components/erp/purchases-view.tsx',
 'src/components/erp/p2p-advanced-view.tsx','src/components/erp/supply-chain-view.tsx']){
 const code=get(name)
 const ast=ts.createSourceFile(name,code,ts.ScriptTarget.Latest,true,name.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS)
 assert.deepEqual(ast.parseDiagnostics.map(d=>`${name}: ${ts.flattenDiagnosticMessageText(d.messageText,' ')}`),[],`Syntaxe TS/TSX ${name}`)
}
console.log('PASS P5.13.3 : confidentialité des DA (exécution), parcours fournisseurs, quantités, suggestions, validations, UI mobile, sélections de devis et syntaxe TS/TSX')
