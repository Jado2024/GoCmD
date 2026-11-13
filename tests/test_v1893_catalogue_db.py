import sqlite3, tempfile, shutil, os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as td:
  # P5.15.8 : la fixture versionnée est figée en lecture seule ; la copie de
  # travail doit être explicitement inscriptible pour rejouer la migration.
  test=Path(td)/'test.db';shutil.copy(ROOT/'tests/fixtures/v16_demo.db',test);os.chmod(test,0o644)
  from sys import path as sys_path
  sys_path.insert(0,str(ROOT/'scripts'))
  from apply_catalogue_upgrade_v1893 import apply
  apply(test);apply(test)
  with sqlite3.connect(test) as db:
    assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    assert db.execute('PRAGMA foreign_key_check').fetchone() is None
    assert db.execute('SELECT COUNT(*) FROM Product').fetchone()[0]==189
    fields={r[1] for r in db.execute('PRAGMA table_info(Product)')}
    assert {'commercialBrand','actualManufacturer','commercialAbbreviation','descriptionOverride'}<=fields
    # A genuinely supported OUATE entry, but only in isolated temporary DB:
    row=db.execute('SELECT sku,name,model,length,width,height,unitPrice,subCategory FROM Product LIMIT 1').fetchone()
    db.execute('INSERT INTO Product(sku,name,family,model,length,width,height,unit,unitPrice,subCategory) VALUES (?,?,?,?,?,?,?,?,?,?)',('TEST-OU-001','Ouate de test','OUATE','Ouatage',1,1,1,'kg',100,'Fibre'))
    assert db.execute('SELECT unit FROM Product WHERE sku=?',('TEST-OU-001',)).fetchone()[0]=='kg'
    try:
      db.execute("INSERT INTO Material(ref,name,category,unit,unitPrice,stockQty,minStock,foamNature,foamFormat,foamGrade,foamDensity) VALUES (?,?,?,?,?,?,?,?,?,?,?)",('M-BAD-OU','Agglo en rouleau','Mousse','kg',10,0,0,'AGGLO','ROULEAU','SIM',80))
      raise AssertionError('agglomeree en rouleau acceptee')
    except sqlite3.IntegrityError: pass
    try:
      db.execute('INSERT INTO Product(sku,name,family,model,length,width,height,unit,unitPrice,subCategory) VALUES (?,?,?,?,?,?,?,?,?,?)',('BAD-OU-001','Ouate invalide','OUATE','Ouatage',1,1,1,'u',100,'Fibre'))
      raise AssertionError('unité interdite acceptée')
    except sqlite3.IntegrityError: pass
print('PASS V18.9.3 — base existante, migration idempotente, OUATE kg et refus unité invalide')
