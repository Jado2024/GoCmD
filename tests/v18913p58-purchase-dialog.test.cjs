"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname,"..");
const source = fs.readFileSync(path.join(root,"src/components/erp/purchase-dialog.tsx"),"utf8");
const listing = fs.readFileSync(path.join(root,"src/components/erp/purchases-view.tsx"),"utf8");
const api = fs.readFileSync(path.join(root,"src/app/api/purchases/route.ts"),"utf8");
const prisma = fs.readFileSync(path.join(root,"prisma/schema.prisma"),"utf8");

// Parse TSX (pas seulement des chaînes) : le parseur TypeScript est fourni par les dépendances du projet.
const ts = require("typescript");
for(const [name,code] of [["purchase-dialog.tsx",source],["purchases-view.tsx",listing]]){
 const ast=ts.createSourceFile(name,code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 assert.equal(ast.parseDiagnostics.length,0,`${name} doit être du TSX syntaxiquement valide`);
}
// Le serveur attend déjà un fournisseur et une date facultatifs.
assert.match(api,/supplier:\s*z\.string\(\)\.max\(120\)\.optional\(\)\.nullable\(\)/);
assert.match(api,/expectedDate:\s*z\.string\(\)\.datetime\(\)\.optional\(\)\.nullable\(\)/);
assert.match(api,/unitPrice:\s*m\.unitPrice/,"prix indicatif conservé côté serveur");
assert.match(prisma,/model PurchaseRequest\s*\{/);
// Affichage confortable : seul le corps défile ; l'entête et les actions ne défilent pas.
assert.match(source,/h-\[min\(92dvh,820px\)\]/,"hauteur responsive");
assert.match(source,/sm:max-w-\[980px\]/,"modal élargie");
assert.equal((source.match(/overflow-y-auto/g)||[]).length,1,"une seule zone de défilement vertical");
assert.doesNotMatch(source,/overflow-x-auto/,"pas de scrollbar horizontale");
assert.ok(source.indexOf("min-h-0 flex-1 space-y-5 overflow-y-auto")<source.indexOf("Actions stables"),"footer indépendant du scroll");
assert.match(source,/shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white/,"footer fixe");
// La DA exprime le besoin : aucune saisie prix, total ou calcul client trompeur.
assert.doesNotMatch(source,/<TableHead[^>]*>PU<\/TableHead>|Montant estimé\s*:|fmtMAD\(|<TableHead[^>]*>Total<\/TableHead>/);
assert.match(source,/Quantité demandée/,"quantité avec unité");
assert.match(source,/parsePurchaseQuantity\(draft,\s*material\.unit\)/,"validation selon l’unité de stock");
assert.match(source,/buildPurchaseRequestLines/,"utilise le garde existant");
assert.match(source,/disabled=\{!canSubmit\}/,"bloque la soumission invalide");
assert.match(source,/MAX_PURCHASE_LINES/,"limite du nombre de lignes conservée");
// Aucune date et aucun fournisseur imposés ; visibilité des options sur demande.
assert.match(source,/useState\(""\) \/\/ Pas de date imposée/,"date vierge au démarrage");
assert.match(source,/useState\(""\) \/\/ Pas de fournisseur présélectionné/,"aucun fournisseur préchoisi");
assert.match(source,/expectedDate: expectedDate \? new Date/,"date null si absente");
assert.match(source,/supplier: supplier \|\| null/,"fournisseur null si absent");
assert.match(source,/aria-expanded=\{showOptions\}/,"options repliables accessibles");
assert.match(source,/Recherche|Rechercher une matière/,"recherche de matière");
assert.match(source,/materials\.slice\(0, maxSuggestions\)/,"résultats progressifs sans deuxième scroll");
assert.match(source,/urgentDateMissing = urgent && !expectedDate/,"date exigée uniquement pour urgence");
assert.match(source,/noteToSave = urgent/,"urgence tracée dans le champ note existant");
assert.match(source,/`URGENT —/,"mention urgente lisible");
assert.match(listing,/Estimation interne/,"montant existant explicitement désigné comme estimation");
assert.match(listing,/date souhaitée :/,"date facultative correctement présentée dans le détail");
assert.match(listing,/p.note\?\.startsWith\("URGENT —"\)/,"urgence signalée dans la liste de validation");
assert.match(listing,/Motif \/ priorité/,"motif / priorité consultable par approbateur");
console.log("PASS P5.8 : TSX, modal accessible, un seul scroll, DA simplifiée, validation, API et schéma conservés");
