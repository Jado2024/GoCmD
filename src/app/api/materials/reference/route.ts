import { accessGate } from "@/lib/access-gate"
import { db } from "@/lib/db"
import { foamReferencePrefixFromSpec, foamDescriptionFromSpec, foamIdentityKey, foamSpecErrors, nextFoamReference, type FoamSpec } from "@/lib/material-reference"
import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"
function readOptional(sp:URLSearchParams,name:string): number|null {
 const raw=sp.get(name)
 return raw&&raw.trim()!==""?Number(raw):null
}
/** Simple aperçu : la création finale se fait dans une transaction avec unicité. */
export async function GET(req: NextRequest) {
 const denied=accessGate(req, "buyer")
 if(denied)return denied
 const sp=req.nextUrl.searchParams
 const spec:FoamSpec={
  foamNature:sp.get("nature")||"",foamFormat:sp.get("format")||"",foamGrade:sp.get("grade")||"",
  foamDensity:readOptional(sp,"density")??0,foamColor:sp.get("color")||"",
  foamFirmness:sp.get("firmness")||null,foamResilience:readOptional(sp,"resilience"),
  foamSupplierGrade:sp.get("supplierGrade")||null,foamLengthCm:readOptional(sp,"lengthCm"),
  foamWidthCm:readOptional(sp,"widthCm"),foamHeightCm:readOptional(sp,"heightCm"),
  foamThicknessCm:readOptional(sp,"thicknessCm"),
 }
 const errors=foamSpecErrors(spec)
 if(errors.length)return NextResponse.json({error:"Caractéristiques mousse invalides",details:errors},{status:400})
 const prefix=foamReferencePrefixFromSpec(spec)!
 const identity=foamIdentityKey(spec)!
 const materials=await db.material.findMany({select:{ref:true,foamIdentityKey:true}})
 const duplicate=materials.find(m=>m.foamIdentityKey===identity)
 const reference=duplicate?.ref??nextFoamReference(prefix,materials.map(m=>m.ref))
 return NextResponse.json({reference,prefix,duplicate:!!duplicate,description:foamDescriptionFromSpec(spec)})
}
