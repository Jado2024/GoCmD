#!/usr/bin/env node
/* Orchestrateur E2E Playwright — même discipline que run-http-recipes-v1899.cjs :
 * UN serveur de production local sur base SQLite jetable, comptes nominatifs
 * distincts, exécution des tests Playwright, puis arrêt. Localhost uniquement.
 * P5.15.21 : la mission d'audit exige des tests Playwright réels ; ce lanceur
 * suit les garde-fous du projet (GOCMD_E2E_CONFIRM, base copiée, jamais la démo).
 *
 * P5.15.22 (CLT-01) — arrêt propre et code de sortie fiable :
 * le serveur est lancé détaché (chef de groupe de processus) et
 * `next start` est un PETIT-FILS (start-gocmd-checked.cjs → spawnSync).
 * Tuer seulement l'enfant direct laissait le serveur Next vivant et les
 * tubes stdout/stderr ouverts : l'orchestrateur ne rendait jamais la main
 * (timeout externe après la réussite des tests). Désormais :
 *   1. arrêt par SIGNAUX AU GROUPE ENTIER (process.kill(-pid)) puis SIGKILL ;
 *   2. destruction des flux hérités avant d'attendre la mort du groupe ;
 *   3. process.exit(code) explicite — 0 = succès, 1 = échec tests/erreur,
 *      2 = précondition absente (build manquant).
 */
'use strict'
const assert = require('node:assert/strict')
const { createAccounts } = require('./qa-managed-accounts.cjs')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { spawn, spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')

assert.equal(process.env.GOCMD_E2E_CONFIRM, undefined, 'Ce lanceur contrôle lui-même la base isolée ; ne pas hériter GOCMD_E2E_CONFIRM')
if (!fs.existsSync(path.join(root, '.next', 'BUILD_ID'))) {
  console.error('Build de production absent : exécuter `bun run build` avant les E2E.')
  process.exit(2)
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gocmd-e2e-playwright-'))
const testDB = path.join(dir, 'e2e.db')
fs.copyFileSync(path.join(root, 'db', 'custom.db'), testDB)
const SPEC = { SALES: ['sales'], APPROVER: ['approver'], INVENTORY: ['inventory'], FINANCE_A: ['finance'], FINANCE_B: ['finance'] }
const accounts = createAccounts(testDB, 'pw', SPEC)
const env = {
  ...process.env, GOCMD_E2E_CONFIRM: 'ISOLATED_DB_ONLY', GOCMD_E2E_URL: '',
  GOCMD_E2E_SALES_NAME: accounts.SALES.username, GOCMD_E2E_SALES_PASSWORD: accounts.SALES.password,
  GOCMD_E2E_APPROVER_NAME: accounts.APPROVER.username, GOCMD_E2E_APPROVER_PASSWORD: accounts.APPROVER.password,
  GOCMD_E2E_INVENTORY_NAME: accounts.INVENTORY.username, GOCMD_E2E_INVENTORY_PASSWORD: accounts.INVENTORY.password,
  GOCMD_E2E_FINANCE_A_NAME: accounts.FINANCE_A.username, GOCMD_E2E_FINANCE_A_PASSWORD: accounts.FINANCE_A.password,
  GOCMD_E2E_FINANCE_B_NAME: accounts.FINANCE_B.username, GOCMD_E2E_FINANCE_B_PASSWORD: accounts.FINANCE_B.password,
}
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer(); srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => { const port = srv.address().port; srv.close(() => resolve(port)) })
  })
}
let server = null
let finishing = false

/* ---- CLT-01 : arrêt déterministe du groupe de processus serveur ---- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function signalGroup(sig) {
  if (!server) return
  if (process.platform === 'win32') {
    // Windows : arbre complet via taskkill /T (pas de groupe POSIX).
    if (server.pid) { try { spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} }
    return
  }
  try { process.kill(-server.pid, sig) } catch { /* groupe déjà éteint ou EPERM */ }
  try { if (server.exitCode === null) server.kill(sig) } catch {}
}
function groupAlive() {
  if (!server) return false
  if (server.exitCode !== null && server.killed) return false
  try { process.kill(-server.pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}
async function shutdownServer() {
  if (!server) return
  // Couper d'abord les flux hérités : les descripteurs ouverts maintenaient
  // la boucle d'événements en vie même après la mort de l'enfant direct.
  for (const stream of [server.stdout, server.stderr]) { try { stream?.destroy() } catch {} }
  if (groupAlive()) {
    signalGroup('SIGTERM')
    const grace = Date.now() + 8000
    while (Date.now() < grace && groupAlive()) await sleep(150)
    if (groupAlive()) signalGroup('SIGKILL')
    const hard = Date.now() + 5000
    while (Date.now() < hard && groupAlive()) await sleep(100)
  }
}
async function finish(code) {
  if (finishing) return
  finishing = true
  try { await shutdownServer() } catch {}
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  process.exit(code)
}
/* Réseau de sécurité synchrone : si process.exit est déclenché ailleurs,
 * le groupe reçoit quand même un signal fatal avant la sortie. */
process.on('exit', () => { try { signalGroup('SIGKILL') } catch {} try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} })
process.on('SIGINT', () => { void finish(130) })
process.on('SIGTERM', () => { void finish(143) })

;(async () => {
  const port = await freePort()
  env.GOCMD_E2E_URL = `http://127.0.0.1:${port}`
  server = spawn(process.execPath, ['scripts/start-gocmd-checked.cjs'], {
    cwd: root, detached: process.platform !== 'win32',
    env: { ...env, GOCMD_DB_FILE: testDB, GOCMD_REQUIRE_SQLITE_USERS: '1', GOCMD_REQUIRE_RBAC: '1',
      GOCMD_ACCESS_PASSWORD: '',
      GOCMD_SALES_TAX_RATES_BPS: '0,2000', GOCMD_PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
      // Audit 10/11/2026 : la copie isolée porte le marqueur de contenu DEMO
      // du seed synthétique ; le démarrage contrôlé exige l'échappatoire de
      // recette LOCALE. La base reste une copie jetable liée à 127.0.0.1 :
      // aucun risque de production (le lanceur supprime le dossier à la fin).
      GOCMD_ALLOW_DEMO_DB: '1',
      HOSTNAME: '127.0.0.1', PORT: String(port), NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let boot = ''
  for (const k of ['stdout', 'stderr']) server[k].on('data', (d) => { boot += d.toString() })
  let ready = false
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw Error(`Serveur E2E exit ${server.exitCode} : ${boot.slice(-1500)}`)
    try { const r = await fetch(`${env.GOCMD_E2E_URL}/api/me`, { signal: AbortSignal.timeout(1200) }); if (r.status === 401) { ready = true; break } } catch {}
    await new Promise((r) => setTimeout(r, 350))
  }
  assert(ready, 'serveur E2E non prêt')
  const run = spawnSync(process.execPath, [path.join(root, 'node_modules', '@playwright', 'test', 'cli.js'), 'test'], { cwd: root, env, encoding: 'utf8', timeout: 600_000, killSignal: 'SIGKILL' })
  process.stdout.write(run.stdout || '')
  process.stderr.write(run.stderr || '')
  if (run.error) { console.error('FAIL E2E PLAYWRIGHT : exécution interrompue —', run.error.message); await finish(1) }
  if (run.status === 0) { console.log('PASS E2E PLAYWRIGHT : circuit ventes vérifié dans l’interface réelle (base isolée)'); await finish(0) }
  console.error(`FAIL E2E PLAYWRIGHT (code de sortie ${run.status ?? 'inconnu'})`)
  await finish(1)
})().catch(async (e) => { console.error('FAIL orchestrateur E2E :', e.stack || e); await finish(1) })
