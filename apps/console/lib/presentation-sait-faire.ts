// Partie 2 de la vitrine — « Ce qu'il sait faire » : ce que la page affiche, et
// d'où vient chaque phrase (plan § 8.2, PS7 et PS8 ; lot P**.4).
//
// RÈGLE DE LA PARTIE (§ 8.0). Rien ici ne dépasse le document de couverture
// (docs/RUM_PARITY_STATUS.md) :
//   - une carte ne montre que des lignes au verdict « déployé, non éprouvé », et
//     chaque identifiant y porte SA limite, en une puce qui garde la réserve
//     principale de sa ligne (relue à la main, puce par puce, par P**.8) ;
//   - une réserve tirée d'une ligne d'un autre verdict (D7, les sauvegardes) va dans
//     « Ce qui reste », jamais dans une carte ;
//   - les lignes déployées mais inertes sur le trafic réel (D12, D14) vont aussi
//     dans « Ce qui reste » : déployé ne veut pas dire actif.
// tests/unit/couverture-site.test.ts (contrôle n° 3) le vérifie sur CES cartes :
// identifiants, provenance de chaque source, une puce par identifiant.
//
// TEXTES. K1 à K14 : textes exacts du tableau PS7 du plan, qu'aucun fait du relevé
// du 23/09/2026 ne contredit. K15 n'est pas dans le plan : ce relevé a fait passer
// F2 (« Vérifier les types ») à « déployé, non éprouvé », et la règle veut alors une
// carte pour elle. Elle est écrite depuis la ligne F2 et le § 8.4 du document, dans
// la forme des autres.
//
// SOURCES. `{ ligne }` = une ligne de capacité, par identifiant ; `{ passage }` = le
// numéro d'une ligne du document hors des tables de capacités ; `{ fichier }` =
// « chemin:ligne » ou « chemin:début-fin » d'un fichier du dépôt, relatif à la
// racine ou à apps/console. Le relevé du 23/09 a gardé, ligne pour ligne, la
// numérotation des §§ 1 à 11 du relevé du 18/09 : les numéros du plan valent encore.
import { CAPACITES, VERDICTS, type Capacite, type Verdict } from "./couverture";
import type { CarteCapacite, Source } from "./couverture-controle";

export type { CarteCapacite, Source };

/**
 * PS7 — les cartes, dans l'ordre des familles du document. Les identifiants d'une
 * carte sont DÉRIVÉS de `limites` : aucune liste séparée qui pourrait diverger.
 * (La recette e2e compte les cartes en lisant les lignes `id: "K…",` de ce fichier.)
 */
export const CARTES: readonly CarteCapacite[] = [
  {
    id: "K1",
    titre: "Remonter d'une erreur à son contexte",
    faitQuoi:
      "Depuis une erreur, ouvrir la session, l'action, la trace et le rejeu où elle s'est produite.",
    limites: [
      {
        id: "A1",
        texte:
          "Un lien n'apparaît que si la relation existe dans la même application ; une trace d'une autre application rend une erreur 404. Le rejeu s'arrête à ce qui a réellement été enregistré.",
      },
    ],
    sources: [{ ligne: "A1" }],
  },
  {
    id: "K2",
    titre: "Compter sans confondre",
    faitQuoi:
      "Les occurrences sont la somme des répétitions reçues ; sessions, visiteurs et utilisateurs identifiés sont comptés à part et ne s'additionnent pas.",
    limites: [
      {
        id: "A2",
        texte:
          "Quand l'identité est inconnue, l'impact s'affiche « Inconnu », et une erreur de service backend sans session n'a aucun impact utilisateur.",
      },
    ],
    // § 6.3 : les populations ne s'additionnent pas ; « Inconnu » : le formatage des
    // compteurs d'impact de l'écran des erreurs.
    sources: [
      { ligne: "A2" },
      { passage: 312 },
      { passage: 313 },
      { fichier: "components/errors/error-view.ts:90-93" },
    ],
  },
  {
    id: "K3",
    titre: "Regrouper les erreurs en issues et les suivre",
    faitQuoi:
      "Regrouper les occurrences en issues stables, les trier (statut, assignation, commentaire, lien de ticket), distinguer régression et réapparition, alerter sur une nouvelle issue ou un pic.",
    limites: [
      {
        id: "A7",
        texte:
          "Le regroupement v2 n'est activé pour aucune application ; un « Script error. » sans contexte reste peu discriminant et tombe dans un regroupement marqué de faible confiance.",
      },
      {
        id: "A8",
        texte:
          "Le commentaire libre d'un opérateur n'est pas nettoyé quand l'issue survit à un effacement : on ne peut pas savoir s'il cite une donnée personnelle, une relecture humaine reste nécessaire.",
      },
      {
        id: "A9",
        texte:
          "Sans marqueur de déploiement comparable, l'écran affiche « Réapparition à vérifier » et ne rouvre pas l'issue.",
      },
      {
        id: "A10",
        texte:
          "Sans données suffisantes, la règle rend « pas de données », jamais un zéro ; les alertes « nouvelle erreur » plus anciennes restent fondées sur l'empreinte, pas sur l'issue.",
      },
    ],
    sources: [{ ligne: "A7" }, { ligne: "A8" }, { ligne: "A9" }, { ligne: "A10" }],
  },
  {
    id: "K4",
    titre: "Capter plus que les exceptions",
    faitQuoi:
      "Erreurs de console, ressources qui échouent, violations CSP et appels réseau en échec, par catégorie activable.",
    limites: [
      {
        id: "A3",
        texte:
          "Les quatre catégories sont à activer une à une et ne le sont pour aucune application ; quand le navigateur ne donne pas le statut HTTP d'une ressource, il reste inconnu.",
      },
    ],
    sources: [{ ligne: "A3" }],
  },
  {
    id: "K5",
    titre: "Retrouver le code source d'une pile minifiée",
    faitQuoi:
      "Dé-minifier une pile avec une source map déposée par un jeton dédié ou une ligne de commande.",
    limites: [
      {
        id: "A5",
        texte:
          "Aucune source map n'a été déposée par une application réelle ; une source map arrivée après les premières occurrences peut ouvrir une seconde issue.",
      },
      {
        id: "A6",
        texte:
          "Seule la route de la console est joignable, par lots de 3 Mio au plus ; le branchement dans la CI d'un client n'est pas fait (voir R3).",
      },
    ],
    sources: [{ ligne: "A5" }, { ligne: "A6" }],
  },
  {
    id: "K6",
    titre: "Filtrer et découper partout de la même façon",
    faitQuoi:
      "Les mêmes filtres sur chaque écran ; découpage par navigateur, système, appareil, pays estimé, release et route ; recherche de session ; ressources lentes et blocages du fil principal.",
    limites: [
      {
        id: "B1",
        texte:
          "Les écrans plus anciens (journaux, SVI, assistant IA) filtrent encore par application nommée, pas par le périmètre effectif ; un écran qui ne sait pas appliquer un filtre l'annonce non appliqué.",
      },
      {
        id: "B2",
        texte:
          "Les données antérieures à la migration v75 s'affichent « Inconnu » ; un iPad récent est compté comme ordinateur ; le pays est estimé depuis le fuseau horaire, ce n'est pas une géolocalisation.",
      },
      {
        id: "B3",
        texte:
          "La recherche est une égalité stricte sur trois champs (identifiant technique, route normalisée, release) : ni motif, ni recherche par identité, par décision de produit.",
      },
      {
        id: "B4",
        texte:
          "Seules les ressources retenues par le SDK (plus de 300 ms, 20 par page vue) sont mesurées : un échantillon biaisé vers le lent, jamais extrapolé ; aucune somme des blocages.",
      },
    ],
    // § 6.4 : le pays vient du fuseau horaire du terminal ; « Pays estimé »
    // partout ; ce n'est pas une géolocalisation.
    sources: [
      { ligne: "B1" },
      { ligne: "B2" },
      { ligne: "B3" },
      { ligne: "B4" },
      { passage: 317 },
      { passage: 318 },
      { passage: 319 },
      { passage: 320 },
    ],
  },
  {
    id: "K7",
    titre: "Explorer, composer un tableau de bord, exporter",
    faitQuoi:
      "Interroger librement un jeu de champs borné, enregistrer une vue, construire un tableau de bord, exporter en CSV.",
    limites: [
      {
        id: "B5",
        texte:
          "Les champs viennent d'un registre fermé ; un dépassement de budget rend une erreur, jamais une série de zéros.",
      },
      {
        id: "B6",
        texte: "24 cartes par tableau, 4 lectures simultanées, aucun rafraîchissement automatique.",
      },
      {
        id: "B7",
        texte:
          "50 vues par compte et par application ; aucune vue publique ni partage à l'échelle de l'application.",
      },
      {
        id: "B8",
        texte: "10 000 lignes par export au plus, la troncature étant écrite dans le fichier.",
      },
    ],
    sources: [{ ligne: "B5" }, { ligne: "B6" }, { ligne: "B7" }, { ligne: "B8" }],
  },
  {
    id: "K8",
    titre: "Répondre vite sur de gros volumes",
    faitQuoi:
      "Des agrégats horaires servent les lectures qui portent exactement les mêmes dimensions.",
    limites: [
      {
        id: "B9",
        texte:
          "Un agrégat ne sert que s'il porte toutes les dimensions demandées, sinon la lecture repart des données brutes ; les temps mesurés viennent d'un jeu synthétique sur un poste : ce n'est pas un engagement de service.",
      },
    ],
    sources: [{ ligne: "B9" }],
  },
  {
    id: "K9",
    titre: "Relier le navigateur à un service Node ou FastAPI, et en capter les erreurs",
    faitQuoi:
      "Instrumenter un service Node ou une API FastAPI, capter ses erreurs sans inventer de session, et les rattacher à l'appel du navigateur.",
    limites: [
      {
        id: "A4",
        texte:
          "Aucun émetteur backend ne tourne en production ; une double instrumentation journal + span sans identifiant d'exception commun n'est pas fusionnée, et l'écran ne le signale pas.",
      },
      {
        id: "C5",
        texte:
          "Aucun service Node n'émet vers la production ; un envoi peut être perdu à l'arrêt brutal du processus.",
      },
      {
        id: "C6",
        texte:
          "Un seul framework (FastAPI/Starlette) et un seul saut de trace : ni propagation d'un service à un autre, ni span de base de données.",
      },
    ],
    // § 6.5, sous le tableau des runtimes : un seul framework backend, un seul saut.
    sources: [{ ligne: "A4" }, { ligne: "C5" }, { ligne: "C6" }, { passage: 340 }, { passage: 341 }],
  },
  {
    id: "K10",
    titre: "Lire l'état d'une application mobile",
    faitQuoi:
      "Un écran, une route d'API et un outil MCP résument l'état d'une application React Native.",
    limites: [
      {
        id: "C7",
        texte:
          "Aucune session React Native réelle n'alimente l'écran ; crashes natifs, ANR et démarrage natif s'affichent « Non collecté », jamais 0 ; le taux affiché est celui des sessions sans erreur JavaScript, pas un taux sans crash.",
      },
      {
        id: "C8",
        texte:
          "Aucune interface ne permet à un opérateur de valider une capacité déclarée ; une capacité déclarée par le SDK ne vaut pas une recette.",
      },
    ],
    sources: [{ ligne: "C7" }, { ligne: "C8" }],
  },
  {
    id: "K11",
    titre: "Effacer et exporter les données d'une personne ou d'une application",
    faitQuoi:
      "Effacer sans qu'un envoi en cours ne recrée la donnée, refuser durablement la personne effacée, exporter ses données, effacer une application entière.",
    // La réserve de D7 (sauvegardes, « non commencé ») n'est PAS ici : elle va dans
    // « Ce qui reste » (règle 2 bis du § 8.0).
    limites: [
      {
        id: "D1",
        texte:
          "Aucun effacement réel n'a encore été demandé : le protocole est prouvé par 17 tests de concurrence, pas par la production ; rien ne refuse automatiquement un émetteur antérieur à la migration v81.",
      },
      {
        id: "D2",
        texte:
          "La trace de l'effacement est conservée sans expiration ; elle est elle-même une donnée pseudonyme ; aucune voie de réactivation n'existe ; un fragment de rejeu arrivé avant son ancre est perdu.",
      },
      {
        id: "D3",
        texte:
          "L'export refuse les anciens identifiants de classe d'appareil, pour ne pas joindre les données d'un tiers ; un événement totalement anonyme n'est rattachable à personne.",
      },
      {
        id: "D4",
        texte:
          "La configuration d'exploitation (SLO, objectifs, canaux de notification, sondes, jetons, marqueurs de déploiement) n'est pas supprimée.",
      },
    ],
    sources: [{ ligne: "D1" }, { ligne: "D2" }, { ligne: "D3" }, { ligne: "D4" }],
  },
  {
    id: "K12",
    titre: "Purger selon la rétention",
    faitQuoi:
      "Une tâche planifiée purge les données au-delà de la durée de rétention de chaque client.",
    limites: [
      {
        id: "D5",
        texte: "La purge ne couvre pas encore les tables de supervision SVI.",
      },
    ],
    sources: [{ ligne: "D5" }],
  },
  {
    id: "K13",
    titre: "Isoler les clients en base",
    faitQuoi:
      "Un script lit la base sous le rôle de la console, sans aucun filtre applicatif, et vérifie qu'aucune donnée d'un autre client n'est visible.",
    limites: [
      {
        id: "D6",
        texte:
          "L'isolation est prouvée en base, mais la connexion de production utilise encore un rôle propriétaire qui contourne ces règles : elle repose aujourd'hui sur le code de la console.",
      },
    ],
    // Le rôle propriétaire de la production : la procédure de déploiement le dit, et
    // l'onglet « Écart au marché » des Specs le reprend (le plan citait ses lignes
    // 160-163 ; le texte est aujourd'hui aux lignes 166-170).
    sources: [
      { ligne: "D6" },
      { fichier: "DEPLOY.md:272-278" },
      { fichier: "components/presentation/Specs.tsx:166-170" },
    ],
  },
  {
    id: "K14",
    titre: "Lire par API et par MCP, écrire depuis la console",
    faitQuoi:
      "API publique en lecture, serveur MCP en lecture seule, écritures (triage, tableaux de bord, vues) réservées aux sessions d'administration.",
    limites: [
      {
        id: "E1",
        texte:
          "Les jetons d'API sont strictement en lecture ; aucune route n'a été appelée sur des données réellement ingérées.",
      },
      {
        id: "E2",
        texte:
          "Lecture seule par construction ; le catalogue n'expose pas encore les dimensions de découpage.",
      },
      {
        id: "E3",
        texte:
          "Viewer et démo n'ont aucun droit d'écriture ; un administrateur est limité à son périmètre d'applications.",
      },
    ],
    sources: [{ ligne: "E1" }, { ligne: "E2" }, { ligne: "E3" }],
  },
  {
    id: "K15",
    titre: "Vérifier les types dans l'intégration continue",
    faitQuoi:
      "L'intégration continue vérifie les types de quatre paquets (cœur commun, SDK web, paquet React Native, agent Node) et ceux de la console.",
    // Deux réserves dans la ligne F2, gardées toutes deux : l'extension hors du
    // contrôle, et une vérification qui n'arrête une fusion que si l'on attend son
    // verdict (§ 7 du document). « Paquets publiés » n'est pas repris : le paquet
    // React Native n'est pas publié (C9).
    limites: [
      {
        id: "F2",
        texte:
          "L'extension navigateur n'est pas typée par l'intégration continue : rien ne garantit ses types à sa prochaine modification ; et la vérification n'arrête une fusion que si l'on attend son verdict sur le commit de fusion.",
      },
    ],
    // § 8.4 : « quatre paquets et la console », « seule l'extension […] n'est typée
    // par aucun workflow » ; § 7 : attendre le verdict de la CI du commit de fusion ;
    // l'étape « Typage des paquets publiés » de la CI.
    sources: [
      { ligne: "F2" },
      { passage: 503 },
      { passage: 504 },
      { passage: 390 },
      { fichier: ".github/workflows/ci.yml:70-76" },
    ],
  },
];

/**
 * Le verdict d'une carte, LU dans le document : celui de ses identifiants s'ils en
 * partagent un seul, `null` sinon (identifiant inconnu, verdicts mêlés). La page
 * l'affiche tel quel : un relevé qui déclasserait une ligne se verrait sur la
 * carte, pas seulement dans un test.
 */
export function verdictCarte(
  carte: Pick<CarteCapacite, "limites">,
  capacites: readonly Capacite[] = CAPACITES,
): Verdict | null {
  const verdicts = new Set(carte.limites.map((l) => capacites.find((c) => c.id === l.id)?.verdict ?? null));
  if (verdicts.size !== 1) return null;
  return [...verdicts][0];
}

/** Accord d'un verdict avec « capacité » : au singulier, au pluriel. */
const ACCORD: Record<Verdict, readonly [string, string]> = {
  deploye_non_eprouve: ["déployée, non éprouvée", "déployées, non éprouvées"],
  livre_non_deploye: ["livrée, non déployée", "livrées, non déployées"],
  livre_avec_defaut_connu: ["livrée avec un défaut connu", "livrées avec un défaut connu"],
  en_revue: ["en revue", "en revue"],
  bloque_acces_externe: ["bloquée par un accès externe", "bloquées par un accès externe"],
  non_retenu: ["non retenue", "non retenues"],
  non_commence: ["non commencée", "non commencées"],
};

export interface PartDeVerdict {
  verdict: Verdict;
  nombre: number;
  /** « déployées, non éprouvées », accordé à `nombre`. */
  libelle: string;
}

/**
 * La répartition des capacités du document par verdict, telle que la barre de
 * couverture la dessine : les verdicts présents seulement, du plus au moins
 * nombreux (l'ordre de la phrase de répartition du § 4 du document), à égalité
 * dans l'ordre du vocabulaire (§ 1). Les nombres sont COMPTÉS, jamais écrits.
 */
export function repartitionCouverture(capacites: readonly Capacite[] = CAPACITES): PartDeVerdict[] {
  return VERDICTS.map((verdict) => ({
    verdict,
    nombre: capacites.filter((c) => c.verdict === verdict).length,
  }))
    .filter((p) => p.nombre > 0)
    .sort((a, b) => b.nombre - a.nombre || VERDICTS.indexOf(a.verdict) - VERDICTS.indexOf(b.verdict))
    .map((p) => ({ ...p, libelle: ACCORD[p.verdict][p.nombre > 1 ? 1 : 0] }));
}

/** Un énoncé du bloc « Méthode » : une règle de comptage, et d'où elle vient. */
export interface EnonceMethode {
  /** L'énoncé, en gras. */
  titre: string;
  /** Ce qu'il veut dire à l'écran. */
  texte: string;
  sources: Source[];
}

/**
 * PS8 — « Une façon de compter » : quatre énoncés, textes exacts du plan, chacun
 * sourcé dans le document de couverture (et, pour le zéro, dans le contrat de
 * l'API, qui fixe la règle).
 */
export const METHODE: readonly EnonceMethode[] = [
  {
    titre: "Inconnu n'est pas zéro.",
    texte:
      "Une valeur qu'on ne connaît pas s'affiche « Inconnu » ; une mesure sans dénominateur n'a pas de valeur ; seul un compteur réellement vide vaut 0.",
    // § 6.3 ; B2 (« affichées « Inconnu » ») ; contrat de l'API : un dénombrement
    // réellement vide vaut 0, une mesure sans échantillon vaut null.
    sources: [{ passage: 312 }, { passage: 313 }, { ligne: "B2" }, { fichier: "docs/API_CONSOLE.md:600-601" }],
  },
  {
    titre: "Une capacité absente n'affiche pas de zéro.",
    texte:
      "Il n'existe aucune table de crash natif : l'écran mobile dit « Non collecté » plutôt qu'un taux sans crash qui ne reposerait sur rien.",
    // § 1, seconde règle de lecture ; C7.
    sources: [{ passage: 43 }, { passage: 44 }, { ligne: "C7" }],
  },
  {
    titre: "L'échantillonnage est dit, pas corrigé.",
    texte:
      "Les comptes sont ceux reçus, sans multiplicateur ; l'écran indique la probabilité qu'une erreur avait d'être retenue.",
    // § 5.3.
    sources: [{ passage: 253 }, { passage: 254 }, { passage: 255 }],
  },
  {
    titre: "Aucune adresse IP n'est conservée.",
    texte: "Le pays est estimé, et nommé « Pays estimé » partout.",
    // § 6.4.
    sources: [{ passage: 319 }, { passage: 326 }],
  },
];
