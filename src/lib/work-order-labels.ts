/** Fonctions pures OF / impression : aucune dépendance serveur, identifiants de pièces stables. */
export const OF_LABELS_PER_PAGE = 8 as const

export type WorkOrderStatus = "draft" | "approved" | "in_progress" | "completed" | "cancelled"
export const WORK_ORDER_NEXT: Record<WorkOrderStatus, WorkOrderStatus | null> = {
  draft: "approved", approved: "in_progress", in_progress: "completed", completed: null, cancelled: null,
}

export function paginateWorkOrderPieces<T extends {code:string}>(pieces:readonly T[]):T[][] {
  if (pieces.length > 1000) throw new Error("Nombre maximal de pièces dépassé")
  if(new Set(pieces.map(p=>p.code)).size!==pieces.length)throw new Error("Pièces dupliquées dans l'OF")
  const pages:T[][]=[]
  for (let offset=0;offset<pieces.length;offset+=OF_LABELS_PER_PAGE)
    pages.push(pieces.slice(offset,offset+OF_LABELS_PER_PAGE))
  return pages
}

export function hasTechnicalDrawing(family:string,gabaritCode:string|null|undefined):boolean {
  // AUCUN dessin sur les matelas ; uniquement les gabarits réels des salons/banquettes.
  return family.toUpperCase()!=="MATELAS" && Boolean(gabaritCode&&gabaritCode!=="STD")
}

export function canGenerateOF(status:string,fulfillmentStatus:string,pieceCount:number,isStockTrade:boolean):boolean {
  // Les OF identifient toutes les lignes ; le mode d'exécution est choisi après.
  return ["new","production","ready"].includes(status) && fulfillmentStatus==="open" && (pieceCount>0 || isStockTrade)
}
