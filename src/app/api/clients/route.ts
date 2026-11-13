import { safeErrorMetadata } from "@/lib/safe-server-error"
import { accessGate, currentActor,hasPermission } from "@/lib/access-gate"
import { serializedSQLiteWrite } from "@/lib/sqlite-write"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

// Création d'un client à la volée (depuis la saisie de commande) :
// une commande peut concerner un particulier ponctuel (sans données personnelles en source)
// qui n'existe pas encore dans la base.
const Schema = z.object({
  name: z.string().trim().min(2, "Nom trop court").max(120),
  city: z.string().trim().min(2, "Ville trop courte").max(80),
  phone: z
    .string()
    .trim()
    .max(30)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
})

export async function GET(req: NextRequest) {
  const denied = accessGate(req)
  if (denied) return denied
  // Données confidentielles (téléphones, villes) : lecture alignée sur la
  // matrice clients.read (sales, finance, approver) ; jamais le compte démo
  // partagé. C4-11 (contre-audit CASCADE4) : l'approbateur est rétabli — la
  // liste RIGHTS et la matrice documentée l'incluaient déjà ; GET /api/orders
  // l'accepte également.
  const actor=currentActor(req)
  const mayRead=actor&&(!actor.legacy&&actor.roles.some(r=>r==="sales"||r==="finance"||r==="approver"))
  if(actor?.managed && !hasPermission(req,"clients.read"))return NextResponse.json({error:"Permission de lecture clients désactivée"},{status:403})
  if(!mayRead)return NextResponse.json({error:"Répertoire clients réservé aux rôles commercial, finance et administration"},{status:403})





  // Rechercher dans TOUT le répertoire avant pagination. Ne jamais envoyer
  // les coordonnées de milliers de clients à un navigateur pour faire le tri.
  const params=req.nextUrl.searchParams
  const q=(params.get("q")??"").trim()
  const take=Number(params.get("take")??50)
  const skip=Number(params.get("skip")??0)
  const selectedIdRaw=params.get("id")
  const selectedId=selectedIdRaw===null?null:Number(selectedIdRaw)
  if(q.length>120 || !Number.isSafeInteger(take)||take<1||take>100 ||
     !Number.isSafeInteger(skip)||skip<0||skip>10_000_000 ||
     (selectedIdRaw!==null&&(!Number.isSafeInteger(selectedId)||Number(selectedId)<1)))
    return NextResponse.json({error:"Recherche ou pagination clients invalide"},{status:400})
  const where=selectedId!==null?{id:selectedId}:{...(q?{OR:[{name:{contains:q}},{city:{contains:q}}]}:{})}
  const [total,clients]=await Promise.all([
    db.client.count({where}),
    db.client.findMany({where,orderBy:[{name:"asc"},{id:"asc"}],skip,take,
      select:{id:true,name:true,city:true,phone:true}}),
  ])
  return NextResponse.json({items:clients,pagination:{total,take,skip,pages:Math.max(1,Math.ceil(total/take))}},
    {headers:{"Cache-Control":"private, no-store","Vary":"Authorization"}})
}

export async function POST(req: NextRequest) {
  const denied = accessGate(req,"sales")
  if (denied) return denied





  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Champs invalides", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }
  const { name, city, phone } = parsed.data
  const actor=currentActor(req)!.username

  try {
    // Le nom est unique : on refuse proprement les doublons (le champ
    // SQLite est sensible à la casse, on normalise la comparaison ici).
    // Contrôle et création dans la même transaction sérialisée pour éviter
    // un doublon concurrent entre deux saisies simultanées.
    const client=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
      const existing=await tx.client.findMany({select:{id:true,name:true,city:true,phone:true}})
      const clash=existing.find((c)=>c.name.trim().toLowerCase()===name.toLowerCase())
      if(clash)throw new Error("DUPLICATE")
      const created=await tx.client.create({data:{name,city,phone}})
      await tx.auditEvent.create({data:{actor,action:"CLIENT_CREATED",entity:"Client",entityId:String(created.id),details:JSON.stringify({name:created.name,city:created.city})}})
      return created
    }))
    return NextResponse.json({ client }, { status: 201 })
  } catch (e) {
    if(e instanceof Error&&e.message==="DUPLICATE"){
      // Recherche insensible à la casse pour retrouver la fiche existante.
      const candidates=await db.client.findMany({where:{name:{contains:name}},select:{id:true,name:true,city:true,phone:true}})
      const clash=candidates.find((c)=>c.name.trim().toLowerCase()===name.toLowerCase())
      if(clash)return NextResponse.json({error:`« ${clash.name} » existe déjà (${clash.city})`,client:clash},{status:409})
    }
    console.error("[clients:create] erreur:",safeErrorMetadata(e))
    return NextResponse.json({error:"Création du client impossible"},{status:409})
  }
}
