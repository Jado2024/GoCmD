# GoCmd / SODEPI — Réseau local d'exploitation (R13.3)

Architecture cible : PC serveur Windows dédié sur le réseau local SODEPI,
postes et tablettes en navigateur. **Le fichier SQLite n'est jamais partagé ni
accessible sur le réseau** : seules les réponses HTTP de l'unique instance
GoCmd quittent le serveur.

## Adresse IP locale stable

- Réserver l'adresse du serveur dans le DHCP du routeur SODEPI (bail statique
  sur l'adresse MAC), ou fixer l'IP en statique :
  ```powershell
  New-NetIPAddress -InterfaceAlias 'Ethernet' -IPAddress 192.168.1.10 `
    -PrefixLength 24 -DefaultGateway 192.168.1.1
  ```
- Noter l'adresse retenue dans le registre d'exploitation SODEPI ; tous les
  postes utilisent `http://<ip-serveur>:3000`.

## Pare-feu Windows et ports

| Port | Sens | Source | Usage |
| --- | --- | --- | --- |
| 3000/TCP | entrée | LocalSubnet uniquement | GoCmd (interface HTTP) |
| 41641/UDP | entrée | tailnet Tailscale (si validé) | coordination Tailscale |

- `New-NetFirewallRule` : voir `deploy/windows/PROCEDURE_R13_3.md §1`.
- Aucune règle entrante vers le port 3000 depuis Internet. Tailscale Funnel
  est interdit sans autorisation explicite (voir `TAILSCALE_SERVE_HTTPS_PRIVE_R11.md`).

## Accès navigateur (postes et tablettes Wi-Fi)

1. Ouvrir `http://<ip-serveur>:3000` dans le navigateur (Edge/Chrome/Safari
   récents ; les tablettes Android et iPad sont prises en charge).
2. Se connecter avec son compte nominatif GoCmd ; session 8 h, cookie
   HttpOnly. Aucune installation locale, aucun accès aux fichiers du serveur.
3. Créer une icône/raccourci sur l'écran d'accueil des tablettes.

## Contrôle des appareils autorisés

- Le serveur n'expose pas de port vers Internet ; l'accès est de fait limité
  au réseau local SODEPI (filaire + Wi-Fi interne).
- Appareils autorisés : tenir une liste nominative (poste, tablette,
  responsable) côté SODEPI ; retirer du Wi-Fi tout appareil sortant du parc.
- Si Tailscale est activé : ACL par identité/appareil dans la console
  d'administration du tailnet (voir la procédure Tailscale).

## Résilience en cas de coupure Wi-Fi/réseau

- Une coupure réseau interrompt la requête HTTP en cours : l'utilisateur voit
  une erreur navigateur ; **aucune écriture partielle** — chaque écriture
  GoCmd est une transaction SQLite atomique (journal DELETE) validée ou
  annulée intégralement.
- Les commandes en cours de saisie non envoyées restent dans le formulaire du
  navigateur ; après reconnexion, actualiser la page et vérifier la liste.
- Comportement à recetter sur site : couper le Wi-Fi d'une tablette pendant
  l'envoi d'une commande, reconnecter, contrôler l'absence de doublon (la
  détection de doublons + clé d'idempotence `Idempotency-Key` protègent le
  rejeu ; sans clé, deux envois identiques successifs sont signalés comme
  doublons potentiels par l'API — 409 avec jeton de confirmation).
- Le serveur continue de fonctionner localement ; les sessions actives
  restent valides (elles sont en base, pas dans la mémoire du navigateur).

## Perte du réseau PENDANT une opération sensible (paiement, livraison)

Les opérations financières (paiement, avoir) sont idempotentes côté serveur
par leur logique de solde : un rejeu après coupure est refusé s'il dépasse le
solde. Après toute coupure pendant une opération financière, l'opérateur doit
vérifier le document (facture réglée ? BL émis ?) AVANT de rejouer —
comportement déjà recetté en R13.2 (campagne C7, sémantique 503/409).
