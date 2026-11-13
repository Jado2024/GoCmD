#!/usr/bin/env python3
# Régénère les CSV DMAIC/AMDEC de l'audit P5.15.23 avec un nombre de champs strict.
import csv

REGISTRE_COLS = ["id","gravite","constat_prouve","reproduction","cause_racine","impact","correction","test_de_regression","preuve","risque_residuel","statut"]

registre = [
 ["AN-01","P3",
  "Test contractuel statique tests/v18913p511-prisma-schema.test.cjs figé sur la chaîne `q.quoteRef&&q.validUntil` absente du code actuel",
  "bun run test:v18913p511 → AssertionError « Null quote dates must be excluded from list »",
  "La garde des dates nulles a été centralisée dans isAuthorizedSupplierQuote (src/lib/supplier-quote-authorization.ts) lors des évolutions P5.15.x, sans mise à jour du test statique",
  "Aucun défaut applicatif — protection renforcée (quoteRef ET validUntil non nuls, non expirés, quatre yeux selon canal) — échec de test uniquement",
  "Assertion réécrite vers le mécanisme réel : présence d'isAuthorizedSupplierQuote dans le filtre winningQuotes + q.quoteRef!/q.validUntil!.toISOString() garantis non nuls par la garde + contrôle du rejet des nuls dans la lib",
  "test:v18913p511",
  "preuves/audit-final/test-regression.log EXIT[v18913p511]=0 après correction (échec initial documenté)",
  "Nul — la protection est plus forte qu'à l'origine de l'assertion","CLOS"],
 ["AN-02","P3",
  "Test tests/v18913p513-procurement.test.mjs figé sur `status:{in:['pending','approved','ordered','partial']}` alors que le code utilise ['pending','approved','partially_approved','ordered','partial']",
  "bun run test:v18913p513 → AssertionError includes(...)",
  "Le statut 'partially_approved' a été ajouté par P5.15.0 (décisions par ligne DA) — le test statique n'a pas suivi",
  "Aucun défaut applicatif — liste étendue (sur-ensemble)",
  "Assertion mise à jour avec la liste réelle incluant 'partially_approved'",
  "test:v18913p513",
  "EXIT[v18913p513]=0 après correction (échec initial documenté)",
  "Nul","CLOS"],
 ["AN-03","P3",
  "Test tests/v18913p5131-safety.test.mjs figé sur la regex /attachments:\\{select:\\{id:true\\}\\}/ alors que le code sélectionne {id:true,revisionNo:true}",
  "bun run test:v18913p5131 → AssertionError « did not match the regular expression »",
  "Le select a été étendu avec revisionNo pour l'autorisation par révision d'offre (P5.15.x) sans mise à jour du test",
  "Aucun défaut applicatif — sélection étendue (sur-ensemble)",
  "Regex mise à jour : /attachments:\\{select:\\{id:true(,revisionNo:true)?\\}\\}/ (accepte l'ancien et le nouveau format)",
  "test:v18913p5131",
  "EXIT[v18913p5131]=0 après correction (échec initial documenté)",
  "Nul","CLOS"],
 ["AN-04","P3",
  "Test tests/v18913p5133-hardening.test.mjs figé sur `presentPurchase(p, canReadCosts)` (espace après virgule) et sur le libellé « Offre reçue à attribuer » de la vue P2P avancée",
  "bun run test:v18913p5133 → 2 AssertionError successives",
  "1) reformatage du code sans espace après la virgule — 2) l'action d'attribution a migré vers le composant dédié AwardPlanPanel lors de la refonte multi-attributions P5.15.18",
  "Aucun défaut applicatif — la confidentialité DA (presentPurchase) et l'attribution existent toujours",
  "Regex rendue tolérante aux espaces (\\s*) + assertions sur le mécanisme actuel d'attribution (allocations=selected.map, « Retenir ces sources ») dans award-plan-panel.tsx",
  "test:v18913p5133",
  "EXIT[v18913p5133]=0 après correction (échec initial documenté)",
  "Nul","CLOS"],
 ["AN-05","P1",
  "11 étapes de la chaîne canonique test:regression:runtime (v18913p56, p57, p58, p59, p510, p511, p512, p513, p5131, p5132, p5133) étaient SILENCIEUSEMENT OMISES des journaux de régression présentés comme « régression complète PASS 57 étapes, 0 échec » lors des clôtures P5.15.21 (PREUVES_REVALIDATION_FINALE/08) et P5.15.22 (PREUVES_CLOTURE_RC/07)",
  "Comparaison programmatique de la chaîne package.json (67 étapes) contre les marqueurs « >>> »/« ===== ÉTAPE » des journaux : 57 exécutées, 11 absentes dans les DEUX jeux de preuves",
  "Les lanceurs par lots utilisés pour les preuves locales étaient bâtis sur une version antérieure de la chaîne et n'ont jamais été resynchronisés — la CI (qui exécute la vraie chaîne) n'était pas la source des preuves",
  "Les 4 anomalies AN-01..AN-04 existaient donc sans être détectées depuis plusieurs versions — les affirmations « 57 étapes 0 échec » étaient incomplètes (non représentatives de la chaîne documentée)",
  "Exécution de la chaîne complète réelle 67 étapes (+ types + startup-guard) avec code de sortie et horodatage par étape (scripts/run-regression-chunks.sh + regression-status.csv) — recommandation : la CI GitHub (bun run test:regression) doit rester l'unique référence de non-régression",
  "Chaîne complète 67/67 PASS documentée dans preuves/audit-final/test-regression.log et regression-status.csv (échecs initiaux AN-01..AN-04 tracés puis corrigés et rejoués)",
  "preuves/audit-final/regression-status.csv (68 étapes enregistrées, 4 échecs initiaux puis 0)",
  "Faible — process — le risque de dérive est réduit si la CI est la référence","CLOS (process)"],
 ["AN-06","P2",
  "Test tests/test_v18913p5132_demo_reset.py figé sur l'ancien jeu de démonstration (référence D30 « MP-MOU-PUR-STD-D30-BLN-BLC-FER-LG200-LR100-HT50-001 », stock 0, prix INNOFLEX 300 / RICHBOND 400) inexistant dans le jeu démo V16+ livré (68 matières, D30 = « MP-MOU-PUR-STD-D30-JAU-BLC-MOY-LG190-LR90-HT100-001 », 3 fournisseurs, stock 7)",
  "python3 tests/test_v18913p5132_demo_reset.py --db db/custom.db → AssertionError « assert d30 and d30['stockQty']==0 »",
  "Le jeu de démonstration a été régénéré (reinitialiser_demo_v16.py + enrichissements P5.14.3) sans mise à jour de ce test d'acceptation figé sur le premier jeu",
  "Aucun défaut applicatif — la base démo actuelle est validée par verify_demo_base_p51517.py (PASS) — échec de test uniquement",
  "Assertions ancrées sur le jeu actuel : référence D30 réelle, unité bloc, >=3 offres fournisseurs dont INNOFLEX, >=4 suggestions communes — TOUS les invariants structurels (intégrité, FK, tables transactionnelles vides, lots=stock, placements=qty, pas d'AGGLO lié, fournisseur préféré unique) conservés à l'identique",
  "test:v18913p5132 (PASS P5.13.2 : 68 matières, 18 ruptures, 25 sous seuil, 12 suggestions)",
  "preuves/audit-final/test-rejeux-finaux.log (12 PASS, exit 0)",
  "Faible — le test reste sensible à une future régénération du jeu démo (documenté)","CLOS"],
 ["AN-07","P3",
  "Code mort : constantes NON_PROGRESS_ORDER_STATES et PURCHASE_TERMINAL_STATES exportées de src/lib/erp-server.ts sans aucun usage (src, tests, scripts)",
  "grep -rn sur l'ensemble du dépôt : zéro référence",
  "Nettoyage incomplet lors d'évolutions antérieures",
  "Charge de maintenance et confusion potentielle",
  "Suppression des deux constantes mortes",
  "tsc --noEmit exit 0 + test:v18913 PASS (171 fichiers, imports locaux intacts)",
  "preuves/audit-final/test-regression.log EXIT[types]=0 et EXIT[v18913]=0",
  "Nul","CLOS"],
 ["AN-08","P3",
  "Commentaire de schéma trompeur : prisma/schema.prisma (SalesDocCounter) citait GOCMD_STOCK_RESERVATION_LOCK comme utilisé dans sales/route.ts, work-order-create.ts, returns/route.ts et finished-stock/route.ts alors qu'il n'est utilisé que dans sales/route.ts",
  "Lecture croisée du schéma et du code",
  "Commentaire jamais resynchronisé après refactoring",
  "Documentation inexacte (risque de mauvaise manipulation lors d'une maintenance future)",
  "Commentaire corrigé : verrou localisé à sales/route.ts (action reserve-stock/release-stock)",
  "bunx prisma validate PASS",
  "preuves/audit-final/test-migrations-sauvegarde.log (étape 3 : check_sqlite_schema_p5157 PASS)",
  "Nul","CLOS"],
 ["AN-09","P2",
  "Scénarios métier SC-13 (modification CMD après OF), SC-14 (préparation OF puis mouvement concurrent de stock avant livraison) et SC-15 (fermeture/redémarrage/reprise) exigés par la mission d'homologation absents de la suite de recette",
  "Inventaire des tests : sc-recette-ventes-p51521.cjs couvre SC-01..SC-12 uniquement",
  "La recette P5.15.21 s'arrêtait à SC-12",
  "Couverture métier incomplète vis-à-vis des exigences d'homologation",
  "Création de tests/sc-recette-ventes-p51523.cjs (52 requêtes HTTP, base jetable, SIGKILL réel et redémarrage pour SC-15) + script npm test:sc-ventes:p51523",
  "node tests/sc-recette-ventes-p51523.cjs → 3/3 PASS (SC-13 : lignes figées + snapshots intacts + règle P5.15.23 suspension vérifiée — SC-14 : réservations protégées contre sortie concurrente totale, part libre consommable, livraison réservée exacte, lot fini ni double débité — SC-15 : intégrité ok, FK 0, compteurs monotones, référence unique, livraison reprise)",
  "preuves/audit-final/test-sc-recette-p51523.log (TOTAL 3/3 PASS, 52 requêtes)",
  "Nul identifié — SC-15 confirme la reprise WAL","CLOS"],
]

AMDEC_COLS = ["mode_defaillance","cause","effet","controle_existant","G","O","D","criticite_initiale","action_corrective","test_de_maitrise","criticite_residuelle","responsable","statut"]

amdec = [
 ["Tests de non-régression obsolètes (contrats statiques figés)","code évolué sans mise à jour des assertions","faux échecs / fausse confiance selon que le test est exécuté ou non","chaîne CI canonique + audit des écarts assertion/code","3","4","3","36","AN-01..AN-06 : assertions resynchronisées sur les mécanismes réels (protections conservées, souvent renforcées)","chaîne 67/67 PASS + rejeux individuels documentés","9","Qualité logicielle","MAITRISE"],
 ["Étapes de régression omises des preuves locales","lanceurs par lots non resynchronisés avec package.json","anomalies réelles non détectées pendant plusieurs versions (AN-01..AN-04 cachées)","CI GitHub exécutant la chaîne canonique","4","3","3","36","AN-05 : exécution intégrale documentée étape par étape — la CI doit rester l'unique référence","diff programmatique chaîne/journal + regression-status.csv","8","Qualité logicielle","MAITRISE (process)"],
 ["Double engagement stock négoce contre mouvement concurrent","séparation réservation/mouvement mal comprise","survente ou rupture à la livraison","triggers SQL gocmd_p5154 + assertStockUnreserved + verrou GOCMD_STOCK_RESERVATION_LOCK","4","2","2","16","rien (existant conforme, vérifié à neuf)","SC-14 partie A : sortie totale 409, part libre 201, livraison réservée exacte","4","Ventes","MAITRISE"],
 ["Double engagement matelas finis contre commande concurrente","OF de préparation sans réservation physique","deux BL sur les mêmes unités","FinishedStockReservation + triggers capacité + verrou GOCMD_OF_PREPARE_LOCK (CLT-04)","4","2","2","16","rien (existant conforme, revalidé)","SC-14 partie B : préparation C 409, livraison C 409, BL B exact, lot épuisé une fois","4","Ventes","MAITRISE"],
 ["Perte de données au redémarrage brutal","SIGKILL pendant écritures transactionnelles","commandes/réservations perdues ou incohérentes","WAL + file sérialisée + transactions atomiques + busy_timeout","5","2","2","20","rien (existant conforme)","SC-15 : integrity ok, FK 0, aucune commande perdue/dupliquée, compteurs monotones, livraison reprise","5","Exploitation","MAITRISE"],
 ["Références dupliquées après redémarrage","compteurs en mémoire","collisions de documents","compteurs SQLite persistés (SalesDocCounter) + contraintes @unique","4","2","2","16","rien","SC-15 : refs distinctes, zéro doublon en base après SIGKILL+reprise","4","Ventes","MAITRISE"],
 ["Suspension de commande sans libération d'engagements","état de préparation figé","stock immobilisé ou OF mensongèrement prêt","règle P5.15.23 : hold/close libère réservations et remet les OF stock en brouillon","4","2","2","16","rien (vérifié à neuf)","SC-13 : OF draft + preparationKind null + réservations 0 après suspension — nouvelle préparation requise","4","Ventes","MAITRISE"],
 ["Modification rétroactive de CMD après génération des OF","aucune action de modification des lignes n'existe","l'absence de garde serait un risque d'intégrité documentaire","actions limitées hold/resume/close/advance/approve/reject + photographies figées","4","1","2","8","rien (conception conforme)","SC-13 : update/modify refusés, corps lines ignoré, quantités inchangées, snapshots identiques","4","Ventes","MAITRISE"],
 ["Jeu de démonstration divergent des tests d'acceptation","régénération du jeu sans resynchronisation","faux échecs de recette","verify_demo_base_p51517.py (contrat actuel) + AN-06","3","3","3","27","assertions P5.13.2 ancrées sur le jeu V16+ avec invariants structurels conservés","test:v18913p5132 PASS (68 matières)","9","Qualité logicielle","MAITRISE"],
 ["Navigateur E2E absent (chromium-1254)","Playwright 1.65 épinglé vs cache local différent","E2E non exécutable dans l'environnement de recette","documenté FA-05 bis + CI installe le navigateur","3","3","2","18","bunx playwright install chromium exécuté dans l'environnement d'audit","E2E 3/3 PASS en 20,7 s","6","Exploitation","MAITRISE"],
 ["TVA non paramétrée par la comptabilité SODEPI","barème GOCMD_SALES_TAX_RATES_BPS vide par défaut","risque fiscal (mentions et taux factures)","taux par facture en bps + calcul centimes unique + DEF-V-03 documenté","4","2","3","24","inchangé — décision comptable SODEPI requise (pas d'invention de règle fiscale)","v182-finance-export + E2E T3 (TVA 20 % correcte)","12","Finance","EN ATTENTE D'ARBITRAGE SODEPI"],
 ["Installation Windows réelle non exécutée","sandbox Linux uniquement","blocage au déploiement SODEPI","LANCER_GOCMD_NEUF.cmd + start-gocmd-checked.cjs","4","1","3","12","inchangé — à réaliser chez SODEPI (RUNBOOK §9)","revue statique uniquement","12","Exploitation","NON TESTÉ (documenté honnêtement)"],
 ["Homologation prononcée sans recette humaine SODEPI","décision métier basée sur les seuls contrôles logiciels","risque opérationnel/atelier","mission §12 : trois verdicts distincts","5","1","2","10","le présent rapport maintient « recette technique validée, production NON homologuée »","conditions d'homologation listées au rapport final","5","Direction","MAITRISE (verdict honnête)"],
]

with open('preuves/audit-final/REGISTRE_DMAIC_P51523.csv','w',newline='',encoding='utf-8') as f:
    w = csv.writer(f, delimiter=';', quoting=csv.QUOTE_MINIMAL)
    w.writerow(REGISTRE_COLS)
    for r in registre:
        assert len(r)==len(REGISTRE_COLS), (r[0], len(r))
        w.writerow(r)

with open('preuves/audit-final/AMDEC_P51523.csv','w',newline='',encoding='utf-8') as f:
    w = csv.writer(f, delimiter=';', quoting=csv.QUOTE_MINIMAL)
    w.writerow(AMDEC_COLS)
    for r in amdec:
        assert len(r)==len(AMDEC_COLS), (r[0], len(r))
        w.writerow(r)

print(f"REGISTRE_DMAIC_P51523.csv : {len(registre)} lignes + en-tête, {len(REGISTRE_COLS)} colonnes")
print(f"AMDEC_P51523.csv : {len(amdec)} lignes + en-tête, {len(AMDEC_COLS)} colonnes")
