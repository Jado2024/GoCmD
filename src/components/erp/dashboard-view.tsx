"use client";

import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  ClipboardList,
  Coins,
  PackageCheck,
  ShoppingCart,
  TrendingUp,
} from "lucide-react"
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { fmtMAD, fmtNum, timeAgo, type DashboardDTO } from "@/lib/erp-types"
import { hasRole, type SessionActor } from "@/lib/role-navigation"
import { api } from "./hooks"
import { KpiCard, MovementBadge, OrderStatusBadge, PriorityBadge } from "./bits"

// V18.9.10 (UX-009) : couleurs de séries assombries — emerald-700 (#047857,
// 5,1:1) et rose-700 (#be123c, 5,9:1) : les légendes recharts héritent de la
// couleur de série ; emerald-500/rose-500 étaient mesurés à 2,54/3,67:1.
const PIE_COLORS = ["#047857", "#0369a1", "#b45309", "#6d28d9", "#be123c"]

export function DashboardView({
  data,
  loading,
  onOpenMaterialDa,
  onGoTo,
}: {
  data?: DashboardDTO
  loading: boolean
  onOpenMaterialDa: (materialId: number) => void
  onGoTo: (v: "orders" | "materials" | "purchases") => void
}) {
  const [flowMetric, setFlowMetric] = useState<"both" | "out">("both")
  // Recharts can preserve a stale SVG width after an in-session desktop→mobile resize.
  const chartBox = useRef<HTMLDivElement>(null)
  const [chartWidth,setChartWidth] = useState(0)
  useEffect(()=>{
    if (typeof ResizeObserver === "undefined" || !chartBox.current) return
    const observer=new ResizeObserver(entries=>{
      const width=Math.round(entries[0]?.contentRect.width ?? 0)
      if(width>0)setChartWidth(current=>current===width?current:width)
    })
    observer.observe(chartBox.current)
    return ()=>observer.disconnect()
  },[loading])
  // Le bouton DA du tableau de bord est désactivé pour les non-acheteurs,
  // avec explication, au lieu d'être silencieusement ignoré.
  const session=useQuery({queryKey:["me"],queryFn:()=>api<SessionActor>("/api/me")})
  const canBuy=hasRole(session.data,"buyer")
  const kpi = data?.kpi
  const flowData = useMemo(
    () =>
      (data?.flow ?? []).map((d) => ({
        day: `${d.day.slice(8,10)}/${d.day.slice(5,7)}`,
        Entrées: Math.round(d.in),
        Sorties: Math.round(d.out),
      })),
    [data?.flow],
  )
  const pieData = useMemo(
    () => (data?.byCategory ?? []).map((c) => ({ name: c.category, value: Math.round(c.value) })),
    [data?.byCategory],
  )

  if (loading || !data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {data.baseline?.stockValueIsProvisional && <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        <strong>Inventaire initial à valider.</strong> {data.baseline.unverifiedLots} lots non vérifiés ; {data.baseline.archivedLegacyMovements ?? 0} anciens mouvements de démonstration archivés et {data.baseline.demoOpeningMovements ?? 0} soldes d’ouverture reconstitués. Valeur de stock indicative : les ouvertures DEMO ne sont pas comptées comme achats réels dans les graphiques.
      </div>}
      {/* KPIs — V18.9.10 (UX-034) : composant partagé KpiCard (bits.tsx) */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label={data.baseline?.stockValueIsProvisional ? "Stock estimé (à vérifier)" : "Valeur du stock"}
          value={kpi!.stockValue === null ? "Accès limité" : fmtMAD(kpi!.stockValue)}
          hint={`${kpi!.stockUnits} matières référencées`}
          icon={Coins}
          tone="emerald"
        />
        <KpiCard
          label="Commandes actives"
          value={String(kpi!.activeOrders)}
          hint={kpi!.pipelineValue == null ? "Montants réservés aux rôles commercial / finances" : `${fmtMAD(kpi!.pipelineValue)} en portefeuille`}
          icon={ClipboardList}
          tone="violet"
          onClick={() => onGoTo("orders")}
        />
        <KpiCard
          label="Alertes stock"
          value={String(kpi!.alerts)}
          hint={kpi!.alerts > 0 ? "Matières sous le seuil mini" : "Tous les seuils sont respectés"}
          icon={AlertTriangle}
          tone={kpi!.alerts > 0 ? "rose" : "slate"}
          onClick={() => onGoTo("materials")}
        />
        <KpiCard
          label="Demandes d'achat"
          value={String(kpi!.openPurchases)}
          hint={kpi!.openPurchases > 0 ? "en cours d'approvisionnement" : "Aucune demande en cours"}
          icon={ShoppingCart}
          tone="amber"
          onClick={() => onGoTo("purchases")}
        />
      </div>

      {/* Les graphiques MAD sont exclusivement affichés aux rôles autorisés. */}
      {kpi!.stockValue !== null ? (
      <div className="grid min-w-0 gap-4 lg:grid-cols-5">
        <Card className="min-w-0 overflow-hidden border-slate-200 lg:col-span-3">
          <CardHeader className="flex-row items-start justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-base">Flux valorisé — 14 derniers jours</CardTitle>
              <CardDescription>Entrées et sorties de stock, en MAD</CardDescription>
            </div>
            <Tabs value={flowMetric} onValueChange={(v) => setFlowMetric(v as "both" | "out")}>
              <TabsList className="h-8">
                <TabsTrigger value="both" className="text-xs">Tout</TabsTrigger>
                <TabsTrigger value="out" className="text-xs">Sorties</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent className="pt-2">
            <div ref={chartBox} className="h-64 min-w-0 overflow-hidden">
              <ResponsiveContainer key={chartWidth} width="100%" height="100%">
                <BarChart data={flowData} barGap={4}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} tickMargin={8} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                  />
                  <Tooltip
                    formatter={(v) => fmtMAD(Number(v))}
                    contentStyle={{ borderRadius: 10, borderColor: "#e2e8f0", fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Entrées" fill="#047857" radius={[4, 4, 0, 0]} maxBarSize={26} />
                  {flowMetric === "both" && <Bar dataKey="Sorties" fill="#be123c" radius={[4, 4, 0, 0]} maxBarSize={26} />}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden border-slate-200 lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Valeur du stock par catégorie</CardTitle>
            <CardDescription>Répartition en MAD</CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="h-56 min-w-0 overflow-hidden">
              <ResponsiveContainer key={chartWidth} width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="55%"
                    outerRadius="85%"
                    paddingAngle={2}
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v) => fmtMAD(Number(v))}
                    contentStyle={{ borderRadius: 10, borderColor: "#e2e8f0", fontSize: 12 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-2 space-y-1.5">
              {pieData.map((p, i) => {
                const pct = kpi!.stockValue !== null && kpi!.stockValue > 0 ? Math.round((p.value / kpi!.stockValue) * 100) : 0
                return (
                  <li key={p.name} className="flex items-center gap-2 text-xs text-slate-600">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                      aria-hidden
                    />
                    <span className="flex-1 truncate">{p.name}</span>
                    <span className="font-medium text-slate-800">{pct}%</span>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      </div>
      ) : (
        <div role="note" className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          Valorisation du stock et flux en MAD : accès réservé aux achats, approbateurs et finances. Les quantités et alertes restent consultables.
        </div>
      )}

      {/* Alertes + échéances */}
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Card className="min-w-0 border-slate-200">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-rose-500" /> Alertes de stock
            </CardTitle>
            <CardDescription>Matières sous le seuil mini — distinguer achats et fabrication</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {data.alertsList.length === 0 ? (
              <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
                Aucune alerte : tous les stocks sont au-dessus des seuils.
              </p>
            ) : (
              <ul className="min-w-0 space-y-2.5">
                {data.alertsList.map((m) => (
                  <li
                    key={m.id}
                    className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-slate-200 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-800">{m.name}</p>
                      <p className="text-xs text-slate-500">
                        {m.category} · {fmtNum(m.stockQty)} / min {fmtNum(m.minStock)} {m.unit}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                      disabled={!canBuy || m.isPurchasable===false || m.foamNature==="AGGLO"}
                      title={!canBuy?"Réservé au rôle acheteur":m.isPurchasable===false||m.foamNature==="AGGLO"?"Article à fabriquer ou non achetable":"Créer une demande d'achat"}
                      onClick={() => onOpenMaterialDa(m.id)}
                    >
                      <PackageCheck className="size-4" /> {m.isPurchasable===false||m.foamNature==="AGGLO"?"Achat non autorisé":"Demande d’achat"}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0 border-slate-200">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="size-4 text-slate-500" /> Prochaines échéances
            </CardTitle>
            <CardDescription>Commandes triées par date de livraison</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="min-w-0 space-y-2.5">
              {data.upcoming.map((o) => {
                const late = o.dueDate && new Date(o.dueDate) < new Date() && o.status !== "shipped"
                return (
                  <li
                    key={o.id}
                    className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                        <span className="truncate">{o.ref}</span>
                        <OrderStatusBadge status={o.status} />
                        <PriorityBadge priority={o.priority} />
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {o.client ? `${o.client.name} · ` : ""}{new Date(o.dueDate ?? "").toLocaleDateString("fr-FR")}
                        {late && <span className="ml-1 font-semibold text-rose-600">— en retard</span>}
                      </p>
                    </div>
                    <p className="text-sm font-bold text-slate-900">{fmtMAD(o.total)}</p>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Derniers mouvements */}
      <Card className="min-w-0 border-slate-200">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="size-4 text-emerald-600" /> Derniers mouvements
          </CardTitle>
          <CardDescription>Journal des entrées, sorties et consommations atelier</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Référence</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Matière</TableHead>
                  <TableHead className="text-right">Quantité</TableHead>
                  <TableHead>Motif</TableHead>
                  <TableHead>Opérateur</TableHead>
                  <TableHead className="text-right">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentMovements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-mono text-xs">{m.ref}</TableCell>
                    <TableCell><MovementBadge type={m.type} /></TableCell>
                    <TableCell className="max-w-52 truncate">{m.material?.name ?? "—"}</TableCell>
                    <TableCell className="text-right font-medium">
                      {fmtNum(Math.abs(m.qty))} {m.unit}
                    </TableCell>
                    <TableCell className="max-w-64 truncate text-slate-600">{m.reason}</TableCell>
                    <TableCell>{m.operator}</TableCell>
                    <TableCell className="text-right text-slate-500">
                      {/* V18.9.10 (UX-027) : date absolue au survol + <time> sémantique */}
                      <time dateTime={m.createdAt} title={new Date(m.createdAt).toLocaleString("fr-FR")}>
                        {timeAgo(m.createdAt)}
                      </time>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Button
            variant="ghost"
            className="mt-3 gap-1 text-slate-600"
            onClick={() => onGoTo("materials")}
          >
            Voir les stocks <ArrowRight className="size-4" />
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
