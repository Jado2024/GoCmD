#!/usr/bin/env python3
"""P5.15.13 — Réparation AN-CPL-02 : lots d'ouverture démo à quantité fractionnée
sur unité INDIVISIBLE (pcs, rouleau…). Contre-correction, données 100 % fictives.

CONTEXTE (reproduit avant correction, voir RAPPORT_DONNEES_CORRIGEES_P5_15_13.md) :
le script d'ensemencement demo reconstruire_demo_sodepi_articles_p5154.py scindait
le stock d'ouverture de 1 article sur 3 en deux moitiés round(qty*0.5,3). Pour les
articles à stock IMPAIR sur unité indivisible, cela fabriquait des demi-pièces
(45 pcs → 22.5+22.5 ; 19 rouleaux → 9.5+9.5 ; 55 pcs → 27.5+27.5 ; 5 rouleaux →
2.5+2.5). Ces lots ne sont issus d'AUCUNE réception réelle (provenanceKey
DEMO-OUVERTURE-P5154, isOpeningBalance=1) : ils violent l'invariant d'unité
(src/lib/purchase-quantity.ts : unités indivisibles = entiers).

RÈGLES DE CIBLE (hypothèses EXPLICITES — aucun arrondi silencieux) :
 1. Lot avec comptage StockCount en statut 'pending' → la quantité COMPTÉE
    (observedQty) prévaut : c'est le seul état physiquement mesuré.
 2. Sinon, si exactement 2 lots fractionnaires pour l'article → moitié entière
    supérieure (id le plus bas) + moitié entière inférieure : LE TOTAL D'ARTICLE
    EST CONSERVÉ EXACTEMENT (aucune pièce créée ni détruite).
 3. Sinon (cas isolé) → entier le plus proche (moitié arrondie vers le haut).
Les deltas sont journalisés par un MOUVEMENT de régularisation nominatif
(opérateur system_an-cpl-02, document AN-CPL-02-R-P51513) : l'historique d'origine
est INTÉGRALLEMENT conservé, la correction est un événement tracé, l'avant/après
est exporté (--report). Les comptages 'pending' touchés sont clos en 'rejected'
avec justification complète : l'API ne peut NI les approuver NI les rejeter
(INVALID_UNIT_QTY : la qté attendue fractionnaire est elle-même invalide pour
une unité indivisible — gel documenté, cf. AN-CPL-04). AUCUNE suppression.

Le script NE TOUCHE PAS :
 - les fractions légitimes sur unités divisibles (kg, ml…) ;
 - les données d'exploitation : dry-run par défaut ; --apply exige --backup
   externe ; idempotent ; intégrité et FK vérifiées avant/après ;
 - aucune autre table que StockLot.qty, StockPlacement.qty, Material.stockQty,
   Movement (insertion), StockCount.status/reason/approvedBy/approvedAt.
"""
import argparse, datetime as dt, json, math, pathlib, sqlite3, sys, tempfile

# Miroir documenté de src/lib/purchase-quantity.ts (FRACTIONAL_UNITS)
FRACTIONAL_UNITS = {'kg', 'g', 't', 'tonne', 'ml', 'm', 'm2', 'm²', 'l', 'litre', 'litres', 'm3', 'm³'}
TOLERANCE = 1e-9
REPORT_DEFAULT = 'rapport_an_cpl_02_avant_apres.json'

def is_fractional(qty):
    return abs(qty - round(qty)) > TOLERANCE

def round_half_up(qty):
    return int(math.floor(qty + 0.5))

def now_ms():
    return int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000)

def find_cases(con):
    """Lots fractionnaires sur unité indivisible, groupés par article, avec comptages pending."""
    rows = con.execute("""
        SELECT l.id, l.lotCode, l.materialId, m.ref, m.unit, l.qty, l.status, l.provenanceKey
        FROM StockLot l JOIN Material m ON m.id = l.materialId
        WHERE ABS(l.qty - CAST(l.qty AS INTEGER)) > 0.000000001
        ORDER BY l.materialId, l.id""").fetchall()
    cases = []
    for (lid, code, mid, ref, unit, qty, status, prov) in rows:
        if unit.strip().lower() in FRACTIONAL_UNITS:
            continue  # fraction légitime sur unité divisible
        counts = con.execute(
            "SELECT id, expectedQty, observedQty, status, countedBy, reason FROM StockCount "
            "WHERE lotId=? AND status='pending' ORDER BY id", (lid,)).fetchall()
        cases.append({'lotId': lid, 'lotCode': code, 'materialId': mid, 'ref': ref, 'unit': unit,
                      'qty': qty, 'status': status, 'provenance': prov, 'pendingCounts': [dict(
                          zip(('id', 'expectedQty', 'observedQty', 'status', 'countedBy', 'reason'), c)) for c in counts]})
    return cases

def compute_targets(con, cases):
    """Applique les règles 1-3 ; retourne {lotId: (target, hypothesis)}."""
    by_material = {}
    for c in cases:
        by_material.setdefault(c['materialId'], []).append(c)
    targets = {}
    for mid, lots in by_material.items():
        counted = {c['lotId']: c for c in lots if c['pendingCounts']}
        uncounted = [c for c in lots if not c['pendingCounts']]
        for c in lots:
            if c['lotId'] in counted:
                observed = c['pendingCounts'][0]['observedQty']
                # Règle 1 : état compté prévaut
                targets[c['lotId']] = (observed, f"règle 1 — quantité comptée {observed} par magasinier "
                                                 f"{c['pendingCounts'][0]['countedBy']} (comptage n°{c['pendingCounts'][0]['id']}, conservé)")
            elif len(uncounted) == 2 and not counted:
                total = sum(x['qty'] for x in uncounted)
                first = min(uncounted, key=lambda x: x['lotId'])
                target = math.ceil(total / 2) if c['lotId'] == first['lotId'] else math.floor(total / 2)
                targets[c['lotId']] = (target, f"règle 2 — conservation exacte du total d'article {total:g} {c['unit']} "
                                               f"(moitié entière {'supérieure' if c['lotId'] == first['lotId'] else 'inférieure'})")
            else:
                target = round_half_up(c['qty'])
                targets[c['lotId']] = (target, f"règle 3 — cas isolé : entier le plus proche (moitié arrondie vers le haut)")
    return targets

def migrate(db, apply=False, backup=None, report=None):
    target_db = pathlib.Path(db).expanduser().resolve()
    if not target_db.is_file():
        raise ValueError('Base SQLite absente : aucun fichier créé')
    if apply and not backup:
        raise ValueError('--backup externe obligatoire avec --apply')
    if apply:
        backup = pathlib.Path(backup).expanduser().resolve()
        if backup.exists() or backup == target_db or backup.parent == target_db.parent:
            raise ValueError('Le fichier de sauvegarde doit être nouveau et hors du dossier de base')
    con = sqlite3.connect(str(target_db) if apply else target_db.as_uri() + '?mode=ro', uri=not apply)
    try:
        con.execute('PRAGMA foreign_keys=ON')
        assert con.execute('PRAGMA integrity_check').fetchone()[0] == 'ok', 'Base non intègre'
        cases = find_cases(con)
        if not cases:
            print('Aucun lot fractionnaire sur unité indivisible : base déjà conforme AN-CPL-02.')
            if report:
                pathlib.Path(report).write_text(json.dumps({'lots': [], 'statut': 'rien à faire'},
                                                            ensure_ascii=False, indent=1), encoding='utf-8')
            return
        targets = compute_targets(con, cases)
        before = []
        for c in cases:
            mid = c['materialId']
            mat = con.execute("SELECT ref, unit, stockQty FROM Material WHERE id=?", (mid,)).fetchone()
            placements = con.execute("SELECT id, locationId, qty FROM StockPlacement WHERE stockLotId=?",
                                     (c['lotId'],)).fetchall()
            before.append({'lot': c, 'material': {'ref': mat[0], 'unit': mat[1], 'stockQty': mat[2]},
                           'placements': [list(p) for p in placements]})
        print(f"{len(cases)} lot(s) fractionnaire(s) sur unité indivisible :")
        for c in cases:
            t, hyp = targets[c['lotId']]
            print(f"  lot {c['lotId']} ({c['lotCode']}, {c['ref']}, {c['unit']}) : {c['qty']:g} → {t:g} | {hyp}")
        if not apply:
            print('DRY-RUN : aucune écriture. Rejouer avec --apply --backup <chemin externe> [--report ...].')
            if report:
                pathlib.Path(report).write_text(json.dumps(
                    {'statut': 'DRY-RUN', 'lots': [{'lot': c['lotCode'], 'avant': c['qty'],
                     'apres': targets[c['lotId']][0], 'hypothese': targets[c['lotId']][1]} for c in cases]},
                    ensure_ascii=False, indent=1), encoding='utf-8')
            return
        import shutil
        shutil.copy2(target_db, backup)
        print(f'sauvegarde : {backup}')
        stamp = now_ms()
        con.execute('BEGIN IMMEDIATE')
        try:
            for c in cases:
                lid = c['lotId']
                new_qty = targets[lid][0]
                hyp = targets[lid][1]
                delta = new_qty - c['qty']
                # 1. mouvement de régularisation tracé (l'historique d'origine est conservé)
                unit = c['unit']
                mv_type = 'in' if delta >= 0 else 'out'
                mv_reason = ("Régularisation AN-CPL-02 (P5.15.13) : lot d'ouverture de démonstration fractionné "
                             f"à tort sur unité indivisible ({unit}) — {hyp}. Correction de données fictives, "
                             "voir RAPPORT_DONNEES_CORRIGEES_P5_15_13.md.")
                con.execute("""INSERT INTO Movement(ref,type,materialId,qty,unit,reason,document,operator,
                                createdAt,signedQty,stockLotId,isOpeningBalance)
                                VALUES (?,? ,?,?,?,?,'AN-CPL-02-R-P51513','system_an-cpl-02',?,?,?,0)""",
                            (f"MVT-AN-CPL-02-R-{lid}", mv_type, c['materialId'], abs(delta), unit, mv_reason,
                             stamp, delta, lid))
                # 2. quantité du lot
                changed = con.execute("UPDATE StockLot SET qty=? WHERE id=? AND qty=?", (new_qty, lid, c['qty'])).rowcount
                assert changed == 1, f"lot {lid} : qté a changé entre-temps — rejouer le diagnostic"
                # 3. miroir emplacements
                con.execute("UPDATE StockPlacement SET qty=? WHERE stockLotId=?", (new_qty, lid))
                # 4. clôture documentée des comptages pending gelés du lot
                for cnt in c['pendingCounts']:
                    new_reason = (f"{cnt['reason']} | Clôture de régularisation AN-CPL-02 (P5.15.13) : qté attendue "
                                  f"{cnt['expectedQty']:g} invalide pour unité indivisible — approbation ET rejet "
                                  "impossibles via l'API (INVALID_UNIT_QTY). Lot régularisé à "
                                  f"{new_qty:g} ({hyp}) ; le comptage et sa valeur comptée sont CONSERVÉS pour "
                                  "traçabilité ; aucune suppression. Voir RAPPORT_DONNEES_CORRIGEES_P5_15_13.md.")
                    con.execute("""UPDATE StockCount SET status='rejected', approvedBy='system_an-cpl-02',
                                   approvedAt=?, reason=? WHERE id=? AND status='pending'""",
                                (stamp, new_reason, cnt['id']))
            # 5. stock article = somme des lots disponibles (invariant applicatif)
            for mid in sorted({c['materialId'] for c in cases}):
                total = con.execute("SELECT COALESCE(SUM(qty),0) FROM StockLot WHERE materialId=? AND status='available'",
                                    (mid,)).fetchone()[0]
                con.execute("UPDATE Material SET stockQty=? WHERE id=?", (total, mid))
            con.commit()
        except Exception:
            con.rollback()
            raise
        assert con.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert not con.execute('PRAGMA foreign_key_check').fetchall()
        # vérifications finales : plus aucun lot fractionnaire sur unité indivisible
        remaining = find_cases(con)
        assert not remaining, f"lots fractionnaires restants : {[c['lotId'] for c in remaining]}"
        print('Réparation AN-CPL-02 appliquée : lots régularisés, mouvements tracés, comptages gelés clos, '
              'invariant stock/lots recalé.')
        if report:
            after = []
            for c in cases:
                lid = c['lotId']
                row = con.execute("SELECT l.qty, m.stockQty FROM StockLot l JOIN Material m ON m.id=l.materialId WHERE l.id=?",
                                  (lid,)).fetchone()
                after.append({'lot': c['lotCode'], 'avant': c['qty'], 'apres': row[0],
                              'stockArticleAvant': next(b['material']['stockQty'] for b in before if b['lot']['lotId'] == lid),
                              'stockArticleApres': row[1], 'hypothese': targets[lid][1],
                              'delta': targets[lid][0] - c['qty']})
            pathlib.Path(report).write_text(json.dumps(
                {'statut': 'APPLIQUÉ', 'horodatage': stamp, 'base': str(target_db), 'lots': after,
                 'methode': {'règle 1': 'quantité comptée (StockCount pending) prévaut',
                             'règle 2': 'conservation exacte du total article (ceil+floor sur paire)',
                             'règle 3': 'entier le plus proche (moitié vers le haut) pour cas isolé'}},
                ensure_ascii=False, indent=1), encoding='utf-8')
            print(f'rapport avant/après : {report}')
    finally:
        con.close()

if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--db', required=True)
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--backup')
    ap.add_argument('--report', default=REPORT_DEFAULT)
    a = ap.parse_args()
    try:
        migrate(a.db, a.apply, a.backup, a.report)
    except Exception as e:
        print('ERROR:', e, file=sys.stderr)
        sys.exit(1)
