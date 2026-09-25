# Bascule de la console vers console-api — mode d'emploi

> Les écrans, la coquille et les écritures de la console passent par `console-api`, **session par session**, pour une part réglée en base. Code : `apps/console/lib/aiguillage-console-api.ts` (qui sert), `lib/ecran.ts` (les écrans), `lib/coquille-ecran.ts` (la coquille), `lib/commande.ts` (les écritures) ; service : [services/console-api/README.md](../../services/console-api/README.md) ; architecture : [docs/architecture/console-api/README.md](../architecture/console-api/README.md) (« La bascule »).

## Qui sert quoi

| Session | Écrans et coquille | Écritures |
|---|---|---|
| aucune | console (le chargeur rend `sans_session`, la page renvoie à `/login`) | console (refus « session requise ») |
| **HS256** (signée par la console, `AUTH_SECRET`) | **console**, toujours : le service ne la connaît pas | **console**, toujours |
| **ES256** (ouverte par `console-api`, C1) | tirée au sort → `console-api` (`console_api_ecrans_pct`) | tirée au sort → `console-api` (`console_api_commandes_pct`) |

Le tirage est **stable par session** : le seau est l'empreinte de l'identifiant de session. 10 % = un dixième des sessions, toujours les mêmes ; une session ne passe pas d'un chemin à l'autre d'un rendu au suivant.

Les routes que le navigateur appelle et qui lisent par un chargeur suivent les écrans : `/api/releases` (barre de filtres), `/api/dashboards/[id]/export` (CSV), `/api/replay/[sessionId]` (lecteur de rejeu).

## Prérequis, dans l'ordre

1. `console-api` déployé, domaine généré, `/health` à 200 ; les trois variables Vercel de C0b posées (`CONSOLE_API_URL`, `CONSOLE_API_CLIENT_SECRET`, `SESSION_PUBLIC_JWKS`) — la connexion passe alors par le service (C1) et les nouvelles sessions sont ES256.
2. **Conformité** : les textes légaux disent que Railway sert aussi `console-api` (identité, écrans, écritures) — `lib/legal.ts`, `docs/CONFORMITE.md` § 7.
3. Vérifier à la main : se connecter, ouvrir trois écrans et un panneau, se déconnecter (drapeaux à 0 : c'est encore la console qui sert).

## Monter, couper

```sql
-- LES LECTURES D'ABORD : 10 % une journée, puis 50 %, puis 100 %
insert into platform_flag (key, value, updated_by) values ('console_api_ecrans_pct', '10', '<qui>')
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by;

-- LES ÉCRITURES ENSUITE, quand les lectures sont à 100 % sans écart au journal
insert into platform_flag (key, value, updated_by) values ('console_api_commandes_pct', '10', '<qui>')
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by;

-- COUPER (effectif en 30 s, le cache de chaque instance) :
update platform_flag set value = '0', updated_by = '<qui>' where key in ('console_api_ecrans_pct', 'console_api_commandes_pct');
```

Défauts d'environnement, quand la base ne répond pas : `CONSOLE_API_ECRANS_PCT`, `CONSOLE_API_COMMANDES_PCT` (0 s'ils sont absents — les laisser absents en production).

## Ce qui se passe quand le service échoue

**Une lecture** se rejoue sans risque :

- **échec de transport** (injoignable, réponse non signée, 5xx, échéance) : la console sert l'écran elle-même, et l'échec est compté ;
- **refus avant le chargeur** (session, rôle, périmètre, paramètres) : la console sert aussi — son chargeur rend la décision que l'écran sait afficher — et le journal le dit (`console-api refuse ce que la console sert : écart à corriger avant le mode strict`). **Chacune de ces lignes est un écart à comprendre avant le mode strict** ;
- **refus de filtre** (`filtre_non_supporte`) : relevé tel que le chargeur l'aurait levé, l'écran le traite comme avant.

**Une écriture ne se rejoue pas.** Seul un échec où rien n'est parti (service non branché, poignée de main refusée) laisse la console écrire à sa place. Tout autre échec — réseau, 5xx, échéance, débit — a une issue **inconnue** (la commande a peut-être écrit) : l'action affiche l'écran d'erreur avec la référence de la requête (`réf. …`), à retrouver dans les journaux du service.

**Disjoncteur par instance et par famille** : 5 échecs de transport en 30 s → la console sert seule pendant 60 s (`disjoncteur ouvert` au journal).

## Le mode strict — la répétition générale de C12

Quand les deux drapeaux tiennent à 100 % **sans aucun écart au journal** pendant au moins 7 jours, et **après le retrait d'`AUTH_SECRET`** (plus aucune session HS256) :

- sur Vercel `CONSOLE_API_STRICT=1`, redéployer ;
- toute session est servie par le service : tirage et disjoncteur ignorés, **aucun échec ne retombe sur la base** ;
- une page suit la porte du middleware sur un refus (`/login`, l'accueil, `/select`) ; toute autre panne est un écran d'erreur avec la référence ; la coquille s'affiche « Partiel » plutôt que de tomber.

Retour arrière : retirer la variable, redéployer. C'est le mode dans lequel tourne l'E2E (`playwright.config.ts`). Après un rodage en mode strict, la décommission (C12) retire le chemin local et la base de Vercel.

## Surveiller

- `console_api_requests_total{operation,status}` sur `/metrics` du service : les opérations `screens.*`, `console.shell`, `replay.session`, `dashboards.export` pour les lectures, les autres pour les écritures ;
- journaux Vercel, services `ecran` et `commande` : `console-api en échec`, `écart à corriger`, `n'a rien reçu` ; service `aiguillage-console-api` : `disjoncteur ouvert` ;
- un écran d'erreur avec `réf. …` : la même référence dans les journaux de `console-api`.
