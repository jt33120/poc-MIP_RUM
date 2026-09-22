import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ScatterPlot } from "@/components/charts/ScatterPlot";
import { Figure } from "@/components/charts/Figure";
import { KpiTile } from "@/components/charts/KpiTile";
import { ImpactTable, type ImpactLigne } from "@/components/ImpactTable";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { OngletsInteractions } from "@/components/perf/OngletsInteractions";
import { EtatSurface } from "@/components/states/EtatSurface";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import type { SearchParams } from "@/lib/filters";
import { lire, type Lecture } from "@/lib/lecture";
import { pageFilters } from "@/lib/page-filters";
import { decouperUrlScript, fmtVital } from "@/lib/format";
import { formater } from "@/lib/fmt-ids";
import { couverturePrecedente, sourcesSousFiltres, type CouverturePrecedente, type SourceComparaison } from "@/lib/comparaison";
import { LIMITES_FRUSTRATION, reglesFrustration } from "@/lib/frustration-regles";
import { classerRoutesFrustrantes, etatCapteurFrustration, referencePeriodePrecedente } from "@/lib/perf-domain";
import { vitalSeriesN, vitalsP75 } from "@/lib/queries";
import {
  frustrationParRoute,
  frustrationTotaux,
  inpOffenders,
  scriptsBloquants,
  type FrustrationTotaux,
  type TypeSignal,
} from "@/lib/queries-frustration";
import { hrefWithQuery, paramReader, type AnalyticsQuery } from "@/lib/query-contract";
import { RATING_CLASS, RATING_HEX, rating2026 } from "@/lib/rating";
import { ecartP75 } from "@/lib/stats/incertitude";
import { ligneIgnoree, lireComparaison, lireEtatDeVue } from "@/lib/view-state";

export const dynamic = "force-dynamic";

/** Question de l'écran (P1, § 5.4). */
const QUESTION = "Quels gestes échouent, restent sans réponse ou font attendre ?";

const LIBELLES_SIGNAL: Record<TypeSignal, string> = { rage: "Rage clicks", dead: "Dead clicks", error: "Error clicks" };

// Sources comparées à la période précédente (§ 3.2) : des signaux (comptes, additifs)
// et des mesures INP (non additives).
const SOURCES_SIGNAUX: SourceComparaison[] = [{ table: "rum_event", colonneTemps: "ts", additive: true }];
const SOURCES_INP: SourceComparaison[] = [{ table: "rum_metric", colonneTemps: "ts", additive: false }];

/** Première couverture incomplète d'une rangée de sources, sinon « complète ». */
async function couvertureDe(query: AnalyticsQuery, sources: SourceComparaison[]): Promise<CouverturePrecedente> {
  const couvertures = await Promise.all(
    sources.flatMap((s) => sourcesSousFiltres(query, s)).map((s) => couverturePrecedente(query, s)),
  );
  return couvertures.find((c) => c.etat !== "complete") ?? { etat: "complete", raison: null };
}

const PRECEDENTE_EN_ECHEC: CouverturePrecedente = { etat: "inconnue", raison: "lecture de la période précédente en échec" };
const sansLecture = Promise.resolve(null);

/** Interactions, onglet Frustration (§ 5.4.1-5.4.2) : quels gestes échouent ou font attendre. */
export default async function UxFrustration({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ecran = await pageFilters(sp, "/ux");
  if (!ecran.ok) return <FilterProblemNotice title="Interactions" problem={ecran.problem} />;
  const f = ecran.filters;
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

  // CHAQUE LECTURE EST INDÉPENDANTE (F02, § 3.8) : `lire()` ne lève pas, une section
  // en échec le dit sans emporter les autres — et jamais par un « 0 ».
  const [totaux, totauxPrec, routes, vitaux, vitauxPrec, serieInp, inp, scripts, couvSignaux, couvInp] = await Promise.all([
    lire(() => frustrationTotaux(f)),
    prev ? lire(() => frustrationTotaux(f, true)) : sansLecture,
    lire(() => frustrationParRoute(f, type)),
    lire(() => vitalsP75(f)),
    prev ? lire(() => vitalsP75(f, true)) : sansLecture,
    lire(() => vitalSeriesN(f, "INP")),
    lire(() => inpOffenders(f)),
    lire(() => scriptsBloquants(f)),
    prev ? couvertureDe(query, SOURCES_SIGNAUX) : Promise.resolve(undefined),
    prev ? couvertureDe(query, SOURCES_INP) : Promise.resolve(undefined),
  ]);
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
            totaux={totaux}
            capteurMasque={capteur?.masquer ?? false}
            type={type}
            tri={tri}
            hrefUx={hrefUx}
          />
        </div>
      </SectionErreur>

      {/* ── Zone 5 : éléments responsables de l'INP (nuage + table) ── */}
      <SectionErreur titre="Éléments responsables de l'INP">
        <div id="elements-inp" className="scroll-mt-4">
          <ElementsInp inp={inp} label={label} />
        </div>
      </SectionErreur>

      {/* ── Zone 6 : scripts qui bloquent le fil principal ── */}
      {/* Le chaînon manquant entre « INP à 900 ms » et un correctif : l'élément
          ci-dessus dit OÙ l'utilisateur a cliqué, celui-ci dit QUEL CODE a tenu
          le fil principal pendant ce temps-là. */}
      <h2 className="mb-2 mt-8 text-sm font-semibold text-ink">
        Scripts qui bloquent le fil principal (Long Animation Frames)
      </h2>
      <SectionErreur titre="Scripts qui bloquent le fil principal">
        {!scripts.ok ? (
          <EchecLecture titre="Scripts qui bloquent le fil principal" />
        ) : (
          <div className="card relative overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-panel2">
                <tr>
                  <th scope="col" className="th">Script</th>
                  <th scope="col" className="th">Fonction / invocation</th>
                  <th scope="col" className="th text-right">Frames</th>
                  <th scope="col" className="th text-right">Blocage cumulé</th>
                  <th scope="col" className="th text-right">Pire</th>
                </tr>
              </thead>
              <tbody>
                {scripts.data.map((s) => (
                  <tr key={`${s.url}-${s.quoi}`} className="border-t border-line/60 transition hover:bg-panel2/60">
                    {/* Nom de fichier en évidence, hôte en dessous : une troncature
                        de fin n'aurait montré que le préfixe, identique pour tous
                        les scripts du même site. L'URL entière reste en infobulle. */}
                    <td className="px-4 py-2" title={s.url}>
                      {(() => {
                        const { fichier, hote } = decouperUrlScript(s.url);
                        return (
                          <>
                            <span className="block font-mono text-xs font-medium text-ink">{fichier}</span>
                            {hote && <span className="block font-mono text-[11px] text-ink-faint">{hote}</span>}
                          </>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-soft">{s.quoi}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-soft">{s.n.toLocaleString("fr-FR")}</td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums text-ink">
                      {Math.round(s.totalMs).toLocaleString("fr-FR")} ms
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-soft">
                      {Math.round(s.worstMs).toLocaleString("fr-FR")} ms
                    </td>
                  </tr>
                ))}
                {!scripts.data.length && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-ink-faint">
                      Aucun blocage attribué sur {label}. L&apos;API Long Animation Frames n&apos;existe que sur
                      Chromium : les visiteurs Safari et Firefox n&apos;en produisent pas.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </SectionErreur>
      <p className="mt-2 text-xs leading-relaxed text-ink-soft">
        Classé par blocage <strong>cumulé</strong>, pas par pire cas : un script qui bloque 400 ms une fois est un
        incident, un script qui bloque 60 ms à chaque frappe est le problème — et c&apos;est le second qui décide de
        l&apos;INP. Un cumul de visiteurs différents n&apos;est le temps vécu de personne.
      </p>
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
  totauxPrec: Lecture<FrustrationTotaux> | null;
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
            // signaux) des bloqués (beaucoup de visiteurs).
            lecture={`${formater("count", t.n)} signal${t.n > 1 ? "aux" : ""}, ${formater("count", t.sessions)} session${t.sessions > 1 ? "s" : ""}`}
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
  totaux,
  capteurMasque,
  type,
  tri,
  hrefUx,
}: {
  label: string;
  query: AnalyticsQuery;
  routes: Lecture<Awaited<ReturnType<typeof frustrationParRoute>>>;
  totaux: Lecture<FrustrationTotaux>;
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
  const cleType = type ?? "tous";
  const base = totaux.ok ? totaux.data.capteur.sessionsCouvertes : null;
  const touchees = totaux.ok ? totaux.data.baseTouchee[cleType] : null;
  const tauxEnsemble = base && base > 0 && touchees !== null ? touchees / base : null;
  const signaux = type ? LIBELLES_SIGNAL[type].toLowerCase() : "signaux";

  const impactLignes: ImpactLigne[] = lignes.map((r) => {
    const libelle = r.route ?? "Inconnu";
    const ecart = r.taux !== null && tauxEnsemble !== null ? r.taux - tauxEnsemble : null;
    return {
      cle: r.route === null ? " inconnu" : `r:${r.route}`,
      libelle,
      // Le panneau route (`panel=route:`) arrive avec F17 : d'ici là, Pages filtrée sur la route.
      href:
        r.route === null
          ? hrefWithQuery("/pages", query, { seg: "v2:route:is_null" })
          : hrefWithQuery("/pages", query, { route: r.route }),
      description: `Route ${libelle} — ${formater("pct", r.taux)} des ${formater("count", r.sessionsRoute)} sessions avec au moins un signal`,
      pilote: r.taux,
      volume: r.sessionsRoute,
      mesures: [
        { cle: "rage", valeur: r.rage, affichage: formater("count", r.rage) },
        { cle: "dead", valeur: r.dead, affichage: formater("count", r.dead) },
        { cle: "error", valeur: r.error, affichage: formater("count", r.error) },
        { cle: "touchees", valeur: r.sessionsTouchees, affichage: formater("count", r.sessionsTouchees) },
      ],
      ecart:
        ecart === null
          ? undefined
          : { valeur: ecart, affichage: `${ecart > 0 ? "+" : ""}${(ecart * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} pts vs ensemble` },
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
          tauxEnsemble === null
            ? null
            : {
                libelle: "Ensemble",
                valeurs: { pilote: formater("pct", tauxEnsemble), volume: formater("count", base ?? 0) },
              }
        }
        referenceRaison={totaux.ok ? `aucune session avec vue sur ${label}` : "lecture des totaux en échec"}
        lignes={impactLignes}
        colonnes={["Rage", "Dead", "Error", "Sessions touchées"]}
        unitePilote="pct"
        volumeLibelle="Sessions de la route"
        groupes={lignes.length}
        tronque={false}
        notice={`Route normalisée au moment de la vue. Population : sessions dont le capteur émet des signaux de frustration, ${label}. ${faibles > 0 ? `${faibles} route(s) vue(s) par moins de 30 sessions, rangée(s) en fin.` : ""}`}
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

/** Nuage fréquence × latence des éléments à l'INP, et sa table (F23 y ajoutera étiquettes et série). */
function ElementsInp({ inp, label }: { inp: Lecture<Awaited<ReturnType<typeof inpOffenders>>>; label: string }) {
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
      meta={<span>20 éléments au plus, classés par INP p75 · {label}</span>}
      lecture="Chaque point = un élément interactif : X = nombre d'interactions, Y = INP p75, couleur = verdict web.dev de l'INP. En haut à droite : fréquents ET lents, à corriger d'abord. Les points ne sont pas cliquables : la cible n'est pas une dimension de filtre."
    >
      <ScatterPlot
        points={pts}
        xLabel="Interactions"
        yLabel="INP p75"
        yUnit=" ms"
        yFormat="int"
        ariaLabel={`Éléments responsables de l'INP : ${pts.length} éléments, nombre d'interactions × INP p75, ${label}`}
      />
      <div className="relative mt-4 overflow-x-auto">
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

function InpCell({ v }: { v: number | null }) {
  if (v == null) return <span className="text-ink-soft">—</span>;
  const rating = rating2026("INP", Number(v));
  return (
    <span className={`rounded border px-1.5 py-0.5 text-xs font-medium tabular-nums ${rating ? RATING_CLASS[rating] : ""}`}>
      {fmtVital("INP", Number(v))}
    </span>
  );
}
