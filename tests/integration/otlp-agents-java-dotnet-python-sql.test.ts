// R11 — les corps OTLP RÉELLEMENT émis par les agents OpenTelemetry officiels de Java
// (opentelemetry-javaagent), de .NET (instrumentation automatique) et de Python
// (opentelemetry-instrument, sous Flask), rejoués octet pour octet contre le serveur de
// développement du collector et une vraie base. Même mécanisme que Go, PHP et Ruby
// (otlp-agents-go-php-ruby-sql.test.ts), même manifeste.
//
// D'où viennent les corps : `tests/fixtures/otlp-agents/capturer.mjs` construit les
// trois applications de `applications/` (agent à version et empreinte figées), les
// lance avec le seul socle de la page Installer (`socleOtel`), les appelle comme un
// navigateur porteur du SDK web, et garde ce que chaque agent a envoyé. La capture
// tourne en CI (.github/workflows/agents-otlp.yml) dès qu'une application, le script
// ou ce fichier change, et ce fichier la vérifie aussitôt ; ce qui est versionné est
// une capture de ce workflow (provenance : manifeste.json, `langages.<l>.capture`).
//
// Ce que ce fichier prouve, pour chaque langage :
//   · son exportateur (protobuf) est accepté tel quel, clé exigée ;
//   · ses spans SERVER deviennent des spans serveur, route `http.route` ramenée à
//     `:nom`, 404 sans route → `(non trouvée)` (Spring Boot : `/**`, voir plus bas) ;
//     son sous-appel HTTP, un span de détail ;
//   · ses spans sont dans la trace du navigateur (`traceparent`) et rattachés à sa
//     session (`tracestate`) ;
//   · l'exception de la route en échec est comptée UNE fois — par le journal ERROR du
//     framework, qui arrive avant le span —, et prend pourtant la session et la route
//     de son span serveur (migration-v110) ;
//   · ses journaux sont écrits et reliés à leur trace.
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm vitest run tests/integration/otlp-agents-java-dotnet-python-sql.test.ts
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decompresserOtlp } from "../../packages/backend/shared/otlp-corps.mjs";
import { decoderLogsProtobuf, decoderTracesProtobuf } from "../../packages/backend/shared/otlp-protobuf.mjs";

const URL_TEST = process.env.SQL_TEST_DATABASE_URL;
const RACINE = join(__dirname, "..", "..");
const SQL_DIR = join(RACINE, "packages", "db", "sql");
const FIXTURES = join(RACINE, "tests", "fixtures", "otlp-agents");
const LANGAGES = ["java", "dotnet", "python"] as const;
type Langage = (typeof LANGAGES)[number];
/** Rang de chaque langage dans les identifiants de trace du manifeste (1 Go, 2 PHP, 3 Ruby). */
const RANG: Record<Langage, number> = { java: 4, dotnet: 5, python: 6 };
const app = (l: Langage) => `r11-${l}`;
const cle = (l: Langage) => `r11-${l}-cle`;
const session = (l: Langage) => `r11-${l}-session`;
const service = (l: Langage) => `factures-${l}`;
const trace = (l: Langage, k: 1 | 2 | 3) => `e11c00000000000000000000000${RANG[l]}000${k}`;
/** Le socle de la page Installer pose `deployment.environment.name=prod`. */
const ENV = "prod";
const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const TABLES_APP = [
  "rum_event_index", "rum_action", "rum_metric", "rum_error", "rum_resource", "rum_longtask", "rum_breadcrumb",
  "rum_event", "rum_span", "rum_log", "rum_pageview", "rum_session", "tenant_usage_daily", "rate_counter",
  "route_registry", "route_cardinality",
];

interface Corps {
  fichier: string;
  langage: string;
  signal: "traces" | "logs";
  contentType: string;
  contentEncoding: string;
  userAgent: string;
  octets: number;
  sha256: string;
  statutALaCapture: number;
}
const MANIFESTE = JSON.parse(readFileSync(join(FIXTURES, "manifeste.json"), "utf8")) as {
  corps: Corps[];
  langages: Record<string, { versions: Record<string, string> }>;
};
const CORPS = MANIFESTE.corps.filter((c) => (LANGAGES as readonly string[]).includes(c.langage));
const corpsDe = (l: Langage) => CORPS.filter((c) => c.langage === l);
const lireCorps = (c: Corps) => readFileSync(join(FIXTURES, c.fichier));
const decoder = (c: Corps) => {
  const brut = decompresserOtlp(lireCorps(c), c.contentEncoding);
  return c.signal === "logs" ? decoderLogsProtobuf(brut) : decoderTracesProtobuf(brut);
};

const valeur = (a: { value?: Record<string, unknown> }) => (a.value ? Object.values(a.value)[0] : undefined);
const attributs = (l: { key: string; value?: Record<string, unknown> }[] | undefined) =>
  Object.fromEntries((l ?? []).map((a) => [a.key, valeur(a)]));

describe("R11 — fixtures des agents Java, .NET et Python", () => {
  it("chaque langage a ses corps, tailles et empreintes conformes au manifeste", () => {
    const fichiers = new Set(readdirSync(FIXTURES));
    for (const l of LANGAGES) {
      const corps = corpsDe(l);
      expect(corps.some((c) => c.signal === "traces"), l).toBe(true);
      for (const c of corps) {
        expect(fichiers.has(c.fichier), c.fichier).toBe(true);
        const brut = lireCorps(c);
        expect(brut.length, c.fichier).toBe(c.octets);
        expect(sha256(brut), c.fichier).toBe(c.sha256);
        // http/protobuf, ce que le socle demande ; et la collecte a dit oui.
        expect(c.contentType, c.fichier).toBe("application/x-protobuf");
        expect(c.statutALaCapture, c.fichier).toBe(200);
      }
    }
  });

  it("l'agent est celui qu'on dit, à la version figée", () => {
    expect(MANIFESTE.langages.java.versions.OTEL_JAVAAGENT_VERSION).toBe("2.31.1");
    expect(MANIFESTE.langages.dotnet.versions.OTEL_DOTNET_AUTO_VERSION).toBe("1.17.0");
    expect(MANIFESTE.langages.python.versions["opentelemetry-distro"]).toBe("0.66b0");
    expect(MANIFESTE.langages.python.versions["opentelemetry-sdk"]).toBe("1.45.0");
  });

  it("chaque corps porte la ressource du socle de la page Installer : app, clé, service, environnement", () => {
    for (const c of CORPS) {
      const lot = decoder(c);
      const ressources = (lot.resourceSpans ?? lot.resourceLogs) as { resource?: { attributes?: never } }[];
      expect(ressources.length, c.fichier).toBeGreaterThan(0);
      for (const r of ressources) {
        expect(attributs(r.resource?.attributes), c.fichier).toMatchObject({
          "mip.app_id": `r11-${c.langage}`,
          "mip.api_key": `r11-${c.langage}-cle`,
          "service.name": `factures-${c.langage}`,
          "deployment.environment.name": ENV,
          "telemetry.sdk.language": c.langage,
        });
      }
    }
  });
});

const pool = new pg.Pool(URL_TEST ? { connectionString: URL_TEST, max: 3 } : { max: 3 });
const suite = URL_TEST ? describe : describe.skip;
if (!URL_TEST) console.warn("[otlp-agents-java-dotnet-python-sql] SAUTÉ — définir SQL_TEST_DATABASE_URL (base jetable).");

function fichiersSql(): string[] {
  const migrations = readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  return ["schema.sql", ...migrations].map((f) => join(SQL_DIR, f));
}

const portLibre = () =>
  new Promise<number>((ok, ko) => {
    const s = createServer();
    s.once("error", ko);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
  });

suite("R11 — corps des agents Java, .NET et Python → dev-server du collector → Postgres", () => {
  let serveur: ChildProcess | undefined;
  let base = "";
  const journal: string[] = [];

  async function nettoyer() {
    for (const l of LANGAGES) {
      for (const table of TABLES_APP) await pool.query(`delete from ${table} where app_id = $1`, [app(l)]);
    }
  }

  async function rejouer(c: Corps) {
    const headers: Record<string, string> = { "content-type": c.contentType, "user-agent": c.userAgent };
    if (c.contentEncoding) headers["content-encoding"] = c.contentEncoding;
    return fetch(`${base}/v1/${c.signal}`, { method: "POST", headers, body: lireCorps(c) });
  }

  const spans = (l: Langage, k: 1 | 2 | 3) =>
    pool
      .query(
        `select tier, kind, session_id, method, status_code, route, name, service, env
           from rum_span where app_id = $1 and trace_id = $2
          order by tier, route nulls last, name`,
        [app(l), trace(l, k)],
      )
      .then((r) => r.rows);
  const erreurs = (l: Langage) =>
    pool
      .query(
        `select trace_id, session_id, route, error_type, message, service, env, origin_signal
           from rum_error where app_id = $1 order by trace_id`,
        [app(l)],
      )
      .then((r) => r.rows);

  beforeAll(async () => {
    const c = await pool.connect();
    try {
      for (const f of fichiersSql()) await c.query(readFileSync(f, "utf8"));
    } finally {
      c.release();
    }
    await nettoyer();
    for (const l of LANGAGES) {
      await pool.query("delete from app_registry where app_id = $1", [app(l)]);
      await pool.query(
        "insert into app_registry (app_id, name, api_key_hash, active, privacy_barrier_mode) values ($1, $1, $2, true, 'off')",
        [app(l), sha256(cle(l))],
      );
    }

    const port = await portLibre();
    base = `http://127.0.0.1:${port}`;
    serveur = spawn(process.execPath, [join(RACINE, "services", "collector", "dev-server.mjs")], {
      cwd: RACINE,
      // Environnement EXPLICITE : rien n'hérite du shell (pas de DATABASE_URL de production).
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        DATABASE_URL: URL_TEST!,
        INGEST_PORT: String(port),
        PGPOOL_MAX: "3",
        REQUIRE_API_KEY: "true",
        IDENTITY_HASH_SECRET: "r11-secret-identite",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    serveur.stdout!.on("data", (b) => journal.push(String(b)));
    serveur.stderr!.on("data", (b) => journal.push(String(b)));
    const echeance = Date.now() + 20_000;
    for (;;) {
      const ok = await fetch(`${base}/health`).then((r) => r.ok).catch(() => false);
      if (ok) break;
      if (Date.now() > echeance || serveur.exitCode !== null) throw new Error(`dev-server non démarré :\n${journal.join("")}`);
      await new Promise((r) => setTimeout(r, 150));
    }

    // La session du navigateur, ancrée comme le ferait le SDK web (JSON), AVANT les
    // corps des agents : c'est elle que leur `tracestate` revendique.
    const t = (BigInt(Date.now() - 60_000) * 1_000_000n).toString();
    const attr = (key: string, value: string) => ({ key, value: { stringValue: value } });
    for (const l of LANGAGES) {
      const ancre = await fetch(`${base}/v1/traces`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resourceSpans: [{
            resource: { attributes: [attr("mip.app_id", app(l)), attr("mip.api_key", cle(l))] },
            scopeSpans: [{ spans: [{
              name: "pageview", traceId: trace(l, 1).replace(/0001$/, "0000"), spanId: `e11c00000000000${RANG[l]}`,
              startTimeUnixNano: t, endTimeUnixNano: t,
              attributes: [attr("mip.session_id", session(l)), attr("mip.url", "https://factures.exemple.fr/factures/42")],
            }] }],
          }],
        }),
      });
      expect(ancre.status).toBe(200);
    }

    // Les corps, dans l'ordre de leur arrivée à la capture.
    for (const c of CORPS) {
      const r = await rejouer(c);
      expect(r.status, `${c.fichier}\n${journal.join("")}`).toBe(200);
      expect(r.headers.get("content-type"), c.fichier).toContain("application/x-protobuf");
    }
  }, 180_000);

  afterAll(async () => {
    if (serveur && serveur.exitCode === null) {
      serveur.kill("SIGTERM");
      await new Promise((r) => serveur!.once("exit", r));
    }
    await nettoyer();
    for (const l of LANGAGES) await pool.query("delete from app_registry where app_id = $1", [app(l)]);
    await pool.end();
  });

  it("clé exigée : une clé fausse ou absente est refusée en 403", async () => {
    const attr = (key: string, value: string) => ({ key, value: { stringValue: value } });
    for (const l of LANGAGES) {
      for (const ressource of [
        [attr("mip.app_id", app(l)), attr("mip.api_key", `${cle(l)}-fausse`)],
        [attr("mip.app_id", app(l))],
      ]) {
        const r = await fetch(`${base}/v1/traces`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ resourceSpans: [{ resource: { attributes: ressource }, scopeSpans: [{ spans: [] }] }] }),
        });
        expect(r.status, l).toBe(403);
      }
    }
  });

  for (const l of LANGAGES) {
    it(`${l} — GET /factures/42 : route \`http.route\` en \`:nom\`, sous-appel en détail, trace et session du navigateur`, async () => {
      const lignes = await spans(l, 1);
      const serveurs = lignes.filter((s) => s.tier === "back");
      expect(serveurs).toEqual([
        expect.objectContaining({ kind: "server", session_id: session(l), method: "GET", status_code: 200, route: "/factures/:id", service: service(l), env: ENV }),
        expect.objectContaining({ kind: "server", session_id: session(l), method: "GET", status_code: 200, route: "/stock/:id", service: service(l), env: ENV }),
      ]);
      const details = lignes.filter((s) => s.tier === "detail");
      expect(details.length, JSON.stringify(lignes)).toBeGreaterThan(0);
      for (const s of details) expect(s).toMatchObject({ session_id: session(l), service: service(l) });
    });

    // Spring Boot sert les ressources statiques sous le motif `/**` : un chemin inconnu y
    // tombe, et le javaagent écrit `http.route=/**` sur la 404. La route est donc
    // déclarée, et la 404 reste rangée sous `/**`, pas sous « (non trouvée) » — constaté
    // à la capture, dit dans le guide d'intégration, annexe K. Jamais le chemin brut.
    const route404 = l === "java" ? "/**" : "(non trouvée)";
    it(`${l} — 404 → « ${route404} », jamais le chemin brut`, async () => {
      const serveurs = (await spans(l, 3)).filter((s) => s.tier === "back");
      expect(serveurs).toEqual([
        expect.objectContaining({ kind: "server", session_id: session(l), method: "GET", status_code: 404, route: route404, service: service(l), env: ENV }),
      ]);
    });

    // L'exception est comptée UNE fois, par le JOURNAL ERROR que le framework écrit
    // (Tomcat, Kestrel, Flask), porteur d'`exception.type` : les trois agents exportent
    // leurs journaux avant leurs spans, et un journal ne porte ni session ni route. Le
    // span serveur (500), arrivé ensuite, les lui donne (migration-v110) : l'erreur est
    // dans la session du navigateur et sous la route de sa requête. Elle reste
    // `origin_signal = 'log'` : c'est le journal qui l'a comptée.
    // .NET n'enregistre même pas l'exception sur le span (constaté avec 1.17.0).
    const TYPE: Record<Langage, string> = {
      java: "java.lang.IllegalStateException",
      dotnet: "InvalidOperationException",
      python: "RuntimeError",
    };
    it(`${l} — l'exception de POST /factures/:id/payer comptée une fois, par le journal, avec la session et la route de son span`, async () => {
      const lignes = await erreurs(l);
      expect(lignes).toHaveLength(1);
      expect(lignes[0]).toMatchObject({
        trace_id: trace(l, 2),
        session_id: session(l),
        route: "/factures/:id/payer",
        error_type: TYPE[l],
        message: "paiement refusé : facture déjà soldée",
        service: service(l),
        env: ENV,
        origin_signal: "log",
      });
      const serveurs = (await spans(l, 2)).filter((s) => s.tier === "back");
      expect(serveurs).toEqual([
        expect.objectContaining({ session_id: session(l), method: "POST", status_code: 500, route: "/factures/:id/payer" }),
      ]);
    });

    it(`${l} — le journal « facture lue » : écrit, relié à sa trace et à un span de la session`, async () => {
      const { rows } = await pool.query(
        "select trace_id, span_id, session_id, severity_num, body from rum_log where app_id = $1 and body = 'facture lue'",
        [app(l)],
      );
      expect(rows).toEqual([expect.objectContaining({ trace_id: trace(l, 1), severity_num: 9 })]);
      const { rows: span } = await pool.query("select session_id from rum_span where app_id = $1 and span_id = $2", [app(l), rows[0].span_id]);
      expect(span).toEqual([{ session_id: session(l) }]);
    });
  }

  it("rejouer les mêmes corps n'ajoute aucune exception", async () => {
    for (const c of CORPS) expect((await rejouer(c)).status).toBe(200);
    for (const l of LANGAGES) {
      expect(await erreurs(l), l).toEqual([
        expect.objectContaining({ session_id: session(l), route: "/factures/:id/payer", origin_signal: "log" }),
      ]);
    }
  }, 30_000);
});
