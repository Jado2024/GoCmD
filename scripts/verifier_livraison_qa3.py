#!/usr/bin/env python3
"""Vérifier une livraison GoCmd P5.15.14 QA3 depuis une extraction propre.
Aucune modification, aucune ouverture de base en écriture.
"""
from __future__ import annotations
import argparse, hashlib, sys
from pathlib import Path

def verifier(racine: Path, nom: str) -> tuple[int, list[str]]:
    if not racine.is_dir(): return 0, [f"Dossier introuvable: {racine}"]
    manifeste = racine / nom
    if not manifeste.is_file(): return 0, [f"Manifeste introuvable: {manifeste}"]
    erreurs=[]; attendus={}
    for no,ligne in enumerate(manifeste.read_text(encoding='utf-8').splitlines(),1):
        if not ligne.strip(): continue
        try: empreinte, chemin = ligne.split('  ',1)
        except ValueError:
            erreurs.append(f"Ligne {no}: format incorrect"); continue
        if len(empreinte)!=64 or not all(c in '0123456789abcdef' for c in empreinte):
            erreurs.append(f"Ligne {no}: empreinte incorrecte");continue
        rel=Path(chemin)
        if rel.is_absolute() or '..' in rel.parts or chemin in attendus or chemin==nom:
            erreurs.append(f"Ligne {no}: chemin non autorisé ou dupliqué: {chemin}");continue
        attendus[chemin]=empreinte
    for rel,digest in attendus.items():
        p=racine/rel
        if not p.is_file(): erreurs.append(f"ABSENT: {rel}"); continue
        if p.is_symlink(): erreurs.append(f"LIEN SYMBOLIQUE INTERDIT: {rel}"); continue
        hasher=hashlib.sha256()
        with p.open('rb') as f:
            for block in iter(lambda:f.read(1024*1024),b''):hasher.update(block)
        if hasher.hexdigest()!=digest: erreurs.append(f"EMPREINTE INVALIDE: {rel}")
    visibles={p.relative_to(racine).as_posix() for p in racine.rglob('*') if p.is_file() and p != manifeste}
    for rel in sorted(visibles-set(attendus)): erreurs.append(f"NON RÉPERTORIÉ: {rel}")
    return len(attendus),erreurs

def main() -> int:
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--projet',type=Path,default=Path('.'))
    ap.add_argument('--preuves',type=Path,default=None)
    args=ap.parse_args()
    total,err=verifier(args.projet.resolve(), 'SHA256SUMS.txt')
    print(f'Projet: {total} fichiers vérifiés; {len(err)} anomalie(s)')
    for e in err:print(' - '+e)
    if args.preuves is not None:
        total2,err2=verifier(args.preuves.resolve(),'SHA256SUMS.txt')
        print(f'Preuves: {total2} fichiers vérifiés; {len(err2)} anomalie(s)')
        for e in err2:print(' - '+e)
        err.extend(err2)
    return 1 if err else 0

if __name__=='__main__':sys.exit(main())
