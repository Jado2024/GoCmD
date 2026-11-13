-- P5.15.21 (SEP-001) — migration ADDITIVE, rejouable sans perte.
-- Garde quatre-yeux sur la validation des commandes clients : colonne
-- « createdBy » sur la table « Order ». Nullable : aucune commande existante
-- n'est modifiée et les commandes historiques (NULL) ne déclenchent jamais
-- la garde d'auto-validation. Appliquer sur une SAUVEGARDE vérifiée (cf.
-- PROCEDURE_INSTALLATION_CORRECTIF.md du correctif).
-- Compatible SQLite >= 3.35 (ADD COLUMN classique, sans contrainte non nulle).
ALTER TABLE "Order" ADD COLUMN "createdBy" TEXT;
