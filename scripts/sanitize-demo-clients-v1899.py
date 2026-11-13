#!/usr/bin/env python3
"""V18.9.9 (DONNEES-01) — synthétisation complète du répertoire clients de la
base de démonstration distribuée.

Les huit fiches clients historiques (IDs 1 à 8) présentaient des
enseignes, villes et numéros réalistes d'origine NON documentée : elles ne
peuvent pas être présumées fictives et ne doivent pas être redistribuées.
Ce script remplace les DIX fiches par des valeurs entièrement synthétiques
(noms CLIENT-DEMO-XX-FICTIF, ville VILLE-DEMO, téléphone NULL) en conservant
les identifiants et toutes les relations (devis, commandes, factures).

Contrôles de non-réidentification :
  - refus catégorique d'opérer sur une base non reconnue (empreintes SHA-256
    des noms originaux vérifiées avant toute écriture) ;
  - téléphones mis à NULL (jamais de numéro « réaliste » de remplacement) ;
  - VACUUM après écriture pour éliminer les pages libres récupérables ;
  - intégrité et clés étrangères vérifiées après transformation.

Ne JAMAIS exécuter sur une base de production ou appartenant à un client :
la transformation est réservée à la copie de démonstration distribuée.
"""
import argparse
import hashlib
import sqlite3
from pathlib import Path

# Empreintes SHA-256 (casefold) des 8 enseignes historiques d'origine
# inconnue — tout écart fait échouer le script (base non reconnue).
HISTORICAL = {
  1: "2223bf60e5a4af0ee8ce4b4568c9c33d3796b19aa28c26de538d1bd7a6f80c98",
  2: "38b9971f7dcb5ad378c12822b7ff0e1571cbe3dd2bb844011113cb6927333a34",
  3: "89bb2736cfc0549cb1da8c0747ccfe475578199c354e6f657321a7f90e964b50",
  4: "29762e26f834b0c59409520afab2e55effbda9a68d73a4357bca9bd97942c77e",
  5: "ef204ece78333d7b9a5e75a2879b50afd60f393e7645b318f7304b6b01333798",
  6: "4ddebd855c7a02064279f0f9fa0eb800991b0b56d2926126280e8f8e4d6dd5a9",
  7: "709af3fd9b33915d73de7f854814650eddb68c2e6e2df63fec22d8071de237e0",
  8: "b2fe342566b75eab219cdaeb0fa5013aa5c61ceddd120aeac9e61d39cfa57b52",
}
EXPECTED_COUNT = 10

def synth_name(i: int) -> str:
    return f"CLIENT-DEMO-{i:02d}-FICTIF"

def sanitize(path: Path):
    with sqlite3.connect(path) as conn:
        conn.execute("PRAGMA foreign_keys=ON")
        count = conn.execute("SELECT COUNT(*) FROM Client").fetchone()[0]
        if count != EXPECTED_COUNT:
            raise SystemExit(f"Refus: {count} fiches clients (attendu {EXPECTED_COUNT}) — base non reconnue")
        names = dict(conn.execute("SELECT id, name FROM Client WHERE id IN (1,2,3,4,5,6,7,8)"))
        if set(names) != set(HISTORICAL):
            raise SystemExit("Refus: les 8 fiches historiques attendues sont absentes")
        for i, fingerprint in HISTORICAL.items():
            if names[i] == synth_name(i):
                continue  # déjà synthétique (idempotence)
            if hashlib.sha256(names[i].casefold().encode()).hexdigest() != fingerprint:
                raise SystemExit(f"Refus: fiche client {i} non reconnue — données potentiellement réelles")
        changed = 0
        conn.execute("BEGIN IMMEDIATE")
        for i in range(1, EXPECTED_COUNT + 1):
            name, city, phone = conn.execute(
                "SELECT name, city, phone FROM Client WHERE id=?", (i,)
            ).fetchone()
            if name == synth_name(i) and city == "VILLE-DEMO" and phone is None:
                continue
            conn.execute(
                "UPDATE Client SET name=?, city=?, phone=NULL WHERE id=?",
                (synth_name(i), "VILLE-DEMO", i),
            )
            changed += 1
        if conn.execute("PRAGMA foreign_key_check").fetchall() != []:
            raise SystemExit("Refus: clés étrangères invalide après transformation")
        conn.commit()
        conn.execute("VACUUM")  # élimine les pages libres contenant les anciens libellés
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        remaining = conn.execute(
            "SELECT COUNT(*) FROM Client WHERE name NOT LIKE 'CLIENT-DEMO-__-FICTIF'"
            " OR city<>'VILLE-DEMO' OR phone IS NOT NULL"
        ).fetchone()[0]
        if remaining:
            raise SystemExit(f"Refus: {remaining} fiches non synthétiques après traitement")
        print(f"PASS V18.9.9 : {changed} fiches synthétisées, 10/10 entièrement fictives, "
              f"relations conservées, VACUUM et intégrité SQLite OK")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, required=True)
    parser.add_argument("--demo-only", action="store_true", required=True)
    parser.add_argument("--ack", choices=["SYNTHETIC_DISTRIBUTION_ONLY"], required=True)
    args = parser.parse_args()
    if not args.demo_only or not args.db.is_file():
        raise SystemExit("Copie de démonstration requise (--demo-only --ack SYNTHETIC_DISTRIBUTION_ONLY)")
    sanitize(args.db)
