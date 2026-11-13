"""Backup retention must preserve a database restored in the backup folder."""
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class BackupRetentionTest(unittest.TestCase):
    def test_source_is_never_purged_and_old_backups_are_removed(self):
        with tempfile.TemporaryDirectory(prefix="gocmd-backup-test-") as directory:
            folder = pathlib.Path(directory)
            source = folder / "gocmd_backup_20000101T000000000000Z.db"
            with sqlite3.connect(source) as db:
                db.execute("CREATE TABLE sentinel(value TEXT)")
                db.execute("INSERT INTO sentinel VALUES ('preserved')")
            before = source.read_bytes()
            old = folder / "gocmd_backup_20010101T000000000000Z.db"
            old.write_bytes(before)
            result = subprocess.run(
                [sys.executable, str(ROOT / "scripts/backup_sqlite.py"),
                 "--source", str(source), "--output-dir", str(folder), "--retention", "1"],
                capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertTrue(source.exists(), "retention deleted its source database")
            self.assertEqual(source.read_bytes(), before)
            self.assertFalse(old.exists())
            backups = [p for p in folder.glob("gocmd_backup_*.db") if p != source]
            self.assertEqual(len(backups), 1)
            with sqlite3.connect(backups[0]) as restored:
                self.assertEqual(restored.execute("SELECT value FROM sentinel").fetchone()[0], "preserved")
                self.assertEqual(restored.execute("PRAGMA integrity_check").fetchone()[0], "ok")


if __name__ == "__main__":
    unittest.main()
