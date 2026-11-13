#!/usr/bin/env python3
"""GoCmd P5.13.2: REINITIALISATION DESTRUCTIVE d'une base de DEMONSTRATION.

Supprime les anciennes DA, RFQ, BC, BR, factures, mouvements et lots fictifs ;
recrée des stocks d'ouverture cohérents (rupture / sous seuil / normal), et
complète un catalogue de fournisseurs de TEST pour les consultations multi-matières.

NE PAS utiliser sur une base réelle. AUCUNE SAUVEGARDE N'EST CREEE.
Les comptes utilisateurs et le catalogue des ventes sont conservés.

Windows : python scripts/reinitialiser_demo_achats_p5132.py --db db/custom.db --apply
"""
from __future__ import annotations
import argparse
import datetime as dt
import math
import sqlite3
from pathlib import Path

MARKER = 'DEMO-P5132-OUVERTURE'
# Suppression explicite du périmètre achats, réception et stock ; les tables vente ne sont pas touchées.
PURGE = [
 'SupplierOfferAttachment', 'SupplierConsultationRecipientLine', 'SupplierConsultationLine',
 'SupplierConsultationRecipient', 'SupplierConsultation', 'SupplierQuoteOffer',
 'SupplierPriceAgreement', 'SupplierRFQ', 'SupplierReturnCreditAllocation',
 'SupplierRefund', 'SupplierCreditNote', 'SupplierInvoiceLine', 'SupplierPayment',
 'SupplierInvoice', 'SupplierReturn', 'SupplierDispute', 'QualityInspection',
 'StockCount', 'GoodsReceiptLine', 'StockPlacement', 'Movement', 'StockLot',
 'GoodsReceipt', 'SupplierDeliveryNote', 'SupplierDeliverySchedule',
 'SupplierOrderRevision', 'SupplierOrderLine', 'SupplierOrder',
 'PurchaseReceiptLine', 'PurchaseReceipt', 'PurchaseRequestLine', 'PurchaseRequest',
 # Les journaux de droits et connexion sont conserves (audit-securite).
]
COUNT_UNITS = {'bloc','plaque','rouleau','pcs','u'}

def pick_qty(minimum: float, unit: str, mode: str) -> float:
    if mode == 'rupture': return 0.0
    ratio = {'bas': 0.30, 'normal': 1.40}[mode]
    qty = minimum * ratio
    if unit.lower() in COUNT_UNITS:
        return float(max(1, math.floor(qty)))
    return round(max(.001, qty), 3)

def run(path: Path):
    if not path.is_file(): raise RuntimeError(f'Base introuvable : {path}')
    con = sqlite3.connect(str(path), timeout=10, isolation_level=None)
    con.row_factory = sqlite3.Row
    try:
        con.execute('PRAGMA busy_timeout=10000')
        con.execute('PRAGMA foreign_keys=OFF')
        have = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        required = set(PURGE) | {'Supplier','Material','SupplierMaterial','StockPlacement','StockLot','Movement','StorageLocation','SupplierQualification'}
        missing = required-have
        if missing: raise RuntimeError('Base incompatible, tables manquantes : '+', '.join(sorted(missing)))
        if not con.execute('SELECT 1 FROM StorageLocation LIMIT 1').fetchone():
            raise RuntimeError('Aucun emplacement de stock dans cette base')
        con.execute('BEGIN IMMEDIATE')
        for table in PURGE:
            con.execute('DELETE FROM "'+table+'"')
            con.execute('DELETE FROM sqlite_sequence WHERE name=?', (table,))

        # Ne purger que l'historique des transactions d'achat fictives ; ne pas effacer
        # les audit trails d'administration des utilisateurs et des connexions.
        con.execute("""DELETE FROM AuditEvent WHERE entity IN (
            'PurchaseRequest','PurchaseRequestLine','SupplierOrder','GoodsReceipt',
            'SupplierConsultation','SupplierRFQ','SupplierQuoteOffer',
            'SupplierInvoice','SupplierReturn','StockLot','Material','SupplierMaterial',
            'SupplierPriceAgreement','SupplierCreditNote')
            OR action LIKE 'PURCHASE_%' OR action LIKE 'RFQ_%'
            OR action LIKE 'CONSULTATION_%' OR action LIKE 'DEMO_STOCK_%' """)
        # Reconstruire les liens matières/fournisseurs, jamais les stocks sous forme de vente fictive.
        con.execute('DELETE FROM SupplierMaterial')
        con.execute('DELETE FROM sqlite_sequence WHERE name=?', ('SupplierMaterial',))

        def supplier_by_word(needle: str, create_name: str) -> int:
            for x in con.execute('SELECT id,name FROM Supplier'):
                if needle.casefold() in x['name'].casefold():
                    return x['id']
            codes = {r[0] for r in con.execute('SELECT code FROM Supplier')}
            n = 1
            while f'FRN-{n:04d}' in codes: n += 1
            cur = con.execute('INSERT INTO Supplier(code,name,active,city,country,paymentTerms) VALUES(?,?,?,?,?,?)',
                              (f'FRN-{n:04d}',create_name,1,'Casablanca','Maroc','30 jours (démo)'))
            sid = cur.lastrowid
            con.execute('INSERT INTO SupplierQualification(supplierId,status,score,note,reviewedBy) VALUES(?,?,?,?,?)',
                        (sid,'approved',85,'Qualification fictive pour recettes GoCmd','demo_seed'))
            return sid

        # Fournisseurs existants privilégiés ; nouveaux fournisseurs explicitement fictifs.
        foam_a = supplier_by_word('INNOFLEX', 'INNOFLEX — Démo')
        foam_b = supplier_by_word('RICHBOND', 'RICHBOND — Démo')
        glue_b = supplier_by_word('Colles Test', 'Colles Test — Fournisseur fictif')
        chem = supplier_by_word('ChimiPlus', 'ChimiPlus — Démo')
        tex = supplier_by_word('Textile Atlas', 'Textile Atlas — Démo')
        tex_b = supplier_by_word('Textiles Test', 'Textiles Test — Fournisseur fictif')
        foam_existing = supplier_by_word('Atlas Foam', 'Atlas Foam — Démo')
        foam_existing2 = supplier_by_word('PolyMousse', 'PolyMousse — Démo')
        merc = supplier_by_word('Mercerie Centrale', 'Mercerie Centrale — Démo')
        print_sup = supplier_by_word('Imprimerie Al Wafa', 'Imprimerie Al Wafa — Démo')
        plastic = supplier_by_word('Plastimar', 'Plastimar — Démo')

        # Articles de démonstration pour vérifier une commande multi-matières et deux devis.
        demos = [
            ('MP-MOU-PUR-STD-D30-BLN-BLC-FER-LG200-LR100-HT50-001',
             'Mousse pure STD D30 blanche — bloc 200 × 100 × 50 cm','Mousse','bloc',100.0,100.0,
             'Mousse pure standard, densité 30 kg/m³, blanche, ferme, bloc 200 × 100 × 50 cm.',
             'PURE','STD',30,'BLOC','BLN','FER',200,100,50,
             'FOAM-V1|PURE|BLOC|STD|30|BLN|FER||||200|100|50|'),
            ('MP-MOU-PUR-STD-D40-BLN-BLC-FER-LG200-LR100-HT50-001',
             'Mousse pure STD D40 blanche — bloc 200 × 100 × 50 cm','Mousse','bloc',130.0,60.0,
             'Mousse pure standard, densité 40 kg/m³, blanche, ferme, bloc 200 × 100 × 50 cm.',
             'PURE','STD',40,'BLOC','BLN','FER',200,100,50,
             'FOAM-V1|PURE|BLOC|STD|40|BLN|FER||||200|100|50|'),
        ]
        for ref,name,cat,unit,price,minstock,desc,nature,grade,dens,fmt,col,firm,l,w,h,identity in demos:
            if not con.execute('SELECT id FROM Material WHERE ref=?',(ref,)).fetchone():
                # Les références existantes de la base utilisateur restent prioritaires.
                if con.execute('SELECT id FROM Material WHERE foamIdentityKey=?',(identity,)).fetchone():
                    continue
                con.execute('''INSERT INTO Material(ref,name,category,unit,unitPrice,stockQty,minStock,location,averageCost,description,
                      foamNature,foamGrade,foamDensity,foamFormat,foamColor,foamFirmness,foamLengthCm,foamWidthCm,foamHeightCm,foamIdentityKey)
                     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                     (ref,name,cat,unit,price,0,minstock,'Dépôt A – Mousse',price,desc,
                     nature,grade,dens,fmt,col,firm,l,w,h,identity))

        extra = [
            ('MP-COL-DEMO-AGG-001', "Colle d'agglomération — usage fabrication (démo)", 'Colles','kg',36.0,80.0),
            ('MP-COL-DEMO-ASS-002', "Colle d'assemblage — grade rapide (démo)", 'Colles','kg',42.0,40.0),
        ]
        for ref,name,cat,unit,price,minstock in extra:
            if not con.execute('SELECT 1 FROM Material WHERE ref=?',(ref,)).fetchone():
                con.execute('INSERT INTO Material(ref,name,category,unit,unitPrice,stockQty,minStock,location,averageCost) VALUES(?,?,?,?,?,?,?,?,?)',
                            (ref,name,cat,unit,price,0,minstock,'Dépôt C – Emballage & Colle',price))

        # Synchroniser les seuils de démonstration ; le compte d'ouverture est tracé comme hypothèse fictive.
        materials = list(con.execute('SELECT id,ref,name,category,unit,minStock,unitPrice,foamNature FROM Material ORDER BY id'))
        location = con.execute('SELECT id FROM StorageLocation WHERE status="active" ORDER BY id LIMIT 1').fetchone()[0]
        stats={'rupture':0,'bas':0,'normal':0,'interne':0}
        supplier_links = 0
        for m in materials:
            ident,ref,name,cat,unit,minimum,price,nature = tuple(m)
            internal_foam = (nature == 'AGGLO' or 'agglomér' in name.casefold()) and cat=='Mousse'
            if minimum is None or minimum <= 0:
                minimum = {'bloc':50,'plaque':60,'pcs':400,'kg':50,'ml':300,'m³':35}.get(unit,30)
            if ref.endswith('D30-BLN-BLC-FER-LG200-LR100-HT50-001'):
                mode='rupture'
            elif ref.endswith('D40-BLN-BLC-FER-LG200-LR100-HT50-001'):
                mode='bas'
            elif internal_foam:
                # Stock fabriqué par GoProd, pas à acheter par RFQ.
                mode='normal';stats['interne']+=1
            else:
                mode=('rupture','bas','rupture','bas','normal')[(ident-1)%5]
            qty = pick_qty(float(minimum),unit,mode)
            con.execute('UPDATE Material SET minStock=?,stockQty=? WHERE id=?',(minimum,qty,ident))
            stats[mode]+=1
            if qty>0:
                lot = con.execute('''INSERT INTO StockLot(materialId,lotCode,status,qty,supplierId,receiptLineId,provenanceKey)
                    VALUES(?,?,?,?,NULL,NULL,?)''',(ident,f'OUVERTURE-DEMO-{ident:04d}','available',qty,MARKER)).lastrowid
                con.execute('INSERT INTO StockPlacement(stockLotId,locationId,qty) VALUES(?,?,?)',(lot,location,qty))
                con.execute('''INSERT INTO Movement(ref,type,materialId,qty,unit,reason,document,operator,signedQty,stockLotId,isOpeningBalance)
                   VALUES(?,?,?,?,?,?,?,?,?,?,1)''',
                   (f'MVT-DEMO-P5132-{ident:04d}','in',ident,qty,unit,'Stock initial fictif pour scénarios DA et RFQ',MARKER,'demo_reset',qty,lot))
            if internal_foam:
                con.execute('UPDATE Material SET supplier=NULL WHERE id=?',(ident,))
                continue
            if cat=='Mousse':
                # Mélange de fournisseurs par matière : les fiches communes déclenchent le filtre en cascade.
                vendors=[foam_a,foam_b,foam_existing] if ident%3 else [foam_a,foam_b,foam_existing2]
            elif cat=='Tissu':
                vendors=[tex,tex_b]
            elif cat=='Mercerie':
                vendors=[merc,tex_b]
            elif cat=='Colles' or 'colle' in name.casefold():
                vendors=[chem,glue_b]
            elif 'Etiquette' in name or 'Étiquette' in name or 'étiquette' in name:
                vendors=[print_sup,plastic]
            elif cat=='Emballage & consommables':
                vendors=[plastic,chem] if ('film' in name.casefold()) else [chem,plastic]
            else:
                vendors=[foam_existing,foam_b]
            for i,sid in enumerate(dict.fromkeys(vendors)):
                # Prix de catalogue strictement indicatifs ; pas de devis ni contrat créé fictivement.
                indicative=round(float(price)*(1.07+i*.08),2)
                con.execute('''INSERT INTO SupplierMaterial(supplierId,materialId,supplierSku,unitPrice,leadTimeDays,preferred,purchaseUnit,unitsPerPurchase)
                    VALUES(?,?,?,?,?,?,?,1)''',(sid,ident,f'DEMO-{ident:03d}-{i+1}',indicative,4+i*3,int(i==0),unit))
                supplier_links+=1
            con.execute('UPDATE Material SET supplier=(SELECT name FROM Supplier WHERE id=?) WHERE id=?',(vendors[0],ident))

        # Seuls les prix de D30 reprennent les deux prix indicatifs du scénario utilisateur.
        d30=con.execute("SELECT id FROM Material WHERE ref='MP-MOU-PUR-STD-D30-BLN-BLC-FER-LG200-LR100-HT50-001'").fetchone()
        if d30:
            con.execute('UPDATE SupplierMaterial SET unitPrice=300,leadTimeDays=5 WHERE materialId=? AND supplierId=?',(d30[0],foam_a))
            con.execute('UPDATE SupplierMaterial SET unitPrice=400,leadTimeDays=14 WHERE materialId=? AND supplierId=?',(d30[0],foam_b))

        # Nettoyage complet des compteurs d'achats : aucune DA / RFQ / BC de test n'est conservée.
        con.execute('''INSERT INTO AuditEvent(actor,action,entity,entityId,details)
            VALUES(?,?,?,?,?)''',('demo_reset','DEMO_STOCK_RESET','Material','all',
                 f'Réinitialisation explicitement demandée; {MARKER}; données fictives'))

        bad=con.execute('PRAGMA foreign_key_check').fetchall()
        if bad: raise RuntimeError(f'Liens SQL invalides : {bad[:10]}')
        integrity=con.execute('PRAGMA integrity_check').fetchone()[0]
        if integrity!='ok': raise RuntimeError('SQLite integrity_check : '+integrity)
        mismatch=con.execute('''SELECT m.id,m.ref,m.stockQty,COALESCE(SUM(CASE WHEN l.status='available' THEN l.qty ELSE 0 END),0) AS lots
            FROM Material m LEFT JOIN StockLot l ON l.materialId=m.id GROUP BY m.id
            HAVING ABS(m.stockQty-COALESCE(SUM(CASE WHEN l.status='available' THEN l.qty ELSE 0 END),0))>0.0001''').fetchall()
        if mismatch: raise RuntimeError(f'Stock≠lots disponibles : {mismatch[:5]}')
        place=con.execute('''SELECT l.id,l.qty,COALESCE(SUM(p.qty),0) AS placed FROM StockLot l
            LEFT JOIN StockPlacement p ON p.stockLotId=l.id GROUP BY l.id HAVING ABS(l.qty-COALESCE(SUM(p.qty),0))>0.0001''').fetchall()
        if place: raise RuntimeError(f'Stock≠emplacement : {place[:5]}')
        con.commit()
        con.execute('PRAGMA foreign_keys=ON')
        print(f'P5.13.2 OK | matières={len(materials)} | fournisseurs={con.execute("SELECT COUNT(*) FROM Supplier").fetchone()[0]} | liens={supplier_links}')
        print(f"Stocks : ruptures={stats['rupture']}, sous-seuil={stats['bas']}, suffisants={stats['normal']} (dont mousses internes={stats['interne']})")
        print('DA=0, RFQ=0, devis=0, BC=0, réceptions=0 | lots/mouvements cohérents | FK et SQLite OK')
        print('AUCUNE sauvegarde créée ; opération irréversible sur la base choisie.')
    except BaseException:
        if con.in_transaction: con.rollback()
        raise
    finally:
        con.close()

if __name__=='__main__':
    p=argparse.ArgumentParser(description='Réinitialisation destructive de données fictives uniquement, sans sauvegarde')
    p.add_argument('--db',default='db/custom.db')
    p.add_argument('--apply',action='store_true',help='Obligatoire pour autoriser la destruction des opérations de démonstration')
    args=p.parse_args()
    if not args.apply: raise SystemExit('Aucune modification : ajouter --apply pour réinitialiser la base fictive (sans sauvegarde).')
    run(Path(args.db).resolve())
