// Nouvelle release face à la précédente (F08, plan § 4.2, § 3.2) — SSR.
//
// Deux colonnes (A = référence, B = candidate), une ligne par mesure, l'écart
// relatif de B à A. Ce que la comparaison NE dit PAS est écrit aussi fort que ce
// qu'elle dit :
//
//   - les valeurs BRUTES sont lues sur la même fenêtre, sans normalisation de trafic :
//     deux releases vivent sur la même plage mais pas sur les mêmes heures ni les
//     mêmes visiteurs ; leur écart mêle le code et le contexte (phrase obligatoire,
//     toujours rendue) ;
//   - sous LCP, INP et sessions en erreur, la même mesure À MIX DE TRAFIC ÉGAL
//     (`@mip/stats/standardisation`, nuit du 01/10/2026) : chaque strate route ×
//     appareil pèse dans A et B ce qu'elle pèse dans les deux réunies. Elle égalise
//     le mix, rien d'autre : l'écran dit « à mix égal », jamais une cause. Sous un
//     seuil d'effectif ou de couverture, la ligne se tait et dit pourquoi ;
//   - la règle qui a choisi A et B (dernier déploiement déclaré, ou volume) est
//     affichée sous le titre (CP3) ;
//   - d'où vient la release de chaque mesure (`source`) ;
//   - chaque valeur porte son effectif ; une release sans session sur la fenêtre le
//     dit, au lieu d'afficher des tirets muets ;
//   - le CLS n'est pas lu par `comparaisonVersions` : sa ligne le dit, elle ne
//     disparaît pas.
//
// Verdict de couleur réservé aux p75 de Web Vitals (seuils de `lib/rating.ts`, R-V) ;
// le taux de sessions en erreur n'a pas de seuil publié : aucune couleur (R-S). Un
// écart n'est pas coloré non plus — « plus haut » n'est « pire » qu'avec une règle,
// et le verdict statistique viendra de P*.5 (`verdict`).
//
// Recette du 26/09/2026 : le même INP de 304 ms était « verdict incertain » sur la
// tuile et « À améliorer » ici. Le verdict passe donc par la même règle que la tuile
// (`lireVital`) : affirmé seulement s'il tient sur tout l'intervalle à 95 % de la
// release. Et l'écart d'un TAUX s'écrit en points : « +46 % » sur 43,5 % → 63,6 %
// se lisait comme une hausse de 46 points.
//
// SUR LA VUE D'ENSEMBLE, UNE CASE (recette du 30/09/2026) : `VignetteRelease` résume
// la comparaison en quatre lignes chiffrées (A, B, écart), la pastille de verdict de
// B quand il est affirmé ; un clic ouvre la comparaison entière ci-dessous, avec ses
// effectifs, sa règle de choix, sa source et sa phrase de fenêtre.
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { FicheMesure } from "@/components/charts/FicheMesure";
import { InfoTip } from "@/components/InfoTip";
import { TableDefilante } from "@/components/TableDefilante";
import { DessinVignette, EnteteVignette } from "@/components/vue-ensemble/Vignette";
import { formater, type FormatId, type VitalName } from "@/lib/fmt-ids";
import type { ComparaisonStandardisee, LigneStandardisee, VersionRow, VersionSource } from "@/lib/queries-deploys";
import { relativeChange } from "@/lib/query-contract";
import { FORME_RATING, RATING_CLASS, RATING_LABEL } from "@/lib/rating";
import type { IntervalleP75 } from "@mip/stats/incertitude";
import { COUVERTURE_MIN, EFFECTIF_MIN_RELEASE, EFFECTIF_MIN_STRATE } from "@mip/stats/standardisation";
import type { Intervalle } from "@mip/stats/types";
import { fmtInstant } from "@/lib/format";
import { lireVital, texteVerdict } from "@/lib/vital-lecture";

export type { Intervalle };

export interface ReleaseStats {
  release: string;
  sessions: number | null;
  lcp_p75: number | null;
  inp_p75: number | null;
  /** Absent : la lecture ne porte pas le CLS (ligne « non lue par cette comparaison »). */
  cls_p75?: number | null;
  /** Taux = sessionsEnErreur / sessions ; `null` si `sessions` est nul ou inconnu. */
  sessionsEnErreur: number | null;
  /** ISO. */
  premiereVue?: string | null;
  /**
   * Intervalles à 95 % des p75 de la release (P*.1), lus comme ceux des tuiles.
   * Fournis, le verdict n'est affirmé que s'il tient sur tout l'intervalle ; un
   * vital fourni sans intervalle n'a pas de verdict. Absents (appelant qui ne les
   * lit pas), le verdict suit la seule p75, comme une tuile sans intervalle.
   */
  intervalles?: Partial<Record<VitalName, IntervalleP75>>;
}

export interface VerdictRelease {
  etat: "degradation" | "amelioration" | "non_etabli" | "insuffisant";
  mesure: string;
  difference: Intervalle | null;
  ecartDetectable: number | null;
  p: number | null;
  raison?: string;
}

/** Une ligne de `comparaisonVersions` → statistiques d'une release (mapping du § 5.1.2). */
export function statsDeVersion(row: VersionRow): ReleaseStats {
  return {
    release: row.version,
    sessions: row.sessions,
    lcp_p75: row.lcp,
    inp_p75: row.inp,
    sessionsEnErreur: row.sessionsEnErreur,
  };
}

/** Part de sessions en erreur ; sans dénominateur, `null` (jamais 0 %). */
export function tauxSessionsEnErreur(s: ReleaseStats): number | null {
  if (s.sessions == null || s.sessions <= 0 || s.sessionsEnErreur == null) return null;
  return s.sessionsEnErreur / s.sessions;
}

// Les valeurs BRUTES (et les règles d'alerte de release, qui la citent) : vraie de tout
// écart lu sans pondération.
export const PHRASE_FENETRE = "même fenêtre, sans normalisation de trafic : l'écart mêle le code et le contexte";
export const SANS_SESSION = "aucune session de cette release sur la fenêtre";
export const CLS_NON_LU = "non lue par cette comparaison";

/** Libellé des lignes standardisées : un mix de trafic égalisé, pas une cause établie. */
export const LIBELLE_MIX = "à mix égal";
export const PHRASE_MIX =
  "chaque strate route × appareil (route d'entrée × appareil pour les erreurs) pèse dans A et dans B ce qu'elle pèse dans les deux réunies ; l'écart restant ne tient plus au mix de routes et d'appareils, l'heure, le réseau et le public restent mêlés";

/** Les mesures que la standardisation lit, par clé de ligne. */
const CLES_MIX = { lcp: "lcp", inp: "inp", erreurs: "erreurs" } as const;
const UNITE_MIX: Record<keyof typeof CLES_MIX, string> = { lcp: "mesures", inp: "mesures", erreurs: "sessions" };

/** Ce que la case et la fenêtre reçoivent : la lecture, ou son échec. Absente : non lue, rien n'est dit. */
export type Standardise = ComparaisonStandardisee | "echec";

/** La ligne standardisée d'une mesure ; `null` si la mesure n'en a pas (sessions, CLS). */
export function ligneMix(s: Standardise | undefined, cle: string): LigneStandardisee | null {
  if (!s || !(cle in CLES_MIX)) return null;
  if (s === "echec") return { ok: false, raison: "lecture en échec" };
  if (!s.disponible) return { ok: false, raison: s.raison };
  return s[CLES_MIX[cle as keyof typeof CLES_MIX]];
}

/** Un problème qui tait TOUTES les lignes (lecture en échec, schéma) : dit une fois. */
function silenceGlobal(s: Standardise | undefined): string | null {
  if (!s) return null;
  if (s === "echec") return "lecture en échec";
  return s.disponible ? null : s.raison;
}

const pctEntier = (x: number) => `${Math.round(x * 100)}${String.fromCharCode(0xa0)}%`;

/** « 87 % des sessions » : la couverture que la case affiche, ou null. */
export function couvertureSessions(s: Standardise | undefined): string | null {
  if (!s || s === "echec" || !s.disponible || !s.couvertureSessions) return null;
  return `${pctEntier(s.couvertureSessions.ensemble)} des sessions`;
}

/** La méthode, rangée dans la bulle : ce qui est pondéré, comment, et sous quels seuils. */
function MethodeMix() {
  return (
    <>
      <span className="block">
        Standardisation directe. Référence : A et B réunies, sur les strates communes. Poids d&apos;une unité de la
        release r dans la strate s = part de s dans la référence ÷ part de s dans r.
      </span>
      <span className="mt-1 block">
        LCP et INP : une mesure par unité, strates route × appareil ; p75 pondéré = plus petite valeur dont la somme
        cumulée des poids atteint 75 % du total. Sessions en erreur : une session par unité, strates route d&apos;entrée
        (première page vue sous la release) × appareil ; part pondérée.
      </span>
      <span className="mt-1 block">
        Strate commune : {EFFECTIF_MIN_STRATE} unités au moins de chaque côté. Couverture : part des unités de chaque
        release dans les strates communes. La ligne se tait sous {EFFECTIF_MIN_RELEASE} unités ou{" "}
        {Math.round(COUVERTURE_MIN * 100)} % de couverture par release.
      </span>
    </>
  );
}

const SOURCE: Record<VersionSource, string> = {
  occurrence: "release lue sur chaque mesure (vue, métrique, erreur)",
  session: "release de la session (colonnes par mesure absentes sur ce déploiement)",
};

const VERDICT: Record<VerdictRelease["etat"], string> = {
  degradation: "Dégradation établie",
  amelioration: "Amélioration établie",
  non_etabli: "Écart non établi",
  insuffisant: "Données insuffisantes",
};

const NBSP = String.fromCharCode(0xa0);

/**
 * Écart de B à A, écrit avec son signe ; incalculable → « — ». Un taux (format
 * `pct`) s'écarte en POINTS : 43,5 % → 63,6 % fait « +20,1 pts », pas « +46,4 % ».
 * Toute autre mesure, en écart relatif.
 */
export function ecrireEcart(a: number | null, b: number | null, format: FormatId = "count"): string {
  if (format === "pct") {
    if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return "—";
    const pts = Math.round((b - a) * 1000) / 10;
    if (pts === 0) return `±0${NBSP}pt`;
    return `${pts > 0 ? "+" : "−"}${Math.abs(pts).toLocaleString("fr-FR")}${NBSP}${Math.abs(pts) < 2 ? "pt" : "pts"}`;
  }
  const e = relativeChange(b, a);
  if (e == null) return "—";
  const pct = Math.round(e * 1000) / 10;
  if (pct === 0) return `±0${NBSP}%`;
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct).toLocaleString("fr-FR")}${NBSP}%`;
}

interface Mesure {
  cle: string;
  libelle: string;
  format: FormatId;
  vital?: VitalName;
  lire: (s: ReleaseStats) => number | null | undefined;
  /** Effectif écrit sous la valeur. */
  effectif: (s: ReleaseStats) => string;
}

const sessionsDe = (s: ReleaseStats) => (s.sessions == null ? "sessions inconnues" : `sur ${formater("count", s.sessions)} sessions`);

const MESURES: Mesure[] = [
  { cle: "sessions", libelle: "Sessions", format: "count", lire: (s) => s.sessions, effectif: () => "ayant vu une page sous cette release" },
  { cle: "lcp", libelle: "LCP p75", format: "ms", vital: "LCP", lire: (s) => s.lcp_p75, effectif: sessionsDe },
  { cle: "inp", libelle: "INP p75", format: "ms", vital: "INP", lire: (s) => s.inp_p75, effectif: sessionsDe },
  { cle: "cls", libelle: "CLS p75", format: "cls", vital: "CLS", lire: (s) => s.cls_p75, effectif: sessionsDe },
  {
    cle: "erreurs",
    libelle: "Sessions en erreur",
    format: "pct",
    lire: tauxSessionsEnErreur,
    effectif: (s) =>
      s.sessionsEnErreur == null || s.sessions == null
        ? "effectif inconnu"
        : `${formater("count", s.sessionsEnErreur)} sur ${formater("count", s.sessions)} sessions`,
  },
];

/**
 * Le verdict d'une p75 de release, par la règle de la tuile (`lireVital`) : avec
 * les intervalles lus, un vital sans le sien n'est pas jugé (« non calculable »).
 */
export function verdictRelease(vital: VitalName, v: number, stats: ReleaseStats) {
  const intervalle = stats.intervalles
    ? (stats.intervalles[vital] ?? { indisponible: "intervalle non lu" })
    : undefined;
  return lireVital(vital, v, stats.sessions ?? 0, intervalle).verdict;
}

function Valeur({ mesure, stats }: { mesure: Mesure; stats: ReleaseStats }) {
  const v = mesure.lire(stats) ?? null;
  const verdict = mesure.vital && v != null ? verdictRelease(mesure.vital, v, stats) : null;
  return (
    <div className="min-w-0">
      <span className="font-semibold tabular-nums text-ink">{formater(mesure.format, v)}</span>
      {verdict?.kind === "etabli" && (
        <span
          className={`ml-1.5 rounded border px-1 py-px text-[11px] font-medium ${RATING_CLASS[verdict.rating]}`}
          data-testid="release-verdict-vital"
        >
          {RATING_LABEL[verdict.rating]}
        </span>
      )}
      {verdict && verdict.kind !== "etabli" && (
        // Comme la tuile : un verdict qui ne tient pas sur tout l'intervalle n'a pas de couleur.
        <span className="block text-[11px] text-ink-soft" data-testid="release-verdict-vital">
          {texteVerdict(verdict)}
        </span>
      )}
      <span className="block text-[11px] text-ink-soft">{mesure.effectif(stats)}</span>
    </div>
  );
}

function EnTete({ role, stats, href }: { role: "A" | "B"; stats: ReleaseStats; href: string }) {
  return (
    <div className="min-w-0">
      <span className="block text-[11px] font-medium uppercase tracking-wider text-ink-soft">
        {role === "A" ? "Référence (A)" : "Candidate (B)"}
      </span>
      <Link href={href} className="block truncate font-semibold text-perf underline-offset-2 hover:underline" title={stats.release}>
        {stats.release}
      </Link>
      {stats.premiereVue && (
        <span className="block text-[11px] text-ink-soft">
          vue depuis le {fmtInstant(stats.premiereVue, { annee: true })}
        </span>
      )}
    </div>
  );
}

/**
 * La ligne « à mix égal » sous une mesure : A et B standardisés, la couverture de
 * chacune, l'écart et les strates communes — ou, sous un seuil, la raison en une ligne.
 * Aucune couleur : le verdict des seuils web.dev porte sur la p75 brute et son intervalle.
 */
function LigneMix({ mesure, ligne }: { mesure: Mesure; ligne: LigneStandardisee }) {
  const unite = UNITE_MIX[mesure.cle as keyof typeof UNITE_MIX] ?? "unités";
  return (
    <tr className="border-b border-line/60 align-top" data-testid={`release-mix-${mesure.cle}`}>
      <th scope="row" className="py-1.5 pr-3 pl-2 text-left text-[11px] font-normal text-ink-soft">
        <span className="sr-only">{mesure.libelle}, </span>
        <span aria-hidden="true">↳ </span>
        {LIBELLE_MIX}
      </th>
      {ligne.ok ? (
        <>
          {(["a", "b"] as const).map((cote) => (
            <td key={cote} className="py-1.5 pr-3">
              <span className="font-semibold tabular-nums text-ink">{formater(mesure.format, ligne[cote])}</span>
              <span className="block text-[11px] text-ink-soft">
                couv. {pctEntier(ligne.couverture[cote])} des {unite}
              </span>
            </td>
          ))}
          <td className="py-1.5 text-right tabular-nums text-ink-soft">
            {ecrireEcart(ligne.a, ligne.b, mesure.format)}
            <span className="block text-[11px]">
              {ligne.strates.communes}/{ligne.strates.total} strates
            </span>
          </td>
        </>
      ) : (
        <td colSpan={3} className="py-1.5 text-[11px] text-ink-soft" data-testid="release-mix-raison">
          non calculée : {ligne.raison}
        </td>
      )}
    </tr>
  );
}

/** Teinte de la pastille d'un verdict affirmé : le jeton de TEXTE (4,5:1), qui suit le mode sombre. */
const TEINTE_PASTILLE = { good: "text-good-ink", "needs-improvement": "text-warn-ink", poor: "text-bad-ink" } as const;

/** Libellés courts de la case : la colonne est étroite, la fenêtre écrit les longs. */
const COURT: Record<string, string> = { sessions: "Sessions", lcp: "LCP", inp: "INP", cls: "CLS", erreurs: "En erreur" };

/**
 * La case de la Vue d'ensemble : A, B et l'écart, une ligne par mesure lue ; une
 * release sans session l'écrit « — » (la fenêtre dit pourquoi). Le verdict de B n'est
 * posé qu'affirmé sur tout l'intervalle — une pastille de forme et de couleur, le mot
 * pour l'écran vocal ; sinon aucune couleur.
 *
 * À MIX ÉGAL (nuit du 01/10/2026) : une colonne de plus, l'écart B / A des mêmes mesures
 * à mix de trafic égal (« — » quand la ligne se tait), et sous la grille la couverture
 * en % des sessions, ou la raison du silence. Les valeurs standardisées sont dans la
 * fenêtre.
 */
export function VignetteRelease(props: Parameters<typeof ReleaseCompare>[0]) {
  const { a, b, plage, standardise } = props;
  const vide = (s: ReleaseStats) => s.sessions == null || s.sessions === 0;
  const clsLu = a.cls_p75 !== undefined && b.cls_p75 !== undefined;
  const lignes = MESURES.filter((m) => m.cle !== "cls" || clsLu);
  const valeur = (m: Mesure, s: ReleaseStats) => (vide(s) && m.cle !== "sessions" ? "—" : formater(m.format, m.lire(s) ?? null));
  const verdictB = (m: Mesure) => {
    const vb = m.lire(b) ?? null;
    return m.vital && vb != null && !vide(b) ? verdictRelease(m.vital, vb, b) : null;
  };
  // La colonne « à mix égal » : l'écart standardisé, « — » pour une ligne qui se tait,
  // rien pour une mesure que la standardisation ne lit pas (sessions, CLS).
  const ecartMix = (m: Mesure): string | null => {
    const l = ligneMix(standardise, m.cle);
    return l === null ? null : l.ok ? ecrireEcart(l.a, l.b, m.format) : "—";
  };
  const couverture = couvertureSessions(standardise);
  const silence = silenceGlobal(standardise);
  const toutesTues = lignes.every((m) => {
    const l = ligneMix(standardise, m.cle);
    return l === null || !l.ok;
  });
  const premiereRaison = lignes.map((m) => ligneMix(standardise, m.cle)).find((l) => l && !l.ok);
  const piedMix = !standardise
    ? null
    : silence
      ? `${LIBELLE_MIX} : ${silence}`
      : toutesTues && premiereRaison && !premiereRaison.ok
        ? `${LIBELLE_MIX} : ${premiereRaison.raison}`
        : couverture
          ? `${LIBELLE_MIX} : couverture ${couverture}`
          : null;
  const ariaMix = standardise
    ? `, ${LIBELLE_MIX} : ${lignes
        .flatMap((m) => {
          const e = ecartMix(m);
          return e === null ? [] : [`${m.libelle} ${e}`];
        })
        .join(", ")}${piedMix ? ` (${piedMix})` : ""}`
    : "";
  return (
    <FicheMesure
      titre={`Release ${b.release} face à ${a.release}`}
      ariaLabel={`Release ${b.release} face à ${a.release}, ${plage} : ${lignes
        .map((m) => {
          const v = verdictB(m);
          return `${m.libelle} ${valeur(m, a)} puis ${valeur(m, b)}${v ? ` (${texteVerdict(v)})` : ""}`;
        })
        .join(", ")}${ariaMix} — ouvrir la comparaison`}
      testId="vignette-release"
      case={
        <>
          <EnteteVignette titre={`Release ${b.release} vs ${a.release}`} meta={plage} />
          <DessinVignette>
            <span
              className={`grid min-w-0 ${standardise ? "grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] gap-x-1.5" : "grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-2"} items-baseline gap-y-0.5 text-[11px] tabular-nums`}
            >
              <span />
              <span className="truncate text-right text-[10px] text-ink-faint" title={a.release}>
                A
              </span>
              <span className="truncate text-right text-[10px] text-ink-faint" title={b.release}>
                B
              </span>
              <span className="text-right text-[10px] text-ink-faint">B / A</span>
              {standardise && (
                <span className="text-right text-[10px] text-ink-faint" data-testid="vignette-release-mix">
                  {LIBELLE_MIX}
                </span>
              )}
              {lignes.map((m) => {
                const vb = m.lire(b) ?? null;
                const verdict = verdictB(m);
                return (
                  <span key={m.cle} className="contents">
                    <span className="truncate text-ink-soft" title={m.libelle}>
                      {COURT[m.cle] ?? m.libelle}
                    </span>
                    <span className="text-right text-ink-soft">{valeur(m, a)}</span>
                    <span className="flex items-baseline justify-end gap-1 font-semibold text-ink">
                      {verdict?.kind === "etabli" && (
                        <i aria-hidden="true" className={`text-[8px] not-italic ${TEINTE_PASTILLE[verdict.rating]}`}>
                          {FORME_RATING[verdict.rating]}
                        </i>
                      )}
                      {valeur(m, b)}
                    </span>
                    <span className="text-right text-ink">{ecrireEcart(m.lire(a) ?? null, vb, m.format)}</span>
                    {standardise && <span className="text-right text-ink">{ecartMix(m) ?? ""}</span>}
                  </span>
                );
              })}
            </span>
            {piedMix && (
              <span className="mt-0.5 block truncate text-[10px] text-ink-faint" data-testid="vignette-release-couverture">
                {piedMix}
              </span>
            )}
          </DessinVignette>
        </>
      }
    >
      <div className="mt-3">
        <ReleaseCompare {...props} />
      </div>
    </FicheMesure>
  );
}

export function ReleaseCompare({
  a,
  b,
  plage,
  source,
  regleChoix,
  hrefs,
  verdict,
  toutesLesVersions,
  standardise,
}: {
  a: ReleaseStats;
  b: ReleaseStats;
  plage: string;
  source: VersionSource;
  regleChoix: string;
  hrefs: { a: string; b: string };
  verdict?: VerdictRelease;
  /** Contenu de « Toutes les versions » (`VersionsTable`), replié sous la comparaison. */
  toutesLesVersions?: ReactNode;
  /** Les mêmes mesures à mix de trafic égal (`comparaisonStandardisee`) ; absent : non lues, rien n'est dit. */
  standardise?: Standardise;
}) {
  const vide = (s: ReleaseStats) => s.sessions == null || s.sessions === 0;
  const clsLu = a.cls_p75 !== undefined && b.cls_p75 !== undefined;
  const silence = silenceGlobal(standardise);

  return (
    <div className="card min-w-0 p-4" data-testid="release-compare">
      <p className="text-xs text-ink-soft" data-testid="release-regle">
        Choix des releases : {regleChoix}
      </p>
      <p className="mt-0.5 text-xs text-ink-soft">
        {plage} · {SOURCE[source]}
      </p>

      {verdict && (
        <p className="mt-2 text-sm text-ink" role="note" data-testid="release-verdict">
          <span className="font-semibold">{VERDICT[verdict.etat]}</span> ({verdict.mesure})
          {verdict.raison ? ` : ${verdict.raison}` : ""}
        </p>
      )}

      {/* Défilement signalé sous 20 rem ; la zone est `relative`, la légende
          `sr-only` (position absolue) ne peut plus élargir la page. */}
      <TableDefilante className="mt-3" label="Comparaison des deux releases">
        <table className="w-full min-w-[20rem] text-sm">
          <caption className="sr-only">
            Release {b.release} comparée à {a.release}, {plage}
          </caption>
          <thead>
            <tr className="border-b border-line align-bottom">
              <th scope="col" className="py-2 pr-3 text-left text-xs font-medium text-ink-soft">
                Mesure
              </th>
              <th scope="col" className="py-2 pr-3 text-left font-normal">
                <EnTete role="A" stats={a} href={hrefs.a} />
              </th>
              <th scope="col" className="py-2 pr-3 text-left font-normal">
                <EnTete role="B" stats={b} href={hrefs.b} />
              </th>
              <th scope="col" className="py-2 text-right text-xs font-medium text-ink-soft">
                Écart B / A
              </th>
            </tr>
          </thead>
          <tbody>
            {MESURES.map((mesure) => {
              if (mesure.cle === "cls" && !clsLu) {
                return (
                  <tr key={mesure.cle} className="border-b border-line/60" data-testid="release-cls">
                    <th scope="row" className="py-2 pr-3 text-left text-xs font-medium text-ink-soft">
                      {mesure.libelle}
                    </th>
                    <td colSpan={3} className="py-2 text-xs text-ink-soft">
                      {CLS_NON_LU}
                    </td>
                  </tr>
                );
              }
              const va = mesure.lire(a) ?? null;
              const vb = mesure.lire(b) ?? null;
              // Un problème commun (échec, schéma) est dit UNE fois sous le tableau.
              const mix = silence ? null : ligneMix(standardise, mesure.cle);
              return (
                <Fragment key={mesure.cle}>
                  <tr className="border-b border-line/60 align-top">
                    <th scope="row" className="py-2 pr-3 text-left text-xs font-medium text-ink-soft">
                      {mesure.libelle}
                    </th>
                    {[a, b].map((s) => (
                      <td key={s === a ? "a" : "b"} className="py-2 pr-3">
                        {vide(s) && mesure.cle !== "sessions" ? (
                          <span className="text-xs text-ink-soft">{SANS_SESSION}</span>
                        ) : (
                          <Valeur mesure={mesure} stats={s} />
                        )}
                      </td>
                    ))}
                    <td className="py-2 text-right tabular-nums text-ink-soft">{ecrireEcart(va, vb, mesure.format)}</td>
                  </tr>
                  {mix && <LigneMix mesure={mesure} ligne={mix} />}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </TableDefilante>

      <p className="mt-3 text-xs text-ink-soft" role="note" data-testid="release-phrase">
        {standardise ? (
          <>
            Valeurs brutes : {PHRASE_FENETRE}. Lignes « {LIBELLE_MIX} » : {PHRASE_MIX}.{" "}
            <InfoTip label="Méthode : à mix de trafic égal" align="start">
              <MethodeMix />
            </InfoTip>
          </>
        ) : (
          <>Comparaison sur la {PHRASE_FENETRE}.</>
        )}
      </p>
      {silence && (
        <p className="mt-1 text-xs text-ink-soft" data-testid="release-mix-silence">
          Lignes « {LIBELLE_MIX} » non calculées : {silence}.
        </p>
      )}

      {toutesLesVersions && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-perf">Toutes les versions</summary>
          <div className="mt-2 min-w-0">{toutesLesVersions}</div>
        </details>
      )}
    </div>
  );
}
