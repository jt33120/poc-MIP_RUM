// Charge légère (PLAN §12) : ~1 000 events OTLP scriptés -> sanity ingestion + console.
// Pas un bench : on vérifie que la chaîne tient et on note les chiffres réels.
import pg from "pg";

const ENDPOINT = "http://localhost:4318/v1/traces";
const BATCHES = 100;
const SPANS_PER_BATCH = 10; // 1000 events
const APP = "load-test";

function span(i, j) {
  const names = ["LCP", "INP", "CLS", "FCP", "TTFB"];
  const name = names[j % names.length];
  const value = name === "CLS" ? Math.random() * 0.4 : 100 + Math.random() * 3000;
  return {
    traceId: String(i).padStart(32, "0"),
    spanId: `${String(i).padStart(8, "0")}${String(j).padStart(8, "0")}`,
    name: `webvital.${name}`,
    kind: 1,
    startTimeUnixNano: String(Date.now()) + "000000",
    endTimeUnixNano: String(Date.now()) + "400000",
    attributes: [
      { key: "mip.session_id", value: { stringValue: `load-${i % 20}` } },
      { key: "mip.route", value: { stringValue: ["/", "/partners", "/partners/:id"][j % 3] } },
      { key: "webvital.name", value: { stringValue: name } },
      { key: "webvital.value", value: { doubleValue: value } },
    ],
  };
}

const payload = (i) => ({
  resourceSpans: [{
    resource: { attributes: [{ key: "mip.app_id", value: { stringValue: APP } }] },
    scopeSpans: [{ scope: { name: "load" }, spans: Array.from({ length: SPANS_PER_BATCH }, (_, j) => span(i, j)) }],
  }],
});

const t0 = performance.now();
let okCount = 0;
for (let i = 0; i < BATCHES; i += 10) {
  // 10 POST concurrents par vague (réaliste : plusieurs onglets/utilisateurs)
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, k) =>
      fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload(i + k)),
      }).then((r) => r.ok),
    ),
  );
  okCount += results.filter(Boolean).length;
}
const elapsed = performance.now() - t0;

const pool = new pg.Pool({ connectionString: "postgres://postgres:postgres@localhost:5433/mip_rum" });
const { rows: [{ n }] } = await pool.query(
  "select count(*)::int as n from rum_metric where app_id = $1", [APP],
);
console.log(`POST ok: ${okCount}/${BATCHES} | events insérés: ${n}/${BATCHES * SPANS_PER_BATCH} | durée: ${(elapsed / 1000).toFixed(1)} s | débit: ${Math.round(n / (elapsed / 1000))} events/s`);
// nettoyage : les données de charge ne polluent pas la démo
await pool.query("delete from rum_metric where app_id = $1", [APP]);
await pool.query("delete from rum_session where app_id = $1", [APP]);
await pool.end();
console.log("(données de charge nettoyées)");
process.exit(n === BATCHES * SPANS_PER_BATCH && okCount === BATCHES ? 0 : 1);
