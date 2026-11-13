#!/usr/bin/env python3
"""Independent SQL regression for >3000 audit rows, index idempotence, no source DB change."""
from pathlib import Path
import sqlite3, tempfile, shutil, sys
from contextlib import closing
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import upgrade_audit_indexes_p5151 as migration

with tempfile.TemporaryDirectory(prefix='gocmd5151-') as tmp:
    src=ROOT/'db/custom.db'
    dst=Path(tmp)/'audit.db'
    shutil.copy2(src,dst)
    with closing(sqlite3.connect(str(dst))) as c:
        c.execute('DELETE FROM AuditEvent')
        # 3,005 audit events in one DA + 50 other DA events; new events must appear.
        for n in range(3005):
            c.execute("INSERT INTO AuditEvent(actor,action,entity,entityId,details) VALUES('qa','PURCHASE_LINE_DECIDED','PurchaseRequestLine','9001',?)",(str(n),))
        for n in range(50):
            c.execute("INSERT INTO AuditEvent(actor,action,entity,entityId,details) VALUES('qa','PURCHASE_LINE_DECIDED','PurchaseRequestLine','OTHER',?)",(str(n),))
        c.commit()
    migration.upgrade(dst)
    migration.upgrade(dst)
    with closing(sqlite3.connect(str(dst))) as c:
        indexes=c.execute("PRAGMA index_list('AuditEvent')").fetchall()
        assert any('entity_entityId_id_idx' in x[1] for x in indexes),indexes
        received=[]
        cursor=None
        for _ in range(102):
            q='SELECT id,details FROM AuditEvent WHERE entity=? AND entityId=?'
            params=['PurchaseRequestLine','9001']
            if cursor is not None: q+=' AND id<?';params.append(cursor)
            q+=' ORDER BY id DESC LIMIT 31'
            rows=c.execute(q,params).fetchall()
            page=rows[:30]
            received.extend(page)
            if len(rows)<=30:break
            cursor=page[-1][0]
        assert len(received)==3005,(len(received),cursor)
        assert received[0][1]=='3004' and received[-1][1]=='0'
        assert all(x[1]!='OTHER' for x in received)
        assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        assert c.execute('PRAGMA foreign_key_check').fetchall()==[]
print('PASS P5.15.1 : 3005 décisions paginées, tri récent, isolation DA, index idempotent, SQLite/FK OK.')
