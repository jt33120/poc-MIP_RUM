// Garde de l'invariant AD-4 : l'endpoint d'ingestion est produit par une seule
// fonction, et le repli est TOUJOURS l'hôte courant — jamais un hôte tiers, jamais
// une valeur de développement.
//
// Ce test existe parce que la propriété a déjà été perdue : deux sites pointaient un
// projet Supabase décommissionné et un troisième `localhost:4318`, si bien qu'un
// client onboardé recevait un snippet qui n'ingérait rien, sans erreur exploitable.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dogfoodingEndpoint, ingestEndpoint } from "../../apps/console/lib/ingest-endpoint";

const ENV_KEYS = [
  "NEXT_PUBLIC_RUM_ENDPOINT",
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
