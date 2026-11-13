-- R11 PERF-02 -- à exécuter via scripts/upgrade_order_list_index_r11.py
-- après sauvegarde externe; n'altère ni données métier ni anciens documents.
CREATE INDEX IF NOT EXISTS "Order_createdAt_id_idx"
  ON "Order" ("createdAt" DESC, "id" DESC);
