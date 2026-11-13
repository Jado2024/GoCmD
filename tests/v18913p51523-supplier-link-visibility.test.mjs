import assert from 'node:assert/strict'
import {supplierLinkForReader} from '../src/lib/supplier-link-visibility.ts'
const link={id:7,supplierId:2,materialId:5,unitPrice:33.5,leadTimeDays:5,preferred:true}
const allowed=supplierLinkForReader(link,true)
assert.equal(allowed.unitPrice,33.5,'authorized price must be unchanged')
assert.deepEqual(allowed,link)
const denied=supplierLinkForReader(link,false)
assert.equal(denied.unitPrice,null,'forbidden supplier unit price must not leak')
assert.equal(denied.materialId,link.materialId)
assert.equal(denied.leadTimeDays,link.leadTimeDays)
assert.equal(link.unitPrice,33.5,'read-only DTO must not mutate stored price')
const old={...link,unitPrice:0}
assert.equal(supplierLinkForReader(old,false).unitPrice,null,'even 0 is redacted')
assert.equal(supplierLinkForReader({...link,unitPrice:null},false).unitPrice,null)
console.log('PASS supplier link DTO: price allowed/masked and original untouched (5 checks)')
