/** GoCmd V18.9.5 — le prix commercial autorisé est un nombre entier de centimes MAD.
 * Attention aux valeurs comme 245.004 : un simple Math.round masquerait une
 * différence qui deviendrait significative sur une commande de 1000 unités. */
export function isExactMADPrice(value:number):boolean{
  return Number.isFinite(value) && value>0 && value<=100000000 &&
    Number.isSafeInteger(Math.round(value*100)) &&
    Math.abs(value*100-Math.round(value*100))<1e-6
}
export function isSameAuthorizedPrice(proposed:number,authorized:number|null):boolean{
  return authorized!=null && isExactMADPrice(proposed) && isExactMADPrice(authorized) &&
    Math.round(proposed*100)===Math.round(authorized*100)
}
