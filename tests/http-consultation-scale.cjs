const {spawn}=require('node:child_process');
const {randomBytes}=require('node:crypto');
const {copyFileSync,mkdtempSync,rmSync,mkdirSync,writeFileSync,statSync,readFileSync}=require('node:fs');
const {once}=require('node:events');
const {createServer}=require('node:net');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const assert=require('node:assert/strict');
const root=resolve(__dirname,'..'),temp=mkdtempSync(join(tmpdir(),'gocmd-scale-')),file=join(temp,'qa.db');
copyFileSync(join(root,'db','custom.db'),file);
process.env.GOCMD_DB_FILE=file;
const d=require(join(root,'src/lib/user-directory.cjs')),db=new DatabaseSync(file);
const admin=db.prepare('SELECT username FROM GoCmdUser WHERE is_root=1').get().username;
const username='bench_buyer', first=randomBytes(24).toString('hex'), password=randomBytes(24).toString('hex');
d.createUser(admin,username,first,['buyer'],{});d.changeOwnPassword(username,first,password);
db.exec(`
CREATE TEMP TABLE FixtureLinks AS SELECT row_number() OVER (ORDER BY materialId,supplierId) as n, materialId,supplierId,unit FROM SupplierMaterial JOIN Material ON materialId=Material.id LIMIT 40;
`);
function seed(from,to){
 const cte=`WITH RECURSIVE seq(i) AS(VALUES(${from}) UNION ALL SELECT i+1 FROM seq WHERE i<${to})`;
 db.exec(`BEGIN;
 ${cte} INSERT INTO SupplierConsultation(id,ref,status,createdBy,createdAt,deadline)
 SELECT i,printf('BENCH-CONS-%06d',i),CASE WHEN i%4=0 THEN 'closed' ELSE 'prepared' END,'bench_buyer',1760000000000+i*3600000,1790000000000+i*3600000 FROM seq;
 ${cte} INSERT INTO SupplierRFQ(id,ref,materialId,qty,unit,status,createdBy,createdAt,targetDate)
 SELECT i,printf('BENCH-RFQ-%06d',i),m.materialId,10,m.unit,CASE WHEN i%4=0 THEN 'closed' ELSE 'open' END,'bench_buyer',1760000000000+i*3600000,1790000000000+i*3600000 FROM seq JOIN FixtureLinks m ON m.n=(i%40)+1;
 ${cte} INSERT INTO SupplierConsultationLine(id,consultationId,rfqId) SELECT i,i,i FROM seq;
 ${cte} INSERT INTO SupplierConsultationRecipient(id,consultationId,supplierId) SELECT i,i,m.supplierId FROM seq JOIN FixtureLinks m ON m.n=(i%40)+1;
 ${cte} INSERT INTO SupplierConsultationRecipientLine(id,recipientId,rfqId,responseStatus)
 SELECT i,i,i,CASE WHEN i%5=0 THEN 'declined' ELSE 'invited' END FROM seq;
 COMMIT;`);
}
let child;
const measurements=[],stages=[];
(async()=>{
 const p=createServer().listen(0,'127.0.0.1');await once(p,'listening');
 const port=p.address().port;await new Promise(r=>p.close(r));
 const url='http://127.0.0.1:'+port;
 seed(1,100);
 child=spawn(process.execPath,[join(root,'node_modules/next/dist/bin/next'),'start','-H','127.0.0.1','-p',String(port)],{cwd:root,env:{...process.env,DATABASE_URL:'file:'+file,GOCMD_PUBLIC_ORIGIN:url,GOCMD_REQUIRE_SQLITE_USERS:'1',GOCMD_ALLOW_DEMO_DB:'1'},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',x=>process.stderr.write(x));child.stderr.on('data',x=>process.stderr.write(x));
 for(let i=0;i<70;i++){try{if((await fetch(url+'/api/me')).status===401)break}catch{}assert(i<69);await new Promise(r=>setTimeout(r,200));}
 const login=await fetch(url+'/api/auth/login',{method:'POST',headers:{origin:url,'content-type':'application/json'},body:JSON.stringify({username,password})});
 assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie').split(';')[0];
 async function query(n,params,iteration){
  const start=performance.now();
  const r=await fetch(url+'/api/p2p/consultations?pageSize=40&'+params,{headers:{cookie},signal:AbortSignal.timeout(40000)});
  const content=await r.text(),elapsed=Math.round(performance.now()-start);
  const data=JSON.parse(content);
  const measure={n,params,iteration,status:r.status,ms:elapsed,bytes:Buffer.byteLength(content),count:data.items?.length,total:data.pagination?.total};
  measurements.push(measure);console.log(JSON.stringify(measure));
  assert.equal(r.status,200);
  return data;
 }
 let previous=100;
 for(const n of [100,1000,10000,100000]){
  if(n>previous)seed(previous+1,n);
  previous=n;
  await query(n,'view=summary&sort=urgency','warmup');
  for(let i=1;i<=10;i++)await query(n,'view=summary&sort=urgency',i);
  const times=measurements.filter(x=>x.n===n&&Number.isInteger(x.iteration)).map(x=>x.ms).sort((a,b)=>a-b);
  const plan=db.prepare('EXPLAIN QUERY PLAN SELECT id,ref FROM SupplierConsultation WHERE status=? ORDER BY createdAt DESC,id DESC LIMIT 40').all('prepared');
  const stage={n,samples:times.length,p50:times[Math.ceil(times.length*.5)-1],p95:times[Math.ceil(times.length*.95)-1],dbBytes:statSync(file).size,representativeSqlPlan:plan,sqlQueryCount:'not instrumented'};
  if(process.platform==='linux')stage.serverMemory=readFileSync(`/proc/${child.pid}/status`,'utf8').split('\n').filter(x=>/^Vm(?:RSS|HWM):/.test(x));
  stages.push(stage);console.log('SCALE_STAGE '+JSON.stringify(stage));
 }
 assert.equal(db.prepare('SELECT count(*) n FROM SupplierConsultation').get().n,100000);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 for(let i=1;i<=3;i++)await query(100000,'sort=urgency',i);
 const summary=await query(100000,'view=summary&sort=urgency',1);
 assert.equal(summary.items.length,40);
 assert.equal(summary.pagination.total,100000);
 assert(summary.items.every(row=>!('lines' in row)&&!('recipients' in row)));
 const detail=await query(100000,`id=${summary.items[0].id}&sort=recent`,1);
 assert.equal(detail.items.length,1);
 assert.equal(detail.items[0].ref,summary.items[0].ref);
 const last=await query(100000,'sort=recent&page=2500',1);
 assert.equal(last.items.length,40);assert.equal(last.pagination.hasMore,false);
 const unanswered=await query(100000,'status=no_response&sort=recent',1);
 assert.equal(unanswered.pagination.total,60000);
 const exact=await query(100000,'search=bench-cons-100000&sort=recent',1);
 assert.equal(exact.pagination.total,1);
 const partial=await query(100000,'view=summary&search=BENCH-CONS-0999&sort=recent',1);
 assert.equal(partial.pagination.total,100);
 const concurrent=await Promise.all([1,2,3].map(page=>query(100000,`view=summary&sort=urgency&page=${page}`,'concurrent')));
 const pageIds=concurrent.flatMap(result=>result.items.map(row=>row.id));
 assert.equal(pageIds.length,120);
 assert.equal(new Set(pageIds).size,120);

})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(async()=>{
 if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}
 db.close();rmSync(temp,{recursive:true,force:true});
 if(process.env.GOCMD_QA_ARTIFACTS){mkdirSync(process.env.GOCMD_QA_ARTIFACTS,{recursive:true});writeFileSync(join(process.env.GOCMD_QA_ARTIFACTS,'scale.json'),JSON.stringify({stages,measurements,scope:'Consultations and related RFQs/recipients only; synthetic isolated DB; representative SQL plan is not the full HTTP query'},null,2));}
});
