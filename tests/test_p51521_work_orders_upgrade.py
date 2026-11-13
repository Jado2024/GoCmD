#!/usr/bin/env python3
"""Régression réelle SQLite : migration d'une table WorkOrder ancienne avec données,
vers le statut cancelled + garde parent/ligne, sur COPIE uniquement."""
import importlib.util, pathlib, sqlite3, tempfile, json
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('upgrade_of',ROOT/'scripts/upgrade_work_orders_p51521.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory(prefix='gocmd-legacy-of-') as d:
    p=pathlib.Path(d)/'test'/'legacy.db';p.parent.mkdir()
    with sqlite3.connect(ROOT/'db/custom.db') as src,sqlite3.connect(p) as dst:src.backup(dst)
    with sqlite3.connect(p) as c:
        c.execute('PRAGMA foreign_keys=ON')
        # Contre-audit 08/11/2026 (AV-02) : la base livrée est désormais MIGRÉE
        # P5.15.21 (table WorkOrder présente). Le « CREATE TABLE IF NOT EXISTS »
        # du schéma hérité était alors un no-op et la sauvegarde pré-migration
        # contenait déjà 'cancelled'. Supprimer explicitement la table pour
        # garantir l'état hérité quoi que contienne la base livrée.
        c.execute('DROP TABLE IF EXISTS "WorkOrder"')
        old=m.SQL[0].replace(",'cancelled'",'')
        assert "'cancelled'" not in old
        c.execute(old)
        for sql in m.SQL[1:3]:c.execute(sql)
        c.execute("INSERT INTO Client(name,city) VALUES('Legacy OF','Casa')")
        client=c.execute('SELECT last_insert_rowid()').fetchone()[0]
        c.execute("INSERT INTO Product(sku,name,family,model,length,width,height,unit,coreType,foamComposition,mattressFinish,foamDensity) VALUES('LEG-OF','Matelas test','MATELAS','STD',200,160,25,'u','BONNELL','PURE','SANS',30)")
        product=c.execute('SELECT last_insert_rowid()').fetchone()[0]
        c.execute('INSERT INTO "Order"(ref,clientId) VALUES(?,?)',('CMD-LEGACY-OF',client))
        order=c.execute('SELECT last_insert_rowid()').fetchone()[0]
        c.execute('INSERT INTO OrderLine(orderId,productId,qty,unit,unitPrice) VALUES(?,?,?,?,?)',(order,product,1,'u',500))
        line=c.execute('SELECT last_insert_rowid()').fetchone()[0]
        payload=json.dumps({'orderRef':'CMD-LEGACY-OF','pieces':[{'code':'LEG-P1'}]})
        c.execute('INSERT INTO WorkOrder(ref,orderId,orderLineId,snapshotJson,totalPieces,createdBy) VALUES(?,?,?,?,?,?)',
                  ('OF-2026-00421',order,line,payload,1,'commercial'))
    backup=pathlib.Path(d)/'backup'/'before.db'
    m.migrate(p,True,backup)
    assert backup.is_file()
    with sqlite3.connect(p) as c:
        assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        assert not c.execute('PRAGMA foreign_key_check').fetchall()
        row=c.execute('SELECT ref,snapshotJson,totalPieces,createdBy,status FROM WorkOrder').fetchone()
        assert row==('OF-2026-00421',payload,1,'commercial','draft'),row
        c.execute("UPDATE WorkOrder SET status='cancelled' WHERE ref='OF-2026-00421'")
        assert c.execute('SELECT status FROM WorkOrder').fetchone()[0]=='cancelled'
        assert 'WorkOrder_guard_parent_insert' in {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='trigger'")}
    with sqlite3.connect(backup) as c:
        assert c.execute('SELECT ref FROM WorkOrder').fetchone()[0]=='OF-2026-00421'
        assert "'cancelled'" not in c.execute("SELECT sql FROM sqlite_master WHERE name='WorkOrder'").fetchone()[0]
    m.migrate(p,True,pathlib.Path(d)/'backup'/'after.db')
print('PASS migration ancienne table OF avec données -> cancelled ; références conservées, sauvegarde et idempotence')
