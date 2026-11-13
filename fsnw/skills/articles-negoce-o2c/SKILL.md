---
name: gocmd-articles-negoce-stock-reservations
description: "Vérifier une même référence achetée, stockée, utilisée en interne et vendue : disponibilité, réservations, BL et traçabilité."
---

# Skill — Article commun / Négoce / O2C (GoCmd P5.15.4)

## Doctrine métier
Lire `fsnw/POLITIQUE_SODEPI_ACTUELLE.md` en priorité. Garder l'achat et la vente indépendants, une seule identité de stock `Material` liée à `Product`, et aucun BOM/OF GoProd. Les mousses AGGLO sont fabriquées en interne, non achetables par défaut ; le visa directeur reste obligatoire pour les prix spéciaux. Aucun contrôle ne doit exposer le coût fournisseur au rôle ventes.

## Scénarios obligatoires, avec résultats HTTP et SQLite sur copie fictive
1. Créer une mousse pure achetable et vendable ; vérifier une seule référence commune, aucune duplication de lots ni de stock.
2. Créer une commande mixte (salon facturé en ml et deux matières revendues) ; vérifier le prix unitaire figé, les pièces et les unités converties.
3. Vérifier disponibilité physique, réservée et libre ; les lots quarantaines/périmés ne sont pas disponibles à la réservation.
4. Réserver 3 blocs sur 5 ; une commande concurrente ne peut réserver que 2 ; refuser 0,5 bloc.
5. Refuser une sortie manuelle, un retour fournisseur, un rejet qualité et un inventaire qui feraient passer le lot sous la quantité réservée.
6. Livrer partiellement : consommer la réservation et le stock du bon lot, générer `Movement`, `SalesStockAllocation` et un BL unique dans une même transaction.
7. Retenter le BL avec le même UUID : renvoyer le même document sans nouvelle sortie. Un UUID de BL lié à une autre commande est refusé.
8. Suspendre la commande : relâcher ses réservations ; refuser BL et transitions atelier. Reprendre puis clôturer son reliquat avec motif, sans annuler les BL déjà postés.
9. Vérifier l'interdiction de reconstituer ou modifier une facture/ligne déjà livrée ; la facture provient uniquement des BL non facturés.
10. Vérifier rôles et permissions : sales pour réserve/délivre/hold, inventory pour sortie, finance pour facture ; aucun droit hérité via `admin` ne remplace le directeur spécial.
11. Rejouer deux clients simultanés et deux processus serveurs si environnement cible le permet. Tester sauvegarde/restauration et migration idempotente.
12. Scénarios négatifs pour altération SQL directe de réservations, crash entre mouvement et BL, et correction documentaire par retour. Conserver l'échec des scénarios non implémentés.

## Preuves et garde de sortie
Conserver code SHA, données d'entrée, sortie, statut HTTP, événements et invariants SQLite. Séparer preuve de lecture statique, test Node/SQL, test HTTP et tests navigateur. La présence d'un test ou d'un skill n'est jamais une preuve qu'il a été exécuté. Ne jamais certifier conformité ISO/OWASP sur cette seule base.

## Actualisation CASCADE4-R1 — contrôle de commande approuvée
- Avant tout appel de réservation ou BL, prouver que la commande a été approuvée par un autre compte habilité ; une commande `pending_validation` doit rester bloquée même si une quantité physique existe.
- La détection d'une commande similaire ne doit pas être contournée en régénérant une clé ; la justification doit être enregistrée côté serveur.
- Tester la même matière dans plusieurs commandes concurrentes, la dernière unité et la relecture après réponse perdue : réponse HTTP et quantité réservée doivent correspondre.
- Ne pas conclure à un retour en stock de matière revendue sans réception physique et décision qualité vérifiées ; qualifier l'écart s'il reste une fonction non implémentée.
