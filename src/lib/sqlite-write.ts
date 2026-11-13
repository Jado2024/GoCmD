/** SQLite a single writer. This process-local queue avoids conflicting GoCmd
 * order creates inside one Next.js worker. Retries handle other workers/routes.
 * PostgreSQL / multiple instances require database-backed sequencing instead.
 * P5.15.21 RC (DEF-S-05) : pré-vol injecté par src/lib/db.ts — la promesse
 * d'application des PRAGMA de connexion (busy_timeout, foreign_keys, rollback DELETE) est
 * attendue avant chaque écriture sérialisée. Injection plutôt qu'import :
 * ce module reste chargé isolément par les harnais de test (test_v12). */
let writePreflight: Promise<unknown> = Promise.resolve()

export function setSqliteWritePreflight(preflight: Promise<unknown>): void {
  writePreflight = preflight
}

let lastWrite: Promise<void> = Promise.resolve()

function retryable(error: unknown): boolean {
  const err = error as { code?: string; message?: string; meta?: { target?: string | string[] } } | null
  const code = String(err?.code ?? "")
  const msg = String(err?.message ?? "")
  if (/SQLITE_CORRUPT|disk image is malformed|database (?:is )?corrupt/i.test(code + " " + msg)) {
    console.error("GOCMD_SQLITE_CORRUPTION_SUSPECTED: écriture stoppée ; contrôler l'intégrité et les sauvegardes")
    return false
  }
  // P6 : le moteur peut signaler une erreur APRES qu'une transaction ait
  // été engagée. Un rejeu générique de ces erreurs pourrait créer des doublons
  // dans les API dépourvues d'une clé d'idempotence persistante. Fail-closed.
  if (code === "P1008" || /file being deleted|socket timeout/i.test(msg)) {
    console.error("GOCMD_SQLITE_OUTCOME_UNCERTAIN: ne pas rejouer sans vérifier le document et l'intégrité de la base")
    return false
  }
  if (code === "P2002") {
    // V18.9.1 (contre-audit A-11) : une violation d'unicité n'est rejouable
    // QUE pour les références générées par nextRef (movement.ref, BC, BR, RF…)
    // et la clé composée des upserts de lots : une collision sur une clé
    // métier (numéro de facture, nom client…) ne peut jamais réussir au
    // retry et doit renvoyer immédiatement un conflit.
    const target = err?.meta?.target
    const fields = Array.isArray(target) ? target.map(String) : target != null ? [String(target)] : []
    const generatedRef = fields.some(f => f === "ref")
    const lotUpsertKey = fields.includes("materialId") && fields.includes("lotCode") && fields.includes("provenanceKey")
    return generatedRef || lotUpsertKey
  }
  // P5.15.29-P4 : un signal SQLITE_CORRUPT (code 11) n'est JAMAIS une simple
  // contention. Il impose une alerte et une investigation, sans nouveau POST.
  // Le fait qu'un integrity_check ultérieur soit OK ne suffit pas à le reclasser.
  // Seuls les conflits/temporisations documentés sont rejoués (transaction entière).
  return ["P2028", "P2034", "SQLITE_BUSY"].includes(code) ||
    /SQLITE_BUSY|database is locked|transaction.*timeout|write conflict/i.test(msg)
}

async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await operation() }
    catch (error) {
      const canRetry=retryable(error)
      if (attempt >= 5 || !canRetry) {
        if (attempt >= 5 && canRetry) {
          // Exploitation Windows : signature sans message SQL ni donnée client.
          console.error("GOCMD_SQLITE_RETRY_EXHAUSTED: 6 tentatives, vérification opérateur requise")
        }
        throw error
      }
      // Deliberately back off instead of instantly recreating the SQLite contention.
      await new Promise<void>(resolve => setTimeout(resolve,
        Math.min(1500, 120 * 2 ** attempt) + Math.floor(Math.random() * 120)))
    }
  }
}

export async function serializedSQLiteWrite<T>(operation: () => Promise<T>): Promise<T> {
  await writePreflight
  let release!: () => void
  const previous = lastWrite
  lastWrite = new Promise<void>(resolve => { release = resolve })
  await previous
  try { return await withRetry(operation) }
  finally { release() }
}
