// Partie 3 de la vitrine — « Ce qui reste pour un vrai outil de RUM » (plan § 8.2,
// points R1 à R9 ; rendu par components/presentation/Reste.tsx).
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
// RELEVÉ DU 23/09/2026 (P**.10). Trois textes du plan ne tiennent plus et ont été
// réécrits depuis le document, pas recopiés du plan :
//   - R2 disait la migration de la reprise « non appliquée en production ». Le
//     document établit que v83 l'est, par DÉDUCTION des journaux de déploiement,
//     sans lecture de la base (ligne D8, § 2, § 12.2) : le texte garde ce degré de
//     certitude. Ce qui manque encore n'est plus le schéma, c'est l'exécution.
//   - R9 disait « la CI ne vérifie pas les types » et « deux suites SQL […] dont une
//     est rouge ». F2 est passée « déployé, non éprouvé » : la CI type les SDK et
//     l'agent Node (#213) et la console (#217), pas l'extension ; la suite rouge
//     (fenêtre v82→v83) est réparée et jouée en CI. Restent les bancs hors CI, la
//     construction depuis un dépôt propre, l'extension, la restauration (F1–F3, D7,
//     § 11).
//   - R6 finissait par « Aucun pays n'est résolu aujourd'hui », qui se lisait comme
//     « aucun pays du tout », alors que le pays estimé existe (§ 6.4). Le sujet est
//     désormais la résolution par base IP→pays, comme dans la ligne D14.
// Les six autres points sont les textes du plan : leurs lignes du document sont
// identiques d'un relevé à l'autre, et R8, qui n'en cite aucune, a été relu dans
// les fichiers qu'il cite. Les numéros de ligne cités hors du document ont été
// relevés à nouveau (ils avaient bougé depuis le commit 322c9a7 du plan).
import { capaciteParId, type Capacite } from "./couverture";
import type { PointReste } from "./couverture-controle";

/** Le document de couverture, tel que les sources le citent. */
const DOC = "docs/RUM_PARITY_STATUS.md";

/** Les neuf points, dans l'ordre fixe du plan. */
export const POINTS_RESTE: readonly PointReste[] = [
  {
    id: "R1",
    titre: "Une recette sur une vraie application",
    manque:
      "Aucune donnée n'a été ingérée depuis les déploiements ; le dernier événement reçu date du 17/09/2026 à 17:23, d'après le journal de livraison (non recontrôlé).",
    debloque:
      "Réactiver un émetteur sur une application de recette, attendre quelques centaines d'événements, puis relire les erreurs, l'Explorer, un tableau de bord et l'écran mobile.",
    decide: "L'équipe MIP ; c'est le point le moins coûteux.",
    // § 6.2 (aucune recette, date reprise sans recontrôle) ; § 11, étape 1.
    sources: [`${DOC}:295-308`, `${DOC}:560-563`],
  },
  {
    id: "R2",
    titre: "P8.3 — Reprise de l'historique",
    manque:
      "L'outil de reprise est livré et testé (dry-run, vérification), et sa migration v83 est appliquée en production : c'est déduit des journaux de déploiement, pas lu en base. Aucun environnement ne lance l'outil, qui est une ligne de commande, et son exécution en production a été écartée le 18/09/2026 : environ 97 lignes étaient concernées (chiffre non recontrôlé).",
    debloque:
      "Rien n'est obligatoire. Si une reprise redevient nécessaire, plus rien n'est à faire côté schéma : il reste à lancer l'outil sur la base de production, depuis un poste qui y a accès.",
    decide: "Le responsable du produit.",
    // D8 (v83 appliquée, déduite des journaux ; aucun environnement ne lance l'outil),
    // D9 (décision du 18/09, ≈ 97 lignes non recontrôlées, poste de livraison refusé
    // par la base) ; § 10 (seul point fermé par une décision) ; § 12.2 (« rien côté
    // schéma, seulement lancer l'outil »).
    sources: ["D8", "D9", `${DOC}:546-548`, `${DOC}:611-631`],
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
      "La résolution est déployée dans l'image Railway, mais le trafic entre par la route de la console sur Vercel, qui ne l'appelle pas ; la base elle-même reste à déposer. Cette résolution ne donne donc aucun pays aujourd'hui.",
    debloque:
      "Choisir entre un collecteur backend public et une résolution depuis la console. Aucun des deux n'est tranché.",
    decide: "L'équipe MIP.",
    // D14 : déployée, INERTE (règle 3 du § 8.0) — elle figure ici et nulle part dans
    // « Ce qu'il sait faire ». § 11, étape 2 ; la topologie, section GeoIP.
    sources: ["D14", `${DOC}:564-566`, "docs/TOPOLOGIE_BACKEND.md:112-123"],
  },
  {
    id: "R7",
    titre: "Tickets : le connecteur existe, la cible ITSM n'est pas confirmée",
    manque:
      "Un connecteur GitHub Issues est déployé mais aucune intégration n'est configurée ; le webhook n'a jamais reçu de livraison d'un vrai fournisseur ; résoudre une issue ne ferme pas le ticket. La cible annoncée pour MIP (ServiceNow) n'est pas confirmée.",
    debloque:
      "Confirmer l'outil ITSM cible, ouvrir un espace et ses droits, poser un secret de webhook, décider de la synchronisation des statuts.",
    decide: "La DSI de MIP.",
    // D12 : déployée, INERTE (règle 3 du § 8.0), comme D14 en R6.
    sources: ["D12", "D13"],
  },
  {
    id: "R8",
    titre: "Souveraineté et mise en service chez un client",
    manque:
      "Les trois hébergeurs relèvent du droit américain ; la console n'a pas d'image conteneur, donc « déployable chez vous » n'est pas livrable de bout en bout ; la clé d'ingestion n'est pas encore exigée par défaut ; aucune certification.",
    debloque:
      "Choisir un hébergeur relevant du droit européen, conteneuriser la console, fermer l'ingestion par défaut, lancer une démarche de certification si un appel d'offres l'exige.",
    decide: "Le responsable du produit et le client.",
    // Hors du document de couverture (qui ne couvre que P5 à P8) : les fichiers du
    // dépôt qui le disent. Droit des hébergeurs ; console sans image ; clé exigée
    // seulement si REQUIRE_API_KEY vaut « true » ; aucune certification acquise.
    sources: [
      "apps/console/lib/specs.ts:98-102",
      "apps/console/lib/specs.ts:199-203",
      "apps/console/components/presentation/Specs.tsx:161-165",
      "apps/console/components/presentation/Specs.tsx:186-195",
      "apps/console/lib/ingest.ts:16",
      "docs/CONFORMITE.md:24-26",
      "docs/CONFORMITE.md:198-201",
    ],
  },
  {
    id: "R9",
    titre: "Une chaîne de livraison qui dit vrai",
    manque:
      "La construction échoue sur un dépôt fraîchement installé ; la CI vérifie les types de la console, des SDK et de l'agent Node, mais pas ceux de l'extension navigateur ; les deux bancs de mesure ne tournent jamais en CI, si bien que les temps de réponse publiés ne sont jamais revérifiés ; la restauration d'une sauvegarde sans ressusciter des données effacées n'est ni écrite, ni éprouvée.",
    debloque:
      "Deux corrections courtes pour l'extension : déclarer sa dépendance au SDK, ce qui ordonne la construction, et l'ajouter au typage de la CI. Jouer les bancs de mesure sur une base préparée, dans la CI ou à chaque relevé. Écrire la procédure de restauration.",
    decide: "L'équipe MIP.",
    // F1 (construction, défaut), F2 (typage : « déployé, non éprouvé » depuis le
    // 23/09, limite = l'extension), F3 (bancs hors CI), D7 (restauration) ; § 11,
    // étapes 3 à 5.
    sources: ["F1", "F2", "F3", "D7", `${DOC}:567-575`],
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
