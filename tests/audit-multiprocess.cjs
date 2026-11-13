'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const {createServer}=require('node:net'),{tmpdir}=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const {createAccounts,loginAccounts}=require('./qa-managed-accounts.cjs');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(tmpdir(),'gocmd-two-process-'));
const file=path.join(temp,'qa.db');fs.copyFileSync(path.join(root,'db/custom.db'),file);
const accounts=createAccounts(file,'multi',{sales:['sales'],inventory:['inventory'],approver:['approver']});
const db=new DatabaseSync(file),servers=[],sessions=[],origins=[],rows=[];
async function api(instance,role,method,url,body,allowed=[200,201]){
 const started=performance.now();
 const response=await fetch(origins[instance]+url,{method,headers:{origin:origins[instance],cookie:sessions[instance][role],'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
 const data=await response.json();rows.push({instance,role,method,path:url,status:response.status,ms:Math.round(performance.now()-started)});
 assert(allowed.includes(response.status),JSON.stringify({last:rows.at(-1),data}));return {status:response.status,data};
}
(async()=>{
 for(let i=0;i<2;i++){
  const probe=createServer().listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
  const base='http://127.0.0.1:'+port;origins.push(base);
  const server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','-H','127.0.0.1','-p',String(port)],{cwd:root,env:{...process.env,GOCMD_DB_FILE:file,DATABASE_URL:'file:'+file,GOCMD_REQUIRE_SQLITE_USERS:'1',GOCMD_PUBLIC_ORIGIN:base},stdio:['ignore','pipe','pipe']});
  servers.push(server);let output='';for(const stream of [server.stdout,server.stderr])stream.on('data',x=>output=(output+x).slice(-5000));
  for(let n=0;n<100;n++){assert(server.exitCode===null,output);try{if((await fetch(base+'/api/me')).status===401)break}catch{}assert(n<99);await new Promise(r=>setTimeout(r,200));}
  sessions.push(await loginAccounts(base,accounts));
 }
 const product=db.prepare(`SELECT p.id,p.unitPrice,p.materialId FROM Product p JOIN Material m ON m.id=p.materialId
 WHERE p.status='active' AND p.unitsPerSale=1 AND m.unit='bloc' AND m.stockQty>1 AND m.isSellable=1
 AND (SELECT count(*) FROM StockLot l WHERE l.materialId=m.id AND l.status='available' AND l.qty>0)=1 LIMIT 1`).get();
 assert(product,'trade block fixture');
 const lot=db.prepare("SELECT id,qty FROM StockLot WHERE materialId=? AND status='available' AND qty>0").get(product.materialId);
 await api(0,'inventory','POST','/api/movements',{type:'out',materialId:product.materialId,stockLotId:lot.id,qty:lot.qty-1,reason:'Fixture dernière unité du test multi-processus'});
 const client=db.prepare('SELECT id FROM Client ORDER BY id LIMIT 1').get();
 const input={clientId:client.id,priority:'normale',lines:[{productId:product.id,qty:1,unitPrice:Number(product.unitPrice)}]};
 // P6 (2026-11-11) : jours de livraison distincts — l'intention du test est
 // l'unicité des références à travers deux PROCESSUS distincts, pas la création
 // de doublons commerciaux. La garde P5.15.29-P5 (commandes similaires sans
 // jeton de revue) est vérifiée séparément juste après.
 const orders=await Promise.all(Array.from({length:12},(_,i)=>api(i%2,'sales','POST','/api/orders',{...input,dueDate:new Date(Date.now()+(i+1)*864e5).toISOString()})));
 assert.equal(new Set(orders.map(x=>x.data.order.ref)).size,12,'unique references across server processes');
 // P5 : une requête strictement identique à une commande existante (même client,
 // même jour, même signature) est refusée 409 sans confirmation, même depuis
 // l'AUTRE processus : le contrôle serveur n'est pas contournable.
 const duplicate=await api(1,'sales','POST','/api/orders',{...input,dueDate:new Date(Date.now()+1*864e5).toISOString()},[409]);
 assert.equal(duplicate.data.code,'DUPLICATE_ORDER_POTENTIAL','garde doublons inter-processus');
 // CASCADE3 (11/11/2026) — P1FIX : toute commande naît pending_validation ; la
 // réservation exige le visa commercial quatre-yeux. Vérifié négativement
 // AVANT approbation (réservation refusée), puis les deux commandes sont
 // approuvées par un responsable indépendant avant la course finale.
 const premature=await api(0,'sales','POST','/api/sales',{action:'reserve-stock',orderId:orders[0].data.order.id,orderLineId:orders[0].data.order.lines[0].id,qty:1},[200,201,409]);
 if(premature.status!==409)throw new Error('P1FIX : la réservation avant approbation doit être refusée, statut='+premature.status);
 for(const o of orders.slice(0,2))await api(0,'approver','PATCH',`/api/orders/${o.data.order.id}`,{action:'approve',comment:'Validation quatre-yeux multi-processus — réservation dernière unité'});
 const reserves=await Promise.all(orders.slice(0,2).map((x,i)=>api(i,'sales','POST','/api/sales',{action:'reserve-stock',orderId:x.data.order.id,orderLineId:x.data.order.lines[0].id,qty:1},[200,409])));
 assert.deepEqual(reserves.map(x=>x.status).sort(),[200,409]);
 assert.equal(db.prepare('SELECT sum(qty) n FROM SalesStockReservation WHERE stockLotId=?').get(lot.id).n,1);
 assert.equal(db.prepare('SELECT qty FROM StockLot WHERE id=?').get(lot.id).qty,1);
 assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 console.log('PASS two production processes: 12 unique order references, last-unit reservation 200/409 after four-eyes approval, reservation before approval refused, stock and database intact');
})().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(async()=>{
 if(process.env.GOCMD_QA_ARTIFACTS){fs.mkdirSync(process.env.GOCMD_QA_ARTIFACTS,{recursive:true});fs.writeFileSync(path.join(process.env.GOCMD_QA_ARTIFACTS,'multiprocess.json'),JSON.stringify(rows,null,2));}
 for(const server of servers)if(server.exitCode===null){const exited=once(server,'exit');server.kill();await exited;}
 db.close();fs.rmSync(temp,{recursive:true,force:true});
});
