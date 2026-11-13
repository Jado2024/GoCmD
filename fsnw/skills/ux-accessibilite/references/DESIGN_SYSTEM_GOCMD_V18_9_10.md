# Design system GoCmd — règles validées V18.9.10

> Ce document consigne les règles de design **appliquées et vérifiées** lors de la correction UX/UI V18.9.10 (39/40 anomalies de l'audit V18.9.9 corrigées). Il sert de référence pour toute évolution future de l'interface GoCmd et complète le protocole d'audit. Chaque règle est adossée à une mesure ou à un test réel.

## 1. Jetons de couleur (mesurés au navigateur, canvas)

| Usage | Jeton | Contraste mesuré | Règle |
|---|---|---|---|
| Action primaire (une seule par écran) | `Button variant="primary"` = `bg-emerald-700` + blanc | **5,36:1** | Jamais d'ambre ni de violet pour une action primaire |
| Action destructive | `Button variant="destructive"` = `bg-rose-700` + blanc | **6,03:1** | Unique échelle de rouge : `rose-*` (jamais `red-*`) |
| Action neutre en tableau | `size="sm"` (32 px) | — | Libellés « Approuver / Refuser / Clôturer » ; taille default dans les modales |
| Menu sombre (slate-900) | titres et secondaire `text-slate-400` | **6,78:1** | `slate-500/600` interdits sur fond sombre (2,35–3,74:1) |
| Métadonnées sur fond clair | `text-slate-500` minimum | **4,76:1** | `text-slate-400` sur blanc interdit pour toute information utile (2,63:1) |
| Séries graphiques | emerald `#047857` / rose `#be123c` (et déclinaisons 600-800 pour les camemberts) | légendes 5,48 / 6,29:1 | Les légendes recharts héritent de la couleur de série : choisir des séries ≥ 4,5:1 |
| Badge compteur | `bg-rose-700` + texte 11 px | **6,03:1** | Le compteur est annoncé via l'aria-label du bouton |
| Ambre | réservé aux alertes/attentes : fonds `amber-50` + texte `amber-900` | — | Jamais de texte blanc sur fond ambre |
| Violet | réservé aux statuts « en attente de validation / produits spéciaux » | — | Inchangé (sémantique existante) |
| Bleu | hors palette : fonds d'info → `slate-50`/`slate-200`, succès → `emerald-50` | — | `blue-*` interdit dans l'interface |

## 2. Focus clavier (WCAG 2.4.7)

- **Motif unique** : `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600` — appliqué dans les composants centraux (`button.tsx`, `input.tsx`, `select.tsx`, `tabs.tsx`, `textarea.tsx`) et à tout nouvel élément interactif.
- **Leçon V18.9.10** : le ring shadcn `focus-visible:ring-ring/50` était mesuré **invisible** dans le navigateur (box-shadow transparent) — ne pas s'y fier sans test Tab réel ; l'outline opaque est le motif de référence.
- Preuve type : chaîne de Tab avec `getComputedStyle().outlineStyle/Width` sur chaque élément actif (artefact `NEXTJS-PORTAL` exclu en dev).

## 3. Composants exclusifs

- **Select** : composant shadcn `Select` uniquement (les `<select>` natifs sont proscrits — focus et aria hérités).
- **Tableau** : composants `Table*` shadcn, montants `text-right tabular-nums`, `scope="col"` automatique.
- **Input / Textarea** : composants du design system (36 px, 16 px mobile anti-zoom iOS).
- **Cases à cocher** : toujours dans un `<label>` cliquable, ≥ 20 px (`size-5`), cible ligne entière quand pertinent, `aria-label` explicite si hors flux textuel ; 24 px (`size-6`) pour les cases isolées en cellule de tableau.
- **Chargement** : `Skeleton` pour les listes (grille identique à la grille réelle), jamais de texte « Chargement… » seul.
- **Erreur de liste** : composant `LoadError` (bordure/fond rose, message actionnable, bouton Réessayer).
- **KPI** : composant unique `KpiCard` (bits.tsx), hint à hauteur fixe `min-h-8` pour aligner les lignes de base, clic de navigation optionnel.
- **Recherche/tri de liste** : composants partagés `ListSearch` / `SortableTh` / `useListSort` (list-controls.tsx) ; **la portée (« N lignes chargées ») est toujours affichée** — un tri local ne doit jamais passer pour un tri global de la base.
- **Monnaie** : `fmtMAD()` seul ; `fmtMAD(v, { cents: true })` pour les documents financiers (centimes conservés).

## 4. Interactions

- **Recherche globale** : navigation uniquement à la soumission (Entrée) — jamais de changement de vue à la frappe (perte de contexte).
- **URL** : la vue est synchronisée dans `?vue=…` (history.replaceState) avec **garde RBAC** (vue interdite → dashboard) ; le serveur revalide chaque endpoint.
- **Destructions** : toute action destructive a une confirmation (dialogue dédié) ou un motif obligatoire — le seuil réel (5/8/10 selon l'opération) est affiché dans le libellé.
- **Quantités** : saisie directe (input numérique) + boutons ± de 36 px ; jamais de valeur non éditable.
- **Boutons désactivés complexes** : la raison est affichée en contexte sous le bouton.
- **Dates relatives** : toujours `title` avec date absolue + élément `<time>`.
- **Impression** : `Button variant="outline" size="sm"` + icône, jamais de lien stylé main.
- **Identité de session** : visible dès 768 px (md), tronquée avec rôles au survol.

## 5. Typographie

| Niveau | Règle |
|---|---|
| H1 page | `text-2xl font-bold tracking-tight` (systématique) |
| Sous-titre | `text-sm text-slate-500 mt-0.5` |
| CardTitle | `text-base font-semibold` — jamais en doublon du H1 |
| Données de tableaux | 14 px minimum (`text-sm`) |
| Métadonnées | 12 px minimum (`text-xs`) ; `text-[11px]` limite, `text-[10px]` réservé à l'impression |
| Consignes de sécurité atelier | **≥ 12 px + encadré** pour les alertes critiques (cotes et valeurs géométriques jamais modifiées par l'ergonomie) |

## 6. États vides

Chaque tableau affiche une ligne `colSpan` « Aucun X… » (motif « Aucun lot enregistré ») — jamais de page blanche. Les états vides de recherche précisent le terme recherché.

## 7. Ce qui ne doit jamais être sacrifié à l'ergonomie

Masquage par rôle explicite (boutons désactivés + `title`), motifs obligatoires, quatre-yeux, simulation de stock avant sortie, contrôle géométrique des gabarits, visa directeur distinct de la validation, montants tabulaires à droite, confidentialité des prix par rôle. Le mode sombre (tokens définis dans globals.css) reste une décision métier séparée.
