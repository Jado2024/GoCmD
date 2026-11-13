import { safeErrorMetadata } from "@/lib/safe-server-error"
import { NextResponse } from "next/server"

/** Only explicitly mapped business codes are exposed. Unknown exceptions are logged server-side. */
export function p2pConflictResponse(
  error: unknown,
  messages: Readonly<Record<string,string>>,
  operation: string,
): NextResponse {
  const prismaCode=error && typeof error==="object" && "code" in error && typeof error.code==="string" ? error.code : ""
  const code=Object.prototype.hasOwnProperty.call(messages,prismaCode) ? prismaCode : error instanceof Error?error.message:""
  if (Object.prototype.hasOwnProperty.call(messages,code)) {
    return NextResponse.json({error:messages[code],code},{status:409})
  }
  console.error(`Échec transactionnel ${operation}`,safeErrorMetadata(error))
  return NextResponse.json({error:`${operation} impossible. Actualisez les données et réessayez.`,code:"TRANSACTION_CONFLICT"},{status:409})
}
