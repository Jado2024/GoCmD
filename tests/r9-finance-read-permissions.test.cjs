'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const directory=require('../src/lib/user-directory.cjs')
const src=(file)=>fs.readFileSync(file,'utf8')

test('finance role with individually revoked finance.purchases does not pass privilege model',()=>{
 assert.equal(directory.allowed(['finance'],{},'finance.purchases'),true)
 assert.equal(directory.allowed(['finance'],{'finance.purchases':false},'finance.purchases'),false)
 assert.equal(directory.allowed(['sales'],{},'finance.purchases'),false)
})
test('supplier invoice list and P2P finance list guard individual finance revocation',()=>{
 const invoices=src('src/app/api/supplier-invoices/route.ts')
 const finance=src('src/app/api/p2p/finance/route.ts')
 assert.match(invoices,/export async function GET[\s\S]*?accessGate\(req,"finance"\)[\s\S]*?currentActor\(req\)\?\.managed\s*&&\s*!hasPermission\(req,"finance\.purchases"\)/)
 assert.match(finance,/export async function GET[\s\S]*?accessGate\(req,'finance'\)[\s\S]*?currentActor\(req\)\?\.managed\s*&&\s*!hasPermission\(req,'finance\.purchases'\)/)
 assert.match(invoices, /Lecture des factures fournisseurs non autorisée/)
 assert.match(finance,/Lecture financière non autorisée/)
})
