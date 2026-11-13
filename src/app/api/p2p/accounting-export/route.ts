import {accessGate,hasPermission,currentActor} from "@/lib/access-gate"
import {db} from "@/lib/db"
import {NextRequest} from "next/server"
import {safeCsvCell} from "@/lib/export-csv"

/** Working purchase ledger for accountant review, NOT a Moroccan tax filing. */
export async function GET(req:NextRequest){
 const denied=accessGate(req,"finance");if(denied)return denied
 if(currentActor(req)?.managed && !hasPermission(req,"finance.export"))return Response.json({error:"Export comptable non autorisé"},{status:403})
 const invoices=await db.supplierInvoice.findMany({
  include:{supplier:true,lines:{include:{receiptLine:{include:{supplierOrderLine:{include:{order:true}}}}}}},
  orderBy:[{invoiceDate:"asc"},{id:"asc"}],take:5000,
 })
 const totalCount=await db.supplierInvoice.count()
 // V18.9.2 (contre-audit F01) : colonne « Nature de ligne » ajoutée au schéma
 // pour TOUTES les lignes (ARTICLE / FRET). Chaque ligne produit EXACTEMENT le
 // même nombre de champs que l'en-tête : le fret n'est plus logé à travers les
 // colonnes Quantité / Prix HT / Taux taxe %. Les valeurs HT, TVA et TTC de la
 // ligne fret correspondent désormais à leurs en-têtes, et la somme de la
 // colonne « TTC estimé », fret inclus, égale le total de la facture au
 // centime. Les parseurs doivent lire les colonnes PAR LEUR NOM d'en-tête.
 const head=["Fournisseur","Numéro facture","Date facture","Devise","Statut","N° BC","N° BR","Ligne BR","Nature de ligne","Quantité","Prix HT","Taux taxe %","Base HT","Taxe estimée","TTC estimé","Validation fiscale"]
 const rows=[head.map(safeCsvCell).join(";")]
 for(const inv of invoices){
  for(const line of inv.lines){
   const qty=line.qty,unit=Number(line.unitPrice),tax=Number(line.taxRate)
   const ht=Math.round(qty*unit*100)/100
   const taxe=Math.round(ht*tax)/100
   const data=[inv.supplier.name,inv.invoiceNumber,inv.invoiceDate.toISOString().slice(0,10),inv.currency,inv.status,line.receiptLine?.supplierOrderLine.order.ref??"",line.receiptLine?.goodsReceiptId??"",line.receiptLineId??"","ARTICLE",qty,unit.toFixed(4),tax.toFixed(4),ht.toFixed(2),taxe.toFixed(2),(ht+taxe).toFixed(2),"A VALIDER PAR COMPTABLE MAROC"]
   rows.push(data.map(safeCsvCell).join(";"))
  }
  // V18.9.1 (contre-audit A-06) : le fret est intégré au total de la facture
  // en base ; il doit apparaître au journal sous forme de ligne dédiée pour
  // que la somme des écritures égalise le total facturé.
  // V18.9.2 (contre-audit F01) : la ligne fret respecte le schéma — Nature de
  // ligne = FRET, Quantité = 1, Prix HT = montant du fret, Taux taxe = 0 (la
  // TVA sur le fret n'est pas modélisée à ce jour : mention fiscale conservée
  // pour validation par le comptable), Base HT = TTC = montant du fret.
  const freight=Number(inv.freightAmount)
  if(freight>0){
   const data=[inv.supplier.name,inv.invoiceNumber,inv.invoiceDate.toISOString().slice(0,10),inv.currency,inv.status,"","","","FRET",1,freight.toFixed(4),"0.0000",freight.toFixed(2),"0.00",freight.toFixed(2),"A VALIDER PAR COMPTABLE MAROC"]
   rows.push(data.map(safeCsvCell).join(";"))
  }
 }
 // V18.9.1 (contre-audit A-12) : signaler explicitement toute troncature.
 const truncated=totalCount>invoices.length
 return new Response("\uFEFF"+rows.join("\r\n"),{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename=\"gocmd_journal_achats_pour_controle.csv\"","Cache-Control":"no-store","X-Total-Count":String(totalCount),"X-Rows-Exported":String(invoices.length),...(truncated?{"X-Truncated":"true"}:{})}})
}
