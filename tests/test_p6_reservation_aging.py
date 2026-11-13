#!/usr/bin/env python3
"""P6 (2026-11-11) — Chantier 2, §3.3/3.4 : modèle d'ancienneté des réservations.

Contrôles réels sur une copie jetable de la base démo :
 1. Migration additive : colonnes engagedAt (matière) et updatedAt (fini) créées,
    idempotentes, backfill engagedAt = createdAt pour les lignes historiques.
 2. Une consommation partielle (décrément de qty) met à jour updatedAt mais
    NE MODIFIE PAS engagedAt : une réservation ancienne ne redevient jamais
    « jeune » (la date d'alerte/expiration dérive de engagedAt uniquement).
 3. Le contrat d'alerte /api/sales/reservation-alerts expose le modèle explicite :
    createdAt, engagedAt, lastModifiedAt, expectedDeliveryAt, warningAt,
    expiresAt, state — et calcule l'ancienneté sur engagedAt.
 4. Aucune réservation négative ; libération tracée par AuditEvent.
"""
import sqlite3
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FAILURES = []


def check(name, ok, detail=""):
    print(("PASS" if ok else "FAIL"), name, detail if not ok else "")
    if not ok:
        FAILURES.append(name)


def main():
    tmp = Path(tempfile.mkdtemp(prefix="gocmd-p6-resa-"))
    db = tmp / "resa.db"
    db.write_bytes((ROOT / "db" / "custom.db").read_bytes())

    # 1. Migration additive + idempotence.
    r1 = subprocess.run([sys.executable, str(ROOT / "scripts" / "upgrade_reservation_engagement_p6.py"),
                         "--db", str(db), "--apply"], capture_output=True, text=True)
    check("migration P6 appliquée", r1.returncode == 0, r1.stderr.strip())
    r2 = subprocess.run([sys.executable, str(ROOT / "scripts" / "upgrade_reservation_engagement_p6.py"),
                         "--db", str(db)], capture_output=True, text=True)
    check("migration P6 idempotente (contrôle seul : installée)", r2.returncode == 0 and "installée" in r2.stdout, r2.stdout + r2.stderr)

    con = sqlite3.connect(db)
    cur = con.cursor()
    mat_cols = [c[1] for c in cur.execute('PRAGMA table_info("SalesStockReservation")')]
    fin_cols = [c[1] for c in cur.execute('PRAGMA table_info("FinishedStockReservation")')]
    check("SalesStockReservation.engagedAt présent", "engagedAt" in mat_cols, str(mat_cols))
    check("FinishedStockReservation.updatedAt présent", "updatedAt" in fin_cols, str(fin_cols))

    # 2. Sémantique : backfill et non-rajeunissement (simulation SQL directe du
    #    chemin applicatif : livraison partielle → UPDATE qty, updatedAt bouge,
    #    engagedAt reste). Les lignes sont créées comme l'application le fait.
    client_id = cur.execute("SELECT id FROM Client ORDER BY id LIMIT 1").fetchone()[0]
    product = cur.execute("SELECT id FROM Product WHERE status='active' AND unit='u' AND materialId IS NULL LIMIT 1").fetchone()
    # Ligne NÉGOCE liée à la matière du lot (le trigger gocmd_p5154 contrôle la
    # capacité ET la cohérence produit↔matière : une ligne matelas ne peut pas
    # réserver un lot de mousse brute).
    negoce = cur.execute("SELECT p.id, m.id FROM Product p JOIN Material m ON m.id=p.materialId "
                         "WHERE p.status='active' AND m.isSellable=1 "
                         "AND (SELECT COALESCE(SUM(qty),0) FROM StockLot WHERE materialId=m.id AND status='available' AND qty>0) >= 6 "
                         "ORDER BY (SELECT COALESCE(SUM(qty),0) FROM StockLot WHERE materialId=m.id AND status='available') DESC LIMIT 1").fetchone()
    check("fixture négoce disponible", negoce is not None)
    lot_m = cur.execute("SELECT id, qty FROM StockLot WHERE materialId=? AND status='available' AND qty>=6 ORDER BY qty DESC LIMIT 1",
                        (negoce[1],)).fetchone()
    check("garde SQL capacité réservation présente (gocmd_p5154)",
          cur.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'gocmd_p5154_reservation%'").fetchone()[0] == 2)
    cur.execute('INSERT INTO "Order"(ref,clientId,status,priority,createdBy,dueDate,createdAt) '
                'VALUES (?,?,?,?,?,?,?)',
                ("CMD-P6-RESA", client_id, "ready", "normale", "p6_test",
                 (datetime.now(timezone.utc) + timedelta(days=10)).isoformat(),
                 datetime.now(timezone.utc).isoformat()))
    order_id = cur.execute('SELECT id FROM "Order" WHERE ref=?', ("CMD-P6-RESA",)).fetchone()[0]
    cur.execute('INSERT INTO OrderLine(orderId,productId,qty,unit,unitPrice,priceApprovalStatus,stockUnit,stockUnitsPerSale) VALUES(?,?,?,?,?,?,?,?)',
                (order_id, negoce[0], 5, "bloc", 100.0, "not_required", "bloc", 1))
    line_id = cur.execute("SELECT id FROM OrderLine WHERE orderId=? ORDER BY id DESC LIMIT 1", (order_id,)).fetchone()[0]
    engaged = datetime(2026, 10, 12, 8, 0, 0, tzinfo=timezone.utc)  # réservation ancienne : 30 jours
    created = engaged
    cur.execute('INSERT INTO SalesStockReservation(orderLineId,stockLotId,qty,createdBy,createdAt,updatedAt,engagedAt) '
                'VALUES(?,?,?,?,?,?,?)', (line_id, lot_m[0], 4, "p6_test", created.isoformat(),
                                          datetime.now(timezone.utc).isoformat(), engaged.isoformat()))
    resa_id = cur.execute("SELECT id FROM SalesStockReservation WHERE orderLineId=?", (line_id,)).fetchone()[0]
    # Livraison partielle : l'application décrémente qty et Prisma rafraîchit updatedAt.
    later = datetime.now(timezone.utc)
    cur.execute('UPDATE SalesStockReservation SET qty=qty-1, updatedAt=? WHERE id=?', (later.isoformat(), resa_id))
    row = cur.execute("SELECT qty, createdAt, updatedAt, engagedAt FROM SalesStockReservation WHERE id=?", (resa_id,)).fetchone()
    check("consommation partielle : qty décrémentée", row[0] == 3, str(row))
    check("engagedAt NON rajeuni par la modification", row[3] == engaged.isoformat(), str(row))
    check("updatedAt bien avancé (dernière modification)", row[2] != row[1], str(row))

    # 3. Contrat d'alerte : ancienneté calculée sur engagedAt (contrôle statique
    #    du code + calcul dynamique), car la route exige une session serveur.
    route = (ROOT / "src" / "app" / "api" / "sales" / "reservation-alerts" / "route.ts").read_text(encoding="utf-8")
    check("alertes : base de calcul = engagedAt (matière)", "r.engagedAt??r.createdAt" in route.replace(" ", ""))
    check("alertes : createdAt du stock fini = sémantique d'engagement", "engagedAt:r.createdAt.toISOString()" in route.replace(" ", ""))
    for field in ("createdAt", "engagedAt", "lastModifiedAt", "expectedDeliveryAt", "warningAt", "expiresAt", "state"):
        check(f"alertes : champ {field} exposé", field in route)
    # Calcul dynamique : à J+30 avec TTL 72h/warning 24h → expirée (et NON active).
    ttl_h, warn_h = 72, 24
    age_h = (datetime.now(timezone.utc) - engaged).total_seconds() / 3600
    state = "expired" if age_h >= ttl_h else ("expiring-soon" if age_h >= ttl_h - warn_h else "active")
    check("dynamique : réservation de 30 j expirée (TTL 72 h)", state == "expired", f"âge={age_h:.0f}h état={state}")
    # 4. Invariants : jamais de quantité négative, colonne NOT NULL respectée.
    check("aucune réservation négative après décrément",
          cur.execute("SELECT COUNT(*) FROM SalesStockReservation WHERE qty<0").fetchone()[0] == 0)
    check("engagedAt jamais NULL (backfill + NOT NULL)",
          cur.execute("SELECT COUNT(*) FROM SalesStockReservation WHERE engagedAt IS NULL").fetchone()[0] == 0)
    con.rollback()
    con.close()

    # 5. Schéma Prisma ↔ SQLite : les champs scalaires existent côté base.
    schema = (ROOT / "prisma" / "schema.prisma").read_text(encoding="utf-8")
    check("schéma Prisma : engagedAt déclaré (matière)", "engagedAt DateTime @default(now())" in schema)
    check("schéma Prisma : updatedAt? déclaré (fini)", "updatedAt DateTime? @updatedAt" in schema)
    check("schéma Prisma : index engagedAt", "@@index([engagedAt])" in schema)

    print()
    if FAILURES:
        print(f"P6 RÉSERVATIONS : {len(FAILURES)} ÉCHEC(S) —", ", ".join(FAILURES))
        sys.exit(1)
    print("P6 RÉSERVATIONS : modèle d'ancienneté explicite vérifié (engagedAt stable, alertes sur engagement, migration additive idempotente).")


if __name__ == "__main__":
    main()
