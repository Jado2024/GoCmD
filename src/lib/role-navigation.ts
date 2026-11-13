import type { ViewId } from "@/components/erp/nav-sidebar"
export type SessionActor={username:string;roles:string[];legacy:boolean;managed?:boolean;isRoot?:boolean;permissions?:Record<string,boolean>;mustChangePassword?:boolean}
const GROUPS:Record<string,ViewId[]>={
 admin:["users","my-account"],
 sales:["dashboard","catalogue","orders","sales-quotes","sales-deliveries","sales-invoices"],
 buyer:["production-planning","buyer-workbench","materials","purchases","suppliers","p2p-advanced","supplier-orders","goods-receipts"],
 director:["dashboard","orders","sales-quotes"],
 approver:["dashboard","orders","materials","purchases","supplier-orders","p2p-advanced"],
 receiver:["dashboard","materials","supplier-orders","goods-receipts","stock-lots"],
 inventory:["production-planning","dashboard","materials","movements","stock-lots","goods-receipts"],
 production:["production-planning"],
 quality:["production-planning","dashboard","materials","stock-lots","goods-receipts"],
 finance:["production-planning","dashboard","supplier-invoices","sales-invoices","supplier-orders","goods-receipts","p2p-advanced"],
}
export function visibleViews(actor:SessionActor|null|undefined):ViewId[]{
 if(!actor)return []
 // V18.9.9 (SEC-LEGACY-01) : le compte partagé ne voit AUCUNE donnée
 // financière, client, facture ou nominative — uniquement les vues
 // opérationnelles dont les API masquent coûts et coordonnées.
 if(actor.legacy)return ["dashboard","materials","catalogue","movements","stock-lots","suppliers","supplier-orders","goods-receipts"]
 return [...new Set([...actor.roles.flatMap(role=>GROUPS[role]??[]),...(actor.managed?["my-account" as ViewId]:[]),...(actor.managed && actor.roles.includes("admin") && actor.permissions?.["users.read"]!==false ? ["users" as ViewId]:[])])]
}
export function hasRole(actor:SessionActor|null|undefined,role:string):boolean{
 return Boolean(actor && !actor.legacy && actor.roles.includes(role))
}

export function hasPermission(actor:SessionActor|null|undefined,key:string):boolean{
  if(!actor||actor.legacy)return false
  return actor.permissions?.[key]!==false
}
