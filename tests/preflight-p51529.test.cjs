#!/usr/bin/env node
/* P5.15.29 contre-audit — P0-01 : contrat de pré-vol Prisma.
 *
 * Avant correction, db.ts appliquait « PRAGMA busy_timeout=5000 » via
 * $executeRawUnsafe. Ce PRAGMA retourne la valeur active : le moteur Prisma
 * refuse toute requête executeRaw qui retourne des lignes (P2010 « Execute
 * returned results, which is not allowed in SQLite »). La promesse de pré-vol
 * rejetait donc, et serializedSQLiteWrite faisait échouer TOUTES les écritures
 * applicatives (409 génériques), sans qu'aucun test HTTP ne l'ait détecté.
 *
 * Ce test exécute les MÊMES appels que src/lib/db.ts sur une copie jetable de
 * la base démo, prouve qu'ils aboutissent, qu'une écriture réelle fonctionne
 * et que foreign_keys=ON est opérationnel (insertion orpheline refusée).
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const root = path.resolve(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gocmd-p51529-preflight-'));
const file = path.join(work, 'preflight.db');
fs.copyFileSync(path.join(root, 'db', 'custom.db'), file);
process.env.DATABASE_URL = 'file:' + file;
process.on('exit', () => fs.rmSync(work, { recursive: true, force: true }));

const db = new PrismaClient();

test('le pré-vol Prisma de db.ts aboutit (queryRaw, jamais executeRaw sur un PRAGMA retournant une ligne)', async () => {
  await db.$queryRawUnsafe('PRAGMA busy_timeout=5000');
  await db.$queryRawUnsafe('PRAGMA foreign_keys=ON');
  const mode = await db.$queryRawUnsafe('SELECT journal_mode AS mode FROM pragma_journal_mode');
  assert.equal(String(mode[0]?.mode ?? '').toLowerCase(), 'delete', 'journal_mode=delete attendu');
  const fk = await db.$queryRawUnsafe('SELECT foreign_keys AS enabled FROM pragma_foreign_keys');
  assert.equal(Number(fk[0]?.enabled ?? 0), 1, 'foreign_keys=ON attendu');
});

test('une écriture applicative réelle aboutit (le pré-vol ne bloque plus les mutations)', async () => {
  await assert.doesNotReject(
    () => db.auditEvent.create({ data: { actor: 'preflight-test', action: 'PREFLIGHT_WRITE_PROBE', entity: 'System', entityId: 'p51529', details: '{}' } }),
    'l\'écriture Prisma échoue : le pré-vol de db.ts est rejeté (régression P0-01)'
  );
  const rows = await db.auditEvent.findMany({ where: { actor: 'preflight-test' } });
  assert.ok(rows.length >= 1, 'la sonde d\'écriture doit être relue');
});

test('foreign_keys=ON est opérationnel : une écriture orpheline est refusée', async () => {
  await assert.rejects(
    () => db.orderLine.create({ data: { orderId: 987654321, productId: 1, qty: 1, unit: 'u', unitPrice: 1, priceApprovalStatus: 'not_required', stockUnitsPerSale: 1 } }),
    (e) => String(e.code ?? '').startsWith('P2') || /Foreign key constraint/i.test(String(e.message ?? '')),
    'l\'insertion orpheline doit être refusée par la clé étrangère active'
  );
});

test('rappel du contrat : $executeRawUnsafe sur busy_timeout doit être refusé (pourquoi queryRaw est requis)', async () => {
  await assert.rejects(
    () => db.$executeRawUnsafe('PRAGMA busy_timeout=5000'),
    (e) => e.code === 'P2010',
    'le moteur Prisma doit refuser executeRaw sur un PRAGMA retournant une ligne — db.ts doit utiliser queryRaw'
  );
});

db.$disconnect();
