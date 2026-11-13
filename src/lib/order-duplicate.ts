/** P5 — détection de doublons commerciaux, distincte de l'idempotence technique.
 * Une similarité n'est PAS une interdiction métier : confirmation tracée requise.
 */
import { createHash } from "node:crypto"
import type { Prisma } from "@prisma/client"
import { z } from "zod"

export const DuplicateReviewSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(12).max(300),
}).strict()

export type DuplicateReview = z.infer<typeof DuplicateReviewSchema>
export type DuplicateOrderInput = {
  clientId: number
  dueDate: string
  customerOrderNo?: string | null
  lines: Array<{ productId: number; qty: number; generic?: unknown; technicalSnapshotJson?: string | null }>
}

/** NFKC + réduction des blancs + casse unifiée pour un numéro client. */
export function normalizeCustomerOrderNo(value: string | null | undefined): string | null {
  const normalized = (value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toUpperCase()
  return normalized || null
}

function lineSignature(lines: DuplicateOrderInput["lines"]): string {
  // Une configuration GEN est une identité commerciale de ligne, pas le gabarit
  // générique commun. Comparer dimensions, détails, tarif et préparation.
  const sums = new Map<string, number>()
  for (const line of lines) {
    let signature = `SKU:${line.productId}`
    if (line.generic) signature = `GEN:${JSON.stringify(line.generic)}`
    else if (line.technicalSnapshotJson) {
      try {const s=JSON.parse(line.technicalSnapshotJson)
        if(s.kind==="GENERIC") signature=`GEN:${JSON.stringify({template:s.template,description:s.description,specifications:s.specifications,
          lengthCm:s.dimensions.lengthCm,widthCm:s.dimensions.widthCm,heightCm:s.dimensions.heightCm,
          requiresPreparation:s.requiresPreparation})}`
      } catch { /* un historique mal formé ne doit jamais provoquer de faux rapprochement */ }
    }
    sums.set(signature,(sums.get(signature)??0)+line.qty)
  }
  return JSON.stringify([...sums].sort((a,b)=>a[0].localeCompare(b[0])).map(([id,qty])=>[id,Number(qty.toPrecision(14))]))
}

export function duplicateSignature(lines: DuplicateOrderInput["lines"]): string {
  return lineSignature(lines)
}

export function duplicateReviewToken(clientId: number, dueDate: string, matchedIds: number[]): string {
  return createHash("sha256")
    .update(JSON.stringify([clientId,dueDate.slice(0,10),[...matchedIds].sort((a,b)=>a-b)]))
    .digest("hex")
}

export type DuplicateMatch = {id:number;ref:string;status:string;dueDate:string|null;createdAt:string}
export type DuplicateCheck = {
  existingReference: DuplicateMatch | null
  matches: DuplicateMatch[]
  token: string | null
}

const MAX_CANDIDATES = 1500
export async function lookupOrderDuplicates(tx: Prisma.TransactionClient, input: DuplicateOrderInput): Promise<DuplicateCheck> {
  const normalizedReference = normalizeCustomerOrderNo(input.customerOrderNo)
  const existingReference = normalizedReference
    ? await tx.order.findUnique({
        where:{clientId_customerOrderNoNormalized:{clientId:input.clientId,customerOrderNoNormalized:normalizedReference}},
        select:{id:true,ref:true,status:true,dueDate:true,createdAt:true},
      })
    : null
  const date = input.dueDate.slice(0,10)
  const start = new Date(`${date}T00:00:00.000Z`)
  const end = new Date(start.getTime()+86400000)
  const rows = await tx.order.findMany({
    where:{clientId:input.clientId,dueDate:{gte:start,lt:end}},
    select:{id:true,ref:true,status:true,dueDate:true,createdAt:true,lines:{select:{productId:true,qty:true,technicalSnapshotJson:true}}},
    orderBy:{id:"desc"},take:MAX_CANDIDATES+1,
  })
  // Ne pas déclarer « aucun doublon » lorsqu'une recherche est tronquée.
  if(rows.length>MAX_CANDIDATES) throw new Error("GOCMD_DUPLICATE_SEARCH_LIMIT")
  const signature = lineSignature(input.lines)
  const matches = rows.filter(o=>lineSignature(o.lines)===signature).map(o=>({
    id:o.id,ref:o.ref,status:o.status,dueDate:o.dueDate?.toISOString()??null,createdAt:o.createdAt.toISOString(),
  }))
  return {
    existingReference:existingReference?{
      id:existingReference.id,ref:existingReference.ref,status:existingReference.status,
      dueDate:existingReference.dueDate?.toISOString()??null,createdAt:existingReference.createdAt.toISOString(),
    }:null,
    matches:matches.slice(0,12),
    // Inclure tous les identifiants dans l'empreinte, même si seuls 12 sont affichés.
    token:matches.length?duplicateReviewToken(input.clientId,input.dueDate,matches.map(x=>x.id)):null,
  }
}

export function duplicateConflict(check: DuplicateCheck): {code:string;error:string;existing?:DuplicateMatch;matches?:DuplicateMatch[];token?:string} | null {
  if (check.existingReference) return {code:"CUSTOMER_ORDER_NUMBER_EXISTS",error:"Ce numéro de commande client est déjà enregistré pour ce client.",existing:check.existingReference}
  if (check.token) return {code:"DUPLICATE_ORDER_POTENTIAL",error:"Une commande similaire existe : vérifier et justifier la nouvelle commande.",matches:check.matches,token:check.token}
  return null
}
