// P8.1 — ce qui se prouve SANS moteur : la logique de filtrage, l'ordre des
// verrous, et les invariants de forme que la recette SQL ne regarde pas.
//
// Le comportement concurrent est prouvé sur un vrai PostgreSQL par
// tests/integration/dsar-concurrency-sql.test.ts. Ici : les fonctions PURES, et
// les phrases qu'on ne veut pas voir disparaître d'une relecture à l'autre.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error module .mjs sans déclaration de types
import {
  appsDuLot,
  filtrerLot,
  STRATEGIE_VERROU,
  sujetsDuLot,
  VERROU_INGESTION_NS,
  // @ts-expect-error module .mjs sans déclaration de types
} from "../../packages/backend/lib/privacy-barriere.mjs";
import { DSAR_BARRIERE_MESSAGES, DSAR_LIMITES } from "../../apps/console/lib/dsar";

const RACINE = join(__dirname, "..", "..");
const lire = (rel: string) => readFileSync(join(RACINE, rel), "utf8");
const V81 = lire("packages/db/sql/migration-v81.sql");
const PRIMITIVE = lire("packages/backend/lib/privacy-barriere.mjs");
const PG = lire("packages/backend/lib/pg-ingest.mjs");

type Sujets = { session: Set<string>; visitor: Set<string>; user: Set<string>; account: Set<string> };
const bloquer = (valeurs: Partial<Record<keyof Sujets, string[]>>): Sujets => ({
  session: new Set(valeurs.session ?? []),
  visitor: new Set(valeurs.visitor ?? []),
  user: new Set(valeurs.user ?? []),
  account: new Set(valeurs.account ?? []),
});

const APP = "app-a";
const AUTRE = "app-b";

/** Deux personnes, deux sessions, plus une exception sans session (P5.3). */
function lot() {
  return {
    sessions: [
      { app_id: APP, session_id: "s1", visitor_id: "v1", user_id_hash: "h-alice" },
      { app_id: APP, session_id: "s2", visitor_id: "v2", user_id_hash: "h-bob" },
      { app_id: AUTRE, session_id: "s3", visitor_id: "v3", user_id_hash: "h-alice" },
    ],
    pageviews: [
      { app_id: APP, session_id: "s1" },
      { app_id: APP, session_id: "s2" },
      { app_id: AUTRE, session_id: "s3" },
    ],
    errors: [
      { app_id: APP, session_id: null, user_id_hash: "h-alice" },
      { app_id: APP, session_id: "s2" },
    ],
    rejected: 0,
  };
}

describe("la clé de verrou est UNE constante partagée", () => {
  it("la valeur de JavaScript et celle du SQL sont la même", () => {
    // Deux copies qui dérivent, ce sont deux verrous : chacun se croit seul, et
    // la sérialisation n'existe plus sans qu'aucun test ne le dise.
    expect(VERROU_INGESTION_NS).toBe(811_801);
    expect(V81).toContain("language sql immutable parallel safe as $$ select 811801 $$");
  });

  it("le verrou est de TRANSACTION, jamais de session — le pooler l'exige", () => {
    expect(PRIMITIVE).toContain("pg_advisory_xact_lock");
    expect(PRIMITIVE).not.toContain("pg_advisory_lock(");
    expect(V81).not.toMatch(/perform pg_advisory_lock\(/);
  });

  it("l'ordre multi-app se calcule sur la CLÉ, pas sur le texte de l'app", () => {
    // Trier par app_id ferait dépendre l'ordre de la collation : JavaScript trie
    // en UTF-16, PostgreSQL selon sa locale. Deux lots multi-app s'y
    // interbloqueraient.
    expect(PRIMITIVE).toContain("group by a order by 2, 1");
    expect(V81).toContain("select distinct hashtext(a) as cle");
  });

  it("la stratégie d'attente est bornée et nommée", () => {
    expect(STRATEGIE_VERROU.delaiMs).toBe(5_000);
    expect(STRATEGIE_VERROU.tentatives).toBeGreaterThan(1);
    expect(STRATEGIE_VERROU.reculMs.length).toBeGreaterThan(0);
    expect(PRIMITIVE).toContain("set local lock_timeout");
  });
});

describe("sujetsDuLot — seuls des identifiants, jamais une ressemblance", () => {
  it("relève session, visiteur et HMAC, par application", () => {
    const vu = sujetsDuLot(lot()) as Map<string, Sujets>;
    expect([...vu.keys()].sort()).toEqual([APP, AUTRE]);
    expect([...vu.get(APP)!.session].sort()).toEqual(["s1", "s2"]);
    expect([...vu.get(APP)!.user].sort()).toEqual(["h-alice", "h-bob"]);
    expect([...vu.get(AUTRE)!.session]).toEqual(["s3"]);
  });

  it("ne relève NI message, NI stack, NI user-agent", () => {
    const vu = sujetsDuLot({
      errors: [{ app_id: APP, message: "boom", stack: "at f()", user_agent: "Mozilla" }],
    }) as Map<string, Sujets>;
    expect(vu.size).toBe(0);
  });

  it("appsDuLot rend les applications réellement présentes", () => {
    expect((appsDuLot(lot()) as string[]).sort()).toEqual([APP, AUTRE]);
    expect(appsDuLot({})).toEqual([]);
  });
});

describe("filtrerLot — la personne effacée sort, l'autre reste", () => {
  it("une barrière d'identité emporte AUSSI les lignes de ses sessions", () => {
    // Sans la première passe, la session serait refusée mais ses pages vues
    // entreraient quand même : une clé étrangère en échec ferait alors perdre
    // le lot ENTIER, donc les données de l'autre personne.
    const { rows, refuses, total } = filtrerLot(lot(), new Map([[APP, bloquer({ user: ["h-alice"] })]])) as {
      rows: ReturnType<typeof lot>; refuses: Record<string, number>; total: number;
    };
    expect(rows.sessions.map((s) => s.session_id)).toEqual(["s2", "s3"]);
    expect(rows.pageviews.map((p) => p.session_id)).toEqual(["s2", "s3"]);
    // L'exception SANS session mais portant le HMAC correspond directement.
    expect(rows.errors).toHaveLength(1);
    expect(rows.errors[0].session_id).toBe("s2");
    expect(total).toBe(3);
    expect(refuses).toEqual({ sessions: 1, pageviews: 1, errors: 1 });
  });

  it("une barrière de session n'emporte que cette session", () => {
    const { rows } = filtrerLot(lot(), new Map([[APP, bloquer({ session: ["s2"] })]])) as {
      rows: ReturnType<typeof lot>;
    };
    expect(rows.sessions.map((s) => s.session_id)).toEqual(["s1", "s3"]);
    expect(rows.errors.map((e) => e.user_id_hash ?? null)).toEqual(["h-alice"]);
  });

  it("une barrière de visiteur emporte les lignes de ses sessions", () => {
    const { rows } = filtrerLot(lot(), new Map([[APP, bloquer({ visitor: ["v1"] })]])) as {
      rows: ReturnType<typeof lot>;
    };
    expect(rows.sessions.map((s) => s.session_id)).toEqual(["s2", "s3"]);
    expect(rows.pageviews.map((p) => p.session_id)).toEqual(["s2", "s3"]);
  });

  it("une barrière ne franchit JAMAIS la frontière d'application", () => {
    // `h-alice` est aussi porté par la session s3 de l'autre application : elle
    // doit rester. Le HMAC est cloisonné par app ; une collision ne vaut pas
    // identité.
    const { rows } = filtrerLot(lot(), new Map([[APP, bloquer({ user: ["h-alice"] })]])) as {
      rows: ReturnType<typeof lot>;
    };
    expect(rows.sessions.filter((s) => s.app_id === AUTRE)).toHaveLength(1);
  });

  it("aucune barrière : le lot ressort IDENTIQUE, sans copie inutile", () => {
    const entree = lot();
    const sortie = filtrerLot(entree, new Map()) as { rows: unknown; total: number };
    expect(sortie.rows).toBe(entree);
    expect(sortie.total).toBe(0);
  });

  it("les clés non tabulaires du lot traversent le filtre", () => {
    const { rows } = filtrerLot(lot(), new Map([[APP, bloquer({ session: ["s1"] })]])) as {
      rows: ReturnType<typeof lot>;
    };
    expect(rows.rejected).toBe(0);
  });
});

describe("les writers partagent UNE primitive, et le rejeu n'ouvre pas de transaction", () => {
  it("writeRows, writeLogs et writeReplayChunk passent tous par withAppIngestTransaction", () => {
    for (const writer of ["writeRows", "writeLogs", "writeReplayChunk"]) {
      const bloc = PG.slice(PG.indexOf(`export async function ${writer}(`) >= 0
        ? PG.indexOf(`export async function ${writer}(`)
        : PG.indexOf(`export function ${writer}(`));
      expect(bloc.slice(0, 3_000), writer).toContain("withAppIngestTransaction");
    }
  });

  it("un client transactionnel fourni ne fait PAS rouvrir une transaction", () => {
    // Rouvrir une connexion romprait la sérialisation : c'est exactement le
    // défaut d'origine du drain.
    expect(PG).toContain("if (fourni) return await travail(client);");
    expect(PG).toContain("if (fourni) return travail(fourni);");
    expect(PG).toContain("if (fourni) return writeReplayChunkWithClient(fourni, chunk);");
  });

  it("les variantes `WithClient` ne contiennent ni begin, ni commit, ni release", () => {
    for (const nom of ["writeRowsWithClient", "writeLogsWithClient", "writeReplayChunkWithClient"]) {
      const debut = PG.indexOf(`export async function ${nom}(`);
      const fin = PG.indexOf("\n}\n", debut);
      const corps = PG.slice(debut, fin);
      expect(corps, nom).not.toContain('query("begin")');
      expect(corps, nom).not.toContain('query("commit")');
      expect(corps, nom).not.toContain("release()");
    }
  });

  it("le rejeu ne crée plus aveuglément une session minimale", () => {
    const debut = PG.indexOf("export async function writeReplayChunkWithClient(");
    const corps = PG.slice(debut, PG.indexOf("\n}\n", debut));
    // La création reste possible SOUS la protection désactivée, jamais avant
    // d'avoir consulté la barrière.
    expect(corps.indexOf("sessionSousBarriere")).toBeLessThan(corps.indexOf("insert into rum_session"));
    expect(corps.indexOf("barriereActivee")).toBeLessThan(corps.indexOf("insert into rum_session"));
  });
});

describe("la politique manquante est ÉCRITE, pas sous-entendue", () => {
  /** Le texte des commentaires, sans les tirets qui les introduisent. */
  const prose = (sql: string) => sql.replace(/^\s*--\s?/gm, "").replace(/\s+/g, " ");

  it("la migration dit que la décision n'a pas été prise et que la protection n'est pas activée", () => {
    const plat = prose(V81);
    expect(plat).toContain("DÉCISION DE POLITIQUE QUI N'A PAS ÉTÉ PRISE");
    expect(plat).toContain("`app_registry.privacy_barrier_mode` vaut `off` par défaut");
    expect(plat).toContain("La barrière EST ELLE-MÊME UNE DONNÉE PSEUDONYME");
  });

  it("aucune expiration n'est inventée : expires_at est nullable et vaut NULL", () => {
    expect(V81).toContain("expires_at   timestamptz,");
    expect(prose(V81)).toContain("Aucune purge automatique");
    // Et la rétention ne l'emporte pas non plus.
    const purge = V81.slice(V81.indexOf("create or replace function purge_rum_app"));
    expect(purge.slice(0, purge.indexOf("end $$;"))).not.toContain("delete from privacy_erasure_barrier");
  });

  it("aucune voie de RÉACTIVATION n'existe, ni en SQL ni dans la primitive", () => {
    // Un drapeau du SDK qui lèverait une barrière serait la faille que tout ce
    // lot ferme. Il n'y a donc aucune fonction de levée.
    expect(V81).not.toMatch(/delete from privacy_erasure_barrier/);
    expect(PRIMITIVE).not.toMatch(/delete from privacy_erasure_barrier/);
    expect(PRIMITIVE).toContain("Aucune fonction de LEVÉE n'existe dans ce module");
  });

  it("le rapport DSAR affiche la limite des identifiants et l'état de la protection", () => {
    expect(DSAR_LIMITES.join(" ")).toContain("Un événement totalement anonyme");
    expect(DSAR_LIMITES.join(" ")).toContain("Aucune suppression");
    expect(DSAR_BARRIERE_MESSAGES.off).toContain("NON ACTIVÉE");
    expect(DSAR_BARRIERE_MESSAGES.off).toContain("décision de politique");
    expect(DSAR_BARRIERE_MESSAGES.indisponible).toContain("v81");
  });
});
