import { test, expect, type Page } from "@playwright/test"

/** E2E circuit ventes GoCmd — UI réelle, base isolée, comptes nominatifs.
 * Le lanceur (tests/run-e2e-playwright.cjs) fournit GOCMD_E2E_URL et les
 * identifiants GOCMD_E2E_{SALES,INVENTORY,FINANCE_A,FINANCE_B}_{NAME,PASSWORD}.
 *
 * Contre-audit final 08/11/2026 : sélecteurs alignés sur l'UI réelle —
 * les lignes du catalogue sont des <tr role="button"> (le rôle explicite
 * écrase le rôle « row » implicite), le champ mot de passe exige une
 * correspondance EXACTE (le bouton de visibilité « Afficher le mot de
 * passe » porte un aria-label contenant la même sous-chaîne), l'option de
 * facturation est au format « CMD-… — CLIENT-… », la sélection des pièces
 * du BL se fait par cases à cocher (pas de « Tout sélectionner »), et le
 * refus quatre-yeux du règlement est soumis via le dialog puis lu dans
 * l'alerte serveur (role="alert"). */

const users = {
  sales: [process.env.GOCMD_E2E_SALES_NAME!, process.env.GOCMD_E2E_SALES_PASSWORD!],
  approver: [process.env.GOCMD_E2E_APPROVER_NAME!, process.env.GOCMD_E2E_APPROVER_PASSWORD!],
  inventory: [process.env.GOCMD_E2E_INVENTORY_NAME!, process.env.GOCMD_E2E_INVENTORY_PASSWORD!],
  finance: [process.env.GOCMD_E2E_FINANCE_A_NAME!, process.env.GOCMD_E2E_FINANCE_A_PASSWORD!],
  financeB: [process.env.GOCMD_E2E_FINANCE_B_NAME!, process.env.GOCMD_E2E_FINANCE_B_PASSWORD!],
}
for (const [k, [n, p]] of Object.entries(users)) if (!n || !p) throw Error(`Missing ${k}`)

async function login(page: Page, who: "sales" | "approver" | "inventory" | "finance" | "financeB") {
  const [name, password] = users[who]
  await page.goto("/login")
  await page.getByLabel("Nom d'utilisateur").fill(name)
  // Correspondance EXACTE requise : le bouton de visibilité « Afficher le
  // mot de passe » (aria-label contenant la même sous-chaîne) faisait
  // échouer getByLabel en mode strict (2 éléments résolus).
  await page.getByLabel("Mot de passe", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Se connecter" }).click()
  // Audit 10/11/2026 : « GoCmd · ERP SODEPI » figure DÉJÀ dans l'en-tête de la
  // page de connexion — ce repère validait le login avant même la réponse de
  // /api/auth/login, et les appels API directs suivants partaient sans cookie
  // (401 intermittent). Attendre désormais la session réellement établie : le
  // bouton de déconnexion n'existe que dans l'application authentifiée.
  await expect(page.getByRole("button", { name: "Se déconnecter de GoCmd" })).toBeVisible({ timeout: 20_000 })
}

async function openOrderDetail(page: Page, ref: string) {
  await page.getByRole("button", { name: new RegExp(ref) }).first().click()
  const dlg = page.getByRole("dialog")
  // Le titre du dialog (heading) porte la référence — les lignes de pièces
  // contiennent aussi la réf complète (CMD-…-001-S01-L01-P01) : matcher le
  // heading évite la violation de mode strict (5 éléments résolus).
  await expect(dlg.getByRole("heading", { name: new RegExp(ref) })).toBeVisible({ timeout: 10_000 })
  return dlg
}

test("T1 — commande catalogue approuvée à quatre yeux puis OF et étiquettes", async ({ page }) => {
  await login(page, "sales")
  await page.getByRole("button", { name: "Catalogue produits" }).click()
  await expect(page.getByText(/produits — page/)).toBeVisible()
  // Filtrer sur la famille MATELAS : la pagination par défaut ne montre que
  // les premières familles (page 1/10) — les matelas ne sont pas rendus.
  await page.getByRole("combobox", { name: "Famille" }).click()
  await page.getByRole("option", { name: /MATELAS \(/ }).click()
  await expect(page.getByRole("button", { name: /Ouvrir la fiche de MATELAS/ }).first()).toBeVisible({ timeout: 10_000 })
  // Les lignes du catalogue sont des boutons « Ouvrir la fiche de … »
  // (role=button explicite sur le <tr>) — pas des « row » ARIA.
  const row = page.getByRole("button", { name: /Ouvrir la fiche de MATELAS/ }).filter({ hasText: "/u" }).first()
  await row.getByRole("button", { name: "Commander" }).click()
  const dlg = page.getByRole("dialog")
  await expect(dlg.getByText(/Nouvelle commande/)).toBeVisible({ timeout: 10_000 })
  // Quatre matelas au PRIX DU CATALOGUE : ne pas déclencher le visa directeur.
  // Règle serveur /u : quantité = champ « Nombre d'articles identiques »
  // (copie) et UNE seule pièce de compte 1 par ligne (« Une unité vendue
  // correspond à une seule pièce physique ») — ne pas toucher au compte de
  // pièces (défaut 1). Les <Label> du dialog n'ont pas d'association for/id :
  // cibler l'input frère du label.
  const qty = dlg.getByText(/Nombre d.articles identiques/).locator("xpath=following-sibling::input").first()
  await qty.fill("4")
  // Choisir le client (comptes démo synthétiques CLIENT-DEMO-*).
  await dlg.getByText("Choisir un client").click()
  await page.getByRole("option", { name: /CLIENT-DEMO/ }).first().click()
  await dlg.getByRole("button", { name: /Confirmer \/ soumettre la commande/ }).click()
  // Succès : le dialog se ferme (la fiche commande n'est PAS ouverte
  // automatiquement — aller la consulter dans « Commandes clients »).
  await expect(dlg).toBeHidden({ timeout: 15_000 })
  await page.getByRole("button", { name: "Commandes clients" }).click()
  await expect(page.getByText(/commandes au total/)).toBeVisible({ timeout: 10_000 })
  const first = page.getByRole("button", { name: /CMD-2026-\d+/ }).first()
  const ref = ((await first.getAttribute("aria-label")) ?? (await first.innerText())).match(/CMD-2026-\d+/)![0]
  // P6U-P2FIX : le créateur ne doit JAMAIS obtenir d'OF avant l'approbation.
  const pendingOrders = await page.request.get('/api/orders?take=200')
  expect(pendingOrders.ok()).toBeTruthy()
  const pendingOrder=(await pendingOrders.json()).items.find((o:{ref:string})=>o.ref===ref)
  expect(pendingOrder?.status).toBe('pending_validation')
  const orderId=pendingOrder.id as number
  const before=await page.request.get(`/api/work-orders?orderId=${orderId}`)
  expect((await before.json()).items).toHaveLength(0)
  const forbidden=await page.request.patch(`/api/orders/${orderId}`,{
    headers:{Origin:process.env.GOCMD_E2E_URL!},data:{action:'approve',comment:'Tentative auto-validation commerciale'}
  })
  expect(forbidden.status()).toBe(403)
  await page.getByRole('button',{name:'Se déconnecter de GoCmd'}).click()
  await login(page,'approver')
  const accepted=await page.request.patch(`/api/orders/${orderId}`,{
    headers:{Origin:process.env.GOCMD_E2E_URL!},data:{action:'approve',comment:'Validation par responsable indépendant'}
  })
  expect(accepted.status()).toBe(200)
  await page.getByRole('button',{name:'Se déconnecter de GoCmd'}).click()
  await login(page,'sales')
  await page.getByRole('button',{name:'Commandes clients'}).click()
  // Les OF ne sont disponibles qu'à cette étape.
  const after=await page.request.get(`/api/work-orders?orderId=${orderId}`)
  expect((await after.json()).items).toHaveLength(1)
  // Le détail s’ouvre : OF approuvé après validation nominative.
  const detail = await openOrderDetail(page, ref)
  await expect(detail.getByText(/Ordres de fabrication \(OF\)/)).toBeVisible({ timeout: 15_000 })
  await expect(detail.getByText(/8 étiquettes A4\/page/)).toBeVisible()
  await expect(detail.getByText(/· Approuvé/)).toBeVisible()
  await detail.getByRole("button", { name: "Consulter" }).first().click()
  await expect(detail.getByRole("button", { name: /Imprimer/ })).toBeVisible({ timeout: 10_000 })
})

test("T2 — magasinier prépare OF confirmé, commercial livre sans second visa", async ({ page }) => {
  await login(page, "sales")
  // Récupérer les références réellement créées par T1 sur la base isolée.
  const response=await page.request.get("/api/orders?take=200")
  expect(response.ok()).toBeTruthy()
  const orders=(await response.json()).items as Array<{id:number;ref:string;status:string}>
  const latest=orders.find(o=>o.status==="new")
  expect(latest, "Une CMD normale confirmée par T1 doit exister").toBeTruthy()
  const detailResponse=await page.request.get(`/api/work-orders?orderId=${latest!.id}`)
  expect(detailResponse.ok()).toBeTruthy()
  const wos=(await detailResponse.json()).items as Array<{id:number;status:string}>
  expect(wos).toHaveLength(1)
  expect(wos[0].status).toBe("approved")
  // Un compte commercial n'a pas le droit d'effectuer les actions du magasinier.
  const denied=await page.request.patch(`/api/work-orders/${wos[0].id}`,{
    headers:{Origin:process.env.GOCMD_E2E_URL!},data:{action:"start"}
  })
  expect(denied.status()).toBe(403)

  await page.getByRole("button", { name: "Se déconnecter de GoCmd" }).click()
  await login(page,"inventory")
  // Les actions d'atelier ont lieu sous le rôle INVENTORY, pas sous approver.
  for(const action of ["start","complete"]){
    const response=await page.request.patch(`/api/work-orders/${wos[0].id}`,{
      headers:{Origin:process.env.GOCMD_E2E_URL!},data:{action}
    })
    expect(response.status(),`${action} OF par magasinier`).toBe(200)
  }
  await page.getByRole("button", { name: "Se déconnecter de GoCmd" }).click()
  await login(page,"sales")
  for(const status of ["production","ready"]){
    const response=await page.request.patch(`/api/orders/${latest!.id}`,{
      headers:{Origin:process.env.GOCMD_E2E_URL!},data:{action:"advance"}
    })
    expect(response.status(),`commande passe ${status}`).toBe(200)
    expect((await response.json()).order.status).toBe(status)
  }
  // Livraison réelle par l'interface : les OF sont terminés et les pièces disponibles.
  await page.getByRole("button", { name: "BL clients" }).click()
  await page.getByText("Choisir une commande validée").click()
  await page.getByRole("option", { name: new RegExp(latest!.ref) }).click()
  const blBoxes=page.getByRole("checkbox")
  await blBoxes.first().waitFor({state:"visible",timeout:10_000})
  for(const cb of await blBoxes.all()) await cb.check()
  await page.getByRole("button", { name: "Valider le BL" }).click()
  await expect(page.getByText(/BLC-2026-\d+/).first()).toBeVisible({timeout:15_000})
  const shipped=await page.request.get("/api/orders?take=200")
  const current=(await shipped.json()).items.find((o:{id:number})=>o.id===latest!.id)
  expect(current.status).toBe("shipped")
})

test("T3 — facturation finance : TVA 20 %, règlement quatre yeux par un second compte, solde soldé", async ({ page }) => {
  await login(page, "finance")
  await page.getByRole("button", { name: "Factures & règlements clients" }).click()
  await expect(page.getByText(/État de compte client · Finance/)).toBeVisible({ timeout: 10_000 })
  // Facturer le BL de la commande : option « CMD-… — CLIENT-… » puis BL non facturé.
  await page.getByText("Choisir une commande", { exact: true }).click()
  await page.getByRole("option", { name: /CMD-2026-\d+ — CLIENT-DEMO/ }).first().click()
  // Attendre le rendu de la liste des BL non facturés avant de cocher.
  const billBoxes = page.getByRole("checkbox")
  await billBoxes.first().waitFor({ state: "visible", timeout: 10_000 })
  for (const cb of await billBoxes.all()) await cb.check()
  await page.getByText("Sélectionner le taux").click()
  await page.getByRole("option", { name: "20 %" }).click()
  await page.getByRole("button", { name: "Émettre la facture client" }).click()
  const card = page.getByText(/FAC-2026-\d+/).first()
  await expect(card).toBeVisible({ timeout: 15_000 })
  // L'émetteur ne peut pas encaisser lui-même : le serveur refuse (quatre yeux).
  await page.getByRole("button", { name: "Enregistrer un paiement" }).first().click()
  const pay = page.getByRole("dialog")
  await expect(pay.getByText(/Enregistrer un règlement/)).toBeVisible({ timeout: 10_000 })
  await pay.getByText("Choisir le mode").click()
  await page.getByRole("option", { name: "Virement" }).click()
  // Montant réel de la facture calculé au prix catalogue, pas un tarif forcé.
  const invoices=(await (await page.request.get("/api/sales?type=invoices")).json()).items as Array<{id:number;totalCents:number}>
  const amount=(invoices[0].totalCents/100).toFixed(2)
  await pay.getByLabel("Montant en MAD").fill(amount)
  await pay.getByLabel(/Référence unique du règlement/).fill("E2E-REG-01")
  await pay.getByRole("button", { name: "Confirmer" }).click()
  // Le serveur refuse : message d'erreur remonté par le toast (rôle
  // « Notifications »), le dialog reste ouvert.
  await expect(page.getByText(/quatre yeux/i)).toBeVisible({ timeout: 15_000 })
  await pay.getByRole("button", { name: "Annuler" }).click()
  await expect(pay).toBeHidden({ timeout: 10_000 })

  // Second compte finance (quatre yeux) : le règlement passe, la facture est soldée.
  await page.getByRole("button", { name: "Se déconnecter de GoCmd" }).click()
  await expect(page.getByText(/Accès sécurisé/)).toBeVisible({ timeout: 10_000 })
  await login(page, "financeB")
  await page.getByRole("button", { name: "Factures & règlements clients" }).click()
  await page.getByRole("button", { name: "Enregistrer un paiement" }).first().click()
  const pay2 = page.getByRole("dialog")
  await expect(pay2.getByText(/Enregistrer un règlement/)).toBeVisible({ timeout: 10_000 })
  await pay2.getByText("Choisir le mode").click()
  await page.getByRole("option", { name: "Virement" }).click()
  await pay2.getByLabel("Montant en MAD").fill(amount)
  await pay2.getByLabel(/Référence unique du règlement/).fill("E2E-REG-02")
  await pay2.getByRole("button", { name: "Confirmer" }).click()
  // Plein règlement : facture « Payée », solde nul.
  await expect(page.getByText(/Payée/).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/Solde 0,00 MAD/).first()).toBeVisible({ timeout: 15_000 })
})
