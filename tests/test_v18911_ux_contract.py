"""V18.9.11 — contrats statiques UX/UI du contre-audit (extension de V18.9.10).
Garde anti-régression des correctifs du contre-audit, en particulier :
- CA-001 : débordement horizontal 25 px sur « Factures fournisseurs » à 768×1024
  (bouton « Préparer l'avoir post-règlement » coupé). La grille des avoirs
  fournisseurs doit rester en 2 colonnes de md à xl (colonne ≥ ~340 px à 768)
  avant de passer en 4 colonnes au-delà de 1280 px ; interdiction de revenir à
  md:grid-cols-4 (colonne 165 px < bouton 226 px en whitespace-nowrap).
Ne remplace pas les mesures navigateur (voir dossier de preuves V18.9.11)."""
from pathlib import Path

R = Path(__file__).resolve().parents[1]
src = lambda rel: (R / rel).read_text(encoding="utf-8")

# ── CA-001 : grille des avoirs fournisseurs sans colonne étroite ──
p2p = src("src/components/erp/p2p-control-view.tsx")
assert "md:grid-cols-2 xl:grid-cols-4" in p2p, (
    "p2p-control-view : la grille des avoirs doit être md:grid-cols-2 xl:grid-cols-4 "
    "(sinon le bouton « Préparer l'avoir post-règlement » est coupé à 768-1024 px)")
assert "grid grid-cols-1 gap-3 md:grid-cols-4" not in p2p, (
    "p2p-control-view : md:grid-cols-4 (165 px/colonne à 768) est interdit — "
    "cause du débordement de 25 px détecté par le contre-audit")
# Le libellé métier du bouton reste inchangé (terminologie finance préservée)
assert "Préparer l’avoir post-règlement" in p2p, "libellé métier de l'avoir post-règlement"

# ── CA-001b : le design system Button reste nowrap par défaut ; aucune classe
#    globale overflow-x:hidden de masquage ajoutée sur html/body dans globals ──
globals_css = src("src/app/globals.css")
for forbidden in ("html{overflow-x:hidden", "body{overflow-x:hidden",
                  "html {\n  overflow-x: hidden", "overflow-x: hidden;\n}"):
    assert forbidden not in globals_css, (
        f"globals.css : « {forbidden} » masquerait les débordements au lieu de les corriger")

# ── CA-002 : cible du bouton Fermer ≥ 24×24 (WCAG 2.5.8) ──
dialog = src("src/components/ui/dialog.tsx")
assert "grid size-6 place-items-center" in dialog, (
    "dialog.tsx : le bouton de fermeture doit avoir une cible ≥ 24×24 px (size-6)")
assert "absolute top-3 right-3" in dialog, "dialog.tsx : position du bouton Fermer"

# ── CA-003 : message visible de saisie invalide dans la modale DA ──
purchase = src("src/components/erp/purchase-dialog.tsx")
assert "Quantité positive requise (3 décimales maximum pour kg/ml/m ; entier pour les blocs)." in purchase, (
    "purchase-dialog.tsx : règle quantité par unité absente")
assert "aria-describedby={invalid ? helpId : undefined}" in purchase, (
    "purchase-dialog.tsx : liaison aria-describedby du message d'erreur manquante")
# V18.9.12 : la garde est désormais centralisée dans le payload contrôlé ;
# la protection contre les brouillons invalides remplace l'ancien arrondi.
assert 'disabled={!canSubmit}' in purchase and 'submissionLines !== null' in purchase, (
    "purchase-dialog.tsx : interdiction d'envoi avec brouillon invalide")
assert 'lines: submissionLines' in purchase, (
    "purchase-dialog.tsx : le payload doit utiliser les quantités affichées et validées")


print("test_v18911_ux_contract : OK (CA-001 + CA-002 + CA-003)")
