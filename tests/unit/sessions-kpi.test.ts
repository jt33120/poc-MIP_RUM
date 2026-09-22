// F41 — rangée de KPI, volume et répartition de /sessions : les décisions pures.
//
// Ce que ces tests verrouillent : un nombre de visiteurs INCONNU n'est jamais écrit
// « 0 », un taux sans dénominateur non plus ; la période précédente se pose par
// RANG de seau ; la première source incomplète fait taire le delta ; « Inconnu »
// devient `is_null` dans l'URL, et le capteur passe par `seg`.
import { describe, expect, it } from "vitest";
import type { DimensionSchema } from "../../apps/console/lib/query-compiler";
import { parseAnalyticsQuery, previousRange, type AnalyticsQuery } from "../../apps/console/lib/query-contract";
import {
  DIMENSIONS_REPARTITION,
  couvertureCombinee,
  disponibiliteRepartition,
  hrefGroupe,
  lectureOccurrences,
  libelleGroupe,
  lireRepartition,
  occurrencesParSession,
  parRang,
  partDuTout,
  referencePrecedente,
  resteNonAffiche,
  visiteursAffiches,
} from "../../apps/console/lib/sessions-kpi";

const NOW = Date.parse("2026-09-21T14:00:00.000Z");
const NBSP = String.fromCharCode(0xa0);

/** Schéma après v75 : navigateur et système présents sur la session. */
const V75: DimensionSchema = new Set([
  "rum_session.device_type",
  "rum_session.geo_country",
  "rum_session.collection_source",
  "rum_session.browser",
  "rum_session.os",
  "rum_pageview.route",
]);
/** Avant v75 : ni navigateur ni système. */
const AVANT_V75: DimensionSchema = new Set(["rum_session.device_type", "rum_session.geo_country", "rum_session.collection_source"]);

function requete(qs = ""): AnalyticsQuery {
  const parsed = parseAnalyticsQuery(new URLSearchParams(`app=a&${qs}`), {
    principal: { role: "admin", apps: null },
    nowMs: NOW,
  });
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

describe("referencePrecedente", () => {
  it("nomme la durée ET date la période précédente, en UTC", () => {
    const precedente = previousRange({
      from: "2026-09-20T14:00:00.000Z",
      to: "2026-09-21T14:00:00.000Z",
      preset: "24h",
      bucketSeconds: 3600,
    });
    expect(referencePrecedente(precedente)).toBe("vs 24 h précédentes (19/09 14:00 → 20/09 14:00 UTC)");
  });

  it("plage personnalisée : « période précédente », jamais une durée de preset", () => {
    const texte = referencePrecedente({
      from: "2026-09-10T08:00:00.000Z",
      to: "2026-09-10T10:00:00.000Z",
      preset: null,
      bucketSeconds: 300,
    });
    expect(texte).toBe("vs période précédente (10/09 08:00 → 10/09 10:00 UTC)");
  });
});

describe("couvertureCombinee", () => {
  it("la première source incomplète décide, avec sa raison ; l'effectif précédent suit", () => {
    const c = couvertureCombinee(
      [
        { etat: "complete", raison: null },
        { etat: "partielle", raison: "erreurs collectées depuis le 20/09 seulement" },
        { etat: "inconnue", raison: "début de collecte non lu" },
      ],
      42,
    );
    expect(c).toEqual({ etat: "partielle", raison: "erreurs collectées depuis le 20/09 seulement", n: 42 });
  });

  it("toutes complètes : complète", () => {
    expect(couvertureCombinee([{ etat: "complete", raison: null }], 7)).toEqual({ etat: "complete", raison: null, n: 7 });
  });
});

describe("visiteursAffiches", () => {
  it("aucune session commencée : 0 est un vrai zéro", () => {
    expect(visiteursAffiches(0, 0)).toEqual({ valeur: 0 });
  });

  it("des sessions, aucune à identifiant aléatoire : inconnu, jamais « 0 visiteur »", () => {
    const v = visiteursAffiches(0, 12);
    expect(v.valeur).toBeNull();
    expect(v.raisonNull).toContain("aucune session identifiée");
  });

  it("null (lecture sans total) : « aucune session identifiée »", () => {
    expect(visiteursAffiches(null, 3)).toEqual({ valeur: null, raisonNull: "aucune session identifiée" });
  });

  it("des visiteurs comptés : la valeur telle quelle", () => {
    expect(visiteursAffiches(8, 12)).toEqual({ valeur: 8 });
  });
});

describe("occurrencesParSession (B39)", () => {
  it("S1 à 3 occurrences sur 1 session commencée : 3", () => {
    expect(occurrencesParSession({ sessions: 1, occurrences: 3 }).valeur).toBe(3);
  });

  it("aucune session commencée : « — » et sa raison, jamais 0", () => {
    const t = occurrencesParSession({ sessions: 0, occurrences: 0 });
    expect(t.valeur).toBeNull();
    expect(t.raisonNull).toBe("aucune session commencée : taux non calculable");
    expect(occurrencesParSession(null).valeur).toBeNull();
  });
});

describe("lectureOccurrences", () => {
  it("dit les occurrences exclues et ce qui peut encore bouger", () => {
    expect(lectureOccurrences({ sansSession: 2 }, 3)).toBe(
      `2 occurrences sans session rattachée, exclues ; peut encore augmenter : 3 sessions encore actives.`,
    );
  });

  it("singulier ; rien à dire → undefined", () => {
    expect(lectureOccurrences({ sansSession: 1 }, 0)).toBe("1 occurrence sans session rattachée, exclue.");
    expect(lectureOccurrences({ sansSession: 0 }, 0)).toBeUndefined();
    expect(lectureOccurrences(null, null)).toBeUndefined();
  });
});

describe("parRang", () => {
  it("pose la période précédente seau contre seau, sans rien inventer au-delà", () => {
    expect(parRang(["h0", "h1", "h2"], [4, 5])).toEqual([4, 5, null]);
    expect(parRang(["h0", "h1"], [4, 5, 6])).toEqual([4, 5]);
    expect(parRang(["h0"], [null])).toEqual([null]);
  });
});

describe("répartition", () => {
  it("onglets dans l'ordre du plan : Appareil, Navigateur, Système, Pays estimé, Capteur", () => {
    expect([...DIMENSIONS_REPARTITION]).toEqual(["device", "browser", "os", "country", "source"]);
  });

  it("onglet demandé s'il est disponible, sinon le premier disponible", () => {
    expect(lireRepartition("os", ["device", "browser", "os"])).toBe("os");
    expect(lireRepartition("os", ["device", "country"])).toBe("device");
    expect(lireRepartition("n-importe-quoi", ["device"])).toBe("device");
    expect(lireRepartition(null, [])).toBeNull();
  });

  it("navigateur et système désactivés avant v75, avec leur raison", () => {
    expect(disponibiliteRepartition("browser", V75)).toEqual({ available: true, reason: null });
    const avant = disponibiliteRepartition("browser", AVANT_V75);
    expect(avant.available).toBe(false);
    expect(avant.reason).toBeTruthy();
    expect(disponibiliteRepartition("source", AVANT_V75).available).toBe(true);
  });

  it("« Inconnu » → seg=v2:browser:is_null, filtres conservés", () => {
    const href = hrefGroupe(requete("period=7d&device=mobile"), "browser", null, V75);
    const u = new URL(href, "http://x");
    expect(u.pathname).toBe("/sessions");
    expect(u.searchParams.get("seg")).toBe("v2:browser:is_null");
    expect(u.searchParams.get("device")).toBe("mobile");
    expect(u.searchParams.get("period")).toBe("7d");
  });

  it("une valeur de navigateur passe par son paramètre dédié", () => {
    const u = new URL(hrefGroupe(requete(), "browser", "Firefox", V75), "http://x");
    expect(u.searchParams.get("browser")).toBe("Firefox");
  });

  it("le capteur passe par seg (pas de paramètre dédié)", () => {
    const u = new URL(hrefGroupe(requete(), "source", "extension", V75), "http://x");
    expect(u.searchParams.get("seg")).toBe("v2:source:eq:extension");
  });

  it("libellés : capteur en toutes lettres, groupe sans valeur « Inconnu »", () => {
    expect(libelleGroupe("source", "extension")).toBe("Extension navigateur");
    expect(libelleGroupe("source", "sdk")).toBe("SDK");
    expect(libelleGroupe("browser", null)).toBe("Inconnu");
    expect(libelleGroupe("country", "FR")).toBe("FR");
  });

  it("part du tout écrite ; sans tout, « — »", () => {
    expect(partDuTout(42, 100)).toBe(`42,0${NBSP}%`);
    expect(partDuTout(0, 0)).toBe("—");
  });

  it("reste non affiché : exact (des comptes s'additionnent), seulement si tronqué", () => {
    expect(resteNonAffiche(100, [{ sessions: 60 }, { sessions: 30 }], true)).toBe(10);
    expect(resteNonAffiche(100, [{ sessions: 60 }], false)).toBeNull();
  });
});
