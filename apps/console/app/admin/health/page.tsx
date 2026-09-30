import Link from "next/link";
import { headers } from "next/headers";
import { Fragment } from "react";
import { ECRANS_ADMIN } from "@mip/console-contract";
import { PageHeader } from "@/components/PageHeader";
import { SanteChaine } from "@/components/SanteChaine";
import { EchecLecture } from "@/components/states/SectionErreur";
import { chargerSante } from "@/lib/chargeurs/administration";
import { accesAdmin, chargerEcran } from "@/lib/ecran";
import { verdictSante, FILE_ATTENTION, RETARD_CONSO_ATTENTION_H, RETARD_CONSO_INCIDENT_H, type VerdictSante } from "@/lib/health-verdict";
import { dogfoodingEndpoint, ingestEndpoint, origineCollecteurDogfooding } from "@/lib/ingest-endpoint";
import type { HealthSnapshot } from "@/lib/metrics-format";

export const dynamic = "force-dynamic";

/** Santé interne de MIP RUM (auto-observabilité, P1) — admin. Mêmes chiffres que /api/metrics. */
export default async function Health() {
  // Le chargeur (`lib/chargeurs/administration.ts`) : l'administrateur de la
  // plateforme seul (C9). Lecture en échec : les tuiles ne sont PAS rendues à zéro
  // (F02) — un tableau de bord « 0 alerte, 0 lot en attente » pendant une panne
  // serait le pire des mensonges sur une page de santé. Le bloc d'adresse, lui,
  // ne lit rien en base.
  const { sante, identite: identity, causales: causal, chaine } = accesAdmin(await chargerEcran(ECRANS_ADMIN.sante, chargerSante, {}));

  // Où le capteur de la console POSTE réellement, résolu comme il l'est pour le
  // navigateur. Affiché parce que sa panne est SILENCIEUSE : NEXT_PUBLIC_RUM_ENDPOINT
  // prime sur l'hôte courant, donc une valeur périmée fait émettre dans le vide sans
  // la moindre erreur — c'est déjà arrivé douze jours durant vers un projet Supabase
  // décommissionné (invariant AD-4). Un endpoint qui ne pointe pas l'hôte de la page
  // est signalé ici, au lieu de se lire dans un tableau vide des semaines plus tard.
  const hote = (await headers()).get("host");
  const endpoint = dogfoodingEndpoint(hote);          // la console -> elle-même
  const direct = origineCollecteurDogfooding(hote) !== null; // ou au collector, en direct (P6b.G)
  const snippet = ingestEndpoint("traces", hote);     // ce qu'on remet aux CLIENTS
  const force = Boolean(process.env.NEXT_PUBLIC_RUM_ENDPOINT);
  const memeHote = (() => {
    try {
      return new URL(snippet).host === hote;
    } catch {
      return false;
    }
  })();
  const verdict = sante.ok
    ? verdictSante(sante.data, {
        identiteDegradee: identity.label === "degraded",
        causalesDegradees: causal.label === "degraded",
        collecteAilleurs: !memeHote,
      })
    : null;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Santé interne"
        sub={
          <>
            L&apos;état de MIP RUM lui-même : collecte, notifications d&apos;alerte, consommation. Les mêmes
            indicateurs sont publiés pour Prometheus à l&apos;adresse <code className="chip-mono">/api/metrics</code>{" "}
            (jeton requis).
          </>
        }
      />

      {verdict ? <Verdict verdict={verdict} /> : <EchecLecture titre="Santé interne" />}

      {(identity.label === "degraded" || causal.label === "degraded") && (
        <div id="degradations" className="mb-6 grid gap-3">
          {identity.label === "degraded" && (
            <div className="rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn-ink" data-testid="identity-health-degraded">
              <strong>Identité métier dégradée.</strong>{" "}
              {!identity.configured && <>La clé de pseudonymisation des identifiants n&apos;est pas configurée. </>}
              {!identity.schema && <>La base n&apos;est pas à jour pour l&apos;identité métier. </>}
              Les identifiants utilisateur et compte sont omis quand il le faut ; le reste de la collecte continue.
              <DetailTechnique>
                {!identity.configured && <>Variable absente : <code>IDENTITY_HASH_SECRET</code>. </>}
                {!identity.schema && <>Migration v66 non détectée.</>}
              </DetailTechnique>
            </div>
          )}
          {causal.label === "degraded" && (
            <div className="rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn-ink" data-testid="causal-actions-health-degraded">
              <strong>Actions causales indisponibles.</strong> La base n&apos;est pas à jour pour elles : la collecte
              continue sans interruption, mais les liens entre actions et le classement des actions restent vides.
              <DetailTechnique>Migration v67 non détectée.</DetailTechnique>
            </div>
          )}
        </div>
      )}

      {/* La preuve que la mesure passe, étage par étage (canari du scheduler, A3 § 2.6). */}
      <h2 id="chaine" className="mb-2 scroll-mt-20 text-sm font-semibold text-ink">
        Santé de la chaîne de mesure
      </h2>
      {chaine?.ok ? (
        <SanteChaine brute={chaine.data.brute} cadenceMin={chaine.data.cadenceMin} maintenant={Date.now()} />
      ) : (
        <EchecLecture titre="Santé de la chaîne de mesure" />
      )}

      <h2 id="collecte" className="mb-2 scroll-mt-20 text-sm font-semibold text-ink">
        Où partent les données
      </h2>
      <div
        className={`card mb-6 px-4 py-3 ${memeHote ? "" : "border-warn/50 bg-warn/5"}`}
        data-testid="dogfooding-endpoint"
      >
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          Mesures de la console elle-même
        </div>
        <Adresse url={endpoint} />
        <div className="mt-1 text-xs text-ink-soft">
          {direct
            ? "Directement au collecteur, qui en déduit le pays par l'adresse IP (collecte directe). Retirer ce réglage ramène ces mesures sur l'hôte de cette page."
            : "L'hôte de cette page : seule la collecte directe au collecteur peut l'en déplacer."}
          {direct && (
            <DetailTechnique>
              Réglage : <code>NEXT_PUBLIC_DOGFOOD_COLLECTOR_URL</code>.
            </DetailTechnique>
          )}
        </div>

        <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          Adresse de collecte remise aux clients (code de suivi)
        </div>
        <Adresse url={snippet} />
        <div className={`mt-1 text-xs ${memeHote ? "text-ink-soft" : "text-warn-ink"}`}>
          {memeHote
            ? force
              ? "Fixée par la configuration, et pointe bien cet hôte."
              : "Déduite de l'hôte de la requête : aucune configuration à maintenir."
            : "La configuration pointe un AUTRE hôte que celui-ci. Chaque code de suivi copié depuis la console envoie donc les données du client là-bas, sans erreur visible ni chez le client ni ici. Retirez ce réglage pour revenir à l'hôte courant."}
          {force && (
            <DetailTechnique>
              Réglage : <code>NEXT_PUBLIC_RUM_ENDPOINT</code>.
            </DetailTechnique>
          )}
        </div>
      </div>

      {sante.ok && <StatsSante h={sante.data} />}
    </div>
  );
}

const TON_VERDICT: Record<VerdictSante["niveau"], string> = {
  ok: "border-good/30 bg-good/10 text-good-ink",
  attention: "border-warn/40 bg-warn/10 text-warn-ink",
  incident: "border-bad/40 bg-bad/10 text-bad-ink",
};

/** Le verdict d'ensemble, en tête : une phrase, puis les points qui la justifient. */
function Verdict({ verdict }: { verdict: VerdictSante }) {
  return (
    <section
      className={`mb-6 rounded-xl border px-4 py-3 text-sm ${TON_VERDICT[verdict.niveau]}`}
      role={verdict.niveau === "incident" ? "alert" : "status"}
      data-testid="sante-verdict"
      data-niveau={verdict.niveau}
    >
      <p className="font-semibold">{verdict.titre}</p>
      {verdict.raisons.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5">
          {verdict.raisons.map((r) => (
            <li key={r.texte}>
              {r.texte}{" "}
              <a href={r.ancre} className="font-medium underline underline-offset-2">
                Voir
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Le nom technique, sur demande : l'exploitant en a besoin pour agir, la page n'a
 * pas à l'afficher d'emblée (recette du 26/09/2026 : jargon d'exploitation).
 */
function DetailTechnique({ children }: { children: React.ReactNode }) {
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer select-none text-ink-soft">Détail technique</summary>
      <p className="mt-1 text-ink-soft">{children}</p>
    </details>
  );
}

/**
 * Une adresse qui se coupe après une barre oblique, jamais au milieu d'un mot : à
 * 390 px, « …/v1/trace » puis « s » seul sur la ligne suivante (recette du 26/09).
 */
function Adresse({ url }: { url: string }) {
  const morceaux = url.split("/");
  return (
    <code className="mt-1 block font-mono text-[13px] text-ink [overflow-wrap:anywhere]">
      {morceaux.map((m, i) => (
        <Fragment key={i}>
          {m}
          {i < morceaux.length - 1 && (
            <>
              /<wbr />
            </>
          )}
        </Fragment>
      ))}
    </code>
  );
}

/** Les tuiles de l'instantané de santé — rendues seulement sur une lecture réussie. */
function StatsSante({ h }: { h: HealthSnapshot }) {
  const lag = h.metering_lag_hours;
  const lagTone = lag == null ? "text-warn-ink" : lag > RETARD_CONSO_INCIDENT_H ? "text-bad-ink" : lag > RETARD_CONSO_ATTENTION_H ? "text-warn-ink" : "";
  const fileVide = h.ingest_backlog === 0 && h.ingest_backlog_blocked === 0;
  return (
    <>
      <h2 className="mb-2 text-sm font-semibold text-ink">Collecte des 5 dernières minutes (toutes applications)</h2>
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Mesures Web Vitals" value={h.ingest_metrics_5m} />
        <Stat label="Pages vues" value={h.ingest_pageviews_5m} />
        <Stat label="Erreurs" value={h.ingest_errors_5m} />
        <Stat label="Sessions" value={h.ingest_sessions_5m} />
      </div>

      <h2 id="notifications" className="mb-2 scroll-mt-20 text-sm font-semibold text-ink">
        Alertes et notifications (toutes applications)
      </h2>
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {/* Un déclenchement à acquitter est une tâche, pas une panne de MIP RUM : neutre, et un lien pour s'en occuper. */}
        <Stat label="Déclenchements non acquittés" value={h.alerts_unacked}>
          {h.alerts_unacked > 0 && (
            <Link href="/alerts" className="mt-0.5 block text-[11px] font-medium text-brand hover:underline">
              Voir les alertes →
            </Link>
          )}
        </Stat>
        <Stat label="Notifications en attente d'envoi" value={h.deliveries_queued} />
        <Stat label="Notifications en échec (nouvel essai prévu)" value={h.deliveries_failed} tone={h.deliveries_failed > 0 ? "text-warn-ink" : ""} />
        <Stat label="Notifications abandonnées" value={h.deliveries_dead} tone={h.deliveries_dead > 0 ? "text-bad-ink" : ""} />
      </div>

      <h2 id="file" className="mb-2 scroll-mt-20 text-sm font-semibold text-ink">
        File d&apos;attente de la collecte
      </h2>
      {/* La console écrit toujours en direct (ses routes d'ingestion n'emploient pas
          cette file) : seul le service de collecte la remplit, s'il tourne en
          collecte différée. Une file vide veut donc dire « inutilisée », pas
          « saine » — et l'écran le dit (recette du 26/09/2026). */}
      {fileVide ? (
        <p className="card mb-6 px-4 py-3 text-sm text-ink-soft" data-testid="file-inutilisee">
          <strong className="text-ink">Inutilisée.</strong> La console écrit les données reçues directement en base.
          Seul le service de collecte peut passer par cette file, s&apos;il est réglé en collecte différée : rien
          n&apos;y attend.
        </p>
      ) : (
        <>
          <div className="mb-2 text-xs text-ink-soft">
            Le service de collecte l&apos;utilise (collecte différée) : les données reçues y attendent avant
            d&apos;être écrites. Elle n&apos;est pas protégée contre un arrêt brutal de la base : ce qui y attend
            serait perdu. Une file qui monte veut dire que l&apos;écriture ne suit pas ; des lots abandonnés,
            qu&apos;une écriture échoue en boucle — ceux-là ne seront plus repris.
            <DetailTechnique>
              Réglage <code>INGEST_DEFERRED</code> du service de collecte ; file non journalisée par la base
              (UNLOGGED).
            </DetailTechnique>
          </div>
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Lots en attente" value={h.ingest_backlog} tone={h.ingest_backlog > FILE_ATTENTION ? "text-warn-ink" : ""} />
            <Stat label="Lots abandonnés" value={h.ingest_backlog_blocked} tone={h.ingest_backlog_blocked > 0 ? "text-bad-ink" : ""} />
            <div className="card px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-ink-faint">Plus vieux lot en attente</div>
              <div className="mt-0.5 text-2xl font-bold tabular-nums text-ink">
                {h.ingest_backlog === 0 ? "aucun" : `${h.ingest_backlog_age_s.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}\u00a0s`}
              </div>
            </div>
          </div>
        </>
      )}

      <h2 id="routes" className="mb-2 scroll-mt-20 text-sm font-semibold text-ink">
        Détail par route
      </h2>
      <p className="mb-2 text-xs text-ink-soft">
        Au-delà du plafond d&apos;une application, ses nouvelles routes sont regroupées sur une seule ligne
        « autres ». Rien n&apos;est perdu en volume : c&apos;est le détail par route qui s&apos;arrête. Une
        application au plafond a besoin de règles de regroupement de ses adresses (par exemple{" "}
        <code className="chip-mono">/produit/123</code> → <code className="chip-mono">/produit/:id</code>), pas
        d&apos;un plafond plus haut.
      </p>
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Applications au plafond" value={h.apps_route_capped} tone={h.apps_route_capped > 0 ? "text-warn-ink" : ""} />
        <Stat label="Routes distinctes (application la plus détaillée)" value={h.routes_max} />
      </div>

      <h2 id="consommation" className="mb-2 scroll-mt-20 text-sm font-semibold text-ink">
        Applications et consommation
      </h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Applications actives" value={h.apps_active} />
        <div className="card px-4 py-3" data-testid="retard-consommation">
          <div className="text-[11px] uppercase tracking-wide text-ink-faint">Dernier calcul de la consommation</div>
          <div className={`mt-0.5 text-2xl font-bold tabular-nums ${lagTone || "text-ink"}`}>
            {lag == null ? "jamais exécuté" : `il y a ${lag.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} h`}
          </div>
          <div className="mt-0.5 text-[11px] text-ink-soft">
            {lag == null
              ? "Sans lui, l'écran Consommation n'affiche aucun volume."
              : `Signalé au-delà de ${RETARD_CONSO_ATTENTION_H} h, en incident au-delà de ${RETARD_CONSO_INCIDENT_H} h.`}
          </div>
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, tone = "", children }: { label: string; value: number; tone?: string; children?: React.ReactNode }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</div>
      <div className={`mt-0.5 text-2xl font-bold tabular-nums ${tone || "text-ink"}`}>
        {value.toLocaleString("fr-FR")}
      </div>
      {children}
    </div>
  );
}
