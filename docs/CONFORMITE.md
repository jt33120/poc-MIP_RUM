# Dossier de conformité — MIP RUM (P0 #4)

> Pièce destinée aux **grilles de notation d'AO grand compte** et aux **DPO**. Décrit
> ce qui est **en place** (vérifiable dans le code/la base) et la **trajectoire** de
> certification. Souveraineté et RGPD *by design* sont des choix d'architecture, pas
> des promesses. Modèle de contrat : [`docs/DPA.md`](DPA.md).

## 1. Résidence des données 🇪🇺

> Ces trois lignes sont le reflet de `apps/console/lib/legal.ts` (constantes `HOSTS` et
> `SUBPROCESSORS`), qui alimente `/legal/confidentialite` et les Specs de la vitrine (les pages
> `/legal/mentions` et `/legal/dpa` ont été retirées le 22/09/2026). `tests/unit/conformite.test.ts`
> refuse qu'elles divergent : ce document a déclaré **Supabase / `eu-west-3` (Paris)** pendant des
> semaines après la migration vers Neon, et omis Railway alors que ce sous-traitant reçoit les
> mesures. Une pièce d'appel d'offres périmée n'est pas une coquille, c'est une déclaration
> inexacte et opposable.

- Base **PostgreSQL (Neon)** sur infrastructure AWS, région **`aws-eu-central-1` (Francfort)**.
- Console **Next.js** sur **Vercel**, fonctions serveur en région **`fra1` (Francfort)** ;
  le SDK est servi par la console (auto-hébergeable).
- Les **mesures** arrivent sur la route d'ingestion de la console (**Vercel**, `fra1`), qui les **relaie**,
  code pays seul et jamais l'adresse IP, au **collecteur** de **Railway** (région **`europe-west4`, Amsterdam**) :
  il les pseudonymise et les écrit (repli sur la console, cf. §7), à côté des travaux planifiés et du MCP.
- **Donnée et traitement sont en UE. La souveraineté, non** : Neon, Vercel et Railway sont trois
  sociétés de droit américain. La résidence européenne des données n'est pas la souveraineté ;
  la cible reste un hébergeur de droit européen (cf. §8).
- Le jour de la bascule **ClickHouse**, l'hébergement reste **souverain** (auto-géré
  Scaleway/OVH/Clever Cloud ou on-prem — cf. `labs/clickhouse/DEPLOY.md`).
- Le **flux OTLP** va du navigateur directement à l'ingestion MIP : pas d'intermédiaire US.

## 2. Données collectées & classification (minimisation)
| Donnée | Nature | Mesure de protection |
|---|---|---|
| Core Web Vitals, timings, longtasks | technique, non personnelle | — |
| Route / URL | technique | **query string & fragment retirés**, scrub PII du chemin |
| Erreurs (message, stack) | technique, **PII possible** | **scrub serveur** (`shared/scrub.mjs`) avant écriture |
| Événements `track.*` | défini par le client | scrub récursif des `props` |
| Adresse IP | **jamais stockée**, sous aucune forme (ni en clair, ni hachée, ni tronquée, ni temporairement) | Elle sert, dans la mémoire du processus qui reçoit la requête et pour la durée de cette requête seule, à déduire un **code pays**. Trois provenances possibles, tracées ligne par ligne dans `rum_session.geo_source` (migration-v85) : **`timezone`** — déduit de `mip.tz`, aucune adresse lue ; **`geoip`** — résolu dans une base **DB-IP Lite embarquée**, chargée en mémoire, **sans aucun appel réseau et sans qu'aucun tiers reçoive l'adresse** ; **`cdn`** — en-tête pays d'un CDN en façade (`x-vercel-ip-country`, `cf-ipcountry`), la résolution ayant alors lieu chez le CDN. Aucune coordonnée, aucune ville, aucune région n'est ni lue ni stockée |
| Identifiant de visiteur | **pseudonyme** | `visitor_id` : tirage ALÉATOIRE du SDK (UUID v4), persisté dans le stockage local du navigateur, sans lien avec le terminal ni avec un compte. Effaçable par le visiteur en vidant le stockage local. Reste une donnée à caractère personnel au sens du RGPD — un pseudonyme, pas une donnée anonyme |
| `user_hash` (héritage, ≤ 09/09/2026) | **ni anonyme, ni identifiant de personne** | Ancienne empreinte dérivée du user-agent, de la langue, de la résolution et du décalage horaire, sans aléa : sur un parc homogène, plusieurs personnes partagent la même valeur. Le SDK ne l'émet plus. Un export ou un effacement RGPD **refuse** de s'exécuter dessus (`id_kind = 'device_class'`), parce qu'il porterait sur les données de tiers. Ces lignes s'éteignent à l'échéance de rétention (30 j). Voir `packages/db/sql/migration-v57.sql` |
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
  d'un tiers. Exports, effacements **et refus** sont tracés dans `audit_log` : `privacy.visitor_export`,
  `privacy.visitor_erase` (un refus porte `refus=<motif>` dans son détail), et par identité métier
  `privacy.identity_search`, `privacy.identity_export`, `privacy.identity_erase` — l'audit d'un effacement
  dans la transaction de l'effacement. Avant C10, ces lignes s'appelaient `dsar_erase`, `dsar_erase_refuse`,
  `dsar_export`, `dsar_identity_*`. « Toutes les applications » est réservé à l'administrateur de la
  plateforme ; l'administrateur d'une liste ne vise que ses applications.
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

**Ce qui est activé depuis le 18/09/2026.** La *protection durable* —
`privacy_erasure_barrier`, qui fait refuser par tous les writers les données rattachables à un sujet
effacé — est **allumée pour les sept applications du registre**
(`app_registry.privacy_barrier_mode = 'enforce'`). La politique retenue est **la conservation sans
expiration** : `expires_at` vaut `NULL`. Une durée bornée ne garantirait rien contre une restauration
plus ancienne qu'elle, et la barrière est assumée pour ce qu'elle est — une donnée pseudonyme, qui
retient l'identifiant effacé afin de pouvoir le refuser.

**Aucune voie de réactivation n'existe** : ni fonction SQL de levée, ni drapeau du SDK. Les
identifiants de session effacés restent refusés pour toujours. Par quelle opération une personne
pourrait reprendre une collecte autorisée après son effacement reste à décider ; rien ne l'implémente
implicitement.

**Ce que l'activation ne couvre pas : les sauvegardes.** Une restauration PITR antérieure à un
effacement doit rejouer les barrières **avant** de rouvrir lectures et ingestion. Cette procédure
n'est ni écrite ni éprouvée. Tant qu'elle ne l'est pas, la garantie ne porte pas sur les
restaurations, et ce document ne prétend pas le contraire.

**Ce que la garantie ne couvrira jamais.** La preuve porte sur les identifiants fournis ou déjà liés
(session, visiteur, HMAC utilisateur ou compte, cloisonnés par application). Un événement totalement
anonyme — nouvelle session, aucun identifiant commun — n'est pas rattachable à une personne effacée.
Cette limite est affichée **à l'écran** dans le rapport `/admin/privacy`, pas seulement ici.

**Retour arrière.** Revenir à une version applicative antérieure à P8.1 ne lève PAS les barrières
déjà posées (aucune migration descendante ne les supprime), mais un writer d'une version antérieure
**ignore** la table : il ne les consulte pas. Un retour arrière ne se fait donc pas en silence — soit
on reste sur une version compatible, soit on suspend l'ingestion des applications concernées
(`app_registry.ingestion_suspended_at`) le temps du retour.

### 3.2 Pays estimé et adresse IP (P8.7, migration-v85)

**Ce qui est traité.** L'adresse IP de la connexion entrante est une **donnée à caractère
personnel**. MIP RUM la lit — quand l'exploitation a déclaré d'où la lire (`GEOIP_IP_SOURCE`) —
et la transforme immédiatement en un **code pays à deux lettres**. L'adresse n'est écrite nulle
part : ni en base, ni dans un journal, ni dans une clef d'erreur, ni dans un cache. Il n'existe
**aucun cache de résolution**, délibérément : ce serait le seul endroit où une adresse survivrait
à la requête qui l'a apportée, et on préfère ne pas créer l'objet à protéger. La résolution est
une recherche dichotomique en mémoire, sans entrée/sortie — d'où l'absence de délai d'attente.

**Base légale de fait.** Intérêt légitime du responsable de traitement (art. 6.1.f) : connaître la
répartition géographique de l'audience d'une application pour la dimensionner et interpréter ses
mesures de performance. La donnée conservée — un code pays sur une session déjà collectée — est
**moins identifiante** que l'adresse dont elle dérive, et le traitement n'ajoute ni suivi, ni
profil, ni enrichissement par un tiers. **Aucune adresse n'est transmise à qui que ce soit** : la
variante « appel à un fournisseur de géolocalisation », qui aurait envoyé l'adresse **avant tout
scrub MIP**, a été explicitement écartée. DB-IP n'est donc **pas un sous-traitant** : nous
téléchargeons un fichier, il ne reçoit aucune donnée.

**Ce qui est conservé.** `rum_session.geo_country` (code pays), `rum_session.geo_source`
(`geoip` / `timezone` / `cdn`, ou NULL pour l'historique antérieur à v85) et
`rum_session.geo_db_version` (livraison DB-IP qui a répondu, pour les seules lignes `geoip`). Ces
trois colonnes suivent la rétention, la purge, `erase_session`, `erase_app_data` et les exports
DSAR de la table `rum_session` — dont elles font partie. Aucune table n'a été créée.

**Ce qui n'est pas conservé.** L'adresse IP, sous quelque forme que ce soit. Aucune coordonnée
géographique, aucune ville, aucune subdivision administrative : la base « City Lite » de DB-IP,
qui les porte, est refusée par le chargeur — la raison n'est pas technique, c'est ce que ce
produit a décidé de ne jamais collecter.

**Ce que la mesure vaut.** Une base pays ne localise **pas une personne**. Elle situe une
**adresse**, qui est le plus souvent celle d'un opérateur, d'un relais d'entreprise ou d'un VPN :
un télétravailleur derrière le VPN de son employeur est classé au pays de sortie du VPN. Le
fuseau horaire, lui, est un **réglage du terminal**, que la personne choisit. Les écrans écrivent
« Pays estimé », jamais « Pays », et affichent la provenance à côté de la valeur.

**Conséquence définitive sur l'historique.** Aucun enrichissement rétrospectif du pays n'est
possible, et ne le sera jamais : **l'adresse IP des visites passées n'a jamais été stockée**.
Ce n'est pas un manque à combler plus tard, c'est le résultat voulu de la minimisation. Les
sessions antérieures à v85 gardent `geo_source` à NULL — « provenance inconnue », ce qui est
exact —, et ce lot n'introduit **aucun stockage d'adresse** qui rendrait un tel backfill possible
à l'avenir.

**Licence de la base.** DB-IP IP to Country Lite est distribuée sous **CC BY 4.0**, qui exige une
attribution visible. Elle figure dans le pied de page de la vitrine publique (`/presentation`,
via `apps/console/lib/legal.ts`), dans `packages/backend/data/LICENCE-DB-IP.txt` et ici :
**IP Geolocation by DB-IP (https://db-ip.com)**. Le fichier est utilisé tel quel, sans
modification ni redistribution.

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
| Vercel Inc. | hébergement de la console ; réception des mesures et relais vers le collecteur | fonctions serveur en UE (Francfort, `fra1`) — société de droit américain | **télémétrie RUM en transit**, relayée telle quelle avec le **code pays seul** : la console ne conserve ni ne transmet l'adresse IP ; **en traitement** (scrub, identité retirée, écriture en base) pour la part non relayée et en repli si le collecteur est indisponible ; pas de stockage RUM |
| Railway Corp. | collecteur (`collector`) : réception des mesures relayées, pseudonymisation, écriture en base ; travaux planifiés, serveur MCP | UE (Amsterdam, `europe-west4`) — société de droit américain | **télémétrie RUM en traitement**, sans adresse IP (code pays seul) : scrub, identité hachée (HMAC, secret posé sur Railway seul), écriture en base ; lecture des agrégats (travaux planifiés), réponses MCP ; pas de stockage RUM |
| Resend, Inc. | envoi des alertes e-mail, appelé par le service `notifier` (Railway) | États-Unis — société de droit américain ; région d'envoi non choisie tant que l'expéditeur est le domaine de test `resend.dev`, `eu-west-1` (Irlande) à retenir en vérifiant le domaine | adresse du destinataire (un opérateur) et texte de l'alerte (application, mesure, valeur) ; aucune donnée d'utilisateur final |

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
