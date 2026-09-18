#!/usr/bin/env node
// P7.1 — étanchéité des bundles et installation réelle des paquets construits.
//
// POURQUOI UN SCRIPT ET PAS UN TEST UNITAIRE. Ce qu'on vérifie ici n'existe
// qu'APRÈS le build : les fichiers `dist/`, le champ `exports` que le
// résolveur de Node lit vraiment, et les déclarations `.d.ts` telles qu'un
// consommateur les voit. Un test qui importerait la SOURCE prouverait autre
// chose que ce qui est publié.
//
// Trois questions, une réponse chacune :
//   1. Le bundle web contient-il du React Native ? Le bundle RN, du DOM ?
//      L'agent Node, du React ?
//   2. Un artefact publié référence-t-il encore un autre paquet du dépôt —
//      c'est-à-dire du TypeScript non compilé à résoudre chez le client ?
//   3. Un consommateur qui INSTALLE le paquet obtient-il les exports annoncés,
//      en CommonJS, en ESM et en types ?
//
// Usage : node scripts/verify-sdk-packaging.mjs
// Prérequis : pnpm --filter "@mip/rum-core" --filter "@mip/rum-sdk" \
//             --filter "@mip/rum-mobile" --filter "@mip/agent-node" build

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const racine = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const erreurs = [];
const ok = [];

function verifie(condition, message) {
  if (condition) ok.push(message);
  else erreurs.push(message);
}

function lire(chemin) {
  const absolu = join(racine, chemin);
  if (!existsSync(absolu)) {
    erreurs.push(`artefact manquant : ${chemin} — lancer les builds avant ce script`);
    return null;
  }
  return readFileSync(absolu, "utf8");
}

// ─────────────────── 1. Étanchéité des bundles construits ───────────────────
//
// esbuild supprime les commentaires du source : un mot trouvé dans un bundle
// est donc du CODE, pas une phrase de documentation.

const web = lire("packages/rum-sdk/dist/mip-rum.js");
if (web) {
  for (const interdit of ["react-native", "ErrorUtils", "@mip/rum-mobile", "AppState"]) {
    verifie(!web.includes(interdit), `bundle web sans « ${interdit} »`);
  }
}

const rnCjs = lire("packages/rum-mobile/dist/index.js");
const rnEsm = lire("packages/rum-mobile/dist/index.mjs");
for (const [nom, source] of [["CJS", rnCjs], ["ESM", rnEsm]]) {
  if (!source) continue;
  for (const interdit of ["document", "window", "navigator", "localStorage", "rrweb", "web-vitals"]) {
    verifie(!source.includes(interdit), `bundle RN (${nom}) sans global DOM « ${interdit} »`);
  }
}

const node = lire("packages/agent-node/dist/register.js");
if (node) {
  for (const interdit of ["react-native", "ErrorUtils", "rrweb"]) {
    verifie(!node.includes(interdit), `bundle agent Node sans « ${interdit} »`);
  }
  // `react` seul serait un faux positif (« react » est un fragment fréquent) :
  // on cherche une VRAIE résolution de module.
  verifie(
    !/require\(["']react/.test(node) && !/from ["']react/.test(node),
    "bundle agent Node sans import de React",
  );
}

// ───────── 2. Aucun artefact publié ne référence un paquet du dépôt ─────────
//
// Les trois bundles inlinent `@mip/rum-core`. S'il en restait un import, le
// consommateur devrait résoudre — et compiler — du TypeScript non publié.
for (const [nom, source] of [["web", web], ["RN CJS", rnCjs], ["RN ESM", rnEsm], ["agent Node", node]]) {
  if (!source) continue;
  verifie(
    !/require\(["']@mip\//.test(source) && !/from\s*["']@mip\//.test(source) && !/import\(["']@mip\//.test(source),
    `bundle ${nom} sans import résiduel vers un paquet @mip/*`,
  );
  verifie(!/\.ts["']/.test(source), `bundle ${nom} sans référence à un fichier .ts`);
}

// ─────────── 3. Mini-consommateur isolé : installation puis exports ──────────
//
// Les paquets sont COPIÉS dans le `node_modules` d'un projet neuf, hors du
// dépôt : la résolution passe par `exports`, comme chez un client.

const EXPORTS_ATTENDUS_MOBILE = [
  "addAction", "addError", "addFeatureFlagEvaluation", "addTiming",
  "clearAccount", "clearGlobalContext", "clearUser", "consent", "default",
  "flushNow", "getDiagnostics", "getGlobalContext", "init",
  // P7.3 — instrumentation d'appui, mesure de démarrage JS, et deux fabriques
  // d'adaptateurs que l'application appelle avec SES objets (référence de
  // routeur, module de suivi de rejets) : le SDK ne résout aucun module.
  "instrumentPressable", "markFirstScreenRendered", "navigationDepuisRouteur",
  "rejetsDepuisTracker",
  "removeGlobalContextProperty", "screen", "setAccount", "setGlobalContext",
  "setGlobalContextProperty", "setUser", "shutdown", "startView", "track",
];

const EXPORTS_ATTENDUS_CORE = [
  "CONTEXT_LIMITS", "EventContextStore", "SPAN_KIND", "STATUS_CODE",
  "STRUCTURAL_ATTRIBUTES", "applyBeforeSend", "boundedName", "buildResourceSpans",
  "encodeAttributes", "hrToNanos", "kindPour", "msToHr", "msToNanos",
  "newEnvelopeId", "sanitizeContext", "statutPour", "toAnyValue", "validateIdentity",
];

const bac = mkdtempSync(join(tmpdir(), "mip-rum-consommateur-"));
try {
  for (const paquet of ["rum-core", "rum-mobile"]) {
    const cible = join(bac, "node_modules", "@mip", paquet);
    mkdirSync(cible, { recursive: true });
    cpSync(join(racine, "packages", paquet, "dist"), join(cible, "dist"), { recursive: true });
    // La dépendance workspace n'existe plus dans l'artefact : le bundle est
    // autonome. La déclarer ici ferait échouer l'installation du consommateur.
    const manifeste = JSON.parse(readFileSync(join(racine, "packages", paquet, "package.json"), "utf8"));
    delete manifeste.dependencies;
    delete manifeste.devDependencies;
    delete manifeste.scripts;
    delete manifeste.private;
    writeFileSync(join(cible, "package.json"), JSON.stringify(manifeste, null, 2));
  }

  writeFileSync(join(bac, "package.json"), JSON.stringify({ name: "consommateur-mip", version: "1.0.0", private: true }, null, 2));

  // CommonJS — le chemin `react-native` / `main` de Metro.
  writeFileSync(join(bac, "consommateur.cjs"), `
    const globauxInterdits = ["document", "window", "navigator", "localStorage"];
    for (const nom of globauxInterdits) {
      Object.defineProperty(globalThis, nom, {
        configurable: true,
        get() { throw new Error("global DOM touché par le SDK RN : " + nom); },
      });
    }
    const sdk = require("@mip/rum-mobile");
    const noms = Object.keys(sdk).sort();
    const diag = sdk.getDiagnostics();
    console.log(JSON.stringify({ noms, diag }));
  `);

  const sortieCjs = execFileSync(process.execPath, [join(bac, "consommateur.cjs")], { encoding: "utf8" });
  const { noms, diag } = JSON.parse(sortieCjs.trim().split("\n").pop());
  verifie(
    JSON.stringify(noms) === JSON.stringify(EXPORTS_ATTENDUS_MOBILE),
    `exports CommonJS de @mip/rum-mobile conformes (obtenu : ${noms.join(", ")})`,
  );
  // « Inconnu » vaut null, jamais 0 : AVANT `init`, le runtime ne sait rien de
  // son consentement, de son stockage ni de ses renvois. Annoncer « 0 renvoi »
  // à ce moment-là serait une affirmation, pas une mesure.
  verifie(
    diag.queued === 0 && diag.dropped === 0 && diag.retries === null &&
      diag.storageAvailable === null && diag.consent === null && diag.nativeCapabilities === null &&
      diag.identityPersistence === null && diag.lastTransportStatus === null &&
      diag.storageCorruptions === null && diag.jsCapabilities === null,
    "getDiagnostics() distingue le connu (0) de l'inconnu (null)",
  );

  // ESM — le chemin `module`/`import` des bundlers modernes.
  writeFileSync(join(bac, "consommateur.mjs"), `
    import * as sdk from "@mip/rum-mobile";
    import * as core from "@mip/rum-core";
    console.log(JSON.stringify({ sdk: Object.keys(sdk).sort(), core: Object.keys(core).sort() }));
  `);
  const sortieEsm = execFileSync(process.execPath, [join(bac, "consommateur.mjs")], { encoding: "utf8" });
  const surfaces = JSON.parse(sortieEsm.trim().split("\n").pop());
  verifie(
    JSON.stringify(surfaces.sdk) === JSON.stringify(EXPORTS_ATTENDUS_MOBILE),
    "exports ESM de @mip/rum-mobile conformes",
  );
  verifie(
    JSON.stringify(surfaces.core) === JSON.stringify(EXPORTS_ATTENDUS_CORE),
    `exports ESM de @mip/rum-core conformes (obtenu : ${surfaces.core.join(", ")})`,
  );

  // Types — un consommateur TypeScript compile contre les `.d.ts` publiés.
  writeFileSync(join(bac, "consommateur.ts"), `
    import {
      init, addError, consent, shutdown, getDiagnostics, setUser, startView,
      instrumentPressable, markFirstScreenRendered, navigationDepuisRouteur,
      type EventContext, type StorageAdapter, type NavigationAdapter,
    } from "@mip/rum-mobile";
    const stockage: StorageAdapter = {
      async getItem() { return null; },
      async setItem() {},
      async removeItem() {},
    };
    init({
      endpoint: "https://ingest.test/v1/traces", appId: "demo", platform: "ios",
      requireConsent: true, initialConsent: "pending",
      adapters: { storage: stockage },
      offline: { persistent: false, maxEvents: 500 },
    });
    consent(true);
    const contexte: EventContext = { plan: "pro" };
    setUser({ id: "u-1", ...contexte });
    startView("Accueil", contexte);
    addError(new Error("boum"), contexte, { fingerprint: "checkout-v1" });
    const d: number | null = getDiagnostics().retries;
    void d;
    // P7.3 — l'instrumentation d'appui préserve toutes les autres props, la
    // fabrique d'adaptateur rend bien un NavigationAdapter, et la mesure de
    // démarrage rend un booléen (jamais une exception dans l'app hôte).
    const props = instrumentPressable({
      mipActionName: "checkout.payer",
      accessibilityLabel: "Payer la commande",
      onPress: () => {},
    });
    const libelle: string = props.accessibilityLabel;
    void libelle;
    const routage: NavigationAdapter = navigationDepuisRouteur({
      addListener: () => () => {},
      getCurrentRoute: () => ({ name: "Accueil", key: "Accueil-1" }),
    });
    void routage;
    const demarre: boolean = markFirstScreenRendered();
    void demarre;
    const capacites = getDiagnostics().jsCapabilities;
    void (capacites === null ? null : capacites.unhandledRejection);
    void shutdown();
  `);
  writeFileSync(join(bac, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2020", module: "ESNext", moduleResolution: "bundler",
      lib: ["ES2020"], types: [], strict: true, noEmit: true, skipLibCheck: true,
    },
    include: ["consommateur.ts"],
  }, null, 2));
  const tsc = join(racine, "packages/rum-mobile/node_modules/.bin/tsc");
  if (existsSync(tsc)) {
    execFileSync(tsc, ["-p", join(bac, "tsconfig.json")], { encoding: "utf8", stdio: "pipe" });
    ok.push("consommateur TypeScript compile contre les .d.ts publiés");
  } else {
    erreurs.push("tsc introuvable : `pnpm install` non joué ?");
  }
} catch (e) {
  erreurs.push(`mini-consommateur : ${e.stdout ? String(e.stdout) : ""}${e.message}`);
} finally {
  rmSync(bac, { recursive: true, force: true });
}

for (const ligne of ok) console.log(`  ✓ ${ligne}`);
for (const ligne of erreurs) console.error(`  ✗ ${ligne}`);
if (erreurs.length) {
  console.error(`\n❌ ${erreurs.length} vérification(s) d'empaquetage en échec`);
  process.exit(1);
}
console.log(`\n✓ Empaquetage SDK vérifié (${ok.length} contrôles).`);
