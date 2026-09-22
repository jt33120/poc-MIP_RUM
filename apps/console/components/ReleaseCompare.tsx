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
import Link from "next/link";
import type { ReactNode } from "react";
import { formater, type FormatId, type VitalName } from "@/lib/fmt-ids";
import type { VersionRow, VersionSource } from "@/lib/queries-deploys";
import { relativeChange } from "@/lib/query-contract";
import { RATING_CLASS, RATING_LABEL, rating2026 } from "@/lib/rating";
import type { Intervalle } from "@/lib/stats/types";

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

/** Écart relatif de B à A, écrit avec son signe ; incalculable → « — ». */
function ecrireEcart(a: number | null, b: number | null): string {
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

function Valeur({ mesure, stats }: { mesure: Mesure; stats: ReleaseStats }) {
  const v = mesure.lire(stats) ?? null;
  const verdict = mesure.vital && v != null ? rating2026(mesure.vital, v) : null;
  return (
    <div className="min-w-0">
      <span className="font-semibold tabular-nums text-ink">{formater(mesure.format, v)}</span>
      {verdict && (
        <span className={`ml-1.5 rounded border px-1 py-px text-[11px] font-medium ${RATING_CLASS[verdict]}`}>
          {RATING_LABEL[verdict]}
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
          vue depuis le {new Date(stats.premiereVue).toISOString().slice(0, 16).replace("T", " ")} UTC
        </span>
      )}
    </div>
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

      <div className="mt-3 overflow-x-auto">
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
                  <td className="py-2 text-right tabular-nums text-ink-soft">{ecrireEcart(va, vb)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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
