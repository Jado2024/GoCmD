# Protocole exhaustif d'audit UX/UI ERP — version FSNW

Source : protocole utilisateur d'audit UX/UI remis le 2 novembre 2026 ; exigences intégrées et organisées en un skill opératoire. **Ce n'est pas une autorisation de modifier le code.**

## Mission et méthode
Auditeur senior UX/UI, ergonomie cognitive et accessibilité ERP (achats, commandes, stock, finance). Fondements : WCAG 2.2 AA, heuristiques de Nielsen, Fitts, Hick, Gestalt et prévention des erreurs. L'objectif n'est pas une refonte décorative : interface professionnelle, fiable, cohérente, rapide, accessible au clavier, au PC et à la tablette, qui limite les erreurs et ressaisies.

**Ordre immuable : Phase 1 → Phase 2 → Phase 3 → Phase 4 → STOP.** Une phase 5 n'est permise qu'après validation humaine **explicite**, lot par lot. Ne jamais modifier la base, les autorisations, les API, les validations, les calculs, la facturation, les gabarits ni les circuits métier depuis le seul audit UX.

## Phase 1 — Compréhension sans modification
- Lire README, installation, toutes routes/pages/layouts, composants, modèles de données, auth/RBAC, navigation, modales, formulaires, tables, CSS/Tailwind, design tokens, couleurs, polices, espacements, icônes, feedback d'erreur et états chargement/vide.
- Différencier trois niveaux : **déclaré en documentation**, **présent dans le code**, **vérifié à l'exécution**. Ne jamais substituer l'un à l'autre.
- Identifier chaque rôle de la version réellement auditée, ses modules, actions autorisées et interdites, informations essentielles. Proposer cinq tâches fréquentes **si** observation/preuve ; sinon marquer « hypothèse à confirmer ».
- Fournir un résumé factuel de 10 à 15 lignes, une matrice rôles × modules × actions, un inventaire de toutes vues/sous-vues/modales/parcours avec route et fichier, et les ambiguïtés restantes.
- **Ne pas commencer l'évaluation visuelle avant inventaire terminé.**

## Phase 2 — Exécution instrumentée et inventaire des interactions
1. Vérifier dépendances, démarrer en mode local isolé sur une **copie fictive** de la DB, ne pas contourner l'authentification ; expliquer précisément toute erreur de démarrage, puis continuer l'analyse statique sans inventer de tests.
2. Parcourir tous les écrans accessibles de chaque rôle pertinent. Matrice minimale : **1920×1080, 1366×768, 1024×768, 768×1024**. Compléter 320/375 px et resize 1920→320 sans rafraîchir (régression historique GoCmd).
3. Capturer uniquement les écrans réellement visités, nommer chaque preuve `role_vue_largeurxhauteur_YYYYMMDD.png`, documenter environnement, version/SHA, navigateur, login de test non secret.
4. Contrôler dépassements (`scrollWidth`, boîtes), sidebar, tableaux larges, menus, modales, focus, éléments masqués, clavier virtuel si matériel/test le permet.
5. Inventorier boutons, liens, sélecteurs, champs, cases, onglets, icônes cliquables, lignes cliquables et menus contextuels. Pour chaque type et occurrence : mesures **réelles par le navigateur** des dimensions et hit areas, normal/hover/focus/disabled/error/loading, retour après action.
6. Tester explicitement refus de rôle, mauvais input, confirmation d'annulation, perte réseau si environnement isolé, persistance d'édition et impressions simulées si possibles. Une simple lecture CSS n'est pas une mesure des pixels réels.

## Phase 3 — Les dix axes et principes à documenter

### Axe 1. Alignement et structure (Gestalt, proximité, cohérence)
Grille principale, alignement des titres et cartes, marges, échelle d'espacement 4/8 px, champs, colonnes, alignement montants/quantités **à droite**, libellés **à gauche**, distribution de l'espace. Conserver des captures avec superpositions/mesures quand applicable.

### Axe 2. Typographie et lisibilité
Cible projet : **tableaux ≥14 px**, champs de saisie **≥16 px** ; ce sont des objectifs de conception, **pas des minima WCAG universels**. Vérifier échelle typographique, interlignage, gras, libellés, lecture longue, chiffres tabulaires pour coûts/quantités, distinction contenu primaire/secondaire. Mesurer les valeurs réelles.

### Axe 3. Couleurs et contrastes
Extraire la palette réellement utilisée avec HEX, fond/composant/usage et cohérence de sémantique. Mesurer les ratios WCAG AA pertinents : texte normal 4,5:1, grand texte 3:1, composants/indicateurs non textuels 3:1 quand critère applicable ; ne pas transmettre une information uniquement par couleur. Contrôler hover, sélection, erreur, succès, avertissement, info, focus, fatigue liée à la saturation. Toute palette proposée doit préciser HEX, usages et couples de contraste vérifiés.

### Axe 4. Psychologie et charge cognitive (Nielsen, Hick)
Évaluer hiérarchie, tâche primaire, nombre de décisions, informations redondantes, bruit visuel, reconnaissance plutôt que mémorisation, erreurs lisibles, feedback immédiat, reprise après échec, prévention de l'erreur et vocabulaire adapté à SODEPI. Une compréhension « en 3 secondes » exige **un test humain** et ne peut être déclarée par le seul agent.

### Axe 5. Boutons et interactions (Fitts)
Mesurer tailles, cibles, espacement, hiérarchie des actions, verbes des libellés, icônes interprétables, confirmations destructives et clics accidentels. Cible ergonomique **44×44 px** ; le minimum WCAG 2.2 AA **2.5.8** est généralement **24×24 CSS px**, sous exceptions. Ne pas confondre conseil et norme. Relever avant→après seulement si l'état initial est mesuré.

### Axe 6. Clavier et tactile (WCAG 2.2)
Tester Tab/Shift+Tab, ordre logique, focus visible, Entrée/Espace appropriés, fermeture Escape, absence de piège, menus sans dépendance au survol, champs non cachés derrière clavier virtuel quand testable, défilement tablette, précision tactile. Si lecteur d'écran absent, statut **Non testé**, jamais « conforme ».

### Axe 7. Densité et utilité
Identifier colonnes/KPI/boutons redondants, champs inutiles ou répétés, textes de décoration, espaces vides improductifs ; pour chaque élément recommander explicitement **Conserver / Simplifier / Regrouper / Masquer / Supprimer**. Jamais supprimer une donnée nécessaire au contrôle, à l'audit ou à la décision métier.

### Axe 8. Tableaux et formulaires
Recherche, filtres, tris, pagination, colonnes figées si justifiées, largeur, unités et montants, états vides, validation, champs obligatoires, valeur par défaut, doublons, confirmation, conservation des champs après erreur, bon fonctionnement sur tablette. Préserver les contrôles de prix directeur, gabarits, stocks, TVA, double validation.

### Axe 9. Rôles et autorisations
Pour **chaque** rôle, comparer les écrans visibles, boutons permis/interdits, complexité et tâches attendues. Un bouton masqué/désactivé ne sécurise rien ; tout contrôle serveur reste intact. Les écarts RBAC sont signalés séparément à `securite-confidentialite` **sans correction automatique**.

### Axe 10. Esthétique et cohérence professionnelle
Simplicité, modernité, sobriété, cartes, ombres, arrondis, typographie, libellés, icônes, navigation, formulaires et design tokens. Chaque modification proposée doit servir compréhension, cohérence ou efficacité ; aucune refonte gratuite.

## Phase 4 — Rapport obligatoire, sans modification de source

### Scoring
Tableau par axe : `Axe | Note /10 ou Non évaluable | Justification | Principe | Niveau de confiance | Couverture testée`. Ne pas donner de score global si des écrans/rôles essentiels n'ont pas été observés. **Aucun score inventé**. Absence de test ≠ non-conformité avérée.

### Registre par écran
`ID UX-001... | Écran/route | Problème | Preuve fichier:ligne ou capture/mesure | Principe | Gravité | Impact | Correction mesurable | Effort | Retest`. Gravité : **Bloquant** (tâche impossible/risque opérationnel), **Gênant** (ralentit/risque d'erreur), **Mineur** (cosmétique). Réserver le qualificatif P0 aux défauts effectivement bloquants.

### Recommandations chiffrées
Formule : valeur mesurée → cible justifiée, par exemple champ 36→44 px, tableau 12→14 px, cible 28×28→44×44 px, espacement 6→8 px, montants gauche→droite, contraste mesuré→contraste cible. Ne jamais inventer la valeur initiale ni promettre un gain de temps non mesuré.

### Palette
Proposer une palette **uniquement en cas d'écart constaté**, avec HEX pour primaire/secondaire/fond/cartes/textes/bordures/succès/avertissement/erreur/information/focus/sélection. Tester les ratios des associations.

### Priorisation
Top 10 : problème, écran(s), preuve, impact, risque évité, correction, effort faible/moyen/élevé, méthode de vérification. Favoriser réduction d'erreur, vitesse, accessibilité, lisibilité, cohérence, puis esthétique.

### Fichiers livrables (dans dossier d'audit séparé)
- `AUDIT_UX_UI.md` : constats et scores justifiés ;
- `INVENTAIRE_ECRANS.md` : routes et fichiers ;
- `MATRICE_ROLES_UX.md` : visibilité, actions, interdictions ;
- `ANOMALIES_UX.csv` : données structurées ;
- `PLAN_CORRECTIONS_UX.md` : lots et critères ;
- `CAPTURES/` : uniquement si captures réellement produites.

## Phase 5 — Seulement après autorisation explicite
**STOP** après phase 4. Présenter rapport, attendre validation. Si autorisé, travailler **un lot à la fois** : 1 typographie ; 2 alignement ; 3 couleurs ; 4 boutons/tactile ; 5 formulaires/tableaux ; 6 navigation/responsive ; 7 charge cognitive ; 8 harmonisation. Adapter au registre ; ne pas exécuter de lot inutile.

Pour chaque lot : fichiers, diff attendu, modification **seulement d'interface approuvée**, tests techniques + régressions visuelles, comparatif captures avant/après, résultats et limites, puis **nouveau STOP avant lot suivant**. Aucune migration/API/RBAC/modification métier sans mandat distinct.

## Principes non négociables
Aucune hypothèse comme fait ; chaque critique a une preuve ; aucune mesure, test ni score inventés ; ne pas confondre WCAG et préférences ; indiquer limites/outils absents ; contrôler retombées sur tous les rôles ; préférer composants réutilisables et design tokens ; préserver traçabilité, sécurité, workflows et périmètre GoCmd. Le rapport doit indiquer clairement les écrans **non visités**.
