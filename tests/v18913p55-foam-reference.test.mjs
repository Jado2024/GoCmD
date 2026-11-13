import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  foamSpecErrors,foamReferencePrefixFromSpec,foamIdentityKey,
  foamDescriptionFromSpec,foamDimensionsText,nextFoamReference,FOAM_COLORS,
} from '../src/lib/material-reference.ts'
const block={
 foamNature:'PURE',foamFormat:'BLOC',foamGrade:'HR',foamDensity:30,foamColor:'BLN',
 foamFirmness:'FER',foamResilience:null,foamSupplierGrade:null,
 foamLengthCm:200,foamWidthCm:100,foamHeightCm:50,foamThicknessCm:null,
}
let checks=0
function eq(a,b,msg){assert.equal(a,b,msg);checks++}
function ok(a,msg){assert.ok(a,msg);checks++}
eq(foamSpecErrors(block).length,0,'bloc complet valide')
const prefix=foamReferencePrefixFromSpec(block)
eq(prefix,'MP-MOU-PUR-HR-D30-BLN-BLC-FER-LG200-LR100-HT50')
eq(nextFoamReference(prefix,[]),prefix+'-001')
eq(nextFoamReference(prefix,[prefix+'-001']),prefix+'-002')
const text=foamDescriptionFromSpec(block)
ok(text.name.includes('200 × 100 × 50 cm'))
ok(text.description.includes('200 × 100 × 50 cm'))
ok(text.description.includes('fermeté ferme'))
eq(foamDimensionsText(block),'200 × 100 × 50 cm')
const change=(key,value)=>({...block,[key]:value})
for(const [key,value] of [['foamColor','BLE'],['foamFirmness','SOU'],['foamDensity',35],['foamLengthCm',210],['foamWidthCm',110],['foamHeightCm',45],['foamGrade','STD']]){
 const changed=change(key,value)
 ok(foamReferencePrefixFromSpec(changed)!==prefix,'variante change le préfixe: '+key)
 ok(foamIdentityKey(changed)!==foamIdentityKey(block),'variante change l’identité: '+key)
}
const resilience=change('foamResilience',45)
ok(foamReferencePrefixFromSpec(resilience).includes('-RES45-'))
ok(foamDescriptionFromSpec(resilience).description.includes('résilience 45 %'))
ok(foamIdentityKey(resilience)!==foamIdentityKey(block))
const supplier=change('foamSupplierGrade','HRX 30')
ok(foamReferencePrefixFromSpec(supplier).includes('-GFHRX30-'))
ok(foamDescriptionFromSpec(supplier).description.includes('grade technique HRX 30'))
const plate={...block,foamFormat:'PLAQUE',foamHeightCm:null,foamThicknessCm:5,foamFirmness:null}
eq(foamSpecErrors(plate).length,0)
ok(foamReferencePrefixFromSpec(plate).includes('-LG200-LR100-EP5'))
ok(foamDescriptionFromSpec(plate).description.includes('200 × 100 × 5 cm'))
const roll={...plate,foamFormat:'ROULEAU',foamLengthCm:null}
eq(foamSpecErrors(roll).length,0)
ok(foamReferencePrefixFromSpec(roll).includes('-LR100-EP5'))
ok(!foamReferencePrefixFromSpec(roll).includes('-LG'))
ok(foamDescriptionFromSpec(roll).description.includes('longueur variable'))
const rollFixed={...roll,foamLengthCm:500}
ok(foamReferencePrefixFromSpec(rollFixed).includes('-LG500-LR100-EP5'))
ok(foamDescriptionFromSpec(rollFixed).description.includes('longueur fixe 500 cm'))
eq(foamReferencePrefixFromSpec({...roll,foamNature:'AGGLO'}),null)
eq(foamSpecErrors({...block,foamWidthCm:null}).length>0,true)
eq(foamSpecErrors({...block,foamThicknessCm:20}).length>0,true)
eq(foamSpecErrors({...plate,foamHeightCm:50}).length>0,true)
eq(foamSpecErrors({...block,foamResilience:101}).length>0,true)
eq(foamSpecErrors({...block,foamGrade:'SPE',foamSupplierGrade:null}).length>0,true)
eq(foamSpecErrors({...block,foamGrade:'VIS',foamNature:'AGGLO'}).length>0,true)
eq(foamSpecErrors({...block,foamDensity:30.000001}).length>0,true)
eq(foamSpecErrors({...block,foamWidthCm:-1}).length>0,true)
eq(foamSpecErrors({...block,foamColor:'INCONNU'}).length>0,true)
const same={...block,foamDensity:30.0,foamSupplierGrade:''}
eq(foamIdentityKey(same),foamIdentityKey(block))
ok(FOAM_COLORS.some(c=>c.value==='BLN')&&FOAM_COLORS.some(c=>c.value==='BLE'))
// Contrats statiques des contrôles sensibles, sans faux positif d'exécution HTTP.
const get=(path)=>fs.readFileSync(path,'utf8')
const post=get('src/app/api/materials/route.ts')
const update=get('src/app/api/materials/[id]/route.ts')
const preview=get('src/app/api/materials/reference/route.ts')
const schema=get('prisma/schema.prisma')
const form=get('src/components/erp/materials-view.tsx')
for (const value of ['foamColor','foamFirmness','foamResilience','foamLengthCm','foamWidthCm','foamHeightCm','foamThicknessCm','foamIdentityKey','description']) ok(schema.includes(value),'schema '+value)
for (const value of ['foamSpecErrors','foamIdentityKey','DUPLICATE_FOAM_VARIANT','serializedSQLiteWrite','MATERIAL_CREATED','foamDescriptionFromSpec','stockQty:0'])ok(post.includes(value),'POST '+value)
for (const value of ['FOAM_IDENTITY_IMMUTABLE','MATERIAL_UPDATED','UNIT_HAS_HISTORY','foamDescriptionFromSpec'])ok(update.includes(value),'PATCH '+value)
for (const value of ['duplicate:!!duplicate','nextFoamReference','foamDescriptionFromSpec'])ok(preview.includes(value),'prévisualisation '+value)
for (const value of ['foamLengthCm','foamWidthCm','foamThicknessCm','foamFirmness','foamResilience','FOAM_GRADES','FOAM_COLORS','displayDescription','descriptionTouched'])ok(form.includes(value),'UI '+value)
console.log(`PASS : ${checks} contrôles logiques/statique — formats, tailles, descriptions, suffixes, identité, restrictions et RBAC`)
