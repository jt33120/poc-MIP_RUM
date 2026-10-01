// Alertes — /alerts (F64, plan § 5.19).
//
// LA QUESTION. « Qu'est-ce qui s'est déclenché, qui en a été averti, et qu'est-ce
// qui reste à traiter ? » D'où l'ordre de l'écran : ce qui manque pour prévenir
// (aucun canal actif) AVANT tout chiffre, puis les chiffres, puis les
// déclenchements, puis ce qu'il reste à traiter, puis la configuration.
//
// CE QUE L'ÉCRAN N'AFFIRME PAS.
//   - Il ne compte plus les déclenchements sur les 100 derniers événements gardés
//     en mémoire : les barres et la frise lisent 30 jours FIXES en SQL
//     (`alertEventsByDay`, `alertFirings`, F62). Une fenêtre de 30 jours n'est pas
//     la plage de l'écran, et l'écran le dit : une règle s'évalue sur SA fenêtre.
//   - « Livrée » ≠ « partie » : trois états conservés (v49). Une alerte transmise
//     dont le code HTTP n'est pas connu n'est ni livrée ni perdue.
//   - Le délai d'acquittement (MTTA) n'est pas affiché : `alert_event` n'a pas
//     d'horodatage d'acquittement (B50, § 6.3). Le motif est écrit à l'écran, en
//     mots : sans nom de colonne (recette du 26/09/2026).
//   - Aucun bouton d'écriture n'est RENDU pour un viewer ou une démonstration (V9).
//
// CHAQUE SECTION LIT INDÉPENDAMMENT (F02, § 3.8) : `lire()` ne lève pas, et une
// lecture en échec n'efface pas les autres. AUCUNE frontière `<Suspense>` ni
// `loading.tsx` au-dessus de l'écran (écart F02 : elles cassent `router.replace`).
import Link from "next/link";
import { motifDeRefus } from "@mip/backend/lib/net/safe-fetch.mjs";
import { ECRANS } from "@mip/console-contract";
import { Figure } from "@/components/charts/Figure";
import { FriseDeclenchements } from "@/components/charts/FriseDeclenchements";
import { KpiTile } from "@/components/charts/KpiTile";
import { StackedBars } from "@/components/charts/StackedBars";
import { FilterProblemNotice, FiltersNotAppliedNote } from "@/components/FilterProblemNotice";
import { PageHeader } from "@/components/PageHeader";
import { CadreEtat, EtatSurface } from "@/components/states/EtatSurface";
import { ICON_PATHS, Icon } from "@/components/icons";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import { ChannelsSection } from "@/components/alerts/ChannelsSection";
import { RuleFields } from "@/components/alerts/RuleFields";
import { RAISON_DETECTION_RELEASE, RAISON_REGRESSION_RELEASE, type ModeRelease } from "@/components/alerts/RuleFields";
import { RuleRow } from "@/components/alerts/RuleRow";
import { SeverityBadge } from "@/components/alerts/SeverityBadge";
import type { Fil } from "@mip/console-contract";
import { chargerAlertes } from "@/lib/chargeurs/alertes";
import { chargerEcran } from "@/lib/ecran";
import type { SearchParams } from "@/lib/filters";
import { formater } from "@/lib/fmt-ids";
import { accord, fmtDate, pluriel } from "@/lib/format";
import { hrefWithQuery, paramReader, queryToSearchParams } from "@/lib/query-contract";
import type { NotifyChannelRow } from "@/lib/queries-alerting";
import {
  isAlertMetric,
  totalNonLivres,
  type AlertDayRow,
  type AlertEventRow,
  type AlertFiringRow,
  type AlertRuleRow,
} from "@/lib/queries-v2";
import { lireEtatDeVue } from "@/lib/view-state";
import {
  alternativeParJour,
  cibleMesure,
  declenchementsParRegle,
  etatLivraison,
  fluxATraiter,
  grilleDesJours,
  JOURS_DECLENCHEMENTS,
  MOTIF_MTTA,
  PLAFOND_DECLENCHEMENTS,
  PLAFOND_FLUX,
  comptesRegles,
  lectureSansDonnees,
  pistesDeDeclenchements,
  pointsParJour,
  SEVERITES_AFFICHEES,
  titreEvenement,
  totalDeclenchements,
} from "@/lib/alertes-ecran";
import { ackEventAction, createRuleAction, evaluateNowAction } from "./actions";
import { FUSEAU_AFFICHAGE } from "@/lib/fuseau-local";
import { fenetresLues } from "@/lib/series";

export const dynamic = "force-dynamic";

const TITRE = "Alertes";
const JOUR_SECONDES = 86_400;

/** D'où viennent les chiffres des cases, écrit dans leur fenêtre. */
const SOURCE_ALERTES = "Table alert_event : déclenchements écrits par l'évaluateur des règles, des SLO et des issues.";
const SOURCE_LIVRAISONS =
  "Tables alert_event et alert_delivery : un déclenchement compte ici s'il n'a aucune livraison confirmée (2xx) ni en attente.";
const SOURCE_REGLES = "Table alert_rule : état laissé par la dernière évaluation de chaque règle active.";

export default async function Alerts({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const sp = (await searchParams) ?? {};
  // Le chargeur (`lib/chargeurs/alertes.ts`) lit chaque section, et ce qui ne sert
  // qu'à écrire pour un administrateur seulement (décidé par son principal).
  const ecran = await chargerEcran(ECRANS.alertes, chargerAlertes, sp);
  if (ecran.etat === "refus") return <FilterProblemNotice title={TITRE} problem={ecran.problem} />;
  const f = { app: ecran.appFiltre };
  const lecteur = paramReader(sp);
  // État de vue (F06, § 3.1) : `evt` met un déclenchement en évidence, `regle_*`
  // pré-remplit le formulaire. Une valeur illisible est IGNORÉE et signalée — elle
  // ne touche aucun chiffre, donc elle ne justifie pas un refus.
  const { etat: vue, ignores } = lireEtatDeVue("/alerts", lecteur, { estMetriqueAlerte: isAlertMetric });

  const { admin, plateforme, regles, evenements, nonAcquittees, apps, canaux, parJour, declenchements, releaseDetectee, fenetresCollecte } = ecran;
  const modeRelease: ModeRelease = !releaseDetectee.ok
    ? { disponible: false, raison: RAISON_DETECTION_RELEASE }
    : releaseDetectee.data
      ? { disponible: true }
      : { disponible: false, raison: RAISON_REGRESSION_RELEASE };

  const listeRegles: Fil<AlertRuleRow>[] = regles.ok ? regles.data : [];
  const listeEvenements: Fil<AlertEventRow>[] = evenements.ok ? evenements.data : [];
  const listeCanaux: Fil<NotifyChannelRow>[] = canaux.ok ? canaux.data : [];
  const jours: Fil<AlertDayRow>[] = parJour.ok ? parJour.data : [];
  const lignes: Fil<AlertFiringRow>[] = declenchements.ok ? declenchements.data.lignes : [];
  const comptes = regles.ok ? comptesRegles(listeRegles) : null;
  const canauxActifs = canaux.ok ? listeCanaux.filter((c) => c.active).length : null;
  const grille = grilleDesJours(jours);
  const pistes = pistesDeDeclenchements(lignes, listeRegles);
  const flux = fluxATraiter(listeEvenements);
  // La fenêtre d'évaluation d'un déclenchement vient de SA règle : c'est elle qui
  // donne `[fired_at − window_minutes, fired_at)`, la seule plage qui décrit ce que
  // l'évaluateur a regardé.
  const regleParId = new Map(listeRegles.map((r) => [r.id, r]));
  // `alertEvents` ne rend pas l'issue d'un déclenchement SANS règle (notification
  // v73) ; `alertFirings` la porte. Jointure par identifiant d'événement.
  const sourceParEvenement = new Map(lignes.map((l) => [l.event_id, l]));

  const firedRaw = Array.isArray(sp.fired) ? sp.fired[0] : sp.fired;
  const fired = firedRaw != null && /^\d+$/.test(firedRaw) ? Number(firedRaw) : null;
  // Refus d'une URL sortante à l'écriture (P1) : l'action renvoie un CODE, le
  // texte est relu ici — jamais le contenu d'un paramètre affiché tel quel.
  const urlRefuseeRaw = Array.isArray(sp.url_refusee) ? sp.url_refusee[0] : sp.url_refusee;
  const urlRefusee = urlRefuseeRaw != null ? (motifDeRefus(urlRefuseeRaw) ?? "URL refusée.") : null;
  // « Créer une alerte de pic » depuis une issue : `?issue=<uuid>` préremplit le formulaire.
  const issueRaw = Array.isArray(sp.issue) ? sp.issue[0] : sp.issue;
  const defaultIssue = issueRaw && isAlertMetric(`issue:${issueRaw}`) ? issueRaw : undefined;
  const preRemplissage = vue.regle.metrique !== null || vue.regle.route !== null || vue.regle.seuil !== null;

  const evtMisEnEvidence = vue.evt;
  const evtHorsFlux = evtMisEnEvidence != null && !listeEvenements.some((e) => e.id === evtMisEnEvidence);

  const total30j = totalDeclenchements(jours);
  const nonLivres30j = parJour.ok ? totalNonLivres(jours) : null;
  // Recette du 30/09/2026 — « règle en une ligne, dernier déclenchement » : tiré des
  // lignes DÉJÀ lues pour la frise, sur les mêmes jours que les barres.
  const parRegle = declenchements.ok ? declenchementsParRegle(lignes, grille) : null;
  // Plusieurs apps lues : le nom de l'app suit chaque déclenchement ; une seule : rien.
  const avecApp = ecran.query.scope.requestedApp === null;
  const figureVide = parJour.ok && total30j === 0 && pistes.length === 0;
  // « À traiter » prend le tiers droit de la rangée quand il a des lignes ; vide, il
  // tient sur une ligne sous la figure (pas de colonne qui ne dit rien).
  const cote = evenements.ok && flux.length > 0 && !figureVide;
  // Rien de créé (recette du 01/10/2026 : « tout afficher », mais pas des cases à 0) :
  // aucune règle, aucun déclenchement sur 30 jours, lectures réussies. L'écran dit
  // l'absence en UNE ligne, qui est aussi le geste de création ; les canaux restent.
  const rienCree =
    regles.ok && listeRegles.length === 0 && evenements.ok && listeEvenements.length === 0 && parJour.ok && total30j === 0;

  return (
    <div className="animate-fade-up">
      {/* ── Zone 1 : en-tête, badge et évaluation manuelle. ── */}
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {TITRE}
            {nonAcquittees.ok && nonAcquittees.data > 0 && (
              <span
                data-testid="unacked-badge"
                className="rounded-full bg-bad-fond px-2.5 py-0.5 text-xs font-bold text-white"
              >
                {formater("count", nonAcquittees.data)} non {accord(nonAcquittees.data, "acquittée", "acquittées")}
              </span>
            )}
          </span>
        }
        domain="fiabilite"
      >
        {plateforme && (
          <form action={evaluateNowAction}>
            <input type="hidden" name="qs" value={`?${queryToSearchParams(ecran.query)}`} />
            <button type="submit" data-testid="evaluate-now" className="btn-accent">
              Évaluer maintenant
            </button>
          </form>
        )}
      </PageHeader>
      <FiltersNotAppliedNote note={ecran.notApplied} />
      {ignores.map((ligne) => (
        <p key={ligne} role="note" className="mb-2 text-xs text-ink-soft" data-testid="reglage-ignore">
          {ligne}
        </p>
      ))}

      {/* ── Zone 2 : résultat de « Évaluer maintenant » (conservé), en une ligne. ── */}
      {fired != null && (
        <div
          data-testid="fired-banner"
          className={`mb-3 rounded-lg border px-3 py-2 text-xs font-medium ${
            fired > 0 ? "border-bad/30 bg-bad/10 text-bad-ink" : "border-good/30 bg-good/10 text-good-ink"
          }`}
        >
          Évaluation faite :{" "}
          {fired > 0 ? `${pluriel(fired, "alerte déclenchée", "alertes déclenchées")}.` : "aucune alerte déclenchée."}
        </div>
      )}
      {urlRefusee && (
        <div
          role="alert"
          data-testid="url-refusee"
          className="mb-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs font-medium text-bad-ink"
        >
          URL de webhook non enregistrée — {urlRefusee}
        </div>
      )}

      {/* ── Zone 3 : aucun canal actif — AVANT tout chiffre (conservé), en une ligne.
             Une alerte qui se déclenche sans atteindre personne est un faux
             sentiment de sécurité : le dire sous les chiffres serait le dire trop
             tard. La phrase entière reste lue par un lecteur d'écran. ── */}
      {canaux.ok && canauxActifs === 0 && (
        <div
          data-testid="no-channel-warning"
          className="mb-3 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn-ink"
        >
          <Icon paths={ICON_PATHS.bell} className="h-3.5 w-3.5 shrink-0" />
          <span className="font-semibold">Aucun canal de notification actif</span>
          <span aria-hidden>—</span>
          <span>la supervision voit, elle ne prévient pas.</span>
          <span className="sr-only">
            Les alertes de ce périmètre se déclenchent sans être envoyées à personne.
            {total30j > 0 ? ` ${pluriel(total30j, "déclenchement")} sur ${JOURS_DECLENCHEMENTS} jours.` : ""}
          </span>
          <a href="#canaux" className="font-medium underline underline-offset-2 sm:ml-auto">
            Ajouter un canal
          </a>
        </div>
      )}

      {/* ── Zone 4 : les cinq chiffres clés (A1, A2, A3, A4, A4b), cases de même gabarit. ── */}
      {!rienCree && (
      <SectionErreur titre="Chiffres clés des alertes">
        <div className="mb-4 grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-5" data-testid="kpi-alertes">
          <KpiTile
            label="Non acquittées"
            valeur={nonAcquittees.ok ? nonAcquittees.data : null}
            format="count"
            raisonNull="lecture en échec"
            alerte={{ si: ">", valeur: 0, regle: "déclenchement non acquitté" }}
            lecture="tous les déclenchements non acquittés du périmètre, sans plafond"
            source={SOURCE_ALERTES}
            categorie="Déclenchements"
            href="#a-traiter"
          />
          <KpiTile
            label={`Déclenchées sans que personne soit averti (${JOURS_DECLENCHEMENTS} j)`}
            libelleCase={`Sans destinataire · ${JOURS_DECLENCHEMENTS} j`}
            valeur={nonLivres30j}
            format="count"
            raisonNull="lecture en échec"
            alerte={{ si: ">", valeur: 0, regle: "aucune livraison réussie ni en attente" }}
            lecture="une notification transmise dont le code HTTP n'est pas confirmé ne compte pas ici"
            source={SOURCE_LIVRAISONS}
            categorie="Livraisons"
            href="#declenchements"
          />
          <KpiTile
            label="Règles franchies à la dernière évaluation"
            libelleCase="Règles franchies"
            valeur={comptes ? comptes.franchies : null}
            format="count"
            raisonNull="lecture en échec"
            lecture={comptes ? `sur ${pluriel(comptes.actives, "règle active", "règles actives")}` : undefined}
            source={SOURCE_REGLES}
            categorie="Règles"
            href="#regles"
          />
          <KpiTile
            label="Règles sans données"
            valeur={comptes ? comptes.sansDonnees : null}
            format="count"
            raisonNull="lecture en échec"
            // Une règle sans données n'est pas « normale » : elle ne surveille rien encore,
            // ou la collecte était coupée sur sa fenêtre (v105).
            lecture={comptes ? lectureSansDonnees(comptes) : undefined}
            source={SOURCE_REGLES}
            categorie="Règles"
            href="#regles"
          />
          <KpiTile
            label="Canaux actifs"
            valeur={canauxActifs}
            format="count"
            raisonNull="lecture en échec"
            alerte={{ si: "<", valeur: 1, regle: "aucun canal : personne n'est prévenu" }}
            lecture="canaux globaux et canaux de l'app"
            source="Table notify_channel : canaux globaux et canaux de l'application, actifs."
            categorie="Routage"
            href="#canaux"
          />
        </div>
      </SectionErreur>
      )}

      {/* ── Zone 5 : les déclenchements des 30 derniers jours (barres AU-DESSUS de la
             frise par source, même axe) et, à droite, ce qu'il reste à traiter. ── */}
      {!rienCree && (
      <div className={`mb-4 grid min-w-0 gap-2 ${cote ? "xl:grid-cols-12" : ""}`}>
        {/* La figure prend la hauteur de la rangée : ses bords bas s'alignent sur la liste. */}
        <div className={`min-w-0 ${cote ? "xl:col-span-8 xl:[&>section]:h-full" : ""}`}>
          <SectionErreur titre={`Déclenchements des ${JOURS_DECLENCHEMENTS} derniers jours`}>
            <Figure
              titre={`Déclenchements des ${JOURS_DECLENCHEMENTS} derniers jours`}
              id="declenchements"
              meta={
                <>
                  <span>{JOURS_DECLENCHEMENTS} jours fixes, jusqu&apos;à maintenant ; la plage de l&apos;écran ne s&apos;applique pas</span>
                  <span>
                    {formater("count", total30j)} déclenchement{total30j > 1 ? "s" : ""}
                  </span>
                  <span>source : table alert_event</span>
                </>
              }
              etat={
                !parJour.ok
                  ? { kind: "erreur", titre: `Déclenchements des ${JOURS_DECLENCHEMENTS} derniers jours` }
                  : figureVide
                    ? { kind: "vide", population: "déclenchement", masculin: true, plage: `${JOURS_DECLENCHEMENTS} jours` }
                    : undefined
              }
              alternative={jours.length > 0 ? alternativeParJour(jours) : undefined}
              titreAlternative="Alternative textuelle — déclenchements par jour"
              lecture={
                <>
                  Chaque barre compte les déclenchements d&apos;un jour, empilés par sévérité (des
                  comptes s&apos;additionnent). Sous les barres, une piste par source : un marqueur = un
                  déclenchement, sa forme dit la livraison, son contour l&apos;acquittement.
                </>
              }
            >
              <div className="min-w-0">
                <StackedBars
                  grille={grille}
                  points={pointsParJour(jours)}
                  series={SEVERITES_AFFICHEES.map((s) => ({ cle: s.cle, libelle: s.libelle, ton: s.ton }))}
                  format="count"
                  seauSecondes={JOUR_SECONDES}
                  fuseau={FUSEAU_AFFICHAGE}
                  hauteur={80}
                  fenetresCollecte={fenetresLues(fenetresCollecte)}
                  ariaLabel={`Déclenchements par jour sur ${JOURS_DECLENCHEMENTS} jours, empilés par sévérité`}
                />
                {!declenchements.ok ? (
                  <div className="mt-3">
                    <EchecLecture titre="Déclenchements par source" compact />
                  </div>
                ) : (
                  <FriseDeclenchements
                    debut={grille[0] ?? new Date(Date.now() - JOURS_DECLENCHEMENTS * 86_400_000).toISOString()}
                    fin={new Date().toISOString()}
                    pistes={pistes}
                    tronque={
                      declenchements.data.tronque
                        ? `${formater("count", PLAFOND_DECLENCHEMENTS)} déclenchements affichés sur ${JOURS_DECLENCHEMENTS} j : les plus anciens manquent`
                        : undefined
                    }
                  />
                )}
              </div>
            </Figure>
          </SectionErreur>
        </div>

        {/* ── Zone 6 : le flux « À traiter », une ligne dense par déclenchement. ── */}
        <section
          id="a-traiter"
          aria-labelledby="a-traiter-titre"
          className={`card flex min-w-0 scroll-mt-20 flex-col ${cote ? "xl:col-span-4" : ""}`}
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line/60 px-3 py-2">
            <h2 id="a-traiter-titre" className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
              À traiter
            </h2>
            {evenements.ok && flux.length > 0 && (
              <span className="text-[11px] tabular-nums text-ink-faint">
                {formater("count", flux.length)} déclenchement{flux.length > 1 ? "s" : ""} · non acquittés d&apos;abord
              </span>
            )}
            {/* Pourquoi aucun délai d'acquittement : lu par un lecteur d'écran, au survol pour les autres. */}
            <span className="sr-only" data-testid="motif-mtta">
              Non acquittés d&apos;abord, puis les plus récents. {MOTIF_MTTA}
            </span>
            <span aria-hidden title={MOTIF_MTTA} className="ml-auto cursor-help text-[11px] text-ink-faint">
              délai d&apos;acquittement non enregistré
            </span>
          </div>
          {!evenements.ok ? (
            <div className="p-3">
              <EchecLecture titre="À traiter" />
            </div>
          ) : (
            <>
              {flux.length >= PLAFOND_FLUX && (
                <div className="px-3 pt-2">
                  <EtatSurface
                    etat={{
                      kind: "partiel",
                      raison: `${formater("count", PLAFOND_FLUX)} plus récents affichés : les déclenchements antérieurs ne sont pas dans cette liste`,
                    }}
                    compact
                  />
                </div>
              )}
              {evtHorsFlux && (
                <p role="note" data-testid="evt-hors-flux" className="px-3 pt-2 text-xs text-ink-soft">
                  Événement {evtMisEnEvidence} hors des {formater("count", PLAFOND_FLUX)} plus récents : il n&apos;est
                  pas affiché ici.
                </p>
              )}
              <div className={`flex min-w-0 flex-col divide-y divide-line/60 ${cote ? "xl:max-h-[26rem] xl:overflow-y-auto" : ""}`}>
                {flux.map((e) => {
                  const source = sourceParEvenement.get(e.id);
                  const livraison = etatLivraison(e);
                  const regle = e.rule_id != null ? (regleParId.get(e.rule_id) ?? null) : null;
                  const cible = cibleMesure(e, regle?.window_minutes ?? null, source?.source === "issue" ? source.source_id : null);
                  const enEvidence = evtMisEnEvidence === e.id;
                  const titre = titreEvenement(e, source, regle);
                  return (
                    <div
                      key={e.id}
                      id={`evt-${e.id}`}
                      data-testid={`alert-event-${e.id}`}
                      aria-current={enEvidence ? "true" : undefined}
                      className={`min-w-0 scroll-mt-20 px-3 py-2 text-xs ${e.acknowledged ? "" : "bg-bad/[0.04]"} ${
                        enEvidence ? "ring-2 ring-inset ring-perf" : ""
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${e.acknowledged ? "bg-ink-faint/50" : "bg-bad"}`} />
                        <SeverityBadge severity={e.severity} />
                        <span className="min-w-0 truncate text-[13px] font-medium text-ink" title={titre}>
                          {titre}
                        </span>
                        {/* Trois états, pas deux : une notification transmise dont le code
                            HTTP n'est pas encore connu n'est PAS une notification livrée.
                            La confondre avec un succès était le défaut corrigé par v49. */}
                        <span
                          title={livraison.detail}
                          data-testid={`livraison-${e.id}`}
                          className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[11px] ${
                            livraison.etat === "livree"
                              ? "bg-panel2 text-ink-faint"
                              : livraison.etat === "en_attente"
                                ? "border border-line bg-panel2 text-ink-soft"
                                : "border border-warn/30 bg-warn/10 text-warn-ink"
                          }`}
                        >
                          {livraison.libelle}
                        </span>
                      </div>
                      <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 pl-4 text-[11px] text-ink-soft">
                        {!e.acknowledged && <span className="font-semibold text-bad-ink">non acquittée</span>}
                        <span className="font-mono text-ink-faint">#{e.id}</span>
                        {/* La route était renvoyée par la lecture sans jamais être affichée :
                            « LCP franchi » sans savoir où n'aide personne. */}
                        <span className="min-w-0 break-words font-mono">
                          {e.route ?? "toutes routes"}
                          {avecApp ? ` · app ${e.app_id}` : ""}
                        </span>
                        <span className="tabular-nums" title={`il y a ${formater("s-auto", Date.now() - new Date(e.fired_at).getTime())}`}>
                          {fmtDate(e.fired_at)}
                        </span>
                        {cible && (
                          <Link
                            href={hrefWithQuery(cible.pathname, ecran.query, cible.extra)}
                            className="font-medium text-perf underline-offset-2 hover:underline"
                            data-testid={`mesure-${e.id}`}
                            title={cible.fenetre ?? undefined}
                          >
                            {cible.libelle}
                          </Link>
                        )}
                        {e.acknowledged ? (
                          <span className="rounded bg-panel2 px-1.5 text-ink-faint">acquittée</span>
                        ) : admin ? (
                          <form action={ackEventAction} className="ml-auto">
                            <input type="hidden" name="id" value={e.id} />
                            <input type="hidden" name="app" value={e.app_id} />
                            <button type="submit" data-testid={`ack-${e.id}`} className="btn-ghost px-2 py-0.5 text-[11px]">
                              Acquitter
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                {flux.length === 0 && (
                  <CadreEtat ton="neutre" role="status" testId="etat-vide" etat="vide" enLigne className="px-3 py-2">
                    <p className="flex items-center gap-1.5">
                      <span aria-hidden className="text-ink-faint">
                        ⊘
                      </span>
                      Aucun déclenchement sur ce périmètre.
                    </p>
                  </CadreEtat>
                )}
              </div>
            </>
          )}
        </section>
      </div>
      )}

      {/* ── Zone 7 : les règles, une ligne chacune, puis leur création. ── */}
      {rienCree && !admin && (
        <p id="regles" className="card mb-4 flex items-center gap-1.5 px-3 py-2 text-xs text-ink-soft" role="status" data-testid="alertes-rien-cree">
          <span aria-hidden className="text-ink-faint">
            ⊘
          </span>
          Aucune règle d&apos;alerte créée sur ce périmètre. Demandez à un administrateur d&apos;en créer une.
        </p>
      )}
      {!rienCree && (
      <section id="regles" aria-labelledby="regles-titre" className="mb-4 min-w-0 scroll-mt-20">
        <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
          <h2 id="regles-titre" className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
            Règles
          </h2>
          {regles.ok && listeRegles.length > 0 && (
            <span className="text-[11px] tabular-nums text-ink-faint">
              {pluriel(listeRegles.length, "règle")} · déclenchements sur {JOURS_DECLENCHEMENTS} j
            </span>
          )}
        </div>
        {!regles.ok ? (
          <EchecLecture titre="Règles" />
        ) : listeRegles.length === 0 ? (
          <p className="card flex items-center gap-1.5 px-3 py-2 text-xs text-ink-soft" role="status">
            <span aria-hidden className="text-ink-faint">
              ⊘
            </span>
            {admin
              ? "Aucune règle — créez la première ci-dessous."
              : "Aucune règle d'alerte sur ce périmètre. Demandez à un administrateur d'en créer une."}
          </p>
        ) : (
          <div className="card min-w-0 divide-y divide-line/60">
            {/* En-têtes de colonnes, à partir de 1 024 px : la ligne se lit comme un tableau. */}
            <div
              aria-hidden
              className="hidden grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,17rem)_auto] gap-x-3 bg-panel2/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint lg:grid"
            >
              <span>Règle</span>
              <span>Réglage</span>
              <span>Dernière évaluation</span>
              <span className="text-right">Déclenchements · {JOURS_DECLENCHEMENTS} j</span>
            </div>
            {listeRegles.map((r) => {
              const d = parRegle?.get(String(r.id));
              return (
                <RuleRow
                  key={r.id}
                  rule={r}
                  apps={apps.ok ? apps.data : []}
                  admin={admin}
                  modeRelease={modeRelease}
                  avecApp={avecApp}
                  dernierDeclenchement={parRegle ? (d?.dernier ?? null) : undefined}
                  parJour={parRegle ? (d?.parJour ?? grille.map(() => 0)) : undefined}
                />
              );
            })}
          </div>
        )}
      </section>
      )}

      {admin && (
        <details id="nouvelle-regle" className="card mb-4 min-w-0" open={(!rienCree && !listeRegles.length) || defaultIssue !== undefined || preRemplissage}>
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-ink-soft transition hover:text-ink">
            {rienCree ? (
              <span className="inline-flex flex-wrap items-center gap-x-2" data-testid="alertes-rien-cree">
                <span aria-hidden className="text-ink-faint">
                  ⊘
                </span>
                <span className="font-normal">Aucune règle d&apos;alerte créée sur ce périmètre.</span>
                <span className="text-brand">+ Créer une alerte</span>
              </span>
            ) : (
              "+ Nouvelle règle"
            )}
          </summary>
          {!apps.ok ? (
            <div className="border-t border-line p-3">
              <EchecLecture titre="Liste des applications" compact />
            </div>
          ) : (
            <form action={createRuleAction} className="flex min-w-0 flex-wrap items-end gap-3 border-t border-line p-3">
              <RuleFields
                apps={apps.data}
                defaultApp={f.app ?? undefined}
                defaultIssue={defaultIssue}
                regle={vue.regle}
                modeRelease={modeRelease}
              />
              <button type="submit" data-testid="create-rule" className="btn-accent">
                Créer
              </button>
            </form>
          )}
        </details>
      )}

      {/* ── Zone 8 : canaux de notification (conservé), une ligne par canal. ── */}
      {!canaux.ok ? (
        <div className="mt-6">
          <EchecLecture titre="Canaux de notification" />
        </div>
      ) : (
        <ChannelsSection channels={listeCanaux} apps={apps.ok ? apps.data : []} defaultApp={f.app ?? undefined} admin={admin} global={plateforme} />
      )}
    </div>
  );
}
