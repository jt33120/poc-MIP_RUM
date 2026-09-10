// A5 — verrouillage du contrat OTLP -> lignes SQL (snapshot) + durcissement.
// Le snapshot fige la sortie de flattenOtlp pour un payload représentatif (tous
// les types de spans, scrub PII inclus) : toute évolution du parser devient
// visible en revue. La 2e partie prouve que le parser ne jette JAMAIS sur des
// entrées malformées/hostiles (il compte `rejected` et continue).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { flattenOtlp } from "../../apps/ingest/supabase/functions/_shared/otlp.mjs";

const fixture = JSON.parse(
  readFileSync(join(__dirname, "../fixtures/otlp-snapshot.json"), "utf8"),
);

describe("flattenOtlp — snapshot du contrat de sortie", () => {
  // `now` figé à l'ère de la fixture (oct. 2025) pour que la garde anti-dérive
  // ne clampe pas ses timestamps -> snapshot déterministe.
  const rows = flattenOtlp(fixture, { now: Date.parse("2025-10-09T09:00:00Z") });

  it("couvre tous les types de lignes (repères avant le snapshot)", () => {
    expect(rows.sessions).toHaveLength(1);
    expect(rows.pageviews).toHaveLength(1);
    expect(rows.metrics).toHaveLength(1);
    expect(rows.errors).toHaveLength(1);
    expect(rows.resources).toHaveLength(1);
    // longtask ET loaf : le MÊME fait — le fil principal a bloqué — rangé dans
    // la même table, avec `source` pour dire laquelle des deux API a parlé.
    expect(rows.longtasks).toHaveLength(2);
    expect(rows.longtasks.map((l) => l.source)).toEqual(["longtask", "loaf"]);
    // l'attribution LoAF : le script, sa fonction, ce qui l'a invoqué
    expect(rows.longtasks[1].script_function).toBe("recalculerTotal");
    expect(rows.longtasks[1].invoker).toBe("BUTTON#payer.onclick");
    // et son URL nettoyée de son jeton — un sourceURL est une URL comme une autre
    expect(rows.longtasks[1].script_url).toBe("https://app.demo.fr/static/panier.js");
    expect(rows.breadcrumbs).toHaveLength(1);
    expect(rows.events).toHaveLength(2); // track.signup + frustration (P1)
    expect(rows.spans).toHaveLength(3); // http.client + http.server + OTel server
    expect(rows.rejected).toBe(1); // le 2e resourceSpans (sans mip.app_id)
    // L'identité du visiteur voyage jusqu'à la ligne de session, et la colonne
    // dérivée la qualifie. Une fixture sans `mip.visitor_id` figerait un `null`,
    // ce qui ne prouverait rien du chemin de l'attribut.
    expect(rows.sessions[0].visitor_id).toBe("5f3a9c21-0e44-4bd7-9a10-6c2e88f14b03");
    // `id_kind` n'est PAS écrit par l'ingestion : c'est une colonne générée que
    // PostgreSQL refuse qu'on écrive (migration-v57). L'absence est le contrat.
    expect(rows.sessions[0]).not.toHaveProperty("id_kind");
    // v58 — la déduplication des vitals et le poids d'échantillonnage voyagent
    // jusqu'aux lignes. Une fixture sans ces attributs figerait des `null`, ce
    // qui ne prouverait rien du chemin.
    expect(rows.metrics[0].metric_uid).toBe("v5-1760000000000-4821");
    expect(rows.sessions[0].sample_rate).toBe(0.25);
    expect(rows.sessions[0].error_sample_rate).toBe(1);
    // `weight` n'est PAS écrit par l'ingestion : colonne générée (migration-v58).
    expect(rows.sessions[0]).not.toHaveProperty("weight");
    // v59 — une ligne d'erreur peut REPRÉSENTER plusieurs occurrences : le SDK
    // déduplique une erreur qui se répète et joint le compte qu'il a tu.
    expect(rows.errors[0].occurrences).toBe(37);
    // garde-fous de contrat : scrub PII appliqué, clé d'API extraite
    expect(rows.errors[0].message).toBe("login failed for [email] password=[redacted]");
    expect(rows.errors[0].release).toBe("1.4.2"); // mip.release (resource) -> dé-minification
    // La pile de la fixture porte un bundle À NOM HACHÉ, comme en produit toute
    // application moderne. L'empreinte de regroupement ne doit PAS en dépendre :
    // sinon le même bug change de groupe à chaque mise en production. On rejoue
    // ici la même erreur avec un autre hachage de déploiement.
    const autreDeploiement = JSON.parse(
      JSON.stringify(fixture).replaceAll("main-4f2a9c1d.js", "main-7b3e88ff.js"),
    );
    const apres = flattenOtlp(autreDeploiement, { now: Date.parse("2025-10-09T09:00:00Z") });
    expect(apres.errors[0].fingerprint).toBe(rows.errors[0].fingerprint);
    expect(rows.events[0].props).toEqual({ email: "[redacted]", plan: "pro" });
    // P1 : signal de frustration -> rum_event sous nom réservé 'frustration.<kind>'
    expect(rows.events[1].name).toBe("frustration.rage");
    expect(rows.events[1].props).toEqual({ target: 'button "Payer"', count: 4 });
    expect(rows.apiKeys[0]).toEqual({ app_id: "demo", api_key: "mip_secretkey1234" });
  });

  it("fige la forme complète des lignes produites", () => {
    expect(rows).toMatchSnapshot();
  });
});

describe("flattenOtlp — durcissement : ne jette jamais sur entrée hostile", () => {
  const sv = (s: string) => ({ stringValue: s });
  const cases: [string, unknown][] = [
    ["null", null],
    ["undefined", undefined],
    ["objet vide", {}],
    ["resourceSpans non-array", { resourceSpans: "nope" }],
    ["resourceSpans avec éléments null/scalaires", { resourceSpans: [null, 5, "x"] }],
    ["payload scalaire", 42],
    ["payload string", "hello"],
    [
      "scopeSpans non-array",
      { resourceSpans: [{ resource: { attributes: [{ key: "mip.app_id", value: sv("a") }] }, scopeSpans: 1 }] },
    ],
    [
      "spans avec null / sans nom / nom non-string",
      {
        resourceSpans: [
          {
            resource: { attributes: [{ key: "mip.app_id", value: sv("a") }] },
            scopeSpans: [{ spans: [null, {}, { name: 123 }, { name: "exception" }] }],
          },
        ],
      },
    ],
    [
      "attributes non-array + AnyValue déformé",
      {
        resourceSpans: [
          {
            resource: { attributes: { not: "an array" } },
            scopeSpans: [
              { spans: [{ name: "pageview", attributes: [{ key: "x", value: { arrayValue: {} } }] }] },
            ],
          },
        ],
      },
    ],
    [
      "startTimeUnixNano non numérique",
      {
        resourceSpans: [
          {
            resource: { attributes: [{ key: "mip.app_id", value: sv("a") }] },
            scopeSpans: [
              {
                spans: [
                  {
                    name: "pageview",
                    startTimeUnixNano: "pas-un-nombre",
                    attributes: [{ key: "mip.session_id", value: sv("s") }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  ];

  it.each(cases)("ne jette pas : %s", (_label, payload) => {
    expect(() => flattenOtlp(payload as never)).not.toThrow();
  });

  it("compte les resourceSpans malformés en rejected sans planter", () => {
    const rows = flattenOtlp({ resourceSpans: [null, 5, "x"] } as never);
    expect(rows.rejected).toBe(3);
    expect(rows.sessions).toHaveLength(0);
  });

  it("nanos invalide -> ts = Date valide (pas de NaN, pas d'exception)", () => {
    const rows = flattenOtlp({
      resourceSpans: [
        {
          resource: { attributes: [{ key: "mip.app_id", value: sv("a") }] },
          scopeSpans: [
            {
              spans: [
                {
                  name: "pageview",
                  startTimeUnixNano: "pas-un-nombre",
                  attributes: [{ key: "mip.session_id", value: sv("s") }],
                },
              ],
            },
          ],
        },
      ],
    } as never);
    expect(rows.pageviews).toHaveLength(1);
    expect(rows.pageviews[0].ts).toBeInstanceOf(Date);
    expect(Number.isNaN(rows.pageviews[0].ts.getTime())).toBe(false);
  });
});
