"use client";

import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  Factory,
  Wrench,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { MaterialDTO, MovementType, OrderStatus, PurchaseStatus } from "@/lib/erp-types";
import { stockLevel } from "@/lib/erp-types";
import { Button } from "@/components/ui/button";

// ─── Badges de statut ─────────────────────────────────────────

export function LevelBadge({ level }: { level: "out" | "low" | "ok" }) {
  const map = {
    ok: { label: "Disponible", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
    low: { label: "Sous le mini", cls: "border-amber-200 bg-amber-50 text-amber-700" },
    out: { label: "Rupture", cls: "border-rose-200 bg-rose-50 text-rose-700" },
  }[level];
  return (
    <Badge variant="outline" className={cn("gap-1", map.cls)}>
      {level !== "ok" && <AlertTriangle className="size-3" />}
      {map.label}
    </Badge>
  );
}

export function MaterialLevelBadge({ material }: { material: MaterialDTO }) {
  return <LevelBadge level={stockLevel(material)} />
}

const MOVEMENT_META: Record<
  string,
  { label: string; cls: string; icon: LucideIcon }
> = {
  in: { label: "Entrée", cls: "border-emerald-200 bg-emerald-50 text-emerald-700", icon: ArrowDownToLine },
  out: { label: "Sortie", cls: "border-rose-200 bg-rose-50 text-rose-700", icon: ArrowUpFromLine },
  production: { label: "Production", cls: "border-violet-200 bg-violet-50 text-violet-700", icon: Factory },
  adjust: { label: "Ajustement", cls: "border-slate-200 bg-slate-50 text-slate-600", icon: Wrench },
}

export function MovementBadge({ type }: { type: MovementType | string }) {
  const m = MOVEMENT_META[type] ?? MOVEMENT_META.adjust
  const Icon = m.icon
  return (
    <Badge variant="outline" className={cn("gap-1", m.cls)}>
      <Icon className="size-3" />
      {m.label}
    </Badge>
  )
}

export function OrderStatusBadge({ status }: { status: OrderStatus | string }) {
  const map = {
    pending_validation: { label: "À valider", cls: "border-violet-300 bg-violet-50 text-violet-800" },
    rejected: { label: "Refusée", cls: "border-rose-300 bg-rose-50 text-rose-800" },
    new: { label: "Nouvelle", cls: "border-slate-300 bg-slate-100 text-slate-700" },
    production: { label: "En production", cls: "border-amber-200 bg-amber-50 text-amber-700" },
    ready: { label: "Prête", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
    shipped: { label: "Expédiée", cls: "border-slate-200 bg-slate-100 text-slate-500" },
  }[status] ?? { label: status, cls: "border-slate-200 bg-slate-50 text-slate-600" }
  return <Badge variant="outline" className={map.cls}>{map.label}</Badge>
}

export function PurchaseStatusBadge({ status }: { status: PurchaseStatus | string }) {
  const map = {
    pending: { label: "À valider", cls: "border-slate-300 bg-slate-100 text-slate-700" },
    partially_approved: { label: "Partiellement approuvée", cls: "border-amber-200 bg-amber-50 text-amber-800" },
    rejected: { label: "Refusée", cls: "border-rose-200 bg-rose-50 text-rose-700" },
    approved: { label: "Validée", cls: "border-sky-200 bg-sky-50 text-sky-700" },
    ordered: { label: "Commandée", cls: "border-orange-200 bg-orange-50 text-orange-700" },
    partial: { label: "Réception partielle", cls: "border-amber-200 bg-amber-50 text-amber-700" },
    closed: { label: "Clôturée (solde annulé)", cls: "border-slate-300 bg-slate-100 text-slate-700" },
    received: { label: "Réceptionnée", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
    cancelled: { label: "Annulée", cls: "border-rose-200 bg-rose-50 text-rose-700" },
  }[status] ?? { label: status, cls: "border-slate-200 bg-slate-50 text-slate-600" }
  return <Badge variant="outline" className={map.cls}>{map.label}</Badge>
}

export function VariantTag({ variant }: { variant: string }) {
  if (variant === "STD") return null
  return (
    <Badge variant="outline" className="border-violet-200 bg-violet-50 px-1.5 text-[10px] font-semibold text-violet-700">
      {variant}
    </Badge>
  )
}

export function PriorityBadge({ priority }: { priority: string }) {
  if (priority === "haute")
    return (
      <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
        Urgente
      </Badge>
    )
  return null
}

// ─── Erreur de chargement unifiée (UX-018) ─────────────────────

// V18.9.10 : un seul pattern d'erreur de liste — bordure/fond rose,
// message actionnable, bouton Réessayer. Remplace les ErrorBox locales.
export function LoadError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Réessayer
        </Button>
      )}
    </div>
  );
}

// ─── KPI ──────────────────────────────────────────────────────

// V18.9.10 (UX-033/UX-034) : composant KPI unique (fusion de KpiCard et de
// l'ancien Kpi local de dashboard-view). Indication sur hauteur de hint
// fixe (min-h-8) pour aligner les lignes de base entre cartes, clic
// optionnel de navigation avec focus clavier visible.
export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "slate",
  onClick,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: "slate" | "emerald" | "amber" | "rose" | "violet";
  onClick?: () => void;
}) {
  const tones = {
    slate: "bg-slate-100 text-slate-600",
    emerald: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    rose: "bg-rose-100 text-rose-700",
    violet: "bg-violet-100 text-violet-700",
  };
  const Comp = onClick ? "button" : "div";
  return (
    <Card
      className={`min-w-0 border-slate-200 ${onClick ? "cursor-pointer text-left transition-shadow hover:shadow-md" : ""}`}
    >
      <CardContent className="p-4 sm:p-5">
        <Comp
          type={Comp === "button" ? "button" : undefined}
          onClick={onClick}
          className="flex w-full items-start justify-between gap-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-1.5 text-xl font-bold tracking-tight break-words text-slate-900 sm:text-2xl">
              {value}
            </p>
            {hint && <p className="mt-1 line-clamp-2 min-h-8 text-xs text-slate-500">{hint}</p>}
          </div>
          <div className={cn("grid size-10 shrink-0 place-items-center rounded-lg", tones[tone])}>
            <Icon className="size-5" />
          </div>
        </Comp>
      </CardContent>
    </Card>
  );
}

// ─── Barre de niveau de stock ─────────────────────────────────

export function StockBar({ stock, min, unit }: { stock: number; min: number; unit: string }) {
  const target = Math.max(min, 1)
  const ratio = Math.min(1, Math.max(0, stock / (target * 1.5)))
  const width = Math.round(ratio * 100)
  const level = stock <= 0 ? "out" : stock < min ? "low" : "ok"
  const barCls =
    level === "out"
      ? "bg-rose-500"
      : level === "low"
        ? "bg-amber-500"
        : "bg-emerald-500"
  const minPos = Math.min(100, Math.round((min / (target * 1.5)) * 100))
  return (
    <div className="w-24 lg:w-28 2xl:w-32">
      <div className="relative h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={cn("h-full rounded-full transition-all", barCls)} style={{ width: `${width}%` }} />
        <div
          className="absolute top-0 h-full w-px bg-slate-400/70"
          style={{ left: `${minPos}%` }}
          aria-hidden
        />
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        {stock.toLocaleString("fr-FR")} / min {min.toLocaleString("fr-FR")} {unit}
      </p>
    </div>
  )
}
