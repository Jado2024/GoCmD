/// <reference types="bun-types" />
import {describe,test,expect} from 'bun:test'
import {supplierInvoicePolicyIssues} from '../src/lib/purchase-invoice-policy'
const base={taxRates:[20],freightCents:20000,goodsCents:100000,strict:true}
describe('RR-02 / RR-03 production financial guard',()=>{
 test('unconfigured tax & freight rules hold an invoice',()=>{
  expect(supplierInvoicePolicyIssues(base)).toEqual(['TVA_ACHAT_NON_VALIDEE_PAR_COMPTABILITE','FRET_PLAFOND_NON_CONFIGURE'])
 })
 test('accountant-configured rates and justified cap permit a normal invoice',()=>{
  expect(supplierInvoicePolicyIssues({...base,approvedTaxRatesBps:'0,2000',maxFreightBps:'2500'})).toEqual([])
 })
 test('over-cap freight is held',()=>{
  expect(supplierInvoicePolicyIssues({...base,approvedTaxRatesBps:'0,2000',maxFreightBps:'1000'})).toEqual(['FRET_HORS_PLAFOND_A_VALIDER'])
 })
 test('arbitrary tax percentages are held',()=>{
  expect(supplierInvoicePolicyIssues({...base,taxRates:[35],approvedTaxRatesBps:'0,2000',maxFreightBps:'2500'})).toEqual(['TVA_ACHAT_NON_VALIDEE_PAR_COMPTABILITE'])
 })
 test('demo without policy stays demonstrable',()=>{
  expect(supplierInvoicePolicyIssues({...base,strict:false})).toEqual([])
 })
})
