// P7.1 — le cœur partagé est-il VRAIMENT partagé, et le SDK web a-t-il changé ?
//
// Deux questions, et elles ne se prouvent pas de la même façon :
//
//   1. « Extrait » ne veut rien dire si chaque runtime garde une copie. On
//      vérifie donc l'IDENTITÉ des références (`toBe`), pas la ressemblance des
//      résultats : deux implémentations jumelles finiraient par diverger.
//   2. Le web ne doit changer ni de surface, ni de comportement, ni de budget.
//      La surface est gelée dans une liste, le comportement est rejoué sur les
//      cas limites de `beforeSend`, et le budget est mesuré sur l'artefact
//      RÉELLEMENT livré (`apps/console/public/mip-rum.js`), pas sur un build
//      local qui pourrait manquer.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import * as core from "../../packages/rum-core/src/index";
import * as sdk from "../../packages/rum-sdk/src/index";
import * as sdkContexte from "../../packages/rum-sdk/src/event-context";
import * as sdkOtlp from "../../packages/rum-sdk/src/otlp-encode";
import * as mobile from "../../packages/rum-mobile/src/core";
import * as agent from "../../packages/agent-node/src/core";

describe("rum-core — une seule implémentation pour trois runtimes", () => {
  it("le web et React Native partagent la MÊME classe de contexte et les mêmes limites", () => {
    expect(sdkContexte.EventContextStore).toBe(core.EventContextStore);
    expect(sdkContexte.sanitizeContext).toBe(core.sanitizeContext);
    expect(sdkContexte.boundedName).toBe(core.boundedName);
    expect(sdkContexte.CONTEXT_LIMITS).toBe(core.CONTEXT_LIMITS);
  });

  it("le web et React Native partagent la MÊME couture beforeSend", () => {
    expect(sdk.applyBeforeSend).toBe(core.applyBeforeSend);
  });

  it("les trois runtimes partagent le MÊME encodeur OTLP", () => {
    expect(sdkOtlp.encodeAttributes).toBe(core.encodeAttributes);
    expect(sdkOtlp.toAnyValue).toBe(core.toAnyValue);
    expect(mobile.encodeAttrs).toBe(core.encodeAttributes);
    expect(mobile.nanos).toBe(core.msToNanos);
    // L'agent Node garde ses NOMS historiques (`register.ts` les appelle) mais
    // délègue : ce sont des adaptateurs d'une ligne, pas une seconde table.
    expect(agent.encodeAttrs({ a: 1 })).toEqual(core.encodeAttributes({ a: 1 }));
    expect(agent.nanos(1_760_000_000_123)).toBe(core.msToNanos(1_760_000_000_123));
  });

  it("encode les scalaires à l'identique pour les trois runtimes (snapshot commun)", () => {
    const attributs = {
      "mip.texte": "valeur",
      "mip.entier": 42,
      "mip.reel": 1.5,
      "mip.vrai": true,
      "mip.faux": false,
      "mip.absent": null,
      "mip.indefini": undefined,
    };
    const attendu = [
      { key: "mip.texte", value: { stringValue: "valeur" } },
      { key: "mip.entier", value: { intValue: "42" } },
      { key: "mip.reel", value: { doubleValue: 1.5 } },
      { key: "mip.vrai", value: { boolValue: true } },
      { key: "mip.faux", value: { boolValue: false } },
    ];
    // `null` et `undefined` = attribut ABSENT, jamais une valeur vide : côté
    // ingestion, « inconnu » et « chaîne vide » ne sont pas la même chose.
    expect(core.encodeAttributes(attributs)).toEqual(attendu);
    expect(sdkOtlp.encodeAttributes(attributs)).toEqual(attendu);
    expect(mobile.encodeAttrs(attributs)).toEqual(attendu);
    expect(agent.encodeAttrs(attributs)).toEqual(attendu);
  });

  it("convertit les horodatages à l'identique : ms entières -> nanosecondes en chaîne", () => {
    for (const ms of [0, 1, 1_760_000_000_000, 1_760_000_000_123, 1_760_000_000_999]) {
      expect(core.msToNanos(ms)).toBe(core.hrToNanos(core.msToHr(ms)));
      expect(mobile.nanos(ms)).toBe(agent.nanos(ms));
      // La précision nanoseconde dépasse 2^53 : la valeur reste une CHAÎNE.
      expect(typeof core.msToNanos(ms)).toBe("string");
    }
  });

  it("n'importe ni DOM, ni React Native, ni module natif Node, ni réseau", () => {
    const dossier = "packages/rum-core/src";
    const interdits = [
      /from\s+["']node:/, /require\(["']node:/, /from\s+["']react/, /from\s+["']@mip\//,
      /\bdocument\s*\./, /\bwindow\s*\./, /\bnavigator\s*\./, /\blocalStorage\b/,
      /\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bprocess\s*\./,
    ];
    for (const fichier of readdirSync(dossier).filter((f) => f.endsWith(".ts"))) {
      // Les commentaires sont écrits en français et parlent forcément du DOM :
      // on ne scanne que le code.
      const source = readFileSync(`${dossier}/${fichier}`, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((ligne) => !ligne.trim().startsWith("//"))
        .join("\n");
      for (const motif of interdits) {
        expect(`${fichier}:${motif}:${motif.test(source)}`).toBe(`${fichier}:${motif}:false`);
      }
    }
  });
});

describe("SDK web — compatibilité P7.1", () => {
  // Liste GELÉE : toute entrée ajoutée ou retirée doit être un choix explicite,
  // pas l'effet de bord d'une extraction. Un SDK déjà posé chez un client
  // continue d'appeler exactement ces noms.
  const SURFACE_WEB = [
    "addAction", "addError", "addFeatureFlagEvaluation", "addTiming", "appId",
    "applyBeforeSend", "clearAccount", "clearGlobalContext", "clearUser",
    "consent", "flush", "getErrorCollectionStats", "getGlobalContext", "init",
    "removeGlobalContextProperty", "setAccount", "setGlobalContext",
    "setGlobalContextProperty", "setUser", "startView", "track",
    "wireErrorDrainLifecycle",
  ];

  it("conserve exactement sa surface publique", () => {
    expect(Object.keys(sdk).sort()).toEqual(SURFACE_WEB);
  });

  it("garde le comportement historique de beforeSend : l'exception du hook REMONTE", () => {
    // Le web n'installe pas de garde d'isolation. Le changer silencieusement
    // ferait disparaître, chez un client déjà intégré, une exception qu'il
    // remonte peut-être lui-même à son propre outillage.
    expect(() =>
      sdk.applyBeforeSend(() => {
        throw new Error("hook cassé");
      }, { "mip.session_id": "s" }, { type: "custom", name: "x" }),
    ).toThrow("hook cassé");
  });

  it("restaure les attributs structurels et revalide le nom d'une action", () => {
    const attributs = {
      "mip.session_id": "s-1", "mip.view_id": "v-1", "mip.event_name": "Payer",
      "email": "jean@x.fr",
    };
    const filtre = sdk.applyBeforeSend(
      (a) => ({ ...a, "mip.session_id": "usurpee", "mip.view_id": "usurpee", email: "[filtré]" }),
      attributs,
      { type: "action", name: "Payer" },
    );
    expect(filtre).toMatchObject({ "mip.session_id": "s-1", "mip.view_id": "v-1", email: "[filtré]" });

    // Une racine d'action sans nom valide laisserait des enfants `action_id`
    // sans projection rum_action : elle est refusée en bloc.
    expect(sdk.applyBeforeSend(
      (a) => ({ ...a, "mip.event_name": "" }),
      attributs,
      { type: "action", name: "Payer" },
    )).toBeNull();
  });

  it("tient le budget de 35 Kio gzip sur le bundle réellement livré", () => {
    const livre = readFileSync("apps/console/public/mip-rum.js");
    const gzip = gzipSync(livre).length;
    expect(gzip).toBeLessThanOrEqual(35 * 1024);
    // Le bundle web ne contient pas le runtime React Native : les deux SDK
    // partagent des primitives, pas leurs adaptateurs.
    const texte = livre.toString("utf8");
    expect(texte).not.toContain("react-native");
    expect(texte).not.toContain("ErrorUtils");
  });
});
