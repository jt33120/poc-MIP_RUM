// Étape 3 de l'assistant d'intégration : les agents OpenTelemetry OFFICIELS.
//
// Décision du 29/09/2026 : côté serveur, plus aucun capteur maison. Deux garanties :
//   1. chaque recette porte le socle commun, prérempli (app_id, adresses complètes
//      par signal, protobuf, gzip, pas de métriques), puis la commande de lancement
//      de l'agent de son langage ;
//   2. aucune recette, ni l'écran qui les montre, ne renvoie à un capteur maison
//      (middleware FastAPI ou Express de MIP, agent Node de MIP) : ils sont archivés,
//      et plus personne ne les maintient.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BackendStep } from "@/components/wizard/BackendStep";
import { REPERE_CLE_API, recettesAgentsOtel } from "@/lib/recettes-agents-otel";

const RACINE = join(__dirname, "..", "..");
const CAPTEUR_MAISON =
  /mip_rum_middleware|MIPRumMiddleware|mip-rum-express|agent-node|examples\/integrations|\/integrations\/[^"\s]+\.(py|js)\b/;

const adresses = {
  traces: "https://console.exemple/api/ingest/v1/traces",
  logs: "https://console.exemple/api/ingest/v1/logs",
};
const recettes = recettesAgentsOtel({ appId: "demo-app", adresses });

describe("recettes serveur : le socle commun, prérempli", () => {
  const attendus = [
    `OTEL_EXPORTER_OTLP_PROTOCOL="http/protobuf"`,
    `OTEL_EXPORTER_OTLP_COMPRESSION="gzip"`,
    // Une adresse PAR SIGNAL, complète : la variable générique ferait ajouter
    // `/v1/traces` à l'adresse par l'agent, qui viserait alors un chemin inexistant.
    `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT="${adresses.traces}"`,
    `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT="${adresses.logs}"`,
    `OTEL_METRICS_EXPORTER="none"`,
    `mip.app_id=demo-app,mip.api_key=${REPERE_CLE_API},deployment.environment.name=prod`,
  ];

  it("le socle seul porte toutes les variables", () => {
    for (const a of attendus) expect(recettes.socle).toContain(a);
    expect(recettes.socle).not.toContain("OTEL_EXPORTER_OTLP_ENDPOINT=");
  });

  it.each(recettes.agents)("$id : le socle, puis l'agent officiel", (agent) => {
    for (const a of attendus) expect(agent.code, a).toContain(a);
    expect(agent.pieges.length).toBeGreaterThan(0);
    expect(agent.documentation).toMatch(/^https:\/\/opentelemetry\.io\/docs\//);
  });

  it("chaque langage a sa commande de lancement, celle de l'agent officiel", () => {
    const code = Object.fromEntries(recettes.agents.map((a) => [a.id, a.code]));
    expect(Object.keys(code)).toEqual(["python", "node", "java", "dotnet"]);
    expect(code.python).toContain("opentelemetry-instrument uvicorn main:app");
    expect(code.node).toContain("@opentelemetry/auto-instrumentations-node");
    expect(code.node).toContain("node --require @opentelemetry/auto-instrumentations-node/register app.js");
    expect(code.java).toContain("java -javaagent:opentelemetry-javaagent.jar -jar app.jar");
    expect(code.dotnet).toContain("instrument.sh");
  });

  it("Go, PHP et Ruby renvoient à la documentation OpenTelemetry", () => {
    expect(recettes.autres.map((a) => a.langage)).toEqual(["Go", "PHP", "Ruby"]);
    for (const a of recettes.autres) expect(a.documentation).toMatch(/^https:\/\/opentelemetry\.io\/docs\//);
  });
});

describe("recettes serveur : aucun capteur maison", () => {
  it("ni le socle, ni une recette, ni le Collector ne renvoient à un capteur maison", () => {
    const textes = [
      recettes.socle,
      recettes.collecteur,
      ...recettes.agents.flatMap((a) => [a.titre, a.precision, a.code, a.documentation, ...a.pieges]),
      ...recettes.autres.map((a) => a.documentation),
    ];
    expect(textes.filter((t) => CAPTEUR_MAISON.test(t))).toEqual([]);
  });

  it("l'étape rendue ne propose que les agents officiels, et garde le repère de la clé", () => {
    const html = renderToStaticMarkup(<BackendStep recettes={recettes} nomSecret="cle:demo-app" />);
    expect(html).not.toMatch(CAPTEUR_MAISON);
    for (const id of ["python", "node", "java", "dotnet", "autres", "collecteur"]) {
      expect(html).toContain(`data-testid="recette-${id}"`);
    }
    // Au rendu serveur, le secret remis n'est jamais dans la page : le repère reste.
    expect(html).toContain(REPERE_CLE_API);
    // Le seul téléchargement restant : la configuration du Collector, open source.
    expect([...html.matchAll(/href="(\/integrations\/[^"]+)"/g)].map((m) => m[1])).toEqual([
      "/integrations/otel-collector.yaml",
    ]);
  });

  it("la fiche de l'application ne passe plus par les anciennes recettes", () => {
    for (const f of ["apps/console/app/admin/customers/[appId]/page.tsx", "apps/console/components/wizard/BackendStep.tsx"]) {
      const source = readFileSync(join(RACINE, f), "utf8");
      expect(source, f).not.toContain("onboarding-recipes");
      expect(source, f).not.toMatch(CAPTEUR_MAISON);
    }
  });
});
