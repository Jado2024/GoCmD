"""V18.9.1 — contre-contre-audit : contrats sources des corrections du contre-audit indépendant.
Vérifications hors ligne (lecture de code + base témoin). Les parcours HTTP complets
sont couverts par tests/http-v1891-remediation.cjs."""
import pathlib, sqlite3, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
files = {name: (ROOT / name).read_text(encoding="utf-8") for name in [
    "src/app/api/dashboard/route.ts",
    "src/app/api/supplier-returns/route.ts",
    "src/app/api/goods-receipts/route.ts",
    "src/app/api/quality-inspections/route.ts",
    "src/app/api/supplier-invoices/route.ts",
    "src/app/api/supplier-invoices/[id]/route.ts",
    "src/app/api/p2p/accounting-export/route.ts",
    "src/app/api/suppliers/route.ts",
    "src/app/api/supplier-orders/route.ts",
    "src/app/api/purchases/route.ts",
    "src/app/api/stock-lots/route.ts",
    "src/app/api/p2p/overview/route.ts",
    "src/app/api/orders/route.ts",
    "src/lib/sqlite-write.ts",
    "src/lib/access-gate.ts",
    "src/lib/erp-types.ts",
    "src/components/erp/supply-chain-view.tsx",
    "src/components/erp/p2p-control-view.tsx",
    "src/components/erp/dashboard-view.tsx",
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

# A-01 : archive reproductible — nom ASCII, test mis à jour, aucun nom non ASCII
check("A-01 doc historique renommé ASCII", (ROOT / "docs/historique/README_V18_5_AUDIT_REMEDIATIONS.md").is_file())
check("A-01 ancien nom accentué absent", not (ROOT / "docs/historique/README_V18_5_AUDIT_REMÉDIATIONS.md").exists())
check("A-01 test v187 référence le nom ASCII",
      "README_V18_5_AUDIT_REMEDIATIONS.md" in (ROOT / "tests/test_v187_audit.py").read_text(encoding="utf-8"))
non_ascii = [str(p.relative_to(ROOT)) for p in ROOT.rglob("*")
             if p.is_file() and any(ord(c) > 127 for c in str(p.relative_to(ROOT)))
             and ".git/" not in str(p) and "node_modules" not in str(p) and ".next" not in str(p)]
check("A-01 aucun nom de fichier non ASCII dans le projet", not non_ascii)

# A-02 : retour conditionné par avoir approuvé suffisant + consommation liée
sr = files["src/app/api/supplier-returns/route.ts"]
coverage_lib = (ROOT / "src/lib/supplier-credit-coverage.ts").read_text(encoding="utf-8")
check("A-02 garde avoir approuvé non consommé", 'c.status === "approved"' in coverage_lib and "planCreditAllocation(pool,returnCents)" in sr)
check("A-02 couverture de la valeur retournée au prix facturé", "coveredCents<returnCents" in sr)
check("A-02 consommation atomique des avoirs", "creditNotesConsumed" in sr)
check("A-02 l'ancien blocage inconditionnel est retiré",
      "supplierInvoiceLine.count({where:{receiptLineId:lot.receiptLineId,invoice:{status:{in:[" not in sr)

# A-03 : DTO dashboard par rôle
dash = files["src/app/api/dashboard/route.ts"]
check("A-03 rôles commerciaux définis, hors admin", 'COMMERCIAL_ROLES = ["sales", "finance"]' in dash and 'COMMERCIAL_ROLES = ["sales", "finance", "admin"]' not in dash)
check("A-03 client masqué hors rôles commerciaux", "canSeeCommercial ? o.client : null" in dash)
check("A-03 montant masqué hors rôles commerciaux", "canSeeCommercial ? o.lines.reduce" in dash)
# A-03 pipelineValue : la propriété RBAC exigée est le CONDITIONNEMENT par
# canSeeCommercial. Depuis PERF-02 (R13.3), la valeur vient d'un agrégat SQL
# (pipelineRow) au lieu du reduce JS en mémoire — la liaison au rôle reste
# obligatoire, quelle que soit la source de la valeur.
check("A-03 pipelineValue conditionné", "canSeeCommercial\n    ? Number(pipelineRow[0]?.total ?? 0)" in dash)
types = files["src/lib/erp-types.ts"]
check("A-03 type DashboardUpcomingDTO avec client nullable", "client: ClientDTO | null" in types)

# A-04 : péremption en BR + préservation aux transitions
gr = files["src/app/api/goods-receipts/route.ts"]
check("A-04 schéma BR accepte expiresAt", "expiresAt:z.iso.date().optional()" in gr)
check("A-04 lot disponible porte la péremption", 'expiresAt:expiryOf(entry.expiresAt)}})' in gr)
qi = files["src/app/api/quality-inspections/route.ts"]
check("A-04 transitions qualité préservent receivedAt/expiresAt",
      "receivedAt:from.receivedAt,expiresAt:from.expiresAt" in qi)
check("A-04 retour préserve les dates", "receivedAt:lot.receivedAt,expiresAt:lot.expiresAt" in sr)
ui = files["src/components/erp/supply-chain-view.tsx"]
check("A-04 colonne Péremption dans le formulaire BR", "Péremption (facultatif)" in ui)

# A-05 : rejet motivé d'une facture bloquée
inv_id = files["src/app/api/supplier-invoices/[id]/route.ts"]
check("A-05 action reject sur facture bloquée", 'z.literal("reject")' in inv_id)
check("A-05 quatre-yeux sur le rejet", "SELF_REJECTION" in inv_id)
check("A-05 motif de rejet persisté", "rejectionReason:p.data.reason" in inv_id)
inv = files["src/app/api/supplier-invoices/route.ts"]
check("A-05 facture rejetée libère le facturable", '!["blocked","rejected"].includes(l.invoice.status)' in inv)
schema = files["prisma/schema.prisma"]
check("A-05 colonnes de rejet au schéma", "rejectedBy String?" in schema and "rejectionReason String?" in schema)
ctrl = files["src/components/erp/p2p-control-view.tsx"]
check("A-05 bouton UI Rejeter la facture", "Rejeter la facture" in ctrl)
check("A-05 statut Rejetée affiché", 'rejected:"Rejetée"' in ctrl)

# A-06 : fret exporté au journal
exp = files["src/app/api/p2p/accounting-export/route.ts"]
check("A-06 ligne FRET dédiée", '"FRET"' in exp and "freight.toFixed(2)" in exp)
check("A-06 signal de troncature", "X-Truncated" in exp and "X-Total-Count" in exp)

# A-07 : entiers sûrs
check("A-07 garde centimes sûrs factures", "Number.isSafeInteger(htCents)" in inv)
check("A-07 garde fret/total sûrs", "Number.isSafeInteger(totalCents+freightCents)" in inv)
orders = files["src/app/api/orders/route.ts"]
check("A-07 garde symétrique côté ventes", "Number.isSafeInteger(Math.round(l.qty * l.unitPrice * 100))" in orders)

# A-09 : RBAC lecture
gate = files["src/lib/access-gate.ts"]
check("A-09 helper lecture multi-rôles", "readRoleGate" in gate and "hasAnyReadRole" in gate)
sup = files["src/app/api/suppliers/route.ts"]
check("A-09 tarifs fournisseurs sanités", 'unitPrice:pricing?l.unitPrice:null' in sup)
so = files["src/app/api/supplier-orders/route.ts"]
check("A-09 prix BC sanités", 'unitPrice:pricing?l.unitPrice:null' in so)
pur = files["src/app/api/purchases/route.ts"]
# P5.15.8 : le rôle admin est géré centralement dans readRoleGate (contrôle
# isRoot), les routes listent les rôles métier ; la lecture DA reste restreinte.
check("A-09 lecture DA restreinte", 'readRoleGate(req, ["buyer", "approver"])' in pur)

# A-11 : P2002 non rejouable sauf références générées
sw = files["src/lib/sqlite-write.ts"]
check("A-11 P2002 classé selon la cible", 'code === "P2002"' in sw)
check("A-11 seuls ref/clé lot restent rejouables", "generatedRef || lotUpsertKey" in sw)

# A-12 : alertes exactes
sl = files["src/app/api/stock-lots/route.ts"]
check("A-12 alerte péremption requête dédiée", "expiredLotsTruncated" in sl)
check("A-12 plus de calcul sur les 200 affichés", "const expired=items.filter" not in sl)
ov = files["src/app/api/p2p/overview/route.ts"]
check("A-12 agrégats exacts overview", "groupBy" in ov and "aggregate" in ov and "db.goodsReceipt.count()" in ov)

# A-13 : CSP — V18.9.2 (contre-audit F07) : APPLIQUÉE avec nonce par requête
# (src/proxy.ts), plus de Report-Only, plus d'unsafe-inline dans script-src.
nc = files["next.config.ts"]
proxy = (ROOT / "src/proxy.ts").read_text(encoding="utf-8")
check("A-13 CSP appliquée via proxy avec nonce", "nonce-" in proxy and "Content-Security-Policy" in proxy)
check("A-13 CSP plus en Report-Only", "Content-Security-Policy-Report-Only" not in nc and "Report-Only" not in proxy)
check("A-13 strict-dynamic sans unsafe-inline sur les scripts", "'strict-dynamic'" in proxy and "script-src 'self' 'unsafe-inline'" not in proxy)
check("A-13 object-src none + frame-ancestors none", "object-src 'none'" in proxy and "frame-ancestors 'none'" in proxy)

# Base témoin : colonnes de rejet présentes, intégrité intacte
with sqlite3.connect(f"file:{ROOT}/db/custom.db?mode=ro", uri=True) as db:
    cols = {r[1] for r in db.execute("PRAGMA table_info(SupplierInvoice)")}
    check("A-05 colonnes rejet en base", "rejectedBy" in cols and "rejectionReason" in cols)
    check("intégrité base témoin", db.execute("PRAGMA integrity_check").fetchone()[0] == "ok")
    check("FK base témoin", not db.execute("PRAGMA foreign_key_check").fetchall())

print(f"PASS V18.9.1: contre-audit intégré — {checks} contrôles sources+base (A-01→A-13, A-15 via packaging)")
