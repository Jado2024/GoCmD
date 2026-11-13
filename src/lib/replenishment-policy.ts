/** Reconstitution MTS/MTO : calcul conservateur sur quantites de STOCK.
 * Aucune conversion implicite d'unites, aucun OF ni DA automatique.
 * Les receptions non approuvees ne comptent pas comme stock disponible.
 * Les commandes et les reservations sont separees : une demande deja reservee
 * ne doit PAS etre soustraite deux fois.
 */
import { permitsFraction } from './purchase-quantity.ts'

export type StockPolicy = {
  physical: number
  reserved: number
  unreservedDemand: number
  firmInbound: number
  minStock: number
  targetStock: number | null
  unit: string
}
function finiteNonNegative(n:number, label:string):number {
  if(!Number.isFinite(n)||n<0||n>1e12)throw Error(`INVALID_${label}`)
  return n
}
function decimals(unit:string):number {
  // C4-10 (contre-audit CASCADE4) : même définition des unités fractionnaires
  // que isValidPurchaseQuantity. L'ancienne liste locale en sens inverse (0 pour
  // une liste de discrètes, 3 pour TOUT le reste) suggérait 8.334 « carton » —
  // quantité que isValidPurchaseQuantity refuse : suggestion inexploitable.
  return permitsFraction(unit)?3:0
}
function ceilToUnit(qty:number, unit:string):number {
  const scale=10**decimals(unit)
  return Math.ceil((qty-1e-9)*scale)/scale
}
function round(qty:number):number {return Math.round(qty*1e6)/1e6}
export function calculateReplenishment(p:StockPolicy){
  const physical=finiteNonNegative(p.physical,'PHYSICAL')
  const reserved=finiteNonNegative(p.reserved,'RESERVED')
  const demand=finiteNonNegative(p.unreservedDemand,'DEMAND')
  const inbound=finiteNonNegative(p.firmInbound,'INBOUND')
  const min=finiteNonNegative(p.minStock,'MIN')
  const target=finiteNonNegative(p.targetStock??p.minStock,'TARGET')
  if(target<min)throw Error('TARGET_BELOW_MIN')
  if(!p.unit)throw Error('UNIT_REQUIRED')
  // Ignore partial stock corruption only by flagging: never produce bogus advice.
  if(reserved>physical+1e-6)throw Error('RESERVED_EXCEEDS_PHYSICAL')
  const free=round(physical-reserved)
  const position=round(free-demand+inbound)
  const triggered=min>0 && position<min-1e-9
  const qty=triggered?ceilToUnit(Math.max(0,target-position),p.unit):0
  return {freeQty:free,projectedQty:position,minStock:min,targetStock:target,
    shortage:round(Math.max(0,min-position)),suggestedQty:qty,triggered,
    formula:'stock physique - reservations - commandes non reservees + entrees fermes'}
}
