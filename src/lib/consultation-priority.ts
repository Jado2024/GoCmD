/** Priorité fondée sur les données de stock et les dates; aucune urgence déduite d'un prix. */
export type ConsultationRisk='rupture'|'low_stock'|'due_soon'|'normal';
export function consultationRisk(lines:ReadonlyArray<{
 material:{stockQty:number;minStock:number};targetDate?:string|null;
}>,deadline?:string|null,now:Date=new Date()):ConsultationRisk{
 if(lines.some(l=>l.material.stockQty<=0))return 'rupture';
 if(lines.some(l=>l.material.minStock>0&&l.material.stockQty<l.material.minStock))return 'low_stock';
 const soon=now.getTime()+3*86400000;
 const isSoon=(x?:string|null)=>!!x&&Number.isFinite(Date.parse(x))&&Date.parse(x)<=soon;
 if(isSoon(deadline)||lines.some(l=>isSoon(l.targetDate)))return 'due_soon';
 return 'normal';
}
export const riskLabel:Record<ConsultationRisk,string>={rupture:'Rupture de stock',low_stock:'Sous le seuil',due_soon:'Échéance proche',normal:'Suivi normal'};
