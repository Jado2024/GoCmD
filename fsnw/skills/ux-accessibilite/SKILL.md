---
name: gocmd-ux-ui-expert-erp
description: Audit expert UX/UI d'un ERP SODEPI sur dix axes avec preuves, tests navigateur multi-rôles, WCAG 2.2 AA et arrêt obligatoire avant corrections.
---

# Skill — Audit UX/UI expert ERP SODEPI

## Déclenchement et autorité
Mission d'audit ergonomique, responsive, accessibilité, design system, simplification de workflows GoCmd, **sans modifier l'application**. Lire `fsnw/POLITIQUE_SODEPI_ACTUELLE.md`, ce skill puis `references/PROTOCOLE_AUDIT_UX_UI_ERP.md`. Ce protocole enrichi est l'instruction de référence pour l'audit UX ; il remplace les anciens prompts UX copiés dans le projet.

## Arrêt absolu
**PHASES 1 À 4 : lecture et mesures uniquement. STOP obligatoire après le rapport.** Ne pas écrire dans `src/`, `prisma/`, `scripts/`, `.github/` ou la base ; seules des preuves dans un dossier d'audit séparé sont permises. Ne pas demander à l'utilisateur de redonner des exigences déjà précisées. Une demande explicite de correction ultérieure autorise seulement le lot désigné ; obtenir une validation séparée avant chaque lot suivant.

## Exécution
1. **Comprendre** : identifier fichiers, routes, écrans, composants, design tokens et matrice rôles×actions. Distinguer documentation, code et exécution. Lister cinq tâches par rôle seulement si observées, sinon hypothèses.
2. **Exécuter** : environnement isolé, comptes nominatifs, navigateur avec 1920×1080, 1366×768, 1024×768, 768×1024 ; inclure 320/375px et resize sans rafraîchir. Captures par écran/rôle/résolution pertinent. Ne jamais contourner auth/RBAC.
3. **Évaluer** sur 10 axes détaillés dans le protocole : alignements, typographie, couleurs et contrastes, charge cognitive, interactions, clavier/tactile, densité, tableaux/formulaires, rôles, cohérence esthétique. Associer chaque critique à un principe et une preuve réelle (fichier:ligne/capture/mesure).
4. **Rapporter** : inventaire exhaustif, matrice, anomalies `UX-001…`, score /10 par axe uniquement si suffisamment testé, mesurables avant/après, top 10, plan de corrections et limites. Ne jamais inventer de mesure ni de note globale.
5. **STOP** : attendre validation explicite avant tout changement de source. Suivre ensuite les lots listés dans le protocole ; revalidation avant chaque lot.

## Livrables
Créer dans un dossier d'audit autonome : `AUDIT_UX_UI.md`, `INVENTAIRE_ECRANS.md`, `MATRICE_ROLES_UX.md`, `ANOMALIES_UX.csv`, `PLAN_CORRECTIONS_UX.md`, `CAPTURES/` si le navigateur l'a réellement permis. Chaque constat inclut gravité, preuve, comportement attendu, impact, principe ergonomique, correction chiffrée, effort et méthode de retest.

## Gardes métiers
Gabarits Richbond et métrage ml ; visa prix spécial directeur distinct de validation générale ; informations prix/coûts interdites aux rôles non habilités ; aucun retrait des contrôles ou champs légaux sous prétexte d'ergonomie. GoProd (BOM/MP/OF/MRP) hors périmètre.

## Règles validées par le contre-audit V18.9.11
1. **Verdict strict des journaux de campagne** : un débordement (`documentElement.scrollWidth − clientWidth > 0`) est TOUJOURS un échec dans les journaux — V18.9.10 avait enregistré 25 px sur « Factures fournisseurs » à 768×1024 en le marquant « OK », contredisant son propre rapport. Un journal ne doit jamais contredire le verdict annoncé.
2. **Boutons `whitespace-nowrap` dans les grilles** : jamais de colonne de grille plus étroite que le bouton le plus large qu'elle contient (CA-001 : colonne 165 px < bouton 226 px). Utiliser des grilles à 2 colonnes entre 768 et 1280 px quand la 4e colonne porte des boutons longs ; vérifier aussi la frontière 1024 px où une colonne de 225 px peut passer à 1 px près.
3. **Cibles tactiles ≥ 24×24 px** (WCAG 2.5.8) pour TOUS les contrôs, y compris le bouton de fermeture des modales (CA-002 : 16×16 → 24×24 avec `grid size-6 place-items-center`, icône inchangée).
4. **Saisies invalides — règle renforcée V18.9.12** : afficher un message visible lié par `aria-describedby` **et** empêcher l'enregistrement tant que le brouillon saisi n'est pas valide. Un contrôle doit dériver l'affichage, le total et le payload de la même quantité ; ne jamais envoyer une ancienne valeur commitée lorsque le champ affiche un nombre invalide. Éviter les arrondis silencieux et les remplacements automatiques lors du blur (UX-QTY-01, test `v18912-purchase-quantity.test.mjs`).
5. **Mesures « non trouvé » à reprendre** : une mesure prévue mais non exécutée (« Valider la sortie » NON TROUVÉ en V18.9.10) doit être rejouée avec attente robuste jusqu'à obtenir une valeur réelle — jamais laissée en « — » dans le rapport final sans reprise.
6. **Environnement de test imbriqué** : si le projet GoCmd est servi depuis un dossier imbriqué dans un autre projet Next.js, charger `DATABASE_URL` (chemin absolu) au niveau du process ; vérifier l'avertissement « multiple lockfiles » de Next 16 qui fait choisir le workspace root parent (le .env du parent peut écraser celui du projet).

## Règles de design validées (V18.9.10)
Après l'audit V18.9.9 et sa mission de correction, les règles de design appliquées et mesurées sont consignées dans `references/DESIGN_SYSTEM_GOCMD_V18_9_10.md` : action primaire unique emerald-700 (5,36:1), destructive rose-700, focus outline opaque (le ring shadcn 50 % était mesuré invisible), composants shadcn exclusifs, fmtMAD unique, recherche à la soumission, portée des tris locaux affichée, seuils de motif réels affichés. Toute évolution UI de GoCmd doit s'y conformer ou la mettre à jour avec de nouvelles mesures.

## Règles validées par le contre-audit P5.15.8 (base 18.9.13-p5.15.7)
1. **Affordance des zones défilantes (F1/F2)** : tout conteneur `overflow-x-auto` (barre d'onglets, tableaux) dont le contenu dépasse le viewport DOIT porter un indicateur visible. Un dégradé blanc→transparent sur fond blanc est INVISIBLE (mesuré par analyse de capture) : utiliser une ombre interne `shadow-[inset_±10px_0_8px_-8px_rgba(15,23,42,0.35)]` sur un élément `pointer-events-none` superposé, activée seulement quand `scrollLeft+clientWidth<scrollWidth` (et symétriquement à gauche), `print:hidden` sur l'indicateur et `print:overflow-visible` sur le conteneur pour l'impression. Repère mesuré : 768 px, rôle finance = 506 px d'onglets masqués sans aucun indice avant correction ; rôle acheteur = 724 px.
2. **Débordement 25 px « Factures fournisseurs » 768×1024 (V18.9.10) : NON REPRODUIT sur P5.15.7** — la branche 18.9.13-p5.15.x utilise `overflow-x-auto` + `min-w-max` correctement. Toujours re-mesurer sur la branche réellement livrée avant d'hériter un verdict d'une version antérieure ; un débordement historique peut avoir été corrigé entre branches.
3. **« Échec silencieux » de formulaire (F4) : vérifier la validation native AVANT de conclure** — un bouton qui ne déclenche aucune requête avec un champ requis vide peut être le comportement HTML5 normal : le focus passe au champ fautif et le navigateur affiche son infobulle native (invisible dans l'arbre d'accessibilité, visible en capture). Vérifier focus + infobulle + surlignage avant de décréter un défaut ; la langue de l'infobulle suit celle du navigateur, pas de l'application.
4. **Zéro débordement document mesuré sur 45 combinaisons** (9 vues × 5 résolutions 1920/1366/1024/768/375) après correction des affordances : ce balayage est le gabarit minimal d'une matrix UX GoCmd.
5. **Fixtures versionnées pour les tests historiques (écart P5157-06)** : quand les données de démonstration évoluent (189→217 produits, P2P vidé), les tests de recette historiques doivent rejouer sur une fixture figée (`tests/fixtures/v16_demo.db`, SHA-256 épinglé dans le test) et non sur la base live ; les assertions ne sont jamais supprimées ni affaiblies. Les recettes HTTP qui créent des doublons DA volontaires utilisent la sortie `duplicateJustification` prévue par l'API.
