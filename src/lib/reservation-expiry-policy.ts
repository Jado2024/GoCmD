/** Durées de conservation des réservations : AUCUN délai implicite.
 * Si non configurée, l'expiration automatique reste inactive.
 * La tâche planifiée d'exploitation est responsable de l'expiration physique.
 */
export function reservationExpiryPolicy(ttlRaw:string|undefined,warnRaw:string|undefined){
 const ttl=Number(ttlRaw),warn=Number(warnRaw)
 if(!ttlRaw?.trim()||!warnRaw?.trim()||!Number.isSafeInteger(ttl)||ttl<1||ttl>2160||!Number.isSafeInteger(warn)||warn<1||warn>=ttl)
  return {configured:false,ttlHours:null,warningHours:null} as const
 return {configured:true,ttlHours:ttl,warningHours:warn} as const
}
