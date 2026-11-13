/**
 * Audit without leaking raw ORM errors, SQL values, credentials or customer details.
 * Never serialize or print the original Error / stack / message.
 */
export function safeErrorMetadata(error: unknown): {kind: string; code?: string} {
  if (!error || typeof error !== "object") return {kind: "Unknown"}
  const candidate=error as {name?:unknown;code?:unknown}
  const knownKinds=new Set(["Error","TypeError","RangeError","SyntaxError","PrismaClientKnownRequestError","PrismaClientValidationError","PrismaClientUnknownRequestError","PrismaClientInitializationError","PrismaClientRustPanicError"])
  const kind=typeof candidate.name === "string" && knownKinds.has(candidate.name) ? candidate.name : "Error"
  const code=typeof candidate.code === "string" && /^(?:P\d{4}|SQLITE_[A-Z_]{2,32})$/.test(candidate.code) ? candidate.code : undefined
  return code ? {kind,code} : {kind}
}
