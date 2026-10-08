// Garde-fous de livraison relevés par l'audit du 07/10/2026. Chacun tient à une
// ligne de l'IaC ou de la CI qu'une PR anodine pourrait remettre en arrière sans
// que le plan Railway ne le signale comme une destruction.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const iac = readFileSync(".railway/railway.ts", "utf8");
const ci = readFileSync(".github/workflows/ci.yml", "utf8");

/** Le bloc de déclaration d'un service dans l'IaC. */
function bloc(nom: string): string {
  const b = iac.split(/\n  const \w+ = service\(/).slice(1).find((x) => x.startsWith(`"${nom}"`));
  if (!b) throw new Error(`service ${nom} absent de l'IaC`);
  return b;
}

describe("IaC — un déploiement attend la CI", () => {
  it("la source GitHub porte checkSuites: true", () => {
    expect(iac).toMatch(/github\("jt33120\/poc-MIP_RUM", \{[^}]*checkSuites: true[^}]*\}\)/);
    expect(iac).not.toMatch(/checkSuites: false/);
  });

  // Railway saute le déploiement d'un commit dont la CI est annulée (si rien
  // d'autre n'y a réussi) : sur master, la CI d'un commit doit aller au bout.
  it("la CI n'annule un run dépassé que sur une PR", () => {
    expect(ci).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
  });
});

describe("IaC — les variables du scheduler", () => {
  it("METRICS_TOKEN vient de la même variable partagée que les autres services", () => {
    for (const nom of ["collector", "api", "console-api", "notifier", "scheduler"]) {
      expect(bloc(nom), nom).toContain("METRICS_TOKEN: ctx.shared.METRICS_TOKEN");
    }
  });

  it("DEADMAN_URL est déclarée sans valeur : posée à la main, gardée par l'apply", () => {
    expect(bloc("scheduler")).toContain("DEADMAN_URL: preserve()");
  });
});

describe("IaC — le repli MIP_CONSOLE_URL du service mcp", () => {
  // Le retirer de l'IaC le supprimerait sur Railway : il ne part qu'avec le code
  // qui le lit.
  it("reste déclaré tant que origineApi le lit", () => {
    const client = readFileSync("packages/mcp-tools/lib/client.mjs", "utf8");
    if (client.includes("env.MIP_CONSOLE_URL")) {
      expect(bloc("mcp")).toContain("MIP_CONSOLE_URL: preserve()");
    }
  });
});
