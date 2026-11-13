#!/usr/bin/env python3
"""Reconstruit UNIQUEMENT le catalogue matières d'une base GoCmd de démonstration.
Données fictives. Mode atomique, sans sauvegarde persistante (sur demande expresse).
Usage: python scripts/reconstruire_demo_sodepi_articles_p5154.py --db db/custom.db --confirm-demo-reset
ATTENTION: n'exécuter ni sur une installation de production ni sur une base réelle.
"""
from __future__ import annotations
import argparse, hashlib, os, shutil, sqlite3, tempfile, json
from pathlib import Path
from datetime import datetime, timezone

STAMP='2026-11-05 12:30:00'
PRODUCT_CREATED=STAMP
FAMILIES={'Mousse','Tissu','Ressorts','Colles','Fibres & rembourrage','Mercerie','Emballage & consommables'}
UNITS={'kg','m³','m²','ml','m','pcs','u','L','rouleau','bloc','plaque'}
COLORS={'BLN':'blanche','BLE':'bleue','GRI':'grise','NOI':'noire','VER':'verte','BEI':'beige','JAU':'jaune','ROS':'rose'}
SEQ=0
ARTICLES=[]

def add(category,code,name,unit,price,stock,minimum,*,sell=False,make=False,internal=True,
        sales_unit=None,sales_price=0,scale=1,suppliers=(),description='',foam=None):
    assert category in FAMILIES and unit in UNITS and (sales_unit or unit) in UNITS
    assert not (make and suppliers) and (make or suppliers)
    assert not (category=='Mousse' and foam and foam['nature']=='AGGLO' and suppliers)
    assert not (category=='Mousse' and foam and foam['nature']=='AGGLO' and foam['format']=='ROULEAU')
    assert (sell or internal) and price>=0 and stock>=0 and minimum>=0
    if unit in {'bloc','plaque','rouleau','pcs','u'}:assert stock==int(stock) and minimum==int(minimum)
    if sell: assert sales_price>0 and scale>0
    else: assert sales_price==0
    ARTICLES.append(dict(category=category,ref=code,name=name,unit=unit,unitPrice=price,stockQty=stock,minStock=minimum,
                         isPurchasable=bool(suppliers),isManufactured=make,isSellable=sell,isInternalUse=internal,
                         salesUnit=sales_unit or unit,unitsPerSale=scale,salesUnitPrice=sales_price,suppliers=suppliers,
                         description=description or (name+' — référence fictive pour recette SODEPI.'),foam=foam))

def foam(nature,fmt,grade,density,color,dim,*,firm=None,res=None,quality=None,price,stock,minimum,sell=False):
    ntag='PUR' if nature=='PURE' else 'AGG'; ftag={'BLOC':'BLC','PLAQUE':'PLQ','ROULEAU':'ROL'}[fmt]
    parts=['MP','MOU',ntag,grade,f'D{density}',color,ftag]
    if firm:parts.append(firm)
    if res is not None:parts.append('RES'+str(res).replace('.','P'))
    if quality:parts.append('GF'+quality.replace(' ','').upper())
    length,width,depth=dim
    if fmt!='ROULEAU':parts.append(f'LG{length}')
    parts.extend([f'LR{width}',f'{"HT" if fmt=="BLOC" else "EP"}{depth}'])
    code='-'.join(map(str,parts))+'-001'
    widthtext=f'{length} × {width} × {depth} cm' if fmt!='ROULEAU' else f'largeur {width} × épaisseur {depth} cm, longueur variable'
    char=f'Mousse {"pure" if nature=="PURE" else "agglomérée"} {grade} D{density} {COLORS[color]} — {fmt.lower()} {widthtext}'
    spec=dict(nature=nature,format=fmt,grade=grade,density=density,color=color,firmness=firm,resilience=res,
              supplier_grade=quality,length_cm=length if fmt!='ROULEAU' else None,width_cm=width,
              height_cm=depth if fmt=='BLOC' else None,thickness_cm=depth if fmt!='BLOC' else None)
    unit={'BLOC':'bloc','PLAQUE':'plaque','ROULEAU':'rouleau'}[fmt]
    suppliers=(1,6,8,9) if nature=='PURE' else ()
    add('Mousse',code,char,unit,price,stock,minimum,sell=sell,make=(nature=='AGGLO'),
        sales_price=round(price*1.5,2) if sell and price>0 else (275 if sell else 0),suppliers=suppliers,
        description=f'{char}. Densité {density} kg/m³, couleur {COLORS[color]}, fermeté {firm or "non précisée"}. Données DEMO, non contractuelles.',foam=spec)

# Mousses pures, codes incluant chaque dimension et variante technique.
for args in [
 ('BLOC','STD',20,'BLN',(200,120,100),'SOU',275,16,5,True),
 ('BLOC','STD',25,'BLE',(200,120,100),'MOY',325,10,6,True),
 ('BLOC','HR',28,'VER',(200,140,100),'SOU',450,0,4,True),
 ('BLOC','STD',33,'BLN',(200,120,100),'FER',495,12,5,True),
 ('BLOC','HR',35,'GRI',(200,140,100),'FER',595,3,7,True),
 ('BLOC','VIS',50,'BEI',(200,120,80),'SOU',730,0,4,False),
 ('BLOC','STD',30,'JAU',(190,90,100),'MOY',420,7,6,False),
 ('BLOC','HR',40,'BLE',(200,160,100),'FER',685,2,4,True),
 ('PLAQUE','STD',20,'BLN',(200,120,5),'SOU',38,48,12,True),
 ('PLAQUE','STD',25,'BLE',(200,120,10),'MOY',82,6,10,True),
 ('PLAQUE','HR',33,'BLN',(200,120,5),'FER',110,32,12,True),
 ('PLAQUE','HR',35,'GRI',(200,140,8),'FER',152,0,7,True),
 ('PLAQUE','VIS',50,'BEI',(200,120,4),'SOU',185,9,12,False),
 ('PLAQUE','STD',28,'VER',(190,90,6),'MOY',68,4,8,True),
 ('ROULEAU','STD',18,'BLN',(None,150,1),'SOU',225,5,3,True),
 ('ROULEAU','STD',22,'BLE',(None,160,2),'MOY',310,0,3,True),
 ('ROULEAU','HR',30,'GRI',(None,140,3),'FER',405,2,4,False),
]:
 fmt,grade,density,color,dim,firm,price,stock,minimum,sell=args
 foam('PURE',fmt,grade,density,color,dim,firm=firm,price=price,stock=stock,minimum=minimum,sell=sell)
# Agglomérée fabriquée en interne : interdiction d'achat fournisseur, pas de rouleau.
for args in [
 ('BLOC',70,'GRI',(200,120,100),12,6,True),
 ('BLOC',80,'NOI',(200,140,100),0,4,True),
 ('BLOC',90,'VER',(200,120,100),7,10,True),
 ('BLOC',100,'GRI',(190,90,90),4,3,False),
 ('PLAQUE',70,'GRI',(200,120,5),22,9,True),
 ('PLAQUE',80,'NOI',(200,140,8),2,5,True),
 ('PLAQUE',90,'VER',(200,120,10),0,6,True),
]:
 fmt,density,color,dim,stock,minimum,sell=args
 foam('AGGLO',fmt,'STD',density,color,dim,firm='FER',price=0,stock=stock,minimum=minimum,sell=sell)

# Tissus: l'unité de stock est le mètre linéaire; achat possible par rouleaux de 50 m.
for i,(short,label,col,price,stock,minimum,sell) in enumerate([
 ('TIS-VELOURS-BEI','Velours beige non piqué','beige',28,175,100,True),
 ('TIS-JACQUARD-GRI','Jacquard gris non piqué','gris',39,62,100,True),
 ('TIS-CHENILLE-BLE','Chenille bleu non piqué','bleu',43,0,80,True),
 ('TIS-COUTIL-BLN','Coutil blanc non piqué','blanc',24,310,120,True),
 ('TIS-COUTIL-GRI','Coutil gris non piqué','gris',27,18,80,True),
 ('TIS-TRICOT-BEI','Tricot beige non piqué','beige',21,160,90,True),
 ('TIS-DOUBLURE-BLN','Doublure blanche non piqué','blanc',15,320,180,False),
 ('TIS-NONTISSE-GRI','Non-tissé gris','gris',11,0,120,False),
 ('TIS-CANEVAS-NOI','Canevas noir','noir',19,55,70,False),
 ]):
 add('Tissu','MP-'+short,'Tissu '+label+' — rouleau fournisseur, stock au ml','ml',price,stock,minimum,sell=sell,
     sales_price=round(price*1.5,2) if sell else 0,suppliers=(7,11),
     description=f'Tissu {label}, coloris {col}. Achat par rouleau de 50 ml, suivi et vente au mètre linéaire. Valeurs de démonstration.')
for code,name,stock in [('PLATEAU-PIQUE-BLN','Plateau textile piqué blanc',40),('PLATEAU-PIQUE-GRI','Plateau textile piqué gris',0),('PLATEAU-NONPIQUE-BEI','Plateau textile non piqué beige',12)]:
 add('Tissu','MP-'+code,name,'pcs',0,stock,20,make=True,description=name+' — préparation atelier, sans DA fournisseur.')

# Ressorts achetés assemblés, stockés à la pièce.
for code,name,price,stock,minstock in [
 ('BONNELL-090190','Carcasse Bonnell 90 × 190 cm',200,16,8),
 ('BONNELL-140190','Carcasse Bonnell 140 × 190 cm',315,4,8),
 ('ENSACHES-160200','Carcasse ressorts ensachés 160 × 200 cm',480,0,6),
 ('ENSACHES-090190','Carcasse ressorts ensachés 90 × 190 cm',260,9,5),
 ]:
 add('Ressorts','MP-RES-'+code,name,'pcs',price,stock,minstock,suppliers=(8,9),description='Carcasse de ressorts déjà assemblée, unité pièce. Dimensions achat; adaptation atelier à tracer séparément. DEMO.')

for code,name,price,stock,minimum in [
 ('AGGLO','Colle pour agglomération de mousse',32,0,60),
 ('ASSEMBLAGE','Colle pour assemblage matelas/banquettes',27,85,50),
 ('SPRAY','Colle spéciale application atelier',44,15,30),
 ]:
 add('Colles','MP-COL-'+code,name,'kg',price,stock,minimum,suppliers=(2,10),description='Colle achetée, référence distincte selon le procédé. Prix fictif MAD/kg.')

for code,name,unit,price,stock,minimum,sell,make,suppliers in [
 ('FEUTRE-500','Feutre de protection 500 g/m²','m²',19,120,80,False,False,(7,11)),
 ('POLYESTER-OUATE','Fibre polyester pour fabrication de ouate','kg',22,28,60,False,False,(7,11)),
 ('FIBRE-REMBOURRAGE','Fibre polyester de rembourrage','kg',27,0,45,False,False,(7,11)),
 ('OUATE-FAB-250','Ouate fabriquée 250 g/m² — vendable au kg','kg',0,65,35,True,True,()),
 ('OUATE-FAB-400','Ouate fabriquée 400 g/m² — vendable au kg','kg',0,0,25,True,True,()),
 ]:
 add('Fibres & rembourrage','MP-FIB-'+code,name,unit,price,stock,minimum,sell=sell,make=make,
     sales_price=(48 if '250' in code else 64) if sell else 0,suppliers=suppliers,description='Référence de démonstration SODEPI. Ouate : produit fabriqué en interne, vente au kg.' if make else 'Fibre/feutre achetée destinée à la production.')

for code,name,unit,price,stock,minimum,sell in [
 ('FIL-PES-BLN','Fil de couture polyester blanc','ml',0.06,2500,1500,False),
 ('FIL-PES-NOI','Fil de couture polyester noir','ml',0.06,0,1500,False),
 ('RUBAN-25MM','Ruban textile 25 mm','ml',2.35,370,200,True),
 ('GANSE-BEI','Ganse / bordage beige','ml',3.1,130,220,False),
 ('GANSE-GRI','Ganse / bordage gris','ml',3.15,250,180,False),
 ('ZIP-60CM','Fermeture éclair 60 cm','pcs',3.5,45,120,False),
 ('ZIP-100CM','Fermeture éclair 100 cm','pcs',5.2,0,80,False),
 ('ELASTIQUE-40MM','Élastique textile 40 mm','ml',1.7,75,100,False),
 ]:
 add('Mercerie','MP-MER-'+code,name,unit,price,stock,minimum,sell=sell,
     sales_price=3.9 if sell else 0,suppliers=(4,11),description='Mercerie achetée, référence et conditionnement fictifs.')

for code,name,unit,price,stock,minimum,suppliers in [
 ('FILM-ETIRABLE','Film plastique étirable','rouleau',58,19,20,(5,)),
 ('FILM-PE','Film polyéthylène emballage','rouleau',42,0,10,(5,)),
 ('HOUSSE-MAT-090','Housse matelas 90 × 190 cm','pcs',6,170,150,(5,)),
 ('HOUSSE-MAT-160','Housse matelas 160 × 200 cm','pcs',9,55,70,(5,)),
 ('CARTON-MAT','Carton de transport matelas','pcs',14,35,50,(5,3)),
 ('ETIQUETTE-PROD','Étiquette produit SODEPI (fictive)','pcs',0.7,350,1000,(3,)),
 ('SACHET-ACCESS','Sachet accessoires','pcs',0.8,100,300,(5,3)),
 ('RUBAN-EMB','Ruban adhésif emballage','rouleau',11,3,12,(5,)),
 ]:
 add('Emballage & consommables','MP-EMB-'+code,name,unit,price,stock,minimum,suppliers=suppliers,description='Consommable d’emballage acheté — données fictives pour les tests.')


def quote_ident(x:str):return '"'+x.replace('"','""')+'"'

def reset(db):
    db.execute('PRAGMA foreign_keys=ON')
    check_demo=db.execute("SELECT COUNT(*) FROM WarehouseSite WHERE code='SODEPI-DEMO' AND name LIKE '%simulation%'").fetchone()[0]
    if check_demo!=1: raise RuntimeError('Refus : cette base ne porte pas le marqueur DEMO attendu')
    for t in ('PurchaseRequest','SupplierOrder','GoodsReceipt','SupplierInvoice','SalesStockReservation','SalesStockAllocation'):
        if db.execute(f'SELECT COUNT(*) FROM {quote_ident(t)}').fetchone()[0]:
            raise RuntimeError(f'Refus: {t} contient des opérations. Nettoyer séparément une base DEMO non vide.')
    if db.execute('SELECT COUNT(*) FROM Product WHERE materialId IS NOT NULL').fetchone()[0]>0:
        raise RuntimeError('Refus: des produits de négoce existent déjà : recréer depuis la base P5.15.4 originale uniquement')
    db.execute('BEGIN IMMEDIATE')
    for t in ('SupplierMaterial','StockPlacement','Movement','StockLot','Material'):
        db.execute('DELETE FROM '+quote_ident(t))
    db.execute('DELETE FROM AuditEvent')
    db.execute("DELETE FROM sqlite_sequence WHERE name IN ('Material','SupplierMaterial','StockLot','StockPlacement','Movement','AuditEvent')")
    sups={r[0]:r[1] for r in db.execute('SELECT id,name FROM Supplier WHERE active=1')}
    assert len(sups)>=10
    locations={r[0]:r[1] for r in db.execute('SELECT code,id FROM StorageLocation')}
    assert 'MP-A' in locations and 'MP-C' in locations
    for n,a in enumerate(ARTICLES,1):
        f=a['foam'] or {}
        identity=None
        if f:
            def num(v):return str(int(v)) if float(v).is_integer() else str(v).replace('.','P')
            identity='|'.join(str(x or '') for x in ['FOAM-V1',f['nature'],f['format'],f['grade'],num(f['density']),f['color'],f['firmness'],f['resilience'],f['supplier_grade'],num(f['length_cm']) if f['length_cm'] else None,num(f['width_cm']),num(f['height_cm']) if f['height_cm'] else None,num(f['thickness_cm']) if f['thickness_cm'] else None])
        supp_names=','.join(sups[i] for i in a['suppliers'][:2]) if a['suppliers'] else None
        storage='MP-C' if a['isManufactured'] else 'MP-A'
        values=(a['ref'],a['name'],a['category'],a['unit'],a['unitPrice'],a['stockQty'],a['minStock'],storage,supp_names,
                a['unitPrice'] if a['isPurchasable'] else None,
                f.get('nature'),f.get('grade'),f.get('density'),f.get('format'),a['description'],f.get('color'),f.get('firmness'),f.get('resilience'),f.get('supplier_grade'),f.get('length_cm'),f.get('width_cm'),f.get('height_cm'),f.get('thickness_cm'),identity,
                int(a['isPurchasable']),int(a['isManufactured']),int(a['isSellable']),int(a['isInternalUse']),a['salesUnit'],a['unitsPerSale'],a['salesUnitPrice'])
        db.execute('''INSERT INTO Material(ref,name,category,unit,unitPrice,stockQty,minStock,location,supplier,averageCost,
            foamNature,foamGrade,foamDensity,foamFormat,description,foamColor,foamFirmness,foamResilience,foamSupplierGrade,
            foamLengthCm,foamWidthCm,foamHeightCm,foamThicknessCm,foamIdentityKey,
            isPurchasable,isManufactured,isSellable,isInternalUse,salesUnit,unitsPerSale,salesUnitPrice)
            VALUES ('''+','.join('?'*len(values))+')',values)
        mid=db.execute('SELECT last_insert_rowid()').fetchone()[0]
        if a['isSellable']:
            db.execute('''INSERT INTO Product(sku,name,family,model,variant,length,width,height,unit,unitPrice,createdAt,status,materialId,unitsPerSale)
                          VALUES (?,?, 'NEGOCE',?,'STD',1,1,1,?,?,?,?,?,?)''',
                       (a['ref'],a['name'],a['ref'],a['salesUnit'],a['salesUnitPrice'],PRODUCT_CREATED,'active',mid,a['unitsPerSale']))
        for sidx,sid in enumerate(a['suppliers'][:3]):
            unit_price=round(a['unitPrice']*(1+.04*sidx),2)
            purchase_unit='rouleau' if a['category']=='Tissu' and a['unit']=='ml' else a['unit']
            units_per_purchase=50 if purchase_unit=='rouleau' and a['unit']=='ml' else 1
            db.execute('''INSERT INTO SupplierMaterial(supplierId,materialId,supplierSku,unitPrice,leadTimeDays,preferred,purchaseUnit,unitsPerPurchase)
                          VALUES (?,?,?,?,?,?,?,?)''',(sid,mid,f'DEMO-{a["ref"][:48]}-{sid}',unit_price,3+2*sidx,int(sidx==0),purchase_unit,units_per_purchase))
        quantity=a['stockQty']
        if quantity:
            # Two identifiable lots where possible (supports FEFO/reservations tests).
            # P5.15.13 (AN-CPL-02) : sur unité INDIVISIBLE, la scission doit produire des
            # moitiés ENTIÈRES (ceil+floor) — round(quantity*0.5,3) fabriquait des
            # demi-pièces pour tout stock impair (45 pcs → 22.5+22.5, cf. contre-audit).
            # Sur unité divisible (kg, ml…), la demi-quantité reste légitime.
            split=quantity>=2 and n%3==0
            if not split:
                chunks=[quantity]
            elif a['unit'].strip().lower() in {'kg','g','t','tonne','ml','m','m2','m²','l','litre','litres','m3','m³'}:
                chunks=[round(quantity*.5,3),round(quantity*.5,3)]
            else:
                first=-(-quantity//2)  # ceil pour les moitiés entières
                chunks=[int(first),int(quantity-first)]
            for li,q in enumerate(chunks,1):
                lot_code=f'DEMO-SODEPI-{n:03d}-L{li:02d}'
                db.execute('''INSERT INTO StockLot(materialId,lotCode,status,qty,supplierId,receiptLineId,provenanceKey,receivedAt)
                              VALUES (?,?,'available',?,?,NULL,'DEMO-OUVERTURE-P5154',?)''',
                           (mid,lot_code,q,a['suppliers'][0] if a['suppliers'] else None,STAMP))
                lotid=db.execute('SELECT last_insert_rowid()').fetchone()[0]
                db.execute('INSERT INTO StockPlacement(stockLotId,locationId,qty) VALUES(?,?,?)',(lotid,locations[storage],q))
                db.execute('''INSERT INTO Movement(ref,type,materialId,qty,unit,reason,document,operator,createdAt,signedQty,stockLotId,isOpeningBalance)
                              VALUES (?,'in',?,?,?,?,?,?,?,?,?,1)''',
                           (f'MVT-SODEPI-DEMO-{n:03d}-{li:02d}',mid,q,a['unit'],'Stock initial de démonstration - non issu d’une réception réelle','DEMO-OUVERTURE-P5154','system_demo',STAMP,q,lotid))
    db.execute('''INSERT INTO AuditEvent(actor,action,entity,entityId,details,createdAt)
                  VALUES('system_demo','DEMO_MATERIALS_RESEEDED','Material','all',?,?)''',
               (json.dumps({'count':len(ARTICLES),'note':'Réinitialisation fictive du catalogue matières; tous les stocks sont des soldes d’ouverture, aucune réception réelle.'},ensure_ascii=False),STAMP))
    db.commit()


def verify(db):
    assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    assert not db.execute('PRAGMA foreign_key_check').fetchall()
    materials=db.execute('SELECT COUNT(*) FROM Material').fetchone()[0]
    sold=db.execute('SELECT COUNT(*) FROM Material WHERE isSellable=1').fetchone()[0]
    linked=db.execute('SELECT COUNT(*) FROM Product WHERE materialId IS NOT NULL').fetchone()[0]
    manufactured=db.execute('SELECT COUNT(*) FROM Material WHERE isManufactured=1').fetchone()[0]
    suppliers=db.execute('SELECT COUNT(*) FROM SupplierMaterial').fetchone()[0]
    zeros=db.execute('SELECT COUNT(*) FROM Material WHERE stockQty=0').fetchone()[0]
    low=db.execute('SELECT COUNT(*) FROM Material WHERE stockQty<minStock').fetchone()[0]
    assert materials==len(ARTICLES) and sold==linked and sold>=20 and manufactured>=10 and suppliers>=70 and zeros>=15 and low>=15
    assert not db.execute('SELECT id FROM Material WHERE foamNature="AGGLO" AND isPurchasable=1').fetchall()
    assert not db.execute('SELECT id FROM Material WHERE isPurchasable=0 AND EXISTS (SELECT 1 FROM SupplierMaterial WHERE materialId=Material.id)').fetchall()
    assert not db.execute('SELECT id FROM Product WHERE family="NEGOCE" AND materialId IS NULL').fetchall()
    assert not db.execute('''SELECT m.id FROM Material m LEFT JOIN StockLot l ON l.materialId=m.id
          GROUP BY m.id HAVING ABS(m.stockQty-COALESCE(SUM(CASE WHEN l.status='available' THEN l.qty ELSE 0 END),0))>0.000001''').fetchall()
    assert not db.execute('''SELECT l.id FROM StockLot l LEFT JOIN StockPlacement s ON s.stockLotId=l.id
          GROUP BY l.id HAVING ABS(l.qty-COALESCE(SUM(s.qty),0))>0.000001''').fetchall()
    assert db.execute('SELECT COUNT(*) FROM Product WHERE materialId IS NULL').fetchone()[0]>=180
    return {'materials':materials,'sellable':sold,'linkedTradeProducts':linked,'manufactured':manufactured,
            'suppliers':db.execute('SELECT COUNT(*) FROM Supplier').fetchone()[0], 'supplierMaterialLinks':suppliers,
            'zeroStock':zeros,'underMinimum':low, 'lots':db.execute('SELECT COUNT(*) FROM StockLot').fetchone()[0],
            'stockMovements':db.execute('SELECT COUNT(*) FROM Movement').fetchone()[0],
            'commercialProducts':db.execute('SELECT COUNT(*) FROM Product').fetchone()[0],
            'purchases':db.execute('SELECT COUNT(*) FROM PurchaseRequest').fetchone()[0]}


def rebuild(path):
    # Copy-on-write technique using an ephemeral temp file, NOT a retained backup.
    fd,tmp=tempfile.mkstemp(prefix='.gocmd_demo_seed_',suffix='.db',dir=str(path.parent));os.close(fd)
    try:
        with sqlite3.connect(f'file:{path}?mode=ro',uri=True) as orig,sqlite3.connect(tmp) as w:orig.backup(w)
        db=sqlite3.connect(tmp)
        try:
            reset(db)
            result=verify(db)
            db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        finally:db.close()
        os.replace(tmp,path)
        print(json.dumps(result,ensure_ascii=False,indent=2))
        return result
    finally:
        if os.path.exists(tmp):os.unlink(tmp)

if __name__=='__main__':
    pa=argparse.ArgumentParser(description=__doc__)
    pa.add_argument('--db',required=True)
    pa.add_argument('--confirm-demo-reset',action='store_true')
    arg=pa.parse_args()
    if not arg.confirm_demo_reset:pa.error('Exige --confirm-demo-reset (destructif pour le catalogue DEMO).')
    rebuild(Path(arg.db).resolve())
