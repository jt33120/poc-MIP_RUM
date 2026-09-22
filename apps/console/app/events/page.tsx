// Journal `/events` (F25, plan § 5.23) — « Que s'est-il passé exactement, dans quel
// ordre ? » ; question suivante : « dans quelle session ? ».
//
// UN SEUL INSTANTANÉ. Liste, total, volume et facettes viennent d'une même lecture
// (`exploreEvents`, transaction en lecture répétable) : ils ne peuvent pas se
// contredire, même pendant une ingestion. Ce que F25 ajoute autour, sans rien lire
// de plus sur les attributs :
//   - des facettes CLIQUABLES : un nom pose `name`, un attribut pose `attr_source` +
//     `attr_key` (les champs du formulaire, CP18), une valeur pose `attr_type` +
//     `attr_value` — le filtre se construit sans ressaisie ;
//   - un volume DATÉ (axe en heures UTC, seaux du contrat, zoom au clic) ;
//   - des colonnes promues : une clé portée par ≥ 80 % des lignes de la page devient
//     une colonne (`colonnesPromues`, lib/perf-domain.ts), avec les valeurs que la vue
//     rendait déjà ;
//   - un panneau d'événement (`panel=event:<id>`) où vit désormais « Voir le contexte ».
//
// `/events` force `kind=event` (événements custom) : c'est écrit dans le sous-titre.
// Les vues, vitals et erreurs ont leurs écrans ; le journal ne les recompte pas.
import Link from "next/link";
import type { ReactNode } from "react";
import { DetailPanel, type PuceDetail } from "@/components/DetailPanel";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { PageHeader } from "@/components/PageHeader";
import { Figure } from "@/components/charts/Figure";
import { KpiTile } from "@/components/charts/KpiTile";
import { RankBar } from "@/components/charts/RankBar";
import { ThresholdSeries } from "@/components/charts/ThresholdSeries";
import { INPUT_CLASS } from "@/components/forms/Field";
import { EtatSurface } from "@/components/states/EtatSurface";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import { annotationsDeploiements } from "@/lib/annotations";
import {
  cleSansValeur,
  eventResetHref,
  eventSearchParams,
  lienJournal,
  lienPanneauJournal,
  paginationJournal,
  totalJournal,
} from "@/lib/events-page-params";
import { type SearchParams } from "@/lib/filters";
import { formater } from "@/lib/fmt-ids";
import { lire } from "@/lib/lecture";
import { pageFilters } from "@/lib/page-filters";
import { colonnesPromues, valeurColonnePromue, type ColonnePromue } from "@/lib/perf-domain";
import { listDeploys } from "@/lib/queries-deploys";
import {
  EVENT_ATTRIBUTE_SOURCES,
  EVENT_ATTRIBUTE_TYPES,
  exploreEvents,
  parseEventAttribute,
  parseEventCursor,
  parseEventPage,
  parseEventQuery,
  type EventAttributeSource,
  type EventExplorerResult,
  type EventIndexRow,
  type EventQuery,
} from "@/lib/queries-events";
import { bucketStarts, hrefWithQuery, paramReader, queryToSearchParams, type AnalyticsQuery } from "@/lib/query-contract";
import { alignerSeaux, grilleIso, libelleSeauComplet } from "@/lib/series";
import { ecrirePanel, gabaritZoom, ligneIgnoree, lireEtatDeVue } from "@/lib/view-state";

export const dynamic = "force-dynamic";

const TITRE = "Journal";


const DATE_UTC = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const DATE_UTC_COMPLETE = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Instant d'un événement, en UTC (le fuseau des seaux du contrat) ; illisible → « — ». */
function dateUtc(d: Date | string, complete = false): string {
  const ms = new Date(d).getTime();
  if (!Number.isFinite(ms)) return "—";
  return complete ? `${DATE_UTC_COMPLETE.format(ms)} UTC` : DATE_UTC.format(ms);
}

function nomEvenement(e: EventIndexRow): string {
  return e.name ?? e.source_name ?? e.kind;
}

/** Lien vers la session d'un événement ; le panneau session arrive avec F43. */
function lienSession(e: EventIndexRow, query: AnalyticsQuery): string | null {
  return e.session_id ? hrefWithQuery(`/sessions/${encodeURIComponent(e.session_id)}`, query, { app: e.app_id }) : null;
}

const LIEN = "rounded text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf";

export default async function Journal({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ecran = await pageFilters(sp, "/events");
  if (!ecran.ok) return <FilterProblemNotice title={TITRE} problem={ecran.problem} />;
  const sub = (
    <>
      Que s&apos;est-il passé exactement, dans quel ordre ? Événements custom et signaux émis par le SDK, observés sur{" "}
      {ecran.label} ; les vues et les vitals ont leurs écrans.
    </>
  );

  // L'URL telle quelle : base de TOUS les liens de l'écran (facettes, panneau, page
  // suivante), qui gardent donc population, plage et filtres d'événements.
  const brut = eventSearchParams(sp);
  // Clé choisie depuis une facette, sans valeur encore : elle pré-remplit le
  // formulaire et demande ses valeurs ; elle ne filtre rien.
  const choisie = brut ? cleSansValeur(brut) : null;
  const cle =
    choisie &&
    parseEventAttribute(
      new URLSearchParams({ attr_source: choisie.cle.source, attr_key: choisie.cle.key, attr_type: "null" }),
    )
      ? { source: choisie.cle.source as EventAttributeSource, key: choisie.cle.key }
      : null;
  const lu = brut ? new URLSearchParams(cle && choisie ? choisie.sansCle : brut) : null;
  if (lu && !lu.has("kind")) lu.set("kind", "event");
  const query = lu ? parseEventQuery(lu) : undefined;
  const cursor = lu ? parseEventCursor(lu.get("cursor")) : undefined;
  const page = lu && cursor !== undefined ? paginationJournal(lu, parseEventPage(lu), cursor) : undefined;

  if (!brut || !query || cursor === undefined || !page) {
    return (
      <div className="animate-fade-up">
        <PageHeader title={TITRE} domain="explorer" sub={sub} />
        <div role="alert" className="card border-bad/30 p-6 text-sm text-bad-ink">
          Filtre invalide. Les noms sont bornés à 100 caractères ; une facette exige une source, une clé sûre,
          un type primitif et une valeur exacte.
        </div>
      </div>
    );
  }

  const [resultat, deploys] = await Promise.all([
    lire(() => exploreEvents(ecran.deviceFilters, query, page, cursor, { valeursDe: cle })),
    lire(() => listDeploys(ecran.filters, 20)),
  ]);

  // Réglages d'affichage : seul le panneau d'un événement s'ouvre ici.
  const vue = lireEtatDeVue("/events", paramReader(sp));
  const notes = [...vue.ignores];
  const panel = vue.etat.panel;
  let ouvert: { ligne: EventIndexRow; index: number } | null = null;
  if (panel && panel.type !== "event") {
    notes.push(ligneIgnoree("panel", brut.get("panel") ?? "", "seul le panneau d'un événement s'ouvre sur le Journal"));
  } else if (panel && resultat.ok) {
    const index = resultat.data.events.findIndex((e) => e.id === panel.id);
    if (index >= 0) ouvert = { ligne: resultat.data.events[index], index };
    else notes.push(ligneIgnoree("panel", brut.get("panel") ?? "", "cet événement n'est pas sur la page affichée du journal"));
  }

  return (
    <div className="animate-fade-up">
      <PageHeader title={TITRE} domain="explorer" sub={sub} />

      <FormulaireJournal
        query={query}
        cle={cle}
        contexte={ecran.query}
        brut={brut}
        valeurs={resultat.ok ? resultat.data.facets.values : []}
        noms={resultat.ok ? resultat.data.facets.names.map((n) => n.value) : []}
      />

      {notes.length > 0 && (
        <div role="note" className="mb-4 space-y-1 text-xs text-ink-soft" data-testid="reglages-ignores">
          {notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      )}

      {!resultat.ok ? (
        <div className="card p-4">
          <EchecLecture titre="Journal des événements" />
        </div>
      ) : (
        <ResultatJournal
          r={resultat.data}
          query={query}
          cle={cle}
          contexte={ecran.query}
          label={ecran.label}
          bucketLabel={ecran.bucketLabel}
          brut={brut}
          zoom={gabaritZoom(hrefWithQuery("/events", ecran.query, { period: null, from: "{from}", to: "{to}" }), sp)}
          annotations={
            deploys.ok
              ? annotationsDeploiements(deploys.data, ecran.query.range, {
                  // Pas de comparaison sur le Journal : un déploiement ouvre les événements de sa release.
                  lien: (version) => lienJournal(brut, { release: version }),
                })
              : { annotations: [], liste: [], indisponible: "déploiements non lus (lecture en échec)" }
          }
          ouvertId={ouvert?.ligne.id ?? null}
        />
      )}

      {ouvert && resultat.ok && (
        <PanneauEvenement
          e={ouvert.ligne}
          precedent={resultat.data.events[ouvert.index - 1] ?? null}
          suivant={resultat.data.events[ouvert.index + 1] ?? null}
          brut={brut}
          contexte={ecran.query}
          label={ecran.label}
        />
      )}
    </div>
  );
}

// ─────────────────────────────── Formulaire ───────────────────────────────

function FormulaireJournal({
  query,
  cle,
  contexte,
  brut,
  valeurs,
  noms,
}: {
  query: EventQuery;
  cle: { source: EventAttributeSource; key: string } | null;
  contexte: AnalyticsQuery;
  brut: URLSearchParams;
  valeurs: EventExplorerResult["facets"]["values"];
  /** Noms de la facette, proposés à la saisie. */
  noms: string[];
}) {
  const attribut = query.attribute;
  const source = attribut?.source ?? cle?.source ?? "";
  const clef = attribut?.key ?? cle?.key ?? "";
  // Un formulaire par filtre : sans cette clé, un champ déjà monté garderait sa
  // valeur précédente après un clic sur une facette (valeur par défaut non réappliquée).
  const version = [query.name, source, clef, attribut?.type, String(attribut?.value)].join("|");
  return (
    <form
      key={version}
      method="get"
      className="card mb-6 grid gap-3 p-4 md:grid-cols-3 xl:grid-cols-6"
      aria-label="Filtres du journal"
    >
      {/* Le contexte global suit la recherche : plage, appareil, dimensions, segment. */}
      {[...queryToSearchParams(contexte)].map(([nom, valeur]) => (
        <input key={nom} type="hidden" name={nom} value={valeur} />
      ))}
      <input type="hidden" name="kind" value="event" />
      <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-ink-soft">
        Nom d’événement
        <input name="name" defaultValue={query.name ?? ""} list="event-names" placeholder="checkout" className={INPUT_CLASS} />
        <datalist id="event-names">
          {noms.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-ink-soft">
        Source attribut
        <select name="attr_source" defaultValue={source} className={INPUT_CLASS}>
          <option value="">Aucune</option>
          {EVENT_ATTRIBUTE_SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-ink-soft">
        Clé
        <input name="attr_key" defaultValue={clef} placeholder="plan" className={INPUT_CLASS} />
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-ink-soft">
        Type
        <select name="attr_type" defaultValue={attribut?.type ?? "string"} className={INPUT_CLASS}>
          {EVENT_ATTRIBUTE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <div className="flex min-w-0 flex-col gap-1.5">
        <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-ink-soft">
          Valeur exacte
          <input
            name="attr_value"
            defaultValue={attribut?.value == null ? "" : String(attribut.value)}
            className={INPUT_CLASS}
          />
        </label>
        {valeurs.length > 0 && clef && source && (
          <PucesValeurs valeurs={valeurs} source={source} clef={clef} actuelle={attribut} brut={brut} />
        )}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <button className="btn-accent" type="submit">
          Appliquer
        </button>
        <Link href={eventResetHref(contexte)} className="btn-ghost">
          Réinitialiser
        </Link>
      </div>
    </form>
  );
}

/** « Valeurs » (§ 5.23.2) : puces-liens sous « Valeur exacte » ; un clic pose le type et la valeur. */
function PucesValeurs({
  valeurs,
  source,
  clef,
  actuelle,
  brut,
}: {
  valeurs: EventExplorerResult["facets"]["values"];
  source: string;
  clef: string;
  actuelle: EventQuery["attribute"];
  brut: URLSearchParams;
}) {
  return (
    <ul className="flex flex-wrap gap-1" aria-label={`Valeurs de ${source}.${clef}`} data-testid="puces-valeurs">
      {valeurs.map((v) => {
        const texte = v.type === "null" ? "null" : (v.value ?? "");
        const active = actuelle != null && actuelle.type === v.type && String(actuelle.value) === texte;
        // Une valeur trop longue pour être un filtre exact (500 caractères) reste lisible, pas cliquable.
        const cliquable = v.type === "null" || texte.length <= 500;
        const contenu = (
          <>
            <span className="block min-w-0 max-w-[10rem] truncate font-mono">{texte}</span>
            <span className="shrink-0 tabular-nums text-ink-soft">{formater("count", v.count)}</span>
          </>
        );
        const classe = `inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
          active ? "border-accent bg-accent/10 text-ink" : "border-line bg-panel2 text-ink"
        }`;
        return (
          <li key={`${v.type}:${texte}`} className="min-w-0 max-w-full">
            {cliquable ? (
              <Link
                href={lienJournal(brut, {
                  attr_source: source,
                  attr_key: clef,
                  attr_type: v.type,
                  attr_value: v.type === "null" ? null : texte,
                })}
                aria-current={active ? "true" : undefined}
                title={`${source}.${clef} = ${texte} (${v.type})`}
                className={`${classe} hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf`}
              >
                {contenu}
              </Link>
            ) : (
              <span className={classe} title="valeur trop longue pour un filtre exact">
                {contenu}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ─────────────────────────────── Résultat ───────────────────────────────

function ResultatJournal({
  r,
  query,
  cle,
  contexte,
  label,
  bucketLabel,
  brut,
  zoom,
  annotations,
  ouvertId,
}: {
  r: EventExplorerResult;
  query: EventQuery;
  cle: { source: EventAttributeSource; key: string } | null;
  contexte: AnalyticsQuery;
  label: string;
  bucketLabel: string;
  brut: URLSearchParams;
  zoom: string;
  annotations: ReturnType<typeof annotationsDeploiements>;
  ouvertId: string | null;
}) {
  const enrichi = r.enrichment.available;
  const diagnostic = r.enrichment.diagnostic ?? "lecture incomplète";
  // Sans projection (v65), ou sans enrichissements (v68) sous un filtre de nom ou
  // d'attribut, le total rendu vaut 0 PAR DÉFAUT : ce n'est pas un compte. Une seule
  // décision (`totalJournal`) pour la tuile ET la méta du volume.
  const total = totalJournal(r, query);
  const totalConnu = total !== null;
  const range = contexte.range;
  const debuts = bucketStarts(range);
  const grille = grilleIso(debuts);
  const points = enrichi
    ? alignerSeaux(
        r.trend.map((t) => ({ bucket: t.bucket, n: Number(t.count) })),
        debuts,
        true,
      ).map((ligne, i) => ({ t: grille[i], n: ligne?.n ?? 0 }))
    : [];
  const colonnes = colonnesPromues(r.events);
  const suivante = r.page.next_cursor ? pageSuivante(brut, r.page.next_cursor) : null;

  return (
    <>
      {/* Zone 2 : ce que la lecture n'a pas pu faire, puis l'échantillonnage (R-E). */}
      {!enrichi && (
        <div className="mb-4">
          <EtatSurface etat={{ kind: "partiel", raison: diagnostic }} />
        </div>
      )}
      {r.sampling_notice && (
        <div className="mb-4" data-testid="bandeau-echantillonnage">
          <EtatSurface
            etat={{ kind: "echantillonne", probaMin: r.sampling_notice.min_sample_rate, unite: "session", biaiseErreurs: true }}
          />
        </div>
      )}

      <div className="grid min-w-0 gap-4 xl:grid-cols-12">
        <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_14rem] xl:col-span-9 xl:col-start-4 xl:row-start-1">
          <SectionErreur titre="Volume du résultat">
            <Figure
              titre="Volume du résultat"
              id="volume-du-resultat"
              etat={enrichi ? undefined : { kind: "partiel", raison: diagnostic }}
              meta={
                <>
                  <span data-testid="volume-total">
                    {total === null ? "total non calculé" : `${formater("count", total)} événements`}
                  </span>
                  <span>{label}</span>
                  <span>seaux de {bucketLabel} (UTC)</span>
                  <span>journal indexé depuis la migration v65, sans rattrapage : les événements antérieurs n&apos;y sont pas</span>
                </>
              }
              lecture="Chaque barre compte les événements du résultat dans son seau, filtres compris ; un seau vide vaut 0. Un clic sur une barre zoome sur sa plage."
              alternative={{
                legende: `Événements du résultat par seau de ${bucketLabel}`,
                colonnes: ["Seau (UTC)", "Événements"],
                lignes: points.map((p) => [libelleSeauComplet(p.t, range.bucketSeconds, "UTC"), p.n]),
              }}
            >
              <ThresholdSeries
                grille={grille}
                points={points}
                series={[{ cle: "n", libelle: "Événements", role: "principale", forme: "barres", additive: true }]}
                format="count"
                annotations={annotations.annotations}
                annotationsIndisponibles={annotations.indisponible ?? undefined}
                seauSecondes={range.bucketSeconds}
                fuseau="UTC"
                zoomHref={zoom}
                hauteur={180}
                ariaLabel={`Événements du résultat par seau de ${bucketLabel}, ${label}`}
              />
            </Figure>
          </SectionErreur>
          <div data-testid="events-total" className="min-w-0">
            <KpiTile
              label="Total observé"
              valeur={total}
              raisonNull={`total non calculé : ${diagnostic}`}
              format="count"
              lecture={
                total === null
                  ? undefined
                  : total === 0
                    ? "Aucun événement ne correspond à ces filtres."
                    : "Même instantané que la liste, les facettes et le volume."
              }
            />
          </div>
        </div>

        <Facettes r={r} query={query} cle={cle} brut={brut} />

        <div className="min-w-0 xl:col-span-9 xl:col-start-4">
          {r.events.length === 0 ? (
            totalConnu ? (
              <EtatSurface
                etat={{
                  kind: "vide",
                  population: "ligne de journal correspondant à ces filtres",
                  plage: label,
                  geste: { libelle: "Retirer les filtres du journal", href: eventResetHref(contexte) },
                }}
              />
            ) : (
              <EtatSurface etat={{ kind: "partiel", raison: diagnostic }} />
            )
          ) : (
            <TableJournal lignes={r.events} colonnes={colonnes} contexte={contexte} brut={brut} ouvertId={ouvertId} />
          )}
          <nav className="mt-4 flex justify-end text-sm" aria-label="Pagination des événements">
            {suivante && (
              <Link className={LIEN} href={suivante}>
                Événements suivants
              </Link>
            )}
          </nav>
        </div>
      </div>
    </>
  );
}

function pageSuivante(brut: URLSearchParams, curseur: string): string {
  const p = new URLSearchParams(brut);
  p.set("cursor", curseur);
  p.delete("offset");
  p.delete("panel");
  return `/events?${p}`;
}

// ─────────────────────────────── Facettes ───────────────────────────────

/**
 * Colonne des facettes (3/12 à partir de 1 280 px). En dessous, elles passent sous
 * le volume, REPLIÉES : une case à cocher (sans JavaScript) les déplie.
 */
function Facettes({
  r,
  query,
  cle,
  brut,
}: {
  r: EventExplorerResult;
  query: EventQuery;
  cle: { source: EventAttributeSource; key: string } | null;
  brut: URLSearchParams;
}) {
  const enrichi = r.enrichment.available;
  const cleActive = query.attribute ?? cle;
  return (
    <aside
      className="card min-w-0 p-4 xl:col-span-3 xl:col-start-1 xl:row-span-2 xl:row-start-1"
      aria-label="Facettes du résultat"
      data-testid="facettes"
    >
      <input id="facettes-deplier" type="checkbox" className="peer sr-only" />
      <label
        htmlFor="facettes-deplier"
        className="flex cursor-pointer select-none items-center justify-between gap-2 rounded text-[11px] font-semibold uppercase tracking-wider text-ink-soft peer-focus-visible:ring-2 peer-focus-visible:ring-perf xl:hidden"
        data-testid="facettes-deplier"
      >
        <span>
          Facettes du résultat <span className="sr-only">: afficher ou masquer</span>
        </span>
        <span aria-hidden="true">▾</span>
      </label>
      <h2 className="hidden text-[11px] font-semibold uppercase tracking-wider text-ink-soft xl:block">
        Facettes du résultat
      </h2>
      <div className="mt-3 hidden min-w-0 space-y-5 peer-checked:block xl:block">
        {!enrichi ? (
          <p className="text-xs text-ink-soft">Facettes indisponibles : {r.enrichment.diagnostic}.</p>
        ) : (
          <>
            <section aria-labelledby="facette-noms" className="min-w-0">
              <h3 id="facette-noms" className="mb-2 text-xs font-semibold text-ink">
                Événements par nom
              </h3>
              <RankBar
                data={r.facets.names.map((n) => ({
                  label: n.value,
                  value: n.count,
                  display: formater("count", n.count),
                  href: lienJournal(brut, { name: n.value }),
                  title: query.name === n.value ? "filtre actif" : `Filtrer le journal sur « ${n.value} »`,
                }))}
                labelWidth="7rem"
                legende="Événements par nom (20 noms au plus)"
                emptyLabel="Aucun nom."
              />
            </section>
            <section aria-labelledby="facette-attributs" className="min-w-0">
              <h3 id="facette-attributs" className="mb-2 text-xs font-semibold text-ink">
                Attributs fréquents
              </h3>
              {r.facets.attributes.length === 0 ? (
                <p className="text-xs text-ink-soft">Aucune facette primitive.</p>
              ) : (
                <ul className="space-y-0.5 text-xs" data-testid="facette-attributs">
                  {r.facets.attributes.map((a) => {
                    const active = cleActive?.source === a.source && cleActive.key === a.key;
                    return (
                      <li key={`${a.source}:${a.key}`} className="min-w-0">
                        <Link
                          href={lienJournal(brut, {
                            attr_source: a.source,
                            attr_key: a.key,
                            attr_type: null,
                            attr_value: null,
                          })}
                          aria-current={active ? "true" : undefined}
                          className={`flex min-w-0 items-center justify-between gap-3 rounded px-1 py-0.5 hover:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf ${
                            active ? "bg-accent/10" : ""
                          }`}
                        >
                          <code className="block min-w-0 truncate text-ink">
                            {a.source}.{a.key}
                          </code>
                          <span className="shrink-0 tabular-nums text-ink-soft">{formater("count", a.count)}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="mt-2 text-[11px] text-ink-soft">
                Un clic choisit la clé ; ses valeurs s&apos;affichent sous « Valeur exacte ». Comptes : événements qui
                portent la clé (30 clés au plus).
              </p>
            </section>
          </>
        )}
      </div>
    </aside>
  );
}

// ─────────────────────────────── Table ───────────────────────────────

const CELLULE = "sm:table-cell sm:px-4 sm:py-3 sm:align-top";

/** Une cellule : en carte sous 640 px, son libellé la précède. */
function Cellule({ libelle, children, className = "" }: { libelle: string; children: ReactNode; className?: string }) {
  return (
    <td className={`mt-1 flex min-w-0 items-baseline gap-2 text-xs ${CELLULE} ${className}`}>
      <span className="shrink-0 text-ink-soft sm:hidden">{libelle}</span>
      {children}
    </td>
  );
}

function TableJournal({
  lignes,
  colonnes,
  contexte,
  brut,
  ouvertId,
}: {
  lignes: EventIndexRow[];
  colonnes: ColonnePromue[];
  contexte: AnalyticsQuery;
  brut: URLSearchParams;
  ouvertId: string | null;
}) {
  return (
    <div className="card min-w-0 sm:overflow-x-auto" data-testid="journal-table">
      {/* 44 rem : cinq colonnes et les colonnes promues tiennent dans les 9/12 d'un
          écran de 1 440 px ; en dessous, le conteneur défile sans élargir la page. */}
      <table className="block w-full text-sm sm:table sm:min-w-[44rem]">
        <caption className="sr-only">
          Journal des événements custom correspondant aux filtres, du plus récent au plus ancien
          {colonnes.length > 0 ? ` ; colonnes promues : ${colonnes.map((c) => `${c.source}.${c.cle}`).join(", ")}` : ""}
        </caption>
        <thead className="hidden bg-panel2 sm:table-header-group">
          <tr>
            <th scope="col" className="th">
              Événement
            </th>
            <th scope="col" className="th">
              Route
            </th>
            <th scope="col" className="th">
              Appareil
            </th>
            <th scope="col" className="th">
              Session
            </th>
            <th scope="col" className="th">
              Date (UTC)
            </th>
            {colonnes.map((c) => (
              <th key={`${c.source}.${c.cle}`} scope="col" className="th" title={`présente sur ${c.presence} ligne(s) de la page`}>
                <span className="font-mono normal-case">
                  {c.source}.{c.cle}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="block sm:table-row-group">
          {lignes.map((e) => {
            const ouvert = ouvertId === e.id;
            const session = lienSession(e, contexte);
            return (
              <tr
                key={e.id}
                data-testid="journal-ligne"
                aria-current={ouvert ? "true" : undefined}
                className={`block border-t border-line/60 px-4 py-3 first:border-t-0 sm:table-row sm:p-0 ${
                  ouvert ? "bg-accent/5" : "hover:bg-panel2/60"
                }`}
              >
                <td className={`block min-w-0 ${CELLULE}`}>
                  <Link
                    href={lienPanneauJournal(brut, ecrirePanel({ type: "event", id: e.id }))}
                    scroll={false}
                    className="break-words font-semibold text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
                  >
                    {nomEvenement(e)}
                  </Link>
                  <div className="mt-1 break-all font-mono text-[11px] text-ink-soft">{e.app_id}</div>
                  <div className="mt-1 text-xs text-ink-soft sm:hidden">{dateUtc(e.ts)} UTC</div>
                </td>
                <Cellule libelle="Route">
                  <span className="block min-w-0 truncate font-mono text-ink-soft sm:whitespace-normal sm:break-all">
                    {e.route ?? "—"}
                  </span>
                </Cellule>
                <Cellule libelle="Appareil">
                  <span className="text-ink-soft">{e.device_type ?? "Inconnu"}</span>
                </Cellule>
                <Cellule libelle="Session">
                  {session && e.session_id ? (
                    <Link className={LIEN} href={session}>
                      {e.session_id.slice(0, 8)}…
                    </Link>
                  ) : (
                    <span className="text-ink-soft">—</span>
                  )}
                </Cellule>
                <td className={`hidden whitespace-nowrap text-xs text-ink-soft ${CELLULE}`}>{dateUtc(e.ts)}</td>
                {colonnes.map((c) => {
                  const v = valeurColonnePromue(e, c);
                  return (
                    <Cellule key={`${c.source}.${c.cle}`} libelle={`${c.source}.${c.cle}`}>
                      <span className="block min-w-0 truncate font-mono text-ink sm:max-w-[16rem]" title={v ?? undefined}>
                        {v ?? "—"}
                      </span>
                    </Cellule>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────── Panneau ───────────────────────────────

function PanneauEvenement({
  e,
  precedent,
  suivant,
  brut,
  contexte,
  label,
}: {
  e: EventIndexRow;
  precedent: EventIndexRow | null;
  suivant: EventIndexRow | null;
  brut: URLSearchParams;
  contexte: AnalyticsQuery;
  label: string;
}) {
  const session = lienSession(e, contexte);
  const puces: PuceDetail[] = [
    { label: "Appareil", valeur: e.device_type ?? "Inconnu" },
    { label: "Route", valeur: e.route ?? "—" },
    { label: "App", valeur: e.app_id },
  ];
  const ouvrir = (x: EventIndexRow | null) => (x ? lienPanneauJournal(brut, ecrirePanel({ type: "event", id: x.id })) : null);
  // « Ouvrir en page » : l'événement n'a pas de page à lui ; sa session en est une.
  const pageHref = session ?? (e.name ? lienJournal(brut, { name: e.name }) : lienPanneauJournal(brut, null));
  const ligne = (terme: string, valeur: ReactNode) => (
    <>
      <dt className="text-ink-soft">{terme}</dt>
      <dd className="min-w-0 break-words text-ink">{valeur}</dd>
    </>
  );
  return (
    <DetailPanel
      type="event"
      titre={nomEvenement(e)}
      puces={puces}
      fermerHref={lienPanneauJournal(brut, null)}
      pageHref={pageHref}
      precedentHref={ouvrir(precedent)}
      suivantHref={ouvrir(suivant)}
    >
      <div className="space-y-4">
        <p className="text-xs text-ink-soft">
          Plage de l&apos;écran : {label}. Le panneau n&apos;a pas de fenêtre de temps propre : il montre une ligne de la
          page affichée du journal ; précédent et suivant parcourent cette page.
        </p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm" data-testid="panneau-evenement">
          {ligne("Événement", nomEvenement(e))}
          {ligne("Signal", `${e.kind}${e.source_name ? ` · ${e.source_name}` : ""}`)}
          {ligne("Date", dateUtc(e.ts, true))}
          {ligne("Route", <span className="font-mono">{e.route ?? "—"}</span>)}
          {ligne("Appareil", e.device_type ?? "Inconnu")}
          {ligne("Application", <span className="font-mono">{e.app_id}</span>)}
          {ligne(
            "Session",
            session && e.session_id ? (
              <Link className={LIEN} href={session}>
                {e.session_id.slice(0, 8)}… — ouvrir la session
              </Link>
            ) : (
              "—"
            ),
          )}
        </dl>
        <details open className="text-sm">
          <summary className="cursor-pointer rounded text-xs font-medium text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf">
            Voir le contexte
          </summary>
          <p className="mt-2 text-xs text-ink-soft">
            Attributs et contexte tels qu&apos;enregistrés, nettoyés à l&apos;ingestion (« scrubbed ») : aucune donnée
            brute n&apos;est relue.
          </p>
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded bg-panel2 p-2 text-[11px] text-ink-soft">
            {JSON.stringify({ props: e.props ?? {}, context: e.context ?? {} }, null, 2)}
          </pre>
        </details>
      </div>
    </DetailPanel>
  );
}
