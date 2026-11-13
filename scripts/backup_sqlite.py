#!/usr/bin/env python3
"""Sauvegarde SQLite cohérente de GoCmd (compatible avec une DB ouverte).

Créer une sauvegarde ne déclenche pas de restauration ni de purge des données métier.
Planifier la commande via cron / Planificateur Windows pour automatiser les sauvegardes.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path
import sqlite3
import sys
import os

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    ap = argparse.ArgumentParser(description="Sauvegarde transactionnelle GoCmd SQLite")
    ap.add_argument("--source", type=Path, default=None, help="Fichier SQLite précis, ou variable GOCMD_DB_FILE")
    ap.add_argument("--output-dir", type=Path, default=None, help="Par défaut: répertoire backups à côté de la base sélectionnée")
    ap.add_argument("--retention", type=int, default=14, help="Nombre de sauvegardes GoCmd à conserver")
    opts = ap.parse_args()
    if opts.source is None:
        raw = os.environ.get("GOCMD_DB_FILE", "").strip()
        if not raw or raw.startswith("file:"):
            ap.error("Source explicite obligatoire : --source /chemin/base.db ou GOCMD_DB_FILE")
        opts.source = (ROOT / raw).resolve()
    opts.source = opts.source.expanduser().resolve()
    if opts.output_dir is None:
        opts.output_dir = opts.source.parent / "backups"
    opts.output_dir = opts.output_dir.expanduser().resolve()
    if not opts.source.is_file() or opts.retention < 1:
        ap.error("Base source absente ou rétention invalide")
    opts.output_dir.mkdir(parents=True, exist_ok=True)
    name = f"gocmd_backup_{datetime.now(timezone.utc):%Y%m%dT%H%M%S%fZ}.db"
    dest = opts.output_dir / name
    try:
        with sqlite3.connect(f"file:{opts.source.resolve()}?mode=ro", uri=True, timeout=30) as source:
            with sqlite3.connect(dest) as backup:
                source.backup(backup, pages=200, sleep=0.1)
        with sqlite3.connect(f"file:{dest.resolve()}?mode=ro", uri=True) as backup:
            if backup.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise RuntimeError("Contrôle d'intégrité en échec")
            if backup.execute("PRAGMA foreign_key_check").fetchone() is not None:
                raise RuntimeError("Clés étrangères invalides dans la sauvegarde")
        # A restored backup may itself be the active source in this folder.
        # Never count or purge that database (including symlinks/hard links).
        old = sorted(
            (file for file in opts.output_dir.glob("gocmd_backup_*.db")
             if not file.samefile(opts.source)),
            reverse=True,
        )
        for file in old[opts.retention:]:
            file.unlink()
        print(f"BACKUP OK: {dest} ({dest.stat().st_size} octets), contrôle SQLite OK")
        return 0
    except Exception as exc:
        dest.unlink(missing_ok=True)
        print(f"BACKUP ÉCHEC: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
