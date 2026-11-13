---
name: gocmd-acheteur-navigation-complete
description: "Vérifier les sept onglets du processus acheteur, la séparation des tâches et la cohérence de navigation multi-rôles."
---

# P5.15.6 — Relecture des onglets Acheteur

## Contrat métier

1. L'acheteur suit : Mes actions → Matières → DA → Fournisseurs → Consultations → BC → Suivi réceptions.
2. Le tableau de bord commercial et le catalogue de vente ne sont pas nécessaires au compte `buyer` seul. Ils restent visibles avec un rôle supplémentaire autorisé, sans modification des portes API.
3. L'acheteur peut consulter les bons de réception, mais seul `receiver` peut les saisir. La séparation des tâches sur DA, BC, tarification et réception reste imposée côté API.
4. Les alertes sous seuil fabriquées en interne restent informatives. L'acheteur ne crée jamais de DA pour l'agglomérée.
5. Les intitulés des écrans et explications doivent guider vers l'étape suivante, sans envoyer de devis ni créer automatiquement DA ou BC.
6. Les sept onglets doivent être accessibles au clavier (boutons natifs, aria-current), sur mobile et sur ordinateur ; les comptes multi-rôles conservent les autres fonctionnalités.
7. Recette: compte buyer pur, buyer+approver, receiver seul, finance seul, demande avec 0,5 bloc refusée, sourcing après DA approuvée, suivi BC et BR, absence de fonction de réception pour buyer, création BR pour receiver. Préserver les données et journaliser les effets.

## Preuves demandées

Tests navigation Node/TS, contrôle statique lecture seule BR, tests API multi-rôles et capture navigateur 1366×768 / 390×844. Distinguer code inspecté, suites exécutées, types/build et validation Windows. Ne pas déclarer la production homologuée avant la recette réelle.
