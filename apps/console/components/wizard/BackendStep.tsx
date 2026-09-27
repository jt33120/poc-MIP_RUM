// Corps de l'étape 3 du wizard d'onboarding : recettes de branchement backend
// (FastAPI, Express, autre technologie, auto-instrumentation OpenTelemetry). Rendu
// serveur. Extrait de app/admin/customers/[appId]/page.tsx.
//
// Recette du 26/09/2026 : plus de note interne (« la démo qui vend »), plus de nom de
// client, plus d'émoji ; jetons du thème pour suivre le mode sombre.
import { CopyBlock } from "@/components/CopyBlock";
import { ICON_PATHS, Icon } from "@/components/icons";

const TELECHARGER =
  "inline-flex w-fit items-center gap-1.5 rounded-lg bg-panel2 px-3 py-1.5 text-xs font-medium text-ink ring-1 ring-line transition hover:bg-app";
const BLOC = "rounded-lg border border-line px-3 py-2";
const RESUME = "cursor-pointer text-xs font-medium text-ink";

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
      <p className="mb-3 text-xs text-ink-soft">
        Un fichier à poser dans le serveur du client : chaque appel est alors décomposé entre
        navigateur, réseau et serveur. Sans cette étape, la mesure côté navigateur fonctionne déjà.
      </p>
      <div className="grid gap-2">
        <details className={BLOC} open>
          <summary className={RESUME}>
            FastAPI / Starlette (Python) — <span className="text-ink-soft">fichier servi testé en intégration continue</span>
          </summary>
          <div className="mt-2 grid gap-2">
            <a href="/integrations/mip_rum_middleware.py" download className={TELECHARGER}>
              <Icon paths={ICON_PATHS.download} className="h-3.5 w-3.5" strokeWidth={2.2} />
              mip_rum_middleware.py (un fichier, bibliothèque standard seule)
            </a>
            <CopyBlock code={fastapiWiring} />
          </div>
        </details>
        <details className={BLOC}>
          <summary className={RESUME}>
            Express / Connect (Node 18 ou plus) — <span className="text-ink-soft">testé unitairement</span>
          </summary>
          <div className="mt-2 grid gap-2">
            <a href="/integrations/mip-rum-express.js" download className={TELECHARGER}>
              <Icon paths={ICON_PATHS.download} className="h-3.5 w-3.5" strokeWidth={2.2} />
              mip-rum-express.js (sans dépendance)
            </a>
            <CopyBlock code={expressWiring} />
          </div>
        </details>
        <details className={BLOC}>
          <summary className={RESUME}>Autre technologie (Django, Spring, PHP, Rails…)</summary>
          <div className="mt-2">
            <CopyBlock code={otherStack} />
            <p className="mt-2 text-xs text-ink-soft">
              Le principe est le même partout : propager l&apos;en-tête <code>traceparent</code> et le
              réémettre en réponse. Adapter l&apos;extrait ci-dessus à la technologie du client.
            </p>
          </div>
        </details>
        <details className={BLOC}>
          <summary className={RESUME}>
            Sans toucher au code du serveur — auto-instrumentation OpenTelemetry (toute technologie)
          </summary>
          <p className="mb-2 mt-2 text-xs leading-relaxed text-ink-soft">
            Si le serveur ne peut pas recevoir le middleware : on lance l&apos;application sous
            l&apos;agent d&apos;auto-instrumentation OpenTelemetry de son langage (Python, Java, .NET, Go,
            Node…), et un petit collecteur réémet vers la collecte MIP. Aucune ligne de code applicatif :
            la collecte accepte les spans serveur OpenTelemetry standard.
          </p>
          <div className="grid gap-2">
            <a href="/integrations/otel-collector.yaml" download className={TELECHARGER}>
              <Icon paths={ICON_PATHS.download} className="h-3.5 w-3.5" strokeWidth={2.2} />
              otel-collector.yaml (identifiant, clé et adresse de collecte à compléter)
            </a>
            <CopyBlock code={otelRecipe} />
          </div>
        </details>
      </div>
    </>
  );
}
