// Interactions `/ux`, onglet Frustration (plan § 5.4) — « Quels gestes échouent,
// restent sans réponse ou font attendre ? »
//
// ZONES 5 ET 6 (F23). La question « qui fait attendre » se répond en trois temps, et
// chacun a sa figure : QUAND (l'INP p75 dans le temps, sur ses bandes de seuil lues dans
// `lib/rating.ts`), SUR QUOI l'utilisateur a cliqué (le nuage fréquence × latence, dont
// les cinq points les plus hauts sont étiquetés : ce sont ceux qu'on cherche), et QUEL
// CODE a tenu le fil principal pendant ce temps-là (les scripts bloquants, classés par
// blocage CUMULÉ — un script qui bloque 60 ms à chaque frappe décide de l'INP, pas
// celui qui bloque 400 ms une fois).
//
// PAS DE DEUXIÈME ÉCHELLE, PAS DE CUMUL DE p75 (P5, V5) : la série INP est un p75 par
// seau, calculé sur les mesures brutes de son seau ; un seau sans mesure est un TROU,
// jamais un zéro. Aucune couleur hors des verdicts web.dev de `lib/rating.ts` (P2, V8).
import Link from "next/link";
import { ECRANS } from "@mip/console-contract";
import { PageHeader } from "@/components/PageHeader";
import { RankBar, type RankDatum } from "@/components/charts/RankBar";
import { ScatterPlot } from "@/components/charts/ScatterPlot";
import { ThresholdSeries } from "@/components/charts/ThresholdSeries";
import { Figure } from "@/components/charts/Figure";
import { KpiTile } from "@/components/charts/KpiTile";
import { ImpactTable, type ImpactLigne } from "@/components/ImpactTable";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { OngletsInteractions } from "@/components/perf/OngletsInteractions";
import { EtatSurface } from "@/components/states/EtatSurface";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import { annotationsDeploiements } from "@/lib/annotations";
import type { SearchParams } from "@/lib/filters";
import { type SectionLue } from "@/lib/lecture";
import { chargerUx } from "@/lib/chargeurs/ux";
import { chargerEcran } from "@/lib/ecran";
import { decouperUrlScript, fmtVital } from "@/lib/format";
import { formater } from "@/lib/fmt-ids";
import { libelleSeauComplet } from "@/lib/series";
import { pointsVital } from "@/lib/vue-ensemble";
import { type CouverturePrecedente } from "@/lib/comparaison";
import { LIMITES_FRUSTRATION, reglesFrustration, sousTexteSignaux } from "@/lib/frustration-regles";
import {
  classerRoutesFrustrantes,
  ecartAuTauxEnsemble,
  etatCapteurFrustration,
  referencePeriodePrecedente,
  tauxEnsembleRoutes,
} from "@/lib/perf-domain";
import { type VitalSeriesPoint } from "@/lib/queries";
import {
  frustrationParRoute,
  inpOffenders,
  type FrustrationTotaux,
  type ScriptBloquant,
  type TypeSignal,
} from "@/lib/queries-frustration";
import { hrefWithQuery, paramReader, type AnalyticsQuery } from "@/lib/query-contract";
import { RATING_CLASS, RATING_HEX, rating2026 } from "@/lib/rating";
import { ecartP75 } from "@/lib/stats/incertitude";
import { ecrirePanel, gabaritZoom, ligneIgnoree, lireComparaison, lireEtatDeVue } from "@/lib/view-state";

export const dynamic = "force-dynamic";

/** Question de l'écran (P1, § 5.4). */
const QUESTION = "Quels gestes échouent, restent sans réponse ou font attendre ?";

const LIBELLES_SIGNAL: Record<TypeSignal, string> = { rage: "Rage clicks", dead: "Dead clicks", error: "Error clicks" };

/**
 * Sélecteurs étiquetés dans le nuage (§ 5.4.2) : les cinq points les plus hauts, ceux
 * qu'on cherche. Au-delà, les étiquettes se chevauchent et le nuage devient illisible.
 */
const ETIQUETTES_INP = 5;

const PRECEDENTE_EN_ECHEC: CouverturePrecedente = { etat: "inconnue", raison: "lecture de la période précédente en échec" };

/** Interactions, onglet Frustration (§ 5.4.1-5.4.2) : quels gestes échouent ou font attendre. */
export default async function UxFrustration({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // Le chargeur (`lib/chargeurs/ux.ts`) lit filtres et sections.
  const ecran = await chargerEcran(ECRANS.ux, chargerUx, sp);
  if (ecran.etat === "refus") return <FilterProblemNotice title="Interactions" problem={ecran.problem} />;
  const { query, label } = ecran;
  const lecteur = paramReader(sp);

  // Réglages d'affichage (§ 3.1) : `type` filtre le hero, `tri` l'ordonne. Les lignes
  // de la comparaison sont déjà dites par la barre de filtres.
  const { etat: vue, ignores } = lireEtatDeVue("/ux", lecteur);
  const dejaDites = new Set(lireComparaison("/ux", lecteur).ignores);
  const avertissements = ignores.filter((l) => !dejaDites.has(l));
  if (vue.vital !== null && vue.vital !== "LCP" && vue.vital !== "INP") {
    // `vital` est déclaré pour /ux, mais l'écran ne pilote encore que l'INP.
    avertissements.push(ligneIgnoree("vital", vue.vital, "cet écran ne pilote que l'INP"));
  }
  const type = vue.type;
  const tri = vue.tri === "volume" ? "volume" : "gravite";
  const prev = vue.cmp === "prev";

  // CHAQUE LECTURE EST INDÉPENDANTE (F02, § 3.8) : une section en échec le dit sans
  // emporter les autres — et jamais par un « 0 ».
  const { totaux, totauxPrec, routes, vitaux, vitauxPrec, serieInp, inp, scripts, deploys } = ecran;
  const couvSignaux = ecran.couvSignaux ?? undefined;
  const couvInp = ecran.couvInp ?? undefined;
  const reference = prev ? referencePeriodePrecedente(query.range) : undefined;

  // Liens de l'écran vers lui-même : ils ne changent qu'un réglage d'affichage.
  const brut = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v] as [string, string]] : [])),
  );
  const hrefUx = (reglages: Record<string, string | null>, ancre = "routes-frustrantes") => {
    const p = new URLSearchParams(brut);
    for (const [k, v] of Object.entries(reglages)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    const qs = p.toString();
    return `/ux${qs ? `?${qs}` : ""}#${ancre}`;
  };

  // Annotations de déploiement sur la série INP (P9, § 3.7) : un trait par version,
  // son lien compare les deux releases SUR CET ÉCRAN. Lecture en échec : aucun trait,
  // et la figure dit pourquoi (jamais une série muette qui laisserait croire qu'il
  // n'y a pas eu de déploiement).
  const annotations = deploys.ok
    ? annotationsDeploiements(deploys.data, query.range, {
        lien: (relB, relA) => hrefUx({ cmp: "release", rel_b: relB, rel_a: relA }, "inp-dans-le-temps"),
      })
    : { annotations: [], liste: [], indisponible: "déploiements non lus (lecture en échec)" };
  // Zoom au clic sur un seau : le même écran, seule la plage change (§ 3.3).
  const zoomInp = gabaritZoom(hrefWithQuery("/ux", query, { period: null, from: "{from}", to: "{to}" }), sp);

  const capteur = totaux.ok ? etatCapteurFrustration(totaux.data.capteur) : null;
  const inpCourant = vitaux.ok ? vitaux.data.find((v) => v.name === "INP") : undefined;
  const inpAvant = vitauxPrec?.ok ? vitauxPrec.data.find((v) => v.name === "INP") : undefined;

  return (
    <div className="animate-fade-up">
      <PageHeader title="Interactions" sub={QUESTION} />
      <OngletsInteractions actif="/ux" sp={lecteur} />
      {avertissements.length > 0 && (
        <div className="mb-4 space-y-1" data-testid="reglages-ignores">
          {avertissements.map((ligne) => (
            <p key={ligne} role="note" className="text-xs text-ink-soft">
              {ligne}
            </p>
          ))}
        </div>
      )}

      {vue.cmp === "release" && (
        <p role="note" className="mb-2 text-xs text-ink-soft" data-testid="note-cmp-release">
          Comparaison de releases : les tuiles d&apos;interactions ne comparent que la période précédente ; aucun écart
          n&apos;est affiché ici.
        </p>
      )}

      {/* ── Zone 2 : tuiles (§ 5.4.2). Population : sessions dont le capteur émet. ── */}
      <SectionErreur titre="Signaux de frustration et INP">
        <section aria-label={`Signaux de frustration et INP sur ${label}`} className="mb-4" data-testid="kpi-interactions">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {!totaux.ok ? (
              <div className="col-span-2 lg:col-span-3">
                <EchecLecture compact titre="Signaux de frustration" />
              </div>
            ) : capteur?.masquer ? (
              // Aucun capteur n'écoute : AUCUN compte n'est rendu, pas même « 0 ».
              <div className="col-span-2 lg:col-span-3" data-testid="signaux-non-collectes">
                <EtatSurface etat={capteur.etat!} />
              </div>
            ) : (
              <TuilesSignaux
                totaux={totaux.data}
                totauxPrec={totauxPrec}
                reference={reference}
                couverture={couvSignaux}
                hrefType={(k) => hrefUx({ type: k })}
              />
            )}
            {!vitaux.ok ? (
              <EchecLecture compact titre="INP p75" />
            ) : (
              <KpiTile
                label="INP p75"
                valeur={inpCourant?.p75 ?? null}
                raisonNull={`aucune mesure INP sur ${label}`}
                format="ms"
                vital="INP"
                intervalle={inpCourant?.intervalle}
                couverture={{ n: inpCourant?.n ?? 0, unite: "mesures INP" }}
                serie={serieInp.ok ? serieInp.data.map((p) => p.p75) : undefined}
                reference={reference}
                {...(vitauxPrec === null
                  ? {}
                  : !vitauxPrec.ok
                    ? { precedent: null, couverturePrecedente: PRECEDENTE_EN_ECHEC }
                    : { precedent: inpAvant?.p75 ?? null, couverturePrecedente: couvInp && { ...couvInp, n: inpAvant?.n ?? 0 } })}
                ecart={ecartP75(inpCourant?.intervalle, inpAvant?.intervalle, (v) => formater("ms", v))}
                href="#elements-inp"
              />
            )}
          </div>
          <div className="mt-2 space-y-1 text-xs text-ink-soft">
            {capteur?.etat && !capteur.masquer && <EtatSurface etat={capteur.etat} compact />}
            <p>
              Population des signaux : sessions dont le capteur émet des signaux de frustration (SDK navigateur,
              extension) ; le SDK mobile n&apos;en émet aucun.
            </p>
            <p data-testid="ligne-sdk-desactive">
              Un SDK configuré avec <code>frustration: false</code> envoie 0 sans que la console puisse le savoir.
            </p>
          </div>
        </section>
      </SectionErreur>

      {/* ── Zone 3 : règles de détection, repliées à une ligne ── */}
      <details className="card mb-6 px-4 py-3 text-sm" data-testid="regles-detection">
        <summary className="cursor-pointer select-none font-medium text-ink">
          Règles de détection : rage, dead et error clicks (constantes du SDK)
        </summary>
        <ul className="mt-2 space-y-1 text-ink-soft">
          {reglesFrustration().map((r) => (
            <li key={r.kind}>
              <strong className="font-semibold text-ink">{r.libelle} :</strong> {r.texte}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-ink-soft">{LIMITES_FRUSTRATION}</p>
      </details>

      {/* ── Zone 4 : hero « Routes les plus frustrantes » ── */}
      <SectionErreur titre="Routes les plus frustrantes">
        <div id="routes-frustrantes" className="mb-6 scroll-mt-4">
          <HeroRoutes
            label={label}
            query={query}
            routes={routes}
            capteurMasque={capteur?.masquer ?? false}
            type={type}
            tri={tri}
            hrefUx={hrefUx}
          />
        </div>
      </SectionErreur>

      {/* ── Zone 5 : « INP p75 dans le temps » · « Éléments responsables de l'INP » ──
          6/12 · 6/12 à 1440 (§ 5.4.1), empilés sous lg : le QUAND à gauche, le SUR QUOI
          à droite. `min-w-0` sur la grille et ses colonnes : un sélecteur CSS long dans
          le nuage ne doit pas élargir la page (piège des colonnes de grille implicites). */}
      <div className="mt-6 grid min-w-0 gap-4 lg:grid-cols-2">
        <SectionErreur titre="INP p75 dans le temps">
          <div id="inp-dans-le-temps" className="min-w-0 scroll-mt-4">
            <SerieInp
              serie={serieInp}
              label={label}
              seau={ecran.bucketLabel}
              seauSecondes={query.range.bucketSeconds}
              annotations={annotations}
              zoom={zoomInp}
            />
          </div>
        </SectionErreur>
        <SectionErreur titre="Éléments responsables de l'INP">
          <div id="elements-inp" className="min-w-0 scroll-mt-4">
            <ElementsInp inp={inp} label={label} />
          </div>
        </SectionErreur>
      </div>

      {/* ── Zone 6 : scripts qui bloquent le fil principal ── */}
      {/* Le chaînon manquant entre « INP à 900 ms » et un correctif : la zone
          ci-dessus dit OÙ l'utilisateur a cliqué, celle-ci dit QUEL CODE a tenu
          le fil principal pendant ce temps-là. */}
      <div className="mt-6">
        <SectionErreur titre="Scripts qui bloquent le fil principal">
          <ScriptsBloquants scripts={scripts} label={label} />
        </SectionErreur>
      </div>
    </div>
  );
}

/** Les trois tuiles de signaux : comptes ENTIERS (jamais les 50 lignes de `topFrustrations`), neutres (R-S). */
function TuilesSignaux({
  totaux,
  totauxPrec,
  reference,
  couverture,
  hrefType,
}: {
  totaux: FrustrationTotaux;
  totauxPrec: SectionLue<FrustrationTotaux> | null;
  reference: string | undefined;
  couverture: CouverturePrecedente | undefined;
  hrefType: (k: TypeSignal) => string;
}) {
  return (
    <>
      {totaux.parType.map((t) => {
        const avant = totauxPrec?.ok ? totauxPrec.data.parType.find((p) => p.kind === t.kind) : undefined;
        const comparaison =
          totauxPrec === null
            ? {}
            : !totauxPrec.ok
              ? { precedent: null, couverturePrecedente: PRECEDENTE_EN_ECHEC }
              : { precedent: avant?.n ?? 0, couverturePrecedente: couverture };
        return (
          <KpiTile
            key={t.kind}
            label={LIBELLES_SIGNAL[t.kind]}
            valeur={t.n}
            format="count"
            sensMeilleur="bas"
            reference={reference}
            {...comparaison}
            // « 14 signaux, 9 sessions » distingue l'acharné (un visiteur, beaucoup de
            // signaux) des bloqués (beaucoup de visiteurs). Pluriels écrits, pas fabriqués.
            lecture={sousTexteSignaux(t.n, t.sessions)}
            href={hrefType(t.kind)}
          />
        );
      })}
    </>
  );
}

/** Hero : routes classées par part de sessions touchées (§ 5.4.2), `ImpactTable`. */
function HeroRoutes({
  label,
  query,
  routes,
  capteurMasque,
  type,
  tri,
  hrefUx,
}: {
  label: string;
  query: AnalyticsQuery;
  routes: SectionLue<Awaited<ReturnType<typeof frustrationParRoute>>>;
  capteurMasque: boolean;
  type: TypeSignal | null;
  tri: "gravite" | "volume";
  hrefUx: (reglages: Record<string, string | null>, ancre?: string) => string;
}) {
  const titre = "Routes les plus frustrantes";
  if (capteurMasque) {
    return <Figure titre={titre} id="hero-routes-frustrantes" etat={{ kind: "non_collecte", manque: "le SDK mobile n'émet pas de signaux de frustration" }} />;
  }
  if (!routes.ok) return <Figure titre={titre} id="hero-routes-frustrantes" etat={{ kind: "erreur", titre }} />;
  if (routes.data.length === 0) {
    return (
      <Figure
        titre={titre}
        id="hero-routes-frustrantes"
        etat={{ kind: "vide", population: "page vue ni signal de frustration", plage: label }}
      />
    );
  }

  const { lignes, faibles } = classerRoutesFrustrantes(routes.data, tri);
  // Référence sur les MÊMES couples session × route que les lignes (jamais « touchées
  // n'importe où / sessions avec vue », une autre population).
  const ensemble = tauxEnsembleRoutes(routes.data);
  const signaux = type ? LIBELLES_SIGNAL[type].toLowerCase() : "signaux";

  const impactLignes: ImpactLigne[] = lignes.map((r) => {
    const libelle = r.route ?? "Inconnu";
    const ecart = ecartAuTauxEnsemble(r.taux, ensemble.taux);
    return {
      cle: r.route === null ? " inconnu" : `r:${r.route}`,
      libelle,
      // Une route ouvre son PANNEAU sur `/pages` (F17, § 5.2.3) : on qualifie la route
      // sans quitter le classement. « Inconnu » n'a pas d'identifiant de panneau :
      // il garde la condition `is_null`.
      href:
        r.route === null
          ? hrefWithQuery("/pages", query, { seg: "v2:route:is_null" })
          : hrefWithQuery("/pages", query, { panel: ecrirePanel({ type: "route", id: r.route }) }),
      description: `Route ${libelle} — ${formater("pct", r.taux)} des ${formater("count", r.sessionsRoute)} sessions avec au moins un signal`,
      pilote: r.taux,
      volume: r.sessionsRoute,
      mesures: [
        { cle: "rage", valeur: r.rage, affichage: formater("count", r.rage) },
        { cle: "dead", valeur: r.dead, affichage: formater("count", r.dead) },
        { cle: "error", valeur: r.error, affichage: formater("count", r.error) },
        { cle: "touchees", valeur: r.sessionsTouchees, affichage: formater("count", r.sessionsTouchees) },
      ],
      ecart: ecart ?? undefined,
      echantillonFaible: r.sessionsRoute < 30,
    };
  });

  return (
    <>
      <nav aria-label="Filtrer par type de signal" className="mb-2 flex flex-wrap items-center gap-1 text-xs" data-testid="filtre-type">
        <span className="mr-1 text-ink-soft">Signal</span>
        {([null, "rage", "dead", "error"] as const).map((k) =>
          k === type ? (
            <span key={k ?? "tous"} aria-current="true" className="rounded-md border border-accent/50 bg-accent/10 px-2 py-0.5 font-medium text-accent-ink">
              {k ? LIBELLES_SIGNAL[k] : "Tous"}
            </span>
          ) : (
            <Link
              key={k ?? "tous"}
              href={hrefUx({ type: k })}
              scroll={false}
              className="rounded-md border border-line bg-panel2 px-2 py-0.5 font-medium text-ink-soft transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
            >
              {k ? LIBELLES_SIGNAL[k] : "Tous"}
            </Link>
          ),
        )}
      </nav>
      <ImpactTable
        titre={`${titre} — part des sessions de la route avec au moins un ${type ? LIBELLES_SIGNAL[type].toLowerCase().replace(/s$/, "") : "signal"}`}
        tri={tri}
        triHref={{
          gravite: hrefUx({ tri: null }),
          volume: hrefUx({ tri: "volume" }),
          impact: null,
          fourni: null,
        }}
        reference={
          ensemble.taux === null
            ? null
            : {
                // Pas de « volume » : la somme porte sur des couples session × route, pas
                // sur des sessions ; une session qui voit deux routes y compte deux fois.
                libelle: "Ensemble (toutes routes)",
                valeurs: {
                  pilote: formater("pct", ensemble.taux),
                  touchees: `${formater("count", ensemble.touchees)} sur ${formater("count", ensemble.couples)} couples session × route`,
                },
              }
        }
        referenceRaison={`aucune session avec vue sur ${label}`}
        lignes={impactLignes}
        colonnes={["Rage", "Dead", "Error", "Sessions touchées"]}
        unitePilote="pct"
        volumeLibelle="Sessions de la route"
        groupes={lignes.length}
        tronque={false}
        notice={`Route normalisée au moment de la vue. Population : sessions dont le capteur émet des signaux de frustration, ${label}. « Ensemble » = sessions touchées sur la route / sessions qui l'ont vue, sommées sur toutes les routes (mêmes couples session × route que les lignes).${type ? ` Le classement ne retient que les ${signaux} ; les colonnes Rage, Dead et Error comptent tous les signaux de la route.` : ""}${faibles > 0 ? ` ${faibles} route(s) vue(s) par moins de 30 sessions, rangée(s) en fin.` : ""}`}
      />
      <p className="mt-2 text-xs text-ink-soft">
        Les {signaux} eux-mêmes, route par route :{" "}
        <Link
          href={hrefWithQuery("/events", query, { name: `frustration.${type ?? "rage"}` })}
          className="text-perf underline-offset-2 hover:underline"
        >
          Journal filtré sur frustration.{type ?? "rage"}
        </Link>{" "}
        (ajoutez la route dans les filtres).
      </p>
    </>
  );
}

/**
 * « INP p75 dans le temps » (§ 5.4.2) : un p75 par seau du contrat, sur les bandes
 * Bon / À améliorer / Mauvais de `lib/rating.ts` (bornes de l'INP, jamais recopiées ici).
 *
 * UN SEAU SANS MESURE EST UN TROU. `vitalSeriesN` rend déjà toute la grille ; un seau
 * sans mesure y vaut `p75: null, n: 0`, et `ThresholdSeries` coupe la ligne au lieu de
 * la tirer d'un point à l'autre. Aucun p75 n'est agrégé d'un autre (V5) : chacun est
 * calculé sur les mesures brutes de son seau.
 */
function SerieInp({
  serie,
  label,
  seau,
  seauSecondes,
  annotations,
  zoom,
}: {
  serie: SectionLue<VitalSeriesPoint[]>;
  label: string;
  seau: string;
  seauSecondes: number;
  annotations: ReturnType<typeof annotationsDeploiements>;
  zoom: string;
}) {
  const titre = "INP p75 dans le temps";
  if (!serie.ok) return <Figure titre={titre} id="figure-inp-dans-le-temps" etat={{ kind: "erreur", titre }} />;
  const grille = serie.data.map((p) => p.bucket);
  const points = pointsVital(grille, serie.data);
  let mesures = 0;
  for (const p of points) mesures += p.n;

  return (
    <Figure
      titre={titre}
      id="figure-inp-dans-le-temps"
      aide="INP"
      etat={mesures === 0 ? { kind: "vide", population: "mesure INP", plage: label } : undefined}
      meta={
        <>
          <span>{formater("count", mesures)} mesures INP</span>
          <span>{label}</span>
          <span>seaux de {seau} (UTC)</span>
        </>
      }
      lecture="L'INP p75 du seau, sur les bandes Bon / À améliorer / Mauvais de web.dev (seuils lus dans le code, jamais recopiés). Un seau sans interaction mesurée est un trou, pas un zéro. Un clic sur un seau zoome sur sa plage ; les traits verticaux sont les déploiements."
      alternative={
        mesures > 0
          ? {
              legende: `INP p75 par seau de ${seau} (UTC)`,
              colonnes: ["Seau (UTC)", "INP p75", "Mesures"],
              lignes: points.map((p) => [libelleSeauComplet(p.t, seauSecondes, "UTC"), formater("ms", p.p75), p.n]),
            }
          : undefined
      }
    >
      <ThresholdSeries
        grille={grille}
        points={points}
        series={[{ cle: "p75", libelle: "INP p75", role: "principale", effectifCle: "n" }]}
        format="ms"
        vital="INP"
        annotations={annotations.annotations}
        annotationsIndisponibles={annotations.indisponible ?? undefined}
        seauSecondes={seauSecondes}
        fuseau="UTC"
        zoomHref={zoom}
        hauteur={240}
        ariaLabel={`INP p75 par seau de ${seau}, ${label}`}
      />
    </Figure>
  );
}

/** Nuage fréquence × latence des éléments à l'INP, ses cinq étiquettes, et sa table jumelle. */
function ElementsInp({ inp, label }: { inp: SectionLue<Awaited<ReturnType<typeof inpOffenders>>>; label: string }) {
  const titre = "Éléments responsables de l'INP";
  if (!inp.ok) return <Figure titre={titre} id="figure-elements-inp" etat={{ kind: "erreur", titre }} />;
  const pts = inp.data
    .filter((o) => o.p75 != null)
    .map((o) => {
      const rating = rating2026("INP", Number(o.p75));
      return {
        x: o.n,
        y: Number(o.p75),
        z: o.worst != null ? Number(o.worst) : undefined,
        label: o.target,
        color: rating ? RATING_HEX[rating] : "rgb(var(--c-ink-soft))",
      };
    });
  return (
    <Figure
      titre={titre}
      id="figure-elements-inp"
      etat={pts.length === 0 ? { kind: "vide", population: "interaction mesurée à l'INP", plage: label } : undefined}
      meta={
        <>
          <span>20 éléments au plus, classés par INP p75</span>
          <span>{label}</span>
          <span>{Math.min(ETIQUETTES_INP, pts.length)} sélecteurs les plus lents étiquetés</span>
        </>
      }
      lecture="Chaque point = un élément interactif : X = nombre d'interactions, Y = INP p75, couleur = verdict web.dev de l'INP. En haut à droite : fréquents ET lents, à corriger d'abord ; les cinq plus lents portent leur sélecteur. Les points ne sont pas cliquables : la cible n'est pas une dimension de filtre — la table sous le nuage porte les mêmes lignes, chiffrées."
    >
      <ScatterPlot
        points={pts}
        xLabel="Interactions"
        yLabel="INP p75"
        xUnit=" interactions"
        yUnit=" ms"
        xFormat="int"
        yFormat="int"
        etiquettes={ETIQUETTES_INP}
        ariaLabel={`Éléments responsables de l'INP : ${pts.length} éléments, nombre d'interactions × INP p75, ${label}`}
      />
      {/* `relative` sur le conteneur défilant : sans ancêtre positionné, le `sr-only`
          de la légende (position: absolute) se place par rapport à la PAGE et l'élargit. */}
      <div className="relative mt-4 overflow-x-auto" data-testid="table-elements-inp">
        <table className="w-full text-sm">
          <caption className="sr-only">Éléments responsables de l&apos;INP sur {label}</caption>
          <thead className="bg-panel2">
            <tr>
              <th scope="col" className="th">Élément (interactionTarget)</th>
              <th scope="col" className="th text-right">Interactions</th>
              <th scope="col" className="th text-right">INP p75</th>
              <th scope="col" className="th text-right">Pire</th>
            </tr>
          </thead>
          <tbody>
            {inp.data.map((o) => (
              <tr key={o.target} className="border-t border-line/60">
                <td className="max-w-xs truncate px-4 py-2 font-mono text-xs text-ink" title={o.target}>
                  {o.target}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-ink-soft">{o.n.toLocaleString("fr-FR")}</td>
                <td className="px-4 py-2 text-right">
                  <InpCell v={o.p75} />
                </td>
                <td className="px-4 py-2 text-right">
                  <InpCell v={o.worst} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Figure>
  );
}

/**
 * « Scripts qui bloquent le fil principal » (§ 5.4.2) : classement en barres du blocage
 * CUMULÉ, la mesure qui décide de l'INP.
 *
 * POURQUOI DES BARRES, ET PAS LA TABLE D'AVANT. La question n'est pas « combien de
 * millisecondes exactement », c'est « lequel de ces scripts pèse le plus » : une
 * longueur se compare d'un coup d'œil, cinq colonnes de chiffres non. Les chiffres
 * restent : blocage cumulé sur la barre, frames et pire cas en sous-texte, et
 * l'alternative textuelle de la figure rend les cinq colonnes de la table précédente.
 *
 * AUCUNE COULEUR DE VERDICT (R-S) : il n'existe aucun seuil publié pour un temps de
 * blocage cumulé. Les barres portent la série principale, rien d'autre.
 */
function ScriptsBloquants({ scripts, label }: { scripts: SectionLue<ScriptBloquant[]>; label: string }) {
  const titre = "Scripts qui bloquent le fil principal (Long Animation Frames)";
  if (!scripts.ok) return <Figure titre={titre} id="scripts-bloquants" etat={{ kind: "erreur", titre }} />;

  const lignes: RankDatum[] = scripts.data.map((s) => {
    // Nom de fichier en évidence, hôte en sous-texte : une troncature de fin n'aurait
    // montré que le préfixe, identique pour tous les scripts du même site. L'URL
    // entière et la fonction restent en infobulle de la ligne.
    const { fichier, hote } = decouperUrlScript(s.url);
    return {
      label: fichier,
      value: s.totalMs,
      display: formater("ms", s.totalMs),
      title: `${s.url} — ${s.quoi}`,
      sub: `${hote ? `${hote} · ` : ""}${s.quoi} · ${formater("count", s.n)} frames · pire ${formater("ms", s.worstMs)}`,
    };
  });

  return (
    <Figure
      titre={titre}
      id="scripts-bloquants"
      meta={
        <>
          <span>{formater("count", scripts.data.length)} couples script × fonction, 20 au plus</span>
          <span>{label}</span>
          <span>classement par blocage cumulé</span>
        </>
      }
      etat={
        lignes.length === 0
          ? { kind: "vide", population: "frame bloquante attribuée à un script", plage: label }
          : undefined
      }
      lecture={
        <>
          Classé par blocage <strong>cumulé</strong>, pas par pire cas : un script qui bloque 400 ms une fois est un
          incident, un script qui bloque 60 ms à chaque frappe est le problème — et c&apos;est le second qui décide de
          l&apos;INP. Un cumul de visiteurs différents n&apos;est le temps vécu de personne. L&apos;API Long Animation
          Frames n&apos;existe que sur Chromium : les visiteurs Safari et Firefox n&apos;en produisent pas, et une
          absence de ligne ne veut donc pas dire qu&apos;ils n&apos;attendent pas.
        </>
      }
      alternative={
        lignes.length > 0
          ? {
              legende: `Blocage attribué par script et par fonction, ${label}`,
              colonnes: ["Script", "Fonction / invocation", "Frames", "Blocage cumulé", "Pire"],
              lignes: scripts.data.map((s) => [
                s.url,
                s.quoi,
                s.n,
                formater("ms", s.totalMs),
                formater("ms", s.worstMs),
              ]),
            }
          : undefined
      }
    >
      <RankBar data={lignes} alternative={false} legende="Blocage cumulé par script et par fonction" />
    </Figure>
  );
}

function InpCell({ v }: { v: number | null }) {
  if (v == null) return <span className="text-ink-soft">—</span>;
  const rating = rating2026("INP", Number(v));
  return (
    <span className={`rounded border px-1.5 py-0.5 text-xs font-medium tabular-nums ${rating ? RATING_CLASS[rating] : ""}`}>
      {fmtVital("INP", Number(v))}
    </span>
  );
}
