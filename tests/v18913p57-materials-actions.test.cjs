"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const ts=require("typescript");
const src=fs.readFileSync(path.join(__dirname,"../src/components/erp/materials-view.tsx"),"utf8");
const ast=ts.createSourceFile("materials-view.tsx",src,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
assert.equal(ast.parseDiagnostics.length,0,"TSX valide");
assert.match(src,/table-fixed.*canBuy\?"min-w-\[1580px\]":"min-w-\[1100px\]"/,"largeur dynamique acheteur et autres rôles");
assert.match(src,/sticky right-0 z-10 bg-white/,"actions fixes a droite du tableau déroulant");
assert.doesNotMatch(src,/MoreHorizontal|<Popover|PopoverTrigger/,"suppression du menu minimaliste et indirect");
const region=src.slice(src.indexOf("function MaterialRowActions("));
assert.match(region,/role="group" aria-label=\{`Actions sur la matière/,"regroupement accessible");
for(const [right,icon,callback,label] of [
  ["canEdit","Pencil","onEdit","Modifier la fiche"],
  ["canReceive","ArrowDownToLine","onReceive","Réception de matière"],
  ["canMove","ArrowUpFromLine","onMove","Sortie de stock"],
  ["canBuy","ShoppingCart","onBuy","Créer une demande d'achat"],
]){
  assert.match(region,new RegExp("\\{"+right+" && <Button"),"action sous permission: "+right);
  assert.match(region,new RegExp("<"+icon+" className="),"icône "+icon);
  assert.match(region,new RegExp("onClick=\\{"+callback+"\\}"),"callback "+callback);
  if(right==="canBuy") assert.match(region,/title=\{daCount>0\?"Consulter les DA existantes avant une nouvelle demande":"Créer une demande d'achat"\}/,"DA : historique ou création");
  else assert.ok(region.includes("title=\""+label+"\""),"infobulle: "+label);
}
assert.match(region,/aria-label=\{`Consulter la fiche/,"consultation toujours accessible");
assert.match(region,/onClick=\{onInspect\}/,"fiche consultable");
assert.match(region,/focus-visible:outline-2/,"navigation clavier visible");
assert.match(region,/min-w-9/,"zones cliquables cohérentes");
assert.match(src,/const canBuy=hasRole\(session\.data,"buyer"\)&&hasPermission\(session\.data,"purchases.create"\)/,"RBAC DA inchangée");
assert.match(src,/const canMove=hasRole\(session\.data,"inventory"\)/,"RBAC inventaire inchangée");
console.log("PASS P5.7 : actions directes, RBAC, tooltips, clavier, alignement, TSX");
