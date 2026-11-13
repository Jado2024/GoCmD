export const consultationStatusLabels: Record<string, string> = {
  prepared: "À consulter",
  in_progress: "Offres reçues",
  pending_validation: "Offre orale à valider",
  pending_decision: "Décision responsable",
  awarded: "Attribuée",
  closed: "Clôturée",
}

export type ConsultationSummary = {
  id: number
  ref: string
  requestRefs: string[]
  materials: string[]
  supplierCount: number
  offerCount: number
  deadline: string | null
  createdAt: string
  status: string
  risk: 'rupture' | 'low_stock' | 'due_soon' | 'normal'
}

export type ConsultationPage = {
  items: ConsultationSummary[]
  pagination: { page: number; pageSize: number; total: number; hasMore: boolean }
}
