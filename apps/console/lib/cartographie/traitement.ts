// La colonne Railway de la carte, côté réception et traitement : le collector, le
// scheduler et le notifier, le canari, les protections qu'ils portent, et les tiers
// avec qui ils parlent. Relevé du 30/09/2026 dans packages/backend, packages/service-kit
// et services/* ; les répliques et l'exposition viennent de docs/TOPOLOGIE_BACKEND.md.
//
// Une source sans numéro de ligne désigne un fichier entier : c'est le cas des
// fichiers que le relevé n'a pas relus ligne à ligne (l'IaC, le receveur).
import type { Element, Lien } from "./types";

const BACK = "packages/backend";
const KIT = "packages/service-kit";

export const ELEMENTS_RAILWAY_TRAITEMENT: readonly Element[] = [
  {
    id: "collector",
    famille: "service",
    zone: "railway",
    titre: "collector",
    sousTitre: "reçoit, contrôle, écrit · 2 répliques",
    resume:
      "Le service qui reçoit ce que les capteurs envoient, relayé par la console : il contrôle la clé et le débit, pseudonymise l'identité et écrit les mesures dans la base.",
    etiquettes: ["JSON · protobuf", "gzip · deflate", "2 répliques"],
    faits: [
      {
        texte: "Traces et journaux en JSON ou en protobuf, compressés en gzip, en deflate ou pas ; tout autre format reçoit 415.",
        sources: [`${BACK}/shared/otlp-corps.mjs:10-21`],
      },
      { texte: "Rejouer un même lot ne crée aucune ligne de plus, sauf pour les journaux.", sources: [`${BACK}/lib/pg-ingest.mjs:636-715`] },
      { texte: "Sondes /health et /live ; /ready et /metrics sous jeton, sinon 404.", sources: [`${KIT}/http.mjs:29-39`] },
      { texte: "Son journal d'accès n'écrit jamais d'adresse IP.", sources: [`${KIT}/http.mjs:54-60`] },
      { texte: "Une image par service, lancée sans les droits root.", sources: ["services/collector/Dockerfile:152-165"] },
      { texte: "Deux répliques, un domaine public.", sources: ["docs/TOPOLOGIE_BACKEND.md:23"] },
    ],
    x: 50,
    y: 1420,
  },
  {
    id: "s-cle-ingestion",
    famille: "securite",
    zone: "railway",
    titre: "Clé d'API et domaine",
    sousTitre: "qui a le droit d'envoyer",
    resume:
      "Chaque lot doit porter la clé de son application, stockée hachée ; l'extension, sans clé, n'est acceptée que depuis un domaine enregistré. Une application suspendue ou inactive est refusée.",
    etiquettes: ["SHA-256", "403", "exigée depuis le 29/09"],
    faits: [
      {
        texte: "Une clé mip_ suivie de 32 caractères hexadécimaux, stockée en SHA-256, montrée une seule fois.",
        sources: ["apps/console/lib/commandes/applications.ts:10-21"],
      },
      { texte: "Refus dans l'ordre : application suspendue, inactive, sans clé, clé fausse.", sources: [`${BACK}/lib/pg-ingest.mjs:1061-1100`] },
      {
        texte: "La clé est lisible dans la page : elle identifie l'application sans rien protéger, et le débit reste la borne.",
        sources: [`${BACK}/shared/limits.mjs:22-23`],
      },
      {
        texte: "Si le registre des applications n'a jamais pu se charger, le lot passe, par choix, et /ready le signale.",
        sources: [`${BACK}/lib/pg-ingest.mjs:1063-1066`],
      },
      { texte: "Seules les origines des applications actives reçoivent l'autorisation CORS.", sources: [`${BACK}/shared/cors.mjs:20-23`] },
    ],
    x: 370,
    y: 1420,
  },
  {
    id: "s-debit-taille",
    famille: "securite",
    zone: "railway",
    titre: "Débit et taille bornés",
    sousTitre: "contre la saturation",
    resume:
      "Chaque application a un plafond de lots par minute, compté en base ; chaque corps a une taille maximale, vérifiée avant, pendant la lecture, et après décompression.",
    etiquettes: ["600 / min", "2 Mo", "429 · 413"],
    faits: [
      {
        texte: "600 lots par minute et par application ; base injoignable, le repli refuse au-delà de 150.",
        sources: [`${BACK}/lib/pg-ingest.mjs:1003-1010`, `${BACK}/lib/pg-ingest.mjs:1156-1177`],
      },
      {
        texte: "Un site inscrit en libre-service a son propre plafond, plus bas que celui de la plateforme.",
        sources: [`${BACK}/lib/pg-ingest.mjs:1146-1155`, "packages/db/sql/migration-v107.sql:38"],
      },
      { texte: "Un corps de 2 Mo au plus, lu en flux borné, même sans longueur annoncée.", sources: [`${BACK}/shared/limits.mjs:10`, `${BACK}/shared/limits.mjs:109-119`] },
      { texte: "La décompression est bornée au même plafond : pas de bombe gzip.", sources: [`${BACK}/shared/otlp-corps.mjs:23-28`] },
      { texte: "En-têtes en 10 s, requête en 30 s : les connexions lentes sont coupées.", sources: [`${KIT}/http.mjs:74-79`] },
    ],
    x: 690,
    y: 1420,
  },
  {
    id: "railway-projet",
    famille: "externe",
    zone: "railway",
    titre: "Projet Railway",
    sousTitre: "6 services · Amsterdam",
    resume:
      "Les six services Node du backend, construits depuis la branche master par leur Dockerfile et décrits dans un seul fichier d'infrastructure, appliqué par un workflow relu.",
    etiquettes: ["IaC", "europe-west4", "Node 24"],
    faits: [
      { texte: "Toute l'infrastructure tient dans un fichier TypeScript, appliqué seulement par le workflow.", sources: [".railway/railway.ts", "AGENTS.md:119-120"] },
      { texte: "Railway Corp., à Amsterdam : déclaré dans les pages légales, comme Neon et Vercel.", sources: ["apps/console/lib/legal.ts:124-133"] },
      { texte: "Un push sur les chemins du scheduler le redéploie, et son pré-déploiement migre la base.", sources: ["AGENTS.md:121-128"] },
    ],
    x: 50,
    y: 1600,
  },
  {
    id: "s-relais-signe",
    famille: "securite",
    zone: "railway",
    titre: "Relais signé",
    sousTitre: "mip-edge/1 : le collector ne croit que la console",
    resume:
      "Le collector ne croit un pays ou une origine de page que si la requête porte le secret partagé avec la console ; sinon, ces en-têtes sont ignorés et retirés.",
    etiquettes: ["secret partagé", "rotation à deux clés"],
    faits: [
      { texte: "Sans signature : mode direct, et les en-têtes forgés sont ignorés et comptés.", sources: ["tests/unit/bord-de-confiance.test.ts:34-58"] },
      { texte: "Deux secrets acceptés pendant une rotation ; une signature fausse coupe le pays et le GeoIP.", sources: ["tests/unit/bord-de-confiance.test.ts:78-93"] },
      { texte: "La console transmet le pays, jamais l'adresse.", sources: ["apps/console/lib/ingest-relay.ts:42-45"] },
    ],
    x: 370,
    y: 1600,
  },
  {
    id: "s-pii",
    famille: "securite",
    zone: "railway",
    titre: "Identité et adresses",
    sousTitre: "pseudonymiser, ne rien garder",
    resume:
      "L'identifiant d'utilisateur devient un HMAC propre à l'application avant d'être stocké ; l'adresse IP ne sert qu'à déduire un pays et n'est jamais écrite ; les champs libres sont nettoyés.",
    etiquettes: ["HMAC-SHA256", "0 IP stockée", "nettoyage"],
    faits: [
      { texte: "L'identifiant d'utilisateur devient un HMAC par application ; l'attribut brut est retiré.", sources: ["packages/db/sql/migration-v66.sql:64", `${BACK}/lib/identity-hash.mjs`] },
      { texte: "Aucune colonne d'adresse IP dans les sessions.", sources: [`${BACK}/lib/pg-ingest.mjs:279-286`] },
      {
        texte: "GeoIP en mémoire (DB-IP Lite) pour le seul trafic direct ; une requête relayée n'y passe pas.",
        sources: [`${BACK}/shared/geoip.mjs:18-26`, "tests/unit/collecte-directe.test.ts:214-223"],
      },
      { texte: "Côté serveur, secrets, jetons, e-mails, IPv4 et longues suites de chiffres sont masqués.", sources: [`${BACK}/shared/scrub.mjs`] },
      { texte: "Sur Vercel, sans le secret d'identité, l'identité est retirée plutôt que hachée.", sources: ["apps/console/lib/ingest-relay.ts:37-40"] },
    ],
    x: 690,
    y: 1600,
  },
  {
    id: "scheduler",
    famille: "service",
    zone: "railway",
    titre: "scheduler",
    sousTitre: "toutes les 15 min · seul migrateur",
    resume:
      "Un processus permanent qui lance trois cadences — toutes les 15 minutes, chaque heure, chaque nuit — sous un bail en base, et qui applique seul les migrations avant chaque déploiement.",
    faits: [
      { texte: "Tick à :00, :15, :30 et :45 ; passage horaire à HH:05 ; passage quotidien à 03:17 UTC.", sources: [`${BACK}/jobs/cadence.mjs:28-83`] },
      {
        texte: "Un bail en base empêche deux instances de lancer la même cadence ; pas de verrou de session, que le pooler de Neon perdrait.",
        sources: [`${BACK}/jobs/bail.mjs:3-19`, `${BACK}/jobs/bail.mjs:62-75`],
      },
      {
        texte: "Seul migrateur, au pré-déploiement : un échec garde l'ancien déploiement en service.",
        sources: ["services/scheduler/migrate.mjs:17-33", "packages/db/migrate.mjs:100-106"],
      },
      { texte: "Il ne livre plus rien : la livraison est passée au notifier.", sources: [`${BACK}/jobs/planifie.mjs:367-372`] },
      { texte: "Ses sondes HTTP refusent le réseau privé et les métadonnées du cloud.", sources: [`${BACK}/jobs/planifie.mjs:199-218`] },
      { texte: "Une réplique, aucun domaine public.", sources: ["docs/TOPOLOGIE_BACKEND.md:27"] },
    ],
    liste: {
      titre: "Travaux",
      entrees: [
        { nom: "tick · canari", role: "un faux lot par la console et en direct, relu en base" },
        { nom: "tick · check_alerts", role: "les règles d'alerte : seuil, habitude, release" },
        { nom: "tick · check_slo_burn", role: "la consommation des objectifs de service" },
        { nom: "tick · uptime", role: "les vérifications HTTP des sites, 10 en parallèle" },
        { nom: "heure · refresh_rum_rollups", role: "les agrégats horaires des 26 dernières heures" },
        { nom: "heure · refresh_metric_histogram", role: "les histogrammes des Web Vitals" },
        { nom: "heure · check_new_errors", role: "les erreurs jamais vues" },
        { nom: "heure · détections", role: "percentiles horaires et plages habituelles" },
        { nom: "nuit · purge_rum_tenants", role: "la rétention de chaque application" },
        { nom: "nuit · meter_tenant_usage", role: "la consommation de la veille" },
        { nom: "nuit · purge_console_sessions", role: "sessions expirées, compteurs de connexion" },
        { nom: "nuit · purge_detections", role: "les détections de plus de 8 semaines" },
        { nom: "déploiement · migrate.mjs", role: "les migrations en attente, avant de démarrer" },
      ],
    },
    x: 50,
    y: 1780,
    hauteur: 330,
  },
  {
    id: "notifier",
    famille: "service",
    zone: "railway",
    titre: "notifier",
    sousTitre: "livre les alertes · toutes les 15 min",
    resume:
      "Le seul service qui parle vers l'extérieur : il vide la file des livraisons tenue en base, et envoie webhooks signés et e-mails. Il est le seul à détenir les secrets d'envoi.",
    etiquettes: ["webhooks", "e-mail", "5 tentatives"],
    faits: [
      {
        texte: "Une passe toutes les 15 minutes, 45 s après le tick ; pas de LISTEN/NOTIFY, qui ne traverse pas le pooler de Neon.",
        sources: [`${BACK}/jobs/livreur.mjs:37-81`, "docs/architecture/adr/0014-base-gratuite.md:38"],
      },
      { texte: "Réservation en SKIP LOCKED : un même envoi ne part jamais deux fois.", sources: [`${BACK}/lib/dispatch-alerts.mjs:142-162`] },
      { texte: "Cinq tentatives au plus, avec un recul qui double à chaque fois.", sources: [`${BACK}/lib/dispatch-alerts.mjs:118-134`] },
      {
        texte: "Les e-mails partent par l'API Resend, en mode test tant que le domaine d'envoi n'est pas vérifié ; pas de SMTP.",
        sources: [`${BACK}/lib/net/resend.mjs:34`, "services/notifier/worker.mjs:69-71"],
      },
    ],
    x: 370,
    y: 1780,
  },
  {
    id: "s-sorties",
    famille: "securite",
    zone: "railway",
    titre: "Sorties sûres",
    sousTitre: "webhooks signés · safe-fetch",
    resume:
      "Les webhooks partent signés en HMAC-SHA256, et aucun appel vers une adresse saisie par un utilisateur ne peut viser le réseau privé ni les métadonnées du fournisseur.",
    etiquettes: ["HMAC-SHA256", "anti-SSRF"],
    faits: [
      { texte: "En-têtes x-mip-timestamp et x-mip-signature, en HMAC-SHA256.", sources: [`${BACK}/lib/net/signature-webhook.mjs:7-11`, `${BACK}/lib/net/signature-webhook.mjs:48-53`] },
      { texte: "safe-fetch refuse le réseau privé de Railway, les IP littérales et les métadonnées du cloud.", sources: [`${BACK}/lib/net/safe-fetch.mjs:1-25`] },
    ],
    x: 690,
    y: 1780,
  },
  {
    id: "canari",
    famille: "qualite",
    zone: "railway",
    titre: "Canari de bout en bout",
    sousTitre: "à chaque tick, un faux lot",
    resume:
      "À chaque tick, le scheduler envoie un faux lot de mesures par la console et directement au collector, puis vérifie qu'il est arrivé en base ; une coupure ou un silence anormal ouvre une alerte.",
    etiquettes: ["par la console", "en direct", "mip-canari"],
    faits: [
      { texte: "Deux envois : par la console, et directement au collector.", sources: [`${BACK}/jobs/sondes.mjs:34-47`] },
      { texte: "Sa clé est tirée au démarrage, et seule son empreinte est écrite.", sources: [`${BACK}/jobs/sondes.mjs:421-435`] },
      { texte: "Il relit la session, la page vue, la mesure, le span et l'index, puis écrit le journal des sondes.", sources: [`${BACK}/jobs/sondes.mjs:506-592`] },
    ],
    x: 370,
    y: 1960,
  },
  {
    id: "s-reseau-prive",
    famille: "securite",
    zone: "railway",
    titre: "Réseau privé",
    sousTitre: "mcp → api, sans passer par Internet",
    resume:
      "Le serveur MCP joint le service api par le réseau privé de Railway, et refuse de démarrer si l'hôte n'est pas privé. Sur ce réseau, le trafic circule en HTTP simple.",
    etiquettes: ["*.railway.internal", "HTTP simple"],
    faits: [
      { texte: "mcp lit l'API v1 par le service api, sur le réseau privé, sans toucher la base.", sources: ["docs/TOPOLOGIE_BACKEND.md:26"] },
      { texte: "Un hôte qui n'est pas privé empêche le démarrage.", sources: ["packages/mcp-tools/lib/client.mjs"] },
    ],
    x: 50,
    y: 2440,
  },
  {
    id: "s-bundles",
    famille: "securite",
    zone: "railway",
    titre: "Bundles sous garde",
    sousTitre: "ce qu'un service n'embarque pas",
    resume:
      "Le build de api et de console-api refuse un bundle qui embarquerait la session de la console, Next.js, React, les écrans ou le secret de développement.",
    etiquettes: ["build refusé", "fumée Docker"],
    faits: [
      { texte: "api refuse la session de la console, jose, next/ et le relais.", sources: ["services/api/build.mjs:98-119"] },
      { texte: "console-api refuse les écrans, les composants, la session, la base locale et React.", sources: ["services/console-api/build.mjs:50-66"] },
      { texte: "La fumée Docker vérifie l'image : ni next ni jose dans api, pas de pilote Postgres dans mcp.", sources: [".github/workflows/docker-smoke.yml"] },
    ],
    x: 370,
    y: 2440,
  },
];

export const ELEMENTS_TIERS_TRAITEMENT: readonly Element[] = [
  {
    id: "dbip",
    famille: "externe",
    titre: "DB-IP Lite",
    sousTitre: "pays par adresse IP · CC BY 4.0",
    resume: "La base libre qui donne le pays d'une adresse IP ; le collector la télécharge à la construction de son image et la garde en mémoire.",
    faits: [
      { texte: "Version dbip-country-lite-2026-09, 717 170 plages.", sources: ["packages/backend/data/dbip-country-lite.manifest.json"] },
      { texte: "Refusée si elle a plus de 180 jours.", sources: [`${BACK}/lib/geoip-db.mjs:46-50`] },
    ],
    x: -440,
    y: 1420,
  },
  {
    id: "resend",
    famille: "externe",
    titre: "Resend",
    sousTitre: "envoi des e-mails d'alerte",
    resume: "Le service d'e-mail qui porte les alertes adressées à une personne ; déclaré comme sous-traitant.",
    faits: [
      { texte: "Appel à l'API Resend, avec une clé d'idempotence par livraison.", sources: [`${BACK}/lib/net/resend.mjs:34`] },
      { texte: "Déclaré sous-traitant dans les pages légales.", sources: ["apps/console/lib/legal.ts:280"] },
    ],
    x: -440,
    y: 1780,
  },
  {
    id: "webhooks-clients",
    famille: "externe",
    titre: "Webhooks des clients",
    sousTitre: "compatibles Slack",
    resume: "Les adresses que les clients déclarent pour recevoir leurs alertes : un JSON dont le champ text se lit tel quel dans Slack.",
    faits: [{ texte: "Pas d'API Slack native : un webhook compatible.", sources: [`${BACK}/lib/dispatch-alerts.mjs:4`] }],
    x: -440,
    y: 1960,
  },
  {
    id: "sites-clients",
    famille: "externe",
    titre: "Sites surveillés",
    sousTitre: "vérifications HTTP",
    resume: "Les adresses que les clients font vérifier : le scheduler les appelle à chaque tick et note si elles répondent.",
    faits: [{ texte: "Un échec est confirmé par un second essai une seconde plus tard.", sources: [`${BACK}/jobs/planifie.mjs:183-185`] }],
    x: -440,
    y: 2140,
  },
];

export const LIENS_TRAITEMENT: readonly Lien[] = [
  { de: "collector", vers: "base-mesures", nature: "ecrit", libelle: "sessions, pages, mesures, erreurs, spans, journaux" },
  { de: "collector", vers: "base-rejeu", nature: "ecrit", libelle: "morceaux de rejeu" },
  { de: "collector", vers: "base-extension", nature: "ecrit", libelle: "postes équipés" },
  { de: "collector", vers: "base-erreurs", nature: "ecrit", libelle: "problèmes, source maps, déploiements" },
  { de: "collector", vers: "base-applications", nature: "lit", libelle: "clés, origines, domaines" },
  { de: "collector", vers: "base-plateforme", nature: "ecrit", libelle: "compteurs de débit" },
  { de: "collector", vers: "base-rgpd", nature: "lit", libelle: "barrières d'effacement" },
  { de: "dbip", vers: "collector", nature: "embarque", libelle: "à la construction de l'image" },
  { de: "s-cle-ingestion", vers: "collector", nature: "protege" },
  { de: "s-debit-taille", vers: "collector", nature: "protege" },
  { de: "s-relais-signe", vers: "collector", nature: "protege" },
  { de: "s-pii", vers: "collector", nature: "protege" },
  { de: "railway-projet", vers: "collector", nature: "embarque", libelle: "héberge" },
  { de: "railway-projet", vers: "scheduler", nature: "embarque", libelle: "héberge" },
  { de: "railway-projet", vers: "notifier", nature: "embarque", libelle: "héberge" },
  { de: "railway-projet", vers: "api", nature: "embarque", libelle: "héberge" },
  { de: "railway-projet", vers: "console-api", nature: "embarque", libelle: "héberge" },
  { de: "railway-projet", vers: "mcp", nature: "embarque", libelle: "héberge" },
  { de: "scheduler", vers: "base-fonctions", nature: "declenche", libelle: "check_alerts, refresh_*, purge_*" },
  { de: "scheduler", vers: "base-agregats", nature: "ecrit", libelle: "agrégats, percentiles, détections" },
  { de: "scheduler", vers: "base-alertes", nature: "ecrit", libelle: "alertes déclenchées" },
  { de: "scheduler", vers: "base-chaine", nature: "ecrit", libelle: "journal des sondes" },
  { de: "scheduler", vers: "base-disponibilite", nature: "ecrit", libelle: "résultats des vérifications" },
  { de: "scheduler", vers: "base-plateforme", nature: "ecrit", libelle: "bail, migrations" },
  { de: "scheduler", vers: "base-mesures", nature: "lit", libelle: "lit, puis purge à la rétention" },
  { de: "scheduler", vers: "canari", nature: "declenche", libelle: "à chaque tick" },
  { de: "scheduler", vers: "sites-clients", nature: "appel", libelle: "vérifications HTTP" },
  { de: "canari", vers: "reception", nature: "verifie", libelle: "par la console" },
  { de: "canari", vers: "collector", nature: "verifie", libelle: "en direct" },
  { de: "notifier", vers: "base-alertes", nature: "lit", libelle: "file des livraisons" },
  { de: "notifier", vers: "base-chaine", nature: "ecrit", libelle: "son battement" },
  { de: "notifier", vers: "resend", nature: "appel", libelle: "e-mails" },
  { de: "notifier", vers: "webhooks-clients", nature: "appel", libelle: "webhooks signés" },
  { de: "s-sorties", vers: "notifier", nature: "protege" },
  { de: "s-sorties", vers: "scheduler", nature: "protege", libelle: "sondes HTTP" },
  { de: "s-reseau-prive", vers: "mcp", nature: "protege" },
  { de: "s-bundles", vers: "api", nature: "protege" },
  { de: "s-bundles", vers: "console-api", nature: "protege" },
];
