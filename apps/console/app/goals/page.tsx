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
//
// RECETTE DU 26/09/2026.
//   - Un taux, une couleur : la série principale partout (barres du hero, petits
//     multiples ET colonne Taux de la table, qui était bleue).
//   - Le nom de l'application, jamais son identifiant (`nomsApps`, lu par le chargeur).
//   - Les objectifs étaient listés deux fois (table, puis administration) : pour
//     qui a le droit, Désactiver et Supprimer sont sur la ligne de la table ; la
//     gestion ne garde que la création et les objectifs absents de la table
//     (désactivés, ou d'une application interne que « toutes » ne compte pas).
//   - La méthode (intervalle de Wilson, seuil d'échantillon) est repliée sous la
//     figure ou derrière l'aide « ? » ; aucune justification technique visible.
//
// REFONTE DU 30/09/2026 : trois cases épurées (sources dans leur fenêtre), le taux par
// objectif et la conversion par appareil côte à côte (même bord bas), la table en
// lignes denses ; les phrases de lecture (« longueur = part… », « entre parenthèses :
// l'écart… », la définition d'une conversion) dans les replis « Méthode » et les bulles.
import { ECRANS } from "@mip/console-contract";
import { PageHeader } from "@/components/PageHeader";
import { ConfirmationDanger } from "@/components/ConfirmationDanger";
import { entreGuillemets } from "@/lib/format";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { Figure, MethodeRepliee as Methode } from "@/components/charts/Figure";
import { KpiTile } from "@/components/charts/KpiTile";
import { RangeeKpi } from "@/components/charts/RangeeKpi";
import { RankBar, type RankDatum } from "@/components/charts/RankBar";
import { CadreEtat } from "@/components/states/EtatSurface";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import { TableDefilante } from "@/components/TableDefilante";
import { breakdownDrillHref } from "@/lib/breakdowns";
import { type CouverturePrecedente } from "@/lib/comparaison";
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
  ecartesPlusHauts,
  texteEcartes,
} from "@/lib/goals";
import { chargerGoals } from "@/lib/chargeurs/goals";
import { chargerEcran } from "@/lib/ecran";
import { listGoals, type GoalConversionLue, type GoalConversionsParAppareil } from "@/lib/queries-goals";
import { hrefWithQuery, paramReader, previousRange, rangeLabel } from "@/lib/query-contract";
import { SERIE } from "@/lib/palette";
import { FAIBLE_SOUS_PROPORTION, intervalleWilson, texteIntervalle } from "@mip/stats/incertitude";
import { lireComparaison } from "@/lib/view-state";
import { createGoalAction, deleteGoalAction, toggleGoalAction } from "./actions";
import { FUSEAU_AFFICHAGE } from "@/lib/fuseau-local";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const pct = (v: number | null) => formater("pct", v);

/** La population de l'écran, nommée dans chaque méta (S1, R-P). */
const POPULATION = "sessions ayant vu au moins une page sur la période";

/** D'où viennent les chiffres de l'écran, écrit dans la fenêtre des cases. */
const SOURCE_OBJECTIFS = "Capteur navigateur · pages vues et événements des sessions ; objectifs définis dans la console";

/** La définition d'une conversion, dite une fois (en-tête de la table et repli). */
const DEFINITION_CONVERSION = "Une conversion est une session qui atteint l'objectif, même si elle l'atteint plusieurs fois.";

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


export default async function Goals({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // Le chargeur (`lib/chargeurs/goals.ts`) lit les conversions et, pour un
  // administrateur (décidé par son principal), la gestion des objectifs (G6).
  const ecran = await chargerEcran(ECRANS.goals, chargerGoals, sp);
  if (ecran.etat === "refus") return <FilterProblemNotice title="Conversions" problem={ecran.problem} />;
  const query = ecran.query;
  // Comparaison (F06) : `cmp=prev` compare le dénominateur à la période précédente,
  // seulement si celle-ci est COMPLÈTE (§ 3.2) ; défaut de l'écran : aucune.
  const prev = lireComparaison("/goals", paramReader(sp)).valeur.mode === "prev";
  const { isAdmin, lecture, lecturePrev, parAppareil, couvertures, gestion, nomsApps } = ecran;
  const schema = new Set(ecran.schema);
  const f = { app: ecran.app };
  const error = typeof sp.error === "string" ? sp.error : null;

  const rep = lecture.ok ? lecture.data : null;
  const rows = rep ? classerObjectifs(rep.rows) : [];
  const plusieursApps = new Set(rows.map((g) => g.app_id)).size > 1;
  /** Le nom lisible d'une application ; son identifiant si le registre ne le connaît pas. */
  const nomApp = (app: string) => nomsApps[app] ?? app;
  const prefixeApp = (g: GoalConversionLue) => (plusieursApps ? `${nomApp(g.app_id)} · ` : "");
  const creer = isAdmin ? { libelle: "Créer un objectif", href: "#gerer-objectifs" } : null;

  // État commun du hero et des petits multiples : aucun objectif, puis aucune session.
  const vide =
    rep && rows.length === 0 ? (
      // Une ligne (charte § 3.7) : le pictogramme d'absence, le constat, le geste à côté.
      <CadreEtat ton="neutre" role="status" testId="etat-vide" etat="vide" enLigne className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span aria-hidden="true" className="text-ink-faint">
          ⊘
        </span>
        <p>Aucun objectif actif sur ce périmètre.</p>
        {creer && (
          <a href={creer.href} className="font-medium text-brand hover:underline">
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

      {/* Rien de créé (recette du 01/10/2026) : pas de cases à 0 ni de table vide, la
          ligne d'absence seule, puis la création (gestion). */}
      {vide && <div className="mb-4">{vide}</div>}
      {!vide && (
      <SectionErreur titre="Chiffres clés">
        {rep ? (
          <TuilesConversions
            total={rep.total}
            rows={rows}
            precedent={lecturePrev.ok ? (lecturePrev.data?.total ?? undefined) : null}
            reference={prev ? `vs période précédente (${rangeLabel({ ...previousRange(query.range), preset: null }, FUSEAU_AFFICHAGE)})` : undefined}
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
      )}

      {/* G3 et G4 — le taux par objectif (6 colonnes) à côté de la conversion par appareil
          (6 colonnes), au-dessus du pli, même bord bas. Sans objectif, une seule ligne sur
          toute la largeur : il n'y a rien à découper par appareil. */}
      {!vide && (
      <div className="mb-4 grid min-w-0 gap-3 lg:grid-cols-12">
      <div className={`min-w-0 ${vide ? "lg:col-span-12" : "lg:col-span-6"}`}>
        <SectionErreur titre="Taux de conversion par objectif">
          <Figure pleineHauteur
            id="conversions-taux"
            titre="Taux de conversion par objectif"
            meta={meta(rep ? `${sessions(rep.total)} au dénominateur` : undefined)}
            etat={!lecture.ok ? { kind: "erreur", titre: "Taux de conversion par objectif" } : sansSession ? etatSansSession : undefined}
          >
            {vide ?? (
              <>
                <BarresObjectifs rows={rows} prefixeApp={prefixeApp} />
                <Methode>
                  Longueur = part des sessions qui atteignent l&apos;objectif, de 0 à 100&nbsp;% ; « ± » donne la marge
                  d&apos;incertitude. Les objectifs sont indépendants : ce ne sont pas les étapes d&apos;un entonnoir.{" "}
                  {DEFINITION_CONVERSION} Chaque objectif se rapporte aux sessions de son application. La marge « ± » est la demi-largeur de
                  l&apos;intervalle de confiance à 95&nbsp;% (méthode de Wilson). Sous {FAIBLE_SOUS_PROPORTION} conversions ou{" "}
                  {FAIBLE_SOUS_PROPORTION} non-conversions, un objectif passe en fin de classement, marqué « échantillon
                  faible » : son taux se départage mal de ses voisins. Source : pages vues et événements du capteur navigateur,
                  rapprochés des objectifs définis dans la console.
                </Methode>
              </>
            )}
          </Figure>
        </SectionErreur>
      </div>

      {/* G4 — petits multiples par appareil. */}
      {!vide && (
      <div className="min-w-0 lg:col-span-6">
        <SectionErreur titre="Conversion par appareil">
          <Figure pleineHauteur
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
                <>
                  <PetitsMultiples
                    rows={rows}
                    parAppareil={parAppareil.data}
                    prefixeApp={prefixeApp}
                    href={(device) => breakdownDrillHref("/goals", query, "device", device, schema)}
                  />
                  <Methode>
                    Entre parenthèses : l&apos;écart, en points, au taux de l&apos;objectif tous appareils confondus.
                    Cliquez un appareil pour filtrer l&apos;écran. Taux = conversions ÷ sessions de cet appareil dans l&apos;application de l&apos;objectif, sur la même
                    échelle pour chaque objectif. Un appareil sans session n&apos;a pas de taux (« — »).
                  </Methode>
                </>
              ))}
          </Figure>
        </SectionErreur>
      </div>
      )}
      </div>
      )}

      {/* G5 — la table des objectifs. */}
      {!vide && (
      <div className="mb-6" id="objectifs">
        <SectionErreur titre="Objectifs">
          {rep ? (
            <TableObjectifs rows={rows} plusieursApps={plusieursApps} isAdmin={isAdmin} nomApp={nomApp} />
          ) : (
            <EchecLecture titre="Objectifs" />
          )}
        </SectionErreur>
      </div>
      )}

      {/* G6 — gestion (admin) : section non rendue pour un viewer (V9). */}
      {isAdmin && (
        <section id="gerer-objectifs" className="scroll-mt-6">
          <h2 className="mb-3 text-sm font-semibold text-ink-soft">Gérer les objectifs</h2>
          {gestion.ok && gestion.data ? (
            <Gestion
              apps={gestion.data[0]}
              allGoals={gestion.data[1]}
              // Une table illisible ne liste rien : tous les objectifs restent alors gérables ici.
              dejaListes={new Set(rep ? rows.map((g) => g.id) : [])}
              appParDefaut={f.app}
              nomApp={nomApp}
            />
          ) : (
            <EchecLecture titre="Gérer les objectifs" />
          )}
        </section>
      )}
    </div>
  );
}

/**
 * G1, G2 et le meilleur taux (P*.1) : une rangée, une population (sessions de la
 * période). La rangée (`RangeeKpi`) dit une fois au-dessus d'elle pourquoi un écart
 * se tait ; la méthode de chaque tuile est derrière son aide.
 */
function TuilesConversions({
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
  // Un objectif au taux plus haut, écarté pour échantillon faible, se dit sous la tuile.
  const ecartes = texteEcartes(ecartesPlusHauts(rows, best));
  return (
    <RangeeKpi couvertures={[reference ? couverture : undefined]} className="mb-3 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3">
      <KpiTile
        label="Sessions de la période"
        valeur={total}
        format="count"
        lecture="Le dénominateur de chaque taux."
        // Tuile-lien : la méthode passe dans son infobulle native (pas de bouton dans un lien).
        methode="Sessions ayant vu au moins une page sur la période. Chaque objectif se rapporte aux seules sessions de son application."
        source={SOURCE_OBJECTIFS}
        categorie="Conversions · dénominateur"
        precedent={reference ? precedent : undefined}
        reference={reference}
        couverturePrecedente={couverture}
        href={hrefSessions}
      />
      <KpiTile
        label="Objectifs actifs"
        valeur={rows.length}
        format="count"
        href="#objectifs"
        source="Table goal (objectifs actifs du périmètre)"
        categorie="Conversions · objectifs"
      />
      <KpiTile
        label="Meilleur taux"
        valeur={best?.rate ?? null}
        format="pct"
        raisonNull={rows.length === 0 ? "aucun objectif actif" : "aucune session sur la période : taux non calculables"}
        intervalle={best ? (intervalleWilson(best.conversions, best.sessions) ?? undefined) : undefined}
        couverture={best ? couvertureTaux(best.conversions, best.sessions) : undefined}
        // Un objectif au taux plus haut, écarté pour échantillon faible, est NOMMÉ sous le
        // chiffre : « 82,2 % » côtoyait un « 97,0 % » sans dire pourquoi.
        lecture={best ? (ecartes ? `${best.name} — ${ecartes}` : best.name) : undefined}
        source={SOURCE_OBJECTIFS}
        categorie="Conversions · taux (Wilson 95 %)"
        methode={`Le taux le plus haut parmi les objectifs dont l'échantillon suffit (au moins ${FAIBLE_SOUS_PROPORTION} conversions et ${FAIBLE_SOUS_PROPORTION} non-conversions) ; un objectif au taux plus haut mais à l'échantillon faible est écarté, et nommé sous le chiffre. Intervalle de confiance à 95\u00a0% (méthode de Wilson).`}
      />
    </RangeeKpi>
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
  return <RankBar data={data} max={100} labelWidth="12rem" legende={"Taux de conversion par objectif (taux ± marge d'incertitude à 95\u00a0%)"} />;
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
    <div className="grid min-w-0 gap-2 sm:grid-cols-2">
      {rows.map((g) => (
        <div key={g.id} className="min-w-0 rounded-lg border border-line p-2.5" data-testid="conversion-appareils">
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

/**
 * Désactiver (ou réactiver) et supprimer un objectif, sur sa ligne. Désactiver se
 * défait (Activer) : un clic suffit ; Supprimer efface la définition : confirmé.
 */
function ActionsObjectif({ g }: { g: Pick<GoalConversionLue, "id" | "app_id" | "name" | "active"> }) {
  return (
    <div className="flex items-start gap-2">
      <form action={toggleGoalAction}>
        <input type="hidden" name="id" value={g.id} />
        <input type="hidden" name="app" value={g.app_id} />
        <input type="hidden" name="active" value={g.active ? "false" : "true"} />
        <button type="submit" className="btn-ghost px-2 py-1" aria-label={`${g.active ? "Désactiver" : "Activer"} l’objectif ${g.name}`}>
          {g.active ? "Désactiver" : "Activer"}
        </button>
      </form>
      <form action={deleteGoalAction}>
        <input type="hidden" name="id" value={g.id} />
        <input type="hidden" name="app" value={g.app_id} />
        <ConfirmationDanger
          libelle="Supprimer"
          libelleAccessible={`Supprimer l’objectif ${g.name}`}
          question={`Supprimer l’objectif ${entreGuillemets(g.name)}\u00a0?`}
          consequence="Sa définition sera effacée et il disparaîtra des conversions ; les données collectées, elles, restent."
          confirmer="Supprimer l’objectif"
          enCours="Suppression…"
          testid={`supprimer-objectif-${g.id}`}
        />
      </form>
    </div>
  );
}

/**
 * G5 — Objectif · Taux · Conversions (sessions) · App · Condition · Dernière
 * conversion · Actions (admin). Le taux vient juste après le nom : à 390 px, il se
 * lit sans faire défiler la table (recette du 26/09/2026).
 */
function TableObjectifs({
  rows,
  plusieursApps,
  isAdmin,
  nomApp,
}: {
  rows: GoalConversionLue[];
  plusieursApps: boolean;
  isAdmin: boolean;
  nomApp: (app: string) => string;
}) {
  const colonnes = 5 + (plusieursApps ? 1 : 0) + (isAdmin ? 1 : 0);
  return (
    <>
      {/* Défilement signalé : à 390 px, les dernières colonnes étaient hors champ sans
          aucun indice (recette 26/09). */}
      <TableDefilante className="card" label="Objectifs">
        <table className="w-full min-w-[40rem] text-sm">
          <caption className="caption-top px-4 pt-3 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
            Objectifs
          </caption>
          <thead className="bg-panel2">
            <tr>
              <th scope="col" className="th sticky left-0 bg-panel2">
                Objectif
              </th>
              <th scope="col" className="th w-56">
                Taux
              </th>
              <th scope="col" className="th" title={DEFINITION_CONVERSION}>
                Conversions (sessions)
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
                Dernière conversion
              </th>
              {isAdmin && (
                <th scope="col" className="th">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {rows.map((g) => (
              <tr key={g.id} id={`objectif-${g.id}`} className="scroll-mt-6 transition hover:bg-panel2/60">
                <th scope="row" className="sticky left-0 bg-panel px-3 py-1.5 text-left font-medium text-ink">
                  {g.name}
                </th>
                {/* `min-w-[12rem]` : sans elle, à 390 px, la colonne cédait sa largeur aux
                    suivantes, la barre disparaissait et l'intervalle tenait sur quatre lignes. */}
                <td className="px-3 py-1.5">
                  <div className="flex min-w-[12rem] items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel2">
                      {/* La couleur du taux est celle des barres du hero et des petits
                          multiples (série principale) : elle passait du orange au bleu. */}
                      {g.rate != null && (
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.min(100, g.rate * 100)}%`, backgroundColor: SERIE.principale }}
                        />
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
                <td className="px-3 py-1.5 tabular-nums text-ink-soft">
                  {formater("count", g.conversions)} sur {formater("count", g.sessions)}
                </td>
                {plusieursApps && (
                  <td className="px-3 py-1.5 text-xs text-ink-soft" title={g.app_id}>
                    {nomApp(g.app_id)}
                  </td>
                )}
                <td className="px-3 py-1.5 font-mono text-xs text-ink-soft">{libelleCondition(g)}</td>
                <td className="px-3 py-1.5 text-xs tabular-nums text-ink-soft">
                  {g.derniere ? fmtDate(g.derniere) : "—"}
                </td>
                {isAdmin && (
                  <td className="px-3 py-1.5">
                    <ActionsObjectif g={g} />
                  </td>
                )}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={colonnes} className="px-4 py-8 text-center text-ink-soft">
                  Aucun objectif actif{isAdmin ? " : créez-en un ci-dessous" : ""}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableDefilante>
      <p className="sr-only">{DEFINITION_CONVERSION}</p>
    </>
  );
}

/**
 * G6 — gestion des objectifs (admin) : la création, puis les objectifs ABSENTS de la
 * table (désactivés, ou d'une application interne que « toutes » ne compte pas). Les
 * objectifs actifs de la table se gèrent sur leur ligne : les lister une seconde fois
 * doublait l'écran (recette du 26/09/2026).
 */
function Gestion({
  apps,
  allGoals,
  dejaListes,
  appParDefaut,
  nomApp,
}: {
  apps: { app_id: string; name: string }[];
  allGoals: Awaited<ReturnType<typeof listGoals>>;
  dejaListes: ReadonlySet<number>;
  appParDefaut: string | null;
  nomApp: (app: string) => string;
}) {
  const autres = allGoals.filter((g) => !dejaListes.has(g.id));
  const tousInactifs = autres.every((g) => !g.active);
  return (
    <>
      <div className="card mb-6 p-4">
        <form action={createGoalAction} className="flex flex-wrap items-end gap-3" data-testid="create-goal">
          {/* Bornée à la carte : la liste prend la largeur de son plus long nom
              d'application, et un nom long élargissait la page sur mobile. */}
          <label className="min-w-0 max-w-full text-xs font-medium text-ink-soft">
            Application
            <select name="app" className="field mt-1 block w-full max-w-full" required defaultValue={appParDefaut ?? ""}>
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

      {autres.length > 0 && (
        // Défilement signalé : Statut était coupé (« act ») et les actions invisibles.
        <TableDefilante className="card" label={tousInactifs ? "Objectifs désactivés" : "Autres objectifs"}>
          <table className="w-full min-w-[36rem] text-sm" data-testid="objectifs-autres">
            <caption className="caption-top px-4 pt-3 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
              {tousInactifs ? "Objectifs désactivés" : "Autres objectifs"}
            </caption>
            <thead className="bg-panel2">
              <tr>
                <th scope="col" className="th">Objectif</th>
                <th scope="col" className="th">App</th>
                <th scope="col" className="th">Condition</th>
                <th scope="col" className="th">Statut</th>
                <th scope="col" className="th">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {autres.map((g) => (
                <tr key={g.id} className="transition hover:bg-panel2/60">
                  <th scope="row" className="px-4 py-2 text-left font-medium text-ink">
                    {g.name}
                  </th>
                  <td className="px-3 py-1.5 text-xs text-ink-soft" title={g.app_id}>
                    {nomApp(g.app_id)}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs text-ink-soft">{libelleCondition(g)}</td>
                  <td className="px-3 py-1.5">
                    <span
                      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${g.active ? "bg-good/10 text-good-ink" : "bg-panel2 text-ink-soft"}`}
                    >
                      {g.active ? "actif" : "inactif"}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    <ActionsObjectif g={g} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableDefilante>
      )}
    </>
  );
}
