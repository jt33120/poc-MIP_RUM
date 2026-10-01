// Section « Escalade » de /alerts (migration-v108) : la politique, étape par étape.
//
// UNE LIGNE PAR ÉTAPE, DÉTAIL AU CLIC (design dense, 30/09/2026). La ligne dit le
// niveau, le délai, la sévérité, le canal visé, la relance et les envois des 30
// derniers jours ; un clic l'ouvre sur la phrase entière (ce qui la déclenche, où
// elle envoie, quand elle relance, le grain du planificateur) et, pour un
// administrateur, la suppression confirmée.
//
// RIEN QUI ATTEIGNE LA BASE. Les server actions arrivent en props (`creer`,
// `supprimer`) depuis la page : importées ici, elles feraient de ce composant une
// entrée de plus du cliquet « console sans base ». Les types des lectures sont
// importés comme types, effacés à la compilation.
//
// LE GRAIN EST LE PASSAGE DU PLANIFICATEUR, écrit en tête de section avec la
// cadence lue : un délai de 5 min ne part pas à 5 min, il part au passage qui suit.
//
// L'AUTEUR D'UNE ÉTAPE est une adresse de compte : montrée à l'administrateur
// seulement, jamais à un lecteur ni à une session de démonstration.
import { Fragment } from "react";
import { ConfirmationDanger } from "@/components/ConfirmationDanger";
import { Field, INPUT_CLASS } from "@/components/forms/Field";
import type { Fil } from "@mip/console-contract";
import { ALERT_SEVERITIES } from "@/lib/alerting";
import { libelleSeverite } from "@/lib/alertes-metriques";
import {
  BORNES_ESCALADE,
  CADENCE_TICK_DEFAUT_MIN,
  dureeMinutes,
  etapesParPortee,
  grainDuTick,
  relanceDeLEtape,
} from "@/lib/escalade-ecran";
import { entreGuillemets, fmtInstant, pluriel } from "@/lib/format";
import type { EtapeEscaladeRow } from "@/lib/queries-escalade";
import { SeverityBadge } from "./SeverityBadge";

type Etape = Fil<EtapeEscaladeRow>;

interface CanalChoisissable {
  id: number;
  app_id: string | null;
  kind: string;
  target: string;
  active: boolean;
}

const LIBELLE_KIND: Record<string, string> = { email: "e-mail", webhook: "webhook", slack: "Slack" };
const kind = (k: string) => LIBELLE_KIND[k] ?? k;

export function EscaladeSection({
  disponible,
  etapes,
  canaux,
  apps,
  defaultApp,
  admin = false,
  global = admin,
  cadenceMin,
  refus = null,
  creer,
  supprimer,
}: {
  /** La base a-t-elle les étapes (migration-v108) ? */
  disponible: boolean;
  etapes: Etape[];
  canaux: CanalChoisissable[];
  apps: { app_id: string; name: string }[];
  defaultApp?: string;
  /** V9 : sans droit d'écriture, ni formulaire ni bouton dans le DOM. */
  admin?: boolean;
  /** Une étape GLOBALE (toutes les applications) : l'administrateur de la plateforme seul. */
  global?: boolean;
  /** Cadence publiée du planificateur, en minutes ; `null` : non publiée. */
  cadenceMin: number | null;
  /** Le motif d'une création refusée (relu par la page d'un code, jamais affiché brut). */
  refus?: string | null;
  creer: (fd: FormData) => Promise<void>;
  supprimer: (fd: FormData) => Promise<void>;
}) {
  const groupes = etapesParPortee(etapes);
  const canauxActifs = canaux.filter((c) => c.active);
  const niveauSuivant = Math.min(BORNES_ESCALADE.niveau.max, Math.max(0, ...etapes.map((e) => e.level)) + 1);

  return (
    <section className="mt-6 min-w-0 scroll-mt-20" id="escalade" aria-labelledby="escalade-titre" data-testid="escalade">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="escalade-titre" className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
          Escalade
        </h2>
        {disponible && (
          <span className="text-[11px] tabular-nums text-ink-faint" data-testid="escalade-grain">
            {etapes.length > 0 ? `${pluriel(etapes.length, "étape")} · ` : ""}
            {grainDuTick(cadenceMin)} · s&apos;arrête à l&apos;acquittement
          </span>
        )}
      </div>
      <p className="sr-only">
        Si un incident reste non acquitté, chaque étape l&apos;envoie de nouveau, à son délai compté depuis son premier
        déclenchement, vers son canal : un niveau de plus à chaque étape. Un incident, ce sont les déclenchements ouverts
        d&apos;une même règle, d&apos;un même objectif de service ou d&apos;une même issue ; en acquitter un les acquitte
        tous. Le dernier niveau peut relancer à intervalle fixe, un nombre limité de fois. L&apos;envoi immédiat aux
        canaux reste celui du routage ; l&apos;escalade s&apos;y ajoute. Seuls les déclenchements d&apos;une règle,
        d&apos;un objectif de service ou d&apos;une issue s&apos;escaladent : ce sont ceux qu&apos;on peut acquitter.
      </p>
      {refus && (
        <p
          role="alert"
          className="mb-2 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs font-medium text-bad-ink"
          data-testid="escalade-refus"
        >
          Étape non créée — {refus}
        </p>
      )}

      {!disponible ? (
        <p className="card flex items-center gap-1.5 px-3 py-2 text-xs text-ink-soft" role="status" data-testid="escalade-indisponible">
          <span aria-hidden className="text-ink-faint">
            ⊘
          </span>
          Escalade indisponible : la base n&apos;enregistre pas encore les étapes.
        </p>
      ) : (
        <>
          {etapes.length > 0 && (
            <div className="card min-w-0 divide-y divide-line/60" data-testid="escalade-etapes">
              {groupes.map((g) => (
                <Fragment key={g.app ?? "*"}>
                  <div className="bg-panel2/60 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                    {g.app === null ? "Toutes les applications" : `Application ${g.app}`}
                  </div>
                  {g.etapes.map((e) => (
                    <LigneEtape key={e.id} etape={e} etapes={etapes} admin={admin} cadenceMin={cadenceMin} supprimer={supprimer} />
                  ))}
                </Fragment>
              ))}
            </div>
          )}

          {etapes.length === 0 && !admin && (
            <p className="card flex items-center gap-1.5 px-3 py-2 text-xs text-ink-soft" role="status" data-testid="escalade-vide">
              <span aria-hidden className="text-ink-faint">
                ⊘
              </span>
              Aucune étape d&apos;escalade : un déclenchement non acquitté ne monte d&apos;aucun niveau. Demandez à un
              administrateur d&apos;en créer une.
            </p>
          )}

          {admin && (
            <details className={`card min-w-0 ${etapes.length > 0 ? "mt-2" : ""}`} id="nouvelle-etape" open={refus ? true : undefined}>
              <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-ink-soft transition hover:text-ink">
                {etapes.length === 0 ? (
                  <span className="inline-flex flex-wrap items-center gap-x-2" data-testid="escalade-vide">
                    <span aria-hidden className="text-ink-faint">
                      ⊘
                    </span>
                    <span className="font-normal">Aucune étape : un déclenchement non acquitté ne monte d&apos;aucun niveau.</span>
                    <span className="text-brand">+ Créer une étape</span>
                  </span>
                ) : (
                  "+ Nouvelle étape"
                )}
              </summary>
              {canauxActifs.length === 0 ? (
                <p className="flex flex-wrap items-center gap-x-2 border-t border-line px-3 py-2 text-xs text-ink-soft" role="status">
                  Une étape envoie vers un canal actif : aucun n&apos;existe.
                  <a href="#canaux" className="font-medium text-perf underline-offset-2 hover:underline">
                    Ajouter un canal
                  </a>
                </p>
              ) : (
                <form action={creer} className="flex min-w-0 flex-wrap items-end gap-3 border-t border-line p-3" data-testid="form-etape">
                  <Field label="App">
                    <select name="app_id" defaultValue={defaultApp ?? (global ? "" : apps[0]?.app_id)} className={INPUT_CLASS}>
                      {global && <option value="">toutes les applications</option>}
                      {apps.map((a) => (
                        <option key={a.app_id} value={a.app_id}>
                          {a.app_id}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Sévérité minimale">
                    <select name="severity_min" defaultValue="warning" className={INPUT_CLASS}>
                      {ALERT_SEVERITIES.map((s) => (
                        <option key={s} value={s}>
                          {libelleSeverite(s)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Niveau">
                    <input
                      name="level"
                      type="number"
                      required
                      min={BORNES_ESCALADE.niveau.min}
                      max={BORNES_ESCALADE.niveau.max}
                      defaultValue={niveauSuivant}
                      className={`${INPUT_CLASS} w-16`}
                    />
                  </Field>
                  <Field label="Après (min, non acquittée)">
                    <input
                      name="delay_minutes"
                      type="number"
                      required
                      min={BORNES_ESCALADE.delai.min}
                      max={BORNES_ESCALADE.delai.max}
                      defaultValue={cadenceMin ?? 15}
                      className={`${INPUT_CLASS} w-24`}
                    />
                  </Field>
                  <Field label="Canal (de l'app ou global)">
                    <select name="channel_id" required className={`${INPUT_CLASS} max-w-[18rem]`} defaultValue={String(canauxActifs[0].id)}>
                      {canauxActifs.map((c) => (
                        <option key={c.id} value={c.id}>
                          #{c.id} {kind(c.kind)} · {c.app_id ?? "global"} · {c.target}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Relance toutes les (min)">
                    <input
                      name="repeat_minutes"
                      type="number"
                      min={BORNES_ESCALADE.relance.min}
                      max={BORNES_ESCALADE.relance.max}
                      placeholder="aucune"
                      className={`${INPUT_CLASS} w-24`}
                    />
                  </Field>
                  <Field label="Au plus (fois)">
                    <input
                      name="repeat_max"
                      type="number"
                      min={BORNES_ESCALADE.plafond.min}
                      max={BORNES_ESCALADE.plafond.max}
                      placeholder="—"
                      className={`${INPUT_CLASS} w-20`}
                    />
                  </Field>
                  <button type="submit" data-testid="create-etape" className="btn-accent">
                    Créer
                  </button>
                  <p className="w-full text-[11px] text-ink-faint">
                    Délais comptés depuis le premier déclenchement de l&apos;incident ; la relance ne joue que sur le dernier
                    niveau qui s&apos;applique ; une étape vaut pour les incidents ouverts après sa création. Le canal doit
                    être global ou de l&apos;application choisie ; sa sévérité minimale ne filtre pas l&apos;escalade. Une
                    règle désactivée garde ses déclenchements ouverts : ils s&apos;escaladent jusqu&apos;à leur acquittement.
                  </p>
                </form>
              )}
            </details>
          )}
        </>
      )}
    </section>
  );
}

function LigneEtape({
  etape: e,
  etapes,
  admin,
  cadenceMin,
  supprimer,
}: {
  etape: Etape;
  etapes: Etape[];
  admin: boolean;
  cadenceMin: number | null;
  supprimer: (fd: FormData) => Promise<void>;
}) {
  // Cadence non publiée : celle de la production, comme `grainDuTick`.
  const relance = relanceDeLEtape(e, etapes, cadenceMin ?? CADENCE_TICK_DEFAUT_MIN);
  const portee = e.app_id === null ? "de toute application" : `de l'application ${e.app_id}`;
  return (
    <details className="group min-w-0" data-testid={`etape-${e.id}`}>
      <summary className="flex min-w-0 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs hover:bg-panel2/40 [&::-webkit-details-marker]:hidden">
        <span className="rounded bg-panel2 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink" title={`Niveau ${e.level}`}>
          N{e.level}
        </span>
        <span className="tabular-nums text-ink">après {dureeMinutes(e.delay_minutes)}</span>
        <span className="inline-flex items-center gap-1 text-ink-faint">
          ≥ <SeverityBadge severity={e.severity_min} />
        </span>
        <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
          <span className="text-ink-faint">→</span>
          <span className="rounded bg-panel2 px-1.5 py-0.5 text-[11px] font-medium text-ink-soft">{kind(e.canal_kind)}</span>
          <span className="min-w-0 truncate font-mono text-[12px] text-ink sm:max-w-[22rem]" title={e.canal_target}>
            {e.canal_target}
          </span>
        </span>
        {!e.canal_actif && (
          <span className="rounded border border-warn/30 bg-warn/10 px-1.5 py-0.5 text-[11px] text-warn-ink" title="Un canal désactivé ne reçoit rien">
            canal désactivé
          </span>
        )}
        {relance.etat !== "aucune" && (
          <span className={`text-[11px] ${relance.etat === "inactive" ? "text-ink-faint" : "text-ink-soft"}`} title={relance.texte}>
            <span className={relance.etat === "inactive" ? "line-through" : undefined}>
              relance {dureeMinutes(e.repeat_minutes ?? 0)} × {e.repeat_max}
            </span>
            {/* L'état en mots, pas seulement barré : un lecteur d'écran ne lit ni le trait ni le title. */}
            {relance.etat === "inactive" && " · muette"}
            {relance.etat === "partielle" && " · partielle"}
          </span>
        )}
        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-ink-faint" title={
            e.app_id === null
              ? "Envois mis en file par cette étape sur 30 jours, relances comprises, pour les applications du périmètre lu"
              : "Envois mis en file par cette étape sur 30 jours, relances comprises"
          }
        >
          {pluriel(e.envois_30j, "envoi")} · 30 j
        </span>
      </summary>
      <div className="flex min-w-0 flex-wrap items-start gap-x-6 gap-y-2 border-t border-line/60 bg-panel2/30 px-3 py-2 text-xs text-ink-soft">
        <dl className="grid w-full min-w-0 grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 sm:w-auto sm:flex-1">
          <dt className="text-ink-faint">Déclenche</dt>
          <dd className="min-w-0">
            un incident {portee}, de sévérité {libelleSeverite(e.severity_min).toLowerCase()} ou plus, encore non acquitté{" "}
            {dureeMinutes(e.delay_minutes)} après son premier déclenchement
          </dd>
          <dt className="text-ink-faint">Envoie</dt>
          <dd className="min-w-0 break-all font-mono text-[11px]">
            {kind(e.canal_kind)} {e.canal_target}
            {e.canal_actif ? "" : " — désactivé : rien ne part"}
          </dd>
          <dt className="text-ink-faint">Relance</dt>
          <dd className="min-w-0">{relance.texte}</dd>
          <dt className="text-ink-faint">Grain</dt>
          <dd className="min-w-0">{grainDuTick(cadenceMin)}</dd>
          <dt className="text-ink-faint">Créée</dt>
          <dd className="min-w-0">
            le {fmtInstant(e.created_at)}
            {admin && e.created_by ? ` par ${e.created_by}` : ""} · vaut pour les incidents ouverts depuis
          </dd>
        </dl>
        {admin && (
          <form action={supprimer} className="shrink-0">
            <input type="hidden" name="id" value={e.id} />
            <ConfirmationDanger
              libelle="Supprimer"
              libelleAccessible={`Supprimer l'étape de niveau ${e.level} vers ${e.canal_target}`}
              question={`Supprimer l'étape de niveau ${e.level} vers ${entreGuillemets(e.canal_target)} ?`}
              consequence="Les incidents non acquittés ne seront plus envoyés à ce niveau ; les envois déjà partis restent dans l'historique."
              confirmer="Supprimer l'étape"
              enCours="Suppression…"
              flottant
              classeDeclencheur="rounded-lg border border-bad/40 bg-panel px-2.5 py-1 text-xs font-medium text-bad-ink transition hover:bg-bad/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bad/40"
              testid={`delete-etape-${e.id}`}
            />
          </form>
        )}
      </div>
    </details>
  );
}
