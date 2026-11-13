"use client";

import { useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { ArrowDownToLine, ArrowUpFromLine, Boxes, Search, ShoppingCart, Plus, Pencil, RefreshCw, Eye, Copy, ChevronDown, ChevronUp, CheckCircle2, History, AlertTriangle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { SearchableCombobox } from "@/components/ui/searchable-combobox"
import { ARTICLE_DICTIONARY, technicalArticleIdentity, type ArticleAttributes, type NonFoamCategory } from "@/lib/article-identity"
import { MATERIAL_CATEGORIES, MATERIAL_UNITS, FOAM_GRADES, FOAM_COLORS, FOAM_FIRMNESS, foamSpecErrors, foamDescriptionFromSpec, type FoamSpec } from "@/lib/material-reference"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { fmtMAD, fmtNum, stockLevel, type MaterialDTO } from "@/lib/erp-types"
import { daAvailableCoverage, daOpenQty, type DaMaterialSummary } from "@/lib/material-da-summary"
import { replenishmentPosition, type MaterialSupply } from "@/lib/material-replenishment"
import { filterAndSortMaterials, type MaterialDaFilter, type MaterialSortMode, type MaterialStockFilter } from "@/lib/materials-workbench-sort"
import { MaterialLevelBadge } from "./bits"
import { api,useMaterials } from "./hooks"
import { hasPermission, hasRole, type SessionActor } from "@/lib/role-navigation"
import { InventoryWorkOrders } from "./inventory-work-orders"
import {StockPlanningPanel} from "./stock-planning-panel"
import {FinishedQualityPanel} from "./finished-quality-panel"
import {MaterialsPriceReview} from "./materials-price-review"

const materialCost=(m:MaterialDTO)=>m.averageCost!=null && Number(m.averageCost)>0 ? Number(m.averageCost) : m.unitPrice
// V18.9.2 (contre-audit F03) : coûts masqués pour certains rôles — affichage
// explicite « — » plutôt qu'un prix trompeur.
const costOrDash=(c:number|null|undefined)=>c==null?"—":fmtMAD(c)

export function MaterialsView({
  onMovement,
  onPurchase, onOpenPurchases,
}: {
  onMovement: (m: MaterialDTO, preset: "in" | "out") => void
  onPurchase: (m: MaterialDTO) => void
  onOpenPurchases: () => void
}) {
  const [q, setQ] = useState("")
  const [page,setPage] = useState(1)
  // Les actions non autorisées sont désactivées et expliquées, jamais silencieuses.
  const session=useQuery({queryKey:["me"],queryFn:()=>api<SessionActor>("/api/me")})
  const canCreate=hasRole(session.data,"buyer")&&hasPermission(session.data,"materials.manage")
  const canEdit=canCreate // Aligné avec PATCH /api/materials/[id] et l'autorisation granulaire.
  const canBuy=hasRole(session.data,"buyer")&&hasPermission(session.data,"purchases.create")
  const canMove=hasRole(session.data,"inventory")&&hasPermission(session.data,"stock.move")
  const canReceive=hasRole(session.data,"receiver")||canMove||hasRole(session.data,"quality")||hasRole(session.data,"finance")
  const [category, setCategory] = useState("all")
  const [stockFilter, setStockFilter] = useState<MaterialStockFilter>("all")
  const [daFilter, setDaFilter] = useState<MaterialDaFilter>("all")
  const [supplierFilter, setSupplierFilter] = useState("all")
  const [bcFilter, setBcFilter] = useState("all")
  const [locationFilter, setLocationFilter] = useState("all")
  const [sort, setSort] = useState<MaterialSortMode>("urgency")
  const queryClient=useQueryClient()
  const [editing,setEditing]=useState<MaterialDTO|"new"|null>(null)
  const [inspecting,setInspecting]=useState<MaterialDTO|null>(null)
  const [daInspecting,setDaInspecting]=useState<MaterialDTO|null>(null)
  const [ackAdditionalDa,setAckAdditionalDa]=useState(false)
  const [saving,setSaving]=useState(false)
  const [priceBusy,setPriceBusy]=useState(false)
  const [materialPriceReason,setMaterialPriceReason]=useState("Reajustement du tarif de vente catalogue")
  const [referenceTouched,setReferenceTouched]=useState(false)
  const freshForm=()=>({
    ref:"",name:"",description:"",category:"Mousse",unit:"kg",unitPrice:"0",minStock:"0",targetStock:"",location:"",reason:"",
    isPurchasable:true,isManufactured:false,isSellable:false,isInternalUse:true,salesUnit:"kg",unitsPerSale:"1",salesUnitPrice:"0",
    foamNature:"PURE",foamFormat:"BLOC",foamGrade:"STD",foamDensity:"",foamColor:"BLN",foamFirmness:"",
    foamResilience:"",foamSupplierGrade:"",foamLengthCm:"",foamWidthCm:"",foamHeightCm:"",foamThicknessCm:"",
  })
  const [form,setForm]=useState(freshForm)
  const [technicalAttrs,setTechnicalAttrs]=useState<Record<string,string>>({})
  const [nameTouched,setNameTouched]=useState(false)
  const [descriptionTouched,setDescriptionTouched]=useState(false)
  const [showTechnicalExtras,setShowTechnicalExtras]=useState(false)
  const [showStockExtras,setShowStockExtras]=useState(false)
  const openEditor=(m?:MaterialDTO)=>{
    setReferenceTouched(false)
    setShowTechnicalExtras(Boolean(m?.foamResilience || m?.foamSupplierGrade))
    setShowStockExtras(Boolean(m?.location || (m?.unitPrice && Number(m.unitPrice)>0)))
    setNameTouched(Boolean(m))
    setDescriptionTouched(Boolean(m))
    setEditing(m??"new")
    try {setTechnicalAttrs(m?.technicalAttributesJson?JSON.parse(m.technicalAttributesJson):{})}
    catch{setTechnicalAttrs({})}
    setForm(m?{
      ref:m.ref,name:m.name,description:m.description??"",category:m.category,unit:m.unit,
      unitPrice:m.unitPrice==null?"0":String(m.unitPrice),minStock:String(m.minStock),targetStock:m.targetStock==null?"":String(m.targetStock),location:m.location??"",reason:"",
      isPurchasable:m.isPurchasable??true,isManufactured:m.isManufactured??false,
      isSellable:m.isSellable??false,isInternalUse:m.isInternalUse??true,
      salesUnit:m.salesUnit??m.unit,unitsPerSale:String(m.unitsPerSale??1),salesUnitPrice:String(m.salesUnitPrice??0),
      foamNature:m.foamNature??"PURE",foamFormat:m.foamFormat??"",foamGrade:m.foamGrade??"",foamDensity:String(m.foamDensity??""),
      foamColor:m.foamColor??"",foamFirmness:m.foamFirmness??"",foamResilience:m.foamResilience==null?"":String(m.foamResilience),
      foamSupplierGrade:m.foamSupplierGrade??"",foamLengthCm:m.foamLengthCm==null?"":String(m.foamLengthCm),
      foamWidthCm:m.foamWidthCm==null?"":String(m.foamWidthCm),foamHeightCm:m.foamHeightCm==null?"":String(m.foamHeightCm),
      foamThicknessCm:m.foamThicknessCm==null?"":String(m.foamThicknessCm),
    }:freshForm())
  }
  const optionalNumber=(s:string):number|null=>s.trim()===""?null:Number(s)
  const foamSpec:FoamSpec={
    foamNature:form.foamNature,foamFormat:form.foamFormat,foamGrade:form.foamGrade,
    foamDensity:form.foamDensity.trim()===""?0:Number(form.foamDensity),foamColor:form.foamColor,
    foamFirmness:form.foamFirmness||null,foamResilience:optionalNumber(form.foamResilience),
    foamSupplierGrade:form.foamSupplierGrade.trim()||null,
    foamLengthCm:optionalNumber(form.foamLengthCm),foamWidthCm:optionalNumber(form.foamWidthCm),
    foamHeightCm:optionalNumber(form.foamHeightCm),foamThicknessCm:optionalNumber(form.foamThicknessCm),
  }
  const foamErrors=foamSpecErrors(foamSpec)
  const proposed=foamDescriptionFromSpec(foamSpec)
  const displayName=editing==="new"&&form.category==="Mousse"&&!nameTouched?proposed?.name??"":form.name
  const displayDescription=editing==="new"&&form.category==="Mousse"&&!descriptionTouched?proposed?.description??"":form.description
  const saveMaterial=async()=>{
    if(!editing)return
    setSaving(true)
    try{
      const payload={
        name:displayName.trim(),description:displayDescription.trim()||null,
        category:form.category.trim(),unit:form.unit.trim(),
        unitPrice:Number(form.unitPrice),minStock:Number(form.minStock),targetStock:form.targetStock.trim()===""?null:Number(form.targetStock),location:form.location.trim()||null,
        isPurchasable:form.isPurchasable,isManufactured:form.isManufactured,isSellable:form.isSellable,isInternalUse:form.isInternalUse,
        salesUnit:form.salesUnit||form.unit,unitsPerSale:Number(form.unitsPerSale),
        salesUnitPrice:editing!=="new" && editing.isSellable?Number(editing.salesUnitPrice??0):Number(form.salesUnitPrice),
        ...(editing==="new"&&form.category==="Mousse"?foamSpec:{}),
        ...(editing==="new"&&form.category!=="Mousse"?{technicalAttributes:Object.fromEntries(Object.entries(technicalAttrs).filter(([,v])=>v.trim()).map(([k,v])=>[k,v]))}:{}) ,
      }
      let createdRef=""
      if(editing==="new") {
        const result=await api<{ref:string}>("/api/materials",{method:"POST",body:JSON.stringify({...payload,
          ref:form.category==="Mousse"&&!referenceTouched?"":displayRef.trim(),
          location:form.location.trim()||undefined,
        })})
        createdRef=result.ref
      } else await api(`/api/materials/${editing.id}`,{method:"PATCH",body:JSON.stringify({...payload,reason:form.reason.trim()})})
      await Promise.all([queryClient.invalidateQueries({queryKey:["materials"]}),queryClient.invalidateQueries({queryKey:["dashboard"]})])
      toast.success(editing==="new"?`Matière ${createdRef} créée (stock initial à zéro)`:"Matière actualisée")
      setEditing(null)
    }catch(e){toast.error(e instanceof Error?e.message:"Enregistrement impossible")}
    finally{setSaving(false)}
  }
  const materialQuery = useMaterials({ q, category: category === "all" ? "" : category,
    status:stockFilter, page, pageSize:40,sort:sort==="name"?"name":sort==="stock"?"stock":sort==="category"?"category":"ref" })
  const {data,isPending}=materialQuery
  const materials = data?.items ?? []
  const daFollowup=useQuery({
    queryKey:["material-da-followup","open"],
    queryFn:()=>api<{byMaterial:Record<number,DaMaterialSummary>;supply:Record<number,MaterialSupply>}>("/api/materials/da-followup?scope=open"),
    enabled:canBuy,
    staleTime:5000,
  })
  const byMaterial: Record<number,DaMaterialSummary> = daFollowup.data?.byMaterial??{}
  const supply = daFollowup.isSuccess ? daFollowup.data.supply : undefined
  const history = useQuery({
    queryKey:["material-da-followup","history",daInspecting?.id],
    queryFn:()=>api<{byMaterial:Record<number,DaMaterialSummary>;pagination:{hasMore:boolean}}>(
      `/api/materials/da-followup?materialId=${daInspecting?.id}`),
    enabled:canBuy && daInspecting!==null,
  })
  // Présence exhaustive des DA : indépendante du suivi historique paginé.
  const daPresence = useQuery({
    queryKey:["material-da-presence"],
    queryFn:()=>api<{byMaterial:Record<number,{historyCount:number;activeCount:number}>}>("/api/materials/da-presence"),
    enabled:canBuy,
    staleTime:10_000,
  })
  const presence = daPresence.data?.byMaterial
  const supplierOptions = useMemo(()=>[...new Set(materials.flatMap(m=>[...(m.supplierNames??[]), ...(m.supplier?[m.supplier]:[])]))].sort((a,b)=>a.localeCompare(b,"fr")),[materials])
  const visibleMaterials = useMemo(()=>filterAndSortMaterials(materials.filter(m=>
    (locationFilter==="all" || m.location===locationFilter) &&
    (bcFilter==="all" || (supply && (Boolean(supply[m.id]?.inbound.length)===(bcFilter==="with"))))
  ),{
    sort,stock:stockFilter,da:canBuy?daFilter:"all",supplier:supplierFilter,presence:canBuy?presence:undefined,supply,
  }),[materials,sort,stockFilter,daFilter,supplierFilter,canBuy,presence,supply,bcFilter,locationFilter])
  const openDa=(m:MaterialDTO)=>{
    if(daFollowup.isPending||daFollowup.isError){
      toast.error("Suivi des DA indisponible : réessayez avant de créer une nouvelle demande.")
      return
    }
    if(presence?.[m.id]?.historyCount || byMaterial[m.id]?.history.length || supply?.[m.id]?.inbound.length){setAckAdditionalDa(false);setDaInspecting(m)}
    else onPurchase(m)
  }
  const facets = useMaterials({ q:"", category:"", status:"all" })
  const previewParams=new URLSearchParams({
    nature:form.foamNature,format:form.foamFormat,grade:form.foamGrade,density:form.foamDensity,
    color:form.foamColor,firmness:form.foamFirmness,resilience:form.foamResilience,
    supplierGrade:form.foamSupplierGrade,lengthCm:form.foamLengthCm,widthCm:form.foamWidthCm,
    heightCm:form.foamHeightCm,thicknessCm:form.foamThicknessCm,
  })
  const suggestions = useQuery({
    queryKey:["material-foam-ref",previewParams.toString()],
    queryFn:()=>api<{reference:string;prefix:string;duplicate:boolean}>(`/api/materials/reference?${previewParams}`),
    enabled:editing==="new"&&form.category==="Mousse"&&foamErrors.length===0,
    staleTime:0,
  })
  const familyAttributes=form.category!=="Mousse"?ARTICLE_DICTIONARY[form.category as NonFoamCategory]:undefined
  const codedNonFoam=familyAttributes?technicalArticleIdentity(form.category,
    Object.fromEntries(Object.entries(technicalAttrs).filter(([,v])=>v.trim())) as ArticleAttributes):null
  const displayRef = editing==="new" && form.category!=="Mousse"
    ? codedNonFoam?.reference??"" : editing==="new"&&form.category==="Mousse"&&!referenceTouched
      ? suggestions.data?.reference??"" : form.ref
  const categories=MATERIAL_CATEGORIES.map(value=>({value,label:value}))
  const units=MATERIAL_UNITS.map(value=>({value,label:value==="pcs"?"Pièce (pcs)":value==="u"?"Unité (u)":value==="ml"?"Mètre linéaire (ml)":value}))
  const locations=[...new Set((facets.data?.items??[]).map(m=>m.location?.trim()).filter((v):v is string=>Boolean(v)))].sort((a,b)=>a.localeCompare(b,"fr"))
  const locationOptions=[{value:"",label:"Non défini"},...locations.map(value=>({value,label:value}))]
  const validNumeric=(value:string)=>value.trim()!==""&&Number.isFinite(Number(value))&&Number(value)>=0&&Number(value)<=1e9
  const formValid = Boolean(displayName.trim().length>=2 && displayName.trim().length<=180 && displayDescription.trim().length<=900 &&
    form.category && form.unit && validNumeric(form.unitPrice) && validNumeric(form.minStock) && (form.targetStock.trim()==="" || (validNumeric(form.targetStock)&&Number(form.targetStock)>=Number(form.minStock))) &&
    (editing!=="new" || form.category==="Mousse" || (codedNonFoam?.errors.length===0&&displayRef.trim().length>=2)) &&
    (editing==="new" || form.reason.trim().length>=8) &&
    (editing!=="new" || form.category!=="Mousse" || (foamErrors.length===0 && !suggestions.data?.duplicate)))

  const stats = useMemo(() => {
    const total = materials.length
    const low = materials.filter((m) => m.stockQty < m.minStock).length
    // V18.9.2 (contre-audit F03) : valeur agrégée seulement si les coûts
    // sont visibles pour le rôle ; sinon affichage « — ».
    const out = materials.filter((m) => m.stockQty <= 0).length
    return { total, low, out }
  }, [materials])

  return (
    <div className="space-y-4">
      {hasRole(session.data,"director")&&<MaterialsPriceReview/>}
      {(canMove||canBuy || hasRole(session.data,"approver") || hasRole(session.data,"production")) && <StockPlanningPanel/>}
      {hasRole(session.data,"quality")&&<FinishedQualityPanel/>}
      {canMove && <InventoryWorkOrders />}
      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-3">
        <MiniStat label="Matières affichées" value={String(visibleMaterials.length)} />
        <MiniStat label="Sous le seuil" value={String(stats.low)} tone={stats.low > 0 ? "rose" : "emerald"} />
        <MiniStat label="En rupture" value={String(stats.out)} tone={stats.out > 0 ? "rose" : "emerald"} />
      </div>

      <Card className="min-w-0 border-slate-200">
        <CardHeader className="gap-3 pb-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Boxes className="size-4 text-emerald-600" /> Stock matières premières
            </CardTitle>
            <CardDescription>
              Mousses, tissus, mercerie et emballage — stocks initiaux validés par hypothèse pour simulation, contrôle réel lors des essais en usine
            </CardDescription>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" disabled={!canCreate} title={canCreate?"Créer une fiche matière":"Réservé à l’acheteur habilité à gérer les matières"} onClick={()=>openEditor()}><Plus className="size-4"/> Nouvelle matière</Button>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={q}
                onChange={(e) => {setQ(e.target.value);setPage(1)}}
                placeholder="Rechercher (réf, nom, fournisseur)…"
                className="w-full pl-8 sm:w-64"
                aria-label="Rechercher une matière"
              />
            </div>
            <SearchableCombobox label="Filtrer par catégorie" value={category} onChange={v=>{setCategory(v);setPage(1)}}
              className="w-full sm:w-52"
              options={[{value:"all",label:"Toutes catégories"},...(facets.data?.categories??[]).map(value=>({value,label:value}))]}/>


          </div>
        </CardHeader>
        <div className="mx-4 mb-3 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-3 sm:mx-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-700">Prioriser les matières à traiter</p>
            <span className="text-xs text-slate-500">{visibleMaterials.length} sur cette page · {data?.total??0} correspondances au serveur</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <SearchableCombobox label="Risque de stock" value={stockFilter} onChange={v=>{setStockFilter(v as MaterialStockFilter);setPage(1)}}
              options={[{value:"all",label:"Tous les états"},{value:"out",label:"Rupture (stock à zéro)"},{value:"low",label:"Sous seuil (hors rupture)"},{value:"ok",label:"Stock suffisant"}]}/>
            <SearchableCombobox label="État des demandes d'achat" value={daFilter} onChange={v=>setDaFilter(v as MaterialDaFilter)} disabled={!canBuy||daPresence.isPending||daPresence.isError}
              options={[{value:"all",label:"Toutes les DA"},{value:"without-active",label:"Sans DA en cours"},{value:"with-active",label:"Avec DA en cours"},{value:"history",label:"Avec historique DA"},{value:"without-history",label:"Jamais de DA"}]}/>
            <SearchableCombobox label="Fournisseur de matière" value={supplierFilter} onChange={setSupplierFilter}
              options={[{value:"all",label:"Tous les fournisseurs"},...supplierOptions.map(value=>({value,label:value}))]}/>
            <SearchableCombobox label="Trier les matières" value={sort} onChange={v=>{setSort(v as MaterialSortMode);setPage(1)}}
              options={[{value:"urgency",label:"Priorité de réapprovisionnement"},{value:"gap",label:"Quantité manquante décroissante"},{value:"stock",label:"Quantité en stock croissante"},{value:"name",label:"Désignation A → Z"},{value:"category",label:"Famille puis désignation"}]}/>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {canBuy&&<SearchableCombobox label="Bons de commande en cours" value={bcFilter} onChange={setBcFilter} disabled={!supply}
              options={[{value:"all",label:"Tous les BC"},{value:"with",label:"Avec reliquat BC"},{value:"without",label:"Sans reliquat BC"}]}/>}
            <SearchableCombobox label="Emplacement de la fiche matière" value={locationFilter} onChange={setLocationFilter}
              options={[{value:"all",label:"Tous les emplacements"},...locations.map(value=>({value,label:value}))]}/>
          </div>
          <Button size="sm" variant="ghost" className="mt-2" onClick={()=>{setPage(1);setQ("");setCategory("all");setStockFilter("all");setDaFilter("all");setSupplierFilter("all");setBcFilter("all");setLocationFilter("all");setSort("urgency")}}>Réinitialiser les filtres matières</Button>
          {canBuy&&daPresence.isError&&<p role="alert" className="mt-2 text-xs text-rose-700">Suivi DA indisponible : impossible de conclure si une DA existe. Les filtres DA sont désactivés.</p>}
          {canBuy&&daPresence.isPending&&<p className="mt-2 text-xs text-slate-500">Chargement du statut des DA…</p>}
          <p className="mt-2 text-xs text-slate-500">Rupture = stock disponible ≤ 0 ; sous seuil = stock positif inférieur au seuil. Recherche, famille, stock et tris nom/stock/famille couvrent tout le catalogue. Les filtres avancés (DA, BC, fournisseur, emplacement) et les tris priorité/écart s’appliquent seulement aux 40 résultats de la page affichée ; ne pas utiliser ces tris pour une décision globale de réapprovisionnement. Les DA ouvertes ne garantissent pas une livraison.</p>
        </div>
        <CardContent className="min-w-0 pt-0">
          {materialQuery.isError ? <p role="alert" className="text-sm text-rose-800">Impossible de charger les matières. <Button size="sm" variant="outline" onClick={()=>void materialQuery.refetch()}>Réessayer</Button></p> : isPending ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="min-w-0 w-full overflow-x-auto scrollbar-thin" role="region" aria-label="Tableau des matières premières" tabIndex={0}>
              <Table className={cn("table-fixed",canBuy?"min-w-[1580px]":"min-w-[1100px]")}>
                {/* Colonnes de suivi des DA par statut, sans masquer la référence ni la désignation. */}
                <colgroup>
                  <col style={{width:canBuy?"20%":"30%"}} />
                  <col style={{width:canBuy?"23%":"34%"}} />
                  <col style={{width:canBuy?"12%":"14%"}} />
                  {canBuy&&<><col style={{width:"9%"}} /><col style={{width:"9%"}} /><col style={{width:"9%"}} /><col style={{width:"9%"}} /></>}
                  <col style={{width:canBuy?"9%":"22%"}} />
                </colgroup>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Code article</TableHead>
                    <TableHead scope="col">Désignation</TableHead>
                    <TableHead scope="col">Stock / état</TableHead>
                    {canBuy&&<>
                      <TableHead scope="col" className="whitespace-normal text-xs" title="DA créées en attente d'approbation">DA à valider</TableHead>
                      <TableHead scope="col" className="whitespace-normal text-xs" title="Quantité approuvée sans bon de commande">Validées sans BC</TableHead>
                      <TableHead scope="col" className="whitespace-normal text-xs" title="Quantité dans des BC brouillons">BC brouillons</TableHead>
                      <TableHead scope="col" className="whitespace-normal text-xs" title="Quantité commandée et non encore acceptée en réception">Reste à recevoir</TableHead>
                    </>}
                    <TableHead scope="col" className="sticky right-0 z-10 bg-white text-right shadow-[-4px_0_8px_-8px_#334155]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleMaterials.map((m) => (
                    <TableRow key={m.id} className={cn(stockLevel(m) !== "ok" && "bg-amber-50/40")}>
                      <TableCell className="min-w-0 py-3 align-top whitespace-normal">
                        <button
                          type="button"
                          className="group inline-flex max-w-full items-start gap-1 text-left font-mono text-xs font-semibold text-slate-800 underline-offset-2 hover:text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-primary"
                          title={`Copier le code : ${m.ref}`}
                          aria-label={`Copier la référence ${m.ref}`}
                          onClick={async()=>{try{await navigator.clipboard.writeText(m.ref);toast.success("Référence copiée")}catch{toast.error("Copie impossible : sélectionner le code manuellement")}}}
                        >
                          <span className="min-w-0 [overflow-wrap:anywhere]">{m.ref}</span>
                          <Copy aria-hidden="true" className="mt-0.5 size-3 shrink-0 opacity-60 group-hover:opacity-100"/>
                        </button>
                      </TableCell>
                      <TableCell className="min-w-0 py-3 align-top whitespace-normal">
                        <button type="button" onClick={()=>setInspecting(m)} title="Ouvrir la fiche matière"
                          className="w-full text-left font-medium leading-relaxed text-slate-800 [overflow-wrap:anywhere] hover:text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-primary">
                          {m.name}
                        </button>
                      </TableCell>
                      <TableCell className="py-3 align-top whitespace-normal">
                        <p className="font-semibold tabular-nums text-slate-800">{fmtNum(m.stockQty)} {m.unit}</p>
                        {supply&&<p className="mt-1 text-xs text-slate-600">Libre : {fmtNum(replenishmentPosition(m,supply[m.id]).freeQty)} · Réservé : {fmtNum(supply[m.id]?.reservedQty??0)}</p>}
                        {supply&&<p className="mt-1 text-xs text-slate-600">Prévision BC : {fmtNum(replenishmentPosition(m,supply[m.id]).projectedQty)} · Écart au seuil : {fmtNum(replenishmentPosition(m,supply[m.id]).remainingGap)}</p>}
                        <p className="mt-1 text-xs text-slate-500">Seuil : {fmtNum(m.minStock)} {m.unit}</p>
                        <div className="mt-2"><MaterialLevelBadge material={m}/></div>
                        {canBuy&&presence&&<p className="mt-1 text-xs text-slate-500">{(presence[m.id]?.activeCount??0)>0?`${presence[m.id].activeCount} DA active(s)`:(presence[m.id]?.historyCount??0)>0?"Anciennes DA · aucune active":"Aucune DA"}</p>}
                      </TableCell>
                      {canBuy&&(["pendingQty","approvedQty","draftQty","orderedRemainingQty"] as const).map(field=>{
                        const value=field==="orderedRemainingQty" ? replenishmentPosition(m,supply?.[m.id]).inboundQty : byMaterial[m.id]?.[field]??0
                        return <TableCell key={field} className="py-3 align-top tabular-nums text-sm whitespace-normal">
                          {daFollowup.isPending?"…":daFollowup.isError?"Indisponible":value>0?`${fmtNum(value)} ${m.unit}`:"—"}
                        </TableCell>
                      })}
                      <TableCell className="sticky right-0 z-10 bg-white py-3 align-top whitespace-nowrap shadow-[-4px_0_8px_-8px_#334155]">
                        <MaterialRowActions material={m} canEdit={canEdit} canReceive={canReceive}
                          canMove={canMove} canBuy={canBuy}
                          onInspect={()=>setInspecting(m)} onEdit={()=>openEditor(m)}
                          onReceive={()=>onMovement(m,"in")} onMove={()=>onMovement(m,"out")}
                          daCount={byMaterial[m.id]?.history.length??0}
                          onBuy={()=>openDa(m)}/>
                      </TableCell>
                    </TableRow>
                  ))}
                  {visibleMaterials.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={canBuy?8:4} className="py-10 text-center text-slate-500">
                        Aucune matière ne correspond aux filtres, ou état DA momentanément indisponible.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
          {data&&<nav aria-label="Pages du catalogue matières" className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
            <p className="text-sm text-slate-600">Page {data.page} / {data.pages} · {data.total} référence(s) au total · 40 maximum par page</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={page<=1||materialQuery.isFetching} onClick={()=>setPage(p=>Math.max(1,p-1))}>Précédente</Button>
              <Button variant="outline" size="sm" disabled={page>=data.pages||materialQuery.isFetching} onClick={()=>setPage(p=>Math.min(data.pages,p+1))}>Suivante</Button>
            </div>
          </nav>}
        </CardContent>
      </Card>
      <Dialog open={daInspecting!==null} onOpenChange={open=>{if(!open)setDaInspecting(null)}}>
        <DialogContent className="flex max-h-[90dvh] max-w-[calc(100vw-1rem)] flex-col overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><History className="size-5 text-[#bd202a]"/> Suivi des demandes d'achat</DialogTitle>
            <DialogDescription>{daInspecting?.name} — {daInspecting?.ref}</DialogDescription>
          </DialogHeader>
          {daInspecting&&(()=>{
            const summary=byMaterial[daInspecting.id]
            const total=daOpenQty(summary)
            const confirmed=daAvailableCoverage(summary)
            const position=replenishmentPosition(daInspecting,supply?.[daInspecting.id])
            const missing=Math.max(0,daInspecting.minStock-position.freeQty)
            const records=history.data?.byMaterial[daInspecting.id]?.history??[]
            const suggested=Math.max(0,Math.round((position.remainingGap-(summary?.pendingQty??0)-(summary?.approvedQty??0))*1000)/1000)
            return <div className="min-h-0 space-y-3 overflow-y-auto text-sm">
              <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-slate-700">
                Stock : <b>{fmtNum(daInspecting.stockQty)} {daInspecting.unit}</b> · Seuil : <b>{fmtNum(daInspecting.minStock)} {daInspecting.unit}</b>.
                <span className="block text-xs text-slate-500">Les quantités ci-dessous ne sont pas du stock : la réception acceptée seule met le stock à jour.</span>
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {([['À valider',summary?.pendingQty],['Validée sans BC',summary?.approvedQty],['BC brouillon',summary?.draftQty],['Reste à recevoir',summary?.orderedRemainingQty]] as [string,number|undefined][]).map(([label,value])=><div key={label} className="rounded-lg border border-slate-200 p-3"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 font-semibold tabular-nums">{fmtNum(value??0)} {daInspecting.unit}</div></div>)}
              </div>
              <div className="rounded-lg bg-amber-50 p-3 text-amber-950">
                <p className="font-semibold">Besoin brut jusqu'au seuil : {fmtNum(missing)} {daInspecting.unit}</p>
                <p>Déjà couvert par des DA non clôturées : {fmtNum(total)} {daInspecting.unit}, dont {fmtNum(confirmed)} {daInspecting.unit} validés ou commandés.</p>
                <p className="mt-1 font-semibold">Complément indicatif : {fmtNum(suggested)} {daInspecting.unit}</p>
                <p className="mt-1 text-xs">Les DA à valider ne sont pas garanties. Les BC brouillons sont affichés séparément et ne sont jamais comptés deux fois dans le besoin couvert.</p>
                {(summary?.draftExcessQty??0)>0&&<p role="alert" className="mt-2 rounded border border-rose-300 bg-rose-50 p-2 font-semibold text-rose-800">Alerte : les projets de BC concurrents dépassent de {fmtNum(summary!.draftExcessQty)} {daInspecting.unit} le reliquat non commandé. Vérifier les brouillons avant toute approbation.</p>}
              </div>
              <h3 className="font-semibold">Réceptions attendues</h3>
              {(supply?.[daInspecting.id]?.inbound??[]).map((line,index)=><p key={`${line.ref}-${index}`}>{line.ref} · {fmtNum(line.qty)} {daInspecting.unit} · {line.expectedDate?.slice(0,10)??"Date non renseignée"}</p>)}
              <h3 className="font-semibold">Historique récent des DA ({records.length})</h3>
              {history.isPending&&<p>Chargement de l’historique…</p>}
              {history.isError&&<p role="alert">Historique indisponible.</p>}
              {history.data?.pagination.hasMore&&<p>Consultez le registre des DA pour les demandes plus anciennes.</p>}
              <div className="space-y-2">
                {records.map(p=><div key={`${p.id}-${p.ref}`} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2"><b>{p.ref}</b><span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium">{daStatusLabel(p.status)}</span></div>
                  <p className="mt-1 text-xs text-slate-500">Créée le {new Date(p.createdAt).toLocaleDateString('fr-FR')} · Demandée : {fmtNum(p.qty)} {daInspecting.unit}</p>
                  <p className="mt-1 text-xs">Validée non commandée : {fmtNum(p.approvedToOrderQty)} · BC brouillon : {fmtNum(p.draftQty)} · À recevoir : {fmtNum(p.orderedRemainingQty)} · Réception acceptée : {fmtNum(p.acceptedQty)} {daInspecting.unit}{p.draftExcessQty>0&&` · ⚠ Brouillons en excès : ${fmtNum(p.draftExcessQty)} ${daInspecting.unit}`}</p>
                  {p.orders.length>0&&<p className="mt-1 text-xs text-slate-500">BC liés : {p.orders.join(', ')}</p>}
                </div>)}
              </div>
              {total>0&&<label className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
                <input type="checkbox" checked={ackAdditionalDa} onChange={e=>setAckAdditionalDa(e.target.checked)} className="mt-0.5 size-6 accent-amber-700"/>
                J'ai vérifié les DA en cours et souhaite malgré tout créer un besoin supplémentaire. Une justification sera demandée dans la DA.
              </label>}
              <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3">
                <Button variant="outline" onClick={()=>daFollowup.refetch()} disabled={daFollowup.isFetching}><RefreshCw className="size-4"/>{daFollowup.isFetching?"Actualisation…":"Actualiser"}</Button>
                <Button variant="outline" onClick={()=>{setDaInspecting(null);onOpenPurchases()}}>Voir toutes les DA</Button>
                <Button disabled={total>0&&!ackAdditionalDa} onClick={()=>{const m=daInspecting;setDaInspecting(null);onPurchase(m)}}>
                  {total>0?"Créer une DA supplémentaire":"Créer une nouvelle DA"}
                </Button>
              </div>
            </div>
          })()}
        </DialogContent>
      </Dialog>
      <Dialog open={inspecting!==null} onOpenChange={open=>{if(!open)setInspecting(null)}}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Fiche matière</DialogTitle>
            <DialogDescription>Informations complémentaires à la liste — selon les droits du compte.</DialogDescription>
          </DialogHeader>
          {inspecting && <div className="space-y-4 text-sm">
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">Code article</p>
              <p className="mt-1 break-all font-mono font-semibold text-slate-800">{inspecting.ref}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">Désignation</p>
              <p className="mt-1 font-medium text-slate-800">{inspecting.name}</p>
            </div>
            {inspecting.description&&<div>
              <p className="text-xs font-semibold uppercase text-slate-500">Description technique</p>
              <p className="mt-1 whitespace-pre-wrap text-slate-700">{inspecting.description}</p>
            </div>}
            <dl className="grid grid-cols-1 gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
              <div><dt className="text-xs text-slate-500">Catégorie</dt><dd className="font-medium">{inspecting.category}</dd></div>
              <div><dt className="text-xs text-slate-500">Unité</dt><dd className="font-medium">{inspecting.unit}</dd></div>
              <div><dt className="text-xs text-slate-500">Stock disponible</dt><dd className="font-medium">{fmtNum(inspecting.stockQty)} {inspecting.unit}</dd></div>
              <div><dt className="text-xs text-slate-500">Seuil minimum</dt><dd className="font-medium">{fmtNum(inspecting.minStock)} {inspecting.unit}</dd></div>
              <div><dt className="text-xs text-slate-500">Dépôt indicatif</dt><dd className="font-medium">{inspecting.location||"Non défini"}</dd></div>
              <div><dt className="text-xs text-slate-500">Fournisseurs référencés</dt><dd className="font-medium">{inspecting.supplierNames?.length?inspecting.supplierNames.join(" · "):"Aucun renseigné"}</dd></div>
              <div><dt className="text-xs text-slate-500">Prix indicatif / coût moyen, si autorisé</dt><dd className="font-medium">{costOrDash(materialCost(inspecting))}{materialCost(inspecting)!=null?` /${inspecting.unit}`:""}</dd></div>
              <div><dt className="text-xs text-slate-500">Valeur stock, si autorisée</dt><dd className="font-medium">{materialCost(inspecting)==null?"—":fmtMAD(inspecting.stockQty*(materialCost(inspecting)??0))}</dd></div>
            </dl>
          </div>}
          <DialogFooter><Button variant="outline" onClick={()=>setInspecting(null)}>Fermer</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {/* P5.9 : un seul scroll central, étapes dans l'ordre réel de saisie,
          aperçu technique après les attributs, pied de fenêtre toujours visible. */}
      <Dialog open={editing!==null} onOpenChange={open=>{if(!open)setEditing(null)}}>
        <DialogContent
          className="flex h-[min(92dvh,860px)] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[920px]"
          aria-describedby="p59-material-description"
        >
          <DialogHeader className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 pr-12 sm:px-7">
            <DialogTitle className="flex items-center gap-2 text-lg text-slate-900">
              <Boxes className="size-5 shrink-0 text-[#bd202a]" aria-hidden="true" />
              {editing==="new"?"Créer une matière":"Modifier la matière"}
            </DialogTitle>
            <DialogDescription id="p59-material-description" className="text-xs leading-relaxed sm:text-sm">
              {editing==="new"
                ? "Renseignez les caractéristiques, puis vérifiez la référence et la désignation proposées. Le stock initial reste à zéro."
                : "Modifiez les données autorisées. Les caractéristiques techniques et la référence restent stables après création."}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden bg-slate-50/70 px-4 py-5 sm:px-7">
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="p59-family-title">
              <div className="mb-4 flex items-start gap-3">
                <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#bd202a] text-xs font-bold text-white">1</span>
                <div>
                  <h3 id="p59-family-title" className="text-sm font-semibold text-slate-900">Famille et unité de stockage</h3>
                  <p className="mt-0.5 text-xs text-slate-500">Choisissez la famille avant de saisir les caractéristiques spécifiques.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 text-sm">
                  <span className="font-medium">Catégorie *</span>
                  <SearchableCombobox label="Catégorie" value={form.category} options={categories} disabled={editing!=="new"}
                    onChange={category=>{setReferenceTouched(false);setTechnicalAttrs({});setNameTouched(false);setDescriptionTouched(false);setForm(prev=>({...prev,category,ref:category===prev.category?prev.ref:"",foamNature:"PURE",foamFormat:"BLOC",foamGrade:"STD",foamDensity:category==="Mousse"?prev.foamDensity:""}))}}/>
                </div>
                <div className="space-y-1.5 text-sm">
                  <span className="font-medium">Unité de stock *</span>
                  <SearchableCombobox label="Unité de stock" value={form.unit} options={units}
                    onChange={unit=>setForm(prev=>({...prev,unit,salesUnit:prev.salesUnit===prev.unit?unit:prev.salesUnit,unitsPerSale:prev.salesUnit===prev.unit?"1":prev.unitsPerSale}))}/>
                  <p className="text-xs text-slate-500">Ne pourra plus être modifiée après les premiers mouvements.</p>
                </div>
              </div>
            </section>

            {form.category!=="Mousse"&&familyAttributes&&<section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-label="Identité technique matière">
              <h3 className="text-sm font-semibold">Identité technique de la famille {form.category}</h3>
              <p className="my-2 text-xs text-slate-600">Les caractéristiques distinctives déterminent le code de l'article. Les unités sont explicites ; une modification technique exige une nouvelle variante. Dictionnaire DEMO à valider métier.</p>
              {editing!=="new"&&<p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs">Identité figée sur la fiche existante.</p>}
              <div className="grid gap-3 sm:grid-cols-2">
                {familyAttributes.required.map(key=><label key={key} className="space-y-1 text-xs"><span className="font-medium">{({type:"Type",composition:"Composition",couleur:"Couleur",piquage:"Piquage",format:"Format",laizeCm:"Laize (cm)",grammageGM2:"Grammage (g/m²)",technologie:"Technologie ressorts",longueurCm:"Longueur (cm)",largeurCm:"Largeur (cm)",hauteurCm:"Hauteur (cm)",diametreFilMm:"Diamètre fil (mm)",matiere:"Matière",calibreMm:"Calibre (mm)",epaisseurUm:"Épaisseur (µm)",chimie:"Chimie",grade:"Grade",conditionnement:"Conditionnement",capaciteKg:"Capacité (kg)"} as Record<string,string>)[key]??key} *</span>
                  <Input disabled={editing!=="new"} value={technicalAttrs[key]??""} onChange={e=>setTechnicalAttrs(prev=>({...prev,[key]:e.target.value}))} placeholder={key.endsWith("Cm")||key.endsWith("Mm")||key.endsWith("GM2")||key.endsWith("Kg")||key.endsWith("Um")?"Valeur numérique":"Code/valeur technique"}/>
                </label>)}
              </div>
              {editing==="new"&&<p role="status" className="mt-3 text-xs text-amber-900">{codedNonFoam?.errors.length?codedNonFoam.errors.join(" · "):"Référence calculée ; vérifier les attributs techniques avant création."}</p>}
            </section>}
            {form.category==="Mousse" && (
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="p59-foam-title">
                <div className="mb-4 flex items-start gap-3">
                  <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#bd202a] text-xs font-bold text-white">2</span>
                  <div>
                    <h3 id="p59-foam-title" className="text-sm font-semibold text-slate-900">Identité technique de la mousse</h3>
                    <p className="mt-0.5 text-xs text-slate-500">Les valeurs saisies définissent la variante et son code article.</p>
                  </div>
                </div>
                {editing!=="new"&&<p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Caractéristiques figées : pour une nouvelle densité, couleur, dimension ou fermeté, créez une nouvelle fiche. Aucune valeur manquante des données de démonstration n’est inventée.</p>}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1 text-sm"><span className="font-medium">Nature *</span>
                <SearchableCombobox label="Nature de la mousse" disabled={editing!=="new"} value={form.foamNature} options={[{value:"PURE",label:"Mousse pure"},{value:"AGGLO",label:"Mousse agglomérée"}]}
                  onChange={v=>{setReferenceTouched(false);setForm(prev=>({...prev,foamNature:v,foamGrade:v==="AGGLO"&&!['STD','SPE'].includes(prev.foamGrade)?'STD':prev.foamGrade,foamFormat:v==="AGGLO"&&prev.foamFormat==="ROULEAU"?"BLOC":prev.foamFormat,foamLengthCm:v==="AGGLO"&&prev.foamFormat==="ROULEAU"?"":prev.foamLengthCm}))}}/>
              </div>
              <div className="space-y-1 text-sm"><span className="font-medium">Format *</span>
                <SearchableCombobox label="Format physique" disabled={editing!=="new"} value={form.foamFormat} options={(form.foamNature==="AGGLO"?["BLOC","PLAQUE"]:["BLOC","PLAQUE","ROULEAU"]).map(value=>({value,label:value}))}
                  onChange={v=>{setReferenceTouched(false);setForm(prev=>({...prev,foamFormat:v,foamLengthCm:"",foamHeightCm:"",foamThicknessCm:""}))}}/>
                {form.foamNature==="AGGLO"&&<p className="text-xs text-amber-800">Mousse agglomérée : rouleau interdit.</p>}
              </div>
              <div className="space-y-1 text-sm"><span className="font-medium">Qualité / type technique *</span>
                <SearchableCombobox label="Qualité / type technique" disabled={editing!=="new"} value={form.foamGrade}
                  options={FOAM_GRADES.filter(v=>form.foamNature==="PURE"||["STD","SPE"].includes(v.value)).map(v=>({value:v.value,label:v.label}))}
                  onChange={v=>{setReferenceTouched(false);if(v==="SPE")setShowTechnicalExtras(true);setForm(prev=>({...prev,foamGrade:v}))}}/>
              </div>
              <label className="space-y-1 text-sm"><span className="font-medium">Densité (kg/m³) *</span>
                <Input disabled={editing!=="new"} aria-label="Densité kg/m³" type="number" min="0.001" max="500" step="0.001" value={form.foamDensity}
                  onChange={e=>{setReferenceTouched(false);setForm(prev=>({...prev,foamDensity:e.target.value}))}} placeholder="Ex. 30"/>
              </label>
              <div className="space-y-1 text-sm"><span className="font-medium">Couleur *</span>
                <SearchableCombobox label="Couleur de mousse" disabled={editing!=="new"} value={form.foamColor}
                  options={FOAM_COLORS.map(c=>({value:c.value,label:c.label}))} onChange={v=>{setReferenceTouched(false);setForm(prev=>({...prev,foamColor:v}))}}/>
              </div>
              <div className="space-y-1 text-sm"><span className="font-medium">Fermeté (si distinctive)</span>
                <SearchableCombobox label="Fermeté" disabled={editing!=="new"} value={form.foamFirmness}
                  options={FOAM_FIRMNESS.map(f=>({value:f.value,label:f.label}))} onChange={v=>{setReferenceTouched(false);setForm(prev=>({...prev,foamFirmness:v}))}}/>
              </div>
                  <div className="sm:col-span-2 mt-1 border-t border-slate-100 pt-3 text-sm font-semibold">Dimensions de référence <span className="font-normal text-slate-500">(cm)</span></div>
              <label className="space-y-1 text-sm"><span className="font-medium">Longueur {form.foamFormat==="ROULEAU"?"fixe (facultative)":"*"}</span>
                <Input disabled={editing!=="new"} aria-label="Longueur (cm)" type="number" min="0.001" max="5000" step="0.001" value={form.foamLengthCm}
                  onChange={e=>{setReferenceTouched(false);setForm(prev=>({...prev,foamLengthCm:e.target.value}))}} placeholder={form.foamFormat==="ROULEAU"?"Variable si vide":"200"}/>
              </label>
              <label className="space-y-1 text-sm"><span className="font-medium">Largeur (cm) *</span>
                <Input disabled={editing!=="new"} aria-label="Largeur (cm)" type="number" min="0.001" max="5000" step="0.001" value={form.foamWidthCm}
                  onChange={e=>{setReferenceTouched(false);setForm(prev=>({...prev,foamWidthCm:e.target.value}))}} placeholder="100"/>
              </label>
              <label className="space-y-1 text-sm"><span className="font-medium">{form.foamFormat==="BLOC"?"Hauteur (cm) *":"Épaisseur (cm) *"}</span>
                <Input disabled={editing!=="new"} aria-label={form.foamFormat==="BLOC"?"Hauteur (cm)":"Épaisseur (cm)"} type="number" min="0.001" max="5000" step="0.001"
                  value={form.foamFormat==="BLOC"?form.foamHeightCm:form.foamThicknessCm}
                  onChange={e=>{const key=form.foamFormat==="BLOC"?"foamHeightCm":"foamThicknessCm";setReferenceTouched(false);setForm(prev=>({...prev,[key]:e.target.value}))}} placeholder={form.foamFormat==="BLOC"?"50":"5"}/>
              </label>
              {editing==="new"&&foamErrors.length>0&&<p role="status" className="sm:col-span-2 text-xs text-amber-800">{foamErrors.slice(0,3).join(' · ')}</p>}
              {editing==="new"&&proposed&&<p className="sm:col-span-2 text-xs text-slate-600">Référence, nom et description prennent automatiquement en compte les dimensions, la fermeté et les autres attributs renseignés. Les prix, quantités et emplacements n'entrent jamais dans la référence.</p>}
                </div>
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/80">
                  <button type="button" aria-expanded={showTechnicalExtras} aria-controls="p59-foam-extras"
                    className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-left text-sm font-medium text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#bd202a]"
                    onClick={()=>setShowTechnicalExtras(v=>!v)}>
                    <span>Caractéristiques techniques complémentaires <span className="font-normal text-slate-500">(si distinctives)</span></span>
                    {showTechnicalExtras?<ChevronUp className="size-4 shrink-0"/>:<ChevronDown className="size-4 shrink-0"/>}
                  </button>
                  {showTechnicalExtras&&<div id="p59-foam-extras" className="grid grid-cols-1 gap-4 border-t border-slate-200 px-4 py-4 sm:grid-cols-2">
              <label className="space-y-1 text-sm"><span className="font-medium">Résilience (%) — facultatif</span>
                <Input disabled={editing!=="new"} aria-label="Résilience (%)" type="number" min="0.001" max="100" step="0.001" value={form.foamResilience}
                  onChange={e=>{setReferenceTouched(false);setForm(prev=>({...prev,foamResilience:e.target.value}))}} placeholder="Ex. 45"/>
              </label>
              <label className="space-y-1 text-sm"><span className="font-medium">Grade technique fournisseur {form.foamGrade==="SPE"?"*":"(si distinctif)"}</span>
                <Input disabled={editing!=="new"} aria-label="Grade technique fournisseur" maxLength={28} value={form.foamSupplierGrade}
                  onChange={e=>{setReferenceTouched(false);setForm(prev=>({...prev,foamSupplierGrade:e.target.value}))}} placeholder="Ex. HRX-30"/>
              </label>
                  </div>}
                </div>
              </section>
            )}

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="p59-identity-title">
              <div className="mb-4 flex items-start gap-3">
                <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#bd202a] text-xs font-bold text-white">{form.category==="Mousse"?"3":"2"}</span>
                <div>
                  <h3 id="p59-identity-title" className="text-sm font-semibold text-slate-900">Référence et désignation</h3>
                  <p className="mt-0.5 text-xs text-slate-500">Proposées automatiquement depuis les attributs distinctifs. Pour les matières hors mousse, la référence est calculée et non modifiable.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="min-w-0 space-y-1.5 text-sm sm:col-span-2">
                  <span className="font-medium">Référence article {editing==="new"?"(proposée)":""}</span>
                  <Input aria-label="Référence" value={displayRef} maxLength={160} disabled={editing!=="new"||form.category!=="Mousse"}
                    className="font-mono text-xs sm:text-sm" onChange={e=>{setReferenceTouched(true);setForm(prev=>({...prev,ref:e.target.value}))}}
                    placeholder="Générée une fois les attributs techniques renseignés"/>
                  {editing==="new"&&form.category==="Mousse"&&<div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="max-w-full text-xs text-slate-600" aria-live="polite">{suggestions.isFetching?"Recherche de référence…":suggestions.data?.duplicate?"Cette variante est déjà enregistrée : création bloquée.":referenceTouched?"Code personnalisé : contrôlé à l’enregistrement.":suggestions.isError?"Prévisualisation indisponible : le serveur proposera le code.":"Le code reprend les attributs distinctifs, dimensions incluses."}</p>
                    <Button type="button" variant="outline" size="sm" onClick={()=>{setReferenceTouched(false);queryClient.invalidateQueries({queryKey:["material-foam-ref"]})}}><RefreshCw className="size-3.5"/> Proposer une référence</Button>
                  </div>}
                </div>
                <div className="min-w-0 space-y-1.5 text-sm sm:col-span-2">
                  <span className="font-medium">Nom de matière *</span>
                  <Input aria-label="Nom de matière" value={displayName} maxLength={180}
                    onChange={e=>{setNameTouched(true);setForm(prev=>({...prev,name:e.target.value}))}}
                    placeholder="Désignation courte de l'article"/>
                  {editing==="new"&&form.category==="Mousse"&&<Button type="button" size="sm" variant="outline" onClick={()=>setNameTouched(false)}><RefreshCw className="size-3.5"/> Régénérer le nom</Button>}
                </div>
                <div className="min-w-0 space-y-1.5 text-sm sm:col-span-2">
                  <span className="font-medium">Description technique détaillée</span>
                  <Textarea aria-label="Description détaillée" rows={2} maxLength={900} value={displayDescription}
                    onChange={e=>{setDescriptionTouched(true);setForm(prev=>({...prev,description:e.target.value}))}}
                    placeholder="Description de la nature, de la densité et des dimensions" />
                  {editing==="new"&&form.category==="Mousse"&&<Button type="button" size="sm" variant="outline" onClick={()=>setDescriptionTouched(false)}><RefreshCw className="size-3.5"/> Régénérer la description</Button>}
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-emerald-200 bg-emerald-50/30 p-4 shadow-sm sm:p-5" aria-labelledby="article-functions-title">
              <h3 id="article-functions-title" className="text-sm font-semibold text-slate-900">Fonctions de l'article — achats, fabrication et vente</h3>
              <p className="mb-3 text-xs text-slate-600">Une seule référence, un seul stock. La vente directe ne déclenche aucune fabrication.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {([
                  ["isPurchasable","Achetable auprès d'un fournisseur"],
                  ["isManufactured","Fabricable en interne (GoProd futur)"],
                  ["isSellable","Vendable directement au client"],
                  ["isInternalUse","Utilisable en interne"],
                ] as const).map(([key,label])=><label key={key} className="flex items-start gap-2 rounded-md bg-white p-2 text-sm">
                  <input type="checkbox" className="mt-0.5 size-6 accent-emerald-700" checked={form[key]}
                    
                    onChange={e=>setForm(v=>({...v,[key]:e.target.checked}))}/><span>{label}</span></label>)}
              </div>
              {form.category==="Mousse"&&form.foamNature==="AGGLO"&&<p className="mt-2 text-xs text-amber-800">Mousse agglomérée : achat fournisseur interdit, fabrication interne requise. Décochez « Achetable ».</p>}
              {form.isSellable&&<div className="mt-3 grid gap-3 rounded-lg border bg-white p-3 sm:grid-cols-3">
                <label className="text-sm">Unité de vente
                  <select className="mt-1 h-10 w-full rounded-md border px-2" value={form.salesUnit} onChange={e=>setForm(v=>({...v,salesUnit:e.target.value,unitsPerSale:e.target.value===v.unit?"1":v.unitsPerSale}))}>
                    {MATERIAL_UNITS.map(u=><option key={u} value={u}>{u}</option>)}
                  </select>
                </label>
                <label className="text-sm">Unités de stock / unité vendue
                  <Input className="mt-1" type="number" min="0.001" step="any" value={form.unitsPerSale}
                    onChange={e=>setForm(v=>({...v,unitsPerSale:e.target.value}))}/>
                </label>
                <label className="text-sm">Tarif vente (MAD / unité vendue)
                  <Input className="mt-1" type="number" min="0" step="0.01" value={form.salesUnitPrice}
                    onChange={e=>setForm(v=>({...v,salesUnitPrice:e.target.value}))}/>
                </label>
                {editing!=null&&editing!=="new"&&editing.isSellable&&canEdit&&Number(form.salesUnitPrice)!==Number(editing.salesUnitPrice??0)&&<div className="sm:col-span-3 flex flex-wrap gap-2 items-center">
                  <Input aria-label="Motif proposition tarif vente" value={materialPriceReason} onChange={e=>setMaterialPriceReason(e.target.value)}/>
                  <Button type="button" size="sm" disabled={priceBusy||materialPriceReason.trim().length<10} onClick={async()=>{
                    setPriceBusy(true)
                    try{await api(`/api/materials/${editing.id}/sales-price`,{method:'POST',body:JSON.stringify({action:'propose',price:Number(form.salesUnitPrice),reason:materialPriceReason.trim()})});toast.success('Tarif soumis au directeur ; ancien tarif conservé');await queryClient.invalidateQueries({queryKey:['materials']})}
                    catch(e){toast.error(e instanceof Error?e.message:'Proposition refusée')}finally{setPriceBusy(false)}
                  }}>Proposer le tarif au directeur</Button>
                </div>}
                <p className="text-xs text-slate-600 sm:col-span-3">Conversion explicite obligatoire. Un tarif catalogue existant est modifié uniquement après validation du directeur ; aucun nouveau prix par simple enregistrement de fiche.</p>
              </div>}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="p59-stock-title">
              <div className="mb-4 flex items-start gap-3">
                <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#bd202a] text-xs font-bold text-white">{form.category==="Mousse"?"4":"3"}</span>
                <div>
                  <h3 id="p59-stock-title" className="text-sm font-semibold text-slate-900">Paramètres de suivi</h3>
                  <p className="mt-0.5 text-xs text-slate-500">La quantité initiale est toujours à zéro. Les entrées se font par réception ou inventaire validé.</p>
                </div>
              </div>
              <div className="max-w-sm space-y-1.5 text-sm">
                <span className="font-medium">Stock minimum <span className="font-normal text-slate-500">(facultatif)</span></span>
                <Input aria-label="Stock minimum" type="number" min="0" max="1000000000" step="any" value={form.minStock}
                  aria-invalid={!validNumeric(form.minStock)} onChange={e=>setForm(prev=>({...prev,minStock:e.target.value}))}/>
                <p className="text-xs text-slate-500">0 : aucun seuil d'alerte défini.</p>
                <span className="font-medium">Stock cible <span className="font-normal text-slate-500">(optionnel ; sinon égal au minimum)</span></span>
                <Input aria-label="Stock cible" type="number" min={form.minStock} max="1000000000" step="any" value={form.targetStock}
                  aria-invalid={form.targetStock.trim()!==""&&(!validNumeric(form.targetStock)||Number(form.targetStock)<Number(form.minStock))}
                  onChange={e=>setForm(prev=>({...prev,targetStock:e.target.value}))}/>
                <p className="text-xs text-slate-500">Déclenchement sous le minimum, proposition jusqu'à la cible en tenant compte des réservations et BC confirmés.</p>
              </div>
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/80">
                <button type="button" aria-expanded={showStockExtras} aria-controls="p59-stock-extras"
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-left text-sm font-medium text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#bd202a]"
                  onClick={()=>setShowStockExtras(v=>!v)}>
                  <span>Options complémentaires <span className="font-normal text-slate-500">(prix catalogue, emplacement)</span></span>
                  {showStockExtras?<ChevronUp className="size-4 shrink-0"/>:<ChevronDown className="size-4 shrink-0"/>}
                </button>
                {showStockExtras&&<div id="p59-stock-extras" className="grid gap-4 border-t border-slate-200 px-4 py-4 sm:grid-cols-2">
                  <div className="space-y-1.5 text-sm">
                    <span className="font-medium">Prix indicatif catalogue (MAD/{form.unit})</span>
                    <Input aria-label="Prix indicatif MAD" type="number" min="0" max="1000000000" step="any" value={form.unitPrice}
                      aria-invalid={!validNumeric(form.unitPrice)} onChange={e=>setForm(prev=>({...prev,unitPrice:e.target.value}))}/>
                    <p className="text-xs text-slate-500">Facultatif : 0 par défaut, pas un prix fournisseur validé.</p>
                  </div>
                  <div className="space-y-1.5 text-sm">
                    <span className="font-medium">Emplacement indicatif</span>
                    <SearchableCombobox label="Emplacement indicatif" value={form.location} options={locationOptions}
                      onChange={location=>setForm(prev=>({...prev,location}))} placeholder="Choisir un dépôt existant"/>
                    <p className="text-xs text-slate-500">Les emplacements sont gérés dans le pilotage du stock.</p>
                  </div>
                </div>}
              </div>
            </section>

            {editing!=="new"&&<div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
              <label className="space-y-1.5">
                <span className="font-medium">Motif de modification (8 caractères minimum) *</span>
                <Input aria-label="Motif de modification" maxLength={500} value={form.reason} onChange={e=>setForm(prev=>({...prev,reason:e.target.value}))}/>
              </label>
            </div>}
          </div>

          {/* Actions indépendantes du défilement, y compris sur petit écran. */}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-3 sm:px-7">
            <div className="min-w-0 flex-1 text-xs text-slate-600" role="status">
              {formValid
                ? <span className="inline-flex items-center gap-1.5 text-emerald-700"><CheckCircle2 className="size-4" aria-hidden="true"/> Fiche prête à enregistrer</span>
                : suggestions.data?.duplicate&&editing==="new"
                  ? <span className="text-rose-700">Variante déjà enregistrée : utilisez sa fiche existante.</span>
                  : <span>Complétez les champs obligatoires pour enregistrer.</span>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button type="button" variant="outline" onClick={()=>setEditing(null)}>Annuler</Button>
              <Button type="button" disabled={saving||!formValid} onClick={saveMaterial}>{saving?"Enregistrement…":editing==="new"?"Créer la matière":"Enregistrer"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MiniStat({
  label,
  value,
  tone = "slate",
}: {
  label: string
  value: string
  tone?: "slate" | "emerald" | "rose"
}) {
  const tones = {
    slate: "text-slate-900",
    emerald: "text-emerald-700",
    rose: "text-rose-700",
  }
  return (
    <Card className="border-slate-200">
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <p className={cn("mt-1 text-lg font-bold", tones[tone])}>{value}</p>
      </CardContent>
    </Card>
  )
}

// P5.7 — Rétablit les actions directes et colorées appréciées sur P5.5.
// Seules les actions autorisées sont visibles : aucune nouvelle permission n'est accordée.
// Les contrôles serveur restent la source d'autorité pour les opérations sensibles.
function daStatusLabel(status:string):string {
  return ({pending:'À valider',approved:'Validée',partially_approved:'Partiellement approuvée',rejected:'Refusée',ordered:'Commandée',partial:'Réception partielle',received:'Réceptionnée',closed:'Clôturée',cancelled:'Annulée'} as Record<string,string>)[status]??status
}

function MaterialRowActions({material,canEdit,canReceive,canMove,canBuy,daCount,onInspect,onEdit,onReceive,onMove,onBuy}:{
  material:MaterialDTO;canEdit:boolean;canReceive:boolean;canMove:boolean;canBuy:boolean;daCount:number;
  onInspect:()=>void;onEdit:()=>void;onReceive:()=>void;onMove:()=>void;onBuy:()=>void;
}) {
  const common="h-9 min-w-9 rounded-lg border shadow-sm transition-colors hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
  return (
    <div role="group" aria-label={`Actions sur la matière ${material.ref}`} className="flex flex-nowrap items-center justify-end gap-1.5">
      <Button type="button" size="sm" variant="outline"
        className={cn(common,"border-slate-200 bg-white px-2 text-slate-700 hover:border-slate-400 hover:bg-slate-50")}
        title="Consulter la fiche" aria-label={`Consulter la fiche ${material.ref}`} onClick={onInspect}>
        <Eye className="size-4" aria-hidden="true" />
      </Button>
      {canEdit && <Button type="button" size="sm" variant="outline"
        className={cn(common,"border-rose-200 bg-rose-50/60 px-2 text-[#bd202a] hover:border-rose-400 hover:bg-rose-100")}
        title="Modifier la fiche" aria-label={`Modifier la fiche ${material.ref}`} onClick={onEdit}>
        <Pencil className="size-4" aria-hidden="true" />
      </Button>}
      {canReceive && <Button type="button" size="sm" variant="outline"
        className={cn(common,"border-emerald-200 bg-emerald-50/60 px-2 text-emerald-700 hover:border-emerald-400 hover:bg-emerald-100")}
        title="Réception de matière" aria-label={`Réception de matière ${material.ref}`} onClick={onReceive}>
        <ArrowDownToLine className="size-4" aria-hidden="true" />
      </Button>}
      {canMove && <Button type="button" size="sm" variant="outline"
        className={cn(common,"border-amber-200 bg-amber-50/60 px-2 text-amber-800 hover:border-amber-400 hover:bg-amber-100")}
        title="Sortie de stock" aria-label={`Sortie de stock ${material.ref}`} onClick={onMove}>
        <ArrowUpFromLine className="size-4" aria-hidden="true" />
      </Button>}
      {canBuy && <Button type="button" size="sm" variant="outline"
        className={cn(common,"border-sky-200 bg-sky-50/60 px-2 text-sky-800 hover:border-sky-400 hover:bg-sky-100")}
        title={daCount>0?"Consulter les DA existantes avant une nouvelle demande":"Créer une demande d'achat"} aria-label={daCount>0?`Historique des DA de ${material.ref}`:`Créer une demande d'achat pour ${material.ref}`} onClick={onBuy}>
        <ShoppingCart className="size-4" aria-hidden="true" />
        <span className="text-xs font-semibold">DA{daCount>0?` (${daCount})`:""}</span>
      </Button>}
    </div>
  )
}
