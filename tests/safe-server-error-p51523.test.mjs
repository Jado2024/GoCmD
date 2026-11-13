import assert from 'node:assert/strict';
import fs from 'node:fs';
import { safeErrorMetadata } from '../src/lib/safe-server-error.ts';
const secret='password=unsafe, iban=MA1234, customer=Private Name';
const coded=Object.assign(new Error(secret),{name:'PrismaClientKnownRequestError',code:'P2002',meta:{secret}});
const result=safeErrorMetadata(coded);
assert.deepEqual(result,{kind:'PrismaClientKnownRequestError',code:'P2002'});
assert(!JSON.stringify(result).includes('MA1234'));
assert.deepEqual(safeErrorMetadata({name:secret,code:secret}),{kind:'Error'});
assert.deepEqual(safeErrorMetadata(new Error(secret)),{kind:'Error'});
for (const file of [
 'src/app/api/p2p/finance/route.ts','src/app/api/sales/route.ts',
 'src/app/api/supplier-invoices/[id]/route.ts','src/app/api/purchases/route.ts',
 'src/app/api/sales/statement/route.ts','src/lib/p2p-api-errors.ts'
]) {
 const source=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
 assert(source.includes('safeErrorMetadata('),file);
 assert(!/console\.error\([^\n]*?,\s*(?:e|err|error)\)/.test(source),file);
}
console.log('PASS: error type/code only, no raw errors, security-sensitive API logs sanitized');
