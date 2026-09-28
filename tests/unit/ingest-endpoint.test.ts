// Garde de l'invariant AD-4 : l'endpoint d'ingestion est produit par une seule
// fonction, et le repli est TOUJOURS l'hôte courant — jamais un hôte tiers, jamais
// une valeur de développement.
//
// Ce test existe parce que la propriété a déjà été perdue : deux sites pointaient un
// projet Supabase décommissionné et un troisième `localhost:4318`, si bien qu'un
// client onboardé recevait un snippet qui n'ingérait rien, sans erreur exploitable.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dogfoodingEndpoint, ingestEndpoint, origineCollecteurDogfooding } from "../../apps/console/lib/ingest-endpoint";

const ENV_KEYS = [
  "NEXT_PUBLIC_RUM_ENDPOINT",
  "NEXT_PUBLIC_DOGFOOD_COLLECTOR_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_URL",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("ingestEndpoint — repli sur l'hôte courant", () => {
  it("dérive l'hôte de la requête, en https hors local", () => {
    expect(ingestEndpoint("traces", "console.exemple.fr")).toBe(
      "https://console.exemple.fr/api/ingest/v1/traces",
    );
  });

  it("bascule en http pour les hôtes locaux", () => {
    expect(ingestEndpoint("traces", "localhost:3000")).toBe(
      "http://localhost:3000/api/ingest/v1/traces",
    );
    expect(ingestEndpoint("traces", "127.0.0.1:3000")).toBe(
      "http://127.0.0.1:3000/api/ingest/v1/traces",
    );
  });

  it("sert les trois canaux sur le même hôte", () => {
    const host = "console.exemple.fr";
    expect(ingestEndpoint("logs", host)).toBe("https://console.exemple.fr/api/ingest/v1/logs");
    expect(ingestEndpoint("replay", host)).toBe("https://console.exemple.fr/api/ingest/v1/replay");
  });
});

describe("ingestEndpoint — configuration explicite", () => {
  it("dérive les autres canaux par CHEMIN, pas par substitution de sous-chaîne", () => {
    // La régression historique : `replace("v1-traces", "v1-logs")` était un no-op sur
    // le chemin actuel, et les logs partaient sur le canal traces.
    process.env.NEXT_PUBLIC_RUM_ENDPOINT = "https://ingest.exemple.fr/api/ingest/v1/traces";
    expect(ingestEndpoint("logs")).toBe("https://ingest.exemple.fr/api/ingest/v1/logs");
    expect(ingestEndpoint("logs")).not.toContain("/traces");
  });

  it("accepte un chemin hérité et le remplace intégralement", () => {
    process.env.NEXT_PUBLIC_RUM_ENDPOINT = "https://ancien.exemple.fr/functions/v1/v1-traces";
    expect(ingestEndpoint("traces")).toBe("https://ancien.exemple.fr/api/ingest/v1/traces");
  });

  it("ignore une valeur inexploitable et retombe sur l'hôte courant", () => {
    process.env.NEXT_PUBLIC_RUM_ENDPOINT = "pas-une-url";
    expect(ingestEndpoint("traces", "console.exemple.fr")).toBe(
      "https://console.exemple.fr/api/ingest/v1/traces",
    );
  });
});

describe("ingestEndpoint — hors contexte de requête", () => {
  it("utilise l'hôte de déploiement quand aucun hôte n'est fourni", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "console.exemple.fr";
    expect(ingestEndpoint("logs")).toBe("https://console.exemple.fr/api/ingest/v1/logs");
  });

  it("ne rend jamais un hôte tiers, quelle que soit la combinaison", () => {
    const combinaisons: (string | null | undefined)[] = [
      null,
      undefined,
      "console.exemple.fr",
      "localhost:3000",
    ];
    for (const host of combinaisons) {
      const url = ingestEndpoint("traces", host);
      expect(url).not.toContain("supabase.co");
      expect(url).not.toContain(":4318");
      expect(url).toContain("/api/ingest/v1/traces");
    }
  });
});

// Ce bloc existe parce que la panne de l'en-tête est REVENUE, en production, le
// 8 septembre : NEXT_PUBLIC_RUM_ENDPOINT pointait encore le projet Supabase
// décommissionné, et la console postait sa propre télémétrie là-bas — sans
// erreur, avec des HTTP 200 côté serveur pour d'autres flux, donc invisible.
//
// Le test précédent gardait la FONCTION ; il ne pouvait rien contre une variable
// d'environnement posée sur l'hébergeur. La seule défense est de retirer à cette
// variable le pouvoir de détourner le dogfooding : la console sert elle-même
// /api/ingest/v1/*, donc son propre hôte est correct par construction.
describe("dogfoodingEndpoint — insensible à l'override", () => {
  it("ignore NEXT_PUBLIC_RUM_ENDPOINT, même pointant un hôte mort", () => {
    process.env.NEXT_PUBLIC_RUM_ENDPOINT =
      "https://nupxrdpsliqptqnjkmgw.supabase.co/functions/v1/v1-traces";
    expect(dogfoodingEndpoint("mip-rum-console.vercel.app")).toBe(
      "https://mip-rum-console.vercel.app/api/ingest/v1/traces",
    );
  });

  // La divergence est le symptôme même de la panne : le snippet client suit
  // l'override (c'est voulu), le dogfooding non.
  it("diverge de ingestEndpoint quand l'override est posé", () => {
    process.env.NEXT_PUBLIC_RUM_ENDPOINT = "https://ailleurs.example/x";
    const hote = "mip-rum-console.vercel.app";
    expect(dogfoodingEndpoint(hote)).not.toBe(ingestEndpoint("traces", hote));
    expect(new URL(dogfoodingEndpoint(hote)).host).toBe(hote);
  });

  it("suit les previews et le self-host, puisqu'il suit l'hôte", () => {
    expect(dogfoodingEndpoint("mip-rum-git-branche.vercel.app")).toBe(
      "https://mip-rum-git-branche.vercel.app/api/ingest/v1/traces",
    );
    expect(dogfoodingEndpoint("localhost:3000")).toBe(
      "http://localhost:3000/api/ingest/v1/traces",
    );
  });

  it("hors contexte de requête, retombe sur l'hôte de déploiement", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "mip-rum-console.vercel.app";
    expect(dogfoodingEndpoint(null)).toBe(
      "https://mip-rum-console.vercel.app/api/ingest/v1/traces",
    );
  });
});

// P6b.G — la collecte DIRECTE, sur un seul périmètre : le capteur de la console.
// Le relais ne transmet que le pays, jamais l'adresse (ADR 0005) ; seul un envoi
// du navigateur au collector permet de résoudre le pays par l'adresse IP. La
// variable est à part pour que les snippets des CLIENTS ne bougent pas.
describe("dogfoodingEndpoint — collecte directe au collector", () => {
  const COLLECTOR = "https://collector-production-d769.up.railway.app";
  const PROD = "mip-rum-console.vercel.app";

  it("sans la variable : le comportement d'avant, à l'identique", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = PROD;
    expect(origineCollecteurDogfooding(PROD)).toBeNull();
    expect(dogfoodingEndpoint(PROD)).toBe(`https://${PROD}/api/ingest/v1/traces`);
  });

  it("avec la variable : le chemin du COLLECTOR (/v1/traces), pas celui de la console", () => {
    process.env.NEXT_PUBLIC_DOGFOOD_COLLECTOR_URL = COLLECTOR;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = PROD;
    expect(dogfoodingEndpoint(PROD)).toBe(`${COLLECTOR}/v1/traces`);
    // Le SDK dérive le replay par substitution de `/v1/traces` : il vise donc
    // `/v1/replay` du collector, que celui-ci sert.
    expect(dogfoodingEndpoint(PROD).replace("/v1/traces", "/v1/replay")).toBe(`${COLLECTOR}/v1/replay`);
  });

  it("seule l'origine compte : un chemin, un slash final ou des blancs sont ignorés", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = PROD;
    for (const brut of [`${COLLECTOR}/`, `${COLLECTOR}/api/ingest/v1/traces`, `  ${COLLECTOR}  `]) {
      process.env.NEXT_PUBLIC_DOGFOOD_COLLECTOR_URL = brut;
      expect(dogfoodingEndpoint(PROD), brut).toBe(`${COLLECTOR}/v1/traces`);
    }
  });

  it("ne touche JAMAIS l'endpoint des snippets remis aux clients", () => {
    process.env.NEXT_PUBLIC_DOGFOOD_COLLECTOR_URL = COLLECTOR;
    expect(ingestEndpoint("traces", PROD)).toBe(`https://${PROD}/api/ingest/v1/traces`);
    expect(ingestEndpoint("replay", PROD)).toBe(`https://${PROD}/api/ingest/v1/replay`);
  });

  it("NEXT_PUBLIC_RUM_ENDPOINT ne la détourne pas davantage qu'avant", () => {
    process.env.NEXT_PUBLIC_DOGFOOD_COLLECTOR_URL = COLLECTOR;
    process.env.NEXT_PUBLIC_RUM_ENDPOINT = "https://ailleurs.example/api/ingest/v1/traces";
    expect(dogfoodingEndpoint(PROD)).toBe(`${COLLECTOR}/v1/traces`);
  });

  it("valeur inexploitable ou http: hors poste local : retour à la console, jamais une URL cassée", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = PROD;
    for (const brut of ["pas-une-url", "http://collector-production-d769.up.railway.app", "ftp://collector.example"]) {
      process.env.NEXT_PUBLIC_DOGFOOD_COLLECTOR_URL = brut;
      expect(dogfoodingEndpoint(PROD), brut).toBe(`https://${PROD}/api/ingest/v1/traces`);
    }
    // Le poste local, lui, parle http au dev-server (:4318), et n'a pas d'hôte de production.
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    process.env.NEXT_PUBLIC_DOGFOOD_COLLECTOR_URL = "http://localhost:4318";
    expect(dogfoodingEndpoint("localhost:3000")).toBe("http://localhost:4318/v1/traces");
  });

  it("previews et URL propres d'un déploiement restent sur la console : leur origine n'est pas enregistrée au CORS", () => {
    process.env.NEXT_PUBLIC_DOGFOOD_COLLECTOR_URL = COLLECTOR;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = PROD;
    for (const hote of ["mip-rum-console-git-branche.vercel.app", "mip-rum-console-abc123-equipe.vercel.app"]) {
      expect(dogfoodingEndpoint(hote), hote).toBe(`https://${hote}/api/ingest/v1/traces`);
    }
    // Hors requête, l'hôte de production est le repli : la collecte directe vaut.
    expect(dogfoodingEndpoint(null)).toBe(`${COLLECTOR}/v1/traces`);
  });
});

// La mission de P6b.G demandait d'élargir `connect-src` à l'origine du collector
// quand la variable est posée. Relevé du 28/09/2026 : la console n'envoie AUCUNE
// politique de sécurité du contenu (ni `next.config.mjs`, ni `vercel.json`, ni le
// middleware ; l'en-tête est absent en production). Rien à élargir — et ce test le
// tient : le jour où une CSP est posée, il rougit pour rappeler que son
// `connect-src` doit porter `origineCollecteurDogfooding(...)`, sans quoi le
// navigateur bloquerait la collecte directe en silence.
describe("CSP de la console — aucune aujourd'hui, donc rien à élargir", () => {
  const CONSOLE = join(__dirname, "..", "..", "apps", "console");

  it("aucun des trois endroits où Next et Vercel la poseraient ne la pose", () => {
    for (const fichier of ["next.config.mjs", "vercel.json", "middleware.ts"]) {
      const texte = readFileSync(join(CONSOLE, fichier), "utf8");
      expect(texte, `${fichier} pose une CSP : son connect-src doit inclure origineCollecteurDogfooding()`).not.toMatch(
        /content-security-policy/i,
      );
    }
  });

  it("l'origine qu'une future CSP devrait autoriser est celle que vise le capteur", () => {
    process.env.NEXT_PUBLIC_DOGFOOD_COLLECTOR_URL = "https://collector-production-d769.up.railway.app/";
    const origine = origineCollecteurDogfooding("mip-rum-console.vercel.app");
    expect(origine).toBe("https://collector-production-d769.up.railway.app");
    expect(new URL(dogfoodingEndpoint("mip-rum-console.vercel.app")).origin).toBe(origine);
  });
});
