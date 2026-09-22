// Conversions (F66, plan § 5.14) — « Quelle part des sessions atteint chaque
// objectif de conversion, et avec quelle incertitude ? »
//
// CE QUE L'ÉCRAN REFUSE D'AFFIRMER.
//   - Une lecture hors périmètre : toutes les lectures passent par `sqlContext`
//     (apps effectives du principal) ; le refus provisoire de F40 (« une
//     application à la fois ») est levé, la plage personnalisée s'applique.
//   - Un taux sans dénominateur : chaque objectif se rapporte aux sessions de SON
//     app ; sans session, « — » et aucune barre (une barre nulle se lirait « 0 % »).
//   - Un classement que l'incertitude ne tient pas : chaque taux porte son
//     intervalle de Wilson (P*.1) ; sous 30 conversions ou 30 non-conversions, il
//     passe en fin, « échantillon faible ».
//   - Un verdict : aucun seuil publié n'existe pour une conversion (R-S), les barres
//     et les tuiles restent neutres.
import { PageHeader } from "@/components/PageHeader";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { Figure } from "@/components/charts/Figure";
import { KpiTile } from "@/components/charts/KpiTile";
import { RankBar, type RankDatum } from "@/components/charts/RankBar";
import { CadreEtat } from "@/components/states/EtatSurface";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import { getUser } from "@/lib/auth";
import { breakdownDrillHref } from "@/lib/breakdowns";
import {
  couverturePrecedente,
  sourcesSousFiltres,
  type CouverturePrecedente,
  type SourceComparaison,
} from "@/lib/comparaison";
import type { SearchParams } from "@/lib/filters";
import { formater } from "@/lib/fmt-ids";
import {
  classerObjectifs,
  couvertureTaux,
  demiLargeurPoints,
  ecartPoints,
  echantillonFaibleObjectif,
  formaterPoints,
  libelleCondition,
  lignesAppareils,
  meilleurObjectif,
} from "@/lib/goals";
import { lire, type Lecture } from "@/lib/lecture";
import { pageFilters } from "@/lib/page-filters";
import { listApps } from "@/lib/queries";
import {
  goalConversions,
  goalConversionsByDevice,
  listGoals,
  type GoalConversionLue,
  type GoalConversionsParAppareil,
} from "@/lib/queries-goals";
import { hrefWithQuery, paramReader, previousRange, rangeLabel } from "@/lib/query-contract";
import { dimensionSchema } from "@/lib/query-schema";
import { intervalleWilson, texteIntervalle } from "@/lib/stats/incertitude";
import { lireComparaison } from "@/lib/view-state";
import { createGoalAction, deleteGoalAction, toggleGoalAction } from "./actions";

export const dynamic = "force-dynamic";

const pct = (v: number | null) => formater("pct", v);

/** La population de l'écran, nommée dans chaque méta (S1, R-P). */
const POPULATION = "sessions ayant au moins une vue sur la fenêtre";

/** Le dénominateur se compare sur les pages vues : c'est d'elles qu'il est compté. */
const SOURCE_DENOMINATEUR: SourceComparaison = { table: "rum_pageview", colonneTemps: "started_at", additive: true };

const sansLecture = <T,>(data: T): Promise<Lecture<T>> => Promise.resolve({ ok: true, data });

/** « 1 session », « 20 sessions ». */
const sessions = (n: number) => `${formater("count", n)} ${n > 1 ? "sessions" : "session"}`;

/** « 12,4 % ± 1,8 pt » : le taux et la demi-largeur de son intervalle à 95 % (G3). */
function tauxEtDemiLargeur(g: GoalConversionLue): string {
  if (g.rate == null) return "—";
  const i = intervalleWilson(g.conversions, g.sessions);
  if (!i || "indisponible" in i) return pct(g.rate);
  const demi = demiLargeurPoints(i).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${pct(g.rate)} ± ${demi} pt`;
}

const FORMAT_DATE_UTC = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function Goals({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ecran = await pageFilters(sp, "/goals");
  if (!ecran.ok) return <FilterProblemNotice title="Conversions" problem={ecran.problem} />;
  const f = ecran.deviceFilters;
  const query = ecran.query;
  // Comparaison (F06) : `cmp=prev` compare le dénominateur à la période précédente,
  // seulement si celle-ci est COMPLÈTE (§ 3.2) ; défaut de l'écran : aucune.
  const prev = lireComparaison("/goals", paramReader(sp)).valeur.mode === "prev";
  const user = await getUser();
  const isAdmin = user?.role === "admin";

  const [lecture, lecturePrev, parAppareil, couvertures, schema, gestion] = await Promise.all([
    lire(() => goalConversions(f)),
    prev ? lire(() => goalConversions(f, true)) : sansLecture(null),
    lire(() => goalConversionsByDevice(f)),
    prev
      ? Promise.all(sourcesSousFiltres(query, SOURCE_DENOMINATEUR).map((s) => couverturePrecedente(query, s)))
      : Promise.resolve<CouverturePrecedente[]>([]),
    dimensionSchema(),
    // Gestion (G6) : le périmètre du principal, jamais l'app demandée seule.
    isAdmin ? lire(() => Promise.all([listApps(), listGoals(query.scope.effectiveApps)])) : sansLecture(null),
  ]);
  const error = typeof sp.error === "string" ? sp.error : null;

  const rep = lecture.ok ? lecture.data : null;
  const rows = rep ? classerObjectifs(rep.rows) : [];
  const plusieursApps = new Set(rows.map((g) => g.app_id)).size > 1;
  const prefixeApp = (g: GoalConversionLue) => (plusieursApps ? `${g.app_id} · ` : "");
  const creer = isAdmin ? { libelle: "Créer un objectif", href: "#gerer-objectifs" } : null;

  // État commun du hero et des petits multiples : aucun objectif, puis aucune session.
  const vide =
    rep && rows.length === 0 ? (
      <CadreEtat ton="neutre" role="status" testId="etat-vide" etat="vide" className="text-center">
        <p>Aucun objectif actif sur ce périmètre.</p>
        {creer && (
          <a href={creer.href} className="mt-2 inline-block font-medium text-brand hover:underline">
            {creer.libelle}
          </a>
        )}
      </CadreEtat>
    ) : null;
  const sansSession = rep && rows.length > 0 && rep.total === 0;
  const etatSansSession = { kind: "vide" as const, population: "session", plage: `${ecran.label} : taux non calculables` };

  const meta = (extra?: string) => (
    <>
      {extra && <span>{extra}</span>}
      <span>Population : {POPULATION}</span>
      <span>{ecran.label}</span>
    </>
  );

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Conversions"
        domain="usages"
        sub="Quelle part des sessions atteint chaque objectif de conversion, et avec quelle incertitude ?"
      />

      {error && (
        <div className="mb-6 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad-ink">
          Champs invalides — objectif non créé.
        </div>
      )}

      <SectionErreur titre="Chiffres clés">
        {rep ? (
          <RangeeKpi
            total={rep.total}
            rows={rows}
            precedent={lecturePrev.ok ? (lecturePrev.data?.total ?? undefined) : null}
            reference={prev ? `vs période précédente (${rangeLabel({ ...previousRange(query.range), preset: null }, "UTC")} UTC)` : undefined}
            couverture={
              !prev
                ? undefined
                : !lecturePrev.ok
                  ? // Une lecture en échec n'est pas « aucune mesure » : la tuile dit pourquoi elle se tait.
                    { etat: "inconnue", raison: "la période précédente n'a pas pu être lue" }
                  : (couvertures.find((c) => c.etat !== "complete") ?? couvertures[0])
            }
            hrefSessions={hrefWithQuery("/sessions", query)}
          />
        ) : (
          <div className="mb-6">
            <EchecLecture titre="Chiffres clés" />
          </div>
        )}
      </SectionErreur>

      {/* G3 — le hero, au-dessus du pli. */}
      <div className="mb-6">
        <SectionErreur titre="Taux de conversion par objectif">
          <Figure
            id="conversions-taux"
            titre="Taux de conversion par objectif"
            meta={meta(rep ? `${sessions(rep.total)} au dénominateur` : undefined)}
            etat={!lecture.ok ? { kind: "erreur", titre: "Taux de conversion par objectif" } : sansSession ? etatSansSession : undefined}
            lecture="Longueur = part des sessions de l'app de l'objectif qui l'atteignent, sur une échelle fixe de 0 à 100 % ; « ± » = demi-largeur de l'intervalle de Wilson à 95 %. Les objectifs sont indépendants, pas les étapes d'un entonnoir. Sous 30 conversions ou 30 non-conversions : en fin de classement, « échantillon faible »."
          >
            {vide ?? <BarresObjectifs rows={rows} prefixeApp={prefixeApp} />}
          </Figure>
        </SectionErreur>
      </div>

      {/* G4 — petits multiples par appareil. */}
      <div className="mb-6">
        <SectionErreur titre="Conversion par appareil">
          <Figure
            id="conversions-appareils"
            titre="Conversion par appareil"
            meta={meta()}
            etat={
              !lecture.ok || !parAppareil.ok
                ? { kind: "erreur", titre: "Conversion par appareil" }
                : sansSession
                  ? etatSansSession
                  : undefined
            }
            lecture="Taux = conversions ÷ sessions de cet appareil dans l'app de l'objectif ; écart en points au taux de l'objectif, tous appareils. Même échelle pour chaque objectif. Un appareil sans session n'a pas de taux (« — »). Cliquer un appareil filtre l'écran."
            alternative={
              parAppareil.ok && !vide
                ? {
                    legende: `Conversion par objectif et par appareil, ${ecran.label}`,
                    colonnes: ["Objectif · appareil", "Taux", "Écart à l'objectif", "Sessions"],
                    lignes: rows.flatMap((g) =>
                      lignesAppareils(g.id, parAppareil.data).map((l) => {
                        const ecart = ecartPoints(l.rate, g.rate);
                        return [`${prefixeApp(g)}${g.name} · ${l.libelle}`, pct(l.rate), ecart == null ? null : formaterPoints(ecart), l.sessions];
                      }),
                    ),
                  }
                : undefined
            }
          >
            {vide ??
              (parAppareil.ok && (
                <PetitsMultiples
                  rows={rows}
                  parAppareil={parAppareil.data}
                  prefixeApp={prefixeApp}
                  href={(device) => breakdownDrillHref("/goals", query, "device", device, schema)}
                />
              ))}
          </Figure>
        </SectionErreur>
      </div>

      {/* G5 — la table des objectifs. */}
      <div className="mb-8" id="objectifs">
        <SectionErreur titre="Objectifs">
          {rep ? (
            <TableObjectifs rows={rows} plusieursApps={plusieursApps} isAdmin={isAdmin} />
          ) : (
            <EchecLecture titre="Objectifs" />
          )}
        </SectionErreur>
      </div>

      {/* G6 — gestion (admin) : section non rendue pour un viewer (V9). */}
      {isAdmin && (
        <section id="gerer-objectifs" className="scroll-mt-6">
          <h2 className="mb-3 text-sm font-semibold text-ink-soft">Gérer les objectifs (admin)</h2>
          {gestion.ok && gestion.data ? (
            <Gestion apps={gestion.data[0]} allGoals={gestion.data[1]} appParDefaut={f.app} />
          ) : (
            <EchecLecture titre="Gérer les objectifs" />
          )}
        </section>
      )}
    </div>
  );
}

/** G1, G2 et le meilleur taux (P*.1) : une rangée, une population (sessions de la fenêtre). */
function RangeeKpi({
  total,
  rows,
  precedent,
  reference,
  couverture,
  hrefSessions,
}: {
  total: number;
  rows: GoalConversionLue[];
  precedent: number | null | undefined;
  reference: string | undefined;
  couverture: CouverturePrecedente | undefined;
  hrefSessions: string;
}) {
  // Le meilleur taux se lit dans l'ordre du hero (objectifs que l'échantillon
  // départage d'abord) ; à défaut, le premier taux connu, qui porte alors
  // « échantillon faible » selon la MÊME règle que le hero et la table.
  const best = meilleurObjectif(rows);
  return (
    <div className="mb-6 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
      <KpiTile
        label="Sessions de la fenêtre (dénominateur)"
        valeur={total}
        format="count"
        lecture="Sessions ayant vu au moins une page sur la fenêtre."
        precedent={reference ? precedent : undefined}
        reference={reference}
        couverturePrecedente={couverture}
        href={hrefSessions}
      />
      <KpiTile
        label="Objectifs actifs"
        valeur={rows.length}
        format="count"
        lecture="Objectifs actifs du périmètre lu."
        href="#objectifs"
      />
      <KpiTile
        label="Meilleur taux"
        valeur={best?.rate ?? null}
        format="pct"
        raisonNull={rows.length === 0 ? "aucun objectif actif" : "aucune session sur la fenêtre : taux non calculables"}
        intervalle={best ? (intervalleWilson(best.conversions, best.sessions) ?? undefined) : undefined}
        couverture={best ? couvertureTaux(best.conversions, best.sessions) : undefined}
        lecture={best?.name}
      />
    </div>
  );
}

/** G3 — une barre par objectif, échelle fixe 0–100 %, taux ± demi-largeur ; barre → ligne de G5. */
function BarresObjectifs({ rows, prefixeApp }: { rows: GoalConversionLue[]; prefixeApp: (g: GoalConversionLue) => string }) {
  const data: RankDatum[] = rows.map((g) => {
    const faible = echantillonFaibleObjectif(g.conversions, g.sessions);
    return {
      label: g.name,
      value: g.rate == null ? null : g.rate * 100,
      display: tauxEtDemiLargeur(g),
      sub: `${prefixeApp(g)}${libelleCondition(g)}${faible ? " · échantillon faible" : ""}`,
      href: `#objectif-${g.id}`,
      title: `${g.name} : ${pct(g.rate)} — ${formater("count", g.conversions)} sessions converties sur ${formater("count", g.sessions)}`,
    };
  });
  return <RankBar data={data} max={100} labelWidth="12rem" legende="Taux de conversion par objectif (taux ± demi-largeur à 95 %)" />;
}

/** G4 — un bloc par objectif, une barre par appareil, même échelle. */
function PetitsMultiples({
  rows,
  parAppareil,
  prefixeApp,
  href,
}: {
  rows: GoalConversionLue[];
  parAppareil: GoalConversionsParAppareil[];
  prefixeApp: (g: GoalConversionLue) => string;
  href: (device: string | null) => string;
}) {
  return (
    <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {rows.map((g) => (
        <div key={g.id} className="min-w-0 rounded-lg border border-line p-3" data-testid="conversion-appareils">
          <h3 className="mb-2 min-w-0 truncate text-xs font-semibold text-ink" title={`${prefixeApp(g)}${g.name}`}>
            {prefixeApp(g)}
            {g.name} · {pct(g.rate)}
          </h3>
          <RankBar
            alternative={false}
            max={100}
            labelWidth="5.5rem"
            data={lignesAppareils(g.id, parAppareil).map((l) => {
              const ecart = ecartPoints(l.rate, g.rate);
              return {
                label: l.libelle,
                value: l.rate == null ? null : l.rate * 100,
                display: l.rate == null ? "—" : `${pct(l.rate)}${ecart == null ? "" : ` (${formaterPoints(ecart)})`}`,
                sub: sessions(l.sessions),
                href: l.sessions > 0 ? href(l.device) : undefined,
                title: `${g.name}, ${l.libelle} : ${pct(l.rate)} — ${formater("count", l.conversions)} sur ${sessions(l.sessions)}`,
              };
            })}
          />
        </div>
      ))}
    </div>
  );
}

/** G5 — Objectif · App · Condition · Conversions (sessions) · Taux · Intervalle · Dernière conversion. */
function TableObjectifs({ rows, plusieursApps, isAdmin }: { rows: GoalConversionLue[]; plusieursApps: boolean; isAdmin: boolean }) {
  return (
    <>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <caption className="caption-top px-4 pt-3 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
            Objectifs
          </caption>
          <thead className="bg-panel2">
            <tr>
              <th scope="col" className="th sticky left-0 bg-panel2">
                Objectif
              </th>
              {plusieursApps && (
                <th scope="col" className="th">
                  App
                </th>
              )}
              <th scope="col" className="th">
                Condition
              </th>
              <th scope="col" className="th">
                Conversions (sessions)
              </th>
              <th scope="col" className="th w-56">
                Taux
              </th>
              <th scope="col" className="th">
                Dernière conversion
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {rows.map((g) => (
              <tr key={g.id} id={`objectif-${g.id}`} className="scroll-mt-6 transition hover:bg-panel2/60">
                <th scope="row" className="sticky left-0 bg-panel px-4 py-2 text-left font-medium text-ink">
                  {g.name}
                </th>
                {plusieursApps && <td className="px-4 py-2 font-mono text-xs text-ink-soft">{g.app_id}</td>}
                <td className="px-4 py-2 font-mono text-xs text-ink-soft">{libelleCondition(g)}</td>
                <td className="px-4 py-2 tabular-nums text-ink-soft">
                  {formater("count", g.conversions)} sur {formater("count", g.sessions)}
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel2">
                      {g.rate != null && (
                        <div className="h-full rounded-full bg-perf" style={{ width: `${Math.min(100, g.rate * 100)}%` }} />
                      )}
                    </div>
                    <span className="w-14 text-right text-xs font-semibold tabular-nums">{pct(g.rate)}</span>
                  </div>
                  {g.rate != null && (
                    <p className="mt-1 text-[11px] text-ink-soft" data-testid="goal-intervalle">
                      {texteIntervalle(intervalleWilson(g.conversions, g.sessions), pct)}
                      {echantillonFaibleObjectif(g.conversions, g.sessions) && (
                        <span className="font-medium text-warn-ink"> · échantillon faible</span>
                      )}
                    </p>
                  )}
                </td>
                <td className="px-4 py-2 text-xs tabular-nums text-ink-soft">
                  {g.derniere ? `${FORMAT_DATE_UTC.format(new Date(g.derniere))} UTC` : "—"}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={plusieursApps ? 6 : 5} className="px-4 py-8 text-center text-ink-soft">
                  Aucun objectif actif{isAdmin ? " : créez-en un ci-dessous" : ""}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-ink-soft">
        « Conversions » compte des sessions, pas des événements. Aucun lien vers les sessions converties : l&apos;objectif
        n&apos;est pas une dimension de filtre de la console.
      </p>
    </>
  );
}

/** G6 — gestion des objectifs (admin), conservée. */
function Gestion({
  apps,
  allGoals,
  appParDefaut,
}: {
  apps: { app_id: string; name: string }[];
  allGoals: Awaited<ReturnType<typeof listGoals>>;
  appParDefaut: string | null;
}) {
  return (
    <>
      <div className="card mb-6 p-4">
        <form action={createGoalAction} className="flex flex-wrap items-end gap-3" data-testid="create-goal">
          <label className="text-xs font-medium text-ink-soft">
            App
            <select name="app" className="field mt-1 block" required defaultValue={appParDefaut ?? ""}>
              <option value="" disabled>
                choisir…
              </option>
              {apps.map((a) => (
                <option key={a.app_id} value={a.app_id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-ink-soft">
            Nom
            <input name="name" required placeholder="Inscription" className="field mt-1 block w-40" />
          </label>
          <label className="text-xs font-medium text-ink-soft">
            Type
            <select name="kind" className="field mt-1 block">
              <option value="pageview">page vue</option>
              <option value="event">événement</option>
            </select>
          </label>
          <label className="text-xs font-medium text-ink-soft">
            Correspondance
            <select name="match_type" className="field mt-1 block">
              <option value="exact">exacte</option>
              <option value="contains">contient</option>
            </select>
          </label>
          <label className="text-xs font-medium text-ink-soft">
            Motif
            <input name="pattern" required placeholder="/merci ou nom_evenement" className="field mt-1 block w-52 font-mono text-xs" />
          </label>
          <button type="submit" className="btn-accent">
            Créer
          </button>
        </form>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="bg-panel2">
            <tr>
              <th className="th">Objectif</th>
              <th className="th">App</th>
              <th className="th">Condition</th>
              <th className="th">Statut</th>
              <th className="th">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {allGoals.map((g) => (
              <tr key={g.id} className="transition hover:bg-panel2/60">
                <td className="px-4 py-2 font-medium text-ink">{g.name}</td>
                <td className="px-4 py-2 font-mono text-xs text-ink-soft">{g.app_id}</td>
                <td className="px-4 py-2 font-mono text-xs text-ink-soft">{libelleCondition(g)}</td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${g.active ? "bg-good/10 text-good-ink" : "bg-panel2 text-ink-faint"}`}
                  >
                    {g.active ? "actif" : "inactif"}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <div className="flex gap-2">
                    <form action={toggleGoalAction}>
                      <input type="hidden" name="id" value={g.id} />
                      <button type="submit" className="btn-ghost px-2 py-1">
                        {g.active ? "Désactiver" : "Activer"}
                      </button>
                    </form>
                    <form action={deleteGoalAction}>
                      <input type="hidden" name="id" value={g.id} />
                      <button type="submit" className="btn-ghost px-2 py-1 text-bad-ink">
                        Supprimer
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
            {!allGoals.length && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-soft">
                  Aucun objectif défini
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
