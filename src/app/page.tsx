"use client";

import dynamic from "next/dynamic";
import { SodepiSymbol } from "@/components/branding/sodepi-logo";

// L'application est chargée côté client uniquement : les données affichées (dates
// relatives, graphiques) sont calculées à l'exécution dans le navigateur, ce qui
// évite tout écart d'hydratation.
const ErpApp = dynamic(() => import("@/components/erp/erp-app"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50">
      <div className="grid size-16 animate-pulse place-items-center rounded-2xl border border-[#e1e5ea] bg-white">
        <SodepiSymbol size={56} />
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold text-slate-700">GoCmd · ERP SODEPI</p>
        <p className="mt-1 text-xs text-slate-500">Connexion à la base…</p>
      </div>
    </div>
  ),
});

export default function Page() {
  return <ErpApp />;
}
