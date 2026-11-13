"use strict";
/* Stop the release if either installed-package lock still resolves a known-affected
 * deepmerge-ts version, or the root override/locks disagree. A static advisory
 * gate does NOT replace npm audit or a fresh Node 24 installation. */
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const npm=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
const bun=fs.readFileSync(path.join(root,'bun.lock'),'utf8');
const npmVersion=npm.packages?.['node_modules/deepmerge-ts']?.version;
const bunVersion=bun.match(/"deepmerge-ts":\s*\["deepmerge-ts@(\d+\.\d+\.\d+)"/)?.[1];
const override=pkg.overrides?.['deepmerge-ts'];
function major(v){return /^\d+\.\d+\.\d+$/.test(v??'')?Number(v.split('.')[0]):-1}
const errors=[];
if(major(npmVersion)<8)errors.push(`CVE-2026-40345: package-lock.json deepmerge-ts ${npmVersion??'absent'} <8`);
if(major(bunVersion)<8)errors.push(`CVE-2026-40345: bun.lock deepmerge-ts ${bunVersion??'absent'} <8`);
if(major(override)<8)errors.push(`Override root manquant/invalide: ${override??'absent'}`);
if(npmVersion!==bunVersion||npmVersion!==override)errors.push(`Verrouillages divergents: npm=${npmVersion} bun=${bunVersion} override=${override}`);
const entry=npm.packages?.['node_modules/deepmerge-ts'];
if(entry?.resolved!==`https://registry.npmjs.org/deepmerge-ts/-/deepmerge-ts-${npmVersion}.tgz` || !/^sha512-[A-Za-z0-9+/]+=*$/.test(entry?.integrity??''))errors.push('Résolution ou SRI npm non valide');
if(errors.length){for(const error of errors)console.error('FAIL SEC-01:',error);if(process.argv.includes('--enforce'))process.exit(1)}
else console.log(`PASS SEC-01 (verrouillages statiques): deepmerge-ts ${npmVersion} en npm/bun, override cohérent. Installation réelle non testée.`);
