/**
 * GoCmd/SODEPI — émission d'OF pour TOUTES les lignes d'une commande validée.
 * Aucune décision stock/achat/fabrication et aucun mouvement physique ici.
 * À appeler DANS la transaction de création/validation commerciale.
 */
import type { Prisma } from "@prisma/client"
import { createHash } from "node:crypto"

/**
 * V2 R5 : un article GEN-* est une configuration contractuelle, pas un SKU.
 * Une ligne générique sans fabrication/préparation n'émet PAS d'OF.
 * En cas de snapshot absent ou altéré, refuser la décision plutôt que
 * supposer qu'une ligne ne nécessite pas de préparation.
 */
export function lineRequiresWorkOrder(kind: string, snapshotJson: string | null | undefined): boolean {
  if (kind !== "GENERIC") return true // catalogue : contrat industriel historique préservé
  if (!snapshotJson) throw new Error("GENERIC_SNAPSHOT_REQUIRED")
  let snapshot: unknown
  try { snapshot = JSON.parse(snapshotJson) } catch { throw new Error("GENERIC_SNAPSHOT_INVALID") }
  if (snapshot === null || typeof snapshot !== "object" ||
      (snapshot as {kind?: unknown}).kind !== "GENERIC" ||
      typeof (snapshot as {requiresPreparation?: unknown}).requiresPreparation !== "boolean") {
    throw new Error("GENERIC_PREPARATION_UNKNOWN")
  }
  return (snapshot as {requiresPreparation: boolean}).requiresPreparation
}

/** Vérifie la cohérence du snapshot contractuel avant d'émettre un OF. */
export function verifyWorkOrderContract(line: {
  kind: string; technicalSnapshotJson: string | null; technicalSnapshotHash: string | null;
  qty: number; unit: string; unitPrice: number;
}): void {
  if (!line.technicalSnapshotJson) {
    if (line.kind === "GENERIC") throw new Error("GENERIC_SNAPSHOT_REQUIRED")
    return // document catalogue historique antérieur à V2
  }
  let frozen: unknown
  try { frozen = JSON.parse(line.technicalSnapshotJson) }
  catch { throw new Error("CONTRACT_SNAPSHOT_INVALID") }
  if (!frozen || typeof frozen !== "object") throw new Error("CONTRACT_SNAPSHOT_INVALID")
  const snapshot = frozen as Record<string, unknown>
  if (line.kind === "GENERIC" && (!line.technicalSnapshotHash || snapshot.kind !== "GENERIC"))
    throw new Error("GENERIC_SNAPSHOT_INVALID")
  if (line.technicalSnapshotHash) {
    const expected = createHash("sha256").update(JSON.stringify(frozen)).digest("hex")
    if (line.technicalSnapshotHash !== expected) throw new Error("CONTRACT_SNAPSHOT_HASH_MISMATCH")
  }
  if (snapshot.unitPrice !== line.unitPrice || snapshot.quantity !== line.qty || snapshot.unit !== line.unit)
    throw new Error("CONTRACT_SNAPSHOT_PRICE_OR_UNIT_MISMATCH")
}

export async function createMissingWorkOrders(
  tx: Prisma.TransactionClient,
  orderId: number,
  actor: string,
): Promise<number> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: {
      client: true,
      lines: {
        include: { product: true, pieces: { orderBy: { sequence: "asc" } }, workOrder: true },
        orderBy: { id: "asc" },
      },
    },
  })
  if (!order) throw new Error("ORDER_NOT_FOUND")
  if (!order.reviewedAt || !order.reviewedBy || (order.createdBy && order.reviewedBy === order.createdBy))
    throw new Error("ORDER_NOT_APPROVED")
  if (!(["new", "production", "ready"].includes(order.status)) || order.fulfillmentStatus !== "open")
    throw new Error("ORDER_NOT_ELIGIBLE")

  // Précontrôle intégral AVANT la première création. Une erreur annule
  // toute la transaction appelante (y compris la CMD ou son approbation).
  for (const line of order.lines) {
    verifyWorkOrderContract(line)
    if (line.priceApprovalStatus === "pending" || line.product.status !== "active" ||
        (line.product.specialNotes && line.product.specialPriceStatus !== "approved"))
      throw new Error("PRODUCT_NOT_APPROVED")
    if (!(line.qty > 0) || !Number.isFinite(line.qty)) throw new Error("LINE_QUANTITY_INVALID")
    if (lineRequiresWorkOrder(line.kind, line.technicalSnapshotJson) &&
        (line.pieces.length > 1000 ||
         new Set(line.pieces.map(piece => piece.code)).size !== line.pieces.length ||
         (line.product.materialId === null && line.pieces.length === 0)))
      throw new Error("PIECES_INVALID")
  }

  let created = 0
  for (const line of order.lines) {
    if (!lineRequiresWorkOrder(line.kind, line.technicalSnapshotJson)) continue // service direct / aucune préparation demandée
    if (line.workOrder) continue // idempotence : UNIQUE(orderLineId) en base
    const year = new Date().getFullYear()
    const counter = await tx.salesDocCounter.upsert({
      where: { id: `WORK_ORDER:${year}` },
      create: { id: `WORK_ORDER:${year}`, value: 1 },
      update: { value: { increment: 1 } },
    })
    const ref = `OF-${year}-${String(counter.value).padStart(5, "0")}`
    // La configuration contractuelle figée à la saisie prévaut sur la fiche actuelle.
    // Les entrées génériques sont isolées par ligne et ne possèdent aucun SKU public.
    const frozen = line.technicalSnapshotJson ? JSON.parse(line.technicalSnapshotJson) : null
    const snapshot = {
      contractualConfiguration: frozen,
      orderLineKind: line.kind,
      genericTemplate: line.genericTemplate,
      orderRef: order.ref,
      orderDate: order.createdAt.toISOString(),
      client: { name: order.client.name, city: order.client.city },
      product: {
        name: line.productNameSnapshot??line.product.name,
        sku: line.productSkuSnapshot??line.product.sku,
        family: line.product.family,
        modelRef: line.modelRef, configRef: line.configRef,
        coreType: frozen?.coreType??line.product.coreType,
        foamComposition: frozen?.foamComposition??line.product.foamComposition,
        mattressFinish: frozen?.mattressFinish??line.product.mattressFinish,
        // Audit 10/11/2026 (OF-SNAP-01, règle métier SODEPI §7) : la composition
        // et les caractéristiques techniques doivent être transmises INTÉGRALEMENT
        // aux OF. Manquaient au snapshot : garnissage banquette, couches de
        // mélange (MELANGE), nature/grade/densité mousse, et les dimensions
        // CATALOGUE lorsque la ligne ne porte pas de cotes dérogatoires —
        // un matelas « MELANGE » perdait son détail de couches sur la fiche OF.
        upholstery: frozen?.upholstery??line.product.upholstery,
        foamLayers: frozen?.foamLayers ? (typeof frozen.foamLayers==="string"?JSON.parse(frozen.foamLayers):frozen.foamLayers) : line.product.foamLayers ? JSON.parse(line.product.foamLayers) : null,
        foamNature: frozen?.foamNature??line.product.foamNature,
        foamGrade: frozen?.foamGrade??line.product.foamGrade,
        foamDensity: frozen?.foamDensity??line.product.foamDensity,
        catalogDimensions: {
          lengthCm: frozen?.dimensions?.lengthCm??line.product.length,
          widthCm: frozen?.dimensions?.widthCm??line.product.width,
          heightCm: frozen?.dimensions?.heightCm??line.product.height,
        },
        specialNotes:line.product.specialNotes,
        // GEN : les spécifications de fabrication suivent l'OF imprimé
        // et non un produit de catalogue partagé.
        technicalInstructions:line.kind==="GENERIC"
          ? [frozen?.specifications,line.technicalInstructions].filter(Boolean).join(" ; ")
          : line.technicalInstructions,
        dimensions:line.customDimensionsJson?JSON.parse(line.customDimensionsJson):null,
      },
      quantity: line.qty,
      unit: line.unit,
      stockTrade: line.product.materialId !== null,
      pieces: line.pieces.map(piece => ({
        id: piece.id, code: piece.code, salonNo: piece.salonNo,
        elementNo: piece.elementNo, partRef: piece.partRef,
        linearMeters: piece.linearMeters, gabaritCode: piece.gabaritCode,
        billingMode: piece.billingMode, sequence: piece.sequence,
        label: piece.label, shape: piece.shape, lengthCm: piece.lengthCm,
        widthCm: piece.widthCm, heightCm: piece.heightCm,
        dimensionsExtra: piece.dimensionsExtra, note: piece.note, status: piece.status,
      })),
    }
    const workOrder = await tx.workOrder.create({
      data: {
        ref, orderId: order.id, orderLineId: line.id,
        // Les références de négoce utilisent une étiquette de préparation.
        // totalPieces = nombre d'étiquettes, sans créer de fausse OrderPiece.
        snapshotJson: JSON.stringify(snapshot), totalPieces: line.pieces.length || 1,
        // Validation commerciale acquise : l'OF est immédiatement utilisable.
        // Aucune deuxième validation commerciale (les contrôles stock restent au prélèvement).
        status:"approved",approvedBy:"SYSTEM:CMD_CONFIRMED",approvedAt:new Date(),
        createdBy: order.createdBy ?? actor,
      },
    })
    await tx.auditEvent.create({
      data: {
        actor, action: "WORK_ORDER_AUTO_ACTIVATED", entity: "WorkOrder",
        entityId: String(workOrder.id),
        details: JSON.stringify({ ref, orderRef: order.ref, orderLineId: line.id,
          pieces: line.pieces.length, quantity: line.qty, unit: line.unit, automatic: true }),
      },
    })
    created++
  }
  return created
}
