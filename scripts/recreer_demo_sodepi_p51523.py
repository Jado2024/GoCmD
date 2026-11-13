#!/usr/bin/env python3
"""RECREATE a fresh synthetic GoCmd demo SQLite database, from validated seed data.

The existing demo file is replaced by a NEW SQLite database (new schema, freshly
inserted reference records and opening balances). Old orders, DA, sessions,
access traces and proof artifacts are never imported. This script MUST NEVER
be pointed at a real production database.
"""
from __future__ import annotations
import argparse
import gzip
import json
import os
from pathlib import Path
import sqlite3
from demo_v2_catalogue import upgrade_demo_conn, export_mapping
import tempfile
from datetime import datetime, timezone
from uuid import uuid4

ROOT=Path(__file__).resolve().parents[1]
SEED=ROOT/'db/demo_seed_sodepi.json.gz'
SCHEMA=ROOT/'db/schema_demo_p51523.sql'
TRIGGERS=ROOT/'db/triggers_demo_p51523.sql'
OVERLAY=ROOT/'db/overlay_demo_current_p51529p5.sql'
EXPECTED={'Material':82,'Supplier':18,'SupplierMaterial':135,'Product':218,'Client':10,'GoCmdUser':9,'StockLot':64}
PROTECTED=(
 'Order','OrderLine','OrderPiece','PurchaseRequest','PurchaseRequestLine',
 'PurchaseReceipt','PurchaseReceiptLine','SupplierOrder','SupplierOrderLine',
 'GoodsReceipt','GoodsReceiptLine','SupplierInvoice','SupplierInvoiceLine',
 'SalesDelivery','SalesDeliveryLine','SalesInvoice','SalesInvoiceLine',
 'Movement','StockLot','Material')

def recreate(path: Path):
    path=path.expanduser().resolve()
    allowed=ROOT/'db/custom.db'
    if path != allowed.resolve():
        raise ValueError('Refus: réinitialisation limitée EXCLUSIVEMENT à db/custom.db de cette archive DEMO')
    # V2 — sauvegarde de l'intégrité : ne JAMAIS écraser un fichier existant
    # sans preuve qu'il s'agit de la DEMO, même si son chemin est autorisé.
    if path.is_symlink():
        raise ValueError('Refus: lien symbolique interdit pour une base DEMO')
    if (os.getenv('NODE_ENV','').lower()=='production' or
        os.getenv('GOCMD_ENV','').lower()=='production' or
        os.getenv('APP_ENV','').lower()=='production' or
        os.getenv('GOCMD_PRODUCTION','') in ('1','true','TRUE')):
        raise ValueError('Refus: indicateur environnement de production présent')
    if path.exists():
        # URI readonly pour NE PAS créer une nouvelle base en cas d'erreur de chemin.
        with sqlite3.connect(f'file:{path.as_posix()}?mode=ro',uri=True) as prior:
            exists=prior.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='WarehouseSite'").fetchone()
            demo=exists and prior.execute("SELECT 1 FROM WarehouseSite WHERE code='SODEPI-DEMO'").fetchone()
            if not demo:
                raise ValueError('Refus: base existante non identifiée DEMO; aucune suppression effectuée')

    if not (SEED.exists() and SCHEMA.exists() and TRIGGERS.exists() and OVERLAY.exists()):
        raise FileNotFoundError('Seed ou schéma manquant')
    with gzip.open(SEED,'rt',encoding='utf-8') as f: data=json.load(f)
    if data.get('_metadata',{}).get('hasTransactions') is not False:
        raise ValueError('Seed non marqué comme démonstration sans transactions')
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,name=tempfile.mkstemp(prefix='.gocmd_demo_clean_',suffix='.db',dir=path.parent)
    os.close(fd)
    tmp=Path(name)
    mapping_rows=[]
    try:
        with sqlite3.connect(tmp) as db:
            db.execute('PRAGMA foreign_keys=OFF')
            db.executescript(SCHEMA.read_text(encoding='utf-8'))
            db.execute('BEGIN IMMEDIATE')
            for table, dataset in data['tables'].items():
                columns=dataset['columns'];rows=dataset['rows']
                if not columns:raise ValueError(f'Colonnes absentes pour {table}')
                quoted=','.join('"'+c.replace('"','""')+'"' for c in columns)
                slots=','.join('?' for _ in columns)
                for row in rows:
                    parsed=[__import__('base64').b64decode(v['base64']) if isinstance(v,dict) and 'base64' in v else v for v in row]
                    db.execute(f'INSERT INTO "{table}" ({quoted}) VALUES({slots})',parsed)
            # Démo P5.15.25 : seuils et cibles sur plusieurs familles.
            # Exemplaires volontairement limites ; le gestionnaire paramètre
            # ensuite chaque article. Ne change JAMAIS les stocks historiques.
            db.execute('UPDATE Material SET targetStock=ROUND(minStock*2,3) WHERE minStock>0 AND targetStock IS NULL')
            for family in ('MATELAS','PLAQUE_MOUSSE','BANQUETTE','GAUFRETTE','SALON'):
                rows=db.execute('SELECT id,unit FROM Product WHERE family=? AND status=? ORDER BY id LIMIT 4',(family,'active')).fetchall()
                for id,unit in rows:
                    minimum=4 if unit=='u' else 5
                    db.execute('UPDATE Product SET minStock=?, targetStock=? WHERE id=?',(minimum,minimum*2,id))
            # Tous les comptes fictifs doivent choisir un nouveau mot de passe au premier accès.
            db.execute('UPDATE GoCmdUser SET must_change_password=1 WHERE active=1')
            # New audit record; no old access logs or expired sessions.
            db.execute("INSERT INTO AuditEvent(actor,action,entity,entityId,details) VALUES(?,?,?,?,?)",
                       ('demo_seed','DEMO_REGENERATED','Database','SODEPI-DEMO',json.dumps({'synthetic':True,'source':'reference seed','oldTransactionsDeleted':True})))
            db.commit()
            db.executescript(TRIGGERS.read_text(encoding='utf-8'))
            # Reconstituer également les évolutions P5.15.26/P5.15.27 et les index P5.15.29.
            # Aucun historique métier n'est importé : schéma seul, depuis la version officielle.
            db.executescript(OVERLAY.read_text(encoding='utf-8'))
            db.execute('BEGIN IMMEDIATE')
            # Archive-level delete protection active by default, including on demo.
            for table in PROTECTED:
                db.execute(f'''CREATE TRIGGER IF NOT EXISTS "gocmd_no_hard_delete_{table.lower()}"
                       BEFORE DELETE ON "{table}" BEGIN
                       SELECT RAISE(ABORT,'GOCMD_HISTORICAL_DELETE_FORBIDDEN'); END''')
            db.commit()
            db.execute('PRAGMA foreign_keys=ON')
            if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise RuntimeError('integrity_check failed')
            if db.execute('PRAGMA foreign_key_check').fetchone():raise RuntimeError('foreign_key_check failed')
            schema_counts={kind:db.execute("SELECT COUNT(*) FROM sqlite_master WHERE type=? AND name NOT LIKE 'sqlite_%'",(kind,)).fetchone()[0] for kind in ('table','index','trigger')}
            # P6 (2026-11-11) : l'overlay ajoute l'index SalesStockReservation_engagedAt_idx
            # (modèle d'ancienneté des réservations, chantier 2 §3.3) → 137 index attendus.
            if schema_counts != {'table':73,'index':137,'trigger':53}:
                raise RuntimeError(f'Schéma de démo P5 incomplet : {schema_counts}')
            for table in ('ProductionMaterialReceipt','ProductionStockOrder','ProductionMaterialCostApproval','ProductionReworkApproval'):
                if db.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?",(table,)).fetchone()[0]!=1:
                    raise RuntimeError(f'Table P5 absente : {table}')
            for t,n in EXPECTED.items():
                got=db.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
                if got!=n:raise RuntimeError(f'{t}: {got} != {n}')
            for t in ('PurchaseRequest','SupplierOrder','GoodsReceipt','Order','SalesQuote','SalesStockReservation','WorkOrder','GoCmdSession','GoCmdAccessAudit'):
                if db.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]!=0:
                    raise RuntimeError(f'Ancienne opération présente : {t}')
            if db.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'gocmd_no_hard_delete_%'").fetchone()[0]!=20:
                raise RuntimeError('20 protections suppression manquantes')
            if not db.execute("SELECT 1 FROM WarehouseSite WHERE code='SODEPI-DEMO'").fetchone():raise RuntimeError('Marqueur demo absent')
            mismatch=db.execute('''SELECT count(*) FROM Material m LEFT JOIN
                   (SELECT materialId,sum(qty) q FROM StockLot WHERE status='available' GROUP BY materialId) l
                   ON l.materialId=m.id WHERE abs(m.stockQty-coalesce(l.q,0)) > 0.00001''').fetchone()[0]
            if mismatch:raise RuntimeError(f'Quantité matières/lot incohérente: {mismatch}')
            mismatch=db.execute('''SELECT count(*) FROM StockLot l LEFT JOIN
                    (SELECT stockLotId,sum(qty) q FROM StockPlacement GROUP BY stockLotId) p
                    ON p.stockLotId=l.id WHERE abs(l.qty-coalesce(p.q,0))>0.00001''').fetchone()[0]
            if mismatch:raise RuntimeError(f'Lot/emplacements incohérents: {mismatch}')
            if db.execute('SELECT count(*) FROM Movement WHERE isOpeningBalance<>1').fetchone()[0]:raise RuntimeError('Movement historiques dans le seed')
            # VERSION V2 : recodifier TOUJOURS le catalogue neuf sur la copie DEMO.
            # Ceci ne modifie ni les opérations ni les quantités d'ouverture.
            mapping_rows=upgrade_demo_conn(db)
            if len(mapping_rows)!=EXPECTED['Material']+EXPECTED['Product']:
                raise RuntimeError('Table de correspondance V2 incomplète')
            if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or db.execute('PRAGMA foreign_key_check').fetchone():
                raise RuntimeError('Intégrité V2 défaillante')
            db.commit()
            db.execute('PRAGMA journal_mode=DELETE')
            db.execute('PRAGMA wal_checkpoint(TRUNCATE)') if db.execute('PRAGMA journal_mode').fetchone()[0]=='wal' else None
        # Sauvegarde transactionnelle de la copie DEMO précédente, indépendante
        # du ZIP final. Refuser le reset si cette sauvegarde échoue. SQLite backup()
        # gère le journal WAL, contrairement à une simple copie brute du .db.
        if path.exists():
            backups=ROOT/'db/demo_backups'
            backups.mkdir(parents=True,exist_ok=True)
            stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
            prior_backup=backups/f'demo_before_v2_reset_{stamp}_{uuid4().hex[:8]}.db'
            with sqlite3.connect(f'file:{path.as_posix()}?mode=ro',uri=True) as previous:
                with sqlite3.connect(prior_backup) as archived:
                    previous.backup(archived)
                    if archived.execute('PRAGMA integrity_check').fetchone()[0]!='ok':
                        raise RuntimeError('Sauvegarde DEMO invalide : reset annulé')
            try:prior_backup.chmod(0o600)
            except OSError:pass
        # Sous Windows, arrêter GoCmd avant la reconstruction : un fichier ouvert
        # empêchera normalement le remplacement. L'ancien fichier reste sauvegardé.
        os.replace(tmp,path)
        export_mapping(mapping_rows,ROOT/'db/recodification_v2_mapping.csv')
        print(f'BASE DEMO V2 RECRÉÉE : {path}; 82 matières, 18 fournisseurs, 135 liaisons, 218 produits, 9 comptes, 0 anciennes opérations, 20 protections actives')
    finally:
        tmp.unlink(missing_ok=True)

if __name__=='__main__':
    p=argparse.ArgumentParser(description='Supprime et RECRÉE la base fictive GoCmd de démonstration')
    p.add_argument('--db',type=Path,default=ROOT/'db/custom.db')
    p.add_argument('--apply',action='store_true')
    p.add_argument('--ack',default='')
    a=p.parse_args()
    if not a.apply or a.ack!='DEMO_ONLY':p.error('Préciser --apply --ack DEMO_ONLY pour recréer la DEMO uniquement')
    recreate(a.db)
