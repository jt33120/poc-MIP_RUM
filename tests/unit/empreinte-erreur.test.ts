// L'empreinte de regroupement des erreurs — ce qui décide qu'un bug est « le même ».
//
// CE QUI ÉTAIT FAUX. L'empreinte retenait l'URL du bundle avec son EMPREINTE DE
// CONTENU. Toute application moderne sert des fichiers à nom haché, donc le même
// bug changeait de groupe à chaque mise en production :
//
//   déploiement N    …/chunks/main-4f2a9c1d.js
//   déploiement N+1  …/chunks/main-7b3e88ff.js   -> groupe différent
//
// `first_seen` repartait à zéro, le statut de triage ne suivait pas, une erreur
// marquée « résolue » revenait en groupe neuf plutôt qu'en régression, et la
// détection de régression ne se déclenchait jamais. Pendant ce temps la vitrine
// promettait « groupées par empreinte pour qu'un même bug ne compte qu'une fois ».
//
// L'ÉQUILIBRE QUE CES TESTS GARDENT. Deux erreurs opposées guettent, et elles ne
// coûtent pas le même prix. Sous-normaliser SCINDE un groupe : gênant, mais le
// bug reste visible. Sur-normaliser FUSIONNE deux bugs distincts : l'un des deux
// disparaît de l'écran. La moitié des cas ci-dessous vérifie donc que des choses
// différentes restent différentes — c'est le côté qu'on est tenté d'oublier.
//
// L'HISTORIQUE N'EST PAS REMAPPÉ, ET C'EST DÉLIBÉRÉ. Les lignes déjà en base
// gardent leur ancienne empreinte : le changement provoque UNE scission, au
// déploiement qui l'emporte. L'audit proposait une table d'alias et un job de
// reprise (une journée) ; la rétention est de 30 jours, donc cette scission
// disparaît d'elle-même en un mois. Construire une indirection permanente pour un
// écart qui expire seul aurait coûté plus que le problème.
import { describe, expect, it } from "vitest";
// @ts-expect-error — module .mjs sans déclaration de types
import { errorFingerprint, firstStackFrame, normalizeModulePath } from "../../apps/ingest/supabase/functions/_shared/otlp.mjs";

/** Une pile réaliste de bundle haché, paramétrée par l'empreinte du déploiement. */
const pile = (hash: string, fn = "handleClick") =>
  `TypeError: x is not a function
    at ${fn} (https://app.fr/_next/static/chunks/main-${hash}.js:1:2345)
    at HTMLButtonElement.<anonymous> (https://app.fr/_next/static/chunks/main-${hash}.js:1:900)`;

const empreinte = (over: { msg?: string; fn?: string; hash?: string } = {}) =>
  errorFingerprint("TypeError", over.msg ?? "x is not a function", pile(over.hash ?? "4f2a9c1d", over.fn));

describe("normalizeModulePath — ce qui change à chaque déploiement s'en va", () => {
  it("retire l'empreinte de contenu du nom de fichier", () => {
    expect(normalizeModulePath("https://app.fr/_next/static/chunks/main-4f2a9c1d.js")).toBe(
      "/_next/static/chunks/main-#.js",
    );
    // Le séparateur varie selon l'outil : `-` (webpack, Next) ou `.` (Vite).
    expect(normalizeModulePath("https://app.fr/assets/app.a1b2c3d4e5.mjs")).toBe("/assets/app.#.mjs");
  });

  it("retire un segment de chemin entièrement hexadécimal", () => {
    expect(normalizeModulePath("https://app.fr/static/a1b2c3d4e5f6/bundle.js")).toBe(
      "/static/#/bundle.js",
    );
  });

  it("retire l'origine — préproduction, préversion et production servent le même code", () => {
    expect(normalizeModulePath("https://preview-42.vercel.app/src/panier.js")).toBe("/src/panier.js");
    expect(normalizeModulePath("https://app.fr/src/panier.js")).toBe("/src/panier.js");
  });

  it("retire la query string et le fragment", () => {
    expect(normalizeModulePath("https://app.fr/src/panier.js?v=42#x")).toBe("/src/panier.js");
  });

  // ── le côté qu'on oublie : ce qui doit RESTER distinct ──────────────────────

  it("garde le nom de fichier, qui identifie le module", () => {
    expect(normalizeModulePath("https://app.fr/a/panier.js")).not.toBe(
      normalizeModulePath("https://app.fr/a/paiement.js"),
    );
  });

  it("garde le chemin, qui distingue deux modules de même nom", () => {
    expect(normalizeModulePath("https://app.fr/panier/index.js")).not.toBe(
      normalizeModulePath("https://app.fr/paiement/index.js"),
    );
  });

  // Une version SEMVER n'est pas une empreinte de contenu : `lodash-4.17.21.js`
  // et `lodash-3.10.1.js` sont deux bibliothèques différentes, et l'erreur qui
  // vient de l'une n'est pas celle qui vient de l'autre.
  it("ne confond pas un numéro de version avec une empreinte", () => {
    expect(normalizeModulePath("https://app.fr/v/lodash-4.17.21.js")).toContain("4.17.21");
  });

  // Un nom court et lisible n'est pas un hachage, même en hexadécimal pur :
  // `/api/` ou `/beef/` ne doivent pas devenir `#`. Le plancher de 8 caractères
  // est là pour ça.
  it("ne remplace pas un segment court, même hexadécimal", () => {
    expect(normalizeModulePath("https://app.fr/beef/cafe.js")).toBe("/beef/cafe.js");
  });

  it("survit à une URL non standard sans jeter", () => {
    for (const u of ["", "<anonymous>", "chrome-extension://abc/x.js", "eval", "/rel.js"])
      expect(() => normalizeModulePath(u)).not.toThrow();
  });
});

describe("firstStackFrame — la frame retenue", () => {
  it("garde le nom de fonction, qui est le cœur de l'identité du bug", () => {
    expect(firstStackFrame(pile("4f2a9c1d"))).toContain("handleClick");
  });

  it("retire ligne et colonne", () => {
    expect(firstStackFrame(pile("4f2a9c1d"))).not.toMatch(/:\d+:\d+/);
  });

  it("rend une chaîne vide sur une pile absente ou illisible", () => {
    for (const s of [null, undefined, "", "pas une pile"]) expect(firstStackFrame(s)).toBe("");
  });
});

describe("errorFingerprint — un même bug ne compte qu'une fois", () => {
  it("SURVIT à un déploiement qui rehache les bundles", () => {
    // Le cas qui a motivé tout ce fichier, et que l'audit avait exécuté.
    expect(empreinte({ hash: "4f2a9c1d" })).toBe(empreinte({ hash: "7b3e88ff" }));
  });

  it("survit à trois déploiements successifs", () => {
    const vues = new Set(["4f2a9c1d", "7b3e88ff", "0011aabb"].map((h) => empreinte({ hash: h })));
    expect(vues.size).toBe(1);
  });

  it("distingue deux messages différents", () => {
    expect(empreinte({ msg: "x is not a function" })).not.toBe(empreinte({ msg: "y is not a function" }));
  });

  it("distingue deux fonctions différentes", () => {
    expect(empreinte({ fn: "handleClick" })).not.toBe(empreinte({ fn: "handleSubmit" }));
  });

  it("regroupe toujours les variantes que la normalisation du message couvrait déjà", () => {
    // Acquis d'avant, qu'il ne fallait pas casser : identifiants et nombres
    // variables dans le message.
    const a = errorFingerprint("Error", "user 4711 not found", pile("4f2a9c1d"));
    const b = errorFingerprint("Error", "user 9022 not found", pile("7b3e88ff"));
    expect(a).toBe(b);
  });

  it("rend toujours une empreinte, même sans pile ni message", () => {
    expect(errorFingerprint(null, null, null)).toMatch(/^[0-9a-f]{8}$/);
  });
});
