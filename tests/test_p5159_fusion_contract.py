#!/usr/bin/env python3
"""P5.15.9 — preuves statiques de fusion et intégrité d'une démo isolée.
Ce test ne remplace PAS une recette HTTP et navigateur.
CASCADE3 (11/11/2026) : contrat actualisé sur la base démo P5.15.23
(82 matières / 218 produits / 18 fournisseurs / 9 comptes) et sur le
durcissement A-023/INFO-001 — les messages d'erreur transférés au client
sont désormais FILTRÉS par liste blanche métier (plus de transfert brut
« e instanceof Error?e.message » qui divulguait des détails techniques).
"""
from pathlib import Path
import sqlite3, hashlib
ROOT=Path(__file__).resolve().parents[1]
nav=(ROOT/'src/components/erp/top-navigation.tsx').read_text()
table=(ROOT/'src/components/ui/table.tsx').read_text()
sales=(ROOT/'src/app/api/sales/route.ts').read_text()
foam=(ROOT/'scripts/catalogue_v16.py').read_text()
assert 'ResizeObserver' in nav and 'edges.right' in nav and 'scrollLeft' in nav
assert 'aria-label="Navigation principale GoCmd"' in nav
assert 'print:overflow-visible' in table and 'edges.right' in table
assert 'A-023' in sales and 'buildPieces' in sales
# INFO-001 : messages métier filtrés, jamais de divulgation technique brute.
assert 'e instanceof Error&&/pièce|gabarit' in sales
assert 'e instanceof Error?e.message' not in sales, 'transfert brut de message interdit (INFO-001)'
assert "if fmt=='ROULEAU': nature='PURE'" in foam
v16=ROOT/'tests/fixtures/v16_demo.db'
assert v16.exists() and hashlib.sha256(v16.read_bytes()).hexdigest()=='002756607bf36f19ebd6fd3c1124b8189fd406a78d4fa8579d0b71495188987f'
with sqlite3.connect(f'file:{ROOT/"db/custom.db"}?mode=ro',uri=True) as db:
 assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
 assert not list(db.execute('PRAGMA foreign_key_check'))
 # Base de référence P5.15.23 (reseed SODEPI, cf. README) — plus l'ancien 64/217/11/0.
 for t,n in [('Material',82),('Product',218),('Supplier',18),('GoCmdUser',9)]:
  assert db.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]==n, t
 assert db.execute('SELECT COUNT(*) FROM GoCmdUser WHERE active=1').fetchone()[0]==9, '9 comptes de démonstration actifs'
print('PASS P5.15.9 fusion : UX F1/F2, A-023 durci (INFO-001), mousse AGGLO, fixture V16, catalogue et SQLite P5.15.23. (statique + SQL seulement)')
