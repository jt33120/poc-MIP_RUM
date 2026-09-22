import { headers } from "next/headers";
import { PageHeader } from "@/components/PageHeader";
import { EchecLecture } from "@/components/states/SectionErreur";
import { requireAdmin } from "@/lib/auth";
import { dogfoodingEndpoint, ingestEndpoint } from "@/lib/ingest-endpoint";
import { lire } from "@/lib/lecture";
import type { HealthSnapshot } from "@/lib/metrics-format";
import { internalHealth } from "@/lib/queries-health";
import { causalActionsHealth, identityPersistenceHealth } from "@/lib/health";

export const dynamic = "force-dynamic";

/** Santé interne de MIP RUM (auto-observabilité, P1) — admin. Mêmes chiffres que /api/metrics. */
export default async function Health() {
  await requireAdmin();
  // Lecture en échec : les tuiles ne sont PAS rendues à zéro (F02) — un tableau
  // de bord « 0 alerte, 0 lot en attente » pendant une panne serait le pire des
  // mensonges sur une page de santé. Le bloc d'endpoint, lui, ne lit rien en base.
  const sante = await lire(internalHealth);
  const [identity, causal] = await Promise.all([
    identityPersistenceHealth(),
    causalActionsHealth(),
  ]);

  // Où le capteur de la console POSTE réellement, résolu comme il l'est pour le
  // navigateur. Affiché parce que sa panne est SILENCIEUSE : NEXT_PUBLIC_RUM_ENDPOINT
  // prime sur l'hôte courant, donc une valeur périmée fait émettre dans le vide sans
  // la moindre erreur — c'est déjà arrivé douze jours durant vers un projet Supabase
  // décommissionné (invariant AD-4). Un endpoint qui ne pointe pas l'hôte de la page
  // est signalé ici, au lieu de se lire dans un tableau vide des semaines plus tard.
  const hote = (await headers()).get("host");
  const endpoint = dogfoodingEndpoint(hote);          // la console -> elle-même
  const snippet = ingestEndpoint("traces", hote);     // ce qu'on remet aux CLIENTS
  const force = Boolean(process.env.NEXT_PUBLIC_RUM_ENDPOINT);
  const memeHote = (() => {
    try {
      return new URL(snippet).host === hote;
    } catch {
      return false;
    }
  })();


  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Santé interne"
        sub={
          <>
            Auto-observabilité de MIP RUM — ingestion, alertes, métering. Mêmes indicateurs exposés au
            format Prometheus sur <code>/api/metrics</code> (token requis).
          </>
        }
      />

      {identity.label === "degraded" && (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200" data-testid="identity-health-degraded">
          <strong>Identité métier dégradée.</strong>{" "}
          {!identity.configured && <><code>IDENTITY_HASH_SECRET</code> est absent. </>}
          {!identity.schema && <>La migration v66 n&apos;est pas détectée. </>}
          Les identifiants user/account sont omis si nécessaire, tandis que la télémétrie existante continue.
        </div>
      )}

      {causal.label === "degraded" && (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200" data-testid="causal-actions-health-degraded">
          <strong>Actions causales dégradées.</strong> La migration v67 n&apos;est pas détectée :
          l&apos;ingestion P2 continue sans interruption, mais les liens et le classement Top Actions restent indisponibles.
        </div>
      )}

      <h2 className="mb-2 text-sm font-semibold text-ink">Où la console s&apos;envoie</h2>
      <div
        className={`card mb-6 px-4 py-3 ${memeHote ? "" : "border-warn/50 bg-warn/5"}`}
        data-testid="dogfooding-endpoint"
      >
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          Capteur de la console (dogfooding)
        </div>
        <code className="mt-1 block break-all font-mono text-[13px] text-ink">{endpoint}</code>
        <div className="mt-1 text-xs text-ink-soft">
          Toujours l&apos;hôte de cette page — aucune variable ne peut le détourner.
        </div>

        <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          Endpoint remis aux clients (snippet d&apos;intégration)
        </div>
        <code className="mt-1 block break-all font-mono text-[13px] text-ink">{snippet}</code>
        <div className={`mt-1 text-xs ${memeHote ? "text-ink-soft" : "text-warn"}`}>
          {memeHote
            ? force
              ? "Forcé par NEXT_PUBLIC_RUM_ENDPOINT, et pointe bien cet hôte."
              : "Résolu depuis l'hôte de la requête — aucune configuration à maintenir."
            : "NEXT_PUBLIC_RUM_ENDPOINT pointe un AUTRE hôte que celui-ci. Chaque snippet copié depuis la console envoie donc la télémétrie du client là-bas, sans erreur visible ni côté client ni ici. Retirez la variable pour revenir à l'hôte courant."}
        </div>
      </div>

      {sante.ok ? <StatsSante h={sante.data} /> : <EchecLecture titre="Santé interne" />}
    </div>
  );
}

/** Les tuiles de l'instantané de santé — rendues seulement sur une lecture réussie. */
function StatsSante({ h }: { h: HealthSnapshot }) {
  const lag = h.metering_lag_hours;
  const lagTone = lag == null ? "" : lag > 30 ? "text-red-600 dark:text-red-400" : lag > 26 ? "text-amber-600 dark:text-amber-400" : "";
  return (
    <>
      <h2 className="mb-2 text-sm font-semibold text-ink">Ingestion (5 min glissantes)</h2>
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Events (vitals)" value={h.ingest_metrics_5m} />
        <Stat label="Pages vues" value={h.ingest_pageviews_5m} />
        <Stat label="Erreurs" value={h.ingest_errors_5m} />
        <Stat label="Sessions" value={h.ingest_sessions_5m} />
      </div>

      <h2 className="mb-2 text-sm font-semibold text-ink">Alertes & livraison</h2>
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Alertes non acquittées" value={h.alerts_unacked} tone={h.alerts_unacked > 0 ? "text-amber-600 dark:text-amber-400" : ""} />
        <Stat label="Livraisons en file" value={h.deliveries_queued} />
        <Stat label="Livraisons échouées" value={h.deliveries_failed} tone={h.deliveries_failed > 0 ? "text-amber-600 dark:text-amber-400" : ""} />
        <Stat label="Livraisons abandonnées" value={h.deliveries_dead} tone={h.deliveries_dead > 0 ? "text-red-600 dark:text-red-400" : ""} />
      </div>

      <h2 className="mb-2 text-sm font-semibold text-ink">File de débarquement</h2>
      <p className="mb-2 text-xs text-ink-faint">
        Active seulement si <code>INGEST_DEFERRED</code> est allumé. La table est <strong>UNLOGGED</strong> :
        ce qui attend ici est exactement ce qu&apos;un redémarrage brutal de PostgreSQL perdrait. Une
        file qui monte veut dire que le travailleur ne suit pas ; des lots abandonnés veulent dire
        qu&apos;une écriture échoue en boucle, et ceux-là ne seront plus repris.
      </p>
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Lots en attente" value={h.ingest_backlog} tone={h.ingest_backlog > 1000 ? "text-amber-600 dark:text-amber-400" : ""} />
        <Stat label="Lots abandonnés" value={h.ingest_backlog_blocked} tone={h.ingest_backlog_blocked > 0 ? "text-red-600 dark:text-red-400" : ""} />
        <div className="card px-4 py-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-faint">Plus vieux lot</div>
          <div className="mt-0.5 text-2xl font-bold tabular-nums">
            {h.ingest_backlog === 0 ? "—" : `${h.ingest_backlog_age_s.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`}
          </div>
        </div>
      </div>

      <h2 className="mb-2 text-sm font-semibold text-ink">Cardinalité des routes</h2>
      <p className="mb-2 text-xs text-ink-faint">
        Au-delà du plafond d&apos;une application, ses routes inédites sont regroupées sous{" "}
        <code>(other)</code>. Rien n&apos;est perdu côté volumes ; c&apos;est le DÉTAIL par route qui
        s&apos;arrête. Une application au plafond doit recevoir des règles de normalisation
        (<code>route_pattern</code>), pas un plafond plus haut.
      </p>
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          label="Apps au plafond"
          value={h.apps_route_capped}
          tone={h.apps_route_capped > 0 ? "text-amber-600 dark:text-amber-400" : ""}
        />
        <Stat label="Routes distinctes (max)" value={h.routes_max} />
      </div>

      <h2 className="mb-2 text-sm font-semibold text-ink">Tenants & métering</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Apps actives" value={h.apps_active} />
        <div className="card px-4 py-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-faint">Retard métering</div>
          <div className={`mt-0.5 text-2xl font-bold tabular-nums ${lagTone}`}>
            {lag == null ? "—" : `${lag.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} h`}
          </div>
          <div className="mt-0.5 text-[11px] text-ink-faint">dernier meter_tenant_usage</div>
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, tone = "" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</div>
      <div className={`mt-0.5 text-2xl font-bold tabular-nums ${tone || "text-ink"}`}>
        {value.toLocaleString("fr-FR")}
      </div>
    </div>
  );
}
