"use client"

import {Button} from "@/components/ui/button"
import {Input} from "@/components/ui/input"
import type {DocumentPage} from "@/lib/document-register"

export function DocumentPager({page,data,onPage,label}:{page:number;data?:DocumentPage;onPage:(page:number)=>void;label:string}) {
  const last=Math.max(1,Math.ceil((data?.total??0)/(data?.pageSize??40)))
  return <nav className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs" aria-label={`Pages · ${label}`}>
    <span role="status">Page {page}{data?` sur ${last} · ${data.total} résultat(s)`:""}</span>
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" disabled={page<=1} onClick={()=>onPage(1)}>Première</Button>
      <Button variant="outline" size="sm" disabled={page<=1} onClick={()=>onPage(page-1)}>Précédent</Button>
      <Button variant="outline" size="sm" disabled={!data?.hasMore} onClick={()=>onPage(page+1)}>Suivant</Button>
      <Button variant="outline" size="sm" disabled={!data||page>=last} onClick={()=>onPage(last)}>Dernière</Button>
      <form className="flex items-center gap-1" onSubmit={e=>{
        e.preventDefault()
        const target=Number(new FormData(e.currentTarget).get("page"))
        if(data&&Number.isInteger(target)&&target>=1&&target<=last)onPage(target)
      }}>
        <Input name="page" type="number" required min={1} max={last} aria-label="Aller à la page" className="h-8 w-20"/>
        <Button size="sm" type="submit" variant="outline" disabled={!data}>Aller</Button>
      </form>
    </div>
  </nav>
}
