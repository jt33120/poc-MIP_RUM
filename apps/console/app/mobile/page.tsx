// `/mobile` — ce que la couche JavaScript React Native observe, et ce qu'elle
// n'observe pas (P7.5).
//
// LA RÈGLE DE CET ÉCRAN TIENT EN UNE PHRASE : une capacité non collectée
// s'affiche « Non collecté », jamais 0. Un tableau de bord qui annonce
// « 0 crash » à une application dont rien ne mesure les crashes ne se trompe pas
// d'un peu : il dit exactement le contraire de la vérité, et il le dit avec
// l'autorité d'un chiffre. Crashes natifs, ANR et démarrage natif sont dans ce
// cas pour toutes les applications, sans exception, tant que P8.5 n'a pas livré
// de module natif.
//
// LE LIBELLÉ NE DIT PAS « CRASH-FREE ». Le taux affiché porte sur les erreurs
// JAVASCRIPT : une erreur non interceptée arrête le bundle et affiche la redbox,
// elle ne tue pas le processus natif. Les deux populations sont disjointes.
import Link from "next/link";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { PageHeader } from "@/components/PageHeader";
import { RankBar } from "@/components/charts/RankBar";
import { INPUT_CLASS } from "@/components/forms/Field";
import { fmtDate, fmtLatency, fmtPct } from "@/lib/format";
import { type SearchParams } from "@/lib/filters";
import { pageFilters } from "@/lib/page-filters";
import {
  ERROR_FREE_REASONS,
  PLATFORMS,
  PLATFORM_LABELS,
  PLATFORM_OS,
  STATE_LABELS,
  parsePlatform,
  sessionsCohorte,
  type CapabilityStatus,
} from "@/lib/mobile-capabilities";
import { mobileSummary } from "@/lib/queries-mobile";
import { hrefWithQuery, intersectQuery, queryToSearchParams } from "@/lib/query-contract";
import { filtersOfQuery } from "@/lib/filters";

export const dynamic = "force-dynamic";

const NOMBRE = (n: number) => n.toLocaleString("fr-FR");
/** « Inconnu » et non « 0 » : une population qu'on ne sait pas compter n'est pas vide. */
const INCONNU = (n: number | null) => (n == null ? "Inconnu" : NOMBRE(n));

const BADGE: Record<CapabilityStatus["state"], string> = {
  active: "border-good/40 bg-good/10 text-good",
  unavailable: "border-warn/40 bg-warn/10 text-warn",
  unknown: "border-line bg-panel2 text-ink-faint",
};

export default async function MobilePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ecran = await pageFilters(sp, "/mobile");
  if (!ecran.ok) return <FilterProblemNotice title="Mobile" problem={ecran.problem} />;

  const platform = parsePlatform(typeof sp?.platform === "string" ? sp.platform : null);
  // INTERSECTION avec le contrat, jamais remplacement : un `os=` déjà présent
  // dans l'URL reste appliqué, et la combinaison contradictoire rend zéro ligne
  // — la réponse exacte, plutôt qu'un filtre écrasé par l'autre.
  const query = platform
    ? intersectQuery(ecran.query, {
        conditions: [{ dimension: "os", operator: "eq", value: PLATFORM_OS[platform] }],
      })
    : ecran.query;

  const data = await mobileSummary(filtersOfQuery(query));
  const { sessions, js_errors: erreurs, startup } = data;
  const jsErrors = data.capabilities.find((c) => c.capability === "js_errors");
  const contexte = queryToSearchParams(ecran.query);
  // CE7 : `/errors/issues` n'a pas de page (seul `/errors/issues/[id]` existe) ;
  // la liste des erreurs lit `source` elle-même (`parseIssueSource`).
  const lienErreurs = hrefWithQuery("/errors", ecran.query, { source: "react_native_js" });
  // CE9 : sans v82, la lecture rend 0 session — l'écran dit « — » et pourquoi.
  const sessionsLues = sessionsCohorte(data);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Mobile"
        sub={`Ce que la couche JavaScript React Native observe sur ${ecran.label} — et ce qu'elle n'observe pas.`}
      />

      {data.unavailable.map((raison) => (
        <p key={raison} role="status" data-testid="mobile-partiel" className="mb-4 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink-soft">
          Réponse partielle : {raison}.
        </p>
      ))}
      {data.sampling.message && (
        <p role="note" className="mb-4 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink-soft">
          {data.sampling.message}
        </p>
      )}

      <form method="get" className="card mb-6 flex flex-wrap items-end gap-3 p-4" aria-label="Filtres de l’écran mobile">
        {/* Le contexte global suit : app, plage, appareil, release, segment. */}
        {[...contexte].map(([nom, valeur]) => (
          <input key={nom} type="hidden" name={nom} value={valeur} />
        ))}
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          Plateforme
          <select name="platform" defaultValue={platform ?? ""} className={INPUT_CLASS}>
            <option value="">Toutes</option>
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>
            ))}
          </select>
        </label>
        <button className="btn-accent" type="submit">Appliquer</button>
        <Link href={hrefWithQuery("/mobile", ecran.query, { platform: null })} className="btn-ghost">
          Réinitialiser
        </Link>
      </form>

      {/* ── Cartes : populations observées, jamais additionnées ── */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Sessions observées</div>
          <div data-testid="mobile-sessions" className="mt-1 text-3xl font-bold tabular-nums text-ink">
            {sessionsLues.valeur == null ? "—" : NOMBRE(sessionsLues.valeur)}
          </div>
          <p className="mt-1 text-xs text-ink-faint">
            {sessionsLues.raison ?? "Sessions React Native commencées dans la fenêtre."}
          </p>
        </div>
        <div className="card p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Visiteurs observés</div>
          <div data-testid="mobile-visiteurs" className="mt-1 text-3xl font-bold tabular-nums text-ink">
            {INCONNU(sessions.visitors)}
          </div>
          <p className="mt-1 text-xs text-ink-faint">
            {sessions.sessions_without_visitor > 0
              ? `${NOMBRE(sessions.sessions_without_visitor)} session(s) sans identifiant d’installation : non rattachables.`
              : "Installations distinctes. Ni sessions, ni identités déclarées — ces populations ne s’additionnent pas."}
          </p>
        </div>
        <div className="card p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Erreurs JavaScript</div>
          <div data-testid="mobile-erreurs" className="mt-1 text-3xl font-bold tabular-nums text-ink">
            {erreurs ? NOMBRE(erreurs.occurrences) : "Inconnu"}
          </div>
          <p className="mt-1 text-xs text-ink-faint">
            {erreurs
              ? `${NOMBRE(erreurs.crashes)} non interceptée(s), ${NOMBRE(erreurs.unhandled_rejections)} rejet(s) de promesse · fatales : ${INCONNU(erreurs.fatal)}`
              : "Source d’erreur non lisible sur ce schéma."}
          </p>
        </div>
        <div className="card p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
            Sessions sans erreur JS
          </div>
          <div data-testid="mobile-taux-sans-erreur" className="mt-1 text-3xl font-bold tabular-nums text-ink">
            {data.js_error_free_session_rate == null ? "Non calculable" : fmtPct(data.js_error_free_session_rate)}
          </div>
          <p className="mt-1 text-xs text-ink-faint">
            {data.js_error_free_unavailable_reason
              ? ERROR_FREE_REASONS[data.js_error_free_unavailable_reason]
              : "Erreurs JavaScript seulement. Ce n’est pas un taux « sans crash » : les crashes natifs ne sont pas collectés."}
          </p>
        </div>
      </div>

      {/* ── Capacités : la seule carte qui a le droit de dire « rien » ── */}
      <section className="card mb-6 overflow-x-auto p-4" aria-labelledby="mobile-capacites">
        <h2 id="mobile-capacites" className="text-sm font-semibold text-ink">Ce qui est collecté, et ce qui ne l’est pas</h2>
        <p className="mt-1 text-xs text-ink-faint">
          Déclaré par le SDK, par application, runtime et release. Une capacité activée n’est pas un test natif
          passé : seule une recette d’opérateur renseigne la colonne « Vérifié ».
        </p>
        <table className="mt-3 w-full min-w-table text-sm">
          <caption className="sr-only">Capacités de collecte déclarées par le runtime mobile</caption>
          <thead className="bg-panel2">
            <tr>
              <th scope="col" className="th">Capacité</th>
              <th scope="col" className="th">État</th>
              <th scope="col" className="th">Releases déclarantes</th>
              <th scope="col" className="th">Vérifié (recette)</th>
            </tr>
          </thead>
          <tbody>
            {data.capabilities.map((c) => (
              <tr key={c.capability} data-testid={`capacite-${c.capability}`} className="border-t border-line/60 align-top">
                <td className="px-4 py-3">
                  <div className="font-medium text-ink">{c.label}</div>
                  <div className="mt-1 max-w-md text-xs text-ink-faint">{c.note}</div>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${BADGE[c.state]}`}>
                    {STATE_LABELS[c.state]}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-ink-soft">
                  {c.declared_by.length
                    ? c.declared_by.map((r) => r ?? "release inconnue").join(", ")
                    : "—"}
                </td>
                <td className="px-4 py-3 text-xs text-ink-soft">
                  {c.verified_at ? `${fmtDate(c.verified_at)}${c.verified_by ? ` · ${c.verified_by}` : ""}` : "Jamais"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ── Démarrage JS : deux mesures distinctes, jamais fondues ── */}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <section className="card p-4" aria-labelledby="mobile-demarrage">
          <h2 id="mobile-demarrage" className="text-sm font-semibold text-ink">Temps JS jusqu’au premier écran</h2>
          <p className="mt-1 text-xs text-ink-faint">
            Depuis l’initialisation du SDK jusqu’au premier écran que l’application déclare rendu. Ce n’est pas le
            démarrage natif : ni le lancement du processus, ni le pré-main, ni l’écran de lancement n’y figurent.
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            {([["À froid", startup.cold], ["À chaud", startup.warm]] as const).map(([titre, mesure]) => (
              <div key={titre} className="rounded-lg border border-line/60 p-3">
                <dt className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{titre}</dt>
                <dd
                  data-testid={`mobile-demarrage-${titre === "À froid" ? "froid" : "chaud"}`}
                  className="mt-1 text-2xl font-bold tabular-nums text-ink"
                >
                  {mesure ? fmtLatency(mesure.p75_ms) : "Non mesuré"}
                </dd>
                <dd className="mt-1 text-xs text-ink-faint">
                  {mesure
                    ? `p75 · médiane ${fmtLatency(mesure.p50_ms)} · p95 ${fmtLatency(mesure.p95_ms)} · ${NOMBRE(mesure.samples)} mesure(s)`
                    : "L’application n’a déclaré aucun premier écran sur la fenêtre."}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="card p-4" aria-labelledby="mobile-ecrans">
          <h2 id="mobile-ecrans" className="text-sm font-semibold text-ink">Écrans les plus consultés</h2>
          <div className="mt-3">
            <RankBar
              data={data.screens.map((s) => ({
                label: s.route ?? "Inconnu",
                value: s.views,
                display: NOMBRE(s.views),
                sub: `${NOMBRE(s.sessions)} session(s)`,
              }))}
              emptyLabel="Aucun écran observé sur la fenêtre."
            />
          </div>
          <details className="mt-3 text-xs text-ink-soft">
            <summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf">
              Alternative textuelle de la série
            </summary>
            <table className="mt-2 w-full">
              <caption className="sr-only">Écrans consultés et leur volume</caption>
              <thead><tr><th scope="col" className="py-1 text-left">Écran</th><th scope="col" className="py-1 text-right">Consultations</th><th scope="col" className="py-1 text-right">Sessions</th></tr></thead>
              <tbody>
                {data.screens.map((s) => (
                  <tr key={s.route ?? "inconnu"} className="border-t border-line/60">
                    <td className="py-1">{s.route ?? "Inconnu"}</td>
                    <td className="py-1 text-right tabular-nums">{NOMBRE(s.views)}</td>
                    <td className="py-1 text-right tabular-nums">{NOMBRE(s.sessions)}</td>
                  </tr>
                ))}
                {!data.screens.length && <tr><td className="py-1 text-ink-faint" colSpan={3}>Aucun écran observé.</td></tr>}
              </tbody>
            </table>
          </details>
        </section>
      </div>

      {/* ── Requêtes lentes ── */}
      <section className="card mb-6 overflow-x-auto" aria-labelledby="mobile-requetes">
        <h2 id="mobile-requetes" className="px-4 pt-4 text-sm font-semibold text-ink">Requêtes les plus lentes</h2>
        <p className="px-4 pt-1 text-xs text-ink-faint">
          Appels réseau émis par l’application. Mesurer la latence d’une origine tierce n’expose rien à ce tiers :
          aucun en-tête MIP n’est envoyé hors des origines explicitement déclarées.
        </p>
        <table className="mt-3 w-full min-w-table text-sm">
          <caption className="sr-only">Appels réseau les plus lents de la cohorte mobile</caption>
          <thead className="bg-panel2">
            <tr>
              <th scope="col" className="th">Chemin</th>
              <th scope="col" className="th">Méthode</th>
              <th scope="col" className="th">Appels</th>
              <th scope="col" className="th">p75</th>
              <th scope="col" className="th">Max</th>
              <th scope="col" className="th">≥ 400</th>
            </tr>
          </thead>
          <tbody>
            {data.resources.map((r) => (
              <tr key={`${r.method}-${r.path}`} className="border-t border-line/60 hover:bg-panel2/60">
                <td className="max-w-xs truncate px-4 py-3 font-mono text-xs text-ink-soft" title={r.path}>{r.path || "—"}</td>
                <td className="px-4 py-3 text-xs">{r.method ?? "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums">{NOMBRE(r.calls)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtLatency(r.p75_ms)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtLatency(r.max_ms)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{NOMBRE(r.errors)}</td>
              </tr>
            ))}
            {!data.resources.length && (
              <tr><td className="px-4 py-10 text-center text-sm text-ink-faint" colSpan={6}>Aucun appel réseau observé sur la fenêtre.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <nav className="flex flex-wrap items-center gap-3 text-sm" aria-label="Aller plus loin">
        <Link href={lienErreurs} data-testid="mobile-lien-erreurs" className="btn-ghost">
          Erreurs React Native
        </Link>
        {/* CE8 : `device=mobile` ouvrait les navigateurs mobiles, pas la cohorte React
            Native. Tant que la liste ne filtre pas le runtime (B8), le lien n'est pas
            un lien : désactivé, avec sa raison écrite. */}
        <span
          data-testid="mobile-lien-sessions"
          aria-disabled="true"
          className="btn-ghost cursor-not-allowed opacity-60"
          title="La liste des sessions ne filtre pas encore le runtime (B8)."
        >
          Sessions React Native
        </span>
        <span className="text-xs text-ink-soft">
          Indisponible : la liste des sessions ne filtre pas encore le runtime (B8).
        </span>
      </nav>
    </div>
  );
}
