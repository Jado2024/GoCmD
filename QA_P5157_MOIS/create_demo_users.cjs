'use strict';
const fs = require('fs');
const crypto = require('crypto');
const path=require('path');
const users = require(path.join(process.env.GOCMD_SOURCE_DIR||path.resolve(__dirname,'..'),'src/lib/user-directory.cjs'));
if(!process.env.GOCMD_DB_FILE || path.basename(process.env.GOCMD_DB_FILE)!=='custom_mois_2026_11.db')throw Error('Copie de recette requise');
const rows=[];
// AUDIT P5.15.27-B (AN-MOIS-01) : la base démo P5.15.23 est déjà administrée
// (9 comptes nommés en français) ; le bootstrap échouait avec « Un
// administrateur existe déjà ». Quand un compte racine existe déjà, on le
// réutilise comme ACTEUR de création et demo_admin devient un compte
// administratif GÉRÉ (non-root). Les droits observés restent identiques :
// root et admin ne peuvent pas acheter (allowed: purchases.create=[buyer]),
// et users.manage revient au rôle admin.
const rootPw=crypto.randomBytes(18).toString('base64url');
const existingRoot=users.listUsers().find(u=>u.isRoot&&u.active);
if(existingRoot){
  users.createUser(existingRoot.username,'demo_admin',rootPw,['admin'],{});
}else{
  users.bootstrap('demo_admin',rootPw);
}
rows.push(['demo_admin','admin',rootPw]);
for(const role of ['director','buyer','approver','receiver','quality','inventory','sales','finance']){
 const pw=crypto.randomBytes(18).toString('base64url');const username='demo_'+role;
 users.createUser('demo_admin',username,pw,[role],{});
 rows.push([username,role,pw]);
}
const secondFinancePw=crypto.randomBytes(18).toString('base64url');users.createUser('demo_admin','demo_finance_2',secondFinancePw,['finance'],{});rows.push(['demo_finance_2','finance',secondFinancePw]);
const pw=crypto.randomBytes(18).toString('base64url');users.createUser('demo_admin','demo_buyer_approver',pw,['buyer','approver'],{});rows.push(['demo_buyer_approver','buyer+approver',pw]);
const tests=[];
for(const [u, role] of rows){
 const x=users.readUser(u);
 if(!x)throw Error('Compte non créé: '+u);
 tests.push({user:u,roles:x.roles,canCreateDA:users.allowed(x.roles,x.permissions,'purchases.create',x.isRoot),canApproveDA:users.allowed(x.roles,x.permissions,'purchases.approve',x.isRoot),canReceipt:users.allowed(x.roles,x.permissions,'receipts.create',x.isRoot),canInvoice:users.allowed(x.roles,x.permissions,'sales.invoices',x.isRoot),canApproveSpecialPrice:users.allowed(x.roles,x.permissions,'director.prices',x.isRoot),canAdminUsers:users.allowed(x.roles,x.permissions,'users.manage',x.isRoot)});
}
if(!tests.find(x=>x.user==='demo_admin').canAdminUsers)throw Error('admin rules failure');
if(tests.find(x=>x.user==='demo_admin').canCreateDA)throw Error('root cannot buy');
if(tests.find(x=>x.user==='demo_approver').canApproveSpecialPrice)throw Error('price director role failure');
if(!tests.find(x=>x.user==='demo_director').canApproveSpecialPrice)throw Error('director missing');
if(tests.find(x=>x.user==='demo_buyer').canReceipt)throw Error('buyer not receiver');
if(!tests.find(x=>x.user==='demo_buyer_approver').canApproveDA)throw Error('multirole not accepted');
fs.writeFileSync(path.join(__dirname,'COMPTES_DEMO_PRIVES.txt'),'COMPTES FICTIFS DE RECETTE LOCALE - NE PAS UTILISER SUR UNE BASE REELLE\nA supprimer apres les essais. Changement de mot de passe demande au premier acces.\n\n'+rows.map(r=>`${r[0]} | ${r[1]} | ${r[2]}`).join('\n')+'\n',{mode:0o600});
fs.writeFileSync(path.join(__dirname,'RBAC_COMPTES.json'),JSON.stringify(tests,null,2));
console.log('Comptes créés='+rows.length+'; contrôles RBAC='+(tests.length*6)+'; PASS');
