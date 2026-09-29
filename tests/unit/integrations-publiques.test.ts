// Ce que l'assistant d'intégration sert à télécharger (`apps/console/public/integrations/`).
//
// Décision du 29/09/2026 : côté serveur, plus aucun capteur maison — le client
// installe l'agent OpenTelemetry officiel de son langage. Ce dossier ne sert donc
// plus de middleware à poser chez le client : ni la copie du middleware FastAPI
// (qui a déjà divergé une fois de celui que la CI testait), ni celle d'Express.
// Seule la configuration du Collector OpenTelemetry, logiciel open source, y reste,
// en option.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RACINE = join(__dirname, "..", "..");
const DOSSIER = join(RACINE, "apps/console/public/integrations");

/** Ce qui trahit un capteur maison : un de nos middlewares, notre agent Node, leurs exemples. */
const CAPTEUR_MAISON = /mip_rum_middleware|MIPRumMiddleware|mip-rum-express|agent-node|examples\/integrations/;

describe("intégrations téléchargeables", () => {
  it("aucun capteur maison n'est servi : seule la configuration du Collector reste", () => {
    expect(readdirSync(DOSSIER)).toEqual(["otel-collector.yaml"]);
  });

  it("la configuration du Collector ne renvoie à aucun capteur maison", () => {
    const yaml = readFileSync(join(DOSSIER, "otel-collector.yaml"), "utf8");
    expect(yaml).not.toMatch(CAPTEUR_MAISON);
    expect(yaml).not.toMatch(/middleware/i);
    // Les deux signaux que les agents exportent : un Collector qui ne saurait
    // relayer que les traces refuserait les journaux des agents.
    expect(yaml).toContain('traces_endpoint: "<ADRESSE_TRACES>"');
    expect(yaml).toContain('logs_endpoint: "<ADRESSE_LOGS>"');
  });
});
