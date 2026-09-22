import { PageHeader } from "@/components/PageHeader";
import { SupervisionHero, HeroStat, HeroReading } from "@/components/SupervisionHero";
import { StackedBars, type StackSeries } from "@/components/charts/StackedBars";
import { fmtDate } from "@/lib/format";
import { FilterProblemNotice, FiltersNotAppliedNote } from "@/components/FilterProblemNotice";
import type { SearchParams } from "@/lib/filters";
import { pageFilters } from "@/lib/page-filters";
import { queryToSearchParams } from "@/lib/query-contract";
import { alertEvents, alertRules, isAlertMetric, unackedAlertCount } from "@/lib/queries-v2";
import { registeredApps } from "@/lib/queries";
import { listChannels } from "@/lib/queries-alerting";
import { SeverityBadge } from "@/components/alerts/SeverityBadge";
import { RuleFields } from "@/components/alerts/RuleFields";
import { RuleRow } from "@/components/alerts/RuleRow";
import { ChannelsSection } from "@/components/alerts/ChannelsSection";
import {
  ackEventAction,
  createRuleAction,
  evaluateNowAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function Alerts({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = (await searchParams) ?? {};
  const ecran = await pageFilters(sp, "/alerts");
  if (!ecran.ok) return <FilterProblemNotice title="Alertes" problem={ecran.problem} />;
  const f = ecran.filters;
  const [rules, events, unacked, apps, channels] = await Promise.all([
    alertRules(f),
    alertEvents(f),
    unackedAlertCount(f),
    registeredApps(),
    listChannels(f),
  ]);
  const firedRaw = Array.isArray(sp.fired) ? sp.fired[0] : sp.fired;
  const fired = firedRaw != null && /^\d+$/.test(firedRaw) ? Number(firedRaw) : null;
  // « Créer une alerte de pic » depuis une issue : `?issue=<uuid>` préremplit le formulaire.
  const issueRaw = Array.isArray(sp.issue) ? sp.issue[0] : sp.issue;
  const defaultIssue = issueRaw && isAlertMetric(`issue:${issueRaw}`) ? issueRaw : undefined;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            Alertes
            {unacked > 0 && (
              <span
                data-testid="unacked-badge"
                className="rounded-full bg-bad-fond px-2.5 py-0.5 text-xs font-bold text-white"
              >
                {unacked} non acquittée(s)
              </span>
            )}
          </span>
        }
        sub={
          <>
            Se déclenchent quand un vital (p75), un taux d&apos;erreur, le compte d&apos;un événement custom ou
            les occurrences d&apos;une issue franchit son seuil ou sa baseline — évaluation automatique côté
            base, notification par webhook
          </>
        }
      >
        <form action={evaluateNowAction}>
          <input type="hidden" name="qs" value={`?${queryToSearchParams(ecran.query)}`} />
          <button type="submit" data-testid="evaluate-now" className="btn-accent">
            Évaluer maintenant
          </button>
        </form>
      </PageHeader>
      <FiltersNotAppliedNote note={ecran.notApplied} />

      {fired != null && (
        <div
          data-testid="fired-banner"
          className={`mb-6 rounded-xl border px-4 py-3 text-sm font-medium ${
            fired > 0
              ? "border-bad/30 bg-bad/10 text-bad-ink"
              : "border-good/30 bg-good/10 text-good-ink"
          }`}
        >
          check_alerts() exécutée : {fired} alerte(s) déclenchée(s).
        </div>
      )}

      {events.length > 0 && (() => {
        // Hero : rafales d'alertes dans le temps, empilées par sévérité.
        const SEV_COLOR: Record<string, string> = {
          critical: "#dc2626",
          page: "#dc2626",
          error: "#dc2626",
          warning: "#d97706",
          warn: "#d97706",
          info: "#2563eb",
        };
        const sevs = [...new Set(events.map((e) => e.severity))];
        const byDay = new Map<string, Record<string, number | string>>();
        const order: string[] = [];
        for (const e of [...events].reverse()) {
          const key = new Date(e.fired_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
          if (!byDay.has(key)) {
            const row: Record<string, number | string> = { d: key };
            for (const s of sevs) row[s] = 0;
            byDay.set(key, row);
            order.push(key);
          }
          const row = byDay.get(key)!;
          row[e.severity] = (Number(row[e.severity]) || 0) + 1;
        }
        const data = order.map((k) => byDay.get(k)!);
        const series: StackSeries[] = sevs.map((s) => ({ key: s, name: s, color: SEV_COLOR[s] ?? "#94a3b8" }));
        const critical = events.filter((e) => ["critical", "page", "error"].includes(e.severity)).length;
        return (
          <SupervisionHero
            chartTitle="Événements d'alerte dans le temps — par sévérité"
            chart={<StackedBars data={data} xKey="d" series={series} />}
          >
            <HeroStat label="Événements" value={events.length.toLocaleString("fr-FR")} hint="100 plus récents" />
            <HeroStat
              label="Non acquittées"
              value={unacked.toLocaleString("fr-FR")}
              tone={unacked > 0 ? "poor" : "good"}
            />
            <HeroStat
              label="Critiques"
              value={critical.toLocaleString("fr-FR")}
              tone={critical > 0 ? "warn" : "good"}
            />
            <HeroReading>
              Chaque colonne = un jour, empilée par sévérité (rouge = critique). Une colonne haute = une rafale
              d&apos;alertes à investiguer — souvent le symptôme d&apos;un incident. Les règles et le flux
              détaillé sont ci-dessous.
            </HeroReading>
          </SupervisionHero>
        );
      })()}

      {/* ----- Création ----- */}
      <details className="card mb-6" open={!rules.length || defaultIssue !== undefined}>
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink-soft transition hover:text-ink">
          + Nouvelle règle
        </summary>
        <form action={createRuleAction} className="flex flex-wrap items-end gap-3 border-t border-line p-4">
          <RuleFields apps={apps} defaultApp={f.app ?? undefined} defaultIssue={defaultIssue} />
          <button type="submit" data-testid="create-rule" className="btn-accent">
            Créer
          </button>
        </form>
      </details>

      {/* ----- Règles ----- */}
      <div className="mb-8 flex flex-col gap-3">
        {rules.map((r) => (
          <RuleRow key={r.id} rule={r} apps={apps} />
        ))}
        {!rules.length && (
          <p className="py-4 text-center text-sm text-ink-faint">
            Aucune règle — crée la première ci-dessus.
          </p>
        )}
      </div>

      {/* ----- Flux d'événements ----- */}
      <h2 className="mb-3 text-base font-bold tracking-tight">Événements déclenchés</h2>
      {/* Une alerte qui se déclenche sans atteindre personne est un faux sentiment
          de sécurité. Tant qu'aucun canal actif n'existe, on le dit ici — au-dessus
          du flux — et pas seulement dans la section « Canaux » plus bas. */}
      {!channels.some((c) => c.active) && events.length > 0 && (
        <div
          data-testid="no-channel-warning"
          className="mb-4 rounded-xl border border-warn/30 bg-warn/10 p-4 text-sm text-warn-ink"
        >
          <strong>Aucun canal de notification actif.</strong> Ces {events.length} alertes se sont
          déclenchées <strong>sans être envoyées à personne</strong> — la supervision voit, elle ne
          prévient pas. Ajoute un canal webhook ou Slack dans la section ci-dessous pour fermer la
          boucle.
        </div>
      )}
      <div className="flex flex-col gap-2">
        {events.map((e) => (
          <div
            key={e.id}
            data-testid={`alert-event-${e.id}`}
            className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm shadow-card ${
              e.acknowledged
                ? "border-line bg-panel"
                : "border-bad/30 bg-bad/10"
            }`}
          >
            {!e.acknowledged && (
              <span className="rounded-full bg-bad-fond px-2 py-0.5 text-xs font-bold text-white">
                non acquittée
              </span>
            )}
            <span className="font-mono text-xs text-ink-faint">#{e.id}</span>
            <SeverityBadge severity={e.severity} />
            <span className="font-medium">
              {e.message ?? `${e.metric} (${e.rule_id != null ? `règle ${e.rule_id}` : "SLO"})`}
            </span>
            {/* Trois états, pas deux : une notification transmise dont le code HTTP
                n'est pas encore connu n'est PAS une notification livrée. La
                confondre avec un succès était le défaut corrigé par v49. */}
            <span
              title={
                e.delivered > 0
                  ? `${e.delivered} notification(s) livrée(s) — code 2xx confirmé`
                  : e.pending > 0
                    ? `${e.pending} notification(s) transmise(s), résultat pas encore confirmé`
                    : "Aucune notification n'est partie pour cette alerte"
              }
              className={`ml-auto rounded px-2 py-0.5 text-xs ${
                e.delivered > 0
                  ? "bg-panel2 text-ink-faint"
                  : e.pending > 0
                    ? "border border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-300"
                    : "border border-warn/30 bg-warn/10 text-warn-ink"
              }`}
            >
              {e.delivered > 0
                ? `livrée ×${e.delivered}`
                : e.pending > 0
                  ? `en attente ×${e.pending}`
                  : "non livrée"}
            </span>
            <span className="text-xs tabular-nums text-ink-soft">{fmtDate(e.fired_at)}</span>
            {e.acknowledged ? (
              <span className="rounded bg-panel2 px-2 py-0.5 text-xs text-ink-faint">acquittée</span>
            ) : (
              <form action={ackEventAction}>
                <input type="hidden" name="id" value={e.id} />
                <button type="submit" data-testid={`ack-${e.id}`} className="btn-ghost">
                  Acquitter
                </button>
              </form>
            )}
          </div>
        ))}
        {!events.length && (
          <p className="py-4 text-center text-sm text-ink-faint">
            Aucun événement — crée une règle puis « Évaluer maintenant ».
          </p>
        )}
      </div>

      {/* ----- Canaux de notification ----- */}
      <ChannelsSection channels={channels} apps={apps} defaultApp={f.app ?? undefined} />
    </div>
  );
}
