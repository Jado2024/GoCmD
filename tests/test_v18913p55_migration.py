from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory
import shutil
import sqlite3
import subprocess
import sys

root = Path(__file__).resolve().parents[1]

# Every SQLite connection must be explicitly closed on Windows before
# TemporaryDirectory tries to delete its temporary database file.
with TemporaryDirectory(prefix="gocmd-p55-test-") as temp_dir:
    database = Path(temp_dir) / "demo.db"
    shutil.copy2(root / "db/custom.db", database)

    with closing(sqlite3.connect(database)) as db:
        before = db.execute("SELECT COUNT(*) FROM Material").fetchone()[0]

    migration = root / "scripts/upgrade_foam_catalogue_p55.py"
    for _ in range(2):
        subprocess.run(
            [sys.executable, str(migration), "--db", str(database), "--apply"],
            check=True,
            capture_output=True,
            text=True,
        )

    with closing(sqlite3.connect(database)) as db:
        columns = {row[1] for row in db.execute("PRAGMA table_info(Material)")}
        assert {
            "description",
            "foamIdentityKey",
            "foamColor",
            "foamFirmness",
            "foamLengthCm",
            "foamWidthCm",
            "foamThicknessCm",
        } <= columns
        assert db.execute("SELECT COUNT(*) FROM Material").fetchone()[0] == before
        assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"

        material_ids = [row[0] for row in db.execute("SELECT id FROM Material LIMIT 2")]
        assert len(material_ids) == 2, "Deux matières sont nécessaires au test d'unicité"
        try:
            db.execute(
                "UPDATE Material SET foamIdentityKey=? WHERE id=?",
                ("TEST-UNIQUE", material_ids[0]),
            )
            try:
                db.execute(
                    "UPDATE Material SET foamIdentityKey=? WHERE id=?",
                    ("TEST-UNIQUE", material_ids[1]),
                )
            except sqlite3.IntegrityError:
                pass  # Collision correctly rejected by SQLite UNIQUE index.
            else:
                raise AssertionError("Contrainte UNIQUE manquante")
        finally:
            db.rollback()

print("PASS : migration SQLite idempotente, données démo conservées, unicité et intégrité")
