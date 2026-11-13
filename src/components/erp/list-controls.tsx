"use client";

import { useCallback, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// V18.9.10 (UX-019) : contrôles de liste partagés — recherche locale et tri
// par colonne réutilisables. Portée : tri/filtrage CLIENT sur les éléments
// déjà chargés par l'API (take ≤ 100–200) ; le compteur l'affiche clairement
// pour ne pas faire passer un tri local pour un tri global de la base.

export type SortDir = "asc" | "desc";
export type SortState<K extends string> = { key: K; dir: SortDir };

/** État de tri local : colonne active + direction, avec bascule. */
export function useListSort<K extends string>(defaultKey: K, defaultDir: SortDir = "desc") {
  const [sort, setSort] = useState<SortState<K>>({ key: defaultKey, dir: defaultDir });
  const toggle = useCallback(
    (key: K) => {
      setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
    },
    [],
  );
  return { sort, toggle, setSort };
}

/** Applique le tri : comparateurs fournis par colonne (fallback : texte). */
export function sortItems<T, K extends string>(
  items: T[],
  sort: SortState<K>,
  comparators: Partial<Record<K, (a: T, b: T) => number>>,
): T[] {
  const cmp = comparators[sort.key];
  const list = [...items];
  if (!cmp) return list;
  list.sort((a, b) => (sort.dir === "asc" ? cmp(a, b) : -cmp(a, b)));
  return list;
}

/** En-tête de colonne triable (tableaux shadcn). Indicateur de sens + aria-sort. */
export function SortableTh<K extends string>({
  label,
  field,
  sort,
  onToggle,
  className,
  align = "left",
}: {
  label: string;
  field: K;
  sort: SortState<K>;
  onToggle: (field: K) => void;
  className?: string;
  align?: "left" | "right";
}) {
  const active = sort.key === field;
  const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn("text-foreground h-10 px-2 align-middle font-medium whitespace-nowrap", align === "right" && "text-right", className)}
    >
      <button
        type="button"
        onClick={() => onToggle(field)}
        className={cn(
          "inline-flex items-center gap-1 rounded text-xs font-medium uppercase tracking-wide transition-colors hover:text-slate-900",
          align === "right" && "flex-row-reverse",
          active ? "text-slate-900" : "text-slate-500",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        )}
      >
        {label}
        <Icon className={cn("size-3", active ? "text-emerald-700" : "text-slate-400")} aria-hidden />
        <span className="sr-only">{active ? (sort.dir === "asc" ? ", tri croissant" : ", tri décroissant") : ", trier"}</span>
      </button>
    </th>
  );
}

/**
 * Champ de recherche locale de liste, avec compteur de portée.
 * `total` = éléments chargés affichables ; le libellé précise que la
 * recherche porte sur les lignes chargées (jamais sur toute la base).
 */
export function ListSearch({
  value,
  onChange,
  placeholder,
  shown,
  total,
  unit,
  className,
  global=false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  shown: number;
  total: number;
  unit: string;
  global?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className="relative min-w-0 flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <Input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-9 w-full pl-8 pr-8"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Effacer la recherche"
            className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500" aria-live="polite">
        {global ? `${shown} sur ${total} ${unit} correspondant(s)` : `${value ? shown : total} ${unit} — recherche sur les ${total} lignes chargées`}
      </p>
    </div>
  );
}
