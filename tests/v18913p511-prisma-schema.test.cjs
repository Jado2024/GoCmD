const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const schema=fs.readFileSync(path.join(root,'prisma/schema.prisma'),'utf8');
const migration=fs.readFileSync(path.join(root,'scripts/upgrade_sourcing_p511.py'),'utf8');
const block=schema.match(/model SupplierQuoteOffer\s*\{([\s\S]*?)\n\}/)?.[1];
assert.ok(block, 'SupplierQuoteOffer missing');
for(const [field,type,sql] of [['quoteRef','String?','TEXT'],['validUntil','DateTime?','DATETIME'],['documentRef','String?','TEXT']]){
 const line=block.split('\n').some(line=>line.trim().split(/\s+/).slice(0,2).join(' ')===`${field} ${type}`);
 assert.ok(line,`${field}: missing or wrong Prisma type`);
 assert.ok(migration.includes(`"${field}":"${sql}"`),`${field}: missing SQLite migration field`);
}
const order=fs.readFileSync(path.join(root,'src/app/api/supplier-orders/route.ts'),'utf8');
// P5.15.x : la garde est centralisée dans isAuthorizedSupplierQuote (exige quoteRef
// et validUntil non nuls et non expirés, plus quatre yeux selon le canal).
assert.ok(order.includes('isAuthorizedSupplierQuote'),'authorized-quote guard must be applied to quote sources');
assert.ok(/winningQuotes\.filter\(q=>\{[\s\S]*?isAuthorizedSupplierQuote/.test(order),'winning quotes must pass the authorization guard before listing');
assert.ok(order.includes('ref:q.quoteRef!')&&order.includes('q.validUntil!.toISOString()'),'Null quote dates must be excluded from list (guard guarantees non-null before mapping)');
const guard=fs.readFileSync(path.join(root,'src/lib/supplier-quote-authorization.ts'),'utf8');
assert.ok(guard.includes('!q.quoteRef||!q.validUntil'),'guard must reject null quoteRef/validUntil');
console.log('PASS P5.11.1 : Prisma/SQLite devis synchronises, dates null protegees');
