'use strict';
// P5.15.14 DMAIC regression: assertions without vendor dependencies.
// These are source/permission contract tests, NOT end-to-end API browser tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
const directory = require('../src/lib/user-directory.cjs');
const warehouse = source('src/app/api/p2p/warehouse/route.ts');
const overview = source('src/app/api/p2p/overview/route.ts');
const admin = source('src/components/erp/users-admin-view.tsx');
const p2pUI = source('src/components/erp/p2p-advanced-view.tsx');
let passed = 0;
function check(name, fn) { fn(); passed++; process.stdout.write('PASS '+name+'\n'); }
check('stock.read and procurement overview rights are registered', () => {
  assert.ok(directory.RIGHTS['stock.read']);
  assert.ok(directory.RIGHTS['p2p.overview.read']);
});
for (const role of ['buyer','approver','receiver','inventory','quality','finance','director']) {
  check(role + ' can read warehouse by default', () => assert.equal(directory.allowed([role], {}, 'stock.read'), true));
  check(role + ' can read supply overview by default', () => assert.equal(directory.allowed([role], {}, 'p2p.overview.read'), true));
}
check('sales only cannot read warehouse or P2P overview', () => {
  assert.equal(directory.allowed(['sales'], {}, 'stock.read'), false);
  assert.equal(directory.allowed(['sales'], {}, 'p2p.overview.read'), false);
});
check('root cannot gain operational read rights', () => {
  assert.equal(directory.allowed(['admin'], {}, 'stock.read', true), false);
  assert.equal(directory.allowed(['admin'], {}, 'p2p.overview.read', true), false);
});
check('explicit deny defeats multi-role access', () => {
  assert.equal(directory.allowed(['buyer','finance'], {'stock.read':false}, 'stock.read'), false);
  assert.equal(directory.allowed(['inventory','quality'], {'p2p.overview.read':false}, 'p2p.overview.read'), false);
});
check('finance export requires its own granular permission in API and UI', () => {
  assert.match(overview, /hasPermission\(req,'finance\.export'\)/);
  assert.match(p2pUI, /hasPermission\(session,"finance\.export"\)/);
  assert.equal(directory.allowed(['finance'], {'finance.export':false}, 'finance.export'), false);
});
check('both sensitive read endpoints check role and explicit permissions', () => {
  assert.match(warehouse, /hasAnyReadRole\(req,\['buyer'/);
  assert.match(warehouse, /hasPermission\(req,'stock\.read'\)/);
  assert.match(overview, /hasAnyReadRole\(req,\['buyer'/);
  assert.match(overview, /hasPermission\(req,'p2p\.overview\.read'\)/);
});
check('admin can see labels for both new granular permissions', () => {
  assert.match(admin, /"stock\.read"/);
  assert.match(admin, /"p2p\.overview\.read"/);
});
check('invalid historical count can be rejected before unit validations, but approvals remain validated', () => {
  const begin = warehouse.indexOf("else if(d.action==='count')");
  const end = warehouse.indexOf("await tx.auditEvent.create", begin);
  const block = warehouse.slice(begin, end);
  const reject = block.indexOf('if(!d.approved)');
  const validate = block.indexOf("if(!countMaterial||!isValidStockQuantity");
  const approvalBranch = block.indexOf('else{', reject);
  const stockMutation = block.indexOf('await tx.stockPlacement.updateMany', approvalBranch);
  assert.ok(begin>=0 && reject>=0 && validate>approvalBranch && approvalBranch>reject && stockMutation>validate);
  assert.match(block, /status:'rejected',approvedBy:actor,approvedAt:new Date\(\)/);
  assert.match(block, /if\(!count\|\|count\.status!=='pending'\|\|count\.countedBy===actor\)throw Error\('DOUBLE_VALIDATION_REQUISE'\)/);
});
console.log(`P5.15.14 DMAIC contract checks: ${passed}/${passed} PASS`);
