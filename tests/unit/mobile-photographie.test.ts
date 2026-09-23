// /mobile — les tuiles et la série « dans le temps » dans UNE photographie (revue de
// fin de vague 8, constat 6), sur base simulée.
//
// Le défaut : `mobileSerie` ouvrait sa transaction à côté de celle de
// `mobileSummary` (deux `snapshot()` lancés par le même `Promise.all`), alors que
// l'écran affirme « la somme des seaux est la tuile ». Ici on verrouille la forme :
// UNE transaction pour les deux, en lecture répétable, chaque partie sous son point
// de reprise — une partie en échec n'efface pas l'autre (F02). La preuve sur
// PostgreSQL réel (une session reçue PENDANT la lecture n'entre dans aucune des
// deux) est dans tests/integration/rum-mobile-serie-sql.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Client = { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> };

const db = vi.hoisted(() => {
  const journal: string[] = [];
  const transactions = { ouvertes: 0 };
  // Instructions de données qui échouent (prédicat sur le SQL), pour éprouver l'isolement.
  const echecs: { quand: (sql: string) => boolean }[] = [];
  const q = vi.fn(async () => []);
  const tx = vi.fn(async (fn: (client: Client) => unknown) => {
    transactions.ouvertes += 1;
    return fn({
      query: async (sql: string) => {
        journal.push(sql.trim());
        if (echecs.some((e) => e.quand(sql))) throw new Error("instruction en échec (simulée)");
        return { rows: [] };
      },
    });
  });
  return { journal, transactions, echecs, q, tx };
});
vi.mock("@/lib/db", () => ({ q: db.q, tx: db.tx }));

import { schemaComplet } from "../fixtures/dimension-schema";
import { filtersOfQuery } from "../../apps/console/lib/filters";
import { mobileResumeEtSerie, valeurDe, type MobileSchema } from "../../apps/console/lib/queries-mobile";
import { parseAnalyticsQuery } from "../../apps/console/lib/query-contract";

const SCHEMA: MobileSchema = { runtime: true, capabilities: true, errorSource: true, dimensions: schemaComplet() };

function filtres() {
  const parsed = parseAnalyticsQuery(new URLSearchParams("app=app-a&period=24h"), {
    principal: { role: "admin", apps: null },
    nowMs: Date.parse("2026-09-23T12:00:00Z"),
  });
  if (!parsed.ok) throw new Error(parsed.error.message);
  return filtersOfQuery(parsed.value);
}

const estSerie = (sql: string) => /generate_series/.test(sql);
const estRequetesReseau = (sql: string) => /from rum_span sp/.test(sql);

beforeEach(() => {
  db.journal.length = 0;
  db.echecs.length = 0;
  db.transactions.ouvertes = 0;
});

describe("mobileResumeEtSerie — une photographie, deux sections", () => {
  it("UNE transaction en lecture répétable porte le résumé ET la série", async () => {
    const { resume, serie } = await mobileResumeEtSerie(filtres(), SCHEMA);
    expect(resume.ok && serie.ok).toBe(true);
    expect(db.transactions.ouvertes).toBe(1);
    // La première instruction fixe l'isolation : PostgreSQL la refuse après une requête.
    expect(db.journal[0]).toBe("set transaction isolation level repeatable read read only");
    // Le résumé d'abord (sessions de la cohorte), puis la série, dans la même transaction.
    const iSessions = db.journal.findIndex((s) => /count\(distinct visitor_id\)/.test(s));
    const iSerie = db.journal.findIndex(estSerie);
    expect(iSessions).toBeGreaterThan(0);
    expect(iSerie).toBeGreaterThan(iSessions);
    expect(db.journal).toContain("release savepoint resume_mobile");
    expect(db.journal).toContain("release savepoint serie_mobile");
  });

  it("une instruction du résumé échoue : la série est lue quand même, après retour au point de reprise", async () => {
    db.echecs.push({ quand: estRequetesReseau });
    const { resume, serie } = await mobileResumeEtSerie(filtres(), SCHEMA);
    expect(resume.ok).toBe(false);
    expect(() => valeurDe(resume)).toThrow("instruction en échec (simulée)");
    expect(serie.ok).toBe(true);
    // Sans `rollback to savepoint`, PostgreSQL refuserait toute instruction suivante
    // (« current transaction is aborted ») : la série tomberait avec le résumé.
    const iRetour = db.journal.indexOf("rollback to savepoint resume_mobile");
    expect(iRetour).toBeGreaterThan(db.journal.findIndex(estRequetesReseau));
    expect(db.journal.findIndex(estSerie)).toBeGreaterThan(iRetour);
    expect(db.transactions.ouvertes).toBe(1);
  });

  it("la série échoue : le résumé reste lu", async () => {
    db.echecs.push({ quand: estSerie });
    const { resume, serie } = await mobileResumeEtSerie(filtres(), SCHEMA);
    expect(resume.ok).toBe(true);
    expect(valeurDe(resume).sessions.sessions).toBe(0);
    expect(serie.ok).toBe(false);
    expect(db.journal).toContain("rollback to savepoint serie_mobile");
  });

  it("les déclarations (hors transaction) échouent : le résumé est en échec, la série lue", async () => {
    db.q.mockRejectedValueOnce(new Error("déclarations illisibles"));
    const { resume, serie } = await mobileResumeEtSerie(filtres(), SCHEMA);
    expect(resume.ok).toBe(false);
    expect(serie.ok).toBe(true);
  });

  it("sans `runtime` (v82) : aucune transaction, résumé « sans cohorte », série indisponible", async () => {
    const { resume, serie } = await mobileResumeEtSerie(filtres(), { ...SCHEMA, runtime: false });
    expect(db.transactions.ouvertes).toBe(0);
    expect(valeurDe(resume).unavailable).toHaveLength(1);
    expect(valeurDe(serie)).toMatchObject({ disponible: false });
  });
});
