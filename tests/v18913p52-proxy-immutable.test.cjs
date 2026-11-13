"use strict";
// Isolated middleware regression for the production "TypeError: immutable".
// Uses the actual src/proxy.ts compiled to CJS and stubs only the Next.js class.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const file = path.join(__dirname, '../src/proxy.ts');
const code = ts.transpileModule(fs.readFileSync(file,'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
let gateResponse = null;
let nextInput = null;
class TestNextResponse extends Response {
  static next(input) { nextInput = input; return new TestNextResponse(null, {status:200}); }
}
const mod = new Module(file, module);
mod.filename=file;
mod.paths=Module._nodeModulePaths(path.dirname(file));
mod.require = (id) => {
  if (id === 'next/server') return { NextResponse: TestNextResponse };
  if (id === '@/lib/access-gate') return { accessGate: ()=> gateResponse };
  throw new Error('Unexpected import: ' + id);
};
mod._compile(code, file);
const proxy = mod.exports.proxy;
const request = {headers:new Headers(),url:'http://127.0.0.1:3001/dashboard'};

// Reproduce previous failure. Response.redirect yields immutable headers.
gateResponse=Response.redirect('http://127.0.0.1:3001/login',302);
assert.throws(()=>gateResponse.headers.set('Cache-Control','no-store'), /immutable/i);
const redirect=proxy(request);
assert.equal(redirect.status,302);
assert.equal(redirect.headers.get('location'),'http://127.0.0.1:3001/login');
assert.equal(redirect.headers.get('Cache-Control'),'no-store');
assert.match(redirect.headers.get('Content-Security-Policy')||'',/script-src/);
assert.equal(gateResponse.headers.get('Content-Security-Policy'),null,'original immutable redirect must remain unchanged');

// Denied APIs must remain denied and retain their error body.
gateResponse=Response.json({error:'Permission refusée'}, {status:403,headers:{'X-Original':'kept'}});
const forbidden=proxy(request);
assert.equal(forbidden.status,403);
assert.equal(forbidden.headers.get('X-Original'),'kept');
assert.equal(forbidden.headers.get('Content-Type'),'application/json');
forbidden.text().then(body=>{
  assert.match(body,/Permission refusée/);
  gateResponse=null;
  const allowed=proxy(request);
  assert.equal(allowed.status,200);
  assert.equal(allowed.headers.get('Cache-Control'),'no-store');
  assert.ok(nextInput?.request?.headers?.get('x-nonce'));
  assert.ok(nextInput?.request?.headers?.get('Content-Security-Policy'));
  console.log('PASS P5.2: immutable redirect, 403 denial, CSP and nonce, no authorization bypass');
}).catch(e=>{ console.error(e);process.exitCode=1; });
