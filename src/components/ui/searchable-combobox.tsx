"use client"

import * as React from "react"
import { Check, ChevronsUpDown, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export type SearchOption = { value: string; label: string }
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr").trim()

/** Choix contrôlé + recherche clavier, sans création libre de catégories fantômes. */
export function SearchableCombobox({
  value, onChange, options, label, placeholder = "Rechercher ou sélectionner…", disabled = false,
  emptyText = "Aucun résultat", className,
}: {
  value: string
  onChange: (value: string) => void
  options: readonly SearchOption[]
  label: string
  placeholder?: string
  emptyText?: string
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [active, setActive] = React.useState(0)
  const listId = React.useId()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const filtered = React.useMemo(() => options.filter(x => norm(`${x.label} ${x.value}`).includes(norm(query))), [options, query])
  const selected = options.find(x => x.value === value)
  const choose = (v: string) => { onChange(v); setOpen(false); setQuery(""); setActive(0) }
  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(i => Math.min(i + 1, filtered.length - 1)) }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive(i => Math.max(0, i - 1)) }
    if (e.key === "Enter" && filtered[active]) { e.preventDefault(); choose(filtered[active].value) }
    if (e.key === "Escape") { setOpen(false); setQuery("") }
  }
  return <Popover open={open} onOpenChange={v=>{setOpen(v);setQuery("");setActive(0)}}>
    <PopoverTrigger asChild>
      <Button type="button" variant="outline" role="combobox" aria-expanded={open} aria-controls={listId} aria-label={label}
        disabled={disabled} className={cn("h-9 w-full min-w-0 justify-between font-normal",className)}>
        <span className="truncate text-left">{(selected?.label ?? value) || placeholder}</span>
        <ChevronsUpDown aria-hidden="true" className="ml-2 size-4 shrink-0 opacity-50" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" sideOffset={4} className="w-[var(--radix-popover-trigger-width)] min-w-56 max-w-[calc(100vw-2rem)] p-2"
      onOpenAutoFocus={e=>{e.preventDefault();inputRef.current?.focus()}}>
      <div className="relative mb-2">
        <Search aria-hidden="true" className="absolute left-2.5 top-2.5 size-4 text-slate-500"/>
        <Input ref={inputRef} value={query} onChange={e=>{setQuery(e.target.value);setActive(0)}} onKeyDown={handleKey}
          aria-label={`Rechercher ${label.toLocaleLowerCase("fr")}`} role="combobox" aria-controls={listId}
          aria-expanded="true" aria-activedescendant={filtered[active]?`${listId}-option-${active}`:undefined}
          className="pl-8" placeholder="Tapez pour filtrer…" autoComplete="off" />
      </div>
      <div id={listId} role="listbox" aria-label={label} className="max-h-52 overflow-y-auto overscroll-contain">
        {filtered.length ? filtered.map((o,idx)=><button key={o.value} type="button" role="option" aria-selected={value===o.value}
          id={`${listId}-option-${idx}`} onMouseEnter={()=>setActive(idx)} onClick={()=>choose(o.value)}
          className={cn("flex min-h-9 w-full items-center gap-2 rounded px-2 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary",idx===active?"bg-slate-100":"hover:bg-slate-50")}>
          <Check aria-hidden="true" className={cn("size-4 shrink-0",o.value===value?"opacity-100":"opacity-0")}/>
          <span className="break-words">{o.label}</span>
        </button>) : <p className="px-2 py-3 text-sm text-slate-500">{emptyText}</p>}
      </div>
    </PopoverContent>
  </Popover>
}
