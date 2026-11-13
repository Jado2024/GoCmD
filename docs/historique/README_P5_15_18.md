# GoCmd P5.15.18 — Installation & recette achats multi-fournisseurs

## Nouvelle base de recette (non destinée à la production)

- **68 matières premières**, y compris des ruptures, sous-seuil et stocks suffisants.
- **11 fournisseurs**, 119 associations matière–fournisseur, qualifications fictives de recette.
- **64 lots**, emplacements et quantités conservés depuis la DEMO P5.15.17.
- **9 comptes fonctionnels** (acheteur, responsable achats, réception, magasinier, qualité, finance, direction, administration, commercial), mot de passe provisoire communiqué séparément ; changement obligatoire à la première connexion.
- **0 DA, consultations, offres, BC, BR, factures fournisseurs** au départ : réaliser le circuit depuis la première DA.

**Ne pas remplacer `db/custom.db` dans une installation réelle.** Les qualifications et stocks de cette DEMO sont fictifs.

## Installation complète, Windows

1. Arrêter l'ancien GoCmd. Sauvegarder au minimum la base SQLite, le dossier des documents privés et `.env`.
2. Créer un dossier neuf, par exemple `C:\GoCmd-Recette-51518`, extraire **le ZIP complet** dans ce dossier (où se trouve `package.json`). Ne pas superposer les fichiers à ton ancien dossier de production.
3. Ouvrir PowerShell dans ce dossier et lancer :

```powershell
bun install --frozen-lockfile
bunx prisma validate
bunx prisma generate
bunx tsc --noEmit
bun run build
python scripts/verify_demo_base_p51517.py
npm run test:v18913p51518
```

4. Si toutes ces commandes réussissent, libérer le port **3001**, puis démarrer `LANCER_GOCMD_NEUF.cmd`. Ouvrir `http://127.0.0.1:3001/login`.
5. Utiliser deux comptes distincts **acheteur** et **responsable_achats** pour les décisions. Un approbateur ne peut pas être celui qui a proposé, saisi ou validé l'offre.

Si le build échoue, ne pas démarrer `next start` sur une ancienne compilation : corriger la panne et reconstruire.

## Migration additive sur une autre base P5.15.17 (option avancée)

**Après sauvegarde et arrêt complet de GoCmd**, appliquer au préalable les migrations manquantes des versions intermédiaires si nécessaire. Pour une base déjà au schéma P5.15.17 :

```powershell
python scripts/upgrade_multi_awards_p51518.py --db db/custom.db --apply
bunx prisma generate
bunx tsc --noEmit
bun run build
```

La migration P5.15.18 est rejouable, ne réinitialise ni matières ni DA et conserve tous les documents existants. Vérifier d'abord sur une copie avant migration d'une base réelle.

## Parcours de recette — 100 kg de colle, deux fournisseurs

1. Créer une DA de 100 kg sur une matière référencée chez au moins deux fournisseurs ; faire approuver la DA.
2. Démarrer une consultation et inviter fournisseurs A et B.
3. Enregistrer A : offre téléphonique 60 kg (prix, délai, interlocuteur, compte rendu), puis **validation acheteur** sans PDF.
4. Enregistrer B : devis écrit 40 kg, joindre le **PDF de la version courante** ; saisir le devis et la validité. Utiliser les qualifications fictives du jeu de recette.
5. Dans **Consultations & offres → Comparer**, répartir 60 + 40 kg et saisir la justification (20 caractères minimum).
6. Avec `responsable_achats` **distinct**, approuver le plan. Vérifier que les deux offres sont retenues et que le total ne dépasse pas 100 kg.
7. Revenir sur le compte acheteur, cliquer **Créer les BC brouillons par fournisseur**. Deux BC distincts doivent être créés ; les faire approuver par un autre compte.
8. Contrôler la réception, les lots et les stocks. Tester également un refus, une relance, un devis révisé, un PDF d'ancienne version et le blocage d'une attribution à 110 kg.

Les offres non retenues restent historisées. Une RFQ peut contenir plusieurs fournisseurs et un plan peut affecter des quantités différentes à chacun, mais un plan doit couvrir la totalité de la quantité consultée ; pour une attribution partielle, créer une nouvelle RFQ justifiée après réévaluation du besoin.

## Filtres et tri

- DA : sans DA / avec DA / historique, rupture et stock sous seuil.
- Consultations : matière, fournisseur, famille, statuts, sans réponse **par fournisseur invité**, validation acheteur, attente responsable.
- Tri : priorité combinée besoin daté / rupture / seuil, tri séparé de risque de stock, dates, alphabétique matière et fournisseur stables. La **prévision complète MRP/couverture par réservations futures** reste hors périmètre GoCmd (GoProd reporté) : le classement est une aide à la décision, pas une date de rupture garantie.
- Refus et relances : saisie horodatée par acheteur, **aucun envoi automatique** de mail ou SMS.

## Tests et limites

```powershell
npm run test:v18913p51515
npm run test:v18913p51516
npm run test:v18913p51517
npm run test:v18913p51518
npm run test:package
```

Tests effectués lors de la livraison : 8 tests Node ciblés + vérification Prisma/SQLite statique + tests de migration rejouée et scénario **structurel** SQLite 60/40 → deux BC (sur copie isolée). Les nouvelles routes Next.js n'ont pas fait l'objet d'une recette HTTP complète ici ; le build et le typecheck intégral sont **à exécuter sur Windows après installation des dépendances**. Ne pas utiliser en production sans validation complémentaire RBAC, concurrence et navigation.
