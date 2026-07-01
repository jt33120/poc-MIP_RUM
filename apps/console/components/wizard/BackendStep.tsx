// Corps de l'étape 3 du wizard d'onboarding : recettes de branchement backend
// (FastAPI, Express, autre stack, auto-instrumentation OpenTelemetry). Rendu
// 100 % serveur. Extrait de app/admin/customers/[appId]/page.tsx.
import { CopyBlock } from "@/components/CopyBlock";

/** Étape 3 : recettes middleware backend (présentationnel). */
export function BackendStep({
  fastapiWiring,
  expressWiring,
  otherStack,
  otelRecipe,
}: {
  fastapiWiring: string;
  expressWiring: string;
  otherStack: string;
  otelRecipe: string;
}) {
  return (
    <>
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
    </>
  );
}
