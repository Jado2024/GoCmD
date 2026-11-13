"use client";

import { useEffect, useRef, useState } from "react";
import { navigationSections, type ViewId } from "./nav-sidebar";
import { cn } from "@/lib/utils";

interface TopNavigationProps {
  active: ViewId;
  onNavigate: (id: ViewId) => void;
  alerts: number;
  allowedViews?: ViewId[];
  buyerMode?: boolean;
}

/**
 * Barre horizontale, ne prend aucune largeur au contenu principal.
 * P5.15.8 (audit UX F1) : indicateurs de défilement (dégradés) quand des
 * onglets sont masqués — sans eux, la barre coupée en plein bouton à 768 px
 * ressemble à un bug et les derniers onglets restent indécouvrables.
 */
export function TopNavigation({ active, onNavigate, alerts, allowedViews, buyerMode=false }: TopNavigationProps) {
  const navRef = useRef<HTMLElement | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const update = () => {
      const left = nav.scrollLeft > 4;
      const right = nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 4;
      setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
    };
    update();
    nav.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(nav);
    return () => {
      nav.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);

  return (
    <nav
      ref={navRef}
      aria-label="Navigation principale GoCmd"
      className="scrollbar-thin relative hidden w-full overflow-x-auto border-t border-slate-100 px-3 md:block sm:px-5 lg:px-7"
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 z-10 w-6 shadow-[inset_10px_0_8px_-8px_rgba(15,23,42,0.35)] transition-opacity duration-150 print:hidden",
          edges.left ? "opacity-100" : "opacity-0"
        )}
      />
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 z-10 w-6 shadow-[inset_-10px_0_8px_-8px_rgba(15,23,42,0.35)] transition-opacity duration-150 print:hidden",
          edges.right ? "opacity-100" : "opacity-0"
        )}
      />
      <ul className="flex min-w-max items-center gap-1 py-1">
        {navigationSections(allowedViews,buyerMode).flatMap(section => section.items).map(item => {
          const selected = active === item.id;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onNavigate(item.id)}
                aria-current={selected ? "page" : undefined}
                className={cn(
                  "inline-flex h-10 items-center gap-2 rounded-md border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                  selected
                    ? "border-[#bd202a] bg-[#fff0f1] text-[#89141d]"
                    : "border-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                )}
              >
                <item.icon className="size-4 shrink-0" aria-hidden />
                <span>{item.label}</span>
                {item.id === "materials" && alerts > 0 && (
                  <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-bold text-amber-900" aria-label={`${alerts} alertes de stock`}>
                    {alerts}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
