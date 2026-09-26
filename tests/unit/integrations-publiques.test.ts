// Le middleware FastAPI que l'assistant d'intégration fait télécharger
// (`apps/console/public/integrations/`) est une COPIE de celui que la CI teste
// (`examples/integrations/fastapi/`, unittest + tests/unit/otel-exceptions.test.ts).
// Les deux ont divergé une fois : l'assistant servait la v0.4.0 (juin) pendant que
// la v0.6.0 (capture d'exceptions, contexte) passait les tests. Ce test l'interdit.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RACINE = join(__dirname, "..", "..");

describe("intégrations téléchargeables", () => {
  it("le middleware FastAPI servi par l'assistant est celui que la CI teste", () => {
    const servi = readFileSync(join(RACINE, "apps/console/public/integrations/mip_rum_middleware.py"), "utf8");
    const teste = readFileSync(join(RACINE, "examples/integrations/fastapi/mip_rum_middleware.py"), "utf8");
    expect(servi).toBe(teste);
  });
});
