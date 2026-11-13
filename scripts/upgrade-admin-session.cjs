#!/usr/bin/env node
'use strict';
const fs=require('node:fs');const path=require('node:path');
const directory=require('../src/lib/user-directory.cjs');
const args=process.argv.slice(2),idx=args.indexOf('--db');
if(idx<0 || !args[idx+1] || !args.includes('--apply')){
 console.error('Usage: node scripts/upgrade-admin-session.cjs --db db/custom.db --apply');process.exit(2)
}
const filename=path.resolve(process.cwd(),args[idx+1]);
if(!fs.existsSync(filename)){console.error('Base SQLite absente');process.exit(2)}
process.env.GOCMD_DB_FILE=filename;
try {const result=directory.migrateRootAndSessions();console.log('Migration OK : '+result.username+' — rôle administrateur uniquement, sessions activées, comptes conservés.')}catch(e){console.error('Migration REFUSÉE : '+e.message);process.exitCode=1}
