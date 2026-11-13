-- Schéma complémentaire P5.15.29-P5 de la base de démonstration.
-- Relevé directement du schéma officiel fourni ; aucune donnée transactionnelle.
-- À appliquer UNIQUEMENT sur une base fictive régénérée hors ligne.

-- table: ProductionMaterialCostApproval
CREATE TABLE "ProductionMaterialCostApproval"(
   "id" INTEGER PRIMARY KEY AUTOINCREMENT,
   "stockOrderId" INTEGER NOT NULL UNIQUE REFERENCES "ProductionStockOrder"("id") ON DELETE RESTRICT,
   "unitCost" DECIMAL NOT NULL CHECK(CAST("unitCost" AS REAL)>0),
   "currency" TEXT NOT NULL DEFAULT 'MAD' CHECK("currency"='MAD'),
   "approvedBy" TEXT NOT NULL,
   "approvedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
   "reason" TEXT NOT NULL CHECK(length("reason")>=10));

-- table: ProductionMaterialReceipt
CREATE TABLE "ProductionMaterialReceipt"(
   "id" INTEGER PRIMARY KEY AUTOINCREMENT,
   "stockOrderId" INTEGER NOT NULL REFERENCES "ProductionStockOrder"("id") ON DELETE RESTRICT,
   "stockLotId" INTEGER NOT NULL UNIQUE REFERENCES "StockLot"("id") ON DELETE RESTRICT,
   "qty" REAL NOT NULL CHECK("qty">0),"status" TEXT NOT NULL DEFAULT 'quarantine' CHECK("status" IN ('quarantine','released','rejected')),
   "receivedBy" TEXT NOT NULL,"receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
   "decidedBy" TEXT,"decidedAt" DATETIME,"reason" TEXT);

-- table: ProductionReworkApproval
CREATE TABLE "ProductionReworkApproval"(
   "id" INTEGER PRIMARY KEY AUTOINCREMENT,
   "ref" TEXT NOT NULL UNIQUE,
   "sourceKind" TEXT NOT NULL CHECK("sourceKind" IN ('material_receipt','finished_lot')),
   "sourceId" INTEGER NOT NULL,
   "productionRef" TEXT NOT NULL,
   "qty" REAL NOT NULL CHECK("qty">0),
   "usedQty" REAL NOT NULL DEFAULT 0 CHECK("usedQty">=0 AND "usedQty"<="qty"+0.000001),
   "unit" TEXT NOT NULL,
   "approvedBy" TEXT NOT NULL,
   "approvedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
   "reason" TEXT NOT NULL CHECK(length("reason")>=10),
   UNIQUE("sourceKind","sourceId"));

-- table: ProductionStockOrder
CREATE TABLE "ProductionStockOrder" (
   "id" INTEGER PRIMARY KEY AUTOINCREMENT,"ref" TEXT NOT NULL UNIQUE,
   "requestId" INTEGER NOT NULL UNIQUE REFERENCES "ProductionReplenishmentRequest"("id") ON DELETE RESTRICT,
   "status" TEXT NOT NULL DEFAULT 'approved' CHECK("status" IN ('approved','planned','in_progress','completed','closed','cancelled')),
   "createdBy" TEXT NOT NULL,"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
   "plannedStartAt" DATETIME,"dueAt" DATETIME,"plannedBy" TEXT,
   "startedBy" TEXT,"startedAt" DATETIME,"completedBy" TEXT,"completedAt" DATETIME,
   "closedBy" TEXT,"closedAt" DATETIME,"statusReason" TEXT);

-- index: AuditEvent_entity_entityId_id_idx
CREATE INDEX "AuditEvent_entity_entityId_id_idx" ON "AuditEvent"(entity, entityId, id);

-- index: FinishedStockLot_status_id_idx
CREATE INDEX "FinishedStockLot_status_id_idx" ON "FinishedStockLot"("status","id");

-- index: FinishedStockMovement_type_lotId_idx
CREATE INDEX "FinishedStockMovement_type_lotId_idx" ON "FinishedStockMovement"("type","lotId");

-- index: GoodsReceiptLine_goodsReceiptId_idx
CREATE INDEX "GoodsReceiptLine_goodsReceiptId_idx" ON "GoodsReceiptLine"(goodsReceiptId);

-- index: Movement_stockLotId_idx
CREATE INDEX "Movement_stockLotId_idx" ON "Movement"(stockLotId);

-- index: OrderLine_orderId_idx
CREATE INDEX "OrderLine_orderId_idx" ON "OrderLine"(orderId);

-- index: OrderLine_productId_idx
CREATE INDEX "OrderLine_productId_idx" ON "OrderLine"(productId);

-- index: Product_family_coreType_foamComposition_idx
CREATE INDEX "Product_family_coreType_foamComposition_idx" ON "Product"(family, coreType, foamComposition);

-- index: Product_family_foamNature_foamDensity_idx
CREATE INDEX "Product_family_foamNature_foamDensity_idx" ON "Product"(family, foamNature, foamDensity);

-- index: ProductionMaterialReceipt_status_id_idx
CREATE INDEX "ProductionMaterialReceipt_status_id_idx" ON "ProductionMaterialReceipt"("status","id");

-- index: ProductionMaterialReceipt_stockOrderId_status_idx
CREATE INDEX "ProductionMaterialReceipt_stockOrderId_status_idx" ON "ProductionMaterialReceipt"("stockOrderId","status");

-- index: ProductionReplenishmentRequest_status_id_idx
CREATE INDEX "ProductionReplenishmentRequest_status_id_idx" ON "ProductionReplenishmentRequest"("status","id");

-- index: ProductionStockOrder_requestId_status_idx
CREATE INDEX "ProductionStockOrder_requestId_status_idx" ON "ProductionStockOrder"("requestId","status");

-- index: ProductionStockOrder_status_createdAt_idx
CREATE INDEX "ProductionStockOrder_status_createdAt_idx" ON "ProductionStockOrder"("status","createdAt");

-- index: PurchaseReceiptLine_requestLineId_idx
CREATE INDEX "PurchaseReceiptLine_requestLineId_idx" ON "PurchaseReceiptLine"(requestLineId);

-- index: PurchaseRequestLine_requestId_idx
CREATE INDEX "PurchaseRequestLine_requestId_idx" ON "PurchaseRequestLine"(requestId);

-- index: PurchaseRequest_createdAt_id_idx
CREATE INDEX "PurchaseRequest_createdAt_id_idx" ON "PurchaseRequest"(createdAt, id);

-- index: PurchaseRequest_status_createdAt_id_idx
CREATE INDEX "PurchaseRequest_status_createdAt_id_idx" ON "PurchaseRequest"(status, createdAt, id);

-- index: QualityInspection_materialId_idx
CREATE INDEX "QualityInspection_materialId_idx" ON "QualityInspection"(materialId);

-- index: QualityInspection_stockLotId_idx
CREATE INDEX "QualityInspection_stockLotId_idx" ON "QualityInspection"(stockLotId);

-- index: SalesDeliveryLine_deliveryId_idx
CREATE INDEX "SalesDeliveryLine_deliveryId_idx" ON "SalesDeliveryLine"(deliveryId);

-- index: SalesInvoiceLine_invoiceId_idx
CREATE INDEX "SalesInvoiceLine_invoiceId_idx" ON "SalesInvoiceLine"(invoiceId);

-- index: SalesInvoice_orderId_idx
CREATE INDEX "SalesInvoice_orderId_idx" ON "SalesInvoice"(orderId);

-- index: StockCount_countedAt_id_idx
CREATE INDEX "StockCount_countedAt_id_idx" ON "StockCount"(countedAt, id);

-- index: StockCount_locationId_idx
CREATE INDEX "StockCount_locationId_idx" ON "StockCount"(locationId);

-- index: StockCount_lotId_idx
CREATE INDEX "StockCount_lotId_idx" ON "StockCount"(lotId);

-- index: StockCount_status_countedAt_idx
CREATE INDEX "StockCount_status_countedAt_idx" ON "StockCount"(status, countedAt);

-- index: StockLot_materialId_status_idx
CREATE INDEX "StockLot_materialId_status_idx" ON "StockLot"(materialId, status);

-- index: StockLot_receiptLineId_idx
CREATE INDEX "StockLot_receiptLineId_idx" ON "StockLot"(receiptLineId);

-- index: StockPlacement_locationId_idx
CREATE INDEX "StockPlacement_locationId_idx" ON "StockPlacement"(locationId);

-- index: SupplierAwardContractAllocation_agreementId_idx
CREATE INDEX "SupplierAwardContractAllocation_agreementId_idx" ON "SupplierAwardContractAllocation"(agreementId);

-- index: SupplierConsultation_createdAt_id_idx
CREATE INDEX "SupplierConsultation_createdAt_id_idx" ON "SupplierConsultation"(createdAt, id);

-- index: SupplierCreditNote_supplierId_idx
CREATE INDEX "SupplierCreditNote_supplierId_idx" ON "SupplierCreditNote"(supplierId);

-- index: SupplierDeliverySchedule_orderId_targetDate_idx
CREATE INDEX "SupplierDeliverySchedule_orderId_targetDate_idx" ON "SupplierDeliverySchedule"(orderId, targetDate);

-- index: SupplierDispute_supplierId_status_idx
CREATE INDEX "SupplierDispute_supplierId_status_idx" ON "SupplierDispute"(supplierId, status);

-- index: SupplierInvoiceLine_invoiceId_idx
CREATE INDEX "SupplierInvoiceLine_invoiceId_idx" ON "SupplierInvoiceLine"(invoiceId);

-- index: SupplierOrderLine_orderId_idx
CREATE INDEX "SupplierOrderLine_orderId_idx" ON "SupplierOrderLine"(orderId);

-- index: SupplierQualification_supplierId_reviewedAt_idx
CREATE INDEX "SupplierQualification_supplierId_reviewedAt_idx" ON "SupplierQualification"(supplierId, reviewedAt);

-- index: SupplierQuoteOffer_supplierId_idx
CREATE INDEX "SupplierQuoteOffer_supplierId_idx" ON "SupplierQuoteOffer"(supplierId);

-- index: SupplierRFQ_createdAt_id_idx
CREATE INDEX "SupplierRFQ_createdAt_id_idx" ON "SupplierRFQ"(createdAt, id);

-- index: SupplierRFQ_materialId_idx
CREATE INDEX "SupplierRFQ_materialId_idx" ON "SupplierRFQ"(materialId);

-- index: SupplierRFQ_status_deadline_idx
CREATE INDEX "SupplierRFQ_status_deadline_idx" ON "SupplierRFQ"(status, deadline);

-- index: SupplierReturn_stockLotId_idx
CREATE INDEX "SupplierReturn_stockLotId_idx" ON "SupplierReturn"(stockLotId);

-- index: SupplierReturn_supplierId_idx
CREATE INDEX "SupplierReturn_supplierId_idx" ON "SupplierReturn"(supplierId);

-- trigger: gocmd_finished_lot_provenance_immutable
CREATE TRIGGER "gocmd_finished_lot_provenance_immutable"
    BEFORE UPDATE OF "sourceRef","workOrderId","productId" ON "FinishedStockLot"
    BEGIN SELECT RAISE(ABORT,'GOCMD_FINISHED_LOT_PROVENANCE_IMMUTABLE'); END;

-- trigger: gocmd_finished_receipt_immutable_delete
CREATE TRIGGER "gocmd_finished_receipt_immutable_delete"
    BEFORE DELETE ON "FinishedStockMovement" WHEN OLD."type"='received_quarantine'
    BEGIN SELECT RAISE(ABORT,'GOCMD_FINISHED_RECEIPT_IMMUTABLE'); END;

-- trigger: gocmd_finished_receipt_immutable_update
CREATE TRIGGER "gocmd_finished_receipt_immutable_update"
    BEFORE UPDATE ON "FinishedStockMovement" WHEN OLD."type"='received_quarantine'
    BEGIN SELECT RAISE(ABORT,'GOCMD_FINISHED_RECEIPT_IMMUTABLE'); END;

-- trigger: gocmd_mts_cost_immutable_delete
CREATE TRIGGER "gocmd_mts_cost_immutable_delete"
   BEFORE DELETE ON "ProductionMaterialCostApproval"
   BEGIN SELECT RAISE(ABORT,'GOCMD_MTS_COST_IMMUTABLE'); END;

-- trigger: gocmd_mts_cost_immutable_update
CREATE TRIGGER "gocmd_mts_cost_immutable_update"
   BEFORE UPDATE ON "ProductionMaterialCostApproval"
   BEGIN SELECT RAISE(ABORT,'GOCMD_MTS_COST_IMMUTABLE'); END;

-- trigger: gocmd_mts_of_no_delete
CREATE TRIGGER "gocmd_mts_of_no_delete"
  BEFORE DELETE ON "ProductionStockOrder"
  BEGIN SELECT RAISE(ABORT,'GOCMD_MTS_OF_NO_DELETE'); END;

-- trigger: gocmd_mts_receipt_immutable
CREATE TRIGGER "gocmd_mts_receipt_immutable"
  BEFORE UPDATE OF "stockOrderId","stockLotId","qty","receivedBy","receivedAt" ON "ProductionMaterialReceipt"
  BEGIN SELECT RAISE(ABORT,'GOCMD_MTS_RECEIPT_IMMUTABLE'); END;

-- trigger: gocmd_mts_receipt_no_delete
CREATE TRIGGER "gocmd_mts_receipt_no_delete"
  BEFORE DELETE ON "ProductionMaterialReceipt"
  BEGIN SELECT RAISE(ABORT,'GOCMD_MTS_RECEIPT_NO_DELETE'); END;

-- trigger: gocmd_rework_approval_immutable
CREATE TRIGGER "gocmd_rework_approval_immutable"
   BEFORE UPDATE OF "ref","sourceKind","sourceId","productionRef","qty","unit","approvedBy","approvedAt","reason" ON "ProductionReworkApproval"
   BEGIN SELECT RAISE(ABORT,'GOCMD_REWORK_APPROVAL_IMMUTABLE'); END;

-- trigger: gocmd_rework_approval_no_delete
CREATE TRIGGER "gocmd_rework_approval_no_delete"
   BEFORE DELETE ON "ProductionReworkApproval"
   BEGIN SELECT RAISE(ABORT,'GOCMD_REWORK_APPROVAL_IMMUTABLE'); END;


-- P6 (2026-11-11), chantier 2 §3.3 : modèle explicite d'ancienneté des réservations.
-- Contrat R5 : colonne nullable SQLite + déclencheurs garantissant à l'INSERT
-- engagedAt = createdAt, puis sa non-mutabilité. Le NOT NULL avec DEFAULT
-- CURRENT_TIMESTAMP créait une date plus récente que createdAt pour les
-- réservations saisies avec un horodatage explicite (anomalie P6).
-- engagedAt : début d'engagement, fixé à la création, jamais rajeuni par une
-- modification (expiration/alertes calculées sur cette date, pas sur updatedAt).
ALTER TABLE "SalesStockReservation" ADD COLUMN "engagedAt" DATETIME;
CREATE INDEX IF NOT EXISTS "SalesStockReservation_engagedAt_idx" ON "SalesStockReservation"("engagedAt");
CREATE TRIGGER IF NOT EXISTS "gocmd_p6_engagement_default_insert"
AFTER INSERT ON "SalesStockReservation"
WHEN NEW."engagedAt" IS NULL
BEGIN
  UPDATE "SalesStockReservation" SET "engagedAt"=COALESCE(NEW."createdAt",CURRENT_TIMESTAMP)
  WHERE "id"=NEW."id";
END;
CREATE TRIGGER IF NOT EXISTS "gocmd_p6_engagement_immutable_update"
BEFORE UPDATE OF "engagedAt" ON "SalesStockReservation"
WHEN OLD."engagedAt" IS NOT NULL AND NEW."engagedAt" IS NOT OLD."engagedAt"
BEGIN SELECT RAISE(ABORT,'GOCMD_ENGAGEMENT_DATE_IMMUTABLE'); END;
-- Dernière modification des réservations de stock fini (NULL jusqu'à la première écriture).
ALTER TABLE "FinishedStockReservation" ADD COLUMN "updatedAt" DATETIME;
