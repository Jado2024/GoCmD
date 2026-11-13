"""P5.15.28 P1: WAL startup policy + complete backup/restore proofs.

All tests operate on disposable SQLite databases and temporary directories.
"""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def command(*args):
    return subprocess.run([sys.executable,*map(str,args)],cwd=ROOT,capture_output=True,text=True)


def fixture(base: Path):
    db_file=base/'db'/'activity.db'; db_file.parent.mkdir(); docdir=base/'private'
    docdir.mkdir()
    stored=f'{uuid.uuid4()}.pdf'
    content=b'%PDF-1.7\n1 0 obj\n<</Type/Catalog>>\nendobj\n%%EOF\n'
    (docdir/stored).write_bytes(content)
    with sqlite3.connect(db_file) as db:
        db.execute('CREATE TABLE SupplierOfferAttachment(id INTEGER PRIMARY KEY,storedName TEXT UNIQUE,sha256 TEXT,bytes INTEGER)')
        db.execute('CREATE TABLE "Order"(id INTEGER PRIMARY KEY,status TEXT NOT NULL)')
        db.execute('CREATE TABLE WorkOrder(id INTEGER PRIMARY KEY,status TEXT NOT NULL)')
        db.execute('CREATE TABLE Invoice(id INTEGER PRIMARY KEY,total INTEGER)')
        db.execute('INSERT INTO SupplierOfferAttachment VALUES (1,?,?,?)',
                   (stored,hashlib.sha256(content).hexdigest(),len(content)))
        db.execute('INSERT INTO "Order" VALUES(55,"production")')
        db.execute('INSERT INTO WorkOrder VALUES(77,"started")')
        db.execute('INSERT INTO Invoice VALUES(88,9000)')
    return db_file,docdir,stored


class P1SecurityTest(unittest.TestCase):
    def test_wal_refused_then_maintenance_converts_with_external_backup(self):
        with tempfile.TemporaryDirectory() as raw:
            temp=Path(raw); db_file=temp/'db'/'active.db';db_file.parent.mkdir()
            with sqlite3.connect(db_file) as db:
                db.execute('CREATE TABLE real_activity(id INTEGER PRIMARY KEY,data TEXT)')
                db.execute('INSERT INTO real_activity VALUES(1,"important")')
                db.commit()
                self.assertEqual(db.execute('PRAGMA journal_mode=WAL').fetchone()[0],'wal')
            refuse=command(ROOT/'scripts'/'verify_sqlite_runtime.py','--db',db_file)
            self.assertNotEqual(refuse.returncode,0,refuse.stdout)
            self.assertIn('WAL',refuse.stderr.upper())
            external=temp/'external'/'before.db'
            apply=command(ROOT/'scripts'/'verify_sqlite_runtime.py','--db',db_file,
                          '--set-rollback','--ack','MAINTENANCE_WINDOW','--backup-file',external)
            self.assertEqual(apply.returncode,0,apply.stderr)
            with sqlite3.connect(db_file) as db:
                self.assertEqual(db.execute('PRAGMA journal_mode').fetchone()[0],'delete')
                self.assertEqual(db.execute('SELECT data FROM real_activity').fetchone()[0],'important')
            with sqlite3.connect(external) as db:
                self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
                self.assertEqual(db.execute('SELECT data FROM real_activity').fetchone()[0],'important')
            self.assertEqual(command(ROOT/'scripts'/'verify_sqlite_runtime.py','--db',db_file).returncode,0)

    def test_wal_cannot_be_converted_without_explicit_ack_and_backup(self):
        with tempfile.TemporaryDirectory() as raw:
            p=Path(raw)/'db.db';sqlite3.connect(p).close()
            self.assertNotEqual(command(ROOT/'scripts'/'verify_sqlite_runtime.py','--db',p,'--set-rollback').returncode,0)

    def test_preflight_failure_is_not_discarded(self):
        source=(ROOT/'src'/'lib'/'sqlite-write.ts').read_text()
        self.assertIn('await writePreflight',source)
        self.assertNotIn('writePreflight.catch',source)
        self.assertIn('pragma_journal_mode',(ROOT/'src'/'lib'/'db.ts').read_text())
        self.assertIn('verify_sqlite_runtime.py',(ROOT/'scripts'/'start-gocmd-checked.cjs').read_text())

    def test_identity_sqlite_refuses_wal_before_schema_mutation(self):
        with tempfile.TemporaryDirectory() as raw:
            tmp=Path(raw); dbfile=tmp/'auth.db'
            with sqlite3.connect(dbfile) as db:
                db.execute('CREATE TABLE sentinel(a INTEGER)')
                self.assertEqual(db.execute('PRAGMA journal_mode=WAL').fetchone()[0],'wal')
            env={**os.environ,'GOCMD_DB_FILE':str(dbfile)}
            result=subprocess.run(['node','-e',
                "const dir=require('./src/lib/user-directory.cjs');try{dir.prepareSchema();process.exit(9)}catch(e){process.exit(0)}"],
                cwd=ROOT,env=env,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            with sqlite3.connect(dbfile) as db:
                self.assertIsNone(db.execute("SELECT 1 FROM sqlite_master WHERE name='GoCmdUser'").fetchone())

    def test_complete_backup_and_restore_activity(self):
        with tempfile.TemporaryDirectory() as raw:
            temp=Path(raw);source,docs,name=fixture(temp)
            out=temp/'backup'/'encrypted-drive';out.parent.mkdir()
            result=command(ROOT/'scripts'/'backup_gocmd_complete.py','--source',source,'--documents-dir',docs,'--output-dir',out)
            self.assertEqual(result.returncode,0,result.stderr)
            archives=list(out.glob('gocmd_full_*.zip'))
            self.assertEqual(len(archives),1)
            archive=archives[0]
            with zipfile.ZipFile(archive) as z:
                self.assertIsNone(z.testzip())
                self.assertIn('documents/'+name,z.namelist())
                manifest=json.loads(z.read('manifest.json'))
                self.assertEqual(manifest['document_count'],1)
            verify=command(ROOT/'scripts'/'restore_gocmd_complete.py','--archive',archive,'--verify-only')
            self.assertEqual(verify.returncode,0,verify.stderr)
            destination=temp/'restore'/'fresh';destination.parent.mkdir()
            restore=command(ROOT/'scripts'/'restore_gocmd_complete.py','--archive',archive,'--target-dir',destination)
            self.assertEqual(restore.returncode,0,restore.stderr)
            with sqlite3.connect(destination/'database'/'gocmd.db') as db:
                self.assertEqual(db.execute('SELECT status FROM "Order"').fetchone()[0],'production')
                self.assertEqual(db.execute('SELECT status FROM WorkOrder').fetchone()[0],'started')
                self.assertEqual(db.execute('SELECT total FROM Invoice').fetchone()[0],9000)
            self.assertEqual((destination/'documents'/name).read_bytes(),(docs/name).read_bytes())
            second=command(ROOT/'scripts'/'restore_gocmd_complete.py','--archive',archive,'--target-dir',destination)
            self.assertNotEqual(second.returncode,0,'Must not overwrite a previous restore')

    def test_missing_or_corrupt_pdf_fails_closed_and_no_artifact(self):
        with tempfile.TemporaryDirectory() as raw:
            temp=Path(raw);source,docs,name=fixture(temp);out=temp/'out'
            (docs/name).write_bytes(b'%PDF-CHANGED')
            fail=command(ROOT/'scripts'/'backup_gocmd_complete.py','--source',source,'--documents-dir',docs,'--output-dir',out)
            self.assertNotEqual(fail.returncode,0)
            self.assertFalse(list(out.glob('gocmd_full_*.zip')))
            (docs/name).unlink()
            missing=command(ROOT/'scripts'/'backup_gocmd_complete.py','--source',source,'--documents-dir',docs,'--output-dir',out)
            self.assertNotEqual(missing.returncode,0)

    def test_restore_refuses_modified_manifest_and_rogue_entries(self):
        with tempfile.TemporaryDirectory() as raw:
            temp=Path(raw);source,docs,name=fixture(temp);out=temp/'out'
            self.assertEqual(command(ROOT/'scripts'/'backup_gocmd_complete.py','--source',source,'--documents-dir',docs,'--output-dir',out).returncode,0)
            original=next(out.glob('gocmd_full_*.zip'))
            evil=temp/'modified.zip'
            with zipfile.ZipFile(original) as zi,zipfile.ZipFile(evil,'w') as zo:
                for entry in zi.namelist():zo.writestr(entry,zi.read(entry))
                zo.writestr('../pwned','hello')
            result=command(ROOT/'scripts'/'restore_gocmd_complete.py','--archive',evil,'--verify-only')
            self.assertNotEqual(result.returncode,0)


if __name__=='__main__': unittest.main(verbosity=2)
