// Usage: node scripts/create-user.cjs identifiant buyer,receiver
// Prints one account JSON. Merge entries for multiple identities under GOCMD_USERS_JSON.
const {randomBytes,scryptSync}=require('node:crypto')
const fs=require('node:fs')
const user=process.argv[2],roles=(process.argv[3]||'').split(',').filter(Boolean)
const valid=['buyer','sales','approver','receiver','inventory','quality','finance','admin','director']
if(!/^[a-z0-9._-]{3,50}$/i.test(user||'')||!roles.length||roles.some(r=>!valid.includes(r))){console.error('Usage: node scripts/create-user.cjs identifiant buyer,receiver');process.exit(1)}
function output(password){if(password.length<16){console.error('Mot de passe: au moins 16 caractères');process.exit(1)}const salt=randomBytes(16).toString('hex');const hash=scryptSync(password,Buffer.from(salt,'hex'),32).toString('hex');console.log(JSON.stringify({[user]:{salt,hash,roles}}));}
if(process.env.GOCMD_NEW_PASSWORD){output(process.env.GOCMD_NEW_PASSWORD)}
else if(process.stdin.isTTY){
 const rl=require('node:readline').createInterface({input:process.stdin,output:process.stdout,terminal:true})
 rl._writeToOutput=function _writeToOutput(stringToWrite){if(stringToWrite.includes('Mot de passe'))rl.output.write(stringToWrite);else if(stringToWrite.endsWith('\n'))rl.output.write('\n')}
 rl.question('Mot de passe (saisie masquée) : ',pwd=>{rl.close();output(pwd)})
}else{console.error('Exécuter dans un terminal interactif (ou GOCMD_NEW_PASSWORD local en environnement protégé).');process.exit(1)}
