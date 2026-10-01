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
//
// RECETTE DU 26/09/2026. La page est publique : les titres ne portent plus les codes
// de lot (« P8.3 — … »), un renvoi nomme le point par son titre et non par « R10 »,
// et R10 dit le mécanisme du quota (ce qu'un lecteur doit savoir pour décider) sans
// le journal de la coupure en cours ni le montant d'une offre.
//
// ÉTAT DU 28/09/2026. La production a changé les 27 et 28/09 (docs/TOPOLOGIE_BACKEND.md,
// « Relevé du 28/09/2026 ») ; trois points disaient le contraire et sont réécrits :
//   - R10 : la base n'est plus sur l'offre gratuite (offre payante à l'usage depuis le
//     27/09, ADR 0014 remplacée). Ce qui manque n'est plus un budget mais un CHOIX : la
//     base d'un vrai produit, selon le standard de la DSI de MIP ; le palier actuel n'en
//     est pas un. Les cadences restent à 15 minutes. Titre ajusté ;
//   - R6 : le collecteur tourne et reçoit le trafic relayé ; la résolution par IP reste
//     éteinte parce que le relais ne transmet pas l'adresse — il faut la collecte directe ;
//   - R1 : son renvoi à R10 ne parle plus d'offre gratuite.
//
// JOURNÉE DU 28/09/2026. Cinq points étaient faits en tout ou en partie ; le document de
// couverture le dit d'abord (§ 13.4, et en place sur ses lignes), sans changer de verdict.
// La règle de cette partie tranche entre retirer et réduire : ne pas maintenir une limite
// levée, ne pas minimiser celle qui reste. Un point entièrement fait sort ; un point fait
// en partie ne dit plus que ce qui reste. Les identifiants ne sont PAS renumérotés : la
// page n'en affiche aucun (le rang visible vient de l'ordre), un renvoi « (voir R3) »
// d'une carte vise son identifiant, et un trou dans la suite ne se voit pas.
//   - R2 (reprise de l'historique) SORT : exécutée en production le 28/09/2026, sans
//     échec, et plus rien ne la bloque (lignes D8, D9). Il passe dans POINTS_FAITS, que
//     la page rend sous la liste (« Sortis de la liste ») : l'annexe veut, pour CHAQUE
//     ligne du registre, un endroit de la page qui dise son état en français courant
//     (tests/unit/Annexe.test.tsx), et D8 et D9 n'en auraient plus ;
//   - R1 ne dit plus que l'écran mobile : les écrans web ont été relus sur le trafic de
//     l'application du client, quatre défauts corrigés (§ 6.2, § 13.4). Pastille C7 ;
//   - R6 ne dit plus que les sites des clients : le GeoIP résout le pays de la collecte
//     directe du capteur de la console. D14 n'est plus inerte (elle a sa carte, K16) ;
//     R6 la cite encore, pour ce qui reste ;
//   - R9 : la restauration est éprouvée sur la branche de répétition ; restent sa partie
//     « identités », les bancs sans seuil et le JavaScript du backend ;
//   - R11 ne dit plus que Go, PHP et Ruby : les agents Python, Java et .NET sont
//     éprouvés en production (docs/capteurs-serveur.md § 2, depuis le 29/09/2026 ;
//     avant, docs/INTEGRATION.md § 10).
//   - R7 (les tickets) SORT le 29/09/2026 : la fonctionnalité est retirée par décision du
//     propriétaire du produit (lignes D12, D13, passées « non retenu »). Plus rien à
//     débloquer : il passe dans POINTS_FAITS, pour que D12 et D13 gardent un endroit de
//     la page qui dise leur état.
// R3, R4, R5, R8 et R10 dépendent de tiers et n'ont pas bougé.
import { capaciteParId, type Capacite } from "./couverture";
import type { PointFait, PointReste } from "./couverture-controle";

/** Le document de couverture, tel que les sources le citent. */
const DOC = "docs/RUM_PARITY_STATUS.md";

/**
 * Les neuf points, dans l'ordre fixe du plan (R10 ajouté le 24/09/2026, R11 le 27/09/2026 ;
 * R2 retiré le 28/09/2026, fait ; R7 le 29/09/2026, fonctionnalité retirée).
 */
export const POINTS_RESTE: readonly PointReste[] = [
  {
    id: "R1",
    titre: "Une recette de l'écran mobile sur une vraie application",
    manque:
      "Le 28/09/2026, des écrans ont été relus pour la première fois sur le trafic réel de l'application du client : vue d'ensemble, erreurs, un tableau de bord, l'Explorer ; quatre défauts trouvés et corrigés le jour même. L'écran mobile, lui, n'a encore reçu aucune donnée réelle : aucune application React Native n'émet. Et le registre ne tire encore de cette recette aucun verdict.",
    debloque:
      "Faire émettre une application React Native de recette, puis relire l'écran mobile sur ses sessions ; consigner la recette dans un nouveau relevé du registre.",
    decide: "L'équipe MIP.",
    // RÉDUIT LE 28/09/2026 à ce qui reste. § 6.2 (la limite, et ce qui l'a levée en
    // partie), § 13.4 (la recette, ses quatre défauts, l'écran mobile), la vue
    // d'ensemble qui disait « jamais rien reçu » ; la fin du § 13.4 (aucun verdict ne
    // porte encore la recette). C7 : l'écran mobile, qu'aucune session réelle n'alimente.
    sources: [
      `${DOC}:297-304`,
      `${DOC}:743-756`,
      "apps/console/lib/vue-ensemble.ts:59-62",
      `${DOC}:780-781`,
      "C7",
    ],
  },
  {
    id: "R3",
    titre: "Source maps dans l'intégration continue du client",
    manque: "Jamais entamé.",
    debloque:
      "Un accès au dépôt et au build du client, un identifiant d'application, une convention de release, un jeton d'upload rangé dans les secrets de sa CI.",
    decide: "Le client.",
    sources: ["D10"],
  },
  {
    id: "R4",
    titre: "Crashes natifs iOS et Android",
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
    titre: "Le pays par adresse IP sur les sites des clients",
    manque:
      "Depuis le 28/09/2026, le collecteur déduit le pays de l'adresse IP pour la collecte que lui envoie directement le capteur de la console, et pour elle seule. Les sites des clients passent encore par le relais de la console, qui ne transmet que le pays posé par Vercel, jamais l'adresse : pour eux, la résolution ne donne aucun pays.",
    debloque:
      "Ouvrir la collecte directe aux sites dont la politique de sécurité du contenu (CSP) le permet, une fois que le relais porte tout le trafic depuis 7 jours sans repli ; relire la conformité avant d'élargir le périmètre.",
    decide: "L'équipe MIP.",
    // RÉDUIT LE 28/09/2026 aux sites des clients. D14 n'est plus inerte (elle a sa carte,
    // K16) ; R6 la cite pour ce qui reste. Le périmètre allumé et sa preuve (§ 13.4 ; la
    // conformité) ; ce que le relais transmet (liste exacte d'en-têtes, sans adresse) ; la
    // décision (ADR 0005) ; l'IaC du collecteur ; la suite pour les clients et la
    // conformité à relire (mode d'emploi du relais).
    sources: [
      "D14",
      `${DOC}:763-769`,
      "docs/CONFORMITE.md:132-141",
      "apps/console/lib/ingest-relay.ts:173-181",
      "docs/architecture/adr/0005-relais-ingestion.md:21",
      ".railway/railway.ts:232-241",
      "docs/operations/relais-ingestion.md:296-301",
      "docs/operations/relais-ingestion.md:413-416",
    ],
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
      "apps/console/lib/specs.ts:101-105",
      "apps/console/lib/specs.ts:247-253",
      "apps/console/components/presentation/Specs.tsx:167-171",
      "apps/console/components/presentation/Specs.tsx:192-201",
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
      "Depuis le 24/09/2026, la CI construit le dépôt depuis un clone propre, vérifie les types de l'extension navigateur et joue les deux bancs de mesure ; depuis le 28/09/2026, la restauration d'une sauvegarde sans ressusciter des données effacées est éprouvée sur une branche de répétition, avec 24 heures d'historique restaurable. Restent sa partie « identités », manuelle et jamais éprouvée ; des bancs qui impriment leurs temps sans seuil, si bien que les temps publiés sont remesurés, pas garantis ; et le JavaScript du backend n'est typé par rien.",
    debloque:
      "Éprouver la partie « identités » sur la branche de répétition, avec une identité effacée ; donner un seuil aux bancs de mesure ; étendre le typage au JavaScript du backend.",
    decide: "L'équipe MIP.",
    // D7 (restauration : « non commencée » au relevé, écrite le 24/09, éprouvée le 28/09
    // sur la répétition — la ligne le dit en place, le verdict attend un relevé). Le
    // runbook : l'exercice, la fenêtre de 24 heures, la partie « identités » manuelle et
    // ce qui n'a pas été éprouvé. La CI : typage de l'extension et limite du backend
    // `.mjs`, construction depuis un dépôt propre, bancs de mesure sans seuil de latence.
    sources: [
      "D7",
      `${DOC}:770-773`,
      "docs/operations/runbook.md:115",
      "docs/operations/runbook.md:119",
      "docs/operations/runbook.md:177",
      "docs/operations/runbook.md:206-212",
      ".github/workflows/ci.yml:78-93",
      ".github/workflows/ci.yml:102-131",
      ".github/workflows/ci.yml:462-481",
    ],
  },
  {
    // AJOUTÉ LE 24/09/2026, décision du responsable du produit : la base restait sur
    // l'offre gratuite, en mode dégradé, et la vitrine devait le dire. Ce n'est pas
    // un manque du document de couverture (qui ne couvre que P5 à P8) : les
    // sources sont les fichiers qui règlent et expliquent la cadence ralentie.
    // RÉÉCRIT LE 28/09/2026 : la base est passée le 27/09 sur une offre payante à
    // l'usage (ADR 0014, section « Remplacée le 27/09/2026 »). Le responsable du produit
    // ne la tient pas pour la base d'un vrai produit : elle se choisira selon ce
    // qu'utilise la DSI de MIP. Pas de nom d'hébergeur ni de montant ici (recette du
    // 26/09) : le tableau d'hébergement dit qui héberge.
    id: "R10",
    titre: "Une base choisie pour un vrai produit",
    manque:
      "Depuis le 27/09/2026, la base n'est plus sur une offre gratuite : elle est passée sur une offre payante à l'usage, au calcul plafonné, mise en veille entre deux passages. Ce n'est qu'un palier, pas un choix : la base d'un vrai produit reste à choisir selon le standard de la DSI de MIP. En attendant, les tâches planifiées et la livraison des alertes passent toujours toutes les 15 minutes au lieu de 5 : une alerte part jusqu'à 15 minutes après sa cause.",
    debloque:
      "Connaître la base qu'exploite la DSI de MIP et y installer celle du produit, dimensionnée pour le trafic d'un vrai site ; puis remettre les cadences à 5 minutes et la livraison à 15 secondes : deux réglages, sans changement de code.",
    decide: "La DSI de MIP et le responsable du produit.",
    // La nouvelle situation et la décision qui reste (ADR 0014, section finale) ; les
    // cadences posées par l'IaC ; le mécanisme de la veille et le réglage (README du
    // scheduler, cadence.mjs) ; la vitrine lit la cadence effective (etat-latence).
    sources: [
      "docs/architecture/adr/0014-base-gratuite.md:40-54",
      ".railway/railway.ts:365",
      ".railway/railway.ts:402",
      "services/scheduler/README.md:28-41",
      "packages/backend/jobs/cadence.mjs:6-26",
      "apps/console/lib/etat-latence.ts:20-29",
    ],
  },
  {
    // AJOUTÉ LE 27/09/2026 ; RÉÉCRIT LE 28/09/2026 après la PR #338 (la collecte accepte
    // OTLP en protobuf) ; RÉDUIT LE MÊME JOUR après la PR #342 : les agents officiels
    // Python, Java et .NET sont éprouvés en production (docs/capteurs-serveur.md § 2,
    // tableau par langage, depuis le 29/09/2026). RÉDUIT LE 29/09/2026 : FastAPI et Node
    // (traces) éprouvés en production sous leur agent officiel (C5, C6). Ce qui reste :
    // Go, PHP et Ruby. RÉDUIT LE 01/10/2026 : les trois sont éprouvés EN LOCAL (conteneurs
    // jetables, collecteur de développement, base locale ; corps capturés et rejoués par
    // tests/integration/otlp-agents-go-php-ruby-sql.test.ts). Local n'est pas production,
    // la barre des autres langages : le point reste, pour la production seule.
    id: "R11",
    titre: "Les backends Go, PHP et Ruby, éprouvés en local, pas en production",
    manque:
      "La collecte accepte depuis le 28/09/2026 le format des agents OpenTelemetry officiels, et ceux de Python, Java et .NET ont été éprouvés en production le même jour : un vrai serveur, configuré par la seule documentation, a envoyé traces, journaux et erreurs. Le 29/09/2026, FastAPI sous l'agent Python et, pour les traces, Node ont suivi. Le 01/10/2026, Go, PHP et Ruby ont été éprouvés en local : spans, sous-appels et exceptions rattachés à la session (journaux pour PHP), corps rejoués en test. Aucun agent Go, PHP ou Ruby n'a encore envoyé à la collecte de production.",
    debloque:
      "Brancher sur la collecte de production un vrai backend de chacun des trois langages, Go, PHP et Ruby, sous son agent officiel.",
    decide: "L'équipe MIP.",
    sources: [
      "C5",
      "C6",
      "packages/backend/shared/otlp-corps.mjs:10-21",
      "docs/capteurs-serveur.md:51-60",
      "tests/integration/otlp-protobuf-agent-sql.test.ts:1-12",
      "tests/integration/otlp-agents-go-php-ruby-sql.test.ts:1-20",
      `${DOC}:774-778`,
    ],
  },
];

/**
 * Les points sortis de la liste parce qu'ils sont faits, dans l'ordre où ils en sont
 * sortis. Une phrase datée chacun, sourcée comme un point (contrôle n° 4).
 */
export const POINTS_FAITS: readonly PointFait[] = [
  {
    // SORTI LE 28/09/2026. La ligne D9 (« depuis le relevé ») et le § 13.4 : la reprise
    // exécutée, ses chiffres lus en base (`backfill_run`), le « ≈ 97 lignes » faux. D8 :
    // l'outil reste une ligne de commande, sans écran.
    id: "R2",
    titre: "Reprise de l'historique des erreurs",
    fait:
      "Exécutée en production le 28/09/2026 sur les données du 30/08 au 28/09, après une répétition : 143 686 lignes manquaient à l'index des signaux, surtout des appels serveur, et non environ 97 comme estimé le 18/09. Aucun échec. L'outil reste une ligne de commande, lancée depuis un poste, sans écran.",
    sources: ["D8", "D9", `${DOC}:191-192`, `${DOC}:757-762`],
  },
  {
    // SORTI LE 29/09/2026. Les lignes D12 et D13, passées « non retenu » : la décision du
    // propriétaire du produit y est datée et citée.
    id: "R7",
    titre: "Tickets depuis une issue",
    fait:
      "Retirés le 29/09/2026 par décision du propriétaire du produit : le connecteur GitHub Issues, sa file d'envoi, son webhook entrant et le lien de ticket manuel ont quitté la console, les services et la base. Aucune intégration n'avait été configurée.",
    sources: ["D12", "D13", `${DOC}:195-196`],
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
