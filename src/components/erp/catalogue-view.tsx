"use client";

import { useState } from "react"
import {
  ChevronLeft,
  ChevronRight,
  PackagePlus,
  Pencil,
  Search,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { fmtMAD, fmtNum, unitLabel, unitShort, type ProductDTO } from "@/lib/erp-types"
import { hasRole, type SessionActor } from "@/lib/role-navigation"
import { VariantTag } from "./bits"
import { useProducts, useProductFacets, useUpdateProduct } from "./hooks"
import { api } from "./hooks"
import { useQuery,useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

function UnitTag({ unit }: { unit: string }) {
  return (
    <Badge
      variant="outline"
      className={
        unit === "ml"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-violet-200 bg-violet-50 text-violet-700"
      }
    >
      /{unitShort(unit)}
    </Badge>
  )
}

export function CatalogueView({ onAddToOrder, searchTerm="" }: { onAddToOrder: (p: ProductDTO) => void; searchTerm?:string }) {
  // La commande n'est proposée qu'au rôle commercial : bouton désactivé et
  // expliqué plutôt que silencieusement ignoré.
  const session=useQuery({queryKey:["me"],queryFn:()=>api<SessionActor>("/api/me")})
  const canOrder=hasRole(session.data,"sales")
  const [q, setQ] = useState(searchTerm)
  const [page, setPage] = useState(1)
  // Ajustement pendant le rendu (pattern React officiel) au lieu d'un effet :
  // la recherche externe pilotée par searchTerm réinitialise filtre et pagination.
  const [prevSearchTerm, setPrevSearchTerm] = useState(searchTerm)
  if (prevSearchTerm !== searchTerm) {
    setPrevSearchTerm(searchTerm)
    setQ(searchTerm)
    setPage(1)
  }
  const [family, setFamily] = useState("all")
  const [model, setModel] = useState("all")
  const [variant, setVariant] = useState("all")
  const [subCategory, setSubCategory] = useState("all")
  const [coreType,setCoreType]=useState("all")
  const [foamComposition,setFoamComposition]=useState("all")
  const [foamNature,setFoamNature]=useState("all")
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const facets = useProductFacets()
  const { data, isPending } = useProducts({
    q,
    family: family === "all" ? "" : family,
    model: model === "all" ? "" : model,
    variant: variant === "all" ? "" : variant,
    subCategory: subCategory === "all" ? "" : subCategory,
    coreType: coreType === "all" ? "" : coreType,
    foamComposition: foamComposition === "all" ? "" : foamComposition,
    foamNature: foamNature === "all" ? "" : foamNature,
    page,
  })
  const products = data?.items ?? []
  const fam = facets.data?.families.find((f) => f.family === family)
  const famVariants = fam?.variants ?? []

  // Réinitialiser modèle/variante quand la famille change
  function setFamilyReset(v: string) {
    setFamily(v)
    setModel("all")
    setVariant("all")
    setSubCategory("all")
    setCoreType("all")
    setFoamComposition("all")
    setFoamNature("all")
    setPage(1)
  }

  return (
    <div className="space-y-4">
      <Card className="border-slate-200">
        <CardHeader className="gap-4 pb-4 sm:flex-row sm:items-center sm:justify-between">
          {/* V18.9.10 (UX-040) : CardTitle supprimé — le H1 de page suffit ;
              la description et les filtres restent dans l'en-tête de carte. */}
          <div>
            <CardDescription className="sm:max-w-2xl">
              Banquettes, gaufrettes et salons au mètre linéaire ; matelas et plaques de mousse à la pièce (plaques : hypothèse de simulation).
              Tarifs fictifs de démonstration (MAD), modifiables dans la commande.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setPage(1)
                }}
                placeholder="SKU, modèle, dims…"
                className="w-full pl-8 sm:w-56"
                aria-label="Rechercher un produit"
              />
            </div>
            <Select value={family} onValueChange={setFamilyReset}>
              <SelectTrigger className="w-full sm:w-40" aria-label="Famille">
                <SelectValue placeholder="Famille" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes familles</SelectItem>
                {(facets.data?.families ?? []).map((f) => (
                  <SelectItem key={f.family} value={f.family}>
                    {f.family} ({f.models.length})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {family !== "all" && (
              <Select
                value={model}
                onValueChange={(v) => {
                  setModel(v)
                  setPage(1)
                }}
              >
                <SelectTrigger className="w-full sm:w-44" aria-label="Modèle">
                  <SelectValue placeholder="Modèle" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous modèles</SelectItem>
                  {(fam?.models ?? []).map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {family !== "all" && (fam?.subCategories?.length ?? 0) > 1 && (
              <Select value={subCategory} onValueChange={(v) => { setSubCategory(v); setPage(1) }}>
                <SelectTrigger className="w-full sm:w-40" aria-label="Sous-catégorie">
                  <SelectValue placeholder="Sous-catégorie" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes catégories</SelectItem>
                  {(fam?.subCategories ?? []).map((sc) => <SelectItem key={sc} value={sc}>{sc}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {family !== "all" && !!fam?.coreTypes?.length && <Select value={coreType} onValueChange={v=>{setCoreType(v);setPage(1)}}><SelectTrigger className="w-full sm:w-40" aria-label="Type de noyau"><SelectValue placeholder="Noyau"/></SelectTrigger><SelectContent><SelectItem value="all">Tous noyaux</SelectItem>{fam.coreTypes.map(v=><SelectItem key={v} value={v}>{({SANS_RESSORTS:"Sans ressorts",BONNELL:"Bonnell",ENSACHES:"Ensachés"} as Record<string,string>)[v]||v}</SelectItem>)}</SelectContent></Select>}
            {family !== "all" && !!fam?.foamCompositions?.length && <Select value={foamComposition} onValueChange={v=>{setFoamComposition(v);setPage(1)}}><SelectTrigger className="w-full sm:w-40" aria-label="Composition mousse"><SelectValue placeholder="Mousse"/></SelectTrigger><SelectContent><SelectItem value="all">Toutes mousses</SelectItem>{fam.foamCompositions.map(v=><SelectItem key={v} value={v}>{({PURE:"100 % pure",MELANGE:"Mélange",AGGLO:"100 % agglo"} as Record<string,string>)[v]||v}</SelectItem>)}</SelectContent></Select>}
            {family !== "all" && !!fam?.foamNatures?.length && <Select value={foamNature} onValueChange={v=>{setFoamNature(v);setPage(1)}}><SelectTrigger className="w-full sm:w-40" aria-label="Nature mousse"><SelectValue placeholder="Nature"/></SelectTrigger><SelectContent><SelectItem value="all">Toutes natures</SelectItem>{fam.foamNatures.map(v=><SelectItem key={v} value={v}>{v==="PURE"?"Pure":"Agglomérée"}</SelectItem>)}</SelectContent></Select>}
            {family !== "all" && famVariants.length > 1 && (
              <Select
                value={variant}
                onValueChange={(v) => {
                  setVariant(v)
                  setPage(1)
                }}
              >
                <SelectTrigger className="w-28" aria-label="Variante">
                  <SelectValue placeholder="Var." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes</SelectItem>
                  {famVariants.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v === "STD" ? "Standard" : v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="pb-3 text-sm text-slate-500">
            {isPending ? "…" : `${fmtNum(data?.total ?? 0, 0)} produits — page ${data?.page ?? 1}/${data?.pages ?? 1}`}
          </p>
          {isPending ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[980px] xl:min-w-0">
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Produit</TableHead>
                    <TableHead>Var.</TableHead>
                    <TableHead className="text-right">Dimensions (cm)</TableHead>
                    <TableHead className="text-center">Unité</TableHead>
                    <TableHead className="text-right">Prix indicatif</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((p) => (
                    <TableRow
                      key={p.id}
                      className="cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
                      // P5.15.21 (UX-002) : ligne opérable au clavier — focus,
                      // rôle et activation Entrée/Espace, comme un bouton.
                      tabIndex={0}
                      role="button"
                      aria-label={`Ouvrir la fiche de ${p.name}`}
                      onClick={() => setSelectedId(p.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault()
                          setSelectedId(p.id)
                        }
                      }}
                    >
                      <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                      <TableCell className="max-w-72 truncate font-medium text-slate-800">
                        {p.name}
                      </TableCell>
                      <TableCell><VariantTag variant={p.variant} /></TableCell>
                      <TableCell className="text-right text-slate-600 tabular-nums">
                        {p.materialId!=null?"Article stock":`${p.length}×${p.width}×${p.height}`}
                      </TableCell>
                      <TableCell className="text-center">
                        <UnitTag unit={p.unit} />
                      </TableCell>
                      <TableCell className="text-right font-bold tabular-nums text-slate-900">
                        {p.family === "MATELAS" && p.unitPrice === 0 ? "Prix à définir" : fmtMAD(p.unitPrice)}
                        <span className="text-xs font-normal text-slate-500"> /{unitShort(p.unit)}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1 border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100"
                          disabled={!canOrder}
                          title={canOrder?"Ajouter à la commande":"Réservé au rôle commercial"}
                          aria-label={canOrder?`Commander ${p.name}`:"Commande réservée au rôle commercial"}
                          onClick={(e) => {
                            e.stopPropagation()
                            onAddToOrder(p)
                          }}
                        >
                          <PackagePlus className="size-4" />
                          <span className="hidden lg:inline">Commander</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {products.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-10 text-center text-slate-500">
                        Aucun produit ne correspond aux filtres.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Pagination */}
          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs text-slate-500">24 produits par page</p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={(data?.page ?? 1) <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Page précédente"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="text-sm font-medium tabular-nums text-slate-700">
                {data?.page ?? 1} / {data?.pages ?? 1}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={(data?.page ?? 1) >= (data?.pages ?? 1)}
                onClick={() => setPage((p) => p + 1)}
                aria-label="Page suivante"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Fiche produit */}
      <ProductSheet
        productId={selectedId}
        onClose={() => setSelectedId(null)}
        onAddToOrder={(p) => {
          onAddToOrder(p)
          setSelectedId(null)
        }}
      />
    </div>
  )
}

function ProductSheet({
  productId,
  onClose,
  onAddToOrder,
}: {
  productId: number | null
  onClose: () => void
  onAddToOrder: (p: ProductDTO) => void
}) {
  const { data, isPending } = useQuery({
    queryKey: ["product", productId],
    queryFn: () => api<ProductDTO>(`/api/products/${productId}`),
    enabled: productId != null,
  })

  return (
    <Sheet open={productId != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="pb-2">
          <SheetTitle className="pr-6 text-lg">{data?.name ?? "Chargement…"}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-2">
            {data && (
              <>
                <Badge variant="outline" className="border-slate-200 font-mono text-[11px]">
                  {data.sku}
                </Badge>
                <VariantTag variant={data.variant} />
                <span className="text-slate-500">
                  {data.materialId!=null?"Article lié au stock":`${data.length}×${data.width}×${data.height} cm`}
                </span>
                <UnitTag unit={data.unit} />
              </>
            )}
          </SheetDescription>
        </SheetHeader>

        {isPending || !data ? (
          <div className="space-y-2 px-4 pb-8">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 rounded-lg" />
            ))}
          </div>
        ) : (
          <ProductForm key={data.id} product={data} onAddToOrder={onAddToOrder} />
        )}
      </SheetContent>
    </Sheet>
  )
}

// Monté avec key={product.id} : le formulaire s'initialise directement
// depuis le produit (pas d'effet de synchronisation nécessaire).
function ProductForm({
  product,
  onAddToOrder,
}: {
  product: ProductDTO
  onAddToOrder: (p: ProductDTO) => void
}) {
  const update = useUpdateProduct()
  const session=useQuery({queryKey:["me"],queryFn:()=>api<SessionActor>("/api/me")})
  const canEdit=hasRole(session.data,"approver")
  const canDecidePrice=hasRole(session.data,"director")
  const qc=useQueryClient()
  const [priceBusy,setPriceBusy]=useState(false)
  const [revisionBusy,setRevisionBusy]=useState(false)
  const [revisionReason,setRevisionReason]=useState("")
  const [revisionModel,setRevisionModel]=useState(product.model)
  const [revisionDims,setRevisionDims]=useState({length:product.length,width:product.width,height:product.height})
  const [revisionDensity,setRevisionDensity]=useState(product.foamDensity==null?"":String(product.foamDensity))
  const revisions=useQuery({queryKey:["pf-revisions",product.id],queryFn:()=>api<{items:{id:number;sku:string;status:string;revisionNumber:number;revisionRequestedBy:string|null}[]}>(`/api/products/${product.id}/revision`),enabled:product.materialId==null})
  async function revisionAction(id:number,action:"approve"|"reject"){
    setRevisionBusy(true)
    try {await api(`/api/products/${id}/revision`,{method:"POST",body:JSON.stringify({action,reason:revisionReason.trim()})})
      toast.success(action==="approve"?"Révision technique approuvée":"Révision technique refusée")
      await qc.invalidateQueries({queryKey:["pf-revisions",product.id]});await qc.invalidateQueries({queryKey:["products"]})
    }catch(e){toast.error(e instanceof Error?e.message:"Révision non validée")}
    finally{setRevisionBusy(false)}
  }
  async function proposeRevision(){
    setRevisionBusy(true)
    const changes:Record<string,unknown>={model:revisionModel.trim(),...revisionDims}
    if(product.foamDensity!=null&&revisionDensity.trim()!=="")changes.foamDensity=Number(revisionDensity.replace(",","."))
    try{await api(`/api/products/${product.id}/revision`,{method:"POST",body:JSON.stringify({action:"propose",reason:revisionReason.trim(),changes})})
      toast.success("Nouvelle révision proposée ; elle n'est pas encore vendable")
      await qc.invalidateQueries({queryKey:["pf-revisions",product.id]})
    }catch(e){toast.error(e instanceof Error?e.message:"Révision refusée")}
    finally{setRevisionBusy(false)}
  }
  const [minStock,setMinStock]=useState(String(product.minStock??0))
  const [targetStock,setTargetStock]=useState(product.targetStock==null?"":String(product.targetStock))
  const [targetReason,setTargetReason]=useState("")
  const [priceInput, setPriceInput] = useState(String(product.unitPrice))
  const [priceReason,setPriceReason]=useState("")
  const [unitInput, setUnitInput] = useState<"ml" | "u" | "kg">(product.unit === "kg" ? "kg" : product.unit === "ml" ? "ml" : "u")
  const [shortName,setShortName] = useState(product.commercialAbbreviation ?? "")
  const [brand,setBrand] = useState(product.commercialBrand ?? "")
  const [manufacturer,setManufacturer] = useState(product.actualManufacturer ?? "")
  const [designation,setDesignation] = useState(product.descriptionOverride ?? "")
  const [catalogueReason,setCatalogueReason] = useState("")
  const commercialDirty = shortName !== (product.commercialAbbreviation ?? "") || brand !== (product.commercialBrand ?? "") || manufacturer !== (product.actualManufacturer ?? "") || designation !== (product.descriptionOverride ?? "")

  const priceDirty = Number(priceInput.replace(",", ".")) !== product.unitPrice
  const unitDirty = unitInput !== product.unit
  const priceNum = Number(priceInput.replace(",", "."))
  const canSave = priceDirty && Number.isFinite(priceNum) && priceNum>=0 &&
    Math.abs(priceNum*100-Math.round(priceNum*100))<1e-6 && priceReason.trim().length>=10 && !priceBusy
  async function priceAction(action:"propose"|"approve"|"reject"){
    setPriceBusy(true)
    try {
      await api(`/api/products/${product.id}/catalog-price`,{method:"POST",body:JSON.stringify(action==="propose"
        ?{action,price:priceNum,reason:priceReason.trim()}
        :{action,revision:product.catalogPriceProposalRevision??0,reason:priceReason.trim()})})
      toast.success(action==="propose"?"Proposition transmise au directeur":action==="approve"?"Nouveau tarif validé":"Proposition tarifaire refusée")
      await qc.invalidateQueries({queryKey:["products"]})
    } catch(e){toast.error(e instanceof Error?e.message:"Décision tarifaire refusée")}
    finally{setPriceBusy(false)}
  }

  return (
    <div className="space-y-5 px-4 pb-8">
            {/* Caractéristiques */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Info label="Famille" value={product.family} />
              <Info label="Modèle" value={product.model} />
              {product.family !== "OUATE" && product.materialId==null && <Info label="Dimensions" value={`${product.length}×${product.width}×${product.height} cm`} />}
              <Info label="Unité de vente" value={`par ${unitLabel(product.unit)}`} />
            </div>

            {(product.family==="MATELAS"||product.family==="BANQUETTE") && <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="font-semibold text-slate-700">Composition technique du noyau</p>
              <div className="mt-2 grid grid-cols-2 gap-2"><Info label="Noyau" value={({SANS_RESSORTS:"Sans ressorts",BONNELL:"Ressorts Bonnell",ENSACHES:"Ressorts ensachés"} as Record<string,string>)[product.coreType??""]||"À qualifier"}/>
              <Info label="Mousse" value={({PURE:"100 % pure",MELANGE:"Pure + agglomérée",AGGLO:"100 % agglomérée"} as Record<string,string>)[product.foamComposition??""]||"À qualifier"}/>
              <Info label={product.family==="MATELAS"?"Finition matelas":"Habillage"} value={product.family==="MATELAS"?(({SANS:"Sans",TOPPER:"Topper",ALESE:"Alèse"} as Record<string,string>)[product.mattressFinish??""]||"—"):(({NUE:"Nue",TISSU:"Avec tissu"} as Record<string,string>)[product.upholstery??""]||"—")}/>
              <Info label="Densité mousse" value={product.foamDensity?`${product.foamDensity} kg/m³`:product.foamLayers?"Détails par couche":"Non saisie"}/></div>
              {product.foamLayers && <p className="mt-2 text-xs">Mélange : densités et épaisseurs enregistrées séparément par couche.</p>}
            </div>}
            {product.family==="PLAQUE_MOUSSE" && <div className="rounded-lg border border-violet-100 bg-violet-50 p-3 text-sm"><p className="font-semibold">Caractéristiques de la plaque</p><div className="mt-2 grid grid-cols-2 gap-2"><Info label="Nature" value={product.foamNature==="PURE"?"Mousse pure":product.foamNature==="AGGLO"?"Mousse agglomérée":"—"}/><Info label="Type / qualité" value={product.foamGrade||"—"}/><Info label="Densité" value={product.foamDensity?`${product.foamDensity} kg/m³`:"—"}/><Info label="Volume" value={`${(product.length*product.width*product.height/1000000).toFixed(3)} m³`}/></div></div>}
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 space-y-3">
              <p className="font-semibold text-sm">Identification commerciale · distincte du code produit</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1"><Label>Abréviation modifiable</Label><Input maxLength={24} value={shortName} onChange={e=>setShortName(e.target.value)} placeholder="Ex. BTRATH"/><Button type="button" size="sm" variant="outline" onClick={()=>setShortName(product.model.replace(/[^a-zA-Z0-9]/g,"").slice(0,8).toUpperCase())}>Proposer une abréviation</Button></div>
                <div className="space-y-1"><Label>Marque commerciale</Label><Input maxLength={120} value={brand} onChange={e=>setBrand(e.target.value)}/></div>
                <div className="space-y-1"><Label>Fabricant réel</Label><Input maxLength={120} value={manufacturer} onChange={e=>setManufacturer(e.target.value)}/></div>
                <div className="space-y-1"><Label>Désignation proposée / modifiable</Label><Input maxLength={200} value={designation} onChange={e=>setDesignation(e.target.value)} placeholder={product.name}/></div>
              </div>
              <Label>Motif de la modification commerciale</Label><Input maxLength={500} value={catalogueReason} onChange={e=>setCatalogueReason(e.target.value)} placeholder="Ex. Référentiel commercial validé" />
              <Button type="button" size="sm" disabled={!canEdit || !commercialDirty || catalogueReason.trim().length<8 || update.isPending} onClick={()=>update.mutate({id:product.id,reason:catalogueReason.trim(),commercialAbbreviation:shortName,commercialBrand:brand,actualManufacturer:manufacturer,descriptionOverride:designation})}>Enregistrer l'identité commerciale</Button>
              <p className="text-xs text-slate-600">Le SKU technique reste stable. Aucun suffixe C/S n'est imposé. Modification journalisée et réservée au responsable. {canEdit ? "" : "Compte sans droit de modification."}</p>
            </div>
            {product.materialId==null&&<div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3.5">
              <p className="text-sm font-semibold">Réapprovisionnement — seuil minimum et stock cible</p>
              <div className="grid grid-cols-2 gap-3"><div><Label>Minimum ({unitShort(product.unit)})</Label>
                <Input type="number" min="0" step={product.unit==="u"?"1":"0.001"} value={minStock} onChange={e=>setMinStock(e.target.value)}/></div>
                <div><Label>Stock cible ({unitShort(product.unit)})</Label>
                <Input type="number" min={minStock} step={product.unit==="u"?"1":"0.001"} placeholder="= minimum si vide" value={targetStock} onChange={e=>setTargetStock(e.target.value)}/></div></div>
              <Label>Motif du paramétrage</Label><Input value={targetReason} onChange={e=>setTargetReason(e.target.value)} placeholder="Ex. Stock de sécurité de la gamme"/>
              <Button size="sm" variant="outline" disabled={!canEdit||targetReason.trim().length<8||!Number.isFinite(Number(minStock))||Number(minStock)<0||(targetStock.trim()!==""&&Number(targetStock)<Number(minStock))||update.isPending}
                onClick={()=>update.mutate({id:product.id,reason:targetReason.trim(),minStock:Number(minStock),targetStock:targetStock.trim()===""?null:Number(targetStock)})}>Enregistrer les seuils</Button>
              <p className="text-xs text-slate-600">Pour les familles sans suivi physique des lots et livraisons, l’alerte est mise en attente de ce raccordement : aucune quantité n’est inventée.</p>
            </div>}
            {product.materialId==null&&product.status==="active"&&<div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3.5">
              <p className="text-sm font-semibold">Révision technique du produit fini</p>
              <p className="text-xs text-slate-700">La référence utilisée reste figée. Une nouvelle fiche, avec une nouvelle référence et aucun stock hérité, doit être validée par un directeur distinct du demandeur.</p>
              {product.revisionOfId!=null&&<p className="text-xs">Révision n° {product.revisionNumber} · origine #{product.revisionOfId}</p>}
              {canEdit&&<div className="grid grid-cols-3 gap-2">
                <div className="col-span-3"><Label>Modèle</Label><Input value={revisionModel} onChange={e=>setRevisionModel(e.target.value)}/></div>
                {(["length","width","height"] as const).map(field=><div key={field}><Label>{({length:"Longueur",width:"Largeur",height:"Hauteur"})[field]} (cm)</Label><Input type="number" min="1" max="1500" value={revisionDims[field]} onChange={e=>setRevisionDims(x=>({...x,[field]:Number(e.target.value)}))}/></div>)}
                {product.foamDensity!=null&&<div className="col-span-3"><Label>Densité (kg/m³)</Label><Input type="number" min="1" max="500" value={revisionDensity} onChange={e=>setRevisionDensity(e.target.value)}/></div>}
              </div>}
              <div><Label>Justification technique (12 caractères minimum)</Label><Input maxLength={500} value={revisionReason} onChange={e=>setRevisionReason(e.target.value)} placeholder="Modification dimensions / densité / conception"/></div>
              {canEdit&&<Button size="sm" variant="outline" disabled={revisionBusy||revisionReason.trim().length<12} onClick={()=>void proposeRevision()}>Proposer une nouvelle révision</Button>}
              {revisions.data?.items.map(r=><div key={r.id} className="rounded border bg-white p-2 text-xs"><p>Révision {r.revisionNumber} · {r.sku} · {r.status} · demandeur : {r.revisionRequestedBy??"—"}</p>
                {canDecidePrice&&r.status==="pending_validation"&&<div className="mt-2 flex gap-2"><Button size="sm" disabled={revisionBusy||revisionReason.trim().length<12} onClick={()=>void revisionAction(r.id,"approve")}>Approuver</Button><Button size="sm" variant="outline" disabled={revisionBusy||revisionReason.trim().length<12} onClick={()=>void revisionAction(r.id,"reject")}>Refuser</Button></div>}
              </div>)}
            </div>}
            {/* Saisie du prix indicatif */}
            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3.5">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Pencil className="size-4 text-violet-600" />
                Prix de vente indicatif (saisi)
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pp-price">Prix par {unitLabel(unitInput)} (MAD)</Label>
                  <Input
                    id="pp-price"
                    inputMode="decimal"
                    value={priceInput}
                    onChange={(e) => setPriceInput(e.target.value)}
                    className="tabular-nums"
                    placeholder="ex. 450"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pp-unit">Unité de vente</Label>
                  <Select value={unitInput} onValueChange={(v) => setUnitInput(v as "ml" | "u" | "kg")} disabled>
                    <SelectTrigger id="pp-unit" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ml">Mètre linéaire (ml)</SelectItem>
                      <SelectItem value="u">Unité</SelectItem><SelectItem value="kg">Kilogramme</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {product.materialId!=null&&<p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">Article de négoce lié à la fiche matière. Tarif et unité de vente : à modifier depuis la fiche article, avec motif d'audit.</p>}
              <p className="text-xs text-slate-500">
                Unité imposée pour le scénario : banquette, gaufrette et salon = ml ; matelas et plaque = unité ; ouate = kg. Les prix chargés pour les salons et les matelas sont fictifs : ils servent uniquement aux essais.
              </p>
              <p className="text-xs text-slate-500">
                Ce prix de démonstration pré-remplit la saisie de commande et reste ajustable ligne par ligne
                (ex. matelas facturé selon ses dimensions).
              </p>
              <div className="space-y-1"><Label htmlFor="pp-reason">Motif de changement de tarif (obligatoire)</Label><Input id="pp-reason" value={priceReason} onChange={e=>setPriceReason(e.target.value)} placeholder="Ex. Nouveau tarif validé par les achats"/></div>
              {product.pendingCatalogUnitPrice!=null&&<p className="rounded border border-amber-300 bg-amber-50 p-2 text-sm">Proposition en attente : {fmtMAD(product.pendingCatalogUnitPrice)} /{unitShort(product.unit)}. Le tarif actuel reste inchangé jusqu’au visa directeur.</p>}
              {canEdit&&product.pendingCatalogUnitPrice==null&&<Button size="sm" variant="primary" className="gap-1.5"
                disabled={!canSave || product.materialId!=null} onClick={()=>void priceAction("propose")}>
                <Pencil className="size-4"/>{priceBusy?"Transmission…":"Proposer au directeur"}
              </Button>}
              {canDecidePrice&&product.pendingCatalogUnitPrice!=null&&<div className="flex gap-2">
                <Button size="sm" disabled={priceBusy||priceReason.trim().length<10} onClick={()=>void priceAction("approve")}>Valider le prix</Button>
                <Button size="sm" variant="outline" disabled={priceBusy||priceReason.trim().length<10} onClick={()=>void priceAction("reject")}>Refuser</Button>
              </div>}
              <p className="text-xs text-slate-600">Les commandes déjà confirmées conservent leur prix contractuel. Le commercial ne peut pas changer le catalogue.</p>
            </div>

            <Button
              variant="primary" className="w-full gap-2"
              onClick={() => onAddToOrder(product)}
            >
              <PackagePlus className="size-4" />
              Ajouter à une commande
            </Button>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 truncate text-sm font-bold text-slate-900">{value}</p>
    </div>
  )
}
