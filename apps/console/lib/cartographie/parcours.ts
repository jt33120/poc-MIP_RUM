// Les parcours guidés de la carte : chaque étape met en avant quelques éléments et y
// cadre la vue. Ils racontent le système dans l'ordre où les choses se passent.
import type { Parcours } from "./types";

export const PARCOURS: readonly Parcours[] = [
  {
    id: "mesure",
    titre: "Une mesure",
    resume: "D'un visiteur qui ouvre une page jusqu'au graphique de la console.",
    etapes: [
      {
        titre: "Un visiteur ouvre une page",
        texte: "Le site charge mip-rum.js dans le <head>. Si le navigateur refuse le suivi (DNT, GPC), rien ne part.",
        elements: ["navigateur", "sdk-web", "s-sdk-vie-privee"],
      },
      {
        titre: "Le SDK mesure",
        texte: "Web Vitals, page vue, erreurs, appels réseau : chaque mesure devient un span OpenTelemetry, rangé dans un lot.",
        elements: ["sdk-web", "m-pages", "m-vitals", "m-erreurs", "m-reseau"],
      },
      {
        titre: "Le lot part vers la console",
        texte: "Toutes les 3 secondes, ou quand la page passe en arrière-plan, le lot part en OTLP/HTTP JSON vers la réception de la console.",
        elements: ["m-vitals", "m-pages", "reception"],
      },
      {
        titre: "La console le relaie au collector",
        texte: "Le corps part tel quel, signé du secret partagé ; seul le pays accompagne le lot, jamais l'adresse IP.",
        elements: ["reception", "collector", "s-relais-signe"],
      },
      {
        titre: "Le collector contrôle",
        texte: "Clé d'API, application active, débit, taille : un lot qui ne passe pas reçoit un refus explicite. L'identité devient un HMAC.",
        elements: ["collector", "s-cle-ingestion", "s-debit-taille", "s-pii"],
      },
      {
        titre: "La mesure est écrite en base",
        texte: "Sessions, pages vues, mesures, erreurs : dans les tables brutes de Neon, sans doublon si le lot est rejoué.",
        elements: ["collector", "base-mesures", "base"],
      },
      {
        titre: "Le scheduler agrège",
        texte: "Chaque heure, les agrégats et les percentiles sont recalculés ; chaque nuit, la rétention purge ce qui a expiré.",
        elements: ["scheduler", "base-fonctions", "base-agregats", "base-mesures"],
      },
      {
        titre: "La console l'affiche",
        texte: "L'équipe ouvre la console : l'écran lit la base, et la note de santé s'affiche avec son intervalle de confiance.",
        elements: ["equipes", "console-ecrans", "base", "stats"],
      },
    ],
  },
  {
    id: "trace",
    titre: "Une trace serveur",
    resume: "Un appel du navigateur suivi jusqu'à sa part serveur.",
    etapes: [
      {
        titre: "Le navigateur appelle l'API du client",
        texte: "Le SDK chronomètre l'appel et y ajoute l'en-tête traceparent, qui porte l'identifiant de la trace.",
        elements: ["navigateur", "m-reseau", "serveur-client"],
      },
      {
        titre: "L'agent OpenTelemetry mesure la part serveur",
        texte: "L'agent officiel du langage reprend le traceparent : la requête serveur, ses requêtes SQL, ses appels sortants et ses journaux.",
        elements: ["serveur-client", "agents-otel", "m-traces-serveur", "m-journaux"],
      },
      {
        titre: "Les deux moitiés arrivent séparément",
        texte: "Le navigateur et le serveur envoient chacun leur part à la réception, qui les relaie au collector.",
        elements: ["m-reseau", "m-traces-serveur", "reception", "collector"],
      },
      {
        titre: "Elles se rejoignent en base",
        texte: "Même identifiant de trace : l'appel est reconstitué, du clic à la requête SQL.",
        elements: ["collector", "base-mesures"],
      },
      {
        titre: "La lenteur est localisée",
        texte: "L'écran de traçage décompose chaque appel lent : la part du serveur, et celle du trajet.",
        elements: ["console-ecrans", "base-mesures", "equipes"],
      },
    ],
  },
  {
    id: "alerte",
    titre: "Une alerte",
    resume: "D'une règle posée dans la console jusqu'au message reçu.",
    etapes: [
      {
        titre: "Une règle est posée",
        texte: "Dans la console, un administrateur crée une règle : un seuil, un écart à l'habitude, ou une régression de release.",
        elements: ["equipes", "console-commandes", "base-alertes"],
      },
      {
        titre: "Toutes les 15 minutes, le scheduler évalue",
        texte: "Au tick, check_alerts confronte les mesures récentes aux règles, en tenant compte des périodes où la collecte était coupée.",
        elements: ["scheduler", "base-fonctions", "base-mesures", "base-chaine"],
      },
      {
        titre: "L'alerte entre dans la file",
        texte: "Une alerte déclenchée dépose une livraison par canal dans une file tenue en base.",
        elements: ["base-fonctions", "base-alertes"],
      },
      {
        titre: "Le notifier livre",
        texte: "45 secondes après le tick, il réserve chaque livraison sans risque de doublon, signe les webhooks, et réessaie en cas d'échec.",
        elements: ["notifier", "base-alertes", "s-sorties"],
      },
      {
        titre: "Le message arrive",
        texte: "Un webhook compatible Slack, ou un e-mail par Resend.",
        elements: ["notifier", "webhooks-clients", "resend"],
      },
    ],
  },
  {
    id: "ia",
    titre: "Une question d'IA",
    resume: "Un assistant IA qui lit les mesures, sans jamais toucher la base.",
    etapes: [
      {
        titre: "L'assistant appelle un outil MCP",
        texte: "Claude, Cursor ou un autre assistant appelle l'un des 19 outils du serveur MCP, avec le jeton de son utilisateur.",
        elements: ["assistants-ia", "mcp"],
      },
      {
        titre: "Le serveur MCP relaie à l'API",
        texte: "Il n'a pas accès à la base : il appelle le service api par le réseau privé de Railway, avec le même jeton.",
        elements: ["mcp", "api", "s-reseau-prive"],
      },
      {
        titre: "L'API lit en lecture seule",
        texte: "Le service api lit sous le rôle mip_api : une liste blanche de tables, une transaction en lecture seule, 15 secondes au plus.",
        elements: ["api", "base", "base-securite", "s-jetons"],
      },
    ],
  },
  {
    id: "deploiement",
    titre: "Un déploiement",
    resume: "D'un commit sur le dépôt jusqu'aux services en production.",
    etapes: [
      {
        titre: "Un commit arrive sur le dépôt",
        texte: "Toute PR vise master ; elle déclenche la CI, et selon les chemins touchés, la fumée des images et le plan d'infrastructure.",
        elements: ["depot", "workflow-ci", "workflow-docker-smoke", "workflow-railway-config"],
      },
      {
        titre: "La CI vérifie",
        texte: "Tests unitaires et gardes du dépôt, tests SQL, contrats de parité, E2E : tout doit passer.",
        elements: ["workflow-ci", "tests-unit", "tests-integration", "tests-contract", "tests-e2e", "gardes"],
      },
      {
        titre: "L'infrastructure s'applique après relecture",
        texte: "Le plan calculé sur la PR, relu par un humain, s'applique tel quel après la fusion.",
        elements: ["workflow-railway-config", "railway-projet"],
      },
      {
        titre: "Le scheduler migre, puis tout redémarre",
        texte: "Au pré-déploiement du scheduler, les migrations en attente s'appliquent ; un échec garde l'ancien déploiement.",
        elements: ["railway-projet", "scheduler", "base"],
      },
      {
        titre: "La console part sur Vercel",
        texte: "La console se déploie sur Vercel, à Francfort.",
        elements: ["depot", "console"],
      },
      {
        titre: "La production est surveillée",
        texte: "Toutes les 15 minutes, la sonde externe appelle chaque service exposé, et le canari envoie un faux lot de bout en bout.",
        elements: ["workflow-sonde-externe", "canari", "reception", "collector"],
      },
    ],
  },
];
