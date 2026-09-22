import Link from "next/link";
import { cookies } from "next/headers";
import { PageHeader } from "@/components/PageHeader";
import { SupervisionHero, HeroStat, HeroReading } from "@/components/SupervisionHero";
import { Donut } from "@/components/charts/Donut";
import { ObservedTrend } from "@/components/charts/ObservedTrend";
import { INPUT_CLASS } from "@/components/forms/Field";
import { browserFromUA, fmtDate } from "@/lib/format";
import { geoSourceLabel } from "@/lib/geo";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import type { SearchParams } from "@/lib/filters";
import { lire, type Lecture } from "@/lib/lecture";
import { pageFilters } from "@/lib/page-filters";
import { breakdownDrillHref } from "@/lib/breakdowns";
import {
  engagementRaison,
  engagementSuffisant,
  fmtDuree,
  partActive,
  singleViewSessionRate,
  STILL_ACTIVE_MINUTES,
} from "@/lib/engagement";
import { hrefWithQuery, paramReader, queryToSearchParams } from "@/lib/query-contract";
import { dimensionSchema } from "@/lib/query-schema";
import { listSessions, releaseRechercheParOccurrence, visitStats, type VisitStats } from "@/lib/queries";
import { engagementStats, observedVisitorsTrend, samplingSessions } from "@/lib/queries-sessions";
import { BandeauEchantillonnage } from "@/components/states/BandeauEchantillonnage";
import {
  SESSION_PAGE_SIZE,
  SESSION_SEARCH_FIELDS,
  SESSION_SEARCH_FIELD_PARAM,
  SESSION_SEARCH_LABELS,
  SESSION_SEARCH_PARAM,
  SESSION_SEARCH_PLACEHOLDERS,
  SESSION_SEARCH_PROBLEMS,
  encodeSessionCursor,
  parseSessionCursor,
  parseSessionSearch,
  parseSessionSearchField,
  sessionSearchSummary,
} from "@/lib/sessions-search";
import { catalogueDe, lireChoix } from "@/lib/dashboard-blocs";
import { TousEteints } from "@/components/TousEteints";

export const dynamic = "force-dynamic";

/** Paramètre de pagination : une clé opaque, jamais un numéro de page. */
const CURSOR_PARAM = "cursor";

export default async function Sessions({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ecran = await pageFilters(sp, "/sessions");
  if (!ecran.ok) return <FilterProblemNotice title="Sessions" problem={ecran.problem} />;
  const f = ecran.filters;
  const url = paramReader(sp);

  // Recherche et curseur sont RELUS AVANT toute lecture : une saisie refusée ne
  // doit pas produire une liste qui l'ignore, et un curseur qui ne vient pas de
  // cette console ne doit pas être présenté à PostgreSQL.
  const champ = parseSessionSearchField(url.get(SESSION_SEARCH_FIELD_PARAM));
  const recherche = parseSessionSearch(champ, url.get(SESSION_SEARCH_PARAM));
  const curseur = parseSessionCursor(url.get(CURSOR_PARAM));
  const refus =
    recherche === undefined
      ? SESSION_SEARCH_PROBLEMS[champ]
      : curseur === undefined
        ? "Curseur de pagination invalide : il ne provient pas de cette console."
        : null;

  // Composition de l'écran, lue AVANT les requêtes : un bloc éteint ne lance pas
  // la sienne. `visitStats` et `listSessions` sont deux agrégats distincts, donc
  // éteindre l'un économise réellement un aller-retour en base.
  const cat = catalogueDe("/sessions")!;
  const blocs = lireChoix(cat, (await cookies()).get(cat.cookie)?.value);
  /** Lecture non lancée (bloc éteint) : une valeur sûre, jamais affichée comme mesure. */
  const sansLecture = <T,>(data: T): Promise<Lecture<T>> => Promise.resolve({ ok: true, data });
  const liste = blocs.liste && !refus;

  // Chaque bloc a SA lecture (F02, § 3.8) : `lire()` ne lève pas, un bloc en
  // échec dit « Lecture en échec » et les autres restent affichés. L'engagement
  // et les visiteurs rendaient autrefois des zéros pendant une panne. Le schéma
  // sondé, lui, conditionne les liens de tout l'écran : son échec est celui de
  // l'écran (`error.tsx`).
  const [schema, rows, vs, visiteurs, engagementLu, releaseParOccurrence, echantillonnage] = await Promise.all([
    dimensionSchema(),
    // Une ligne de plus que la page : c'est ainsi qu'on sait s'il en reste, sans
    // compter toute la population à chaque affichage.
    liste
      ? lire(() =>
          listSessions(f, {
            limit: SESSION_PAGE_SIZE + 1,
            cursor: curseur ?? null,
            search: recherche ?? null,
          }),
        )
      : sansLecture([]),
    blocs.resume ? lire(() => visitStats(f)) : sansLecture(null),
    blocs.visiteurs ? lire(() => observedVisitorsTrend(f)) : sansLecture([]),
    blocs.engagement ? lire(() => engagementStats(f)) : sansLecture(null),
    releaseRechercheParOccurrence(),
    // S7 : la population de l'écran (sessions commencées OU actives) est-elle un
    // échantillon ? Lue quel que soit le choix de blocs : elle qualifie tous.
    lire(() => samplingSessions(f)),
  ]);

  const lignes = rows.ok ? rows.data : [];
  const engagement = engagementLu.ok ? engagementLu.data : null;
  const page = lignes.slice(0, SESSION_PAGE_SIZE);
  const suivante = lignes.length > SESSION_PAGE_SIZE ? page[page.length - 1] : null;
  const rechercheParams = recherche
    ? { [SESSION_SEARCH_FIELD_PARAM]: recherche.field, [SESSION_SEARCH_PARAM]: recherche.value }
    : {};
  const lienPage = (cursor: string | null) =>
    hrefWithQuery("/sessions", ecran.query, { ...rechercheParams, [CURSOR_PARAM]: cursor });
  // Les filtres du contrat voyagent en champs cachés : le formulaire est un GET,
  // et sans eux « Rechercher » effacerait la plage et les filtres en cours.
  const caches = [...queryToSearchParams(ecran.query)];

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Sessions"
        sub="Parcours réels, rattachés à un identifiant de visiteur tiré au hasard (aucune PII) — ouvre une session pour sa timeline pas à pas."
      />

      {/* S7 (zone Z2b) : au-dessus des figures qu'il qualifie, tant que la rangée de
          KPI n'existe pas (F41 l'y placera). Rien n'est rendu hors échantillonnage. */}
      <BandeauEchantillonnage lecture={echantillonnage} />

      {/* Hero : partage nouveaux vs revenants (visitStats, sur TOUTE la fenêtre —
          contrairement à la page de sessions ci-dessous). Le partage ne porte que
          sur les sessions identifiées ; les autres sont affichées comme telles
          plutôt que réparties au jugé. */}
      {blocs.resume && (
        <SectionErreur titre="Nouveaux vs revenants">
          {!vs.ok ? (
            <div className="card mb-6 p-5">
              <EchecLecture titre="Nouveaux vs revenants" />
            </div>
          ) : (
            vs.data && <HeroVisites vs={vs.data} label={ecran.label} />
          )}
        </SectionErreur>
      )}

      {/* Tendance des visiteurs OBSERVÉS (P6.3). Des distincts par seau : leur
          somme n'est pas le nombre de visiteurs de la fenêtre, et aucun total
          n'est affiché sous la courbe. */}
      {blocs.visiteurs && (
        <SectionErreur titre="Visiteurs observés">
          {!visiteurs.ok ? (
            <div className="mb-6">
              <EchecLecture titre="Visiteurs observés" />
            </div>
          ) : (
            <section className="mb-6" data-testid="visiteurs-observes">
              <ObservedTrend
                title={`Visiteurs observés par ${ecran.bucketLabel} — ${ecran.label}`}
                rows={visiteurs.data.map((point) => ({ bucket: point.bucket, value: point.visitors }))}
                valueLabel="Visiteurs distincts"
              />
              <p className="mt-2 text-xs leading-relaxed text-ink-faint">
                Chaque seau compte les identifiants de visiteur DISTINCTS des sessions commencées pendant ce
                seau. <strong>Ces valeurs ne s&apos;additionnent pas</strong> : un visiteur présent dans trois
                seaux y figure trois fois, et aucun total de fenêtre n&apos;en est déduit.{" "}
                {visiteurs.data.some((point) => point.sans_identifiant > 0) && (
                  <>
                    {visiteurs.data
                      .reduce((somme, point) => somme + point.sans_identifiant, 0)
                      .toLocaleString("fr-FR")}{" "}
                    session(s) sans identifiant de visiteur sont hors de ce compte.
                  </>
                )}
              </p>
            </section>
          )}
        </SectionErreur>
      )}

      {/* Durée observée et sessions à une vue (P6.3) : affichées seulement si la
          fenêtre porte assez de sessions pour que ces chiffres veuillent dire
          quelque chose. */}
      {blocs.engagement && !engagementLu.ok && (
        <div className="mb-6">
          <EchecLecture titre="Durée observée et sessions à une seule vue" />
        </div>
      )}
      {blocs.engagement && engagement && (
        <SectionErreur titre="Durée observée et sessions à une seule vue">
        <section className="card mb-6 p-4" data-testid="engagement">
          <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Durée observée et sessions à une seule vue
          </h2>
          {engagementSuffisant(engagement) ? (
            <>
              <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Mesure
                  label="Durée observée médiane"
                  value={fmtDuree(engagement.duration_p50_s)}
                  hint="session_duration_observed = max(0, dernière observation − première)"
                />
                <Mesure label="Durée observée p75" value={fmtDuree(engagement.duration_p75_s)} hint="les 25 % les plus longues" />
                <Mesure
                  label="Sessions à une seule vue"
                  value={
                    singleViewSessionRate(engagement) == null
                      ? "—"
                      : `${(singleViewSessionRate(engagement)! * 100).toFixed(1)} %`
                  }
                  hint={`${engagement.single_view_sessions.toLocaleString("fr-FR")} sur ${engagement.sessions_with_view.toLocaleString("fr-FR")} session(s) avec au moins une vue`}
                />
                <Mesure
                  label="Sessions encore actives"
                  value={engagement.still_active.toLocaleString("fr-FR")}
                  hint={`vues dans les ${STILL_ACTIVE_MINUTES} dernières minutes de la fenêtre : durée non finie`}
                />
              </div>
              <p className="mt-3 text-xs leading-relaxed text-ink-faint">
                Population : les {engagement.sessions_started.toLocaleString("fr-FR")} session(s){" "}
                <strong>commencées</strong> dans la fenêtre — une session ouverte avant elle apporterait
                une durée qui ne s&apos;y est pas déroulée. La durée observée est un écart entre deux
                observations, <strong>pas du temps actif</strong> : un onglet laissé ouvert l&apos;allonge.
                « Sessions à une seule vue » n&apos;est pas un taux de rebond : aucune durée minimale ni
                interaction n&apos;entre dans sa définition.
                {partActive(engagement) != null && engagement.still_active > 0 && (
                  <>
                    {" "}
                    {(partActive(engagement)! * 100).toFixed(0)} % des sessions comptées étaient encore
                    actives à la fin de la fenêtre : leur durée et leur nombre de vues peuvent encore
                    augmenter.
                  </>
                )}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-ink-faint" data-testid="engagement-insuffisant">
              {engagementRaison(engagement)}
            </p>
          )}
        </section>
        </SectionErreur>
      )}

      {blocs.liste && (
      <>
      <form method="get" action="/sessions" className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Rechercher une session">
        {caches.map(([nom, valeur]) => (
          <input key={nom} type="hidden" name={nom} value={valeur} />
        ))}
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          Chercher par
          <select name={SESSION_SEARCH_FIELD_PARAM} defaultValue={champ} className={INPUT_CLASS}>
            {SESSION_SEARCH_FIELDS.map((field) => (
              <option key={field} value={field}>
                {SESSION_SEARCH_LABELS[field]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft sm:col-span-2">
          Valeur exacte
          <input
            name={SESSION_SEARCH_PARAM}
            defaultValue={recherche?.value ?? url.get(SESSION_SEARCH_PARAM) ?? ""}
            maxLength={512}
            placeholder={SESSION_SEARCH_PLACEHOLDERS[champ]}
            aria-invalid={refus ? true : undefined}
            aria-describedby={refus ? "recherche-refus" : "recherche-aide"}
            className={INPUT_CLASS}
          />
        </label>
        <div className="flex items-end gap-2">
          <button className="btn-accent" type="submit">
            Rechercher
          </button>
          {(recherche || refus) && (
            <Link href={hrefWithQuery("/sessions", ecran.query)} className="btn-ghost">
              Réinitialiser
            </Link>
          )}
        </div>
        {refus ? (
          <p
            id="recherche-refus"
            role="alert"
            data-testid="recherche-refus"
            className="text-xs text-bad-ink sm:col-span-2 lg:col-span-4"
          >
            {refus}
          </p>
        ) : (
          <p id="recherche-aide" className="text-xs leading-relaxed text-ink-faint sm:col-span-2 lg:col-span-4">
            Égalité exacte, jamais un motif ni un préfixe. La recherche par identité — visiteur, compte,
            adresse — n&apos;est pas proposée : une URL partageable ne doit pas permettre de retrouver le
            parcours d&apos;une personne.
            {!releaseParOccurrence && " La release est lue sur la session tant que les colonnes par occurrence ne sont pas présentes."}
          </p>
        )}
      </form>

      {recherche && !refus && (
        <p className="mb-3 text-xs text-ink-soft" data-testid="recherche-resume">
          {sessionSearchSummary(recherche)} · {ecran.label}
        </p>
      )}

      {/* Liste en échec : ni « Aucune session sur 24 h » (un vide qu'on n'a pas
          lu), ni pagination (une page suivante d'une liste inconnue). */}
      {!refus && !rows.ok && <EchecLecture titre="Liste des sessions" />}
      {!refus && rows.ok && (
        <SectionErreur titre="Liste des sessions">
        <div className="flex flex-col gap-3">
          {page.map((s) => (
            <div key={s.session_id} className="card p-4 transition hover:shadow-pop">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Link
                  href={hrefWithQuery(`/sessions/${encodeURIComponent(s.session_id)}`, ecran.query)}
                  className="rounded font-mono text-xs font-semibold text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
                  data-testid="session-link"
                >
                  {s.session_id.slice(0, 8)}…
                </Link>
                <Badge>{s.device_type ?? "?"}</Badge>
                <Badge>{browserFromUA(s.user_agent)}</Badge>
                {/* P8.7 : le badge porte sa provenance en alternative textuelle
                    ET en infobulle — un lecteur d'écran l'entend, une souris la
                    voit, et personne ne lit un pays comme une position. */}
                {s.geo_country && (
                  <Badge>
                    <span title={`Pays estimé · ${geoSourceLabel(s.geo_source)}`}>
                      {s.geo_country}
                      <span className="sr-only"> — pays estimé, provenance : {geoSourceLabel(s.geo_source)}</span>
                    </span>
                  </Badge>
                )}
                {s.collection_source === "extension" && (
                  <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent-ink">
                    extension
                  </span>
                )}
                <span className="text-ink-soft">{s.page_count} page(s)</span>
                {s.err_count > 0 && (
                  <span className="rounded-full border border-bad/30 bg-bad/10 px-2 py-0.5 text-xs font-medium text-bad-ink">
                    {s.err_count} erreur(s)
                  </span>
                )}
                <span className="ml-auto text-xs tabular-nums text-ink-faint">
                  {fmtDate(s.started_at)} → {fmtDate(s.last_seen_at)}
                </span>
              </div>
              {/* Parcours utilisateur : la lecture « analytics produit » de la session.
                  Chaque route ouvre `/pages` filtré sur elle — cet écran compte des
                  sessions, qui ne portent pas de route. */}
              {s.routes?.length ? (
                <div className="mt-2.5 flex flex-wrap items-center gap-1 font-mono text-xs text-ink-soft">
                  {s.routes.map((r, i) => (
                    <span key={i}>
                      {i > 0 && <span className="mx-1 text-accent/70">→</span>}
                      <Link
                        href={breakdownDrillHref("/sessions", ecran.query, "route", r, schema)}
                        aria-label={`Route ${r} — ouvrir les mesures de cette route`}
                        className="chip-mono rounded hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
                      >
                        {r}
                      </Link>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          {!page.length && (
            <p className="py-8 text-center text-ink-faint">
              {recherche
                ? `Aucune session ne correspond à cette recherche sur ${ecran.label}`
                : `Aucune session sur ${ecran.label}`}
            </p>
          )}
        </div>
        </SectionErreur>
      )}

      {!refus && rows.ok && (page.length > 0 || curseur) && (curseur || suivante) && (
        <nav className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm" aria-label="Pagination des sessions">
          <span className="text-xs text-ink-faint">
            {page.length.toLocaleString("fr-FR")} session(s) affichée(s) · pagination par clé stable
            (dernière vue, identifiant) : aucune ligne n&apos;est répétée ni sautée entre deux pages.
          </span>
          <span className="flex gap-4">
            {curseur && (
              <Link href={lienPage(null)} className="text-brand hover:underline">
                Retour au début
              </Link>
            )}
            {suivante && (
              <Link href={lienPage(encodeSessionCursor(suivante))} className="text-brand hover:underline">
                Sessions suivantes
              </Link>
            )}
          </span>
        </nav>
      )}
      </>
      )}

      {!blocs.resume && !blocs.liste && !blocs.visiteurs && !blocs.engagement && <TousEteints />}
    </div>
  );
}

/** Hero « Nouveaux vs revenants », rendu seulement sur une lecture réussie de `visitStats`. */
function HeroVisites({ vs, label }: { vs: VisitStats; label: string }) {
  const reprises = Math.max(vs.visits - vs.sessions, 0);
  const identified = vs.new_count + vs.returning_count;
  const returningPct = identified ? Math.round((vs.returning_count / identified) * 100) : 0;
  return (
    <SupervisionHero
      chartTitle="Nouveaux vs revenants"
      chart={
        identified > 0 ? (
          <Donut
            slices={[
              { label: "Nouveaux", value: vs.new_count, color: "#f89101" },
              { label: "Revenants", value: vs.returning_count, color: "#2563eb" },
            ]}
            centerValue={identified.toLocaleString("fr-FR")}
            centerLabel="identifiés"
          />
        ) : (
          <p className="py-12 text-center text-sm text-ink-faint">
            Aucun visiteur identifié sur {label}.
            {vs.unidentified_count > 0 && (
              <>
                <br />
                {vs.unidentified_count.toLocaleString("fr-FR")} session(s) sans identifiant de visiteur :
                collectées avant le 09/09/2026, ou par un SDK pas encore à jour.
              </>
            )}
          </p>
        )
      }
    >
      <HeroStat label="Sessions actives" value={vs.sessions.toLocaleString("fr-FR")} hint="≥ 1 page vue" />
      <HeroStat
        label="Visites"
        value={vs.visits.toLocaleString("fr-FR")}
        hint={reprises > 0 ? `dont ${reprises.toLocaleString("fr-FR")} reprise(s) après 30 min` : "aucune reprise"}
      />
      <HeroStat
        label="Part de revenants"
        value={identified ? `${returningPct} %` : "—"}
        hint={
          vs.unidentified_count > 0
            ? `sur ${identified.toLocaleString("fr-FR")} session(s) identifiée(s) · ${vs.unidentified_count.toLocaleString("fr-FR")} sans identifiant`
            : `${vs.returning_count.toLocaleString("fr-FR")} revenants · ${vs.new_count.toLocaleString("fr-FR")} nouveaux`
        }
      />
      <HeroReading>
        L&apos;anneau distingue les visiteurs vus pour la première fois de ceux qui reviennent (fidélité).
        Une session = un parcours ; une visite = un passage (reprise après 30 min d&apos;inactivité = nouvelle
        visite). « Revenant » se juge sur cette application seulement, et uniquement sur les sessions qui
        portent un identifiant de visiteur — les autres sont comptées à part, jamais réparties. Détail des
        parcours ci-dessous.
      </HeroReading>
    </SupervisionHero>
  );
}

function Mesure({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-ink">{value}</div>
      <div className="mt-0.5 text-[11px] leading-snug text-ink-faint">{hint}</div>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-line bg-panel2 px-2 py-0.5 text-xs text-ink-soft">
      {children}
    </span>
  );
}
