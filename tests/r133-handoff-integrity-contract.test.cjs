#!/usr/bin/env node
/* Livraison de reprise R13.3 — contrats rapides SANS serveur, applicables
 * AVANT le build. Ces contrôles complètent (ne remplacent PAS) le véritable
 * test HTTP tests/r133-dual-engine-corruption.test.cjs.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('R13.3: la base DEMO est incluse et identique au jeu fictif autorisé', () => {
  const p = path.join(root, 'db/custom.db');
  assert(fs.existsSync(p), 'Le ZIP complet doit contenir db/custom.db');
  const bytes = fs.readFileSync(p);
  assert.equal(bytes.subarray(0, 16).toString(), 'SQLite format 3\0', 'En-tête SQLite invalide');
  // CI applique des migrations sur sa seule copie de db/custom.db AVANT ce test.
  // Vérification octet-pour-octet réservée à une extraction fraîche, AVANT migrations.
  if (process.env.GOCMD_REQUIRE_PRISTINE_DEMO === '1') {
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),
      '65288ab6a380d3b9a7d8f8b3447fe011d01f674eca4c60efc19d310abf06545d',
      'La base DEMO de distribution n’est pas strictement identique à R13.2');
  }
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(p, {readOnly:true});
  try {
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok', 'Intégrité SQLite non conforme');
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0, 'Clés étrangères invalides');
  } finally { db.close(); }
});

test('R13.3: le moteur node:sqlite reste lecture seule sur serveur', () => {
  const directory = read('src/lib/user-directory.cjs');
  const next = read('next.config.ts');
  const identity = read('src/lib/identity-writes.ts');
  assert.match(directory, /SERVER_RUNTIME\s*=\s*process\.env\.GOCMD_SERVER_RUNTIME\s*===\s*['"]1['"]/);
  assert.match(directory, /new DatabaseSync\(filename,\s*\{readOnly:SERVER_RUNTIME\}\)/);
  assert.match(directory, /if\s*\(SERVER_RUNTIME\)\s*serverWriteRefused/);
  assert.match(next, /GOCMD_SERVER_RUNTIME:\s*['"]1['"]/);
  assert.match(identity, /serializedSQLiteWrite\(/);
  assert.match(identity, /db\.goCmdSession|tx\.goCmdSession/);
  assert.match(identity, /goCmdAccessAudit/);
});

test('R13.3: test HTTP anticorruption refuse les faux PASS à vide', () => {
  const source = read('tests/r133-dual-engine-corruption.test.cjs');
  assert.match(source, /GOCMD_E2E_CONFIRM\s*!==\s*['"]ISOLATED_DB_ONLY['"]/);
  assert.match(source, /created2\s*>?=\s*N\s*\/\s*2/);
  assert.match(source, /pending\.length,\s*4/);
  assert.match(source, /line\.priceApprovalStatus\s*===\s*['"]pending['"]/);
  assert.match(source, /price\.status,\s*200/);
  assert.match(source, /order\.status,\s*200/);
  assert.match(source, /integrity\('phase3-confirmations-sensibles'\)/);
});

test('R13.3: CI déclenche les tests anticorruption APRÈS le build', () => {
  const ci = read('.github/workflows/ci.yml');
  const build = ci.indexOf('      - name: Production build');
  const corruption = ci.indexOf('      - name: R13.3 — dual-engine SQLite corruption regression');
  assert(build !== -1 && corruption > build, 'Le test HTTP doit suivre le build production');
  assert.match(ci.slice(corruption, corruption + 300), /GOCMD_E2E_CONFIRM:\s*ISOLATED_DB_ONLY/);
  assert.match(ci, /node tests\/r133-dual-engine-corruption\.test\.cjs/);
});

test('R13.3: fermeture du mode multi-instance et absence de migration destructive dans le patch', () => {
  const starter = read('scripts/start-gocmd-checked.cjs');
  assert.match(starter, /instance|lock/i);
  assert.match(starter, /GOCMD_SERVER_RUNTIME/);
});
