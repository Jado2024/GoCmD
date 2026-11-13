import {NextRequest,NextResponse} from "next/server"
import {accessGate,currentActor,hasPermission} from "@/lib/access-gate"
import {readSalesTaxPolicy} from "@/lib/sales-tax-policy"
export const dynamic="force-dynamic"
export async function GET(req:NextRequest){
 const denied=accessGate(req,"finance");if(denied)return denied
 if(currentActor(req)?.managed&&!hasPermission(req,"sales.invoices"))return NextResponse.json({error:"Accès fiscal non autorisé"},{status:403})
 const rates=readSalesTaxPolicy(process.env.GOCMD_SALES_TAX_RATES_BPS)
 return NextResponse.json({configured:rates.length>0,rates,warning:"Taux à valider par la comptabilité SODEPI ; la configuration technique ne vaut pas homologation fiscale."},{headers:{"Cache-Control":"private, no-store"}})
}
