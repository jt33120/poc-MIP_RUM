// migration-v63 + lib/ingest-differe.mjs — la file de débarquement, sur un vrai
// PostgreSQL.
//
// Ce qui doit être prouvé ici ne se lit pas dans le code : qu'un lot débarqué
// finit dans les tables finales À L'IDENTIQUE, qu'un lot empoisonné ne bloque
// pas la file, que deux travailleurs ne traitent pas le même lot, et qu'un
// effacement RGPD emporte ce qui n'est pas encore drainé.
//
//   SQL_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5433/sqltest pnpm test:sql
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error — module .mjs sans déclaration de types
import { MAX_TENTATIVES, deposerLot, drainerIngestRaw, etatIngestRaw } from "../../packages/backend/lib/ingest-differe.mjs";
// @ts-expect-error — module .mjs sans déclaration de types
import { flattenOtlp } from "../../packages/backend/shared/otlp.mjs";

const URL_TEST = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");
const APP = "differe-app";
// Seconde application : elle sert à prouver que le verrou de P8.1 est PAR
// application, et non global — deux apps se drainent bien de front.
const AUTRE_APP = "differe-app-b";
const muet = { info() {}, warn() {}, error() {}, debug() {} };

function fichiersSql(): string[] {
  const migrations = readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  return ["schema.sql", ...migrations].map((f) => join(SQL_DIR, f));
}

const pool = new pg.Pool(URL_TEST ? { connectionString: URL_TEST, max: 6 } : { max: 6 });
const suite = URL_TEST ? describe : describe.skip;

if (!URL_TEST) {
  console.warn("[ingest-differe-sql] SAUTÉ — définir SQL_TEST_DATABASE_URL (base jetable).");
}

/**
 * Un lot aplati produit par le VRAI flattenOtlp, et non écrit à la main.
 *
 * La première version de ce fichier fabriquait les lignes directement : elle a
 * échoué quatre fois de suite sur des colonnes NOT NULL que flattenOtlp
 * renseigne et qu'un fixtures écrit à la main oublie (`is_bot`,
 * `collection_source`, `sample_rate`, `error_sample_rate`). Un lot de test qui
 * dérive du vrai producteur ne peut pas dériver du produit.
 */
function lot(n: number, app: string = APP) {
  const sid = `d-${n}`;
  const base = Date.now() - 1000;
  const attr = (o: Record<string, string | number>) =>
    Object.entries(o).map(([key, value]) => ({
      key,
      value: typeof value === "number" ? { doubleValue: value } : { stringValue: String(value) },
    }));
  const span = (nom: string, extra: Record<string, string | number>, i: number) => ({
    name: nom,
    spanId: (n * 16 + i + 1).toString(16).padStart(16, "0"),
    traceId: `${sid}-t`,
    startTimeUnixNano: String((base + i) * 1e6),
    endTimeUnixNano: String((base + i + 5) * 1e6),
    attributes: attr({ "mip.session_id": sid, "mip.route": "/x", ...extra }),
  });
  return flattenOtlp({
    resourceSpans: [{
      resource: { attributes: attr({ "mip.app_id": app, "mip.client_id": "test" }) },
      scopeSpans: [{
        spans: [
          span("pageview", {
            "mip.visitor_id": `v-${n}`, "mip.url": "https://e.test/x",
            "mip.nav_type": "navigate", "mip.device_type": "desktop",
          }, 0),
          span("webvital.LCP", {
            "webvital.name": "LCP", "webvital.value": 1000 + n,
            "webvital.rating": "good", "webvital.id": `${sid}-lcp`,
          }, 1),
        ],
      }],
    }],
  });
}

beforeAll(async () => {
  if (!URL_TEST) return;
  const c = await pool.connect();
  for (const f of fichiersSql()) await c.query(readFileSync(f, "utf8"));
  await c.query(
    `insert into app_registry (app_id, name, active, route_limit) values ($1, $1, true, 5000)
     on conflict (app_id) do update set active = true`, [APP]);
  await c.query(
    `insert into app_registry (app_id, name, active, route_limit) values ($1, $1, true, 5000)
     on conflict (app_id) do update set active = true`, [AUTRE_APP]);
  c.release();
}, 180_000);
afterAll(async () => {
  if (URL_TEST) await pool.end();
});

async function repartirDeZero() {
  await pool.query("delete from ingest_raw");
  await pool.query("delete from rum_event_index where app_id = $1", [APP]);
  await pool.query("delete from rum_metric where app_id = $1", [APP]);
  await pool.query("delete from rum_pageview where app_id = $1", [APP]);
  await pool.query("delete from rum_session where app_id = $1", [APP]);
}

suite("le lot débarqué finit dans les tables finales, à l'identique", () => {
  it("un dépôt puis un drain écrivent exactement ce que l'écriture directe aurait écrit", async () => {
    await repartirDeZero();
    for (let n = 0; n < 5; n++) await deposerLot(pool, APP, lot(n));

    // AVANT le drain : rien dans les tables finales, tout dans la file. C'est le
    // découplage ; si les lignes étaient déjà là, la mesure de latence du banc
    // n'aurait mesuré aucun découplage.
    expect(Number((await pool.query("select count(*)::int n from rum_metric where app_id=$1", [APP])).rows[0].n)).toBe(0);
    expect((await etatIngestRaw(pool)).en_attente).toBe(5);

    const bilan = await drainerIngestRaw(pool, { max: 100, log: muet });
    expect(bilan).toEqual({ drains: 5, echecs: 0 });
    expect(Number((await pool.query("select count(*)::int n from rum_metric where app_id=$1", [APP])).rows[0].n)).toBe(5);
    expect(Number((await pool.query("select count(*)::int n from rum_pageview where app_id=$1", [APP])).rows[0].n)).toBe(5);
    // Chaque lot porte une pageview et un vital : la projection est conservée
    // dans le jsonb aplati et écrite par le même drain que les sources.
    expect(Number((await pool.query("select count(*)::int n from rum_event_index where app_id=$1", [APP])).rows[0].n)).toBe(10);
    expect((await etatIngestRaw(pool)).en_attente).toBe(0);
  });

  it("un même lot différé rejoué garde une seule projection par identité native", async () => {
    await repartirDeZero();
    const rejoue = lot(77);
    await deposerLot(pool, APP, rejoue);
    await deposerLot(pool, APP, rejoue);
    expect(await drainerIngestRaw(pool, { max: 10, log: muet })).toEqual({ drains: 2, echecs: 0 });
    expect(Number((await pool.query("select count(*)::int n from rum_pageview where app_id=$1", [APP])).rows[0].n)).toBe(1);
    expect(Number((await pool.query("select count(*)::int n from rum_metric where app_id=$1", [APP])).rows[0].n)).toBe(1);
    expect(Number((await pool.query("select count(*)::int n from rum_event_index where app_id=$1", [APP])).rows[0].n)).toBe(2);
  });

  it("supprime le lot drainé — sinon un second passage le rejouerait", async () => {
    const bilan = await drainerIngestRaw(pool, { max: 100, log: muet });
    expect(bilan).toEqual({ drains: 0, echecs: 0 });
  });

  it("survit à un lot dont des collections MANQUENT", async () => {
    // Un lot déposé avant l'ajout d'un signal n'a pas la clé correspondante.
    // Sans le complément, writeRows échouerait sur « undefined n'est pas
    // itérable » — une erreur qui ne dit rien de sa cause.
    await repartirDeZero();
    const complet = lot(99);
    const partiel = { sessions: complet.sessions, metrics: complet.metrics };
    await deposerLot(pool, APP, partiel);
    expect(await drainerIngestRaw(pool, { max: 10, log: muet })).toEqual({ drains: 1, echecs: 0 });
    expect(Number((await pool.query("select count(*)::int n from rum_metric where app_id=$1", [APP])).rows[0].n)).toBe(1);
  });
});

suite("un lot empoisonné ne bloque pas la file", () => {
  it("compte ses tentatives, laisse passer les suivants, puis renonce", async () => {
    await repartirDeZero();
    // `value` non numérique : writeRows échouera à l'insertion, pas au parsing —
    // c'est bien un échec d'ÉCRITURE qu'on veut éprouver.
    const poison = lot(1000);
    (poison.metrics[0] as Record<string, unknown>).value = "pas-un-nombre";
    await deposerLot(pool, APP, poison);
    await deposerLot(pool, APP, lot(1001));

    const un = await drainerIngestRaw(pool, { max: 100, log: muet });
    // UNE seule tentative dans cette passe : le lot en échec prend un recul et
    // sort de la file. Sans ce recul, ses cinq tentatives seraient brûlées en
    // quelques millisecondes — une coupure d'une seconde deviendrait une perte
    // définitive.
    expect(un.echecs).toBe(1);
    // ET LE SUIVANT EST PASSÉ. C'est la propriété qui distingue une file d'une
    // file bloquée.
    expect(un.drains).toBe(1);

    // On avance l'horloge du lot plutôt que d'attendre 31 secondes : c'est le
    // recul qu'on veut court-circuiter, pas la logique de renoncement.
    for (let i = 1; i < MAX_TENTATIVES; i++) {
      await pool.query("update ingest_raw set reprendre_a = now()");
      await drainerIngestRaw(pool, { max: 100, log: muet });
    }
    const etat = await etatIngestRaw(pool);
    expect(etat.bloques).toBe(1);
    expect(etat.en_attente).toBe(0);

    // Renoncé : plus repris du tout, même horloge remise à zéro, et l'erreur est
    // conservée pour être lue.
    await pool.query("update ingest_raw set reprendre_a = now()");
    expect(await drainerIngestRaw(pool, { max: 100, log: muet })).toEqual({ drains: 0, echecs: 0 });
    const { rows } = await pool.query<{ erreur: string }>("select erreur from ingest_raw");
    expect(rows[0].erreur).toBeTruthy();
  });

  it("remonte dans la santé interne plutôt que de rester silencieux", async () => {
    const { rows } = await pool.query<{ n: number }>(
      "select count(*) filter (where tentatives >= 5)::int as n from ingest_raw");
    expect(Number(rows[0].n)).toBe(1);
  });
});

suite("deux travailleurs peuvent drainer en parallèle", () => {
  it("ne traitent jamais le même lot deux fois", async () => {
    // CE QUE CE TEST PROUVE, ET CE QU'IL NE PROUVE PAS. Il prouve qu'aucun lot
    // n'est traité deux fois quand deux travailleurs tournent ensemble. Il ne
    // prouve PAS que `skip locked` est nécessaire : retirer le `skip locked` le
    // laisse passer, parce que `for update` seul est correct aussi — le second
    // travailleur ATTEND le premier au lieu de passer au suivant. La différence
    // est le débit, pas l'exactitude, et l'écrire ici évite de faire croire à
    // une garantie que la mesure ne soutient pas.
    await repartirDeZero();
    for (let n = 2000; n < 2040; n++) await deposerLot(pool, APP, lot(n));
    const [a, b] = await Promise.all([
      drainerIngestRaw(pool, { max: 100, log: muet }),
      drainerIngestRaw(pool, { max: 100, log: muet }),
    ]);
    expect(a.drains + b.drains).toBe(40);
    expect(a.echecs + b.echecs).toBe(0);
    expect((await etatIngestRaw(pool)).en_attente).toBe(0);
    expect(Number((await pool.query("select count(*)::int n from rum_metric where app_id=$1", [APP])).rows[0].n)).toBe(40);
  });

  it("une SEULE application se draine en série, et c'est le prix assumé de P8.1", async () => {
    // LE CHANGEMENT DE CONTRAT, ÉCRIT PLUTÔT QUE SUBI. Avant P8.1, deux
    // travailleurs drainaient la même application de front — `skip locked` leur
    // donnait deux lots différents. Désormais ils prennent le MÊME verrou
    // consultatif d'application : le second attend, constate que le candidat a
    // disparu, et passe au suivant. Le débit par application n'augmente donc
    // plus avec le nombre de travailleurs ; c'est ce qui rend l'effacement
    // prouvable, et le banc de charge le chiffre.
    await repartirDeZero();
    for (let n = 3100; n < 3108; n++) await deposerLot(pool, APP, lot(n));
    const debut = Date.now();
    const [a, b] = await Promise.all([
      drainerIngestRaw(pool, { max: 100, log: muet }),
      drainerIngestRaw(pool, { max: 100, log: muet }),
    ]);
    // Aucun doublon, aucun perdu — la propriété qui compte tient toujours.
    expect(a.drains + b.drains).toBe(8);
    expect(a.echecs + b.echecs).toBe(0);
    expect((await etatIngestRaw(pool)).en_attente).toBe(0);
    // Et personne ne reste bloqué : l'attente est bornée par `lock_timeout`, pas
    // par la fin de la file.
    expect(Date.now() - debut).toBeLessThan(20_000);
  });

  it("deux applications se drainent bien en parallèle : le verrou est PAR app", async () => {
    // Anti-tautologie de la sérialisation : si le verrou était global, ce test
    // ne verrait jamais les deux travailleurs avancer ensemble.
    await repartirDeZero();
    await pool.query("delete from rum_metric where app_id = $1", [AUTRE_APP]);
    await pool.query("delete from rum_session where app_id = $1", [AUTRE_APP]);
    for (let n = 3200; n < 3210; n++) await deposerLot(pool, APP, lot(n));
    for (let n = 3300; n < 3310; n++) await deposerLot(pool, AUTRE_APP, lot(n, AUTRE_APP));
    const [a, b] = await Promise.all([
      drainerIngestRaw(pool, { max: 100, log: muet }),
      drainerIngestRaw(pool, { max: 100, log: muet }),
    ]);
    expect(a.drains + b.drains).toBe(20);
    expect(a.echecs + b.echecs).toBe(0);
    expect((await etatIngestRaw(pool)).en_attente).toBe(0);
    await pool.query("delete from rum_metric where app_id = $1", [AUTRE_APP]);
    await pool.query("delete from rum_pageview where app_id = $1", [AUTRE_APP]);
    await pool.query("delete from rum_event_index where app_id = $1", [AUTRE_APP]);
    await pool.query("delete from rum_session where app_id = $1", [AUTRE_APP]);
  });
});

suite("l'effacement d'un client emporte ce qui n'est pas encore drainé", () => {
  it("vide aussi la file, et AVANT le reste", async () => {
    // Sans cette suppression, un lot en attente réintroduirait, quelques
    // secondes après l'effacement, exactement les données effacées.
    await repartirDeZero();
    await deposerLot(pool, APP, lot(3000));
    await pool.query("select erase_app_data($1)", [APP]);
    expect((await etatIngestRaw(pool)).en_attente).toBe(0);
    expect(await drainerIngestRaw(pool, { max: 10, log: muet })).toEqual({ drains: 0, echecs: 0 });
  });
});
