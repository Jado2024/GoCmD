/** SODEPI V2 — gabarits non stockables, configuration propre à la ligne. */
import { createHash } from "node:crypto"
import type { Product } from "@prisma/client"

import { GENERIC_TEMPLATES, type GenericSpec } from "./generic-templates"

export function genericVirtualProduct(g:GenericSpec,unitPrice:number,productId:number):Product {
  const t=GENERIC_TEMPLATES[g.template]
  // Prévisualisation uniquement : jamais une fiche Prisma, ni un SKU public.
  // D-GEN-01 : la prévisualisation porte les champs taxonomiques saisis pour
  // refléter exactement la fiche INT-GEN qui sera persistée.
  return {id:productId,sku:"HORS CATALOGUE",name:g.description,family:t.family,model:g.template,
    variant:"STD",length:g.lengthCm??0,width:g.widthCm??0,height:g.heightCm??0,unit:t.unit,unitPrice,
    status:"active",specialNotes:null,specialPriceStatus:"not_required",materialId:null,
    coreType:g.coreType??null,foamComposition:g.foamComposition??null,mattressFinish:g.mattressFinish??null,upholstery:null,
    foamNature:g.foamNature??null,foamDensity:g.foamDensity??null,foamGrade:g.foamGrade??null,
    foamLayers:g.foamLayers?JSON.stringify(g.foamLayers):null,
    unitsPerSale:1,isOrderScoped:true} as Product
}
export function genericLineSnapshot(g:GenericSpec,unitPrice:number,qty:number) {
  const t=GENERIC_TEMPLATES[g.template]
  return {version:2,kind:"GENERIC",template:g.template,description:g.description,
    specifications:g.specifications,dimensions:g.lengthCm===undefined?null:{lengthCm:g.lengthCm,widthCm:g.widthCm!,heightCm:g.heightCm!},
    // D-GEN-01 : caractéristiques taxonomiques réellement saisies, incluses
    // dans l'instantané scellé et son empreinte SHA-256.
    coreType:g.coreType??null,foamComposition:g.foamComposition??null,mattressFinish:g.mattressFinish??null,
    foamNature:g.foamNature??null,foamDensity:g.foamDensity??null,foamGrade:g.foamGrade??null,
    foamLayers:g.foamLayers??null,
    unit:t.unit,unitPrice,quantity:qty,requiresPreparation:g.requiresPreparation}
}
export function catalogLineSnapshot(p:Product,unitPrice:number,qty:number,dimensions?:{lengthCm:number;widthCm:number;heightCm:number},instructions?:string|null){
  return {version:2,kind:"CATALOG",reference:p.sku,description:p.name,family:p.family,model:p.model,
    coreType:p.coreType,foamComposition:p.foamComposition,mattressFinish:p.mattressFinish,
    upholstery:p.upholstery,foamNature:p.foamNature,foamGrade:p.foamGrade,foamDensity:p.foamDensity,
    foamLayers:p.foamLayers,dimensions:dimensions??{lengthCm:p.length,widthCm:p.width,heightCm:p.height},
    unit:p.unit,unitPrice,quantity:qty,instructions:instructions??null}
}
export function snapshotHash(snapshot:unknown):string {
 return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")
}
