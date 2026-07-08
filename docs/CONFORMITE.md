# Dossier de conformité — MIP RUM (P0 #4)

> Pièce destinée aux **grilles de notation d'AO grand compte** et aux **DPO**. Décrit
> ce qui est **en place** (vérifiable dans le code/la base) et la **trajectoire** de
> certification. Souveraineté et RGPD *by design* sont des choix d'architecture, pas
> des promesses. Modèle de contrat : [`docs/DPA.md`](DPA.md).

## 1. Résidence des données 🇪🇺
- Base **PostgreSQL (Supabase) en région `eu-west-3` (Paris)**. Aucune donnée hors UE.
- Console **Next.js** déployable en UE ; le SDK est servi par la console (auto-hébergeable).
- Le jour de la bascule **ClickHouse**, l'hébergement reste **souverain** (auto-géré
  Scaleway/OVH/Clever Cloud ou on-prem — cf. `infra/clickhouse/DEPLOY.md`).
- Le **flux OTLP** va du navigateur directement à l'ingestion MIP : pas d'intermédiaire US.

## 2. Données collectées & classification (minimisation)
| Donnée | Nature | Mesure de protection |
|---|---|---|
| Core Web Vitals, timings, longtasks | technique, non personnelle | — |
| Route / URL | technique | **query string & fragment retirés**, scrub PII du chemin |
| Erreurs (message, stack) | technique, **PII possible** | **scrub serveur** (`_shared/scrub.mjs`) avant écriture |
| Événements `track.*` | défini par le client | scrub récursif des `props` |
| Adresse IP | **jamais stockée** | géolocalisation **par timezone** (`mip.tz`) → pays seulement |
| Identifiant utilisateur | pseudonyme | `user_hash` **anonymisé** côté client (pas de PII) |
| Session replay (opt-in) | rejouée | **masquage des saisies par défaut**, opt-in par app, consent requis |

**Défense en profondeur PII** : `beforeSend` côté client **+** scrub côté serveur (parité
dev-server/edge) → on ne dépend pas du seul client. Source maps **privées** (jamais servies).

## 3. RGPD *by design*
- **Consentement** : `requireConsent` met le SDK en tampon mémoire jusqu'à `MIPRum.consent(true)`.
- **Opt-out navigateur honoré** : `honorDNT` (défaut `true`) respecte **Do Not Track** et **Global Privacy Control** — signal présent → aucune collecte (0 session, 0 requête).
- **Minimisation** : pas d'IP, géo au pays, hash utilisateur anonyme, scrub systématique.
- **Sécurité du transport** : TLS de bout en bout (CA Supabase épinglée côté console).

## 4. Rétention — **configurable par client** (migration-v14)
- `purge_rum_tenants(default_days)` purge **chaque app selon SA rétention**
  (`app_registry.retention_days`, sinon défaut **30 j**), planifié quotidiennement (pg_cron).
- ClickHouse (le jour J) : **TTL 30 j** natif sur les tables brutes (les agrégats horaires
  sans PII peuvent être conservés plus longtemps).
- Vérifié sur Postgres réel : `scripts/verify-conformite.mjs` (rétention par tenant honorée).

## 5. Droits des personnes (art. 15–17)
- **Effacement client / offboarding** : `erase_app_data(app_id)` supprime **toute** la
  télémétrie d'un client (sessions, erreurs, métriques, replay, source maps, alertes).
- **Effacement d'une personne concernée** : `erase_session(session_id)`.
- **Accès / portabilité** : export via l'API de lecture (agrégats) / requêtes ciblées.
- `audit_log` et `console_user` (comptes/traçabilité) ne sont **pas** effacés par ces
  fonctions — conformité et sécurité priment. Vérifié : `scripts/verify-conformite.mjs`.

## 6. Sécurité
- **RLS** activé sur toutes les tables `public` (API PostgREST fermée) ; secrets hashés
  (`password_hash` bcrypt, clés d'API sha256) ; fonctions `SECURITY DEFINER` `search_path` figé.
- **Authentification** : JWT cookie httpOnly + **SSO/OIDC** (Azure AD/Okta/Keycloak — MFA
  déléguée à l'IdP) + **RBAC** admin/viewer scopé par app. Secrets via **coffre** (Vault).
- **Ingestion durcie** : 400/500 distincts, limites de taille (413), retries transitoires,
  rate limiting durable, logs structurés avec **redaction des secrets**.
- **Cloisonnement multi-tenant** : scoping `app_id` + RBAC (renforcement P0 #5 à venir).

## 7. Sous-traitants (registre)
| Sous-traitant | Rôle | Localisation | Donnée |
|---|---|---|---|
| Supabase | base PostgreSQL managée | UE (`eu-west-3`) | télémétrie |
| Vercel | hébergement console (option) | configurable UE | aucune donnée RUM stockée (rendu) |
| Mistral / Anthropic | assistant d'intégration **optionnel** | UE (Mistral) / US | **désactivé par défaut** ; n'envoie aucune donnée RUM client |

## 8. Trajectoire de certification (gap analysis)
| Cible | En place | Reste à faire |
|---|---|---|
| **ISO 27001** | RLS, RBAC/SSO, chiffrement transport, journalisation, rétention, gestion des secrets | SMSI formalisé, analyse de risques, politiques documentées, audit externe |
| **SecNumCloud / SecNumCloud-ready** | hébergement souverain possible, OTel sans lock-in, pas d'IP | qualification de l'hébergeur, dossier ANSSI, PCA/PRA |
| **HDS** (si données de santé) | UE, chiffrement, traçabilité | hébergeur **certifié HDS**, contrat HDS |

> Aucune certification n'est **acquise** à ce stade (POC→MVP) : la trajectoire est
> documentée, l'architecture ne présente pas de blocage de principe (souveraineté,
> minimisation, auditabilité sont déjà là). Les certifications relèvent d'une **décision
> de direction** (budget, calendrier 12–18 mois).

## 9. Journalisation & violation
- `audit_log` trace les actions sensibles (login, gestion utilisateurs/clients, règles).
- **Notification de violation** : engagement contractuel (DPA) à notifier sous **72 h**.

---
*Ce dossier est tenu à jour avec le code. Capacités techniques vérifiables :
`scripts/verify-conformite.mjs` (rétention par tenant + effacement, prouvés sur Postgres réel).*
