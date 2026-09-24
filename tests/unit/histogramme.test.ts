// Lot 7 — les percentiles pondérés, par seaux pré-agrégés (migration-v61).
//
// CE QUE CES TESTS DOIVENT PROUVER, ET POURQUOI C'EST INHABITUEL. Le découpage
// en seaux est un format FIGÉ : une ligne écrite dans metric_histogram_hourly ne
// porte plus la valeur d'origine, seulement son index de seau. Changer GAMMA ou
// le plancher ne recalculerait pas l'historique — il le rendrait
// ininterprétable, silencieusement. C'est la raison pour laquelle ce chantier
// avait été différé, et la raison pour laquelle il ne l'est plus : ce fichier
// MESURE ce que le format coûte en exactitude, au lieu de l'affirmer.
//
// Trois familles d'assertions :
//   1. les propriétés du découpage (monotone, borné, sans trou) ;
//   2. l'EXACTITUDE — le percentile par seaux comparé au percentile exact, sur
//      des distributions réalistes, à chaque exécution ;
//   3. le MIROIR SQL — les constantes de mip_seau() lues dans le fichier de
//      migration, pas supposées. L'égalité NUMÉRIQUE des deux implémentations
//      est vérifiée sur un vrai moteur par scripts/verify-histogramme.mjs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GAMMA,
  VALEUR_MIN,
  borneHaute,
  libelleSeau,
  percentileDepuisSeaux,
  seau,
  valeurDuSeau,
} from "../../apps/console/lib/histogramme";

const RACINE = join(__dirname, "..", "..");
const lire = (rel: string) => readFileSync(join(RACINE, rel), "utf8");
const V61 = lire("packages/db/sql/migration-v61.sql");

// ═════════════════════ 1. Les propriétés du découpage ════════════════════════

describe("le découpage en seaux", () => {
  it("est monotone : une valeur plus grande ne tombe jamais dans un seau plus petit", () => {
    // Sans ça, la somme cumulée ne serait pas une distribution cumulée et le
    // percentile n'aurait aucun sens.
    let precedent = -1;
    for (let v = 0.0005; v < 40_000; v *= 1.11) {
      const s = seau(v);
      expect(s).toBeGreaterThanOrEqual(precedent);
      precedent = s;
    }
  });

  it("place chaque valeur DANS les bornes du seau qu'on lui attribue", () => {
    // L'assertion qui rend `libelleSeau` honnête : l'intervalle affiché contient
    // réellement la valeur.
    for (const v of [0.002, 0.05, 1, 120, 2500, 9999, 31_000]) {
      const s = seau(v);
      expect(v).toBeLessThanOrEqual(borneHaute(s) * (1 + 1e-12));
      expect(v).toBeGreaterThan(borneHaute(s - 1) * (1 - 1e-12));
    }
  });

  it("range NaN, zéro et les négatifs dans le seau 0 au lieu de propager une erreur", () => {
    // Un agrégat horaire ne doit pas être emporté par une ligne aberrante.
    for (const v of [NaN, 0, -1, -0.0001, Number.NEGATIVE_INFINITY]) expect(seau(v)).toBe(0);
    expect(seau(Number.POSITIVE_INFINITY)).toBe(0); // non fini : même traitement
  });

  it("rend le MILIEU géométrique, pas la borne haute — l'erreur est symétrique", () => {
    // Rendre la borne haute biaiserait TOUS les percentiles vers le haut d'une
    // largeur de seau. Ici la valeur représentative est strictement à
    // l'intérieur du seau.
    for (const idx of [1, 50, 400, 900]) {
      expect(valeurDuSeau(idx)).toBeGreaterThan(borneHaute(idx - 1));
      expect(valeurDuSeau(idx)).toBeLessThan(borneHaute(idx));
    }
  });

  it("borne l'écart relatif par la demi-largeur d'un seau", () => {
    // La borne théorique annoncée dans l'en-tête du module. On la vérifie, on ne
    // la cite pas : (γ−1)/2 ≈ 1 %.
    const borne = (GAMMA - 1) / 2;
    for (let v = 0.002; v < 30_000; v *= 1.037) {
      expect(Math.abs(valeurDuSeau(seau(v)) - v) / v).toBeLessThanOrEqual(borne);
    }
    // (1,02−1)/2 s'écrit 0,010000000000000009 en binaire : on borne à 1,01 %,
    // pas à 1,00 %, sans quoi le test échouerait sur un artefact de virgule
    // flottante et pas sur une propriété du découpage.
    expect(borne).toBeLessThan(0.0101);
  });

  it("couvre l'échelle réelle du produit — d'un CLS de 0,005 à un TTFB de 30 s", () => {
    // Le plancher n'écrase pas les CLS, et le haut de l'échelle reste dans des
    // index d'entier ordinaires (pas de débordement, pas de table à 10^6 seaux).
    expect(seau(0.005)).toBeGreaterThan(0);
    expect(seau(0.005)).toBeLessThan(seau(0.05));
    expect(seau(30_000)).toBeLessThan(1000);
  });
});

// ═════════════════════════ 2. L'exactitude, mesurée ══════════════════════════

/** Générateur pseudo-aléatoire DÉTERMINISTE : un test d'exactitude qui change de
 *  verdict d'une exécution à l'autre ne prouve rien. */
function alea(graine: number): () => number {
  let x = graine >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

/** Loi normale par Box-Muller, à partir du générateur ci-dessus. */
function normale(r: () => number): number {
  const u = Math.max(r(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/** Percentile EXACT (interpolation linéaire), la référence à battre. */
function percentileExact(valeurs: number[], p: number): number {
  const v = [...valeurs].sort((a, b) => a - b);
  const rang = (v.length - 1) * p;
  const bas = Math.floor(rang);
  const haut = Math.min(bas + 1, v.length - 1);
  return v[bas] + (v[haut] - v[bas]) * (rang - bas);
}

/** Cinq distributions choisies pour ce qu'elles ont de MÉCHANT, pas de moyen. */
const DISTRIBUTIONS: Array<{ nom: string; tirer: (r: () => number) => number }> = [
  // Ce que sont réellement les temps de chargement : log-normales.
  { nom: "LCP log-normale", tirer: (r) => Math.exp(7.6 + 0.55 * normale(r)) },
  { nom: "INP log-normale", tirer: (r) => Math.exp(4.2 + 0.9 * normale(r)) },
  // Petites valeurs : c'est là que le plancher 0,001 pourrait tout écraser.
  { nom: "CLS petites valeurs", tirer: (r) => Math.exp(-4.5 + 1.1 * normale(r)) },
  // Bimodale cache / hors-cache : deux modes séparés d'un facteur 10, le cas où
  // un découpage trop grossier fusionne les deux populations.
  { nom: "TTFB bimodale", tirer: (r) => (r() < 0.6 ? 40 + 15 * normale(r) : 600 + 200 * normale(r)) },
  // Queue lourde : quelques valeurs à 100× la médiane, qui décident du p99.
  { nom: "queue lourde", tirer: (r) => (r() < 0.97 ? 300 * (0.5 + r()) : 20_000 * r()) },
];

const PERCENTILES = [0.5, 0.75, 0.95, 0.99];

describe("le percentile lu sur les seaux vaut le percentile exact", () => {
  it.each(DISTRIBUTIONS)("$nom — écart sous 1 % à tous les percentiles", ({ nom, tirer }) => {
    const r = alea(0x5eed + nom.length);
    const valeurs: number[] = [];
    for (let i = 0; i < 20_000; i++) valeurs.push(Math.max(tirer(r), 1e-6));

    // Les seaux, tels que le SQL les construirait : un poids par valeur.
    const compte = new Map<number, number>();
    for (const v of valeurs) compte.set(seau(v), (compte.get(seau(v)) ?? 0) + 1);
    const seaux = [...compte].map(([bucket, weighted_count]) => ({ bucket, weighted_count }));

    for (const p of PERCENTILES) {
      const exact = percentileExact(valeurs, p);
      const approche = percentileDepuisSeaux(seaux, p)!;
      expect(Math.abs(approche - exact) / exact).toBeLessThanOrEqual(0.01);
    }
  });

  it("ne se contente pas d'être proche : l'écart est bien celui du DÉCOUPAGE", () => {
    // Anti-tautologie. Un découpage 25 fois plus grossier doit FAIRE ÉCHOUER la
    // même comparaison — sinon le test ci-dessus passerait quel que soit GAMMA,
    // et ne prouverait rien du format qu'on fige.
    const r = alea(99);
    const valeurs = Array.from({ length: 20_000 }, () => Math.exp(7.6 + 0.55 * normale(r)));
    const grossier = (v: number) => 1 + Math.floor(Math.log(v / VALEUR_MIN) / Math.log(1.5));
    const milieu = (i: number) => Math.sqrt(VALEUR_MIN * 1.5 ** (i - 1) * (VALEUR_MIN * 1.5 ** i));

    const compte = new Map<number, number>();
    for (const v of valeurs) compte.set(grossier(v), (compte.get(grossier(v)) ?? 0) + 1);
    const total = valeurs.length;
    let cumul = 0;
    let lu = 0;
    for (const [b, w] of [...compte].sort((a, z) => a[0] - z[0])) {
      cumul += w;
      if (cumul >= total * 0.75) {
        lu = milieu(b);
        break;
      }
    }
    expect(Math.abs(lu - percentileExact(valeurs, 0.75)) / percentileExact(valeurs, 0.75)).toBeGreaterThan(0.01);
  });

  it("PONDÈRE réellement : un seau de poids 9 ne pèse pas comme un seau de poids 1", () => {
    // C'est TOUTE la raison d'être de la table. Deux valeurs, l'une portée par
    // une session non échantillonnée (poids 1), l'autre par neuf sessions
    // représentées (poids 9) : le p75 doit tomber du côté lourd.
    const lent = seau(8000);
    const rapide = seau(500);
    const ponderee = percentileDepuisSeaux(
      [
        { bucket: rapide, weighted_count: 9 },
        { bucket: lent, weighted_count: 1 },
      ],
      0.75,
    )!;
    const brute = percentileDepuisSeaux(
      [
        { bucket: rapide, weighted_count: 1 },
        { bucket: lent, weighted_count: 1 },
      ],
      0.75,
    )!;
    expect(ponderee).toBeLessThan(brute);
    expect(ponderee).toBeCloseTo(500, -2);
  });

  it("rend null sur une distribution vide, jamais 0", () => {
    // 0 se lirait comme « LCP parfait ». La distinction n'est pas cosmétique :
    // c'est elle qui empêche une tuile verte sur une app qui n'émet rien.
    expect(percentileDepuisSeaux([], 0.75)).toBeNull();
    expect(percentileDepuisSeaux([{ bucket: 5, weighted_count: 0 }], 0.75)).toBeNull();
  });

  it("est SOMMABLE : deux heures concaténées valent les deux heures fusionnées", () => {
    // La propriété qui autorise à lire n'importe quelle fenêtre sans relire les
    // lignes brutes — et que les comptages de distincts n'ont PAS.
    const r = alea(7);
    const h1 = Array.from({ length: 5000 }, () => Math.exp(7 + 0.6 * normale(r)));
    const h2 = Array.from({ length: 5000 }, () => Math.exp(7.9 + 0.4 * normale(r)));
    const seauxDe = (vs: number[]) => {
      const m = new Map<number, number>();
      for (const v of vs) m.set(seau(v), (m.get(seau(v)) ?? 0) + 1);
      return [...m].map(([bucket, weighted_count]) => ({ bucket, weighted_count }));
    };
    const somme = percentileDepuisSeaux([...seauxDe(h1), ...seauxDe(h2)], 0.75)!;
    const fusion = percentileDepuisSeaux(seauxDe([...h1, ...h2]), 0.75)!;
    expect(somme).toBe(fusion);
  });
});

// ═══════════════════════════ 3. Le miroir SQL ════════════════════════════════

describe("mip_seau() en SQL et seau() en TypeScript décrivent la même formule", () => {
  it("porte les MÊMES constantes, lues dans la migration", () => {
    // Deux implémentations d'une même formule finissent par diverger. Celle-ci
    // ne peut plus le faire en silence : les constantes du SQL sont extraites du
    // fichier et comparées aux constantes du module.
    const fn = V61.slice(V61.indexOf("create or replace function mip_seau"));
    const corps = fn.slice(0, fn.indexOf("$$;"));
    const nombres = [...corps.matchAll(/[\d]+\.[\d]+/g)].map((m) => Number(m[0]));
    expect(nombres).toContain(VALEUR_MIN);
    expect(nombres).toContain(GAMMA);
    // La forme, pas seulement les nombres : 1 + floor(ln(v/min)/ln(γ)).
    expect(corps.replace(/\s+/g, " ")).toContain("1 + floor(ln(v / 0.001) / ln(1.02))");
  });

  it("traite le plancher, NULL et NaN comme le TypeScript", () => {
    // Les trois cas où deux implémentations « équivalentes » divergent le plus
    // souvent. `not (v = v)` est le test de NaN en SQL — sans lui, la comparaison
    // `v <= 0.001` serait fausse pour NaN et le seau partirait en négatif.
    const corps = V61.slice(V61.indexOf("create or replace function mip_seau"));
    expect(corps).toContain("v is null or v <= 0.001 or not (v = v) then 0");
    expect(seau(VALEUR_MIN)).toBe(0);
    expect(seau(NaN)).toBe(0);
  });

  it("est déclarée immutable — sinon elle ne pourrait pas indexer ni s'agréger vite", () => {
    expect(V61).toContain("language sql immutable parallel safe");
  });

  it("est comparée NUMÉRIQUEMENT par une suite qui exige un vrai moteur", () => {
    // Ce fichier ne peut pas exécuter du SQL. Plutôt que de faire semblant, il
    // vérifie que la suite qui le fait existe et compare bien les deux
    // implémentations valeur par valeur, sur un PostgreSQL réel.
    const verif = lire("tests/integration/histogramme-sql.test.ts");
    expect(verif).toContain("mip_seau(v) as sql");
    expect(verif).toContain("r.sql !== r.ts");
    expect(verif).toContain("SQL_TEST_DATABASE_URL");
  });
});

// ══════════════════ 4. Ce que la table doit à tout le reste ══════════════════

describe("metric_histogram_hourly entre dans TOUTES les énumérations", () => {
  // Une table applicative oubliée dans l'une d'elles produit soit des données
  // qui ne purgent jamais, soit des données qui survivent à un effacement RGPD.
  it.each([
    ["purge de rétention", "purge_rum_app"],
    ["effacement d'un client", "erase_app_data"],
  ])("%s la supprime", (_, fn) => {
    const bloc = V61.slice(V61.indexOf(`create or replace function ${fn}`));
    expect(bloc.slice(0, bloc.indexOf("end $$;"))).toContain("delete from metric_histogram_hourly");
  });

  it("est sous RLS, et lisible par console_ro", () => {
    expect(V61).toContain("alter table metric_histogram_hourly enable row level security");
    expect(V61).toContain("create policy tenant_scope on metric_histogram_hourly");
    expect(V61).toContain("grant select on metric_histogram_hourly to console_ro");
  });

  it("exclut les robots du pré-agrégat, comme toutes les vues de qualité", () => {
    // Sans ce filtre, les seaux et le calcul sur lignes brutes porteraient sur
    // deux populations différentes, et le p75 changerait selon la fraîcheur.
    const fn = V61.slice(V61.indexOf("create or replace function refresh_metric_histogram"));
    expect(fn.slice(0, fn.indexOf("end $$;"))).toContain("not coalesce(s.is_bot, false)");
  });

  it("borne le rafraîchissement en HAUT, et enregistre cette borne", () => {
    // C'est ce qui rend la partition lecture/pré-agrégat exacte. Une borne
    // implicite `now()` rendrait le raccord impossible à écrire sans trou.
    const fn = V61.slice(V61.indexOf("create or replace function refresh_metric_histogram"));
    const corps = fn.slice(0, fn.indexOf("end $$;"));
    expect(corps).toContain("and m.ts < v_now");
    expect(corps).toContain("insert into metric_histogram_state (seul, refreshed_at, max_metric_id) values (true, v_now, v_max)");
    // La borne d'IDENTIFIANT, prise AVANT l'agrégation. Sans elle, une mesure
    // rejouée dans une heure déjà agrégée n'est visible nulle part.
    expect(corps).toContain("select coalesce(max(id), 0) into v_max from rum_metric");
    expect(corps).toContain("where m.id <= v_max");
  });
});

describe("la console additionne les deux sources sans trou ni recouvrement", () => {
  const LECTURE = lire("apps/console/lib/queries-histogramme.ts");

  it("borne le pré-agrégat aux heures ENTIÈRES situées sous la borne", () => {
    expect(LECTURE).toContain("h.hour >= c.hb and h.hour < c.hw");
  });

  it("prend en vif exactement le complémentaire", () => {
    // [debut, hb) ∪ [hw, now) — les deux morceaux que le pré-agrégat ne couvre
    // pas — PLUS les lignes arrivées après la borne, que leur ts ne trahit pas.
    // Complémentaire au sens strict : une ligne déjà agrégée a ts dans [hb, hw)
    // ET un id sous la borne, donc elle échoue aux TROIS branches du « ou ».
    // Quand hb >= hw, le pré-agrégat est vide et le vif couvre toute la fenêtre.
    expect(LECTURE).toContain("m.ts >= c.debut and (m.ts < c.hb or m.ts >= c.hw or m.id > c.wid)");
    expect(LECTURE).toContain("date_trunc('hour', now() - $2::interval) + interval '1 hour' as hb");
  });

  it("retombe sur un calcul intégralement vif quand rien n'a jamais été rafraîchi", () => {
    // Sans ce coalesce, une base fraîchement migrée afficherait des percentiles
    // vides plutôt que justes.
    expect(LECTURE).toContain("coalesce((select refreshed_at from metric_histogram_state), to_timestamp(0))");
    expect(LECTURE).toContain("coalesce((select max_metric_id from metric_histogram_state), 0)");
  });

  it("le résumé ne calcule PLUS de percentile_cont non pondéré", () => {
    // Le marqueur négatif : la chaîne doit avoir disparu de queries-summary.ts.
    // Sans cette assertion, on pourrait ajouter le nouveau chemin en laissant
    // l'ancien en place, et lire l'un ou l'autre selon le hasard du code mort.
    const resume = lire("apps/console/lib/queries-summary.ts");
    // `percentile_cont(` — avec la parenthèse : le commentaire qui explique la
    // bascule mentionne le nom sans l'appeler, et ne doit pas déclencher.
    expect(resume).not.toMatch(/percentile_cont\(/);
    expect(resume).toContain("percentilesPonderes(app, interval");
  });
});
