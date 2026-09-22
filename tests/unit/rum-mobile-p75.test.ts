// P7.5 — le modèle de capacités, de bout en bout côté logique pure.
//
// CE QUE CES TESTS EXISTENT POUR EMPÊCHER. Un seul défaut, décliné : qu'un
// « non mesuré » se transforme quelque part en « zéro ». Il peut arriver par le
// SDK (déclarer une capacité qu'il n'a pas installée), par le parseur (accepter
// un nom inconnu), par la console (fondre `unavailable` et `unknown`) ou par le
// taux (rendre 100 % là où rien n'observe). Chacun a son test.
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error module JS sans déclarations
import {
  CAPABILITY_ATTRIBUTE,
  CAPABILITY_DECLARATION_MAX,
  MOBILE_CAPABILITIES,
  MOBILE_CAPABILITY_STATES,
  capabilityRows,
  formatCapabilityDeclaration,
  parseCapabilityDeclaration,
} from "../../apps/ingest/supabase/functions/_shared/mobile-capabilities.mjs";
import {
  CAPACITES_MOBILES,
  RAISON_CAPACITES_NATIVES,
  capacitesNativesActives,
  declarationCapacites,
  serialiserCapacites,
} from "../../packages/rum-mobile/src/capacites";
import {
  CAPABILITIES,
  CAPABILITY_LABELS,
  STATE_LABELS,
  capabilityMatrix,
  capabilityStatus,
  errorFreeSessionRate,
  parsePlatform,
  PLATFORM_OS,
  RAISON_SANS_RUNTIME,
  sessionsCohorte,
  type CapabilityDeclaration,
} from "../../apps/console/lib/mobile-capabilities";
import {
  ERROR_FREE_REASONS,
  RAISON_SANS_SOURCE_JS,
  chainerReleases,
  derniereReleaseDeclaree,
  etatCapaciteParRelease,
  ordreZonesMobile,
  tauxSansErreurDeclarant,
  texteRaisonTaux,
} from "../../apps/console/lib/mobile-capabilities";

// ═════════════ 1. Un seul vocabulaire, trois endroits qui le disent ══════════

describe("P7.5 — le vocabulaire est fermé, et il est le MÊME partout", () => {
  it("le SDK mobile et le serveur nomment exactement les mêmes capacités", () => {
    // Le paquet React Native ne peut pas importer un module Node : la liste y est
    // RECOPIÉE. Une divergence doit être un échec de test, pas une capacité
    // silencieusement jetée à l'ingestion. Même raison que pour ERROR_SOURCES.
    expect([...CAPACITES_MOBILES]).toEqual([...MOBILE_CAPABILITIES]);
  });

  it("la console lit la liste du serveur, elle ne la recopie pas", () => {
    expect([...CAPABILITIES]).toEqual([...MOBILE_CAPABILITIES]);
    // Et chacune a un libellé : une capacité sans nom d'affichage serait une
    // ligne vide dans le tableau, donc une information perdue.
    for (const c of CAPABILITIES) expect(CAPABILITY_LABELS[c]).toBeTruthy();
  });

  it("les six capacités sont celles de la spec, ni plus ni moins", () => {
    expect([...MOBILE_CAPABILITIES]).toEqual([
      "js_errors",
      "native_crashes",
      "anr",
      "native_start",
      "offline_persistence",
      "screen_tracking",
    ]);
    expect([...MOBILE_CAPABILITY_STATES]).toEqual(["active", "unavailable"]);
  });
});

// ═══════════════════ 2. Ce que le SDK a le droit de déclarer ═════════════════

describe("P7.5 — le SDK ne déclare que ce qu'il observe", () => {
  it("les trois capacités natives sont TOUJOURS indisponibles, quoi qu'on lui passe", () => {
    // Il n'existe aucun module natif MIP. Rendre ces capacités configurables ne
    // les rendrait pas observables : cela donnerait seulement à une application
    // le moyen de déclarer une collecte qui n'a pas lieu.
    for (const etat of ["active", "unavailable"] as const) {
      const d = declarationCapacites({ errorHandler: etat, navigation: etat, offlinePersistence: etat });
      expect(d.native_crashes).toBe("unavailable");
      expect(d.anr).toBe("unavailable");
      expect(d.native_start).toBe("unavailable");
      expect(capacitesNativesActives(d)).toEqual([]);
    }
    expect(RAISON_CAPACITES_NATIVES).toContain("P8.5");
  });

  it("js_errors suit le gestionnaire d'erreurs SEUL, pas les rejets de promesses", () => {
    // Une application qui a ErrorUtils mais pas d'adaptateur de rejets collecte
    // bel et bien ses erreurs JS. Annoncer « non collecté » serait un faux
    // négatif — et un faux négatif fait chercher une panne qui n'existe pas.
    const d = declarationCapacites({
      errorHandler: "active",
      navigation: "unavailable",
      offlinePersistence: "unavailable",
    });
    expect(d.js_errors).toBe("active");
    expect(d.screen_tracking).toBe("unavailable");
    expect(d.offline_persistence).toBe("unavailable");
  });

  it("la sérialisation est stable, ordonnée, et fait l'aller-retour avec le parseur serveur", () => {
    const d = declarationCapacites({
      errorHandler: "active",
      navigation: "active",
      offlinePersistence: "unavailable",
    });
    const texte = serialiserCapacites(d);
    // Ordre du vocabulaire : un ordre instable ferait varier l'octet envoyé
    // sans que rien ne change, et rendrait toute comparaison illisible.
    expect(texte).toBe(
      "js_errors:active,native_crashes:unavailable,anr:unavailable,native_start:unavailable," +
        "offline_persistence:unavailable,screen_tracking:active",
    );
    expect(texte.length).toBeLessThan(CAPABILITY_DECLARATION_MAX);
    const relu = parseCapabilityDeclaration(texte);
    expect(relu).toHaveLength(6);
    expect(relu.find((r: { capability: string }) => r.capability === "js_errors")?.declared).toBe(true);
    expect(relu.find((r: { capability: string }) => r.capability === "native_crashes")?.declared).toBe(false);
  });
});

// ════════════════ 3. Ce que le serveur accepte, et ce qu'il jette ════════════

describe("P7.5 — validation serveur : un nom inconnu n'entre jamais en base", () => {
  it("écarte les jetons inconnus SANS perdre les autres", () => {
    // Un lot de télémétrie ne doit pas être perdu parce qu'une version future du
    // SDK a ajouté un septième nom ; et ce nom ne doit pas entrer en base, où
    // plus rien ne saurait le lire.
    const d = parseCapabilityDeclaration("js_errors:active,telepathie:active,anr:peut_etre,screen_tracking:unavailable");
    expect(d.map((x: { capability: string }) => x.capability)).toEqual(["js_errors", "screen_tracking"]);
  });

  it("refuse une déclaration hors borne EN ENTIER plutôt que de la tronquer", () => {
    // Tronquer couperait un état en deux et en inventerait un autre.
    expect(parseCapabilityDeclaration("a".repeat(CAPABILITY_DECLARATION_MAX + 1))).toEqual([]);
    expect(parseCapabilityDeclaration(null)).toEqual([]);
    expect(parseCapabilityDeclaration(42)).toEqual([]);
    expect(parseCapabilityDeclaration("")).toEqual([]);
  });

  it("garde la PREMIÈRE occurrence d'une capacité répétée", () => {
    // Deux états contradictoires ne sont fiables ni l'un ni l'autre, mais le
    // résultat doit être déterministe : un « dernier gagnant » laisserait la fin
    // d'une chaîne forgée décider de l'état affiché.
    const d = parseCapabilityDeclaration("js_errors:active,js_errors:unavailable");
    expect(d).toEqual([{ capability: "js_errors", declared: true }]);
  });

  it("n'écrit aucune ligne pour un runtime qui n'est pas mobile", () => {
    // Un navigateur n'a ni crash natif ni ANR : lui poser le modèle donnerait six
    // lignes « non collecté » à un runtime auquel la question ne se pose pas.
    expect(capabilityRows({ appId: "a", runtime: "browser", release: "1", raw: "js_errors:active" })).toEqual([]);
    expect(capabilityRows({ appId: "a", runtime: null, release: "1", raw: "js_errors:active" })).toEqual([]);
    expect(capabilityRows({ appId: "", runtime: "react_native", release: "1", raw: "js_errors:active" })).toEqual([]);
  });

  it("garde une release NULLE plutôt que d'inventer une chaîne vide", () => {
    const [ligne] = capabilityRows({ appId: "app", runtime: "react_native", release: null, raw: "anr:unavailable" });
    expect(ligne).toEqual({ app_id: "app", runtime: "react_native", release: null, capability: "anr", declared: false });
  });

  it("l'attribut lu est bien celui que le SDK écrit", () => {
    expect(CAPABILITY_ATTRIBUTE).toBe("mip.capabilities");
  });

  it("formatCapabilityDeclaration est l'inverse exact de parseCapabilityDeclaration", () => {
    const texte = formatCapabilityDeclaration({ js_errors: true, anr: false });
    expect(texte).toBe("js_errors:active,anr:unavailable");
    expect(parseCapabilityDeclaration(texte)).toEqual([
      { capability: "anr", declared: false },
      { capability: "js_errors", declared: true },
    ]);
  });
});

// ═══════════ 4. Trois états côté console, et jamais un zéro à la place ═══════

const decl = (over: Partial<CapabilityDeclaration> = {}): CapabilityDeclaration => ({
  capability: "js_errors",
  runtime: "react_native",
  release: "1.0.0",
  declared: true,
  first_declared_at: "2026-09-01T00:00:00.000Z",
  last_declared_at: "2026-09-18T00:00:00.000Z",
  verified_at: null,
  verified_by: null,
  ...over,
});

describe("P7.5 — « Non collecté » et « Inconnu » ne sont pas la même chose", () => {
  it("aucune déclaration = Inconnu, pas Non collecté", () => {
    const s = capabilityStatus("native_crashes", []);
    expect(s.state).toBe("unknown");
    expect(STATE_LABELS[s.state]).toBe("Inconnu");
  });

  it("une déclaration négative = Non collecté", () => {
    const s = capabilityStatus("native_crashes", [decl({ capability: "native_crashes", declared: false })]);
    expect(s.state).toBe("unavailable");
    expect(STATE_LABELS[s.state]).toBe("Non collecté");
  });

  it("une SEULE release active suffit à rendre la capacité active dans le parc", () => {
    // Sinon, une release ancienne encore déployée ferait annoncer « non
    // collecté » alors que les signaux arrivent bel et bien.
    const s = capabilityStatus("js_errors", [
      decl({ release: "1.0.0", declared: false }),
      decl({ release: "2.0.0", declared: true }),
    ]);
    expect(s.state).toBe("active");
    expect(s.declared_by).toEqual(["2.0.0"]);
  });

  it("la matrice rend les SIX capacités, même sans aucune déclaration", () => {
    // Une case vide est une information : ne pas afficher la ligne reviendrait à
    // cacher que la question n'a pas de réponse.
    expect(capabilityMatrix([]).map((c) => c.capability)).toEqual([...MOBILE_CAPABILITIES]);
    expect(capabilityMatrix([]).every((c) => c.state === "unknown")).toBe(true);
  });

  it("retient la vérification la PLUS RÉCENTE, jamais une déclaration comme preuve", () => {
    const s = capabilityStatus("js_errors", [
      decl({ release: "1.0.0", verified_at: "2026-01-01T00:00:00.000Z", verified_by: "ops-a" }),
      decl({ release: "2.0.0", verified_at: "2026-06-01T00:00:00.000Z", verified_by: "ops-b" }),
      decl({ release: "3.0.0" }),
    ]);
    expect(s.verified_at).toBe("2026-06-01T00:00:00.000Z");
    expect(s.verified_by).toBe("ops-b");
    // Une capacité active mais jamais vérifiée le reste : `active` ne vaut pas preuve.
    const jamais = capabilityStatus("js_errors", [decl()]);
    expect(jamais.state).toBe("active");
    expect(jamais.verified_at).toBeNull();
  });
});

// ═════════════ 5. Le taux qui refuse de mentir quand il ne sait pas ══════════

// F30 (CE9) — sans migration v82, `mobileSummary` rend `sessions: 0` : ce zéro
// n'est pas un compte, c'est l'absence de cohorte. L'écran écrit « — » et pourquoi.
describe("F30 — sessionsCohorte : « — » quand la cohorte ne peut pas être isolée", () => {
  it("v82 absente (motif dans `unavailable`) → valeur null et raison, jamais 0", () => {
    const r = sessionsCohorte({ sessions: { sessions: 0 }, unavailable: [RAISON_SANS_RUNTIME] });
    expect(r.valeur).toBeNull();
    expect(r.raison).toMatch(/runtime non collecté \(migration v82\)/);
  });

  it("v82 présente : le compte lu, 0 compris (un vrai zéro)", () => {
    expect(sessionsCohorte({ sessions: { sessions: 0 }, unavailable: [] })).toEqual({ valeur: 0, raison: null });
    expect(
      sessionsCohorte({ sessions: { sessions: 3 }, unavailable: ["migration v69 absente : autre chose"] }),
    ).toEqual({ valeur: 3, raison: null });
  });
});

describe("P7.5 — js_error_free_session_rate", () => {
  it("vaut null quand la collecte des erreurs JS est déclarée indisponible", () => {
    // C'est le cœur du sujet : 10 sessions et 0 erreur observée donneraient
    // « 100 % », et ce serait exactement l'inverse de la vérité.
    const r = errorFreeSessionRate({ sessions: 10, sessionsWithJsError: 0, jsErrorsState: "unavailable" });
    expect(r.rate).toBeNull();
    expect(r.reason).toBe("capability_unavailable");
  });

  it("vaut null quand personne n'a déclaré collecter les erreurs JS", () => {
    const r = errorFreeSessionRate({ sessions: 10, sessionsWithJsError: 0, jsErrorsState: "unknown" });
    expect(r.rate).toBeNull();
    expect(r.reason).toBe("capability_unknown");
  });

  it("vaut null sans dénominateur, et ne rend jamais 0 à la place", () => {
    const r = errorFreeSessionRate({ sessions: 0, sessionsWithJsError: 0, jsErrorsState: "active" });
    expect(r.rate).toBeNull();
    expect(r.reason).toBe("no_sessions");
  });

  it("dit d'abord « aucune session » quand le périmètre est vide ET la capacité inconnue", () => {
    // Les deux raisons sont vraies ; celle qui explique la PAGE ENTIÈRE passe
    // devant. « Aucune release ne déclare collecter » enverrait chercher un
    // défaut d'instrumentation là où il n'y a rien à mesurer.
    expect(errorFreeSessionRate({ sessions: 0, sessionsWithJsError: 0, jsErrorsState: "unknown" }).reason)
      .toBe("no_sessions");
  });

  it("calcule 1 − touchées/observées quand la capacité est active", () => {
    expect(errorFreeSessionRate({ sessions: 100, sessionsWithJsError: 3, jsErrorsState: "active" })).toEqual({
      rate: 0.97,
      reason: null,
    });
    // Un vrai 100 % est légitime : la capacité est active, et rien n'a été observé.
    expect(errorFreeSessionRate({ sessions: 8, sessionsWithJsError: 0, jsErrorsState: "active" }).rate).toBe(1);
  });

  it("ne descend jamais sous 0, même si le numérateur dépasse (arrivée tardive)", () => {
    // Une erreur rattachée à une session hors cohorte ne doit pas produire un
    // taux négatif, qui serait lu comme un bug d'affichage plutôt que comme un
    // décalage de fenêtre.
    expect(errorFreeSessionRate({ sessions: 2, sessionsWithJsError: 5, jsErrorsState: "active" }).rate).toBe(0);
  });
});

// ═══════════════════════ 6. Le filtre plateforme ═════════════════════════════

describe("P7.5 — platform est le système du contrat, pas une dimension neuve", () => {
  it("n'accepte que les deux valeurs d'un runtime React Native", () => {
    expect(parsePlatform("ios")).toBe("ios");
    expect(parsePlatform("ANDROID")).toBe("android");
    expect(parsePlatform("windows")).toBeNull();
    expect(parsePlatform(null)).toBeNull();
    expect(parsePlatform("")).toBeNull();
  });

  it("se traduit par la valeur RÉELLEMENT stockée par l'ingestion", () => {
    // `dimensions.mjs` écrit « iOS » et « Android », pas « ios » : comparer la
    // valeur d'URL à la colonne rendrait zéro ligne en silence.
    expect(PLATFORM_OS.ios).toBe("iOS");
    expect(PLATFORM_OS.android).toBe("Android");
  });
});

// ════════════ 7. Le SDK transmet sa déclaration, et elle est vivante ═════════

describe("P7.5 — la déclaration part sur la resource, et suit l'état réel", () => {
  it("accompagne le lot, et vaut null tant que rien n'est déclaré", async () => {
    vi.resetModules();
    const lots: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      lots.push(JSON.parse(init.body));
      return { status: 202 };
    });
    const sdk = await import("../../packages/rum-mobile/src/index");
    // Avant `init`, le runtime ne sait rien : `null`, jamais un tableau vide.
    expect(sdk.getDiagnostics().capabilities).toBeNull();
    expect(sdk.getDiagnostics().nativeCapabilities).toBeNull();

    sdk.init({ endpoint: "https://ingest.test/v1/traces", appId: "p75", appVersion: "4.2.0", flushIntervalMs: 60_000 });
    const diag = sdk.getDiagnostics();
    // Après `init`, la réponse est CONNUE et vide : aucun module natif n'existe.
    expect(diag.nativeCapabilities).toEqual([]);
    expect(diag.capabilities?.native_crashes).toBe("unavailable");
    expect(diag.capabilities?.offline_persistence).toBe("unavailable");

    sdk.track("achat", { n: 1 });
    await sdk.flushNow();
    const resource = (lots.at(-1) as any).resourceSpans[0].resource.attributes as {
      key: string;
      value: { stringValue?: string };
    }[];
    const declaree = resource.find((a) => a.key === "mip.capabilities")?.value.stringValue;
    expect(declaree).toContain("native_crashes:unavailable");
    expect(declaree).toContain("anr:unavailable");
    expect(declaree).toContain("native_start:unavailable");
    // Et la déclaration se relit par le vocabulaire serveur, sans perte.
    expect(parseCapabilityDeclaration(declaree)).toHaveLength(6);

    await sdk.shutdown();
    vi.unstubAllGlobals();
  });

  it("l'ingestion en tire des lignes app/runtime/release, dédoublonnées", () => {
    const lignes = capabilityRows({
      appId: "p75",
      runtime: "react_native",
      release: "4.2.0",
      raw: "js_errors:active,screen_tracking:unavailable",
    });
    expect(lignes).toEqual([
      { app_id: "p75", runtime: "react_native", release: "4.2.0", capability: "js_errors", declared: true },
      { app_id: "p75", runtime: "react_native", release: "4.2.0", capability: "screen_tracking", declared: false },
    ]);
  });
});

// ═══════════ F38 — état et taux PAR RELEASE, la stabilité en hero (CE14) ═════════

describe("F38 — etatCapaciteParRelease : l'état d'une release vient de SES déclarations", () => {
  const declarations = [decl({ release: "1.4", declared: true }), decl({ release: "1.1", declared: false })];

  it("deux releases dont une seule déclarante → active pour elle, unknown pour l'autre", () => {
    expect(etatCapaciteParRelease(declarations, "js_errors", "1.4")).toBe("active");
    // Le parc est « active » (capabilityStatus) ; la 1.2, elle, n'a rien déclaré.
    expect(capabilityStatus("js_errors", declarations).state).toBe("active");
    expect(etatCapaciteParRelease(declarations, "js_errors", "1.2")).toBe("unknown");
  });

  it("une release qui déclare NE PAS collecter est unavailable, pas unknown", () => {
    expect(etatCapaciteParRelease(declarations, "js_errors", "1.1")).toBe("unavailable");
  });

  it("une release null n'hérite pas des déclarations des autres", () => {
    expect(etatCapaciteParRelease(declarations, "js_errors", null)).toBe("unknown");
    expect(etatCapaciteParRelease([decl({ release: null })], "js_errors", null)).toBe("active");
  });
});

describe("F38 — tauxSansErreurDeclarant : un taux sur les releases déclarantes seulement", () => {
  it("exemple W-M5 : A (active, 100 sessions, 10 touchées) et B (unknown, 50, 0) → 90 %, 50 exclues", () => {
    const r = tauxSansErreurDeclarant([
      { sessions: 100, sessions_touchees: 10, etat_js_errors: "active" },
      { sessions: 50, sessions_touchees: 0, etat_js_errors: "unknown" },
    ]);
    expect(r.rate).toBeCloseTo(0.9, 10);
    expect(r).toMatchObject({ reason: null, sessions: 100, touchees: 10, exclues: 50 });
    // Et non 93,3 % : la B, aveugle, gonflerait le dénominateur « sans erreur ».
    expect(r.rate).not.toBeCloseTo(1 - 10 / 150, 3);
  });

  it("somme des comptes, jamais moyenne des parts", () => {
    const r = tauxSansErreurDeclarant([
      { sessions: 10, sessions_touchees: 5, etat_js_errors: "active" },
      { sessions: 30, sessions_touchees: 3, etat_js_errors: "active" },
    ]);
    // Σ touchées / Σ sessions = 8 / 40 = 20 % touchées ; la moyenne des parts dirait 30 %.
    expect(r.rate).toBeCloseTo(0.8, 10);
  });

  it("aucune session → no_sessions, avant toute autre raison", () => {
    expect(tauxSansErreurDeclarant([]).reason).toBe("no_sessions");
    expect(tauxSansErreurDeclarant([{ sessions: 0, sessions_touchees: 0, etat_js_errors: "unknown" }]).reason).toBe("no_sessions");
  });

  it("aucune release déclarante → capability_unknown ; toutes refusent → capability_unavailable", () => {
    const inconnu = tauxSansErreurDeclarant([
      { sessions: 20, sessions_touchees: 0, etat_js_errors: "unknown" },
      { sessions: 5, sessions_touchees: 0, etat_js_errors: "unavailable" },
    ]);
    expect(inconnu).toMatchObject({ rate: null, reason: "capability_unknown", exclues: 25 });
    const refus = tauxSansErreurDeclarant([{ sessions: 5, sessions_touchees: 0, etat_js_errors: "unavailable" }]);
    expect(refus).toMatchObject({ rate: null, reason: "capability_unavailable" });
    expect(texteRaisonTaux("capability_unknown")).toBe(ERROR_FREE_REASONS.capability_unknown);
  });

  it("source d'erreur illisible (v69) → null et sa raison, jamais 100 %", () => {
    const r = tauxSansErreurDeclarant([{ sessions: 12, sessions_touchees: null, etat_js_errors: "active" }]);
    expect(r).toMatchObject({ rate: null, reason: "source_indisponible" });
    expect(texteRaisonTaux("source_indisponible")).toBe(RAISON_SANS_SOURCE_JS);
  });

  it("plus de sessions touchées que de sessions : le taux ne descend pas sous 0", () => {
    expect(tauxSansErreurDeclarant([{ sessions: 3, sessions_touchees: 5, etat_js_errors: "active" }]).rate).toBe(0);
  });
});

describe("F38 — chainerReleases : chaque release contre la précédente en première session vue", () => {
  const ligne = (release: string | null, premiere: string, part: number | null) => ({
    release,
    premiere_session: premiere,
    part_touchee: part,
  });

  it("ordre : la plus récente en tête ; écart en points contre la précédente", () => {
    const r = chainerReleases([
      ligne("1.2", "2026-09-20T10:00:00.000Z", 0.1),
      ligne("1.4", "2026-09-21T10:00:00.000Z", 1 / 3),
      ligne("1.3", "2026-09-20T18:00:00.000Z", 0.2),
    ]);
    expect(r.map((l) => l.release)).toEqual(["1.4", "1.3", "1.2"]);
    expect(r[0].release_precedente).toBe("1.3");
    expect(r[0].ecart_precedente_pts).toBeCloseTo(13.333, 2);
    expect(r[2]).toMatchObject({ release_precedente: null, ecart_precedente_pts: null });
  });

  it("une part null d'un côté → écart null ; la release « Inconnue » n'entre pas dans la chaîne", () => {
    const r = chainerReleases([
      ligne("1.4", "2026-09-21T10:00:00.000Z", 0.3),
      ligne(null, "2026-09-21T09:00:00.000Z", null),
      ligne("1.2", "2026-09-20T10:00:00.000Z", null),
    ]);
    const v14 = r.find((l) => l.release === "1.4")!;
    expect(v14.release_precedente).toBe("1.2");
    expect(v14.ecart_precedente_pts).toBeNull();
    expect(r.find((l) => l.release === null)).toMatchObject({ release_precedente: null, ecart_precedente_pts: null });
  });
});

describe("F38 — vue « Dernière release déclarée » et ordre des zones", () => {
  it("la dernière release est celle dont la PREMIÈRE déclaration est la plus récente", () => {
    expect(
      derniereReleaseDeclaree([
        decl({ release: "1.2", first_declared_at: "2026-09-01T00:00:00.000Z", last_declared_at: "2026-09-21T00:00:00.000Z" }),
        decl({ release: "1.4", first_declared_at: "2026-09-15T00:00:00.000Z" }),
        decl({ release: null, first_declared_at: "2026-09-20T00:00:00.000Z" }),
      ]),
    ).toBe("1.4");
    expect(derniereReleaseDeclaree([decl({ release: null })])).toBeNull();
  });

  it("nominal : la stabilité par release suit les tuiles ; une lecture en échec reste en place", () => {
    for (const cas of ["disponible", "erreur"] as const) {
      const ordre = ordreZonesMobile(cas);
      expect(ordre.indexOf("stabilite")).toBe(ordre.indexOf("kpi") + 1);
      expect(ordre.indexOf("angles-morts")).toBeLessThan(ordre.indexOf("kpi"));
      expect(ordre.at(-2)).toBe("capacites");
    }
  });

  it("repli (lecture indisponible sur ce schéma) : tuiles puis démarrage forment le hero, la stabilité descend", () => {
    const ordre = ordreZonesMobile("indisponible");
    expect(ordre.indexOf("demarrage-ecrans")).toBe(ordre.indexOf("kpi") + 1);
    expect(ordre.indexOf("stabilite")).toBe(ordre.indexOf("demarrage-ecrans") + 1);
  });
});
