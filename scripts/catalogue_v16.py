#!/usr/bin/env python3
"""GoCmd V16: catalogue de simulation reproductible, totalement fictif.
Ne pas utiliser les prix et densités à des fins commerciales/industrielles réelles.
"""
import json
CORE=[('SANS_RESSORTS','Sans ressorts'),('BONNELL','Ressorts Bonnell'),('ENSACHES','Ressorts ensachés')]
FOAM=[('PURE','Mousse pure'),('MELANGE','Mélange pure + agglomérée'),('AGGLO','Mousse agglomérée')]
FIELDS=('coreType','foamComposition','mattressFinish','upholstery','foamNature','foamGrade','foamDensity','foamLayers','taxonomyVersion')
FIELDS_DEFAULTS={'coreType': None, 'foamComposition': None, 'mattressFinish': None, 'upholstery': None, 'foamNature': None, 'foamGrade': None, 'foamDensity': None, 'foamLayers': None, 'taxonomyVersion': 1}

def ensure_schema(c):
    existing={row[1] for row in c.execute('PRAGMA table_info(Product)')}
    for name in FIELDS:
        if name not in existing:
            typ='REAL' if name=='foamDensity' else 'INTEGER NOT NULL DEFAULT 1' if name=='taxonomyVersion' else 'TEXT'
            c.execute(f'ALTER TABLE Product ADD COLUMN "{name}" {typ}')
    c.execute('CREATE INDEX IF NOT EXISTS Product_family_core_foam_idx ON Product(family,coreType,foamComposition)')
    c.execute('CREATE INDEX IF NOT EXISTS Product_family_nature_density_idx ON Product(family,foamNature,foamDensity)')

def insert(c,sku,family,model,subcategory,length,width,height,unit,price,**spec):
    name=f'{family.replace("_"," ")} · {model} · {length}×{width}×{height} cm'
    data=dict(sku=sku,name=name,family=family,model=model,subCategory=subcategory,variant='STD',length=length,width=width,height=height,unit=unit,unitPrice=price,status='active',**FIELDS_DEFAULTS)
    data.update(spec)
    cols=','.join('"'+k+'"' for k in data)
    c.execute('INSERT INTO Product ('+cols+') VALUES ('+','.join('?' for _ in data)+')',tuple(data.values()))

def rebuild_sim_catalogue(c):
    ensure_schema(c)
    ensure_demo_foam_materials(c)
    # Suppression de TOUS les documents transactionnels avant la suppression du catalogue.
    from reinitialiser_demo_v16 import TRANSACTION_TABLES
    c.execute('PRAGMA defer_foreign_keys=ON')
    for t in TRANSACTION_TABLES:
        c.execute(f'DELETE FROM "{t}"')
        c.execute('DELETE FROM sqlite_sequence WHERE name=?',(t,))
    c.execute('DELETE FROM Product')
    c.execute('DELETE FROM sqlite_sequence WHERE name="Product"')
    i=0
    for core, corelabel in CORE:
      for foam, foamlabel in FOAM:
        for finish,finishlabel in [('SANS','sans option'),('TOPPER','avec topper'),('ALESE','avec alèse')]:
          for length,width,height in [(190,90,18),(190,140,22),(200,160,25)]:
            i+=1
            layers=(json.dumps([{'nature':'PURE','densityKgM3':28,'thicknessCm':6,'grade':'DEMO-P28'}, {'nature':'AGGLO','densityKgM3':60,'thicknessCm':8,'grade':'DEMO-A60'}],ensure_ascii=False) if foam=='MELANGE' else None)
            insert(c,f'SIM-MAT-{i:03}','MATELAS',f'DEMO MAT {corelabel} {foamlabel} {finishlabel}','Adulte',length,width,height,'u',235+10*i,
              coreType=core,foamComposition=foam,mattressFinish=finish,foamGrade=None if foam=='MELANGE' else 'DEMO-P28' if foam=='PURE' else 'DEMO-A60',
              foamDensity=None if foam=='MELANGE' else 28 if foam=='PURE' else 60,foamLayers=layers)
    i=0
    for core,corelabel in CORE:
      for foam,foamlabel in FOAM:
        for upholstery,upholabel in [('NUE','nue'),('TISSU','avec tissu')]:
          for length,width,height in [(100,60,10),(120,70,20),(180,80,25)]:
            i+=1
            layers=(json.dumps([{'nature':'PURE','densityKgM3':30,'thicknessCm':4},{'nature':'AGGLO','densityKgM3':70,'thicknessCm':5}],ensure_ascii=False) if foam=='MELANGE' else None)
            insert(c,f'SIM-BQ-{i:03}','BANQUETTE',f'DEMO BQ {corelabel} {foamlabel} {upholabel}','Banquette',length,width,height,'ml',290+i*5,
              coreType=core,foamComposition=foam,upholstery=upholstery,foamGrade=None if foam=='MELANGE' else 'DEMO-P30' if foam=='PURE' else 'DEMO-A70',
              foamDensity=None if foam=='MELANGE' else 30 if foam=='PURE' else 70,foamLayers=layers)
    i=0
    for nature,naturelabel in [('PURE','Pure'),('AGGLO','Agglomérée')]:
      for grade in ['QUALITE-DEMO-A','QUALITE-DEMO-B']:
        for density in ([20,28,35] if nature=='PURE' else [60,80,100]):
          for length,width,height in [(200,100,5),(200,120,10),(190,90,15)]:
            i+=1
            insert(c,f'SIM-PLA-{i:03}','PLAQUE_MOUSSE',f'DEMO PLAQUE {naturelabel} {grade} D{density}',naturelabel,length,width,height,'u',390+i*3,
                   foamNature=nature,foamGrade=grade,foamDensity=density)
    for i in range(1,10):
       insert(c,f'SIM-SAL-{i:03}','SALON',f'DEMO ENSEMBLE {i:02}','Ensemble',100,60,28,'ml',235+i*4)
    for i in range(1,10):
       insert(c,f'SIM-GAU-{i:03}','GAUFRETTE',f'DEMO GAUFRETTE {i:02}','Gaufrette',100,65,15,'ml',280+i*4)
    create_validation_triggers(c)
    # Atomic metadata: referentiels volontairement fictifs.
    total=c.execute('SELECT COUNT(*) FROM Product').fetchone()[0]
    if total!=189: raise RuntimeError(f'Catalogue attendu=189, obtenu={total}')
    return total


def create_validation_triggers(c):
    # Défense complémentaire à la validation des API : reject SQL invalid product updates/imports.
    for operation in ('INSERT','UPDATE'):
        name='go_v16_product_'+operation.lower()
        c.execute(f'DROP TRIGGER IF EXISTS {name}')
        sql=f"""
        CREATE TRIGGER {name} BEFORE {operation} ON Product BEGIN
          SELECT CASE WHEN NEW.family NOT IN ('MATELAS','BANQUETTE','SALON','GAUFRETTE','PLAQUE_MOUSSE','OUATE')
            THEN RAISE(ABORT,'Famille inconnue') END;
          SELECT CASE WHEN NEW.length<=0 OR NEW.width<=0 OR NEW.height<=0 OR NEW.unitPrice<0
            THEN RAISE(ABORT,'Dimensions ou tarif invalides') END;
          SELECT CASE WHEN ((NEW.family IN ('MATELAS','PLAQUE_MOUSSE') AND NEW.unit!='u') OR
                            (NEW.family IN ('BANQUETTE','SALON','GAUFRETTE') AND NEW.unit!='ml') OR
                            (NEW.family='OUATE' AND NEW.unit!='kg'))
            THEN RAISE(ABORT,'Unité incompatible avec la famille') END;
          SELECT CASE WHEN NEW.family IN ('MATELAS','BANQUETTE') AND
            (NEW.coreType IS NULL OR NEW.coreType NOT IN ('SANS_RESSORTS','BONNELL','ENSACHES') OR
             NEW.foamComposition IS NULL OR NEW.foamComposition NOT IN ('PURE','MELANGE','AGGLO') OR
             NEW.foamNature IS NOT NULL)
            THEN RAISE(ABORT,'Noyau/composition non autorisés') END;
          SELECT CASE WHEN NEW.family='MATELAS' AND
            (NEW.mattressFinish IS NULL OR NEW.mattressFinish NOT IN ('SANS','TOPPER','ALESE') OR NEW.upholstery IS NOT NULL)
            THEN RAISE(ABORT,'Configuration matelas invalide') END;
          SELECT CASE WHEN NEW.family='BANQUETTE' AND
            (NEW.upholstery IS NULL OR NEW.upholstery NOT IN ('NUE','TISSU') OR NEW.mattressFinish IS NOT NULL)
            THEN RAISE(ABORT,'Habillage banquette invalide') END;
          SELECT CASE WHEN NEW.family IN ('MATELAS','BANQUETTE') AND NEW.foamComposition IN ('PURE','AGGLO') AND
            (NEW.foamDensity IS NULL OR NEW.foamDensity<=0 OR NEW.foamDensity>500 OR NEW.foamLayers IS NOT NULL)
            THEN RAISE(ABORT,'Densité mousse hors limites') END;
          SELECT CASE WHEN NEW.family IN ('MATELAS','BANQUETTE') AND NEW.foamComposition='MELANGE' AND
            (NEW.foamDensity IS NOT NULL OR NEW.foamLayers IS NULL OR json_valid(NEW.foamLayers)!=1 OR
             json_array_length(NEW.foamLayers)<2)
            THEN RAISE(ABORT,'Mélange : couches obligatoires') END;
          -- Défense SQL contre JSON de mélange plausible en surface mais physiquement impossible.
          SELECT CASE WHEN NEW.family IN ('MATELAS','BANQUETTE') AND NEW.foamComposition='MELANGE'
            AND json_valid(NEW.foamLayers)=1 AND (
               EXISTS(SELECT 1 FROM json_each(NEW.foamLayers) layer
                 WHERE json_type(layer.value,'$.nature')!='text'
                    OR json_extract(layer.value,'$.nature') NOT IN ('PURE','AGGLO')
                    OR COALESCE(json_type(layer.value,'$.densityKgM3'),'null') NOT IN ('real','integer')
                    OR CAST(json_extract(layer.value,'$.densityKgM3') AS REAL)<=0
                    OR CAST(json_extract(layer.value,'$.densityKgM3') AS REAL)>500
                    OR COALESCE(json_type(layer.value,'$.thicknessCm'),'null') NOT IN ('real','integer')
                    OR CAST(json_extract(layer.value,'$.thicknessCm') AS REAL)<=0)
               OR NOT EXISTS(SELECT 1 FROM json_each(NEW.foamLayers) WHERE json_extract(value,'$.nature')='PURE')
               OR NOT EXISTS(SELECT 1 FROM json_each(NEW.foamLayers) WHERE json_extract(value,'$.nature')='AGGLO')
               OR (SELECT SUM(CAST(json_extract(value,'$.thicknessCm') AS REAL)) FROM json_each(NEW.foamLayers)) > NEW.height+0.001)
            THEN RAISE(ABORT,'Couches mélange invalides ou épaisseur supérieure au produit') END;
          SELECT CASE WHEN NEW.family='PLAQUE_MOUSSE' AND
            (NEW.foamNature IS NULL OR NEW.foamNature NOT IN ('PURE','AGGLO') OR
             NEW.foamDensity IS NULL OR NEW.foamDensity<=0 OR NEW.foamDensity>500 OR
             NEW.foamGrade IS NULL OR length(trim(NEW.foamGrade))<2 OR
             NEW.coreType IS NOT NULL OR NEW.foamComposition IS NOT NULL OR NEW.mattressFinish IS NOT NULL OR
             NEW.upholstery IS NOT NULL OR NEW.foamLayers IS NOT NULL)
            THEN RAISE(ABORT,'Plaque mousse : nature/type/densité invalides') END;
          SELECT CASE WHEN NEW.family IN ('SALON','GAUFRETTE','OUATE') AND
            (NEW.coreType IS NOT NULL OR NEW.foamComposition IS NOT NULL OR NEW.mattressFinish IS NOT NULL OR
             NEW.upholstery IS NOT NULL OR NEW.foamNature IS NOT NULL OR NEW.foamDensity IS NOT NULL OR NEW.foamLayers IS NOT NULL)
            THEN RAISE(ABORT,'Champs techniques hors périmètre') END;
        END;
        """
        c.execute(sql)


def ensure_demo_foam_materials(c):
    existing={r[1] for r in c.execute('PRAGMA table_info(Material)')}
    for name,typ in [('foamNature','TEXT'),('foamGrade','TEXT'),('foamDensity','REAL')]:
        if name not in existing:c.execute(f'ALTER TABLE Material ADD COLUMN "{name}" {typ}')
    # Les références matières restent stables (liens stock/achats préservés).
    # Les qualités, densités et natures suivantes sont strictement fictives.
    # A-002 (recette nov. 2026) : règle métier SODEPI « mousse agglomérée jamais
    # en rouleau » (POLITIQUE_SODEPI §6, trigger P5.15.5). Sur une base enrichie
    # P5.15.x dotée de foamFormat, l'affectation par parité ne doit jamais marquer
    # AGGLO une mousse en rouleau : le UPDATE déclencherait une IntegrityError
    # brute au lieu du refus propre du référentiel demo() (55 matières attendues).
    has_format='foamFormat' in {r[1] for r in c.execute('PRAGMA table_info(Material)')}
    materials=c.execute("SELECT id,ref"+(",foamFormat" if has_format else "")+" FROM Material WHERE category='Mousse' ORDER BY id").fetchall()
    for i,row in enumerate(materials):
        mid,ref=row['id'],row['ref']
        fmt=(row['foamFormat'] if has_format else None)
        nature='PURE' if i%2==0 else 'AGGLO'
        if fmt=='ROULEAU': nature='PURE'  # règle métier : agglomérée jamais en rouleau
        density=([20,25,28,33,35][i%5] if nature=='PURE' else [60,70,80,90,100][i%5])
        quality=('SIM-PURE-D'+str(density)) if nature=='PURE' else ('SIM-AGGLO-D'+str(density))
        name=f'Mousse {"pure" if nature=="PURE" else "agglomérée"} · densité fictive D{density} · {quality}'
        c.execute('UPDATE Material SET name=?,foamNature=?,foamGrade=?,foamDensity=? WHERE id=?',(name,nature,quality,density,mid))
    c.execute("UPDATE Material SET foamNature=NULL,foamGrade=NULL,foamDensity=NULL WHERE category!='Mousse'")
