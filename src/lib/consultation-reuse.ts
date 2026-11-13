/** P5.14.5 : une RFQ ouverte est un besoin déjà consulté ; sa réutilisation est le chemin par défaut. */
export type ConsultationHistory = {
 id:number; ref:string; requestLineId:number|null; qty:number; unit:string;
 status:string; createdAt:string;
 consultation:{id:number;ref:string;status:string;createdAt:string;recipients:{supplierId:number;name:string}[]} | null;
};
export function activeConsultations(items:readonly ConsultationHistory[]):ConsultationHistory[] {
 return items.filter(item=>item.status==='open');
}
export function canPrepareConsultation(items:readonly ConsultationHistory[],explicitReconsult:boolean,reason:string):boolean {
 return activeConsultations(items).length===0 || (explicitReconsult && reason.trim().length>=10 && reason.trim().length<=500);
}
