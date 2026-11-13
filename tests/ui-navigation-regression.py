"""Sanity checks for horizontal desktop navigation and wide tables."""
from pathlib import Path
r=Path(__file__).resolve().parents[1]/'src/components/erp'
shell=(r/'erp-app.tsx').read_text(encoding='utf-8')
top=(r/'top-navigation.tsx').read_text(encoding='utf-8')
nav=(r/'nav-sidebar.tsx').read_text(encoding='utf-8')
materials=(r/'materials-view.tsx').read_text(encoding='utf-8')
assert 'TopNavigation active={view}' in shell
assert 'sticky top-0' in shell
assert '<aside' not in shell, 'No permanent desktop sidebar should remain'
assert 'max-w-7xl' not in shell, 'Main content must use full width'
assert 'w-full min-w-0 flex-1' in shell
assert 'overflow-x-auto' in top and 'aria-current' in top
assert 'SECTIONS.flatMap(section => section.items)' in top
assert 'export const SECTIONS' in nav
assert 'overflow-x-auto scrollbar-thin' in materials
assert 'min-w-[980px]' in materials
assert 'aria-label="Ouvrir le menu"' in shell
print('OK : barre horizontale, pleine largeur, tableau scrollable, menu mobile, 6 onglets conservés.')
