"use client";

import { useEffect, useState } from "react"
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query"
import { AnimatePresence, motion } from "framer-motion"
import { Bell, LogOut, Menu, Search, User } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { SodepiSymbol } from "@/components/branding/sodepi-logo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Toaster } from "@/components/ui/sonner"
import { fmtNum, type MaterialDTO, type ProductDTO } from "@/lib/erp-types"

import { CatalogueView } from "./catalogue-view"
import { DashboardView } from "./dashboard-view"
import { BuyerWorkbenchView } from "./buyer-workbench-view"
import {BuyerJourney,BUYER_WORK_VIEWS} from "./buyer-journey"
import { MaterialLevelBadge } from "./bits"
import { MovementDialog, type MovementPreset } from "./movement-dialog"
import { MovementsView } from "./movements-view"
import { MaterialsView } from "./materials-view"
import { StockPlanningPanel } from "./stock-planning-panel"
import { MtsMaterialReceiptsPanel } from "./mts-material-receipts-panel"
import { MtsMaterialCostPanel } from "./mts-material-cost-panel"
import { MtsReworkPanel } from "./mts-rework-panel"
import { MtsFinishedReceiptsPanel } from "./mts-finished-receipts-panel"
import { FinishedQualityPanel } from "./finished-quality-panel"
import { NavSidebar, type ViewId } from "./nav-sidebar"
import { TopNavigation } from "./top-navigation"
import { NewOrderDialog } from "./new-order-dialog"
import { OrdersView } from "./orders-view"
import { PurchaseDialog } from "./purchase-dialog"
import { PurchasesView } from "./purchases-view"
import { useDashboard, api } from "./hooks"
import { visibleViews, hasRole, type SessionActor } from "@/lib/role-navigation"
import { SupplyChainView } from "./supply-chain-view"
import { P2PControlView } from "./p2p-control-view"
import { P2PAdvancedView } from "./p2p-advanced-view"
import { SalesView } from "./sales-view"
import { UsersAdminView } from "./users-admin-view"
import { PasswordChangeView } from "./password-change-view"

// V18.9.10 (UX-013) : vues valides pour la synchronisation ?vue=… (l'URL
// reste une SPA sans route serveur ; replaceState uniquement, réversible).
const ALL_VIEWS: ViewId[] = ["buyer-workbench","production-planning","dashboard","materials","catalogue","movements","orders","purchases","suppliers","supplier-orders","goods-receipts","stock-lots","supplier-invoices","p2p-advanced","sales-quotes","sales-deliveries","sales-invoices","users","my-account"]

const TITLES: Record<ViewId, { title: string; desc: string }> = {
  "production-planning": {title:"Fabrication pour stock",desc:"Propositions, OF-MTS, reception magasin et visa qualite"},
  "buyer-workbench": {title:"Mes actions achats",desc:"Vos priorités : ruptures à acheter, dossiers en suivi et besoins de fabrication distincts"},
  "my-account":{title:"Mon mot de passe",desc:"Modifier vos identifiants personnels"},
  users:{title:"Administration des utilisateurs",desc:"Comptes individuels, fonctions cumulées, autorisations et historique des changements"},
  dashboard: {
    title: "Tableau de bord",
    desc: "Pilotage temps réel du stock et des commandes",
  },
  materials: {
    title: "Matières premières",
    desc: "Mousses, tissus, mercerie et emballage — seuils et valorisation",
  },
  catalogue: {
    title: "Catalogue produits",
    desc: "Banquettes, gaufrettes et salons au ml ; matelas à la pièce",
  },
  movements: {
    title: "Mouvements de stock",
    desc: "Journal des entrées, sorties et consommations atelier",
  },
  "sales-quotes":{title:"Devis clients",desc:"Émission, acceptation et transformation des devis en commandes avec pièces et gabarits"},
  "sales-deliveries":{title:"Bons de livraison clients",desc:"Livraisons totales ou partielles, chaque pièce identifiée une seule fois"},
  "sales-invoices":{title:"Factures clients et règlements",desc:"BL rapprochés, taxes paramétrables, avoirs, règlements et soldes en MAD"},
  orders: {
    title: "Commandes clients",
    desc: "Saisie, lancement en production et expédition",
  },
  purchases: { title: "Demandes d'achat", desc: "Besoins internes à valider avant création de BC" },
  suppliers: { title: "Fournisseurs", desc: "Fiches fournisseurs et tarifs par matière première" },
  "supplier-orders": { title: "Bons de commande fournisseurs", desc: "Créer les BC depuis les DA validées, éventuellement chez plusieurs fournisseurs" },
  "goods-receipts": { title: "Bons de réception MP", desc: "Rapprochement BL/BC, réceptions partielles et stock accepté" },
  "stock-lots": { title: "Lots & contrôles qualité", desc: "Libération, quarantaine et retours fournisseur" },
  "p2p-advanced": { title: "Pilotage achats avancé", desc: "Consultations, fournisseurs, dépôts, litiges et avoirs — GoCmd autonome" },
  "supplier-invoices": { title: "Factures fournisseurs", desc: "Rapprochement BC–BR–Facture et suivi de paiement" },
}

const BUYER_TITLES:Partial<Record<ViewId,{title:string;desc:string}>>={
 "buyer-workbench":{title:"Mes actions achats",desc:"Ruptures, besoins, dossiers en attente et prochains gestes"},
 materials:{title:"Matières & besoins",desc:"Stock, seuils, unités et fournisseurs : préparer les besoins d'achat"},
 purchases:{title:"Suivi des demandes d'achat (DA)",desc:"Exprimer les besoins et suivre les approbations sans les effectuer soi-même"},
 suppliers:{title:"Fournisseurs référencés",desc:"Identifier et comparer les fournisseurs actifs et leurs articles"},
 "p2p-advanced":{title:"Consultations & offres",desc:"Consulter les fournisseurs, collecter les devis et transmettre le choix à l'approbateur"},
 "supplier-orders":{title:"Commandes fournisseurs (BC)",desc:"Préparer et suivre les commandes avec une DA et un prix autorisés"},
 "goods-receipts":{title:"Suivi des réceptions (BR)",desc:"Voir les livraisons reçues, les écarts et les reliquats — saisie réservée au réceptionnaire"},
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
  },
})

export function ErpApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <ErpShell />
    </QueryClientProvider>
  )
}

export default ErpApp

function ErpShell() {
  // V18.9.10 (UX-013) : la vue est relue depuis ?vue=… au chargement et
  // resynchronisée à chaque changement (history.replaceState — aucun
  // historique parasite, F5 et liens partageables conservent la vue).
  const [view, setView] = useState<ViewId>(() => {
    if (typeof window !== "undefined") {
      const requested = new URLSearchParams(window.location.search).get("vue") as ViewId | null
      if (requested && ALL_VIEWS.includes(requested)) return requested
    }
    return "dashboard"
  })
  const [explicitInitialView] = useState(() => typeof window!=="undefined" && new URLSearchParams(window.location.search).has("vue"))
  const [navOpen, setNavOpen] = useState(false)
  const [globalSearch, setGlobalSearch] = useState("")
  const [mobileSearchOpen,setMobileSearchOpen]=useState(false)

  // Dialogues
  const [receiptPrefillMaterialId, setReceiptPrefillMaterialId] = useState<number | null>(null)
  const [movementTarget, setMovementTarget] = useState<MaterialDTO | null>(null)
  const [movementPreset, setMovementPreset] = useState<MovementPreset>("in")
  const [purchasePrefill, setPurchasePrefill] = useState<MaterialDTO | null>(null)
  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [orderOpen, setOrderOpen] = useState(false)
  const [orderPresetProduct, setOrderPresetProduct] = useState<ProductDTO | null>(null)

  const session = useQuery({queryKey:["me"],queryFn:()=>api<SessionActor>("/api/me"),retry:0,staleTime:60_000})
  const allowedViews = visibleViews(session.data)
  const dashboard = useDashboard(Boolean(session.data && allowedViews.includes("dashboard")))
  const canBuy = hasRole(session.data,"buyer")
  useEffect(()=>{
    if(session.data && !explicitInitialView && hasRole(session.data,"buyer"))setView(current=>current==="dashboard"?"buyer-workbench":current)
  },[session.data,explicitInitialView])
  const canSell = hasRole(session.data,"sales")
  const buyerMode = canBuy
  const alerts = dashboard.data?.alertsList ?? []

  // V18.9.10 (UX-013) : garde RBAC côté interface — une vue demandée par URL
  // mais non autorisée pour le compte connecté retombe sur le tableau de bord.
  // (Le serveur revalide de toute façon chaque endpoint : ce repli n'est qu'un
  // garde-fou d'affichage, pas un contrôle de sécurité.) Ajustement pendant
  // le rendu (pattern React officiel, comme supply-chain-view) — sans effet.
  const [enforcedActor, setEnforcedActor] = useState<SessionActor | null | undefined>(undefined)
  if (session.data !== enforcedActor) {
    setEnforcedActor(session.data)
    if (session.data && !allowedViews.includes(view)) setView(allowedViews[0] ?? "my-account")
  }

  // V18.9.10 (UX-013) : synchronisation vue → URL (replaceState, réversible).
  useEffect(() => {
    if (typeof window === "undefined") return
    const url = new URL(window.location.href)
    url.searchParams.set("vue", view)
    window.history.replaceState(null, "", url)
  }, [view])

  function openMovement(m: MaterialDTO, preset: MovementPreset) {
    if (!hasRole(session.data,"inventory") && preset!=="in") return
    if (preset === "in") {
      setReceiptPrefillMaterialId(m.id)
      navigate("goods-receipts")
      return
    }
    setMovementTarget(m)
    setMovementPreset(preset)
  }

  function openPurchase(prefill?: MaterialDTO | null) {
    if (!canBuy) return
    setPurchasePrefill(prefill ?? null)
    setPurchaseOpen(true)
  }

  function openOrder(presetProduct?: ProductDTO) {
    if (!canSell) return
    setOrderPresetProduct(presetProduct ?? null)
    setOrderOpen(true)
  }

  function navigate(v: ViewId) {
    if (!allowedViews.includes(v)) return
    setView(v)
    setNavOpen(false)
    // Le préremplissage de réception ne vaut qu'une navigation : en repartant
    // de l'écran, la prochaine visite repart d'une sélection vierge.
    if (v !== "goods-receipts") setReceiptPrefillMaterialId(null)
  }

  // V18.9.10 (UX-012) : la recherche globale ne bascule PLUS la vue à la
  // frappe (perte de contexte non demandée) — la navigation vers le
  // catalogue se fait à la soumission (Entrée) ou depuis le catalogue même.
  const [signingOut,setSigningOut]=useState(false)
  async function signOut(){
    setSigningOut(true)
    try{
      const res=await fetch("/api/auth/logout",{method:"POST",credentials:"same-origin",cache:"no-store"})
      if(!res.ok)throw Error("Déconnexion impossible : réessayez")
      queryClient.clear()
      window.location.replace("/login")
    }catch{setSigningOut(false);window.alert("Déconnexion impossible. Vérifiez la connexion au serveur et réessayez.")}
  }

  function submitGlobalSearch() {
    if (globalSearch.trim().length >= 2 && view !== "catalogue") navigate("catalogue")
  }

  if(session.isError && (session.error as {status?:number})?.status===401){
    if(typeof window!=="undefined")window.location.replace("/login")
    return null
  }
  if(session.data?.mustChangePassword)return <PasswordChangeView username={session.data.username}/>

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Toaster richColors position="top-center" />
      <div className="flex min-h-screen flex-col">
        {/* Barre de navigation horizontale : aucune sidebar permanente sur ordinateur. */}
        <div className="sticky top-0 z-40 border-b border-slate-200 bg-white shadow-sm">
          <header className="flex h-14 items-center gap-3 px-3 sm:px-5 lg:px-7">
            {/* Mobile : menu disponible, sans réduire la largeur des tableaux. */}
            <Sheet open={navOpen} onOpenChange={setNavOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon" className="shrink-0 md:hidden" aria-label="Ouvrir le menu">
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0" aria-describedby={undefined}>
                <SheetTitle className="sr-only">Navigation GoCmd</SheetTitle>
                <NavSidebar
                  active={view}
                  onNavigate={navigate}
                  counts={{ materials: alerts.length }}
                  alerts={alerts.length}
                  allowedViews={allowedViews}
                  buyerMode={buyerMode}
                />
              </SheetContent>
            </Sheet>

            <button
              type="button"
              onClick={() => navigate(allowedViews[0]??"my-account")}
              className="flex shrink-0 items-center gap-2 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              aria-label="GoCmd : accueil"
            >
              <span className="grid size-10 place-items-center rounded-lg border border-slate-200 bg-white">
                <SodepiSymbol size={35} />
              </span>
              <span className="leading-tight">
                <strong className="block text-sm font-bold text-slate-900">GoCmd</strong>
                <span className="hidden text-[11px] text-slate-500 sm:block">ERP SODEPI</span>
              </span>
            </button>

            <div className={`ml-auto hidden min-w-0 w-full max-w-sm items-center sm:flex lg:ml-8 ${!allowedViews.includes("catalogue")?"!hidden":""}`}>
              <div className="relative w-full">
                <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <Input
                  value={globalSearch}
                  onChange={(e) => setGlobalSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitGlobalSearch() }}
                  placeholder="Rechercher un produit — Entrée pour ouvrir le catalogue"
                  className="h-9 w-full pl-8"
                  aria-label="Recherche dans le catalogue (Entrée pour ouvrir le catalogue)"
                />
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2 sm:ml-auto">
              <Button variant="outline" size="icon" className={`sm:hidden ${!allowedViews.includes("catalogue")?"hidden":""}`} aria-label="Ouvrir la recherche" onClick={()=>setMobileSearchOpen(v=>!v)}><Search className="size-4"/></Button>
              {allowedViews.includes("dashboard")&&<Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="icon" className="relative shrink-0" aria-label={alerts.length > 0 ? `Notifications : ${alerts.length} alertes de stock` : "Notifications"}>
                    <Bell className="size-4" />
                    {/* V18.9.10 (UX-001) : badge rose-700 (5,9:1 mesuré ; avant
                        rose-500 = 3,75:1) et 11 px. */}
                    {alerts.length > 0 && (
                      <span className="absolute -right-1 -top-1 grid min-w-4 h-4 place-items-center rounded-full bg-rose-700 px-0.5 text-[11px] font-bold leading-none text-white" aria-hidden>
                        {alerts.length}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
                  <p className="text-sm font-semibold text-slate-800">Alertes de stock</p>
                  {alerts.length === 0 ? (
                    <p className="pt-2 text-sm text-slate-500">Aucune alerte — les seuils sont respectés.</p>
                  ) : (
                    <ul className="max-h-[60vh] space-y-2 overflow-y-auto pt-2">
                      {alerts.map((m) => (
                        <li key={m.id} className="rounded-lg border border-slate-200 p-2.5">
                          <p className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium text-slate-800">{m.name}</span>
                            <MaterialLevelBadge material={m} />
                          </p>
                          <p className="text-xs text-slate-500">
                            {fmtNum(m.stockQty)} {m.unit} en stock (min {fmtNum(m.minStock)})
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-1.5 h-7 w-full border-amber-200 bg-amber-50 text-xs text-amber-700 hover:bg-amber-100"
                            onClick={() => openPurchase(m)}
                            disabled={!canBuy || m.isPurchasable===false || m.foamNature==="AGGLO"}
                            title={m.isPurchasable===false||m.foamNature==="AGGLO"?"Article non achetable : besoin interne ou classification à vérifier":undefined}
                          >
                            {m.isPurchasable===false||m.foamNature==="AGGLO"?"Achat non autorisé":"Créer une demande d’achat"}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </PopoverContent>
              </Popover>}
              {/* V18.9.10 (UX-038) : identité de session visible dès md (avant
                  : masquée sous xl/1280 px) — username tronqué + rôles au survol. */}
              <div className="flex min-w-0 shrink-0 items-center gap-2" title={session.data ? `Compte : ${session.data.username} · Rôles : ${session.data.roles.join(", ") || "Lecture seule"}` : "Chargement des droits"}>
                <Avatar className="size-8">
                  <AvatarFallback className="bg-rose-50 text-[#9f1720]">
                    <User className="size-4" />
                  </AvatarFallback>
                </Avatar>
                <span className="hidden max-w-40 truncate text-xs text-slate-500 md:inline">{session.data ? `${session.data.username} · ${session.data.roles.join(", ") || "Lecture seule"}` : "Identification…"}</span>
              </div>
              {session.data?.managed&&<Button variant="outline" size="sm" onClick={signOut} disabled={signingOut} aria-label="Se déconnecter de GoCmd" className="shrink-0"><LogOut className="size-4 sm:mr-2"/><span className="hidden sm:inline">{signingOut?"Déconnexion…":"Se déconnecter"}</span></Button>}
            </div>
          </header>

          {mobileSearchOpen&&allowedViews.includes("catalogue")&&<div className="px-3 pb-2 sm:hidden"><Input autoFocus aria-label="Rechercher dans le catalogue (Entrée pour ouvrir le catalogue)" value={globalSearch} placeholder="Rechercher un produit…" onChange={e=>setGlobalSearch(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")submitGlobalSearch()}}/></div>}
          {/* Desktop : tous les onglets en haut, défilement horizontal si nécessaire. */}
          <TopNavigation active={view} onNavigate={navigate} alerts={alerts.length} allowedViews={allowedViews} buyerMode={buyerMode} />
        </div>

        {/* Le contenu dispose de toute la largeur ; chaque tableau gère son propre défilement. */}
        <main id="gocmd-contenu" className="w-full min-w-0 flex-1 px-3 py-4 sm:px-5 lg:px-7 lg:py-5">
            <AnimatePresence mode="wait">
              <motion.div
                key={view}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
                className="w-full min-w-0"
              >
                <div className="pb-5">
                  {/* V18.9.10 (UX-007) : H1 systématiquement text-2xl + graisse
                      renforcée pour démarquer du sous-titre et des CardTitle. */}
                  <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                    {buyerMode && BUYER_TITLES[view] ? BUYER_TITLES[view].title : TITLES[view].title}
                  </h1>
                  <p className="mt-0.5 text-sm text-slate-500">{buyerMode && BUYER_TITLES[view] ? BUYER_TITLES[view].desc : TITLES[view].desc}</p>
                </div>

                {buyerMode && BUYER_WORK_VIEWS.has(view) && <BuyerJourney active={view} allowedViews={allowedViews} onNavigate={navigate}/>}

                {view === "my-account" && session.data?.managed && <PasswordChangeView username={session.data.username} forced={false}/>}
                {view === "users" && session.data?.managed && hasRole(session.data,"admin") && <UsersAdminView isRoot={session.data.isRoot}/>}
                {view === "buyer-workbench" && canBuy && <BuyerWorkbenchView onGoTo={navigate} onOpenPurchase={m=>openPurchase(m)} />}
                {view === "dashboard" && (
                  <DashboardView
                    data={dashboard.data}
                    loading={dashboard.isPending}
                    onOpenMaterialDa={(id) => {
                      const m = alerts.find((a) => a.id === id) ?? null
                      openPurchase(m)
                    }}
                    onGoTo={(v) => navigate(v)}
                  />
                )}
                {view === "production-planning" && <div className="space-y-5"><StockPlanningPanel/><MtsReworkPanel/><MtsMaterialCostPanel/><MtsMaterialReceiptsPanel/><MtsFinishedReceiptsPanel/>{hasRole(session.data,"quality")&&<FinishedQualityPanel/>}</div>}
                {view === "materials" && (
                  <MaterialsView onMovement={openMovement} onPurchase={(m) => openPurchase(m)} onOpenPurchases={()=>navigate("purchases")}/>
                )}
                {view === "catalogue" && <CatalogueView searchTerm={globalSearch} onAddToOrder={(p) => openOrder(p)} />}
                {view === "movements" && <MovementsView />}
                {view === "orders" && <OrdersView onNewOrder={() => openOrder()} />}
                {view === "sales-quotes" && <SalesView mode="quotes" onNewQuote={()=>openOrder()} />}
                {view === "sales-deliveries" && <SalesView mode="deliveries" onNewQuote={()=>openOrder()} />}
                {view === "sales-invoices" && <SalesView mode="invoices" onNewQuote={()=>openOrder()} />}
                {view === "purchases" && <PurchasesView onNewPurchase={(m) => openPurchase(m)} />}
                {view === "p2p-advanced" && <P2PAdvancedView />}
                {(["stock-lots","supplier-invoices"] as string[]).includes(view) && <P2PControlView section={view as "stock-lots"|"supplier-invoices"} />}
                {(["suppliers","supplier-orders","goods-receipts"] as string[]).includes(view) && <SupplyChainView section={view as "suppliers"|"supplier-orders"|"goods-receipts"} defaultMaterialId={receiptPrefillMaterialId} />}
              </motion.div>
            </AnimatePresence>
        </main>

        {/* Footer collant — V18.9.10 (Lot 7) : mention démo raccourcie en une
            phrase (l'information essentielle — prix fictifs — est conservée). */}
        <footer className="mt-auto border-t border-slate-200 bg-white">
          <div className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-3 text-xs text-slate-500 sm:px-5 lg:px-7">
            <p>
              {buyerMode&&!allowedViews.includes("dashboard")?"GoCmd — service achats : données de démonstration fictives. Les demandes, consultations et BC nécessitent une validation humaine.":<>GoCmd — catalogue de démonstration : {dashboard.data?.kpi.products ?? "…"} produits, {dashboard.data?.kpi.stockUnits ?? "…"} matières. Prix fictifs, non utilisables comme tarifs commerciaux.</>}
            </p>
            <p className="flex items-center gap-1.5">
              <span className={`size-2 rounded-full ${dashboard.isSuccess&&!dashboard.isFetching?"bg-emerald-500":"bg-amber-500"}`} aria-hidden />
              {buyerMode&&!allowedViews.includes("dashboard")?"Poste achats — données par écran":dashboard.isError?"Données indisponibles":dashboard.isSuccess&&!dashboard.isFetching?"Données actualisées":"Chargement / actualisation des données…"}
            </p>
          </div>
        </footer>
      </div>

      {/* Dialogues */}
      {movementTarget && (
        <MovementDialog
          key={`mv-${movementTarget.id}-${movementPreset}`}
          onClose={() => setMovementTarget(null)}
          material={movementTarget}
          preset={movementPreset}
        />
      )}
      {purchaseOpen && (
        <PurchaseDialog
          key={`pd-${purchasePrefill?.id ?? "new"}-${purchaseOpen}`}
          onClose={() => setPurchaseOpen(false)}
          prefill={purchasePrefill}
        />
      )}
      {orderOpen && (
        <NewOrderDialog
          launchMode={view==="sales-quotes"?"quote":"order"}
          key={`no-${orderPresetProduct?.id ?? "new"}-${orderOpen}`}
          onClose={() => setOrderOpen(false)}
          presetProduct={orderPresetProduct}
        />
      )}
    </div>
  )
}
