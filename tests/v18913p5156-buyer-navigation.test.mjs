import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {visibleViews,hasRole} from '../src/lib/role-navigation.ts';
const text=(p)=>readFileSync(new URL(p,import.meta.url),'utf8');
const actor=(roles,permissions)=>({username:'test-actor',roles,legacy:false,managed:true,permissions});
// AUDIT P5.15.27-A (resynchronisation, precedent AN-01..AN-06 P5.15.23) :
// depuis P5.15.25 (MTS), l'acheteur participe a la reconstitution du stock :
// /api/stock-planning lui accorde canPlan (buyer + purchases.create) et la
// navigation inclut 'production-planning' (Fabrication pour stock) comme vue
// supplementaire du menu. Le parcours physique guide (buyer-journey.tsx) reste
// la chaine achats en 7 etapes ; aucun module commercial/finance/administration.
const journey=['buyer-workbench','materials','purchases','suppliers','p2p-advanced','supplier-orders','goods-receipts'];
const buyerViews=['production-planning',...journey];

test('Buyer pur: parcours achats + vue reconstitution MTS, aucun module commercial/finance/administration',()=>{
 const views=visibleViews(actor(['buyer']));
 assert.deepEqual(views.filter(v=>v!=='my-account'),buyerViews);
 for(const v of ['catalogue','dashboard','orders','supplier-invoices','stock-lots','movements','users'])assert.ok(!views.includes(v),v);
});
test('Les autres métiers et les comptes multi-rôles conservent leurs droits',()=>{
 const sales=visibleViews(actor(['sales']));
 assert.ok(sales.includes('catalogue') && sales.includes('orders'));
 assert.ok(!sales.includes('buyer-workbench') && !sales.includes('goods-receipts'));
 const receiver=visibleViews(actor(['receiver']));
 assert.ok(receiver.includes('goods-receipts') && !receiver.includes('buyer-workbench'));
 const multiple=visibleViews(actor(['buyer','approver','sales']));
 for(const v of [...buyerViews,'dashboard','catalogue','orders'])assert.ok(multiple.includes(v),v);
 assert.ok(hasRole(actor(['buyer','approver']),'approver'));
});
test('Le menu buyer suit la chaîne physique de travail, sans cacher les vues multi-rôles',()=>{
 const side=text('../src/components/erp/nav-sidebar.tsx');
 const top=text('../src/components/erp/top-navigation.tsx');
 const shell=text('../src/components/erp/erp-app.tsx');
 for(const marker of ['Mon travail','Identifier et valider les besoins','Consulter les fournisseurs','Commander et suivre','Suivi des réceptions (BR)'])assert.ok(side.includes(marker),marker);
 for(const v of journey)assert.ok(side.includes('id:"'+v+'"'),v);
 assert.ok(side.includes('production-planning'),'vue Fabrication pour stock presente dans le menu');
 assert.ok(side.includes('const extra=SECTIONS.map'), 'autres rôles conservés');
 assert.ok(side.includes('isAllowed(item.id)&&!seen.has(item.id)'));
 assert.ok(top.includes('navigationSections(allowedViews,buyerMode)'));
 assert.ok(shell.includes('buyerMode={buyerMode}'));
 assert.ok(shell.includes('BUYER_WORK_VIEWS.has(view)'));
});
test('Chaque onglet a un guidage contextualisé et une navigation clavier',()=>{
 const src=text('../src/components/erp/buyer-journey.tsx');
 for(const v of journey)assert.ok(src.includes('id:"'+v+'"'));
 assert.ok(src.includes('aria-current={active===item.id'));
 assert.ok(src.includes('onClick={()=>onNavigate(item.id)}'));
 assert.ok(src.includes('aria-label="Parcours acheteur"'));
 assert.ok(src.includes('Aucune DA automatique'));
});
test('Réception acheteur = lecture seule, réceptionnaire conserve saisie',()=>{
 const page=text('../src/components/erp/supply-chain-view.tsx');
 const api=text('../src/app/api/goods-receipts/route.ts');
 assert.ok(page.includes('const canReceive=hasRole(session.data,"receiver")'));
 assert.ok(page.includes('{canReceive&&<section'));
 assert.ok(page.includes('Lecture seule : l’acheteur consulte les BR'));
 assert.ok(page.includes('Historique des BR'));
 assert.ok(api.includes('accessGate(req,"receiver")'));
 assert.ok(api.includes('export async function GET'));
});
test('BC: approbateurs peuvent consulter mais pas préparer les BC dans l’interface',()=>{
 const page=text('../src/components/erp/supply-chain-view.tsx');
 assert.ok(page.includes('{canBuy&&<section'));
 assert.ok(page.includes('La préparation des BC est réservée au rôle acheteur'));
 const api=text('../src/app/api/supplier-orders/route.ts');
 assert.ok(api.includes('accessGate(req,"buyer")'));
});
test('Poste acheteur: filtres par étape, pas de fabrication transformée en achat',()=>{
 const view=text('../src/components/erp/buyer-workbench-view.tsx');
 for(const f of ['Préparer DA','Fournisseurs manquants','Approbation','Consultations','Réceptions','Fabrication'])assert.ok(view.includes(f));
 assert.ok(view.includes("selected.foamNature==='AGGLO'"));
 assert.ok(view.includes('onOpenPurchase(selected)'));
 assert.ok(!view.includes('method:"POST"'));
});
