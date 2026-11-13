'use strict';
/* R13.2 — contrat de distinction 409 métier / 503 technique sur la création
 * de commande (mission §2 C7). La contention SQLite transitoire doit renvoyer
 * 503 + Retry-After (échec technique rejouable) et ne doit JAMAIS être
 * confondue avec un conflit commercial 409 (DuplicateOrderConflict,
 * DUPLICATE_ORDER_POTENTIAL, DUPLICATE_REVIEW_STALE). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.resolve(__dirname, '..', 'src', 'app', 'api', 'orders', 'route.ts'), 'utf8');

test('R13.2: la contention SQLite transitoire renvoie 503 + Retry-After, pas 409', () => {
  assert.match(source, /errCode==="P2028"\|\|errCode==="P2034"/,
    'les codes Prisma P2028/P2034 doivent être traités comme techniques');
  assert.match(source, /SQLITE_BUSY\|database is locked\|database is busy/i,
    'les signaux SQLITE_BUSY/locked doivent être traités comme techniques');
  assert.match(source, /status:\s*503,\s*headers:\s*\{\s*"Retry-After":"2"/,
    'la réponse technique doit être 503 avec Retry-After');
  assert.match(source, /Base momentanément occupée/,
    'message technique distinct du message métier');
});

test('R13.2: P1008 (issue incertaine) renvoie 503 avec consigne de vérification', () => {
  // P1008 = GOCMD_SQLITE_OUTCOME_UNCERTAIN (fail-closed, non rejoué) : la
  // transaction a pu être engagée. 503 + message de vérification, jamais un
  // 409 métier ni un rejeu à l'aveugle.
  assert.match(source, /if\s*\(\s*errCode==="P1008"\s*\)/,
    'P1008 doit avoir sa branche dédiée avant la contention générique');
  assert.match(source, /Enregistrement en cours de vérification/,
    'message dédié à l\'issue incertaine');
  assert.match(source, /"Retry-After":"5"/,
    'Retry-After plus long pour l\'issue incertaine (vérification d\'abord)');
});

test('R13.2: les conflits métier conservent le 409 documenté', () => {
  assert.match(source, /if\s*\(\s*e\s+instanceof\s+DuplicateOrderConflict\s*\)/,
    'la branche DuplicateOrderConflict doit rester avant le traitement technique');
  assert.match(source, /e\.response,\s*\{\s*status:\s*409/,
    'DuplicateOrderConflict doit continuer de renvoyer 409');
  assert.match(source, /Enregistrement impossible/,
    'le repli générique 409 reste en place pour les autres collisions');
});

test('R13.2: les erreurs Prisma génériques sont 503, les conflits métier Error restent 409', () => {
  assert.match(source, /\/\^PrismaClient\/\.test/,
    'toute erreur PrismaClient* non couverte doit être 503 technique');
  assert.match(source, /Enregistrement momentanément indisponible/,
    'message technique générique dédié');
  assert.match(source, /PRODUCT_CHANGED/, 'les conflits d\'état métier restent documentés dans la transaction');
});

test('R13.2: le journal serveur conserve la trace sans divulgation (safeErrorMetadata)', () => {
  assert.match(source, /console\.error\("Contention SQLite creation commande",safeErrorMetadata\(e\)\)/,
    'la contention doit être journalisée côté serveur via safeErrorMetadata');
});
