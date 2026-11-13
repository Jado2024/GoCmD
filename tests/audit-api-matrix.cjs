'use strict';
// Isolated production HTTP observation matrix. Empty payloads do not establish
// positive business coverage; only the explicit assertions below are gates.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {tmpdir}=require('node:os');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {createServer}=require('node:net');
const {DatabaseSync}=require('node:sqlite');
const {createAccounts,loginAccounts}=require('./qa-managed-accounts.cjs');
const root=path.resolve(__dirname,'..');
const temp=fs.mkdtempSync(path.join(tmpdir(),'gocmd-api-audit-'));
const file=path.join(temp,'qa.db');
fs.copyFileSync(path.join(root,'db/custom.db'),file);
const roles=['buyer','sales','director','approver','receiver','inventory','quality','finance','admin'];
const spec=Object.fromEntries(roles.map(r=>[r,[r]]));
spec.denied=['sales','finance'];
const accounts=createAccounts(file,'audit',spec);
process.env.GOCMD_DB_FILE=file;
const directory=require('../src/lib/user-directory.cjs');
const db=new DatabaseSync(file);
const admin=db.prepare('SELECT username FROM GoCmdUser WHERE is_root=1').get().username;
directory.updateUser(admin,accounts.denied.username,{permissions:{'clients.read':false}});
const rows=[];let server,base,cookies;
function routes(folder){
 return fs.readdirSync(folder,{withFileTypes:true}).flatMap(e=>e.isDirectory()?routes(path.join(folder,e.name)):e.name==='route.ts'?[path.join(folder,e.name)]:[]);
}
async function request(role,method,url,body){
 const start=performance.now();
 const r=await fetch(base+url,{method,redirect:'manual',headers:{origin:base,...(cookies?.[role]?{cookie:cookies[role]}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
 const raw=await r.text();let data;try{data=JSON.parse(raw)}catch{}
 rows.push({role,method,path:url,status:r.status,ms:Math.round(performance.now()-start),bytes:Buffer.byteLength(raw),scenario:'observation',expected:null,result:'OBSERVED'});
 return {r,data,raw};
}
function expect(response,status,label){
 Object.assign(rows.at(-1),{scenario:label,expected:status,result:response.r.status===status?'PASS':'FAIL'});
 assert.equal(response.r.status,status,label);
}
(async()=>{
 const probe=createServer().listen(0,'127.0.0.1');await once(probe,'listening');
 const port=probe.address().port;await new Promise(r=>probe.close(r));base='http://127.0.0.1:'+port;
 server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','-H','127.0.0.1','-p',String(port)],{cwd:root,env:{...process.env,DATABASE_URL:'file:'+file,GOCMD_REQUIRE_SQLITE_USERS:'1',GOCMD_PUBLIC_ORIGIN:base},stdio:['ignore','pipe','pipe']});
 let output='';for(const stream of [server.stdout,server.stderr])stream.on('data',x=>{output=(output+x).slice(-5000)});
 for(let i=0;i<100;i++){
  if(server.exitCode!==null)throw Error(output);
  try{if((await fetch(base+'/api/me')).status===401)break}catch{}
  assert(i<99,'server not ready');await new Promise(r=>setTimeout(r,200));
 }
 cookies=await loginAccounts(base,accounts);
 const endpoints=routes(path.join(root,'src/app/api')).flatMap(file=>{
  const source=fs.readFileSync(file,'utf8');
  const url='/api/'+path.relative(path.join(root,'src/app/api'),file).replace(/\/route.ts$/,'').replaceAll(path.sep,'/').replace(/\[[^\]]+\]/g,'999999999');
  return [...source.matchAll(/export\s+async\s+function\s+(GET|POST|PATCH|PUT|DELETE)\b/g)].map(m=>({url,method:m[1]}));
 });
 for(const {url,method} of endpoints){
  const response=await request('anonymous',method,url,method==='GET'?undefined:{});
  expect(response,url==='/api/auth/logout'?200:401,'unauthenticated route gate');
 }
 for(const role of roles)for(const {url,method} of endpoints.filter(e=>e.method==='GET'))await request(role,method,url);
 const client=(await request('sales','POST','/api/clients',{name:'AUDIT PRIVACY SENTINEL',city:'VILLE FICTIVE',phone:'0500000000'})).data.client;
 const product=(await request('sales','GET','/api/products?family=MATELAS')).data.items.find(p=>p.status==='active'&&p.unit==='u');
 assert(product);
 const created=await request('sales','POST','/api/orders',{clientId:client.id,dueDate:'2027-04-30T12:00:00Z',priority:'normale',lines:[{productId:product.id,qty:1,unitPrice:Number(product.unitPrice)}]});
 expect(created,201,'create privacy fixture through API');
 for(const url of ['/api/clients','/api/orders','/api/sales?type=orders','/api/sales?type=quotes','/api/sales?type=deliveries','/api/sales?type=invoices','/api/sales/print?type=quote&id=999999999']){
  const response=await request('denied','GET',url);
  Object.assign(rows.at(-1),{scenario:'explicit clients.read deny',expected:403,result:response.r.status===403?'PASS':'FAIL',sentinelLeaked:response.raw.includes('AUDIT PRIVACY SENTINEL')});
 }
 const dash=await request('denied','GET','/api/dashboard');
 Object.assign(rows.at(-1),{scenario:'dashboard client privacy',expected:200,result:dash.r.status===200&&!dash.raw.includes('AUDIT PRIVACY SENTINEL')?'PASS':'FAIL',sentinelLeaked:dash.raw.includes('AUDIT PRIVACY SENTINEL')});
 for(const url of ['/api/%6frders','/api/sales/print/?type=quote&id=999999999']){
  const response=await request('denied','GET',url);
  const safe=[403,404,308].includes(response.r.status)&&!response.raw.includes('AUDIT PRIVACY SENTINEL');
  Object.assign(rows.at(-1),{scenario:'encoded or trailing-slash representation',expected:'403/404/308 without data',result:safe?'PASS':'FAIL'});
 }
 expect(await request('denied','POST','/api/clients',{name:client.name,city:client.city,phone:client.phone}),403,'deny duplicate-client response before mutation');
 expect(await request('denied','PATCH','/api/orders/'+created.data.order.id,{action:'advance'}),403,'deny nested mutation response before mutation');
 expect(await request('director','GET','/api/orders'),200,'default director contract retained');
 // A denied operation must not break a normal authorised task.
 expect(await request('sales','GET','/api/orders'),200,'normal sales still reads orders');
 const failures=rows.filter(r=>r.result==='FAIL');
 console.log('API_MATRIX '+JSON.stringify({requests:rows.length,failures:failures.length}));
 if(failures.length)process.exitCode=1;
})().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(async()=>{
 const output=process.env.GOCMD_QA_ARTIFACTS;
 if(output){fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'api-matrix.json'),JSON.stringify(rows,null,2));}
 if(server&&server.exitCode===null){const exit=once(server,'exit');server.kill();await exit;}
 db.close();fs.rmSync(temp,{recursive:true,force:true});
});
