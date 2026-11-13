#!/usr/bin/env python3
"""Vérifications non destructives du corpus FSNW et absence de vieux prompts."""
from pathlib import Path
import re,sys,json,hashlib
ROOT=Path(__file__).resolve().parents[2]
FSNW=ROOT/'fsnw'
skills=sorted((FSNW/'skills').glob('*/SKILL.md'))
errors=[]
for p in skills:
 t=p.read_text(encoding='utf-8')
 if not t.startswith('---\n') or not re.search(r'^name:\s*[-\w]+\s*$',t,re.M) or not re.search(r'^description:',t,re.M): errors.append('frontmatter: '+str(p))
 if not len(t)>400: errors.append('skill vide: '+str(p))
for p in list(ROOT.glob('*PROMPT*.md'))+list((ROOT/'docs/historique').glob('*PROMPT*.md'))+list((FSNW/'sources').rglob('*PROMPT*.md')):
 errors.append('prompt obsolète présent: '+str(p))
if (FSNW/'sources/prompts').exists():errors.append('ancien répertoire sources/prompts présent')
for p in ('POLITIQUE_SODEPI_ACTUELLE.md','MATRICE_SKILLS.md','RESSOURCES_GITHUB_VERIFIEES.md','skills/ux-accessibilite/references/PROTOCOLE_AUDIT_UX_UI_ERP.md'):
 if not (FSNW/p).is_file():errors.append('requis manquant: '+p)
for item in json.loads((FSNW/'sources/MANIFEST_SOURCES.json').read_text(encoding='utf-8')):
 p=FSNW/item['file']
 if not p.is_file():errors.append('source absente: '+item['file'])
 elif hashlib.sha256(p.read_bytes()).hexdigest()!=item['sha256']:errors.append('sha source: '+item['file'])
print('FSNW skills:',len(skills),'| problèmes:',len(errors))
for e in errors:print('FAIL:',e)
sys.exit(int(bool(errors) or len(skills)!=20))
