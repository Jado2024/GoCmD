import { existsSync, appendFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { setSqliteWritePreflight } from './sqlite-write'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  prismaPragmas: Promise<void> | undefined
}

/** P5.15.28 P1 : pas de WAL tant que toutes les versions SQLite embarquées
 * (Prisma, node:sqlite, Python) ne sont pas vérifiées corrigées.
 * Une base en WAL DOIT être convertie hors ligne avec une sauvegarde externe ;
 * le démarrage vérifié refuse le WAL sans modifier automatiquement la base.
 * Ne jamais masquer l'échec de ce pré-vol : les écritures en dépendent. */
async function applyConnectionPragmas(client: PrismaClient): Promise<void> {
  // P0-01 (contre-audit P5.15.29) : « PRAGMA busy_timeout=5000 » RETOURNE une
  // ligne (la valeur active). $executeRawUnsafe la refusait avec P2010
  // (« Execute returned results, which is not allowed in SQLite »), la promesse
  // de pré-vol rejetait et serializedSQLiteWrite faisait donc échouer TOUTES
  // les écritures applicatives. $queryRawUnsafe accepte les lignes retournées ;
  // le résultat est ignoré. preflight-p51529.test.cjs vérifie ce contrat.
  await client.$queryRawUnsafe('PRAGMA busy_timeout=5000')
  await client.$queryRawUnsafe('PRAGMA foreign_keys=ON')
  const rows = await client.$queryRawUnsafe<Array<{ mode: string }>>(
    'SELECT journal_mode AS mode FROM pragma_journal_mode'
  )
  if (String(rows[0]?.mode ?? '').toLowerCase() !== 'delete') {
    throw new Error('GOCMD_SQLITE_UNSAFE_WAL: la base doit être en journal DELETE avant démarrage')
  }
  const fk = await client.$queryRawUnsafe<Array<{ enabled: bigint | number }>>(
    'SELECT foreign_keys AS enabled FROM pragma_foreign_keys'
  )
  if (Number(fk[0]?.enabled ?? 0) !== 1) {
    throw new Error('GOCMD_SQLITE_FOREIGN_KEYS_OFF')
  }
}

function createGoCmdClient(): PrismaClient {
  // R13.3 (mesure §3.3) : profilage SQL désactivé par défaut. Avec
  // GOCMD_BENCH_SQL_PROFILE=1, chaque requête Prisma est journalisée
  // (durée ms + texte) dans GOCMD_BENCH_SQL_OUT pour attribuer le temps SQL
  // et le nombre de requêtes à chaque endpoint de recette. Aucun effet en
  // exploitation : la variable n'est posée que par le harnais de benchmark.
  const profiling = process.env.GOCMD_BENCH_SQL_PROFILE === '1'
  const client = profiling
    ? new PrismaClient({ log: [{ emit: 'event', level: 'query' }] })
    : new PrismaClient()
  if (profiling) {
    const out = process.env.GOCMD_BENCH_SQL_OUT || '/tmp/gocmd-sql-profile.jsonl'
    client.$on('query' as never, (event: unknown) => {
      const e = event as { query?: string; duration?: number; params?: string }
      try {
        appendFileSync(out, JSON.stringify({ t: Date.now(), ms: e.duration ?? 0, q: String(e.query ?? '').slice(0, 300) }) + '\n')
      } catch { /* journal best-effort */ }
    })
  }
  globalForPrisma.prismaPragmas = applyConnectionPragmas(client)
  // Attach a rejection handler immediately to avoid unhandled-rejection noise.
  // The ORIGINAL promise remains rejecting: serializedSQLiteWrite is fail-closed.
  void globalForPrisma.prismaPragmas.catch(() => undefined)
  return client
}

export const db =
  globalForPrisma.prisma ??
  createGoCmdClient()

/** Pré-vol SQLite bloquant pour les mutations (aucun échec silencieux). */
export const sqlitePragmasReady: Promise<void> =
  globalForPrisma.prismaPragmas ?? Promise.resolve()

// DEF-S-05 : toute écriture passe par serializedSQLiteWrite ; on garantit
// ainsi l'ordre PRAGMA → première écriture sans proxy risqué sur le client.
setSqliteWritePreflight(sqlitePragmasReady)

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
