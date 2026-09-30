import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { ECRANS_ADMIN } from "@mip/console-contract";
import { ConfirmationDanger } from "@/components/ConfirmationDanger";
import { entreGuillemets } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { FormulaireSecret, SecretAffiche, SecretFourni } from "@/components/secret/SecretUnique";
import { BackendStep } from "@/components/wizard/BackendStep";
import { SnippetStep } from "@/components/wizard/SnippetStep";
import { WizardBadge, WizardStep } from "@/components/wizard/WizardStep";
import { chargerClient } from "@/lib/chargeurs/administration";
import { accesAdmin, chargerEcran } from "@/lib/ecran";
import type { SearchParams } from "@/lib/filters";
import { ingestEndpoint, voieRecommandee } from "@/lib/ingest-endpoint";
import { buildInjectionArtifacts, buildSnippet, deriveStatus } from "@/lib/onboarding";
import { recettesAgentsOtel } from "@/lib/recettes-agents-otel";
import { fmtDate } from "@/lib/format";
import { cleDe } from "@/lib/secret-remis";
import { rotateKeyAction, updateOriginsAction } from "../actions";

export const dynamic = "force-dynamic";

/** Fiche d'une application cliente et son guide d'intégration pas à pas, vérifié en direct. */
export default async function CustomerWizard({
  params,
  searchParams,
}: {
  params: Promise<{ appId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { appId } = await params;
  // Le refus de « Mettre à jour » (domaine invalide) revenait ici sans être dit.
  const erreurDomaines = (await searchParams).error === "origin";
  // Le chargeur (`lib/chargeurs/administration.ts`) : l'application et sa sonde
  // d'intégration — hors du périmètre de l'administrateur, introuvable (C9).
  const ecran = accesAdmin(await chargerEcran(ECRANS_ADMIN.client, chargerClient, {}, { appId }));
  if (ecran.etat === "introuvable") notFound();
  const { client: customer, sonde: probe } = ecran;
  const status = deriveStatus(probe);

  // URLs réelles : ingestion via env (prod), SDK servi par cette console
  const host = (await headers()).get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  const sdkUrl = `${proto}://${host}/mip-rum.js`;
  // Collecte directe (P6b.G) : dès que sa variable est posée, le code proposé PAR
  // DÉFAUT vise le collecteur (le pays vient de l'adresse IP), et celui par la
  // console reste à côté pour un site dont la CSP fige `connect-src`. Sans elle,
  // `voie` vaut « console » et rien ne change.
  const voie = voieRecommandee();
  const endpoint = ingestEndpoint("traces", host, voie);
  const endpointConsole = ingestEndpoint("traces", host);

  const snippet = buildSnippet({
    sdkUrl,
    endpoint,
    appId,
    clientId: customer.client_id,
    withConsent: false,
    voie,
  });
  const snippetConsent = buildSnippet({
    sdkUrl,
    endpoint,
    appId,
    clientId: customer.client_id,
    withConsent: true,
    voie,
  });
  const parLaConsole =
    voie === "directe"
      ? {
          endpoint: endpointConsole,
          snippet: buildSnippet({ sdkUrl, endpoint: endpointConsole, appId, clientId: customer.client_id, withConsent: false }),
        }
      : null;
  // v0.6 : configs d'injection zéro-touch (le client ne modifie pas son code)
  const injection = buildInjectionArtifacts({
    sdkUrl,
    endpoint,
    appId,
    clientId: customer.client_id,
  });

  // Recettes serveur (tracing navigateur → serveur) : les agents OpenTelemetry
  // officiels, préremplis avec l'app_id et les adresses complètes de collecte.
  // TOUJOURS par la console : l'adresse d'un serveur ne dit rien du pays d'un
  // visiteur, et la collecte directe n'a d'objet que pour un navigateur.
  const recettesServeur = recettesAgentsOtel({
    appId,
    adresses: { traces: endpointConsole, logs: ingestEndpoint("logs", host) },
  });

  const etape = "flex items-center justify-between gap-3 rounded-lg border border-line bg-panel2/60 px-3 py-2";

  // Jetons du thème partout (recette du 26/09/2026) : les `bg-white` / `slate` /
  // `blue` écrits en dur rendaient le champ des domaines illisible en sombre.
  // `SecretFourni` : la clé remise est lue UNE fois pour tout l'écran — le bandeau
  // et les recettes serveur de l'étape 3, qui la portent à la place de leur repère.
  // Sans lui, le premier composant à la lire la retirerait aux autres.
  return (
    <SecretFourni nom={cleDe(appId)}>
      <div className="min-w-0 max-w-4xl animate-fade-up">
        <PageHeader
          title={customer.name}
          sub={
            <>
              <code className="chip-mono">{appId}</code>
              {customer.client_id && <> · client {customer.client_id}</>} · créée le{" "}
              {fmtDate(customer.created_at)}
              {customer.created_by && <> par {customer.created_by}</>} ·{" "}
              <Link href="/admin/customers" className="text-brand hover:underline">
                ← toutes les applications
              </Link>
            </>
          }
        >
          <span
            className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${
              status.live ? "bg-good/10 text-good-ink" : "bg-warn/10 text-warn-ink"
            }`}
            data-testid="live-badge"
          >
            {status.live ? "Données reçues" : "Intégration en cours"}
          </span>
          {/* La même installation, écrite pour l'équipe du client et lisible par elle
              (cette fiche est réservée aux administrateurs). */}
          <Link href={`/installer?app=${encodeURIComponent(appId)}`} className="btn-ghost" data-testid="lien-installer">
            Guide d&apos;installation pour le client →
          </Link>
        </PageHeader>

        {/* La clé d'API (création de l'application ou rotation) : rendue au formulaire
            par l'action, remise ici, affichée une seule fois (C9c). */}
        <SecretAffiche
          nom={cleDe(appId)}
          testid="one-time-key"
          testidValeur="generated-key"
          className="mb-6 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn-ink"
          codeClassName="break-all rounded bg-panel px-2 py-0.5 font-mono text-ink"
          prefixe="Clé d'API de"
          suffixe="(affichée une seule fois : copiez-la maintenant dans le code de suivi et la configuration du site) :"
        />

        <div className="grid gap-5">
          <WizardStep n={1} title="Vérifier la configuration">
            <div className="grid gap-3 text-sm">
              {erreurDomaines && (
                <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad-ink">
                  Domaines non enregistrés : chacun doit être une adresse http(s) complète (ex. https://app.exemple.fr), et
                  il en faut au moins un.
                </p>
              )}
              <form action={updateOriginsAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="app_id" value={appId} />
                <label className="min-w-0 grow text-xs font-medium text-ink-soft">
                  Domaines autorisés à envoyer des mesures (modifiables à tout moment, pris en compte en moins d&apos;une minute)
                  <input
                    name="origins"
                    type="text"
                    defaultValue={customer.allowed_origins.join(", ")}
                    className="field mt-1 block w-full font-mono"
                  />
                </label>
                <button type="submit" className="btn-ghost">
                  Mettre à jour
                </button>
              </form>
              {/* Régénérer invalide la clé posée chez le client : confirmé, et laissé
                  ici plutôt qu'en bas de page — la nouvelle clé s'affiche en tête.
                  Sans clé (intégration ancienne), rien ne se coupe : en générer une
                  part d'un clic, et le code de suivi ci-dessous, qui en attend une,
                  dit enfin vrai (recette du 26/09/2026). */}
              <FormulaireSecret action={rotateKeyAction}>
                <input type="hidden" name="app_id" value={appId} />
                {customer.has_key ? (
                  <ConfirmationDanger
                    libelle="Régénérer la clé d’API"
                    question={`Régénérer la clé d’API de ${entreGuillemets(customer.name)}\u00a0?`}
                    consequence="L’ancienne clé cessera aussitôt de fonctionner : il faudra poser la nouvelle, affichée une seule fois, sur le site du client."
                    confirmer="Régénérer la clé"
                    enCours="Régénération…"
                    testid="regenerer-cle"
                  />
                ) : (
                  <div className="flex flex-wrap items-center gap-3" data-testid="sans-cle">
                    <p className="text-xs text-ink-soft">
                      Cette application n&apos;a pas encore de clé d&apos;API : le code de suivi ci-dessous en attend une.
                    </p>
                    <button type="submit" className="btn-accent">
                      Générer une clé d&apos;API
                    </button>
                  </div>
                )}
              </FormulaireSecret>
            </div>
          </WizardStep>

          <WizardStep n={2} title="Poser le code de suivi sur le site du client (navigateur)">
            <SnippetStep
              snippet={snippet}
              snippetConsent={snippetConsent}
              sdkUrl={sdkUrl}
              endpoint={endpoint}
              injection={injection}
              parLaConsole={parLaConsole}
            />
          </WizardStep>

          <WizardStep n={3} title="Brancher le serveur (facultatif : suivre un appel du navigateur jusqu’au serveur)">
            <BackendStep recettes={recettesServeur} nomSecret={cleDe(appId)} />
          </WizardStep>

          <WizardStep n={4} title="Vérifier que les données arrivent (en direct)">
            <p className="mb-3 text-xs text-ink-soft">
              Cette liste se met à jour toute seule, toutes les 5 secondes. Ouvrez le site du client dans
              un autre onglet : les cases passent au vert à mesure que les données arrivent.
            </p>
            <div className="grid gap-2" data-testid="onboarding-checklist">
              <div className={etape}>
                <span className="text-sm text-ink">Premières Web Vitals reçues (code de suivi posé)</span>
                <WizardBadge state={status.snippet}>
                  {probe.first_metric_at ? fmtDate(probe.first_metric_at) : "en attente"}
                </WizardBadge>
              </div>
              <div className={etape}>
                <span className="text-sm text-ink">Sessions sur les dernières 24 h</span>
                <WizardBadge state={status.traffic}>
                  {probe.sessions_24h ? probe.sessions_24h.toLocaleString("fr-FR") : "aucune"}
                </WizardBadge>
              </div>
              <div className={etape}>
                <span className="text-sm text-ink">Appels d&apos;API suivis depuis le navigateur</span>
                <WizardBadge state={status.tracingFront}>
                  {probe.first_front_span_at ? fmtDate(probe.first_front_span_at) : "en attente"}
                </WizardBadge>
              </div>
              <div className={etape}>
                <span className="text-sm text-ink">Temps serveur reçus (serveur branché, étape 3)</span>
                <WizardBadge state={status.tracingBack}>
                  {probe.first_back_span_at ? fmtDate(probe.first_back_span_at) : "en attente"}
                </WizardBadge>
              </div>
            </div>
            {status.live && (
              <p className="mt-3 text-xs text-good-ink">
                Les données arrivent : la Vue d&apos;ensemble, les Sessions et le Tracing montrent cette
                application (choisissez <code className="chip-mono">{appId}</code> dans le sélecteur
                d&apos;application).
              </p>
            )}
          </WizardStep>

          <WizardStep n={5} title="Donner un accès au client (facultatif)">
            <p className="mb-3 text-xs text-ink-soft">
              Un compte en <strong className="text-ink">lecture seule</strong>, limité à cette application, n&apos;en
              voit que les données : tableaux de bord, sessions, erreurs, traces — rien d&apos;autre.
            </p>
            <Link href={`/admin/users?app=${encodeURIComponent(appId)}`} className="btn-accent inline-block">
              Créer un compte en lecture seule pour {appId} →
            </Link>
          </WizardStep>
        </div>
      </div>
    </SecretFourni>
  );
}
