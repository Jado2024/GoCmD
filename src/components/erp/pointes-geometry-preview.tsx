"use client"
import type { geometryPointes, PointMetres } from "@/lib/geometry-engine"

type Geo = ReturnType<typeof geometryPointes>
const fmt=(n:number)=>n.toLocaleString("fr-FR",{maximumFractionDigits:3})

/** Dessin coté construit d'après les sommets calculés, non un pictogramme approximatif. */
export function PointesGeometryPreview({code,geo,D,J,K,L,H}:{
  code:'41'|'51';geo:Geo;D:number;J:number;K:number;L:number;H:number
}) {
  const w=geo.distancePointesM
  const top=geo.hauteurHautM, bot=geo.hauteurBasM
  const scale=Math.min(345/w,165/(top+bot))
  const x=(a:number)=>85+(a*scale)+(345-w*scale)/2
  const y=(a:number)=>47+(top-a)*scale
  const poly=geo.verticesM.map((p:PointMetres)=>`${x(p.x)},${y(p.y)}`).join(" ")
  const topMid=geo.verticesM[code==='41'?1:1]
  const baseMiddle=(w/2)
  return <div className="col-span-full rounded-md border border-emerald-200 bg-white p-3 text-xs text-slate-800 space-y-2">
    <p className="font-semibold text-emerald-900">Dessin industriel calculé — gabarit {code}</p>
    <svg viewBox="0 0 530 270" role="img" aria-label={`Gabarit ${code} coté, W ${fmt(w)} mètres, hauteur H ${fmt(H)} mètres`} className="w-full max-w-2xl bg-slate-50 rounded-md">
      <rect x={x(0)} y={y(top)} width={w*scale} height={H*scale} fill="#f4d9a9" fillOpacity=".25" stroke="#ad8644" strokeDasharray="5 4"/>
      <polygon points={poly} fill="#acd6e6" fillOpacity=".65" stroke="#22749e" strokeWidth="2.5"/>
      <line x1={x(0)} y1={y(0)} x2={x(w)} y2={y(0)} stroke="#ba8a45" strokeDasharray="4 4"/>
      <line x1={x(0)} y1="27" x2={x(w)} y2="27" stroke="#1f5b82" strokeWidth="1.4"/>
      <line x1={x(0)} y1="21" x2={x(0)} y2="33" stroke="#1f5b82"/>
      <line x1={x(w)} y1="21" x2={x(w)} y2="33" stroke="#1f5b82"/>
      <text x={x(w/2)} y="20" fontSize="12" fill="#205979" textAnchor="middle">W = {fmt(w)} m (calculé)</text>
      <line x1="61" y1={y(top)} x2="61" y2={y(-bot)} stroke="#247d61" strokeWidth="1.5"/>
      <line x1="55" y1={y(top)} x2="67" y2={y(top)} stroke="#247d61"/>
      <line x1="55" y1={y(-bot)} x2="67" y2={y(-bot)} stroke="#247d61"/>
      <text x="47" y={y(0)} fontSize="12" textAnchor="end" fill="#247d61">H = {fmt(H)} m</text>
      <text x={x(baseMiddle)} y={y(-bot)+18} fontSize="12" fill="#1f3654" textAnchor="middle">J = {fmt(J)} m</text>
      {code==='51' && <text x={x(w/2)} y={y(top)-6} fontSize="12" fill="#1f3654" textAnchor="middle">D = {fmt(D)} m</text>}
      <text x={x(w/4)} y={y(top/2)-6} fontSize="12" fill="#1f3654" textAnchor="middle">K = {fmt(K)}</text>
      <text x={x(w*0.75)} y={y(top/2)-6} fontSize="12" fill="#1f3654" textAnchor="middle">K</text>
      <text x={x(w/6)} y={y(-bot/2)+8} fontSize="12" fill="#1f3654">L = {fmt(L)}</text>
      <text x={x(w*0.83)} y={y(-bot/2)+8} fontSize="12" fill="#1f3654">L</text>
      <text x="455" y="59" fill="#205979" fontSize="11">K : {fmt(geo.angleKDeg)}°</text>
      <text x="455" y="75" fill="#205979" fontSize="11">L : {fmt(geo.angleLDeg)}°</text>
    </svg>
    <div className="grid gap-1 sm:grid-cols-2">
      <p>Hauteur haute : <strong>{fmt(geo.hauteurHautM)} m</strong> · hauteur basse : <strong>{fmt(geo.hauteurBasM)} m</strong>.</p>
      <p>Projection de K : <strong>{fmt(geo.projectionK)} m</strong> · de L : <strong>{fmt(geo.projectionL)} m</strong>.</p>
      <p>Contrôle hauteur et cotes K/L à 45° : <strong>{geo.coherent?'✓ cohérent':'À vérifier'}</strong> · H reconstruite : {fmt(geo.hauteurCalculeeM)} m.</p>
      <p>Rectangle brut : <strong>{fmt(geo.brutM)} × {fmt(geo.profondeurBruteM)} m</strong>.</p>
      <p>Surface réelle : <strong>{fmt(geo.areaM2)} m²</strong> · chute théorique : <strong>{fmt(geo.wasteAreaM2)} m²</strong>.</p>
      <p className="font-semibold text-emerald-900">Métrage facturé : {fmt(w)} ml (W calculé).</p>
    </div>
    <p className="text-slate-500">Angles à 45° imposés par rapport à l'horizontale, avec symétrie gauche-droite. L'orientation de débit et les marges de coupe restent à valider en atelier.</p>
  </div>
}
