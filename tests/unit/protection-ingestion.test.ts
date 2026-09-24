// Lot 4 — la protection de l'ingestion. Findings 2.1, 2.2 et 2.3 de l'audit
// externe, les trois marqués BLOQUANT.
//
// Ils forment UNE SEULE boucle, et c'est ce qui les rend dangereux ensemble :
//
//   une erreur en boucle émet sans plafond (2.1)
//     → elle sature la limite de débit et reçoit des 429
//       → tout 429 est réessayé indéfiniment, sans dispersion (2.2)
//         → le rejeu simultané de tous les navigateurs frappe une base déjà
//           chargée, dont le mécanisme de protection est lui-même une requête
//           SQL, et dont le repli était « laisser passer » (2.3).
//
// Chaque maillon corrigé casse la boucle ; les trois la rendent impossible.
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error — module .mjs sans déclaration de types
import { createPgAuth } from "../../packages/backend/lib/pg-ingest.mjs";
// @ts-expect-error — module .mjs sans déclaration de types
import { occurrencesDe } from "../../packages/backend/shared/otlp.mjs";
import {
  ERREURS_PAR_PAGE,
  FENETRE_SILENCE_MS,
  creerEtranglement,
  empreinteLocale,
  initErrors,
} from "../../packages/rum-sdk/src/errors";
import { initNavigation } from "../../packages/rum-sdk/src/context";
import { wireErrorDrainLifecycle } from "../../packages/rum-sdk/src/index";
import {
  RETRY_MAX_TENTATIVES,
  classerReponse,
  delaiProchainEssai,
  lireRetryAfter,
} from "../../packages/rum-sdk/src/retry";

// ═══════════════ 2.1 — le collecteur d'erreurs a enfin un plafond ═════════════

describe("une erreur en boucle est comptée, pas transmise mille fois", () => {
  it("la première occurrence part, les suivantes se taisent", () => {
    const e = creerEtranglement();
    expect(e.admettre("boom", 0)).toBe(1);
    for (let t = 1; t < 500; t++) expect(e.admettre("boom", t)).toBeNull();
  });

  it("après la fenêtre de silence, une transmission emporte TOUT le retard", () => {
    // Le plafond ne doit pas faire disparaître du volume : 300 occurrences tues
    // repartent dans le compte de la transmission suivante. Sans cela on
    // soignerait le symptôme en cassant la mesure.
    const e = creerEtranglement();
    e.admettre("boom", 0);
    for (let t = 1; t <= 300; t++) e.admettre("boom", t);
    expect(e.admettre("boom", FENETRE_SILENCE_MS)).toBe(301);
  });

  it("et le compteur repart de zéro après cette transmission", () => {
    const e = creerEtranglement();
    e.admettre("boom", 0);
    e.admettre("boom", 1);
    expect(e.admettre("boom", FENETRE_SILENCE_MS)).toBe(2);
    expect(e.admettre("boom", FENETRE_SILENCE_MS * 2)).toBe(1);
  });

  it("draine les répétitions avant la sortie sans libérer le plafond", () => {
    const e = creerEtranglement();
    expect(e.admettre("boom", 0)).toBe(1);
    for (let t = 1; t <= 9; t++) expect(e.admettre("boom", t)).toBeNull();
    // 1 span déjà émis + 9 occurrences drainées = 10 persistées.
    expect(e.drainer(10)).toEqual([{ empreinte: "boom", occurrences: 9 }]);
    expect(e.drainer(11)).toEqual([]);
    expect(e.admettre("boom", 12)).toBeNull();
  });

  it("réémet les répétitions drainées avec leur mesure avant la sortie", () => {
    const emits: Array<{ name: string; attrs: Record<string, string | number | boolean> }> = [];
    let receiveError: ((event: ErrorEvent) => void) | undefined;
    vi.stubGlobal("addEventListener", (type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === "error") receiveError = listener as (event: ErrorEvent) => void;
    });
    try {
      let actionId = "11111111-2222-4333-8444-555555555555";
      const e = initErrors(
        (name, attrs) => emits.push({ name, attrs }),
        () => 0,
        () => ({ "mip.action_id": actionId }),
      );
      const event = {
        message: "boom",
        error: new Error("boom"),
        filename: "https://app.example.test/app.js",
        lineno: 1,
        colno: 1,
      } as ErrorEvent;

      receiveError!(event);
      for (let i = 0; i < 9; i++) receiveError!(event);
      actionId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
      e.drainer(1);

      expect(emits).toHaveLength(2);
      expect(emits[0].name).toBe("exception");
      expect(emits[1].attrs["mip.error_count"]).toBe(9);
      expect(emits[1].attrs["mip.action_id"]).toBe("11111111-2222-4333-8444-555555555555");
      expect(1 + Number(emits[1].attrs["mip.error_count"])).toBe(10);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("conserve la route et l'horodatage d'origine à travers SPA, pagehide et MIPRum.flush", () => {
    const emits: Array<{ attrs: Record<string, string | number | boolean>; ts?: number }> = [];
    const listeners = new Map<string, (event?: Event) => void>();
    const documentListeners = new Map<string, () => void>();
    let now = 101;
    const page = {
      visibilityState: "visible",
      addEventListener: (type: string, listener: () => void) => documentListeners.set(type, listener),
    };
    const loc = { pathname: "/origin", href: "https://app.example.test/origin" };
    const hist = { pushState: () => undefined, replaceState: () => undefined };
    vi.stubGlobal("document", page);
    vi.stubGlobal("location", loc);
    vi.stubGlobal("history", hist);
    vi.stubGlobal("addEventListener", (type: string, listener: (event?: Event) => void) => {
      listeners.set(type, listener);
    });
    try {
      const errors = initErrors((_, attrs, ts) => emits.push({ attrs, ts }), () => now);
      const wiring = wireErrorDrainLifecycle(() => errors.drainer(Date.now()), async () => {});
      initNavigation(() => wiring.onSpaNavigation());
      const event = {
        message: "boom",
        error: new Error("boom"),
        filename: "https://app.example.test/app.js",
        lineno: 1,
        colno: 1,
      } as ErrorEvent;

      listeners.get("error")!(event); // route /origin, ts 101
      now = 102;
      listeners.get("error")!(event); // silencieuse, à drainer après SPA
      loc.pathname = "/destination";
      hist.pushState();

      now = 103;
      listeners.get("error")!(event); // silencieuse, à drainer au pagehide
      listeners.get("pagehide")!();

      now = 104;
      listeners.get("error")!(event); // silencieuse, à drainer par flush public
      wiring.onPublicFlush();

      now = 105;
      listeners.get("error")!(event); // silencieuse, à drainer en visibilitychange
      page.visibilityState = "hidden";
      documentListeners.get("visibilitychange")!();

      expect(emits).toHaveLength(5);
      expect(emits.map((e) => e.attrs["mip.route"])).toEqual(["/origin", "/origin", "/destination", "/destination", "/destination"]);
      expect(emits.map((e) => e.ts)).toEqual([101, 102, 103, 104, 105]);
      expect(emits.slice(1).every((e) => e.attrs["mip.error_count"] === 1)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("ne retient pas de détails pour une nouvelle empreinte rejetée par le cap", () => {
    const emits: Array<Record<string, string | number | boolean>> = [];
    const listeners = new Map<string, (event: ErrorEvent) => void>();
    vi.stubGlobal("addEventListener", (type: string, listener: (event: ErrorEvent) => void) => {
      listeners.set(type, listener);
    });
    try {
      const errors = initErrors((_, attrs) => emits.push(attrs), () => 0);
      const messages = Array.from({ length: ERREURS_PAR_PAGE + 1 }, (_, i) => `erreur-${String.fromCharCode(65 + i)}`);
      for (let i = 0; i <= ERREURS_PAR_PAGE; i++) {
        listeners.get("error")!({
          message: messages[i],
          error: new Error(messages[i]),
          filename: "",
          lineno: 0,
          colno: 0,
        } as ErrorEvent);
      }
      // La 51e empreinte est refusée, y compris si elle se répète puis si un
      // cycle de vie force le drain : aucun détail nouveau n'est mémorisé.
      listeners.get("error")!({ message: messages[50], error: new Error(messages[50]) } as ErrorEvent);
      errors.drainer(1);
      expect(emits).toHaveLength(ERREURS_PAR_PAGE);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("le plafond porte sur les EMPREINTES distinctes, pas sur les occurrences", () => {
    // C'est la bonne unité : ce qu'on borne, c'est le nombre de causes
    // rapportées, pas la mesure de leur fréquence. Mille répétitions d'un même
    // bug consomment un slot ; cinquante bugs différents les consomment tous.
    const e = creerEtranglement();
    for (let i = 0; i < ERREURS_PAR_PAGE; i++) expect(e.admettre(`bug-${i}`, 0)).toBe(1);
    expect(e.admettre("bug-de-trop", 0)).toBeNull();
    // …mais une empreinte DÉJÀ vue continue d'être comptée malgré le plafond.
    expect(e.admettre("bug-0", FENETRE_SILENCE_MS)).toBe(1);
  });

  it("une nouvelle page vue remet tout à zéro, comme les autres plafonds", () => {
    const e = creerEtranglement();
    for (let i = 0; i < ERREURS_PAR_PAGE; i++) e.admettre(`bug-${i}`, 0);
    expect(e.admettre("neuf", 0)).toBeNull();
    e.reset();
    expect(e.admettre("neuf", 0)).toBe(1);
  });
});

describe("l'empreinte locale reconnaît « la même erreur qui se répète »", () => {
  it("ignore les nombres du message — compteurs et horodatages varient", () => {
    // Une empreinte trop fine laisserait passer exactement la boucle qu'on veut
    // arrêter : celle dont le message contient un compteur.
    const a = empreinteLocale("TypeError", "échec tentative 41", "at f (a.js:1:2)");
    const b = empreinteLocale("TypeError", "échec tentative 9312", "at f (a.js:1:2)");
    expect(a).toBe(b);
  });

  it("mais distingue deux bugs différents", () => {
    expect(empreinteLocale("TypeError", "a", "at f")).not.toBe(
      empreinteLocale("TypeError", "b", "at f"),
    );
    expect(empreinteLocale("TypeError", "a", "at f")).not.toBe(
      empreinteLocale("RangeError", "a", "at f"),
    );
  });

  it("ne jette sur aucune forme de pile", () => {
    for (const s of ["", "pas une pile", "at f", "\n\n\n"])
      expect(() => empreinteLocale("E", "m", s)).not.toThrow();
  });
});

describe("le volume réel survit à la déduplication", () => {
  it("l'ingestion accepte le compte joint par le SDK", () => {
    expect(occurrencesDe("37")).toBe(37);
    expect(occurrencesDe(37)).toBe(37);
  });

  it("absent ou illisible vaut 1 — les SDK antérieurs restent justes", () => {
    for (const v of [undefined, null, "", "abc", 0, -5, NaN]) expect(occurrencesDe(v)).toBe(1);
  });

  it("BORNÉ : ce nombre vient du navigateur, donc d'un tiers", () => {
    // Non borné, un seul beacon fabriqué afficherait des milliards
    // d'occurrences et écraserait tous les autres groupes du classement.
    expect(occurrencesDe(1e12)).toBe(10_000);
    expect(occurrencesDe(Number.MAX_SAFE_INTEGER)).toBe(10_000);
  });
});

// ════════════ 2.2 — ce qui mérite d'être rejoué, et quand ═════════════════════

describe("la file de rejeu distingue enfin le définitif du temporaire", () => {
  it("un 403 sur une clé refusée est DÉFINITIF — le rejouer ne l'acceptera pas", () => {
    for (const s of [400, 401, 403, 404, 413, 422]) expect(classerReponse(s).retryable, String(s)).toBe(false);
  });

  it("un 429 et les 5xx sont temporaires", () => {
    for (const s of [408, 425, 429, 500, 502, 503, 504, 599])
      expect(classerReponse(s).retryable, String(s)).toBe(true);
  });

  it("l'absence de réponse est rejouable — c'est le cas nominal du hors-ligne", () => {
    expect(classerReponse(null).retryable).toBe(true);
  });

  it("un succès n'alimente rien", () => {
    for (const s of [200, 202, 204]) expect(classerReponse(s).retryable).toBe(false);
  });
});

describe("Retry-After, que l'ingestion renvoyait et que personne ne lisait", () => {
  it("lit les secondes", () => {
    expect(lireRetryAfter("60")).toBe(60_000);
  });

  it("lit une date HTTP", () => {
    const t = Date.parse("2026-09-09T12:00:00Z");
    expect(lireRetryAfter("Wed, 09 Sep 2026 12:00:30 GMT", t)).toBe(30_000);
  });

  it("rend null plutôt qu'un délai négatif sur une date passée", () => {
    const t = Date.parse("2026-09-09T12:00:00Z");
    expect(lireRetryAfter("Wed, 09 Sep 2026 11:00:00 GMT", t)).toBeNull();
  });

  it("rend null sur absent ou illisible", () => {
    for (const v of [null, "", "bientôt", "-5", "0"]) expect(lireRetryAfter(v)).toBeNull();
  });
});

describe("le retrait exponentiel, et son bruit", () => {
  it("croît avec les tentatives", () => {
    const d = [0, 1, 2, 3].map((n) => delaiProchainEssai(n, null, 0.5));
    expect(d).toEqual([...d].sort((a, b) => a - b));
    expect(d[3]).toBeGreaterThan(d[0] * 4);
  });

  it("est PLAFONNÉ — on n'attend pas trois jours", () => {
    expect(delaiProchainEssai(99, null, 1)).toBeLessThanOrEqual(30 * 60_000 * 1.5);
  });

  it("le bruit disperse : deux navigateurs ne reviennent pas à la même seconde", () => {
    // Sans lui, tous ceux qui ont échoué pendant un incident reviennent
    // ensemble et le retour de service reçoit un pic supérieur au nominal.
    // C'est l'incident qui se reproduit tout seul.
    const bas = delaiProchainEssai(2, null, 0);
    const haut = delaiProchainEssai(2, null, 1);
    expect(haut).toBeGreaterThan(bas * 2.5);
  });

  it("n'attend JAMAIS moins que ce que le serveur a demandé", () => {
    // Le bruit ne fait que disperser le retour, il ne raccourcit pas l'attente.
    for (const alea of [0, 0.25, 0.5, 0.75, 1])
      expect(delaiProchainEssai(0, 60_000, alea)).toBeGreaterThanOrEqual(60_000);
  });

  it("abandonne au bout de six tentatives", () => {
    // Garder un lot qui ne passera jamais remplirait la file au détriment de
    // spans plus récents, qui eux ont une chance.
    expect(RETRY_MAX_TENTATIVES).toBe(6);
  });
});

// ═════════ 2.3 — le repli du limiteur refuse au lieu d'accepter ═══════════════

describe("quand la base ne répond plus, le limiteur REFUSE", () => {
  const poolKO = { query: () => Promise.reject(new Error("ECONNREFUSED")) };

  it("le repli n'est plus un blanc-seing", async () => {
    // AVANT : `catch { return false }` — « on laisse passer », au moment précis
    // où la base ne répond plus. Combiné au fail-open documenté de checkApiKey,
    // l'ingestion se retrouvait sans AUCUNE protection exactement quand elle en
    // avait besoin.
    let t = 0;
    const auth = createPgAuth(poolKO, { rateLimitPerMin: 600, now: () => t, log: {} });
    let acceptes = 0;
    for (let i = 0; i < 400; i++) if (!(await auth.rateLimitedDurable("a"))) acceptes++;
    expect(acceptes).toBe(auth.plafondRepli);
    expect(acceptes).toBeLessThan(400);
  });

  it("le plafond de repli est PLUS BAS que le nominal, et c'est délibéré", () => {
    // Le compteur mémoire est par INSTANCE : appliquer le plafond nominal en
    // local autoriserait `instances × plafond` au total.
    const auth = createPgAuth(poolKO, { rateLimitPerMin: 600, log: {} });
    expect(auth.plafondRepli).toBe(150);
    expect(auth.plafondRepli).toBeLessThan(600);
  });

  it("laisse quand même passer le trafic ordinaire d'une instance", () => {
    // Refuser un peu trop pendant un incident est réparable ; refuser tout ne
    // vaudrait pas mieux qu'accepter tout.
    const auth = createPgAuth(poolKO, { rateLimitPerMin: 600, log: {} });
    expect(auth.plafondRepli).toBeGreaterThan(100);
  });

  it("ne compte chaque beacon QU'UNE fois, malgré ses deux seuils", async () => {
    // Un seul compteur, deux seuils. Le compter deux fois — une fois pour le
    // pré-filtre, une fois pour le repli — refuserait deux fois plus vite
    // qu'annoncé.
    let t = 0;
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ ok: true }] }) };
    const auth = createPgAuth(pool, { rateLimitPerMin: 10, now: () => t, log: {} });
    for (let i = 0; i < 10; i++) expect(await auth.rateLimitedDurable("a")).toBe(false);
    expect(await auth.rateLimitedDurable("a")).toBe(true); // le 11e dépasse
  });

  it("la fenêtre glisse : une minute plus tard, on repasse", async () => {
    let t = 0;
    const auth = createPgAuth(poolKO, { rateLimitPerMin: 4, now: () => t, log: {} });
    for (let i = 0; i < 20; i++) await auth.rateLimitedDurable("a");
    t += 61_000;
    expect(await auth.rateLimitedDurable("a")).toBe(false);
  });
});
