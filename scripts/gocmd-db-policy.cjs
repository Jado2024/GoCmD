/** Safety guard for production entrypoint. No network or database mutations. */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
function isBundledDemoDatabase(root,selected){
  const source=path.join(root,'db','custom.db');
  // realpath also detects symlinks pointing to the bundled demo database.
  try{return fs.realpathSync(selected)===fs.realpathSync(source)}catch{return path.resolve(selected)===path.resolve(source)}
}
function checkDatabaseSelection(root,selected,env=process.env){
  if(!isBundledDemoDatabase(root,selected))return {allowed:true,demo:false};
  if(env.GOCMD_ALLOW_DEMO_DB!=='1')return {allowed:false,demo:true,reason:'Base de démonstration embarquée interdite en production. Utiliser une base séparée. Pour une recette LOCALE uniquement : GOCMD_ALLOW_DEMO_DB=1.'};
  const hostname=env.HOSTNAME||'127.0.0.1';
  if(!['127.0.0.1','localhost','::1','[::1]'].includes(hostname))return {allowed:false,demo:true,reason:'La base de démonstration ne peut être exposée sur le réseau, même avec GOCMD_ALLOW_DEMO_DB=1.'};
  return {allowed:true,demo:true,reason:'ATTENTION : BASE DE DÉMONSTRATION ; usage local uniquement.'};
}
module.exports={isBundledDemoDatabase,checkDatabaseSelection};
