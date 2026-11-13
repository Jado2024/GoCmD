import { NextResponse } from "next/server"

/** Liveness only (no database, version, configuration or business data exposed).
 * The Windows supervisor independently checks SQLite integrity and backups. */
export const dynamic = "force-dynamic"
export function GET() {
  return new NextResponse(null, {status:204, headers:{"Cache-Control":"no-store"}})
}
