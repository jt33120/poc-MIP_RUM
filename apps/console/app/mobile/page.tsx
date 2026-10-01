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
import { ECRANS } from "@mip/console-contract";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { ImpactTable, type ImpactLigne } from "@/components/ImpactTable";
import { InfoTip } from "@/components/InfoTip";
import { SOURCE_MOBILE } from "@/components/perf/sources";
import { PageHeader } from "@/components/PageHeader";
import { PresetBar } from "@/components/PresetBar";
import { EtenduePercentiles } from "@/components/charts/EtenduePercentiles";
import { Figure } from "@/components/charts/Figure";
import { KpiTile } from "@/components/charts/KpiTile";
import { RankBar } from "@/components/charts/RankBar";
import { StabiliteParRelease, faibleUneFois, type TriStabilite } from "@/components/mobile/StabiliteParRelease";
import { MobileDansLeTemps } from "@/components/mobile/MobileDansLeTemps";
import { EtatSurface } from "@/components/states/EtatSurface";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import { chargerMobile } from "@/lib/chargeurs/mobile";
import { validerCapaciteAction } from "./actions";
import { chargerEcran } from "@/lib/ecran";
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
import { ecartProportions, intervalleWilson } from "@mip/stats/incertitude";
import { lireComparaison, lireTri } from "@/lib/view-state";
import { explorerPlanParams } from "@/lib/explorer-page-params";
import { lienCohorte, SANS_RELEASE } from "@/lib/mobile-capabilities";
import { annotationsDeploiementsCohorte } from "@/lib/mobile-capabilities";
import { PLAN_SESSIONS_COMMENCEES } from "@/lib/queries-sessions";
import { bucketStarts } from "@/lib/query-contract";
import { gabaritZoom } from "@/lib/view-state";
import { FUSEAU_AFFICHAGE } from "@/lib/fuseau-local";
import { fenetresLues } from "@/lib/series";
import { accord, fmtInstant, pluriel } from "@/lib/format";
import { AUTRES } from "@/lib/palette";
import { RangeeKpi } from "@/components/charts/RangeeKpi";

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

// Heure de Paris, comme toute la console (le nom `dateUtc` est historique).
const dateUtc = (iso: string) => fmtInstant(iso, { annee: true, sansA: true });
const nombre = (n: number) => n.toLocaleString("fr-FR");

/** Teinte des barres de volume (écrans consultés) : neutre (ardoise), ni orange ni verdict. */
const TEINTE_VOLUME = AUTRES;

/**
 * W-M1 : l'angle mort, écrit AVANT le premier chiffre. `ecransDeclares` : l'écran
 * affiche des écrans que l'application déclare elle-même ; sans suivi automatique,
 * on le dit, sinon « Suivi… : non collecté » contredisait la liste d'écrans
 * juste en dessous (recette du 26/09/2026).
 */
function texteAnglesMorts(capacites: CapabilityStatus[] | null, ecransDeclares: boolean): string {
  const natives = NATIVES.map((c) => CAPABILITY_LABELS[c]).join(", ");
  const parties = [`${natives} : non mesurés par le capteur actuel, qui n'observe que la couche JavaScript`];
  if (capacites) {
    const autres = capacites.filter((c) => !NATIVES.includes(c.capability));
    const refusees = autres.filter((c) => c.state === "unavailable").map((c) => c.label);
    const inconnues = autres.filter((c) => c.state === "unknown").map((c) => c.label);
    if (refusees.length) parties.push(`déclaré non collecté : ${refusees.join(", ")}`);
    if (inconnues.length) parties.push(`aucune déclaration, état inconnu : ${inconnues.join(", ")}`);
    const suiviEcrans = autres.find((c) => c.capability === "screen_tracking");
    if (ecransDeclares && suiviEcrans?.state === "unavailable") {
      parties.push("les écrans que l'application déclare elle-même restent affichés plus bas");
    }
  }
  return `${parties.join(" ; ")}.`;
}

/** Libellé court d'une capacité, pour une pastille (« ANR » plutôt que sa définition). */
const LIBELLE_COURT: Partial<Record<MobileCapability, string>> = { anr: "ANR" };

/**
 * Les capacités qu'on ne voit pas, en pastilles : les trois natives, puis celles que
 * le capteur déclare non collectées ou ne déclare pas. La phrase de `texteAnglesMorts`
 * dit la même chose, avec les raisons.
 */
function anglesMorts(capacites: CapabilityStatus[] | null): string[] {
  const autres = (capacites ?? []).filter((c) => !NATIVES.includes(c.capability) && c.state !== "active");
  return [...NATIVES, ...autres.map((c) => c.capability)].map((c) => LIBELLE_COURT[c] ?? CAPABILITY_LABELS[c]);
}

export default async function MobilePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // Le chargeur (`lib/chargeurs/mobile.ts`) lit filtres, schéma et sections.
  const d = await chargerEcran(ECRANS.mobile, chargerMobile, sp);
  if (d.etat === "refus") return <FilterProblemNotice title="Mobile" problem={d.problem} />;
  const query = d.query;
  const lecteur = paramReader(sp);
  // R5 (C9) : la recette d'une capacité, pour l'administrateur de la plateforme sur une app nommée.
  const recette = d.recette;

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
    ? `vs période précédente (${rangeLabel({ ...precedente, preset: null }, FUSEAU_AFFICHAGE)})`
    : undefined;

  const schemaLu = d.schema;
  const schema = schemaLu.ok ? schemaLu.data : undefined;
  const filtreRelease = query.filters.release !== undefined || query.filters.segments.some((c) => c.dimension === "release");
  const { resume, parRelease, resumePrec, parReleasePrec, declarationsToutes, serieLue, deploysLus, fenetresCollecte } = d;
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
        ? // v69 absente (`error_source`) : l'origine des erreurs n'est pas lisible.
          "Inconnu : l'origine des erreurs n'est pas encore enregistrée sur cette installation"
        : "lecture du résumé mobile en échec";

  const taux = releasesLues?.declarantes ?? null;
  const tauxPrec = releasesPrec?.declarantes ?? null;
  // Repli (§ 5.6.4, W-M5) : sans lecture par release, le taux global de `mobileSummary`,
  // dont l'état de collecte est lu sur TOUT le parc — et on le dit (lecture ci-dessous).
  // L'effectif s'écrit « sessions comptées » dans les deux cas : « de releases
  // déclarantes » était un terme de conception (recette du 26/09/2026).
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
            : `${pluriel(taux.touchees, "session touchée", "sessions touchées")} sur ${nombre(taux.sessions)}.${
                taux.exclues > 0
                  ? ` ${pluriel(taux.exclues, "session exclue", "sessions exclues")} : ${accord(taux.exclues, "sa release ne déclare", "leurs releases ne déclarent")} pas collecter les erreurs JS.`
                  : ""
              }`,
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
            ? "Certaines releases ne déclarent pas collecter les erreurs JS : leurs sessions peuvent être comptées sans erreur."
            : undefined,
        }
      : null;

  const tuiles = (
    <RangeeKpi
      couvertures={prev ? [couvSessions, couvErreurs] : []}
      className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4"
      testId="mobile-kpi"
    >
      <div className="grid min-w-0" data-testid="mobile-sessions">
        <KpiTile
          label="Sessions React Native commencées"
          libelleCase="Sessions React Native"
          source={SOURCE_MOBILE}
          categorie="Mobile · React Native"
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
          source={SOURCE_MOBILE}
          categorie="Mobile · React Native"
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
              ? data.sessions.sessions_without_visitor > 0
                ? `${pluriel(data.sessions.sessions_without_visitor, "session sans identifiant", "sessions sans identifiant")}, non ${accord(data.sessions.sessions_without_visitor, "rattachable", "rattachables")}.`
                : undefined
              : undefined
          }
          // Vérifié dans `packages/rum-mobile/src/index.ts` (bootstrapIdentite) : l'identifiant
          // d'installation est CONSERVÉ quand le stockage le permet. La phrase d'avant
          // (« renouvelé à chaque lancement ») décrivait le capteur d'avant P7.2.
          methode="Un visiteur est une installation de l'application : un identifiant aléatoire, conservé sur l'appareil. Quand l'appareil ne peut pas le conserver (stockage absent ou plein), il en reçoit un nouveau à chaque lancement et y est compté plusieurs fois."
        />
      </div>
      <div className="grid min-w-0" data-testid="mobile-erreurs">
        <KpiTile
          label="Occurrences d'erreurs JS"
          libelleCase="Erreurs JS"
          source={SOURCE_MOBILE}
          categorie="Mobile · React Native"
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
              ? `dont ${nombre(erreurs.crashes)} non ${accord(erreurs.crashes, "interceptée", "interceptées")}, ${pluriel(
                  erreurs.unhandled_rejections,
                  "rejet de promesse",
                  "rejets de promesse",
                )} · ${accord(erreurs.fatal ?? 0, "fatale", "fatales")} : ${erreurs.fatal === null ? "inconnu" : nombre(erreurs.fatal)}${
                  capaciteJs === "unknown" ? " — collecte non déclarée par le capteur : 0 ne prouve pas l'absence d'erreur" : ""
                }`
              : undefined
          }
        />
      </div>
      <div className="grid min-w-0" data-testid="mobile-taux-sans-erreur">
        <KpiTile
          label="Sessions sans erreur JS"
          source={SOURCE_MOBILE}
          categorie="Mobile · React Native"
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
              ? { n: tuileTaux.n, unite: accord(tuileTaux.n, "session comptée", "sessions comptées"), faibleSous: 30 }
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
    </RangeeKpi>
  );

  // ── Zones ──
  const capacites = data?.capabilities ?? null;
  // Suivi automatique DÉCLARÉ non collecté : les écrans listés sont ceux que l'app déclare elle-même.
  const suiviEcransInactif = capacites?.find((c) => c.capability === "screen_tracking")?.state === "unavailable";
  const zones: Record<ZoneMobile, ReactNode> = {
    "angles-morts": (
      // L'angle mort AVANT le premier chiffre (W-M1), mais sur UNE ligne de pastilles
      // (recette du 30/09/2026 : un bandeau de deux lignes de phrases). La phrase
      // entière reste dans la page, lue par les lecteurs d'écran ; « Détail » mène à
      // la matrice des capacités, en bas de l'écran.
      <div className="mb-3 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px]" data-testid="mobile-angles-morts">
        <div className="sr-only">
          <EtatSurface etat={{ kind: "non_collecte", manque: texteAnglesMorts(capacites, (data?.screens.length ?? 0) > 0) }} compact />
        </div>
        <span aria-hidden className="inline-flex items-center gap-1 rounded-full bg-panel2 px-2.5 py-0.5 font-medium text-ink">
          <span className="text-ink-faint">⊘</span>
          Non collecté
        </span>
        {anglesMorts(capacites).map((libelle) => (
          <span key={libelle} aria-hidden className="rounded-full border border-line px-2 py-0.5 text-ink-soft">
            {libelle}
          </span>
        ))}
        <Link
          href="#capacites"
          className="ml-1 shrink-0 rounded text-xs font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
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
          // Repli sans lecture par release : une ligne, la raison à droite du titre.
          <section className="card mb-4 min-w-0 px-4 py-3" data-testid="mobile-stabilite" aria-labelledby="mobile-stabilite-repli">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 id="mobile-stabilite-repli" className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                Stabilité par release
              </h2>
              <div className="min-w-0 sm:ml-auto">
                <EtatSurface etat={{ kind: "partiel", raison: parRelease.data.raison }} compact />
              </div>
            </div>
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
      <div className="mb-4 grid min-w-0 gap-2 lg:grid-cols-2">
        <SectionErreur titre="Démarrage JS jusqu'au premier écran">
          <Figure
            titre="Démarrage JS jusqu'au premier écran"
            id="mobile-demarrage"
            // Aucun démarrage mesuré : une ligne (recette du 30/09/2026), la raison dans « Méthode ».
            etat={
              !data
                ? { kind: "erreur", titre: "Démarrage JS jusqu'au premier écran" }
                : !data.startup.cold && !data.startup.warm
                  ? { kind: "vide", population: "démarrage mesuré", masculin: true, plage: d.label }
                  : undefined
            }
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
                Depuis le démarrage du capteur jusqu&apos;au premier écran que l&apos;application déclare affiché. Ce
                n&apos;est pas le démarrage natif : ni le lancement du processus, ni l&apos;écran de lancement n&apos;y
                figurent. Aucun seuil de démarrage n&apos;est publié : aucune couleur de verdict.
                {/* « Non mesuré » rattaché à SA ligne : écrit en général, il semblait
                    contredire la ligne « À froid » mesurée juste au-dessus (recette du 26/09/2026). */}
                {data &&
                  [
                    !data.startup.cold ? "à froid" : null,
                    !data.startup.warm ? "à chaud" : null,
                  ]
                    .filter(Boolean)
                    .map((ligne) => (
                      <span key={ligne}>
                        {" "}
                        Démarrage {ligne} non mesuré : aucun démarrage {ligne} n&apos;a atteint un premier écran déclaré sur
                        la fenêtre.
                      </span>
                    ))}
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
            etat={
              !data
                ? { kind: "erreur", titre: "Écrans les plus consultés" }
                : data.screens.length === 0
                  ? { kind: "vide", population: "écran observé", masculin: true, plage: d.label }
                  : undefined
            }
            meta={
              data ? (
                <>
                  <span>{d.label} · 10 écrans au plus, par consultations</span>
                  {suiviEcransInactif && <span>écrans déclarés par l&apos;application (suivi automatique non collecté)</span>}
                </>
              ) : undefined
            }
            lecture={
              data && data.screens.length === 0
                ? `Aucun écran observé sur la fenêtre. ${CAPABILITY_NOTES.screen_tracking}`
                : raisonLienEcrans === null
                  ? "Une consultation par écran affiché. Chaque écran ouvre l'écran Pages filtré sur sa route et sur l'application mobile : les pages web de même route n'y entrent pas."
                  : `Une consultation par écran affiché. Pas de lien vers l'écran Pages : ${raisonLienEcrans}.`
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
                      sub: pluriel(s.sessions, "session"),
                      color: TEINTE_VOLUME,
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
          data.resources.length === 0 ? (
            // Aucun appel mesuré : une ligne, pas une table vide sous une notice.
            <div className="mb-4">
              <Figure
                titre="Appels réseau les plus lents"
                id="mobile-appels"
                etat={{ kind: "vide", population: "appel réseau mesuré", masculin: true, plage: d.label }}
              />
            </div>
          ) : (() => {
            const construites: ImpactLigne[] = data.resources.map((r) => {
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
            // « échantillon faible » dit une fois, en tête, quand toutes les lignes le sont.
            const { lignes, toutesFaibles } = faibleUneFois(
              classerParGravite(construites, { pilote: (l) => l.pilote, effectif: (l) => l.volume, tri: "gravite" }).lignes,
            );
            return (
              <ImpactTable
                titre="Appels réseau les plus lents"
                tri="fourni"
                triHref={{ gravite: null, volume: null, impact: null, fourni: null }}
                // La provenance des appels en bulle, à côté du titre (recette du 30/09/2026).
                commandes={
                  <InfoTip label="Méthode : appels réseau" align="end">
                    Appels réseau émis par l&apos;application, chemin sans son domaine ; les identifiants du chemin sont
                    regroupés (:id). Mesurer la latence d&apos;un service tiers ne lui transmet rien.
                    {toutesFaibles ? ` Chaque appel compte moins de ${SEUIL_ECHANTILLON_FAIBLE} mesures : échantillon faible.` : ""}
                  </InfoTip>
                }
                ordreLibelle={`Ordre : les 10 appels au p75 le plus élevé ; moins de ${SEUIL_ECHANTILLON_FAIBLE} appels en fin.`}
                reference={null}
                referenceRaison="p75 de l'ensemble des appels non calculé."
                lignes={lignes}
                colonnes={["Max", "Réponses ≥ 400"]}
                unitePilote="ms"
                volumeLibelle="Appels"
                groupes={lignes.length}
                tronque={false}
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
            fenetresCollecte={fenetresLues(fenetresCollecte)}
          />
        </SectionErreur>
      </div>
    ),
    capacites: (
      <section id="capacites" className="card mb-4 min-w-0 scroll-mt-4 p-4" aria-labelledby="mobile-capacites">
        {/* Le titre de l'étage, et sa règle de lecture en bulle (recette du 30/09/2026 :
            plus de paragraphe entre le titre et la table). */}
        <div className="flex items-center gap-1.5">
          <h2 id="mobile-capacites" className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
            Ce qui est collecté, et ce qui ne l&apos;est pas
          </h2>
          <InfoTip label="Lecture des capacités" align="start">
            Ce que le capteur de chaque release déclare collecter, toutes périodes confondues : une déclaration n&apos;est
            pas une mesure. La colonne « Vérifié » n&apos;est remplie que lorsqu&apos;un opérateur a constaté la collecte
            sur un appareil.
          </InfoTip>
        </div>
        {!data ? (
          <div className="mt-3">
            <EchecLecture titre="Capacités déclarées" />
          </div>
        ) : (
          // Une seule table ; sous 640 px chaque ligne devient une carte (libellés en tête de cellule).
          <table className="mt-3 block w-full text-sm sm:table">
            <caption className="sr-only">Capacités de collecte déclarées par le capteur mobile</caption>
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
                  <th scope="row" className="block px-2 py-1 text-left font-normal sm:table-cell sm:px-4 sm:py-1.5">
                    {/* Ce que l'absence veut dire : une bulle à côté du nom, plus un repli sous lui. */}
                    <span className="inline-flex items-center gap-1.5 font-medium text-ink">
                      {c.label}
                      <InfoTip label={`Ce que l'absence veut dire : ${c.label}`} align="start">
                        {c.note}
                      </InfoTip>
                    </span>
                  </th>
                  <td className="block px-2 py-1 sm:table-cell sm:px-4 sm:py-1.5">
                    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${BADGE[c.state]}`}>
                      {STATE_LABELS[c.state]}
                    </span>
                  </td>
                  <td className="block px-2 py-1 text-xs text-ink-soft sm:table-cell sm:px-4 sm:py-1.5">
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
                  <td className="block px-2 py-1 text-xs text-ink-soft sm:table-cell sm:px-4 sm:py-1.5" data-testid="capacite-derniere-declaration">
                    <span className="sm:hidden">Dernière déclaration : </span>
                    {c.last_declared_at ? dateUtc(c.last_declared_at) : "—"}
                  </td>
                  <td className="block px-2 py-1 text-xs text-ink-soft sm:table-cell sm:px-4 sm:py-1.5">
                    <span className="sm:hidden">Vérifié (recette) : </span>
                    {c.verified_at ? `${dateUtc(c.verified_at)}${c.verified_by ? ` · ${c.verified_by}` : ""}` : "Jamais"}
                    {/* R5 (C9) : l'administrateur de la plateforme pose la recette d'une capacité
                        DÉCLARÉE active, release par release — un geste audité, plus un `update` direct. */}
                    {recette && c.state === "active" && c.declared_by.length > 0 && (
                      <details className="mt-1" data-testid={`recette-${c.capability}`}>
                        <summary className="cursor-pointer select-none hover:text-ink">Poser la recette</summary>
                        <form action={validerCapaciteAction} className="mt-1 flex flex-wrap items-end gap-2">
                          <input type="hidden" name="app" value={recette.app} />
                          <input type="hidden" name="capability" value={c.capability} />
                          <label className="flex flex-col gap-1">
                            Release
                            <select name="release" className="field">
                              {c.declared_by.map((r) => (
                                <option key={r ?? SANS_RELEASE} value={r ?? SANS_RELEASE}>
                                  {r ?? "release inconnue"}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="flex min-w-0 flex-col gap-1">
                            Ce qui a été vu (appareil, build)
                            <input name="note" maxLength={1000} className="field w-56 max-w-full" />
                          </label>
                          <button type="submit" className="btn-ghost">
                            Recette jouée
                          </button>
                        </form>
                      </details>
                    )}
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
        sub={`Comment se comporte l'app React Native sur ${d.label}, et que ne mesurons-nous pas\u00a0?`}
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
