import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { AssistBox } from "@/components/AssistBox";
import { CopyBlock } from "@/components/CopyBlock";
import { popSecret, requireAdmin } from "@/lib/auth";
import type { SearchParams } from "@/lib/filters";
import {
  buildInjectionArtifacts,
  buildSnippet,
  deriveStatus,
  type StepState,
} from "@/lib/onboarding";
import { getCustomer, probeOnboarding } from "@/lib/queries-customers";
import { fmtDate } from "@/lib/format";
import { rotateKeyAction, updateOriginsAction } from "../actions";

export const dynamic = "force-dynamic";

function Badge({ state, children }: { state: StepState; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        state === "done" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
      }`}
    >
      {state === "done" ? "✅" : "⏳"} {children}
    </span>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

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
  const endpoint = process.env.NEXT_PUBLIC_RUM_ENDPOINT ?? "http://localhost:4318/v1/traces";

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

  const otelRecipe = `# Backend codeless — aucune modification du code (exemple Python : FastAPI/Django/Flask) :
pip install opentelemetry-distro opentelemetry-exporter-otlp
opentelemetry-bootstrap -a install

# Lancer l'app sous l'agent OTel, en pointant vers le Collector local (otel-collector.yaml) :
OTEL_SERVICE_NAME=${appId} \\
OTEL_EXPORTER_OTLP_ENDPOINT="http://127.0.0.1:4318" \\
opentelemetry-instrument uvicorn main:app --host 0.0.0.0 --port 8000

# Le Collector ne garde que les spans serveur, injecte mip.app_id + la clé, et
# réémet en OTLP/HTTP JSON vers ${endpoint}. L'ingestion MIP accepte nativement
# les spans serveur OpenTelemetry standard (Java/.NET/Go/Node/Ruby/PHP de même).`;

  const fastapiWiring = `# 1. Pose mip_rum_middleware.py à côté de main.py (télécharge-le ci-dessous)
# 2. Dans config.py (pydantic-settings) — ATTENTION : le .env chargé par
#    pydantic-settings ne remplit PAS os.environ, il faut passer par Settings :
class Settings(BaseSettings):
    ...
    mip_rum_endpoint: Optional[str] = None
    mip_rum_app_id: Optional[str] = None
    mip_rum_api_key: Optional[str] = None

# 3. Dans main.py :
from mip_rum_middleware import MIPRumMiddleware
app.add_middleware(
    MIPRumMiddleware,
    endpoint=settings.mip_rum_endpoint,
    app_id=settings.mip_rum_app_id,
    api_key=settings.mip_rum_api_key,
)

# 4. Dans le .env du serveur :
MIP_RUM_ENDPOINT=${endpoint}
MIP_RUM_APP_ID=${appId}
MIP_RUM_API_KEY=<la clé affichée à la création>`;

  const expressWiring = `// 1. Pose mip-rum-express.js dans ton projet (télécharge-le ci-dessous)
// 2. Dans app.js / server.js (Node >= 18) :
const mipRum = require("./mip-rum-express");
app.use(mipRum()); // AVANT tes routes

// 3. Dans l'environnement du serveur :
MIP_RUM_ENDPOINT=${endpoint}
MIP_RUM_APP_ID=${appId}
MIP_RUM_API_KEY=<la clé affichée à la création>`;

  const otherStack = `Protocole (toute stack) — 3 règles :
1. Lire le header "traceparent" entrant : 00-<trace_id 32hex>-<parent_span_id 16hex>-01
   (et la session dans "tracestate" : mip=s:<session_id>)
2. Chronométrer la requête, puis construire un span OTLP/HTTP JSON :
   name "http.server", kind 2, attributs mip.trace_id, mip.span_id,
   mip.route (template, ex /partners/:id), http.method, http.status_code,
   http.duration_ms, mip.parent_span_id, mip.session_id
3. POST en batch vers ${endpoint}
   resource.attributes : mip.app_id="${appId}" (+ mip.api_key)
   Jamais de corps/query/header métier. Jamais d'exception vers l'app hôte.
Les deux fichiers fournis (FastAPI, Express) sont la référence d'implémentation.`;

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
        <Step n={1} title="Vérifier la configuration">
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
        </Step>

        <Step n={2} title="Poser le snippet sur le site du client (front)">
          <p className="mb-3 text-xs text-slate-500">
            Deux balises dans le <code>&lt;head&gt;</code>, avant tout autre script. Rien
            d&apos;autre à modifier — Web Vitals, erreurs, sessions et tracing des appels API
            sont automatiques.
          </p>
          <CopyBlock code={snippet} />
          <div className="mt-3 grid gap-2 text-sm">
            <details className="rounded border border-slate-200 px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-slate-700">
                Où le poser ? (HTML statique, React/Vite, Next.js)
              </summary>
              <ul className="mt-2 list-disc pl-5 text-xs leading-relaxed text-slate-600">
                <li><strong>HTML statique / SPA Vite ou CRA</strong> : dans le <code>&lt;head&gt;</code> de <code>index.html</code> (c&apos;est l&apos;intégration faite sur plateforme.groupement-it.com).</li>
                <li><strong>Next.js (App Router)</strong> : deux <code>&lt;Script strategy=&quot;beforeInteractive&quot;&gt;</code> dans <code>app/layout.tsx</code>, ou les balises dans <code>pages/_document.tsx</code> (Pages Router).</li>
                <li><strong>CMS / tag manager</strong> : un tag « Custom HTML » déclenché sur toutes les pages fait l&apos;affaire.</li>
              </ul>
            </details>
            <details className="rounded border border-slate-200 px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-slate-700">
                Le site a une CSP stricte ?
              </summary>
              <p className="mt-2 text-xs leading-relaxed text-slate-600">
                Ajouter à la CSP : <code>script-src {sdkUrl.replace("/mip-rum.js", "")}</code> et{" "}
                <code>connect-src {new URL(endpoint).origin}</code>. Alternative recommandée :
                auto-héberger <code>mip-rum.js</code> sur le domaine du client (fichier statique
                unique) — plus de dépendance CSP externe pour le script.
              </p>
            </details>
            <details className="rounded border border-slate-200 px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-slate-700">
                RGPD : le client a une bannière de consentement ?
              </summary>
              <p className="mb-2 mt-2 text-xs leading-relaxed text-slate-600">
                Version <code>requireConsent</code> : rien ne part tant que la CMP n&apos;a pas
                appelé <code>MIPRum.consent(true)</code>.
              </p>
              <CopyBlock code={snippetConsent} />
            </details>
            <details className="rounded border border-blue-200 bg-blue-50/40 px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-blue-800">
                🚀 Injection zéro-touch — le client ne peut (ou ne veut) pas modifier son code
              </summary>
              <p className="mb-2 mt-2 text-xs leading-relaxed text-slate-600">
                Sites COTS, legacy ou gérés par un tiers : on pose le snippet depuis
                l&apos;infrastructure, sans toucher au code source. Choisis le point d&apos;injection
                selon l&apos;hébergement du client.
              </p>
              <div className="grid gap-3">
                <div>
                  <p className="mb-1 text-xs font-semibold text-slate-700">
                    Cloudflare Worker{" "}
                    <span className="font-normal text-slate-500">
                      — recommandé : injecte <em>et</em> relâche la CSP automatiquement
                    </span>
                  </p>
                  <CopyBlock code={injection.worker} />
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold text-slate-700">
                    nginx{" "}
                    <span className="font-normal text-slate-500">
                      — si le HTML passe par un nginx que tu opères (ngx_http_sub_module)
                    </span>
                  </p>
                  <CopyBlock code={injection.nginx} />
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold text-slate-700">
                    Google Tag Manager{" "}
                    <span className="font-normal text-slate-500">
                      — si le client a déjà GTM (self-service ; ne corrige pas la CSP)
                    </span>
                  </p>
                  <CopyBlock code={injection.gtm} />
                </div>
                <p className="text-xs leading-relaxed text-slate-500">
                  <strong>SPA statique (Vercel/Netlify/S3)</strong> : pas de proxy HTML dans la
                  chaîne → mettre un Cloudflare devant le domaine (Worker ci-dessus) ou injecter au
                  build. C&apos;est le cas de plateforme.groupement-it.com, où le snippet en dur
                  reste le plus simple.
                  <br />
                  CSP à autoriser si tu l&apos;ajoutes à la main :{" "}
                  <code>script-src {injection.scriptOrigin}</code> ·{" "}
                  <code>connect-src {injection.connectOrigin}</code>.
                </p>
              </div>
            </details>
          </div>
        </Step>

        <Step n={3} title="Brancher le backend (optionnel — tracing front→back)">
          <p className="mb-3 text-xs text-slate-500">
            Un fichier à poser dans le backend du client : chaque appel API est alors décomposé
            navigateur / réseau / serveur (la démo qui vend). Sans cette étape, le RUM front
            fonctionne déjà à 100 %.
          </p>
          <div className="grid gap-2">
            <details className="rounded border border-slate-200 px-3 py-2" open>
              <summary className="cursor-pointer text-xs font-medium text-slate-700">
                FastAPI / Starlette (Python) — <span className="text-green-700">prouvé en prod chez G-IT</span>
              </summary>
              <div className="mt-2 grid gap-2">
                <a
                  href="/integrations/mip_rum_middleware.py"
                  download
                  className="w-fit rounded bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
                >
                  ⬇ mip_rum_middleware.py (232 lignes, stdlib pure)
                </a>
                <CopyBlock code={fastapiWiring} />
              </div>
            </details>
            <details className="rounded border border-slate-200 px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-slate-700">
                Express / Connect (Node ≥ 18) — testé unitairement
              </summary>
              <div className="mt-2 grid gap-2">
                <a
                  href="/integrations/mip-rum-express.js"
                  download
                  className="w-fit rounded bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
                >
                  ⬇ mip-rum-express.js (zéro dépendance)
                </a>
                <CopyBlock code={expressWiring} />
              </div>
            </details>
            <details className="rounded border border-slate-200 px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-slate-700">
                Autre stack (Django, Spring, PHP, Rails…)
              </summary>
              <div className="mt-2">
                <CopyBlock code={otherStack} />
                <p className="mt-2 text-xs text-slate-500">
                  L&apos;assistant IA en bas de page peut générer le middleware pour la stack
                  exacte du client.
                </p>
              </div>
            </details>
            <details className="rounded border border-blue-200 bg-blue-50/40 px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-blue-800">
                🚀 Sans toucher au code backend — auto-instrumentation OpenTelemetry (toute stack)
              </summary>
              <p className="mb-2 mt-2 text-xs leading-relaxed text-slate-600">
                Si le backend ne peut pas recevoir le middleware : on lance l&apos;app sous l&apos;agent
                d&apos;auto-instrumentation OTel de son langage (Python, Java, .NET, Go, Node…) et un
                petit Collector réémet vers l&apos;ingestion MIP. Zéro ligne de code applicatif —
                l&apos;ingestion accepte nativement les spans serveur OpenTelemetry standard.
              </p>
              <div className="grid gap-2">
                <a
                  href="/integrations/otel-collector.yaml"
                  download
                  className="w-fit rounded bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
                >
                  ⬇ otel-collector.yaml (adaptateur — app_id, clé et endpoint à compléter)
                </a>
                <CopyBlock code={otelRecipe} />
              </div>
            </details>
          </div>
        </Step>

        <Step n={4} title="Vérifier que les données arrivent (live)">
          <p className="mb-3 text-xs text-slate-500">
            Cette checklist se met à jour toute seule (rafraîchissement 5 s). Ouvre le site du
            client dans un onglet et regarde les cases passer au vert.
          </p>
          <div className="grid gap-2" data-testid="onboarding-checklist">
            <div className="flex items-center justify-between rounded border border-slate-100 bg-slate-50 px-3 py-2">
              <span className="text-sm">Premières Web Vitals reçues (snippet posé)</span>
              <Badge state={status.snippet}>
                {probe.first_metric_at ? fmtDate(probe.first_metric_at) : "en attente"}
              </Badge>
            </div>
            <div className="flex items-center justify-between rounded border border-slate-100 bg-slate-50 px-3 py-2">
              <span className="text-sm">Sessions sur les dernières 24 h</span>
              <Badge state={status.traffic}>{probe.sessions_24h || "aucune"}</Badge>
            </div>
            <div className="flex items-center justify-between rounded border border-slate-100 bg-slate-50 px-3 py-2">
              <span className="text-sm">Appels API tracés côté navigateur (spans front)</span>
              <Badge state={status.tracingFront}>
                {probe.first_front_span_at ? fmtDate(probe.first_front_span_at) : "en attente"}
              </Badge>
            </div>
            <div className="flex items-center justify-between rounded border border-slate-100 bg-slate-50 px-3 py-2">
              <span className="text-sm">Temps serveur reçus (middleware backend, étape 3)</span>
              <Badge state={status.tracingBack}>
                {probe.first_back_span_at ? fmtDate(probe.first_back_span_at) : "en attente"}
              </Badge>
            </div>
          </div>
          {status.live && (
            <p className="mt-3 text-xs text-green-700">
              ✅ Le client est live — Overview, Sessions et Tracing montrent ses données (filtre
              app : <code>{appId}</code>).
            </p>
          )}
        </Step>

        <Step n={5} title="Donner un accès au client (optionnel)">
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
        </Step>
      </div>

      <div className="mt-6">
        <AssistBox appId={appId} />
      </div>
    </div>
  );
}
