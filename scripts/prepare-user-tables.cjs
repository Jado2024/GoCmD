#!/usr/bin/env node
// Migration additive, sans identifiants. Aucun utilisateur n'est créé.
const fs=require('node:fs'),path=require('node:path');
const store=require('../src/lib/user-directory.cjs');
const args=process.argv.slice(2);const ix=args.indexOf('--db');const raw=ix>=0?args[ix+1]:null;
if(!raw||!args.includes('--apply')){console.error('Usage: node scripts/prepare-user-tables.cjs --db db/custom.db --apply (sauvegarder avant)');process.exit(2)}
const p=path.resolve(process.cwd(),raw);if(!fs.existsSync(p)){console.error('Fichier SQLite absent');process.exit(2)}
process.env.GOCMD_DB_FILE=p;
try{store.prepareSchema();console.log('PASS migration additive GoCmdUser/GoCmdAccessAudit. Aucune ligne compte ajoutée.')}catch(e){console.error(e.message);process.exitCode=1}
