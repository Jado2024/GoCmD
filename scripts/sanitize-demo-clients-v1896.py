#!/usr/bin/env python3
"""One-time privacy cleanup ONLY for the distributed synthetic demo DB.

Refuses databases whose two historic extra rows do not match known fingerprints.
Never run this on a production or customer-owned database. Referential IDs stay intact.
"""
import argparse
import hashlib
import sqlite3
from pathlib import Path

EXPECTED = {
  9: "af76b7a43f60d40002c0b0dba363e409f88fca6712c31e5e4cf046c9e8632844",
  10: "21eebe15a736f0887ec77e969574d7b1ad8fadef44d9fbe38f1e18ff8bef4b25",
}
SAFE = {9: "CLIENT-DEMO-09-FICTIF", 10: "CLIENT-DEMO-10-FICTIF"}

def sanitize(path: Path):
    with sqlite3.connect(path) as conn:
        conn.execute("PRAGMA foreign_keys=ON")
        original = dict(conn.execute("SELECT id,name FROM Client WHERE id IN (9,10)"))
        if set(original) != set(EXPECTED):
            raise SystemExit("Refus: les deux fiches de démonstration attendues sont absentes")
        if all(original[i] == SAFE[i] for i in SAFE):
            print("Déjà anonymisé : aucun changement")
            return
        if any(hashlib.sha256(original[i].casefold().encode()).hexdigest() != EXPECTED[i] for i in EXPECTED):
            raise SystemExit("Refus: base non reconnue, données potentiellement réelles")
        conn.execute("BEGIN IMMEDIATE")
        for i,name in SAFE.items():
            conn.execute("UPDATE Client SET name=?, city=?, phone=NULL WHERE id=?", (name,"VILLE-DEMO",i))
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
        conn.commit()
        conn.execute("VACUUM")  # eliminate recoverable old free-page text in the distributed copy
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        print("PASS : 2 fiches anonymisées, relations conservées et SQLite VACUUM OK")

if __name__ == "__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--db",type=Path,required=True)
    parser.add_argument("--demo-only",action="store_true",required=True)
    parser.add_argument("--ack",choices=["SYNTHETIC_DISTRIBUTION_ONLY"],required=True)
    args=parser.parse_args()
    if not args.demo_only or not args.db.is_file(): raise SystemExit("Copie de démonstration requise")
    sanitize(args.db)
