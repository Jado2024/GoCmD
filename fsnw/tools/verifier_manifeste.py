#!/usr/bin/env python3
"""Vérifie les empreintes SHA-256 d'un fichier SHA256SUMS.txt sans rien modifier."""
import argparse,hashlib,pathlib,sys

def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()

def main(root,manifest):
 root=root.resolve(); errors=[];seen=set(); n=0
 for line in manifest.read_text(encoding='utf-8').splitlines():
  if not line.strip() or line.startswith('#'):continue
  if '  ' not in line:errors.append('Format: '+line[:50]);continue
  checksum,rel=line.split('  ',1); p=(root/rel).resolve()
  if not p.is_relative_to(root):errors.append('Chemin sortant: '+rel);continue
  if rel in seen:errors.append('Doublon: '+rel)
  seen.add(rel);n+=1
  if not p.is_file():errors.append('Fichier absent: '+rel)
  elif sha(p).lower()!=checksum.lower():errors.append('Empreinte incorrecte: '+rel)
 print('Fichiers vérifiés:',n,'erreurs:',len(errors))
 for e in errors:print('FAIL',e)
 return int(bool(errors))

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('project',type=pathlib.Path);p.add_argument('--manifest',type=pathlib.Path)
 a=p.parse_args();sys.exit(main(a.project,a.manifest or a.project/'SHA256SUMS.txt'))
