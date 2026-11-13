/** Un droit de référencement fournisseur n'implique jamais la lecture des prix. */
export function supplierLinkForReader<T extends {unitPrice:number|null}>(link:T,canSeeCosts:boolean):T {
  return canSeeCosts ? link : {...link,unitPrice:null}
}
