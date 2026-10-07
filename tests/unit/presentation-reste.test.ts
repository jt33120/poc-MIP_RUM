// P**.5 — « Ce qui reste pour un vrai outil de RUM » : les points de la vitrine (neuf, puis R10 le
// 24/09/2026, R11 le 27/09, R2 retiré le 28/09) (apps/console/lib/presentation-reste.ts) disent ce
// que dit le relevé, ni moins ni plus.
//
// Que chaque source EXISTE est le contrôle n° 4 de couverture-site.test.ts. Ici, ce
// que ce contrôle ne peut pas voir : que les textes réécrits suivent leurs sources.
// Chaque test pose d'abord le FAIT tel que sa source l'écrit, puis le texte : si la
// source change, le test rougit sur le fait, et quelqu'un relit le point au lieu de
// laisser la vitrine répéter l'ancien état. Depuis la relecture du 26/09/2026, les
// faits de R1, R6 et R9 se lisent dans des fichiers du dépôt (CI, IaC) et dans les
// lignes de la couverture (`apps/console/lib/couverture.json`). Depuis la
// journée du 28/09/2026, R2 en sort, R1, R6, R9 et R11 sont réduits à ce qui reste.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { capaciteParId, type Capacite } from "@/lib/couverture";
import { POINTS_FAITS, POINTS_RESTE, lignesCitees } from "@/lib/presentation-reste";

function point(id: string) {
  const trouve = POINTS_RESTE.find((p) => p.id === id);
  if (!trouve) throw new Error(`point absent : ${id}`);
  return trouve;
}

/** Tout ce que la carte d'un point affiche, d'un seul tenant. */
function affiche(id: string): string {
  const p = point(id);
  return [p.titre, p.manque, p.debloque, p.decide].join(" ");
}

const RACINE = join(__dirname, "..", "..");
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), "utf8");

function ligne(id: string): Capacite {
  const c = capaciteParId(id);
  if (!c) throw new Error(`ligne absente du document : ${id}`);
  return c;
}

describe("les huit points, dans l'ordre fixe du plan", () => {
  it("titres exacts, R1 à R11 sans R2 (fait le 28/09/2026), R7 (tickets retirés le 29/09/2026) ni R6 (fait le 07/10/2026) : les identifiants ne sont pas renumérotés", () => {
    expect(POINTS_RESTE.map((p) => [p.id, p.titre])).toEqual([
      ["R1", "Une recette de l'écran mobile sur une vraie application"],
      ["R3", "Source maps dans l'intégration continue du client"],
      ["R4", "Crashes natifs iOS et Android"],
      ["R5", "React Native : une matrice de compatibilité vide"],
      ["R8", "Souveraineté et mise en service chez un client"],
      ["R9", "Une chaîne de livraison qui dit vrai"],
      ["R10", "Une base choisie pour un vrai produit"],
      ["R11", "Les backends Go, PHP et Ruby, éprouvés en local, pas en production"],
    ]);
  });

  it("recette du 26/09/2026 : ni code de lot dans un titre, ni renvoi par code (« voir R10 »)", () => {
    for (const p of POINTS_RESTE) {
      expect(p.titre, p.id).not.toMatch(/\bP\d+(\.\d+)?\b/);
      expect(affiche(p.id), p.id).not.toMatch(/\(voir R\d+\)/);
    }
  });

  it("chaque point dit ce qui manque, ce qui le débloque et qui décide", () => {
    for (const p of POINTS_RESTE) {
      for (const champ of [p.manque, p.debloque, p.decide]) expect(champ.trim(), p.id).not.toBe("");
    }
  });

  it("R2 (reprise de l'historique) sort : le document dit la reprise exécutée le 28/09/2026 (D9)", () => {
    // Le fait, tel que la ligne D9 et le § 13.4 l'écrivent ; le verdict attend un relevé.
    expect(ligne("D9").verdict).toBe("non_retenu");
    expect(ligne("D9").limite).toContain("**exécutée en production le 28/09/2026**");
    expect(ligne("D9").limite).toContain("0 échec, les deux passages `completed`");
    // Plus rien ne le bloque : aucun point n'en parle, ni ne cite D8 ou D9.
    expect(POINTS_RESTE.map((p) => p.id)).not.toContain("R2");
    // La page le dit encore, sous la liste : une phrase datée, qui cite D8 et D9.
    const r2 = POINTS_FAITS.find((p) => p.id === "R2")!;
    expect(r2.titre).toBe("Reprise de l'historique des erreurs");
    expect(r2.fait).toContain("Exécutée en production le 28/09/2026");
    expect(r2.fait).toContain("143 686 lignes manquaient");
    expect(r2.fait).toContain("et non environ 97 comme estimé le 18/09");
    expect(r2.fait).toContain("L'outil reste une ligne de commande");
    expect(r2.sources).toEqual(expect.arrayContaining(["D8", "D9"]));
    for (const p of POINTS_RESTE) {
      expect(p.sources, p.id).not.toContain("D8");
      expect(p.sources, p.id).not.toContain("D9");
      expect(affiche(p.id), p.id).not.toMatch(/reprise de l'historique|97 lignes/i);
    }
  });
});

// R10 (24/09/2026, réécrit le 28/09/2026). La base est passée le 27/09 de l'offre
// gratuite à une offre payante à l'usage (ADR 0014, remplacée) ; pour le responsable
// du produit, ce n'est qu'un palier : la base d'un vrai produit se choisira selon le
// standard de la DSI de MIP. Ce qui compte : que l'offre gratuite ne soit plus dite,
// que le manque devienne un choix, que la latence des alertes reste dite, et qui décide.
describe("R10 — une base à choisir avec la DSI de MIP", () => {
  it("plus d'offre gratuite, un palier payant, les cadences à 15 minutes", () => {
    expect(lire(".railway/railway.ts")).toContain('SCHEDULER_TICK_MIN: "15"');

    const r10 = point("R10");
    expect(r10.manque).toContain("la base n'est plus sur une offre gratuite");
    expect(r10.manque).toContain("Ce n'est qu'un palier, pas un choix");
    expect(r10.manque).toContain("selon le standard de la DSI de MIP");
    expect(r10.manque).toContain("jusqu'à 15 minutes après sa cause");
    expect(r10.debloque).toContain("sans changement de code");
    expect(r10.decide).toBe("La DSI de MIP et le responsable du produit.");
    // L'ancien état : ni quota, ni coupure mensuelle, ni « ligne de budget ».
    expect(affiche("R10")).not.toMatch(/100 heures|suspendue|quota|budget/);
    // Recette du 26/09/2026 : pas de montant, pas de journal ; l'hébergeur se lit au tableau d'hébergement.
    expect(affiche("R10")).not.toMatch(/\$|octobre|Neon/);
  });

  it("R1 ne renvoie plus à une base « sur une offre gratuite »", () => {
    expect(affiche("R1")).not.toMatch(/offre gratuite/);
  });
});

describe("relecture du 26/09/2026 : les points réécrits suivent leurs sources", () => {
  it("R1 suit la ligne C7 — des écrans relus le 28/09, reste l'écran mobile", () => {
    // Le fait : le document dit la recette commencée, et l'écran mobile sans données réelles.
    expect(ligne("C7").limite).toContain("**aucune session RN réelle ne l'alimente**");

    const r1 = point("R1");
    expect(r1.manque).toContain("des écrans ont été relus pour la première fois sur le trafic réel de l'application du client");
    expect(r1.manque).toContain("quatre défauts trouvés et corrigés le jour même");
    expect(r1.manque).toContain("L'écran mobile, lui, n'a encore reçu aucune donnée réelle");
    // Aucun verdict ne porte encore la recette : un nouveau relevé le fera.
    expect(r1.manque).toContain("le registre ne tire encore de cette recette aucun verdict");
    expect(r1.debloque).toContain("nouveau relevé");
    // L'ancien état, que la recette a rendu faux.
    expect(affiche("R1")).not.toMatch(/Aucun écran n'a été relu|17\/09\/2026 à 17:23|Aucune donnée n'a été ingérée/);
  });

  it("R9 suit la CI et la ligne D7 — ce qui est fait au passé, la restauration éprouvée sauf les identités", () => {
    const ci = lire(".github/workflows/ci.yml");
    expect(ci).toContain("pnpm --filter extension typecheck");
    expect(ci).toContain("name: Construction depuis un dépôt propre");
    expect(ci).toContain("name: Bancs de mesure (Explorer P6.6, /mobile P7.5)");
    expect(ci).toContain("Aucun seuil de LATENCE");
    expect(ci).toContain("Reste HORS typage, et c'est connu : le JavaScript du backend");
    expect(ligne("D7").verdict).toBe("non_commence");
    expect(ligne("D7").limite).toContain("**éprouvée le 28/09/2026 sur la branche de répétition**");

    const r9 = point("R9");
    expect(r9.manque).toContain(
      "la CI construit le dépôt depuis un clone propre, vérifie les types de l'extension navigateur et joue les deux bancs de mesure",
    );
    expect(r9.manque).toContain("la restauration d'une sauvegarde sans ressusciter des données effacées est éprouvée sur une branche de répétition");
    expect(r9.manque).toContain("avec 24 heures d'historique restaurable");
    expect(r9.manque).toContain("Restent sa partie « identités », manuelle et jamais éprouvée");
    expect(affiche("R9")).not.toMatch(/n'a jamais été éprouvée|Répéter la procédure de restauration/);
    expect(r9.manque).toContain("sans seuil");
    expect(r9.manque).toContain("le JavaScript du backend n'est typé par rien");
    // Les phrases que la CI du 24/09 a rendues fausses.
    expect(affiche("R9")).not.toMatch(
      /ne vérifie pas les types|rouge|échoue sur un dépôt|ne tournent jamais en CI|n'est ni écrite|pas ceux de l'extension/i,
    );
  });

  it("R6 sort le 07/10/2026 : la collecte directe des clients est en service, le collecteur y déduit le pays (D14, IaC)", () => {
    // Le fait : l'IaC lit l'adresse du trafic direct ; le code de suivi proposé vise le
    // collector dès que la collecte directe est ouverte ; la ligne D14 le dit en place.
    expect(lire(".railway/railway.ts")).toContain('GEOIP_IP_SOURCE: "railway"');
    expect(lire("apps/console/lib/ingest-endpoint.ts")).toContain('return origineCollecteDirecte() ? "directe" : "console";');
    expect(ligne("D14").limite).toContain("**Depuis le 06/10/2026** : la collecte directe des sites des clients est ouverte");
    expect(ligne("D14").limite).not.toContain("pour eux, toujours aucun pays par adresse");

    expect(POINTS_RESTE.map((p) => p.id)).not.toContain("R6");
    const r6 = POINTS_FAITS.find((p) => p.id === "R6")!;
    expect(r6.titre).toBe("Le pays par adresse IP sur les sites des clients");
    expect(r6.fait).toContain("Depuis le 06/10/2026, le code de suivi proposé aux sites des clients envoie les mesures en direct au collecteur");
    expect(r6.fait).toContain("qui ne transmet que le pays posé par Vercel");
    expect(r6.fait).not.toMatch(/aucun pays|éteint/);
    expect(r6.sources).toContain("D14");
  });

  it("R5 nuancé le 07/10/2026 : le visiteur mobile est persisté si l'application branche un stockage", () => {
    // Le fait : le SDK lit puis écrit l'identité dans le stockage fourni, et retombe en mémoire sans lui.
    const mobile = lire("packages/rum-mobile/src/index.ts");
    expect(mobile).toContain("const record = await persist.chargerIdentite(appId);");
    expect(mobile).toContain('origine = ecrit ? "storage" : "memory";');
    const r5 = point("R5");
    expect(r5.manque).toContain("le visiteur mobile n'est gardé d'un lancement à l'autre que si l'application branche un stockage");
    expect(r5.manque).toContain("sans lui, il est recompté à chaque lancement");
    expect(affiche("R5")).not.toContain("persister l'identifiant du visiteur");
  });

  // Le 29/09/2026, les agents officiels Python, Java et .NET sont éprouvés en production ;
  // le 01/10/2026, Go, PHP et Ruby en local : R11 ne garde que la production.
  it("R11 — Python, Java et .NET éprouvés en production, Go, PHP et Ruby en local", () => {
    expect(lire("tests/integration/otlp-agents-go-php-ruby-sql.test.ts")).toBeTruthy();
    const r11 = point("R11");
    expect(r11.titre).toBe("Les backends Go, PHP et Ruby, éprouvés en local, pas en production");
    expect(r11.manque).toContain("ceux de Python, Java et .NET ont été éprouvés en production le même jour");
    expect(r11.manque).toContain("Le 01/10/2026, Go, PHP et Ruby ont été éprouvés en local");
    expect(r11.manque).toContain("Aucun agent Go, PHP ou Ruby n'a encore envoyé à la collecte de production.");
    expect(r11.sources).toContain("tests/integration/otlp-agents-go-php-ruby-sql.test.ts:1-20");
    // L'ancien état : aucun essai Go, PHP ou Ruby.
    expect(affiche("R11")).not.toContain("Aucun agent Go, PHP ou Ruby n'a encore envoyé de trace");
    expect(r11.manque).toContain("Le 29/09/2026, FastAPI sous l'agent Python et, pour les traces, Node ont suivi.");
    // L'ancien état : Java et .NET n'étaient pas éprouvés.
    expect(affiche("R11")).not.toMatch(/aucun agent Java|Seul le SDK Node officiel a été éprouvé|qu'en test automatique/);
  });

  it("R8 — la clé d'ingestion n'est plus un manque : exigée depuis le 29/09/2026", () => {
    expect(lire(".railway/railway.ts")).toContain('REQUIRE_API_KEY: "true"');
    expect(point("R8").manque).toContain("La clé d'ingestion, elle, est exigée depuis le 29/09/2026");
    // L'ancien état : la clé facultative, six applications sur sept sans clé.
    expect(affiche("R8")).not.toMatch(/six applications sur sept|n'est pas exigée|provisionner une clé/);
  });
});

describe("les pastilles d'un point : les lignes du document qu'il cite", () => {
  it("dans l'ordre des sources ; une source « chemin:ligne » n'en est pas une", () => {
    const ids = (id: string) => lignesCitees(point(id)).map((c) => c.id);
    expect(ids("R5")).toEqual(["C1", "C2", "C3", "C4", "C9", "C10"]);
    // R9 : F1 à F3 ne sont plus citées depuis la relecture du 26/09 (ce qu'elles
    // disaient manquer est fait) ; reste D7, la restauration.
    expect(ids("R9")).toEqual(["D7"]);
    // R1 (28/09/2026) : C7, l'écran mobile qu'aucune session réelle n'alimente ; R8 ne
    // cite que des fichiers du dépôt.
    expect(ids("R1")).toEqual(["C7"]);
    expect(ids("R8")).toEqual([]);
  });

  it("un identifiant inconnu du document ne devient pas une pastille", () => {
    const faux = { ...point("R3"), sources: ["Z9", "D10", "README.md:1"] };
    expect(lignesCitees(faux).map((c) => c.id)).toEqual(["D10"]);
  });

  it("D14 n'est plus une pastille de « Ce qui reste » (R6 fait le 07/10/2026) ; D12 et D13, retirées, sortent de la liste", () => {
    // D14 n'est plus inerte depuis le 28/09/2026 (elle a sa carte, K16) ; R6, qui la
    // citait pour les sites des clients, est sorti de la liste.
    expect(ligne("D14").verdict).toBe("deploye_non_eprouve");
    for (const p of POINTS_RESTE) expect(lignesCitees(p).map((c) => c.id), p.id).not.toContain("D14");
    // Les tickets sont retirés le 29/09/2026 (décision du propriétaire du produit) : D12
    // et D13 passent « non retenu », R7 sort de la liste et dit le retrait, daté.
    for (const id of ["D12", "D13"]) {
      expect(ligne(id).verdict, id).toBe("non_retenu");
      expect(ligne(id).preuve, id).toContain("29/09/2026");
    }
    expect(POINTS_RESTE.map((p) => p.id)).not.toContain("R7");
    const r7 = POINTS_FAITS.find((p) => p.id === "R7")!;
    expect(r7.fait).toContain("Retirés le 29/09/2026");
    expect(r7.sources).toEqual(expect.arrayContaining(["D12", "D13"]));
  });
});
