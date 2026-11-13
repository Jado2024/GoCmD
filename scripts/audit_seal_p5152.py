#!/usr/bin/env python3
"""P5.15.2 — External audit checkpoint using keyed SHA-256 (HMAC).
P6 (2026-11-11) — chaîne de scellement append-only (chantier 3, §4.5).

This tool does NOT make SQLite tamper-proof. It allows an independent checker
holding a secret and a checkpoint outside the database to detect retrospective
modification/deletion of events up to the last sealed id.

Chaîne P6 : avec --chain, chaque scellement écrit un NOUVEAU fichier horodaté
(jamais écrasé) qui référence l'empreinte SHA-256 du scellement précédent.
Conséquences pour un administrateur malveillant disposant du système complet :
  - modifier un événement scellé puis re-sceller ne suffit plus : la chaîne
    conserve les scellés antérieurs, la vérification détecte la divergence ;
  - supprimer les fichiers de chaîne est détecté (parent manquant, code 4) ;
  - forger la chaîne exige la clé HMAC — conservée hors du serveur (direction).
L'indépendance réelle exige toujours : clé ET copie de scellés archivées sur
un support séparé (voir RUNBOOK §supervision), vérification périodique par
une personne distincte de l'administrateur.

Usage:
  GOCMD_AUDIT_SEAL_KEY=<secret> python scripts/audit_seal_p5152.py seal --chain \
      --db db/custom.db --out /independent/backups/gocmd-audit-seal.json
  GOCMD_AUDIT_SEAL_KEY=<secret> python scripts/audit_seal_p5152.py verify --chain \
      --db db/custom.db --out /independent/backups/gocmd-audit-seal.json
Do not put the secret or checkpoint into the public ZIP, repo or same DB folder.
"""
import argparse, hashlib, hmac, json, os, sqlite3, sys
from pathlib import Path
from datetime import datetime, timezone

COLS='id,actor,action,entity,entityId,details,createdAt'

def audit_digest(db: sqlite3.Connection, key: bytes, max_id: int | None = None):
    q=f'SELECT {COLS} FROM AuditEvent'
    params=()
    if max_id is not None:
        q+=' WHERE id <= ?';params=(max_id,)
    q+=' ORDER BY id ASC'
    state=hmac.new(key,b'GoCmd-P5152-Audit-v1',hashlib.sha256).digest()
    count=0
    end_id=0
    for row in db.execute(q,params):
        payload=json.dumps(row,ensure_ascii=False,separators=(',',':')).encode('utf-8')
        state=hmac.new(key,state+len(payload).to_bytes(8,'big')+payload,hashlib.sha256).digest()
        end_id=row[0];count+=1
    return dict(count=count,maxId=end_id,hmac256=state.hex())

def _file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def _chain_files(out: Path):
    return sorted(out.parent.glob(out.stem+'-chain-*.json'))

def seal_chained(db_path: Path, out: Path, key: bytes, digest: dict) -> str:
    """Écrit un nouveau maillon horodaté + met à jour le pointeur --out."""
    out.parent.mkdir(parents=True, exist_ok=True)
    chain=_chain_files(out)
    parent=None
    if chain:
        prev=chain[-1]
        parent=dict(file=prev.name,sha256=_file_sha256(prev))
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    link=dict(version='GoCmd-P6-Audit-Seal-Chain-1',
              sealedAt=datetime.now(timezone.utc).isoformat(),
              **digest,parent=parent)
    link_file=out.with_name(f'{out.stem}-chain-{stamp}.json')
    tmp=link_file.with_suffix('.tmp')
    with open(tmp,'x',encoding='utf-8') as stream:json.dump(link,stream,ensure_ascii=False,indent=2)
    os.chmod(tmp,0o400)
    os.replace(tmp,link_file)
    latest=dict(version='GoCmd-P5152-Audit-v1',sealedAt=link['sealedAt'],
                count=digest['count'],maxId=digest['maxId'],hmac256=digest['hmac256'],
                chainLatest=link_file.name)
    tmp=out.with_suffix(out.suffix+'.tmp')
    with open(tmp,'x',encoding='utf-8') as stream:json.dump(latest,stream,ensure_ascii=False,indent=2)
    os.chmod(tmp,0o600)
    os.replace(tmp,out)
    return f'SEALED {digest["count"]} audit events, through #{digest["maxId"]} (chaîne: {link_file.name})'

def _check_sealed_event_prefixes(db: sqlite3.Connection, key: bytes, links: list[dict], names: list[str]) -> tuple[bool, str]:
    """Verify every sealed prefix in ONE ordered DB scan, not only oldest/latest.

    This detects a modification to any already sealed interval, including an
    intermediate interval which would otherwise pass the normal quick check.
    """
    state=hmac.new(key,b'GoCmd-P5152-Audit-v1',hashlib.sha256).digest()
    count=0
    last_id=0
    idx=0

    def check_link(index: int) -> tuple[bool, str]:
        link=links[index]
        if count!=link['count'] or last_id!=link['maxId'] or not hmac.compare_digest(state.hex(),link['hmac256']):
            return False,f'empreinte des événements divergente pour {names[index]} (falsification ou suppression détectée)'
        return True,''

    for row in db.execute(f'SELECT {COLS} FROM AuditEvent ORDER BY id ASC'):
        row_id=row[0]
        while idx<len(links) and links[idx]['maxId'] < row_id:
            ok,reason=check_link(idx)
            if not ok:return False,reason
            idx+=1
        payload=json.dumps(row,ensure_ascii=False,separators=(',',':')).encode('utf-8')
        state=hmac.new(key,state+len(payload).to_bytes(8,'big')+payload,hashlib.sha256).digest()
        count+=1
        last_id=row_id
        while idx<len(links) and links[idx]['maxId'] == row_id:
            ok,reason=check_link(idx)
            if not ok:return False,reason
            idx+=1
        if idx==len(links):
            # All prefixes verified. Events beyond the last seal are allowed;
            # --strict separately refuses them when requested.
            break
    while idx<len(links):
        ok,reason=check_link(idx)
        if not ok:return False,reason
        idx+=1
    return True,''


def verify_chain(db: sqlite3.Connection, out: Path, key: bytes, deep: bool=False) -> tuple[bool, str]:
    """Full verification of chain topology, latest anchor and ALL event digests.

    The current pointer is an anchor to the last link. Losing the last link
    must not silently shorten a supposedly healthy chain. A copy of the pointer
    and the key must also be held outside the server for independent assurance.
    """
    chain=_chain_files(out)
    if not chain:
        return False,'aucun maillon de scellement : chaîne manquante'
    if not out.is_file():
        return False,'pointeur de la chaîne absent'
    try:
        latest=json.loads(out.read_text(encoding='utf-8'))
    except (OSError,ValueError) as exc:
        return False,f'pointeur de scellement illisible : {exc}'
    if latest.get('chainLatest') != chain[-1].name:
        return False,'maillon terminal absent ou divergent du pointeur chainLatest'
    links=[]
    names=[]
    previous_id=-1
    previous_count=-1
    for idx,current in enumerate(chain):
        try:
            link=json.loads(current.read_text(encoding='utf-8'))
            if link.get('version')!='GoCmd-P6-Audit-Seal-Chain-1':
                return False,f'version de maillon invalide : {current.name}'
            max_id=int(link['maxId'])
            count=int(link['count'])
            digest=link['hmac256']
            if not isinstance(digest,str) or len(digest)!=64 or any(ch not in '0123456789abcdef' for ch in digest):
                return False,f'empreinte de maillon invalide : {current.name}'
            if max_id < previous_id or count < previous_count:
                return False,f'chaîne non monotone : {current.name}'
            parent=link.get('parent')
            if idx==0:
                if parent is not None:return False,'premier maillon avec parent inattendu'
            else:
                predecessor=chain[idx-1]
                if not isinstance(parent,dict) or parent.get('file')!=predecessor.name or parent.get('sha256')!=_file_sha256(predecessor):
                    return False,f'chaîne interrompue avant {current.name} (parent absent ou altéré)'
            previous_id=max_id
            previous_count=count
            links.append(dict(maxId=max_id,count=count,hmac256=digest))
            names.append(current.name)
        except (OSError,ValueError,TypeError,KeyError) as exc:
            return False,f'maillon illisible : {current.name} : {exc}'
    terminal=links[-1]
    if (latest.get('version')!='GoCmd-P5152-Audit-v1' or
        latest.get('maxId')!=terminal['maxId'] or
        latest.get('count')!=terminal['count'] or
        latest.get('hmac256')!=terminal['hmac256']):
        return False,'pointeur terminal non conforme au dernier maillon'
    valid,reason=_check_sealed_event_prefixes(db,key,links,names)
    if not valid:return False,reason
    return True,f'chaîne intègre ({len(chain)} maillons, vérification exhaustive des périodes scellées)'

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['seal','verify'])
    parser.add_argument('--db',required=True)
    parser.add_argument('--out',required=True)
    parser.add_argument('--strict',action='store_true',help='en vérification, refuser de nouveaux événements non scellés')
    parser.add_argument('--chain',action='store_true',help='P6 : scellement append-only chaîné (recommandé en exploitation)')
    parser.add_argument('--deep',action='store_true',help='compatibilité : avec --chain, tous les maillons sont désormais vérifiés systématiquement')
    args=parser.parse_args()
    key=os.environ.get('GOCMD_AUDIT_SEAL_KEY','').encode('utf-8')
    if len(key)<32:parser.error('GOCMD_AUDIT_SEAL_KEY doit contenir au moins 32 octets et rester hors du projet')
    db_path=Path(args.db).resolve()
    out=Path(args.out).resolve()
    if args.action=='seal' and out.parent==db_path.parent:parser.error('le scellement doit être placé hors du dossier de la base')
    if not db_path.is_file():parser.error('base absente')
    with sqlite3.connect(db_path.as_uri()+'?mode=ro',uri=True) as db:
        # Stable read snapshot for validation and new seal, even with writers.
        db.execute('BEGIN')
        if args.action=='seal':
            digest=audit_digest(db,key)
            if args.chain:
                # P6 : on ne scelle JAMAIS par-dessus une chaîne divergente —
                # un re-scellage après modification est refusé, l'opérateur
                # doit investiguer (la clé reste requise pour sceller).
                if _chain_files(out) or out.exists():
                    ok,detail=verify_chain(db,out,key,deep=True)
                    if not ok:
                        print(f'REFUS DE SCELLER: {detail}',file=sys.stderr)
                        return 6
                    print(f'CHAÎNE PRÉALABLE: {detail}')
                print(seal_chained(db_path,out,key,digest))
                return 0
            result=dict(version='GoCmd-P5152-Audit-v1',sealedAt=datetime.now(timezone.utc).isoformat(),**digest)
            out.parent.mkdir(parents=True,exist_ok=True)
            tmp=out.with_suffix(out.suffix+'.tmp')
            with open(tmp,'x',encoding='utf-8') as stream:json.dump(result,stream,ensure_ascii=False,indent=2)
            os.chmod(tmp,0o600)
            os.replace(tmp,out)
            print(f'SEALED {digest["count"]} audit events, through #{digest["maxId"]}')
            return 0
        if not out.is_file():parser.error('signature de référence absente')
        expected=json.loads(out.read_text(encoding='utf-8'))
        if expected.get('version')!='GoCmd-P5152-Audit-v1':parser.error('version de scellement inconnue')
        actual=audit_digest(db,key,int(expected['maxId']))
        if actual['count']!=expected['count'] or actual['maxId']!=expected['maxId'] or not hmac.compare_digest(actual['hmac256'],expected['hmac256']):
            print('FAIL: événement(s) scellé(s) modifié(s), supprimé(s) ou clé incorrecte',file=sys.stderr)
            return 2
        if args.chain:
            ok,detail=verify_chain(db,out,key,deep=args.deep)
            if not ok:
                print(f'FAIL CHAÎNE: {detail}',file=sys.stderr)
                return 4
            print(f'CHAÎNE: {detail}')
        total=db.execute('SELECT count(*) FROM AuditEvent').fetchone()[0]
        pending=total-actual['count']
        if pending>0 and args.strict:
            print(f'FAIL: {pending} nouvel(le)(s) événement(s) non scellés',file=sys.stderr)
            return 3
        print(f'PASS: {actual["count"]} événements intacts; {pending} événement(s) récents non scellés')
        return 0
if __name__=='__main__':sys.exit(main())
