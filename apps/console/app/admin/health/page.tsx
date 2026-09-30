import { headers } from "next/headers";
import { Fragment } from "react";
import { ECRANS_ADMIN } from "@mip/console-contract";
import { InfoTip } from "@/components/InfoTip";
import { PageHeader } from "@/components/PageHeader";
import { SanteChaine } from "@/components/SanteChaine";
import { KpiLibelle } from "@/components/charts/KpiLibelle";
import { KpiTile } from "@/components/charts/KpiTile";
import { EchecLecture } from "@/components/states/SectionErreur";
import { chargerSante } from "@/lib/chargeurs/administration";
import { accesAdmin, chargerEcran } from "@/lib/ecran";
import { verdictSante, FILE_ATTENTION, RETARD_CONSO_ATTENTION_H, RETARD_CONSO_INCIDENT_H, type VerdictSante } from "@/lib/health-verdict";
import { dogfoodingEndpoint, ingestEndpoint, ingestEndpointDirect, origineCollecteurDogfooding } from "@/lib/ingest-endpoint";
import type { HealthSnapshot } from "@/lib/metrics-format";
import { Panneau, Pastille, TD, TH, type TonPastille } from "../_ui/kit";

export const dynamic = "force-dynamic";

const HEURE_MS = 3_600_000;
const SOURCE = "Instantané de santé interne de la console — les mêmes indicateurs que ceux publiés pour Prometheus (jeton requis)";

/**
 * Santé interne de MIP RUM (auto-observabilité, P1) — admin. Mêmes chiffres que /api/metrics.
 *
 * Refonte du 01/10/2026 : le verdict sur une ligne (ses raisons en puces qui mènent à
 * l'indicateur), les indicateurs en cases rangées par étage, la chaîne de mesure, puis
 * les adresses de collecte en tableau ; chaque explication dans une bulle ou un repli.
 */
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
  const endpoint = dogfoodingEndpoint(hote); // la console -> elle-même
  const direct = origineCollecteurDogfooding(hote) !== null; // ou au collector, en direct (P6b.G)
  const snippet = ingestEndpoint("traces", hote); // ce qu'on remet aux CLIENTS
  const directeClients = ingestEndpointDirect("traces"); // ou, par défaut, le collector (P6b.G)
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
      <PageHeader title="Santé interne" />

      {verdict ? <Verdict verdict={verdict} /> : <EchecLecture titre="Santé interne" />}

      {(identity.label === "degraded" || causal.label === "degraded") && (
        <div id="degradations" className="mb-4 grid scroll-mt-20 gap-2">
          {identity.label === "degraded" && (
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn-ink" data-testid="identity-health-degraded">
              <strong>Identité métier dégradée.</strong>
              {!identity.configured && <>La clé de pseudonymisation des identifiants n&apos;est pas configurée.</>}
              {!identity.schema && <>La base n&apos;est pas à jour pour l&apos;identité métier.</>}
              <InfoTip label="Conséquence" align="start">
                Les identifiants utilisateur et compte sont omis quand il le faut ; le reste de la collecte continue.
              </InfoTip>
              <DetailTechnique>
                {!identity.configured && <>Variable absente : <code>IDENTITY_HASH_SECRET</code>. </>}
                {!identity.schema && <>Migration v66 non détectée.</>}
              </DetailTechnique>
            </div>
          )}
          {causal.label === "degraded" && (
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn-ink" data-testid="causal-actions-health-degraded">
              <strong>Actions causales indisponibles.</strong> La base n&apos;est pas à jour pour elles.
              <InfoTip label="Conséquence" align="start">
                La collecte continue sans interruption, mais les liens entre actions et le classement des actions restent vides.
              </InfoTip>
              <DetailTechnique>Migration v67 non détectée.</DetailTechnique>
            </div>
          )}
        </div>
      )}

      {sante.ok && <StatsSante h={sante.data} />}

      {/* La preuve que la mesure passe, étage par étage (canari du scheduler, A3 § 2.6). */}
      <h2 id="chaine" className="mb-1.5 mt-5 scroll-mt-20 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
        Chaîne de mesure
      </h2>
      {chaine?.ok ? (
        <SanteChaine brute={chaine.data.brute} cadenceMin={chaine.data.cadenceMin} maintenant={Date.now()} />
      ) : (
        <EchecLecture titre="Santé de la chaîne de mesure" />
      )}

      <Panneau
        id="collecte"
        testId="dogfooding-endpoint"
        titre="Où partent les données"
        className={`mt-4 scroll-mt-20 ${memeHote ? "" : "border-warn/50"}`}
        aide="Les adresses où partent les mesures : celles de la console elle-même, et celles remises aux clients. Une adresse qui ne pointe pas cet hôte fait émettre dans le vide, sans erreur visible."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-panel2">
              <tr>
                <th className={TH}>Flux</th>
                <th className={TH}>Adresse</th>
                <th className={TH}>État</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              <LigneAdresse
                flux="Mesures de la console elle-même"
                url={endpoint}
                ton={direct ? "neutre" : "bon"}
                etat={direct ? "collecteur, en direct" : "hôte de cette page"}
                explication={
                  direct
                    ? "Directement au collecteur, qui en déduit le pays par l'adresse IP (collecte directe). Retirer ce réglage ramène ces mesures sur l'hôte de cette page."
                    : "L'hôte de cette page : seule la collecte directe au collecteur peut l'en déplacer."
                }
                technique={
                  direct ? (
                    <>
                      Réglage : <code>NEXT_PUBLIC_DOGFOOD_COLLECTOR_URL</code>.
                    </>
                  ) : null
                }
              />
              <LigneAdresse
                flux="Collecte directe des navigateurs des clients"
                url={directeClients}
                ton={directeClients ? "bon" : "eteint"}
                etat={directeClients ? "ouverte" : "fermée"}
                testId="collecte-directe-clients"
                explication={
                  directeClients
                    ? "Ouverte : le code de suivi et l'extension visent le collecteur, qui déduit le pays de l'adresse IP. Le code par la console reste proposé pour un site dont la CSP fige connect-src."
                    : "Fermée : le code de suivi et l'extension passent par la console, qui ne transmet pas l'adresse IP ; le pays reste estimé."
                }
                technique={
                  directeClients ? (
                    <>
                      Réglage : <code>NEXT_PUBLIC_DIRECT_COLLECTOR_URL</code>.
                    </>
                  ) : null
                }
              />
              <LigneAdresse
                flux={directeClients ? "Collecte par la console (CSP figée, agents serveur)" : "Adresse remise aux clients (code de suivi)"}
                url={snippet}
                ton={memeHote ? "bon" : "attention"}
                etat={memeHote ? (force ? "fixée, pointe cet hôte" : "déduite de cet hôte") : "pointe un AUTRE hôte"}
                explication={
                  memeHote
                    ? force
                      ? "Fixée par la configuration, et pointe bien cet hôte."
                      : "Déduite de l'hôte de la requête : aucune configuration à maintenir."
                    : "La configuration pointe un AUTRE hôte que celui-ci. Chaque code de suivi copié depuis la console envoie donc les données du client là-bas, sans erreur visible ni chez le client ni ici. Retirez ce réglage pour revenir à l'hôte courant."
                }
                technique={
                  force ? (
                    <>
                      Réglage : <code>NEXT_PUBLIC_RUM_ENDPOINT</code>.
                    </>
                  ) : null
                }
              />
            </tbody>
          </table>
        </div>
      </Panneau>
    </div>
  );
}

const TON_VERDICT: Record<VerdictSante["niveau"], string> = {
  ok: "border-good/30 bg-good/10 text-good-ink",
  attention: "border-warn/40 bg-warn/10 text-warn-ink",
  incident: "border-bad/40 bg-bad/10 text-bad-ink",
};

/** La forme double la couleur : le verdict se lit sans elle. */
const FORME_VERDICT: Record<VerdictSante["niveau"], string> = { ok: "●", attention: "▲", incident: "■" };

/** Le verdict d'ensemble, en tête, sur une ligne : la phrase, puis ses raisons en puces qui mènent à l'indicateur. */
function Verdict({ verdict }: { verdict: VerdictSante }) {
  return (
    <section
      className={`mb-4 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2 text-sm ${TON_VERDICT[verdict.niveau]}`}
      role={verdict.niveau === "incident" ? "alert" : "status"}
      data-testid="sante-verdict"
      data-niveau={verdict.niveau}
    >
      <p className="font-semibold">
        <span aria-hidden className="mr-1.5">
          {FORME_VERDICT[verdict.niveau]}
        </span>
        {verdict.titre}
      </p>
      {verdict.raisons.length > 0 && (
        <ul className="flex min-w-0 flex-wrap gap-1.5">
          {verdict.raisons.map((r) => (
            <li key={r.texte} className="min-w-0">
              <a
                href={r.ancre}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-panel/70 px-2 py-px text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
              >
                <span className="min-w-0">{r.texte}</span>
                <span aria-hidden>→</span>
                <span className="sr-only">Voir</span>
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
    <details className="text-xs">
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
    <code className="block font-mono text-xs text-ink [overflow-wrap:anywhere]">
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

/** Une ligne du tableau des adresses : le flux, l'adresse, l'état en pastille ; la phrase dans la bulle. */
function LigneAdresse({
  flux,
  url,
  ton,
  etat,
  explication,
  technique,
  testId,
}: {
  flux: string;
  url: string | null;
  ton: TonPastille;
  etat: string;
  explication: string;
  technique: React.ReactNode | null;
  testId?: string;
}) {
  return (
    <tr className="align-top">
      <td className={`${TD} text-xs font-medium text-ink`}>{flux}</td>
      <td className={`${TD} min-w-[14rem]`}>{url ? <Adresse url={url} /> : <span className="text-xs text-ink-faint">—</span>}</td>
      <td className={TD} data-testid={testId}>
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Pastille ton={ton}>{etat}</Pastille>
          <InfoTip label={`Explication : ${flux}`} align="end">
            {explication}
          </InfoTip>
          <span className="sr-only">{explication}</span>
          {technique && <DetailTechnique>{technique}</DetailTechnique>}
        </span>
      </td>
    </tr>
  );
}

/** Un étage d'indicateurs : son surtitre en petites capitales, sa bulle, ses cases. */
function Etage({ id, titre, aide, colonnes = 4, children }: { id: string; titre: string; aide?: React.ReactNode; colonnes?: 2 | 3 | 4; children: React.ReactNode }) {
  const grille = { 2: "grid-cols-2", 3: "grid-cols-2 sm:grid-cols-3", 4: "grid-cols-2 sm:grid-cols-4" }[colonnes];
  return (
    <section id={id} aria-labelledby={`${id}-titre`} className="min-w-0 scroll-mt-20">
      <div className="mb-1.5 flex items-center gap-1.5">
        <h2 id={`${id}-titre`} className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
          {titre}
        </h2>
        {aide && (
          <InfoTip label={`Aide : ${titre}`} align="start">
            {aide}
          </InfoTip>
        )}
      </div>
      <div className={`grid gap-2 ${grille}`}>{children}</div>
    </section>
  );
}

/** Les tuiles de l'instantané de santé — rendues seulement sur une lecture réussie. */
function StatsSante({ h }: { h: HealthSnapshot }) {
  const lag = h.metering_lag_hours;
  const fileVide = h.ingest_backlog === 0 && h.ingest_backlog_blocked === 0;
  return (
    <div className="grid gap-x-4 gap-y-3 lg:grid-cols-2">
      <Etage id="collecte-5-min" titre="Collecte · 5 dernières minutes" aide="Ce qui est arrivé ces 5 dernières minutes, toutes applications confondues.">
        <KpiTile label="Mesures Web Vitals reçues (5 min)" libelleCase="Web Vitals" valeur={h.ingest_metrics_5m} format="count" source={SOURCE} methode="Mesures Web Vitals écrites ces 5 dernières minutes, toutes applications." />
        <KpiTile label="Pages vues reçues (5 min)" libelleCase="Pages vues" valeur={h.ingest_pageviews_5m} format="count" source={SOURCE} methode="Pages vues écrites ces 5 dernières minutes, toutes applications." />
        <KpiTile label="Erreurs reçues (5 min)" libelleCase="Erreurs" valeur={h.ingest_errors_5m} format="count" source={SOURCE} methode="Erreurs écrites ces 5 dernières minutes, toutes applications." />
        <KpiTile label="Sessions reçues (5 min)" libelleCase="Sessions" valeur={h.ingest_sessions_5m} format="count" source={SOURCE} methode="Sessions actives ces 5 dernières minutes, toutes applications." />
      </Etage>

      <Etage id="notifications" titre="Alertes et notifications" aide="Toutes applications. Un déclenchement à acquitter est une tâche, pas une panne de MIP RUM.">
        {/* Un déclenchement à acquitter est une tâche, pas une panne de MIP RUM : neutre, et un lien pour s'en occuper. */}
        <KpiTile label="Déclenchements non acquittés" libelleCase="Non acquittés" valeur={h.alerts_unacked} format="count" href="/alerts" source={SOURCE} methode="Déclenchements d'alerte qu'aucun membre n'a encore acquittés." />
        <KpiTile label="Notifications en attente d'envoi" libelleCase="En attente" valeur={h.deliveries_queued} format="count" source={SOURCE} methode="Notifications d'alerte prêtes à partir." />
        <KpiTile
          label="Notifications en échec (nouvel essai prévu)"
          libelleCase="En échec"
          valeur={h.deliveries_failed}
          format="count"
          alerte={{ si: ">", valeur: 0, regle: "un nouvel essai est prévu" }}
          source={SOURCE}
          methode="Notifications dont l'envoi a échoué ; un nouvel essai est prévu."
        />
        <KpiTile
          label="Notifications abandonnées"
          libelleCase="Abandonnées"
          valeur={h.deliveries_dead}
          format="count"
          alerte={{ si: ">", valeur: 0, regle: "abandonnées après plusieurs échecs : personne n'a été prévenu" }}
          source={SOURCE}
          methode="Notifications abandonnées après plusieurs échecs : elles ne partiront plus."
        />
      </Etage>

      {/* La console écrit toujours en direct (ses routes d'ingestion n'emploient pas
          cette file) : seul le service de collecte la remplit, s'il tourne en
          collecte différée. Une file vide veut donc dire « inutilisée », pas
          « saine » — et l'écran le dit (recette du 26/09/2026). */}
      {fileVide ? (
        <Etage id="file" titre="File d'attente de la collecte" colonnes={2}>
          <div className="col-span-2 flex min-h-[6.5rem] min-w-0 flex-wrap items-center gap-2 rounded-xl border border-line bg-panel px-3.5 py-3 text-sm text-ink-soft" data-testid="file-inutilisee">
            <strong className="text-ink">Inutilisée.</strong> La console écrit les données reçues directement en base.
            <InfoTip label="Pourquoi la file est vide" align="start">
              Seul le service de collecte peut passer par cette file, s&apos;il est réglé en collecte différée : rien n&apos;y attend.
            </InfoTip>
          </div>
        </Etage>
      ) : (
        <Etage
          id="file"
          titre="File d'attente de la collecte"
          colonnes={3}
          aide={
            <>
              Le service de collecte l&apos;utilise (collecte différée) : les données reçues y attendent avant d&apos;être écrites. Elle
              n&apos;est pas protégée contre un arrêt brutal de la base : ce qui y attend serait perdu. Une file qui monte veut dire que
              l&apos;écriture ne suit pas ; des lots abandonnés, qu&apos;une écriture échoue en boucle — ceux-là ne seront plus repris.
              Réglage <code>INGEST_DEFERRED</code> du service de collecte ; file non journalisée par la base (UNLOGGED).
            </>
          }
        >
          <KpiTile
            label="Lots en attente"
            valeur={h.ingest_backlog}
            format="count"
            alerte={{ si: ">", valeur: FILE_ATTENTION, regle: "l'écriture ne suit pas" }}
            source={SOURCE}
            methode="Lots de données reçus qui attendent d'être écrits en base."
          />
          <KpiTile
            label="Lots abandonnés"
            valeur={h.ingest_backlog_blocked}
            format="count"
            alerte={{ si: ">", valeur: 0, regle: "ils ne seront plus repris" }}
            source={SOURCE}
            methode="Lots dont l'écriture a échoué en boucle : ils ne seront plus repris."
          />
          <KpiTile
            label="Plus vieux lot en attente"
            libelleCase="Plus vieux lot"
            valeur={h.ingest_backlog === 0 ? null : h.ingest_backlog_age_s * 1000}
            format="s-auto"
            raisonNull="aucun lot en attente"
            source={SOURCE}
            methode="Âge du plus ancien lot encore en attente d'écriture."
          />
        </Etage>
      )}

      <Etage
        id="routes"
        titre="Routes et consommation"
        aide={
          <>
            Au-delà du plafond d&apos;une application, ses nouvelles routes sont regroupées sur une seule ligne
            « autres ». Rien n&apos;est perdu en volume : c&apos;est le détail par route qui s&apos;arrête. Une
            application au plafond a besoin de règles de regroupement de ses adresses (par exemple{" "}
            <code className="chip-mono">/produit/123</code> → <code className="chip-mono">/produit/:id</code>), pas
            d&apos;un plafond plus haut.
          </>
        }
      >
        <KpiTile
          label="Applications au plafond de routes"
          libelleCase="Au plafond"
          valeur={h.apps_route_capped}
          format="count"
          alerte={{ si: ">", valeur: 0, regle: "leurs nouvelles routes sont regroupées" }}
          source={SOURCE}
          methode="Applications dont les nouvelles routes sont regroupées sur une seule ligne « autres » : il leur faut des règles de regroupement de leurs adresses."
        />
        <KpiTile label="Routes distinctes (application la plus détaillée)" libelleCase="Routes (max)" valeur={h.routes_max} format="count" source={SOURCE} methode="Nombre de routes distinctes de l'application qui en a le plus." />
        <KpiTile label="Applications actives" valeur={h.apps_active} format="count" source={SOURCE} methode="Applications autorisées à envoyer des mesures." />
        <div id="consommation" className="min-w-0 scroll-mt-20" data-testid="retard-consommation">
          {lag == null ? (
            <KpiLibelle label="Dernier calcul de la consommation" texte="jamais exécuté" lecture="Sans lui, l'écran Consommation n'affiche aucun volume." />
          ) : (
            <KpiTile
              label="Dernier calcul de la consommation"
              libelleCase="Calcul de la conso."
              valeur={lag * HEURE_MS}
              format="s-auto"
              alerte={{ si: ">", valeur: RETARD_CONSO_ATTENTION_H * HEURE_MS, regle: `signalé au-delà de ${RETARD_CONSO_ATTENTION_H} h, en incident au-delà de ${RETARD_CONSO_INCIDENT_H} h` }}
              source={SOURCE}
              methode={`Temps écoulé depuis le dernier calcul de la consommation. Signalé au-delà de ${RETARD_CONSO_ATTENTION_H} h, en incident au-delà de ${RETARD_CONSO_INCIDENT_H} h.`}
            />
          )}
        </div>
      </Etage>
    </div>
  );
}
