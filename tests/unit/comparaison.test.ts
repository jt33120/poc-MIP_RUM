// F06 — couverture de la période précédente (plan § 3.2), règles PURES.
//
// La lecture `debutCollecte` est jouée sur PostgreSQL par
// tests/integration/comparaison-sql.test.ts ; ici, l'ordre des règles, leurs textes
// et le cas qui ne doit RIEN lire : une plage de 30 jours, dont la période
// précédente est hors rétention quelle que soit la donnée.
import { beforeEach, describe, expect, it, vi } from "vitest";

// Toute lecture en base est une faute dans ces tests : la plage de 30 jours se
// décide sans elle, et les autres cas passent la date de début en entrée.
const lecture = vi.fn(async () => {
  throw new Error("aucune lecture attendue dans un test unitaire");
});
vi.mock("../../apps/console/lib/db", () => ({ q: lecture, tx: lecture, pool: {} }));

const {
  couverturePrecedente,
  deltasDeLaRangee,
  evaluerCouverture,
  releasesComparables,
  sourcesSousFiltres,
} = await import("../../apps/console/lib/comparaison");
const { parseAnalyticsQuery } = await import("../../apps/console/lib/query-contract");
type Source = Parameters<typeof evaluerCouverture>[0]["source"];

const NOW = Date.parse("2026-09-22T12:00:00Z");
const JOUR = 86_400_000;
const METRIQUE: Source = { table: "rum_metric", colonneTemps: "ts", additive: false };
const VUES: Source = { table: "rum_pageview", colonneTemps: "started_at", additive: true };

function requete(qs: string) {
  const r = parseAnalyticsQuery(new URLSearchParams(qs), { principal: { role: "admin", apps: null }, nowMs: NOW });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}
const trenteJours = () => requete(`from=${new Date(NOW - 30 * JOUR).toISOString()}&to=${new Date(NOW).toISOString()}`);
const evaluer = (query: ReturnType<typeof requete>, source: Source, debut: Date | null | "echec") =>
  evaluerCouverture({ query, source, debut, nowMs: NOW, retentionJours: 30 });

// Accolades obligatoires : une fonction RENDUE par beforeEach est prise pour son
// nettoyage — et `mockClear()` rend le mock lui-même, qui lève.
beforeEach(() => {
  lecture.mockClear();
});

describe("règle 1 — rétention", () => {
  it("plage personnalisée de 30 jours → partielle, sans aucune lecture", async () => {
    const c = await couverturePrecedente(trenteJours(), METRIQUE, { nowMs: NOW, retentionJours: 30 });
    expect(c).toEqual({
      etat: "partielle",
      raison: "période précédente hors rétention (30 jours) : les données les plus anciennes ont été purgées",
    });
    expect(lecture).not.toHaveBeenCalled();
  });

  it("… même si la donnée remonte plus loin : la purge gagne", () => {
    expect(evaluer(trenteJours(), METRIQUE, new Date(NOW - 90 * JOUR)).etat).toBe("partielle");
  });

  it("… et la rangée de tuiles n'affiche aucun delta", async () => {
    const c = await couverturePrecedente(trenteJours(), METRIQUE, { nowMs: NOW, retentionJours: 30 });
    expect(deltasDeLaRangee("prev", [c])).toEqual({
      deltas: false,
      note: "période précédente incomplète : période précédente hors rétention (30 jours) : les données les plus anciennes ont été purgées",
    });
  });

  it("7 jours tiennent dans 30 : la règle ne s'applique pas", () => {
    expect(evaluer(requete("period=7d"), METRIQUE, new Date(NOW - 20 * JOUR))).toEqual({ etat: "complete", raison: null });
  });

  it("plage PASSÉE : la purge compte depuis maintenant, pas depuis la fin de la plage", async () => {
    // [J−29, J−27] : sa précédente [J−31, J−29] déborde la purge (J−30). Ancrée sur
    // `range.to`, la règle la disait dans la rétention, et la raison devenait
    // « collectées depuis le … seulement » — la date de la purge, pas du début.
    const passee = requete(`from=${new Date(NOW - 29 * JOUR).toISOString()}&to=${new Date(NOW - 27 * JOUR).toISOString()}`);
    const horsRetention = {
      etat: "partielle",
      raison: "période précédente hors rétention (30 jours) : les données les plus anciennes ont été purgées",
    };
    expect(evaluer(passee, METRIQUE, new Date(NOW - 30 * JOUR))).toEqual(horsRetention);
    expect(await couverturePrecedente(passee, METRIQUE, { nowMs: NOW, retentionJours: 30 })).toEqual(horsRetention);
    expect(lecture).not.toHaveBeenCalled();
    // Une plage passée dont la précédente reste dans la purge n'est pas touchée.
    const recente = requete(`from=${new Date(NOW - 10 * JOUR).toISOString()}&to=${new Date(NOW - 9 * JOUR).toISOString()}`);
    expect(evaluer(recente, METRIQUE, new Date(NOW - 30 * JOUR))).toEqual({ etat: "complete", raison: null });
  });

  it("la rétention configurée est lue telle quelle (15 jours : 7 j + 7 j tiennent, 8 j + 8 j non)", () => {
    const huit = requete(`from=${new Date(NOW - 8 * JOUR).toISOString()}&to=${new Date(NOW).toISOString()}`);
    expect(evaluerCouverture({ query: requete("period=7d"), source: METRIQUE, debut: new Date(0), nowMs: NOW, retentionJours: 15 }).etat).toBe("complete");
    expect(evaluerCouverture({ query: huit, source: METRIQUE, debut: new Date(0), nowMs: NOW, retentionJours: 15 }).raison).toContain("(15 jours)");
  });
});

describe("règle 2 — début de collecte", () => {
  it("première mesure d'hier sous period=7d → partielle, date écrite en UTC", () => {
    const hier = new Date("2026-09-21T08:30:00Z");
    expect(evaluer(requete("period=7d"), METRIQUE, hier)).toEqual({
      etat: "partielle",
      raison: "mesures de performance collectées depuis le 21/09 08:30 UTC seulement",
    });
  });

  it("colonne ajoutée par une migration : c'est elle qui est nommée", () => {
    const source: Source = { table: "rum_pageview", colonneTemps: "started_at", colonneRequise: "release", additive: true };
    expect(evaluer(requete("period=7d"), source, new Date("2026-09-20T00:00:00Z")).raison).toBe(
      "champ « release » collecté depuis le 20/09 00:00 UTC seulement",
    );
  });

  it("aucune ligne sur le périmètre → partielle", () => {
    expect(evaluer(requete("period=24h"), METRIQUE, null)).toEqual({
      etat: "partielle",
      raison: "aucune donnée collectée sur le périmètre",
    });
  });

  it("un début exactement au début de la période précédente est complet", () => {
    const q = requete("period=24h");
    expect(evaluer(q, METRIQUE, new Date(Date.parse(q.range.from) - JOUR)).etat).toBe("complete");
  });
});

describe("règle 3 — retard d'ingestion", () => {
  it("period=1h sur un compte → partielle", () => {
    expect(evaluer(requete("period=1h"), VUES, new Date(NOW - 10 * JOUR))).toEqual({
      etat: "partielle",
      raison: "période en cours : les derniers événements arrivent encore ; un delta serait faussement négatif",
    });
  });

  it("period=1h sur une mesure non additive (p75) → complète", () => {
    expect(evaluer(requete("period=1h"), METRIQUE, new Date(NOW - 10 * JOUR)).etat).toBe("complete");
  });

  it("une heure terminée il y a plus de 5 minutes n'attend plus rien", () => {
    const passee = requete(`from=${new Date(NOW - 2 * 3_600_000).toISOString()}&to=${new Date(NOW - 3_600_000).toISOString()}`);
    expect(evaluer(passee, VUES, new Date(NOW - 10 * JOUR)).etat).toBe("complete");
  });

  it("au-delà d'une heure, l'effet est sous 1 % : non traité", () => {
    expect(evaluer(requete("period=24h"), VUES, new Date(NOW - 10 * JOUR)).etat).toBe("complete");
  });
});

describe("règles 4 et 5", () => {
  it("début de collecte non lu → inconnue, jamais complète par défaut", () => {
    expect(evaluer(requete("period=24h"), METRIQUE, "echec")).toEqual({ etat: "inconnue", raison: "début de collecte non lu" });
  });

  it("l'ordre tient : le retard d'ingestion passe avant l'échec de lecture", () => {
    expect(evaluer(requete("period=1h"), VUES, "echec").etat).toBe("partielle");
  });

  it("period=24h avec historique complet → complète", () => {
    expect(evaluer(requete("period=24h"), VUES, new Date(NOW - 10 * JOUR))).toEqual({ etat: "complete", raison: null });
  });
});

describe("sources", () => {
  it("une table ou une colonne hors liste blanche est une faute de programmation", async () => {
    await expect(couverturePrecedente(requete("period=24h"), { table: "pg_user", colonneTemps: "ts", additive: false })).rejects.toThrow(
      "source de comparaison non déclarée",
    );
    await expect(
      couverturePrecedente(requete("period=24h"), { table: "rum_metric", colonneTemps: "ts; drop table x", additive: false }),
    ).rejects.toThrow();
    await expect(
      couverturePrecedente(requete("period=24h"), { table: "rum_metric", colonneTemps: "ts", colonneRequise: "a b", additive: false }),
    ).rejects.toThrow("colonne requise invalide");
    expect(lecture).not.toHaveBeenCalled();
  });
});

describe("sourcesSousFiltres — colonne requise dérivée des filtres actifs", () => {
  // Sous un filtre porté par une colonne ajoutée par migration (v75 : navigateur,
  // système, release, env, service ; v85 : provenance du pays), la période
  // précédente n'est complète que si CETTE colonne était déjà collectée : lire
  // `min(ts)` de toute la table la disait complète à tort (faux « +100 % »).
  const SESSIONS: Source = { table: "rum_session", colonneTemps: "started_at", additive: true };
  const ERREURS: Source = { table: "rum_error", colonneTemps: "ts", additive: false };

  it("sans filtre, ou sous un filtre d'une colonne d'origine : la source seule", () => {
    expect(sourcesSousFiltres(requete("period=7d"), METRIQUE)).toEqual([METRIQUE]);
    expect(sourcesSousFiltres(requete("period=7d&device=mobile&route=/panier&country=FR"), VUES)).toEqual([VUES]);
  });

  it("colonne de la ligne (release) : la même source, colonne requise", () => {
    expect(sourcesSousFiltres(requete("period=7d&release=1.4.2"), VUES)).toEqual([
      VUES,
      { ...VUES, colonneRequise: "release" },
    ]);
    expect(sourcesSousFiltres(requete("period=7d&env=prod"), ERREURS)).toEqual([ERREURS, { ...ERREURS, colonneRequise: "env" }]);
  });

  it("colonne de SESSION (browser) : sur rum_session directement, sinon le début de collecte des sessions", () => {
    expect(sourcesSousFiltres(requete("period=7d&browser=Firefox"), SESSIONS)).toEqual([
      SESSIONS,
      { ...SESSIONS, colonneRequise: "browser" },
    ]);
    expect(sourcesSousFiltres(requete("period=7d&browser=Firefox"), METRIQUE)).toEqual([
      METRIQUE,
      { table: "rum_session", colonneTemps: "started_at", colonneRequise: "browser", additive: false },
    ]);
  });

  it("segments : `neq` exige la colonne (NULL n'est jamais « différent »), `is_null` non", () => {
    expect(sourcesSousFiltres(requete("period=7d&seg=v2:os:neq:Linux"), SESSIONS)).toEqual([
      SESSIONS,
      { ...SESSIONS, colonneRequise: "os" },
    ]);
    expect(sourcesSousFiltres(requete("period=7d&seg=v2:browser:is_null"), SESSIONS)).toEqual([SESSIONS]);
    expect(sourcesSousFiltres(requete("period=7d&seg=v2:country_source:eq:ip"), SESSIONS)).toEqual([
      SESSIONS,
      { ...SESSIONS, colonneRequise: "geo_source" },
    ]);
  });

  it("une dimension que la table ne porte pas n'ajoute rien ; une colonne citée deux fois, une seule source", () => {
    // `service` n'existe pas sur rum_metric : la lecture refuse ce filtre ailleurs.
    expect(sourcesSousFiltres(requete("period=7d&service=api"), METRIQUE)).toEqual([METRIQUE]);
    expect(sourcesSousFiltres(requete("period=7d&browser=Firefox&seg=v2:browser:neq:Safari"), SESSIONS)).toHaveLength(2);
  });

  it("la couverture qui en découle : le champ récent décide, pas la table", () => {
    const q = requete("period=7d&browser=Firefox");
    const [, navigateur] = sourcesSousFiltres(q, METRIQUE);
    expect(evaluer(q, navigateur, new Date("2026-09-20T00:00:00Z"))).toEqual({
      etat: "partielle",
      raison: "champ « browser » collecté depuis le 20/09 00:00 UTC seulement",
    });
  });
});

describe("deltasDeLaRangee", () => {
  const complete = { etat: "complete" as const, raison: null };
  const partielle = { etat: "partielle" as const, raison: "période en cours" };
  it("prev : deltas seulement si TOUTES les couvertures sont complètes", () => {
    expect(deltasDeLaRangee("prev", [complete, complete])).toEqual({ deltas: true, note: null });
    expect(deltasDeLaRangee("prev", [complete, partielle])).toEqual({ deltas: false, note: "période précédente incomplète : période en cours" });
  });
  it("hors prev : ni delta ni raison", () => {
    expect(deltasDeLaRangee("none", [complete])).toEqual({ deltas: false, note: null });
    expect(deltasDeLaRangee("release", [complete])).toEqual({ deltas: false, note: null });
  });
});

describe("releasesComparables", () => {
  it("écarte le groupe sans release, garde l'ordre par volume, sans doublon", () => {
    const rows = [{ version: "1.4.2" }, { version: "(non renseignée)" }, { version: "1.4.1" }, { version: "1.4.2" }];
    expect(releasesComparables(rows)).toEqual(["1.4.2", "1.4.1"]);
  });
});

describe("B8 — dimensions de lecture de la session sous comparaison", () => {
  const SESSIONS_B8: Source = { table: "rum_session", colonneTemps: "started_at", additive: true };
  const ERREURS_B8: Source = { table: "rum_error", colonneTemps: "ts", additive: true };

  it("runtime (v82), versions (v75), type de réseau (v53) : le début de collecte de LEUR colonne décide", () => {
    for (const dimension of ["runtime", "browser_version", "os_version", "net_type"]) {
      expect(sourcesSousFiltres(requete(`period=7d&seg=v2:${dimension}:eq:x`), SESSIONS_B8), dimension).toEqual([
        SESSIONS_B8,
        { ...SESSIONS_B8, colonneRequise: dimension },
      ]);
    }
    // Sous une table d'occurrences, la colonne de session se juge sur rum_session.
    expect(sourcesSousFiltres(requete("period=7d&seg=v2:runtime:eq:react_native"), ERREURS_B8)).toEqual([
      ERREURS_B8,
      { table: "rum_session", colonneTemps: "started_at", colonneRequise: "runtime", additive: true },
    ]);
    // « Inconnu » n'exige pas la colonne : l'historique NULL en fait partie.
    expect(sourcesSousFiltres(requete("period=7d&seg=v2:runtime:is_null"), SESSIONS_B8)).toEqual([SESSIONS_B8]);
  });
});
