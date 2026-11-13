"use client";

import { useMemo, useState } from "react"
import { ArrowLeftRight, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
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
import { cn } from "@/lib/utils"
import { fmtNum, timeAgo, type MovementDTO } from "@/lib/erp-types"
import { MovementBadge } from "./bits"
import { useMovements } from "./hooks"

const TABS = [
  { id: "all", label: "Tous" },
  { id: "in", label: "Entrées" },
  { id: "out", label: "Sorties" },
  { id: "production", label: "Production" },
  { id: "adjust", label: "Ajustements" },
] as const

export function MovementsView() {
  const [type, setType] = useState<string>("all")
  const [q, setQ] = useState("")
  const [archive, setArchive] = useState(false)
  const { data, isPending } = useMovements({ type, q, archive })
  const movements = data?.items ?? []

  const stats = useMemo(() => {
    let inQty = 0, outQty = 0, prodQty = 0
    const byCat = new Map<string, number>()
    for (const m of movements) {
      byCat.set(m.type, (byCat.get(m.type) ?? 0) + 1)
      if (m.type === "in") inQty++
      else if (m.type === "out") outQty++
      else if (m.type === "production") prodQty++
    }
    return { inQty, outQty, prodQty, total: movements.length }
  }, [movements])

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <MiniStat label="Mouvements affichés" value={String(stats.total)} />
        <MiniStat label="Entrées" value={String(stats.inQty)} />
        <MiniStat label="Sorties" value={String(stats.outQty)} />
        <MiniStat label="Consommations atelier" value={String(stats.prodQty)} />
      </div>

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <span className="min-w-0 flex-1 basis-full break-words sm:basis-auto">{archive ? "Archive historique de démonstration : valeurs conservées à titre documentaire, non utilisées pour les soldes." : "Journal opérationnel : les écritures d’ouverture DEMO sont distinguées des mouvements réels."}</span>
        <Button className="h-auto min-w-0 w-full whitespace-normal py-2 text-center sm:w-auto" variant="outline" size="sm" onClick={() => { setArchive(!archive); setType("all") }}>
          {archive ? "Revenir au journal actif" : "Consulter les anciennes transactions (archives)"}
        </Button>
      </div>
      <Card className="border-slate-200">
        <CardHeader className="gap-4 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowLeftRight className="size-4 text-slate-600" /> Journal des mouvements
            </CardTitle>
            <CardDescription>{archive ? "Mouvements de démonstration archivés (hors stock courant)" : "Journal actif, y compris soldes d’ouverture non vérifiés"}</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Motif, document, opérateur…"
                className="w-full pl-8 sm:w-64"
                aria-label="Rechercher un mouvement"
              />
            </div>
          </div>
          <Tabs value={type} onValueChange={setType}>
            <TabsList className="h-9 flex-wrap">
              {TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id} className="text-xs">
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="pt-0">
          {isPending ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="max-h-[520px] overflow-y-auto scrollbar-thin">
              <Table className="min-w-[1030px] xl:min-w-0">
                <TableHeader className="sticky top-0 z-10 bg-white">
                  <TableRow>
                    <TableHead>Référence</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Matière</TableHead>
                    <TableHead className="text-right">Quantité</TableHead>
                    <TableHead>Motif</TableHead>
                    <TableHead>Document</TableHead>
                    <TableHead>Opérateur</TableHead>
                    <TableHead className="text-right">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-mono text-xs">{m.ref}</TableCell>
                      <TableCell><MovementBadge type={m.type} /></TableCell>
                      <TableCell className="max-w-52 truncate">{m.material?.name ?? "—"}</TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-medium tabular-nums",
                          m.type === "in" ? "text-emerald-700" : m.type === "adjust" ? "text-slate-600" : "text-rose-700",
                        )}
                      >
                        {m.type === "in" ? "+" : m.type === "adjust" ? (m.qty >= 0 ? "+" : "−") : "−"}
                        {fmtNum(Math.abs(m.qty))} {m.unit}
                      </TableCell>
                      <TableCell className="max-w-64 truncate text-slate-600">
                        {m.isOpeningBalance ? "Ouverture DEMO (stock non vérifié)" : m.isArchived ? `[ARCHIVE DEMO] ${m.reason}` : m.reason}
                      </TableCell>
                      <TableCell>
                        {m.document ? (
                          <span className="font-mono text-xs text-slate-500">{m.document}</span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>{m.operator}</TableCell>
                      <TableCell className="text-right text-slate-500">
                        {/* V18.9.10 (UX-027) : date absolue au survol + <time> sémantique */}
                        <time dateTime={m.createdAt} title={new Date(m.createdAt).toLocaleString("fr-FR")}>{timeAgo(m.createdAt)}</time>
                      </TableCell>
                    </TableRow>
                  ))}
                  {movements.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="py-10 text-center text-slate-500">
                        Aucun mouvement ne correspond aux filtres.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="border-slate-200">
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-1 text-lg font-bold text-slate-900">{value}</p>
      </CardContent>
    </Card>
  )
}
