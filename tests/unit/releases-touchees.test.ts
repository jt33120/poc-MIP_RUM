// Releases touchées par un groupe d'erreurs (recette du 26/09/2026).
//
// « Première release vue 4.12.0 · Dernière 4.12.0 » alors que 4.13.0 portait la
// moitié des occurrences : les deux releases tournaient EN MÊME TEMPS, et la
// « dernière » était celle de la dernière occurrence dans le temps. On en concluait
// que la dernière release était saine. La dernière est désormais la plus RÉCENTE.
import { describe, expect, it } from "vitest";
import {
  avecReleasePersistee,
  comparerReleases,
  resumerReleases,
  type ReleaseTouchee,
} from "../../apps/console/lib/releases-touchees";

const T = (min: number) => new Date(Date.UTC(2026, 8, 26, 12, min));
const rel = (release: string, o: Partial<ReleaseTouchee> = {}): ReleaseTouchee => ({
  release,
  occurrences: 1,
  premiere_ts: T(0),
  derniere_ts: T(10),
  deploiement_ts: null,
  ...o,
});

describe("resumerReleases — la plus récente est la dernière, quelle que soit l'heure de sa dernière occurrence", () => {
  it("le cas de la recette : 4.13.0 (48 occurrences) et 4.12.0 (7), vues en même temps", () => {
    // 4.12.0 a la DERNIÈRE occurrence dans le temps : l'ancien calcul la disait « Dernière ».
    const r = resumerReleases([
      rel("4.12.0", { occurrences: 7, premiere_ts: T(6), derniere_ts: T(14) }),
      rel("4.13.0", { occurrences: 48, premiere_ts: T(0), derniere_ts: T(13) }),
    ]);
    expect(r.derniere?.release).toBe("4.13.0");
    expect(r.premiere?.release).toBe("4.12.0");
    expect(r.distinctes).toBe(2);
    // La liste complète, avec les occurrences de chacune, de la plus récente à la plus ancienne.
    expect(r.parRelease.map((l) => [l.release, l.occurrences])).toEqual([
      ["4.13.0", 48],
      ["4.12.0", 7],
    ]);
  });

  it("le marqueur de déploiement l'emporte sur le numéro quand les deux releases en ont un", () => {
    const r = resumerReleases([
      rel("4.13.0", { deploiement_ts: T(0) }),
      rel("4.12.1", { deploiement_ts: T(30) }), // correctif de l'ancienne branche, déployé APRÈS
    ]);
    expect(r.derniere?.release).toBe("4.12.1");
  });

  it("numéros : 10 après 9, une préversion avant sa version", () => {
    expect(resumerReleases([rel("1.10.0"), rel("1.9.3")]).derniere?.release).toBe("1.10.0");
    expect(resumerReleases([rel("2.0.0"), rel("2.0.0-beta.2")]).derniere?.release).toBe("2.0.0");
    expect(resumerReleases([rel("v3.1"), rel("3.0.9")]).derniere?.release).toBe("v3.1");
  });

  it("identifiants de commit : la première apparition départage, jamais l'ordre alphabétique", () => {
    const r = resumerReleases([rel("ffff000", { premiere_ts: T(0) }), rel("0000aaa", { premiere_ts: T(20) })]);
    expect(r.derniere?.release).toBe("0000aaa");
    expect(comparerReleases(rel("a1b2c3d", { premiere_ts: T(5) }), rel("a1b2c3d", { premiere_ts: T(5) }))).toBe(0);
  });

  it("aucune release déclarée : rien, jamais une version devinée", () => {
    expect(resumerReleases([])).toEqual({ premiere: null, derniere: null, distinctes: 0, parRelease: [] });
  });
});

describe("avecReleasePersistee — la release de la première occurrence d'une issue survit à la purge", () => {
  it("absente des lignes : ajoutée sans nombre d'occurrences (inconnu, jamais 0)", () => {
    const lignes = avecReleasePersistee([rel("1.1.0")], { release: "1.0.0", ts: T(-3000) });
    const r = resumerReleases(lignes);
    expect(r.premiere).toEqual({ release: "1.0.0", ts: T(-3000) });
    expect(r.derniere?.release).toBe("1.1.0");
    expect(r.parRelease.find((l) => l.release === "1.0.0")?.occurrences).toBeNull();
  });

  it("déjà présente, ou non déclarée : la liste est celle des lignes", () => {
    expect(avecReleasePersistee([rel("1.1.0")], { release: "1.1.0", ts: T(0) })).toHaveLength(1);
    expect(avecReleasePersistee([rel("1.1.0")], { release: null, ts: T(0) })).toHaveLength(1);
  });
});
