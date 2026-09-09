// Page « API et MCP » — les deux manières de sortir la donnée du portail :
//   · l'API REST v1, pour un front ou un partenaire ;
//   · le serveur MCP, pour un agent IA.
// Une seule page parce qu'un seul socle : le serveur MCP est un CLIENT de
// l'API v1. Il n'ouvre aucun accès qu'un jeton n'ouvrait pas déjà.
//
// LA LISTE DES ENDPOINTS N'EST PLUS ÉCRITE ICI. Elle l'était, et elle a menti :
// elle annonçait `GET /api/v1/ai`, route supprimée du produit (la supervision IA
// est passée chez xSOM AI Guard, cf. ADR-0001). C'était la troisième copie de la
// même liste — spec OpenAPI, descripteur /api/v1, cette page — et la troisième
// avait dérivé. Elle vient maintenant de `endpointsDeclares()`, comme le
// descripteur : une seule source, celle qui sert aussi les schémas.
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { endpointsDeclares } from "@/lib/api/openapi";

export const dynamic = "force-dynamic";

const PROD_BASE = "https://mip-rum-console.vercel.app";
// Le dépôt s'appelle poc-MIP_RUM. Il était écrit `mip-rum` ici : les deux liens
// « Documentation → » de cette page tombaient donc en 404 sur GitHub.
const GH_BASE = "https://github.com/jt33120/poc-MIP_RUM/blob/master/docs";

const ENDPOINTS = endpointsDeclares();

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

/** Les onze outils MCP. Source : apps/mcp/lib/catalogue.mjs. */
const OUTILS_MCP: { nom: string; desc: string }[] = [
  { nom: "mip_rum_list_apps", desc: "Applications accessibles au jeton — à appeler en premier." },
  { nom: "mip_rum_get_overview", desc: "Santé, vitals p75, trafic, avec la période précédente." },
  { nom: "mip_rum_get_vitals", desc: "Core Web Vitals p75, et séries temporelles à la demande." },
  { nom: "mip_rum_list_slow_pages", desc: "Routes les plus lentes, avec leur volume." },
  { nom: "mip_rum_list_errors", desc: "Groupes d'erreurs JS, paginés." },
  { nom: "mip_rum_get_error_group", desc: "Détail d'un groupe d'erreurs." },
  { nom: "mip_rum_list_sessions", desc: "Sessions récentes, paginées." },
  { nom: "mip_rum_get_session", desc: "Chronologie complète d'une session." },
  { nom: "mip_rum_get_tracing", desc: "Couverture du tracing, appels API, routes backend." },
  { nom: "mip_rum_get_correlation", desc: "Robot ↔ réel, et angles morts." },
  { nom: "mip_rum_get_health_grid", desc: "Heatmap jour × heure, trafic quotidien." },
];

export default function ApiDocs() {
  return (
    <div className="animate-fade-up">
      <PageHeader
        title="API et MCP"
        sub={
          <>
            Les agrégats RUM exposés de deux façons : en <strong>API REST lecture seule</strong> pour brancher un
            tableau de bord partenaire, et en <strong>serveur MCP</strong> pour qu'un agent IA interroge le portail
            en langage naturel. Aucune PII, agrégats techniques uniquement.
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
          href={`${GH_BASE}/MCP.md`}
          title="Brancher un agent IA (MCP)"
          desc="Configuration du serveur MCP : les onze outils, les deux transports, et le modèle d'authentification."
        />
      </div>

      {/* Deux points d'entrée ------------------------------------------------ */}
      <section className="card mb-6 p-5">
        <h2 className="text-sm font-semibold text-ink">Deux points d'entrée REST</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-line bg-panel2/50 p-4">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent-deep dark:text-accent">
                recommandé partenaire
              </span>
            </div>
            <h3 className="mt-2 font-mono text-sm font-semibold text-ink">GET /api/rum/summary</h3>
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
              {ENDPOINTS.length} endpoints granulaires (vitals en série, heatmap, tracing…). Auth par
              <strong> jeton machine</strong> (<code className="chip-mono">Authorization: Bearer</code>) ou cookie
              de session. Enveloppe stable <code className="chip-mono">{"{ meta, data }"}</code>. C'est cette API
              que consomme le serveur MCP.
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

      {/* Serveur MCP --------------------------------------------------------- */}
      <section className="card mb-6 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-ink">Serveur MCP — interroger le portail avec une IA</h2>
          <span className="rounded-full bg-perf/15 px-2 py-0.5 text-[11px] font-semibold text-perf">
            lecture seule
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-ink-soft">
          Le <strong>Model Context Protocol</strong> est la prise standard entre un modèle et un système. Branché sur
          MIP RUM, il permet de demander « quelles routes se sont dégradées cette semaine, et sur quels appareils ? »
          plutôt que d'enchaîner des appels REST à la main. Le serveur est un <strong>client de l'API v1</strong> :
          il n'accède pas à la base, et n'ouvre aucun droit qu'un jeton n'ouvrait pas déjà.
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-line bg-panel2/50 p-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              Authentification
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
              <strong>Oui, un jeton est requis</strong> — le même que l'API v1. Le serveur distant n'en détient
              aucun : il <strong>relaie celui de l'appelant</strong>. Un jeton scopé à une app ne voit donc que la
              sienne, ici comme ailleurs, et une URL MCP découverte par un tiers ne donne rien sans jeton.
            </p>
          </div>
          <div className="rounded-xl border border-line bg-panel2/50 p-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              Deux transports
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
              <strong>stdio</strong> pour un poste de travail (Claude Desktop, un IDE) : le jeton vient de
              l'environnement. <strong>HTTP</strong> (Streamable HTTP, sans session) pour l'usage distant, déployé
              sur Railway à côté de l'ingestion.
            </p>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-line">
          <div className="border-b border-line bg-panel2 px-4 py-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              {OUTILS_MCP.length} outils — tous en lecture, aucun n'écrit
            </h3>
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line/60">
              {OUTILS_MCP.map((o) => (
                <tr key={o.nom} className="transition hover:bg-panel2/60">
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-ink">{o.nom}</td>
                  <td className="px-4 py-2 text-xs text-ink-soft">{o.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-xs text-ink-faint">
          Ce que le serveur ne fait pas, et le dit au modèle : aucune écriture, trois fenêtres seulement
          (1h / 24h / 7d), aucun total sur les listes paginées. Une app demandée hors périmètre n'est pas refusée
          par l'API — elle est ramenée au périmètre du jeton ; l'outil le signale alors explicitement dans sa
          réponse, pour qu'un chiffre d'une autre app ne passe jamais pour celui demandé.
        </p>
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
                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-ink">
                  {e.method} {e.path}
                </td>
                <td className="px-4 py-2.5 text-xs text-ink-soft">{e.desc}</td>
              </tr>
            ))}
            <tr className="bg-panel2/40">
              <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-ink">POST /api/v1/deploys</td>
              <td className="px-4 py-2.5 text-xs text-ink-soft">
                Marqueur de déploiement (intégration CI/CD). Seule route en écriture — et la seule que le serveur
                MCP n'expose pas.
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Exemples ------------------------------------------------------------ */}
      <section className="card p-5">
        <h2 className="text-sm font-semibold text-ink">Exemples</h2>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-panel2 p-3 font-mono text-xs text-ink-soft">
{`# tableau de bord partenaire en un appel
curl -s -H "Authorization: Bearer $MIP_RUM_READ_TOKEN" \\
  "${PROD_BASE}/api/rum/summary?app=gip-plateforme&window=30d"

# détail : LCP p75 dans le temps (série)
curl -s -H "Authorization: Bearer $MIP_API_TOKEN" \\
  "${PROD_BASE}/api/v1/vitals?app=gip-plateforme&period=7d&series=LCP"`}
        </pre>
        <p className="mt-3 text-xs font-semibold text-ink">Brancher un agent IA en local (transport stdio)</p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-panel2 p-3 font-mono text-xs text-ink-soft">
{`{
  "mcpServers": {
    "mip-rum": {
      "command": "node",
      "args": ["services/mcp/stdio.mjs"],
      "env": {
        "MIP_CONSOLE_URL": "${PROD_BASE}",
        "MIP_API_TOKEN": "<jeton listé dans CONSOLE_API_TOKENS>"
      }
    }
  }
}`}
        </pre>
        <p className="mt-3 text-xs text-ink-faint">
          La correspondance <strong>graphe → endpoint → champs à tracer</strong> (pour reproduire les visuels
          de la console) est détaillée dans les docs liées ci-dessus ; la configuration MCP complète, transport
          distant compris, est dans <code className="chip-mono">docs/MCP.md</code>.
        </p>
      </section>
    </div>
  );
}
