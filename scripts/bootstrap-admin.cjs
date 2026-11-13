#!/usr/bin/env node
'use strict';
const fs=require('node:fs');const path=require('node:path');const readline=require('node:readline');
const store=require('../src/lib/user-directory.cjs');
const [,,...args]=process.argv;
function flag(name){const idx=args.indexOf('--'+name);return idx>=0?args[idx+1]:undefined}
const db=flag('db'),username=flag('username')||'administrateur';
if(!db || !args.includes('--initialize')){console.error('Usage: node scripts/bootstrap-admin.cjs --db db/custom.db --username administrateur --initialize');process.exit(2)}
const absolute=path.resolve(process.cwd(),db);
if(!fs.existsSync(absolute)){console.error('Base SQLite inexistante : '+absolute);process.exit(2)}
process.env.GOCMD_DB_FILE=absolute;
if(store.managed()){console.error('Un compte existe déjà : initialisation refusée. Utilisez Administration > Utilisateurs.');process.exit(2)}
if(!process.stdin.isTTY && !process.env.GOCMD_BOOTSTRAP_PASSWORD){console.error('Terminal interactif requis (ou secret via GOCMD_BOOTSTRAP_PASSWORD pour tests automatisés).');process.exit(2)}
function finish(pwd){try{store.bootstrap(username,pwd);console.log('Compte principal créé : '+username);console.log('Rôle administration uniquement. Aucun secret affiché.');}catch(e){console.error('Initialisation refusée : '+e.message);process.exitCode=1}}
if(process.env.GOCMD_BOOTSTRAP_PASSWORD)finish(process.env.GOCMD_BOOTSTRAP_PASSWORD);
else {
 const rl=readline.createInterface({input:process.stdin,output:process.stdout,terminal:true});
 rl._writeToOutput=function(str){if(str.startsWith('Mot de passe'))rl.output.write(str);else if(str.endsWith('\n'))rl.output.write('\n')};
 rl.question('Mot de passe administrateur principal (16 caractères minimum, saisie masquée) : ', pwd=>{rl.close();finish(pwd)})
}
