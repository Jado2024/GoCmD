"use strict";
// Test isolé de la logique de sécurité réellement extraite de route.ts.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname,"../src/app/api/admin/users/route.ts"),"utf8");
const match = source.match(/function secure\(req:NextRequest\):boolean\{[\s\S]*?\n\}\nfunction authorized/);
assert(match,"Fonction secure() introuvable");
const fn = match[0].replace(/\nfunction authorized$/,"").replace("req:NextRequest","req").replace("):boolean{","){ ");
const sandbox = {process:{env:{}},URL,Set};
vm.createContext(sandbox);
vm.runInContext(`${fn}; globalThis.checkSecure=secure`,sandbox);
const check=(configured,host)=>{
  sandbox.process.env.GOCMD_PUBLIC_ORIGIN=configured;
  return sandbox.checkSecure({headers:{get:(k)=>k==="host"?host:null}});
};
const cases = [
 ["http://127.0.0.1:3001","127.0.0.1:3001",true,"local IPv4 configuré"],
 ["http://localhost:3001","localhost:3001",true,"localhost configuré"],
 ["http://[::1]:3001","[::1]:3001",true,"local IPv6 configuré"],
 ["http://127.0.0.1:3001","localhost:3001",false,"hôte divergent"],
 ["http://127.0.0.1:3001","127.0.0.1:3002",false,"port divergent"],
 ["http://example.com:3001","example.com:3001",false,"HTTP distant refusé"],
 ["http://example.com:3001","127.0.0.1:3001",false,"HTTP public déguisé en localhost refusé"],
 ["https://erp.example.com","erp.example.com",true,"HTTPS public préservé"],
 ["","127.0.0.1:3001",true,"HTTP local non configuré"],
 ["","localhost:3001",true,"HTTP localhost non configuré"],
 ["","example.com",false,"HTTP distant non configuré refusé"],
 ["http://example.com","localhost:3001",false,"origine externe HTTP refusée"],
 ["not-a-url","localhost:3001",false,"origine invalide refusée"],
 ["ftp://localhost:3001","localhost:3001",false,"protocole non HTTP refusé"],
];
for(const [configured,host,expected,label] of cases){
  assert.equal(check(configured,host),expected,label);
  process.stdout.write(`PASS ${label}\n`);
}
console.log(`PASS ${cases.length} scénarios de sécurité HTTP/HTTPS`);
