'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const directory=require('../src/lib/user-directory.cjs');
const permission=(perms)=>directory.allowed(['director'],perms,'clients.read',false);
// Le directeur conserve le droit par défaut, mais un refus nominatif prime.
assert.equal(permission({}),true);
assert.equal(permission({'clients.read':true}),true);
assert.equal(permission({'clients.read':false}),false);
assert.equal(directory.allowed(['admin'],{},'clients.read',true),false);
assert.equal(directory.allowed(['inventory'],{},'clients.read',false),false);
for(const file of ['src/app/api/orders/route.ts','src/app/api/orders/[id]/route.ts','src/app/api/work-orders/route.ts']){
 const source=fs.readFileSync(path.join(root,file),'utf8');
 assert.match(source,/hasPermission\(req,"clients\.read"\)/,file);
 assert.doesNotMatch(source,/actor\.roles\.includes\("director"\)\s*\|\|\s*hasPermission\(req,"clients\.read"\)/,file);
}
console.log('PASS R12: directeur par défaut, refus nominatif prioritaire, lecture listes/détail/OF, admin interdit');
