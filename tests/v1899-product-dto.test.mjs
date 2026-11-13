/** V18.9.9 (SEC-PROD-01/02) — tests unitaires du DTO produit par permission.
 * Exécution : node --experimental-strip-types tests/v1899-product-dto.test.mjs
 * Ne remplace pas les recettes HTTP (ci-v1896-isolated-http.cjs, http-v1899-business-recipe.cjs). */
import assert from 'node:assert/strict'
import { maySeeSpecialPriceInternals, productDtoForActor, mayReadNonActiveProduct } from '../src/lib/product-dto.ts'

const director = { username: 'direction', roles: ['director'], legacy: false }
const admin = { username: 'patrone', roles: ['admin'], legacy: false }
const salesAuthor = { username: 'commercial', roles: ['sales'], legacy: false }
const salesOther = { username: 'concurrent', roles: ['sales'], legacy: false }
const finance = { username: 'compta', roles: ['finance'], legacy: false }
const receiver = { username: 'magasin', roles: ['receiver'], legacy: false }
const shared = { username: 'legacy-demo', roles: [], legacy: true }

const proposal = {
  id: 1, sku: 'GC-SA-SP-TEST', status: 'pending_validation', specialNotes: 'Notes internes confidentielles',
  specialPriceStatus: 'pending', specialApprovedUnitPrice: null, specialPriceProposedBy: 'commercial',
  specialPriceApprovedBy: null, specialPriceApprovedAt: null, specialPriceDecisionReason: null,
  specialPriceRevision: 1, unitPrice: 999,
}
const approved = { ...proposal, specialPriceStatus: 'approved', specialApprovedUnitPrice: 1300.75, unitPrice: 1300.75, specialPriceApprovedBy: 'direction', specialPriceApprovedAt: new Date() }

// --- Habilitations aux métadonnées internes (SEC-PROD-01)
assert.equal(maySeeSpecialPriceInternals(director, proposal), true, 'directeur habilité')
assert.equal(maySeeSpecialPriceInternals(admin, proposal), false, 'admin seul ne lit pas le prix spécial interne')
assert.equal(maySeeSpecialPriceInternals(salesAuthor, proposal), true, 'auteur de la proposition habilité')
assert.equal(maySeeSpecialPriceInternals(salesOther, proposal), false, 'autre commercial NON habilité')
assert.equal(maySeeSpecialPriceInternals(finance, proposal), false, 'finance NON habilité aux notes internes')
assert.equal(maySeeSpecialPriceInternals(receiver, proposal), false, 'réception NON habilitée')
assert.equal(maySeeSpecialPriceInternals(shared, proposal), false, 'compte partagé NON habilité')
assert.equal(maySeeSpecialPriceInternals(null, proposal), false, 'anonyme NON habilité')

// --- DTO : masquage des champs internes, conservation du travail commercial
const masked = productDtoForActor(approved, salesOther)
assert.equal(masked.specialNotes, null, 'notes internes masquées')
assert.equal(masked.specialApprovedUnitPrice, null, 'prix approuvé enregistré masqué')
assert.equal(masked.specialPriceProposedBy, null, 'auteur masqué')
assert.equal(masked.specialPriceApprovedBy, null, 'décideur masqué')
assert.equal(masked.specialPriceApprovedAt, null, 'date de décision masquée')
assert.equal(masked.specialPriceDecisionReason, null, 'motif masqué')
assert.equal(masked.specialPriceRevision, 0, 'révision masquée')
assert.equal(masked.specialPriceStatus, 'approved', 'statut du visa conservé (travail commercial)')
assert.equal(masked.unitPrice, 1300.75, 'prix de vente autorisé conservé')
const full = productDtoForActor(approved, director)
assert.equal(full.specialNotes, 'Notes internes confidentielles', 'directeur voit les notes')
assert.equal(full.specialApprovedUnitPrice, 1300.75, 'directeur voit le prix approuvé')
assert.equal(full.specialPriceApprovedBy, 'direction', 'directeur voit le décideur')
const authorView = productDtoForActor(approved, salesAuthor)
assert.equal(authorView.specialNotes, 'Notes internes confidentielles', 'auteur voit ses propres notes')

// --- Accès aux propositions non actives (SEC-PROD-02)
assert.equal(mayReadNonActiveProduct(director, proposal), true, 'directeur lit la proposition')
assert.equal(mayReadNonActiveProduct(admin, proposal), false, 'admin seul ne lit pas la proposition métier')
assert.equal(mayReadNonActiveProduct(salesAuthor, proposal), true, 'auteur lit sa proposition')
assert.equal(mayReadNonActiveProduct(salesOther, proposal), false, 'autre commercial : proposition PENDING invisible')
assert.equal(mayReadNonActiveProduct(salesOther, approved), true, 'autre commercial : proposition visée réutilisable')
assert.equal(mayReadNonActiveProduct(receiver, approved), false, 'réception : produit non actif invisible même visé')
assert.equal(mayReadNonActiveProduct(finance, proposal), false, 'finance : proposition invisible')
assert.equal(mayReadNonActiveProduct(shared, proposal), false, 'compte partagé : proposition invisible')
assert.equal(mayReadNonActiveProduct(null, proposal), false, 'anonyme : proposition invisible')
const rejected = { ...proposal, status: 'rejected' }
assert.equal(mayReadNonActiveProduct(salesAuthor, rejected), true, 'auteur voit sa proposition refusée')
assert.equal(mayReadNonActiveProduct(salesOther, rejected), false, 'autre commercial : proposition refusée invisible')

console.log('PASS V18.9.9 — DTO produit par permission et accès aux propositions : 34 assertions')
