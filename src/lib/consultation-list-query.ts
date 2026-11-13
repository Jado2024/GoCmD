import { Prisma } from '@prisma/client'

type Filters = {
  search: string
  category: string
  supplierId: number
  priority: string
  status: string
  contractStatus?: string
  sort: string
  from?: string
  to?: string
  id?: number
}

// SQLite contains both epoch milliseconds (Prisma) and ISO dates (older imports).
function milliseconds(column: Prisma.Sql) {
  return Prisma.sql`CASE WHEN typeof(${column}) IN ('integer','real') THEN ${column}
    ELSE (julianday(${column}) - 2440587.5) * 86400000 END`
}

export function consultationListQuery(filters: Filters, soon: number) {
  const created = milliseconds(Prisma.sql`c.createdAt`)
  const deadline = milliseconds(Prisma.sql`c.deadline`)
  const target = milliseconds(Prisma.sql`r.targetDate`)
  const lines = Prisma.sql`FROM SupplierConsultationLine l
    JOIN SupplierRFQ r ON r.id = l.rfqId
    JOIN Material m ON m.id = r.materialId
    WHERE l.consultationId = c.id`
  const exists = (condition: Prisma.Sql) => Prisma.sql`EXISTS (SELECT 1 ${lines} AND (${condition}))`
  const where: Prisma.Sql[] = []
  const supplierId = Number.isSafeInteger(filters.supplierId) && filters.supplierId > 0 ? filters.supplierId : null
  if (filters.id) where.push(Prisma.sql`c.id = ${filters.id}`)
  if (filters.search) {
    const q = filters.search
    where.push(Prisma.sql`(
      instr(lower(c.ref), lower(${q})) > 0 OR
      c.id IN (
        SELECT l.consultationId FROM SupplierConsultationLine l
        JOIN SupplierRFQ r ON r.id = l.rfqId
        JOIN Material m ON m.id = r.materialId
        LEFT JOIN PurchaseRequestLine pl ON pl.id = r.requestLineId
        LEFT JOIN PurchaseRequest pr ON pr.id = pl.requestId
        WHERE instr(lower(m.name), lower(${q})) > 0 OR instr(lower(m.ref), lower(${q})) > 0
          OR instr(lower(r.ref), lower(${q})) > 0 OR instr(lower(pr.ref), lower(${q})) > 0
      ) OR c.id IN (
        SELECT s.consultationId FROM SupplierConsultationRecipient s JOIN Supplier f ON f.id = s.supplierId
        WHERE instr(lower(f.name), lower(${q})) > 0
      ))`)
  }
  if (filters.category) where.push(exists(Prisma.sql`m.category = ${filters.category}`))
  if (supplierId) where.push(Prisma.sql`EXISTS (SELECT 1 FROM SupplierConsultationRecipient s
    WHERE s.consultationId = c.id AND s.supplierId = ${supplierId})`)
  if (filters.from) where.push(Prisma.sql`${created} >= ${Date.parse(filters.from + 'T00:00:00Z')}`)
  if (filters.to) where.push(Prisma.sql`${created} < ${Date.parse(filters.to + 'T00:00:00Z') + 86400000}`)
  // Filtres SQL sur TOUS les dossiers, pas seulement les lignes de la page.
  const now = Date.now()
  const start = milliseconds(Prisma.sql`a.validFrom`)
  const end = milliseconds(Prisma.sql`a.validUntil`)
  const qualExpiry = milliseconds(Prisma.sql`q.expiresAt`)
  const hasEligibleContract = exists(Prisma.sql`EXISTS (
   SELECT 1 FROM SupplierPriceAgreement a
   JOIN Supplier s ON s.id = a.supplierId AND s.active = 1
   JOIN SupplierMaterial sm ON sm.supplierId = a.supplierId AND sm.materialId = r.materialId
   WHERE a.materialId = r.materialId AND a.status = 'approved'
     AND a.approvedBy IS NOT NULL AND a.approvedBy <> a.createdBy
     AND length(trim(a.documentRef)) > 0
     AND ${start} <= ${now} AND ${end} >= ${now}
     AND a.currency = 'MAD' AND a.unitPrice > 0 AND sm.unitsPerPurchase > 0
     AND ((a.priceBasis IS NULL OR a.priceBasisFactor IS NULL OR a.sourceUnitPrice IS NULL)
         AND abs(sm.unitsPerPurchase - 1) < 0.000001
      OR (a.priceBasis = 'STOCK' AND a.priceBasisFactor IS NOT NULL AND a.sourceUnitPrice IS NOT NULL
         AND abs(a.priceBasisFactor - sm.unitsPerPurchase) < 0.000001
         AND abs(a.unitPrice - a.sourceUnitPrice) < 0.00011)
      OR (a.priceBasis = 'PURCHASE' AND a.priceBasisFactor IS NOT NULL AND a.sourceUnitPrice IS NOT NULL
         AND abs(a.priceBasisFactor - sm.unitsPerPurchase) < 0.000001
         AND abs(a.unitPrice - a.sourceUnitPrice / sm.unitsPerPurchase) < 0.00011))
     AND EXISTS (SELECT 1 FROM SupplierQualification q WHERE q.supplierId=a.supplierId
       AND q.status = 'approved' AND (q.expiresAt IS NULL OR ${qualExpiry} >= ${now})
       AND q.id = (SELECT q2.id FROM SupplierQualification q2 WHERE q2.supplierId=a.supplierId
         ORDER BY q2.reviewedAt DESC,q2.id DESC LIMIT 1))
  )`)
  if(filters.contractStatus === 'contract')where.push(hasEligibleContract)
  if(filters.contractStatus === 'no_contract')where.push(Prisma.sql`NOT ${hasEligibleContract}`)
  if (filters.status === 'open' || filters.status === 'awarded') where.push(exists(Prisma.sql`r.status = ${filters.status}`))
  if (filters.status === 'closed') {
    where.push(exists(Prisma.sql`r.status = 'closed'`), Prisma.sql`NOT ${exists(Prisma.sql`r.status NOT IN ('closed','awarded')`)}`)
  }
  if (filters.status === 'pending_validation') where.push(exists(Prisma.sql`r.status = 'open' AND EXISTS (
    SELECT 1 FROM SupplierQuoteOffer o WHERE o.rfqId = r.id AND o.responseChannel = 'phone'
    AND o.confirmationStatus = 'pending' AND (${supplierId} IS NULL OR o.supplierId = ${supplierId})
  )`))
  if (filters.status === 'pending_approval') where.push(exists(Prisma.sql`r.status = 'open' AND EXISTS (
    SELECT 1 FROM SupplierAwardPlan p WHERE p.rfqId = r.id AND p.status = 'pending'
  )`))
  if (filters.status === 'no_response') where.push(Prisma.sql`EXISTS (
    SELECT 1 FROM SupplierConsultationRecipient s
    JOIN SupplierConsultationRecipientLine sl ON sl.recipientId = s.id
    JOIN SupplierRFQ r ON r.id = sl.rfqId
    WHERE s.consultationId = c.id AND r.status = 'open' AND sl.responseStatus <> 'declined'
    AND (${supplierId} IS NULL OR s.supplierId = ${supplierId})
    AND NOT EXISTS (SELECT 1 FROM SupplierQuoteOffer o WHERE o.rfqId = r.id AND o.supplierId = s.supplierId)
  )`)

  const out = Prisma.sql`m.stockQty <= 0`
  const low = Prisma.sql`m.stockQty > 0 AND m.stockQty < m.minStock`
  if (filters.priority === 'rupture') where.push(exists(out))
  if (filters.priority === 'low_stock') where.push(exists(low))
  if (filters.priority === 'due_soon') where.push(Prisma.sql`(${deadline} <= ${soon} OR ${exists(Prisma.sql`${target} <= ${soon}`)})`)

  const lastDate = 8640000000000000
  const due = Prisma.sql`min(coalesce(${deadline}, ${lastDate}),
    coalesce((SELECT min(${target}) ${lines}), ${lastDate}))`
  const rank = Prisma.sql`min(
    coalesce((SELECT min(CASE WHEN ${target} <= ${soon} AND m.stockQty < r.qty THEN 0
      WHEN ${out} THEN 1 WHEN ${low} THEN 2 WHEN ${target} <= ${soon} THEN 3 ELSE 4 END) ${lines}), 4),
    CASE WHEN ${deadline} <= ${soon} THEN 3 ELSE 4 END)`
  const stockRank = Prisma.sql`coalesce((SELECT min(CASE WHEN ${out} THEN 0 WHEN ${low} THEN 1 ELSE 2 END) ${lines}), 2)`
  const sorts: Record<string, Prisma.Sql> = {
    urgency: Prisma.sql`${rank}, ${due},`,
    due_date: Prisma.sql`${due}, ${rank},`,
    stock_risk: Prisma.sql`${stockRank}, ${due},`,
    material: Prisma.sql`coalesce((SELECT min(m.name COLLATE NOCASE) ${lines}), '') COLLATE NOCASE,`,
    supplier: Prisma.sql`coalesce((SELECT min(f.name COLLATE NOCASE) FROM SupplierConsultationRecipient s
      JOIN Supplier f ON f.id = s.supplierId WHERE s.consultationId = c.id), '') COLLATE NOCASE,`,
    recent: Prisma.empty,
  }
  return {
    where: where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty,
    order: Prisma.sql`${Object.hasOwn(sorts, filters.sort) ? sorts[filters.sort] : sorts.urgency} ${created} DESC, c.id ASC`,
  }
}
