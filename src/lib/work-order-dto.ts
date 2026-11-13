/** Public OF projection. Full technical instructions remain available to the workshop,
 * but confidential customer details and negotiated generic pricing do not.
 * The persisted snapshot is NEVER changed by this projection.
 */
export type WorkOrderRowWithSnapshot = {snapshotJson:string}

export function workOrderDtoForViewer<T extends WorkOrderRowWithSnapshot>(
  row:T, canReadClientData:boolean,
): Omit<T,"snapshotJson"> & {snapshot:Record<string,unknown>} {
  const {snapshotJson,...safeRow}=row
  const decoded:unknown=JSON.parse(snapshotJson)
  if (!decoded || typeof decoded!=="object" || Array.isArray(decoded)) throw new Error("OF_SNAPSHOT_INVALID")
  // Parse yields a fresh object; never modify the persisted JSON or Prisma row.
  const snapshot=decoded as Record<string,unknown>
  if (!canReadClientData) {
    snapshot.client={name:"Client confidentiel",city:""}
    // A generic configuration may hold unitPrice, quantity and negotiated
    // commercial terms. Technical specifications are already copied into
    // snapshot.product. Never expose the original contract to warehouse users.
    delete snapshot.contractualConfiguration
  }
  return {...safeRow,snapshot} as Omit<T,"snapshotJson"> & {snapshot:Record<string,unknown>}
}
