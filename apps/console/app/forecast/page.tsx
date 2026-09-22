// Écran « Tendances » (§ 5.20, F65) : « Si la tendance des 14 derniers jours
// continue, quand franchit-on le seuil, et cette tendance se distingue-t-elle du
// bruit ? » (libellé « Tendances », jamais « Prévisions » : ce n'est pas une prévision).
//
// CE QUI CHANGE, ET POURQUOI (DF4).
//   - La fenêtre : 14 jours COMPLETS dans le fuseau de l'app, aujourd'hui exclu.
//     L'ancienne lecture mêlait deux demi-journées (la première et aujourd'hui) aux
//     douze jours complets, et « LCP actuel » prenait la journée entamée.
//   - La droite n'est plus une échéance d'office : elle est tracée sur les jours
//     d'au moins 30 mesures, avec la dispersion des points autour d'elle ; une
//     échéance ne s'écrit que si la pente dépasse ce bruit (`penteSignificative`).
//   - Le ratio d'erreurs n'a pas de seuil (aucun n'est publié, R-S) : ni verdict,
//     ni « franchira ». Le trafic n'a pas de droite : 14 jours lisent un cycle
//     hebdomadaire comme une tendance ; il se lit contre le même jour J−7.
//   - Un seul composant de série, `ThresholdSeries` (bandes de `lib/rating.ts`) ;
//     `ForecastChart`, `MetricCard` et `ForecastSpark` disparaissent.
//
// PORTES OUVERTES. P*.3 (anomalies quotidiennes) posera ses annotations sur ces
// séries (`annotations` de `ThresholdSeries`) ; P*.4 (test de pente, bande de
// prédiction) remplacera `tendance()` sans toucher à la mise en page.
//
// Chaque section lit par `lire()` : une lecture en échec ne fait tomber qu'elle.
import Link from "next/link";
import type { ReactNode } from "react";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { PageHeader } from "@/components/PageHeader";
import { Figure } from "@/components/charts/Figure";
import { KpiTile } from "@/components/charts/KpiTile";
import { ThresholdSeries } from "@/components/charts/ThresholdSeries";
import { EtatSurface, type Etat } from "@/components/states/EtatSurface";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import { getUser } from "@/lib/auth";
import type { SearchParams } from "@/lib/filters";
import { formater } from "@/lib/fmt-ids";
import {
  HORIZON_JOURS,
  JOURS_VALIDES_REQUIS,
  K_BRUIT,
  MESURES_MIN_JOUR,
  buildForecastNarrative,
  cleJour,
  echeanceLcp,
  joursComplets,
  pointsTendance,
  projectAt,
  tendance,
  type Tendance,
} from "@/lib/forecast";
import { liensDesJours } from "@/lib/forecast-liens";
import { SOURCES_TENDANCES, couvertureJour } from "@/lib/forecast-comparaison";
import { fuseauDe } from "@/lib/fuseau";
import { lire } from "@/lib/lecture";
import { pageFilters } from "@/lib/page-filters";
import { ratioPour100 } from "@/lib/perf-domain";
import { dailyLcpSeries, dailyTraffic, GRID_DAYS } from "@/lib/queries-grid";
import { hrefWithQuery } from "@/lib/query-contract";
import { THRESHOLDS } from "@/lib/rating";

export const dynamic = "force-dynamic";

// Borne « Bon » du LCP, lue dans lib/rating.ts : l'échéance se calcule contre elle.
const LCP_BON = THRESHOLDS.LCP[0];
const LCP_BON_TEXTE = formater("ms", LCP_BON);

/** « 10/09 » d'une clé de jour « AAAA-MM-JJ » (une étiquette, lue sans fuseau). */
function jjmm(jour: string | undefined): string {
  if (!jour) return "—";
  const [, m, j] = jour.split("-");
  return `${j}/${m}`;
}

/** L'état d'une tendance, en une ligne de méta. */
function texteTendance(t: Tendance, unite: string): string {
  if (t.etat === "insuffisante") return `tendance non calculée : ${JOURS_VALIDES_REQUIS} jours mesurés requis, ${t.joursValides} disponibles`;
  const pente = t.fit ? `${t.fit.slope >= 0 ? "+" : "−"}${formater(unite === "ms" ? "ms" : "pour100", Math.abs(t.fit.slope))} par jour` : "";
  return t.etat === "bruit" ? `tendance non distinguable du bruit (${pente})` : `tendance établie (${pente})`;
}

const TON_SYNTHESE = {
  risk: "border-bad/40 bg-bad/5",
  watch: "border-warn/50 bg-warn/10",
  ok: "border-line bg-panel2/60",
} as const;

function Methode() {
  return (
    <details className="card mt-6 p-4 text-sm sm:p-5" data-testid="methode">
      <summary className="cursor-pointer select-none text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
        Méthode
      </summary>
      <p className="mt-2 leading-relaxed text-ink-soft">
        Droite des moindres carrés sur les jours d&apos;au moins {MESURES_MIN_JOUR} mesures ; bande = ± 1 écart type des
        résidus ; échéance écrite seulement si la pente sur {GRID_DAYS} jours dépasse {K_BRUIT} écarts types ; aucune
        saisonnalité ; ce n&apos;est pas une prévision. Au moins {JOURS_VALIDES_REQUIS} jours valides sont requis pour
        tracer une droite. Les journées sont découpées dans le fuseau de l&apos;application ; la journée en cours est
        exclue. Aucun seuil publié n&apos;existe pour le ratio d&apos;erreurs ni pour le trafic : ils se lisent sans verdict.
      </p>
    </details>
  );
}

export default async function Tendances({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ecran = await pageFilters(await searchParams, "/forecast");
  if (!ecran.ok) return <FilterProblemNotice title="Tendances" problem={ecran.problem} />;
  const f = ecran.filters;
  const query = ecran.query;
  const [fuseau, user, traficLu, lcpLu] = await Promise.all([
    fuseauDe(query.scope.requestedApp),
    getUser(),
    lire(() => dailyTraffic(f, { exclureAujourdhui: true })),
    lire(() => dailyLcpSeries(f, { exclureAujourdhui: true })),
  ]);

  // L'AXE : les 14 jours complets rendus par la lecture (même expression SQL pour
  // les deux) ; sans aucune lecture, ceux du fuseau de l'app, calculés ici.
  const jours = lcpLu.ok
    ? lcpLu.data.map((r) => r.jour)
    : traficLu.ok
      ? traficLu.data.map((t) => cleJour(t.day))
      : joursComplets(fuseau, Date.now(), GRID_DAYS);
  const dernier = jours.length - 1;
  const semainePrecedente = dernier - 7;

  const lcpParJour = new Map((lcpLu.ok ? lcpLu.data : []).map((r) => [r.jour, r]));
  const traficParJour = new Map((traficLu.ok ? traficLu.data : []).map((t) => [cleJour(t.day), t]));
  const lcp = jours.map((j) => lcpParJour.get(j)?.p75 ?? null);
  const mesures = jours.map((j) => lcpParJour.get(j)?.n ?? 0);
  const vues = jours.map((j) => Number(traficParJour.get(j)?.pageviews ?? 0));
  const occurrences = jours.map((j) => Number(traficParJour.get(j)?.errors ?? 0));
  const ratios = jours.map((_j, i) => ratioPour100(occurrences[i], vues[i]));

  // ─────────────── Tendances ───────────────
  const tLcp = tendance(lcp, mesures);
  const tRatio = tendance(ratios, vues);
  const hero = pointsTendance(jours, lcp, mesures, tLcp);

  // Échéance (TE1) : contre la dernière valeur RETENUE (≥ 30 mesures) ; un seuil
  // déjà dépassé se dit même sans pente — c'est une mesure, pas une projection.
  // « Dépassé » au sens de lib/rating.ts : 2 500 ms est encore « Bon » (`echeanceLcp`).
  const courant = [...tLcp.retenues].reverse().find((v) => v !== null) ?? null;
  const eta = echeanceLcp(tLcp.fit, courant);
  const synthese = buildForecastNarrative([{ label: "LCP p75", thresholdLabel: LCP_BON_TEXTE, eta, tendance: tLcp }]);

  // Jour de référence des tuiles (même jour, semaine précédente) : sa couverture est
  // LUE (§ 3.2) — une collecte commencée ce jour-là ne donne pas « +1 900 % ».
  const jourRef = jours[semainePrecedente];
  const [couvLcp, couvRatio, couvVues] = await Promise.all([
    jourRef && lcpLu.ok ? couvertureJour(query, SOURCES_TENDANCES.lcp, jourRef, fuseau, mesures[semainePrecedente] ?? 0) : null,
    jourRef && traficLu.ok ? couvertureJour(query, SOURCES_TENDANCES.ratio, jourRef, fuseau, vues[semainePrecedente] ?? 0) : null,
    // Un compte de pages vues n'est pas un échantillon : pas de garde d'effectif, seulement la couverture.
    jourRef && traficLu.ok ? couvertureJour(query, SOURCES_TENDANCES.vues, jourRef, fuseau, null) : null,
  ]);

  // ─────────────── Liens (bornes UTC du jour local, § 3.3) ───────────────
  const gabarit = (chemin: string) => hrefWithQuery(chemin, query, { period: null, from: "{from}", to: "{to}" });
  const liensVue = liensDesJours(gabarit("/"), jours, fuseau);
  const liensErreurs = liensDesJours(gabarit("/errors"), jours, fuseau);
  const peutEcrire = user?.role === "admin" && !user.demo;
  const lienAlerte = (() => {
    const p = new URLSearchParams();
    if (query.scope.requestedApp) p.set("app", query.scope.requestedApp);
    p.set("regle_metrique", "LCP");
    p.set("regle_seuil", String(LCP_BON));
    return `/alerts?${p}#nouvelle-regle`;
  })();

  const referenceJ7 = `vs même jour, semaine précédente (${jjmm(jours[semainePrecedente])})`;
  const dateDernier = jjmm(jours[dernier]);
  const aucuneMesureLcp = lcpLu.ok && mesures.every((n) => n === 0);
  const aucuneVue = traficLu.ok && vues.every((v) => v === 0);

  const etatHero: Etat | undefined = !lcpLu.ok
    ? { kind: "erreur", titre: "LCP p75 quotidien" }
    : aucuneMesureLcp
      ? { kind: "vide", population: "mesure LCP", plage: `${GRID_DAYS} jours complets` }
      : undefined;
  const etatRatio: Etat | undefined = !traficLu.ok
    ? { kind: "erreur", titre: "Occurrences d'erreurs pour 100 pages vues" }
    : aucuneVue
      ? { kind: "vide", population: "page vue", plage: `${GRID_DAYS} jours complets` }
      : undefined;
  const etatVues: Etat | undefined = !traficLu.ok
    ? { kind: "erreur", titre: "Pages vues par jour" }
    : aucuneVue
      ? { kind: "vide", population: "page vue", plage: `${GRID_DAYS} jours complets` }
      : undefined;

  const seriesHero = [
    { cle: "observe", libelle: "LCP p75 du jour", role: "principale" as const, effectifCle: "n" },
    ...(tLcp.fit
      ? [{ cle: "ajuste", libelle: tLcp.etat === "bruit" ? "Droite ajustée (dans le bruit)" : "Droite ajustée", role: "reference" as const }]
      : []),
    ...(tLcp.etat === "significative" ? [{ cle: "projection", libelle: `Projection sur ${HORIZON_JOURS} jours`, role: "projection" as const }] : []),
  ];
  const pointsRatio = jours.map((t, i) => ({
    t,
    ratio: ratios[i],
    vues: vues[i],
    ajuste: tRatio.etat === "significative" && tRatio.fit ? projectAt(tRatio.fit, i) : null,
  }));
  const pointsVues = jours.map((t, i) => ({ t, vues: vues[i], vues_j7: i >= 7 ? vues[i - 7] : null }));

  const kpi = (contenu: ReactNode) => <div className="min-w-0">{contenu}</div>;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Tendances"
        domain="fiabilite"
        help="forecast"
        sub="Si la tendance des 14 derniers jours continue, quand franchit-on le seuil, et cette tendance se distingue-t-elle du bruit ?"
      />

      {/* 1 — Bandeau de fenêtre fixe : la plage du haut ne s'applique pas, et on le dit avec les dates. */}
      <p role="note" data-testid="fenetre-fixe" className="-mt-2 mb-5 rounded-lg border border-line bg-panel2/60 px-4 py-2 text-xs text-ink-soft">
        {GRID_DAYS} jours complets, du {jjmm(jours[0])} au {dateDernier}, fuseau de l&apos;app ({fuseau}) ; la plage
        choisie en haut ne s&apos;applique pas ; la journée en cours est exclue.
      </p>

      {/* 2 — Synthèse (TE1) : une échéance seulement si la pente dépasse le bruit. */}
      <section role="note" aria-label="Synthèse" data-testid="synthese" className={`mb-6 rounded-xl border px-4 py-3 ${TON_SYNTHESE[synthese.status]}`}>
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">Synthèse</h2>
        {!lcpLu.ok ? (
          <p className="mt-1 text-sm text-ink">LCP non lu (lecture en échec) : aucune synthèse n&apos;est calculée.</p>
        ) : (
          <ul className="mt-1.5 space-y-0.5 text-sm text-ink">
            {synthese.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
        {peutEcrire && lcpLu.ok && (
          <Link href={lienAlerte} className="mt-2 inline-block text-xs font-medium text-perf underline-offset-2 hover:underline">
            Créer une alerte sur ce seuil ({LCP_BON_TEXTE})
          </Link>
        )}
      </section>

      {/* 3 — Chiffres du dernier jour complet, contre le même jour de la semaine précédente. */}
      <section aria-label="Dernier jour complet" className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {kpi(
          !lcpLu.ok ? (
            <EchecLecture titre="LCP p75, dernier jour complet" compact />
          ) : (
            <KpiTile
              label={`LCP p75, dernier jour complet (${dateDernier})`}
              valeur={lcp[dernier] ?? null}
              format="ms"
              vital="LCP"
              raisonNull="aucune mesure LCP ce jour-là"
              serie={lcp}
              couverture={{ n: mesures[dernier] ?? 0, unite: "mesures LCP" }}
              precedent={semainePrecedente >= 0 ? (lcp[semainePrecedente] ?? null) : undefined}
              reference={referenceJ7}
              couverturePrecedente={couvLcp ?? undefined}
              href={hrefWithQuery("/pages", query, { vital: "LCP" })}
            />
          ),
        )}
        {kpi(
          !traficLu.ok ? (
            <EchecLecture titre="Occurrences d'erreurs pour 100 pages vues" compact />
          ) : (
            <KpiTile
              label={`Occurrences d'erreurs pour 100 pages vues, dernier jour complet (${dateDernier})`}
              valeur={ratios[dernier] ?? null}
              format="pour100"
              sensMeilleur="bas"
              raisonNull="aucune page vue ce jour-là"
              lecture="Inclut les erreurs sans page vue (backend) : le ratio peut dépasser 100."
              couverture={{ n: vues[dernier] ?? 0, unite: "pages vues", faibleSous: MESURES_MIN_JOUR }}
              precedent={semainePrecedente >= 0 ? (ratios[semainePrecedente] ?? null) : undefined}
              reference={referenceJ7}
              couverturePrecedente={couvRatio ?? undefined}
              href={hrefWithQuery("/errors", query)}
            />
          ),
        )}
        {kpi(
          !traficLu.ok ? (
            <EchecLecture titre="Pages vues, dernier jour complet" compact />
          ) : (
            <KpiTile
              label={`Pages vues, dernier jour complet (${dateDernier})`}
              valeur={vues[dernier] ?? 0}
              format="count"
              sensMeilleur="neutre"
              precedent={semainePrecedente >= 0 ? (vues[semainePrecedente] ?? null) : undefined}
              reference={referenceJ7}
              couverturePrecedente={couvVues ?? undefined}
            />
          ),
        )}
      </section>

      {/* 4 — Hero (TE5) : 14 jours observés, droite ajustée, projection si la pente dépasse le bruit. */}
      <SectionErreur titre="LCP p75 quotidien et sa tendance">
        <Figure
          titre="LCP p75 quotidien et sa tendance"
          id="tendance-lcp"
          aide="LCP"
          etat={etatHero}
          meta={
            etatHero ? undefined : (
              <>
                <span>
                  {GRID_DAYS} jours complets ({fuseau})
                </span>
                <span>
                  {tLcp.joursValides} jour{tLcp.joursValides > 1 ? "s" : ""} d&apos;au moins {MESURES_MIN_JOUR} mesures
                </span>
                <span>{texteTendance(tLcp, "ms")}</span>
                {tLcp.etat === "significative" && tLcp.dispersion !== null && (
                  <span>bande ± {formater("ms", tLcp.dispersion)}</span>
                )}
              </>
            )
          }
          lecture={
            <>
              Points creux : moins de {MESURES_MIN_JOUR} mesures, exclus de l&apos;ajustement. Droite grise : moindres
              carrés sur les jours valides, tracée sur les {GRID_DAYS} jours pour voir si elle colle aux points.
              {tLcp.etat === "significative"
                ? ` Pointillé : projection sur ${HORIZON_JOURS} jours dans une bande de ± 1 écart type des résidus.`
                : tLcp.etat === "bruit"
                  ? " La pente ne dépasse pas le bruit : aucune projection, aucune échéance."
                  : ""}{" "}
              Un point ouvre la Vue d&apos;ensemble sur ce jour (bornes converties en UTC).
            </>
          }
          alternative={
            etatHero
              ? undefined
              : {
                  legende: "LCP p75 par jour, droite ajustée et projection",
                  colonnes: ["Jour", "LCP p75", "Mesures", "Droite ajustée", "Projection", "Bande basse", "Bande haute"],
                  lignes: hero.points.map((p) => [
                    jjmm(p.t),
                    formater("ms", p.observe),
                    p.n,
                    formater("ms", p.ajuste),
                    formater("ms", p.projection),
                    formater("ms", p.bas),
                    formater("ms", p.haut),
                  ]),
                }
          }
        >
          <div className="flex flex-col gap-3">
            {tLcp.etat === "insuffisante" && (
              <EtatSurface
                etat={{
                  kind: "partiel",
                  raison: `tendance non calculée : ${JOURS_VALIDES_REQUIS} jours mesurés requis, ${tLcp.joursValides} disponibles`,
                }}
                compact
              />
            )}
            {tLcp.etat === "bruit" && (
              <p className="text-xs text-ink-soft" data-testid="tendance-bruit">
                Tendance non distinguable du bruit : la pente sur {GRID_DAYS} jours ne dépasse pas {K_BRUIT} écarts types
                des résidus.
              </p>
            )}
            <ThresholdSeries
              grille={hero.grille}
              points={hero.points}
              series={seriesHero}
              format="ms"
              vital="LCP"
              faibleSous={MESURES_MIN_JOUR}
              bande={tLcp.etat === "significative" ? { basseCle: "bas", hauteCle: "haut", libelle: "± 1 écart type des résidus" } : undefined}
              seauSecondes={86_400}
              fuseau={fuseau}
              liensSeaux={liensVue}
              ariaLabel={`LCP p75 quotidien sur ${GRID_DAYS} jours complets, droite ajustée${tLcp.etat === "significative" ? ` et projection à ${HORIZON_JOURS} jours` : ""}, 3 zones de seuil`}
            />
          </div>
        </Figure>
      </SectionErreur>

      {/* 5 — Deux petits multiples, sans seuil ni échéance. */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionErreur titre="Occurrences d'erreurs pour 100 pages vues">
          <Figure
            titre="Occurrences d'erreurs pour 100 pages vues"
            id="tendance-erreurs"
            etat={etatRatio}
            meta={
              etatRatio ? undefined : (
                <>
                  <span>par jour, {fuseau}</span>
                  <span>{texteTendance(tRatio, "pour100")}</span>
                </>
              )
            }
            lecture="Aucun seuil n'est publié pour ce ratio : ni verdict, ni échéance. Droite tracée seulement si la pente dépasse le bruit. Points creux : moins de 30 pages vues. Un point ouvre les erreurs de ce jour."
            alternative={
              etatRatio
                ? undefined
                : {
                    legende: "Occurrences d'erreurs pour 100 pages vues, par jour",
                    colonnes: ["Jour", "Pour 100 pages vues", "Occurrences", "Pages vues"],
                    lignes: jours.map((j, i) => [jjmm(j), formater("pour100", ratios[i]), occurrences[i], vues[i]]),
                  }
            }
          >
            <ThresholdSeries
              grille={jours}
              points={pointsRatio}
              series={[
                { cle: "ratio", libelle: "Pour 100 pages vues", role: "principale", effectifCle: "vues" },
                ...(tRatio.etat === "significative" ? [{ cle: "ajuste", libelle: "Droite ajustée", role: "reference" as const }] : []),
              ]}
              format="pour100"
              faibleSous={MESURES_MIN_JOUR}
              seauSecondes={86_400}
              fuseau={fuseau}
              liensSeaux={liensErreurs}
              hauteur={140}
              ariaLabel={`Occurrences d'erreurs pour 100 pages vues, par jour, ${GRID_DAYS} jours complets`}
            />
          </Figure>
        </SectionErreur>

        <SectionErreur titre="Pages vues par jour">
          <Figure
            titre="Pages vues par jour"
            id="pages-vues-jour"
            etat={etatVues}
            meta={
              etatVues ? undefined : (
                <>
                  <span>par jour, {fuseau}</span>
                  <span>repère J−7 sur les 7 derniers jours</span>
                </>
              )
            }
            lecture="Pas de droite : sur 14 jours, une droite lirait le cycle de la semaine comme une tendance. Chaque jour se compare au même jour de la semaine précédente. Une barre ouvre la Vue d'ensemble sur ce jour."
            alternative={
              etatVues
                ? undefined
                : {
                    legende: "Pages vues par jour et même jour de la semaine précédente",
                    colonnes: ["Jour", "Pages vues", "Même jour, semaine précédente"],
                    lignes: pointsVues.map((p) => [jjmm(p.t), p.vues, p.vues_j7]),
                  }
            }
          >
            <ThresholdSeries
              grille={jours}
              points={pointsVues}
              series={[
                { cle: "vues", libelle: "Pages vues", role: "principale", forme: "barres", additive: true },
                { cle: "vues_j7", libelle: "Même jour, semaine précédente", role: "reference" },
              ]}
              format="count"
              seauSecondes={86_400}
              fuseau={fuseau}
              liensSeaux={liensVue}
              hauteur={140}
              ariaLabel={`Pages vues par jour sur ${GRID_DAYS} jours complets, repère du même jour de la semaine précédente`}
            />
          </Figure>
        </SectionErreur>
      </div>

      {/* 6 — Méthode (TE8). */}
      <Methode />
    </div>
  );
}
