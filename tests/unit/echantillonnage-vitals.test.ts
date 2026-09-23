// Lot 3 — les deux biais de mesure, findings 1.5 et 2.4 de l'audit externe.
//
// Ils vont dans des sens OPPOSÉS, ce qui explique qu'aucun n'ait sauté aux yeux :
// la duplication des rapports CLS/INP rend le p75 optimiste, l'échantillonnage
// biaisé-erreurs le rend pessimiste. Se compenser n'est pas être juste.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — module .mjs sans déclaration de types
import { tauxErreurs, tauxPrincipal } from "../../packages/backend/shared/otlp.mjs";
import { noticeEchantillonnage } from "../../apps/console/lib/queries-summary";

const RACINE = join(__dirname, "..", "..");
const lire = (rel: string) => readFileSync(join(RACINE, rel), "utf8");
const V58 = lire("packages/db/sql/migration-v58.sql");
const PG = lire("packages/backend/lib/pg-ingest.mjs");
const OTLP = lire("packages/backend/shared/otlp.mjs");
const SUMMARY = lire("apps/console/lib/queries-summary.ts");

/** La probabilité d'inclusion, telle que le SQL de v58 la calcule. */
const poids = (sr: number, esr: number, erreur: boolean) =>
  erreur ? 1 / (sr + (1 - sr) * esr) : 1 / sr;

// ══════════════════ 1.5 — un rapport par métrique et par page ═════════════════

describe("CLS et INP ne comptent plus qu'une fois par chargement", () => {
  it("l'ingestion garde webvital.id, qu'elle jetait", () => {
    // Le SDK l'émettait DÉJÀ, avec un commentaire disant qu'il sert à ne pas
    // double-compter. L'information n'arrivait simplement jamais en base.
    expect(lire("packages/rum-sdk/src/vitals.ts")).toContain('"webvital.id": metric.id');
    expect(OTLP).toContain('metric_uid: a["webvital.id"]');
  });

  it("l'index d'unicité est PARTIEL — l'historique sans identifiant en est exclu", () => {
    expect(V58).toMatch(/create unique index if not exists uq_metric_report/);
    expect(V58).toContain("where metric_uid is not null");
  });

  it("l'écriture se fait en DEUX passes, et pas par élégance", () => {
    // PostgreSQL n'accepte qu'une clause `on conflict` par ordre. Mélanger les
    // lignes avec et sans metric_uid ferait échouer les secondes sur l'unicité
    // de span_id — donc avorter TOUTE la transaction, un lot entier perdu.
    expect(PG).toContain("on conflict (session_id, name, metric_uid) where metric_uid is not null");
    expect(PG).toContain("on conflict (span_id) do nothing");
    const f = PG.slice(PG.indexOf("async function ecrireMetriques"));
    expect(f).toContain("consolidées.filter((m) => m.metric_uid)");
    expect(f).toContain("consolidées.filter((m) => !m.metric_uid)");
  });

  it("retient le MAXIMUM, pas « le dernier arrivé »", () => {
    // Les cinq vitals sont monotones croissantes sur la vie d'une page. Le
    // maximum donne le même résultat que « le dernier » quand les lots arrivent
    // dans l'ordre, et reste juste quand la file de rejeu les désordonne.
    expect(PG).toContain("value  = greatest(rum_metric.value, excluded.value)");
    expect(PG).not.toContain("value = excluded.value");
  });
});

// ═══════════════════ 2.4 — le poids, et pourquoi 1/taux est faux ══════════════

describe("la probabilité d'inclusion n'est pas le taux d'échantillonnage", () => {
  it("une session SANS erreur n'apparaît qu'avec la probabilité sampleRate", () => {
    expect(poids(0.1, 1, false)).toBeCloseTo(10);
  });

  it("une session AVEC erreur apparaît bien plus souvent, donc pèse moins", () => {
    // sr + (1-sr)·esr = 0,1 + 0,9 = 1 : elle est certaine d'être collectée.
    expect(poids(0.1, 1, true)).toBeCloseTo(1);
  });

  it("LA FORMULE DE L'AUDIT laisse le défaut intact — démonstration", () => {
    // 100 sessions réelles, 1 en erreur → 1 % d'erreur.
    // Échantillon observé à sr=0,1 : la session en erreur + ~10 saines.
    const observees = { erreur: 1, saines: 10 };

    const naif = 1 / 0.1; // ce que propose le rapport : 1 / sample_rate
    const tauxNaif = (observees.erreur * naif) / ((observees.erreur + observees.saines) * naif);
    // Multiplier numérateur ET dénominateur par la même constante ne corrige rien.
    expect(tauxNaif).toBeCloseTo(1 / 11, 3);
    expect(tauxNaif * 100).toBeGreaterThan(9); // ≈ 9,1 %, soit le défaut d'origine

    const juste =
      (observees.erreur * poids(0.1, 1, true)) /
      (observees.erreur * poids(0.1, 1, true) + observees.saines * poids(0.1, 1, false));
    expect(juste * 100).toBeCloseTo(1, 1); // ≈ 1 %, la vérité
  });

  it("keepOnError:false (esr = 0) redevient un échantillonnage uniforme", () => {
    expect(poids(0.1, 0, true)).toBeCloseTo(10);
    expect(poids(0.1, 0, false)).toBeCloseTo(10);
  });

  it("sans échantillonnage, le poids vaut 1 — rien ne bouge pour l'existant", () => {
    expect(poids(1, 1, true)).toBe(1);
    expect(poids(1, 1, false)).toBe(1);
  });

  it("le SQL de la colonne générée dit la MÊME chose que ce test", () => {
    expect(V58).toContain("sample_rate + (1 - sample_rate) * error_sample_rate");
    expect(V58).toContain("generated always as");
    expect(V58).toContain("stored");
  });
});

describe("les deux lecteurs de taux ne se valent pas, et c'est le point", () => {
  it("le taux principal REFUSE zéro — un poids infini ferait exploser les volumes", () => {
    expect(tauxPrincipal(0)).toBe(1);
    expect(tauxPrincipal("0")).toBe(1);
    expect(tauxPrincipal(0.1)).toBe(0.1);
  });

  it("le taux biaisé-erreurs ACCEPTE zéro — c'est keepOnError:false", () => {
    // Le confondre avec « absent » et retomber sur 1 sous-pondérerait les
    // sessions en erreur, donc afficherait un taux d'erreur trop bas.
    expect(tauxErreurs(0)).toBe(0);
    expect(tauxErreurs("0")).toBe(0);
    expect(tauxErreurs(1)).toBe(1);
  });

  it("les deux retombent sur 1 devant n'importe quelle saleté", () => {
    for (const v of [undefined, null, "", "abc", NaN, Infinity, -0.5, 2, "1e400"]) {
      expect(tauxPrincipal(v), String(v)).toBe(1);
      expect(tauxErreurs(v), String(v)).toBe(1);
    }
  });

  it("le SDK émet bien les deux, pas seulement le premier", () => {
    const otel = lire("packages/rum-sdk/src/otel.ts");
    expect(otel).toContain('"mip.sample_rate"');
    expect(otel).toContain('"mip.error_sample_rate"');
  });
});

describe("le drapeau d'erreur ne redescend jamais", () => {
  it("le on conflict cumule au lieu d'écraser", () => {
    // Les spans d'une session arrivent en plusieurs lots. Celui qui portait
    // l'exception peut être suivi d'un lot sans erreur : un `= excluded` ferait
    // changer le poids de la session APRÈS coup, donc bouger des agrégats déjà
    // affichés.
    expect(PG).toContain("has_error = rum_session.has_error or excluded.has_error");
  });

  it("le taux d'échantillonnage, lui, est figé à la première vue", () => {
    // Un lot rejoué par un SDK antérieur ne porte pas l'attribut : l'ingestion
    // retomberait sur 1 et effacerait l'échantillonnage, multipliant d'un coup
    // tous les volumes de la session par son taux.
    const clause = PG.slice(PG.indexOf("export function clauseConflitSession"), PG.indexOf("export async function writeRows"));
    expect(clause).not.toContain("sample_rate = ");
  });
});

// ═════════════ Ce qui est corrigé, ce qui ne l'est pas, et qui le dit ═════════

describe("les volumes sont repondérés", () => {
  it("sessions, pages vues et sessions en erreur somment le poids", () => {
    expect((SUMMARY.match(/sum\(s\.weight\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(SUMMARY).not.toContain("count(distinct p.session_id)::int");
  });

  it("les visiteurs uniques restent un comptage brut, DÉLIBÉRÉMENT", () => {
    // Extrapoler un compte de DISTINCTS demande une estimation de cardinalité,
    // pas une somme de poids : un visiteur revenu dans deux sessions de poids
    // différents n'a pas de poids unique.
    expect(SUMMARY).toContain("count(distinct s.visitor_id)::int");
  });
});

describe("la déclaration d'échantillonnage", () => {
  it("n'existe pas quand il n'y a pas d'échantillonnage", () => {
    for (const v of [1, null, undefined, 0, -1, NaN]) expect(noticeEchantillonnage(v)).toBeNull();
  });

  it("apparaît dès qu'UNE session de la fenêtre a été échantillonnée", () => {
    const n = noticeEchantillonnage(0.1);
    expect(n).not.toBeNull();
    expect(n!.min_sample_rate).toBe(0.1);
  });

  it("nomme ce qui est corrigé ET ce qui ne l'est pas", () => {
    // Le second est le plus important : sans lui, un lecteur suppose que tout
    // l'est. Les deux listes doivent être disjointes, sinon elles se contredisent.
    const n = noticeEchantillonnage(0.25)!;
    expect(n.extrapolated).toContain("error_rate");
    expect(n.not_corrected).toContain("users");
    // Les p75 sont passés de « non corrigé » à « extrapolé » (migration-v61 :
    // somme cumulée sur seaux pondérés). Ce test vérifie le déplacement, pas
    // seulement la présence — une liste dont les deux moitiés contiennent p75
    // passerait le test précédent.
    expect(n.extrapolated).toContain("p75_lcp_ms");
    expect(n.not_corrected.some((c) => c.startsWith("p75"))).toBe(false);
    expect(n.not_corrected).toContain("avg_load_ms");
    expect(n.extrapolated.filter((c) => n.not_corrected.includes(c))).toEqual([]);
  });

  it("dit dans quel SENS le biais restant penche", () => {
    // « non corrigé » ne suffit pas : il faut savoir si on lit trop haut ou trop
    // bas. L'échantillon sur-représente les sessions en erreur, donc les plus
    // lentes — les percentiles penchent du côté pessimiste.
    expect(noticeEchantillonnage(0.1)!.message).toContain("sur-représente");
  });

  it("la documentation d'intégration ne recommande plus l'échantillonnage sans réserve", () => {
    const doc = lire("docs/INTEGRATION.md");
    expect(doc).toContain("sampling_notice");
    expect(doc).toContain("estimation de cardinalité");
  });
});
