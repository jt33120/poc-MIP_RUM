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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PERIODS,
  intervalleEnMs,
  nombreDeSeaux,
  seauEnSecondes,
  type PeriodKey,
} from "../../apps/console/lib/filters";

const RACINE = join(__dirname, "..", "..");
const lire = (rel: string) => readFileSync(join(RACINE, rel), "utf8");
const Q2 = lire("apps/console/lib/queries-v2.ts");
const PAGE = lire("apps/console/app/errors/page.tsx");

/** Le corps de `sourceGroupes`, tel qu'il part vers PostgreSQL. */
const SOURCE = (() => {
  const i = Q2.indexOf("function sourceGroupes");
  const d = Q2.indexOf("return `", i) + 7;
  return Q2.slice(d + 1, Q2.indexOf("`", d + 1));
})();

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
    for (const p of Object.keys(PERIODS) as PeriodKey[]) {
      expect(nombreDeSeaux(p), p).toBeGreaterThan(0);
      // Un seau plus large que la fenêtre donnerait un graphique à une colonne.
      expect(seauEnSecondes(p), p).toBeLessThan(intervalleEnMs(PERIODS[p].interval) / 1000);
    }
  });
});

describe("les DEUX tables PERIODS du dépôt ne divergent pas", () => {
  // lib/queries-v2.ts porte sa propre copie (dette de filtres documentée sur
  // place). Elle est la source des libellés de l'écran Erreurs pendant que le
  // seau vient de lib/filters.ts : si les deux s'écartent, l'écran annoncerait
  // une fenêtre et en dessinerait une autre — le défaut même qu'on corrige.
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
  it("ne lit plus la vue sans borne", () => {
    expect(Q2).not.toContain("from v_error_group_ext");
  });

  it("les trois compteurs sont calculés DANS la fenêtre", () => {
    expect(SOURCE).toContain("e.ts > now() - $");
    for (const c of ["count(*)", "count(distinct e.session_id)", "count(distinct s.visitor_id)"])
      expect(SOURCE, c).toContain(c);
  });

  it("compte des visiteurs, pas des empreintes de terminal (lot 1)", () => {
    expect(SOURCE).not.toContain("user_hash");
  });

  it("liste ET détail lisent la même source, avec la même fenêtre", () => {
    // Sans cela, ouvrir une ligne afficherait d'autres chiffres que celle qu'on
    // vient de cliquer. Deux appels, deux numérotations de paramètres.
    expect(Q2).toContain("sourceGroupes(1, 2)");
    expect(Q2).toContain("sourceGroupes(2, 3)");
    expect((Q2.match(/\$\{sourceGroupes\(/g) ?? []).length).toBe(2);
  });
});

describe("first_seen reste « depuis toujours », et le dit", () => {
  /** La CTE `origine`, qui porte first_seen. */
  const origine = SOURCE.slice(SOURCE.indexOf("origine as ("), SOURCE.indexOf("g as ("));

  it("n'est PAS bornée par la fenêtre — la première apparition n'a de sens que globale", () => {
    expect(origine).toContain("min(e.ts) as first_seen");
    expect(origine).not.toContain("now() -");
  });

  it("l'écran le libelle, au lieu de laisser croire que c'est dans la fenêtre", () => {
    expect(PAGE).toContain("depuis toujours");
    expect(PAGE.toLowerCase()).toContain("hors fenêtre");
  });
});

describe("le piège de performance est verrouillé", () => {
  // Tant que `origine` référençait `fenetre`, PostgreSQL matérialisait cette
  // dernière, ce qui lui retire le parallélisme : 24 h passait de 99 ms à
  // 287 ms. Rien dans le code ne signale ce coût — d'où ce test.
  it("les deux CTE restent INDÉPENDANTES", () => {
    const origine = SOURCE.slice(SOURCE.indexOf("origine as ("), SOURCE.indexOf("g as ("));
    expect(origine).not.toContain("join fenetre");
    expect(origine).not.toContain("from fenetre");
  });

  it("le commentaire dit pourquoi, avec les nombres mesurés", () => {
    // Sans la raison écrite, la « simplification » évidente sera refaite.
    expect(Q2).toContain("MATÉRIALISATION DES CTE");
    expect(Q2).toContain("287 ms");
  });
});

// ═══════════════════════════ 3. Le tri suit l'impact ══════════════════════════

describe("le tri classe par impact sur la fenêtre, pas par volume cumulé", () => {
  const ordre = (() => {
    const i = Q2.indexOf("const ERROR_GROUP_ORDER");
    const d = Q2.indexOf("`", i);
    return Q2.slice(d + 1, Q2.indexOf("`", d + 1));
  })();

  it("les visiteurs touchés priment sur les occurrences", () => {
    expect(ordre.indexOf("g.users_affected desc")).toBeGreaterThan(-1);
    expect(ordre.indexOf("g.users_affected desc")).toBeLessThan(ordre.indexOf("g.occurrences desc"));
  });

  it("`sessions` départage tant que l'historique n'a pas de visitor_id", () => {
    // Depuis migration-v57, seules les sessions identifiées alimentent
    // users_affected. Pendant les 30 jours de rétention qui suivent, beaucoup de
    // groupes valent 0 : sans ce critère, le tri rangerait au hasard.
    expect(ordre.indexOf("g.sessions desc")).toBeLessThan(ordre.indexOf("g.occurrences desc"));
  });

  it("le triage (régression / ouverte / résolue) reste prioritaire", () => {
    expect(ordre.indexOf("case")).toBeLessThan(ordre.indexOf("g.users_affected desc"));
  });
});

// ═══════════════ 4. L'écran n'annonce plus une fenêtre pour une autre ═════════

describe("l'histogramme suit la période choisie", () => {
  it("ne fabrique plus 24 seaux en dur", () => {
    expect(PAGE).toContain("periodNombreDeSeaux(f)");
    expect(PAGE).not.toContain("{ length: 24 }");
    expect(PAGE).not.toContain("new Array(24).fill(0)");
  });

  it("les sparklines SQL sont paramétrées, plus figées sur date_trunc('hour')", () => {
    const spark = Q2.slice(Q2.indexOf("export async function errorSparklines"));
    expect(spark).not.toContain("interval '24 hours'");
    expect(spark).not.toContain("date_trunc('hour'");
    expect(spark).toContain("extract(epoch from ts) / $3");
  });

  it("les titres et libellés viennent de la période, pas d'une constante", () => {
    expect(PAGE).not.toContain("Pic horaire (24 h)");
    expect(PAGE).not.toContain("(24 h) — par groupe");
    expect(PAGE).toContain("periodSeauLabel(f)");
    expect(PAGE).toContain("periodLabel(f)");
  });
});
