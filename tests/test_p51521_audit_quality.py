"""Gate documentaire non destructif pour GoCmd P5.15.21 : CSV structurés, pas de risque fictivement accepté."""
from pathlib import Path
import csv
import re
ROOT=Path(__file__).resolve().parents[1]
def load(name):
    with (ROOT/'AUDIT_FINAL_P51521'/name).open(encoding='utf-8',newline='') as f:
        rows=list(csv.reader(f,delimiter=';'))
    assert rows and rows[0],f'{name}: fichier vide'
    for i,row in enumerate(rows[1:],start=2):
        assert len(row)==len(rows[0]),f'{name}:{i}: {len(row)} colonnes au lieu de {len(rows[0])}'
    return [dict(zip(rows[0],row)) for row in rows[1:]]

dmaic=load('REGISTRE_DMAIC.csv')
assert len(dmaic)==10,len(dmaic)
assert len(set(row['id'] for row in dmaic))==len(dmaic)
for row in dmaic:
    for field in ('id','titre','define','measure','analyze','improve','control','statut','gravite'):
        assert row[field].strip(),f'{row["id"]}: {field} vide'
    assert re.match(r'^P[0-3](?:\b|\s|\()',row['gravite']),f'{row["id"]}: gravité incorrecte {row["gravite"]}'
    assert row['statut'].startswith(('CLOS PAR EXECUTION','ANALYSE PUIS REVERTU')),f'{row["id"]}: statut incohérent {row["statut"]}'

amdec=load('AMDEC_P51521.csv')
assert len(amdec)==23,len(amdec)
pending=0
for row in amdec:
    for f in ('G','O','D','criticite_initiale','criticite_residuelle'):
        assert row[f].isdigit(),f'{row["mode_defaillance"]}: {f} invalide'
    initial=int(row['G'])*int(row['O'])*int(row['D'])
    assert initial==int(row['criticite_initiale']),(row['mode_defaillance'],initial)
    assert 'RISQUE ACCEPTÉ DOCUMENTÉ' not in row['statut'],f'{row["mode_defaillance"]}: acceptation non signée'
    if row['statut'].startswith('EN ATTENTE D ARBITRAGE'):
        pending+=1
        assert row['responsable'],f'{row["mode_defaillance"]}: responsable absent'
assert pending==6,f'{pending} décisions attendues au lieu de 6'
file=ROOT/'AUDIT_FINAL_P51521/DECISIONS_METIER_EN_ATTENTE.md'
assert file.is_file(),file
print(f'PASS QA documentaire: {len(dmaic)} DMAIC sur 9 colonnes, {len(amdec)} risques AMDEC, {pending} sujets de risque non homologués par SODEPI (décisions fonctionnelles du 08/11 documentées séparément).')

# CI gate regression : HTTP cap test must run on a built production server.
ci=(ROOT/'.github/workflows/ci.yml').read_text(encoding='utf-8')
assert ci.index('run: bun run build')<ci.index('run: bun run test:p51521')
assert 'run: bun run test:audit:quality' in ci
import json
scripts=json.loads((ROOT/'package.json').read_text(encoding='utf-8'))['scripts']
assert 'test:v18913p5147' in scripts['test:regression:runtime']
assert scripts['test:audit:quality'].startswith('python tests/test_p51521_audit_quality.py')
