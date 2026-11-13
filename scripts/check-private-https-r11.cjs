"use strict";
/** Pré-vol strict du déploiement privé HTTPS. Ne configure PAS le réseau.
 * Lancer avec --enforce depuis l'environnement de service réel ; les données
 * d'environnement ne sont jamais imprimées en cas d'échec. */
function checkPrivateHttps(env){
 const issues=[];
 let url;
 try { url=new URL(env.GOCMD_PUBLIC_ORIGIN || "") } catch { issues.push('GOCMD_PUBLIC_ORIGIN obligatoire et valide') }
 if(url && (url.protocol!=='https:' || url.username || url.password || url.pathname!=='/' || url.search || url.hash))
   issues.push('Origine HTTPS canonique obligatoire (sans chemin ni identifiants)');
 if(!['127.0.0.1','localhost','::1','[::1]'].includes(env.HOSTNAME||'127.0.0.1'))
   issues.push('GoCmd doit écouter uniquement sur loopback derrière Tailscale Serve');
 if(env.GOCMD_TRUST_PROXY==='1')
   issues.push('Ne pas faire confiance aux X-Forwarded-* pour Tailscale Serve; conserver GOCMD_TRUST_PROXY=0');
 if(env.GOCMD_ALLOW_DEMO_DB==='1')issues.push('Dérogation DEMO interdite dans le déploiement réel');
 if(env.GOCMD_REQUIRE_SQLITE_USERS!=='1')issues.push('Comptes SQLite nominatifs obligatoires');
 return issues;
}
if(require.main===module){
 const issues=checkPrivateHttps(process.env);
 if(issues.length){for(const s of issues) console.error('NO-GO réseau: '+s);if(process.argv.includes('--enforce'))process.exitCode=2;}
 else console.log('PASS pré-vol statique HTTPS privé; essai réseau réel toujours requis');
}
module.exports={checkPrivateHttps};
