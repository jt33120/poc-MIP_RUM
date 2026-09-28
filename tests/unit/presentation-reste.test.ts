// P**.5 — « Ce qui reste pour un vrai outil de RUM » : les points de la vitrine (neuf, puis R10 le 24/09/2026)
// (apps/console/lib/presentation-reste.ts) disent ce que dit le relevé, ni moins ni plus.
//
// Que chaque source EXISTE est le contrôle n° 4 de couverture-site.test.ts. Ici, ce
// que ce contrôle ne peut pas voir : que les textes réécrits suivent leurs sources.
// Chaque test pose d'abord le FAIT tel que sa source l'écrit, puis le texte : si la
// source change, le test rougit sur le fait, et quelqu'un relit le point au lieu de
// laisser la vitrine répéter l'ancien état. Depuis la relecture du 26/09/2026, les
// faits de R1, R2, R6 et R9 se lisent dans des fichiers du dépôt plus récents que le
// document de couverture (relevé de production, CI, ADR, runbook).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { capaciteParId, type Capacite } from "@/lib/couverture";
import { POINTS_RESTE, lignesCitees } from "@/lib/presentation-reste";

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
const RELEVE_P0 = lire("docs/operations/releve-p0-2026-09-23.md");

function ligne(id: string): Capacite {
  const c = capaciteParId(id);
  if (!c) throw new Error(`ligne absente du document : ${id}`);
  return c;
}

describe("les onze points, dans l'ordre fixe du plan", () => {
  it("titres exacts, R1 à R11", () => {
    expect(POINTS_RESTE.map((p) => [p.id, p.titre])).toEqual([
      ["R1", "Une recette sur une vraie application"],
      ["R2", "Reprise de l'historique des erreurs"],
      ["R3", "Source maps dans l'intégration continue du client"],
      ["R4", "Crashes natifs iOS et Android"],
      ["R5", "React Native : une matrice de compatibilité vide"],
      ["R6", "Le pays par adresse IP, éteint tant que la collecte passe par la console"],
      ["R7", "Tickets : le connecteur existe, la cible ITSM n'est pas confirmée"],
      ["R8", "Souveraineté et mise en service chez un client"],
      ["R9", "Une chaîne de livraison qui dit vrai"],
      ["R10", "Une base choisie pour un vrai produit"],
      ["R11", "Les backends au-delà de Node et Python"],
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

  it("R2 dit que son chiffre n'a pas été recontrôlé, comme le document (D9)", () => {
    expect(ligne("D9").limite).toContain("n'ont pas été recontrôlés");
    expect(point("R2").manque).toContain("(chiffre non recontrôlé)");
  });
});

// R10 (24/09/2026, réécrit le 28/09/2026). La base est passée le 27/09 de l'offre
// gratuite à une offre payante à l'usage (ADR 0014, remplacée) ; pour le responsable
// du produit, ce n'est qu'un palier : la base d'un vrai produit se choisira selon le
// standard de la DSI de MIP. Ce qui compte : que l'offre gratuite ne soit plus dite,
// que le manque devienne un choix, que la latence des alertes reste dite, et qui décide.
describe("R10 — une base à choisir avec la DSI de MIP", () => {
  it("suit l'ADR 0014 remplacée : plus d'offre gratuite, un palier payant, les cadences à 15 minutes", () => {
    const adr = lire("docs/architecture/adr/0014-base-gratuite.md");
    expect(adr).toContain("**Statut** : remplacée le 27/09/2026");
    expect(adr).toContain("L'offre Launch n'est qu'un palier.");
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
    expect(point("R1").manque).not.toMatch(/offre gratuite/);
    expect(point("R1").manque).toContain("(voir « Une base choisie pour un vrai produit »)");
  });
});

describe("relecture du 26/09/2026 : les points réécrits suivent leurs sources", () => {
  it("R1 suit le relevé de production lu en base — du trafic arrive, le « 17/09 » est faux", () => {
    // Le fait : le relevé du 23/09 contredit la date reprise par le document.
    expect(RELEVE_P0).toContain("**Faux au 23/09** : `gip-plateforme` a reçu 378 événements, le dernier à 13:01 le jour même");
    expect(RELEVE_P0).toContain('"evenements":378,"dernier":"2026-09-23T13:01:49.972Z"');

    const r1 = point("R1");
    expect(r1.manque).toContain("le relevé lu en base le 23/09/2026 compte 378 événements pour l'application du client, le dernier reçu ce jour-là à 13:01 UTC");
    expect(r1.manque).toContain("Aucun écran n'a été relu sur des données réellement ingérées");
    // L'ancien état, que le relevé a rendu faux.
    expect(affiche("R1")).not.toMatch(/17\/09\/2026 à 17:23|Aucune donnée n'a été ingérée/);
    expect(r1.sources).toContain("docs/operations/releve-p0-2026-09-23.md:13");
  });

  it("R2 suit le registre `schema_migration`, lu en base — v83 n'est plus une déduction", () => {
    const d8 = ligne("D8");
    expect(d8.verdict).toBe("livre_non_deploye");
    expect(d8.limite).toContain("Aucun environnement ne lance l'outil");
    expect(RELEVE_P0).toContain("**Lu en base** : v83 le 18/09 à 11:46");
    expect(RELEVE_P0).toContain('{"filename":"migration-v83.sql","applied_at":"2026-09-18T11:46:47.212Z"');

    const r2 = point("R2");
    expect(r2.manque).toContain("sa migration v83 est appliquée en production : le registre des migrations, lu en base le 23/09/2026, l'inscrit le 18/09/2026 à 11:46 UTC");
    expect(r2.manque).toContain("Aucun environnement ne lance l'outil");
    // Ni l'ancien état, ni l'ancienne réserve, que le relevé a levée.
    expect(affiche("R2")).not.toMatch(/non appliquée|n'est pas appliquée|appliquer la migration|déduit des journaux/i);
    // Ce qu'une reprise demanderait (§ 12.2) : rien côté schéma, lancer l'outil.
    expect(r2.debloque).toContain("plus rien n'est à faire côté schéma");
  });

  it("R9 suit la CI et le runbook — ce qui est fait au passé, la restauration jamais éprouvée", () => {
    const ci = lire(".github/workflows/ci.yml");
    expect(ci).toContain("pnpm --filter extension typecheck");
    expect(ci).toContain("name: Construction depuis un dépôt propre");
    expect(ci).toContain("name: Bancs de mesure (Explorer P6.6, /mobile P7.5)");
    expect(ci).toContain("Aucun seuil de LATENCE");
    expect(ci).toContain("Reste HORS typage, et c'est connu : le JavaScript du backend");
    // Le runbook a changé le 28/09/2026 : la procédure est éprouvée sur la branche de
    // répétition. R9, texte de la vitrine, dit encore « jamais éprouvée » : sa
    // réécriture revient à la vitrine, avec les assertions sur `r9` ci-dessous.
    expect(lire("docs/operations/runbook.md")).toContain("**Procédure éprouvée le 28/09/2026 sur la branche de répétition**");
    expect(ligne("D7").verdict).toBe("non_commence");

    const r9 = point("R9");
    expect(r9.manque).toContain(
      "la CI construit le dépôt depuis un clone propre, vérifie les types de l'extension navigateur et joue les deux bancs de mesure",
    );
    expect(r9.manque).toContain("cette procédure n'a jamais été éprouvée");
    expect(r9.manque).toContain("sans seuil");
    expect(r9.manque).toContain("le JavaScript du backend n'est typé par rien");
    // Les phrases que la CI du 24/09 a rendues fausses.
    expect(affiche("R9")).not.toMatch(
      /ne vérifie pas les types|rouge|échoue sur un dépôt|ne tournent jamais en CI|n'est ni écrite|pas ceux de l'extension/i,
    );
  });

  it("R6 suit l'ADR 0005 et le relevé du 28/09 — collecteur en service, pays seul, collecte directe à faire", () => {
    // 28/09/2026 : l'IaC allume la lecture de `X-Real-IP` pour le seul trafic
    // DIRECT (le dogfooding de la console) ; le relais, lui, ne porte toujours
    // aucune adresse. Le texte de R6 est à relire avec la vitrine.
    expect(lire(".railway/railway.ts")).toContain('GEOIP_IP_SOURCE: "railway"');
    expect(lire("docs/architecture/adr/0005-relais-ingestion.md")).toContain("qui seule permet la géolocalisation par adresse");
    expect(lire("docs/TOPOLOGIE_BACKEND.md")).toContain("**six services en ligne**");
    const r6 = point("R6");
    expect(r6.manque).toContain("Le collecteur est en service depuis le 27/09/2026");
    expect(r6.manque).toContain("le relais ne lui transmet que le pays posé par Vercel, jamais l'adresse");
    expect(affiche("R6")).not.toMatch(/n'est pas en service|Même allumé|passe par Vercel/);
    expect(r6.manque).toContain("Cette résolution ne donne donc aucun pays aujourd'hui.");
    expect(r6.manque).not.toContain("Aucun pays n'est résolu");
    // Le choix est fait : l'ancien « aucun des deux n'est tranché » ne revient pas.
    expect(affiche("R6")).not.toMatch(/n'est tranché|reste à déposer/);
  });

  it("R8 suit le même relevé — six applications sur sept sans clé d'ingestion", () => {
    expect(RELEVE_P0).toContain("**Six applications sur sept n'ont aucune clé**");
    expect(point("R8").manque).toContain("six applications sur sept n'en ont aucune");
    expect(point("R8").debloque).toContain("provisionner une clé par application");
  });
});

describe("les pastilles d'un point : les lignes du document qu'il cite", () => {
  it("dans l'ordre des sources ; une source « chemin:ligne » n'en est pas une", () => {
    const ids = (id: string) => lignesCitees(point(id)).map((c) => c.id);
    expect(ids("R5")).toEqual(["C1", "C2", "C3", "C4", "C9", "C10"]);
    expect(ids("R6")).toEqual(["D14"]);
    // R9 : F1 à F3 ne sont plus citées depuis la relecture du 26/09 (ce qu'elles
    // disaient manquer est fait) ; reste D7, la restauration.
    expect(ids("R9")).toEqual(["D7"]);
    // R1 ne cite que des passages du document, R8 que des fichiers du dépôt.
    expect(ids("R1")).toEqual([]);
    expect(ids("R8")).toEqual([]);
  });

  it("un identifiant inconnu du document ne devient pas une pastille", () => {
    const faux = { ...point("R3"), sources: ["Z9", "D10", "docs/CONFORMITE.md:1"] };
    expect(lignesCitees(faux).map((c) => c.id)).toEqual(["D10"]);
  });

  it("D12 et D14, déployées mais inertes, sont des pastilles de « Ce qui reste » (règle 3 du § 8.0)", () => {
    for (const [id, porteur] of [["D12", "R7"], ["D14", "R6"]] as const) {
      expect(ligne(id).verdict, id).toBe("deploye_non_eprouve");
      expect(lignesCitees(point(porteur)).map((c) => c.id), id).toContain(id);
    }
  });
});
