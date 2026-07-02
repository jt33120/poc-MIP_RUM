# Roadmap — Session Replay (à venir)

**Statut : non activé en production.** Le déploiement actuel garde la collecte RUM **anonyme
et sans consentement** (mesure d'audience/performance exemptée : pas d'IP stockée, pseudonyme,
usage interne, rétention 30 j). Le **session replay** (rejeu visuel d'une session) est plus
intrusif → il sera activé **derrière un consentement explicite**, dans un second temps.

Dans la console, l'onglet **Replay** d'une session affiche cet état « à venir » tant qu'aucun
enregistrement n'existe.

## Pourquoi différé
- **RGPD/ePrivacy** : rejouer une session dépasse la simple mesure → **consentement requis**
  (contrairement aux vitals/erreurs anonymisés). On ne veut pas de bannière sur la plateforme
  tant que le replay n'est pas le sujet prioritaire.
- **Priorité produit** : la valeur RUM (vitals, erreurs, tracing, SLO, alertes) est déjà livrée.

## Stack technique (déjà en place / cible)

| Étape | Techno | État |
|---|---|---|
| Capture navigateur | **rrweb** (bundle lazy ~45 ko gzip), `maskAllInputs`, exclusion des blocs `mip-rum-block`, caps 2 min / 1 Mo | ✅ codé (SDK) |
| Consentement | SDK `requireConsent` + `MIPRum.consent(true/false)` (buffer mémoire jusqu'à l'accord) | ✅ codé — cf. `docs/CONSENT_UTI.md` |
| Échantillonnage | option `replay: 0..1` (SDK) + `app_registry.replay_sample_rate` (registre) | ✅ codé |
| Transport | chunks **gzip** POST → edge function `/v1/replay` (Deno) | ✅ déployée |
| Stockage | `replay_chunk.body` en **bytea** (POC) → **object storage** (S3/R2) en cible, cycle de vie TTL 30 j | 🟠 bytea OK ; object storage = cible |
| Lecture | `/api/replay/[sessionId]` (gunzip + concat) → `rrweb-player` dans la console | ✅ codé |

## Étapes pour activer (le jour où on le veut)
1. **Consentement front** sur le site suivi (bannière + `requireConsent:true`) — voir `docs/CONSENT_UTI.md`.
2. Snippet : `replay: 0.1` (10 % des sessions consenties).
3. Registre : `update app_registry set replay_sample_rate = 0.1 where app_id = '<app>'`.
4. **Cible scale** : basculer le stockage `bytea` → object storage + règle de cycle de vie (TTL 30 j).
5. Contrôles RGPD : masquage vérifié, rétention, **effacement sur demande** (`erase_session`).

## Coût / impact
- Bundle rrweb chargé **à la demande** (uniquement sessions échantillonnées + consenties) → coût
  navigateur nul pour les autres.
- Le replay est le **principal poste de volume** → object storage + TTL court le maîtrisent ;
  raison pour laquelle il n'est pas laissé en base au-delà du POC.
