// Page « API » — explique l'API de lecture RUM exposée aux clients/partenaires et
// affiche les liens : Swagger UI (rendu de la spec), spec OpenAPI brute, endpoint
// de découverte, et les deux docs de référence sur GitHub. Rendu 100 % serveur,
// contenu de référence (indépendant du projet courant).
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

const PROD_BASE = "https://mip-rum-console.vercel.app";
const GH_BASE = "https://github.com/jt33120/mip-rum/blob/master/docs";

// Endpoints /api/v1 (source de vérité : app/api/v1/*, docs/API_CONSOLE.md).
const ENDPOINTS: { path: string; desc: string }[] = [
  { path: "GET /api/v1", desc: "Découverte : liste des endpoints et des filtres." },
  { path: "GET /api/v1/apps", desc: "Catalogue des apps autorisées (scope du jeton)." },
  { path: "GET /api/v1/overview", desc: "Vue d'ensemble : santé, vitals (courant + précédent), stats." },
  { path: "GET /api/v1/vitals", desc: "Core Web Vitals p75 + séries temporelles (?series=LCP,INP…)." },
  { path: "GET /api/v1/pages", desc: "Routes les plus lentes (p75 LCP/INP/CLS, volume)." },
  { path: "GET /api/v1/errors", desc: "Groupes d'erreurs JS (par signature)." },
  { path: "GET /api/v1/sessions", desc: "Sessions récentes + détail d'une session." },
  { path: "GET /api/v1/tracing", desc: "Tracing front → back (couverture, appels API, routes backend)." },
  { path: "GET /api/v1/correlation", desc: "Corrélation robot (synthétique) ↔ réel (RUM) + angles morts." },
  { path: "GET /api/v1/health-grid", desc: "Heatmap de santé jour × heure + trafic quotidien." },
  { path: "GET /api/v1/ai", desc: "Performance IA : coût, tokens, latence, série journalière." },
];

function LinkCard({
  href,
  title,
  desc,
  external = true,
}: {
  href: string;
  title: string;
  desc: string;
  external?: boolean;
}) {
  const cls =
    "card flex flex-col gap-1 p-4 transition hover:shadow-pop hover:border-accent/40";
  const inner = (
    <>
      <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        {title}
        <span className="text-ink-faint">→</span>
      </span>
      <span className="text-xs leading-relaxed text-ink-soft">{desc}</span>
    </>
  );
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
      {inner}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  );
}

export default function ApiDocs() {
  return (
    <div className="animate-fade-up">
      <PageHeader
        title="API de lecture"
        sub={
          <>
            Les agrégats RUM &amp; IA exposés en <strong>API REST lecture seule</strong> — pour brancher un
            tableau de bord partenaire (ex. plateforme UTI) ou reproduire les graphes de la console côté client.
            Aucune PII, agrégats techniques uniquement.
          </>
        }
      />

      {/* Liens clés ---------------------------------------------------------- */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <LinkCard
          href="/api/v1/docs"
          title="Explorer dans Swagger UI"
          desc="Interface interactive : tous les endpoints, paramètres et schémas de réponse, testables en direct."
        />
        <LinkCard
          href="/api/v1/openapi"
          title="Spec OpenAPI 3.0 (JSON)"
          desc="Le contrat machine — à brancher dans un générateur de client ou Postman/Insomnia."
        />
        <LinkCard
          href="/api/v1"
          title="Découverte des endpoints"
          desc="Réponse JSON listant endpoints et filtres disponibles (point de départ programmatique)."
        />
      </div>

      {/* Deux points d'entrée ------------------------------------------------ */}
      <section className="card mb-6 p-5">
        <h2 className="text-sm font-semibold text-ink">Deux points d'entrée</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-line bg-panel2/50 p-4">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent-deep dark:text-accent">
                recommandé partenaire
              </span>
            </div>
            <h3 className="mt-2 font-mono text-sm font-semibold text-ink">GET /rum/summary</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
              <strong>Un seul appel</strong> : trafic, Core Web Vitals, top routes, top erreurs et coûts IA
              agrégés dans une réponse stable. Idéal pour un tableau de bord « Supervision » côté client.
              Auth par <strong>jeton en base</strong> scopé à une app.
            </p>
            <a
              href={`${GH_BASE}/RUM_READ_API.md`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-xs font-medium text-accent-deep underline-offset-2 hover:underline dark:text-accent"
            >
              Documentation RUM_READ_API.md →
            </a>
          </div>
          <div className="rounded-xl border border-line bg-panel2/50 p-4">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-perf/15 px-2 py-0.5 text-[11px] font-semibold text-perf">
                détail par domaine
              </span>
            </div>
            <h3 className="mt-2 font-mono text-sm font-semibold text-ink">GET /api/v1/*</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
              Une dizaine d'endpoints granulaires (vitals en série, heatmap, tracing, IA détaillée…). Auth par
              <strong> jeton machine</strong> (<code className="chip-mono">Authorization: Bearer</code>) ou cookie
              de session. Enveloppe stable <code className="chip-mono">{"{ meta, data }"}</code>.
            </p>
            <a
              href={`${GH_BASE}/API_CONSOLE.md`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-xs font-medium text-perf underline-offset-2 hover:underline"
            >
              Documentation API_CONSOLE.md →
            </a>
          </div>
        </div>
      </section>

      {/* Auth & filtres ------------------------------------------------------ */}
      <section className="card mb-6 p-5">
        <h2 className="text-sm font-semibold text-ink">Authentification &amp; filtres</h2>
        <div className="mt-3 grid gap-4 text-sm md:grid-cols-2">
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Authentification</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
              En-tête <code className="chip-mono">Authorization: Bearer &lt;jeton&gt;</code> (appel
              serveur-à-serveur : le jeton reste côté backend, jamais dans le navigateur). Un jeton partenaire
              est <strong>scopé à une app</strong> — il ne voit que ses données.
            </p>
          </div>
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Filtres communs</h3>
            <div className="mt-1.5 flex flex-wrap gap-2 text-xs">
              {["app=<slug>|all", "period=1h|24h|7d", "device=mobile|desktop|tablet|all"].map((c) => (
                <span key={c} className="chip-mono">{c}</span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Liste des endpoints ------------------------------------------------- */}
      <section className="card mb-6 overflow-hidden">
        <div className="border-b border-line bg-panel2 px-4 py-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Endpoints /api/v1 (lecture seule)
          </h2>
        </div>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-line/60">
            {ENDPOINTS.map((e) => (
              <tr key={e.path} className="transition hover:bg-panel2/60">
                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-ink">{e.path}</td>
                <td className="px-4 py-2.5 text-xs text-ink-soft">{e.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Exemple ------------------------------------------------------------- */}
      <section className="card p-5">
        <h2 className="text-sm font-semibold text-ink">Exemple</h2>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-panel2 p-3 font-mono text-xs text-ink-soft">
{`# tableau de bord partenaire en un appel
curl -s -H "Authorization: Bearer $MIP_RUM_READ_TOKEN" \\
  "${PROD_BASE}/api/rum/summary?app=gip-plateforme&window=30d"

# détail : LCP p75 dans le temps (série)
curl -s -H "Authorization: Bearer $MIP_API_TOKEN" \\
  "${PROD_BASE}/api/v1/vitals?app=gip-plateforme&period=7d&series=LCP"`}
        </pre>
        <p className="mt-3 text-xs text-ink-faint">
          La correspondance <strong>graphe → endpoint → champs à tracer</strong> (pour reproduire les visuels
          de la console) est détaillée dans les deux docs liées ci-dessus.
        </p>
      </section>
    </div>
  );
}
