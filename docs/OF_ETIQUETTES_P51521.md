# GoCmd P5.15.21 — OF simplifiés et étiquettes Richbond/SODEPI

## Fonctionnement

Toute commande commercialement validée reçoit un numéro CMD unique. Le logiciel génère dans la même transaction **un OF en brouillon par ligne commerciale**, qu'il s'agisse de fabrication ou de revente directe. Une commande spéciale n'émet les OF qu'après approbation ; le refus n'en émet aucun. Le commercial ne choisit pas le mode d'approvisionnement à la création de la commande.

Une ligne de salon peut contenir neuf pièces physiques : c'est UN OF avec neuf étiquettes. Les matelas restent sans dessin. Une ligne de négoce n'a pas de `OrderPiece` fabriquée ; elle reçoit une seule **étiquette de préparation** avec quantité, unité, CMD et OF.

L'OF est d'abord `draft`. La validation est effectuée par un responsable distinct (quatre yeux). Pour la revente, le responsable peut utiliser « Valider préparation » pour clore l'OF sans simuler une production. Pour les pièces à fabriquer : `draft → approved → in_progress → completed`.

Annulation motivée possible en brouillon ou approuvé, puis réactivation avec nouvelle validation ; l'identifiant OF est préservé et toutes les décisions sont tracées. Les livraisons de commandes disposant d'OF sont bloquées tant que tous les OF de la commande ne sont pas terminés. Les commandes historiques sans OF restent compatibles, avec régularisation contrôlée depuis le panneau OF.

`WorkOrder.orderLineId` est unique, les références utilisent le compteur transactionnel SQLite, et des gardes SQL assurent la cohérence CMD/ligne. **La création d'OF ne réserve ni ne déduit le stock.**

## Impression

- A4 portrait, marges 9 mm, 2 colonnes × 4 rangées, **8 étiquettes/page**.
- Salon 9 pièces : 2 pages, 8+1 ; matelas 7 : 1 page ; matelas 11 : 2 pages, 8+3.
- Étiquettes individualisées, code-barres Code 39 sur l'identifiant pièce.
- Gabarits 11/21–24/31–34/41/51 : croquis **indicatif** du gabarit et
  données techniques saisies ; aucune conversion fictive des obliques S/T.
- Pièces standards : pas de dessin géométrique inutile.
- **Famille MATELAS : aucun dessin**, même si des données de gabarit
  historiques existent. Dimensions, type de noyau, composition, finition.
- Les plans gabarits imprimés restent des aides de repérage, **pas des plans
  cotés certifiés pour une machine de découpe**. Validation atelier requise.
- Un OF approuvé se consulte et s'imprime depuis les détails de commande.

## Installation et migration

Exécuter le dry-run, sauvegarder hors du dossier source, puis seulement
appliquer la migration durant une fenêtre de maintenance. Ne pas utiliser
`prisma db push` : ce projet interdit les changements de schéma non contrôlés.

```bash
python scripts/upgrade_work_orders_p51521.py --db db/custom.db
python scripts/upgrade_work_orders_p51521.py --db db/custom.db --apply --backup /backup/externe/gocmd-of.db
npm run test:work-orders:p51521
```

`bunx prisma generate`, `bunx tsc --noEmit`, `bun run build`, recettes HTTP et
vérification réelle des étiquettes imprimées restent indispensables avant
homologation. L'OF simplifié ne réserve ni ne consomme de matières premières,
ne modifie pas le stock et ne calcule pas le coût industriel : **GoProd
reste séparé**.

## Dépendances et risques à fermer

1. Vérifier l'impression Chrome/Edge (A4, marges, échelle 100 %, 8 tickets)
   avec les imprimantes et feuilles autocollantes SODEPI réelles.
2. Vérifier l'accès des deux responsables ayant le rôle d'approbation.
3. Exécuter les migrations sur copie, tests HTTP et CI de bout en bout.
4. Vérifier sur une copie le circuit CMD → OF → livraison pour tous les produits, y compris le négoce ; GoProd futur reste séparé.
5. Aucun OF imprimé ne constitue une autorisation automatique de débit stock.
