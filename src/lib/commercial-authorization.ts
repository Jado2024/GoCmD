/** SODEPI — règles de validation tarifaire et personnalisation, sans arrondi implicite. */
import { isSameAuthorizedPrice } from "./special-price"
export type DimensionsCm={lengthCm:number;widthCm:number;heightCm:number}
export function hasPriceException(price:number,catalogue:number):boolean {
  return !isSameAuthorizedPrice(price,catalogue)
}
export function hasTechnicalException(
  product:{length:number;width:number;height:number},
  dims?:DimensionsCm|null, instructions?:string|null,
):boolean {
  return Boolean(instructions?.trim()) || Boolean(dims && (
    dims.lengthCm!==product.length || dims.widthCm!==product.width || dims.heightCm!==product.height))
}
/** Every customer order needs a separate authorized commercial approval.
 * Additional technical and price visas remain independent prerequisite steps. */
export function validatedOrderStatus(needsPrice:boolean,needsTechnical:boolean,hasPendingProduct:boolean):"pending_validation" {
  // Parameters retained to preserve the existing planning/exception API.
  void needsPrice; void needsTechnical; void hasPendingProduct
  return "pending_validation"
}
