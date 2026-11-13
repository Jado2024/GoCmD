#!/usr/bin/env python3
"""GoCmd V2 — reconstruction de la seule DEMO synthétique.

Garde DEMO stricte, dictionnaires de variantes fictives déterministes et
codes lisibles. AUCUN droit de migration de bases de production.
"""
from __future__ import annotations
import csv
import hashlib
import json
import re
import sqlite3
import unicodedata
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'db/custom.db'
FAMILIES={
'Tissu':('TIS',['type','composition','couleur','piquage','format','laizeCm','grammageGM2']),
'Ressorts':('RES',['technologie','longueurCm','largeurCm','hauteurCm','diametreFilMm']),
'Fibres & rembourrage':('FIB',['type','composition','grammageGM2','largeurCm']),
'Mercerie':('MER',['type','matiere','couleur','calibreMm']),
'Emballage & consommables':('EMB',['type','matiere','longueurCm','largeurCm','epaisseurUm']),
'Colles':('COL',['chimie','grade','conditionnement','capaciteKg'])}
LABELS={'type':'T','matiere':'MAT','composition':'CMP','couleur':'COU','piquage':'PIQ','format':'FMT','technologie':'TEC',
'longueurCm':'LG','largeurCm':'LR','hauteurCm':'HT','calibreMm':'CAL','laizeCm':'LZ','grammageGM2':'Q',
'diametreFilMm':'DIA','epaisseurUm':'EPUM','capaciteKg':'CAPKG','chimie':'CH','grade':'GR',
'conditionnement':'COND','qualite':'QL','motif':'MOT','finition':'FIN','marquage':'MAR','densite':'D',
'longueurFixeCm':'LF','epaisseurCm':'EPC','resilience':'RES','nuance':'NU','zones':'ZO','typeTechnique':'TT'}

def tok(s):
 s=unicodedata.normalize('NFKD',str(s).upper())
 return re.sub(r'(^-|-$)','',re.sub(r'[^A-Z0-9]+','-',''.join(x for x in s if not unicodedata.combining(x))))

def fixed_pf_code(spec):
 """Contract V2: exact byte-for-byte equivalent of fixedProductIdentity (TS).

 SQLite may return integral REALs as 28.0; JSON.stringify(28) serializes 28.
 The identity is a canonical typed object, not a textual float representation.
 """
 keys=('coreType','foamComposition','mattressFinish','upholstery','foamNature',
       'foamGrade','foamDensity','foamLayers','specialNotes')
 attrs={k:spec[k] for k in ('family','model','variant','length','width','height')}
 attrs['variant']=attrs['variant'] or 'STD'
 for k in keys:
  if k in spec and spec[k] is not None and spec[k]!='': attrs[k]=spec[k]
 for k,v in list(attrs.items()):
  if isinstance(v,float) and v.is_integer(): attrs[k]=int(v)
 canonical=json.dumps({'schema':'GOCMD-PF-V2','attributes':dict(sorted(attrs.items()))},
  ensure_ascii=False,separators=(',',':'))
 family=tok(attrs['family'])[:3]
 model=tok(attrs['model'])[:25]
 opts=[tok(str(attrs[k]))[:12] for k in ('coreType','foamComposition','mattressFinish','upholstery','foamNature') if attrs.get(k)]
 dimensions=f"{attrs['length']}X{attrs['width']}X{attrs['height']}CM"
 prefix='-'.join(['PF',family,model,*opts,dimensions,tok(attrs['variant'])])
 digest=hashlib.sha256(canonical.encode('utf-8')).hexdigest()[:12].upper()
 return canonical,f"{prefix[:140]}-{digest}",attrs

def identity(family,attrs):
 # Same typed keys as the V2 TypeScript service (JavaScript JSON field ordering).
 return json.dumps({'schema':'GOCMD-ARTICLE-V2','family':family,'attributes':dict(sorted(attrs.items()))},ensure_ascii=False,separators=(',',':'))

def make_ref(family,attrs,required):
 keys=required+sorted(k for k in attrs if k not in required)
 code='MP-'+family+'-'+ '-'.join(LABELS[k]+str(attrs[k]).replace('.','P') for k in keys)
 if len(code)>160:raise ValueError('Référence trop longue '+code)
 return code

def dims_from_name(name):
 m=re.search(r'(\d{2,3})\s*[×xX]\s*(\d{2,3})',name)
 return (int(m.group(1)),int(m.group(2))) if m else None

def derive_attrs(record):
 cat,ref,name,unit=record['category'],record['ref'],record['name'],record['unit']
 up=tok(ref);tname=tok(name)
 if cat=='Tissu':
  if 'PLATEAU' in up: kind='PLATEAU';type_='PLATEAU';piq='NON' if 'NONPIQUE' in up else 'PIQ'
  else:
   kind='ROULEAU';type_=up.replace('MP-TIS-','').replace('-DEMO','').replace('-SIM','').split('-')[0]
   piq='PIQ' if 'PIQUE' in up and 'NONPIQUE' not in up else 'NON'
  color=next((x for x in ('BLN','BLE','GRI','BEI','NOI','VER','ROU') if x in up or x in tname),'NAT')
  attrs={'type':type_,'composition':'PES','couleur':color,'piquage':piq,'format':kind,
   'laizeCm':160 if kind=='ROULEAU' else 90,'grammageGM2':250 if piq=='NON' else 300}
  if kind=='PLATEAU':attrs.update({'longueurCm':200,'largeurCm':160})
  if 'PANAMA' in up:attrs['type']='PANAMA'
  return attrs
 if cat=='Ressorts':
  m=re.search(r'(\d{3})(\d{3})',up)
  width,length=(int(m.group(1)),int(m.group(2))) if m else (90,190)
  return {'technologie':'ENS' if 'ENSACHE' in up else 'BON','longueurCm':length,'largeurCm':width,'hauteurCm':18,'diametreFilMm':2}
 if cat=='Fibres & rembourrage':
  typ='FEUTRE' if 'FEUTRE' in up else 'OUATE' if 'OUATE' in up else 'FIBRE'
  grammage=next((int(x) for x in re.findall(r'\b\d{3}\b',up) if int(x) in (250,300,350,400,500,800)),300)
  qualite='SILICONE100D' if 'SILICONE' in up else 'REMBOURRAGE' if 'REMBOURRAGE' in up else 'OUATE-BASE' if 'POLYESTER-OUATE' in up else 'STD'
  return {'type':typ,'composition':'PES','grammageGM2':grammage,'largeurCm':160,'qualite':qualite}
 if cat=='Mercerie':
  typ=next((k for k in ('POIGNETTE','ELASTIQUE','RUBAN','GANSE','ZIP','FIL') if k in up),'ACCESS')
  color=next((x for x in ('BLN','BLE','GRI','BEI','NOI','VER','ROU') if x in up),'NAT')
  dimension=next((int(x) for x in re.findall(r'\d+',up) if 1<int(x)<200),10)
  qualite='T3' if 'T3' in up else 'STD'
  return {'type':typ,'matiere':'NYL' if typ=='ZIP' else 'PES','couleur':color,'calibreMm':dimension if 'MM' in up else 5,
          'longueurCm':dimension if 'CM' in up else 100,'qualite':qualite}
 if cat=='Emballage & consommables':
  typ=next((x for x in ('HOUSSE','CARTON','FILM','SACHET','RUBAN','ETIQUETTE') if x in up),'EMB')
  dims=dims_from_name(name)
  if dims is None:dims=(int(re.search(r'\b(090|160)\b',up).group(1)),200) if re.search(r'\b(090|160)\b',up) else (100,100)
  qualite='PE' if 'PE' in up or typ in ('FILM','HOUSSE','SACHET') else 'CARTON' if typ=='CARTON' else 'STD'
  return {'type':typ,'matiere':qualite,'longueurCm':dims[1],'largeurCm':dims[0],
   'epaisseurUm':40 if typ in ('FILM','HOUSSE','SACHET') else 300,'qualite':tok(up.replace('MP-EMB-',''))[:24]}
 if cat=='Colles':
  typ='NEOPRENE' if 'NEOPRENE' in up else 'AGGLO' if 'AGGLO' in up else 'RAPIDE' if 'RAPIDE' in up else 'SPRAY' if 'SPRAY' in up else 'ASSEMBLAGE'
  return {'chimie':'PU' if 'PU' in up else 'AQU','grade':typ,'conditionnement':'FUT','capaciteKg':20 if '20' in up else 25}
 raise ValueError('Famille inconnue '+cat)

def columns(conn,table):return {r[1] for r in conn.execute(f'PRAGMA table_info("{table}")')}
def add(conn,table,field,definition):
 if field not in columns(conn,table):conn.execute(f'ALTER TABLE "{table}" ADD COLUMN "{field}" {definition}')
def check_demo(conn):
 if not conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='WarehouseSite'").fetchone():
  raise ValueError('Garde DEMO : marqueur technique absent')
 if not conn.execute("SELECT 1 FROM WarehouseSite WHERE code='SODEPI-DEMO'").fetchone():
  raise ValueError('Garde DEMO : code site non autorisé')
 for t in ('Order','OrderLine','WorkOrder','PurchaseRequest','SupplierOrder','SalesInvoice'):
  if conn.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0]:
   raise ValueError(f'Garde DEMO : historique {t} non vide, abandon')
 if conn.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('DB corrompue')

def upgrade_demo_conn(conn:sqlite3.Connection):
 """On an isolated, verified DEMO database only; caller owns BEGIN/COMMIT."""
 check_demo(conn)
 for t,fields in {
  'Material':{'canonicalIdentity':'TEXT','technicalAttributesJson':'TEXT'},
  'Product':{'canonicalIdentity':'TEXT','technicalAttributesJson':'TEXT','isOrderScoped':'BOOLEAN NOT NULL DEFAULT 0'},
  'OrderLine':{'kind':"TEXT NOT NULL DEFAULT 'CATALOG'",'genericTemplate':'TEXT','technicalSnapshotJson':'TEXT','technicalSnapshotHash':'TEXT'},
  'SupplierMaterial':{'supplierLookupKey':'TEXT','supplierSkuExceptionApprovedBy':'TEXT','supplierSkuExceptionReason':'TEXT'},
 }.items():
  for k,v in fields.items():add(conn,t,k,v)
 # Construire la correspondance depuis l'inventaire encore fictif.
 conn.row_factory=sqlite3.Row
 records=[]
 used=set()
 for m in conn.execute('SELECT * FROM Material ORDER BY id').fetchall():
  old=m['ref'];category=m['category'];id_=m['id']
  if category=='Mousse':
   attrs={key:m[key] for key in ['foamNature','foamFormat','foamGrade','foamDensity','foamColor','foamFirmness',
    'foamResilience','foamSupplierGrade','foamLengthCm','foamWidthCm','foamHeightCm','foamThicknessCm'] if m[key] is not None}
   canonical=json.dumps({'schema':'GOCMD-ARTICLE-V2','family':'MOU','foam':m['foamIdentityKey']},ensure_ascii=False,separators=(',',':'))
   ref=old
  else:
   attrs=derive_attrs(m)
   fam,required=FAMILIES[category]
   canonical=identity(fam,attrs)
   ref=make_ref(fam,attrs,required)
  # Les produits de négoce suivent la matière, sans second stock.
  if canonical in used:raise ValueError(f'Doublon canonique id={id_} {ref}; effectuer fusion métier avant de seed')
  used.add(canonical)
  if not all(0<=ord(c)<128 for c in ref):raise ValueError('SKU non ASCII')
  technical=' ; '.join(f'{k} : {v}'+({'longueurCm':' cm','largeurCm':' cm','hauteurCm':' cm','laizeCm':' cm',
   'calibreMm':' mm','diametreFilMm':' mm','epaisseurUm':' µm','capaciteKg':' kg','grammageGM2':' g/m²'}.get(k,''))
   for k,v in sorted(attrs.items()))
  previous_description=m['description'] or ''
  if category!='Mousse':
   technical=f'{category} — {technical}'
   description=(previous_description.rstrip('. ')+'. Fiche technique : '+technical) if previous_description else technical
   if len(description)>900:description=technical[:900]
   conn.execute('UPDATE Material SET ref=?,canonicalIdentity=?,technicalAttributesJson=?,description=? WHERE id=?',
    (ref,canonical,json.dumps(attrs,ensure_ascii=False,sort_keys=True,separators=(',',':')),description,id_))
  else:
   conn.execute('UPDATE Material SET ref=?,canonicalIdentity=?,technicalAttributesJson=? WHERE id=?',
    (ref,canonical,json.dumps(attrs,ensure_ascii=False,sort_keys=True,separators=(',',':')),id_))
  records.append({'table':'Material','id':id_,'old_ref':old,'new_ref':ref,'category':category,'action':'conservée' if old==ref else 'recodée','canonical_identity':canonical})
 # Code PF fixe, en gardant un identifiant stable et des liens commerciaux inchangés.
 used_pf={}
 for x in conn.execute('SELECT * FROM Product ORDER BY id').fetchall():
  old=x['sku']; id_=x['id']
  if x['materialId'] is not None:
   source=conn.execute('SELECT ref,canonicalIdentity,technicalAttributesJson FROM Material WHERE id=?',(x['materialId'],)).fetchone()
   if not source:raise ValueError('Lien négoce orphelin')
   new=source['ref'];canonical=source['canonicalIdentity'];attrs=json.loads(source['technicalAttributesJson'])
   conn.execute('UPDATE Product SET sku=?,model=?,canonicalIdentity=?,technicalAttributesJson=? WHERE id=?',
    (new,new,canonical,source['technicalAttributesJson'],id_))
  else:
   spec={key:x[key] for key in ['family','model','variant','length','width','height',
    'coreType','foamComposition','mattressFinish','upholstery','foamNature','foamGrade',
    'foamDensity','foamLayers','specialNotes'] if key in x.keys()}
   canonical,new,attrs=fixed_pf_code(spec)
   if canonical in used_pf.values():raise ValueError(f'Doublon identité PF: id={id_} {canonical}')
   if new in used_pf:raise ValueError(f'Collision SKU PF: id={id_} {new}')
   used_pf[new]=canonical
   conn.execute('UPDATE Product SET sku=?,canonicalIdentity=?,technicalAttributesJson=? WHERE id=?',
    (new,canonical,json.dumps(attrs,ensure_ascii=False,sort_keys=True,separators=(',',':')),id_))
  records.append({'table':'Product','id':id_,'old_ref':old,'new_ref':new,'category':x['family'],'action':'liée négoce' if x['materialId'] is not None else 'recodée','canonical_identity':canonical})
 # La référence originale du fournisseur est intacte : seulement une clé de recherche.
 suppliers=set()
 for x in conn.execute('SELECT id,supplierId,materialId,supplierSku FROM SupplierMaterial ORDER BY id').fetchall():
  raw=x['supplierSku'] or ''
  normal=unicodedata.normalize('NFKC',raw).strip().upper()
  normal=' '.join(normal.split())
  key=f"{x['supplierId']}#{normal}" if normal else None
  if key and key in suppliers:raise ValueError('Collision fournisseur existante: '+key)
  if key:suppliers.add(key)
  conn.execute('UPDATE SupplierMaterial SET supplierLookupKey=? WHERE id=?',(key,x['id']))
 conn.executescript('''
 CREATE UNIQUE INDEX IF NOT EXISTS Material_canonicalIdentity_key ON Material(canonicalIdentity);
 CREATE UNIQUE INDEX IF NOT EXISTS Product_canonicalIdentity_key ON Product(canonicalIdentity);
 CREATE UNIQUE INDEX IF NOT EXISTS SupplierMaterial_supplierLookupKey_key ON SupplierMaterial(supplierLookupKey);
 CREATE INDEX IF NOT EXISTS Product_isOrderScoped_idx ON Product(isOrderScoped,status,family);
 CREATE INDEX IF NOT EXISTS OrderLine_technicalSnapshotHash_idx ON OrderLine(technicalSnapshotHash);
 CREATE TRIGGER IF NOT EXISTS v2_material_global_reference_insert
 BEFORE INSERT ON Material WHEN EXISTS (SELECT 1 FROM Product p WHERE UPPER(p.sku)=UPPER(NEW.ref) AND (p.materialId IS NULL OR p.materialId!=NEW.id))
 BEGIN SELECT RAISE(ABORT,'V2_GLOBAL_ARTICLE_REF_COLLISION'); END;
 CREATE TRIGGER IF NOT EXISTS v2_material_global_reference_update
 BEFORE UPDATE OF ref ON Material WHEN EXISTS (SELECT 1 FROM Product p WHERE UPPER(p.sku)=UPPER(NEW.ref) AND (p.materialId IS NULL OR p.materialId!=NEW.id))
 BEGIN SELECT RAISE(ABORT,'V2_GLOBAL_ARTICLE_REF_COLLISION'); END;
 CREATE TRIGGER IF NOT EXISTS v2_product_global_reference_insert
 BEFORE INSERT ON Product WHEN EXISTS (SELECT 1 FROM Material m WHERE UPPER(m.ref)=UPPER(NEW.sku) AND (NEW.materialId IS NULL OR NEW.materialId!=m.id))
 BEGIN SELECT RAISE(ABORT,'V2_GLOBAL_ARTICLE_REF_COLLISION'); END;
 CREATE TRIGGER IF NOT EXISTS v2_product_global_reference_update
 BEFORE UPDATE OF sku,materialId ON Product WHEN EXISTS (SELECT 1 FROM Material m WHERE UPPER(m.ref)=UPPER(NEW.sku) AND (NEW.materialId IS NULL OR NEW.materialId!=m.id))
 BEGIN SELECT RAISE(ABORT,'V2_GLOBAL_ARTICLE_REF_COLLISION'); END;
 CREATE TRIGGER IF NOT EXISTS v2_supplier_lookup_insert BEFORE INSERT ON SupplierMaterial
 WHEN NEW.supplierSku IS NOT NULL AND TRIM(NEW.supplierSku)!='' AND NEW.supplierLookupKey IS NULL AND NEW.supplierSkuExceptionApprovedBy IS NULL
 BEGIN SELECT RAISE(ABORT,'V2_SUPPLIER_SKU_LOOKUP_REQUIRED'); END;
 CREATE TRIGGER IF NOT EXISTS v2_supplier_lookup_update BEFORE UPDATE OF supplierSku,supplierLookupKey ON SupplierMaterial
 WHEN NEW.supplierSku IS NOT NULL AND TRIM(NEW.supplierSku)!='' AND NEW.supplierLookupKey IS NULL AND NEW.supplierSkuExceptionApprovedBy IS NULL
 BEGIN SELECT RAISE(ABORT,'V2_SUPPLIER_SKU_LOOKUP_REQUIRED'); END;
 ''')
 # NB: fournisseur exception manuelle = trace obligatoire et contrôle 4-yeux hors API.
 conn.execute('INSERT INTO AuditEvent(actor,action,entity,entityId,details) VALUES(?,?,?,?,?)',
  ('demo_seed','DEMO_V2_RECODIFIED','Database','SODEPI-DEMO',json.dumps({'materials':len([r for r in records if r['table']=='Material']),
   'products':len([r for r in records if r['table']=='Product']),'scope':'DEMO','dictionary':'V2-DEMO-PROVISIONAL'})))
 conn.row_factory=None
 return records

def export_mapping(rows,path):
 with open(path,'w',newline='',encoding='utf-8-sig') as f:
  w=csv.DictWriter(f,fieldnames=['table','id','old_ref','new_ref','category','action','canonical_identity'])
  w.writeheader();w.writerows(rows)

if __name__=='__main__':
 import argparse,sys
 a=argparse.ArgumentParser();a.add_argument('--db',type=Path,default=BASE);a.add_argument('--apply',action='store_true');a.add_argument('--ack',default='');o=a.parse_args()
 if not o.apply or o.ack!='DEMO_ONLY':a.error('Préciser --apply --ack DEMO_ONLY (copie fictive uniquement)')
 if o.db.resolve()!=BASE.resolve():a.error('Chemin refusé : uniquement db/custom.db de cette archive DEMO')
 with sqlite3.connect(o.db) as db:
  check_demo(db)
  rows=upgrade_demo_conn(db)
  if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise RuntimeError('Corruption après recodification')
  if db.execute('PRAGMA foreign_key_check').fetchone():raise RuntimeError('Foreign keys invalides')
  db.commit()
 export_mapping(rows,ROOT/'db/recodification_v2_mapping.csv')
 print('DEMO V2:',len(rows),'correspondances, aucune commande historique')
