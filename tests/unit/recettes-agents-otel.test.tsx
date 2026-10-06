// Brancher le serveur : les agents OpenTelemetry OFFICIELS (fiche d'une application
// et /select/new).
//
// Décision du 29/09/2026 : côté serveur, plus aucun capteur maison. Trois garanties :
//   1. chaque recette porte le socle commun de docs/INTEGRATION.md § 10, prérempli
//      (app_id, adresses complètes par signal, protobuf, gzip, pas de métriques),
//      puis la commande de lancement de l'agent de son langage ;
//   2. aucune recette, ni les écrans qui les montrent, ne renvoient à un capteur
//      maison (middleware FastAPI ou Express de MIP, agent Node de MIP) : ils sont
//      archivés, et plus personne ne les maintient ;
//   3. la clé remise remplace le repère, nu au milieu d'une variable shell.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BackendStep } from "@/components/wizard/BackendStep";
import { porterSecret } from "@/components/secret/SecretUnique";
import { REPERE_CLE_API, VERSIONS_EPROUVEES, recettesAgentsOtel } from "@/lib/recettes-agents-otel";

const RACINE = join(__dirname, "..", "..");
const CAPTEUR_MAISON =
  /mip_rum_middleware|MIPRumMiddleware|mip-rum-express|agent-node|MIP_RUM_ENDPOINT|examples\/integrations|\/integrations\/[^"\s]+\.(py|js)\b/;

const adresses = {
  traces: "https://console.exemple/api/ingest/v1/traces",
  logs: "https://console.exemple/api/ingest/v1/logs",
};
const recettes = recettesAgentsOtel({ appId: "demo-app", adresses });

describe("recettes serveur : le socle commun, prérempli", () => {
  const attendus = [
    `OTEL_SERVICE_NAME="demo-app-api"`,
    `OTEL_EXPORTER_OTLP_PROTOCOL="http/protobuf"`,
    `OTEL_EXPORTER_OTLP_COMPRESSION="gzip"`,
    // Une adresse PAR SIGNAL, complète : la variable générique recevrait `/v1/traces`
    // en suffixe, et l'agent viserait un chemin inexistant.
    `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT="${adresses.traces}"`,
    `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT="${adresses.logs}"`,
    `OTEL_TRACES_EXPORTER="otlp"`,
    `OTEL_LOGS_EXPORTER="otlp"`,
    `OTEL_METRICS_EXPORTER="none"`,
    `mip.app_id=demo-app,mip.api_key=${REPERE_CLE_API},deployment.environment.name=prod`,
  ];

  it("le socle seul porte toutes les variables, et jamais l'adresse générique", () => {
    for (const a of attendus) expect(recettes.socle).toContain(a);
    expect(recettes.socle).not.toContain("OTEL_EXPORTER_OTLP_ENDPOINT=");
    expect(recettes.socle).not.toContain("grpc");
  });

  it.each(recettes.agents)("$id : le socle, puis l'agent officiel", (agent) => {
    for (const a of attendus) expect(agent.code, a).toContain(a);
    expect(agent.pieges.length).toBeGreaterThan(0);
    expect(agent.etat).toMatch(/éprouvé en production/);
    expect(agent.documentation).toMatch(/^https:\/\/opentelemetry\.io\/docs\//);
  });

  it("chaque langage a sa commande de lancement, celle de l'agent officiel", () => {
    const code = Object.fromEntries(recettes.agents.map((a) => [a.id, a.code]));
    expect(Object.keys(code)).toEqual(["python", "node", "java", "dotnet"]);
    expect(code.python).toContain("opentelemetry-instrument uvicorn main:app");
    expect(code.python).toContain("opentelemetry-exporter-otlp-proto-http");
    expect(code.node).toContain("npm install --save @opentelemetry/api @opentelemetry/auto-instrumentations-node");
    expect(code.node).toContain("node --require @opentelemetry/auto-instrumentations-node/register app.js");
    expect(code.java).toContain("java -javaagent:opentelemetry-javaagent.jar -jar app.jar");
    expect(code.dotnet).toContain('. "$HOME/.otel-dotnet-auto/instrument.sh"');
    // Sans dossier de journaux accessible en écriture, le processus .NET s'arrête (§ 10).
    expect(code.dotnet).toContain("OTEL_DOTNET_AUTO_LOG_DIRECTORY");
  });

  it("l'état dit ce qui a été éprouvé en production, et seulement cela", () => {
    const etat = Object.fromEntries(recettes.agents.map((a) => [a.id, a.etat]));
    expect(etat.python).toBe("éprouvé en production (Flask le 28/09/2026, FastAPI le 29/09/2026), Flask prouvé en CI");
    expect(etat.node).toBe("éprouvé en production le 29/09/2026 (traces)");
    for (const id of ["java", "dotnet"]) expect(etat[id]).toBe("éprouvé en production le 28/09/2026, prouvé en CI");
  });

  // « Prouvé en CI » n'est vrai que si la CI fait tourner CES versions, sous CE socle :
  // les Dockerfile des applications d'essai et le manifeste de la capture versionnée.
  it("prouvé en CI : les versions de la recette sont celles que la CI fait tourner", () => {
    const lire = (f: string) => readFileSync(join(RACINE, f), "utf8");
    const app = "tests/fixtures/otlp-agents/applications";
    expect(lire(`${app}/java/Dockerfile`)).toContain(`ARG OTEL_JAVAAGENT_VERSION=${VERSIONS_EPROUVEES.javaagent}`);
    expect(lire(`${app}/dotnet/Dockerfile`)).toContain(`ARG OTEL_DOTNET_AUTO_VERSION=${VERSIONS_EPROUVEES.dotnetAuto}`);
    expect(lire(`${app}/python/Dockerfile`)).toContain(`ARG OTEL_DISTRO_VERSION=${VERSIONS_EPROUVEES.pythonDistro}`);
    expect(lire(`${app}/python/Dockerfile`)).toContain(`ARG OTEL_SDK_VERSION=${VERSIONS_EPROUVEES.pythonSdk}`);
    const manifeste = JSON.parse(lire("tests/fixtures/otlp-agents/manifeste.json"));
    expect(manifeste.langages.java.ressource["telemetry.distro.version"]).toBe(VERSIONS_EPROUVEES.javaagent);
    expect(manifeste.langages.dotnet.ressource["telemetry.distro.version"]).toBe(VERSIONS_EPROUVEES.dotnetAuto);
    expect(manifeste.langages.python.ressource["telemetry.auto.version"]).toBe(VERSIONS_EPROUVEES.pythonDistro);
    expect(manifeste.langages.python.ressource["telemetry.sdk.version"]).toBe(VERSIONS_EPROUVEES.pythonSdk);
    expect(lire(".github/workflows/agents-otlp.yml")).toContain("capturer.mjs java dotnet python");
    const code = Object.fromEntries(recettes.agents.map((a) => [a.id, a.code]));
    expect(code.java).toContain(`/download/v${VERSIONS_EPROUVEES.javaagent}/opentelemetry-javaagent.jar`);
    expect(code.dotnet).toContain(`/download/v${VERSIONS_EPROUVEES.dotnetAuto}/otel-dotnet-auto-install.sh`);
    expect(code.python).toContain(`opentelemetry-distro==${VERSIONS_EPROUVEES.pythonDistro}`);
  });

  it("Go, PHP et Ruby renvoient à la documentation OpenTelemetry", () => {
    expect(recettes.autres.map((a) => a.langage)).toEqual(["Go", "PHP", "Ruby"]);
    for (const a of recettes.autres) expect(a.documentation).toMatch(/^https:\/\/opentelemetry\.io\/docs\//);
  });

  it("Go, PHP et Ruby : éprouvés en local, pas en production, comme le dit docs/capteurs-serveur.md", () => {
    const doc = readFileSync(join(__dirname, "../../docs/capteurs-serveur.md"), "utf8");
    for (const a of recettes.autres) {
      expect(a.etat).toBe("éprouvé en local le 01/10/2026, pas en production");
      expect(doc).toContain(`| ${a.langage} | éprouvé en local le 01/10/2026 |`);
      expect(a.piege.startsWith(`${a.langage} : `)).toBe(true);
    }
  });
});

describe("recettes serveur : la clé remise remplace le repère", () => {
  it("nu dans une variable shell (guillemets: false)", () => {
    const porte = porterSecret(recettes.socle, REPERE_CLE_API, "mip_0123", false);
    expect(porte).toContain("mip.app_id=demo-app,mip.api_key=mip_0123,deployment.environment.name=prod");
    expect(porte).not.toContain(REPERE_CLE_API);
  });

  it("entre guillemets JSON pour du JavaScript : le comportement d'avant, inchangé", () => {
    const js = `apiKey:${JSON.stringify(REPERE_CLE_API)}`;
    expect(porterSecret(js, REPERE_CLE_API, "mip_0123")).toBe('apiKey:"mip_0123"');
    // Par défaut, un repère nu n'est pas touché : le bookmarklet et le snippet ne changent pas.
    expect(porterSecret(recettes.socle, REPERE_CLE_API, "mip_0123")).toBe(recettes.socle);
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

  it("les écrans d'intégration ne passent plus par un capteur maison", () => {
    for (const f of [
      "apps/console/app/admin/customers/[appId]/page.tsx",
      "apps/console/app/select/new/page.tsx",
      "apps/console/components/wizard/BackendStep.tsx",
    ]) {
      const source = readFileSync(join(RACINE, f), "utf8");
      expect(source, f).not.toContain("onboarding-recipes");
      expect(source, f).not.toMatch(CAPTEUR_MAISON);
      expect(source, f).toContain("recettes");
    }
  });

  it("les deux pages lisent la clé une fois pour tout l'écran (SecretFourni)", () => {
    // Plusieurs blocs portent la même clé : sans fournisseur commun, le premier à la
    // lire la retirerait au bandeau qui doit l'afficher.
    for (const f of ["apps/console/app/admin/customers/[appId]/page.tsx", "apps/console/app/select/new/page.tsx"]) {
      expect(readFileSync(join(RACINE, f), "utf8"), f).toMatch(/<SecretFourni nom=/);
    }
  });
});
