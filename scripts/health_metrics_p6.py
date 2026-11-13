#!/usr/bin/env python3
"""P6 (2026-11-11) — Chantier 4 §5.3 : métriques de santé, lecture seule.

Appelé par deploy/windows/verifier-sante.ps1. Ne modifie AUCUNE donnée et
n'expose AUCUNE donnée confidentielle : uniquement des compteurs agrégés et
des âges, en JSON, pour la supervision locale SODEPI.

Sortie JSON :
  failedLogins24h        tentatives de connexion refusées (24 h) ;
  sensitiveFailed24h     confirmations sensibles refusées (24 h) ;
  lastAuditEventAgeH     ancienneté du dernier événement applicatif (h) ;
  auditEvents24h         volume d'événements applicatifs (24 h).
Code de sortie : 0 si lisible, 2 en cas d'erreur d'accès (base absente…).
"""
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path


def main() -> int:
    db_path = Path(sys.argv[1] if len(sys.argv) > 1 else "db/custom.db").resolve()
    if not db_path.is_file():
        print(json.dumps({"error": "base absente"}))
        return 2
    try:
        con = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True, timeout=5)
        cur = con.cursor()
        failed_logins = cur.execute(
            "SELECT COUNT(*) FROM GoCmdAccessAudit WHERE action='session.login.failed' "
            "AND at >= datetime('now','-1 day')").fetchone()[0]
        sensitive_failed = cur.execute(
            "SELECT COUNT(*) FROM GoCmdAccessAudit WHERE action='sensitive.confirm.failed' "
            "AND at >= datetime('now','-1 day')").fetchone()[0]
        last_event = cur.execute("SELECT MAX(createdAt) FROM AuditEvent").fetchone()[0]
        events_24h = cur.execute(
            "SELECT COUNT(*) FROM AuditEvent WHERE createdAt >= datetime('now','-1 day')").fetchone()[0]
        con.close()
        age_h = None
        if last_event:
            # createdAt Prisma est ISO-8601 UTC (millisecondes incluses).
            try:
                parsed = datetime.fromisoformat(str(last_event).replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=timezone.utc)  # horodatage SQLite sans fuseau : UTC
                age_h = round((datetime.now(timezone.utc) - parsed).total_seconds() / 3600, 2)
            except ValueError:
                age_h = None
        print(json.dumps({
            "failedLogins24h": failed_logins,
            "sensitiveFailed24h": sensitive_failed,
            "lastAuditEventAgeH": age_h,
            "auditEvents24h": events_24h,
        }))
        return 0
    except sqlite3.Error as exc:
        # Aucune divulgation : erreur générique, pas de chemin ni de secret.
        print(json.dumps({"error": "base illisible"}))
        return 2


if __name__ == "__main__":
    sys.exit(main())
