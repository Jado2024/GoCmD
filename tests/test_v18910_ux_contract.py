"""V18.9.10 — contrats statiques UX/UI (garde anti-régression des 40 correctifs).
Vérifie les invariants structurels des corrections : focus visible central,
action primaire unique, échelle rose unifiée, accessibilité (scope, Fermer,
labels), synchronisation d'URL, traductions. Ne remplace pas les mesures
navigateur (contrastes, clavier) — voir le dossier de preuves V18.9.10."""
from pathlib import Path

R = Path(__file__).resolve().parents[1]
src = lambda rel: (R / rel).read_text(encoding="utf-8")

# ── UX-002 : focus clavier visible sur les composants interactifs centraux ──
button = src("src/components/ui/button.tsx")
assert "focus-visible:outline-2" in button, "button.tsx : focus visible manquant"
assert "focus-visible:outline-primary" in button, "button.tsx : focus de marque manquant"
assert "--primary: #bd202a" in src("src/app/globals.css"), "theme SODEPI : couleur primaire manquante"
for comp in ("src/components/ui/input.tsx", "src/components/ui/select.tsx", "src/components/ui/tabs.tsx"):
    assert "focus-visible:outline-2" in src(comp), f"{comp} : focus visible manquant"

# ── UX-006/UX-021 : variant primary unique (rouge SODEPI) + destructive rose-700 ──
assert "primary:" in button and "bg-primary text-primary-foreground" in button, "variant primary de marque manquant"
assert '"bg-rose-700 text-white' in button, "destructive doit être rose-700"
# aucun bouton d'action principale hors design system dans les vues
for view in ("orders-view", "sales-view", "purchase-dialog", "catalogue-view", "purchases-view", "p2p-advanced-view"):
    v = src(f"src/components/erp/{view}.tsx")
    assert "bg-amber-500 hover:bg-amber-600" not in v, f"{view} : CTA ambre interdit (UX-001)"
    assert "bg-violet-600" not in v, f"{view} : CTA violet interdit (UX-006)"
    assert "bg-slate-800 px-" not in v, f"{view} : bouton natif interdit (UX-005)"

# ── UX-003 : menu sombre lisible (slate-400, jamais slate-500/600 sur sombre) ──
sidebar = src("src/components/erp/nav-sidebar.tsx")
assert "text-slate-600" not in sidebar, "nav-sidebar : slate-600 interdit sur fond sombre"
assert sidebar.count("text-slate-400") >= 3, "nav-sidebar : titres/secondaire doivent être slate-400"

# ── UX-025/UX-026 : libellé Fermer + scope col ──
assert '<span className="sr-only">Fermer</span>' in src("src/components/ui/dialog.tsx")
assert 'scope="col"' in src("src/components/ui/table.tsx")

# ── P5.15.29 : revue nominative, plus de champ de code commun ──
# CASCADE3 (11/11/2026) : le libellé P1FIX de la zone de validation a été
# reformulé (« Votre identité est celle du compte connecté. Aucune clé de
# validation commune n'est nécessaire. ») sans mise à jour de ce contrat.
# L'invariant reste identique : aucune clé de validation commune, décision
# nominative par session. Les deux formulations connues sont acceptées.
orders = src("src/components/erp/orders-view.tsx")
assert 'ov-approval-key' not in orders, 'clé commune supprimée de la revue'
assert ('La décision utilise votre session nominative' in orders
        or 'Votre identité est celle du compte connecté. Aucune clé de validation commune n\'est nécessaire.' in orders), 'message de validation nominative manquant'

# ── UX-012 : la recherche ne navigue plus à la frappe ──
erp_app = src("src/components/erp/erp-app.tsx")
assert "value.length >= 2 && view !== \"catalogue\") navigate" not in erp_app, "navigation à la frappe interdite"
assert "if (e.key === \"Enter\") submitGlobalSearch()" in erp_app, "navigation à la soumission attendue"

# ── UX-013 : synchronisation ?vue= + garde RBAC (mise à jour V18.9.13-p4) ──
assert 'searchParams.set("vue", view)' in erp_app
assert 'history.replaceState' in erp_app
assert 'if (session.data && !allowedViews.includes(view)) setView(allowedViews[0] ?? "my-account")' in erp_app, 'garde RBAC (vue interdite → première vue autorisée, ou compte personnel) manquante'

# ── UX-015 : formateur monétaire unique avec centimes ──
types_src = src("src/lib/erp-types.ts")
assert "opts?: { cents?: boolean }" in types_src, "fmtMAD doit gérer les centimes"
sales = src("src/components/erp/sales-view.tsx")
assert "const mad=(c:number)=>(c/100)" not in sales, "formateur local mad() supprimé"
assert "fmtMADCents" in sales

# ── UX-017 : refus de devis confirmé ──
assert "Confirmer le refus" in sales and "confirmRejectQuote" in sales

# ── UX-019 : contrôles de liste partagés ──
assert (R / "src/components/erp/list-controls.tsx").exists(), "composants ListSearch/SortableTh manquants"
assert "ListSearch" in orders, "recherche kanban commandes manquante"
for view, marker in (("sales-view", "ListSearch"), ("supply-chain-view", "SortableTh"), ("p2p-control-view", "SortableTh")):
    assert marker in src(f"src/components/erp/{view}.tsx"), f"{view} : contrôles de liste manquants"

# ── UX-022 : consignes atelier ≥ 12 px (text-xs), valeurs inchangées ──
# Contre-audit 08/11/2026 (AV-06) : l'assertion initiale bannissait
# « text-[10px] font-bold » sur TOUT le composant ; les étiquettes OF P5.15.21
# utilisent légitimement cette taille pour les valeurs imprimées (métrage,
# codes-barres). L'exigence réelle UX-022 porte sur l'AVERTISSEMENT atelier,
# qui doit rester en text-xs (≥ 12 px) et jamais en 10 px.
label_sheet = src("src/components/erp/label-sheet.tsx")
assert 'ATTENTION : écart géométrique D/J' in label_sheet
assert 'text-xs font-bold text-rose-900' in label_sheet, 'avertissement atelier en text-xs (UX-022)'
assert 'text-[10px] font-bold text-rose' not in label_sheet, 'avertissement atelier jamais en 10 px (UX-022)'

# ── UX-029 : traduction des options p2p-advanced ──
p2p_adv = src("src/components/erp/p2p-advanced-view.tsx")
assert 'approved:"Approuvé"' in p2p_adv and 'OPTION_LABELS' in p2p_adv
assert "aria-current={active?\"page\":undefined}" in p2p_adv, "onglet actif (UX-030) manquant"

# ── UX-036 : traduction présentation des écarts, API inchangée ──
route = src("src/app/api/supplier-invoices/route.ts")
assert "quantity above accepted" in route, "chaîne API d'origine doit rester inchangée"
assert "translateDiscrepancy" in src("src/components/erp/p2p-control-view.tsx")

# ── UX-035 : message 401 explicite ──
assert "Session expirée : reconnectez-vous depuis la page de connexion." in src("src/components/erp/hooks.ts")

# ── UX-034 : un seul composant KPI ──
assert "function Kpi(" not in src("src/components/erp/dashboard-view.tsx"), "Kpi local doit être supprimé"
assert "KpiCard" in src("src/components/erp/dashboard-view.tsx")

# ── UX-038 : identité visible dès md ──
assert "md:inline" in erp_app and "xl:inline" not in erp_app.split("Identification")[0][-400:]

# ── UX-037 : skeleton aligné sur la grille réelle ──
assert "lg:grid-cols-2 xl:grid-cols-3\" }>\n          {COLUMNS.map((c) => (\n            <Skeleton" in orders or 'lg:grid-cols-2 xl:grid-cols-3' in orders.split("isPending ? (")[1][:200]

print("PASS V18.9.10 — 17 familles de contrats UX/UI vérifiées statiquement (anti-régression des correctifs UX-001…040)")
