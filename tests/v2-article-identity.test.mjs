import test from 'node:test'
import assert from 'node:assert/strict'
import { technicalArticleIdentity,normalizedTechnicalAttributes } from '../src/lib/article-identity.ts'
import { fixedProductIdentity } from '../src/lib/fixed-product-identity.ts'
import { supplierLookupKey } from '../src/lib/supplier-sku-identity.ts'

const cloth = {type:'couture',composition:'PES',couleur:'BLE',piquage:'non',format:'rouleau',laizeCm:160,grammageGM2:250}
test('nonfoam identity independent of JSON key order',()=>{
 const a=technicalArticleIdentity('Tissu',cloth)
 const b=technicalArticleIdentity('Tissu',Object.fromEntries(Object.entries(cloth).reverse()))
 assert.deepEqual(a.errors,[])
 assert.equal(a.identity,b.identity)
 assert.equal(a.reference,b.reference)
})
test('distinctive color and gram weight have separate SKUs',()=>{
 assert.notEqual(technicalArticleIdentity('Tissu',cloth).reference,technicalArticleIdentity('Tissu',{...cloth,couleur:'ROU'}).reference)
 assert.notEqual(technicalArticleIdentity('Tissu',cloth).identity,technicalArticleIdentity('Tissu',{...cloth,grammageGM2:500}).identity)
})
test('mandatory units and unknown attributes rejected',()=>{
 const bad=technicalArticleIdentity('Tissu',{...cloth,laizeCm:-5,irrelevant:'x'})
 assert.ok(bad.errors.length>=2)
 assert.ok(normalizedTechnicalAttributes('Ressorts',{}).errors.length>0)
})
test('fixed PF canonically stable and varies by dimensions',()=>{
 const spec={family:'MATELAS',model:'Bonnell',variant:'STD',length:200,width:160,height:25,coreType:'BON'}
 const a=fixedProductIdentity(spec),b=fixedProductIdentity({...spec,width:140})
 assert.ok(a.sku.startsWith('PF-MAT-'))
 assert.notEqual(a.sku,b.sku)
 assert.notEqual(a.identity,b.identity)
})
test('supplier ref normalization retains meaningful characters and zeros',()=>{
 assert.equal(supplierLookupKey(1,'   F-0098/XL  '),supplierLookupKey(1,'f-0098/xl'))
 assert.notEqual(supplierLookupKey(1,'F-0098/XL'),supplierLookupKey(1,'F-98/XL'))
 assert.notEqual(supplierLookupKey(1,'F-0098/XL'),supplierLookupKey(2,'F-0098/XL'))
})
