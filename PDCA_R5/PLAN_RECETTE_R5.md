# Plan de recette bloquante R5 — à exécuter sur machine Node24 et base isolée

1. `bun install --frozen-lockfile` puis `bunx prisma validate && bunx prisma generate` ; échouer immédiatement sur lockfile/migrations non reproductibles.
2. `bun run test:v2:r5`, `bunx tsc --noEmit`, `bun run lint` et `bun run build` ; enregistrer les journaux complets et la version de Node/Bun/SQLite.
3. Lancer le serveur uniquement sur une copie DEMO sécurisée avec comptes utilisateurs distincts ; appliquer les scripts de préparation requis ; vérifier `/api/health` et les rôles.
4. HTTP : DA→consultation multi-fournisseurs→offre téléphonique validée→BC→réception qualité→facture, revente MP, vente PF standard, GEN devis/commande, prix directeur ligne A puis B, approbateur distinct, OF uniquement après approbation, GEN sans préparation zéro OF et POST manuel 409, livraison, facture, avoir et retour.
5. Négatifs : commercial s'auto-approuve, directeur sans `director.prices`, idempotence, prix/empreinte modifiés après visa, doublon de référence fournisseur, stock négatif, concurrence deux comptes, suppression d'article utilisé, revente à double stock.
6. Playwright : tablette et téléphone à 320/375/768/1024 pixels, navigation clavier, focus visible, cibles tactiles, messages d'erreur, colonnes sans débordements ; captures brutes et capture de console.
7. Charge 10k/100k : mesurer p50/p95, erreurs réseau/SQLite `busy`, mémoire, tri/filtrage et pagination, verrou mono-instance.
8. Windows sur site : service redémarrage, échec disque/connexion, TLS Tailscale si retenu, sauvegarde hors hôte, restauration cohérente SQLite+documents, RPO/RTO mesurés.
9. Recalculer AMDEC résiduelle **avec mesures** et signatures Achats, Qualité, Direction, Finance avant d'émettre un GO.

**Important :** ce plan n'est pas un résultat de tests. Tous les scénarios ci-dessus non exécutés sont encore ouverts.
