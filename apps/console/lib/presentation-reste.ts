// Partie 3 de la vitrine — « Ce qui reste pour un vrai outil de RUM » (plan § 8.2,
// points R1 à R9, puis R10 le 24/09/2026 ; rendu par components/presentation/Reste.tsx).
//
// /presentation est un chemin PUBLIC, et cette partie dit ce que le POC ne fait pas
// encore. Elle doit être exacte dans les deux sens : ne pas minimiser une limite,
// ne pas en maintenir une que le document de couverture dit levée.
//
// RÈGLE : chaque point ne dit que ce que dit docs/RUM_PARITY_STATUS.md, ou un
// fichier du dépôt, et le cite dans `sources` — un identifiant de ligne de
// capacité (« D12 ») ou « chemin:ligne » depuis la racine du dépôt. Le contrôle
// n° 4 de tests/unit/couverture-site.test.ts vérifie que chaque source existe et
// que chaque citation tombe dans son fichier. Il ne vérifie pas que la phrase dit
// ce que dit la source : c'est la relecture P**.8.
//
// Les pastilles d'une carte sont DÉRIVÉES de `sources` (`lignesCitees`) : les
// identifiants qui sont des lignes du document. Pas de seconde liste qui pourrait
// diverger.
//
// RELEVÉ DU 23/09/2026 (P**.10). Trois textes du plan ne tenaient plus et ont été
// réécrits depuis le document : R2 (la migration de la reprise est appliquée), R9
// (la CI type la console et les paquets) et R6 (c'est la résolution par base
// IP→pays qui ne donne rien, pas le pays estimé, qui existe : § 6.4).
//
// RELECTURE DU 26/09/2026. Le document de couverture n'a pas été relevé depuis le
// 23/09 ; des fichiers du dépôt plus récents que lui ont rendu cinq points faux.
// Ils sont réécrits depuis ces fichiers, qu'ils citent :
//   - R1 et R2 suivent le relevé de production du 23/09/2026, LU EN BASE
//     (docs/operations/releve-p0-2026-09-23.md) : la chaîne reçoit du trafic (le
//     dernier événement ne date pas du 17/09), et v83 est inscrite au registre
//     `schema_migration` — le document ne l'avait que déduite des journaux ;
//   - R6 : le chemin est choisi (ADR 0005). Le relais de la console transmet le pays
//     seul et saute la résolution ; seule une collecte directe (P6b.G) s'en servira.
//     Les deux passages du document qui disaient « rien n'est tranché » (§ 11,
//     étape 2 ; TOPOLOGIE_BACKEND.md, section GeoIP) ne sont plus cités ;
//   - R8 : six applications sur sept n'ont aucune clé d'ingestion (même relevé) ;
//   - R9 : la construction depuis un dépôt propre, le typage de l'extension et les
//     deux bancs de mesure sont joués par la CI depuis le 24/09 (PR #281,
//     .github/workflows/ci.yml), et la procédure de restauration est écrite
//     (docs/operations/runbook.md § 8), jamais éprouvée. F1 à F3 ne sont plus ses
//     pastilles : ce que leurs lignes disent manquer est fait.
// Les autres points ont été relus contre le code le même jour et gardent le texte
// du plan. Les numéros de ligne cités hors du document ont été relevés à nouveau.
import { capaciteParId, type Capacite } from "./couverture";
import type { PointReste } from "./couverture-controle";

/** Le document de couverture, tel que les sources le citent. */
const DOC = "docs/RUM_PARITY_STATUS.md";

/** Les dix points, dans l'ordre fixe du plan (R10 ajouté le 24/09/2026). */
export const POINTS_RESTE: readonly PointReste[] = [
  {
    id: "R1",
    titre: "Une recette sur une vraie application",
    manque:
      "Aucun écran n'a été relu sur des données réellement ingérées. Du trafic arrive pourtant : le relevé lu en base le 23/09/2026 compte 378 événements pour l'application du client, le dernier reçu ce jour-là à 13:01 UTC, et 33 pour la console elle-même. Le volume reste faible, et la production est coupée du 24 septembre au 1er octobre 2026, faute de quota (voir R10).",
    debloque:
      "Une fois la base rouverte, relire les erreurs, l'Explorer et un tableau de bord sur le trafic reçu ; faire émettre une application de recette pour ce qu'il ne couvre pas, dont l'écran mobile.",
    decide: "L'équipe MIP ; c'est le point le moins coûteux.",
    // § 6.2 (aucun écran éprouvé sur des données réellement ingérées) ; § 11, étape 1 ;
    // le relevé de production du 23/09, lu en base : le « dernier événement le 17/09 »
    // que le document reprenait sans recontrôle est faux.
    sources: [
      `${DOC}:297-298`,
      `${DOC}:560-563`,
      "docs/operations/releve-p0-2026-09-23.md:13",
      "docs/operations/releve-p0-2026-09-23.md:54-57",
    ],
  },
  {
    id: "R2",
    titre: "P8.3 — Reprise de l'historique",
    manque:
      "L'outil de reprise est livré et testé (dry-run, vérification), et sa migration v83 est appliquée en production : le registre des migrations, lu en base le 23/09/2026, l'inscrit le 18/09/2026 à 11:46 UTC. Aucun environnement ne lance l'outil, qui est une ligne de commande, et son exécution en production a été écartée le 18/09/2026 : environ 97 lignes étaient concernées (chiffre non recontrôlé).",
    debloque:
      "Rien n'est obligatoire. Si une reprise redevient nécessaire, plus rien n'est à faire côté schéma : il reste à lancer l'outil sur la base de production, depuis un poste qui y a accès.",
    decide: "Le responsable du produit.",
    // D8 (aucun environnement ne lance l'outil), D9 (décision du 18/09, ≈ 97 lignes
    // non recontrôlées, poste de livraison refusé par la base) ; § 10 (seul point
    // fermé par une décision) ; fin du § 12.2 (« rien côté schéma, seulement lancer
    // l'outil ») ; le relevé de production du 23/09 : v83 LUE dans `schema_migration`,
    // là où le document ne l'avait que déduite des journaux du runner.
    sources: [
      "D8",
      "D9",
      `${DOC}:546-548`,
      `${DOC}:629-631`,
      "docs/operations/releve-p0-2026-09-23.md:12",
      "docs/operations/releve-p0-2026-09-23.md:45",
    ],
  },
  {
    id: "R3",
    titre: "P8.4 — Source maps dans l'intégration continue du client",
    manque: "Jamais entamé.",
    debloque:
      "Un accès au dépôt et au build du client, un identifiant d'application, une convention de release, un jeton d'upload rangé dans les secrets de sa CI.",
    decide: "Le client.",
    sources: ["D10"],
  },
  {
    id: "R4",
    titre: "P8.5 — Crashes natifs iOS et Android",
    manque:
      "Rien n'est livré, volontairement : aucune table de crash natif n'existe, pour qu'aucun écran ne lise un zéro.",
    debloque:
      "Choisir un moteur ou un fournisseur, disposer d'une application native, de builds signés, de symboles et d'appareils.",
    decide: "Le client et l'équipe MIP.",
    sources: ["D11"],
  },
  {
    id: "R5",
    titre: "React Native : une matrice de compatibilité vide",
    manque:
      "Le paquet n'est pas publié et n'a tourné sur aucune version de React Native, Hermes, iOS ou Android ; un visiteur mobile est recompté à chaque lancement de l'application ; la file hors ligne durable est désactivée par défaut.",
    debloque:
      "Choisir le registre, le compte, le nom et la politique de versions ; exécuter le paquet sur une matrice réelle ; persister l'identifiant du visiteur.",
    decide: "L'équipe MIP.",
    sources: ["C1", "C2", "C3", "C4", "C9", "C10"],
  },
  {
    id: "R6",
    titre: "Le pays par adresse IP, inerte tant que la collecte passe par Vercel",
    manque:
      "La résolution et sa base (DB-IP Lite, téléchargée à la construction de l'image) sont livrées dans le collecteur, un service Railway que le dépôt déclare mais qui n'est pas encore créé. Le trafic entre par la route de la console sur Vercel, qui ne l'appelle pas ; et le relais de la console vers le collecteur, livré éteint, ne lui transmettra que le pays posé par Vercel, jamais l'adresse : la résolution y est sautée. Cette résolution ne donne donc aucun pays aujourd'hui.",
    debloque:
      "Le chemin est choisi : une collecte directe vers le collecteur, pour les sites dont la politique de sécurité du contenu (CSP) le permet, une fois que le relais porte tout le trafic depuis 7 jours sans repli. Avant, prouver sur un environnement de recette que la façade Railway écrase une adresse forgée par le client. Rien de cela n'est livré.",
    decide: "L'équipe MIP.",
    // D14 : INERTE (règle 3 du § 8.0) — elle figure ici et nulle part dans « Ce qu'il
    // sait faire ». La décision (ADR 0005, points 5 et conséquences), le GeoIP éteint
    // du collector et sa condition d'allumage (.railway/railway.ts), la collecte
    // directe P6b.G (mode d'emploi du relais), la base dans l'image (Dockerfile).
    sources: [
      "D14",
      "docs/architecture/adr/0005-relais-ingestion.md:17",
      "docs/architecture/adr/0005-relais-ingestion.md:21",
      ".railway/railway.ts:232-241",
      "docs/operations/relais-ingestion.md:295-302",
      "services/collector/Dockerfile:103-131",
    ],
  },
  {
    id: "R7",
    titre: "Tickets : le connecteur existe, la cible ITSM n'est pas confirmée",
    manque:
      "Un connecteur GitHub Issues est déployé mais aucune intégration n'est configurée ; le webhook n'a jamais reçu de livraison d'un vrai fournisseur ; résoudre une issue ne ferme pas le ticket. La cible annoncée pour MIP (ServiceNow) n'est pas confirmée.",
    debloque:
      "Confirmer l'outil ITSM cible, ouvrir un espace et ses droits, poser un secret de webhook, décider de la synchronisation des statuts.",
    decide: "La DSI de MIP.",
    // D12 : déployée, INERTE (règle 3 du § 8.0), comme D14 en R6. Aucune intégration
    // configurée : lu en base au relevé de production du 23/09.
    sources: ["D12", "D13", "docs/operations/releve-p0-2026-09-23.md:16"],
  },
  {
    id: "R8",
    titre: "Souveraineté et mise en service chez un client",
    manque:
      "Les trois hébergeurs relèvent du droit américain ; la console n'a pas d'image conteneur, donc « déployable chez vous » n'est pas livrable de bout en bout ; la clé d'ingestion n'est pas exigée par défaut, et six applications sur sept n'en ont aucune, dont celle du client (relevé du 23/09/2026) : l'exiger aujourd'hui couperait leur collecte ; aucune certification.",
    debloque:
      "Choisir un hébergeur relevant du droit européen ; retirer à la console son accès direct à la base, puis la conteneuriser ; provisionner une clé par application (l'outil est livré), la poser dans chaque intégration, puis exiger la clé ; lancer une démarche de certification si un appel d'offres l'exige.",
    decide: "Le responsable du produit et le client.",
    // Hors du document de couverture (qui ne couvre que P5 à P8) : les fichiers du
    // dépôt qui le disent. Droit des hébergeurs ; console sans image, et pourquoi
    // elle attend le retrait de la base (lot C12b) ; clé exigée seulement si
    // REQUIRE_API_KEY vaut « true », six apps sur sept sans clé (relevé du 23/09,
    // R8a), l'outil de provisionnement ; aucune certification acquise.
    sources: [
      "apps/console/lib/specs.ts:98-102",
      "apps/console/lib/specs.ts:207-213",
      "apps/console/components/presentation/Specs.tsx:161-165",
      "apps/console/components/presentation/Specs.tsx:186-195",
      "docs/architecture/console-api/README.md:221",
      "apps/console/lib/ingest.ts:16",
      "docs/operations/releve-p0-2026-09-23.md:14",
      ".railway/railway.ts:221-228",
      "scripts/ops/provisionner-cles.mjs:1-7",
      "docs/CONFORMITE.md:24-26",
      "docs/CONFORMITE.md:198-201",
    ],
  },
  {
    id: "R9",
    titre: "Une chaîne de livraison qui dit vrai",
    manque:
      "Depuis le 24/09/2026, la CI construit le dépôt depuis un clone propre, vérifie les types de l'extension navigateur et joue les deux bancs de mesure, et la procédure de restauration d'une sauvegarde sans ressusciter des données effacées est écrite. Reste que cette procédure n'a jamais été éprouvée et que sa partie « identités » est manuelle ; que les bancs impriment leurs temps sans seuil, si bien que les temps publiés sont remesurés, pas garantis ; et que le JavaScript du backend n'est typé par rien.",
    debloque:
      "Répéter la procédure de restauration sur la branche Neon de répétition, avant d'en avoir besoin.",
    decide: "L'équipe MIP.",
    // D7 (restauration ; le document la dit « non commencée », le runbook l'a écrite
    // le 24/09 sans l'éprouver). La CI : typage de l'extension et limite du backend
    // `.mjs`, construction depuis un dépôt propre, bancs de mesure sans seuil de
    // latence. F1 à F3 ne sont plus citées : ce qu'elles disent manquer est fait.
    sources: [
      "D7",
      ".github/workflows/ci.yml:78-93",
      ".github/workflows/ci.yml:102-131",
      ".github/workflows/ci.yml:462-481",
      "docs/operations/runbook.md:113-115",
      "docs/operations/runbook.md:146",
    ],
  },
  {
    // AJOUTÉ LE 24/09/2026, décision du responsable du produit : la base reste sur
    // l'offre gratuite, en mode dégradé, et la vitrine doit le dire. Ce n'est pas
    // un manque du document de couverture (qui ne couvre que P5 à P8) : les
    // sources sont les fichiers qui règlent et expliquent la cadence ralentie.
    id: "R10",
    titre: "Une base dimensionnée pour un vrai produit",
    manque:
      "La base tourne sur l'offre gratuite de Neon : 100 heures de calcul par mois. Son épuisement a coupé la production du 24 septembre au 1er octobre 2026 : passé le quota, le calcul reste suspendu jusqu'au mois suivant. Pour tenir, les tâches planifiées et la livraison des alertes passent toutes les 15 minutes au lieu de 5 : une alerte part jusqu'à 15 minutes après sa cause. La collecte continue d'un vrai site suffirait à épuiser le quota, et l'offre plafonne aussi le stockage à 0,5 Go, déjà occupés à 60 % le 24/09/2026.",
    debloque:
      "Passer la base sur une offre payante (de l'ordre de 20 à 40 $ par mois avec tous les services), puis remettre les cadences à 5 minutes et la livraison à 15 secondes : deux variables, sans changement de code.",
    decide: "Le responsable du produit : c'est une ligne de budget.",
    // Le calcul (quota, veille à 5 min, CU-h par cadence) et le réglage ; la
    // vitrine lit la cadence effective publiée par le scheduler (etat-latence).
    sources: [
      "services/scheduler/README.md:28-41",
      "packages/backend/jobs/cadence.mjs:6-26",
      "apps/console/lib/etat-latence.ts:20-28",
    ],
  },
];

/**
 * Les lignes du document de couverture qu'un point cite : ses pastilles, dans
 * l'ordre des sources. Une source « chemin:ligne » n'en est pas une ; un
 * identifiant inconnu du document non plus (le contrôle n° 4 le refuse en amont).
 */
export function lignesCitees(point: PointReste): Capacite[] {
  return point.sources.flatMap((source) => {
    const capacite = capaciteParId(source);
    return capacite ? [capacite] : [];
  });
}
