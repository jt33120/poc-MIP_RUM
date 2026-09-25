// `/mobile` — ce que la couche JavaScript React Native observe, et ce qu'elle
// n'observe pas (P7.5, réagencé par F38, plan § 5.6).
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
//
// D'ABORD CE QUI EST MESURÉ, ENSUITE CE QUI NE L'EST PAS (F38). L'écran ouvrait sur
// la matrice de capacités : sur une app instrumentée, aucun chiffre n'était visible
// avant le bas de l'écran. La matrice passe en fin, mais son RÉSUMÉ reste en tête
// (« Non collecté : crashes natifs, ANR, démarrage natif ») : aucun chiffre ne se
// lit sans son angle mort. Le hero est la stabilité PAR RELEASE — la coupe où
// numérateur et dénominateur parlent de la même population (la release est un
// fait exact de la session mobile).
//
// Toutes les mesures portent sur la même cohorte (`runtime = 'react_native'`,
// sessions COMMENCÉES dans la fenêtre), chaque lecture dans une photographie en
// lecture répétable (lib/queries-mobile.ts). Seuls `device`, `os` et `release`
// s'appliquent (lib/surfaces.ts) ; les vues préréglées ne posent que `os` ou
// `release` — le formulaire « Plateforme » a disparu (§ 3.1, règle 4).
//
// DANS LE TEMPS, ET AILLEURS (F39, après B8). La série « Sessions et erreurs JS
// dans le temps » découpe la même cohorte, seau par seau, et se lit dans la MÊME
// photographie que les tuiles (`mobileResumeEtSerie`, revue de fin de vague 8) :
// la somme des barres est la tuile. Depuis que le runtime est une dimension de lecture
// (`seg=v2:runtime:eq:react_native`, B8), la cohorte s'ouvre aussi sur /sessions,
// sur /pages et dans l'Explorer — seulement là où l'écran cible applique le filtre
// de bout en bout ; sinon la raison est écrite à la place du lien.
import Link from "next/link";
import type { ReactNode } from "react";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { ImpactTable, type ImpactLigne } from "@/components/ImpactTable";
import { PageHeader } from "@/components/PageHeader";
import { PresetBar } from "@/components/PresetBar";
import { EtenduePercentiles } from "@/components/charts/EtenduePercentiles";
import { Figure } from "@/components/charts/Figure";
import { KpiTile } from "@/components/charts/KpiTile";
import { RankBar } from "@/components/charts/RankBar";
import { StabiliteParRelease, type TriStabilite } from "@/components/mobile/StabiliteParRelease";
import { MobileDansLeTemps } from "@/components/mobile/MobileDansLeTemps";
import { EtatSurface } from "@/components/states/EtatSurface";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import { chargerMobile } from "@/lib/chargeurs/mobile";
import { chargerEcran } from "@/lib/ecran-local";
import { type SearchParams } from "@/lib/filters";
import { formater } from "@/lib/fmt-ids";
import { classerParGravite, SEUIL_ECHANTILLON_FAIBLE } from "@/lib/impact";
import {
  CAPABILITY_LABELS,
  CAPABILITY_NOTES,
  ERROR_FREE_REASONS,
  PLATFORMS,
  PLATFORM_LABELS,
  PLATFORM_OS,
  STATE_LABELS,
  derniereReleaseDeclaree,
  ordreZonesMobile,
  parsePlatform,
  sessionsCohorte,
  texteRaisonTaux,
  type CapabilityStatus,
  type MobileCapability,
  type ZoneMobile,
} from "@/lib/mobile-capabilities";
import { vuesMobiles, type Entree } from "@/lib/presets";
import { type MobileSummary as MobileSummaryBrut } from "@/lib/queries-mobile";
import type { Fil } from "@mip/console-contract";
import { hrefWithQuery, intersectQuery, paramReader, previousRange, rangeLabel } from "@/lib/query-contract";
import { ecartProportions, intervalleWilson } from "@/lib/stats/incertitude";
import { lireComparaison, lireTri } from "@/lib/view-state";
import { explorerPlanParams } from "@/lib/explorer-page-params";
import { lienCohorte } from "@/lib/mobile-capabilities";
import { annotationsDeploiementsCohorte } from "@/lib/mobile-capabilities";
import { PLAN_SESSIONS_COMMENCEES } from "@/lib/queries-sessions";
import { bucketStarts } from "@/lib/query-contract";
import { gabaritZoom } from "@/lib/view-state";

export const dynamic = "force-dynamic";

/** Le résumé tel que le chargeur le rend, sur le fil. */
type MobileSummary = Fil<MobileSummaryBrut>;

const BADGE: Record<CapabilityStatus["state"], string> = {
  active: "border-good/40 bg-good/10 text-good-ink",
  unavailable: "border-warn/40 bg-warn/10 text-warn-ink",
  unknown: "border-line bg-panel2 text-ink-soft",
};

/** Les trois capacités qu'aucune version du SDK JavaScript n'observe (P8.5). */
const NATIVES: readonly MobileCapability[] = ["native_crashes", "anr", "native_start"];

const DATE_UTC = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const dateUtc = (iso: string) => `${DATE_UTC.format(new Date(iso))} UTC`;
const nombre = (n: number) => n.toLocaleString("fr-FR");

/** W-M1 : l'angle mort, écrit AVANT le premier chiffre. */
function texteAnglesMorts(capacites: CapabilityStatus[] | null): string {
  const natives = NATIVES.map((c) => CAPABILITY_LABELS[c]).join(", ");
  const parties = [`${natives} : non mesurés par cette version du SDK, qui n'observe que la couche JavaScript`];
  if (capacites) {
    const autres = capacites.filter((c) => !NATIVES.includes(c.capability));
    const refusees = autres.filter((c) => c.state === "unavailable").map((c) => c.label);
    const inconnues = autres.filter((c) => c.state === "unknown").map((c) => c.label);
    if (refusees.length) parties.push(`déclaré non collecté : ${refusees.join(", ")}`);
    if (inconnues.length) parties.push(`aucune déclaration, état inconnu : ${inconnues.join(", ")}`);
  }
  return `${parties.join(" ; ")}.`;
}

export default async function MobilePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // Le chargeur (`lib/chargeurs/mobile.ts`) lit filtres, schéma et sections.
  const d = await chargerEcran(chargerMobile, sp);
  if (d.etat === "refus") return <FilterProblemNotice title="Mobile" problem={d.problem} />;
  const query = d.query;
  const lecteur = paramReader(sp);

  // Réglages d'affichage : comparaison (défaut `prev` sur un écran Performance) et
  // ordre du hero. Sans `tri`, le hero garde l'ordre de la SOURCE (chronologie des
  // releases) — « fourni » n'est jamais une valeur d'URL (§ 3.1).
  const comparaisonLue = lireComparaison("/mobile", lecteur);
  const prev = comparaisonLue.valeur.mode === "prev";
  const triLu = lecteur.get("tri") ? lireTri("/mobile", lecteur) : null;
  // Un `tri` ignoré (valeur inconnue, `impact` avant B2) laisse l'ordre par défaut de
  // CET écran — la chronologie —, pas le défaut générique de `lireTri`.
  const triHero: TriStabilite = !triLu || triLu.ignore ? "fourni" : triLu.tri === "volume" ? "volume" : "gravite";
  // L'ancien paramètre `platform` n'est plus lu par l'écran : il est dit, jamais ignoré en silence (V10).
  const plateformeHeritee = parsePlatform(lecteur.get("platform"));
  const ignores = [
    ...comparaisonLue.ignores,
    ...(triLu?.ignore ? [triLu.ignore] : []),
    ...(lecteur.get("platform") ? [`Réglage d'affichage ignoré : platform=${lecteur.get("platform")} (le filtre de plateforme est devenu une vue préréglée).`] : []),
  ];

  const precedente = prev ? previousRange(query.range) : null;
  const reference = precedente
    ? `vs période précédente (${rangeLabel({ ...precedente, preset: null }, "UTC")} UTC)`
    : undefined;

  const schemaLu = d.schema;
  const schema = schemaLu.ok ? schemaLu.data : undefined;
  const filtreRelease = query.filters.release !== undefined || query.filters.segments.some((c) => c.dimension === "release");
  const { resume, parRelease, resumePrec, parReleasePrec, declarationsToutes, serieLue, deploysLus } = d;
  const couvSessions = d.couvSessions ?? undefined;
  const couvErreurs = d.couvErreurs ?? undefined;

  const data: MobileSummary | null = resume.ok ? resume.data : null;
  const dataPrec = resumePrec.ok ? resumePrec.data : null;
  const etatParRelease: "disponible" | "indisponible" | "erreur" = !parRelease.ok
    ? "erreur"
    : parRelease.data.disponible
      ? "disponible"
      : "indisponible";
  const releasesLues = parRelease.ok && parRelease.data.disponible ? parRelease.data : null;
  const releasesPrec = parReleasePrec.ok && parReleasePrec.data?.disponible ? parReleasePrec.data : null;

  // ── Vues préréglées : iOS, Android, dernière release déclarée ──
  const declarationsVues = filtreRelease ? (declarationsToutes.ok ? declarationsToutes.data : null) : (data?.declarations ?? null);
  const derniereRelease: Entree<string | null> = declarationsVues
    ? { valeur: derniereReleaseDeclaree(declarationsVues) }
    : { indisponible: "déclarations de capacités non lues" };
  const vues = vuesMobiles({
    plateformes: PLATFORMS.map((p) => ({ cle: p, libelle: PLATFORM_LABELS[p], os: PLATFORM_OS[p] })),
    derniereRelease,
  });

  // ── Liens ──
  // CE7 : `/errors/issues` n'a pas de page ; la liste des erreurs lit `source` elle-même.
  const lienErreurs = hrefWithQuery("/errors", query, { source: "react_native_js" });
  // Une release `null` ne s'écrit pas `release=` (vide) : `seg=v2:release:is_null` (§ 3.3).
  // Sous plusieurs apps, la ligne est celle d'UNE app : le lien la pose aussi (`app`
  // est un paramètre du contrat), sinon il ouvrirait la même release de toutes les apps.
  const hrefDeRelease = (release: string | null, app: string) => {
    const appLigne = query.scope.requestedApp === null ? { app } : {};
    return release === null
      ? hrefWithQuery(
          "/mobile",
          intersectQuery(query, { conditions: [{ dimension: "release", operator: "is_null", value: null }] }),
          appLigne,
        )
      : hrefWithQuery("/mobile", query, { ...appLigne, release });
  };
  // B8 : la cohorte React Native sur un autre écran du contrat, seulement s'il applique
  // `seg=v2:runtime:eq:react_native` de bout en bout (périmètre compris) ; sinon la raison.
  const runtimeLu = schema ? schema.runtime : null;
  const lienSessions = lienCohorte(query, "/sessions", runtimeLu);
  const raisonLienEcrans = lienCohorte(query, "/pages", runtimeLu).raison;
  const lienEcran = (route: string) => lienCohorte(query, "/pages", runtimeLu, { route }).href ?? undefined;
  // L'Explorer rejoue le panneau des sessions de la série (même définition que la tuile).
  const lienExplorer = lienCohorte(query, "/explorer", runtimeLu, { ...explorerPlanParams(PLAN_SESSIONS_COMMENCEES), cursor: null });
  // Annotations de déploiement de la série (§ 3.7) : une annotation ouvre cet écran
  // filtré sur la release déployée — /mobile ne compare pas deux releases en série.
  // Seuls les marqueurs dont la version est une release de la cohorte, dans leur app,
  // sont posés : un déploiement web n'a rien à faire sur la série React Native, et son
  // lien ouvrirait une cohorte vide. Les écartés sont comptés sous la figure (revue v8).
  // Sous plusieurs apps, le lien pose l'app du marqueur, comme `hrefDeRelease`.
  const deploiements = deploysLus.ok
    ? annotationsDeploiementsCohorte(deploysLus.data, query.range, (release, app) =>
        hrefWithQuery("/mobile", query, { ...(query.scope.requestedApp === null ? { app } : {}), release }),
      )
    : { annotations: [], liste: [], indisponible: "lecture des marqueurs de déploiement en échec" };
  const hrefTri = (tri: TriStabilite) =>
    hrefWithQuery("/mobile", query, {
      tri: tri === "fourni" ? null : tri,
      cmp: lecteur.get("cmp"),
      rel_a: lecteur.get("rel_a"),
      rel_b: lecteur.get("rel_b"),
    });

  // ── Tuiles (W-M2 à W-M5) ──
  const sessionsLues = data ? sessionsCohorte(data) : { valeur: null, raison: "lecture du résumé mobile en échec" };
  const sessionsPrec = dataPrec ? sessionsCohorte(dataPrec).valeur : null;
  const capaciteJs = data?.capabilities.find((c) => c.capability === "js_errors")?.state ?? "unknown";
  const erreurs = data?.js_errors ?? null;
  const occurrences = capaciteJs === "unavailable" ? null : (erreurs?.occurrences ?? null);
  const raisonOccurrences =
    capaciteJs === "unavailable"
      ? "Non collecté : les erreurs JavaScript sont déclarées non collectées sur ce périmètre"
      : data
        ? "Inconnu : source d'erreur non lisible sur ce schéma (migration v69)"
        : "lecture du résumé mobile en échec";

  const taux = releasesLues?.declarantes ?? null;
  const tauxPrec = releasesPrec?.declarantes ?? null;
  // Repli (§ 5.6.4, W-M5) : sans lecture par release, le taux global de `mobileSummary`,
  // dont l'état de collecte est lu sur TOUT le parc — et on le dit.
  const repliTaux = !taux && data !== null;
  const declarationJsNonActive = (data?.declarations ?? []).some((d) => d.capability === "js_errors" && !d.declared);
  const tuileTaux = taux
    ? {
        valeur: taux.rate,
        raison: taux.reason ? texteRaisonTaux(taux.reason) : undefined,
        k: taux.sessions - taux.touchees,
        n: taux.sessions,
        precedent: tauxPrec ? tauxPrec.rate : null,
        kPrec: tauxPrec ? tauxPrec.sessions - tauxPrec.touchees : 0,
        nPrec: tauxPrec?.sessions ?? 0,
        lecture:
          taux.rate === null
            ? undefined
            : `${nombre(taux.touchees)} session${taux.touchees > 1 ? "s" : ""} touchée${taux.touchees > 1 ? "s" : ""} sur ${nombre(taux.sessions)}, releases déclarantes seulement ; ${nombre(taux.exclues)} session${taux.exclues > 1 ? "s" : ""} de releases non déclarantes exclue${taux.exclues > 1 ? "s" : ""}.`,
      }
    : data
      ? {
          valeur: data.js_error_free_session_rate,
          raison: data.js_error_free_unavailable_reason ? ERROR_FREE_REASONS[data.js_error_free_unavailable_reason] : undefined,
          k: data.sessions.sessions - (erreurs?.sessions_affected ?? 0),
          n: data.sessions.sessions,
          precedent: dataPrec ? dataPrec.js_error_free_session_rate : null,
          kPrec: dataPrec ? dataPrec.sessions.sessions - (dataPrec.js_errors?.sessions_affected ?? 0) : 0,
          nPrec: dataPrec?.sessions.sessions ?? 0,
          lecture: declarationJsNonActive
            ? "État de collecte lu sur tout le parc : des sessions de releases non déclarantes peuvent être comptées sans erreur."
            : undefined,
        }
      : null;

  const tuiles = (
    <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="mobile-kpi">
      <div className="grid min-w-0" data-testid="mobile-sessions">
        <KpiTile
          label="Sessions React Native commencées"
          valeur={sessionsLues.valeur}
          format="count"
          raisonNull={sessionsLues.raison ?? undefined}
          sensMeilleur="neutre"
          // B8 : la tuile ouvre la liste des sessions de la cohorte, quand /sessions sait la lire.
          href={lienSessions.href ?? undefined}
          precedent={prev ? sessionsPrec : undefined}
          reference={reference}
          couverturePrecedente={couvSessions}
        />
      </div>
      <div className="grid min-w-0" data-testid="mobile-visiteurs">
        <KpiTile
          label="Visiteurs"
          valeur={data?.sessions.visitors ?? null}
          format="count"
          raisonNull={
            !data
              ? "lecture du résumé mobile en échec"
              : sessionsLues.valeur === null
                ? (sessionsLues.raison ?? undefined)
                : "Inconnu : aucune session ne porte d'identifiant de visiteur"
          }
          sensMeilleur="neutre"
          precedent={prev ? (dataPrec?.sessions.visitors ?? null) : undefined}
          reference={reference}
          couverturePrecedente={couvSessions}
          lecture={
            data
              ? `${
                  data.sessions.sessions_without_visitor > 0
                    ? `${nombre(data.sessions.sessions_without_visitor)} session(s) sans identifiant, non rattachables. `
                    : ""
                }Surestimés : identifiant d'installation tenu en mémoire, renouvelé à chaque lancement (parité C3).`
              : undefined
          }
        />
      </div>
      <div className="grid min-w-0" data-testid="mobile-erreurs">
        <KpiTile
          label="Occurrences d'erreurs JS"
          valeur={occurrences}
          format="count"
          raisonNull={raisonOccurrences}
          sensMeilleur="bas"
          precedent={prev && capaciteJs !== "unavailable" ? (dataPrec?.js_errors?.occurrences ?? null) : undefined}
          reference={reference}
          couverturePrecedente={couvErreurs}
          href={lienErreurs}
          lecture={
            erreurs && occurrences !== null
              ? `dont ${nombre(erreurs.crashes)} non interceptée(s), ${nombre(erreurs.unhandled_rejections)} rejet(s) de promesse · fatales : ${
                  erreurs.fatal === null ? "Inconnu" : nombre(erreurs.fatal)
                }${capaciteJs === "unknown" ? " — capacité non déclarée par le SDK : 0 ne prouve pas l'absence d'erreur" : ""}`
              : undefined
          }
        />
      </div>
      <div className="grid min-w-0" data-testid="mobile-taux-sans-erreur">
        <KpiTile
          label="Sessions sans erreur JS"
          valeur={tuileTaux?.valeur ?? null}
          format="pct"
          raisonNull={tuileTaux ? tuileTaux.raison : "lecture du résumé mobile en échec"}
          sensMeilleur="haut"
          precedent={prev && tuileTaux ? tuileTaux.precedent : undefined}
          reference={reference}
          couverturePrecedente={couvSessions}
          // P*.1 : Wilson sur le numérateur BRUT ; aucun intervalle sans taux.
          intervalle={tuileTaux && tuileTaux.valeur !== null ? (intervalleWilson(tuileTaux.k, tuileTaux.n) ?? undefined) : undefined}
          ecart={
            prev && tuileTaux && tuileTaux.valeur !== null && tuileTaux.precedent != null
              ? ecartProportions(tuileTaux.k, tuileTaux.n, tuileTaux.kPrec, tuileTaux.nPrec)
              : undefined
          }
          couverture={
            tuileTaux && tuileTaux.valeur !== null
              ? { n: tuileTaux.n, unite: repliTaux ? "sessions" : "sessions de releases déclarantes", faibleSous: 30 }
              : undefined
          }
          lecture={[
            tuileTaux?.lecture,
            "Erreurs JavaScript seulement : les crashes natifs ne sont pas collectés, ce taux n'en dit rien.",
          ]
            .filter(Boolean)
            .join(" ")}
        />
      </div>
    </div>
  );

  // ── Zones ──
  const capacites = data?.capabilities ?? null;
  const zones: Record<ZoneMobile, ReactNode> = {
    "angles-morts": (
      <div className="mb-4 flex min-w-0 flex-wrap items-start gap-2" data-testid="mobile-angles-morts">
        <div className="min-w-0 flex-1 basis-64">
          <EtatSurface etat={{ kind: "non_collecte", manque: texteAnglesMorts(capacites) }} compact />
        </div>
        <Link
          href="#capacites"
          className="shrink-0 rounded px-1 py-1.5 text-xs font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
        >
          Détail
        </Link>
      </div>
    ),
    bandeaux: (
      <div className="flex min-w-0 flex-col gap-2 empty:hidden [&:not(:empty)]:mb-4">
        {ignores.map((ligne) => (
          <p key={ligne} role="note" className="text-xs text-ink-soft" data-testid="reglage-ignore">
            {ligne}
            {plateformeHeritee && ligne.startsWith("Réglage d'affichage ignoré : platform=") && (
              <>
                {" "}
                <Link className="font-medium text-brand hover:underline" href={hrefWithQuery("/mobile", query, { os: PLATFORM_OS[plateformeHeritee] })}>
                  Vue « {PLATFORM_LABELS[plateformeHeritee]} »
                </Link>
              </>
            )}
          </p>
        ))}
        {data?.unavailable.map((raison) => (
          <div key={raison} data-testid="mobile-partiel">
            <EtatSurface etat={{ kind: "partiel", raison: `réponse partielle, ${raison}.` }} compact />
          </div>
        ))}
        {data?.sampling.min_inclusion_probability != null && data.sampling.min_inclusion_probability < 1 && (
          <EtatSurface etat={{ kind: "echantillonne", probaMin: data.sampling.min_inclusion_probability, unite: "session" }} compact />
        )}
      </div>
    ),
    kpi: tuiles,
    stabilite: (
      <SectionErreur titre="Stabilité par release">
        {!parRelease.ok ? (
          <div className="mb-6">
            <EchecLecture titre="Stabilité par release" />
          </div>
        ) : !parRelease.data.disponible ? (
          <section className="card mb-6 min-w-0 p-4" data-testid="mobile-stabilite" aria-labelledby="mobile-stabilite-repli">
            <h2 id="mobile-stabilite-repli" className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
              Stabilité par release
            </h2>
            <EtatSurface etat={{ kind: "partiel", raison: parRelease.data.raison }} />
          </section>
        ) : (
          <StabiliteParRelease
            resultat={parRelease.data}
            tri={triHero}
            triHref={{ fourni: hrefTri("fourni"), gravite: hrefTri("gravite"), volume: hrefTri("volume") }}
            hrefDeRelease={hrefDeRelease}
            plage={d.label}
          />
        )}
      </SectionErreur>
    ),
    "demarrage-ecrans": (
      <div className="mb-6 grid min-w-0 gap-4 lg:grid-cols-2">
        <SectionErreur titre="Démarrage JS jusqu'au premier écran">
          <Figure
            titre="Démarrage JS jusqu'au premier écran"
            id="mobile-demarrage"
            etat={data ? undefined : { kind: "erreur", titre: "Démarrage JS jusqu'au premier écran" }}
            meta={
              data ? (
                <>
                  <span>{d.label}</span>
                  {dataPrec && (
                    <span>
                      p75 période précédente : à froid {formater("ms", dataPrec.startup.cold?.p75_ms ?? null)}, à chaud{" "}
                      {formater("ms", dataPrec.startup.warm?.p75_ms ?? null)}
                    </span>
                  )}
                </>
              ) : undefined
            }
            lecture={
              <>
                Depuis l&apos;initialisation du SDK jusqu&apos;au premier écran que l&apos;application déclare rendu. Ce
                n&apos;est pas le démarrage natif : ni le lancement du processus, ni le pré-main, ni l&apos;écran de
                lancement n&apos;y figurent. Aucun seuil de démarrage n&apos;est publié : aucune couleur de verdict.
                {data && (!data.startup.cold || !data.startup.warm) && (
                  <> Non mesuré : l&apos;application n&apos;a déclaré aucun premier écran sur la fenêtre.</>
                )}
              </>
            }
          >
            {data && (
              <EtenduePercentiles
                format="ms"
                lignes={[
                  { libelle: "À froid", m: data.startup.cold },
                  { libelle: "À chaud", m: data.startup.warm },
                ].map(({ libelle, m }) => ({
                  libelle,
                  n: m?.samples ?? 0,
                  p50: m?.p50_ms ?? null,
                  p75: m?.p75_ms ?? null,
                  p95: m?.p95_ms ?? null,
                }))}
              />
            )}
          </Figure>
        </SectionErreur>
        <SectionErreur titre="Écrans les plus consultés">
          <Figure
            titre="Écrans les plus consultés"
            id="mobile-ecrans"
            etat={data ? undefined : { kind: "erreur", titre: "Écrans les plus consultés" }}
            meta={data ? <span>{d.label} · 10 écrans au plus, par consultations</span> : undefined}
            lecture={
              raisonLienEcrans === null
                ? "Une consultation par écran déclaré. Chaque écran ouvre /pages filtré sur sa route et sur la cohorte React Native (runtime = react_native) : les pages web de même route n'y entrent pas."
                : `Une consultation par écran déclaré. Pas de lien vers /pages : ${raisonLienEcrans}.`
            }
          >
            {data &&
              (() => {
                const total = data.screens.reduce((s, e) => s + e.views, 0);
                return (
                  <RankBar
                    data={data.screens.map((s) => ({
                      label: s.route ?? "Inconnu",
                      href: s.route === null ? undefined : lienEcran(s.route),
                      value: s.views,
                      display: `${nombre(s.views)}${total > 0 ? ` · ${formater("pct", s.views / total)}` : ""}`,
                      sub: `${nombre(s.sessions)} session(s)`,
                    }))}
                    legende="Écrans consultés : consultations, part des consultations des 10 premiers écrans, sessions"
                    emptyLabel={`Aucun écran observé sur la fenêtre. ${CAPABILITY_NOTES.screen_tracking}`}
                  />
                );
              })()}
          </Figure>
        </SectionErreur>
      </div>
    ),
    requetes: (
      <SectionErreur titre="Appels réseau les plus lents">
        {!data ? (
          <div className="mb-6">
            <EchecLecture titre="Appels réseau les plus lents" />
          </div>
        ) : (
          (() => {
            const lignes: ImpactLigne[] = data.resources.map((r) => {
              const libelle = `${r.method ?? "—"} ${r.path || "—"}`;
              const partErreurs = r.calls > 0 ? r.errors / r.calls : null;
              return {
                cle: `${r.method ?? ""} ${r.path}`,
                libelle,
                href: null,
                description: `${libelle} : p75 ${formater("ms", r.p75_ms)}, ${nombre(r.calls)} appels`,
                pilote: r.p75_ms,
                volume: r.calls,
                mesures: [
                  { cle: "max", valeur: r.max_ms, affichage: formater("ms", r.max_ms) },
                  { cle: "erreurs", valeur: partErreurs, affichage: formater("pct", partErreurs) },
                ],
                echantillonFaible: r.calls < SEUIL_ECHANTILLON_FAIBLE,
              };
            });
            return (
              <ImpactTable
                titre="Appels réseau les plus lents"
                tri="fourni"
                triHref={{ gravite: null, volume: null, impact: null, fourni: null }}
                ordreLibelle="Ordre : les 10 appels au p75 le plus élevé, du plus lent au plus rapide ; moins de 30 appels en fin de liste. La lecture s'arrête à 10 appels distincts."
                reference={null}
                referenceRaison="p75 de l'ensemble des appels non calculé : aucune lecture ne le rend."
                lignes={classerParGravite(lignes, { pilote: (l) => l.pilote, effectif: (l) => l.volume, tri: "gravite" }).lignes}
                colonnes={["Max", "Réponses ≥ 400"]}
                unitePilote="ms"
                volumeLibelle="Appels"
                groupes={lignes.length}
                tronque={false}
                notice="Appels réseau émis par l'application, origine retirée du chemin. Mesurer la latence d'une origine tierce n'expose rien à ce tiers : aucun en-tête MIP n'est envoyé hors des origines déclarées. Pas de lien : le tracing ne filtre pas par chemin."
              />
            );
          })()
        )}
      </SectionErreur>
    ),
    temps: (
      <div className="mb-6">
        <SectionErreur titre="Sessions et erreurs JS dans le temps">
          <MobileDansLeTemps
            lecture={serieLue}
            starts={bucketStarts(query.range)}
            seauSecondes={query.range.bucketSeconds}
            plage={d.label}
            zoomHref={gabaritZoom(hrefWithQuery("/mobile", query, { period: null, from: "{from}", to: "{to}" }), sp)}
            annotations={deploiements.annotations}
            annotationsIndisponibles={deploiements.indisponible}
            capaciteJs={capaciteJs}
            explorer={lienExplorer.href ?? undefined}
          />
        </SectionErreur>
      </div>
    ),
    capacites: (
      <section id="capacites" className="card mb-6 min-w-0 p-4" aria-labelledby="mobile-capacites">
        <h2 id="mobile-capacites" className="text-sm font-semibold text-ink">
          Ce qui est collecté, et ce qui ne l&apos;est pas
        </h2>
        <p className="mt-1 text-xs text-ink-soft">
          Déclaré par le SDK, par application, runtime et release, sans fenêtre : une déclaration n&apos;est pas une
          occurrence. Une capacité activée n&apos;est pas un test natif passé : seule une recette d&apos;opérateur
          renseigne la colonne « Vérifié ».
        </p>
        {!data ? (
          <div className="mt-3">
            <EchecLecture titre="Capacités déclarées" />
          </div>
        ) : (
          // Une seule table ; sous 640 px chaque ligne devient une carte (libellés en tête de cellule).
          <table className="mt-3 block w-full text-sm sm:table">
            <caption className="sr-only">Capacités de collecte déclarées par le runtime mobile</caption>
            <thead className="hidden bg-panel2 sm:table-header-group">
              <tr>
                <th scope="col" className="th text-ink-soft">Capacité</th>
                <th scope="col" className="th text-ink-soft">État</th>
                <th scope="col" className="th text-ink-soft">Releases déclarantes</th>
                <th scope="col" className="th text-ink-soft">Dernière déclaration</th>
                <th scope="col" className="th text-ink-soft">Vérifié (recette)</th>
              </tr>
            </thead>
            <tbody className="block sm:table-row-group">
              {data.capabilities.map((c) => (
                <tr
                  key={c.capability}
                  data-testid={`capacite-${c.capability}`}
                  className="mb-2 block rounded-lg border border-line/60 p-2 align-top sm:mb-0 sm:table-row sm:rounded-none sm:border-0 sm:border-t sm:p-0"
                >
                  <th scope="row" className="block px-2 py-1 text-left font-normal sm:table-cell sm:px-4 sm:py-3">
                    <div className="font-medium text-ink">{c.label}</div>
                    <details className="mt-1 text-xs text-ink-soft">
                      <summary className="cursor-pointer select-none hover:text-ink">Ce que l&apos;absence veut dire</summary>
                      <p className="mt-1 max-w-md">{c.note}</p>
                    </details>
                  </th>
                  <td className="block px-2 py-1 sm:table-cell sm:px-4 sm:py-3">
                    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${BADGE[c.state]}`}>
                      {STATE_LABELS[c.state]}
                    </span>
                  </td>
                  <td className="block px-2 py-1 text-xs text-ink-soft sm:table-cell sm:px-4 sm:py-3">
                    <span className="sm:hidden">Releases déclarantes : </span>
                    {c.declared_by.length ? (
                      <ul className="inline sm:block">
                        {c.declared_by.map((r) => (
                          <li key={r ?? "__inconnue"} className="inline after:content-[',_'] last:after:content-none sm:block sm:after:content-none">
                            {r ?? "release inconnue"}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="block px-2 py-1 text-xs text-ink-soft sm:table-cell sm:px-4 sm:py-3" data-testid="capacite-derniere-declaration">
                    <span className="sm:hidden">Dernière déclaration : </span>
                    {c.last_declared_at ? dateUtc(c.last_declared_at) : "—"}
                  </td>
                  <td className="block px-2 py-1 text-xs text-ink-soft sm:table-cell sm:px-4 sm:py-3">
                    <span className="sm:hidden">Vérifié (recette) : </span>
                    {c.verified_at ? `${dateUtc(c.verified_at)}${c.verified_by ? ` · ${c.verified_by}` : ""}` : "Jamais"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    ),
    "plus-loin": (
      <nav className="flex flex-wrap items-center gap-3 text-sm" aria-label="Aller plus loin">
        <Link href={lienErreurs} data-testid="mobile-lien-erreurs" className="btn-ghost">
          Erreurs React Native
        </Link>
        {/* CE8 : `device=mobile` ouvrait les navigateurs mobiles, pas la cohorte React
            Native. Depuis B8, la liste lit `seg=v2:runtime:eq:react_native` ; là où elle
            ne le peut pas (release filtrée, runtime non collecté), le lien n'est pas un
            lien : désactivé, avec sa raison écrite. */}
        {lienSessions.href !== null ? (
          <Link href={lienSessions.href} data-testid="mobile-lien-sessions" className="btn-ghost">
            Sessions React Native
          </Link>
        ) : (
          <>
            <span
              data-testid="mobile-lien-sessions"
              aria-disabled="true"
              className="btn-ghost cursor-not-allowed opacity-60"
              title={`Indisponible : ${lienSessions.raison}.`}
            >
              Sessions React Native
            </span>
            <span className="min-w-0 basis-full text-xs text-ink-soft sm:basis-auto" data-testid="mobile-lien-sessions-raison">
              Indisponible : {lienSessions.raison}.
            </span>
          </>
        )}
      </nav>
    ),
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Mobile"
        domain="perf"
        sub={`Comment se comporte l'app React Native sur ${d.label}, et que ne mesurons-nous pas ?`}
      />
      <div className="mb-4 min-w-0">
        <PresetBar vues={vues} actif={null} />
      </div>
      {ordreZonesMobile(etatParRelease).map((zone) => (
        <div key={zone} data-zone={zone} className="min-w-0">
          {zones[zone]}
        </div>
      ))}
    </div>
  );
}
