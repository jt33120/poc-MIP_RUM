# Relais de l'API de lecture v1 — mode d'emploi

> La console transmet les **lectures au jeton machine** de l'API v1 au service `api` de Railway, pour un pourcentage réglé en base. Code : `apps/console/lib/api-relay.ts` ; service : [services/api/README.md](../../services/api/README.md) ; décision : [ADR-0005](../architecture/adr/0005-relais-ingestion.md), même mécanique que la collecte.

## Ce qui part au service, et ce qui reste à la console

| Requête | Où |
|---|---|
| `GET`/`HEAD` `/api/v1/…` avec `Authorization: Bearer <jeton>` | tirée au sort → service `api` |
| `POST /api/v1/explorer/query` avec un jeton | tirée au sort → service `api` |
| toute requête au **cookie de session** (les écrans de la console) | **console**, toujours : le service n'accepte pas les sessions |
| toute écriture (triage, commentaires, liens, tickets, vues, marqueurs) | **console**, toujours |
| `OPTIONS` (préflight, sans jeton) | console |

Transmis : `authorization`, `accept`, `content-type`, `if-none-match`, `origin`, `x-request-id`. Jamais le cookie, jamais l'adresse du client.

## Prérequis, dans l'ordre

1. Le service `api` déployé, domaine généré, `/health` à 200.
2. `CONSOLE_API_TOKENS` et `CONSOLE_API_ALLOWED_ORIGINS` **identiques** sur la console et sur le service (variables partagées Railway) : c'est le service qui authentifie une lecture relayée.
3. Le contrat de parité vert (`tests/contract/api-parity.test.ts`, en CI).
4. **Conformité** : avant la première montée, les textes légaux disent que Railway sert aussi l'API de lecture (`lib/legal.ts`, `docs/CONFORMITE.md` § 7).
5. Sur Vercel : `CONSOLE_API_RELAY_URL=https://<domaine du service api>`.

## Monter, couper

```sql
-- monter : 10 % pendant une journée, puis 50 %, puis 100 %
insert into platform_flag (key, value, updated_by) values ('api_relay_pct', '10', '<qui>')
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by;

-- COUPER (effectif en 30 s, le cache de chaque instance) :
update platform_flag set value = '0', updated_by = '<qui>' where key = 'api_relay_pct';
```

## Ce qui déclenche le repli local

Une lecture se rejoue sans risque : **tout échec retombe sur la console**, sans rien dire au client.

- réponse **non signée** (sans `x-mip-api: 1`) : le routeur Railway, service absent ;
- **5xx** du service, **délai de 8 s**, erreur réseau.

Une réponse signée sous 500 — 200, 304, et les refus 400, 401, 403, 404 identiques à ceux de la console — est rendue telle quelle. **Disjoncteur par instance** : 5 échecs en 30 s coupent le relais 60 s.

## Surveiller

- `api_requests_total{route,status}` sur `/metrics` du service ;
- les journaux Vercel des routes `/api/v1/*` : une hausse de latence locale après une montée signale des replis.
