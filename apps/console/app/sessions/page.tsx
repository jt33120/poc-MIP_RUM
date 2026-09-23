// Sessions (F41, plan § 5.11) : « Quelles sessions regarder en premier, et qui sont
// les visiteurs de cette période ? »
//
// UNE POPULATION PAR FIGURE (S1, R-P). Les tuiles comptent les sessions COMMENCÉES
// (`started_at` dans la fenêtre) — le même nombre que la tuile de trafic de la Vue
// d'ensemble pour la même URL — ; l'anneau compte les sessions ACTIVES (dernière
// activité dans la fenêtre) et le dit dans son titre ; les visiteurs distincts ont
// leur tuile et leur panneau, jamais additionnés aux sessions (V2).
//
// CE QUI A DISPARU (§ 5.11.6) : le hero « Sessions actives / Visites / Part de
// revenants » (trois populations sans question commune ; la part de revenants passe
// dans l'anneau à trois parts) et `ObservedTrend`, courbe sans axe, remplacée par
// deux `ThresholdSeries` sur grille, datées, zoomables.
//
// F42 pose la table dense « Toutes les sessions » (cartes de trois lignes à
// 390 px), les filtres rapides et le hero « À regarder d'abord ». Le CLASSEMENT du
// hero attend B30 (§ 6.3) : tant qu'il manque, le hero dit sa raison et ne classe
// rien — trier les 50 lignes de la page courante donnerait « les plus graves »
// d'un échantillon arbitraire, pas de la fenêtre (§ 5.11.6).
//
// F43 ouvre le PANNEAU de session (`panel=session:<id>`, § 3.5) : une ligne de la
// liste le pose dans l'URL, « Précédent » / « Suivant » (↑ / ↓) parcourent la page
// de liste affichée, « Fermer » (Échap) le retire. Sa lecture part AVEC celles de
// l'écran, et sa garde est celle de la page de session : hors périmètre, aucun
// panneau, une ligne le dit.
import Link from "next/link";
import { cookies } from "next/headers";
import { PageHeader } from "@/components/PageHeader";
import { Breakdown, type BreakdownItem, type OngletDecoupage } from "@/components/Breakdown";
import { Donut } from "@/components/charts/Donut";
import { Figure } from "@/components/charts/Figure";
import { KpiTile } from "@/components/charts/KpiTile";
import { ThresholdSeries } from "@/components/charts/ThresholdSeries";
import { INPUT_CLASS } from "@/components/forms/Field";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { EtatSurface } from "@/components/states/EtatSurface";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import type { SearchParams } from "@/lib/filters";
import { lire, type Lecture } from "@/lib/lecture";
import { pageFilters } from "@/lib/page-filters";
import { BREAKDOWN_NOTICES, BREAKDOWN_PARAM, breakdownDrillHref } from "@/lib/breakdowns";
import {
  ENGAGEMENT_MIN_SESSIONS,
  STILL_ACTIVE_MINUTES,
  engagementRaison,
  engagementSuffisant,
  singleViewSessionRate,
  type EngagementStats,
} from "@/lib/engagement";
import {
  bucketLabel,
  bucketStarts,
  hrefWithQuery,
  paramReader,
  previousRange,
  queryToSearchParams,
} from "@/lib/query-contract";
import { dimensionSchema } from "@/lib/query-schema";
import { listSessions, releaseRechercheParOccurrence, visitStats, type VisitStats } from "@/lib/queries";
import {
  PLAN_SESSIONS_COMMENCEES,
  PLAN_VISITEURS_DISTINCTS,
  REPARTITION_LIMITE,
  engagementStats,
  erreursParSessionCommencee,
  observedVisitorsTrend,
  repartitionSessions,
  samplingSessions,
  visiteursDistincts,
  type RepartitionSessions,
} from "@/lib/queries-sessions";
import { listDeploys } from "@/lib/queries-deploys";
import { retentionDays } from "@/lib/queries-explorer";
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
import { explorerHref } from "@/lib/explorer-page-params";
import { formater } from "@/lib/fmt-ids";
import { CATEGORIELLE } from "@/lib/palette";
import { alignerSeaux, grilleIso, libelleSeauComplet } from "@/lib/series";
import { annotationsDeploiements } from "@/lib/annotations";
import { couverturePrecedente, sourcesSousFiltres, type CouverturePrecedente, type SourceComparaison } from "@/lib/comparaison";
import { AVEC_SESSIONS, VIEW_CONTEXT_PARAMS, contextHref, gabaritZoom, lireComparaison, lireEtatDeVue } from "@/lib/view-state";
import {
  ANCRE_TOUTES_SESSIONS,
  PrioriteSessions,
  alternativePriorite,
  type HrefsPriorite,
} from "@/components/sessions/PrioriteSessions";
import { SessionsTable } from "@/components/sessions/SessionsTable";
import { RAISON_PRIORITE, SIGNAUX_A_CREER, type SessionPrioritaire } from "@/lib/sessions-priorite";
import {
  DIMENSIONS_REPARTITION,
  LIBELLES_REPARTITION,
  SOURCE_VISITEURS,
  couvertureCombinee,
  disponibiliteRepartition,
  hrefGroupe,
  libelleGroupe,
  lectureOccurrences,
  lireRepartition,
  occurrencesParSession,
  parRang,
  partDuTout,
  referencePrecedente,
  resteNonAffiche,
  visiteursAffiches,
  visiteursDuSeau,
  type DimensionRepartition,
} from "@/lib/sessions-kpi";
// F43 — panneau de session.
import { PanneauSession, lirePanneauSession } from "@/components/sessions/PanneauSession";
import { SESSION_INTROUVABLE, voisinsDansLaListe } from "@/lib/panneau-session";
import { ecrirePanel, ligneIgnoree } from "@/lib/view-state";

export const dynamic = "force-dynamic";

/** Paramètre de pagination : une clé opaque, jamais un numéro de page. */
const CURSOR_PARAM = "cursor";

// Sources des comparaisons à la période précédente (§ 3.2). Un compte de sessions
// ou de visiteurs attend encore des lignes sur une heure qui se termine maintenant
// (additif) ; un taux ou une durée les attend au numérateur ET au dénominateur.
const SOURCE_SESSIONS: SourceComparaison = { table: "rum_session", colonneTemps: "started_at", additive: true };
const SOURCE_SESSIONS_TAUX: SourceComparaison = { table: "rum_session", colonneTemps: "started_at", additive: false };
const SOURCE_ERREURS: SourceComparaison = { table: "rum_error", colonneTemps: "ts", additive: false };
// Visiteurs : `SOURCE_VISITEURS` (lib/sessions-kpi.ts), sur le premier `visitor_id` collecté.

/** Sous ce nombre de sessions, un delta se tait : le seuil d'engagement du domaine (S6, `lib/engagement.ts`). */
const FAIBLE_SOUS = ENGAGEMENT_MIN_SESSIONS;

/** Libellés des filtres rapides de la liste (§ 5.11.4) ; leur lecture est B30. */
const LIBELLES_AVEC: Record<(typeof AVEC_SESSIONS)[number], string> = {
  erreurs: "Avec erreurs",
  frustration: "Avec frustration",
  rejeu: "Avec rejeu",
};

/**
 * Hero « À regarder d'abord ». B30 (§ 6.3, `sessionsAPrioriser`) n'est pas livré :
 * cette fonction rend l'ABSENCE DE LECTURE. Le jour où B30 arrive, seul son corps
 * change — la figure, son alternative et ses liens sont déjà écrits en face : une
 * ligne ouvre le panneau (F43), `hrefsPriorite(lignes, pages, panneaux)` avec les
 * liens `lienPanneau(id)` de l'écran.
 */
type LecturePriorite =
  | { lignes: SessionPrioritaire[]; hrefs: Record<string, HrefsPriorite> }
  | { raison: string };

function lirePriorite(): LecturePriorite {
  return { raison: RAISON_PRIORITE };
}

const NOTICE_CAPTEUR =
  "Capteur de la session : le SDK intégré au site, ou l'extension navigateur (même capteur, posé par l'extension sur des postes gérés).";

type ProprietesTuile = Parameters<typeof KpiTile>[0];
type Comparaison = Pick<ProprietesTuile, "precedent" | "reference" | "couverturePrecedente">;

/** Lecture non lancée (bloc éteint, comparaison non demandée) : une valeur sûre, jamais affichée comme mesure. */
const sansLecture = <T,>(data: T): Promise<Lecture<T>> => Promise.resolve({ ok: true, data });

export default async function Sessions({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ecran = await pageFilters(sp, "/sessions");
  if (!ecran.ok) return <FilterProblemNotice title="Sessions" problem={ecran.problem} />;
  const f = ecran.filters;
  const query = ecran.query;
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
  // la sienne. La rangée de KPI et le bandeau d'échantillonnage ne sont pas des
  // blocs : ils qualifient tout l'écran.
  const cat = catalogueDe("/sessions")!;
  const blocs = lireChoix(cat, (await cookies()).get(cat.cookie)?.value);
  const liste = blocs.liste && !refus;

  // Réglages de vue (§ 3.1) : filtre rapide de la liste (F42) et panneau (F43).
  // Seul le panneau d'une SESSION s'ouvre ici ; un autre type, ou une valeur
  // illisible, n'est pas lu à moitié : il est ignoré, et la page le dit (V10).
  const etatVue = lireEtatDeVue("/sessions", url).etat;
  const idPanneau = etatVue.panel?.type === "session" ? etatVue.panel.id : null;
  const panelBrut = url.get("panel");
  const panneauIgnore =
    idPanneau !== null || panelBrut === null || panelBrut === ""
      ? null
      : ligneIgnoree(
          "panel",
          panelBrut,
          etatVue.panel ? "seul le panneau d'une session s'ouvre sur cet écran" : "forme attendue session:<identifiant>",
        );

  // Comparaison (F06) : aucune par défaut sur un écran d'usage ; `cmp=prev` relit
  // la période précédente, et ses écarts ne s'affichent que si elle est COMPLÈTE.
  const comparaison = lireComparaison("/sessions", url).valeur;
  const prev = comparaison.mode === "prev";
  const couvertures = (source: SourceComparaison) =>
    Promise.all(sourcesSousFiltres(query, source).map((s) => couverturePrecedente(query, s)));
  const aucuneCouverture = Promise.resolve<CouverturePrecedente[]>([]);

  const schema = await dimensionSchema();
  const disponibles = DIMENSIONS_REPARTITION.filter((d) => disponibiliteRepartition(d, schema).available);
  const dimension: DimensionRepartition | null = blocs.repartition
    ? lireRepartition(url.get(BREAKDOWN_PARAM), disponibles)
    : null;

  // Chaque bloc a SA lecture (F02, § 3.8) : `lire()` ne lève pas, un bloc en échec
  // dit « Lecture en échec » et les autres restent affichés.
  const [
    rows,
    vs,
    tendance,
    tendancePrec,
    engagementLu,
    engagementPrec,
    visiteursLu,
    visiteursPrec,
    erreursLu,
    erreursPrec,
    repartition,
    deploys,
    releaseParOccurrence,
    echantillonnage,
    couvSessions,
    couvTaux,
    couvErreurs,
    couvVisiteurs,
    panneauLu,
  ] = await Promise.all([
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
    // Sparkline de la tuile, sessions sans identifiant et panneaux du volume : une lecture.
    lire(() => observedVisitorsTrend(f)),
    blocs.visiteurs && prev ? lire(() => observedVisitorsTrend(f, true)) : sansLecture(null),
    lire(() => engagementStats(f)),
    prev ? lire(() => engagementStats(f, true)) : sansLecture(null),
    lire(() => visiteursDistincts(query)),
    prev ? lire(() => visiteursDistincts(query, true)) : sansLecture(null),
    lire(() => erreursParSessionCommencee(f)),
    prev ? lire(() => erreursParSessionCommencee(f, true)) : sansLecture(null),
    dimension ? lire(() => repartitionSessions(query, dimension)) : sansLecture(null),
    blocs.visiteurs ? lire(() => listDeploys(f, 20)) : sansLecture([]),
    releaseRechercheParOccurrence(),
    // S7 : la population de l'écran (sessions commencées OU actives) est-elle un
    // échantillon ? Lue quel que soit le choix de blocs : elle qualifie tous.
    lire(() => samplingSessions(f)),
    prev ? couvertures(SOURCE_SESSIONS) : aucuneCouverture,
    prev ? couvertures(SOURCE_SESSIONS_TAUX) : aucuneCouverture,
    prev ? couvertures(SOURCE_ERREURS) : aucuneCouverture,
    prev ? couvertures(SOURCE_VISITEURS) : aucuneCouverture,
    // Panneau (F43) : lu en même temps que l'écran, garde comprise — rien de la
    // session n'est lu si son app n'est pas dans ce que l'écran lit.
    idPanneau ? lirePanneauSession(idPanneau, query.scope.effectiveApps) : Promise.resolve(null),
  ]);

  const engagement = engagementLu.ok ? engagementLu.data : null;
  const commencees = engagement?.sessions_started ?? null;
  const reference = prev ? referencePrecedente(previousRange(query.range)) : undefined;
  const precEngagement = engagementPrec.ok ? engagementPrec.data : null;
  const nPrec = precEngagement?.sessions_started ?? null;

  /**
   * Comparaison d'une tuile : rien hors `cmp=prev` ; la période précédente ILLISIBLE
   * ne donne pas de delta (et la note le dit), jamais « pas de mesure » — ce serait
   * affirmer un vide qu'on n'a pas lu.
   */
  const comparer = (lu: Lecture<unknown>, precedent: number | null, couv: CouverturePrecedente[]): Comparaison =>
    prev && lu.ok ? { precedent, reference, couverturePrecedente: couvertureCombinee(couv, nPrec) } : {};
  const precIllisible = prev && [engagementPrec, visiteursPrec, erreursPrec].some((l) => !l.ok);

  // ── Volume sur grille (F04, § 3.10) ────────────────────────────────────────
  const debuts = bucketStarts(query.range);
  const grille = grilleIso(debuts);
  const seaux = tendance.ok ? alignerSeaux(tendance.data, debuts, true) : [];
  const sessionsParSeau = seaux.map((r) => r?.sessions ?? 0);
  // Un seau dont TOUTES les sessions sont sans identifiant n'a pas « 0 visiteur » :
  // il en a un nombre inconnu (trou), comme la tuile dit « — » (`visiteursAffiches`).
  const visiteursParSeau = seaux.map((r) => visiteursDuSeau(r));
  const sansIdentifiant = tendance.ok ? tendance.data.reduce((s, p) => s + p.sans_identifiant, 0) : null;
  const couvSessionsTotale = couvertureCombinee(couvSessions, nPrec);
  const precedentParSeau =
    tendancePrec.ok && tendancePrec.data
      ? parRang(
          grille,
          alignerSeaux(tendancePrec.data, bucketStarts(previousRange(query.range)), true).map((r) => r?.sessions ?? 0),
        )
      : null;
  // La série de référence n'est tracée que sur une période précédente COMPLÈTE : une
  // période à moitié mesurée dessinerait une « chute » qui n'est que de la collecte.
  const referenceTracee = prev && precedentParSeau !== null && couvSessionsTotale.etat === "complete";
  const pointsVolume = grille.map((t, i) => ({
    t,
    sessions: sessionsParSeau[i] ?? 0,
    visiteurs: visiteursParSeau[i] ?? null,
    ...(referenceTracee ? { precedent: precedentParSeau![i] } : {}),
  }));
  const gabarit = gabaritZoom(hrefWithQuery("/sessions", query, { period: null, from: "{from}", to: "{to}" }), sp);
  const annotations = annotationsDeploiements(deploys.ok ? deploys.data : [], query.range, {
    lien: (relB, relA) => hrefWithQuery("/sessions", query, { cmp: "release", rel_b: relB, rel_a: relA }),
  });

  // Liens de l'écran sur lui-même : réglages de vue (comparaison, recherche,
  // découpage) conservés, seul ce qui change est posé.
  const lienEcran = (changements: Record<string, string | null>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (typeof v === "string") p.set(k, v);
    }
    for (const [k, v] of Object.entries(changements)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    const qs = p.toString();
    return qs ? `/sessions?${qs}` : "/sessions";
  };
  /** Un filtre posé depuis un groupe garde la comparaison en cours (VIEW_CONTEXT_PARAMS). */
  const avecContexte = (href: string) => {
    const [chemin, qs = ""] = href.split("?");
    const p = new URLSearchParams(qs);
    for (const nom of VIEW_CONTEXT_PARAMS) {
      const v = url.get(nom);
      if (v !== null) p.set(nom, v);
    }
    const texte = p.toString();
    return texte ? `${chemin}?${texte}` : chemin;
  };

  const lignes = rows.ok ? rows.data : [];
  const page = lignes.slice(0, SESSION_PAGE_SIZE);
  const suivante = lignes.length > SESSION_PAGE_SIZE ? page[page.length - 1] : null;

  // Panneau de session (F43). L'URL porte tout : ouvrir, parcourir et fermer gardent
  // la plage, les filtres, la recherche, le curseur et les réglages de l'écran — la
  // liste sous le panneau ne bouge pas. Précédent / suivant : dans la page de liste
  // AFFICHÉE ; une session hors de cette page (lien partagé, hero) s'ouvre sans
  // parcours plutôt qu'avec des voisins inventés.
  const lienPanneau = (id: string | null) =>
    lienEcran({ panel: id === null ? null : ecrirePanel({ type: "session", id }) });
  const voisins = idPanneau === null ? null : voisinsDansLaListe(page.map((s) => s.session_id), idPanneau);
  const panneauOuvert = panneauLu !== null && panneauLu.etat !== "introuvable" ? panneauLu : null;
  const notePanneau = panneauLu?.etat === "introuvable" ? SESSION_INTROUVABLE : panneauIgnore;
  // Hero : classement de la FENÊTRE, lu à part de la liste (B30). Aujourd'hui, son
  // absence motivée — et aucune ligne dessinée.
  const priorite = lirePriorite();
  // Filtres rapides : `avec` est déjà un paramètre d'écran (F06) ; sa LECTURE
  // (option `avec` de `listSessions`) est B30. Tant qu'elle manque, les bascules
  // sont désactivées avec leur raison et une URL qui porte `avec` est déclarée NON
  // APPLIQUÉE (V10) — jamais ignorée en silence, jamais appliquée à moitié.
  const avecDemande = etatVue.avec;
  const rechercheParams = recherche
    ? { [SESSION_SEARCH_FIELD_PARAM]: recherche.field, [SESSION_SEARCH_PARAM]: recherche.value }
    : {};
  const lienPage = (cursor: string | null) =>
    hrefWithQuery("/sessions", query, { ...rechercheParams, [CURSOR_PARAM]: cursor });
  // Les filtres du contrat voyagent en champs cachés : le formulaire est un GET,
  // et sans eux « Rechercher » effacerait la plage et les filtres en cours.
  const caches = [...queryToSearchParams(query)];

  const visiteurs = visiteursLu.ok ? visiteursAffiches(visiteursLu.data, commencees) : null;
  const erreurs = erreursLu.ok ? erreursLu.data : null;
  const taux = occurrencesParSession(erreurs);
  const tauxPrec = erreursPrec.ok && erreursPrec.data ? occurrencesParSession(erreursPrec.data).valeur : null;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Sessions"
        sub="Quelles sessions regarder en premier, et qui sont les visiteurs de cette période ?"
      />

      {/* Un panneau demandé qui ne s'ouvre pas le dit, en tête (F43) : hors périmètre
          ou absente, la session n'est ni nommée ni décrite — les deux se disent pareil. */}
      {notePanneau && (
        <p role="note" className="mb-4 text-xs text-ink-soft" data-testid="panneau-session-absent">
          {notePanneau}
        </p>
      )}

      {/* Z2 — rangée de KPI : cinq tuiles, UNE population chacune, nommée. */}
      <section aria-label="Chiffres clés des sessions" className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" data-testid="kpi-sessions">
        {engagementLu.ok ? (
          <KpiTile
            label="Sessions commencées"
            valeur={commencees}
            format="count"
            sensMeilleur="neutre"
            serie={tendance.ok ? sessionsParSeau : undefined}
            couverture={{ n: commencees, unite: "sessions commencées", faibleSous: FAIBLE_SOUS }}
            lecture={commencees === 0 ? `Aucune session commencée sur ${ecran.label}.` : undefined}
            href={explorerHref(query, PLAN_SESSIONS_COMMENCEES)}
            {...comparer(engagementPrec, precEngagement?.sessions_started ?? null, couvSessions)}
          />
        ) : (
          <TuileEnEchec titre="Sessions commencées" />
        )}
        {visiteursLu.ok && visiteurs ? (
          <KpiTile
            label="Visiteurs distincts (identifiant aléatoire)"
            valeur={visiteurs.valeur}
            raisonNull={visiteurs.raisonNull}
            format="count"
            sensMeilleur="neutre"
            lecture="identifiant aléatoire seulement ; ne s'additionne pas aux sessions."
            href={explorerHref(query, PLAN_VISITEURS_DISTINCTS)}
            {...comparer(visiteursPrec, visiteursPrec.ok ? visiteursPrec.data : null, couvVisiteurs)}
          />
        ) : (
          <TuileEnEchec titre="Visiteurs distincts" />
        )}
        {tendance.ok ? (
          <KpiTile
            label="Sessions sans identifiant"
            valeur={sansIdentifiant}
            format="count"
            sensMeilleur="neutre"
            lecture="hors du compte des visiteurs : ni nouvelles ni revenantes."
          />
        ) : (
          <TuileEnEchec titre="Sessions sans identifiant" />
        )}
        {erreursLu.ok ? (
          <KpiTile
            label="Occurrences d'erreur par session commencée"
            valeur={taux.valeur}
            raisonNull={taux.raisonNull}
            format="ratio"
            sensMeilleur="bas"
            couverture={{ n: erreurs?.sessions ?? null, unite: "sessions commencées", faibleSous: FAIBLE_SOUS }}
            lecture={lectureOccurrences(erreurs, engagement?.still_active ?? null)}
            href={contextHref("/errors", url)}
            {...comparer(erreursPrec, tauxPrec, [...couvTaux, ...couvErreurs])}
          />
        ) : (
          <TuileEnEchec titre="Occurrences d'erreur par session commencée" />
        )}
        {/* B30 manque : la tuile n'affiche AUCUN nombre. Ce n'est pas « Non collecté » :
            les événements `frustration.*` existent, c'est leur lecture par session qui manque. */}
        <KpiTile
          label="Sessions avec frustration"
          valeur={null}
          raisonNull="lecture à créer (B30)"
          format="pct"
          href={contextHref("/ux", url)}
        />
      </section>

      {(precIllisible || comparaison.mode === "release") && (
        <div role="note" data-testid="note-comparaison" className="mb-4 space-y-1 text-xs text-ink-soft">
          {precIllisible && <p>La période précédente n&apos;a pas pu être lue en entier : les tuiles concernées n&apos;affichent aucun écart.</p>}
          {comparaison.mode === "release" && (
            <p>
              Comparaison de releases : ces tuiles n&apos;ont pas d&apos;écart par release — une session n&apos;a pas de release
              unique, la release est portée par chaque occurrence.
            </p>
          )}
        </div>
      )}

      {/* Z2b — S7 : sous la rangée de KPI qu'il qualifie. Rien n'est rendu hors échantillonnage. */}
      <BandeauEchantillonnage lecture={echantillonnage} />

      {/* Z3 — hero « À regarder d'abord » (8 col.) + « Qui sont ces sessions » (4 col.). */}
      {(blocs.priorite || blocs.repartition) && (
        <div className="mb-6 grid gap-6 xl:grid-cols-12">
          {blocs.priorite && (
            <div className={`min-w-0 ${blocs.repartition ? "xl:col-span-8" : "xl:col-span-12"}`}>
              {/* Avant B30, le hero le dit, et rien d'autre : trier les 50 lignes de la
                  liste produirait un faux classement de la fenêtre (§ 5.11.6). */}
              <Figure
                titre="À regarder d'abord"
                id="a-regarder-d-abord"
                etat={"raison" in priorite ? { kind: "partiel", raison: priorite.raison } : undefined}
                meta={
                  "raison" in priorite ? undefined : (
                    <>
                      <span>{formater("count", priorite.lignes.length)} session(s) sur 10 au plus</span>
                      <span>sessions actives (dernière activité dans la fenêtre)</span>
                      <span>{ecran.label}</span>
                    </>
                  )
                }
                lecture={
                  // Décrire l'ordre d'un classement absent le ferait croire rendu :
                  // sans lecture, la figure ne dit que ce qui lui manque.
                  "raison" in priorite ? undefined : (
                    <>
                      Ordre : occurrences d&apos;erreur, puis signaux de frustration, puis appels API en échec, puis
                      dernière activité. <strong>Ce n&apos;est pas un tri de la liste</strong> : la liste reste
                      chronologique, et ce classement porte sur la fenêtre entière, borné à dix lignes.
                    </>
                  )
                }
                alternative={"raison" in priorite ? undefined : alternativePriorite(priorite.lignes, ecran.label)}
              >
                {"raison" in priorite ? null : (
                  <PrioriteSessions lignes={priorite.lignes} hrefs={priorite.hrefs} plage={ecran.label} />
                )}
              </Figure>
            </div>
          )}
          {blocs.repartition && (
            <div className={`min-w-0 ${blocs.priorite ? "xl:col-span-4" : "xl:col-span-12"}`} data-testid="repartition">
              <SectionErreur titre="Qui sont ces sessions">
                {!repartition.ok ? (
                  <div className="card p-4">
                    <EchecLecture titre="Qui sont ces sessions" />
                  </div>
                ) : dimension === null || repartition.data === null ? (
                  <div className="card p-4">
                    <EtatSurface etat={{ kind: "partiel", raison: "aucune dimension de session n'est lisible dans ce schéma" }} />
                  </div>
                ) : (
                  <Repartition
                    dimension={dimension}
                    donnees={repartition.data}
                    onglets={DIMENSIONS_REPARTITION.map((d): OngletDecoupage => {
                      const dispo = disponibiliteRepartition(d, schema);
                      return {
                        dimension: d,
                        label: LIBELLES_REPARTITION[d],
                        available: dispo.available,
                        reason: dispo.reason,
                        current: d === dimension,
                        href: dispo.available ? lienEcran({ [BREAKDOWN_PARAM]: d }) : null,
                      };
                    })}
                    hrefDe={(valeur) => avecContexte(hrefGroupe(query, dimension, valeur, schema))}
                    plage={ecran.label}
                  />
                )}
              </SectionErreur>
            </div>
          )}
        </div>
      )}

      {/* Z4 — Volume : deux panneaux sur le même axe x, deux populations (P5). */}
      {blocs.visiteurs && (
        <div className="mb-6">
          <SectionErreur titre="Volume">
            <Figure
              titre="Volume"
              id="volume"
              etat={
                !tendance.ok
                  ? { kind: "erreur", titre: "Volume" }
                  : commencees === 0 || sessionsParSeau.every((n) => n === 0)
                    ? { kind: "vide", population: "session commencée", plage: ecran.label }
                    : undefined
              }
              meta={
                <>
                  <span>sessions commencées (début dans la fenêtre)</span>
                  <span>seaux de {bucketLabel(query.range.bucketSeconds)} (UTC)</span>
                  <span>{ecran.label}</span>
                  {prev && !referenceTracee && (
                    <span data-testid="volume-reference-absente">
                      période précédente non tracée :{" "}
                      {couvSessionsTotale.etat !== "complete"
                        ? (couvSessionsTotale.raison ?? "raison non lue")
                        : "lecture en échec"}
                    </span>
                  )}
                </>
              }
              lecture={
                <>
                  Barres = sessions commencées par seau ; un clic sur un seau resserre l&apos;écran sur sa plage.{" "}
                  {referenceTracee && "Trait gris pointillé = période précédente, seau contre seau (même rang). "}
                  <strong>Les visiteurs ne s&apos;additionnent pas</strong> : un visiteur présent dans trois seaux y est
                  compté trois fois, et aucun total de fenêtre n&apos;en est déduit.
                </>
              }
              alternative={{
                legende: `Volume par seau de ${bucketLabel(query.range.bucketSeconds)}, ${ecran.label}`,
                colonnes: [
                  "Seau (UTC)",
                  "Sessions commencées",
                  ...(referenceTracee ? ["Période précédente (même rang)"] : []),
                  "Visiteurs distincts",
                ],
                lignes: pointsVolume.map((p) => [
                  libelleSeauComplet(p.t, query.range.bucketSeconds, "UTC"),
                  p.sessions,
                  ...(referenceTracee ? [p.precedent ?? null] : []),
                  p.visiteurs,
                ]),
              }}
              explorer={explorerHref(query, PLAN_SESSIONS_COMMENCEES)}
            >
              <div className="flex min-w-0 flex-col gap-4" data-testid="volume-panneaux">
                <div className="min-w-0">
                  <h3 className="mb-1 text-xs font-medium text-ink-soft">Sessions commencées par seau</h3>
                  <ThresholdSeries
                    grille={grille}
                    points={pointsVolume}
                    series={[
                      { cle: "sessions", libelle: "Sessions commencées", role: "principale", forme: "barres", additive: true },
                      ...(referenceTracee
                        ? [{ cle: "precedent", libelle: "Période précédente (même rang de seau)", role: "reference" as const, additive: true }]
                        : []),
                    ]}
                    format="count"
                    annotations={annotations.annotations}
                    annotationsIndisponibles={annotations.indisponible ?? undefined}
                    seauSecondes={query.range.bucketSeconds}
                    fuseau="UTC"
                    zoomHref={gabarit}
                    hauteur={160}
                    synchro="sessions-volume"
                    ariaLabel={`Sessions commencées par seau de ${bucketLabel(query.range.bucketSeconds)}, ${ecran.label}`}
                  />
                </div>
                <div className="min-w-0">
                  <h3 className="mb-1 text-xs font-medium text-ink-soft">Visiteurs distincts par seau (identifiant aléatoire)</h3>
                  <ThresholdSeries
                    grille={grille}
                    points={pointsVolume}
                    series={[{ cle: "visiteurs", libelle: "Visiteurs distincts", role: "categorie", categorieIndex: 0 }]}
                    format="count"
                    seauSecondes={query.range.bucketSeconds}
                    fuseau="UTC"
                    zoomHref={gabarit}
                    hauteur={160}
                    synchro="sessions-volume"
                    legendeAnnotations={false}
                    ariaLabel={`Visiteurs distincts par seau de ${bucketLabel(query.range.bucketSeconds)}, ${ecran.label} ; valeurs non additionnables`}
                  />
                </div>
                {sansIdentifiant !== null && sansIdentifiant > 0 && (
                  <p className="text-xs text-ink-soft">
                    {formater("count", sansIdentifiant)} session(s) sans identifiant de visiteur sont hors du panneau des visiteurs ;
                    un seau qui n&apos;a que de telles sessions y est un trou, pas un zéro.
                  </p>
                )}
              </div>
            </Figure>
          </SectionErreur>
        </div>
      )}

      {/* Z5 — Engagement (8 col.) + anneau à trois parts (4 col.). */}
      {(blocs.engagement || blocs.resume) && (
        <div className="mb-6 grid gap-6 xl:grid-cols-12">
          {blocs.engagement && (
            <div className={`min-w-0 ${blocs.resume ? "xl:col-span-8" : "xl:col-span-12"}`}>
              <SectionErreur titre="Engagement">
                <Engagement
                  lu={engagementLu}
                  precedent={precEngagement}
                  comparer={(precedent) =>
                    prev && engagementPrec.ok
                      ? { precedent, reference, couverturePrecedente: couvertureCombinee(couvTaux, nPrec) }
                      : {}
                  }
                />
              </SectionErreur>
            </div>
          )}
          {blocs.resume && (
            <div className={`min-w-0 ${blocs.engagement ? "xl:col-span-4" : "xl:col-span-12"}`}>
              <SectionErreur titre="Nouveaux, revenants, non identifiés">
                <AnneauVisiteurs lu={vs} plage={ecran.label} />
              </SectionErreur>
            </div>
          )}
        </div>
      )}

      {/* Z6 — recherche exacte et liste (la table dense et ses filtres rapides : F42). */}
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
            <Link href={hrefWithQuery("/sessions", query)} className="btn-ghost">
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
          <section id={ANCRE_TOUTES_SESSIONS} className="card min-w-0 scroll-mt-20 p-4" aria-labelledby="toutes-les-sessions-titre">
            <h2 id="toutes-les-sessions-titre" className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
              Toutes les sessions
            </h2>
            {/* Filtres rapides : ils restreindront LA LISTE SEULE, jamais les tuiles.
                Désactivés tant que leur lecture manque — une bascule qui ne filtre
                rien est pire qu'une bascule qui dit pourquoi elle ne peut pas. */}
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label="Filtres rapides de la liste" data-testid="filtres-rapides">
              {AVEC_SESSIONS.map((cle) => (
                <button
                  key={cle}
                  type="button"
                  disabled
                  data-testid={`filtre-${cle}`}
                  data-applied="false"
                  title={SIGNAUX_A_CREER}
                  className="max-w-full rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-xs font-medium text-ink-soft"
                >
                  <span className="block truncate">{LIBELLES_AVEC[cle]}</span>
                </button>
              ))}
              <span className="min-w-0 text-xs text-ink-faint">
                Ces bascules ne restreindront que cette liste, jamais les tuiles — {SIGNAUX_A_CREER}.
              </span>
            </div>
            {avecDemande !== null && (
              <p role="note" data-testid="avec-non-applique" className="mt-2 text-xs text-ink-soft">
                Filtre rapide « {LIBELLES_AVEC[avecDemande]} » NON APPLIQUÉ : {SIGNAUX_A_CREER}. La liste ci-dessous
                porte donc sur toutes les sessions de la fenêtre.
              </p>
            )}
            <div className="mt-3">
              <SessionsTable
                lignes={page.map((s) => ({ ...s, frustration: null, rejeu: null }))}
                // Une ligne ouvre le panneau (F43) ; la page de session est à un clic,
                // « Ouvrir en page » dans l'en-tête du panneau.
                panelHrefs={Object.fromEntries(page.map((s) => [s.session_id, lienPanneau(s.session_id)]))}
                ouvert={panneauOuvert && voisins ? idPanneau : null}
                pageHrefs={Object.fromEntries(
                  page.map((s) => [s.session_id, hrefWithQuery(`/sessions/${encodeURIComponent(s.session_id)}`, query)]),
                )}
                routeHrefs={Object.fromEntries(
                  [...new Set(page.flatMap((s) => s.routes ?? []))].map((r) => [
                    r,
                    breakdownDrillHref("/sessions", query, "route", r, schema),
                  ]),
                )}
                suivantHref={suivante ? lienPage(encodeSessionCursor(suivante)) : null}
                debutHref={curseur ? lienPage(null) : null}
                vide={
                  recherche
                    ? `Aucune session ne correspond à cette recherche sur ${ecran.label}`
                    : `Aucune session sur ${ecran.label}`
                }
              />
            </div>
          </section>
        </SectionErreur>
      )}
      </>
      )}

      {!blocs.priorite && !blocs.repartition && !blocs.visiteurs && !blocs.engagement && !blocs.resume && !blocs.liste && (
        <TousEteints />
      )}

      {/* Z7 — panneau de la session ouverte (F43, § 5.11.4) : moitié droite dès 1280 px,
          la liste reste lisible à gauche ; plein écran en dessous. */}
      {panneauOuvert && idPanneau !== null && (
        <PanneauSession
          lecture={panneauOuvert}
          plage={ecran.label}
          avecApp={query.scope.effectiveApps === null || query.scope.effectiveApps.length > 1}
          fermerHref={lienPanneau(null)}
          pageHref={hrefWithQuery(`/sessions/${encodeURIComponent(idPanneau)}`, query)}
          precedentHref={voisins === null ? undefined : voisins.precedent === null ? null : lienPanneau(voisins.precedent)}
          suivantHref={voisins === null ? undefined : voisins.suivant === null ? null : lienPanneau(voisins.suivant)}
        />
      )}
    </div>
  );
}

/** Une tuile dont la lecture a échoué : « Réessayer », jamais un zéro. */
function TuileEnEchec({ titre }: { titre: string }) {
  return (
    <div className="card min-w-0 p-4">
      <EchecLecture compact titre={titre} />
    </div>
  );
}

/** « Qui sont ces sessions » : part de chaque groupe dans les sessions commencées. */
function Repartition({
  dimension,
  donnees,
  onglets,
  hrefDe,
  plage,
}: {
  dimension: DimensionRepartition;
  donnees: RepartitionSessions;
  onglets: OngletDecoupage[];
  hrefDe: (valeur: string | null) => string;
  plage: string;
}) {
  const reste = resteNonAffiche(donnees.total, donnees.groupes, donnees.tronque);
  const items: BreakdownItem[] = donnees.groupes.map((g) => {
    const libelle = libelleGroupe(dimension, g.valeur);
    const part = partDuTout(g.sessions, donnees.total);
    return {
      // « Inconnu » a sa propre clé : les valeurs déclarées portent le préfixe `v:`.
      key: g.valeur === null ? "inconnu" : `v:${g.valeur}`,
      label: libelle,
      value: g.sessions,
      display: formater("count", g.sessions),
      href: hrefDe(g.valeur),
      description: `${LIBELLES_REPARTITION[dimension]} ${libelle} — ${formater("count", g.sessions)} sessions commencées, ${part} du total`,
      cells: [{ label: "part", value: part }],
    };
  });
  const noticeDimension = dimension === "source" ? NOTICE_CAPTEUR : BREAKDOWN_NOTICES[dimension];
  const notice = [
    `Sessions commencées sur ${plage} : ${formater("count", donnees.total)} au total ; chaque barre ouvre l'écran filtré sur son groupe.`,
    reste !== null
      ? `Plus de ${REPARTITION_LIMITE} groupes : les ${REPARTITION_LIMITE} plus fournis sont affichés, ${formater("count", reste)} session(s) (${partDuTout(reste, donnees.total)}) appartiennent aux autres.`
      : null,
    noticeDimension,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Breakdown
      title="Qui sont ces sessions"
      tabs={[]}
      onglets={onglets}
      notice={notice}
      items={items}
      columns={["Part"]}
      groups={items.length}
      truncated={false}
      emptyLabel={`Aucune session commencée sur ${plage}.`}
      measureLabel="Sessions commencées"
    />
  );
}

/** « Engagement » : deux percentiles et un taux, jamais une moyenne (P7). */
function Engagement({
  lu,
  precedent,
  comparer,
}: {
  lu: Lecture<EngagementStats>;
  precedent: EngagementStats | null;
  comparer: (precedent: number | null) => Comparaison;
}) {
  if (!lu.ok) {
    return (
      <Figure titre="Engagement" id="engagement" etat={{ kind: "erreur", titre: "Engagement" }} />
    );
  }
  const e = lu.data;
  const suffisant = engagementSuffisant(e);
  const couverture = { n: e.sessions_with_view, unite: "sessions avec une page vue", faibleSous: ENGAGEMENT_MIN_SESSIONS };
  const ms = (s: number | null) => (s == null ? null : s * 1000);
  return (
    <Figure
      titre="Engagement"
      id="engagement"
      etat={suffisant ? undefined : { kind: "partiel", raison: engagementRaison(e) }}
      meta={
        <>
          <span>
            {formater("count", e.sessions_with_view)} session(s) commencée(s) avec au moins une page vue
          </span>
          {e.still_active > 0 && (
            <span>
              {formater("count", e.still_active)} encore active(s) (vue dans les {STILL_ACTIVE_MINUTES} dernières minutes de
              la fenêtre) : leur durée n&apos;est pas finie
            </span>
          )}
        </>
      }
      lecture={
        <>
          Durée observée = écart entre la première et la dernière observation, <strong>pas du temps actif</strong> :
          un onglet laissé ouvert l&apos;allonge, une sortie brutale la raccourcit. « Sessions à une seule vue »
          n&apos;est pas un taux de rebond : aucune durée minimale ni interaction n&apos;entre dans sa définition.
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="engagement">
        <KpiTile
          label="Durée observée médiane"
          valeur={ms(e.duration_p50_s)}
          raisonNull="aucune session avec une page vue"
          format="s-auto"
          sensMeilleur="neutre"
          couverture={couverture}
          {...comparer(ms(precedent?.duration_p50_s ?? null))}
        />
        <KpiTile
          label="Durée observée p75"
          valeur={ms(e.duration_p75_s)}
          raisonNull="aucune session avec une page vue"
          format="s-auto"
          sensMeilleur="neutre"
          lecture="les 25 % les plus longues durent au moins autant."
          couverture={couverture}
          {...comparer(ms(precedent?.duration_p75_s ?? null))}
        />
        <KpiTile
          label="Sessions à une seule vue"
          valeur={singleViewSessionRate(e)}
          raisonNull="aucune session avec une page vue : taux non calculable"
          format="pct"
          sensMeilleur="neutre"
          lecture={`${formater("count", e.single_view_sessions)} sur ${formater("count", e.sessions_with_view)} session(s) avec au moins une vue.`}
          couverture={couverture}
          {...comparer(precedent ? singleViewSessionRate(precedent) : null)}
        />
      </div>
    </Figure>
  );
}

/**
 * Anneau à TROIS parts sur les sessions ACTIVES (dernière activité dans la fenêtre) :
 * nouveaux, revenants, et non identifiées — la part inconnue nommée, jamais répartie.
 * `visitStats.sessions` (sessions ayant une vue) n'y figure pas : autre population.
 */
function AnneauVisiteurs({ lu, plage }: { lu: Lecture<VisitStats | null>; plage: string }) {
  const titre = "Nouveaux, revenants, non identifiés — sessions actives";
  if (!lu.ok) return <Figure titre={titre} id="nouveaux-revenants" etat={{ kind: "erreur", titre }} />;
  const vs = lu.data;
  if (!vs) return null;
  const total = vs.new_count + vs.returning_count + vs.unidentified_count;
  return (
    <Figure
      titre={titre}
      id="nouveaux-revenants"
      etat={total === 0 ? { kind: "vide", population: "session active", plage } : undefined}
      meta={
        <>
          <span data-testid="anneau-population">
            {formater("count", total)} sessions actives (dernière activité dans la fenêtre)
          </span>
        </>
      }
      lecture={
        <>
          Revenant = une session antérieure du même visiteur existe dans les données conservées ({retentionDays()}{" "}
          jours) : au-delà, un revenant est compté nouveau. Non identifiées = sessions sans identifiant aléatoire
          (historique antérieur au 09/09/2026, SDK pas à jour) : ni nouvelles ni revenantes.
        </>
      }
      alternative={{
        legende: `Sessions actives par statut du visiteur, ${plage}`,
        colonnes: ["Statut", "Sessions actives", "Part"],
        lignes: [
          ["Nouveaux", vs.new_count, partDuTout(vs.new_count, total)],
          ["Revenants", vs.returning_count, partDuTout(vs.returning_count, total)],
          ["Non identifiées", vs.unidentified_count, partDuTout(vs.unidentified_count, total)],
        ],
      }}
    >
      <Donut
        slices={[
          { label: "Nouveaux", value: vs.new_count, color: CATEGORIELLE[0] },
          { label: "Revenants", value: vs.returning_count, color: CATEGORIELLE[1] },
        ]}
        inconnu={{ label: "Non identifiées", value: vs.unidentified_count }}
        centerValue={formater("count", total)}
        centerLabel="sessions actives"
        size={168}
        thickness={28}
      />
    </Figure>
  );
}

