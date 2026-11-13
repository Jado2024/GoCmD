"use client";

import {useEffect,useRef,useState} from "react";
import {ArrowRight} from "lucide-react";
import {Button} from "@/components/ui/button";
import type {ViewId} from "./nav-sidebar";

/** Jalons opérationnels de l'acheteur. Aucune décision métier automatique. */
const STEPS:{id:ViewId;label:string;guidance:string}[]=[
 {id:"buyer-workbench",label:"Mes priorités",guidance:"Identifier les ruptures achetables et les dossiers ouverts. Aucune DA automatique."},
 {id:"materials",label:"Matières",guidance:"Vérifier le stock, le seuil, l'unité, les fournisseurs actifs et les demandes déjà ouvertes."},
 {id:"purchases",label:"Demandes (DA)",guidance:"Exprimer le besoin. Un autre compte doit approuver ; l'acheteur suit la décision."},
 {id:"suppliers",label:"Fournisseurs",guidance:"Consulter les fournisseurs actifs, leurs associations matières et leurs conditions."},
 {id:"p2p-advanced",label:"Consultations",guidance:"Consulter, obtenir des devis écrits et préparer le choix ; l'attribution relève de l'approbateur."},
 {id:"supplier-orders",label:"Commandes (BC)",guidance:"Préparer les BC à partir de DA autorisées et d'une source tarifaire valide ; suivre les reliquats."},
 {id:"goods-receipts",label:"Réceptions (BR)",guidance:"Consulter les réceptions et quantités acceptées. Seul le réceptionnaire saisit un BR."},
];
export const BUYER_WORK_VIEWS=new Set<ViewId>(STEPS.map(step=>step.id));

export function BuyerJourney({active,allowedViews,onNavigate}:{active:ViewId;allowedViews:ViewId[];onNavigate:(view:ViewId)=>void}){
 const steps=STEPS.filter(step=>allowedViews.includes(step.id));
 const scrollRef=useRef<HTMLElement|null>(null);
 const [canScroll,setCanScroll]=useState({left:false,right:false});
 useEffect(()=>{
  const el=scrollRef.current;
  if(!el)return;
  const measure=()=>{
   const left=el.scrollLeft>4;
   const right=el.scrollLeft+el.clientWidth<el.scrollWidth-4;
   setCanScroll(old=>old.left===left&&old.right===right?old:{left,right});
  };
  measure();
  el.addEventListener("scroll",measure,{passive:true});
  const observer=typeof ResizeObserver!=="undefined"?new ResizeObserver(measure):null;
  observer?.observe(el);
  return ()=>{el.removeEventListener("scroll",measure);observer?.disconnect();};
 },[steps.length]);
 const position=steps.findIndex(step=>step.id===active);
 if(position<0)return null;
 const step=steps[position];
 const next=steps[position+1];
 return <section aria-label="Parcours acheteur" className="mb-5 space-y-2 rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
   <div className="flex flex-wrap items-start justify-between gap-2">
    <div><p className="text-xs font-semibold uppercase tracking-wide text-[#971d29]">Circuit acheteur · étape {position+1} / {steps.length}</p>
     <p className="mt-1 text-sm text-slate-700">{step.guidance}</p></div>
    {next&&<Button size="sm" variant="outline" onClick={()=>onNavigate(next.id)}>Étape suivante <ArrowRight className="ml-1 size-4"/></Button>}
   </div>
   <div className="relative min-w-0">
   <div aria-hidden="true" className={`pointer-events-none absolute inset-y-0 left-0 z-10 w-6 shadow-[inset_10px_0_8px_-8px_rgba(15,23,42,0.35)] transition-opacity print:hidden ${canScroll.left?"opacity-100":"opacity-0"}`}/>
   <div aria-hidden="true" className={`pointer-events-none absolute inset-y-0 right-0 z-10 w-6 shadow-[inset_-10px_0_8px_-8px_rgba(15,23,42,0.35)] transition-opacity print:hidden ${canScroll.right?"opacity-100":"opacity-0"}`}/>
   <nav ref={scrollRef} aria-label="Étapes du circuit achats" tabIndex={0} className="min-w-0 overflow-x-auto pb-1 print:overflow-visible">
    <ol className="flex min-w-max gap-1.5">
     {steps.map((item,i)=><li key={item.id}>
       <button type="button" aria-current={active===item.id?'step':undefined} onClick={()=>onNavigate(item.id)}
        className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${active===item.id?'border-[#a92232] bg-rose-50 text-[#861c28]':'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'}`}>
        <span aria-hidden>{i+1}.</span> {item.label}
       </button>
      </li>)}
    </ol>
   </nav>
   </div>
 </section>
}
