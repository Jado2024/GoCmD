"use client";

import { useId, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ChevronDown, ChevronUp, Minus, Plus, Search, ShoppingCart, Trash2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { SearchableCombobox } from "@/components/ui/searchable-combobox"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { commonSupplierIds, suggestedMaterials, type SuggestionFilter } from "@/lib/purchase-suggestions"
import { fmtNum, type MaterialDTO } from "@/lib/erp-types"
import { daOpenQty, type DaMaterialSummary } from "@/lib/material-da-summary"
import { buildPurchaseRequestLines, MAX_PURCHASE_LINES, MAX_PURCHASE_QUANTITY, parsePurchaseQuantity, permitsFraction } from "@/lib/purchase-quantity"
import { filterPurchaseCandidates, type DaStatusFilter, type StockStatusFilter, type MaterialSortFilter, type DaPresence } from "@/lib/material-da-filters"
import { MaterialLevelBadge } from "./bits"
import { api, useCreatePurchase, useMaterials } from "./hooks"

type PurchaseLine = { material: MaterialDTO; qtyDraft: string }

function suggestedQty(material: MaterialDTO): string {
  // Une valeur de seuil n'est PAS une couverture de stock à doubler.
  // Suggestions de départ uniquement ; l'acheteur ajuste selon les besoins réels.
  const target = Math.max((material.targetStock??material.minStock) - material.stockQty, 1)
  return String(Math.min(MAX_PURCHASE_QUANTITY, Math.ceil(Number.isFinite(target) ? target : 1)))
}

function QtyInput({ material, draft, onChange }: { material: MaterialDTO; draft: string; onChange: (raw: string) => void }) {
  const helpId = useId()
  const invalid = parsePurchaseQuantity(draft, material.unit) === null
  return (
    <div className="min-w-0">
      <Input
        aria-label={`Quantité demandée pour ${material.name} en ${material.unit}`}
        aria-invalid={invalid}
        aria-describedby={invalid ? helpId : undefined}
        type="number"
        inputMode="decimal"
        min={permitsFraction(material.unit) ? 0.001 : 1}
        max={MAX_PURCHASE_QUANTITY}
        step={permitsFraction(material.unit) ? 0.001 : 1}
        value={draft}
        onChange={e => onChange(e.target.value)}
        className="h-10 w-24 text-center tabular-nums"
      />
      {invalid && <p role="alert" id={helpId} className="mt-1 text-xs text-rose-700">Quantité positive requise (3 décimales maximum pour kg/ml/m ; entier pour les blocs).</p>}
    </div>
  )
}

/**
 * P5.8 : saisie du besoin uniquement, un seul défilement à l'intérieur de la fenêtre.
 * Le fournisseur suggéré et la date sont facultatifs dans l'API, sans migration.
 * Le prix estimatif continue d'être calculé côté serveur pour les contrôles historiques :
 * il ne fait pas partie des champs demandés à l'acheteur.
 */
export function PurchaseDialog({ onClose, prefill }: { onClose: () => void; prefill?: MaterialDTO | null }) {
  const [lines, setLines] = useState<PurchaseLine[]>(() =>
    prefill ? [{ material: prefill, qtyDraft: suggestedQty(prefill) }] : [],
  )
  const [materialSearch, setMaterialSearch] = useState("")
  const [materialPage,setMaterialPage]=useState(1)
  const materialPageSize=40
  const [maxSuggestions, setMaxSuggestions] = useState(8)
  const [suggestionFilter, setSuggestionFilter] = useState<SuggestionFilter>(prefill ? "common" : "all")
  const [daFilter, setDaFilter] = useState<DaStatusFilter>("all")
  const [stockFilter, setStockFilter] = useState<StockStatusFilter>("all")
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [supplierFilter, setSupplierFilter] = useState("all")
  const [sortFilter, setSortFilter] = useState<MaterialSortFilter>("urgency")
  const [urgent, setUrgent] = useState(false)
  const [expectedDate, setExpectedDate] = useState("") // Pas de date imposée ou inventée.
  const [showOptions, setShowOptions] = useState(false)
  const [supplier, setSupplier] = useState("") // Pas de fournisseur présélectionné.
  const [note, setNote] = useState("")
  const [duplicateJustification, setDuplicateJustification] = useState("")
  const [duplicateConflicts, setDuplicateConflicts] = useState<{ref:string; materialId:number; qty:number}[]>([])
  const [submitError, setSubmitError] = useState("")

  const selectedMaterials=lines.map(l=>l.material)
  const sharedSuppliers=commonSupplierIds(selectedMaterials)
  const { data, isLoading, isFetching:materialsFetching, isError:materialsError } = useMaterials({
    q:materialSearch.trim(), category:categoryFilter==="all"?"":categoryFilter,
    status:stockFilter!=="all"?stockFilter:suggestionFilter!=="all"?"needs":"all",
    page:materialPage,pageSize:materialPageSize,sort:sortFilter==="name"?"name":"stock",
    supplier:supplierFilter==="all"?"":supplierFilter,purchasableOnly:true,da:daFilter,
    sharedSupplierIds:suggestionFilter==="common"&&selectedMaterials.length?sharedSuppliers:undefined,
  })
  const suppliersQ = useQuery({
    queryKey: ["supplier-choices-for-purchase"],
    queryFn: () => api<{ items: { id: number; name: string; active: boolean }[] }>("/api/suppliers?view=choices"),
  })
  const daMaterialIds=[...new Set([...(data?.items??[]).map(m=>m.id),...selectedMaterials.map(m=>m.id)])].sort((a,b)=>a-b)
  const daPresence = useQuery({
    queryKey: ["material-da-presence",daMaterialIds.join(",")],
    queryFn: () => api<{ byMaterial: Record<number, DaPresence> }>(`/api/materials/da-presence?ids=${daMaterialIds.join(",")}`),
    enabled:daMaterialIds.length>0,
    staleTime: 5000,
  })
  const createMutation = useCreatePurchase()
  const daFollowup=useQuery({queryKey:["material-da-followup","open"],
    queryFn:()=>api<{byMaterial:Record<number,DaMaterialSummary>}>("/api/materials/da-followup?scope=open"),
    enabled:lines.length>0,
    staleTime:5000,
  })

  // Recherche et filtres catalogue gérés par l'API : ne pas exclure localement les résultats par code fournisseur.
  const activeDA=selectedMaterials.filter(m=>daOpenQty(daFollowup.data?.byMaterial[m.id])>0)
  const requiresJustification = activeDA.length > 0 || duplicateConflicts.length > 0 ||
    lines.some(line => (daPresence.data?.byMaterial[line.material.id]?.activeCount ?? 0) > 0)
  const selectable = suggestedMaterials(data?.items ?? [], selectedMaterials, suggestionFilter)
  const supplierNames = (suppliersQ.data?.items??[]).map(s=>s.name)
  const materials = daPresence.isSuccess ? filterPurchaseCandidates(selectable, daPresence.data.byMaterial, {
    da: daFilter, stock: stockFilter, category: categoryFilter, supplier: supplierFilter, sort: sortFilter==="urgency"?"stock":sortFilter,
  }) : []
  const matchingCount = materials.length
  // La liste a une page serveur de 40 candidats ; l'affichage par 8 reste un confort de lecture.
  const resetMaterialPage=()=>{setMaterialPage(1);setMaxSuggestions(8)}
  // Ne pas créer un deuxième scroll à l'intérieur de la liste de recherche.
  const visibleMaterials = materials.slice(0, maxSuggestions)
  const submissionLines = buildPurchaseRequestLines(lines.map(l => ({ materialId: l.material.id, qtyDraft: l.qtyDraft, unit: l.material.unit })))

  // « Urgente » est une indication visible dans la note métier existante,
  // pas un nouveau statut d'approbation ou une modification des règles d'autorisation.
  const noteToSave = urgent
    ? `URGENT — ${note.trim() || "Traitement prioritaire demandé"}`
    : note.trim()
  const urgentDateMissing = urgent && !expectedDate
  const canSubmit = submissionLines !== null && !urgentDateMissing && noteToSave.length <= 300 && !createMutation.isPending &&
    (!requiresJustification || duplicateJustification.trim().length>=10) &&
    (!lines.length || (daFollowup.isSuccess && !daFollowup.isFetching && daPresence.isSuccess && !daPresence.isFetching))

  function clearDuplicateWarning(){setDuplicateConflicts([]);setDuplicateJustification("");setSubmitError("")}
  function addMaterial(material: MaterialDTO) {
    clearDuplicateWarning()
    setSuggestionFilter("common")
    resetMaterialPage()
    setLines(previous => {
      if (previous.some(line => line.material.id === material.id) || previous.length >= MAX_PURCHASE_LINES) return previous
      return [...previous, { material, qtyDraft: suggestedQty(material) }]
    })
  }
  function setQuantity(id: number, raw: string) {
    clearDuplicateWarning()
    setLines(previous => previous.map(line => line.material.id === id ? { ...line, qtyDraft: raw } : line))
  }
  function stepQuantity(id: number, offset: -1 | 1) {
    clearDuplicateWarning()
    setLines(previous => previous.map(line => {
      if (line.material.id !== id) return line
      const current = parsePurchaseQuantity(line.qtyDraft, line.material.unit) ?? 1
      return { ...line, qtyDraft: String(Number(Math.max(permitsFraction(line.material.unit) ? 0.001 : 1, Math.min(MAX_PURCHASE_QUANTITY, current + offset * (permitsFraction(line.material.unit) ? 0.001 : 1))).toFixed(3))) }
    }))
  }
  function createPurchase() {
    if (!canSubmit || submissionLines === null) return
    setSubmitError("")
    createMutation.mutate({
      ...(requiresJustification && duplicateJustification.trim() ? { duplicateJustification: duplicateJustification.trim() } : {}),
      supplier: supplier || null,
      expectedDate: expectedDate ? new Date(`${expectedDate}T12:00:00`).toISOString() : null,
      note: noteToSave || null,
      lines: submissionLines,
    }, { onSuccess: onClose, onError: error => {
      const detail=error as Error & {status?:number;body?:{code?:string; conflicts?:{ref:string;materialId:number;qty:number}[]}}
      if(detail.status===409 && detail.body?.code==='DA_EXISTANTE') {
        setDuplicateConflicts(detail.body.conflicts??[])
        setSubmitError('Une demande existe déjà pour cette matière. Indiquez pourquoi une nouvelle DA est nécessaire.')
      } else setSubmitError(detail.message)
    } })
  }

  return (
    <Dialog open onOpenChange={opened => !opened && onClose()}>
      <DialogContent
        className="flex h-[min(92dvh,820px)] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[980px]"
        aria-describedby="p58-purchase-description"
      >
        {/* En-tête toujours visible : fermeture en haut à droite du composant DialogContent. */}
        <DialogHeader className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 pr-12 sm:px-7">
          <DialogTitle className="flex items-center gap-2 text-lg text-slate-900">
            <ShoppingCart className="size-5 shrink-0 text-[#bd202a]" aria-hidden="true" />
            Nouvelle demande d&apos;achat
          </DialogTitle>
          <DialogDescription id="p58-purchase-description" className="text-xs leading-relaxed sm:text-sm">
            Indiquez les matières nécessaires et leurs quantités. Le fournisseur et le prix définitifs seront déterminés à l&apos;étape du bon de commande (BC).
          </DialogDescription>
        </DialogHeader>

        {/* Zone centrale : seul conteneur scrollable de la fenêtre DA. */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden bg-slate-50/60 px-4 py-5 sm:px-7">
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.18fr)]">
            <section className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="p58-search-title">
              <div className="flex items-center justify-between gap-3">
                <h3 id="p58-search-title" className="text-sm font-semibold text-slate-900">1. Rechercher une matière</h3>
                <span className="text-xs text-slate-500">{data?.total??0} référence(s) · page {materialPage}/{data?.pages??1}</span>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-3 size-4 text-slate-400" aria-hidden="true" />
                <Input
                  aria-label="Rechercher une matière à ajouter"
                  placeholder="Rechercher par nom ou code article…"
                  value={materialSearch}
                  onChange={e => {setMaterialSearch(e.target.value);resetMaterialPage()}}
                  className="h-11 pl-9 pr-10"
                />
                {materialSearch && <button type="button" aria-label="Effacer la recherche" title="Effacer la recherche"
                  onClick={() => {setMaterialSearch("");resetMaterialPage()}}
                  className="absolute right-2 top-1.5 grid size-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-[#bd202a]">
                  <X className="size-4" aria-hidden="true" />
                </button>}
              </div>
              <div className="space-y-2" aria-label="Filtres des suggestions">
                <label htmlFor="p512-suggestion-filter" className="text-xs font-medium text-slate-700">Suggestions à afficher</label>
                <select id="p512-suggestion-filter" value={suggestionFilter} onChange={e=>{setSuggestionFilter(e.target.value as SuggestionFilter);resetMaterialPage()}}
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-[#bd202a]">
                  <option value="all">Tout le catalogue (hors sélection)</option>
                  <option value="low">Sous seuil ou en rupture</option>
                  <option value="common">Sous seuil / rupture · fournisseurs communs</option>
                </select>
                {suggestionFilter==='common'&&selectedMaterials.length>0&&<p className="text-xs text-slate-600" aria-live="polite">
                  {sharedSuppliers.length>0?`${sharedSuppliers.length} fournisseur(s) commun(s) aux ${selectedMaterials.length} matière(s) choisie(s) — recalcul automatique.`:'Aucun fournisseur commun : désactivez le filtre ou répartissez les consultations par fournisseur.'}
                </p>}
              </div>
              <div className="grid gap-2 sm:grid-cols-2" aria-label="Filtres de situation des matières">
                <label className="space-y-1 text-xs font-medium text-slate-700">État de la demande d’achat
                  <select aria-label="Filtrer par DA existante" value={daFilter} onChange={e=>{setDaFilter(e.target.value as DaStatusFilter);resetMaterialPage()}}
                    className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm">
                    <option value="all">Toutes les matières</option>
                    <option value="without">Sans DA en cours</option>
                    <option value="active">Avec DA en cours</option>
                    <option value="history">Ayant un historique DA</option>
                  </select>
                </label>
                <label className="space-y-1 text-xs font-medium text-slate-700">Situation du stock
                  <select aria-label="Filtrer par stock" value={stockFilter} onChange={e=>{setStockFilter(e.target.value as StockStatusFilter);resetMaterialPage()}}
                    className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm">
                    <option value="all">Tous les niveaux</option>
                    <option value="out">Rupture (stock nul)</option>
                    <option value="low">Sous seuil (stock positif)</option>
                    <option value="ok">Stock suffisant</option>
                  </select>
                </label>
                <label className="space-y-1 text-xs font-medium text-slate-700">Famille de matière
                  <select aria-label="Filtrer par famille" value={categoryFilter} onChange={e=>{setCategoryFilter(e.target.value);resetMaterialPage()}}
                    className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm">
                    <option value="all">Toutes les familles</option>
                    {(data?.categories ?? []).map(v=><option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
                <label className="space-y-1 text-xs font-medium text-slate-700">Fournisseur
                  <select aria-label="Filtrer par fournisseur" value={supplierFilter} onChange={e=>{setSupplierFilter(e.target.value);resetMaterialPage()}}
                    className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm">
                    <option value="all">Tous les fournisseurs</option>
                    {supplierNames.map(v=><option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
                <label className="space-y-1 text-xs font-medium text-slate-700 sm:col-span-2">Ordre d’affichage
                  <select aria-label="Trier les matières" value={sortFilter} onChange={e=>{setSortFilter(e.target.value as MaterialSortFilter);resetMaterialPage()}}
                    className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm">
                    <option value="urgency">Stock croissant (ruptures d'abord)</option>
                    <option value="stock">Quantité en stock croissante</option>
                    <option value="name">Nom de matière (A–Z)</option>
                  </select>
                </label>
              </div>
              <p className="text-[11px] text-slate-500">Avec DA = demande encore active. Une ancienne DA terminée n&apos;empêche pas de sélectionner la matière. Un doublon actif exige un motif documenté.</p>
              <div className="space-y-1" aria-label="Résultats de recherche matières">
                {visibleMaterials.map(material => {
                  return (
                    <button
                      key={material.id}
                      type="button"
                      disabled={lines.length >= MAX_PURCHASE_LINES}
                      onClick={() => addMaterial(material)}
                      aria-label={`Ajouter ${material.name}, ${material.ref}`}
                      className="flex min-h-16 w-full min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-rose-300 hover:bg-rose-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#bd202a] disabled:cursor-default disabled:bg-slate-50"
                    >
                      <span className="min-w-0 flex-1 space-y-0.5">
                        <span className="block break-words text-sm font-medium text-slate-800">{material.name}</span>
                        <span className="block break-all font-mono text-[11px] text-slate-500">{material.ref}</span>
                        <span className="block text-xs text-slate-600">Stock : {fmtNum(material.stockQty)} {material.unit}</span>
                        <span className="block text-[11px] font-medium text-slate-600">{(daPresence.data?.byMaterial[material.id]?.activeCount ?? 0)>0
                          ? `${daPresence.data!.byMaterial[material.id].activeCount} DA en cours — justification si nouvelle DA`
                          : (daPresence.data?.byMaterial[material.id]?.historyCount ?? 0)>0 ? "Aucune DA en cours (historique présent)" : "Aucune DA enregistrée"}</span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1.5">
                        <MaterialLevelBadge material={material} />
                        <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-1 text-xs font-medium text-[#bd202a]">
                          <Plus className="size-3.5" aria-hidden="true" /> Ajouter
                        </span>
                      </span>
                    </button>
                  )
                })}
                {daPresence.isPending && <p className="p-3 text-sm text-slate-600" role="status">Vérification des DA existantes…</p>}
                {daPresence.isError && <div className="rounded bg-rose-50 p-3 text-sm text-rose-800" role="alert">État des DA indisponible : sélection suspendue pour éviter les doublons. <Button type="button" size="sm" variant="outline" className="ml-2" onClick={()=>daPresence.refetch()}>Réessayer</Button></div>}
                {!isLoading && !materialsFetching && !materialsError && daPresence.isSuccess && matchingCount === 0 && (
                  <p className="rounded-lg border border-dashed p-4 text-center text-sm text-slate-500">Aucune autre matière correspondante. Modifiez les filtres ou la recherche.</p>
                )}
                {(isLoading||materialsFetching) && <p className="p-3 text-sm text-slate-500" role="status">Chargement des matières…</p>}
                {materialsError && <p role="alert" className="rounded bg-rose-50 p-2 text-xs text-rose-800">Recherche des matières indisponible : vérifiez votre connexion.</p>}
                {matchingCount > visibleMaterials.length && (
                  <Button type="button" variant="outline" className="mt-2 w-full" onClick={()=>setMaxSuggestions(n=>n+8)}>
                    Afficher 8 matières de plus sur cette page ({matchingCount-visibleMaterials.length} restantes)
                  </Button>
                )}
                {(data?.pages??1)>1 && <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3" aria-label="Pagination des matières">
                  <span className="text-xs text-slate-600">Page {materialPage} / {data?.pages} · filtre serveur sur {data?.total??0} matière(s)</span>
                  <div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={materialPage<=1||materialsFetching} onClick={()=>{setMaterialPage(p=>Math.max(1,p-1));setMaxSuggestions(8)}}>Précédente</Button>
                    <Button type="button" size="sm" variant="outline" disabled={materialPage>=(data?.pages??1)||materialsFetching} onClick={()=>{setMaterialPage(p=>p+1);setMaxSuggestions(8)}}>Suivante</Button></div>
                </div>}
                <p className="text-[11px] text-slate-500">La recherche référence/désignation, les familles et le stock interrogent toute la base. Les filtres « DA en cours » et « fournisseurs communs » complètent les résultats de la page affichée.</p>
              </div>
            </section>

            <section className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="p58-lines-title">
              <div className="flex items-center justify-between gap-2">
                <h3 id="p58-lines-title" className="text-sm font-semibold text-slate-900">2. Matières demandées</h3>
                <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-[#bd202a]">{lines.length} matière{lines.length > 1 ? "s" : ""}</span>
              </div>
              {lines.length === 0 ? (
                <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-7 text-center">
                  <ShoppingCart className="size-6 text-slate-400" aria-hidden="true" />
                  <p className="text-sm font-medium text-slate-700">Aucune matière sélectionnée</p>
                  <p className="text-xs text-slate-500">Cliquez sur « Ajouter » pour composer la demande.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {lines.map(line => (
                    <div key={line.material.id} className="min-w-0 rounded-lg border border-slate-200 px-3 py-3">
                      <div className="mb-2 flex min-w-0 items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="break-words text-sm font-medium leading-snug text-slate-900">{line.material.name}</p>
                          <p className="mt-1 break-all font-mono text-[11px] text-slate-500">{line.material.ref}</p>
                        </div>
                        <Button
                          type="button" size="icon" variant="ghost"
                          className="size-9 shrink-0 text-rose-700 hover:bg-rose-50"
                          title={`Retirer ${line.material.name}`}
                          aria-label={`Retirer ${line.material.name} de la demande`}
                          onClick={() => { clearDuplicateWarning(); setLines(previous => previous.filter(item => item.material.id !== line.material.id)) }}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <Label className="text-xs font-medium text-slate-600">Quantité demandée ({line.material.unit})</Label>
                        <div className="flex items-start gap-1.5">
                          <Button type="button" size="icon" variant="outline" className="size-10 border-slate-300 hover:border-rose-300 hover:bg-rose-50"
                            aria-label={`Diminuer la quantité de ${line.material.name}`}
                            onClick={() => stepQuantity(line.material.id, -1)}>
                            <Minus className="size-4" aria-hidden="true" />
                          </Button>
                          <QtyInput material={line.material} draft={line.qtyDraft} onChange={value => setQuantity(line.material.id, value)} />
                          <Button type="button" size="icon" variant="outline" className="size-10 border-slate-300 hover:border-rose-300 hover:bg-rose-50"
                            aria-label={`Augmenter la quantité de ${line.material.name}`}
                            onClick={() => stepQuantity(line.material.id, 1)}>
                            <Plus className="size-4" aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                      <p className="mt-2 text-[11px] text-slate-500">Proposition initiale : manque jusqu’au seuil ({line.material.minStock} {line.material.unit}). Vérifiez les commandes déjà en cours et adaptez la quantité.</p>
                    </div>
                  ))}
                </div>
              )}
              {requiresJustification && <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                <strong>Demande(s) déjà ouverte(s)</strong>
                <p>{[...new Set([...duplicateConflicts.map(c=>c.ref),...activeDA.flatMap(m=>(daFollowup.data?.byMaterial[m.id]?.history??[]).filter(p=>['pending','approved','partially_approved','ordered','partial'].includes(p.status)).map(p=>p.ref))])].join(', ')}. Le système ne doit pas réapprovisionner deux fois sans raison.</p>
                {activeDA.map(m=><p key={m.id} className="mt-1 text-xs">{m.name} : {fmtNum(daOpenQty(daFollowup.data?.byMaterial[m.id]))} {m.unit} déjà en DA/BC ouverts.</p>)}
                <Label htmlFor="p513-duplicate-reason" className="mt-2 block">Motif de nouvelle demande (10 caractères minimum)</Label>
                <Textarea id="p513-duplicate-reason" value={duplicateJustification} onChange={e=>setDuplicateJustification(e.target.value)} maxLength={500} rows={2} />
              </div>}
              {(daFollowup.isError || daPresence.isError)&&<p role="alert" className="rounded bg-rose-50 p-2 text-sm text-rose-800">Suivi des DA indisponible : création suspendue pour éviter une demande en double.</p>}
              {submitError && <p role="alert" className="rounded bg-rose-50 p-2 text-sm text-rose-800">{submitError}</p>}
              {submissionLines === null && lines.length > 0 && (
                <p role="alert" className="text-xs text-rose-700">Vérifiez les quantités. La demande ne sera pas enregistrée tant qu&apos;une ligne est invalide.</p>
              )}
            </section>
          </div>

          <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="p58-priority-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 id="p58-priority-title" className="text-sm font-semibold text-slate-900">3. Priorité du besoin</h3>
                <p className="mt-1 text-xs text-slate-500">Normale par défaut. L&apos;urgence est signalée dans la note de la DA ; elle ne contourne aucune validation.</p>
              </div>
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1" role="group" aria-label="Priorité de la demande">
                <Button type="button" size="sm" variant="ghost"
                  aria-pressed={!urgent}
                  className={!urgent ? "bg-white font-semibold text-slate-900 shadow-sm hover:bg-white" : "text-slate-600"}
                  onClick={() => setUrgent(false)}>Normale</Button>
                <Button type="button" size="sm" variant="ghost"
                  aria-pressed={urgent}
                  className={urgent ? "bg-rose-50 font-semibold text-[#bd202a] shadow-sm hover:bg-rose-50" : "text-slate-600"}
                  onClick={() => setUrgent(true)}>Urgente</Button>
              </div>
            </div>
            {urgent && (
              <div className="max-w-sm space-y-1.5 rounded-lg border border-rose-200 bg-rose-50/40 p-3">
                <Label htmlFor="p58-urgent-date">Date de besoin pour cette urgence *</Label>
                <Input id="p58-urgent-date" type="date" required value={expectedDate}
                  aria-invalid={urgentDateMissing}
                  onChange={e => setExpectedDate(e.target.value)} />
                {urgentDateMissing && <p role="alert" className="text-xs text-rose-700">Précisez la date du besoin urgent.</p>}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white shadow-sm" aria-labelledby="p58-options-title">
            <button type="button" aria-expanded={showOptions} aria-controls="p58-options-content"
              onClick={() => setShowOptions(current => !current)}
              className="flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#bd202a]">
              <span id="p58-options-title" className="text-sm font-semibold text-slate-800">Options facultatives</span>
              {showOptions ? <ChevronUp className="size-4 text-slate-600" /> : <ChevronDown className="size-4 text-slate-600" />}
            </button>
            {showOptions && (
              <div id="p58-options-content" className="grid gap-4 border-t border-slate-200 px-4 py-4 sm:grid-cols-2">
                {!urgent && (
                  <div className="space-y-1.5">
                    <Label htmlFor="p58-expected-date">Date souhaitée (facultative)</Label>
                    <Input id="p58-expected-date" type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>Fournisseur suggéré (non imposé)</Label>
                  <SearchableCombobox
                    label="Fournisseur suggéré" value={supplier} onChange={setSupplier}
                    placeholder="Aucune préférence"
                    options={[{ value: "", label: "Aucun fournisseur suggéré" }, ...(suppliersQ.data?.items ?? [])
                      .filter(s => s.active).map(s => ({ value: s.name, label: s.name }))]}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="p58-note">Motif ou observation (facultatif)</Label>
                  <Textarea id="p58-note" rows={2} className="resize-y" maxLength={urgent ? 260 : 300}
                    placeholder="Précision utile pour l'approbateur…"
                    value={note} onChange={e => setNote(e.target.value)} />
                </div>
              </div>
            )}
          </section>
          <p className="text-xs text-slate-500">
            Le numéro, la date de création et le demandeur sont enregistrés automatiquement. Le montant estimatif reste calculé par GoCmd pour les étapes de contrôle, sans saisie du prix dans cette demande.
          </p>
        </div>

        {/* Actions stables, visibles même lorsque la liste des matières est longue. */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-3 sm:px-7">
          <p className="text-xs text-slate-600">{lines.length} matière{lines.length > 1 ? "s" : ""} sélectionnée{lines.length > 1 ? "s" : ""} · Prix et fournisseur définitifs au BC</p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Annuler</Button>
            <Button type="button" variant="primary" disabled={!canSubmit} onClick={createPurchase}
              title={lines.length===0?"Ajoutez au moins une matière":urgentDateMissing?"Renseignez la date du besoin urgent":!canSubmit?"Vérifiez les quantités":"Créer la demande d'achat"}>
              {createMutation.isPending ? "Création…" : "Créer la demande"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
