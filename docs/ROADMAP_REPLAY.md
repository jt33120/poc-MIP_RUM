# Roadmap — Session Replay

**Statut au 26/09/2026 : livré dans le code, désactivé par défaut.** Le SDK n'enregistre rien tant
que le snippet ne passe pas l'option `replay` (`false` par défaut, `packages/rum-sdk/src/types.ts`).
Quelles applications l'activent en production n'a pas été relevé (base suspendue jusqu'au
01/10/2026). La collecte RUM ordinaire tourne sans bandeau de consentement : aucune adresse IP
stockée, un identifiant de visiteur **pseudonyme** — pas anonyme ([CONFORMITE.md](CONFORMITE.md)) —,
rétention de 30 jours par défaut. Le **session replay** (rejeu visuel d'une session) est plus
intrusif : il ne s'active que **derrière un consentement explicite**.

Dans la console, une session sans enregistrement affiche « Aucun rejeu pour cette session », avec
les causes possibles : session trop courte, signal DNT/GPC, consentement refusé, navigateur sans
`CompressionStream` (`apps/console/components/replay/ReplayPlayer.tsx`).

## Pourquoi différé
- **RGPD/ePrivacy** : rejouer une session dépasse la simple mesure → **consentement requis**
  (contrairement aux vitals et aux erreurs, pseudonymisés et nettoyés côté serveur). On ne veut pas
  de bannière sur la plateforme tant que le replay n'est pas le sujet prioritaire.
- **Priorité produit** : la valeur RUM (vitals, erreurs, tracing, SLO, alertes) est déjà livrée.

## Stack technique

| Étape | Techno | État |
|---|---|---|
| Capture navigateur | **rrweb**, bundle séparé chargé à la demande (`mip-rum-replay.js`, 56,7 Ko gzip mesurés le 26/09/2026) ; saisies toujours masquées (`maskAllInputs`), texte et médias masqués par défaut (`replayMask`, `all`), blocs `mip-rum-block` exclus ; plafonds 2 min / 1 Mo gzip | codé (`packages/rum-sdk/src/replay.ts`) |
| Consentement | SDK `requireConsent` + `MIPRum.consent(true/false)` : collecte tamponnée en mémoire jusqu'à l'accord — **côté réseau seulement** : l'identifiant de session est écrit en stockage local avant l'accord ([CONFORMITE.md](CONFORMITE.md) § 3) | codé ; le bandeau du site suivi est décrit dans `docs/CONSENT_UTI.md`, document client hors dépôt |
| Échantillonnage | option `replay: true \| 0..1` du SDK, dans le snippet. La colonne `app_registry.replay_sample_rate` (migration-v03) existe, mais **aucun code ne la lit** | codé |
| Transport | chunks **gzip** en POST vers `/api/ingest/v1/replay` de la console (Vercel), adresse dérivée de celle des traces ; le `collector` sert `/v1/replay`, mais il n'est pas créé | en service sur Vercel, base suspendue jusqu'au 01/10/2026 |
| Stockage | `replay_chunk.body` en `bytea`, dans Postgres : décision d'y rester jusqu'à un seuil de sortie vers un stockage objet ([ADR-0009](architecture/adr/0009-blobs-en-postgres.md)) | en place |
| Lecture | `/api/replay/[sessionId]` (décompression bornée à 32 Mio, concaténation) → lecteur rrweb dans la console | codé |

## Étapes pour activer (le jour où on le veut)
1. **Consentement front** sur le site suivi (bannière + `requireConsent: true`) — voir
   `docs/CONSENT_UTI.md`, document client hors dépôt ([DOCUMENTS-HORS-DEPOT.md](DOCUMENTS-HORS-DEPOT.md)).
   Corriger d'abord l'écriture de l'identifiant de session avant l'accord ([CONFORMITE.md](CONFORMITE.md) § 3).
2. Snippet : `replay: 0.1` (10 % des sessions consenties). C'est le seul réglage qui active le rejeu.
3. Surveiller le stockage : sur l'offre gratuite de Neon, la base est plafonnée à 0,5 Go, et le rejeu
   est ce qui la remplirait le premier ([ADR-0014](architecture/adr/0014-base-gratuite.md),
   [ADR-0009](architecture/adr/0009-blobs-en-postgres.md) pour le seuil de sortie).
4. Contrôles RGPD : masquage vérifié, rétention, **effacement sur demande** (`erase_session`).

## Coût / impact
- Bundle rrweb chargé **à la demande** (uniquement sessions échantillonnées + consenties) → coût
  navigateur nul pour les autres.
- Le replay est le **principal poste de volume** du stockage : c'est lui qui déclencherait la sortie
  vers un stockage objet avec cycle de vie (ADR-0009).
