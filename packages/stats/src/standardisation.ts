// Deux releases comparées À MIX DE TRAFIC ÉGAL — standardisation directe par strate.
// Logique PURE, sans accès base (RM1), testée par tests/unit/stats-standardisation.test.ts ;
// la lecture SQL qui l'alimente (`comparaisonStandardisee`, apps/console/lib/queries-deploys.ts)
// est prouvée contre ce module par tests/integration/versions-standardisees-sql.test.ts.
//
// LE PROBLÈME. Deux releases vivent sur la même fenêtre mais pas sur le même trafic :
// celle déployée le soir voit plus de mobiles et d'autres routes que celle qui a tourné
// aux heures de bureau. Leur p75 brut mêle le code et ce mix de trafic.
//
// LA MÉTHODE (standardisation directe). On découpe le trafic en STRATES (route ×
// appareil pour une mesure de page, route d'entrée × appareil pour une session). La
// population de RÉFÉRENCE est la réunion des deux releases, limitée aux strates
// COMMUNES. Une unité de la release r dans la strate s pèse :
//
//     poids(r, s) = part de s dans la référence ÷ part de s dans r
//                 = (N_s / N) ÷ (n_rs / n_r)
//
// Chaque release est ainsi lue comme si son trafic avait le mix de la référence : une
// strate sur-représentée dans r y pèse moins, une strate rare y pèse plus. Le poids
// total d'une release vaut son effectif dans les strates communes (Σ_s n_rs·poids = n_r).
//
// POURQUOI DES STRATES COMMUNES SEULEMENT. Une strate absente d'une release n'a rien à
// pondérer de ce côté : la garder ferait comparer A sur un trafic que B n'a pas vu. Une
// strate trop RARE dans une release y porterait un poids énorme sur quelques mesures :
// au-dessous de `EFFECTIF_MIN_STRATE` unités de chaque côté, elle n'est pas commune.
// La COUVERTURE dit quelle part du trafic de chaque release reste comparée.
//
// RM5 — CE QUE LA MÉTHODE N'ÉTABLIT PAS. Elle égalise le mix de routes et d'appareils ;
// elle ne dit rien de l'heure, du réseau, du pays ou du public au-delà. L'écran écrit
// « à mix de trafic égal », jamais une cause : aucun texte de ce module n'en parle.
import { refus, type Refus, type Resultat } from "./types";

/** Unités minimales de CHAQUE release dans une strate pour qu'elle soit commune. */
export const EFFECTIF_MIN_STRATE = 10;
/** Unités minimales de chaque release dans les strates communes, sans quoi la ligne se tait. */
export const EFFECTIF_MIN_RELEASE = 50;
/** Part minimale du trafic de CHAQUE release dans les strates communes. */
export const COUVERTURE_MIN = 0.5;
/** Le quantile lu : le p75 des Web Vitals. */
export const P75 = 0.75;
/**
 * Tolérance RELATIVE de la somme cumulée des poids : une somme de flottants peut
 * manquer la cible de quelques ulp selon l'ordre d'addition. La lecture SQL prend la
 * même (`cumul >= p·total − TOLERANCE_CUMUL·total`), pour tomber sur la même mesure.
 */
export const TOLERANCE_CUMUL = 1e-9;

export interface Seuils {
  effectifStrate: number;
  effectifRelease: number;
  couverture: number;
}

export const SEUILS: Seuils = {
  effectifStrate: EFFECTIF_MIN_STRATE,
  effectifRelease: EFFECTIF_MIN_RELEASE,
  couverture: COUVERTURE_MIN,
};

/** A = référence (l'ancienne release), B = candidate. */
export type Cote = "a" | "b";

/** Effectif d'une strate dans chaque release (mesures ou sessions : l'appelant le dit). */
export interface EffectifStrate {
  strate: string;
  a: number;
  b: number;
}

export interface StratePonderee extends EffectifStrate {
  /** Part de la strate dans la référence (A + B réunies, strates communes). */
  partReference: number;
  poidsA: number;
  poidsB: number;
}

/** Part des unités de A, de B et des deux réunies qui tombe dans des strates communes. */
export interface Couverture {
  a: number;
  b: number;
  ensemble: number;
}

export interface Ponderation {
  /** Les strates communes, avec leurs poids. */
  strates: StratePonderee[];
  nbStrates: { communes: number; total: number };
  /** `null` quand aucune unité n'a été lue : « 0 % couvert » n'aurait pas de sens. */
  couverture: Couverture | null;
  /** Unités de chaque release dans les strates communes. */
  effectifs: { a: number; b: number };
  /** Unités de chaque release, toutes strates. */
  totaux: { a: number; b: number };
}

const part = (x: number, total: number) => (total > 0 ? x / total : 0);

/**
 * Strates communes et poids de chaque release. Une strate est commune si CHAQUE
 * release y compte au moins `effectifMin` unités ; la référence est leur réunion.
 */
export function ponderer(effectifs: readonly EffectifStrate[], effectifMin = EFFECTIF_MIN_STRATE): Ponderation {
  const totaux = { a: 0, b: 0 };
  // Une strate citée deux fois (deux lignes de lecture) est une seule strate.
  const fusion = new Map<string, EffectifStrate>();
  for (const e of effectifs) {
    const a = Math.max(0, e.a);
    const b = Math.max(0, e.b);
    totaux.a += a;
    totaux.b += b;
    const deja = fusion.get(e.strate);
    fusion.set(e.strate, { strate: e.strate, a: (deja?.a ?? 0) + a, b: (deja?.b ?? 0) + b });
  }
  // Au moins une unité de chaque côté : une strate vide d'un côté n'y a pas de poids.
  const min = Math.max(1, effectifMin);
  const communes = [...fusion.values()].filter((s) => s.a >= min && s.b >= min);
  const na = communes.reduce((s, x) => s + x.a, 0);
  const nb = communes.reduce((s, x) => s + x.b, 0);
  const n = na + nb;
  const strates = communes.map((s) => {
    const partReference = part(s.a + s.b, n);
    return { ...s, partReference, poidsA: partReference / part(s.a, na), poidsB: partReference / part(s.b, nb) };
  });
  const total = totaux.a + totaux.b;
  return {
    strates,
    nbStrates: { communes: communes.length, total: fusion.size },
    couverture: total > 0 ? { a: part(na, totaux.a), b: part(nb, totaux.b), ensemble: part(n, total) } : null,
    effectifs: { a: na, b: nb },
    totaux,
  };
}

const pct = (x: number) => `${Math.round(x * 100)} %`;
const COTE: Record<Cote, string> = { a: "A", b: "B" };

/**
 * La ligne standardisée peut-elle être affirmée ? `null` si oui ; sinon le refus,
 * en UNE ligne chiffrée (RM2). `unite` : « mesures », « sessions » ; `strates` : le
 * découpage en clair (« route × appareil »).
 */
export function verifierPonderation(p: Ponderation, unite: string, strates: string, seuils: Seuils = SEUILS): Refus | null {
  if (p.nbStrates.communes === 0) {
    return refus(
      `aucune strate ${strates} commune aux deux releases (${seuils.effectifStrate} ${unite} au moins de chaque côté)`,
      { requis: 1, observe: 0, unite: "strates communes" },
    );
  }
  for (const cote of ["a", "b"] as const) {
    const n = p.effectifs[cote];
    if (n < seuils.effectifRelease) {
      return refus(`${n.toLocaleString("fr-FR")} ${unite} de ${COTE[cote]} dans des strates communes, ${seuils.effectifRelease} requises`, {
        requis: seuils.effectifRelease,
        observe: n,
        unite,
      });
    }
  }
  for (const cote of ["a", "b"] as const) {
    const c = p.couverture?.[cote] ?? 0;
    if (c < seuils.couverture) {
      return refus(`couverture ${pct(c)} des ${unite} de ${COTE[cote]}, ${pct(seuils.couverture)} requis`, {
        requis: seuils.couverture,
        observe: c,
        unite: `part des ${unite}`,
      });
    }
  }
  return null;
}

export interface ObservationPonderee {
  valeur: number;
  poids: number;
}

/**
 * Quantile pondéré : la plus petite valeur dont la somme cumulée des poids (valeurs
 * triées) atteint `p` du poids total — l'inverse de la fonction de répartition
 * pondérée. Poids nuls ou négatifs ignorés ; aucune observation → `null`, jamais 0.
 */
export function quantilePondere(observations: readonly ObservationPonderee[], p: number): number | null {
  const obs = observations.filter((o) => Number.isFinite(o.valeur) && Number.isFinite(o.poids) && o.poids > 0);
  const total = obs.reduce((s, o) => s + o.poids, 0);
  if (obs.length === 0 || total <= 0) return null;
  const cible = p * total - TOLERANCE_CUMUL * total;
  const triees = [...obs].sort((x, y) => x.valeur - y.valeur);
  let cumul = 0;
  for (const o of triees) {
    cumul += o.poids;
    if (cumul >= cible) return o.valeur;
  }
  return triees[triees.length - 1].valeur;
}

/** Une strate d'une part : `k` unités « touchées » sur `n`, et le poids d'une unité. */
export interface StratePart {
  n: number;
  k: number;
  poids: number;
}

/** Part pondérée : Σ poids·k ÷ Σ poids·n. Aucune unité → `null`. */
export function partPonderee(strates: readonly StratePart[]): number | null {
  let num = 0;
  let den = 0;
  for (const s of strates) {
    if (!(s.poids > 0) || !(s.n > 0)) continue;
    num += s.poids * Math.min(Math.max(s.k, 0), s.n);
    den += s.poids * s.n;
  }
  return den > 0 ? num / den : null;
}

export interface Observation {
  cote: Cote;
  strate: string;
  valeur: number;
}

export type Standardise = Resultat<{
  /** Valeurs à mix de trafic égal. */
  a: number;
  b: number;
  /** Les mêmes, sans poids, sur TOUTES les unités lues. */
  brut: { a: number | null; b: number | null };
  ponderation: Ponderation;
}>;

/** Quantile des deux releases à mix de trafic égal, depuis les observations brutes. */
export function standardiserQuantile(
  observations: readonly Observation[],
  options: { p?: number; unite?: string; strates?: string; seuils?: Seuils } = {},
): Standardise {
  const { p = P75, unite = "mesures", strates = "route × appareil", seuils = SEUILS } = options;
  const effectifs = new Map<string, EffectifStrate>();
  for (const o of observations) {
    const e = effectifs.get(o.strate) ?? { strate: o.strate, a: 0, b: 0 };
    e[o.cote] += 1;
    effectifs.set(o.strate, e);
  }
  const ponderation = ponderer([...effectifs.values()], seuils.effectifStrate);
  const brut = {
    a: quantilePondere(observations.filter((o) => o.cote === "a").map((o) => ({ valeur: o.valeur, poids: 1 })), p),
    b: quantilePondere(observations.filter((o) => o.cote === "b").map((o) => ({ valeur: o.valeur, poids: 1 })), p),
  };
  const echec = verifierPonderation(ponderation, unite, strates, seuils);
  if (echec) return echec;
  const poids = new Map(ponderation.strates.map((s) => [s.strate, s]));
  const lire = (cote: Cote) =>
    quantilePondere(
      observations.flatMap((o) => {
        const s = o.cote === cote ? poids.get(o.strate) : undefined;
        return s ? [{ valeur: o.valeur, poids: cote === "a" ? s.poidsA : s.poidsB }] : [];
      }),
      p,
    );
  const a = lire("a");
  const b = lire("b");
  if (a === null || b === null) {
    return refus(`aucune ${unite.replace(/s$/, "")} pondérable`, { requis: 1, observe: 0, unite });
  }
  return { ok: true, a, b, brut, ponderation };
}

/** Effectifs d'une strate pour une part (sessions en erreur sur sessions, par release). */
export interface EffectifPart {
  strate: string;
  a: { n: number; k: number };
  b: { n: number; k: number };
}

/** Part des deux releases à mix de trafic égal (part de sessions en erreur…). */
export function standardiserPart(
  lignes: readonly EffectifPart[],
  options: { unite?: string; strates?: string; seuils?: Seuils } = {},
): Standardise {
  const { unite = "sessions", strates = "route d'entrée × appareil", seuils = SEUILS } = options;
  const ponderation = ponderer(
    lignes.map((l) => ({ strate: l.strate, a: l.a.n, b: l.b.n })),
    seuils.effectifStrate,
  );
  const somme = (cote: Cote) => {
    const n = lignes.reduce((s, l) => s + Math.max(0, l[cote].n), 0);
    const k = lignes.reduce((s, l) => s + Math.min(Math.max(0, l[cote].k), Math.max(0, l[cote].n)), 0);
    return n > 0 ? k / n : null;
  };
  const brut = { a: somme("a"), b: somme("b") };
  const echec = verifierPonderation(ponderation, unite, strates, seuils);
  if (echec) return echec;
  // Une strate lue en plusieurs lignes est fusionnée, comme dans `ponderer`.
  const parStrate = new Map<string, EffectifPart>();
  for (const l of lignes) {
    const d = parStrate.get(l.strate);
    parStrate.set(
      l.strate,
      d
        ? { strate: l.strate, a: { n: d.a.n + l.a.n, k: d.a.k + l.a.k }, b: { n: d.b.n + l.b.n, k: d.b.k + l.b.k } }
        : l,
    );
  }
  const lire = (cote: Cote) =>
    partPonderee(
      ponderation.strates.map((s) => {
        const l = parStrate.get(s.strate)!;
        return { n: l[cote].n, k: l[cote].k, poids: cote === "a" ? s.poidsA : s.poidsB };
      }),
    );
  const a = lire("a");
  const b = lire("b");
  if (a === null || b === null) {
    return refus(`aucune ${unite.replace(/s$/, "")} pondérable`, { requis: 1, observe: 0, unite });
  }
  return { ok: true, a, b, brut, ponderation };
}
