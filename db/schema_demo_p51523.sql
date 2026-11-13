-- GoCmd synthetic schema; DO NOT apply to a production database
CREATE TABLE AuditEvent (id INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT NOT NULL,action TEXT NOT NULL,entity TEXT NOT NULL,entityId TEXT NOT NULL,details TEXT,createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE "Client" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "phone" TEXT
);

CREATE TABLE "CustomerReturn"(
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
 "ref" TEXT NOT NULL UNIQUE,
 "deliveryLineId" INTEGER NOT NULL,
 "qty" REAL NOT NULL CHECK("qty">0),
 "unit" TEXT NOT NULL,
 "pieceIdsJson" TEXT NOT NULL DEFAULT '[]',
 "reason" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'requested' CHECK("status" IN ('requested','quarantine','accepted','rejected')),
 "requestKey" TEXT UNIQUE,
 "createdBy" TEXT NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "receivedBy" TEXT,
 "receivedAt" DATETIME,
 "qualityBy" TEXT,
 "qualityAt" DATETIME,
 "qualityReason" TEXT,
 "finishedStockLotId" INTEGER UNIQUE,
 FOREIGN KEY("finishedStockLotId") REFERENCES "FinishedStockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("deliveryLineId") REFERENCES "SalesDeliveryLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "FinishedStockAllocation" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "deliveryLineId" INTEGER NOT NULL,
  "lotId" INTEGER NOT NULL,
  "qty" INTEGER NOT NULL CHECK ("qty" > 0),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("deliveryLineId") REFERENCES "SalesDeliveryLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("lotId") REFERENCES "FinishedStockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "FinishedStockLot" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "productId" INTEGER NOT NULL,
  "lotCode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'quarantine' CHECK ("status" IN ('quarantine','available','rejected','exhausted')),
  "qty" INTEGER NOT NULL DEFAULT 0 CHECK ("qty" >= 0),
  "sourceRef" TEXT NOT NULL,
  "receivedBy" TEXT NOT NULL,
  "qualityBy" TEXT,
  "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" DATETIME,
  "workOrderId" INTEGER REFERENCES "WorkOrder"("id") ON DELETE RESTRICT,
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "FinishedStockMovement" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "ref" TEXT NOT NULL UNIQUE,
  "lotId" INTEGER NOT NULL,
  "type" TEXT NOT NULL CHECK ("type" IN ('received_quarantine','available','rejected','out')),
  "qty" INTEGER NOT NULL,
  "document" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("lotId") REFERENCES "FinishedStockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "FinishedStockReservation" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "orderLineId" INTEGER NOT NULL REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "lotId" INTEGER NOT NULL REFERENCES "FinishedStockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "qty" INTEGER NOT NULL CHECK("qty">0),
  "createdBy" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE GoCmdAccessAudit (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 actor TEXT NOT NULL,
 action TEXT NOT NULL,
 target TEXT NOT NULL,
 details_json TEXT NOT NULL
);

CREATE TABLE GoCmdSession (
 token_hash TEXT PRIMARY KEY,
 username TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(username) REFERENCES GoCmdUser(username) ON DELETE CASCADE
 );

CREATE TABLE GoCmdUser (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 salt TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 roles_json TEXT NOT NULL,
 permissions_json TEXT NOT NULL DEFAULT '{}',
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 is_root INTEGER NOT NULL DEFAULT 0 CHECK(is_root IN (0,1)),
 must_change_password INTEGER NOT NULL DEFAULT 1 CHECK(must_change_password IN (0,1)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE GoodsReceipt (
 id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT NOT NULL UNIQUE,
 supplierOrderId INTEGER NOT NULL, deliveryRef TEXT NOT NULL, operator TEXT NOT NULL,
 note TEXT, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "deliveryNoteId" INTEGER REFERENCES SupplierDeliveryNote(id),
 FOREIGN KEY(supplierOrderId) REFERENCES SupplierOrder(id),
 UNIQUE(supplierOrderId,deliveryRef)
);

CREATE TABLE GoodsReceiptLine(id INTEGER PRIMARY KEY AUTOINCREMENT,goodsReceiptId INTEGER NOT NULL REFERENCES GoodsReceipt(id) ON DELETE CASCADE,supplierOrderLineId INTEGER NOT NULL REFERENCES SupplierOrderLine(id),acceptedQty REAL NOT NULL,rejectedQty REAL NOT NULL DEFAULT 0,lot TEXT,movementId INTEGER UNIQUE REFERENCES Movement(id), returnedQty REAL NOT NULL DEFAULT 0);

CREATE TABLE "Material" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ref" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPrice" REAL NOT NULL,
    "stockQty" REAL NOT NULL DEFAULT 0,
    "minStock" REAL NOT NULL DEFAULT 0,
    "location" TEXT,
    "supplier" TEXT
, "averageCost" DECIMAL, "foamNature" TEXT, "foamGrade" TEXT, "foamDensity" REAL, foamFormat TEXT, "description" TEXT, "foamColor" TEXT, "foamFirmness" TEXT, "foamResilience" REAL, "foamSupplierGrade" TEXT, "foamLengthCm" REAL, "foamWidthCm" REAL, "foamHeightCm" REAL, "foamThicknessCm" REAL, "foamIdentityKey" TEXT, "isPurchasable" BOOLEAN NOT NULL DEFAULT 1, "isManufactured" BOOLEAN NOT NULL DEFAULT 0, "isSellable" BOOLEAN NOT NULL DEFAULT 0, "isInternalUse" BOOLEAN NOT NULL DEFAULT 1, "salesUnit" TEXT, "unitsPerSale" REAL NOT NULL DEFAULT 1, "salesUnitPrice" REAL NOT NULL DEFAULT 0,
"targetStock" REAL,"pendingSalesUnitPrice" REAL,"salesPriceProposedBy" TEXT,
"salesPriceProposalReason" TEXT,"salesPriceProposedAt" DATETIME,
"salesPriceProposalRevision" INTEGER NOT NULL DEFAULT 0);

CREATE TABLE "Movement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ref" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "materialId" INTEGER,
    "qty" REAL NOT NULL,
    "unit" TEXT,
    "reason" TEXT NOT NULL,
    "document" TEXT,
    "operator" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "signedQty" REAL, "stockLotId" INTEGER REFERENCES StockLot(id), "isArchived" INTEGER NOT NULL DEFAULT 0, "archivedAt" DATETIME, "archiveReason" TEXT, "isOpeningBalance" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Movement_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "Order" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ref" TEXT NOT NULL,
    "clientId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "priority" TEXT NOT NULL DEFAULT 'normale',
    "dueDate" DATETIME,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "customerOrderNo" TEXT, "reviewComment" TEXT, "reviewedBy" TEXT, "reviewedAt" DATETIME, quoteId INTEGER REFERENCES SalesQuote(id), "fulfillmentStatus" TEXT NOT NULL DEFAULT 'open', "fulfillmentReason" TEXT, "fulfillmentActor" TEXT, "fulfillmentChangedAt" DATETIME, "createdBy" TEXT, "createRequestKey" TEXT, "createRequestDigest" TEXT, "customerOrderNoNormalized" TEXT,
    CONSTRAINT "Order_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "OrderLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "qty" REAL NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'u',
    "unitPrice" REAL NOT NULL, "modelRef" TEXT, "configRef" TEXT, "stockUnit" TEXT, "stockUnitsPerSale" REAL NOT NULL DEFAULT 1, "productNameSnapshot" TEXT, "productSkuSnapshot" TEXT, "catalogUnitPriceSnapshot" REAL, "priceApprovalStatus" TEXT NOT NULL DEFAULT 'not_required', "priceApprovedBy" TEXT, "priceApprovedAt" DATETIME, "priceApprovalReason" TEXT, "technicalInstructions" TEXT, "customDimensionsJson" TEXT, "technicalReviewRequired" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "OrderPiece" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "code" TEXT NOT NULL UNIQUE,
  "orderLineId" INTEGER NOT NULL,
  "salonNo" INTEGER NOT NULL DEFAULT 1,
  "elementNo" INTEGER NOT NULL DEFAULT 1,
  "partRef" TEXT,
  "linearMeters" REAL,
  "gabaritCode" TEXT,
  "billingMode" TEXT NOT NULL DEFAULT 'manual',
  "sequence" INTEGER NOT NULL,
  "label" TEXT NOT NULL,
  "shape" TEXT NOT NULL DEFAULT 'rectangle',
  "lengthCm" REAL NOT NULL,
  "widthCm" REAL NOT NULL,
  "heightCm" REAL NOT NULL,
  "dimensionsExtra" TEXT,
  "note" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Product" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "variant" TEXT NOT NULL DEFAULT 'STD',
    "length" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'u',
    "unitPrice" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
, legacySku TEXT, legacyName TEXT, legacyModel TEXT, subCategory TEXT, "status" TEXT NOT NULL DEFAULT 'active', "similarProductId" INTEGER, "similarProductSku" TEXT, "specialNotes" TEXT, "coreType" TEXT, "foamComposition" TEXT, "mattressFinish" TEXT, "upholstery" TEXT, "foamNature" TEXT, "foamGrade" TEXT, "foamDensity" REAL, "foamLayers" TEXT, "taxonomyVersion" INTEGER NOT NULL DEFAULT 1, "commercialAbbreviation" TEXT, "commercialBrand" TEXT, "actualManufacturer" TEXT, "descriptionOverride" TEXT, "specialPriceStatus" TEXT NOT NULL DEFAULT 'not_required', "specialApprovedUnitPrice" REAL, "specialPriceProposedBy" TEXT, "specialPriceApprovedBy" TEXT, "specialPriceApprovedAt" DATETIME, "specialPriceDecisionReason" TEXT, "specialPriceRevision" INTEGER NOT NULL DEFAULT 0, "materialId" INTEGER REFERENCES Material(id), "unitsPerSale" REAL NOT NULL DEFAULT 1,
"minStock" REAL NOT NULL DEFAULT 0,"targetStock" REAL,
"revisionOfId" INTEGER, "revisionNumber" INTEGER NOT NULL DEFAULT 1,
"revisionRequestedBy" TEXT, "revisionApprovedBy" TEXT,
"pendingCatalogUnitPrice" REAL,"catalogPriceProposedBy" TEXT,
"catalogPriceProposalReason" TEXT,"catalogPriceProposedAt" DATETIME,
"catalogPriceProposalRevision" INTEGER NOT NULL DEFAULT 0);

CREATE TABLE "PurchaseReceipt" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "requestId" INTEGER NOT NULL,
    "deliveryRef" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PurchaseReceipt_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PurchaseRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
  );

CREATE TABLE "PurchaseReceiptLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "receiptId" INTEGER NOT NULL,
    "requestLineId" INTEGER NOT NULL,
    "acceptedQty" REAL NOT NULL,
    "rejectedQty" REAL NOT NULL DEFAULT 0,
    "lot" TEXT,
    "note" TEXT,
    CONSTRAINT "PurchaseReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "PurchaseReceipt" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PurchaseReceiptLine_requestLineId_fkey" FOREIGN KEY ("requestLineId") REFERENCES "PurchaseRequestLine" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
  );

CREATE TABLE "PurchaseRequest" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ref" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "supplier" TEXT,
    "expectedDate" DATETIME,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
, "closedReason" TEXT, "closedBy" TEXT, "closedAt" DATETIME, "createdBy" TEXT, "approvedBy" TEXT, "approvedAt" DATETIME);

CREATE TABLE "PurchaseRequestLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "requestId" INTEGER NOT NULL,
    "materialId" INTEGER NOT NULL,
    "qty" REAL NOT NULL,
    "unitPrice" REAL, "receivedQty" REAL NOT NULL DEFAULT 0, "approvedQty" REAL NOT NULL DEFAULT 0, "approvalDecision" TEXT NOT NULL DEFAULT 'pending', "approvalReason" TEXT, "decisionBy" TEXT, "decisionAt" DATETIME,
    CONSTRAINT "PurchaseRequestLine_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PurchaseRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PurchaseRequestLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE QualityInspection (id INTEGER PRIMARY KEY AUTOINCREMENT,materialId INTEGER NOT NULL REFERENCES Material(id),stockLotId INTEGER NOT NULL REFERENCES StockLot(id),decision TEXT NOT NULL,qty REAL NOT NULL,reason TEXT NOT NULL,actor TEXT NOT NULL,createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE SalesCreditNote(id INTEGER PRIMARY KEY AUTOINCREMENT,invoiceId INTEGER NOT NULL REFERENCES SalesInvoice(id),ref TEXT NOT NULL UNIQUE,amountCents INTEGER NOT NULL CHECK(amountCents>0),reason TEXT NOT NULL,actor TEXT NOT NULL,createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, status TEXT NOT NULL DEFAULT 'draft', decisionActor TEXT, decisionReason TEXT, decidedAt DATETIME);

CREATE TABLE "SalesCreditNoteLine" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
 "creditNoteId" INTEGER NOT NULL,
 "invoiceLineId" INTEGER NOT NULL,
 "qty" REAL NOT NULL CHECK ("qty">0),
 "amountCents" INTEGER NOT NULL CHECK ("amountCents">=0),
 "taxCents" INTEGER NOT NULL CHECK ("taxCents">=0),
 CONSTRAINT "SalesCreditNoteLine_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "SalesCreditNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "SalesCreditNoteLine_invoiceLineId_fkey" FOREIGN KEY ("invoiceLineId") REFERENCES "SalesInvoiceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE SalesDelivery(id INTEGER PRIMARY KEY AUTOINCREMENT,ref TEXT NOT NULL UNIQUE,orderId INTEGER NOT NULL REFERENCES "Order"(id),status TEXT NOT NULL DEFAULT 'posted',note TEXT,createdBy TEXT NOT NULL,deliveredAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "requestKey" TEXT, "requestHash" TEXT, "clientNameSnapshot" TEXT);

CREATE TABLE SalesDeliveryLine(id INTEGER PRIMARY KEY AUTOINCREMENT,deliveryId INTEGER NOT NULL REFERENCES SalesDelivery(id),orderLineId INTEGER NOT NULL REFERENCES OrderLine(id),qty REAL NOT NULL CHECK(qty>0),unit TEXT NOT NULL,pieceIds TEXT NOT NULL, "productNameSnapshot" TEXT, "productSkuSnapshot" TEXT);

CREATE TABLE SalesDocCounter(id TEXT NOT NULL PRIMARY KEY,value INTEGER NOT NULL DEFAULT 0);

CREATE TABLE SalesInvoice(id INTEGER PRIMARY KEY AUTOINCREMENT,ref TEXT NOT NULL UNIQUE,orderId INTEGER NOT NULL REFERENCES "Order"(id),clientId INTEGER NOT NULL REFERENCES Client(id),status TEXT NOT NULL DEFAULT 'issued',currency TEXT NOT NULL DEFAULT 'MAD',taxRateBps INTEGER NOT NULL DEFAULT 0,subtotalCents INTEGER NOT NULL,taxCents INTEGER NOT NULL,totalCents INTEGER NOT NULL,createdBy TEXT NOT NULL,issuedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, version INTEGER NOT NULL DEFAULT 0, "clientNameSnapshot" TEXT);

CREATE TABLE SalesInvoiceLine(id INTEGER PRIMARY KEY AUTOINCREMENT,invoiceId INTEGER NOT NULL REFERENCES SalesInvoice(id),deliveryLineId INTEGER NOT NULL UNIQUE REFERENCES SalesDeliveryLine(id),qty REAL NOT NULL,unit TEXT NOT NULL,unitPriceCents INTEGER NOT NULL,amountCents INTEGER NOT NULL, "productNameSnapshot" TEXT, "productSkuSnapshot" TEXT);

CREATE TABLE SalesPayment(id INTEGER PRIMARY KEY AUTOINCREMENT,invoiceId INTEGER NOT NULL REFERENCES SalesInvoice(id),ref TEXT NOT NULL UNIQUE,amountCents INTEGER NOT NULL CHECK(amountCents>0),method TEXT NOT NULL,actor TEXT NOT NULL,paidAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE SalesQuote(id INTEGER PRIMARY KEY AUTOINCREMENT,ref TEXT NOT NULL UNIQUE,clientId INTEGER NOT NULL REFERENCES Client(id),status TEXT NOT NULL DEFAULT 'draft',payload TEXT NOT NULL,subtotalCents INTEGER NOT NULL CHECK(subtotalCents>=0),expiresAt DATETIME,createdBy TEXT NOT NULL,acceptedBy TEXT,acceptanceRef TEXT,createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "clientNameSnapshot" TEXT, "productsSnapshotJson" TEXT, "priceReviewRequired" INTEGER NOT NULL DEFAULT 0, "priceApprovedBy" TEXT, "priceApprovedAt" DATETIME, "priceApprovalReason" TEXT, "priceApprovalsJson" TEXT, "priceReviewPlanJson" TEXT);

CREATE TABLE "SalesStockAllocation" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
 "deliveryLineId" INTEGER NOT NULL REFERENCES "SalesDeliveryLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "stockLotId" INTEGER NOT NULL REFERENCES "StockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "movementId" INTEGER NOT NULL UNIQUE REFERENCES "Movement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "qty" REAL NOT NULL,
 "unit" TEXT NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (qty > 0)
);

CREATE TABLE "SalesStockReservation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderLineId" INTEGER NOT NULL REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "stockLotId" INTEGER NOT NULL REFERENCES "StockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "qty" REAL NOT NULL CHECK("qty" > 0),
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE("orderLineId","stockLotId")
   );

CREATE TABLE StockCount (id INTEGER PRIMARY KEY AUTOINCREMENT,lotId INTEGER NOT NULL REFERENCES StockLot(id),locationId INTEGER NOT NULL REFERENCES StorageLocation(id),expectedQty REAL NOT NULL,observedQty REAL NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',countedBy TEXT NOT NULL,approvedBy TEXT,countedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,approvedAt DATETIME);

CREATE TABLE "StockLot" (id INTEGER PRIMARY KEY AUTOINCREMENT,
  materialId INTEGER NOT NULL REFERENCES Material(id),lotCode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',qty REAL NOT NULL DEFAULT 0,
  supplierId INTEGER,receiptLineId INTEGER REFERENCES GoodsReceiptLine(id),
  provenanceKey TEXT NOT NULL DEFAULT 'LEGACY',
  receivedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,expiresAt DATETIME,
  UNIQUE(materialId,lotCode,status,provenanceKey));

CREATE TABLE StockPlacement (id INTEGER PRIMARY KEY AUTOINCREMENT,stockLotId INTEGER NOT NULL REFERENCES StockLot(id),locationId INTEGER NOT NULL REFERENCES StorageLocation(id),qty REAL NOT NULL CHECK(qty>=0),UNIQUE(stockLotId,locationId));

CREATE TABLE StorageLocation (id INTEGER PRIMARY KEY AUTOINCREMENT,warehouseId INTEGER NOT NULL REFERENCES WarehouseSite(id),code TEXT NOT NULL,name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',UNIQUE(warehouseId,code));

CREATE TABLE Supplier (
 id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL UNIQUE,
 phone TEXT, email TEXT, address TEXT, active BOOLEAN NOT NULL DEFAULT 1,
 createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
, "city" TEXT, "country" TEXT, "ice" TEXT, "taxId" TEXT, "tradeRegister" TEXT, "paymentTerms" TEXT);

CREATE TABLE "SupplierAwardAllocation" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,"planId" INTEGER NOT NULL,"offerId" INTEGER NOT NULL,"qty" REAL NOT NULL,"unitPrice" DECIMAL NOT NULL,FOREIGN KEY("planId") REFERENCES "SupplierAwardPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE,FOREIGN KEY("offerId") REFERENCES "SupplierQuoteOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE);

CREATE TABLE "SupplierAwardContractAllocation" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
 "planId" INTEGER NOT NULL,
 "agreementId" INTEGER NOT NULL,
 "qty" REAL NOT NULL CHECK(qty > 0),
 "unitPrice" DECIMAL NOT NULL CHECK(unitPrice >= 0),
 CONSTRAINT "SupplierAwardContractAllocation_plan_fkey" FOREIGN KEY ("planId") REFERENCES "SupplierAwardPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "SupplierAwardContractAllocation_agreement_fkey" FOREIGN KEY ("agreementId") REFERENCES "SupplierPriceAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "SupplierAwardPlan" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,"rfqId" INTEGER NOT NULL,"status" TEXT NOT NULL DEFAULT 'pending',"reason" TEXT NOT NULL,"proposedBy" TEXT NOT NULL,"proposedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,"decidedBy" TEXT,"decidedAt" DATETIME,"decisionNote" TEXT,FOREIGN KEY("rfqId") REFERENCES "SupplierRFQ"("id") ON DELETE RESTRICT ON UPDATE CASCADE);

CREATE TABLE "SupplierConsultation" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
 "ref" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'prepared',
 "createdBy" TEXT NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "deadline" DATETIME
);

CREATE TABLE "SupplierConsultationLine" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
 "consultationId" INTEGER NOT NULL,
 "rfqId" INTEGER NOT NULL,
 FOREIGN KEY("consultationId") REFERENCES "SupplierConsultation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("rfqId") REFERENCES "SupplierRFQ"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "SupplierConsultationRecipient" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
 "consultationId" INTEGER NOT NULL,
 "supplierId" INTEGER NOT NULL,
 FOREIGN KEY("consultationId") REFERENCES "SupplierConsultation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "SupplierConsultationRecipientLine" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
 "recipientId" INTEGER NOT NULL,
 "rfqId" INTEGER NOT NULL, "responseStatus" TEXT NOT NULL DEFAULT 'invited', "contactAt" DATETIME, "lastReminderAt" DATETIME, "reminderCount" INTEGER NOT NULL DEFAULT 0, "declineReason" TEXT,
 FOREIGN KEY("recipientId") REFERENCES "SupplierConsultationRecipient"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("rfqId") REFERENCES "SupplierRFQ"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "SupplierCreditNote" (
             id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT NOT NULL UNIQUE,
             supplierId INTEGER NOT NULL REFERENCES Supplier(id),
             invoiceId INTEGER NOT NULL REFERENCES SupplierInvoice(id),
             returnId INTEGER,amount DECIMAL NOT NULL,reason TEXT NOT NULL,
             status TEXT NOT NULL DEFAULT 'draft',actor TEXT NOT NULL,
             decisionActor TEXT,decisionReason TEXT,decidedAt DATETIME,
             createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, kind TEXT NOT NULL DEFAULT 'balance', version INTEGER NOT NULL DEFAULT 0);

CREATE TABLE SupplierDeliveryNote (id INTEGER PRIMARY KEY AUTOINCREMENT,supplierId INTEGER NOT NULL REFERENCES Supplier(id),reference TEXT NOT NULL,createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(supplierId,reference));

CREATE TABLE SupplierDeliverySchedule (id INTEGER PRIMARY KEY AUTOINCREMENT,orderId INTEGER NOT NULL REFERENCES SupplierOrder(id),targetDate DATETIME NOT NULL,plannedQty REAL,note TEXT,status TEXT NOT NULL DEFAULT 'planned',actor TEXT NOT NULL,createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE SupplierDispute (id INTEGER PRIMARY KEY AUTOINCREMENT,supplierId INTEGER NOT NULL REFERENCES Supplier(id),entityType TEXT NOT NULL,entityId INTEGER NOT NULL,category TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',resolution TEXT,openedBy TEXT NOT NULL,resolvedBy TEXT,openedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,resolvedAt DATETIME);

CREATE TABLE SupplierInvoice (id INTEGER PRIMARY KEY AUTOINCREMENT,supplierId INTEGER NOT NULL REFERENCES Supplier(id),invoiceNumber TEXT NOT NULL,invoiceDate DATETIME NOT NULL,currency TEXT NOT NULL DEFAULT 'MAD',status TEXT NOT NULL DEFAULT 'draft',discrepancy TEXT,totalAmount DECIMAL NOT NULL DEFAULT 0,createdBy TEXT NOT NULL,approvedBy TEXT,createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, freightAmount DECIMAL NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 0, rejectedBy TEXT, rejectionReason TEXT, replacesInvoiceId INTEGER REFERENCES SupplierInvoice(id),UNIQUE(supplierId,invoiceNumber));

CREATE TABLE SupplierInvoiceLine (id INTEGER PRIMARY KEY AUTOINCREMENT,invoiceId INTEGER NOT NULL REFERENCES SupplierInvoice(id) ON DELETE RESTRICT,orderLineId INTEGER NOT NULL,qty REAL NOT NULL,unitPrice DECIMAL NOT NULL,taxRate DECIMAL NOT NULL DEFAULT 0, "receiptLineId" INTEGER REFERENCES GoodsReceiptLine(id));

CREATE TABLE SupplierMaterial (
 id INTEGER PRIMARY KEY AUTOINCREMENT, supplierId INTEGER NOT NULL, materialId INTEGER NOT NULL,
 supplierSku TEXT, unitPrice REAL, leadTimeDays INTEGER, preferred BOOLEAN NOT NULL DEFAULT 0, "purchaseUnit" TEXT, "unitsPerPurchase" REAL NOT NULL DEFAULT 1,
 FOREIGN KEY(supplierId) REFERENCES Supplier(id), FOREIGN KEY(materialId) REFERENCES Material(id),
 UNIQUE(supplierId, materialId)
);

CREATE TABLE "SupplierOfferAttachment" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
 "offerId" INTEGER NOT NULL,
 "originalName" TEXT NOT NULL,
 "storedName" TEXT NOT NULL,
 "sha256" TEXT NOT NULL,
 "bytes" INTEGER NOT NULL,
 "uploadedBy" TEXT NOT NULL,
 "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "revisionNo" INTEGER NOT NULL DEFAULT 1,
 FOREIGN KEY("offerId") REFERENCES "SupplierQuoteOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE SupplierOrder (
 id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT NOT NULL UNIQUE, supplierId INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'confirmed', expectedDate DATETIME, note TEXT,
 createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, closedAt DATETIME, closedReason TEXT, "createdBy" TEXT, "approvedBy" TEXT,
 FOREIGN KEY(supplierId) REFERENCES Supplier(id)
);

CREATE TABLE SupplierOrderLine (
 id INTEGER PRIMARY KEY AUTOINCREMENT, orderId INTEGER NOT NULL, materialId INTEGER NOT NULL,
 requestLineId INTEGER, qty REAL NOT NULL, receivedQty REAL NOT NULL DEFAULT 0, unitPrice REAL NOT NULL, "purchaseQty" REAL, "purchaseUnit" TEXT, "conversionFactor" REAL NOT NULL DEFAULT 1, "priceSourceType" TEXT, "priceSourceId" INTEGER, "priceSourceRef" TEXT,
 FOREIGN KEY(orderId) REFERENCES SupplierOrder(id) ON DELETE CASCADE,
 FOREIGN KEY(materialId) REFERENCES Material(id),
 FOREIGN KEY(requestLineId) REFERENCES PurchaseRequestLine(id)
);

CREATE TABLE SupplierOrderRevision (id INTEGER PRIMARY KEY AUTOINCREMENT,orderId INTEGER NOT NULL REFERENCES SupplierOrder(id),revision INTEGER NOT NULL,previousSnapshot TEXT NOT NULL,newSnapshot TEXT NOT NULL,reason TEXT NOT NULL,actor TEXT NOT NULL,createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(orderId,revision));

CREATE TABLE SupplierPayment (id INTEGER PRIMARY KEY AUTOINCREMENT,invoiceId INTEGER NOT NULL REFERENCES SupplierInvoice(id),amount DECIMAL NOT NULL,reference TEXT NOT NULL UNIQUE,actor TEXT NOT NULL,paidAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE "SupplierPriceAgreement" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
 "supplierId" INTEGER NOT NULL,
 "materialId" INTEGER NOT NULL,
 "contractRef" TEXT NOT NULL,
 "documentRef" TEXT NOT NULL,
 "unitPrice" DECIMAL NOT NULL,
 "currency" TEXT NOT NULL DEFAULT 'MAD',
 "validFrom" DATETIME NOT NULL,
 "validUntil" DATETIME NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'pending',
 "createdBy" TEXT NOT NULL,
 "approvedBy" TEXT,
 "approvedAt" DATETIME,
 "revokedBy" TEXT,
 "revokedAt" DATETIME,
 "revokeReason" TEXT,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "priceBasis" TEXT, "priceBasisFactor" REAL, "sourceUnitPrice" DECIMAL,
 FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE SupplierQualification (id INTEGER PRIMARY KEY AUTOINCREMENT,supplierId INTEGER NOT NULL REFERENCES Supplier(id),status TEXT NOT NULL DEFAULT 'pending',score INTEGER NOT NULL DEFAULT 0,note TEXT,reviewedBy TEXT NOT NULL,reviewedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,expiresAt DATETIME);

CREATE TABLE SupplierQuoteOffer (id INTEGER PRIMARY KEY AUTOINCREMENT,rfqId INTEGER NOT NULL REFERENCES SupplierRFQ(id),supplierId INTEGER NOT NULL REFERENCES Supplier(id),unitPrice DECIMAL NOT NULL,qty REAL NOT NULL CHECK(qty>0),currency TEXT NOT NULL DEFAULT 'MAD',leadTimeDays INTEGER NOT NULL,paymentTerms TEXT,note TEXT,chosen INTEGER NOT NULL DEFAULT 0,createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "quoteRef" TEXT, "validUntil" DATETIME, "documentRef" TEXT, "responseChannel" TEXT NOT NULL DEFAULT 'written', "confirmationStatus" TEXT NOT NULL DEFAULT 'confirmed', "contactName" TEXT, "callSummary" TEXT, "respondedAt" DATETIME, "priceBasis" TEXT, "priceBasisFactor" REAL, "sourceUnitPrice" DECIMAL, "recordedBy" TEXT, "buyerValidatedBy" TEXT, "buyerValidatedAt" DATETIME, "approvedBy" TEXT, "approvedAt" DATETIME, "revisionNo" INTEGER NOT NULL DEFAULT 1,UNIQUE(rfqId,supplierId));

CREATE TABLE "SupplierQuoteRevision" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,"offerId" INTEGER NOT NULL,"version" INTEGER NOT NULL,"previousSnapshot" TEXT NOT NULL,"reason" TEXT NOT NULL,"revisedBy" TEXT NOT NULL,"revisedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY("offerId") REFERENCES "SupplierQuoteOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE);

CREATE TABLE SupplierRFQ (id INTEGER PRIMARY KEY AUTOINCREMENT,ref TEXT NOT NULL UNIQUE,materialId INTEGER NOT NULL REFERENCES Material(id),requestLineId INTEGER,qty REAL NOT NULL CHECK(qty>0),unit TEXT NOT NULL,targetDate DATETIME,deadline DATETIME,status TEXT NOT NULL DEFAULT 'open',createdBy TEXT NOT NULL,createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE SupplierRefund (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             creditNoteId INTEGER NOT NULL UNIQUE REFERENCES SupplierCreditNote(id),
             supplierId INTEGER NOT NULL REFERENCES Supplier(id),
             amount DECIMAL NOT NULL,
             status TEXT NOT NULL DEFAULT 'pending',
             method TEXT,
             reference TEXT,
             actor TEXT NOT NULL,
             refundedAt DATETIME,
             refundActor TEXT,
             createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
             CHECK (status IN ('pending','refunded')));

CREATE TABLE SupplierReturn (id INTEGER PRIMARY KEY AUTOINCREMENT,ref TEXT NOT NULL UNIQUE,supplierId INTEGER NOT NULL REFERENCES Supplier(id),stockLotId INTEGER NOT NULL REFERENCES StockLot(id),qty REAL NOT NULL,reason TEXT NOT NULL,actor TEXT NOT NULL,creditExpected INTEGER NOT NULL DEFAULT 1,createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE SupplierReturnCreditAllocation (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             returnId INTEGER NOT NULL REFERENCES SupplierReturn(id),
             creditId INTEGER NOT NULL REFERENCES SupplierCreditNote(id),
             amountCents INTEGER NOT NULL,
             createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
             CONSTRAINT SupplierReturnCreditAllocation_returnId_creditId_key UNIQUE (returnId,creditId),
             CHECK (amountCents > 0));

CREATE TABLE WarehouseSite (id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT NOT NULL UNIQUE,name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);

CREATE TABLE "WorkOrder" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "ref" TEXT NOT NULL UNIQUE,
  "orderId" INTEGER NOT NULL REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "orderLineId" INTEGER NOT NULL UNIQUE REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft','approved','in_progress','completed','cancelled')),
  "snapshotJson" TEXT NOT NULL CHECK (json_valid("snapshotJson")),
  "totalPieces" INTEGER NOT NULL CHECK ("totalPieces">0 AND "totalPieces"<=1000),
  "createdBy" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedBy" TEXT,
  "approvedAt" DATETIME,
  "startedBy" TEXT,
  "startedAt" DATETIME,
  "completedBy" TEXT,
  "completedAt" DATETIME
 , "preparationKind" TEXT);

CREATE TABLE "ProductionReplenishmentRequest" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "ref" TEXT NOT NULL UNIQUE,
  "productId" INTEGER REFERENCES "Product"("id") ON DELETE RESTRICT,
  "materialId" INTEGER REFERENCES "Material"("id") ON DELETE RESTRICT,
  "qty" REAL NOT NULL CHECK("qty">0),"unit" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'proposed',"reason" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedBy" TEXT,"decidedAt" DATETIME,"decisionReason" TEXT,
  CHECK(("productId" IS NOT NULL) != ("materialId" IS NOT NULL))
);
CREATE INDEX "FinishedStockLot_workOrderId_idx" ON "FinishedStockLot"("workOrderId");
CREATE INDEX "ProductionReplenishmentRequest_productId_status_idx" ON "ProductionReplenishmentRequest"("productId","status");
CREATE INDEX "ProductionReplenishmentRequest_materialId_status_idx" ON "ProductionReplenishmentRequest"("materialId","status");
CREATE TRIGGER IF NOT EXISTS "gocmd_protect_production_request_delete" BEFORE DELETE ON "ProductionReplenishmentRequest"
BEGIN SELECT RAISE(ABORT,'GOCMD_PRODUCTION_REQUEST_DELETE_FORBIDDEN'); END;
CREATE INDEX AuditEvent_createdAt_idx ON AuditEvent(createdAt);

CREATE INDEX AuditEvent_entity_entityId_idx ON AuditEvent(entity,entityId);

CREATE UNIQUE INDEX "Client_name_key" ON "Client"("name");

CREATE INDEX "CustomerReturn_deliveryLineId_status_idx" ON "CustomerReturn"("deliveryLineId","status");

CREATE UNIQUE INDEX "FinishedStockAllocation_deliveryLineId_lotId_key" ON "FinishedStockAllocation"("deliveryLineId","lotId");

CREATE INDEX "FinishedStockAllocation_lotId_idx" ON "FinishedStockAllocation"("lotId");

CREATE UNIQUE INDEX "FinishedStockLot_productId_lotCode_key" ON "FinishedStockLot"("productId","lotCode");

CREATE INDEX "FinishedStockLot_productId_status_idx" ON "FinishedStockLot"("productId","status");

CREATE INDEX "FinishedStockMovement_lotId_createdAt_idx" ON "FinishedStockMovement"("lotId","createdAt");

CREATE INDEX "FinishedStockReservation_lotId_idx" ON "FinishedStockReservation"("lotId");

CREATE UNIQUE INDEX "FinishedStockReservation_orderLineId_lotId_key" ON "FinishedStockReservation"("orderLineId","lotId");

CREATE INDEX GoCmdAccessAudit_at_idx ON GoCmdAccessAudit(at);

CREATE INDEX GoCmdSession_expires_idx ON GoCmdSession(expires_at);

CREATE INDEX GoodsReceipt_createdAt_idx ON GoodsReceipt(createdAt);

CREATE UNIQUE INDEX "Material_foamIdentityKey_key" ON "Material"("foamIdentityKey");

CREATE UNIQUE INDEX "Material_ref_key" ON "Material"("ref");

CREATE INDEX "Movement_createdAt_idx" ON "Movement"("createdAt");

CREATE INDEX Movement_isArchived_createdAt_idx ON Movement(isArchived,createdAt);

CREATE INDEX Movement_isOpeningBalance_idx ON Movement(isOpeningBalance);

CREATE INDEX "Movement_materialId_idx" ON "Movement"("materialId");

CREATE UNIQUE INDEX "Movement_ref_key" ON "Movement"("ref");

CREATE INDEX "OrderPiece_orderLineId_idx" ON "OrderPiece"("orderLineId");

CREATE INDEX "OrderPiece_status_idx" ON "OrderPiece"("status");

CREATE INDEX "Order_dueDate_idx" ON "Order"("dueDate");
CREATE UNIQUE INDEX "Order_createRequestKey_key" ON "Order"("createRequestKey");
CREATE UNIQUE INDEX "Order_clientId_customerOrderNoNormalized_key" ON "Order"("clientId", "customerOrderNoNormalized");
CREATE INDEX "Order_clientId_dueDate_idx" ON "Order"("clientId", "dueDate");

CREATE UNIQUE INDEX Order_quoteId_key ON "Order"(quoteId);

CREATE UNIQUE INDEX "Order_ref_key" ON "Order"("ref");

CREATE INDEX "Order_status_idx" ON "Order"("status");

CREATE INDEX Product_family_core_foam_idx ON Product(family,coreType,foamComposition);

CREATE INDEX "Product_family_model_variant_idx" ON "Product"("family", "model", "variant");

CREATE INDEX Product_family_nature_density_idx ON Product(family,foamNature,foamDensity);

CREATE INDEX Product_legacySku_idx on Product(legacySku);

CREATE UNIQUE INDEX "Product_materialId_key" ON "Product"("materialId");

CREATE INDEX "Product_name_idx" ON "Product"("name");

CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

CREATE INDEX Product_subCategory_idx on Product(subCategory);

CREATE UNIQUE INDEX "PurchaseReceiptLine_receiptId_requestLineId_key" ON "PurchaseReceiptLine"("receiptId", "requestLineId");

CREATE INDEX "PurchaseReceipt_createdAt_idx" ON "PurchaseReceipt"("createdAt");

CREATE UNIQUE INDEX "PurchaseReceipt_requestId_deliveryRef_key" ON "PurchaseReceipt"("requestId", "deliveryRef");

CREATE UNIQUE INDEX "PurchaseRequest_ref_key" ON "PurchaseRequest"("ref");

CREATE INDEX "PurchaseRequest_status_idx" ON "PurchaseRequest"("status");

CREATE UNIQUE INDEX "SalesCreditNoteLine_creditNoteId_invoiceLineId_key" ON "SalesCreditNoteLine"("creditNoteId","invoiceLineId");

CREATE INDEX "SalesCreditNoteLine_invoiceLineId_idx" ON "SalesCreditNoteLine"("invoiceLineId");

CREATE INDEX SalesCreditNote_invoiceId_idx ON SalesCreditNote(invoiceId);

CREATE INDEX SalesDeliveryLine_orderLineId_idx ON SalesDeliveryLine(orderLineId);

CREATE INDEX SalesDelivery_orderId_deliveredAt_idx ON SalesDelivery(orderId,deliveredAt);

CREATE UNIQUE INDEX "SalesDelivery_requestKey_key" ON "SalesDelivery"("requestKey");

CREATE INDEX SalesInvoice_clientId_issuedAt_idx ON SalesInvoice(clientId,issuedAt);

CREATE INDEX SalesPayment_invoiceId_idx ON SalesPayment(invoiceId);

CREATE INDEX SalesQuote_clientId_status_idx ON SalesQuote(clientId,status);

CREATE INDEX "SalesStockAllocation_deliveryLineId_idx" ON "SalesStockAllocation"("deliveryLineId");

CREATE INDEX "SalesStockAllocation_stockLotId_idx" ON "SalesStockAllocation"("stockLotId");

CREATE INDEX "SalesStockReservation_orderLineId_stockLotId_key" ON "SalesStockReservation"("orderLineId","stockLotId");

CREATE INDEX "SalesStockReservation_stockLotId_idx" ON "SalesStockReservation"("stockLotId");

CREATE INDEX "StockLot_material_status_expires_idx"
  ON "StockLot"("materialId","status","expiresAt");

CREATE INDEX StockLot_material_status_idx ON StockLot(materialId,status);

CREATE INDEX "SupplierAwardAllocation_offerId_idx" ON "SupplierAwardAllocation"("offerId");

CREATE UNIQUE INDEX "SupplierAwardAllocation_planId_offerId_key" ON "SupplierAwardAllocation"("planId","offerId");

CREATE INDEX "SupplierAwardContractAllocation_agreement_idx" ON "SupplierAwardContractAllocation"("agreementId");

CREATE UNIQUE INDEX "SupplierAwardContractAllocation_plan_agreement_key" ON "SupplierAwardContractAllocation"("planId", "agreementId");

CREATE INDEX "SupplierAwardPlan_rfqId_status_idx" ON "SupplierAwardPlan"("rfqId","status");

CREATE INDEX "SupplierConsultationLine_consultationId_idx" ON "SupplierConsultationLine"("consultationId");

CREATE UNIQUE INDEX "SupplierConsultationLine_rfqId_key" ON "SupplierConsultationLine"("rfqId");

CREATE UNIQUE INDEX "SupplierConsultationRecipientLine_recipientId_rfqId_key" ON "SupplierConsultationRecipientLine"("recipientId","rfqId");

CREATE INDEX "SupplierConsultationRecipientLine_rfqId_idx" ON "SupplierConsultationRecipientLine"("rfqId");

CREATE UNIQUE INDEX "SupplierConsultationRecipient_consultationId_supplierId_key" ON "SupplierConsultationRecipient"("consultationId","supplierId");

CREATE INDEX "SupplierConsultation_createdAt_idx" ON "SupplierConsultation"("createdAt");

CREATE UNIQUE INDEX "SupplierConsultation_ref_key" ON "SupplierConsultation"("ref");

CREATE INDEX SupplierCreditNote_invoiceId_idx ON SupplierCreditNote(invoiceId);

CREATE INDEX SupplierCreditNote_kind_status_idx ON SupplierCreditNote(kind,status);

CREATE INDEX SupplierInvoiceLine_orderLineId_idx ON SupplierInvoiceLine(orderLineId);

CREATE INDEX SupplierInvoiceLine_receiptLineId_idx ON SupplierInvoiceLine(receiptLineId);

CREATE INDEX SupplierMaterial_materialId_idx ON SupplierMaterial(materialId);

CREATE INDEX "SupplierOfferAttachment_offerId_uploadedAt_idx" ON "SupplierOfferAttachment"("offerId","uploadedAt");

CREATE UNIQUE INDEX "SupplierOfferAttachment_storedName_key" ON "SupplierOfferAttachment"("storedName");

CREATE INDEX SupplierOrderLine_materialId_idx ON SupplierOrderLine(materialId);

CREATE INDEX SupplierOrderLine_requestLineId_idx ON SupplierOrderLine(requestLineId);

CREATE INDEX SupplierOrder_supplierId_status_idx ON SupplierOrder(supplierId,status);

CREATE INDEX "SupplierPriceAgreement_material_status_validUntil_idx" ON "SupplierPriceAgreement"("materialId", "status", "validUntil");

CREATE UNIQUE INDEX "SupplierPriceAgreement_supplierId_materialId_contractRef_key" ON "SupplierPriceAgreement"("supplierId", "materialId", "contractRef");

CREATE INDEX "SupplierPriceAgreement_supplierId_materialId_status_validUntil_idx" ON "SupplierPriceAgreement"("supplierId", "materialId", "status", "validUntil");

CREATE INDEX "SupplierQuoteOffer_buyerValidatedBy_idx" ON "SupplierQuoteOffer"("buyerValidatedBy");

CREATE UNIQUE INDEX "SupplierQuoteRevision_offerId_version_key" ON "SupplierQuoteRevision"("offerId","version");

CREATE INDEX SupplierRefund_supplierId_status_idx ON SupplierRefund(supplierId,status);

CREATE INDEX SupplierReturnCreditAllocation_creditId_idx ON SupplierReturnCreditAllocation(creditId);

CREATE INDEX "WorkOrder_orderId_status_idx" ON "WorkOrder"("orderId","status");

CREATE INDEX "WorkOrder_status_createdAt_idx" ON "WorkOrder"("status","createdAt");
