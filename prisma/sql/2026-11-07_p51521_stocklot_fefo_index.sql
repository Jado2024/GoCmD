-- P5.15.21 (FEFO-001) — migration ADDITIVE, idempotente (IF NOT EXISTS).
-- Index couvrant les parcours FEFO corrigés de /api/sales (disponibilité,
-- réservation, livraison) : filtre materialId + status, tri expiresAt.
-- Sans cet index, chaque consommation de lot relit les lots de toute la
-- matière ; avec lui, le parcours trié reste borné sur les documents de
-- volumétrie élevée (100 → 100 000 documents mesurés sur la campagne P5.15.20).
CREATE INDEX IF NOT EXISTS "StockLot_material_status_expires_idx"
  ON "StockLot"("materialId","status","expiresAt");
