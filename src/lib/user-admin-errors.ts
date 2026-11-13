/** Audit 10/11/2026 (SEC-ERR-01) : les routes /api/me/password et
 * /api/admin/users réémettaient e.message tel quel. Les erreurs métier du
 * répertoire utilisateurs sont des messages français contrôlés ; toute
 * autre erreur (SQLite verrouillée, node:sqlite, chemin de fichier…) doit
 * être remplacée par un libellé générique — jamais de SQL, de chemin ni de
 * détail d'infrastructure au client. Liste BLANCHE stricte de préfixes. */
const KNOWN_USER_ERRORS: readonly string[] = [
  "Mot de passe requis : 16 à 256 caractères",
  "Identifiant : 3 à 50 caractères",
  "Au moins un rôle connu est requis",
  "Autorisations invalides",
  "Permission inconnue : ",
  "Attribuer le rôle associé avant cette permission",
  "Base SQLite introuvable",
  "Un administrateur existe déjà",
  "Gestion des comptes non initialisée",
  "Gestion non initialisée",
  "Comptes non initialisés",
  "Compte introuvable",
  "Compte désactivé",
  "Le compte principal est protégé",
  "Vous ne pouvez pas désactiver votre propre compte",
  "Ancien mot de passe incorrect",
  "Le nouveau mot de passe doit être différent",
  "Un compte principal unique est requis",
  "Migration sessions manquante",
  "Base indisponible",
]

/** Retourne le message métier s'il figure dans la liste blanche, sinon un
 * libellé générique. La violation d'unicité SQLite (username) est traduite
 * côté appelant ; ici on ne laisse passer AUCUN texte technique. */
export function safeUserDirectoryMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ""
  if (!message) return "Opération refusée"
  if (message.length > 200) return "Opération refusée"
  if (/SQLITE|Prisma|node:|[/\\]|\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|Error:/i.test(message))
    return "Opération refusée"
  if (KNOWN_USER_ERRORS.some(prefix => message.startsWith(prefix))) return message
  return "Opération refusée"
}
