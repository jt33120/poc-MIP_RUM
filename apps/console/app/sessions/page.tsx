// Sessions (F41, plan § 5.11). La question du plan, « Quelles sessions regarder en
// premier ? », attend le classement de la fenêtre (B30), non livré : l'écran répond
// aujourd'hui par les colonnes Erreurs, Rejeu et Frustration de la liste, et par les
// visiteurs (contre-recette du 26/09/2026).
//
// MISE EN PAGE (refonte du 30/09/2026, charte § 4 « Sessions »). Trois étages, sans
// phrase d'explication à l'écran :
//   1. une rangée de SEPT cases épurées (valeur et unité ; tout le détail dans leur
//      fenêtre) : les quatre de la population « sessions commencées », puis les trois
//      d'engagement ;
//   2. le volume sur l'axe du temps, sessions (barres) et visiteurs côte à côte ;
//   3. la liste en trois volets : facettes « Qui sont ces sessions » et « Nouveaux ·
//      revenants » à gauche, la table dense (une ligne de 32 px, pictogrammes) au
//      centre, le panneau de session à droite quand une ligne est ouverte.
// Les méthodes, populations et règles sont dans les fenêtres, les replis « Méthode »
// et les bulles : déplacées, jamais supprimées.
//
// UNE POPULATION PAR FIGURE (S1, R-P). Les tuiles comptent les sessions COMMENCÉES
// (`started_at` dans la fenêtre) — le même nombre que la tuile de trafic de la Vue
// d'ensemble pour la même URL — ; « Nouveaux · revenants » compte les sessions
// ACTIVES (dernière activité dans la fenêtre) et le dit ; les visiteurs distincts ont
// leur tuile et leur graphique, jamais additionnés aux sessions (V2).
//
// F42 pose la table dense « Toutes les sessions », les filtres rapides et le hero
// « À regarder d'abord ». Le CLASSEMENT du hero attend B30 (§ 6.3) : tant qu'il
// manque, le hero N'EST PAS AFFICHÉ — trier les 50 lignes de la page courante
// donnerait « les plus graves » d'un échantillon arbitraire, pas de la fenêtre
// (§ 5.11.6). Même règle pour les filtres rapides et la tuile « Sessions avec
// frustration » : une fonction absente ne se montre pas.
//
// F43 ouvre le PANNEAU de session (`panel=session:<id>`, § 3.5) : une ligne de la
// liste le pose dans l'URL, « Précédent » / « Suivant » (↑ / ↓) parcourent la page
// de liste affichée, « Fermer » (Échap) le retire. Sa lecture part AVEC celles de
// l'écran, et sa garde est celle de la page de session : hors périmètre, aucun
// panneau, une ligne le dit.
import Link from "next/link";
import { ECRANS } from "@mip/console-contract";
import { PageHeader } from "@/components/PageHeader";
import { type OngletDecoupage } from "@/components/Breakdown";
import { Figure } from "@/components/charts/Figure";
import { KpiTile } from "@/components/charts/KpiTile";
import { ThresholdSeries } from "@/components/charts/ThresholdSeries";
import { INPUT_CLASS } from "@/components/forms/Field";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { InfoTip } from "@/components/InfoTip";
import { EtatSurface } from "@/components/states/EtatSurface";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import type { SearchParams } from "@/lib/filters";
import { type SectionLue } from "@/lib/lecture";
import { chargerSessions, CURSOR_PARAM, demandeDesSessions } from "@/lib/chargeurs/sessions";
import { avecBlocs, chargerEcran } from "@/lib/ecran";
import { BREAKDOWN_NOTICES, BREAKDOWN_PARAM, breakdownDrillHref } from "@/lib/breakdowns";
import {
  ENGAGEMENT_MIN_SESSIONS,
  STILL_ACTIVE_MINUTES,
  engagementRaison,
  engagementSuffisant,
  singleViewSessionRate,
  type EngagementStats,
} from "@/lib/engagement";
import { bucketLabel, bucketStarts, hrefWithQuery, previousRange, queryToSearchParams } from "@/lib/query-contract";
import { type VisitStats } from "@/lib/queries";
import {
  PLAN_SESSIONS_COMMENCEES,
  PLAN_VISITEURS_DISTINCTS,
  REPARTITION_LIMITE,
  cleSession,
  type RepartitionSessions as DonneesRepartition,
} from "@/lib/queries-sessions";
import { retentionDays } from "@/lib/queries-explorer";
import { BandeauEchantillonnage } from "@/components/states/BandeauEchantillonnage";
import {
  SESSION_PAGE_SIZE,
  SESSION_SEARCH_FIELDS,
  SESSION_SEARCH_FIELD_PARAM,
  SESSION_SEARCH_LABELS,
  SESSION_SEARCH_PARAM,
  SESSION_SEARCH_PLACEHOLDERS,
  encodeSessionCursor,
  sessionSearchSummary,
} from "@/lib/sessions-search";
import { TousEteints } from "@/components/TousEteints";
import { explorerHref } from "@/lib/explorer-page-params";
import { formater } from "@/lib/fmt-ids";
import { CATEGORIELLE } from "@/lib/palette";
import { alignerSeaux, fenetresLues, grilleIso, libelleSeauComplet } from "@/lib/series";
import { annotationsDeploiements } from "@/lib/annotations";
import { type CouverturePrecedente } from "@/lib/comparaison";
import { AVEC_SESSIONS, VIEW_CONTEXT_PARAMS, contextHref, gabaritZoom, lireComparaison } from "@/lib/view-state";
import {
  ANCRE_TOUTES_SESSIONS,
  PrioriteSessions,
  alternativePriorite,
  type HrefsPriorite,
} from "@/components/sessions/PrioriteSessions";
import { SessionsTable } from "@/components/sessions/SessionsTable";
import { RepartitionSessions, type GroupeRepartition } from "@/components/sessions/RepartitionSessions";
import { FILTRE_AVEC_INDISPONIBLE, RAISON_PRIORITE, type SessionPrioritaire } from "@/lib/sessions-priorite";
import { BandeauComparaison, MASQUE_SILENCE_REPETE } from "@/components/charts/RangeeKpi";
import { pluriel } from "@/lib/format";
import { FUSEAU_AFFICHAGE } from "@/lib/fuseau-local";
import {
  DIMENSIONS_REPARTITION,
  LIBELLES_REPARTITION,
  couvertureCombinee,
  disponibiliteRepartition,
  hrefGroupe,
  libelleGroupe,
  lectureOccurrences,
  lireRepartition,
  occurrencesParSession,
  parRang,
  partDuTout,
  partsProvenancePays,
  phraseProvenancePays,
  referencePrecedente,
  resteNonAffiche,
  visiteursAffiches,
  visiteursDuSeau,
  type DimensionRepartition,
} from "@/lib/sessions-kpi";
// F43 — panneau de session.
import { PanneauSession } from "@/components/sessions/PanneauSession";
import { SESSION_INTROUVABLE, voisinsDansLaListe } from "@/lib/panneau-session";
import { ecrirePanel, ligneIgnoree } from "@/lib/view-state";

export const dynamic = "force-dynamic";

// Sources des comparaisons à la période précédente (§ 3.2). Un compte de sessions
// ou de visiteurs attend encore des lignes sur une heure qui se termine maintenant
// (additif) ; un taux ou une durée les attend au numérateur ET au dénominateur.
// Visiteurs : `SOURCE_VISITEURS` (lib/sessions-kpi.ts), sur le premier `visitor_id` collecté.

/** Sous ce nombre de sessions, un delta se tait : le seuil d'engagement du domaine (S6, `lib/engagement.ts`). */
const FAIBLE_SOUS = ENGAGEMENT_MIN_SESSIONS;

/** Libellés des filtres rapides de la liste (§ 5.11.4) ; leur lecture est B30, et elles ne sont pas affichées d'ici là. */
const LIBELLES_AVEC: Record<(typeof AVEC_SESSIONS)[number], string> = {
  erreurs: "Avec erreurs",
  frustration: "Avec frustration",
  rejeu: "Avec rejeu",
};

/** La source des cases, écrite dans leur fenêtre (charte § 3.3). */
const SOURCE_SESSIONS = "Capteur navigateur (SDK ou extension) · table rum_session, robots exclus";
const SOURCE_ERREURS = "Capteur navigateur (SDK ou extension) · tables rum_error et rum_session";

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

export default async function Sessions({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Le chargeur (`lib/chargeurs/sessions.ts`) lit filtres, blocs et sections ; la
  // composition de l'écran (cookie) lui est passée en paramètre, et la page relit
  // l'URL par la même fonction que lui (`demandeDesSessions`).
  const sp = await avecBlocs(await searchParams, "/sessions");
  const d = await chargerEcran(ECRANS.sessions, chargerSessions, sp);
  if (d.etat === "refus") return <FilterProblemNotice title="Sessions" problem={d.problem} />;
  const ecran = d;
  const query = d.query;
  const { url, champ, recherche, curseur, refus, blocs, etatVue, idPanneau } = demandeDesSessions(sp);

  // Réglages de vue (§ 3.1) : filtre rapide de la liste (F42) et panneau (F43).
  // Seul le panneau d'une SESSION s'ouvre ici ; un autre type, ou une valeur
  // illisible, n'est pas lu à moitié : il est ignoré, et la page le dit (V10).
  const panelBrut = url.get("panel");
  const panneauIgnore =
    idPanneau !== null || panelBrut === null || panelBrut === ""
      ? null
      : ligneIgnoree(
          "panel",
          panelBrut,
          etatVue.panel ? "seul le panneau d'une session s'ouvre sur cet écran" : "forme attendue session:<identifiant>",
        );

  const comparaison = lireComparaison("/sessions", url).valeur;
  const { prev } = d;
  const schema = new Set(d.schema);
  const disponibles = DIMENSIONS_REPARTITION.filter((x) => disponibiliteRepartition(x, schema).available);
  const dimension: DimensionRepartition | null = blocs.repartition
    ? lireRepartition(url.get(BREAKDOWN_PARAM), disponibles)
    : null;
  const {
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
    provenancePays,
    deploys,
    releaseParOccurrence,
    echantillonnage,
    couvSessions,
    couvTaux,
    couvErreurs,
    couvVisiteurs,
    panneauLu,
    signaux,
  } = d;
  const fenetresCollecte = fenetresLues(d.fenetresCollecte);

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
  const comparer = (lu: SectionLue<unknown>, precedent: number | null, couv: CouverturePrecedente[]): Comparaison =>
    prev && lu.ok ? { precedent, reference, couverturePrecedente: couvertureCombinee(couv, nPrec) } : {};
  const precIllisible = prev && [engagementPrec, visiteursPrec, erreursPrec].some((l) => !l.ok);
  // Les couvertures de la période précédente des tuiles comparées, pour la pastille
  // unique de la rangée (mêmes combinaisons que `comparer`).
  const couverturesTuiles = prev
    ? [
        engagementPrec.ok ? couvertureCombinee(couvSessions, nPrec) : null,
        visiteursPrec.ok ? couvertureCombinee(couvVisiteurs, nPrec) : null,
        erreursPrec.ok ? couvertureCombinee([...couvTaux, ...couvErreurs], nPrec) : null,
        engagementPrec.ok ? couvertureCombinee(couvTaux, nPrec) : null,
      ]
    : [];

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
  // Hero : classement de la FENÊTRE, lu à part de la liste (B30). Aujourd'hui absent :
  // le hero n'est pas rendu.
  const priorite = lirePriorite();
  const heroPriorite = blocs.priorite && !("raison" in priorite);
  // Filtres rapides : `avec` est déjà un paramètre d'écran (F06) ; sa LECTURE
  // (option `avec` de `listSessions`) est B30. Tant qu'elle manque, les bascules ne
  // sont pas dessinées et une URL qui porte `avec` est déclarée NON APPLIQUÉE (V10) —
  // jamais ignorée en silence, jamais appliquée à moitié.
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
  // Tranches de l'axe, pour le graphique grand format des cases (`grapheDebuts`).
  const debutsCases = tendance.ok ? grille : undefined;
  const aside = blocs.repartition || blocs.resume;

  return (
    <div className="animate-fade-up">
      <PageHeader title="Sessions" />

      {/* Un panneau demandé qui ne s'ouvre pas le dit, en tête (F43) : hors périmètre
          ou absente, la session n'est ni nommée ni décrite — les deux se disent pareil. */}
      {notePanneau && (
        <p role="note" className="mb-3 text-xs text-ink-soft" data-testid="panneau-session-absent">
          {notePanneau}
        </p>
      )}

      {/* Étage 1 — sept cases de même gabarit : quatre sur les sessions commencées
          (`kpi-sessions`), trois d'engagement. Sur 7 colonnes à partir de 1 280 px :
          chaque groupe est une sous-grille, toutes les cases ont la même largeur. */}
      <BandeauComparaison couvertures={couverturesTuiles} />
      <div
        className={`mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 ${blocs.engagement ? "xl:grid-cols-7" : ""} ${MASQUE_SILENCE_REPETE}`}
      >
        <SectionErreur titre="Chiffres clés">
          <section
            aria-label="Chiffres clés des sessions"
            className="col-span-2 grid grid-cols-2 gap-2 sm:col-span-4 sm:grid-cols-4"
            data-testid="kpi-sessions"
          >
            {engagementLu.ok ? (
              <KpiTile
                label="Sessions commencées"
                valeur={commencees}
                format="count"
                sensMeilleur="neutre"
                serie={tendance.ok ? sessionsParSeau : undefined}
                grapheDebuts={debutsCases}
                titreAxeY="Sessions commencées (par tranche)"
                couverture={{ n: commencees, unite: "sessions commencées", faibleSous: FAIBLE_SOUS }}
                lecture={commencees === 0 ? `Aucune session commencée sur ${ecran.label}.` : undefined}
                methode="Sessions dont le début tombe dans la période (started_at), robots exclus : le même nombre que la case de trafic de la Vue d'ensemble."
                source={SOURCE_SESSIONS}
                categorie="Sessions · début dans la période"
                href={explorerHref(query, PLAN_SESSIONS_COMMENCEES)}
                {...comparer(engagementPrec, precEngagement?.sessions_started ?? null, couvSessions)}
              />
            ) : (
              <TuileEnEchec titre="Sessions commencées" />
            )}
            {visiteursLu.ok && visiteurs ? (
              <KpiTile
                label="Visiteurs distincts (identifiant aléatoire)"
                libelleCase="Visiteurs distincts"
                valeur={visiteurs.valeur}
                raisonNull={visiteurs.raisonNull}
                format="count"
                sensMeilleur="neutre"
                serie={tendance.ok ? visiteursParSeau : undefined}
                grapheDebuts={debutsCases}
                titreAxeY="Visiteurs distincts (par tranche)"
                lecture="identifiant aléatoire seulement ; ne s'additionne pas aux sessions."
                methode="Identifiants de visiteur aléatoires distincts parmi les sessions commencées. Un visiteur vu sur deux tranches compte une fois ici, une fois dans chaque tranche du graphique : les tranches ne s'additionnent pas."
                source={SOURCE_SESSIONS}
                categorie="Visiteurs · identifiant aléatoire"
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
                methode="Sessions commencées sans identifiant de visiteur (historique antérieur au 09/09/2026, SDK pas à jour) : exclues du compte des visiteurs ; une tranche qui n'a que de telles sessions est un trou dans le graphique des visiteurs, pas un zéro."
                source={SOURCE_SESSIONS}
                categorie="Sessions · sans visitor_id"
              />
            ) : (
              <TuileEnEchec titre="Sessions sans identifiant" />
            )}
            {erreursLu.ok ? (
              <KpiTile
                label="Occurrences d'erreur par session commencée"
                libelleCase="Erreurs par session"
                valeur={taux.valeur}
                raisonNull={taux.raisonNull}
                format="ratio"
                sensMeilleur="bas"
                couverture={{ n: erreurs?.sessions ?? null, unite: "sessions commencées", faibleSous: FAIBLE_SOUS }}
                lecture={lectureOccurrences(erreurs, engagement?.still_active ?? null)}
                methode="Somme des occurrences d'erreur rattachées aux sessions commencées, divisée par leur nombre. Une erreur sans session rattachée est exclue, et comptée à part."
                source={SOURCE_ERREURS}
                categorie="Erreurs JS · occurrences"
                href={contextHref("/errors", url)}
                {...comparer(erreursPrec, tauxPrec, [...couvTaux, ...couvErreurs])}
              />
            ) : (
              <TuileEnEchec titre="Occurrences d'erreur par session commencée" />
            )}
            {/* « Sessions avec frustration » attend sa lecture par session (B30) : la tuile
                n'est pas affichée d'ici là. Les signaux de frustration se lisent sur
                l'écran Expérience et par ligne dans la liste ci-dessous. */}
          </section>
        </SectionErreur>
        {blocs.engagement && (
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
        )}
      </div>

      {(precIllisible || comparaison.mode === "release") && (
        <div role="note" data-testid="note-comparaison" className="mb-3 space-y-0.5 text-xs text-ink-soft">
          {precIllisible && <p>Période précédente illisible en partie : les cases concernées n&apos;affichent aucun écart.</p>}
          {comparaison.mode === "release" && (
            <p>
              Comparaison de releases : pas d&apos;écart par release sur ces cases — une session n&apos;a pas de release
              unique, la release est portée par chaque occurrence.
            </p>
          )}
        </div>
      )}

      {/* S7 : sous la rangée de KPI qu'il qualifie. Rien n'est rendu hors échantillonnage. */}
      <BandeauEchantillonnage lecture={echantillonnage} />

      {/* Hero « À regarder d'abord » (B30) : rendu seulement quand son classement est lu. */}
      {heroPriorite && !("raison" in priorite) && (
        <div className="mb-4 min-w-0">
          <SectionErreur titre="À regarder d'abord">
            <Figure
              titre="À regarder d'abord"
              id="a-regarder-d-abord"
              meta={
                <>
                  <span>{pluriel(priorite.lignes.length, "session")} sur 10 au plus</span>
                  <span>sessions actives (dernière activité dans la période)</span>
                  <span>{ecran.label}</span>
                </>
              }
              lecture={
                <>
                  Ordre : occurrences d&apos;erreur, puis signaux de frustration, puis appels API en échec, puis
                  dernière activité. <strong>Ce n&apos;est pas un tri de la liste</strong> : la liste reste
                  chronologique, et ce classement porte sur toute la période, borné à dix lignes.
                </>
              }
              alternative={alternativePriorite(priorite.lignes, ecran.label)}
            >
              <PrioriteSessions lignes={priorite.lignes} hrefs={priorite.hrefs} plage={ecran.label} />
            </Figure>
          </SectionErreur>
        </div>
      )}

      {/* Étage 2 — le volume : sessions (barres) et visiteurs côte à côte, même axe du
          temps (P5). Un clic sur une tranche resserre l'écran sur sa plage. */}
      {blocs.visiteurs && (
        <div className="mb-4">
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
                  <span>sessions commencées (début dans la période)</span>
                  <span>tranches de {bucketLabel(query.range.bucketSeconds)}</span>
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
                  Un clic sur une tranche resserre l&apos;écran sur sa plage.{" "}
                  {referenceTracee && "Trait gris pointillé : la période précédente, tranche contre tranche. "}
                  Les visiteurs ne s&apos;additionnent pas d&apos;une tranche à l&apos;autre.
                  {sansIdentifiant !== null && sansIdentifiant > 0 && (
                    <>
                      {" "}
                      {pluriel(sansIdentifiant, "session sans identifiant de visiteur est", "sessions sans identifiant de visiteur sont")}{" "}
                      hors du graphique des visiteurs ; une tranche qui n&apos;a que de telles sessions y est un trou, pas un zéro.
                    </>
                  )}
                </>
              }
              methode={<p>Source : capteur navigateur (SDK ou extension), table rum_session ; heures de Paris.</p>}
              alternative={{
                legende: `Volume par tranche de ${bucketLabel(query.range.bucketSeconds)}, ${ecran.label}`,
                colonnes: [
                  "Période",
                  "Sessions commencées",
                  ...(referenceTracee ? ["Période précédente (même rang)"] : []),
                  "Visiteurs distincts",
                ],
                lignes: pointsVolume.map((p) => [
                  libelleSeauComplet(p.t, query.range.bucketSeconds, FUSEAU_AFFICHAGE),
                  p.sessions,
                  ...(referenceTracee ? [p.precedent ?? null] : []),
                  p.visiteurs,
                ]),
              }}
              explorer={explorerHref(query, PLAN_SESSIONS_COMMENCEES)}
            >
              <div className="grid min-w-0 gap-x-6 gap-y-3 lg:grid-cols-12" data-testid="volume-panneaux">
                <div className="min-w-0 lg:col-span-8">
                  <h3 className="mb-0.5 text-[11px] font-medium text-ink-soft">Sessions commencées · par tranche</h3>
                  <ThresholdSeries
                    grille={grille}
                    points={pointsVolume}
                    series={[
                      { cle: "sessions", libelle: "Sessions commencées", role: "principale", forme: "barres", additive: true },
                      ...(referenceTracee
                        ? [{ cle: "precedent", libelle: "Période précédente", role: "reference" as const, additive: true }]
                        : []),
                    ]}
                    format="count"
                    annotations={annotations.annotations}
                    annotationsIndisponibles={annotations.indisponible ?? undefined}
                    seauSecondes={query.range.bucketSeconds}
                    fuseau={FUSEAU_AFFICHAGE}
                    zoomHref={gabarit}
                    hauteur={132}
                    synchro="sessions-volume"
                    fenetresCollecte={fenetresCollecte}
                    ariaLabel={`Sessions commencées par tranche de ${bucketLabel(query.range.bucketSeconds)}, ${ecran.label}`}
                  />
                </div>
                <div className="min-w-0 lg:col-span-4">
                  <h3 className="mb-0.5 text-[11px] font-medium text-ink-soft">Visiteurs distincts · par tranche</h3>
                  <ThresholdSeries
                    grille={grille}
                    points={pointsVolume}
                    series={[{ cle: "visiteurs", libelle: "Visiteurs distincts", role: "categorie", categorieIndex: 0 }]}
                    format="count"
                    seauSecondes={query.range.bucketSeconds}
                    fuseau={FUSEAU_AFFICHAGE}
                    zoomHref={gabarit}
                    hauteur={132}
                    synchro="sessions-volume"
                    legendeAnnotations={false}
                    // Panneaux côte à côte : les fenêtres datées sont écrites une fois, sous le premier.
                    noteCollecte={false}
                    fenetresCollecte={fenetresCollecte}
                    ariaLabel={`Visiteurs distincts par tranche de ${bucketLabel(query.range.bucketSeconds)}, ${ecran.label} ; valeurs non additionnables`}
                  />
                </div>
              </div>
            </Figure>
          </SectionErreur>
        </div>
      )}

      {/* Étage 3 — facettes à gauche (3 colonnes), liste au centre (9 colonnes) ; le
          panneau d'une session s'ouvre par-dessus, à droite. Empilés sous 1 280 px. */}
      {(aside || blocs.liste) && (
        <div className={`grid min-w-0 gap-4 ${aside && blocs.liste ? "xl:grid-cols-12" : ""}`}>
          {aside && (
            // Collée sous la barre du haut pendant qu'on parcourt la liste : les facettes
            // restent à portée de clic, la colonne ne devient pas un blanc de 1 500 px.
            <div className={`flex min-w-0 flex-col gap-4 ${blocs.liste ? "xl:sticky xl:top-20 xl:col-span-3 xl:self-start" : ""}`}>
              {blocs.repartition && (
                <div className="min-w-0" data-testid="repartition">
                  <SectionErreur titre="Qui sont ces sessions">
                    {!repartition.ok ? (
                      <div className="card p-3">
                        <EchecLecture titre="Qui sont ces sessions" compact />
                      </div>
                    ) : dimension === null || repartition.data === null ? (
                      <div className="card p-3">
                        <EtatSurface
                          compact
                          etat={{ kind: "partiel", raison: "aucune dimension de session n'est lisible dans ce schéma" }}
                        />
                      </div>
                    ) : (
                      <Repartition
                        dimension={dimension}
                        donnees={repartition.data}
                        onglets={DIMENSIONS_REPARTITION.map((dim): OngletDecoupage => {
                          const dispo = disponibiliteRepartition(dim, schema);
                          return {
                            dimension: dim,
                            label: LIBELLES_REPARTITION[dim],
                            available: dispo.available,
                            reason: dispo.reason,
                            current: dim === dimension,
                            href: dispo.available ? lienEcran({ [BREAKDOWN_PARAM]: dim }) : null,
                          };
                        })}
                        hrefDe={(valeur) => avecContexte(hrefGroupe(query, dimension, valeur, schema))}
                        plage={ecran.label}
                        // Sous « Pays estimé » seulement, et seulement lue : une lecture en
                        // échec tait la phrase, elle n'en écrit pas une fausse.
                        precision={
                          dimension === "country" && provenancePays.ok && provenancePays.data
                            ? phraseProvenancePays(partsProvenancePays(provenancePays.data.groupes, provenancePays.data.total))
                            : null
                        }
                      />
                    )}
                  </SectionErreur>
                </div>
              )}
              {blocs.resume && (
                <SectionErreur titre="Nouveaux, revenants, non identifiés">
                  <VisiteursActifs lu={vs} plage={ecran.label} />
                </SectionErreur>
              )}
            </div>
          )}

          {blocs.liste && (
            <div className={`min-w-0 ${aside ? "xl:col-span-9" : ""}`}>
              {!refus && !rows.ok ? (
                // Liste en échec : ni « Aucune session sur 24 h » (un vide qu'on n'a pas
                // lu), ni pagination (une page suivante d'une liste inconnue).
                <>
                  <Recherche
                    caches={caches}
                    champ={champ}
                    valeur={recherche?.value ?? url.get(SESSION_SEARCH_PARAM) ?? ""}
                    refus={refus}
                    reinitialiser={recherche || refus ? hrefWithQuery("/sessions", query) : null}
                    releaseParOccurrence={releaseParOccurrence}
                  />
                  <EchecLecture titre="Liste des sessions" />
                </>
              ) : (
                <SectionErreur titre="Liste des sessions">
                  <section
                    id={ANCRE_TOUTES_SESSIONS}
                    className="card min-w-0 scroll-mt-20 p-3"
                    aria-labelledby="toutes-les-sessions-titre"
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                      <h2 id="toutes-les-sessions-titre" className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                        Toutes les sessions
                      </h2>
                      {recherche && !refus && (
                        <p className="min-w-0 truncate text-[11px] text-ink-soft" data-testid="recherche-resume">
                          {sessionSearchSummary(recherche)} · {ecran.label}
                        </p>
                      )}
                      <div className="w-full lg:ml-auto lg:w-auto">
                        <Recherche
                          caches={caches}
                          champ={champ}
                          valeur={recherche?.value ?? url.get(SESSION_SEARCH_PARAM) ?? ""}
                          refus={refus}
                          reinitialiser={recherche || refus ? hrefWithQuery("/sessions", query) : null}
                          releaseParOccurrence={releaseParOccurrence}
                        />
                      </div>
                    </div>
                    {/* Filtres rapides : ils restreindront LA LISTE SEULE, jamais les tuiles. Leur
                        lecture (B30) manque : ils ne sont pas dessinés — des bascules désactivées
                        aux couleurs d'un filtre actif trompaient (recette du 26/09/2026). Une URL
                        qui porte `avec` est déclarée NON APPLIQUÉE (V10), jamais ignorée en silence. */}
                    {avecDemande !== null && (
                      <p role="note" data-testid="avec-non-applique" className="mb-2 text-xs text-ink-soft">
                        Filtre « {LIBELLES_AVEC[avecDemande]} » non appliqué : {FILTRE_AVEC_INDISPONIBLE}. La liste porte sur
                        toutes les sessions de la période.
                      </p>
                    )}
                    {!refus && rows.ok && (
                      <SessionsTable
                        // Frustration et rejeu LUS pour les lignes affichées (recette du 26/09/2026 :
                        // forcés à « — », ils disaient « pas de rejeu » de 140 sessions qui en avaient
                        // un). Lecture en échec, ou session mobile sans capteur : « — », jamais « 0 ».
                        lignes={page.map((s) => {
                          const lu = signaux.ok ? signaux.data[cleSession(s)] : undefined;
                          return { ...s, frustration: lu ? lu.frustration : null, rejeu: lu ? lu.rejeu : null };
                        })}
                        rejeuHrefs={Object.fromEntries(
                          page
                            .filter((s) => signaux.ok && signaux.data[cleSession(s)]?.rejeu === true)
                            .map((s) => [
                              s.session_id,
                              hrefWithQuery(`/sessions/${encodeURIComponent(s.session_id)}`, query, { tab: "replay" }),
                            ]),
                        )}
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
                    )}
                  </section>
                </SectionErreur>
              )}
            </div>
          )}
        </div>
      )}

      {!heroPriorite && !blocs.repartition && !blocs.visiteurs && !blocs.engagement && !blocs.resume && !blocs.liste && (
        <TousEteints />
      )}

      {/* Panneau de la session ouverte (F43, § 5.11.4) : moitié droite dès 1280 px,
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
    <div className="card min-w-0 p-3">
      <EchecLecture compact titre={titre} />
    </div>
  );
}

/**
 * La recherche exacte, sur une ligne : champ, valeur, « Rechercher ». La règle
 * (égalité exacte, pas de recherche par identité) est dans une bulle et lue par le
 * champ (`aria-describedby`) ; un refus, lui, reste écrit sous le champ.
 */
function Recherche({
  caches,
  champ,
  valeur,
  refus,
  reinitialiser,
  releaseParOccurrence,
}: {
  caches: [string, string][];
  champ: (typeof SESSION_SEARCH_FIELDS)[number];
  valeur: string;
  refus: string | null;
  reinitialiser: string | null;
  releaseParOccurrence: boolean;
}) {
  const aide = `Égalité exacte, jamais un motif ni un préfixe. La recherche par identité — visiteur, compte, adresse — n'est pas proposée : une URL partageable ne doit pas permettre de retrouver le parcours d'une personne.${
    releaseParOccurrence ? "" : " La release est lue sur la session tant que les colonnes par occurrence ne sont pas présentes."
  }`;
  return (
    <form method="get" action="/sessions" className="flex min-w-0 flex-wrap items-center gap-1.5" aria-label="Rechercher une session">
      {caches.map(([nom, v]) => (
        <input key={nom} type="hidden" name={nom} value={v} />
      ))}
      <label className="sr-only" htmlFor="recherche-champ">
        Chercher par
      </label>
      <select id="recherche-champ" name={SESSION_SEARCH_FIELD_PARAM} defaultValue={champ} className={`${INPUT_CLASS} max-w-[12rem] text-xs`}>
        {SESSION_SEARCH_FIELDS.map((field) => (
          <option key={field} value={field}>
            {SESSION_SEARCH_LABELS[field]}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="recherche-valeur">
        Valeur exacte
      </label>
      <input
        id="recherche-valeur"
        name={SESSION_SEARCH_PARAM}
        defaultValue={valeur}
        maxLength={512}
        placeholder={SESSION_SEARCH_PLACEHOLDERS[champ]}
        aria-invalid={refus ? true : undefined}
        aria-describedby={refus ? "recherche-refus" : "recherche-aide"}
        className={`${INPUT_CLASS} min-w-0 flex-1 text-xs sm:w-56 sm:flex-none`}
      />
      <button className="btn-accent px-3 py-1 text-xs" type="submit">
        Rechercher
      </button>
      {reinitialiser && (
        <Link href={reinitialiser} className="btn-ghost px-2 py-1 text-xs">
          Réinitialiser
        </Link>
      )}
      <InfoTip label="Règle de la recherche" align="end">
        {aide}
      </InfoTip>
      <p id="recherche-aide" className="sr-only">
        {aide}
      </p>
      {refus && (
        <p id="recherche-refus" role="alert" data-testid="recherche-refus" className="w-full text-xs text-bad-ink">
          {refus}
        </p>
      )}
    </form>
  );
}

/** « Qui sont ces sessions » : part de chaque groupe dans les sessions commencées, en facettes. */
function Repartition({
  dimension,
  donnees,
  onglets,
  hrefDe,
  plage,
  precision = null,
}: {
  dimension: DimensionRepartition;
  donnees: DonneesRepartition;
  onglets: OngletDecoupage[];
  hrefDe: (valeur: string | null) => string;
  plage: string;
  /** Provenance du pays, sous l'onglet « Pays estimé » (`phraseProvenancePays`). */
  precision?: string | null;
}) {
  const reste = resteNonAffiche(donnees.total, donnees.groupes, donnees.tronque);
  const groupes: GroupeRepartition[] = donnees.groupes.map((g) => {
    const libelle = libelleGroupe(dimension, g.valeur);
    const part = partDuTout(g.sessions, donnees.total);
    return {
      // « Inconnu » a sa propre clé : les valeurs déclarées portent le préfixe `v:`.
      cle: g.valeur === null ? "inconnu" : `v:${g.valeur}`,
      valeur: g.valeur,
      libelle,
      sessions: g.sessions,
      compte: formater("count", g.sessions),
      part,
      href: hrefDe(g.valeur),
      description: `${LIBELLES_REPARTITION[dimension]} ${libelle} — ${pluriel(g.sessions, "session commencée", "sessions commencées")}, ${part} du total`,
    };
  });
  const noticeDimension = dimension === "source" ? NOTICE_CAPTEUR : BREAKDOWN_NOTICES[dimension];
  const notice = [
    `Sessions commencées sur ${plage} : ${formater("count", donnees.total)} au total ; chaque ligne filtre l'écran sur son groupe.`,
    reste !== null ? `Seuls les ${REPARTITION_LIMITE} groupes les plus fournis sont affichés.` : null,
    noticeDimension,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <RepartitionSessions
      titre="Qui sont ces sessions"
      dimension={dimension}
      onglets={onglets}
      groupes={groupes}
      notice={notice}
      reste={reste !== null ? `${pluriel(reste, "session", "sessions")} (${partDuTout(reste, donnees.total)})` : null}
      precision={precision}
      vide={`Aucune session commencée sur ${plage}.`}
      legende={`${LIBELLES_REPARTITION[dimension]} des sessions commencées, ${plage} (${formater("count", donnees.total)} au total)`}
    />
  );
}

/**
 * Engagement : trois cases de la rangée — deux percentiles et un taux, jamais une
 * moyenne (P7). Sous le seuil d'engagement, les cases disent « — » et pourquoi dans
 * leur fenêtre : la rangée garde ses sept cases alignées.
 */
function Engagement({
  lu,
  precedent,
  comparer,
}: {
  lu: SectionLue<EngagementStats>;
  precedent: EngagementStats | null;
  comparer: (precedent: number | null) => Comparaison;
}) {
  if (!lu.ok) {
    return (
      <div className="card col-span-2 min-w-0 p-3 sm:col-span-4 xl:col-span-3" id="engagement" data-testid="engagement">
        <EchecLecture compact titre="Engagement" />
      </div>
    );
  }
  const e = lu.data;
  const suffisant = engagementSuffisant(e);
  const raisonInsuffisant = suffisant ? undefined : engagementRaison(e);
  const couverture = { n: e.sessions_with_view, unite: "sessions avec une page vue", faibleSous: ENGAGEMENT_MIN_SESSIONS };
  const ms = (s: number | null) => (s == null ? null : s * 1000);
  const actives =
    e.still_active > 0
      ? `${pluriel(e.still_active, "encore active", "encore actives")} (vue dans les ${STILL_ACTIVE_MINUTES} dernières minutes de la période) : durée pas encore close.`
      : undefined;
  const methodeDuree =
    "Durée observée = écart entre la première et la dernière observation, pas du temps actif : un onglet laissé ouvert l'allonge, une sortie brutale la raccourcit.";
  return (
    <section
      aria-label="Engagement"
      id="engagement"
      className="col-span-2 grid grid-cols-2 gap-2 sm:col-span-4 sm:grid-cols-3 xl:col-span-3"
      data-testid="engagement"
    >
      <KpiTile
        label="Durée observée médiane"
        libelleCase="Durée médiane"
        valeur={suffisant ? ms(e.duration_p50_s) : null}
        raisonNull={raisonInsuffisant ?? "aucune session avec une page vue"}
        format="s-auto"
        sensMeilleur="neutre"
        couverture={couverture}
        lecture={actives}
        methode={methodeDuree}
        source={SOURCE_SESSIONS}
        categorie="Engagement · p50"
        {...(suffisant ? comparer(ms(precedent?.duration_p50_s ?? null)) : {})}
      />
      <KpiTile
        label="Durée observée p75"
        libelleCase="Durée p75"
        valeur={suffisant ? ms(e.duration_p75_s) : null}
        raisonNull={raisonInsuffisant ?? "aucune session avec une page vue"}
        format="s-auto"
        sensMeilleur="neutre"
        lecture="les 25 % les plus longues durent au moins autant."
        couverture={couverture}
        methode={methodeDuree}
        source={SOURCE_SESSIONS}
        categorie="Engagement · p75"
        {...(suffisant ? comparer(ms(precedent?.duration_p75_s ?? null)) : {})}
      />
      <KpiTile
        label="Sessions à une seule vue"
        libelleCase="Sessions à une vue"
        valeur={suffisant ? singleViewSessionRate(e) : null}
        raisonNull={raisonInsuffisant ?? "aucune session avec une page vue : taux non calculable"}
        format="pct"
        sensMeilleur="neutre"
        lecture={`${formater("count", e.single_view_sessions)} sur ${pluriel(e.sessions_with_view, "session")} avec au moins une vue.`}
        couverture={couverture}
        methode="Sessions à exactement une page vue, sur les sessions commencées qui en ont au moins une. Ce n'est pas un taux de rebond : aucune durée minimale ni interaction n'entre dans sa définition."
        source={SOURCE_SESSIONS}
        categorie="Engagement · une vue"
        {...(suffisant ? comparer(precedent ? singleViewSessionRate(precedent) : null) : {})}
      />
    </section>
  );
}

/**
 * Nouveaux, revenants, non identifiées, sur les sessions ACTIVES (dernière activité
 * dans la fenêtre) : une barre empilée à trois parts et leur légende chiffrée — la
 * part inconnue nommée, jamais répartie. `visitStats.sessions` (sessions ayant une
 * vue) n'y figure pas : autre population.
 */
function VisiteursActifs({ lu, plage }: { lu: SectionLue<VisitStats | null>; plage: string }) {
  const titre = "Nouveaux · revenants";
  if (!lu.ok) return <Figure titre={titre} id="nouveaux-revenants" etat={{ kind: "erreur", titre }} />;
  const vs = lu.data;
  if (!vs) return null;
  const total = vs.new_count + vs.returning_count + vs.unidentified_count;
  const parts = [
    { cle: "nouveaux", libelle: "Nouveaux", n: vs.new_count, couleur: CATEGORIELLE[0] },
    { cle: "revenants", libelle: "Revenants", n: vs.returning_count, couleur: CATEGORIELLE[1] },
    { cle: "inconnus", libelle: "Non identifiées", n: vs.unidentified_count, couleur: "rgb(var(--c-ink-faint))" },
  ];
  return (
    <Figure
      titre={titre}
      id="nouveaux-revenants"
      etat={total === 0 ? { kind: "vide", population: "session active", plage } : undefined}
      meta={
        <span data-testid="anneau-population">
          {pluriel(total, "session active", "sessions actives")} (dernière activité dans la période)
        </span>
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
        lignes: parts.map((p) => [p.libelle, p.n, partDuTout(p.n, total)]),
      }}
    >
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-panel2" role="img" aria-label={parts.map((p) => `${p.libelle} ${partDuTout(p.n, total)}`).join(", ")}>
        {parts.map((p) =>
          p.n > 0 ? <span key={p.cle} className="h-full" style={{ width: `${(p.n / total) * 100}%`, backgroundColor: p.couleur }} /> : null,
        )}
      </div>
      <ul className="mt-2 grid grid-cols-3 gap-1 text-xs">
        {parts.map((p) => (
          <li key={p.cle} className="min-w-0">
            <span className="flex items-center gap-1 text-[11px] text-ink-soft">
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: p.couleur }} />
              <span className="truncate">{p.libelle}</span>
            </span>
            <span className="block font-semibold tabular-nums text-ink">
              {formater("count", p.n)} <span className="text-[11px] font-normal text-ink-soft">{partDuTout(p.n, total)}</span>
            </span>
          </li>
        ))}
      </ul>
    </Figure>
  );
}
