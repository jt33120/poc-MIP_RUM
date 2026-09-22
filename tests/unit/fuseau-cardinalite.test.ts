// Lots 5 et 6 — les fenêtres de temps et la cardinalité des routes.
// Findings 2.8, 2.10 et 2.6 de docs/AUDIT_RUM_EXTERNE.md.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FUSEAU_DEFAUT } from "../../apps/console/lib/fuseau";
import { ROUTES_MAX } from "../../apps/console/lib/queries";

const RACINE = join(__dirname, "..", "..");
const lire = (rel: string) => readFileSync(join(RACINE, rel), "utf8");
const V60 = lire("apps/ingest/sql/migration-v60.sql");
const GRID = lire("apps/console/lib/queries-grid.ts");
const SUMMARY = lire("apps/console/lib/queries-summary.ts");
const QUERIES = lire("apps/console/lib/queries.ts");
const PAGE = lire("apps/console/app/pages/page.tsx");

// ═════════════ 2.8 — UTC sous une interface française ════════════════════════

describe("les journées sont découpées dans le fuseau de l'application", () => {
  it("le fuseau est une colonne, avec un défaut français", () => {
    expect(V60).toContain("alter table app_registry add column if not exists timezone");
    expect(V60).toContain("'Europe/Paris'");
    expect(FUSEAU_DEFAUT).toBe("Europe/Paris");
  });

  it("un fuseau inconnu est refusé À L'ÉCRITURE, pas à l'affichage", () => {
    // `at time zone 'Mars/Olympus'` échoue à l'exécution : sur un écran,
    // plusieurs jours après la saisie, et sur TOUS les écrans à la fois.
    expect(V60).toContain("pg_timezone_names");
    expect(V60).toContain("create trigger trg_app_registry_fuseau");
  });

  it("un DÉCLENCHEUR et pas une contrainte CHECK, et le fichier dit pourquoi", () => {
    // PostgreSQL interdit les sous-requêtes dans un CHECK ; écrire la liste des
    // fuseaux en dur serait pire — elle change plusieurs fois par an.
    // Le commentaire court sur deux lignes : on compare le texte aplati, sinon
    // le test dépend de la largeur de colonne du fichier.
    const aplati = V60.replace(/\n--\s*/g, " ");
    expect(aplati).toContain("interdit les sous-requêtes dans un CHECK");
  });

  it("la heatmap regroupe en heure LOCALE, sur ses deux chemins", () => {
    // Deux chemins : le pré-agrégat horaire et les lignes brutes. Corriger un
    // seul donnerait deux heatmaps différentes selon que le rollup est actif.
    // Le fuseau est un paramètre lié (`${zone}`, numéroté par le compilateur P6.2).
    expect((GRID.match(/at time zone \$\{zone\}/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(GRID).toContain("const zone = sql.bind(tz);");
    expect(GRID).not.toMatch(/date_trunc\('day', m\.ts\)/);
    expect(GRID).not.toMatch(/extract\(hour from m\.ts\)/);
  });

  it("la série journalière aussi, bornes de generate_series comprises", () => {
    // Oublier les bornes décalerait la série d'un jour par rapport aux données
    // qu'elle contient — un écart d'autant plus difficile à voir qu'il est petit.
    expect(SUMMARY).toContain("(now() at time zone $3)");
    expect(SUMMARY).toContain("(p.started_at at time zone $3)::date");
  });

  it("le pré-agrégat HORAIRE reste en UTC, et c'est délibéré", () => {
    // Une heure dure une heure partout ; une journée locale dure 23 ou 25 h deux
    // fois par an. Agréger l'horaire en local rendrait l'historique dépendant du
    // fuseau au moment de l'écriture.
    expect(V60).toContain("pré-agrégat horaire reste en UTC");
  });
});

// ═════════════ 2.6 — la cardinalité des routes ════════════════════════════════

describe("la liste des routes est bornée, et le dit", () => {
  it("plus de sous-requêtes corrélées : des CTE agrégées", () => {
    const f = QUERIES.slice(QUERIES.indexOf("export async function slowRoutes"), QUERIES.indexOf("export async function nombreDeRoutes"));
    expect(f).toContain("with vues as (");
    expect(f).toContain("taches as (");
    // La forme qui coûtait deux sous-requêtes PAR LIGNE.
    expect(f).not.toContain("where p.route = m.route");
    expect(f).not.toContain("where l.route = m.route");
  });

  it("et un plafond", () => {
    expect(ROUTES_MAX).toBe(200);
    expect(QUERIES).toContain("limit ${ROUTES_MAX}");
  });

  it("le plafond garde les PLUS LENTES — celles qu'on est venu chercher", () => {
    const f = QUERIES.slice(QUERIES.indexOf("export async function slowRoutes"));
    expect(f.indexOf("order by v.lcp_p75 desc nulls last")).toBeLessThan(f.indexOf("limit ${ROUTES_MAX}"));
  });

  it("l'écran annonce la troncature au lieu de la subir", () => {
    // Une liste coupée en silence ferait croire à un catalogue plus petit qu'il
    // n'est — le genre de silence que ce dépôt corrige ailleurs.
    expect(QUERIES).toContain("export async function nombreDeRoutes");
    // F14 : le classement lit `vitalsBreakdown(f, "route", ROUTES_MAX)`, qui rend le
    // nombre RÉEL de groupes et `truncated` dans la même lecture — plus de total lu
    // à part, donc plus de cas « total illisible, liste peut-être coupée » : si la
    // lecture échoue, il n'y a pas de liste du tout (« Lecture en échec »). La coupe
    // se fait par VOLUME (CP1) et le bandeau le dit.
    expect(PAGE).toContain("decoupe.data?.truncated");
    expect(PAGE).toContain("routes distinctes mesurées sur");
    expect(PAGE).toContain("moins mesurées, ne le sont pas");
  });

  it("et dit d'où vient une cardinalité qui grimpe", () => {
    // Sans la cause, l'avertissement est un constat sans suite.
    expect(PAGE).toContain("normalizeRoute");
    expect(PAGE.toLowerCase()).toContain("slugs");
  });
});
