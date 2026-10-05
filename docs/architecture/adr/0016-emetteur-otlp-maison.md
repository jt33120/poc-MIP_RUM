# ADR-0016 — Le SDK web émet l'OTLP lui-même, sans les paquets OpenTelemetry

- **Statut** : proposée à l'équipe (05/10/2026), conformité contrôlée le jour même ; en œuvre depuis le 15/07/2026 (commit `2b193107`)
- **Date** : 2026-10-05
- **Portée** : SDK web (`packages/rum-sdk`), extension, ingestion

## Contexte

Le SDK web mesure dans le navigateur des visiteurs et envoie ses mesures au format
OTLP, le format de transport d'OpenTelemetry. Jusqu'au 15/07/2026, il embarquait pour
cela le SDK OpenTelemetry officiel pour navigateur (`@opentelemetry/api`, `core`,
`resources`, `sdk-trace-web`, `exporter-trace-otlp-http`). Ces cinq paquets pesaient
environ 64 % du cœur du SDK.

Un outil de performance se charge sur chaque page du site qu'il surveille : son poids
ralentit ce qu'il mesure.

## Décision

Le SDK écrit lui-même son enveloppe OTLP/HTTP JSON (`packages/rum-sdk/src/otlp-encode.ts`)
et l'envoie lui-même (`packages/rum-sdk/src/otel.ts`) : regroupement par 64, envoi à la
fermeture ou au masquage de la page, file de réessai. Le format sur le fil est
inchangé.

La **mesure** ne change pas : elle vient des interfaces du navigateur et de la
bibliothèque `web-vitals` de Google. Seule l'**enveloppe** est écrite par MIP.

Le choix est **réversible** : l'émetteur a gardé l'interface des paquets officiels
(`initOtel` rend un traceur, `startSpan` / `setAttributes` / `end`, `forceFlush`).
Revenir aux bibliothèques officielles ne toucherait que `otel.ts` et `otlp-encode.ts`,
pas les capteurs.

## Ce que ça apporte

- Le cœur du SDK est passé de 27,4 à 11,7 Ko compressés (−57 %) le 15/07/2026. Il pèse
  environ 23 Ko compressés le 05/10/2026, après l'ajout de nouveaux signaux.
- Les SDK navigateur du marché (Datadog, Sentry) ne reposent pas non plus sur le SDK
  OpenTelemetry.

## Ce que ça coûte

- **Suivre la norme à la main.** Les conventions de nommage d'OpenTelemetry évoluent ;
  le SDK les suit à la main. Exemple : les attributs HTTP stables
  (`http.request.method`, `url.full`, `http.response.status_code`) ajoutés le
  01/10/2026 (`conventionsHttp`, `otel.ts`).
- **Pas d'API OpenTelemetry dans la page.** Une bibliothèque du site instrumentée avec
  `@opentelemetry/api` n'a pas ses spans recueillis par le SDK.
- **Pas d'instrumentations officielles.** Chargement de page, `fetch`, XHR, interactions,
  tâches longues : chacun est réécrit dans le SDK (`navtiming.ts`, `apispans.ts`,
  `actions.ts`, `longtasks.ts`).
- **Un seul format.** OTLP/HTTP JSON, traces seulement (erreurs et vitals sont des
  spans) ; pas de protobuf, pas de signal de logs depuis le navigateur.

## Conformité : deux contrôles extérieurs à MIP (05/10/2026)

- `tests/unit/otlp-conformite-officielle.test.ts` : pour un même lot, la sortie du SDK et
  celle du sérialiseur officiel (`@opentelemetry/otlp-transformer`) sont le même message
  OTLP, champ par champ ; aucun champ du SDK n'est inconnu de l'officiel ; et l'ingestion
  de MIP lit la sortie du SDK comme le protobuf officiel du même lot. Seul écart permis :
  le SDK n'écrit pas `flags` (absent, il vaut « inconnu » selon la spec).
- `tests/unit/otlp-collecteur-officiel.test.ts`, en CI (étape « Conformité OTLP ») : la
  sortie du SDK est envoyée au collecteur OpenTelemetry officiel (0.161.0), qui l'accepte
  sans rejet ; ce qu'il en réécrit est ce que le SDK a envoyé.

Les deux contrôles échouent si l'on casse l'émetteur (essayé : identifiants en base64,
attributs entiers en chaîne, champ renommé).

## Reste à faire

- Relire les conventions sémantiques d'OpenTelemetry à chaque version mineure du SDK.

## Écarté

- **Garder le SDK OpenTelemetry officiel** : la conformité suivrait la norme sans effort,
  au prix d'un SDK deux fois plus lourd sur chaque page des clients.
