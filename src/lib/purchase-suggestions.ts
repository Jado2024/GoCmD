/** P5.12 — suggestions de matières, dérivées des références fournisseur actives. */
export type SuggestionMaterial = {id:number;stockQty:number;minStock:number;supplierIds?:number[]};
export type SuggestionFilter = 'all'|'low'|'common';

export function commonSupplierIds<T extends SuggestionMaterial>(selected:T[]):number[]{
  if(selected.length===0)return [];
  const first=new Set(selected[0].supplierIds??[]);
  for(const row of selected.slice(1)){
    const links=new Set(row.supplierIds??[]);
    for(const id of first){if(!links.has(id))first.delete(id)}
  }
  return [...first].sort((a,b)=>a-b);
}
export function suggestedMaterials<T extends SuggestionMaterial>(all:T[],selected:T[],filter:SuggestionFilter):T[]{
  const chosen=new Set(selected.map(x=>x.id));
  const shared=commonSupplierIds(selected);
  return all.filter(material=>{
    if(chosen.has(material.id))return false;
    if(filter==='all')return true;
    if(!(material.stockQty<=0||material.stockQty<material.minStock))return false;
    if(filter==='low'||selected.length===0)return true;
    return shared.length>0&&(material.supplierIds??[]).some(id=>shared.includes(id));
  });
}
