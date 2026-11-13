'use strict';
// Test-only bridge for historical recipes: the server still accepts only
// revocable SQLite sessions. No Basic fallback is enabled in application code.
const assert=require('node:assert/strict');
const sessions=new Map();
const nativeFetch=globalThis.fetch;
module.exports=async function authenticatedTestFetch(input,options={}){
  const url=new URL(input);
  const headers=new Headers(options.headers);
  const authorization=headers.get('authorization');
  if(!authorization?.startsWith('Basic '))return nativeFetch(input,options);
  assert.equal(process.env.GOCMD_E2E_CONFIRM,'ISOLATED_DB_ONLY');
  assert(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'Local test server only');
  const raw=Buffer.from(authorization.slice(6),'base64').toString('utf8');
  const colon=raw.indexOf(':');assert(colon>0,'Named test account required');
  const username=raw.slice(0,colon),password=raw.slice(colon+1);
  const key=url.origin+'|'+username;
  if(!sessions.has(key))sessions.set(key,(async()=>{
    const response=await nativeFetch(url.origin+'/api/auth/login',{
      method:'POST',headers:{origin:url.origin,'content-type':'application/json'},
      body:JSON.stringify({username,password}),signal:AbortSignal.timeout(10000),
    });
    if(response.status!==200)throw Error('Test account login failed: '+response.status);
    const cookie=response.headers.get('set-cookie')?.split(';')[0];
    assert(cookie?.startsWith('gocmd_session='),'SQLite session cookie required');
    return cookie;
  })());
  headers.delete('authorization');headers.set('cookie',await sessions.get(key));
  if(!headers.has('origin'))headers.set('origin',url.origin);
  return nativeFetch(input,{...options,headers,signal:options.signal??AbortSignal.timeout(20000)});
};
