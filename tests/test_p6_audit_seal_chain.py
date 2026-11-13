#!/usr/bin/env python3
"""P6 (2026-11-11) — Chantier 3, §4.5 : chaîne de scellement append-only.

Preuves sur base jetable :
 1. seal --chain écrit un nouveau maillon horodaté (jamais écrasé) qui référence
    l'empreinte du maillon précédent ; le pointeur --out est mis à jour.
 2. verify --chain : base intègre + chaîne intègre → PASS (0).
 3. Modification d'un événement scellé → verify échoue (2).
 4. Re-scellage après falsification → REFUSÉ (6) : un administrateur disposant
    de la clé ne peut pas masquer une modification en re-scellant.
 5. Suppression d'un maillon de chaîne → verify --chain échoue (4).
 6. Vérification exhaustive --deep : chaque maillon recalculé contre la base.
 7. Compatibilité ascendante : scellement et vérification sans --chain
    (comportement P5.15.2 d'origine) toujours fonctionnels ; clé incorrecte
    refusée.
"""
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "audit_seal_p5152.py"
KEY = "P6-SEAL-TEST-" + "x" * 48  # >= 32 octets, valeur de test jetable
FAILURES = []


def check(name, ok, detail=""):
    print(("PASS" if ok else "FAIL"), name, detail if not ok else "")
    if not ok:
        FAILURES.append(name)


def run(*argv, env_key=True):
    env = {**os.environ, "GOCMD_AUDIT_SEAL_KEY": KEY} if env_key else dict(os.environ)
    return subprocess.run([sys.executable, str(SCRIPT), *argv], capture_output=True, text=True, env=env)


def chain_files(seals):
    return sorted(seals.glob("gocmd-audit-seal-chain-*.json"))


def main():
    tmp = Path(tempfile.mkdtemp(prefix="gocmd-p6-seal-"))
    db = tmp / "base.db"
    db.write_bytes((ROOT / "db" / "custom.db").read_bytes())
    seals = tmp / "independent" / "seals"
    out = seals / "gocmd-audit-seal.json"

    con = sqlite3.connect(db)
    con.execute("INSERT INTO AuditEvent(actor,action,entity,entityId,details) VALUES(?,?,?,?,?)",
                ("p6", "P6_SEAL_TEST", "Order", "1", "{}"))
    con.commit()

    # 1. Premier scellement chaîné.
    r = run("seal", "--chain", "--db", str(db), "--out", str(out))
    check("seal --chain initial", r.returncode == 0 and "chaîne" in r.stdout, r.stdout + r.stderr)
    check("maillon initial créé (sans parent)", len(chain_files(seals)) == 1
          and json.loads(chain_files(seals)[0].read_text())["parent"] is None)

    # 2. Nouvel événement + second scellement : la chaîne s'étend sans écraser.
    con.execute("INSERT INTO AuditEvent(actor,action,entity,entityId,details) VALUES(?,?,?,?,?)",
                ("p6", "P6_SEAL_TEST_2", "Order", "2", "{}"))
    con.commit()
    r = run("seal", "--chain", "--db", str(db), "--out", str(out))
    check("seal --chain second", r.returncode == 0, r.stderr)
    files = chain_files(seals)
    check("maillons précédents conservés (append-only)", len(files) == 2)
    check("le second maillon référence le premier (empreinte)",
          json.loads(files[-1].read_text())["parent"]["file"] == files[0].name)
    r = run("verify", "--chain", "--db", str(db), "--out", str(out))
    check("verify --chain : PASS base + chaîne intègres", r.returncode == 0 and "PASS" in r.stdout, r.stdout + r.stderr)
    r = run("verify", "--chain", "--deep", "--db", str(db), "--out", str(out))
    check("verify --chain --deep : vérification exhaustive PASS", r.returncode == 0 and "exhaustive" in r.stdout, r.stdout + r.stderr)

    # P6-unifié : modification UNIQUEMENT dans la période du second scellement.
    # Le contrôle normal ne doit jamais se limiter au plus vieux maillon.
    con.execute("UPDATE AuditEvent SET details='{\"intermediaire\":true}' WHERE action='P6_SEAL_TEST_2'")
    con.commit()
    r = run("verify", "--chain", "--db", str(db), "--out", str(out))
    check("falsification du second intervalle détectée sans --deep", r.returncode in (2, 4),
          f"rc={r.returncode} {r.stdout}{r.stderr}")
    r = run("seal", "--chain", "--db", str(db), "--out", str(out))
    check("re-scellage du second intervalle refusé", r.returncode == 6,
          f"rc={r.returncode} {r.stdout}{r.stderr}")
    con.execute("UPDATE AuditEvent SET details='{}' WHERE action='P6_SEAL_TEST_2'")
    con.commit()

    # P6-unifié : la suppression du dernier maillon doit être détectée par
    # chainLatest, même quand tous les autres maillons sont intacts.
    terminal = chain_files(seals)[-1]
    terminal_copy = terminal.read_bytes()
    terminal.unlink()
    r = run("verify", "--chain", "--db", str(db), "--out", str(out))
    check("suppression du DERNIER maillon détectée", r.returncode == 4,
          f"rc={r.returncode} {r.stdout}{r.stderr}")
    r = run("seal", "--chain", "--db", str(db), "--out", str(out))
    check("nouveau scellement interdit après perte terminale", r.returncode == 6,
          f"rc={r.returncode} {r.stdout}{r.stderr}")
    terminal.write_bytes(terminal_copy)

    # 3. Falsification d'un événement scellé : détectée.
    con.execute("UPDATE AuditEvent SET details='{\"falsifie\":true}' WHERE action='P6_SEAL_TEST'")
    con.commit()
    r = run("verify", "--chain", "--db", str(db), "--out", str(out))
    check("falsification détectée (code 2)", r.returncode in (2, 4), f"rc={r.returncode}")

    # 4. Re-scellage après falsification : REFUSÉ.
    r = run("seal", "--chain", "--db", str(db), "--out", str(out))
    check("re-scellage après falsification REFUSÉ (code 6)",
          r.returncode == 6 and "REFUS" in r.stderr, f"rc={r.returncode} {r.stderr}")
    check("aucun maillon ajouté par le refus", len(chain_files(seals)) == 2)
    # Restauration : le scellement redevient possible.
    con.execute("UPDATE AuditEvent SET details='{}' WHERE action='P6_SEAL_TEST'")
    con.commit()
    r = run("seal", "--chain", "--db", str(db), "--out", str(out))
    check("après restauration, scellement accepté", r.returncode == 0, r.stderr)

    # 5. Suppression d'un maillon : détectée par verify --chain.
    victim = chain_files(seals)[0]
    victim.unlink()
    r = run("verify", "--chain", "--db", str(db), "--out", str(out))
    check("suppression d'un maillon détectée (code 4)", r.returncode == 4, f"rc={r.returncode} {r.stdout}{r.stderr}")

    # 6. Compatibilité ascendante : mode sans --chain (P5.15.2 d'origine).
    classic = tmp / "independent" / "classic.json"
    r = run("seal", "--db", str(db), "--out", str(classic))
    check("scellement classique (P5.15.2) toujours disponible", r.returncode == 0, r.stderr)
    r = run("verify", "--db", str(db), "--out", str(classic))
    check("vérification classique (P5.15.2) toujours disponible", r.returncode == 0, r.stderr)
    r = run("verify", "--db", str(db), "--out", str(out), env_key=False)
    check("clé absente/incorrecte refusée", r.returncode == 2 or "GOCMD_AUDIT_SEAL_KEY" in r.stderr, r.stderr)
    con.close()

    print()
    if FAILURES:
        print(f"P6 SCELLEMENT : {len(FAILURES)} ÉCHEC(S) —", ", ".join(FAILURES))
        sys.exit(1)
    print("P6 SCELLEMENT : chaîne append-only vérifiée (falsification, re-scellage frauduleux refusé, suppression de maillon et vérification exhaustive --deep).")


if __name__ == "__main__":
    main()
