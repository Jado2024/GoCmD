"use client";

import { useEffect, useState } from "react"
import { ArrowUpFromLine } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { fmtNum, type MaterialDTO } from "@/lib/erp-types"
import { useManualMovement, api } from "./hooks"

export type MovementPreset = "in" | "out"

// Monté par le parent avec key={…} : l'état est initialisé directement
// depuis les props (pas d'effet de synchronisation nécessaire).
// Seule la sortie de stock est saisissable ici :
// - l'entrée passe par une réception fournisseur contrôlée (BR),
// - l'ajustement d'inventaire passe par un comptage approuvé (pilotage achats),
//   le serveur refuse tout ajustement direct (403).
export function MovementDialog({
  onClose,
  material,
  preset,
}: {
  onClose: () => void
  material: MaterialDTO
  preset: MovementPreset
}) {
  const [qty, setQty] = useState(() =>
    String(Math.min(Math.max(material.stockQty * 0.1, 1), material.stockQty)),
  )
  const [reason, setReason] = useState("Sortie atelier – divers")
  const mutation = useManualMovement()
  type LotChoice = {id:number;lotCode:string;qty:number;status:string;
    locations?:Array<{zone:string;name:string;qty:number}>}
  const [lots,setLots]=useState<LotChoice[]>([])
  const [lotId,setLotId]=useState("")
  const [recommendedLotId,setRecommendedLotId]=useState<number|null>(null)
  useEffect(()=>{
    let active=true
    api<{items:Array<LotChoice & {expiresAt:string|null}>;recommendedLotId:number|null}>(`/api/stock-lots?materialId=${material.id}`)
      .then(data=>{
        if(!active)return
        setLots(data.items.filter(l=>l.status==="available"&&l.qty>0&&(!l.expiresAt||new Date(l.expiresAt)>new Date())))
        setRecommendedLotId(data.recommendedLotId)
        setLotId(existing=>existing || (data.recommendedLotId===null?"":String(data.recommendedLotId)))
      }).catch(()=>{})
    return()=>{active=false}
  },[material.id])

  const q = Number(qty.replace(",", "."))
  const after = material.stockQty - q
  const valid =
    Number.isFinite(q) &&
    q > 0 &&
    q <= material.stockQty &&
    reason.trim().length >= 2 &&
    Boolean(lotId) &&
    q <= (lots.find(l=>l.id===Number(lotId))?.qty ?? 0) &&
    preset === "out"

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowUpFromLine className="size-5" /> Sortie de stock
          </DialogTitle>
          <DialogDescription>
            {material.name} — stock actuel {fmtNum(material.stockQty)} {material.unit} (min{" "}
            {fmtNum(material.minStock)})
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">Les entrées hors BC et les ajustements directs ne sont pas autorisés ici. Entrées : « Réceptions MP ». Ajustement : comptage inventaire avec approbation dans le pilotage achats.</div>
          <div className="space-y-1.5">
            <Label htmlFor="mv-lot">Lot à mouvementer *</Label>
            {/* V18.9.10 (UX-005) : Select du design system (focus, aria,
                cohérence) à la place du <select> natif. */}
            <Select value={lotId} onValueChange={setLotId}>
              <SelectTrigger id="mv-lot" className="w-full">
                <SelectValue placeholder="Choisir un lot disponible…" />
              </SelectTrigger>
              <SelectContent>
                {lots.map((l) => (
                  <SelectItem key={l.id} value={String(l.id)}>
                    {l.lotCode}
                    {l.id === recommendedLotId ? " · FEFO/FIFO conseillé" : ""} · disponible{" "}
                    {fmtNum(l.qty)} {material.unit}
                    {l.locations?.length===1 ? ` · ${l.locations[0].zone}` :
                      l.locations && l.locations.length>1 ? " · plusieurs zones" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {lots.find(l=>l.id===Number(lotId))?.locations?.map((place,i)=>(
              <p key={`${place.zone}-${i}`} className="text-xs text-slate-700">
                Emplacement enregistré : <strong>{place.zone}</strong> ({place.name}), {fmtNum(place.qty)} {material.unit}
              </p>
            ))}
            {(lots.find(l=>l.id===Number(lotId))?.locations?.length??0)>1&&
              <p className="text-xs text-amber-800">Attention : ce lot est réparti dans plusieurs emplacements. La sortie automatique ne choisit pas un rack précis. Vérifiez le prélèvement physique.</p>}
            {recommendedLotId!==null&&<p className="text-xs text-emerald-800">Lot conseillé selon la date de péremption (FEFO), sinon l'ancienneté (FIFO). Vous pouvez choisir un autre lot ; les lots expirés sont exclus par le serveur.</p>}
            {lots.length===0&&<p className="text-xs text-rose-700">Aucun lot vérifié disponible. Contrôlez les stocks historiques dans « Lots & qualité ».</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mv-qty">Quantité ({material.unit})</Label>
            <Input
              id="mv-qty"
              type="number"
              step="any"
              min="0"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              aria-invalid={!valid}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mv-reason">Motif</Label>
            <Input
              id="mv-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Motif du mouvement"
              maxLength={200}
            />
          </div>

          <p className="text-xs text-slate-500">L'opérateur est enregistré automatiquement depuis le compte authentifié.</p>

          <p className="rounded-lg bg-slate-50 p-2.5 text-sm text-slate-700">
            Stock après opération :{" "}
            <strong className="tabular-nums">
              {fmtNum(Number.isFinite(after) ? after : 0)} {material.unit}
            </strong>
            {q > material.stockQty && (
              <span className="block pt-1 text-xs font-semibold text-rose-600">
                La sortie dépasse le stock disponible.
              </span>
            )}
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="destructive"
            disabled={!valid || mutation.isPending}
            onClick={() => mutation.mutate({type:"out",materialId:material.id,qty:q,reason:reason.trim(),stockLotId:Number(lotId)},{onSuccess:onClose})}
          >
            {mutation.isPending ? "Enregistrement…" : "Valider la sortie"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
