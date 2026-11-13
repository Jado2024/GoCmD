#!/usr/bin/env python3
"""GoCmd independent regression cascade — synchronous, bounded, auditable.

This is NOT a claim that repeated regression suites replace independent audits,
not a million full code reviews, and NOT a production homologation. It stops on
first error, persists exact command logs/exit codes and checks demo DB hash.
Usage: python scripts/cascade_audit_runner.py --cycles 3 --out /tmp/cascade-run
"""
import argparse
import hashlib
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DB=ROOT/'db'/'custom.db'

def sha256(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--cycles',type=int,default=3)
    ap.add_argument('--out',type=Path,required=True)
    ap.add_argument('--quick',action='store_true',help='Skip time-consuming recovery and sealing scenarios, which require separate deep runs')
    args=ap.parse_args()
    if args.cycles<1 or args.cycles>1000000:ap.error('--cycles entre 1 et 1000000')
    out=args.out.resolve();out.mkdir(parents=True,exist_ok=True)
    tests=[
       ('coherence-engagement-8-states',[sys.executable,'tests/test_cascade2_engagement_guards.py']),
       ('parite-prisma-sqlite',[sys.executable,'tests/test_fk_indexes_20261110.py']),
       ('reparation-index',[sys.executable,'tests/test_cascade_p6_reservation_index_drift.py']),
       ('age-et-alerte',[sys.executable,'tests/test_p6_reservation_aging.py']),
       ('historique-scellement',[sys.executable,'tests/test_p6_audit_seal_chain.py']),
       ('sauvegarde-restauration',[sys.executable,'tests/test_p6_exploitation.py']),
       ('contrats-securite-windows',[sys.executable,'tests/test_p6u_p2fix_contracts.py']),
       ('contrats-durcissement',[sys.executable,'tests/test_p6u_hardening.py']),
       ('logique',[ 'npm','run','test:logic']),
       ('base',['npm','run','test:database']),
       ('paquet',['node','scripts/verify_current_package.cjs']),
    ]
    if args.quick:
        tests=[x for x in tests if x[0] not in ('sauvegarde-restauration','historique-scellement','logique','base')]
    run=dict(version=json.loads((ROOT/'package.json').read_text())['version'],startedAt=datetime.now(timezone.utc).isoformat(),databaseSha256Before=sha256(DB),cycleCountRequested=args.cycles,results=[],unexecuted=['Node.js 24+ install complete','Next build','Prisma runtime HTTP','Playwright','Windows service real','Concurrent production transactions'])
    try:
      for cycle in range(1,args.cycles+1):
       for label,command in tests:
        t=time.monotonic();print(f'CYCLE {cycle}/{args.cycles} {label}',flush=True)
        proc=subprocess.run(command,cwd=ROOT,text=True,capture_output=True,timeout=120)
        path=out/f'{cycle:04d}_{label}.log'
        path.write_text('$ '+' '.join(command)+'\nEXIT='+str(proc.returncode)+'\n'+proc.stdout+'\nSTDERR\n'+proc.stderr)
        item={'cycle':cycle,'check':label,'returnCode':proc.returncode,'durationSeconds':round(time.monotonic()-t,2),'log':path.name}
        run['results'].append(item)
        if proc.returncode:
         print('FAIL',label,'see',path,flush=True)
         return 2
       if sha256(DB)!=run['databaseSha256Before']:
        print('FAIL demo database was changed',flush=True)
        return 3
       print('CYCLE',cycle,'PASS',flush=True)
      return 0
    except (subprocess.TimeoutExpired,Exception) as e:
      print('CASCADE ERROR',repr(e),flush=True)
      run['failure']=repr(e)
      return 4
    finally:
      run['databaseSha256After']=sha256(DB)
      run['completedAt']=datetime.now(timezone.utc).isoformat()
      run['passCount']=sum(x['returnCode']==0 for x in run['results'])
      (out/'MANIFESTE_EXECUTIONS.json').write_text(json.dumps(run,ensure_ascii=False,indent=2)+'\n')
      print(f'COMPLETED {run["passCount"]} successful test commands; data protected; integrated tests unexecuted',flush=True)
if __name__=='__main__':raise SystemExit(main())
