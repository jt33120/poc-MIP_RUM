// Les agrégats de QUALITÉ : score de santé, heatmap, rollup horaire, SLO.
//
// Ils partagent une forme, et c'est cette forme qui les a fait mentir : un ratio
// « part de ce qui est bon » dont le dénominateur contient des lignes qui ne
// peuvent pas être bonnes, ou un quotient qui, faute de savoir dire « je ne sais
// pas », rend un nombre.
//
// ─────────────────────── 1.2 — le dénominateur trop large ───────────────────────
//
// `rum_metric` ne porte pas que des Core Web Vitals : les phases réseau d'une
// navigation (REDIRECT, DNS, TCP, TLS, REQUEST, RESPONSE) voyagent sur le même
// canal, parce que `rum_metric.name` est du texte libre. Elles n'ont pas de seuil
// Google, donc leur `rating` est NULL — correct, il n'existe pas de « bonne »
// durée de résolution DNS. Mais elles comptaient au dénominateur.
//
// Mesuré sur une base réelle avec les cinq vitals TOUS bons et six phases :
// **50 %** de « good » au lieu de 100 %. Le score suivait le nombre de phases que
// le navigateur du visiteur sait remonter, pas la performance du site.
//
// ─────────────────── 1.9 — le quotient qui ne sait pas se taire ─────────────────
//
// `greatest(count(*), 1)` protège de la division par zéro, mais sur zéro mesure il
// rend 0/1 = 0 : une atteinte de 0 %, donc un budget consommé à 100 %, donc une
// alerte CRITIQUE toutes les heures sur toute app qui dort la nuit. Et le
// diagnostic est inversé — une panne d'ingestion s'annonce comme une régression
// de performance.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CORE_VITALS, THRESHOLDS } from "../../apps/console/lib/rating";

const RACINE = join(__dirname, "..", "..");
const lire = (rel: string) => readFileSync(join(RACINE, rel), "utf8");
const V56 = lire("apps/ingest/sql/migration-v56.sql");

describe("la liste des vitals notables — une seule, des deux côtés", () => {
  it("est DÉRIVÉE des seuils, pas retapée à côté", () => {
    // Si quelqu'un ajoute un vital aux seuils, il entre dans les agrégats sans
    // qu'on ait à y penser. C'est le sens de `Object.keys(THRESHOLDS)`.
    expect([...CORE_VITALS]).toEqual(Object.keys(THRESHOLDS));
  });

  it("contient exactement les cinq Core Web Vitals", () => {
    expect([...CORE_VITALS].sort()).toEqual(["CLS", "FCP", "INP", "LCP", "TTFB"]);
  });

  it("le SQL déclare la MÊME liste que le TypeScript", () => {
    // `mip_core_vitals()` est le miroir SQL. Deux listes qui disent la même chose
    // finissent par diverger — le dépôt l'a payé assez souvent pour qu'on le
    // vérifie plutôt que de l'espérer.
    const m = /select array\[([^\]]+)\]::text\[\]/.exec(V56);
    expect(m, "mip_core_vitals() introuvable dans migration-v56").not.toBeNull();
    const sql = m![1].split(",").map((x) => x.trim().replace(/'/g, ""));
    expect(sql).toEqual([...CORE_VITALS]);
  });
});

describe("les trois agrégations filtrent sur les vitals notables", () => {
  // Trois endroits calculaient le même ratio et se trompaient de la même façon.
  // Corriger l'un des trois aurait donné trois chiffres différents pour la même
  // question, ce qui est pire que trois chiffres également faux.
  // P6.2 : les paramètres sont numérotés par le compilateur du contrat ; la liste
  // reste la constante CORE_VITALS, liée, jamais recopiée dans le SQL.
  it("le score de santé (lib/health.ts)", () => {
    const src = lire("apps/console/lib/health.ts");
    expect(src).toContain("const vitaux = sql.bind(CORE_VITALS);");
    expect(src).toContain("m.name = any(${vitaux}::text[])");
  });

  it("la heatmap d'historique (lib/queries-grid.ts)", () => {
    const src = lire("apps/console/lib/queries-grid.ts");
    expect(src).toContain("const vitaux = sql.bind(CORE_VITALS);");
    expect(src).toContain("m.name = any(${vitaux}::text[])");
  });

  it("le rollup horaire (migration-v56)", () => {
    // Celui-ci alimente la heatmap sur l'historique : sans lui, la correction ne
    // se verrait que sur les heures à venir.
    expect(V56).toContain("m.name = any(mip_core_vitals())");
  });

  it("l'historique déjà agrégé est RECALCULÉ, pas laissé en l'état", () => {
    expect(V56).toMatch(/select refresh_rum_rollups\(24 \* 30\)/);
  });
});

describe("un SLO sans données ne dit rien, plutôt que de dire « mauvais »", () => {
  /** Le corps de slo_status() tel que la migration le redéfinit. */
  const slo = V56.slice(V56.indexOf("create or replace function slo_status"));

  it("n'utilise plus greatest(count(*),1), qui transforme « aucune mesure » en zéro", () => {
    expect(slo).not.toMatch(/greatest\(count\(\*\)\s*,\s*1\)/);
    expect(slo).not.toMatch(/\)\s*,\s*1\)\s*\n\s*else/); // la variante sur les pages vues
  });

  it("rend NULL sur zéro mesure, des deux côtés de la fenêtre", () => {
    // Deux latéraux : la fenêtre du SLO et la dernière heure (fast_burn).
    expect((slo.match(/nullif\(count\(\*\), 0\)/g) ?? []).length).toBe(2);
    // Et les deux dénominateurs de pages vues du cas error_rate.
    expect((slo.match(/nullif\(\(select count\(\*\)/g) ?? []).length).toBe(2);
  });

  // Le piège trouvé EN VÉRIFIANT le correctif sur une base réelle :
  // `greatest(NULL, 0)` rend 0 en PostgreSQL — la fonction ignore les NULL au
  // lieu de les propager. Sans garde explicite, un SLO sans données affichait
  // « budget consommé 0 % », soit l'inverse exact de « je ne sais pas ».
  it("ne laisse pas greatest() retransformer le NULL en zéro sur burned_pct", () => {
    expect(slo).toContain("att.attainment is not null");
  });

  it("le cas error_rate est traité comme les autres", () => {
    // Zéro page vue donnait `1 - 0/1 = 1` : une atteinte PARFAITE pour une
    // application éteinte. Défaut symétrique, moins bruyant, aussi faux.
    expect(slo).toContain("s.metric = 'error_rate'");
    expect(slo).not.toContain("greatest((select count(*) from rum_pageview");
  });
});
