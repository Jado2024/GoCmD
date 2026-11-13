import {NextRequest,NextResponse} from "next/server"
import {accessGate,currentActor,hasPermission,isDirector} from "@/lib/access-gate"
import {db} from "@/lib/db"

export const dynamic="force-dynamic"
/** File serveur complète : aucune proposition ne disparaît au-delà de 200 MP. */
export async function GET(req:NextRequest){
  const denied=accessGate(req);if(denied)return denied
  if(!isDirector(req)||(currentActor(req)?.managed&&!hasPermission(req,"director.prices")))
    return NextResponse.json({error:"Visa directeur requis"},{status:403})
  const sp=req.nextUrl.searchParams, page=Number(sp.get("page")??1),pageSize=Number(sp.get("pageSize")??40)
  const q=(sp.get("q")??"").trim()
  if(!Number.isSafeInteger(page)||page<1||page>1000000||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100||q.length>100)
    return NextResponse.json({error:"Filtres de propositions invalides"},{status:400})
  const where={isSellable:true,pendingSalesUnitPrice:{not:null},...(q?{OR:[{ref:{contains:q}},{name:{contains:q}}]}:{})}
  const [total,items]=await Promise.all([
    db.material.count({where}),
    db.material.findMany({where,orderBy:[{salesPriceProposedAt:"asc"},{id:"asc"}],skip:(page-1)*pageSize,take:pageSize,
      select:{id:true,ref:true,name:true,salesUnit:true,salesUnitPrice:true,pendingSalesUnitPrice:true,
        salesPriceProposedBy:true,salesPriceProposalRevision:true,salesPriceProposedAt:true}}),
  ])
  return NextResponse.json({items,total,page,pageSize,pages:Math.max(1,Math.ceil(total/pageSize))},
    {headers:{"Cache-Control":"private, no-store"}})
}
