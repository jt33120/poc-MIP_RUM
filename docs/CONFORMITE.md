# Dossier de conformité — MIP RUM (P0 #4)

> Pièce destinée aux **grilles de notation d'AO grand compte** et aux **DPO**. Décrit
> ce qui est **en place** (vérifiable dans le code/la base) et la **trajectoire** de
> certification. Souveraineté et RGPD *by design* sont des choix d'architecture, pas
> des promesses. Modèle de contrat : [`docs/DPA.md`](DPA.md).

## 1. Résidence des données 🇪🇺

> Ces trois lignes sont le reflet de `apps/console/lib/legal.ts` (constantes `HOSTS` et
> `SUBPROCESSORS`), qui alimente `/legal/confidentialite`, `/extension-privacy` et les Specs de la
> vitrine (les pages `/legal/mentions` et `/legal/dpa` ont été retirées le 22/09/2026 ; les documents
> publics renvoient au DPA comme à une pièce fournie sur demande). `tests/unit/conformite.test.ts`
> refuse qu'elles divergent : ce document a déclaré **Supabase / `eu-west-3` (Paris)** pendant des
> semaines après la migration vers Neon, et omis Railway alors que ce sous-traitant reçoit les
> mesures. Une pièce d'appel d'offres périmée n'est pas une coquille, c'est une déclaration
> inexacte et opposable.

- Base **PostgreSQL (Neon)** sur infrastructure AWS, région **`aws-eu-central-1` (Francfort)**.
- Console **Next.js** sur **Vercel**, fonctions serveur en région **`fra1` (Francfort)** ;
  le SDK est servi par la console (auto-hébergeable).
- Les **mesures** arrivent sur la route d'ingestion de la console (**Vercel**, `fra1`), qui les **relaie**,
  code pays seul et jamais l'adresse IP, au **collecteur** de **Railway** (région **`europe-west4`, Amsterdam**) :
  il les pseudonymise et les écrit (repli sur la console, cf. §7). Les **travaux planifiés**, l'**API de lecture
  pour les machines** (service `api`, sur jeton, en lecture seule), le **backend de la console** (service
  `console-api` : comptes, sessions, écrans, écritures et demandes RGPD, pour le seul serveur de la console)
  et le **serveur MCP** tournent au même endroit.
- **Une exception, la collecte directe** : quand elle est allumée, les mesures vont du navigateur
  **directement** au collecteur Railway, sans passer par Vercel, et le collecteur lit l'adresse IP pour en
  déduire le pays, sans la conserver (§3.2). Deux interrupteurs, deux périmètres : la console elle-même
  (application `mip-rum-console`, variable Vercel `NEXT_PUBLIC_DOGFOOD_COLLECTOR_URL`, depuis le
  28/09/2026) ; les sites des clients dont le code de suivi, ou l'extension, vise le collecteur (variable
  Vercel `NEXT_PUBLIC_DIRECT_COLLECTOR_URL`, code prêt le 30/09/2026, non posée à cette date). Un site
  dont la politique de sécurité (CSP) n'autorise que la console reste en relais.
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
| Session replay (opt-in) | rejouée | **masquage par défaut des saisies, du texte et des médias** (réglable par app via `replayMask`), opt-in par app, consent requis. **Démasquage zone par zone** (classe `mip-rum-unmask`, option `replayUnmask`, depuis le 01/10/2026) : le texte et les médias de la zone sont alors enregistrés **en clair**. Aucune zone n'est démasquée par défaut ; en poser une est un **choix explicite du client, responsable de traitement**, à réserver à ce qui ne porte pas de donnée personnelle. Dans une zone démasquée, les champs natifs (`input`, `textarea`, `select`), le texte d'un `contenteditable` et une page en `designMode` restent masqués, et un bloc `mip-rum-block` n'est jamais capturé ; un widget de saisie maison (valeur affichée dans des `div`) écrit du texte ordinaire et doit être marqué `mip-rum-block` |

**Défense en profondeur PII** : `beforeSend` côté client **+** scrub côté serveur (parité
dev-server/edge) → on ne dépend pas du seul client. Source maps **privées** (jamais servies).

## 3. RGPD *by design*
- **Consentement** : `requireConsent` met le SDK en tampon mémoire jusqu'à `MIPRum.consent(true)` —
  côté réseau (aucune requête) **et côté terminal** (aucune lecture ni écriture du stockage local).
  Session, visiteur et mode d'échantillonnage vivent en mémoire jusqu'à l'accord, qui les écrit, ou
  reprend ceux d'une visite déjà consentie. Le widget d'avis chargé par le SDK (option `feedback`)
  suit le même accord pour sa période de silence ; posé à la main, il ne le connaît pas.
  `MIPRum.consent(false)` efface du stockage local `mip_rum_session`, `mip_rum_visitor`,
  `mip_rum_sampling`, `mip_rum_seq`, la file de rejeu (`mip_rum_retry`) et la période de silence du
  widget (`mip_rum_feedback_last:*`), et le SDK n'y écrit plus rien. Ce refus ne vaut que pour la
  page où il est donné : un autre onglet du même site, déjà consenti, réécrit `mip_rum_session` à son
  événement suivant (et `mip_rum_visitor` quand sa session expire), et une page restaurée depuis le
  cache du navigateur (bfcache) réécrit session et visiteur, tant que l'outil de consentement n'y
  appelle pas `consent(false)` à son tour (`docs/INTEGRATION.md`, annexe B). Le refus arrête aussi
  l'enregistrement du rejeu en cours, et ce qui n'en est pas encore parti est jeté
  (`packages/rum-sdk/src/index.ts`, `consent`). Un accord ultérieur repart d'un nouveau visiteur
  (finding 1.11 de l'audit, traité le 01/10/2026 : `packages/rum-sdk/src/consent.ts`,
  `tests/unit/sdk-consentement-stockage.test.ts`). Ce qui est déjà parti avant un refus tardif ne
  s'efface que par une demande DSAR (ci-dessous) : il n'existe pas de route d'oubli appelée par le SDK.
  Sans `requireConsent`, la mesure démarre dès le chargement, sans bandeau : c'est au client de
  qualifier sa mesure d'audience.
- **Page prérendue** : une page que le navigateur prépare sans l'afficher (Speculation Rules) ne
  collecte rien, et n'écrit rien sur le terminal, tant qu'elle n'est pas affichée.
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
est écrite (`docs/operations/runbook.md` § 8) et éprouvée le 28/09/2026 sur une branche de répétition, sauf sa partie « identités », manuelle et non éprouvée. Tant qu'elle ne l'est pas, la garantie ne porte pas entièrement sur les
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

**Où c'est allumé : la collecte directe, et elle seule.** Le relais de la console vers le collecteur ne
transmet que le code pays, jamais l'adresse (ADR 0005) : pour les mesures relayées, le collecteur ne lit
aucune adresse. Seules les mesures envoyées **directement** au collecteur par le navigateur en portent
une : celles du capteur de la console (`mip-rum-console`), quand `NEXT_PUBLIC_DOGFOOD_COLLECTOR_URL` est
posée sur Vercel (28/09/2026) ; et celles des sites des clients, quand `NEXT_PUBLIC_DIRECT_COLLECTOR_URL`
l'est (code prêt le 30/09/2026) — le code de suivi proposé par la console et la résolution de
l'extension visent alors le collecteur, sauf pour un domaine qui déclare son propre point de collecte
(CSP figée sur la console). L'écran des sessions dit, par application, la part des pays tirés de
l'adresse IP. Le collecteur lit
alors l'en-tête `X-Real-IP` que pose la façade Railway (`GEOIP_IP_SOURCE=railway`, et seulement si la
requête porte un marqueur de cette façade : `packages/backend/shared/client-ip.mjs`). Avant de l'allumer,
`scripts/ops/verifier-ip-directe.mjs` prouve que la façade **écrase** une adresse forgée par le client,
sans rien écrire ni renvoyer d'adresse. Couper : retirer la variable et redéployer la console
(`docs/operations/relais-ingestion.md`) — un code de suivi déjà posé chez un client garde, lui, l'adresse
du collecteur jusqu'à ce qu'il soit remplacé ; pour cesser toute lecture d'adresse, quel que soit le code
posé : `GEOIP_IP_SOURCE: "none"` dans `.railway/railway.ts`, par l'apply. Comme Vercel pour la console, la plateforme Railway consigne
l'adresse source de chaque requête dans ses **journaux HTTP** (champ `srcIp`), pour la durée de
rétention des journaux de son offre : cela relève de son contrat d'hébergeur, pas du code de MIP RUM,
qui ne l'écrit nulle part.

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
  (`app_registry.retention_days`, sinon défaut **30 j**), lancé une fois par jour par le service
  `scheduler` (cadence `quotidien`, `packages/backend/jobs/planifie.mjs` ; Neon n'offre pas pg_cron).
- ClickHouse (le jour J) : **TTL 30 j** natif sur les tables brutes (les agrégats horaires
  sans PII peuvent être conservés plus longtemps).
- Vérifié sur Postgres réel : `scripts/verify-conformite.mjs` (rétention par tenant honorée).

## 5. Droits des personnes (art. 15–17)
- **Effacement client / offboarding** : `erase_app_data(app_id)` supprime **toute** la
  télémétrie d'un client (sessions, erreurs, métriques, replay, source maps, alertes, vues
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
  déléguée à l'IdP) + **RBAC** admin/viewer scopé par app. Secrets en **variables d'environnement**
  des hébergeurs (Vercel, Railway), jamais en clair en base.
- **Ingestion durcie** : 400/500 distincts, limites de taille (413), retries transitoires,
  rate limiting durable, logs structurés avec **redaction des secrets**.
- **Cloisonnement multi-tenant** : scoping `app_id` + RBAC (renforcement P0 #5 à venir).
- **Inscription en libre-service** (30/09/2026, migration-v107 ; fermée tant que
  `INSCRIPTIONS_PAR_JOUR` vaut 0 sur `console-api`) : un visiteur crée un compte **lecteur d'un
  seul site**, créé avec lui — ni la portée plateforme, ni l'administration du site : la clé, les
  origines et les domaines de l'extension restent à la plateforme. Plafonnée : 3 tentatives par heure
  et par adresse IP (une IPv6 comptée par son /64 ; réduite à une empreinte HMAC, compteur
  `inscription_ip`, comme la connexion), `INSCRIPTIONS_PAR_JOUR` sur 24 h pour toute la
  plateforme, et une collecte limitée pour le site
  (`app_registry.debit_max_min`, 120 événements par minute par défaut). Ce qui est gardé : l'adresse
  e-mail, le haché bcrypt du mot de passe, la **date d'inscription** (`console_user.inscrit_le`), la
  ligne d'audit `auth.signup` ; aucun tiers nouveau (pas d'e-mail de confirmation).

## 7. Sous-traitants (registre)
> Registre tenu dans `apps/console/lib/legal.ts` (`SUBPROCESSORS`) — ce tableau en est le reflet,
> et le test le vérifie. **Anthropic en est sorti le 09/09/2026**, dans la même modification que
> la suppression de l'assistant IA interne : aucune donnée ne part plus vers lui. **Mistral AI,
> sorti le même jour, y revient le 30/09/2026** avec l'assistant du tableau de bord : il ne reçoit
> une donnée que lorsque l'assistant est configuré (clé posée sur Vercel) et qu'un utilisateur de
> la console l'interroge. Déclarer un sous-traitant qui ne traite rien est aussi faux que d'en
> omettre un qui traite.

| Sous-traitant | Rôle | Localisation | Donnée |
|---|---|---|---|
| Neon | base PostgreSQL managée | UE (Francfort, `aws-eu-central-1`) — société de droit américain | télémétrie, comptes |
| Vercel Inc. | hébergement de la console ; réception des mesures et relais vers le collecteur | fonctions serveur en UE (Francfort, `fra1`) — société de droit américain | **télémétrie RUM en transit**, relayée telle quelle avec le **code pays seul** : la console ne conserve ni ne transmet l'adresse IP ; **en traitement** (scrub, identité retirée, écriture en base) pour la part non relayée et en repli si le collecteur est indisponible ; pas de stockage RUM |
| Railway Corp. | collecteur (`collector`) : réception des mesures relayées et de celles que les navigateurs lui envoient directement (collecte directe : la console elle-même, et les sites dont le code de suivi vise le collecteur) ; pseudonymisation, écriture en base ; travaux planifiés, API de lecture v1 (machines, sur jeton), backend de la console (`console-api`), serveur MCP | UE (Amsterdam, `europe-west4`) — société de droit américain | **télémétrie RUM en traitement** : code pays seul pour les mesures relayées ; pour celles reçues directement du navigateur, **adresse IP lue le temps de la requête** pour en déduire le pays, jamais conservée (§3.2) ; scrub, identité hachée (HMAC, secret posé sur Railway seul), écriture en base ; lecture des agrégats (travaux planifiés), réponses de l'API v1 et du MCP aux porteurs de jeton, sans écriture (rôle `mip_api`) ; comptes et sessions de la console, écrans, écritures et demandes RGPD (`console-api`, rôles `mip_identity` et `mip_console`), l'adresse d'un utilisateur de la console, ou d'un visiteur qui s'inscrit, réduite à une empreinte HMAC dans les compteurs de débit de connexion et d'inscription, effacée après 24 h d'inactivité ; pas de stockage RUM |
| Resend, Inc. | envoi des alertes e-mail, appelé par le service `notifier` (Railway) | États-Unis — société de droit américain ; région d'envoi non choisie tant que l'expéditeur est le domaine de test `resend.dev`, `eu-west-1` (Irlande) à retenir en vérifiant le domaine | adresse du destinataire (un opérateur) et texte de l'alerte (application, mesure, valeur) ; aucune donnée d'utilisateur final |
| Mistral AI | assistant du tableau de bord : rédaction des réponses à partir des chiffres agrégés affichés à l'utilisateur de la console | UE — société de droit français ; garanties de l'accord de traitement à vérifier lors de la relecture juridique | la question de l'utilisateur et le condensé des chiffres **agrégés** de la Vue d'ensemble (santé, cases, constats, routes normalisées), messages d'erreur masqués ; **uniquement quand l'assistant est configuré et qu'un utilisateur l'interroge** ; jamais d'identifiant de visiteur ni d'adresse IP |

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
