"use strict";
const assert=require('node:assert/strict');
const {checkPrivateHttps}=require('../scripts/check-private-https-r11.cjs');
const valid={GOCMD_PUBLIC_ORIGIN:'https://gocmd.example.ts.net',HOSTNAME:'127.0.0.1',GOCMD_TRUST_PROXY:'0',GOCMD_ALLOW_DEMO_DB:'0',GOCMD_REQUIRE_SQLITE_USERS:'1'};
assert.deepEqual(checkPrivateHttps(valid),[]);
for(const change of [
 {GOCMD_PUBLIC_ORIGIN:'http://gocmd.example.ts.net'},
 {GOCMD_PUBLIC_ORIGIN:'https://gocmd.example.ts.net/path'},
 {HOSTNAME:'0.0.0.0'},
 {GOCMD_TRUST_PROXY:'1'},
 {GOCMD_ALLOW_DEMO_DB:'1'},
 {GOCMD_REQUIRE_SQLITE_USERS:'0'},
])assert.ok(checkPrivateHttps({...valid,...change}).length>0,JSON.stringify(change));
console.log('PASS 7 cas pré-vol HTTPS privé; aucun accès réseau exécuté');
