#!/usr/bin/env python3
"""Libération tracée des réservations de vente arrivées à échéance.
N'activez la tâche planifiée QU'APRÈS avoir renseigné les deux paramètres
GOCMD_RESERVATION_TTL_HOURS et GOCMD_RESERVATION_WARNING_HOURS,
et communiqué aux utilisateurs la politique de notifications.
Usage : python scripts/expire_sales_reservations_p51521.py --db db/custom.db
        python scripts/expire_sales_reservations_p51521.py --db db/custom.db --apply
Lecture seule par défaut. Ne modifie jamais le stock physique.
"""
import argparse
import datetime as dt
import json
import os
import sqlite3
from pathlib import Path

UTC=dt.timezone.utc

def policy():
 try:
  ttl=int(os.environ.get('GOCMD_RESERVATION_TTL_HOURS',''))
  warn=int(os.environ.get('GOCMD_RESERVATION_WARNING_HOURS',''))
  if not 1<=ttl<=2160 or not 1<=warn<ttl:raise ValueError()
  return ttl,warn
 except ValueError:raise SystemExit('Politique TTL absente/invalide : aucune suppression. Valider/configurer TTL + avertissement SODEPI.')

def timestamp(value):
 if isinstance(value,(int,float)):
  if value>100000000000: value/=1000
  return dt.datetime.fromtimestamp(value,tz=UTC)
 if isinstance(value,str):
  # Format SQLite ISO8601, y compris la date stockée comme texte.
  d=dt.datetime.fromisoformat(value.replace('Z','+00:00'))
  return d.replace(tzinfo=UTC) if d.tzinfo is None else d.astimezone(UTC)
 raise ValueError('Date de réservation non lisible')

def run(db:Path,apply:bool,now:dt.datetime|None=None):
 if not db.exists():raise SystemExit('BDD introuvable')
 ttl,warn=policy();now=now or dt.datetime.now(UTC)
 with sqlite3.connect(db,timeout=30) as con:
  con.execute('PRAGMA foreign_keys=ON');con.execute('PRAGMA busy_timeout=30000')
  if apply:con.execute('BEGIN IMMEDIATE')
  records=con.execute('SELECT id,orderLineId,stockLotId,qty,createdBy,updatedAt FROM SalesStockReservation ORDER BY id').fetchall()
  expired=[];warnings=[];invalid=[]
  for id,line,lot,qty,creator,stamp in records:
   try: age=(now-timestamp(stamp)).total_seconds()/3600
   except (ValueError,OverflowError,TypeError):invalid.append(id);continue
   if age>=ttl:expired.append((id,line,lot,qty,creator,stamp))
   elif age>=ttl-warn:warnings.append(id)
  # RR-06/RR-08: an OF already prepared for resale owns its reservation.
  # Expiring it in the scheduler would silently desynchronise the warehouse
  # operation. Keep it and require explicit OF suspension/cancellation.
  prepared_lines=set()
  if con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='WorkOrder'").fetchone():
   prepared_lines={r[0] for r in con.execute(
    "SELECT orderLineId FROM WorkOrder WHERE status='completed' AND preparationKind='stock'")}
  prepared_ids=[r[0] for r in expired if r[1] in prepared_lines]
  expired=[r for r in expired if r[1] not in prepared_lines]
  # En cas de données non décodables, ne pas exécuter de suppression partielle.
  if invalid:raise SystemExit(f'Dates non reconnues sur les réservations {invalid} ; aucune libération')
  summary={'total':len(records),'expiringSoon':len(warnings),'expired':len(expired),
           'expiredIds':[r[0] for r in expired],'blockedByPreparedOfIds':prepared_ids,'applied':apply}
  if apply:
   for id,line,lot,qty,creator,stamp in expired:
    changed=con.execute('DELETE FROM SalesStockReservation WHERE id=? AND updatedAt=?',(id,stamp)).rowcount
    if changed!=1:raise RuntimeError('Suppression concurrente : transaction annulée')
    con.execute('INSERT INTO AuditEvent (actor,action,entity,entityId,details,createdAt) VALUES (?,?,?,?,?,?)',(
      'SODEPI_RESERVATION_SCHEDULER','SALES_STOCK_RESERVATION_EXPIRED','SalesStockReservation',str(id),
      json.dumps({'orderLineId':line,'stockLotId':lot,'qty':qty,'createdBy':creator,'updatedAt':str(stamp),'ttlHours':ttl}),int(now.timestamp()*1000)))
   con.commit()
  print(json.dumps(summary,ensure_ascii=False))
  return summary

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--db',type=Path,required=True);p.add_argument('--apply',action='store_true');a=p.parse_args();run(a.db,a.apply)
