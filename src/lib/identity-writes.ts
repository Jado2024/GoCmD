/** R13.3 (CORR-01) — écritures du répertoire d'identités via le client Prisma.
 *
 * Contexte du défaut : dans le processus serveur Next.js, user-directory.cjs
 * (moteur node:sqlite) et les routes métier (moteur Prisma) ouvraient DEUX
 * connexions SQLite en écriture sur le même fichier. Les verrous POSIX étant
 * détenus par PROCESSUS, ces deux connexions ne se bloquaient jamais mutuelle-
 * ment : un login (INSERT GoCmdSession via node:sqlite) concurrent d'une
 * création de commande (Prisma) entrelaçait leurs pages et CORROMPAIT la base
 * (reproduction déterministe : tests/r133-dual-engine-corruption.test.cjs,
 * intégrité détruite en phase 2 « Prisma + logins » sur R13.2).
 *
 * Correctif : en mode serveur (GOCMD_SERVER_RUNTIME=1, posé par next.config.ts
 * et scripts/start-gocmd-checked.cjs), la connexion node:sqlite de
 * user-directory.cjs est STRICTEMENT lecture seule et ses fonctions d'écriture
 * refusent fail-closed. Toutes les écritures identités / sessions / audits
 * d'accès passent par LE client Prisma unique de src/lib/db.ts — un seul
 * moteur écrivain par fichier. Les scripts CLI (serveur arrêté) conservent
 * l'implémentation node:sqlite d'origine : entre processus distincts, les
 * verrous POSIX fonctionnent.
 *
 * Parité métier stricte avec user-directory.cjs : mêmes validations, mêmes
 * gardes (quatre yeux root, booléen strict, auto-désactivation), mêmes
 * écritures d'audit, mêmes messages d'erreur (les routes continuent de les
 * filtrer via safeUserDirectoryMessage). Les lectures synchrones (readSession,
 * readUser, managed, listUsers) restent dans user-directory.cjs.
 */
import { createHash, randomBytes } from "node:crypto"
import { db } from "@/lib/db"
import { serializedSQLiteWrite } from "./sqlite-write"
import * as directory from "./user-directory.cjs"

const SESSION_SECONDS = 8 * 60 * 60

function sessionHash(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

/** Même format que CURRENT_TIMESTAMP de SQLite (UTC, seconde près). */
function sqliteNow(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ")
}

/** Traduit une erreur Prisma d'infrastructure dans le libellé métier
 * historique afin que les routes (safeUserDirectoryMessage, traduction
 * « UNIQUE » de /api/admin/users) conservent exactement leur contrat. */
function mapInfrastructure(e: unknown): Error {
  const code = String((e as { code?: string })?.code ?? "")
  if (code === "P2002") return new Error("UNIQUE constraint failed: GoCmdUser.username")
  if (code === "P2021") return new Error("Gestion des comptes non initialisée")
  return e instanceof Error ? e : new Error("Opération refusée")
}

export async function createSession(username: string): Promise<{ token: string; maxAge: number }> {
  // COLLATE NOCASE sur la colonne : findFirst est insensible à la casse,
  // comme le SELECT ... WHERE username=? COLLATE NOCASE d'origine.
  const user = await db.goCmdUser.findFirst({ where: { username, active: 1 } })
  if (!user) throw new Error("Compte désactivé")
  const token = randomBytes(32).toString("base64url")
  const now = Math.floor(Date.now() / 1000)
  try {
    // File d'écriture sérialisée de l'application (DEF-S-05) : une seule
    // transaction d'écriture à la fois dans le processus, comme toutes les
    // écritures métier. Évite la contention P1008 entre transactions Prisma.
    await serializedSQLiteWrite(() => db.$transaction(async (tx) => {
      // Purge des sessions expirées, comme l'implémentation d'origine.
      await tx.goCmdSession.deleteMany({ where: { expires_at: { lte: now } } })
      await tx.goCmdSession.create({
        data: { token_hash: sessionHash(token), username: user.username, expires_at: now + SESSION_SECONDS, created_at: sqliteNow() },
      })
      await tx.goCmdAccessAudit.create({
        data: { at: sqliteNow(), actor: user.username, action: "session.login", target: user.username, details_json: "{}" },
      })
    }, { timeout: 20_000, maxWait: 15_000 }))
  } catch (e) {
    if (String((e as { code?: string })?.code ?? "") === "P2021")
      throw new Error("Migration sessions manquante : exécutez scripts/upgrade-admin-session.cjs")
    throw e
  }
  return { token, maxAge: SESSION_SECONDS }
}

export async function revokeSession(token: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token || "")) return false
  const hash = sessionHash(token)
  const row = await db.goCmdSession.findUnique({ where: { token_hash: hash } })
  const deleted = await serializedSQLiteWrite(() => db.$transaction(async (tx) => {
    const r = await tx.goCmdSession.deleteMany({ where: { token_hash: hash } })
    if (row) {
      await tx.goCmdAccessAudit.create({ data: { at: sqliteNow(), actor: row.username, action: "session.logout", target: row.username, details_json: "{}" } })
    }
    return r.count
  }, { timeout: 20_000, maxWait: 15_000 }))
  return deleted > 0
}

/** Journal d'échec d'authentification ; échoue silencieusement comme l'original. */
export async function recordLoginFailure(username: string, reason = "invalid_credentials"): Promise<boolean> {
  try {
    const candidate = typeof username === "string" ? username.trim().toLowerCase() : ""
    const valid = /^[a-z][a-z0-9._-]{2,49}$/.test(candidate)
    const user = valid ? await db.goCmdUser.findFirst({ where: { username: candidate }, select: { username: true } }) : null
    const target = user ? user.username : "unknown-account"
    const safeReason = ["invalid_credentials", "invalid_format", "rate_limited"].includes(reason) ? reason : "invalid_credentials"
    await serializedSQLiteWrite(() => db.goCmdAccessAudit.create({
      data: { at: sqliteNow(), actor: "AUTH", action: "session.login.failed", target, details_json: JSON.stringify({ reason: safeReason }) },
    }))
    return true
  } catch {
    return false
  }
}

export type SensitiveResult = "ok" | "invalid" | "limited" | "unavailable"

/** Confirmation personnelle du directeur (5 échecs / 5 minutes, en base). */
export async function verifySensitivePassword(username: string, password: string, scope: string): Promise<SensitiveResult> {
  if (scope !== "director.prices" || typeof password !== "string" || !password || password.length > 256) return "invalid"
  try {
    return await serializedSQLiteWrite(() => db.$transaction(async (tx) => {
      const row = await tx.goCmdUser.findFirst({ where: { username } })
      if (!row || !row.active || row.is_root || row.must_change_password) return "invalid"
      // Comparaison TEXT ISO : identique au datetime('now','-5 minutes') SQLite.
      const cutoff = new Date(Date.now() - 5 * 60_000).toISOString().slice(0, 19).replace("T", " ")
      const failCount = await tx.goCmdAccessAudit.count({
        where: { actor: row.username, action: "sensitive.confirm.failed", at: { gte: cutoff } },
      })
      if (failCount >= 5) return "limited"
      if (!directory.checkPassword(password, row.salt, row.password_hash)) {
        await tx.goCmdAccessAudit.create({
          data: { at: sqliteNow(), actor: row.username, action: "sensitive.confirm.failed", target: scope, details_json: "{}" },
        })
        return "invalid"
      }
      await tx.goCmdAccessAudit.create({
        data: { at: sqliteNow(), actor: row.username, action: "sensitive.confirm.ok", target: scope, details_json: "{}" },
      })
      return "ok"
    }, { timeout: 20_000, maxWait: 15_000 }))
  } catch {
    return "unavailable"
  }
}

export async function changeOwnPassword(username: string, oldPassword: string, newPassword: string): Promise<{ ok: true }> {
  const row = await db.goCmdUser.findFirst({ where: { username } })
  if (!row || !row.active || !directory.checkPassword(oldPassword, row.salt, row.password_hash))
    throw new Error("Ancien mot de passe incorrect")
  if (oldPassword === newPassword) throw new Error("Le nouveau mot de passe doit être différent")
  const p = directory.hashPassword(newPassword)
  const now = sqliteNow()
  await serializedSQLiteWrite(() => db.$transaction(async (tx) => {
    await tx.goCmdUser.update({
      where: { username: row.username },
      data: { salt: p.salt, password_hash: p.hash, must_change_password: 0, updated_at: now },
    })
    await tx.goCmdSession.deleteMany({ where: { username: row.username } })
    await tx.goCmdAccessAudit.create({
      data: { at: now, actor: row.username, action: "password.change", target: row.username, details_json: "{}" },
    })
  }, { timeout: 20_000, maxWait: 15_000 }))
  return { ok: true }
}

export async function createUser(
  actor: string,
  username: string,
  password: string,
  roles: string[],
  permissions: Record<string, boolean>,
): Promise<{ username: string }> {
  directory.validateIdentity(username)
  const cleanRoles = directory.cleanRoles(roles)
  const cleanPermissions = directory.cleanPermissions(permissions, cleanRoles)
  const p = directory.hashPassword(password)
  const now = sqliteNow()
  try {
    await serializedSQLiteWrite(() => db.$transaction(async (tx) => {
      await tx.goCmdUser.create({
        data: {
          username, salt: p.salt, password_hash: p.hash,
          roles_json: JSON.stringify(cleanRoles), permissions_json: JSON.stringify(cleanPermissions),
          active: 1, is_root: 0, must_change_password: 1, created_at: now, updated_at: now,
        },
      })
      await tx.goCmdAccessAudit.create({
        data: { at: now, actor, action: "user.create", target: username, details_json: JSON.stringify({ roles: cleanRoles, permissions: cleanPermissions }) },
      })
    }, { timeout: 20_000, maxWait: 15_000 }))
  } catch (e) {
    throw mapInfrastructure(e)
  }
  return { username }
}

type UserChanges = { roles?: string[]; permissions?: Record<string, boolean>; active?: boolean; password?: string }

export async function updateUser(actor: string, username: string, changes: UserChanges): Promise<{ username: string }> {
  // Lecture synchrone (node:sqlite, lecture seule en mode serveur) : mêmes
  // règles de normalisation que l'implémentation CLI.
  const row = directory.readUser(username)
  if (!row) throw new Error("Compte introuvable")
  if (row.isRoot && ("roles" in changes || "active" in changes || "permissions" in changes))
    throw new Error("Le compte principal est protégé")
  if (username.toLowerCase() === actor.toLowerCase() && changes.active === false)
    throw new Error("Vous ne pouvez pas désactiver votre propre compte")
  const roles = "roles" in changes ? directory.cleanRoles(changes.roles!) : row.roles
  const perms = "permissions" in changes ? directory.cleanPermissions(changes.permissions!, roles) : directory.cleanPermissions(row.permissions, roles)
  // AUDIT P5.15.27-A (SEC-06) : un booléen strict reste exigé.
  let active = row.active
  if ("active" in changes) {
    if (typeof changes.active !== "boolean") throw new Error("Statut actif invalide : booléen requis")
    active = changes.active
  }
  const passwordReset = "password" in changes
  const p = passwordReset ? directory.hashPassword(changes.password!) : null
  const now = sqliteNow()
  await serializedSQLiteWrite(() => db.$transaction(async (tx) => {
    if (p) {
      await tx.goCmdUser.update({ where: { username: row.username }, data: { salt: p.salt, password_hash: p.hash, must_change_password: 1, updated_at: now } })
    }
    await tx.goCmdUser.update({
      where: { username: row.username },
      data: { roles_json: JSON.stringify(roles), permissions_json: JSON.stringify(perms), active: active ? 1 : 0, updated_at: now },
    })
    // Révoquer les sessions si et seulement si l'original le faisait.
    if (passwordReset || !active || "roles" in changes || "permissions" in changes) {
      await tx.goCmdSession.deleteMany({ where: { username: row.username } })
    }
    await tx.goCmdAccessAudit.create({
      data: { at: now, actor, action: "user.update", target: row.username, details_json: JSON.stringify({ roles, permissions: perms, active, passwordReset }) },
    })
  }, { timeout: 20_000, maxWait: 15_000 }))
  return { username }
}
