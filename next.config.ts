import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: true,
  // R13.3 (CORR-01) : en mode serveur, le répertoire d'identités (node:sqlite)
  // est STRICTEMENT lecture seule. Deux moteurs SQLite écrivains dans un même
  // processus ne se verrouillent pas entre eux (verrous POSIX par processus) :
  // un simple login concurrent d'une écriture métier corrompait la base
  // (reproduction déterministe : tests/r133-dual-engine-corruption.test.cjs).
  // Les écritures identités/sessions/audits passent par le client Prisma
  // unique (src/lib/identity-writes.ts). Les scripts CLI conservent node:sqlite.
  env: { GOCMD_SERVER_RUNTIME: "1" },
  // P5.15.21 RC (DEF-S-11) : ne pas divulguer la stack via X-Powered-By.
  poweredByHeader: false,
  // Les logos SODEPI sont servis depuis /public sans service externe d’optimisation.
  images: { unoptimized: true },
  async headers() {
    const hardened=[
      {key:"X-Frame-Options",value:"DENY"},
      {key:"X-Content-Type-Options",value:"nosniff"},
      {key:"Referrer-Policy",value:"strict-origin-when-cross-origin"},
      {key:"Permissions-Policy",value:"camera=(), microphone=(), geolocation=()"},
      // V18.9.2 (contre-audit F07) : la CSP est APPLIQUÉE et porte un NONCE
      // généré par requête dans src/proxy.ts (pattern officiel Next.js) :
      // script-src 'self' 'nonce-…' 'strict-dynamic', sans 'unsafe-inline'.
      // Elle n'est plus déclarée ici : la version statique de next.config ne
      // peut pas produire de nonce par requête. Les autres en-têtes durcis
      // restent appliqués à toutes les réponses.
      {key:"X-Permitted-Cross-Domain-Policies",value:"none"},
    ];
    // HSTS is meaningful only on a verified HTTPS origin, never on test HTTP/LAN.
    if(process.env.GOCMD_PUBLIC_ORIGIN?.startsWith("https://")) {
      hardened.push({key:"Strict-Transport-Security",value:"max-age=31536000"});
    }
    return [{source:"/:path*",headers:hardened}];
  },
};

export default nextConfig;
