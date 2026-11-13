-- Migration additive GoCmd V18.9.13, exécutée par scripts/bootstrap-admin.cjs
-- Exécuter sur une SAUVEGARDE ou après sauvegarde vérifiée. Ne pas modifier les tables métier.
CREATE TABLE IF NOT EXISTS GoCmdUser (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 salt TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 roles_json TEXT NOT NULL,
 permissions_json TEXT NOT NULL DEFAULT '{}',
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 is_root INTEGER NOT NULL DEFAULT 0 CHECK(is_root IN (0,1)),
 must_change_password INTEGER NOT NULL DEFAULT 1 CHECK(must_change_password IN (0,1)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS GoCmdAccessAudit (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 actor TEXT NOT NULL,
 action TEXT NOT NULL,
 target TEXT NOT NULL,
 details_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS GoCmdAccessAudit_at_idx ON GoCmdAccessAudit(at);
