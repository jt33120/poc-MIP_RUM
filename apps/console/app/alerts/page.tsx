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
//     d'horodatage d'acquittement (B50, § 6.3). Le motif est écrit à l'écran.
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
import { fmtDate } from "@/lib/format";
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
  etatLivraison,
  fluxATraiter,
  grilleDesJours,
  JOURS_DECLENCHEMENTS,
  MOTIF_MTTA,
  PLAFOND_DECLENCHEMENTS,
  PLAFOND_FLUX,
  comptesRegles,
  pistesDeDeclenchements,
  pointsParJour,
  SEVERITES_AFFICHEES,
  titreEvenement,
  totalDeclenchements,
} from "@/lib/alertes-ecran";
import { ackEventAction, createRuleAction, evaluateNowAction } from "./actions";

export const dynamic = "force-dynamic";

const TITRE = "Alertes";
const JOUR_SECONDES = 86_400;

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

  const { admin, plateforme, regles, evenements, nonAcquittees, apps, canaux, parJour, declenchements, releaseDetectee } = ecran;
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
  const fenetreDeRegle = new Map(listeRegles.map((r) => [r.id, r.window_minutes]));
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
                {formater("count", nonAcquittees.data)} non acquittée(s)
              </span>
            )}
          </span>
        }
        domain="fiabilite"
        sub="Qu'est-ce qui s'est déclenché, qui en a été averti, et qu'est-ce qui reste à traiter ?"
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

      {/* ── Zone 2 : résultat de « Évaluer maintenant » (conservé). ── */}
      {fired != null && (
        <div
          data-testid="fired-banner"
          className={`mb-6 rounded-xl border px-4 py-3 text-sm font-medium ${
            fired > 0 ? "border-bad/30 bg-bad/10 text-bad-ink" : "border-good/30 bg-good/10 text-good-ink"
          }`}
        >
          check_alerts() exécutée : {formater("count", fired)} alerte(s) déclenchée(s).
        </div>
      )}
      {urlRefusee && (
        <div
          role="alert"
          data-testid="url-refusee"
          className="mb-6 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm font-medium text-bad-ink"
        >
          URL de webhook non enregistrée — {urlRefusee}
        </div>
      )}

      {/* ── Zone 3 : aucun canal actif — AVANT tout chiffre (conservé, remonté ici).
             Une alerte qui se déclenche sans atteindre personne est un faux
             sentiment de sécurité : le dire sous les chiffres serait le dire trop
             tard. ── */}
      {canaux.ok && canauxActifs === 0 && (
        <div
          data-testid="no-channel-warning"
          className="mb-6 rounded-xl border border-warn/30 bg-warn/10 p-4 text-sm text-warn-ink"
        >
          <strong>Aucun canal de notification actif.</strong> Les alertes de ce périmètre se déclenchent{" "}
          <strong>sans être envoyées à personne</strong> — la supervision voit, elle ne prévient pas.
          {total30j > 0 ? ` ${formater("count", total30j)} déclenchement(s) sur ${JOURS_DECLENCHEMENTS} jours.` : ""}{" "}
          <a href="#canaux" className="font-medium underline underline-offset-2">
            Ajouter un canal
          </a>
        </div>
      )}

      {/* ── Zone 4 : les cinq chiffres clés (A1, A2, A3, A4, A4b). ── */}
      <SectionErreur titre="Chiffres clés des alertes">
        <div className="mb-6 grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-5" data-testid="kpi-alertes">
          <KpiTile
            label="Non acquittées"
            valeur={nonAcquittees.ok ? nonAcquittees.data : null}
            format="count"
            raisonNull="lecture en échec"
            alerte={{ si: ">", valeur: 0, regle: "déclenchement non acquitté" }}
            lecture="tous les déclenchements non acquittés du périmètre, sans plafond"
            href="#a-traiter"
          />
          <KpiTile
            label={`Déclenchées sans que personne soit averti (${JOURS_DECLENCHEMENTS} j)`}
            valeur={nonLivres30j}
            format="count"
            raisonNull="lecture en échec"
            alerte={{ si: ">", valeur: 0, regle: "aucune livraison réussie ni en attente" }}
            lecture="une notification transmise dont le code HTTP n'est pas confirmé ne compte pas ici"
            href="#declenchements"
          />
          <KpiTile
            label="Règles franchies à la dernière évaluation"
            valeur={comptes ? comptes.franchies : null}
            format="count"
            raisonNull="lecture en échec"
            lecture={comptes ? `sur ${formater("count", comptes.actives)} règle(s) active(s)` : undefined}
            href="#regles"
          />
          <KpiTile
            label="Règles sans données"
            valeur={comptes ? comptes.sansDonnees : null}
            format="count"
            raisonNull="lecture en échec"
            lecture={
              comptes
                ? `« données insuffisantes » n'est pas « normale » ; dont ${formater("count", comptes.jamaisEvaluees)} jamais évaluée(s)`
                : undefined
            }
            href="#regles"
          />
          <KpiTile
            label="Canaux actifs"
            valeur={canauxActifs}
            format="count"
            raisonNull="lecture en échec"
            alerte={{ si: "<", valeur: 1, regle: "aucun canal : personne n'est prévenu" }}
            lecture="canaux globaux et canaux de l'app"
            href="#canaux"
          />
        </div>
      </SectionErreur>

      {/* ── Zone 5 : hero, les déclenchements des 30 derniers jours. Barres par jour
             AU-DESSUS de la frise par source, même axe des abscisses. ── */}
      <div className="mb-6">
        <SectionErreur titre={`Déclenchements des ${JOURS_DECLENCHEMENTS} derniers jours`}>
          <Figure
            titre={`Déclenchements des ${JOURS_DECLENCHEMENTS} derniers jours`}
            id="declenchements"
            meta={
              <span>
                {JOURS_DECLENCHEMENTS} jours fixes, jusqu&apos;à maintenant ; la plage de l&apos;écran ne
                s&apos;applique pas
              </span>
            }
            etat={
              !parJour.ok
                ? { kind: "erreur", titre: `Déclenchements des ${JOURS_DECLENCHEMENTS} derniers jours` }
                : total30j === 0 && pistes.length === 0
                  ? { kind: "vide", population: "déclenchement", plage: `${JOURS_DECLENCHEMENTS} jours` }
                  : undefined
            }
            alternative={jours.length > 0 ? alternativeParJour(jours) : undefined}
            lecture={
              <>
                Chaque barre compte les déclenchements d&apos;un jour UTC, empilés par sévérité (des
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
                fuseau="UTC"
                hauteur={80}
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

      {/* ── Zone 6 : le flux « À traiter ». ── */}
      <section id="a-traiter" className="mb-8 min-w-0">
        <h2 className="mb-1 text-base font-bold tracking-tight">À traiter</h2>
        <p className="mb-3 text-xs text-ink-soft" data-testid="motif-mtta">
          Non acquittés d&apos;abord, puis les plus récents. {MOTIF_MTTA}
        </p>
        {!evenements.ok ? (
          <EchecLecture titre="À traiter" />
        ) : (
          <>
            {flux.length >= PLAFOND_FLUX && (
              <div className="mb-3">
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
              <p role="note" data-testid="evt-hors-flux" className="mb-3 text-sm text-ink-soft">
                Événement {evtMisEnEvidence} hors des {formater("count", PLAFOND_FLUX)} plus récents : il n&apos;est
                pas affiché ici.
              </p>
            )}
            <div className="flex min-w-0 flex-col gap-2">
              {flux.map((e) => {
                const source = sourceParEvenement.get(e.id);
                const livraison = etatLivraison(e);
                const cible = cibleMesure(
                  e,
                  e.rule_id != null ? (fenetreDeRegle.get(e.rule_id) ?? null) : null,
                  source?.source === "issue" ? source.source_id : null,
                );
                const enEvidence = evtMisEnEvidence === e.id;
                return (
                  <div
                    key={e.id}
                    id={`evt-${e.id}`}
                    data-testid={`alert-event-${e.id}`}
                    aria-current={enEvidence ? "true" : undefined}
                    className={`min-w-0 rounded-xl border p-3 text-sm shadow-card ${
                      e.acknowledged ? "border-line bg-panel" : "border-bad/30 bg-bad/10"
                    } ${enEvidence ? "ring-2 ring-perf" : ""}`}
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      {!e.acknowledged && (
                        <span className="shrink-0 rounded-full bg-bad-fond px-2 py-0.5 text-xs font-bold text-white">
                          non acquittée
                        </span>
                      )}
                      <span className="shrink-0 font-mono text-xs text-ink-faint">#{e.id}</span>
                      <SeverityBadge severity={e.severity} />
                      <span className="min-w-0 break-words font-medium">{titreEvenement(e, source)}</span>
                      {/* Trois états, pas deux : une notification transmise dont le code
                          HTTP n'est pas encore connu n'est PAS une notification livrée.
                          La confondre avec un succès était le défaut corrigé par v49. */}
                      <span
                        title={livraison.detail}
                        data-testid={`livraison-${e.id}`}
                        className={`ml-auto shrink-0 rounded px-2 py-0.5 text-xs ${
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
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
                      {/* La route était renvoyée par la lecture sans jamais être affichée :
                          « LCP franchi » sans savoir où n'aide personne. */}
                      <span className="min-w-0 break-words">
                        {e.metric ? `${e.metric}` : "métrique inconnue"} · {e.route ?? "toutes routes"} · app {e.app_id}
                      </span>
                      <span className="tabular-nums">
                        {fmtDate(e.fired_at)} (il y a {formater("s-auto", Date.now() - new Date(e.fired_at).getTime())})
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
                        <span className="rounded bg-panel2 px-2 py-0.5 text-ink-faint">acquittée</span>
                      ) : admin ? (
                        <form action={ackEventAction}>
                          <input type="hidden" name="id" value={e.id} />
                          <input type="hidden" name="app" value={e.app_id} />
                          <button type="submit" data-testid={`ack-${e.id}`} className="btn-ghost">
                            Acquitter
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {flux.length === 0 && (
                <CadreEtat ton="neutre" role="status" testId="etat-vide" etat="vide" className="text-center">
                  <p>Aucun déclenchement sur ce périmètre.</p>
                </CadreEtat>
              )}
            </div>
          </>
        )}
      </section>

      {/* ── Zone 7 : les règles, puis leur création. ── */}
      <section id="regles" className="mb-8 min-w-0">
        <h2 className="mb-3 text-base font-bold tracking-tight">Règles</h2>
        {!regles.ok ? (
          <EchecLecture titre="Règles" />
        ) : (
          <div className="flex min-w-0 flex-col gap-3">
            {listeRegles.map((r) => (
              <RuleRow key={r.id} rule={r} apps={apps.ok ? apps.data : []} admin={admin} modeRelease={modeRelease} />
            ))}
            {listeRegles.length === 0 && (
              <p className="py-4 text-center text-sm text-ink-soft">
                {admin
                  ? "Aucune règle — créez la première ci-dessous."
                  : "Aucune règle d'alerte sur ce périmètre. Demandez à un administrateur d'en créer une."}
              </p>
            )}
          </div>
        )}
      </section>

      {admin && (
        <details id="nouvelle-regle" className="card mb-6 min-w-0" open={!listeRegles.length || defaultIssue !== undefined || preRemplissage}>
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink-soft transition hover:text-ink">
            + Nouvelle règle
          </summary>
          {!apps.ok ? (
            <div className="border-t border-line p-4">
              <EchecLecture titre="Liste des applications" compact />
            </div>
          ) : (
            <form action={createRuleAction} className="flex min-w-0 flex-wrap items-end gap-3 border-t border-line p-4">
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

      {/* ── Zone 8 : canaux de notification (conservé). ── */}
      {!canaux.ok ? (
        <div className="mt-10">
          <EchecLecture titre="Canaux de notification" />
        </div>
      ) : (
        <ChannelsSection channels={listeCanaux} apps={apps.ok ? apps.data : []} defaultApp={f.app ?? undefined} admin={admin} global={plateforme} />
      )}
    </div>
  );
}
