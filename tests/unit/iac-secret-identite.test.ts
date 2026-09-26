// Le secret d'identité est PARTAGÉ entre le collector, qui hache l'identité à
// l'ingestion, et console-api, qui hache la valeur saisie par un administrateur
// pour la retrouver (recherche, export, effacement RGPD : lib/commandes/vie-privee.ts).
// console-api l'a longtemps omis dans l'IaC : après la bascule, ces commandes
// auraient rendu « indisponible ». Deux secrets différents seraient pire — une
// recherche qui ne trouve rien, sans erreur —, d'où la même variable partagée.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const iac = readFileSync(".railway/railway.ts", "utf8");
const compose = readFileSync("infra/docker/docker-compose.yml", "utf8");

/** Le bloc de déclaration d'un service dans l'IaC. */
function bloc(nom: string): string {
  const b = iac.split(/\n  const \w+ = service\(/).slice(1).find((x) => x.startsWith(`"${nom}"`));
  if (!b) throw new Error(`service ${nom} absent de l'IaC`);
  return b;
}

describe("IaC — le secret d'identité, le même des deux côtés", () => {
  it.each(["collector", "console-api"])("%s reçoit la variable partagée IDENTITY_HASH_SECRET", (nom) => {
    expect(bloc(nom)).toContain("IDENTITY_HASH_SECRET: ctx.shared.IDENTITY_HASH_SECRET");
  });

  it("le service console-api du compose le reçoit aussi", () => {
    const service = compose.split(/\n  console-api:\n/)[1]?.split(/\n  [a-z-]+:\n/)[0] ?? "";
    expect(service).toContain("IDENTITY_HASH_SECRET: ${IDENTITY_HASH_SECRET:-}");
  });
});
