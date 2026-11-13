/** État de compte financier (MAD centimes).
 * Seuls les avoirs APPROUVÉS diminuent le solde ; les brouillons ne constituent
 * pas une opération comptable. Tri stable par date, type puis identifiant.
 */
export type ClientLedgerEvent={
  kind:"invoice"|"payment"|"credit";
  id:number; invoiceId:number; ref:string; invoiceRef:string;
  date:string; amountCents:number;
}
const priority={invoice:0,payment:1,credit:2} as const
export function buildClientStatement(events:readonly ClientLedgerEvent[],from?:string,to?:string){
  const sorted=[...events].sort((a,b)=>a.date.localeCompare(b.date)||priority[a.kind]-priority[b.kind]||a.id-b.id)
  let openingBalanceCents=0,closingBalanceCents=0
  const rows:{event:ClientLedgerEvent,balanceCents:number}[]=[]
  for(const item of sorted){
    if(!Number.isSafeInteger(item.amountCents)||item.amountCents<=0)throw Error("INVALID_LEDGER_AMOUNT")
    const signed=item.kind==="invoice"?item.amountCents:-item.amountCents
    const next=closingBalanceCents+signed
    if(!Number.isSafeInteger(next))throw Error("LEDGER_OVERFLOW")
    closingBalanceCents=next
    const date=item.date.slice(0,10)
    if(from&&date<from){openingBalanceCents=next;continue}
    if(!to||date<=to)rows.push({event:item,balanceCents:next})
  }
  // Si une borne finale existe, ne pas inclure les mouvements ultérieurs.
  if(to)closingBalanceCents=rows.length?rows[rows.length-1].balanceCents:openingBalanceCents
  return {openingBalanceCents,closingBalanceCents,rows}
}
