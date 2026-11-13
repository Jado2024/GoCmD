> **Mise à jour du 08/11/2026** : les six sujets de ce tableau ont reçu une décision de principe dans `ARBITRAGES_VALIDES_20261108.md`. Le tableau qui suit est un état historique antérieur à ces décisions ; il ne doit plus être utilisé comme liste courante des arbitrages. Les autres défauts restent ouverts.

# Décisions métier SODEPI encore en attente — GoCmd P5.15.21 RC

**État au 8 novembre 2026 : aucune des décisions ci-dessous n’est approuvée.**
Cette liste est un support de validation, et non une attestation de risque accepté.
Elle ne remplace pas la matrice des 24 défauts résiduels de l’audit original.

| Risque | Criticité résiduelle | Service proposé | Arbitrage attendu | Décision / date / signataire |
|---|---:|---|---|---|
| Lot expiré utilisé | 18 | Qualité | DEF-A-04 documenté: imposer FEFO sortie manuelle = décision métier (validation SODEPI requise) | **En attente** |
| Erreur de facturation (écart prix BC) | 9 | Finance | DEF-A-03 documenté: facture matched sans issue de rejet (amélioration recommandée) | **En attente** |
| TVA incohérente (défaut API 0 vs UI 20) | 12 | Finance | DEF-V-03 documenté: paramètre TVA central = décision comptable SODEPI requise | **En attente** |
| Réservation sans expiration | 18 | Ventes | DEF-V-04 documenté: TTL réservations = évolution fonctionnelle (validation SODEPI requise) | **En attente** |
| Avoirs clients purement monétaires | 9 | Finance | DEF-V-02 documenté: modélisation avoir ligne-à-ligne = évolution fonctionnelle | **En attente** |
| Solde client agrégé absent | 9 | Finance | DEF-V-01 documenté: endpoint état de compte = évolution fonctionnelle | **En attente** |

## Procédure de validation

1. Faire revoir le scénario de défaillance, les garde-fous existants et la criticité par le responsable métier.
2. Pour chaque risque, choisir une correction, une mesure compensatoire ou une acceptation formelle ; consigner échéance, identité du décideur et date.
3. Faire confirmer les implications métier, finance et qualité par les personnes habilitées chez SODEPI.
4. Mettre à jour l’AMDEC et rejouer les contrôles appropriés avant de demander une homologation.

**Aucune décision ni signature n’a été fabriquée.**
