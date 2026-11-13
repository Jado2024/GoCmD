#!/usr/bin/env python3
"""R5: exécution bornée de contrôles EXISTANTS par skill, sur copie DEMO.
Un PASS ici est ciblé; il ne vaut ni homologation ni exécution du skill complet.
"""
from __future__ import annotations
from pathlib import Path
import hashlib,json,os,subprocess,sys,datetime
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'PDCA_R5/preuves/skills_matrix.json'
C={
 'audit-orchestrator':['python','tests/test_v2_r5_delivery_policy.py'],
 'preuve-tracabilite':['python','tests/test_p6_audit_seal_chain.py'],
 'build-ci':None,
 'sqlite-integrite':['python','tests/test_stock_sqlite_atomicity.py'],
 'securite-confidentialite':['python','tests/test_security_closure_20261109.py'],
 'achats-p2p':['python','tests/test_da_bc_br_sqlite.py'],
 'stocks-qualite':['python','tests/test_v07_lots_provenance.py'],
 'ventes-directeur':['node','--experimental-strip-types','tests/v2-price-snapshot.test.mjs'],
 'catalogue-gabarits':['node','--experimental-strip-types','tests/v2-pf-database-parity.test.mjs'],
 'ux-accessibilite':['python','tests/test_v18910_ux_contract.py'],
 'tests-navigateur-playwright':None,
 'performance-react-nextjs':None,
 'finance-maroc':['node','--experimental-strip-types','tests/v182-finance-export.test.mjs'],
 'exploitation-resilience':['python','tests/test_p6_exploitation.py'],
 'benchmark-normes':None,
 'nettoyage-code':None,
 'contre-audit-livraison':None,
 'articles-negoce-o2c':['node','--experimental-strip-types','tests/v18913p5153-article-trade.test.mjs'],
 'acheteur-poste-travail':['node','--experimental-strip-types','tests/v18913p5155-buyer-workbench.test.mjs'],
 'acheteur-navigation-complete':['node','--experimental-strip-types','tests/v18913p5156-buyer-navigation.test.mjs'],
}
assert len(C)==20
skills=sorted(p.parent.name for p in (ROOT/'fsnw/skills').glob('*/SKILL.md'))
assert sorted(C)==skills,(set(C)-set(skills),set(skills)-set(C))
proof=[]
for skill,cmd in C.items():
 if cmd is None:
  result={'skill':skill,'status':'NON_TESTE','evidence_level':'aucun test exécuté','reason':'Audit manuel ou environnement complet requis; ne pas assimiler à PASS'}
 else:
  try:
   completed=subprocess.run(cmd,cwd=ROOT,env={**os.environ,'NODE_NO_WARNINGS':'1'},capture_output=True,text=True,timeout=50)
   result={'skill':skill,'status':'PASS_CIBLE' if completed.returncode==0 else 'ECHEC','command':' '.join(cmd),'exitCode':completed.returncode,'stdoutTail':completed.stdout[-2000:],'stderrTail':completed.stderr[-2000:],'evidence_level':'script ciblé, pas recette HTTP/UX'}
  except subprocess.TimeoutExpired:
   result={'skill':skill,'status':'INCONCLUSIF_TIMEOUT','command':' '.join(cmd),'evidence_level':'aucun PASS'}
 proof.append(result)
 print(f"{skill}: {result['status']}",flush=True)
OUT.parent.mkdir(parents=True,exist_ok=True)
OUT.write_text(json.dumps({'date':datetime.datetime.now(datetime.timezone.utc).isoformat(), 'description':'Exécution de 20 contrôles/points de revue FSNW: PASS_CIBLE signifie uniquement test représentatif', 'node_version':subprocess.run(['node','-v'],capture_output=True,text=True).stdout.strip(), 'db_sha256':hashlib.sha256((ROOT/'db/custom.db').read_bytes()).hexdigest(),'skills':proof},ensure_ascii=False,indent=2),encoding='utf-8')
print(f'BILAN: {sum(x["status"]=="PASS_CIBLE" for x in proof)}/20 PASS_CIBLE, {sum(x["status"]=="ECHEC" for x in proof)} ECHEC',flush=True)
