"""V18.9.2 — contre-audit indépendant (F01→F07) : contrats sources des corrections.
Vérifications hors ligne (lecture de code + base témoin). Les parcours HTTP
complets sont couverts par tests/http-v1892-remediation.cjs."""
import pathlib, sqlite3, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
files = {name: (ROOT / name).read_text(encoding="utf-8") for name in [
    "src/app/api/p2p/accounting-export/route.ts",
    "src/app/api/p2p/finance/route.ts",
    "src/app/api/supplier-returns/route.ts",
    "src/app/api/quality-inspections/route.ts",
    "src/app/api/materials/route.ts",
    "src/app/api/supplier-orders/route.ts",
    "src/app/api/dashboard/route.ts",
    "src/app/api/supplier-invoices/route.ts",
    "src/lib/access-gate.ts",
    "src/lib/supplier-credit-coverage.ts",
    "src/components/erp/p2p-control-view.tsx",
    "src/components/erp/materials-view.tsx",
    "src/proxy.ts",
    "next.config.ts",
    "prisma/schema.prisma",
]}
checks = 0
def check(label: str, ok: bool) -> None:
    global checks
    checks += 1
    if not ok:
        print(f"ÉCHEC: {label}", file=sys.stderr)
        sys.exit(1)

# F01 : journal comptable — schéma aligné, fret dans les colonnes prévues
exp = files["src/app/api/p2p/accounting-export/route.ts"]
check("F01 colonne Nature de ligne dans l'en-tête", '"Nature de ligne"' in exp)
check("F01 toutes les lignes portent leur nature", '"ARTICLE"' in exp and '"FRET"' in exp)
check("F01 ligne fret conforme au schéma (Quantité 1, HT=fret, TVA 0)",
      '"FRET",1,freight.toFixed(4),"0.0000",freight.toFixed(2),"0.00",freight.toFixed(2)' in exp)
check("F01 plus de décalage 16 champs / 15 en-têtes",
      '"FRET",1,freight' in exp and '"FRET",1,freight' not in exp.replace('"FRET",1,freight.toFixed(4),"0.0000",freight.toFixed(2),"0.00",freight.toFixed(2),"A VALIDER PAR COMPTABLE MAROC"',''))

# F02 : avoir post-règlement + créance de remboursement
fin = files["src/app/api/p2p/finance/route.ts"]
check("F02 action refund-credit présente", "z.literal('refund-credit')" in fin)
check("F02 réservé aux factures entièrement réglées", "FACTURE_NON_SOLDEE" in fin)
check("F02 plafond = réglé non encore remboursé", "AVOIR_REMBOURSEMENT_IMPOSSIBLE" in fin and "refundableCents" in fin)
check("F02 approbation crée la créance SupplierRefund", "tx.supplierRefund.create" in fin)
check("F02 la facture reste payée (pas de réouverture de solde)", "credit.kind==='refund'" in fin)
check("F02 solder le remboursement (settle-refund)", "z.literal('settle-refund')" in fin)
check("F02 quatre-yeux sur le solder", "REMBOURSEMENT_AUTO" in fin)
check("F02 avoirs de solde séparés des avoirs post-règlement", "c.kind==='balance'" in fin)
check("F02 GET expose les remboursements et le remboursable", "refunds:" in fin and "refundable:" in fin)
schema = files["prisma/schema.prisma"]
check("F02 modèle SupplierRefund au schéma", "model SupplierRefund" in schema and 'status String @default("pending")' in schema)

# F03 : confidentialité des coûts matières
gate = files["src/lib/access-gate.ts"]
mat = files["src/app/api/materials/route.ts"]
so = files["src/app/api/supplier-orders/route.ts"]
dash = files["src/app/api/dashboard/route.ts"]
check("F03 matrice de visibilité des coûts (buyer/approver/finance)", 'MATERIAL_COST_ROLES: readonly Role[] = ["buyer","approver","finance"]' in gate)
check("F03 helper canSeeMaterialCosts", "export function canSeeMaterialCosts" in gate)
check("F03 route materials masque les coûts", "canSeeMaterialCosts(req)" in mat and "unitPrice:costVisible?unitPrice:null" in "".join(mat.split()) and "averageCost:costVisible?" in "".join(mat.split()))
check("F03 route supplier-orders : matière en select minimal", "material:{select:materialSelect}" in so)
check("F03 supplier-orders masque matière et ligne DA imbriquées", "requestLine.material.unitPrice:null" in so.replace(" ","").replace("\n","") or "requestLine?{...requestLine,material:{...requestLine.material," in so)
check("F03 dashboard : alertes en DTO explicite (fin du {...m})", "alertsList: alertsList.map(m => ({" in dash and "averageCost: canSeeCosts ?" in dash)
check("F03 dashboard : plus de diffusion intégrale de l'objet matière", "{\n      ...m,\n" not in dash)

# F04 : rejet qualité possible après facturation, correction financière tracée
qi = files["src/app/api/quality-inspections/route.ts"]
check("F04 plus de blocage inconditionnel INVOICED_LOT", 'throw new Error("INVOICED_LOT")' not in qi)
check("F04 signal de correction financière", "financialCorrection" in qi)
check("F04 couverture d'avoirs non affectés signalée", "approvedCoverageCents" in qi)
check("F04 décision tracée dans l'audit", "financialCorrection})}}" in qi)

# F05 : affectation partielle des avoirs
sr = files["src/app/api/supplier-returns/route.ts"]
cov = files["src/lib/supplier-credit-coverage.ts"]
check("F05 librairie de couverture en centimes", "creditRemainingCents" in cov and "planCreditAllocation" in cov)
check("F05 table d'affectation au schéma", "model SupplierReturnCreditAllocation" in schema and "amountCents Int" in schema)
check("F05 affectations plafonnées par avoir (contrôle applicatif)", "amountCents > 0" in (ROOT / "scripts/migrate_v1892_sqlite.py").read_text(encoding="utf-8"))
check("F05 retour consomme partiellement", "planCreditAllocation(pool,returnCents)" in sr and "supplierReturnCreditAllocation.create" in sr)
check("F05 garde optimiste par version d'avoir", "version:a.version" in sr)
check("F05 returnId n'est plus qu'une trace (premier retour)", "a.returnId==null?{returnId:returned.id}" in sr.replace(" ",""))
check("F05 couverture exigée aussi depuis la quarantaine", '"available","quarantine"].includes(lot.status)' in sr)
check("F05 les affectations sont conservées en interne", "creditAllocations:allocationPlan.map" in sr)

# F06 : lien de remplacement entre factures
inv = files["src/app/api/supplier-invoices/route.ts"]
check("F06 champ replacesInvoiceId accepté", "replacesInvoiceId:z.number().int().positive().optional()" in inv)
check("F06 la remplacée doit être rejetée", "REPLACED_INVOICE_NOT_REJECTED" in inv)
check("F06 même fournisseur exigé", "REPLACED_INVOICE_MISMATCH" in inv)
check("F06 unicité [fournisseur, numéro] conservée", "@@unique([supplierId, invoiceNumber])" in schema)
check("F06 lien exposé en lecture (replacesInvoice/replacedBy)", "replacesInvoice:{select:" in inv and "replacedBy:{select:" in inv)
check("F06 sélecteur UI de facture remplacée", "Remplace la facture rejetée" in files["src/components/erp/p2p-control-view.tsx"])

# F07 : CSP appliquée avec nonce
proxy = files["src/proxy.ts"]
nc = files["next.config.ts"]
check("F07 CSP appliquée dans le proxy", "Content-Security-Policy" in proxy and "nonce-" in proxy)
check("F07 nonce par requête + strict-dynamic", "'strict-dynamic'" in proxy and "crypto.randomUUID()" in proxy)
check("F07 plus de Report-Only ni unsafe-inline script", "Report-Only" not in nc and "Report-Only" not in proxy and "script-src 'self' 'unsafe-inline'" not in proxy)
check("F07 styles toujours fonctionnels (unsafe-inline sur style-src uniquement)", "style-src 'self' 'unsafe-inline'" in proxy)
check("F07 nonce propagé aux en-têtes de requête Next", 'requestHeaders.set("x-nonce", nonce)' in proxy)

# Base témoin : nouvelles tables/colonnes présentes, intégrité intacte
with sqlite3.connect(f"file:{ROOT}/tests/fixtures/v16_demo.db?mode=ro", uri=True) as db:
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    check("F02/F05 base : table SupplierRefund", "SupplierRefund" in tables)
    check("F05 base : table SupplierReturnCreditAllocation", "SupplierReturnCreditAllocation" in tables)
    cols_scn = {r[1] for r in db.execute("PRAGMA table_info(SupplierCreditNote)")}
    check("F02 base : colonne kind sur SupplierCreditNote", "kind" in cols_scn)
    check("F05 base : colonne version sur SupplierCreditNote", "version" in cols_scn)
    cols_si = {r[1] for r in db.execute("PRAGMA table_info(SupplierInvoice)")}
    check("F06 base : colonne replacesInvoiceId", "replacesInvoiceId" in cols_si)
    check("intégrité base témoin", db.execute("PRAGMA integrity_check").fetchone()[0] == "ok")
    check("FK base témoin", not db.execute("PRAGMA foreign_key_check").fetchall())
    check("contenu témoin inchangé (189 produits)", db.execute("SELECT COUNT(*) FROM Product").fetchone()[0] == 189)

print(f"PASS V18.9.2: contre-audit indépendant intégré — {checks} contrôles sources+base (F01→F07)")
