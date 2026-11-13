"use client"
import { GABARITS, type GabaritCode } from "@/lib/gabarits"

export function GabaritPicker({value,onChange}: {value:GabaritCode; onChange:(v:GabaritCode)=>void}) {
  return <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6" role="group" aria-label="Choisir le dessin du gabarit">
    {GABARITS.map(g=><button key={g.code} type="button" onClick={()=>onChange(g.code)} aria-pressed={value===g.code}
      className={`rounded-lg border-2 p-2 text-left transition-colors ${value===g.code?"border-emerald-600 bg-emerald-50":"border-slate-200 bg-white hover:border-emerald-300"}`}>
      <svg viewBox="0 0 122 80" className="h-14 w-full" aria-hidden="true">
        <path d={g.path} fill={value===g.code?"#bbf7d0":"#e2e8f0"} stroke="#334155" strokeWidth="2" strokeLinejoin="round"/>
      </svg>
      <p className="text-center text-sm font-bold text-slate-800">{g.code === "STD" ? "Droit" : `N° ${g.code}`}</p>
      <p className="mt-0.5 line-clamp-2 text-center text-[10px] text-slate-500">{g.name}</p>
    </button>)}
  </div>
}
