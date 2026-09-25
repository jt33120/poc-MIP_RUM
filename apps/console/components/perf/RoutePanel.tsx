// Panneau route (F17, plan § 5.2.3) — rendu SERVEUR, fonction locale à `/pages`.
//
// QUALIFIER UNE ROUTE SANS QUITTER LE CLASSEMENT. Une ligne du hero ouvre
// `panel=route:<route>` (§ 3.3) ; le panneau lit lui-même ses cinq blocs et répond
// à « pourquoi cette page est lente : réseau, ressources, fil principal ? ».
// Il s'ouvre par l'URL : partageable, et il fonctionne SANS JavaScript (Fermer,
// « Ouvrir en page » et les liens sont de vrais liens ; `DetailPanelKeys` n'ajoute
// que Échap et le focus au titre).
//
// CE QU'IL NE FAIT PAS. Aucune fenêtre de temps propre (§ 3.5) : il lit la plage de
// l'écran, et l'écrit dans son contenu. Il n'est réutilisé nulle part ailleurs :
// aucune prop publique au sens du § 4.
//
// CHAQUE BLOC EST INDÉPENDANT (§ 3.8) : chaque lecture passe par `lire()` et son
// bloc est enveloppé de `SectionErreur` — un bloc en échec n'efface pas les autres.
//
// ROBOT ET RÉEL NE SE COMPARENT PAS EN MILLISECONDES (§ 1.5 DF1) : le bloc « Vu par
// le robot » ne rend que des ÉTATS. Aucune latence de sonde n'est affichée à côté
// d'un LCP ; la règle d'angle mort (CR9) est écrite en `title` et en `sr-only`.
import Link from "next/link";
import type { ReactNode } from "react";
import { DetailPanel, type PuceDetail } from "@/components/DetailPanel";
import { DistributionSeuils, alternativeDistribution, bacsDeHistogramme } from "@/components/charts/DistributionSeuils";
import { Figure } from "@/components/charts/Figure";
import { ThresholdSeries } from "@/components/charts/ThresholdSeries";
import { EtatSurface } from "@/components/states/EtatSurface";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import { sessionsDeLaRoute } from "@/lib/breakdowns";
import type { LecturePanneauRoute } from "@/lib/chargeurs/panneau-route";
import { LIBELLE_ETAT_ROBOT, regleAngleMort } from "@/lib/correlation";
import { EFFECTIF_MIN_HEURE, ecrireSerie } from "@/lib/correlation-serie";
import { formater, formatDuVital, type VitalName } from "@/lib/fmt-ids";
import { HISTO_BUCKETS } from "@/lib/distribution";
import { type SectionLue } from "@/lib/lecture";
import { bucketLabel, bucketStarts, hrefWithQuery, type AnalyticsQuery } from "@/lib/query-contract";
import type { SlowResource, VitalAgg, VitalPercentiles, VitalSeriesPoint } from "@/lib/queries";
import type { ErrorGroupRow } from "@/lib/queries-errors";
import type { Concordance, CorrCardRow } from "@/lib/queries-v2";
import { RATING_LABEL, rating2026 } from "@/lib/rating";
import { grilleIso, libelleSeauComplet } from "@/lib/series";
import { pointsRelease } from "@/lib/vue-ensemble";
import type { Fil } from "@mip/console-contract";

/** Ressources lentes montrées dans le panneau (§ 5.2.3). */
const RESSOURCES_PANNEAU = 3;
/** Groupes d'erreurs montrés dans le panneau (§ 5.2.3). */
const ERREURS_PANNEAU = 3;

const LIEN_BLOC =
  "inline-block rounded text-xs font-medium text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf";

/**
 * Un bloc du panneau : son titre, et son contenu ou l'échec de sa lecture (chaque
 * bloc a SA frontière, § 3.8). `titreDansLaFigure` pour les deux blocs dessinés :
 * c'est la `Figure` qui porte alors le titre, et on ne l'écrit pas deux fois.
 */
function Bloc({
  titre,
  id,
  titreDansLaFigure = false,
  children,
}: {
  titre: string;
  id: string;
  titreDansLaFigure?: boolean;
  children: ReactNode;
}) {
  return (
    <SectionErreur titre={titre}>
      <section aria-label={titreDansLaFigure ? titre : undefined} aria-labelledby={titreDansLaFigure ? undefined : `${id}-titre`} className="min-w-0" data-testid={id}>
        {!titreDansLaFigure && (
          <h3 id={`${id}-titre`} className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
            {titre}
          </h3>
        )}
        {children}
      </section>
    </SectionErreur>
  );
}

export function RoutePanel({
  route,
  query,
  vital,
  lecture,
  reglages = {},
}: {
  /** Valeur décodée de `panel=route:<r>`. */
  route: string;
  /** Requête résolue de la page (§ 3.3) : plage, périmètre, filtres. */
  query: AnalyticsQuery;
  /** `vital=` de la page (défaut LCP). */
  vital: VitalName;
  /** Ce que le chargeur de `/pages` a lu pour cette route (`lib/chargeurs/panneau-route.ts`), sur le fil. */
  lecture: Fil<LecturePanneauRoute>;
  /**
   * ÉCART AU PLAN (§ 5.2.3, signature à quatre props) : les réglages de vue de
   * l'écran (`vital`, `cmp`, `tri`, `vue`…) ne sont pas portés par `query`.
   * Sans eux, « Fermer » ramènerait un classement retrié et une comparaison
   * perdue. La page les passe ici ; `null` retire le paramètre.
   */
  reglages?: Record<string, string | null>;
}) {
  const { plage, serieRoute, serieEnsemble, pctsLus, pctsDuVital, ensemble, reel, cartes, concordance, ressources, erreurs, vues, plafond, plafondLibelle, histo } =
    lecture;
  const seau = query.range.bucketSeconds;
  const grille = grilleIso(bucketStarts(query.range));

  // Liens de l'écran (§ 3.3) : la plage et les filtres suivent partout ; les
  // réglages de vue ne suivent que sur `/pages`.
  const ici = (extra: Record<string, string | null>) => hrefWithQuery("/pages", query, { ...reglages, ...extra });
  const fermerHref = ici({ panel: null });
  const pageHref = ici({ panel: null, route });
  // Les sessions passées par la route : la recherche exacte de `/sessions`, jamais
  // `route=`, que l'écran refuse (une session ne porte pas de route) — même quand la
  // page le porte, après « Ouvrir en page ». Sous un filtre que `/sessions` refuse
  // aussi (release, env…), pas de lien : la raison est écrite à sa place (V10).
  const sessions = sessionsDeLaRoute(query, route, new Set(lecture.schema));
  const erreursHref = hrefWithQuery("/errors", query, { route });

  const totalVues = vues.ok ? vues.data.reduce((s, p) => s + p.chargements + p.spa + p.inconnu, 0) : null;
  const mesures = pctsDuVital?.n ?? (serieRoute.ok ? serieRoute.data.reduce((s, p) => s + p.n, 0) : null);
  const puces: PuceDetail[] = [
    { label: "Vues", valeur: vues.ok ? formater("count", totalVues) : "non lu" },
    { label: `Mesures ${vital}`, valeur: pctsLus || serieRoute.ok ? formater("count", mesures) : "non lu" },
  ];

  return (
    <DetailPanel
      type="route"
      titre={<span className="chip-mono break-all">{route}</span>}
      puces={puces}
      fermerHref={fermerHref}
      pageHref={pageHref}
    >
      <div className="space-y-5">
        <p className="text-xs text-ink-soft">
          Plage de l&apos;écran : {plage}. Le panneau n&apos;a pas de fenêtre de temps propre : il lit la plage et les
          filtres de la page, intersectés avec cette route.
        </p>

        <Bloc titre={`${vital} sur cette route`} id="panneau-route-serie" titreDansLaFigure>
          <SerieRoute
            vital={vital}
            route={route}
            grille={grille}
            seau={seau}
            plage={plage}
            serieRoute={serieRoute}
            serieEnsemble={serieEnsemble}
          />
        </Bloc>

        <Bloc titre="Où se situe cette route" id="panneau-route-distribution" titreDansLaFigure>
          <DistributionRoute
            vital={vital}
            histo={histo}
            percentiles={pctsDuVital}
            pctsLus={pctsLus}
            plafond={plafond}
            plafondLibelle={plafondLibelle}
            plage={plage}
            ensemble={ensemble.ok ? (ensemble.data.find((v) => v.name === vital) ?? null) : null}
            ensembleLu={ensemble.ok}
          />
        </Bloc>

        <Bloc titre="Vu par le robot" id="panneau-route-robot">
          <VuParLeRobot
            route={route}
            cartes={cartes}
            concordance={concordance}
            reel={reel}
            hrefCorrelation={(serie) => hrefWithQuery("/correlation", query, { serie })}
          />
        </Bloc>

        <Bloc titre="Ressources lentes de la route" id="panneau-route-ressources">
          <RessourcesRoute lecture={ressources} plage={plage} />
        </Bloc>

        <Bloc titre="Erreurs sur la route" id="panneau-route-erreurs">
          <ErreursRoute lecture={erreurs} plage={plage} href={erreursHref} />
        </Bloc>

        <nav aria-label="Poursuivre depuis cette route" className="flex flex-wrap gap-x-4 gap-y-2 border-t border-line pt-4">
          {sessions.href !== null && (
            <Link href={sessions.href} className={LIEN_BLOC} data-testid="panneau-route-sessions">
              Sessions sur cette route
            </Link>
          )}
          <Link href={pageHref} className={LIEN_BLOC} data-testid="panneau-route-page">
            Ouvrir en page
          </Link>
          {sessions.href === null && (
            <p className="basis-full text-xs text-ink-soft" title={sessions.raison} data-testid="panneau-route-sessions-indisponible">
              {sessions.raison}
            </p>
          )}
        </nav>
      </div>
    </DetailPanel>
  );
}

/**
 * « <vital> sur cette route » (§ 5.2.3) : la série de la route et, en pointillé, la
 * série de l'ENSEMBLE sur les mêmes seaux — deux séries au plus (P14). Une route
 * qui suit l'ensemble n'a pas de problème à elle : c'est ce que la référence dit.
 */
function SerieRoute({
  vital,
  route,
  grille,
  seau,
  plage,
  serieRoute,
  serieEnsemble,
}: {
  vital: VitalName;
  route: string;
  grille: string[];
  seau: number;
  plage: string;
  serieRoute: SectionLue<VitalSeriesPoint[]>;
  serieEnsemble: SectionLue<VitalSeriesPoint[]>;
}) {
  const titre = `${vital} sur cette route`;
  const fmt = formatDuVital(vital);
  if (!serieRoute.ok) return <EchecLecture titre={titre} compact />;
  const points = pointsRelease(grille, serieRoute.data, serieEnsemble.ok ? serieEnsemble.data : []);
  const mesures = points.reduce((s, p) => s + p.nb, 0);
  if (mesures === 0) {
    return <EtatSurface etat={{ kind: "vide", population: `mesure ${vital} sur ${route}`, plage }} />;
  }
  const largeur = bucketLabel(seau);
  return (
    <Figure
      titre={titre}
      id="figure-route-serie"
      meta={
        <>
          <span>p75 par seau de {largeur}</span>
          <span>{formater("count", mesures)} mesures</span>
          <span>{plage}, UTC</span>
          {!serieEnsemble.ok && <span>référence de l&apos;ensemble non lue</span>}
        </>
      }
      lecture={
        <>
          Trait plein : cette route. Pointillé gris : l&apos;ensemble des routes de la population filtrée, mêmes seaux.
          Un seau sans mesure est un trou, jamais un zéro.
        </>
      }
      alternative={{
        legende: `${titre} : p75 par seau de ${largeur} sur ${plage} (UTC), face au p75 de l'ensemble des routes`,
        colonnes: ["Seau (UTC)", "p75 de la route", "Mesures", "p75 de l'ensemble", "Mesures de l'ensemble"],
        lignes: points.map((p) => [
          libelleSeauComplet(p.t, seau, "UTC"),
          formater(fmt, p.b),
          p.nb,
          formater(fmt, p.a),
          p.na,
        ]),
      }}
    >
      <ThresholdSeries
        grille={grille}
        points={points}
        series={[
          { cle: "b", libelle: `${vital} p75 — ${route}`, role: "principale", effectifCle: "nb" },
          ...(serieEnsemble.ok
            ? [{ cle: "a", libelle: "Ensemble des routes", role: "reference" as const, effectifCle: "na" }]
            : []),
        ]}
        format={fmt}
        vital={vital}
        seauSecondes={seau}
        fuseau="UTC"
        hauteur={180}
        ariaLabel={`${vital} p75 de ${route} par seau de ${largeur}, ${grille.length} seaux, 3 zones de seuil (Bon, À améliorer, Mauvais), comparé au p75 de l'ensemble des routes`}
      />
    </Figure>
  );
}

/**
 * « Où se situe cette route » (§ 5.2.3) : la distribution DE LA ROUTE, marquée du
 * p75 de l'ensemble — une valeur se lit contre une population NOMMÉE (§ 3.5).
 */
function DistributionRoute({
  vital,
  histo,
  percentiles,
  pctsLus,
  plafond,
  plafondLibelle,
  plage,
  ensemble,
  ensembleLu,
}: {
  vital: VitalName;
  histo: SectionLue<{ bucket: number; count: number }[]>;
  percentiles: VitalPercentiles | null;
  pctsLus: boolean;
  plafond: number;
  plafondLibelle: string | null;
  plage: string;
  ensemble: VitalAgg | null;
  ensembleLu: boolean;
}) {
  const titre = "Où se situe cette route";
  if (!histo.ok) return <EchecLecture titre={titre} compact />;
  const bacs = bacsDeHistogramme(histo.data, plafond, HISTO_BUCKETS);
  const n = bacs.reduce((s, b) => s + b.n, 0);
  if (n === 0) return <EtatSurface etat={{ kind: "vide", population: `mesure ${vital} sur cette route`, plage }} />;
  const p = percentiles?.pcts ?? null;
  const reperes = p ? { p50: p[0] ?? null, p75: p[1] ?? null, p95: p[3] ?? null } : null;
  const alternative = alternativeDistribution({ vital, bacs, plafond, percentiles: reperes, n });
  const plafondTexte = plafondLibelle ?? `plafond d'affichage : ${formater(formatDuVital(vital), plafond)} (par défaut)`;
  // Population de référence NOMMÉE : sans elle, pas de repère marqué (jamais un
  // trait sans dire de quelle population il vient).
  const marque = ensemble ? { valeur: ensemble.p75, libelle: "p75 toutes routes" } : undefined;
  return (
    <Figure
      titre={titre}
      id="figure-route-distribution"
      meta={
        <>
          <span>{formater("count", n)} mesures {vital}</span>
          <span>{plage}</span>
          <span data-testid="panneau-route-plafond">{plafondTexte}</span>
        </>
      }
      lecture={
        marque ? (
          <span data-testid="panneau-route-population">
            Le trait marqué est le p75 de TOUTES les routes de la population filtrée : cette route se lit contre elle.
          </span>
        ) : (
          <span data-testid="panneau-route-population">
            {ensembleLu
              ? `Aucun p75 ${vital} pour l'ensemble des routes sur ${plage} : aucun repère de population.`
              : "Le p75 de l'ensemble des routes n'a pas pu être lu : aucun repère de population."}
          </span>
        )
      }
      alternative={{ ...alternative, legende: `${alternative.legende} ${plafondTexte[0].toUpperCase()}${plafondTexte.slice(1)}.` }}
    >
      {!pctsLus && (
        <div className="mb-2">
          <EtatSurface compact etat={{ kind: "partiel", raison: "percentiles de la route non lus : repères absents, plafond par défaut." }} />
        </div>
      )}
      <DistributionSeuils
        vital={vital}
        bacs={bacs}
        plafond={plafond}
        plafondLibelle={plafondLibelle ?? undefined}
        percentiles={reperes}
        n={n}
        valeurMarquee={marque}
        alternative={false}
      />
    </Figure>
  );
}

/**
 * « Vu par le robot » (§ 5.2.3) : TROIS LIGNES D'ÉTATS, aucune valeur robot en
 * millisecondes à côté d'un LCP — un premier chargement de sonde et un LCP de
 * visiteur ne mesurent pas la même chose (§ 1.5 DF1). La règle d'angle mort (CR9)
 * est écrite en `title` et en `sr-only` : un état « ok » du robot n'est pas un
 * verdict « Bon ».
 *
 * Sous `app=all`, une ligne par app quand la route existe dans plusieurs apps ; le
 * « Réel » reste la population de l'écran, lu une fois.
 */
function VuParLeRobot({
  route,
  cartes,
  concordance,
  reel,
  hrefCorrelation,
}: {
  route: string;
  cartes: SectionLue<{ refus: null; data: CorrCardRow[] } | { refus: string }>;
  concordance: SectionLue<{ refus: null; data: Concordance } | { refus: string }>;
  reel: SectionLue<VitalAgg[]>;
  hrefCorrelation: (serie: string) => string;
}) {
  const titre = "Vu par le robot";
  if (!cartes.ok) return <EchecLecture titre={titre} compact />;
  if (cartes.data.refus !== null) {
    return <EtatSurface compact etat={{ kind: "partiel", raison: `robot non lu sur ce périmètre : ${cartes.data.refus}` }} />;
  }
  const regle = regleAngleMort(EFFECTIF_MIN_HEURE);
  const lcp = reel.ok ? (reel.data.find((v) => v.name === "LCP") ?? null) : null;
  const verdict = lcp ? rating2026("LCP", lcp.p75) : null;
  const ligneReelle = !reel.ok
    ? "lecture en échec"
    : lcp
      ? `LCP p75 ${formater("ms", lcp.p75)}, ${RATING_LABEL[verdict!]}`
      : "aucune mesure LCP sur cette route";

  const robots = cartes.data.data.filter((c) => c.route === route && (c.syn_state !== null || c.syn_latency_avg !== null));
  // F57 est livré : la ligne « Heures en angle mort » existe. Un refus du robot sur
  // ce périmètre la remplace par sa raison ; jamais un « 0 » qui se lirait « aucun ».
  const angles = concordance.ok && concordance.data.refus === null ? concordance.data.data.anglesMortsParRoute : null;
  const raisonAngles = !concordance.ok
    ? "lecture en échec"
    : concordance.data.refus !== null
      ? concordance.data.refus
      : null;

  const Ligne = ({ terme, children, testid }: { terme: string; children: ReactNode; testid?: string }) => (
    <>
      <dt className="text-ink-soft">{terme}</dt>
      <dd className="min-w-0 break-words text-ink" data-testid={testid}>
        {children}
      </dd>
    </>
  );

  return (
    <div className="relative min-w-0" title={regle}>
      <span className="sr-only">Règle de l&apos;angle mort : {regle}</span>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
        <Ligne terme="Réel" testid="panneau-route-reel">
          {ligneReelle}
        </Ligne>
        {robots.length === 0 ? (
          <Ligne terme="Robot" testid="panneau-route-robot-etat">
            Aucune sonde synthétique sur cette route
          </Ligne>
        ) : (
          robots.map((c) => {
            const etat = LIBELLE_ETAT_ROBOT[c.syn_state ?? "inconnu"] ?? LIBELLE_ETAT_ROBOT.inconnu;
            const suffixe = robots.length > 1 ? ` · ${c.app_id}` : "";
            const heures = angles?.find((a) => a.app_id === c.app_id && a.route === route)?.heures ?? 0;
            return (
              <Ligne key={c.app_id} terme={`Robot${suffixe}`} testid="panneau-route-robot-etat">
                {etat} (pire état sur la plage)
                <span className="block text-xs text-ink-soft">
                  Heures en angle mort : {angles ? formater("count", heures) : `non disponible (${raisonAngles})`}
                </span>
                <Link href={hrefCorrelation(ecrireSerie(c.app_id, route))} className={`${LIEN_BLOC} mt-1`} data-testid="panneau-route-correlation">
                  Voir robot et réel
                </Link>
              </Ligne>
            );
          })
        )}
      </dl>
    </div>
  );
}

/**
 * « Ressources lentes de la route » (§ 5.2.3) : au plus trois, DURÉE MOYENNE — c'est
 * une moyenne, et c'est écrit (jamais lue comme un p75).
 */
function RessourcesRoute({
  lecture,
  plage,
}: {
  /** Les ressources lentes de la route (le chargeur les a extraites de la lecture par route). */
  lecture: SectionLue<readonly Fil<SlowResource>[]>;
  plage: string;
}) {
  const titre = "Ressources lentes de la route";
  if (!lecture.ok) return <EchecLecture titre={titre} compact />;
  const lignes = lecture.data.slice(0, RESSOURCES_PANNEAU);
  if (lignes.length === 0) {
    return <EtatSurface etat={{ kind: "vide", population: "ressource mesurée sur cette route", plage }} />;
  }
  return (
    <ul className="space-y-2 text-sm" data-testid="panneau-route-ressources-liste">
      {lignes.map((r) => (
        <li key={r.url} className="min-w-0">
          <span className="block truncate font-mono text-xs text-ink" title={r.url}>
            {r.url}
          </span>
          <span className="text-xs text-ink-soft">
            {r.type ?? "type inconnu"} · durée moyenne {formater("ms", r.avg_ms)} · {formater("count", r.n)} mesures
            {r.render_blocking ? " · bloque le rendu" : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** « Erreurs sur la route » (§ 5.2.3) : les trois premiers groupes, en OCCURRENCES (V1). */
function ErreursRoute({ lecture, plage, href }: { lecture: SectionLue<{ groups: ErrorGroupRow[]; total: number }>; plage: string; href: string }) {
  const titre = "Erreurs sur la route";
  if (!lecture.ok) return <EchecLecture titre={titre} compact />;
  const groupes = lecture.data.groups.slice(0, ERREURS_PANNEAU);
  if (groupes.length === 0) {
    return <EtatSurface etat={{ kind: "vide", population: "erreur reçue sur cette route", plage }} />;
  }
  return (
    <div className="min-w-0">
      <ul className="space-y-2 text-sm" data-testid="panneau-route-erreurs-liste">
        {groupes.map((g) => (
          <li key={`${g.app_id}:${g.fingerprint}`} className="min-w-0">
            <span className="block truncate font-medium text-ink" title={g.sample_message ?? g.error_type ?? g.fingerprint}>
              {g.error_type ?? "Erreur"}
              {g.sample_message ? ` — ${g.sample_message}` : ""}
            </span>
            <span className="text-xs text-ink-soft">
              {formater("count", g.occurrences)} occurrences ·{" "}
              {g.sessions_affected == null ? "sessions touchées : Inconnu" : `${formater("count", g.sessions_affected)} sessions touchées`}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-soft">
        {lecture.data.total > groupes.length
          ? `${formater("count", groupes.length)} groupes sur ${formater("count", lecture.data.total)} sur ${plage}.`
          : `${formater("count", groupes.length)} groupe(s) sur ${plage}.`}
      </p>
      <Link href={href} className={`${LIEN_BLOC} mt-2`} data-testid="panneau-route-erreurs-lien">
        Toutes les erreurs de cette route
      </Link>
    </div>
  );
}
