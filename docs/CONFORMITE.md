# Dossier de conformité — MIP RUM (P0 #4)

> Pièce destinée aux **grilles de notation d'AO grand compte** et aux **DPO**. Décrit
> ce qui est **en place** (vérifiable dans le code/la base) et la **trajectoire** de
> certification. Souveraineté et RGPD *by design* sont des choix d'architecture, pas
> des promesses. Modèle de contrat : [`docs/DPA.md`](DPA.md).

## 1. Résidence des données 🇪🇺

> Ces trois lignes sont le reflet de `apps/console/lib/legal.ts` (constantes `HOSTS` et
> `SUBPROCESSORS`), qui alimente `/legal/mentions` et `/legal/dpa`. `tests/unit/conformite.test.ts`
> refuse qu'elles divergent : ce document a déclaré **Supabase / `eu-west-3` (Paris)** pendant des
> semaines après la migration vers Neon, et omis Railway alors que ce sous-traitant reçoit les
> mesures. Une pièce d'appel d'offres périmée n'est pas une coquille, c'est une déclaration
> inexacte et opposable.

- Base **PostgreSQL (Neon)** sur infrastructure AWS, région **`aws-eu-central-1` (Francfort)**.
- Console **Next.js** sur **Vercel**, fonctions serveur en région **`fra1` (Francfort)** ;
  le SDK est servi par la console (auto-hébergeable).
- Services backend — réception des mesures, travaux planifiés, serveur MCP — sur **Railway**,
  région **`europe-west4` (Amsterdam)**.
- **Donnée et traitement sont en UE. La souveraineté, non** : Neon, Vercel et Railway sont trois
  sociétés de droit américain. La résidence européenne des données n'est pas la souveraineté ;
  la cible reste un hébergeur de droit européen (cf. §8).
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
| Adresse IP | **jamais stockée** | pays déduit du **fuseau horaire** (`mip.tz`) ; à défaut, de l'**en-tête pays posé par le CDN** (`x-vercel-ip-country`, `cf-ipcountry`) quand il y en a un devant — la résolution IP→pays a alors lieu chez le CDN, aucune IP ne transite ni n'est stockée côté MIP |
| Identifiant de visiteur | **pseudonyme** | `visitor_id` : tirage ALÉATOIRE du SDK (UUID v4), persisté dans le stockage local du navigateur, sans lien avec le terminal ni avec un compte. Effaçable par le visiteur en vidant le stockage local. Reste une donnée à caractère personnel au sens du RGPD — un pseudonyme, pas une donnée anonyme |
| `user_hash` (héritage, ≤ 09/09/2026) | **ni anonyme, ni identifiant de personne** | Ancienne empreinte dérivée du user-agent, de la langue, de la résolution et du décalage horaire, sans aléa : sur un parc homogène, plusieurs personnes partagent la même valeur. Le SDK ne l'émet plus. Un export ou un effacement RGPD **refuse** de s'exécuter dessus (`id_kind = 'device_class'`), parce qu'il porterait sur les données de tiers. Ces lignes s'éteignent à l'échéance de rétention (30 j). Voir `apps/ingest/sql/migration-v57.sql` |
| Session replay (opt-in) | rejouée | **masquage par défaut des saisies, du texte et des médias** (réglable par app via `replayMask`), opt-in par app, consent requis |

**Défense en profondeur PII** : `beforeSend` côté client **+** scrub côté serveur (parité
dev-server/edge) → on ne dépend pas du seul client. Source maps **privées** (jamais servies).

## 3. RGPD *by design*
- **Consentement** : `requireConsent` met le SDK en tampon mémoire jusqu'à `MIPRum.consent(true)` —
  **côté réseau uniquement**. L'identifiant de session est aujourd'hui écrit dans le stockage local
  *avant* la barrière de consentement, et n'est pas purgé au refus (finding 1.11 de l'audit) : à
  corriger avant tout déploiement soumis à recueil de consentement.
- **Opt-out navigateur honoré** : `honorDNT` (défaut `true`) respecte **Do Not Track** et **Global Privacy Control** — signal présent → aucune collecte (0 session, 0 requête).
- **DSAR** (`/admin/privacy`, admin only) : droit d'**accès/portabilité** (export JSON par `visitor_id`,
  une clé par table) et droit à l'**effacement** (suppression transactionnelle, enfants avant l'ancre
  `rum_session`). Les deux **refusent** de s'exécuter sur une ligne `id_kind = 'device_class'`, avec un
  motif explicite : répondre partiellement à une demande art. 15 vaut mieux que d'y joindre les données
  d'un tiers. Effacements **et refus** sont tracés dans `audit_log` (`dsar_erase`, `dsar_erase_refuse`).
- **Minimisation** : aucune adresse IP stockée, géo au pays, scrub systématique. Le `visitor_id`
  n'est **pas** une donnée anonyme (cf. §2) — c'est un pseudonyme, tiré au hasard et effaçable.
- **Sécurité du transport** : TLS de bout en bout jusqu'à Neon.

### 3.1 Effacement sérialisé avec l'ingestion (P8.1, migration-v81)

**Ce qui est acquis.** L'effacement et TOUS les chemins d'écriture — traces, logs, rejeu, file de
débarquement différée, rafraîchissements d'agrégats — prennent le même verrou consultatif de
transaction, par application (`pg_advisory_xact_lock`, jamais un verrou de session : la production
passe par un pooler transactionnel). Pendant un effacement, aucun writer ne peut recréer une ligne ;
les lots encore en file sont nettoyés **élément par élément**, de sorte qu'un lot portant deux
personnes perde celle qui a demandé et conserve l'autre. Une session déjà enregistrée sous une
application ne peut plus être mise à jour par une autre.

**Ce qui attend une décision, et n'est donc PAS activé.** La *protection durable* —
`privacy_erasure_barrier`, qui fait refuser par tous les writers les données rattachables à un sujet
effacé, indéfiniment — est livrée avec ses tables, son protocole et ses tests, mais reste **éteinte
par défaut** (`app_registry.privacy_barrier_mode = 'off'`). Trois questions doivent être tranchées
avant de l'allumer, et elles ne l'ont pas été :

1. **combien de temps conserve-t-on une barrière** ? Elle est elle-même une donnée pseudonyme : elle
   retient l'identifiant effacé pour pouvoir le refuser. `expires_at` existe et vaut `NULL` (pas
   d'expiration) ; aucune durée n'a été inventée, parce qu'une purge à 30 jours ne garantirait rien
   contre une restauration plus ancienne ;
2. **une personne peut-elle reprendre une collecte autorisée** après un effacement, et par quelle
   opération ? Aucune voie de réactivation n'est implémentée : ni fonction SQL de levée, ni drapeau
   du SDK. Les identifiants de session effacés restent refusés **pour toujours** ;
3. **que fait-on des sauvegardes** ? Une restauration PITR antérieure à un effacement doit rejouer
   les barrières avant de rouvrir lectures et ingestion. Tant que cette procédure n'est pas écrite et
   éprouvée, la garantie ne porte pas sur les sauvegardes.

**Ce que la garantie ne couvrira jamais.** La preuve porte sur les identifiants fournis ou déjà liés
(session, visiteur, HMAC utilisateur ou compte, cloisonnés par application). Un événement totalement
anonyme — nouvelle session, aucun identifiant commun — n'est pas rattachable à une personne effacée.
Cette limite est affichée **à l'écran** dans le rapport `/admin/privacy`, pas seulement ici.

**Retour arrière.** Revenir à une version applicative antérieure à P8.1 ne lève PAS les barrières
déjà posées (aucune migration descendante ne les supprime), mais un writer d'une version antérieure
**ignore** la table : il ne les consulte pas. Un retour arrière ne se fait donc pas en silence — soit
on reste sur une version compatible, soit on suspend l'ingestion des applications concernées
(`app_registry.ingestion_suspended_at`) le temps du retour.

## 4. Rétention — **configurable par client** (migration-v14)
- `purge_rum_tenants(default_days)` purge **chaque app selon SA rétention**
  (`app_registry.retention_days`, sinon défaut **30 j**), planifié quotidiennement (pg_cron).
- ClickHouse (le jour J) : **TTL 30 j** natif sur les tables brutes (les agrégats horaires
  sans PII peuvent être conservés plus longtemps).
- Vérifié sur Postgres réel : `scripts/verify-conformite.mjs` (rétention par tenant honorée).

## 5. Droits des personnes (art. 15–17)
- **Effacement client / offboarding** : `erase_app_data(app_id)` supprime **toute** la
  télémétrie d'un client (sessions, erreurs, métriques, replay, SVI, source maps, alertes, vues
  enregistrées, tableaux de bord) **et suspend son ingestion** dans le registre, sous la même
  transaction — sans quoi le prochain événement reçu recréerait des lignes dans l'application qu'on
  vient de vider. La reprise est une opération d'exploitation explicite, jamais l'effet d'un
  événement entrant.
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
> Registre tenu dans `apps/console/lib/legal.ts` (`SUBPROCESSORS`) — ce tableau en est le reflet,
> et le test le vérifie. **Mistral et Anthropic en sont sortis le 09/09/2026**, dans la même
> modification que la suppression de l'assistant IA interne : les routes qui les appelaient
> n'existent plus, aucune donnée ne part vers un fournisseur de modèle. Déclarer un sous-traitant
> qui ne traite rien est aussi faux que d'en omettre un qui traite.

| Sous-traitant | Rôle | Localisation | Donnée |
|---|---|---|---|
| Neon | base PostgreSQL managée | UE (Francfort, `aws-eu-central-1`) — société de droit américain | télémétrie, comptes |
| Vercel Inc. | hébergement de la console | fonctions serveur en UE (Francfort, `fra1`) — société de droit américain | rendu ; pas de stockage RUM |
| Railway Corp. | services backend : réception des mesures, travaux planifiés, serveur MCP | UE (Amsterdam, `europe-west4`) — société de droit américain | **télémétrie RUM en transit et en traitement** |
| *[Fournisseur e-mail — à brancher]* | envoi des alertes (si activé) | *[à préciser — UE recommandé]* | adresse de destination |

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
