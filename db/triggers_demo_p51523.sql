-- GoCmd synthetic schema; DO NOT apply to a production database
CREATE TRIGGER "FinishedStockLot_guard_reserved_qty" BEFORE UPDATE OF "qty","status" ON "FinishedStockLot"
WHEN NEW."qty" < COALESCE((SELECT SUM("qty") FROM "FinishedStockReservation" WHERE "lotId"=OLD."id"),0)
 OR (NEW."status"<>'available' AND EXISTS(SELECT 1 FROM "FinishedStockReservation" WHERE "lotId"=OLD."id"))
BEGIN SELECT RAISE(ABORT,'FINISHED_STOCK_RESERVED'); END;

CREATE TRIGGER "FinishedStockReservation_capacity_insert" BEFORE INSERT ON "FinishedStockReservation"
WHEN (SELECT "status" FROM "FinishedStockLot" WHERE "id"=NEW."lotId")<>'available'
 OR (SELECT "qty" FROM "FinishedStockLot" WHERE "id"=NEW."lotId") <
  NEW."qty" + COALESCE((SELECT SUM("qty") FROM "FinishedStockReservation" WHERE "lotId"=NEW."lotId"),0)
BEGIN SELECT RAISE(ABORT,'FINISHED_STOCK_RESERVED'); END;

CREATE TRIGGER "FinishedStockReservation_capacity_update" BEFORE UPDATE OF "qty","lotId" ON "FinishedStockReservation"
WHEN (SELECT "status" FROM "FinishedStockLot" WHERE "id"=NEW."lotId")<>'available'
 OR (SELECT "qty" FROM "FinishedStockLot" WHERE "id"=NEW."lotId") <
  NEW."qty" + COALESCE((SELECT SUM("qty") FROM "FinishedStockReservation" WHERE "lotId"=NEW."lotId" AND "id"<>OLD."id"),0)
BEGIN SELECT RAISE(ABORT,'FINISHED_STOCK_RESERVED'); END;

CREATE TRIGGER "FinishedStockReservation_guard_insert" BEFORE INSERT ON "FinishedStockReservation"
WHEN (SELECT ol."productId" FROM "OrderLine" ol WHERE ol."id"=NEW."orderLineId")
  <> (SELECT fl."productId" FROM "FinishedStockLot" fl WHERE fl."id"=NEW."lotId")
BEGIN SELECT RAISE(ABORT,'FINISHED_RESERVATION_PRODUCT_MISMATCH'); END;

CREATE TRIGGER "FinishedStockReservation_guard_update" BEFORE UPDATE OF "orderLineId","lotId" ON "FinishedStockReservation"
WHEN (SELECT ol."productId" FROM "OrderLine" ol WHERE ol."id"=NEW."orderLineId")
  <> (SELECT fl."productId" FROM "FinishedStockLot" fl WHERE fl."id"=NEW."lotId")
BEGIN SELECT RAISE(ABORT,'FINISHED_RESERVATION_PRODUCT_MISMATCH'); END;

CREATE TRIGGER "WorkOrder_guard_parent_insert"
 BEFORE INSERT ON "WorkOrder"
 WHEN (SELECT "orderId" FROM "OrderLine" WHERE "id"=NEW."orderLineId") IS NULL
   OR (SELECT "orderId" FROM "OrderLine" WHERE "id"=NEW."orderLineId")<>NEW."orderId"
 BEGIN SELECT RAISE(ABORT,'OF_ORDER_LINE_MISMATCH'); END;

CREATE TRIGGER "WorkOrder_guard_parent_update"
 BEFORE UPDATE OF "orderId","orderLineId" ON "WorkOrder"
 WHEN (SELECT "orderId" FROM "OrderLine" WHERE "id"=NEW."orderLineId") IS NULL
   OR (SELECT "orderId" FROM "OrderLine" WHERE "id"=NEW."orderLineId")<>NEW."orderId"
 BEGIN SELECT RAISE(ABORT,'OF_ORDER_LINE_MISMATCH'); END;

CREATE TRIGGER go_v16_product_insert BEFORE INSERT ON Product BEGIN
          SELECT CASE WHEN NEW.family NOT IN ('MATELAS','BANQUETTE','SALON','GAUFRETTE','PLAQUE_MOUSSE','OUATE','NEGOCE')
            THEN RAISE(ABORT,'Famille inconnue') END;
          SELECT CASE WHEN (NEW.family='NEGOCE' AND (NEW.materialId IS NULL OR NEW.unitsPerSale<=0)) OR (NEW.family!='NEGOCE' AND NEW.materialId IS NOT NULL)
            THEN RAISE(ABORT,'Négoce : matière source et conversion requises') END;
          SELECT CASE WHEN NEW.length<=0 OR NEW.width<=0 OR NEW.height<=0 OR NEW.unitPrice<0
            THEN RAISE(ABORT,'Dimensions ou tarif invalides') END;
          SELECT CASE WHEN ((NEW.family IN ('MATELAS','PLAQUE_MOUSSE') AND NEW.unit!='u') OR
                            (NEW.family IN ('BANQUETTE','SALON','GAUFRETTE') AND NEW.unit!='ml') OR
                            (NEW.family='OUATE' AND NEW.unit!='kg'))
            THEN RAISE(ABORT,'Unité incompatible avec la famille') END;
          SELECT CASE WHEN NEW.family IN ('MATELAS','BANQUETTE') AND
            (NEW.coreType IS NULL OR NEW.coreType NOT IN ('SANS_RESSORTS','BONNELL','ENSACHES') OR
             NEW.foamComposition IS NULL OR NEW.foamComposition NOT IN ('PURE','MELANGE','AGGLO') OR
             NEW.foamNature IS NOT NULL)
            THEN RAISE(ABORT,'Noyau/composition non autorisés') END;
          SELECT CASE WHEN NEW.family='MATELAS' AND
            (NEW.mattressFinish IS NULL OR NEW.mattressFinish NOT IN ('SANS','TOPPER','ALESE') OR NEW.upholstery IS NOT NULL)
            THEN RAISE(ABORT,'Configuration matelas invalide') END;
          SELECT CASE WHEN NEW.family='BANQUETTE' AND
            (NEW.upholstery IS NULL OR NEW.upholstery NOT IN ('NUE','TISSU') OR NEW.mattressFinish IS NOT NULL)
            THEN RAISE(ABORT,'Habillage banquette invalide') END;
          SELECT CASE WHEN NEW.family IN ('MATELAS','BANQUETTE') AND NEW.foamComposition IN ('PURE','AGGLO') AND
            (NEW.foamDensity IS NULL OR NEW.foamDensity<=0 OR NEW.foamDensity>500 OR NEW.foamLayers IS NOT NULL)
            THEN RAISE(ABORT,'Densité mousse hors limites') END;
          SELECT CASE WHEN NEW.family IN ('MATELAS','BANQUETTE') AND NEW.foamComposition='MELANGE' AND
            (NEW.foamDensity IS NOT NULL OR NEW.foamLayers IS NULL OR json_valid(NEW.foamLayers)!=1 OR
             json_array_length(NEW.foamLayers)<2)
            THEN RAISE(ABORT,'Mélange : couches obligatoires') END;
          -- Défense SQL contre JSON de mélange plausible en surface mais physiquement impossible.
          SELECT CASE WHEN NEW.family IN ('MATELAS','BANQUETTE') AND NEW.foamComposition='MELANGE'
            AND json_valid(NEW.foamLayers)=1 AND (
               EXISTS(SELECT 1 FROM json_each(NEW.foamLayers) layer
                 WHERE json_type(layer.value,'$.nature')!='text'
                    OR json_extract(layer.value,'$.nature') NOT IN ('PURE','AGGLO')
                    OR COALESCE(json_type(layer.value,'$.densityKgM3'),'null') NOT IN ('real','integer')
                    OR CAST(json_extract(layer.value,'$.densityKgM3') AS REAL)<=0
                    OR CAST(json_extract(layer.value,'$.densityKgM3') AS REAL)>500
                    OR COALESCE(json_type(layer.value,'$.thicknessCm'),'null') NOT IN ('real','integer')
                    OR CAST(json_extract(layer.value,'$.thicknessCm') AS REAL)<=0)
               OR NOT EXISTS(SELECT 1 FROM json_each(NEW.foamLayers) WHERE json_extract(value,'$.nature')='PURE')
               OR NOT EXISTS(SELECT 1 FROM json_each(NEW.foamLayers) WHERE json_extract(value,'$.nature')='AGGLO')
               OR (SELECT SUM(CAST(json_extract(value,'$.thicknessCm') AS REAL)) FROM json_each(NEW.foamLayers)) > NEW.height+0.001)
            THEN RAISE(ABORT,'Couches mélange invalides ou épaisseur supérieure au produit') END;
          SELECT CASE WHEN NEW.family='PLAQUE_MOUSSE' AND
            (NEW.foamNature IS NULL OR NEW.foamNature NOT IN ('PURE','AGGLO') OR
             NEW.foamDensity IS NULL OR NEW.foamDensity<=0 OR NEW.foamDensity>500 OR
             NEW.foamGrade IS NULL OR length(trim(NEW.foamGrade))<2 OR
             NEW.coreType IS NOT NULL OR NEW.foamComposition IS NOT NULL OR NEW.mattressFinish IS NOT NULL OR
             NEW.upholstery IS NOT NULL OR NEW.foamLayers IS NOT NULL)
            THEN RAISE(ABORT,'Plaque mousse : nature/type/densité invalides') END;
          SELECT CASE WHEN NEW.family IN ('SALON','GAUFRETTE','OUATE') AND
            (NEW.coreType IS NOT NULL OR NEW.foamComposition IS NOT NULL OR NEW.mattressFinish IS NOT NULL OR
             NEW.upholstery IS NOT NULL OR NEW.foamNature IS NOT NULL OR NEW.foamDensity IS NOT NULL OR NEW.foamLayers IS NOT NULL)
            THEN RAISE(ABORT,'Champs techniques hors périmètre') END;
        END;

CREATE TRIGGER go_v16_product_update BEFORE UPDATE ON Product BEGIN
          SELECT CASE WHEN NEW.family NOT IN ('MATELAS','BANQUETTE','SALON','GAUFRETTE','PLAQUE_MOUSSE','OUATE','NEGOCE')
            THEN RAISE(ABORT,'Famille inconnue') END;
          SELECT CASE WHEN (NEW.family='NEGOCE' AND (NEW.materialId IS NULL OR NEW.unitsPerSale<=0)) OR (NEW.family!='NEGOCE' AND NEW.materialId IS NOT NULL)
            THEN RAISE(ABORT,'Négoce : matière source et conversion requises') END;
          SELECT CASE WHEN NEW.length<=0 OR NEW.width<=0 OR NEW.height<=0 OR NEW.unitPrice<0
            THEN RAISE(ABORT,'Dimensions ou tarif invalides') END;
          SELECT CASE WHEN ((NEW.family IN ('MATELAS','PLAQUE_MOUSSE') AND NEW.unit!='u') OR
                            (NEW.family IN ('BANQUETTE','SALON','GAUFRETTE') AND NEW.unit!='ml') OR
                            (NEW.family='OUATE' AND NEW.unit!='kg'))
            THEN RAISE(ABORT,'Unité incompatible avec la famille') END;
          SELECT CASE WHEN NEW.family IN ('MATELAS','BANQUETTE') AND
            (NEW.coreType IS NULL OR NEW.coreType NOT IN ('SANS_RESSORTS','BONNELL','ENSACHES') OR
             NEW.foamComposition IS NULL OR NEW.foamComposition NOT IN ('PURE','MELANGE','AGGLO') OR
             NEW.foamNature IS NOT NULL)
            THEN RAISE(ABORT,'Noyau/composition non autorisés') END;
          SELECT CASE WHEN NEW.family='MATELAS' AND
            (NEW.mattressFinish IS NULL OR NEW.mattressFinish NOT IN ('SANS','TOPPER','ALESE') OR NEW.upholstery IS NOT NULL)
            THEN RAISE(ABORT,'Configuration matelas invalide') END;
          SELECT CASE WHEN NEW.family='BANQUETTE' AND
            (NEW.upholstery IS NULL OR NEW.upholstery NOT IN ('NUE','TISSU') OR NEW.mattressFinish IS NOT NULL)
            THEN RAISE(ABORT,'Habillage banquette invalide') END;
          SELECT CASE WHEN NEW.family IN ('MATELAS','BANQUETTE') AND NEW.foamComposition IN ('PURE','AGGLO') AND
            (NEW.foamDensity IS NULL OR NEW.foamDensity<=0 OR NEW.foamDensity>500 OR NEW.foamLayers IS NOT NULL)
            THEN RAISE(ABORT,'Densité mousse hors limites') END;
          SELECT CASE WHEN NEW.family IN ('MATELAS','BANQUETTE') AND NEW.foamComposition='MELANGE' AND
            (NEW.foamDensity IS NOT NULL OR NEW.foamLayers IS NULL OR json_valid(NEW.foamLayers)!=1 OR
             json_array_length(NEW.foamLayers)<2)
            THEN RAISE(ABORT,'Mélange : couches obligatoires') END;
          -- Défense SQL contre JSON de mélange plausible en surface mais physiquement impossible.
          SELECT CASE WHEN NEW.family IN ('MATELAS','BANQUETTE') AND NEW.foamComposition='MELANGE'
            AND json_valid(NEW.foamLayers)=1 AND (
               EXISTS(SELECT 1 FROM json_each(NEW.foamLayers) layer
                 WHERE json_type(layer.value,'$.nature')!='text'
                    OR json_extract(layer.value,'$.nature') NOT IN ('PURE','AGGLO')
                    OR COALESCE(json_type(layer.value,'$.densityKgM3'),'null') NOT IN ('real','integer')
                    OR CAST(json_extract(layer.value,'$.densityKgM3') AS REAL)<=0
                    OR CAST(json_extract(layer.value,'$.densityKgM3') AS REAL)>500
                    OR COALESCE(json_type(layer.value,'$.thicknessCm'),'null') NOT IN ('real','integer')
                    OR CAST(json_extract(layer.value,'$.thicknessCm') AS REAL)<=0)
               OR NOT EXISTS(SELECT 1 FROM json_each(NEW.foamLayers) WHERE json_extract(value,'$.nature')='PURE')
               OR NOT EXISTS(SELECT 1 FROM json_each(NEW.foamLayers) WHERE json_extract(value,'$.nature')='AGGLO')
               OR (SELECT SUM(CAST(json_extract(value,'$.thicknessCm') AS REAL)) FROM json_each(NEW.foamLayers)) > NEW.height+0.001)
            THEN RAISE(ABORT,'Couches mélange invalides ou épaisseur supérieure au produit') END;
          SELECT CASE WHEN NEW.family='PLAQUE_MOUSSE' AND
            (NEW.foamNature IS NULL OR NEW.foamNature NOT IN ('PURE','AGGLO') OR
             NEW.foamDensity IS NULL OR NEW.foamDensity<=0 OR NEW.foamDensity>500 OR
             NEW.foamGrade IS NULL OR length(trim(NEW.foamGrade))<2 OR
             NEW.coreType IS NOT NULL OR NEW.foamComposition IS NOT NULL OR NEW.mattressFinish IS NOT NULL OR
             NEW.upholstery IS NOT NULL OR NEW.foamLayers IS NOT NULL)
            THEN RAISE(ABORT,'Plaque mousse : nature/type/densité invalides') END;
          SELECT CASE WHEN NEW.family IN ('SALON','GAUFRETTE','OUATE') AND
            (NEW.coreType IS NOT NULL OR NEW.foamComposition IS NOT NULL OR NEW.mattressFinish IS NOT NULL OR
             NEW.upholstery IS NOT NULL OR NEW.foamNature IS NOT NULL OR NEW.foamDensity IS NOT NULL OR NEW.foamLayers IS NOT NULL)
            THEN RAISE(ABORT,'Champs techniques hors périmètre') END;
        END;

CREATE TRIGGER go_v1893_foam_format_insert BEFORE INSERT ON Material BEGIN
                SELECT CASE WHEN NEW.foamFormat NOT IN ('BLOC','PLAQUE','ROULEAU')
                    THEN RAISE(ABORT,'Format mousse inconnu') END;
                SELECT CASE WHEN NEW.foamNature='AGGLO' AND NEW.foamFormat='ROULEAU'
                    THEN RAISE(ABORT,'Mousse agglomeree jamais en rouleau') END;
                SELECT CASE WHEN NEW.category!='Mousse' AND NEW.foamFormat IS NOT NULL
                    THEN RAISE(ABORT,'Format mousse interdit hors categorie Mousse') END;
            END;

CREATE TRIGGER go_v1893_foam_format_update BEFORE UPDATE ON Material BEGIN
                SELECT CASE WHEN NEW.foamFormat NOT IN ('BLOC','PLAQUE','ROULEAU')
                    THEN RAISE(ABORT,'Format mousse inconnu') END;
                SELECT CASE WHEN NEW.foamNature='AGGLO' AND NEW.foamFormat='ROULEAU'
                    THEN RAISE(ABORT,'Mousse agglomeree jamais en rouleau') END;
                SELECT CASE WHEN NEW.category!='Mousse' AND NEW.foamFormat IS NOT NULL
                    THEN RAISE(ABORT,'Format mousse interdit hors categorie Mousse') END;
            END;

CREATE TRIGGER "gocmd_p5154_lot_reserved_guard"
 BEFORE UPDATE OF "qty","status" ON "StockLot"
 BEGIN
   SELECT CASE WHEN NEW."qty"+0.0000001 <
        (SELECT COALESCE(SUM(r."qty"),0) FROM "SalesStockReservation" r WHERE r."stockLotId"=OLD.id)
     OR (NEW."status"!='available' AND
        EXISTS(SELECT 1 FROM "SalesStockReservation" r WHERE r."stockLotId"=OLD.id))
    THEN RAISE(ABORT,'STOCK_RESERVED') END;
 END;

CREATE TRIGGER "gocmd_p5154_reservation_insert"
 AFTER INSERT ON "SalesStockReservation"
 BEGIN
   SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM "StockLot" l
    JOIN "OrderLine" ol ON ol.id=NEW."orderLineId"
    JOIN "Product" p ON p.id=ol."productId"
    WHERE l.id=NEW."stockLotId" AND l."materialId"=p."materialId"
      AND l."status"='available' AND
      (l."expiresAt" IS NULL
       OR (typeof(l."expiresAt") IN ('integer','real')
           AND l."expiresAt" > CAST(strftime('%s','now') AS INTEGER)*1000)
       OR (typeof(l."expiresAt")='text'
           AND datetime(l."expiresAt") IS NOT NULL
           AND datetime(l."expiresAt") > datetime('now')))
      AND l."qty"+0.0000001 >=
       (SELECT COALESCE(SUM(r."qty"),0) FROM "SalesStockReservation" r WHERE r."stockLotId"=l.id)
   ) THEN RAISE(ABORT,'RESERVATION_EXCEEDS_LOT') END;
 END;

CREATE TRIGGER "gocmd_p5154_reservation_update"
 AFTER UPDATE OF "qty","stockLotId","orderLineId" ON "SalesStockReservation"
 BEGIN
   SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM "StockLot" l
    JOIN "OrderLine" ol ON ol.id=NEW."orderLineId"
    JOIN "Product" p ON p.id=ol."productId"
    WHERE l.id=NEW."stockLotId" AND l."materialId"=p."materialId"
      AND l."status"='available' AND
      (l."expiresAt" IS NULL
       OR (typeof(l."expiresAt") IN ('integer','real')
           AND l."expiresAt" > CAST(strftime('%s','now') AS INTEGER)*1000)
       OR (typeof(l."expiresAt")='text'
           AND datetime(l."expiresAt") IS NOT NULL
           AND datetime(l."expiresAt") > datetime('now')))
      AND l."qty"+0.0000001 >=
       (SELECT COALESCE(SUM(r."qty"),0) FROM "SalesStockReservation" r WHERE r."stockLotId"=l.id)
   ) THEN RAISE(ABORT,'RESERVATION_EXCEEDS_LOT') END;
 END;

-- Immutable invoice amounts after issue/approval; changes via payments / credit notes.
CREATE TRIGGER "gocmd_invoice_lock_delete_salesinvoiceline"
          BEFORE DELETE ON "SalesInvoiceLine"
          WHEN EXISTS(SELECT 1 FROM "SalesInvoice" parent WHERE parent.id=OLD.invoiceId AND 1)
          BEGIN SELECT RAISE(ABORT, 'GOCMD_INVOICE_LINE_IMMUTABLE'); END;

CREATE TRIGGER "gocmd_invoice_lock_delete_supplierinvoiceline"
          BEFORE DELETE ON "SupplierInvoiceLine"
          WHEN EXISTS(SELECT 1 FROM "SupplierInvoice" parent WHERE parent.id=OLD.invoiceId AND parent.status IN ('matched','blocked','approved','paid','rejected'))
          BEGIN SELECT RAISE(ABORT, 'GOCMD_INVOICE_LINE_IMMUTABLE'); END;

CREATE TRIGGER "gocmd_invoice_lock_salesinvoice"
          BEFORE UPDATE ON "SalesInvoice"
          WHEN (1) AND (OLD."ref" IS NOT NEW."ref" OR OLD."orderId" IS NOT NEW."orderId" OR OLD."clientId" IS NOT NEW."clientId" OR OLD."currency" IS NOT NEW."currency" OR OLD."taxRateBps" IS NOT NEW."taxRateBps" OR OLD."subtotalCents" IS NOT NEW."subtotalCents" OR OLD."taxCents" IS NOT NEW."taxCents" OR OLD."totalCents" IS NOT NEW."totalCents" OR OLD."createdBy" IS NOT NEW."createdBy" OR OLD."issuedAt" IS NOT NEW."issuedAt" OR OLD."clientNameSnapshot" IS NOT NEW."clientNameSnapshot")
          BEGIN SELECT RAISE(ABORT, 'GOCMD_INVOICE_IMMUTABLE'); END;

CREATE TRIGGER "gocmd_invoice_lock_salesinvoiceline"
          BEFORE UPDATE ON "SalesInvoiceLine"
          WHEN EXISTS(SELECT 1 FROM "SalesInvoice" parent WHERE parent.id=OLD.invoiceId AND 1)
               AND (OLD."invoiceId" IS NOT NEW."invoiceId" OR OLD."deliveryLineId" IS NOT NEW."deliveryLineId" OR OLD."qty" IS NOT NEW."qty" OR OLD."unit" IS NOT NEW."unit" OR OLD."unitPriceCents" IS NOT NEW."unitPriceCents" OR OLD."amountCents" IS NOT NEW."amountCents" OR OLD."productNameSnapshot" IS NOT NEW."productNameSnapshot" OR OLD."productSkuSnapshot" IS NOT NEW."productSkuSnapshot")
          BEGIN SELECT RAISE(ABORT, 'GOCMD_INVOICE_LINE_IMMUTABLE'); END;

CREATE TRIGGER "gocmd_invoice_lock_supplierinvoice"
          BEFORE UPDATE ON "SupplierInvoice"
          WHEN (OLD.status IN ('matched','blocked','approved','paid','rejected')) AND (OLD."supplierId" IS NOT NEW."supplierId" OR OLD."invoiceNumber" IS NOT NEW."invoiceNumber" OR OLD."invoiceDate" IS NOT NEW."invoiceDate" OR OLD."currency" IS NOT NEW."currency" OR OLD."totalAmount" IS NOT NEW."totalAmount" OR OLD."freightAmount" IS NOT NEW."freightAmount" OR OLD."createdBy" IS NOT NEW."createdBy" OR OLD."replacesInvoiceId" IS NOT NEW."replacesInvoiceId")
          BEGIN SELECT RAISE(ABORT, 'GOCMD_INVOICE_IMMUTABLE'); END;

CREATE TRIGGER "gocmd_invoice_lock_supplierinvoiceline"
          BEFORE UPDATE ON "SupplierInvoiceLine"
          WHEN EXISTS(SELECT 1 FROM "SupplierInvoice" parent WHERE parent.id=OLD.invoiceId AND parent.status IN ('matched','blocked','approved','paid','rejected'))
               AND (OLD."invoiceId" IS NOT NEW."invoiceId" OR OLD."orderLineId" IS NOT NEW."orderLineId" OR OLD."receiptLineId" IS NOT NEW."receiptLineId" OR OLD."qty" IS NOT NEW."qty" OR OLD."unitPrice" IS NOT NEW."unitPrice" OR OLD."taxRate" IS NOT NEW."taxRate")
          BEGIN SELECT RAISE(ABORT, 'GOCMD_INVOICE_LINE_IMMUTABLE'); END;
