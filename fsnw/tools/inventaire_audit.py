#!/usr/bin/env python3
"""Inventaire GoCmd non destructif. Aucune connexion réseau, aucun test HTTP."""
import argparse, csv, hashlib, json, pathlib, sqlite3, zipfile, sys
P=pathlib.Path

def digest(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
 return h.hexdigest()

def project_root(p):
 if (p/'package.json').exists(): return p
 raise SystemExit('Racine projet invalide: package.json introuvable')

def run(root, output):
 root=project_root(root.resolve())
 output.mkdir(parents=True,exist_ok=True)
 files=[p for p in root.rglob('*') if p.is_file() and '.git' not in p.relative_to(root).parts and 'node_modules' not in p.parts and '.next' not in p.parts and not output.resolve() in p.parents]
 infos=[{'path':str(p.relative_to(root)).replace('\\','/'),'bytes':p.stat().st_size,'sha256':digest(p)} for p in sorted(files)]
 (output/'inventory.json').write_text(json.dumps(infos,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
 with (output/'inventory.csv').open('w',newline='',encoding='utf-8') as f:
  w=csv.DictWriter(f,fieldnames=['path','bytes','sha256']);w.writeheader();w.writerows(infos)
 routes=[x['path'] for x in infos if x['path'].startswith('src/app/api/') and x['path'].endswith('/route.ts')]
 db=root/'db/custom.db';sqlite_result={'found':db.exists()}
 if db.exists():
  try:
   connection=sqlite3.connect(f'file:{db.resolve()}?mode=ro',uri=True)
   sqlite_result.update({'integrity_check':connection.execute('PRAGMA integrity_check').fetchone()[0], 'foreign_key_violation_count':len(connection.execute('PRAGMA foreign_key_check').fetchall()), 'table_count':len(connection.execute("select name from sqlite_master where type='table'").fetchall())})
   connection.close()
  except Exception as e: sqlite_result['error']=str(e)
 result={'file_count':len(infos),'api_route_files':len(routes),'api_routes':routes,'db_demo':sqlite_result,'WARNING':'Inventaire / contrôle DB en lecture seule : PAS de preuve du build, RBAC, HTTP, UX ou conformité.'}
 (output/'snapshot.json').write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
 print(json.dumps({k:v for k,v in result.items() if k!='api_routes'},ensure_ascii=False,indent=2))

if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('project',type=P);a.add_argument('--output',type=P,default=P('/tmp/gocmd-fsnw-inventory'))
 x=a.parse_args();run(x.project,x.output)
