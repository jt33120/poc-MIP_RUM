// Conformité de l'émetteur OTLP du SDK web, jugée par le collecteur OpenTelemetry
// OFFICIEL (ADR-0016) : la sortie du SDK est envoyée à un vrai collecteur, qui la
// décode avec le décodeur de référence (Go, protojson) et la réécrit. Ce décodeur
// refuse un identifiant mal encodé (400) mais IGNORE un champ qu'il ne connaît pas :
// c'est la comparaison de ce qu'il réécrit avec ce que le SDK a envoyé qui attrape
// un champ perdu ou mal compris.
//
// Exige un collecteur en marche ; sans `MIP_OTELCOL_URL`, le test est sauté (CI :
// étape « Conformité OTLP », .github/workflows/ci.yml). En local :
//   docker run -d --rm --name otelcol -p 4318:4318 -v "$PWD/tests/fixtures/otelcol-conformite.yaml:/etc/otelcol-contrib/config.yaml" \
//     -v /tmp/otelcol:/sortie otel/opentelemetry-collector-contrib:0.161.0
//   MIP_OTELCOL_URL=http://localhost:4318 MIP_OTELCOL_SORTIE=/tmp/otelcol/traces.json pnpm exec vitest run tests/unit/otlp-collecteur-officiel.test.ts
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildResourceSpans } from "../../packages/rum-sdk/src/otlp-encode";
import { randomBytes } from "node:crypto";
import { canonique, RESSOURCE, SPANS } from "../fixtures/lot-sdk-otlp";

const URL_COLLECTEUR = process.env.MIP_OTELCOL_URL;
const SORTIE = process.env.MIP_OTELCOL_SORTIE ?? "/tmp/otelcol/traces.json";

describe.skipIf(!URL_COLLECTEUR)("conformité OTLP — le collecteur OpenTelemetry officiel", () => {
  it("accepte la sortie du SDK sans rejet, et la relit champ par champ", { timeout: 20_000 }, async () => {
    // Une trace propre à ce passage : le fichier du collecteur garde les précédents.
    const trace = randomBytes(16).toString("hex");
    const envoi = buildResourceSpans(RESSOURCE, SPANS.map((s) => ({ ...s, traceId: trace })));
    const reponse = await fetch(`${URL_COLLECTEUR}/v1/traces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(envoi),
    });
    expect(reponse.status, await reponse.clone().text()).toBe(200);
    const corps = (await reponse.json()) as { partialSuccess?: { rejectedSpans?: string | number } };
    expect(Number(corps.partialSuccess?.rejectedSpans ?? 0)).toBe(0);

    // Le collecteur écrit une ligne JSON par lot ; on attend la nôtre.
    let relu: unknown;
    for (let i = 0; i < 50 && relu === undefined; i++) {
      if (existsSync(SORTIE)) {
        relu = readFileSync(SORTIE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
          .find((lot) => JSON.stringify(lot).includes(trace));
      }
      if (relu === undefined) await new Promise((r) => setTimeout(r, 200));
    }
    expect(relu, "le collecteur n'a rien réécrit").toBeDefined();
    expect(canonique(relu)).toEqual(canonique(envoi));
  });
});
