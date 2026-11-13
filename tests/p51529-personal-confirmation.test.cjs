'use strict';
// P5.15.29 — execute against a disposable SQLite copy only. No browser/mock stubs.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..');
const directory=require('../src/lib/user-directory.cjs');
const work=fs.mkdtempSync(path.join(os.tmpdir(),'gocmd-p51529-'));
const file=path.join(work,'test.db');
fs.copyFileSync(path.join(root,'db','custom.db'),file);
process.env.GOCMD_DB_FILE=file;
process.on('exit',()=>fs.rmSync(work,{recursive:true,force:true}));
const db=new DatabaseSync(file,{readOnly:false});
const rootUser=db.prepare('SELECT username FROM GoCmdUser WHERE is_root=1').get()?.username;
assert.ok(rootUser,'database must already have SQLite identities');
const initial='initial-Password-unique-2026-!';
const secret='director-Personal-password-2026!';
const user='p29director';
directory.createUser(rootUser,user,initial,['director'],{});
directory.changeOwnPassword(user,initial,secret);

test('a named director can confirm own identity without any shared validation key',()=>{
  delete process.env.GOCMD_VALIDATION_KEY;
  assert.equal(directory.verifySensitivePassword(user,secret,'director.prices'),'ok');
});
test('account-wide limiter rejects guessing, including a correct password after five failures',()=>{
  for(let n=0;n<5;n++)assert.equal(directory.verifySensitivePassword(user,'wrong-Password-'+n,'director.prices'),'invalid');
  assert.equal(directory.verifySensitivePassword(user,secret,'director.prices'),'limited');
  const failures=db.prepare("SELECT COUNT(*) n FROM GoCmdAccessAudit WHERE actor=? AND action='sensitive.confirm.failed'").get(user).n;
  assert.equal(failures,5);
});
test('password is not written into the security audit log',()=>{
  const logs=db.prepare("SELECT details_json FROM GoCmdAccessAudit WHERE actor=? AND action LIKE 'sensitive.confirm.%'").all(user);
  assert.ok(logs.length>=6);
  assert.ok(logs.every(x=>!x.details_json.includes(secret) && !x.details_json.includes('wrong-Password')));
});
test('rate limiting is per account and an unrelated user remains able to confirm',()=>{
  const second='p29second';
  directory.createUser(rootUser,second,initial,['director'],{});
  directory.changeOwnPassword(second,initial,secret);
  assert.equal(directory.verifySensitivePassword(second,secret,'director.prices'),'ok');
  assert.equal(directory.verifySensitivePassword(second,secret,'unknown.permission'),'invalid');
});
