// Releases touchées par un groupe d'erreurs ou une issue — logique PURE, testée
// (tests/unit/releases-touchees.test.ts), sans accès base.
//
// CE QUI ÉTAIT FAUX (recette du 26/09/2026). « Première release vue » et « Dernière »
// étaient celles de la première et de la dernière OCCURRENCE dans le temps. Deux
// releases qui tournent en même temps — un déploiement progressif, des clients qui
// gardent l'ancienne version en cache — rendent cet ordre arbitraire : « Première
// 4.12.0 · Dernière 4.12.0 » alors que 4.13.0 portait la moitié des occurrences. On
// en concluait que la dernière release était saine.
//
// CE QUE « DERNIÈRE » VEUT DIRE MAINTENANT : la release la plus RÉCENTE parmi celles
// qui portent l'erreur, et « Première » la plus ANCIENNE. L'ordre des releases :
//   1. le marqueur de déploiement de chacune, quand les deux en ont un (la seule
//      date qui dise « mise en production ») ;
//   2. sinon leur numéro, quand les deux en sont un (`4.13.0` après `4.12.0`,
//      `1.0.0-beta` avant `1.0.0`) ;
//   3. sinon leur première occurrence dans le groupe : un identifiant de commit ne se
//      compare pas, sa première apparition si.
// Chaque release garde son nombre d'occurrences : la liste complète se lit, pas
// seulement ses deux bouts.

export interface ReleaseVue {
  release: string;
  /** `Date` lue en base ; chaîne ISO une fois passée par un chargeur d'écran (sur le fil). */
  ts: Date | string;
}

/** Une release qui porte l'erreur, avec ce que le groupe en a vu. */
export interface ReleaseTouchee {
  release: string;
  /**
   * Σ occurrences (V1) de la release dans le groupe, depuis toujours ; `null` quand
   * seule l'issue s'en souvient (lignes purgées au-delà de la conservation).
   */
  occurrences: number | null;
  premiere_ts: Date | string;
  derniere_ts: Date | string;
  /** Dernier marqueur de déploiement de cette version pour l'app ; `null` sans marqueur. */
  deploiement_ts: Date | string | null;
}

export interface ReleasesDuGroupe {
  /** Release la plus ANCIENNE portant l'erreur, datée de sa première occurrence ; `null` si aucune n'en porte. */
  premiere: ReleaseVue | null;
  /** Release la plus RÉCENTE portant l'erreur, datée de sa dernière occurrence. */
  derniere: ReleaseVue | null;
  /** Releases distinctes portées par le groupe : « apparue puis restée ». */
  distinctes: number;
  /** Toutes les releases touchées (au plus `RELEASES_LUES`), de la plus récente à la plus ancienne. */
  parRelease: ReleaseTouchee[];
}

/** Plafond de la liste : au-delà, `distinctes` dit le vrai nombre. */
export const RELEASES_LUES = 100;

export const AUCUNE_RELEASE: ReleasesDuGroupe = { premiere: null, derniere: null, distinctes: 0, parRelease: [] };

const VERSION = /^v?\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.-]+)?$/;

/** Numéro de version comparable (`4.13.0`, `v2.1`, `1.0.0-beta.2`), ou `null`. */
function versionDe(release: string): { nombres: number[]; pre: string | null } | null {
  if (!VERSION.test(release)) return null;
  const sansV = release.replace(/^v/i, "").split("+")[0];
  const [corps, ...reste] = sansV.split("-");
  return { nombres: corps.split(".").map(Number), pre: reste.length ? reste.join("-") : null };
}

/** > 0 si `a` est plus récente que `b`, < 0 si plus ancienne, 0 si le numéro ne départage pas. */
function comparerVersions(a: string, b: string): number | null {
  const va = versionDe(a);
  const vb = versionDe(b);
  if (!va || !vb) return null;
  const n = Math.max(va.nombres.length, vb.nombres.length);
  for (let i = 0; i < n; i++) {
    const d = (va.nombres[i] ?? 0) - (vb.nombres[i] ?? 0);
    if (d !== 0) return d;
  }
  // Une préversion précède sa version (`1.0.0-beta` < `1.0.0`).
  if (va.pre === vb.pre) return 0;
  if (va.pre === null) return 1;
  if (vb.pre === null) return -1;
  return va.pre.localeCompare(vb.pre, "en", { numeric: true });
}

const ms = (d: Date | string | null) => (d === null ? null : new Date(d).getTime());

/** Ordre « la plus récente d'abord » (voir l'en-tête : déploiement, numéro, apparition). */
export function comparerReleases(a: ReleaseTouchee, b: ReleaseTouchee): number {
  const da = ms(a.deploiement_ts);
  const db = ms(b.deploiement_ts);
  if (da !== null && db !== null && da !== db) return db - da;
  const v = comparerVersions(a.release, b.release);
  if (v !== null && v !== 0) return -v;
  return (ms(b.premiere_ts) ?? 0) - (ms(a.premiere_ts) ?? 0) || a.release.localeCompare(b.release);
}

/** La lecture complète, à partir des releases touchées (une ligne par release). */
export function resumerReleases(lignes: readonly ReleaseTouchee[], distinctes: number = lignes.length): ReleasesDuGroupe {
  if (lignes.length === 0) return { ...AUCUNE_RELEASE, parRelease: [] };
  const parRelease = [...lignes].sort(comparerReleases);
  const recente = parRelease[0];
  const ancienne = parRelease[parRelease.length - 1];
  return {
    premiere: { release: ancienne.release, ts: ancienne.premiere_ts },
    derniere: { release: recente.release, ts: recente.derniere_ts },
    distinctes: Math.max(distinctes, parRelease.length),
    parRelease,
  };
}

/**
 * Une issue PERSISTE la release de sa première occurrence (`first_release`), que la
 * purge des lignes (30 jours) n'efface pas : sans elle, une issue apparue il y a
 * deux mois en 4.10.0 dirait « Première 4.12.0 ». Elle entre dans la liste si ses
 * lignes ne la portent plus, sans nombre d'occurrences (inconnu, jamais 0).
 */
export function avecReleasePersistee(
  lignes: readonly ReleaseTouchee[],
  persistee: { release: string | null; ts: Date | string | null },
): ReleaseTouchee[] {
  if (!persistee.release || persistee.ts === null || lignes.some((l) => l.release === persistee.release)) return [...lignes];
  return [
    ...lignes,
    { release: persistee.release, occurrences: null, premiere_ts: persistee.ts, derniere_ts: persistee.ts, deploiement_ts: null },
  ];
}
