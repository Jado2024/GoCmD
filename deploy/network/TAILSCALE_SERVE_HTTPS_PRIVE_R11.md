# GoCmd / SODEPI — Accès HTTPS privé (proposition R11, NON DÉPLOYÉE)

## Architecture retenue pour recette sur Windows

- GoCmd écoute seulement sur `127.0.0.1:3000` au moyen du lanceur vérifié.
- Tailscale **Serve**, pas Funnel, présente une URL HTTPS privée aux appareils autorisés du tailnet.
- GoCmd conserve sa propre authentification nominative, RBAC, CSRF/origine et journaux.
- Aucune ouverture du port GoCmd vers Internet; aucune exposition de SQLite, ni de l'interface Next directement.
- Les droits Tailscale par groupe/appareil (ACL/grants) sont à configurer, vérifier et documenter sur site.

## Paramètres à définir sur l'hôte Windows (configuration de principe)

- `GOCMD_PUBLIC_ORIGIN=https://nom-machine.nom-tailnet.ts.net` (URL **réelle** délivrée par Tailscale, sans slash final dans le fichier `.env`).
- `GOCMD_TRUST_PROXY=0` pour ne PAS accepter les `X-Forwarded-*` des clients.
- `HOSTNAME=127.0.0.1`, `PORT=3000`, `GOCMD_REQUIRE_SQLITE_USERS=1`.
- `GOCMD_ALLOW_DEMO_DB=0` pour la vraie installation. Ne pas réutiliser la BDD de démonstration.
- Pré-vol : `node scripts/check-private-https-r11.cjs --enforce`.

## Mise en place — uniquement sur environnement SODEPI autorisé

1. Enregistrer le serveur et les terminaux dans le tailnet géré par SODEPI; activer MagicDNS et HTTPS (Tailscale publie les noms des certificats dans les journaux CT : ne pas inclure de secrets dans le nom de machine).
2. Définir les règles d'accès restrictives par identité/appareil ; contrôler le refus pour un utilisateur non autorisé.
3. Dans un terminal Windows administrateur, configurer **Tailscale Serve** vers le seul backend de boucle locale (`tailscale serve --bg 3000` sur les versions prenant en charge cette syntaxe). Vérifier la syntaxe sur la version réellement installée.
4. Utiliser le domaine HTTPS fourni (et non `http://localhost`) comme `GOCMD_PUBLIC_ORIGIN`; démarrer le service GoCmd avec le lanceur contrôlé.
5. Vérifier les cookies Secure/HttpOnly/SameSite, les 401/403, les refus d'origine sur écritures, les règles RBAC, la révocation de sessions, et l'absence de réponse via une interface réseau directe.
6. Tester l'accès du PC, des tablettes et d'un appareil distant autorisé ; tester le refus de l'appareil non autorisé, la déconnexion, l'expiration de session, la panne réseau et la reprise.
7. Conserver les logs expurgés (aucun cookie, token ou mot de passe). Faire valider la configuration Windows et l'infrastructure SODEPI.

**Important :** la validation du script ne prouve pas que TLS, le pare-feu et les ACL sont opérationnels. Cette recette nécessite l'hôte réel. **Ne pas utiliser Tailscale Funnel** pour cette installation privée.

Documentation officielle :
- https://tailscale.com/docs/features/tailscale-serve
- https://tailscale.com/docs/how-to/set-up-https-certificates
- https://tailscale.com/docs/secure-networks

---

## Compléments R13.3 (mission §9) — contrôles d'exploitation à recetter sur site

Les points suivants complètent la proposition R11 ; aucun n'est validé sans
tailnet réel (statut EXTERNAL VALIDATION, jamais PASS sans test TLS effectif).

1. **Installation du client** : `winget install Tailscale.Tailscale` puis
   connexion du serveur et de chaque appareil autorisé au tailnet SODEPI.
   Vérifier : `tailscale status` liste uniquement les appareils autorisés.
2. **Authentification des appareils** : clé d'authentification du tailnet,
   expiration et approbation des nœuds configurés dans la console SODEPI.
3. **Accès privé uniquement** : `tailscale serve --bg 3000` (syntaxe selon
   version) ; vérifier que `https://<machine>.<tailnet>.ts.net` répond et que
   `http://<ip-locale>:3000` reste refusé hors LocalSubnet.
4. **Origine applicative** : `GOCMD_PUBLIC_ORIGIN=https://<machine>.<tailnet>.ts.net`
   (le starter vérifié force ensuite le mode serveur mono-moteur R13.3).
5. **Cookies** : avec HTTPS, le cookie `gocmd_session` est émis Secure +
   HttpOnly + SameSite=Lax ; la protection CSRF d'origine (refus des origines
   tierces sur les mutations) reste active. Contrôler dans le navigateur.
6. **Révocation d'un utilisateur** : désactiver le compte GoCmd (admin) —
   sessions révoquées immédiatement (test : l'onglet ouvert renvoie 401).
7. **Révocation d'un appareil** : retirer le nœud dans la console Tailscale —
   l'accès HTTPS doit cesser immédiatement ; GoCmd garde ses propres sessions
   en base (défense en profondeur).
8. **Journalisation** : les journaux GoCmd (`logs/`) ne contiennent ni cookie
   ni mot de passe ; les journaux Tailscale (console) notent les connexions
   par appareil — à conserver selon la politique SODEPI.
9. **Interdits** : pas de Funnel, pas de port 3000 exposé sur Internet, pas de
   X-Forwarded-* approuvé hors reverse proxy verrouillé (`GOCMD_TRUST_PROXY=0`
   par défaut).
