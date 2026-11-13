"use client";

import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  ClipboardList,
  ListTodo,
  LayoutDashboard,
  Layers3,
  Settings2,
  ShoppingCart,
  Warehouse,
  Truck, PackageCheck, Users, ShieldCheck, Receipt, ClipboardCheck, UserCog, KeyRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge"
import { SodepiSymbol } from "@/components/branding/sodepi-logo";
import { cn } from "@/lib/utils";

export type ViewId = "buyer-workbench" | "production-planning" | "dashboard" | "materials" | "catalogue" | "movements" | "orders" | "purchases" | "suppliers" | "supplier-orders" | "goods-receipts" | "stock-lots" | "supplier-invoices" | "p2p-advanced" | "sales-quotes" | "sales-deliveries" | "sales-invoices" | "users" | "my-account";

export const SECTIONS: {
  label: string;
  items: { id: ViewId; label: string; icon: LucideIcon }[];
}[] = [
  {
    label: "Pilotage",
    items: [{ id: "buyer-workbench", label: "Mes actions achats", icon: ListTodo },{ id: "dashboard", label: "Tableau de bord", icon: LayoutDashboard }],
  },
  {label: "Production", items: [{id: "production-planning", label: "Fabrication pour stock", icon: ClipboardList}]},
  {
    label: "Gestion des stocks",
    items: [
      { id: "materials", label: "Matières premières", icon: Warehouse },
      { id: "catalogue", label: "Catalogue produits", icon: Layers3 },
      { id: "movements", label: "Mouvements", icon: ArrowLeftRight },
      { id: "stock-lots", label: "Lots & qualité", icon: ShieldCheck },
    ],
  },
  {
    label: "Achats",
    items: [{ id: "purchases", label: "Demandes d'achat", icon: ShoppingCart },
      { id: "suppliers", label: "Fournisseurs", icon: Users },
      { id: "supplier-orders", label: "BC fournisseurs", icon: Truck },
      { id: "goods-receipts", label: "Réceptions MP", icon: PackageCheck },
      { id: "supplier-invoices", label: "Factures fournisseurs", icon: Receipt },
      { id: "p2p-advanced", label: "Pilotage achats avancé", icon: ClipboardCheck }],
  },
  {
    label: "Administration",
    items: [{id:"users",label:"Utilisateurs et autorisations",icon:UserCog},{id:"my-account",label:"Mon mot de passe",icon:KeyRound}],
  },
  {
    label: "Ventes",
    items: [{ id: "sales-quotes", label: "Devis clients", icon: Receipt },{ id: "orders", label: "Commandes clients", icon: ClipboardList },{ id: "sales-deliveries", label: "BL clients", icon: Truck },{ id: "sales-invoices", label: "Factures & règlements clients", icon: Receipt }],
  },
];

/** P5.15.6 : affichage par parcours métier, sans modifier les autorisations API.
 * Les comptes multi-rôles retrouvent les écrans de leurs autres fonctions.
 */
const BUYER_SECTIONS: typeof SECTIONS = [
  {label:"Mon travail",items:[{id:"buyer-workbench",label:"Mes actions achats",icon:ListTodo}]},
  {label:"Identifier et valider les besoins",items:[
    {id:"materials",label:"Matières & besoins",icon:Warehouse},
    {id:"purchases",label:"Demandes d'achat (DA)",icon:ShoppingCart},
  ]},
  {label:"Consulter les fournisseurs",items:[
    {id:"suppliers",label:"Fournisseurs",icon:Users},
    {id:"p2p-advanced",label:"Consultations & offres",icon:ClipboardCheck},
  ]},
  {label:"Commander et suivre",items:[
    {id:"supplier-orders",label:"Commandes fournisseurs (BC)",icon:Truck},
    {id:"goods-receipts",label:"Suivi des réceptions (BR)",icon:PackageCheck},
  ]},
  {label:"Mon compte",items:[{id:"my-account",label:"Mot de passe",icon:KeyRound}]},
]

export function navigationSections(allowedViews?:ViewId[],buyerMode=false):typeof SECTIONS {
  const isAllowed=(id:ViewId)=>!allowedViews||allowedViews.includes(id)
  if(!buyerMode)return SECTIONS.map(section=>({...section,items:section.items.filter(item=>isAllowed(item.id))})).filter(section=>section.items.length>0)
  const primary=BUYER_SECTIONS.map(section=>({...section,items:section.items.filter(item=>isAllowed(item.id))})).filter(section=>section.items.length>0)
  const seen=new Set(primary.flatMap(section=>section.items.map(item=>item.id)))
  // Un utilisateur buyer+approver, buyer+finance, etc. conserve les autres écrans.
  const extra=SECTIONS.map(section=>({...section,items:section.items.filter(item=>isAllowed(item.id)&&!seen.has(item.id))})).filter(section=>section.items.length>0)
  return [...primary,...extra]
}

interface NavSidebarProps {
  active: ViewId;
  onNavigate: (v: ViewId) => void;
  counts: Partial<Record<ViewId, number>>;
  alerts: number;
  allowedViews?: ViewId[];
  buyerMode?: boolean;
}

export function NavSidebar({ active, onNavigate, counts, alerts, allowedViews, buyerMode=false }: NavSidebarProps) {
  return (
    <div className="flex h-full flex-col bg-[#1b232c] text-slate-300">
      {/* Logo */}
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-slate-700 px-5">
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-white">
          <SodepiSymbol size={34} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">GoCmd</p>
          <p className="truncate text-xs text-slate-300">ERP SODEPI</p>
        </div>
      </div>

      {/* Navigation — V18.9.10 (UX-003) : titres et textes secondaires en
          slate-400 (6,78:1 mesuré sur slate-900 ; avant : 2,35–3,74:1). */}
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5" aria-label="Navigation principale">
        {navigationSections(allowedViews,buyerMode).map((section) => (
          <div key={section.label}>
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-300">
              {section.label}
            </p>
            <ul className="space-y-1">
              {section.items.filter(item => !allowedViews || allowedViews.includes(item.id)).map((item) => {
                const isActive = active === item.id
                const badge = counts[item.id]
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onNavigate(item.id)}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                        isActive
                          ? "border-l-[3px] border-[#f36c75] bg-[#55262d] text-white"
                          : "text-slate-300 hover:bg-[#303b46] hover:text-white",
                      )}
                    >
                      <item.icon className="size-4 shrink-0" />
                      <span className="flex-1 truncate text-left">{item.label}</span>
                      {badge != null && badge > 0 ? (
                        <Badge
                          variant="outline"
                          className={cn(
                            "h-5 min-w-5 justify-center px-1.5 text-[10px]",
                            item.id === "materials" && alerts > 0
                              ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                              : "border-slate-700 bg-slate-800 text-slate-400",
                          )}
                        >
                          {badge}
                        </Badge>
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Pied */}
      <div className="shrink-0 border-t border-slate-800 p-4">
        <div className="flex items-center gap-3 rounded-lg bg-slate-800/60 p-3">
          <Settings2 className="size-5 shrink-0 text-slate-400" />
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-slate-300">Atelier principal</p>
            <p className="truncate text-[11px] text-slate-400">Casablanca — Maroc</p>
          </div>
        </div>
      </div>
    </div>
  )
}
