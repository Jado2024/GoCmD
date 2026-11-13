/** Strict contract: a pending commercial line may be repriced only with its
 * technical snapshot and SHA-256 updated within the SAME DB transaction. */
import {createHash} from "node:crypto"
const snapshotHash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex")
export type PriceSnapshotRevision = {ok:true;json:string;hash:string}|{ok:false;reason:string}
export function revisePendingPriceSnapshot(existing:string,newPrice:number,recordedHash?:string|null,previousPrice?:number):PriceSnapshotRevision {
 if(!Number.isFinite(newPrice)||newPrice<=0||Math.abs(newPrice*100-Math.round(newPrice*100))>1e-6)
   return {ok:false,reason:"INVALID_PRICE"}
 try{
  const parsed:unknown=JSON.parse(existing)
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))return {ok:false,reason:"INVALID_SNAPSHOT"}
  const obj=parsed as Record<string,unknown>
  if(obj.version!==2||!(["GENERIC","CATALOG"] as unknown[]).includes(obj.kind)||typeof obj.unitPrice!=="number")
    return {ok:false,reason:"INVALID_SNAPSHOT_VERSION"}
  if(recordedHash!==undefined && (!recordedHash || snapshotHash(obj)!==recordedHash))
    return {ok:false,reason:"SNAPSHOT_HASH_MISMATCH"}
  if(previousPrice!==undefined && (typeof previousPrice!=="number" ||
    Math.abs(Number(obj.unitPrice)-previousPrice)>1e-6))
    return {ok:false,reason:"SNAPSHOT_PRICE_MISMATCH"}
  const updated={...obj,unitPrice:newPrice}
  return {ok:true,json:JSON.stringify(updated),hash:snapshotHash(updated)}
 }catch{return {ok:false,reason:"INVALID_SNAPSHOT_JSON"}}
}
