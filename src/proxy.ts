import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { accessGate } from "@/lib/access-gate"

// Next.js 16 : le proxy protège les pages; chaque API réapplique le contrôle.
// V18.9.2 (contre-audit F07) : la CSP est désormais APPLIQUÉE (fin du
// simple signalement) avec un NONCE par requête et 'strict-dynamic' : les scripts de
// bootstrap de Next.js portent le nonce, et 'unsafe-inline' est retiré de
// script-src (en CSP3 il serait de toute façon ignoré en présence d'un nonce).
// Le nonce est posé en-tête de requête (x-nonce + CSP) pour que le serveur
// Next l'applique à ses propres balises ; la même politique est renvoyée en
// en-tête de réponse. style-src garde 'unsafe-inline' : requis par les styles
// injectés du bundle (c'est script-src qui portait le risque d'exécution).
// En développement uniquement, 'unsafe-eval' est ajouté (HMR de Next.js).
export function proxy(request: NextRequest) {
  const deny = accessGate(request)
  const nonce = btoa(crypto.randomUUID())
  const devOnly = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${devOnly}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ")
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-nonce", nonce)
  requestHeaders.set("Content-Security-Policy", csp)
  // accessGate may return Response.redirect(), whose headers have the
  // immutable guard. Never mutate that original Response: copy its status,
  // location, body and headers into a fresh mutable NextResponse instead.
  // Important: keep the original denial and redirect, not NextResponse.next().
  const response = deny
    ? new NextResponse(deny.body, {
        status: deny.status,
        statusText: deny.statusText,
        headers: new Headers(deny.headers),
      })
    : NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set("Content-Security-Policy", csp)
  response.headers.set("Cache-Control", "no-store")
  return response
}

export const config = {
  matcher: ['/((?!_next/static|branding/|favicon.ico|icon.png|apple-icon.png|logo.svg|robots.txt).*)'],
}
