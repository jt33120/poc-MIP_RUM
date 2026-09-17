// Les compteurs de l'écran Erreurs — finding 1.1 de docs/AUDIT_RUM_EXTERNE.md.
//
// CE QUI ÉTAIT FAUX. La tuile affichait « Occurrences · 1 h » et la valeur venait
// de `v_error_group_ext`, une vue SANS AUCUNE BORNE TEMPORELLE. Basculer
// 7 j → 24 h → 1 h ne changeait pas le nombre. L'exploitant en concluait que
// rien ne se calmait. Le tri, sur ce même cumul, plaçait un bug corrigé il y a
// deux semaines devant la régression du jour, et les colonnes « Sessions »,
// « Utilisateurs » et « Première vue » avaient le même défaut.
//
// ─────────── POURQUOI ON N'A PAS SUIVI LE SCHÉMA PROPOSÉ PAR L'AUDIT ──────────
//
// Le rapport recommandait `error_group_hourly (…, occurrences, sessions,
// visitors)`, « sommable sur n'importe quelle fenêtre ». Les comptages de
// DISTINCTS ne le sont pas. Vérifié sur une base réelle — une personne, une
// session, un bug rencontré trois fois en trois heures :
//
//     somme des seaux horaires : 3 occurrences, 3 sessions, 3 visiteurs
//     vérité sur la fenêtre    : 3 occurrences, 1 session,  1 visiteur
//
// Soit un sur-comptage de 3× sur la mesure dont l'audit veut faire le critère de
// tri. On a retenu l'autre option du même rapport : une source paramétrée par la
// fenêtre, exacte pour les trois compteurs.
//
// ──────────────────────── RÉÉCRIT EN P5.1, DÉLIBÉRÉMENT ───────────────────────
//
// Les lectures ont quitté lib/queries-v2.ts pour lib/queries-errors.ts. Ce test
// verrouille les MÊMES invariants, non plus sur le texte d'une fonction
// disparue, mais sur les instructions réellement envoyées à PostgreSQL (base
// simulée). S'y ajoutent ceux de P5.1 : `filtered_errors` citée une seule fois
// par instruction, fenêtre [from,to), aucun `::int` sur un compteur, ratios en
// float8, `origine` indépendante.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const journal: string[] = [];
  const q = vi.fn(async () => [{ v69: true }]);
  // Une ligne passe-partout : chaque lecture va jusqu'au bout (groupe trouvé,
  // séries demandées), sans que ce test dépende de l'ordre des réponses.
  const ligne = { app_id: "app-a", fingerprint: "fp1", bucket: new Date(0), occurrences: 1 };
  const tx = vi.fn(async (fn: (client: { query: (sql: string) => Promise<{ rows: unknown[] }> }) => unknown) =>
    fn({
      query: async (sql: string) => {
        journal.push(sql);
        return { rows: /^set transaction/.test(sql) ? [] : [ligne] };
      },
    }));
  return { journal, q, tx };
});
vi.mock("@/lib/db", () => ({ q: db.q, tx: db.tx }));

import {
  PERIODS,
  intervalleEnMs,
  nombreDeSeaux,
  seauEnSecondes,
  type PeriodKey,
} from "../../apps/console/lib/filters";
import { errorGroupDetail, listErrorGroups } from "../../apps/console/lib/queries-errors";

const RACINE = join(__dirname, "..", "..");
const lire = (rel: string) => readFileSync(join(RACINE, rel), "utf8");
const Q2 = lire("apps/console/lib/queries-v2.ts");
const MODULE = lire("apps/console/lib/queries-errors.ts");
const PAGE = lire("apps/console/app/errors/page.tsx");
const PERIODES = Object.keys(PERIODS) as PeriodKey[];

/**
 * Les instructions de données d'une liste avec séries — groupes, totaux,
 * tendance, séries — puis d'un détail — groupe, tendance, exemplaire, occurrences.
 */
async function instructions(period: PeriodKey = "24h") {
  const f = { app: "app-a", period, device: null, segment: [], includeBots: false, includeInternal: false };
  db.journal.length = 0;
  await listErrorGroups(f, { limit: 100, offset: 0 }, { series: true });
  const liste = db.journal.filter((sql) => !sql.startsWith("set transaction"));
  db.journal.length = 0;
  await errorGroupDetail({ app_id: "app-a", fingerprint: "fp1" }, f, { limit: 100, cursor: null });
  const detail = db.journal.filter((sql) => !sql.startsWith("set transaction"));
  return { liste, detail, toutes: [...liste, ...detail] };
}

/** Le corps d'une CTE nommée, parenthèses équilibrées. */
function cte(sql: string, nom: string): string {
  const debut = new RegExp(`\\b${nom} as \\(`).exec(sql);
  if (!debut) throw new Error(`CTE ${nom} absente`);
  const ouverture = debut.index + nom.length + 4;
  let profondeur = 0;
  for (let i = ouverture; i < sql.length; i++) {
    if (sql[i] === "(") profondeur++;
    else if (sql[i] === ")" && --profondeur === 0) return sql.slice(ouverture + 1, i);
  }
  throw new Error(`CTE ${nom} non refermée`);
}

// ══════════════════════ 1. Le découpage en seaux, dérivé ══════════════════════

describe("le découpage d'une période en seaux", () => {
  it("compte les seaux à partir de PERIODS, sans table écrite à côté", () => {
    expect(nombreDeSeaux("1h")).toBe(12); // 60 min / 5 min
    expect(nombreDeSeaux("24h")).toBe(24); // 24 h / 1 h
    expect(nombreDeSeaux("7d")).toBe(28); // 168 h / 6 h
  });

  it("rend la largeur d'un seau en secondes, l'unité que prend le SQL", () => {
    expect(seauEnSecondes("1h")).toBe(300);
    expect(seauEnSecondes("24h")).toBe(3600);
    expect(seauEnSecondes("7d")).toBe(21600);
  });

  it("JETTE sur un intervalle non reconnu plutôt que de rendre zéro", () => {
    // Un 0 silencieux donnerait des seaux de largeur nulle, donc une division
    // par zéro dans les graphiques — un écran vide sans message d'erreur.
    for (const mauvais of ["", "plus tard", "3 fortnights", "hour", "-2 hours"])
      expect(() => intervalleEnMs(mauvais), mauvais).toThrow();
  });

  it("couvre toutes les périodes déclarées, pas seulement celles qu'on a en tête", () => {
    for (const p of PERIODES) {
      expect(nombreDeSeaux(p), p).toBeGreaterThan(0);
      // Un seau plus large que la fenêtre donnerait un graphique à une colonne.
      expect(seauEnSecondes(p), p).toBeLessThan(intervalleEnMs(PERIODS[p].interval) / 1000);
    }
  });
});

describe("les DEUX tables PERIODS du dépôt ne divergent pas", () => {
  // lib/queries-v2.ts porte sa propre copie (dette de filtres documentée sur
  // place), source des libellés des écrans corrélation, alertes et SLO, pendant
  // que les erreurs lisent lib/filters.ts : si les deux s'écartent, deux écrans
  // annonceraient la même période sur deux fenêtres différentes.
  const locale = (() => {
    const i = Q2.indexOf("const PERIODS = {");
    return Q2.slice(i, Q2.indexOf("} as const;", i));
  })();

  it("mêmes clés", () => {
    for (const k of Object.keys(PERIODS)) expect(locale, k).toContain(`"${k}"`);
    // Et pas de clé en plus du côté local.
    const cles = [...locale.matchAll(/"([^"]+)":\s*\{/g)].map((m) => m[1]);
    expect(cles.sort()).toEqual(Object.keys(PERIODS).sort());
  });

  it("mêmes intervalles et mêmes libellés", () => {
    for (const [k, v] of Object.entries(PERIODS)) {
      expect(locale, `${k} interval`).toContain(`interval: "${v.interval}"`);
      expect(locale, `${k} label`).toContain(`label: "${v.label}"`);
    }
  });
});

// ═══════════════════ 2. La source des groupes est bornée ══════════════════════

describe("les compteurs d'un groupe d'erreurs sont bornés par la fenêtre", () => {
  it("ne lit plus la vue sans borne", async () => {
    for (const sql of (await instructions()).toutes) expect(sql).not.toContain("v_error_group");
  });

  it("toute instruction borne sa population à [from, to), pour chaque période", async () => {
    for (const p of PERIODES) {
      for (const sql of (await instructions(p)).toutes) {
        expect(cte(sql, "filtered_errors"), p).toContain(
          `e.ts >= now() - interval '${PERIODS[p].interval}' and e.ts < now()`,
        );
      }
    }
  });

  it("les compteurs sont calculés DANS la fenêtre, et les occurrences sont une somme", async () => {
    const { liste } = await instructions();
    const g = cte(liste[0], "g");
    // `sum(occurrences)` et non `count(*)` depuis migration-v59 : le SDK
    // déduplique une erreur qui se répète et joint le nombre d'occurrences
    // qu'il a tues. Compter les lignes sous-estimerait la boucle qu'on veut voir.
    for (const c of [
      "from filtered_errors",
      "sum(occurrences)",
      "count(distinct same_app_session_id)",
      "count(distinct visitor_id)",
      "count(distinct identity_hash)",
    ])
      expect(g, c).toContain(c);
    for (const sql of (await instructions()).toutes) expect(sql).not.toContain("count(*)");
  });

  it("compte des visiteurs et des identités, pas des empreintes de terminal (lot 1)", async () => {
    for (const sql of (await instructions()).toutes) expect(sql).not.toMatch(/\buser_hash\b/);
  });

  it("liste ET détail lisent la même source, avec la même fenêtre", async () => {
    // Sans cela, ouvrir une ligne afficherait d'autres chiffres que celle qu'on
    // vient de cliquer. Le détail ajoute seulement la restriction à son groupe.
    const { liste, detail } = await instructions();
    expect(cte(detail[0], "g")).toBe(cte(liste[0], "g"));
    const restriction = " and e.fingerprint = any($3::text[])";
    for (const sql of detail) {
      expect(cte(sql, "filtered_errors")).toContain(restriction);
      expect(cte(sql, "filtered_errors").replace(restriction, "")).toBe(cte(liste[0], "filtered_errors"));
    }
  });
});

describe("first_seen reste « depuis toujours », et le dit", () => {
  it("n'est PAS bornée par la fenêtre — la première apparition n'a de sens que globale", async () => {
    const { liste, detail } = await instructions();
    for (const sql of [liste[0], detail[0]]) {
      const origine = cte(sql, "origine");
      expect(origine).toContain("min(e.ts) as first_seen");
      expect(origine).not.toContain("now()");
    }
  });

  it("l'écran le libelle, au lieu de laisser croire que c'est dans la fenêtre", () => {
    expect(PAGE).toContain("depuis toujours");
    expect(PAGE.toLowerCase()).toContain("hors fenêtre");
  });
});

describe("le piège de performance est verrouillé", () => {
  // Tant que `origine` référençait la population bornée, PostgreSQL matérialisait
  // cette dernière, ce qui lui retire le parallélisme : 24 h passait de 99 ms à
  // 287 ms. Même cause pour une CTE citée deux fois. Rien dans le code ne signale
  // ce coût — d'où ce test.
  it("filtered_errors n'est citée qu'UNE fois par instruction", async () => {
    for (const sql of (await instructions()).toutes) {
      // La définition, puis une seule référence.
      expect((sql.match(/\bfiltered_errors\b/g) ?? []).length).toBe(2);
    }
  });

  it("`origine` reste INDÉPENDANTE de la population bornée", async () => {
    const { liste, detail } = await instructions();
    for (const sql of [liste[0], detail[0]]) {
      const origine = cte(sql, "origine");
      expect(origine).toContain("from rum_error e");
      expect(origine).not.toContain("filtered_errors");
      expect(origine).not.toMatch(/\b(from|join) g\b/);
    }
  });

  it("le commentaire dit pourquoi, avec les nombres mesurés", () => {
    // Sans la raison écrite, la « simplification » évidente sera refaite.
    expect(MODULE).toContain("MATÉRIALISATION DES CTE");
    expect(MODULE).toContain("287 ms");
  });
});

describe("aucun compteur tronqué", () => {
  it("pas de `::int` : compteurs en float8, ratios en division réelle", async () => {
    const { liste, toutes } = await instructions();
    for (const sql of toutes) expect(sql).not.toMatch(/::int(eger|4)?\b/);
    // occurrences est un int : bigint / bigint tronquerait une couverture à 0.
    expect(cte(liste[0], "g")).toMatch(/\)::float8\s+\/ nullif\(sum\(occurrences\), 0\)::float8 as session_coverage/);
    expect(cte(liste[0], "g")).toMatch(/\)::float8\s+\/ nullif\(sum\(occurrences\), 0\)::float8 as identity_coverage/);
  });
});

// ═══════════════════════════ 3. Le tri suit l'impact ══════════════════════════

describe("le tri classe par impact sur la fenêtre, pas par volume cumulé", () => {
  const ordre = async () => {
    const [groupes] = (await instructions()).liste;
    return groupes.slice(groupes.indexOf("order by (case"));
  };

  it("les visiteurs touchés priment sur les occurrences", async () => {
    const o = await ordre();
    expect(o.indexOf("g.visitors_affected desc nulls last")).toBeGreaterThan(-1);
    expect(o.indexOf("g.visitors_affected desc nulls last")).toBeLessThan(o.indexOf("g.occurrences desc"));
  });

  it("les sessions départagent tant que l'historique n'a pas de visitor_id", async () => {
    // Depuis migration-v57, seules les sessions identifiées alimentent les
    // visiteurs. Pendant les 30 jours de rétention qui suivent, beaucoup de
    // groupes n'en ont aucun : sans ce critère, le tri rangerait au hasard.
    const o = await ordre();
    expect(o.indexOf("g.sessions_affected desc nulls last")).toBeLessThan(o.indexOf("g.occurrences desc"));
  });

  it("le triage (régression / ouverte / résolue) reste prioritaire, et l'ordre est total", async () => {
    const o = await ordre();
    expect(o.indexOf("case")).toBeLessThan(o.indexOf("g.visitors_affected desc"));
    // Sans départage final, deux pages d'offset répéteraient ou sauteraient une ligne.
    expect(o).toContain("g.last_seen desc, g.app_id, g.fingerprint");
  });
});

// ═══════════════ 4. L'écran n'annonce plus une fenêtre pour une autre ═════════

describe("la tendance suit la période choisie", () => {
  it("les seaux viennent de PERIODS, bornés par les seaux de from et de to", async () => {
    for (const p of PERIODES) {
      const { bucket, interval } = PERIODS[p];
      const { liste, detail } = await instructions(p);
      const [, , tendance, series] = liste;
      for (const sql of [tendance, detail[1]]) {
        expect(sql, p).toContain(
          `generate_series(date_bin(interval '${bucket}', now() - interval '${interval}', timestamptz '2000-01-01'),`,
        );
        expect(sql, p).toContain(`date_bin(interval '${bucket}', now(), timestamptz '2000-01-01'), interval '${bucket}')`);
      }
      // Les séries par groupe tombent dans les MÊMES seaux que la tendance.
      expect(series, p).toContain(`date_bin(interval '${bucket}', ts, timestamptz '2000-01-01') as bucket`);
      for (const sql of [tendance, series]) expect(sql, p).not.toContain("date_trunc(");
    }
  });

  it("l'écran ne fabrique plus 24 seaux ni un titre figé sur 24 h", () => {
    expect(PAGE).not.toContain("{ length: 24 }");
    expect(PAGE).not.toContain("new Array(24).fill(0)");
    expect(PAGE).not.toContain("Pic horaire (24 h)");
    expect(PAGE).not.toContain("(24 h) — par groupe");
  });
});
