/** Auditable, optional planning aids: NEVER generate a manufacturing order here. */
export function pointOfReorder(muDaily:number,leadDays:number,safetyStock:number){
  if(![muDaily,leadDays,safetyStock].every(x=>Number.isFinite(x)&&x>=0))throw Error('INVALID_PLANNING_INPUT')
  // C4-09 (contre-audit CASCADE4) : epsilon anti-artefact flottant, comme
  // replenishment-policy.ceilToUnit — 0.1*3+0 retournait 0.300001 au lieu de 0.3.
  return Math.ceil((muDaily*leadDays+safetyStock-1e-9)*1e6)/1e6
}
export function safetyStock(muDaily:number,sigmaDaily:number,leadDays:number,sigmaLeadDays:number,z:number){
  if(![muDaily,sigmaDaily,leadDays,sigmaLeadDays,z].every(x=>Number.isFinite(x)&&x>=0))throw Error('INVALID_PLANNING_INPUT')
  return z*Math.sqrt(leadDays*sigmaDaily**2+muDaily**2*sigmaLeadDays**2)
}
export function movingAverage(values:number[],window:number){
  if(!Number.isSafeInteger(window)||window<1||values.length<window||!values.every(v=>Number.isFinite(v)&&v>=0))throw Error('INSUFFICIENT_HISTORY')
  return values.slice(-window).reduce((s,v)=>s+v,0)/window
}
export function wape(actual:number[],forecast:number[]){
  if(!actual.length||actual.length!==forecast.length||!actual.every(x=>Number.isFinite(x)&&x>=0)||!forecast.every(x=>Number.isFinite(x)&&x>=0))throw Error('INVALID_FORECAST')
  const sum=actual.reduce((s,v)=>s+v,0)
  return sum>0?actual.reduce((s,x,i)=>s+Math.abs(x-forecast[i]),0)/sum*100:null
}
export function lotAdjustedQty(netQty:number,minBatch:number,multiple:number){
  if(![netQty,minBatch,multiple].every(x=>Number.isFinite(x)&&x>=0)||multiple===0)throw Error('INVALID_BATCH')
  if(netQty===0)return 0
  return Math.ceil((Math.max(netQty,minBatch)-1e-9)/multiple)*multiple
}
