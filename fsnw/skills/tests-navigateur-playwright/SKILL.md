---
name: gocmd-tests-navigateur-playwright
description: Exécuter des recettes UI E2E mesurées et reproductibles, avec Playwright, captures, accessibilité et preuves sans toucher aux règles métier.
---

# Skill — Recettes navigateur Playwright

**Référence GitHub consultée :** [Anthropic `webapp-testing`](https://github.com/anthropics/skills/tree/main/skills/webapp-testing) (skill Apache-2.0 annoncé). Ce skill FSNW est **une adaptation originale**, pas une copie de code externe. Utiliser le vrai Playwright du projet si installé, ne télécharger ni exécuter de script externe implicitement.

## Séquence
1. Lire la politique SODEPI. Figer SHA du projet, environnement, base fictive et rôles nominatifs. Ne pas exposer de secrets, ne jamais tester sur une DB réelle.
2. Lire les routes/vues et préparer la matrice rôle × écran × viewport. Compléter le skill `ux-accessibilite` pour les critères ; en mode **audit UX**, ne modifier ni code ni données métier réelles.
3. Lancer le serveur local et utiliser **un contexte navigateur isolé par rôle**, avec une base de recette indépendante. Noter commandes, URL locales et codes de sortie.
4. Exécuter parcours positifs/négatifs : réception partielle, stock et quarantaine, gabarit 11, salon 8,8ml, ouate 4,75kg, prix directeur (sales/approver/director/admin), BL partiel, accès interdit 403.
5. Mesurer `innerWidth`, `scrollWidth`, `getBoundingClientRect`, captures, erreurs console et erreurs réseau ; tester 1920×1080, 1366×768, 1024×768, 768×1024, 375×812, 320×720, redimensionnement sans reload, focus clavier.
6. Capturer captures réellement produites et produire `journal_navigateur.md` avec assertion, résultat, screenshot, rôle, version et statut PASS/FAIL/Non testé.
7. Si Playwright/Bun indisponible : **Non testé**, ne pas prétendre avoir exécuté E2E.

## Livrables
`inventaire_parcours.csv`, `mesures_responsive.csv`, `CAPTURES/`, `journal_navigateur.md`. Aucune action corrective sans feu vert de l'utilisateur si le mandat est audit seul.

## Actualisation CASCADE4-R1 — parcours à approbation obligatoire
- Créer commande → constater `pending_validation` et l'absence d'OF → approuver avec un **autre compte** → vérifier les OF autorisés, puis BL/facture ; tester auto-approbation avec un utilisateur multi-rôles.
- Simuler double clic, réponse perdue, nouvelle commande similaire et confirmation motivée ; vérifier la cohérence UI/API/base et l'absence de doublon.
- Tester une permission explicitement révoquée même si le rôle est conservé, notamment `stock.read` et `director.prices` ; vérifier aussi l'absence de fuite de DTO dans les réponses réseau.
- Un navigateur manquant ou un échec de navigation transitoire doit être classé/reproduit explicitement ; ne jamais déclarer PASS sans scénario réellement terminé.
