#!/usr/bin/env python3
"""Stress the actual SQLite engagement triggers on a disposable database copy.
This is randomized SQL invariant testing, NOT a million independent app audits.
"""
import random
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tests'))
from test_cascade2_engagement_guards import fixture

N=int(os.environ.get("GOCMD_ENGAGEMENT_STRESS_CASES","20000"))
SEED=int(os.environ.get("GOCMD_ENGAGEMENT_STRESS_SEED","20261111"))
rng=random.Random(SEED)
with tempfile.TemporaryDirectory(prefix='gocmd-engagement-stress-') as td:
    p=Path(td)/'work.db'
    with sqlite3.connect(ROOT/'db/custom.db') as src,sqlite3.connect(p) as out:src.backup(out)
    with sqlite3.connect(p) as con:
        rid=fixture(con)
        original=con.execute('SELECT engagedAt,qty,createdAt FROM SalesStockReservation WHERE id=?',(rid,)).fetchone()
        assert original[0] is not None
        c=con.cursor()
        for i in range(N):
            c.execute('SAVEPOINT audit_step')
            v=rng.randint(1,1000000000)
            try:
                c.execute('UPDATE SalesStockReservation SET engagedAt=? WHERE id=?',(str(v),rid))
                raise AssertionError('engagement date was altered at '+str(i))
            except sqlite3.IntegrityError as e:
                assert 'GOCMD_ENGAGEMENT_DATE_IMMUTABLE' in str(e)
            val=round(rng.uniform(0.01,2),4)
            c.execute('UPDATE SalesStockReservation SET qty=? WHERE id=?',(val,rid))
            got=c.execute('SELECT engagedAt,qty FROM SalesStockReservation WHERE id=?',(rid,)).fetchone()
            assert got[0]==original[0] and abs(got[1]-val)<1e-8
            c.execute('ROLLBACK TO audit_step')
            c.execute('RELEASE audit_step')
        assert con.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        assert not con.execute('PRAGMA foreign_key_check').fetchall()
        after=con.execute('SELECT engagedAt,qty,createdAt FROM SalesStockReservation WHERE id=?',(rid,)).fetchone()
        assert after==original
        con.rollback()
print(f'PASS engagement stress seed={SEED}: {N} SQL scenarios, forbidden date change rejected, legitimate qty change allowed, rollback and integrity OK')
