import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { AssistBox } from "@/components/AssistBox";
import { BackendStep } from "@/components/wizard/BackendStep";
import { SnippetStep } from "@/components/wizard/SnippetStep";
import { WizardBadge, WizardStep } from "@/components/wizard/WizardStep";
import { popSecret, requireAdmin } from "@/lib/auth";
import { ingestEndpoint } from "@/lib/ingest-endpoint";
import type { SearchParams } from "@/lib/filters";
import { buildInjectionArtifacts, buildSnippet, deriveStatus } from "@/lib/onboarding";
import { buildBackendRecipes } from "@/lib/onboarding-recipes";
import { getCustomer, probeOnboarding } from "@/lib/queries-customers";
import { fmtDate } from "@/lib/format";
import { rotateKeyAction, updateOriginsAction } from "../actions";

export const dynamic = "force-dynamic";

/** Guide d'intégration pas-à-pas d'un client (wizard live, v0.5). */
export default async function CustomerWizard({
  params,
  searchParams,
}: {
  params: Promise<{ appId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();
  const { appId } = await params;
  const sp = await searchParams;
  const customer = await getCustomer(appId);
  if (!customer) notFound();

  const probe = await probeOnboarding(appId);
  const status = deriveStatus(probe);

  // clé d'API : consommée du stash, affichée une seule fois (création ou rotation)
  const kt = typeof sp.kt === "string" ? sp.kt : null;
  const oneTimeKey = kt ? popSecret(kt) : null;

  // URLs réelles : ingestion via env (prod), SDK servi par cette console
  const host = (await headers()).get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  const sdkUrl = `${proto}://${host}/mip-rum.js`;
  const endpoint = ingestEndpoint("traces", host);

  const snippet = buildSnippet({
    sdkUrl,
    endpoint,
    appId,
    clientId: customer.client_id,
    withConsent: false,
  });
  const snippetConsent = buildSnippet({
    sdkUrl,
    endpoint,
    appId,
    clientId: customer.client_id,
    withConsent: true,
  });
  // v0.6 : configs d'injection zéro-touch (le client ne modifie pas son code)
  const injection = buildInjectionArtifacts({
    sdkUrl,
    endpoint,
    appId,
    clientId: customer.client_id,
  });

  // recettes backend (tracing front→back), paramétrées par endpoint + app_id
  const { otel: otelRecipe, fastapi: fastapiWiring, express: expressWiring, other: otherStack } =
    buildBackendRecipes({ endpoint, appId });

  return (
    <div className="max-w-4xl">
      <div className="mb-1 flex items-center gap-3">
        <h1 className="text-2xl font-bold">{customer.name}</h1>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            status.live ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
          }`}
          data-testid="live-badge"
        >
          {status.live ? "● live" : "intégration en cours"}
        </span>
      </div>
      <p className="mb-6 text-sm text-slate-500">
        <code className="rounded bg-slate-200 px-1.5 py-0.5 text-xs">{appId}</code>
        {customer.client_id && <> · client {customer.client_id}</>} · créé{" "}
        {fmtDate(customer.created_at)}
        {customer.created_by && <> par {customer.created_by}</>} ·{" "}
        <Link href="/admin/customers" className="text-blue-700 hover:underline">
          ← tous les clients
        </Link>
      </p>

      {kt && (
        <div
          data-testid="one-time-key"
          className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          {oneTimeKey ? (
            <>
              <strong>Clé d&apos;API</strong> (affichée une seule fois — colle-la tout de suite
              dans le snippet et les variables d&apos;env du client) :{" "}
              <code data-testid="generated-key" className="rounded bg-white px-2 py-0.5 font-mono">
                {oneTimeKey}
              </code>
            </>
          ) : (
            <>Clé déjà affichée — utilise « Régénérer la clé » si elle est perdue.</>
          )}
        </div>
      )}

      <div className="grid gap-5">
        <WizardStep n={1} title="Vérifier la configuration">
          <div className="grid gap-3 text-sm">
            <form action={updateOriginsAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="app_id" value={appId} />
              <label className="grow text-xs font-medium text-slate-600">
                Domaines autorisés (CORS — modifiable à chaud, pris en compte en ≤ 60 s)
                <input
                  name="origins"
                  type="text"
                  defaultValue={customer.allowed_origins.join(", ")}
                  className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm shadow-sm focus:border-blue-500 focus:outline-none"
                />
              </label>
              <button
                type="submit"
                className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                Mettre à jour
              </button>
            </form>
            <form action={rotateKeyAction}>
              <input type="hidden" name="app_id" value={appId} />
              <button
                type="submit"
                className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                Régénérer la clé d&apos;API (l&apos;ancienne cesse de fonctionner)
              </button>
            </form>
          </div>
        </WizardStep>

        <WizardStep n={2} title="Poser le snippet sur le site du client (front)">
          <SnippetStep
            snippet={snippet}
            snippetConsent={snippetConsent}
            sdkUrl={sdkUrl}
            endpoint={endpoint}
            injection={injection}
          />
        </WizardStep>

        <WizardStep n={3} title="Brancher le backend (optionnel — tracing front→back)">
          <BackendStep
            fastapiWiring={fastapiWiring}
            expressWiring={expressWiring}
            otherStack={otherStack}
            otelRecipe={otelRecipe}
          />
        </WizardStep>

        <WizardStep n={4} title="Vérifier que les données arrivent (live)">
          <p className="mb-3 text-xs text-slate-500">
            Cette checklist se met à jour toute seule (rafraîchissement 5 s). Ouvre le site du
            client dans un onglet et regarde les cases passer au vert.
          </p>
          <div className="grid gap-2" data-testid="onboarding-checklist">
            <div className="flex items-center justify-between rounded border border-slate-100 bg-slate-50 px-3 py-2">
              <span className="text-sm">Premières Web Vitals reçues (snippet posé)</span>
              <WizardBadge state={status.snippet}>
                {probe.first_metric_at ? fmtDate(probe.first_metric_at) : "en attente"}
              </WizardBadge>
            </div>
            <div className="flex items-center justify-between rounded border border-slate-100 bg-slate-50 px-3 py-2">
              <span className="text-sm">Sessions sur les dernières 24 h</span>
              <WizardBadge state={status.traffic}>{probe.sessions_24h || "aucune"}</WizardBadge>
            </div>
            <div className="flex items-center justify-between rounded border border-slate-100 bg-slate-50 px-3 py-2">
              <span className="text-sm">Appels API tracés côté navigateur (spans front)</span>
              <WizardBadge state={status.tracingFront}>
                {probe.first_front_span_at ? fmtDate(probe.first_front_span_at) : "en attente"}
              </WizardBadge>
            </div>
            <div className="flex items-center justify-between rounded border border-slate-100 bg-slate-50 px-3 py-2">
              <span className="text-sm">Temps serveur reçus (middleware backend, étape 3)</span>
              <WizardBadge state={status.tracingBack}>
                {probe.first_back_span_at ? fmtDate(probe.first_back_span_at) : "en attente"}
              </WizardBadge>
            </div>
          </div>
          {status.live && (
            <p className="mt-3 text-xs text-green-700">
              ✅ Le client est live — Overview, Sessions et Tracing montrent ses données (filtre
              app : <code>{appId}</code>).
            </p>
          )}
        </WizardStep>

        <WizardStep n={5} title="Donner un accès au client (optionnel)">
          <p className="mb-3 text-xs text-slate-500">
            Un compte <strong>viewer scopé</strong> ne voit que cette app — dashboards, sessions,
            erreurs, tracing, rien d&apos;autre.
          </p>
          <Link
            href={`/admin/users?app=${encodeURIComponent(appId)}`}
            className="inline-block rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Créer un compte viewer scopé sur {appId} →
          </Link>
        </WizardStep>
      </div>

      <div className="mt-6">
        <AssistBox appId={appId} />
      </div>
    </div>
  );
}
