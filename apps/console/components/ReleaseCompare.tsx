// Nouvelle release face à la précédente (F08, plan § 4.2, § 3.2) — SSR.
//
// Deux colonnes (A = référence, B = candidate), une ligne par mesure, l'écart
// relatif de B à A. Ce que la comparaison NE dit PAS est écrit aussi fort que ce
// qu'elle dit :
//
//   - même fenêtre, sans normalisation de trafic : deux releases vivent sur la même
//     plage mais pas sur les mêmes heures ni les mêmes visiteurs ; l'écart mêle le
//     code et le contexte (phrase obligatoire, toujours rendue) ;
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
import type { ReactNode } from "react";
import { FicheMesure } from "@/components/charts/FicheMesure";
import { TableDefilante } from "@/components/TableDefilante";
import { DessinVignette, EnteteVignette } from "@/components/vue-ensemble/Vignette";
import { formater, type FormatId, type VitalName } from "@/lib/fmt-ids";
import type { VersionRow, VersionSource } from "@/lib/queries-deploys";
import { relativeChange } from "@/lib/query-contract";
import { FORME_RATING, RATING_CLASS, RATING_LABEL } from "@/lib/rating";
import type { IntervalleP75 } from "@mip/stats/incertitude";
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

export const PHRASE_FENETRE = "même fenêtre, sans normalisation de trafic : l'écart mêle le code et le contexte";
export const SANS_SESSION = "aucune session de cette release sur la fenêtre";
export const CLS_NON_LU = "non lue par cette comparaison";

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

/** Teinte de la pastille d'un verdict affirmé (jeton de remplissage, suit le mode sombre). */
const TEINTE_PASTILLE = { good: "text-good", "needs-improvement": "text-warn", poor: "text-bad" } as const;

/**
 * La case de la Vue d'ensemble : A, B et l'écart, une ligne par mesure lue ; une
 * release sans session l'écrit « — » (la fenêtre dit pourquoi). Le verdict de B n'est
 * posé qu'affirmé sur tout l'intervalle — une pastille de forme et de couleur, le mot
 * pour l'écran vocal ; sinon aucune couleur.
 */
export function VignetteRelease(props: Parameters<typeof ReleaseCompare>[0]) {
  const { a, b, plage } = props;
  const vide = (s: ReleaseStats) => s.sessions == null || s.sessions === 0;
  const clsLu = a.cls_p75 !== undefined && b.cls_p75 !== undefined;
  const lignes = MESURES.filter((m) => m.cle !== "cls" || clsLu);
  const valeur = (m: Mesure, s: ReleaseStats) => (vide(s) && m.cle !== "sessions" ? "—" : formater(m.format, m.lire(s) ?? null));
  return (
    <FicheMesure
      titre={`Release ${b.release} face à ${a.release}`}
      ariaLabel={`Release ${b.release} face à ${a.release}, ${plage} : ${lignes
        .map((m) => `${m.libelle} ${valeur(m, a)} puis ${valeur(m, b)}`)
        .join(", ")} — ouvrir la comparaison`}
      testId="vignette-release"
      case={
        <>
          <EnteteVignette titre={`Release ${b.release} vs ${a.release}`} meta={plage} />
          <DessinVignette>
            <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto_auto] items-baseline gap-x-2 gap-y-0.5 text-[11px] tabular-nums">
              <span />
              <span className="truncate text-right text-[10px] text-ink-faint" title={a.release}>
                A
              </span>
              <span className="truncate text-right text-[10px] text-ink-faint" title={b.release}>
                B
              </span>
              <span className="text-right text-[10px] text-ink-faint">B / A</span>
              {lignes.map((m) => {
                const vb = m.lire(b) ?? null;
                const verdict = m.vital && vb != null && !vide(b) ? verdictRelease(m.vital, vb, b) : null;
                return (
                  <span key={m.cle} className="contents">
                    <span className="truncate text-ink-soft">{m.libelle}</span>
                    <span className="text-right text-ink-soft">{valeur(m, a)}</span>
                    <span className="flex items-baseline justify-end gap-1 font-semibold text-ink">
                      {verdict?.kind === "etabli" && (
                        <i className={`text-[8px] not-italic ${TEINTE_PASTILLE[verdict.rating]}`}>{FORME_RATING[verdict.rating]}</i>
                      )}
                      {valeur(m, b)}
                    </span>
                    <span className="text-right text-ink">{ecrireEcart(m.lire(a) ?? null, vb, m.format)}</span>
                  </span>
                );
              })}
            </span>
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
}) {
  const vide = (s: ReleaseStats) => s.sessions == null || s.sessions === 0;
  const clsLu = a.cls_p75 !== undefined && b.cls_p75 !== undefined;

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
              return (
                <tr key={mesure.cle} className="border-b border-line/60 align-top">
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
              );
            })}
          </tbody>
        </table>
      </TableDefilante>

      <p className="mt-3 text-xs text-ink-soft" role="note" data-testid="release-phrase">
        Comparaison sur la {PHRASE_FENETRE}.
      </p>

      {toutesLesVersions && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-perf">Toutes les versions</summary>
          <div className="mt-2 min-w-0">{toutesLesVersions}</div>
        </details>
      )}
    </div>
  );
}
