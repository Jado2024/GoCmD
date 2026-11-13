/** Ne supprime ni ponctuation ni zéros initiaux des codes fournisseurs. */
export function normalizeSupplierSku(raw:string|null|undefined):string|null {
  const n=(raw??"").normalize("NFKC").trim().replace(/\s+/gu," ").toUpperCase()
  return n||null
}
/** Exception key is deliberately NOT the canonical lookup key: searches must inspect
 * all original supplierSku values and never silently choose one ambiguous material. */
export function approvedSupplierExceptionKey(supplierId:number,sku:string,materialId:number):string {
 const key=supplierLookupKey(supplierId,sku)
 if(!key)throw new Error("SUPPLIER_SKU_REQUIRED")
 return `${key}#EXCEPTION#${materialId}`
}
export function supplierLookupKey(supplierId:number,sku:string|null|undefined):string|null {
  const n=normalizeSupplierSku(sku)
  return n?`${supplierId}#${n}`:null
}
