// P5.5 — la clé de regroupement v2, prouvée sur un corpus multi-navigateurs,
// multi-builds et multi-runtimes.
//
// DEUX ERREURS OPPOSÉES, DEUX MOITIÉS DE CE FICHIER. Sous-normaliser scinde un
// groupe : le même bug apparaît deux fois, gênant mais visible. Sur-normaliser
// fusionne deux bugs : l'un disparaît de l'écran. Chaque règle qui rapproche
// (empreinte de build, frame tierce, message de moteur) a donc son cas qui doit
// rester distinct (nom de module, code sémantique, app, chemin).
//
// Les nombres réels — une issue en base, la migration, le rejeu — sont prouvés
// sur PostgreSQL par tests/integration/error-issues-sql.test.ts.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GROUPING_BASES as BASES_CONSOLE, ISSUE_STATUSES } from "../../apps/console/lib/error-issues";
import { buildOpenApi } from "../../apps/console/lib/api/openapi";
import {
  DEFAULT_VENDOR_PATHS,
  GROUPING_BASES,
  GROUPING_DIAGNOSTICS,
  GROUPING_VERSION,
  errorGrouping,
  isVendorFrame,
  messageTemplate,
  normalizeFramePath,
  normalizeFunctionName,
  overrideHash,
  parseStackFrames,
  semanticCodes,
  validateVendorPaths,
  // @ts-expect-error — module .mjs sans déclaration de types
} from "../../packages/backend/shared/error-normalize.mjs";
// @ts-expect-error — module .mjs sans déclaration de types
import { errorFingerprint, flattenOtlp } from "../../packages/backend/shared/otlp.mjs";

type Position = { index: number; source: string; line: number };

const APP = "boutique";
const cle = (input: Record<string, unknown>) => errorGrouping({ appId: APP, errorType: "TypeError", message: "m", stack: "", ...input });

// ─────────────────────────────── Corpus navigateur ────────────────────────────

const BUILDS = {
  A: { hash: "D8LbuEa1", fn: "Ze", col: { chrome: 2345, firefox: 2340, safari: 2338 } },
  B: { hash: "XyZ12345", fn: "Qe", col: { chrome: 5120, firefox: 5116, safari: 5112 } },
} as const;
type Navigateur = "chrome" | "firefox" | "safari";

const MESSAGES: Record<Navigateur, string> = {
  chrome: "Cannot read properties of undefined (reading 'total')",
  firefox: "can't access property \"total\", t is undefined",
  safari: "undefined is not an object (evaluating 't.total')",
};

const url = (build: keyof typeof BUILDS) => `https://boutique.test/assets/index-${BUILDS[build].hash}.js`;

function pile(navigateur: Navigateur, build: keyof typeof BUILDS): string {
  const b = BUILDS[build];
  if (navigateur === "chrome") {
    return `TypeError: ${MESSAGES.chrome}\n    at ${b.fn} (${url(build)}:1:${b.col.chrome})\n    at HTMLButtonElement.<anonymous> (${url(build)}:1:900)`;
  }
  if (navigateur === "firefox") return `dispatchEvent@${url(build)}:1:880\n${b.fn}@${url(build)}:1:${b.col.firefox}`;
  return `forEach@[native code]\n${b.fn}@${url(build)}:1:${b.col.safari}\nglobal code@${url(build)}:1:870`;
}

/** Positions d'une source map de chaque build : la frame applicative, et React en tiers. */
function positions(navigateur: Navigateur, build: keyof typeof BUILDS): Position[] {
  const lignes = pile(navigateur, build).split("\n");
  return lignes.flatMap((ligne, index) => {
    const colonne = Number(/:1:(\d+)\)?$/.exec(ligne)?.[1]);
    if (!colonne) return [];
    return colonne === BUILDS[build].col[navigateur]
      ? [{ index, source: "src/panier/validerPanier.ts", line: 42 }]
      : [{ index, source: "node_modules/react-dom/cjs/react-dom.production.min.js", line: 7000 }];
  });
}

const NAVIGATEURS: Navigateur[] = ["chrome", "firefox", "safari"];

describe("adaptateurs de frames", () => {
  it("V8 (Chrome, Edge) : fonction, fichier, ligne et colonne ; message et frames anonymes sans chemin écartés", () => {
    expect(parseStackFrames(pile("chrome", "A"))).toEqual([
      { fn: "Ze", file: url("A"), line: 1, column: 2345, lineIndex: 1 },
      { fn: "HTMLButtonElement.<anonymous>", file: url("A"), line: 1, column: 900, lineIndex: 2 },
    ]);
    const evaluees = parseStackFrames("Error: x\n    at new Promise (<anonymous>)\n    at async Promise.all (index 0)\n    at eval (eval at f (https://a.test/x.js:1:2), <anonymous>:1:5)");
    // Seule la frame `eval` a une position ; elle ne désigne aucun module.
    expect(evaluees.map((f) => f.fn)).toEqual(["eval"]);
    expect(normalizeFramePath(evaluees[0].file)).toBeNull();
  });

  it("Gecko (Firefox) et JavaScriptCore (Safari) : anonymes, closures, code natif et colonne absente", () => {
    expect(parseStackFrames(pile("firefox", "A")).map((f) => [f.fn, f.column, f.lineIndex])).toEqual([["dispatchEvent", 880, 0], ["Ze", 2340, 1]]);
    expect(parseStackFrames(pile("safari", "A")).map((f) => [f.fn, f.lineIndex])).toEqual([["Ze", 1], ["global code", 2]]);
    expect(parseStackFrames("@https://a.test/x.js:3:4\nrender/<@https://a.test/x.js:5\nhttps://a.test/y.js:7:8")).toEqual([
      { fn: null, file: "https://a.test/x.js", line: 3, column: 4, lineIndex: 0 },
      { fn: "render/<", file: "https://a.test/x.js", line: 5, column: null, lineIndex: 1 },
      { fn: null, file: "https://a.test/y.js", line: 7, column: 8, lineIndex: 2 },
    ]);
  });

  it("une ligne de message n'est jamais une frame, même avec un chemin et un nombre", () => {
    expect(parseStackFrames("Error: échec /api/panier:30\nError: délai:30")).toEqual([]);
  });

  it("Node : runtime, alias de méthode, URL de module ESM et chemins Windows", () => {
    const frames = parseStackFrames(`TypeError: total
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
    at Layer.handle [as handle_request] (/srv/app/node_modules/express/lib/router/layer.js:95:5)
    at async payer (file:///srv/app/dist/paiement.mjs:42:7)
    at facturer (C:\\srv\\app\\facture.js:3:1)`);
    expect(frames.map((f) => [f.fn, f.file])).toEqual([
      ["process.processTicksAndRejections", "node:internal/process/task_queues"],
      ["Layer.handle [as handle_request]", "/srv/app/node_modules/express/lib/router/layer.js"],
      ["async payer", "file:///srv/app/dist/paiement.mjs"],
      ["facturer", "C:\\srv\\app\\facture.js"],
    ]);
  });

  it("Python : frame la plus interne d'abord, et seule la dernière trace d'une exception chaînée", () => {
    const frames = parseStackFrames(`Traceback (most recent call last):
  File "/app/billing/ancien.py", line 3, in ancien
    raise KeyError("x")
KeyError: 'x'

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "/usr/local/lib/python3.11/site-packages/starlette/routing.py", line 677, in __call__
    await route.handle(scope, receive, send)
  File "/app/billing/views.py", line 42, in create_invoice
    raise ValueError("montant négatif")
ValueError: montant négatif`);
    expect(frames.map((f) => [f.fn, f.file, f.line])).toEqual([
      ["create_invoice", "/app/billing/views.py", 42],
      ["__call__", "/usr/local/lib/python3.11/site-packages/starlette/routing.py", 677],
    ]);
  });

  it("bornée : lignes hostiles ignorées, 200 lignes lues et 50 frames retenues au plus", () => {
    expect(parseStackFrames(`    at f (https://a.test/${"x".repeat(2000)}.js:1:1)`)).toEqual([]);
    const longue = Array.from({ length: 5000 }, (_, i) => `    at f${i} (https://a.test/m${i}.js:1:1)`).join("\n");
    const debut = Date.now();
    expect(parseStackFrames(longue)).toHaveLength(50);
    expect(Date.now() - debut).toBeLessThan(500);
  });

  it("nom de fonction comparable d'un moteur à l'autre", () => {
    expect([
      "Object.handleClick", "async handleClick", "new Panier", "Layer.handle [as handle_request]", "handleClick/<",
      "async*handleClick", "promise callback*handleClick", "Foo.prototype.bar", "global code", "HTMLButtonElement.<anonymous>",
      "<module>", "<lambda>", null,
    ].map(normalizeFunctionName)).toEqual([
      "handleClick", "handleClick", "Panier", "handle", "handleClick", "handleClick", "handleClick", "bar", null, null, null, null, null,
    ]);
  });
});

describe("chemins de modules : les empreintes de build partent, les modules restent distincts", () => {
  it.each([
    ["webpack / Next.js hexadécimal", "https://app.test/_next/static/chunks/pages/checkout-4f2a9c1d3b5e6f70.js", "/_next/static/chunks/pages/checkout-#.js"],
    ["Create React App", "https://app.test/static/js/main.8e1a2b3c.chunk.js", "/static/js/main.#.chunk.js"],
    ["identifiant de build Next.js en base 62", "https://app.test/_next/static/Wc0bq1CZuYb6r3Iv9Jc2e/_buildManifest.js", "/_next/static/#/_buildManifest.js"],
    ["Vite / Rollup base64url", "https://app.test/assets/index-D8LbuEa1.js", "/assets/index-#.js"],
    ["Vite sans chiffre", "https://app.test/assets/index-BZkqRLmw.js", "/assets/index-#.js"],
    ["Vite avec tiret et souligné", "https://app.test/assets/index-D-8_bXyz.js", "/assets/index-#.js"],
    ["esbuild base 32", "https://app.test/assets/chunk-5Q6BZL4O.js", "/assets/chunk-#.js"],
    ["Nuxt 3", "https://app.test/_nuxt/BZ0K3Kx1.js", "/_nuxt/#.js"],
    ["répertoire de build hexadécimal", "https://cdn.test/static/a1b2c3d4e5f6/bundle.js", "/static/#/bundle.js"],
    ["répertoire de build généré", "https://cdn.test/builds/a1b2c3d4e5f6g7h8i9/app.js", "/builds/#/app.js"],
    ["blob", "blob:https://app.test/6e8bd3a1-2b1c-4d7e-9f00-0a1b2c3d4e5f", "/#"],
    ["module de développement webpack", "webpack-internal:///./src/Button.tsx", "/src/Button.tsx"],
    ["origine, requête et fragment", "https://preview-42.vercel.app/src/panier.js?v=42#x", "/src/panier.js"],
  ])("%s", (_nom, brut, attendu) => {
    expect(normalizeFramePath(brut)).toBe(attendu);
  });

  it.each([
    ["composant nommé", "https://app.test/assets/UserCard.js"],
    ["nom composé", "https://app.test/assets/use-auth-context.js"],
    ["version de bibliothèque", "https://app.test/v/lodash-4.17.21.js"],
    ["segment hexadécimal court", "https://app.test/beef/cafe.js"],
    ["répertoire versionné", "https://app.test/builds/material-icons-v140/icons.js"],
  ])("garde un nom qui n'est pas une empreinte : %s", (_nom, brut) => {
    expect(normalizeFramePath(brut)).toBe(new URL(brut).pathname);
  });

  it("deux modules, deux chunks ou deux répertoires restent distincts après normalisation", () => {
    const paires = [
      ["https://app.test/assets/checkout-D8LbuEa1.js", "https://app.test/assets/payment-D8LbuEa1.js"],
      ["https://app.test/static/js/787.8e1a2b3c.chunk.js", "https://app.test/static/js/123.8e1a2b3c.chunk.js"],
      ["https://app.test/panier/index-D8LbuEa1.js", "https://app.test/paiement/index-D8LbuEa1.js"],
    ];
    for (const [a, b] of paires) expect(normalizeFramePath(a)).not.toBe(normalizeFramePath(b));
  });

  it("n'identifie aucun module pour une frame sans fichier", () => {
    for (const f of ["<anonymous>", "native", "[native code]", "eval at f (x.js:1:1), <anonymous>", "", "a\u0000b"]) {
      expect(normalizeFramePath(f)).toBeNull();
    }
  });
});

describe("frames tierces : chemins bornés, jamais une expression régulière", () => {
  it("écarte bibliothèques, runtime Next.js, Node, Python et extensions de navigateur", () => {
    for (const brut of [
      "https://app.test/node_modules/react-dom/cjs/react-dom.production.min.js",
      "https://app.test/_next/static/chunks/framework-4f2a9c1d.js",
      "https://app.test/_next/static/chunks/main-app-4f2a9c1d.js",
      "https://app.test/assets/vendor-D8LbuEa1.js",
      "https://app.test/js/chunk-vendors.8e1a2b3c.js",
      "node:internal/process/task_queues",
      "internal/process/task_queues.js",
      "/usr/local/lib/python3.11/site-packages/starlette/routing.py",
      "/usr/lib/python3.11/asyncio/events.py",
      "chrome-extension://abcdefgh/content.js",
      "moz-extension://1234/inject.js",
    ]) {
      expect(isVendorFrame(brut, normalizeFramePath(brut)), brut).toBe(true);
    }
    for (const brut of ["https://app.test/assets/index-D8LbuEa1.js", "/srv/app/dist/server.js", "/app/billing/views.py", "src/vendor-list/Table.tsx"]) {
      expect(isVendorFrame(brut, normalizeFramePath(brut)), brut).toBe(false);
    }
  });

  it("chemins propres à l'app : littéraux et bornés", () => {
    expect(isVendorFrame("x", "/src/lib/sdk-paiement/client.js", ["/src/lib/sdk-paiement/"])).toBe(true);
    // Littéral : un « .* » n'est pas un joker.
    expect(isVendorFrame("x", "/src/libfoo/client.js", ["/src/lib.*"])).toBe(false);
    expect(validateVendorPaths(["/a/", "/a/", "/b/"])).toEqual(["/a/", "/b/"]);
    expect(validateVendorPaths(Array.from({ length: 33 }, (_, i) => `/v${i}/`))).toBeNull();
    expect(validateVendorPaths(["x".repeat(201)])).toBeNull();
    expect(validateVendorPaths(["/ok/", "a\u0001b"])).toBeNull();
    expect(validateVendorPaths("node_modules/")).toBeNull();
    expect(DEFAULT_VENDOR_PATHS).toContain("node_modules/");
  });
});

describe("codes sémantiques et gabarit de message", () => {
  it("garde le statut HTTP, l'errno et le code Node ; un nombre sans contexte n'est pas un code", () => {
    expect(semanticCodes("AxiosError", "Request failed with status code 404")).toEqual(["http:404"]);
    expect(semanticCodes("AxiosError", "Request failed with status code 500")).toEqual(["http:500"]);
    expect(semanticCodes("HTTP 503", "GET /api/panier : HTTP 503")).toEqual(["http:503"]);
    expect(semanticCodes("requests.exceptions.HTTPError", "500 Server Error: Internal Server Error for url: https://x.test")).toEqual(["http:500"]);
    expect(semanticCodes("Error", "connect ECONNREFUSED 127.0.0.1:5432")).toEqual(["errno:ECONNREFUSED"]);
    expect(semanticCodes("OSError", "[Errno 111] Connection refused")).toEqual(["errno:111"]);
    expect(semanticCodes("TypeError", "The \"path\" argument must be of type string (ERR_INVALID_ARG_TYPE)")).toEqual(["code:ERR_INVALID_ARG_TYPE"]);
    expect(semanticCodes("ChunkLoadError", "Loading chunk 404 failed")).toEqual([]);
  });

  it("scrubbe avant de normaliser : ni email, ni identifiant, ni URL ne font un gabarit par personne", () => {
    expect(messageTemplate("Utilisateur alice@example.test introuvable (id 6e8bd3a1-2b1c-4d7e-9f00-0a1b2c3d4e5f) sur https://api.test/users/42"))
      .toBe("Utilisateur [email] introuvable (id #) sur #");
    expect(messageTemplate("token=abc123 refusé pour session 0a1b2c3d4e5f")).toBe("token=[redacted] refusé pour session #");
  });
});

describe("clé déclarée", () => {
  it("validée, rescrubbée puis hachée dans le périmètre de l'app", () => {
    const a = overrideHash("app-a", "  paiement.refus  ");
    expect(a).toEqual({ hash: expect.stringMatching(/^[0-9a-f]{64}$/), diagnostic: null });
    expect(overrideHash("app-a", "paiement.refus")).toEqual(a);
    expect(overrideHash("app-b", "paiement.refus").hash).not.toBe(a.hash);
    // Une donnée personnelle au milieu d'une clé utile ne fait pas une clé par personne.
    expect(overrideHash("app-a", "checkout-alice@example.test").hash).toBe(overrideHash("app-a", "checkout-bob@example.test").hash);
  });

  it("ignorée avec diagnostic : invalide, ou vide une fois scrubbée", () => {
    expect(overrideHash("app-a", undefined)).toEqual({ hash: null, diagnostic: null });
    for (const invalide of ["x".repeat(101), "a\u0000b", "ligne\nsuivante", 42, {}]) {
      expect(overrideHash("app-a", invalide), String(invalide)).toEqual({ hash: null, diagnostic: "override_invalide" });
    }
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlLWZhdXNzZQ";
    for (const vide of ["", "   ", "alice@example.test", "4111 1111 1111 1111", jwt, "sk-abcdefghijklmnop", "10.0.0.1", "--[email]--"]) {
      expect(overrideHash("app-a", vide), vide).toEqual({ hash: null, diagnostic: "override_vide_apres_scrub" });
    }
  });

  it("à l'ingestion : seule l'empreinte voyage, jamais la clé, et l'empreinte historique ne change pas", () => {
    const span = (attrs: Record<string, string>) => ({
      resourceSpans: [{
        resource: { attributes: [{ key: "mip.app_id", value: { stringValue: APP } }] },
        scopeSpans: [{
          scope: { name: "@mip/rum-sdk" },
          spans: [{
            name: "exception", traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7",
            startTimeUnixNano: `${Date.now() - 1000}000000`,
            attributes: Object.entries({ "mip.session_id": "s1", "exception.type": "PaymentError", "exception.message": "refus", ...attrs })
              .map(([key, v]) => ({ key, value: { stringValue: v } })),
          }],
        }],
      }],
    });
    const [avec] = flattenOtlp(span({ "mip.error_fingerprint": "paiement.refus" })).errors;
    const [sans] = flattenOtlp(span({})).errors;
    const [perso] = flattenOtlp(span({ "mip.error_fingerprint": "alice@example.test" })).errors;
    expect(avec.fingerprint_override_hash).toBe(overrideHash(APP, "paiement.refus").hash);
    expect(JSON.stringify(avec)).not.toContain("paiement.refus");
    expect(sans).not.toHaveProperty("fingerprint_override_hash");
    expect(sans).not.toHaveProperty("grouping_diagnostic");
    expect(perso).toMatchObject({ grouping_diagnostic: "override_vide_apres_scrub" });
    expect(JSON.stringify(perso)).not.toContain("alice@example.test");
    expect(avec.fingerprint).toBe(sans.fingerprint);
    expect(sans.fingerprint).toBe(errorFingerprint(sans.error_type, sans.message, sans.stack));
  });
});

describe("clé v2 : priorité, recette et confidentialité", () => {
  it("même bug, trois navigateurs, deux builds minifiés : UNE clé avec la preuve source", () => {
    const cles = (["A", "B"] as const).flatMap((build) => NAVIGATEURS.map((navigateur) => cle({
      message: MESSAGES[navigateur], stack: pile(navigateur, build), symbolicatedFrames: positions(navigateur, build),
    })));
    expect(new Set(cles.map((c) => c.key)).size).toBe(1);
    expect(cles[0]).toEqual({ version: GROUPING_VERSION, key: expect.stringMatching(/^[0-9a-f]{32}$/), basis: "symbolicated_frame" });
  });

  it("sans preuve source, les messages de moteur et les noms minifiés gardent les occurrences séparées", () => {
    const cles = (["A", "B"] as const).flatMap((build) => NAVIGATEURS.map((navigateur) =>
      cle({ message: MESSAGES[navigateur], stack: pile(navigateur, build) })));
    // Cinq et non six : sans source map, la frame React de Firefox (`dispatchEvent`,
    // même nom dans les deux builds) ne se distingue pas du code applicatif du
    // bundle, et l'empreinte de build retirée la rend identique d'un build à l'autre.
    expect(new Set(cles.map((c) => c.key)).size).toBe(5);
    expect(new Set(cles.map((c) => c.basis))).toEqual(new Set(["normalized_frame"]));
  });

  it("le même code redéployé sous une autre empreinte garde sa clé, même sans source map", () => {
    const deploiement = (hash: string) => cle({ message: MESSAGES.chrome, stack: pile("chrome", "A").replaceAll(BUILDS.A.hash, hash) });
    expect(deploiement("D8LbuEa1")).toEqual(deploiement("Wq9_Lm-3"));
  });

  it("la première frame symbolisée tierce est sautée ; sans aucune frame applicative, repli marqué", () => {
    const stack = pile("firefox", "A");
    const tiers = positions("firefox", "A").map((p) => ({ ...p, source: "node_modules/react-dom/index.js" }));
    expect(cle({ message: "m", stack, symbolicatedFrames: tiers }).basis).toBe("normalized_frame");
    expect(cle({ stack: "Error: x\n    at a (https://app.test/node_modules/lib/index.js:1:1)\n    at b (node:internal/timers:1:1)" }).basis)
      .toBe("low_confidence");
  });

  it("« Script error. » sans contexte reste peu discriminant, et propre à son app", () => {
    const a = errorGrouping({ appId: "app-a", errorType: "Error", message: "Script error.", stack: "" });
    const b = errorGrouping({ appId: "app-b", errorType: "Error", message: "Script error.", stack: "" });
    expect(a.basis).toBe("low_confidence");
    expect(a.key).not.toBe(b.key);
    expect(errorGrouping({ appId: "app-a", errorType: "Error", message: "Script error.", stack: null })).toEqual(a);
  });

  it("404 et 500 restent distincts ; deux URL d'un même 404 ne le sont pas", () => {
    const stack = "AxiosError: Request failed\n    at chargerPanier (https://app.test/src/api/panier.ts:12:5)";
    const erreur = (message: string) => cle({ errorType: "AxiosError", message, stack });
    expect(erreur("Request failed with status code 404").key).not.toBe(erreur("Request failed with status code 500").key);
    // L'empreinte historique, elle, les confondait.
    expect(errorFingerprint("AxiosError", "Request failed with status code 404", stack))
      .toBe(errorFingerprint("AxiosError", "Request failed with status code 500", stack));
    expect(erreur("GET https://api.test/panier/1 : status code 404").key).toBe(erreur("GET https://api.test/panier/2 : status code 404").key);
  });

  it("clé déclarée prioritaire sur les frames, identique entre piles, distincte entre apps", () => {
    const empreinte = overrideHash(APP, "paiement.refus").hash;
    const x = cle({ stack: pile("chrome", "A"), overrideHash: empreinte, symbolicatedFrames: positions("chrome", "A") });
    expect(x.basis).toBe("override");
    expect(cle({ errorType: "RangeError", stack: pile("safari", "B"), overrideHash: empreinte }).key).toBe(x.key);
    expect(errorGrouping({ appId: "autre", errorType: "TypeError", message: "m", stack: "", overrideHash: overrideHash("autre", "paiement.refus").hash }).key)
      .not.toBe(x.key);
    // Une empreinte malformée n'est pas une clé déclarée.
    expect(cle({ stack: pile("chrome", "A"), overrideHash: "paiement.refus" }).basis).toBe("normalized_frame");
  });

  it("ni la release ni un nom de fonction minifié seul ne décident", () => {
    const stack = (fichier: string) => `TypeError: x\n    at a (https://app.test/assets/${fichier}:1:10)`;
    expect(cle({ stack: stack("panier-D8LbuEa1.js") }).key).not.toBe(cle({ stack: stack("profil-D8LbuEa1.js") }).key);
    expect(cle({ message: "total", stack: stack("panier-D8LbuEa1.js") }).key).not.toBe(cle({ message: "items", stack: stack("panier-D8LbuEa1.js") }).key);
    // La release d'une ligne n'entre pas dans sa clé.
    expect(cle({ stack: stack("panier-D8LbuEa1.js"), release: "1.0.0" }).key).toBe(cle({ stack: stack("panier-D8LbuEa1.js"), release: "2.0.0" }).key);
  });

  it("confidentialité : une donnée personnelle dans le message ne fait pas une clé par personne", () => {
    const stack = "Error: x\n    at charger (/srv/app/profil.js:3:1)";
    expect(cle({ message: "profil alice@example.test introuvable", stack }).key).toBe(cle({ message: "profil bob@example.test introuvable", stack }).key);
    expect(cle({ message: "carte 4111 1111 1111 1111 refusée" }).key).toBe(cle({ message: "carte 5500 0000 0000 0004 refusée" }).key);
  });

  it("backends : première frame applicative Node et Python, runtime et dépendances sautés", () => {
    const node = cle({ message: "total", stack: `TypeError: total
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
    at Layer.handle [as handle_request] (/srv/app/node_modules/express/lib/router/layer.js:95:5)
    at async payer (/srv/app/dist/paiement.js:42:7)` });
    expect(node.basis).toBe("normalized_frame");
    expect(node.key).toBe(cle({ message: "total", stack: "TypeError: total\n    at payer (/srv/app/dist/paiement.js:50:1)" }).key);
    const python = (fichier: string) => cle({ errorType: "ValueError", message: "montant négatif", stack: `Traceback (most recent call last):
  File "/usr/local/lib/python3.11/site-packages/starlette/routing.py", line 677, in __call__
  File "${fichier}", line 42, in create_invoice
ValueError: montant négatif` });
    expect(python("/app/billing/views.py").key).not.toBe(python("/app/shipping/views.py").key);
  });

  it("chemins tiers de l'app : la frame configurée est sautée, la suivante décide", () => {
    const stack = "Error: x\n    at client (https://app.test/src/lib/sdk-paiement/client.js:1:1)\n    at payer (https://app.test/src/paiement.js:1:1)";
    const sansConfig = cle({ stack });
    const avecConfig = cle({ stack, vendorPaths: ["/src/lib/sdk-paiement/"] });
    expect(avecConfig.key).not.toBe(sansConfig.key);
    expect(avecConfig.key).toBe(cle({ stack: "Error: x\n    at payer (https://app.test/src/paiement.js:9:9)" }).key);
    // Une configuration hors contrat est ignorée plutôt que d'échouer.
    expect(cle({ stack, vendorPaths: ["x".repeat(500)] }).key).toBe(sansConfig.key);
  });
});

describe("taxonomies partagées avec la console, la migration et l'OpenAPI", () => {
  it("bases, statuts et diagnostics identiques partout", () => {
    expect([...GROUPING_BASES]).toEqual([...BASES_CONSOLE]);
    expect([...GROUPING_DIAGNOSTICS]).toEqual(["override_invalide", "override_vide_apres_scrub"]);
    const schemas = (buildOpenApi().components as { schemas: Record<string, { properties?: Record<string, { enum?: unknown[] }> }> }).schemas;
    expect(schemas.IssueRecord.properties?.grouping_basis.enum).toEqual([...GROUPING_BASES]);
    expect(schemas.IssueRecord.properties?.status.enum).toEqual([...ISSUE_STATUSES]);
  });
});

// ───────────────────────────── migration-v72, lue ─────────────────────────────
// Ce que seul le TEXTE garantit, et qu'une migration ultérieure pourrait défaire
// sans qu'aucun test d'exécution ne le remarque.

const SQL = join(__dirname, "..", "..", "packages", "db", "sql");
const V72 = readFileSync(join(SQL, "migration-v72.sql"), "utf8");

/**
 * Corps d'une fonction RECOPIÉE dans un fichier, jusqu'à sa fin `end $$;`.
 *
 * ANCRÉ EN DÉBUT DE LIGNE : depuis v83, une migration peut insérer une
 * instruction dans la définition COURANTE (`execute 'create or replace …' ||
 * quote_literal(replace(prosrc, …))`) plutôt que de recopier cent lignes. Cette
 * forme ne peut rien perdre — elle part du corps en place. Le garde-fou vise les
 * RECOPIES, qui, elles, le peuvent : c'est ainsi que v80 a repris la définition
 * d'avant v79 et perdu `analytics_saved_view` et `dashboard`.
 */
function corps(sql: string, fonction: string): string | null {
  const debut = sql.search(new RegExp(`^create or replace function ${fonction}\\(`, "m"));
  if (debut < 0) return null;
  const bloc = sql.slice(debut);
  return bloc.slice(0, bloc.indexOf("end $$;"));
}

/** Le fichier modifie-t-il la fonction EN PLACE, à partir de `prosrc` ? */
function patchEnPlace(sql: string, fonction: string): boolean {
  return new RegExp(`execute[^;]*create or replace function ${fonction}`, "s").test(sql)
    && /quote_literal\(replace\(src,/.test(sql);
}

describe("migration-v72", () => {
  it("borne l'attente de verrou dès la première instruction, sans valider de contrainte sous verrou", () => {
    const instructions = V72.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--"));
    expect(instructions[0]).toBe("set local lock_timeout = '5s';");
    expect(V72.slice(V72.indexOf("alter table rum_error"))).toContain(") not valid;");
    expect(V72).not.toMatch(/validate constraint/i);
  });

  it("l'index de l'initialisation est le même en prédéploiement concurrent, et un build bloquant est borné", () => {
    const index = "idx_rum_error_fingerprint_ts_v72 on rum_error (app_id, fingerprint, ts);";
    expect(V72).toContain(`create index if not exists ${index}`);
    const predeploiement = readFileSync(join(SQL, "predeploy-v72-indexes.sql"), "utf8").replace(/\s+/g, " ");
    expect(predeploiement).toContain(`create index concurrently if not exists ${index}`);
    expect(V72.indexOf("pg_total_relation_size('public.rum_error') > 33554432")).toBeLessThan(V72.indexOf(`create index if not exists ${index}`));
  });

  it("les trois tables sont sous RLS tenant et console_ro n'y fait que lire", () => {
    for (const table of ["error_grouping_config", "error_issue", "error_issue_alias"]) {
      expect(V72).toContain(`alter table ${table} enable row level security;`);
      expect(V72).toContain(`create policy tenant_scope on ${table}\n  for select to console_ro using (app_id = any (current_app_ids()));`);
    }
    expect(V72).toContain("grant select on error_grouping_config, error_issue, error_issue_alias to console_ro;");
    expect(V72).not.toMatch(/grant[^;]*(insert|update|delete)[^;]*error_(issue|grouping)/i);
  });
});

describe("toute redéfinition, v72 comprise, emporte les issues", () => {
  const fichiers = readdirSync(SQL).filter((f) => /^migration-v\d+\.sql$/.test(f) && Number(f.match(/\d+/)![0]) >= 72);
  const definitions = (fonction: string) =>
    fichiers
      .map((f) => [f, corps(readFileSync(join(SQL, f), "utf8"), fonction)] as const)
      .filter((d): d is readonly [string, string] => d[1] !== null);

  it("purge_rum_app : une issue sans occurrence depuis la coupure, APRÈS ses occurrences", () => {
    expect(definitions("purge_rum_app").map(([f]) => f)).toContain("migration-v72.sql");
    for (const [f, bloc] of definitions("purge_rum_app")) {
      const issues = bloc.search(/delete from error_issue\s+where app_id = p_app_id and last_seen < p_cutoff/);
      expect(issues, f).toBeGreaterThan(bloc.search(/delete from rum_error\s+where app_id = p_app_id and ts < p_cutoff/));
    }
  });

  it("erase_app_data : issues (et leurs alias, en cascade) et configuration", () => {
    expect(definitions("erase_app_data").map(([f]) => f)).toContain("migration-v72.sql");
    for (const [f, bloc] of definitions("erase_app_data")) {
      expect(bloc, f).toMatch(/delete from error_issue\s+where app_id = p_app_id/);
      expect(bloc, f).toMatch(/delete from error_grouping_config\s+where app_id = p_app_id/);
    }
    expect(V72).toContain("references error_issue (app_id, id) on delete cascade");
  });

  /**
   * L'autre forme, et la seule autre autorisée : la modification EN PLACE. Une
   * recopie simplement indentée — dans un `do $$` — échapperait autrement au
   * garde-fou ci-dessus.
   */
  it("une redéfinition non recopiée part de la définition COURANTE", () => {
    for (const f of fichiers) {
      const sql = readFileSync(join(SQL, f), "utf8");
      for (const fonction of ["purge_rum_app", "erase_app_data"]) {
        if (!sql.includes(`create or replace function ${fonction}`)) continue;
        if (corps(sql, fonction) !== null) continue;
        expect(patchEnPlace(sql, fonction), `${f} / ${fonction}`).toBe(true);
      }
    }
  });
});
