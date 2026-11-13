#!/usr/bin/env python3
"""Rejoue la recette SQL en dehors de l'application, dans un dossier cible explicite.
Aucune modification du fichier SQLite original, aucune connexion externe.
La reproduction genere de faux devis PDF et un planning horaire, PAS des appels reels.
"""
import argparse, pathlib, os, shutil, subprocess, sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser()
p.add_argument('--out',required=True)
p.add_argument('--ack',required=True,choices=['SIMULATION_SEULEMENT'])
a=p.parse_args();dest=pathlib.Path(a.out).resolve();src=ROOT/'db/custom.db'
if dest==ROOT or dest in ROOT.parents or src.parent in dest.parents or dest.is_file():
 raise RuntimeError('Dossier de sortie refuse (eviter un chemin source ou parent)')
if dest.exists() and any(dest.iterdir()):raise RuntimeError('Choisir un dossier de simulation vide')
dest.mkdir(parents=True,exist_ok=True)
shutil.copy2(src,dest/'custom_mois_2026_11.db')
for filename in ['create_demo_users.cjs','simulate_month.py','etendre_simulation_horaire.py']:
 shutil.copy2(ROOT/'QA_P5157_MOIS'/filename,dest/filename)
env={**os.environ,'GOCMD_DB_FILE':str(dest/'custom_mois_2026_11.db'),'GOCMD_SOURCE_DIR':str(ROOT)}
cmds=[['node',str(dest/'create_demo_users.cjs')],
      [sys.executable,str(dest/'simulate_month.py')],
      [sys.executable,str(dest/'etendre_simulation_horaire.py')]]
for cmd in cmds:
 print('Execution:',pathlib.Path(cmd[-1]).name,flush=True)
 subprocess.run(cmd,check=True,cwd=str(ROOT),env=env)
print('Recette SQL simulee finie - sortie:',dest)
