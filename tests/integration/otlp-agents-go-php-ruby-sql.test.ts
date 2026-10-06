// R11 — les corps OTLP RÉELLEMENT émis par les agents OpenTelemetry de Go, de PHP et
// de Ruby (tests/fixtures/otlp-agents/, capturés le 01/10/2026), rejoués octet pour
// octet contre le serveur de développement du collector et une vraie base.
//
// Pourquoi des corps capturés et pas des agents lancés ici : Go et PHP ne sont pas
// sur les postes ni en CI, et leurs dépendances (modules Go, Composer, gems) seraient
// celles du dépôt. Les trois applications d'essai ont tourné une fois, dans des
// conteneurs jetables, configurées par le seul socle de docs/capteurs-serveur.md
// (§ 1) ; ce que leurs exportateurs ont envoyé est figé ici, avec ses en-têtes
// (`content-type`, `content-encoding`). Provenance et versions :
// tests/fixtures/otlp-agents/README.md et manifeste.json.
//
// Ce que ce fichier prouve, pour chaque langage :
//   · le format de son exportateur (protobuf, gzip) est accepté tel quel, clé exigée ;
//   · ses spans SERVER deviennent des spans serveur, route ramenée à `:nom` et 404
//     sans route → `(non trouvée)` ; ses sous-appels (HTTP, SQL) des spans de détail ;
//   · l'exception de la route en échec est comptée UNE fois, même quand un journal
//     ERROR la porte aussi (PHP) ;
//   · tout se rattache à la session du navigateur par le `tracestate` qu'il a reçu ;
//   · les journaux, seulement là où l'agent en émet (PHP, par Monolog).
//
// Les horodatages des corps sont ceux de la capture : passé sept jours, l'ingestion
// les ramène à l'heure de réception (`nanosToDate`), ce qui ne change aucune ligne
// vérifiée ici.
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm test:sql
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
const LANGAGES = ["go", "php", "ruby"] as const;
type Langage = (typeof LANGAGES)[number];
const app = (l: Langage) => `r11-${l}`;
const cle = (l: Langage) => `r11-${l}-cle`;
const session = (l: Langage) => `r11-${l}-session`;
/** Traces des trois appels, par langage : 1 → go, 2 → php, 3 → ruby (manifeste). */
const trace = (l: Langage, k: 1 | 2 | 3) => `e11c00000000000000000000000${LANGAGES.indexOf(l) + 1}000${k}`;
const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
/** Tables écrites par ces lots, enfants avant parents (clés étrangères). */
const TABLES_APP = [
  "rum_event_index", "rum_action", "rum_metric", "rum_error", "rum_resource", "rum_longtask", "rum_breadcrumb",
  "rum_event", "rum_span", "rum_log", "rum_pageview", "rum_session", "tenant_usage_daily", "rate_counter",
  // Écrites par l'ingestion des routes : sans elles, chaque passage laissait des lignes
  // orphelines une fois `app_registry` vidé.
  "route_registry", "route_cardinality",
];

interface Corps {
  fichier: string;
  langage: Langage;
  signal: "traces" | "logs";
  contentType: string;
  contentEncoding: string;
  userAgent: string;
  octets: number;
  sha256: string;
}
const MANIFESTE = JSON.parse(readFileSync(join(FIXTURES, "manifeste.json"), "utf8")) as { corps: Corps[] };
/**
 * Les corps de CE fichier : le manifeste porte aussi ceux de Java, de .NET et de Python,
 * capturés par `capturer.mjs` et rejoués par otlp-agents-java-dotnet-python-sql.test.ts.
 */
const CORPS = MANIFESTE.corps.filter((c) => (LANGAGES as readonly string[]).includes(c.langage));
const lireCorps = (c: Corps) => readFileSync(join(FIXTURES, c.fichier));

const valeur = (a: { value?: Record<string, unknown> }) => (a.value ? Object.values(a.value)[0] : undefined);
const attributs = (l: { key: string; value?: Record<string, unknown> }[] | undefined) =>
  Object.fromEntries((l ?? []).map((a) => [a.key, valeur(a)]));

// Sans base : les fixtures elles-mêmes. Un corps retouché à la main ne prouverait plus
// rien sur l'agent ; l'empreinte du manifeste l'empêche.
describe("R11 — fixtures des agents Go, PHP et Ruby", () => {
  it("le manifeste couvre tous les corps du dossier, empreintes comprises", () => {
    // Tous les corps du dossier, tous langages : un fichier hors manifeste n'a pas de provenance.
    const fichiers = readdirSync(FIXTURES).filter((f) => /\.pb(\.[a-z]+)?$/.test(f)).sort();
    expect(MANIFESTE.corps.map((c) => c.fichier).sort()).toEqual(fichiers);
    for (const c of CORPS) {
      const brut = lireCorps(c);
      expect(brut.length, c.fichier).toBe(c.octets);
      expect(sha256(brut), c.fichier).toBe(c.sha256);
      // Ce que le socle demande : protobuf compressé en gzip, pour les trois.
      expect(c.contentType).toBe("application/x-protobuf");
      expect(c.contentEncoding).toBe("gzip");
    }
    expect(new Set(CORPS.map((c) => c.langage))).toEqual(new Set(LANGAGES));
  });

  it("chaque corps porte la ressource du socle : app, clé, service, environnement", () => {
    for (const c of CORPS) {
      const brut = decompresserOtlp(lireCorps(c), c.contentEncoding);
      const lot = c.signal === "logs" ? decoderLogsProtobuf(brut) : decoderTracesProtobuf(brut);
      const ressources = (lot.resourceSpans ?? lot.resourceLogs) as { resource?: { attributes?: never } }[];
      expect(ressources.length, c.fichier).toBeGreaterThan(0);
      for (const r of ressources) {
        expect(attributs(r.resource?.attributes), c.fichier).toMatchObject({
          "mip.app_id": app(c.langage),
          "mip.api_key": cle(c.langage),
          "service.name": `factures-${c.langage}`,
          "deployment.environment.name": "recette",
          "telemetry.sdk.language": c.langage,
        });
      }
    }
  });
});

const pool = new pg.Pool(URL_TEST ? { connectionString: URL_TEST, max: 3 } : { max: 3 });
const suite = URL_TEST ? describe : describe.skip;
if (!URL_TEST) console.warn("[otlp-agents-go-php-ruby-sql] SAUTÉ — définir SQL_TEST_DATABASE_URL (base jetable).");

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

suite("R11 — corps des agents Go, PHP et Ruby → dev-server du collector → Postgres", () => {
  let serveur: ChildProcess | undefined;
  let base = "";
  const journal: string[] = [];

  async function nettoyer() {
    for (const l of LANGAGES) {
      for (const table of TABLES_APP) await pool.query(`delete from ${table} where app_id = $1`, [app(l)]);
    }
  }

  /** Rejoue un corps tel que l'exportateur l'a envoyé : mêmes octets, mêmes en-têtes. */
  async function rejouer(c: Corps) {
    return fetch(`${base}/v1/${c.signal}`, {
      method: "POST",
      headers: { "content-type": c.contentType, "content-encoding": c.contentEncoding, "user-agent": c.userAgent },
      body: lireCorps(c),
    });
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
              // Un span par langage : un spanId partagé ferait d'une ancre le doublon d'une autre.
              name: "pageview", traceId: trace(l, 1).replace(/0001$/, "0000"), spanId: `e11c00000000000${LANGAGES.indexOf(l) + 1}`,
              startTimeUnixNano: t, endTimeUnixNano: t,
              attributes: [attr("mip.session_id", session(l)), attr("mip.url", "https://factures.exemple.fr/factures/42")],
            }] }],
          }],
        }),
      });
      expect(ancre.status).toBe(200);
    }

    // Les corps, dans l'ordre de leur capture (PHP envoie ses journaux avant ses spans).
    for (const c of CORPS) {
      const r = await rejouer(c);
      expect(r.status, `${c.fichier}\n${journal.join("")}`).toBe(200);
      // La réponse que l'exportateur a lue comme un succès à la capture : protobuf.
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

  // « Clé exigée » : le dev-server refuse bien une clé fausse ou absente. Sans ce cas, un
  // serveur qui ignorerait REQUIRE_API_KEY laisserait passer tous les tests ci-dessous.
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

  // Ce qui vaut pour les trois : la 404 sans route, et la route en échec.
  for (const l of LANGAGES) {
    it(`${l} — 404 sans route → « (non trouvée) », jamais le chemin brut`, async () => {
      expect(await spans(l, 3)).toEqual([
        { tier: "back", kind: "server", session_id: session(l), method: "GET", status_code: 404, route: "(non trouvée)", name: "GET", service: `factures-${l}`, env: "recette" },
      ]);
    });

    it(`${l} — l'exception de POST /factures/:id/payer comptée une fois, rattachée à la session`, async () => {
      const lignes = await erreurs(l);
      expect(lignes).toHaveLength(1);
      expect(lignes[0]).toMatchObject({
        trace_id: trace(l, 2),
        session_id: session(l),
        route: "/factures/:id/payer",
        message: "paiement refusé : facture déjà soldée",
        service: `factures-${l}`,
        env: "recette",
        origin_signal: "span_event",
      });
      const serveurs = (await spans(l, 2)).filter((s) => s.tier === "back");
      expect(serveurs).toEqual([
        expect.objectContaining({ session_id: session(l), method: "POST", status_code: 500, route: "/factures/:id/payer" }),
      ]);
    });
  }

  it("go — otelhttp : la route vient du nom du span (`GET /factures/{id}`, sans `http.route`), sous-appel HTTP en détail", async () => {
    expect(await spans("go", 1)).toEqual([
      { tier: "back", kind: "server", session_id: session("go"), method: "GET", status_code: 200, route: "/factures/:id", name: "/factures/{id}", service: "factures-go", env: "recette" },
      { tier: "back", kind: "server", session_id: session("go"), method: "GET", status_code: 200, route: "/stock/:id", name: "/stock/{id}", service: "factures-go", env: "recette" },
      { tier: "detail", kind: "internal", session_id: session("go"), method: null, status_code: null, route: null, name: "HTTP GET", service: "factures-go", env: "recette" },
    ]);
    expect((await erreurs("go"))[0].error_type).toBe("*errors.errorString");
  });

  it("php — Slim et PDO : route `http.route`, requêtes SQL en détail, exception portée par le span interne", async () => {
    const lignes = await spans("php", 1);
    expect(lignes[0]).toEqual({ tier: "back", kind: "server", session_id: session("php"), method: "GET", status_code: 200, route: "/factures/:id", name: "/factures/:id", service: "factures-php", env: "recette" });
    const sql = lignes.filter((s) => s.kind === "db");
    expect(sql.map((s) => s.name)).toEqual(expect.arrayContaining(["select montant from facture where id = ?"]));
    for (const s of sql) expect(s).toMatchObject({ tier: "detail", route: "sqlite", session_id: session("php") });
    expect((await erreurs("php"))[0].error_type).toBe("RuntimeException");
  });

  it("php — journaux Monolog (auto-psr3) : écrits, reliés à leur trace et à leur span, sans session propre", async () => {
    const { rows } = await pool.query(
      "select trace_id, span_id, session_id, severity_num, body from rum_log where app_id = $1 order by severity_num",
      [app("php")],
    );
    expect(rows).toEqual([
      expect.objectContaining({ trace_id: trace("php", 1), session_id: null, severity_num: 9, body: "facture lue" }),
      expect.objectContaining({ trace_id: trace("php", 2), session_id: null, severity_num: 17, body: "paiement en échec" }),
    ]);
    // Le span du journal existe : le journal se relie à la cascade par la trace.
    for (const log of rows) {
      const { rows: span } = await pool.query("select session_id from rum_span where app_id = $1 and span_id = $2", [app("php"), log.span_id]);
      expect(span).toEqual([{ session_id: session("php") }]);
    }
  });

  // « Aucun journal » pour Go et Ruby est un constat de la capture (leurs agents n'ont
  // envoyé aucun corps de journaux, manifeste), pas une propriété que ce test démontre.
  it("ruby — Sinatra : route `http.route`, sous-appel Net::HTTP en détail ; aucun corps de journaux capturé pour Go ni Ruby", async () => {
    const lignes = await spans("ruby", 1);
    expect(lignes.filter((s) => s.tier === "back")).toEqual([
      { tier: "back", kind: "server", session_id: session("ruby"), method: "GET", status_code: 200, route: "/factures/:id", name: "/factures/:id", service: "factures-ruby", env: "recette" },
      { tier: "back", kind: "server", session_id: session("ruby"), method: "GET", status_code: 200, route: "/stock/:id", name: "/stock/:id", service: "factures-ruby", env: "recette" },
    ]);
    expect(lignes.filter((s) => s.tier === "detail").map((s) => s.name).sort()).toEqual(["GET", "connect"]);
    expect((await erreurs("ruby"))[0].error_type).toBe("RuntimeError");
    expect(CORPS.filter((c) => c.signal === "logs").map((c) => c.langage)).toEqual(["php", "php"]);
    const { rows } = await pool.query("select count(*)::int n from rum_log where app_id = any($1)", [[app("go"), app("ruby")]]);
    expect(rows[0].n).toBe(0);
  });

  it("rejouer les mêmes corps n'ajoute aucune exception", async () => {
    for (const c of CORPS) expect((await rejouer(c)).status).toBe(200);
    for (const l of LANGAGES) expect(await erreurs(l), l).toHaveLength(1);
  }, 30_000);
});
