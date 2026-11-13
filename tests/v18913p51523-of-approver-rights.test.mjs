/** Regression contract for authorizing work orders with approver-only credentials.
 * Node RBAC and navigation assertions are executable; source guards ensure the
 * API/UI uses the same contract. Full HTTP scenarios require Next.js runtime. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { visibleViews } from '../src/lib/role-navigation.ts'
const require=createRequire(import.meta.url)
const {allowed}=require('../src/lib/user-directory.cjs')
const source=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

const session=(roles,permissions={})=>({username:'chef',roles,permissions,managed:true,legacy:false})

test('approbateur pur: peut consulter les commandes et approuver les OF, mais ne vend pas',()=>{
  assert.equal(allowed(['approver'],{},'sales.approve'),true)
  assert.equal(allowed(['approver'],{},'clients.read'),true)
  assert.equal(allowed(['approver'],{},'sales.orders'),false)
  assert.equal(allowed(['approver'],{},'sales.deliveries'),false)
  assert.ok(visibleViews(session(['approver'])).includes('orders'))
})

test('commercial pur: crée les commandes mais ne valide pas les OF',()=>{
  assert.equal(allowed(['sales'],{},'sales.orders'),true)
  assert.equal(allowed(['sales'],{},'sales.approve'),false)
})

test('refus explicites, administrateur racine et autres rôles restent bloqués',()=>{
  assert.equal(allowed(['approver'],{'sales.approve':false},'sales.approve'),false)
  assert.equal(allowed(['approver'],{'clients.read':false},'clients.read'),false)
  assert.equal(allowed(['inventory'],{},'sales.approve'),false)
  assert.equal(allowed(['admin'],{},'sales.approve',true),false)
})

test('approbateur = décision historique, magasinier = préparation sans auto-approbation',()=>{
  const of=source('src/app/api/work-orders/route.ts')
  const patch=source('src/app/api/work-orders/[id]/route.ts')
  const orders=source('src/app/api/orders/route.ts')
  const panel=source('src/components/erp/work-orders-panel.tsx')
  const orderPanel=source('src/components/erp/orders-view.tsx')
  const inventory=source('src/components/erp/inventory-work-orders.tsx')
  const gate=source('src/lib/access-gate.ts')
  assert.match(of,/return hasRole\(req,"approver"\) &&/)
  assert.doesNotMatch(of,/hasRole\(req,"sales"\)/)
  assert.doesNotMatch(patch,/hasRole\(req,"sales"\)/)
  assert.match(patch,/hasRole\(req,"approver"\)/)
  assert.match(patch,/hasRole\(req,"inventory"\)/)
  assert.match(patch,/hasPermission\(req,"stock.move"\)/)
  assert.match(of,/\["sales.approve","clients.read"\]/)
  assert.match(orders,/\["sales","approver","finance","director"\]/)
  assert.match(panel,/const manager=hasRole\(session,"approver"\)/)
  assert.match(orderPanel,/\{canSell && NEXT_LABEL\[detail.status\]/)
  assert.match(inventory,/transition\(of,"prepare"\)/)
  assert.match(gate,/work-orders.*return null/)
  assert.match(patch,/item.createdBy===actor/)
  assert.match(patch,/SELF_APPROVAL/)
  assert.match(patch,/serializedSQLiteWrite/)
})
