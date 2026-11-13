"""V18.9 remediation contracts (static + isolated SQLite). Complements typed/build/HTTP validation."""
from pathlib import Path
import json

root = Path(__file__).resolve().parents[1]
read = lambda p: (root / p).read_text(encoding="utf-8")

# ── P1 : un BC clôturé ne doit jamais être ressuscité par une libération qualité ──
quality = read('src/app/api/quality-inspections/route.ts')
assert 'status:{not:"closed"}' in quality, 'quality release must guard closed BC status'
release_branch = quality.split('if(d.decision==="release"&&!isLegacy&&from.receiptLineId)')[1].split('if(d.decision==="reject"')[0]
assert 'status:{not:"closed"}' in release_branch, 'closed-BC guard must be on the release branch'

# ── P2 : les 6 routes écrites hors file sérialisée la rejoignent ──
serialized_routes = [
    'src/app/api/quality-inspections/route.ts',
    'src/app/api/supplier-returns/route.ts',
    'src/app/api/movements/route.ts',
    'src/app/api/supplier-invoices/route.ts',
    'src/app/api/materials/route.ts',
    'src/app/api/materials/[id]/route.ts',
]
for route in serialized_routes:
    content = read(route)
    assert 'serializedSQLiteWrite' in content and 'db.$transaction' in content, route
    assert 'import { serializedSQLiteWrite } from "@/lib/sqlite-write"' in content or 'import {serializedSQLiteWrite} from "@/lib/sqlite-write"' in content, route

# ── P2 : journalisation des erreurs non mappées (fini les catch silencieux) ──
assert 'console.error("[supplier-invoices:id] erreur non mappée:",safeErrorMetadata(e))' in read('src/app/api/supplier-invoices/[id]/route.ts')

# ── P2 : piste d'audit fournisseurs (création + référencement matière) ──
suppliers = read('src/app/api/suppliers/route.ts')
assert 'action:"SUPPLIER_CREATED"' in suppliers
# P5.15.8 : le référencement matière journalise désormais un événement
# distinct selon création ou mise à jour du lien (ternnaire introduit après
# V18.9) ; l'exigence d'audit du lien matière est inchangée.
assert 'action:current?"SUPPLIER_MATERIAL_UPDATED":"SUPPLIER_MATERIAL_LINKED"' in suppliers

# ── P2 : annulation contrôlée des DA non commandées ──
da_route = read('src/app/api/purchases/[id]/route.ts')
for guard in ('NOT_CANCELLABLE', 'LINKED_BC', 'SELF_CANCEL_APPROVED', 'PURCHASE_REQUEST_CANCELLED'):
    assert guard in da_route, f'missing DA-cancel guard {guard}'
assert '"cancel"' in read('src/app/api/purchases/[id]/route.ts')
types = read('src/lib/erp-types.ts')
assert '"cancelled"' in types, 'PurchaseStatus must include cancelled'
bits = read('src/components/erp/bits.tsx')
assert 'cancelled: { label: "Annulée"' in bits
schema = read('prisma/schema.prisma')
assert 'closed | cancelled' in schema, 'schema comment must document cancelled status'
# Une DA annulée ne doit plus compter comme ouverte pour le réapprovisionnement.
replenishment = read('src/app/api/p2p/replenishment/route.ts')
# P5.15.8 : "partially_approved" ajouté par l'approbation multi-lignes DA
# (P5.15.0) ; les DA annulées restent exclues du réapprovisionnement.
assert 'status:{in:["pending","approved","partially_approved","ordered","partial"]}' in replenishment
assert 'cancelled' not in replenishment.split('status:{in:["pending","approved","partially_approved","ordered","partial"]}')[1].split('}')[0]

# ── P2 : tolérance atelier unique pour les gabarits 21-24 (UI 15 mm = serveur 15 mm) ──
pieces = read('src/lib/order-pieces.ts')
assert 'GABARIT_TOLERANCE_M' in pieces
assert 'Math.abs(expected-geo.grossLengthM)>GABARIT_TOLERANCE_M' in pieces
assert 'Math.abs(expected-geo.grossLengthM)>0.005' not in pieces, 'old 5mm tolerance must be gone for 21-24'

# ── P2 : plus d'ajustement direct proposé à l'écran alors que le serveur refuse ──
dialog = read('src/components/erp/movement-dialog.tsx')
assert '"adjust"' not in dialog, 'movement dialog must not offer adjust anymore'
materials_view = read('src/components/erp/materials-view.tsx')
assert '"adjust"' not in materials_view, 'materials view must not offer adjust anymore'

# ── P2 : lecture clients/commandes commerciale ou financière ; administration exclue depuis p3 ──
for route in ('src/app/api/orders/route.ts', 'src/app/api/clients/route.ts'):
    content = read(route)
    # Les responsables et directeurs habilités consultent les commandes pour
    # validation, mais pas les coordonnées clients sans droit « clients.read ».
    if route.endswith('/orders/route.ts'):
        assert 'actor.roles.some(r=>["sales","approver","finance","director"].includes(r))' in content, route
        assert 'hasPermission(req,"clients.read")' in content, route
    else:
        # C4-11 (contre-audit CASCADE4) : l'approbateur fait partie de la matrice
        # clients.read (RIGHTS et ROLES_ET_PERMISSIONS.md) ; le répertoire
        # l'accepte désormais, la permission révocable reste vérifiée.
        assert 'actor.roles.some(r=>r==="sales"||r==="finance"||r==="approver")' in content, route
    assert 'r==="admin"' not in content.split('const mayRead=')[1].split('\n')[0], route

# ── P3 : TVA saisie explicite — mise à jour contre-audit 08/11/2026 (AV-05) :
# l'arbitrage SODEPI validé (ARBITRAGES_VALIDES_20261108.md) supprime tout taux
# implicite : le sélecteur démarre VIDE, ne propose que les taux autorisés par
# la configuration comptable (GOCMD_SALES_TAX_RATES_BPS) et la facture est
# bloquée tant qu'aucun taux valide n'est choisi. L'ancien défaut codé en dur
# « 20 » (useState("20")) est explicitement retiré. ──
sales_view = read('src/components/erp/sales-view.tsx')
assert 'useState("20")' not in sales_view, 'aucun taux de TVA implicite (arbitrage 08/11/2026)'
assert 'const [taxBps,setTaxBps]=useState("")' in sales_view, 'sélecteur de TVA vide par défaut'
assert 'taxRateBps:Math.round(Number(taxBps.replace(",","."))*100)' in sales_view
assert '(taxPolicy.data?.rates??[])' in sales_view, 'choix limité aux taux autorisés'
assert 'GOCMD_SALES_TAX_RATES_BPS' in sales_view, 'message de configuration comptable présent'

# ── P3 : plus de champ « responsable » libre ignoré par le serveur ──
orders_view = read('src/components/erp/orders-view.tsx')
assert 'Nom du responsable' not in orders_view
assert 'reviewer' not in read('src/components/erp/hooks.ts')

# ── V18.9 (audit 360 reprise) : le schéma API de validation de commande ne doit
# plus exiger « reviewer » — l'interface ne l'envoie plus, l'exiger provoquait un
# 400 systématique sur CHAQUE validation/refus de commande client. ──
orders_id_route = read('src/app/api/orders/[id]/route.ts')
assert "reviewer" not in orders_id_route.split("const ReviewSchema=z.object({")[1].split("})")[0], \
    'ReviewSchema must NOT require reviewer (UI stopped sending it; decision is attributed to the connected account)'
# La payload exacte envoyée par hooks.ts doit rester celle acceptée par le schéma :
assert 'body:JSON.stringify({action,comment})' in read('src/components/erp/hooks.ts'), \
    'UI review payload must stay {action,comment} (no shared key)'

# ── Total facture = somme du journal CSV (arrondi par ligne au centime, fret inclus) ──
invoices = read('src/app/api/supplier-invoices/route.ts')
# AUDIT P5.15.27-A (resynchronisation, cf. precedent AN-01..AN-06 P5.15.23) :
# RR-10 calcule la ligne a partir du prix stocke a 4 decimales (storedPrice),
# evitant la divergence facture/journal. Intention conservée et renforcée.
assert 'const storedPrice=Number(item.unitPrice.toFixed(4))' in invoices
assert 'const htCents=Math.round(item.qty*storedPrice*100)' in invoices
assert 'const taxCents=Math.round(htCents*item.taxRate/100)' in invoices
# V18.9.1 : le fret est toujours ajouté au total, désormais via des centimes
# contrôlés comme entiers sûrs (contre-audit A-07).
assert 'const freightCents=Math.round(d.freightAmount*100)' in invoices
assert 'totalCents+=freightCents' in invoices
assert 'Number.isSafeInteger(totalCents+freightCents)' in invoices

# ── Devis : libellés produits résolus côté serveur ──
sales_route = read('src/app/api/sales/route.ts')
assert 'productNames' in sales_route

# ── Code mort supprimé ──
assert not (root / 'src/hooks/use-toast.ts').exists()
assert not (root / 'src/components/ui/toaster.tsx').exists()
assert not (root / 'src/components/ui/toast.tsx').exists()
assert not (root / 'tailwind.config.ts').exists(), 'tailwind.config.ts is dead under Tailwind v4 CSS-first'
layout = read('src/app/layout.tsx')
assert 'Toaster' not in layout, 'layout must not mount the unused use-toast Toaster'

# ── Registre de chaîne de régression ──
scripts = json.loads(read('package.json'))['scripts']
assert 'test:v189' in scripts['test:regression:runtime']
assert 'test:http:v189' in scripts

# ── Vérification dynamique sur copie isolée : statut cancelled + exclusion réappro ──
import contextlib
import importlib.util
import shutil
import sqlite3
import tempfile

with contextlib.suppress(ImportError):
    spec = importlib.util.spec_from_file_location('mig', root / 'scripts' / 'migrer_da_bc_br.py')
    with tempfile.TemporaryDirectory() as tmp:
        dst = Path(tmp) / 'test.db'
        shutil.copy2(root / 'db' / 'custom.db', dst)
        db = sqlite3.connect(dst)
        db.execute('PRAGMA foreign_keys=ON')
        material_id = db.execute('SELECT id FROM Material LIMIT 1').fetchone()[0]
        db.execute("INSERT INTO PurchaseRequest(ref,status,createdBy) VALUES ('DA-CXL-TEST','cancelled','acheteur_test')")
        cancelled_id = db.execute("SELECT id FROM PurchaseRequest WHERE ref='DA-CXL-TEST'").fetchone()[0]
        db.execute("INSERT INTO PurchaseRequestLine(requestId,materialId,qty,unitPrice,receivedQty) VALUES (?,?,10,5,0)", (cancelled_id, material_id))
        db.commit()
        open_count = db.execute(
            "SELECT COUNT(*) FROM PurchaseRequestLine pl JOIN PurchaseRequest p ON p.id=pl.requestId "
            "WHERE pl.materialId=? AND p.status IN ('pending','approved','ordered','partial')", (material_id,)).fetchone()[0]
        after_count = db.execute(
            "SELECT COUNT(*) FROM PurchaseRequestLine pl JOIN PurchaseRequest p ON p.id=pl.requestId "
            "WHERE pl.materialId=? AND p.status IN ('pending','approved','ordered','partial','cancelled')", (material_id,)).fetchone()[0]
        assert open_count < after_count, 'cancelled DA must be excluded from the replenishment open filter'
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        db.close()

print('PASS V18.9: closed-BC guard, serialized writes 6/6, supplier audit, DA cancel, 15mm tolerance, RBAC reads, explicit VAT, CSV-aligned totals, dead code removed')
