// Page « API et MCP » — les deux manières de sortir la donnée du portail :
//   · l'API REST, pour un tableau de bord partenaire ou une chaîne d'intégration ;
//   · le serveur MCP, pour un agent IA.
// Une seule page parce qu'un seul socle : le serveur MCP est un CLIENT de
// l'API v1. Il n'ouvre aucun accès qu'un jeton n'ouvrait pas déjà.
//
// LA LISTE DES ROUTES N'EST PAS ÉCRITE ICI. Elle l'était, et elle a menti :
// elle annonçait `GET /api/v1/ai`, route supprimée du produit (la supervision IA
// est passée chez xSOM AI Guard, cf. ADR-0001). C'était la troisième copie de la
// même liste — spec OpenAPI, descripteur /api/v1, cette page — et la troisième
// avait dérivé. Elle vient de la spec (`buildOpenApi`), comme le descripteur :
// une seule source, celle qui sert aussi les schémas.
//
// CE QUE LA RECETTE DU 26/09/2026 A CHANGÉ. La page faisait 4 300 px et présentait
// le MCP trois fois (bloc « Brancher une IA », carte, section « Serveur MCP ») ;
// elle renvoyait à une variable serveur pour obtenir un jeton ; elle titrait
// « lecture seule » une liste qui contient `POST /deploys` ; deux styles de blocs
// de code coexistaient. D'où : un sommaire à ancres, un encart « Obtenir un
// jeton », une seule section MCP, et `CopyBlock` pour tout bloc de code.
import Link from "next/link";
import type { ReactNode } from "react";
import { CopyBlock } from "@/components/CopyBlock";
import { PageHeader } from "@/components/PageHeader";
import { TableDefilante } from "@/components/TableDefilante";
import { buildOpenApi, endpointsDeclares } from "@/lib/api/openapi";
import {
  CONSOLE_ORIGINE,
  MCP_ENDPOINT,
  commandeCli,
  configDistante,
  configLocale,
  curlVerification,
} from "@/lib/mcp-public";
import { sonderMcp } from "@/lib/mcp-sonde";
import { OUTILS } from "@mip/mcp-tools/lib/catalogue.mjs";

export const dynamic = "force-dynamic";

// Le dépôt s'appelle poc-MIP_RUM. Il était écrit `mip-rum` ici : les liens
// « Documentation » de cette page tombaient donc en 404 sur GitHub.
const GH_BASE = "https://github.com/jt33120/poc-MIP_RUM/blob/master/docs";

/** Une route de la référence : méthode, chemin, description, et si elle écrit. */
interface Route {
  method: string;
  path: string;
  desc: string;
  ecriture?: boolean;
}

/**
 * Les routes /api/v1 : les lectures GET de la spec, la lecture en POST de
 * l'Explorer (l'AST ne tient pas dans une URL), et l'unique écriture, le marqueur
 * de déploiement — hors spec, décrit ici à la main (cf. `buildOpenApi`).
 */
function routes(): Route[] {
  const paths = buildOpenApi().paths as Record<string, { post?: { summary?: string } }>;
  const posts: Route[] = Object.entries(paths)
    .filter(([, op]) => op.post)
    .map(([chemin, op]) => ({ method: "POST", path: `/api/v1${chemin}`, desc: op.post?.summary ?? "" }));
  return [
    ...endpointsDeclares(),
    ...posts,
    {
      method: "POST",
      path: "/api/v1/deploys",
      desc:
        "Marqueur de déploiement (intégration continue), avec le jeton de CI « deploys:write » d'une application ; " +
        "un jeton d'API y est encore accepté jusqu'au 31/12/2026. Le serveur MCP ne l'expose pas.",
      ecriture: true,
    },
  ];
}

const ROUTES = routes();

/** Dérivé du catalogue réellement enregistré par le serveur MCP. */
const OUTILS_MCP: { nom: string; desc: string }[] = OUTILS.map((outil) => ({
  nom: outil.nom,
  desc: outil.resume,
}));

/** Le sommaire : une ancre par section, dans l'ordre de la page. */
const SOMMAIRE = [
  { id: "jeton", titre: "Obtenir un jeton" },
  { id: "mcp", titre: "Brancher un agent IA (MCP)" },
  { id: "api", titre: "API REST" },
  { id: "routes", titre: "Routes /api/v1" },
  { id: "exemples", titre: "Exemples" },
] as const;

/** Titre de section à ancre ; `scroll-mt` : l'ancre ne passe pas sous le haut de page. */
function Section({ id, titre, children, badge }: { id: string; titre: string; children: ReactNode; badge?: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-titre`} className="card mb-6 min-w-0 scroll-mt-6 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-titre`} className="text-sm font-semibold text-ink">
          {titre}
        </h2>
        {badge}
      </div>
      {children}
    </section>
  );
}

function SousTitre({ children }: { children: ReactNode }) {
  return <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{children}</h3>;
}

// Cellules empilées sous 640 px : une route ou un outil se lit en fiche plutôt
// que dans une colonne tronquée (« Liveness (san… », recette du 26/09/2026).
const CELLULE_TETE = "block px-4 pt-2.5 font-mono text-xs text-ink sm:table-cell sm:whitespace-nowrap sm:py-2.5";
const CELLULE_DESC = "block px-4 pb-2.5 text-xs text-ink-soft sm:table-cell sm:py-2.5";

export default async function ApiDocs() {
  // L'adresse du serveur est une constante du dépôt ; son état, non. La page
  // interroge /health à chaque rendu pour ne pas distribuer une URL morte comme
  // si elle marchait. Échec doux : « pas pu vérifier » n'est pas « en panne ».
  const etat = await sonderMcp();
  const lectures = ROUTES.filter((r) => !r.ecriture).length;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="API et MCP"
        sub={
          <>
            Les agrégats RUM exposés de deux façons&nbsp;: une <strong>API REST</strong>, pour brancher un tableau de
            bord partenaire ou une chaîne d&apos;intégration, et un <strong>serveur MCP</strong>, pour qu&apos;un agent
            IA interroge la console en langage naturel. Des agrégats et des identifiants pseudonymes (visiteur,
            identité hachée)&nbsp;: aucune adresse IP.
          </>
        }
      />

      <nav aria-label="Sommaire de la page" className="card mb-6 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Sur cette page</p>
        <ol className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
          {SOMMAIRE.map((s, i) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="text-accent-ink underline-offset-2 hover:underline">
                {i + 1}. {s.titre}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {/* 1. Obtenir un jeton ---------------------------------------------------- */}
      <Section id="jeton" titre="Obtenir un jeton">
        <p className="mt-2 text-xs leading-relaxed text-ink-soft">
          Trois jetons, trois usages. Chacun se passe dans l&apos;en-tête{" "}
          <code className="chip-mono">Authorization: Bearer &lt;jeton&gt;</code>, d&apos;un serveur à un autre&nbsp;:
          un jeton reste côté serveur, jamais dans un navigateur. Un jeton limité à une application ne voit que
          celle-là, ici comme ailleurs.
        </p>
        <TableDefilante className="mt-3 rounded-xl border border-line" label="Jetons et usages">
          <table className="w-full text-left text-xs">
            <thead className="hidden bg-panel2 sm:table-header-group">
              <tr>
                <th scope="col" className="th">Jeton</th>
                <th scope="col" className="th">Sert à</th>
                <th scope="col" className="th">Qui le délivre</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              <tr className="block sm:table-row">
                <th scope="row" className="block px-4 pt-2.5 font-semibold text-ink sm:table-cell sm:py-2.5">
                  Jeton de lecture
                </th>
                <td className="block px-4 py-1 text-ink-soft sm:table-cell sm:py-2.5">
                  La synthèse d&apos;une application&nbsp;: <code className="chip-mono">GET /api/rum/summary</code>
                </td>
                <td className="block px-4 pb-2.5 text-ink-soft sm:table-cell sm:py-2.5">
                  Un administrateur, depuis l&apos;écran{" "}
                  <Link href="/admin/read-tokens" className="text-accent-ink underline-offset-2 hover:underline">
                    Jetons de lecture
                  </Link>
                  . Affiché une seule fois.
                </td>
              </tr>
              <tr className="block sm:table-row">
                <th scope="row" className="block px-4 pt-2.5 font-semibold text-ink sm:table-cell sm:py-2.5">
                  Jeton d&apos;API
                </th>
                <td className="block px-4 py-1 text-ink-soft sm:table-cell sm:py-2.5">
                  Les routes <code className="chip-mono">/api/v1</code> et le serveur MCP, sur toutes les applications
                  ou sur une liste.
                </td>
                <td className="block px-4 pb-2.5 text-ink-soft sm:table-cell sm:py-2.5">
                  L&apos;exploitant de la plateforme, sur demande&nbsp;: il ne se crée pas depuis la console.
                </td>
              </tr>
              <tr className="block sm:table-row">
                <th scope="row" className="block px-4 pt-2.5 font-semibold text-ink sm:table-cell sm:py-2.5">
                  Jeton de CI
                </th>
                <td className="block px-4 py-1 text-ink-soft sm:table-cell sm:py-2.5">
                  Poser un marqueur de déploiement (<code className="chip-mono">POST /api/v1/deploys</code>) ou
                  envoyer des source maps.
                </td>
                <td className="block px-4 pb-2.5 text-ink-soft sm:table-cell sm:py-2.5">
                  Un administrateur, depuis l&apos;écran{" "}
                  <Link href="/admin/sourcemaps" className="text-accent-ink underline-offset-2 hover:underline">
                    Source maps
                  </Link>
                  , un privilège par jeton.
                </td>
              </tr>
            </tbody>
          </table>
        </TableDefilante>
        <p className="mt-3 text-xs text-ink-faint">
          Connecté à la console, votre navigateur appelle aussi les routes de lecture{" "}
          <code className="chip-mono">/api/v1</code> avec votre session, dans la limite de vos applications.
        </p>
      </Section>

      {/* 2. MCP — présenté une seule fois ------------------------------------------ */}
      <Section
        id="mcp"
        titre="Brancher un agent IA (serveur MCP)"
        badge={
          // L'état est MESURÉ, pas affirmé : une pastille verte sur un service
          // mort serait pire que pas de pastille du tout.
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              etat.joignable ? "bg-good/15 text-good-ink" : "bg-warn/15 text-warn-ink"
            }`}
          >
            {etat.joignable ? `En ligne${etat.version ? ` · v${etat.version}` : ""}` : `État non vérifié — ${etat.motif}`}
          </span>
        }
      >
        <p className="mt-2 text-xs leading-relaxed text-ink-soft">
          Le <strong>Model Context Protocol</strong> est la prise standard entre un modèle et un système. Copiez
          l&apos;adresse ci-dessous dans un client compatible (Claude Code, Claude Desktop, un IDE)&nbsp;: l&apos;agent
          obtient {OUTILS_MCP.length} outils de lecture et peut répondre à «&nbsp;quelles routes se sont dégradées
          cette semaine, et sur quels appareils&nbsp;?&nbsp;» sans que personne n&apos;écrive une requête. Le serveur
          est un <strong>client de l&apos;API v1</strong>&nbsp;: il n&apos;accède pas à la base et n&apos;ouvre aucun
          droit qu&apos;un jeton n&apos;ouvrait pas déjà.
        </p>

        <div className="mt-4">
          <SousTitre>Adresse du serveur</SousTitre>
          <div className="mt-1.5">
            <CopyBlock code={MCP_ENDPOINT} label="Copier l'adresse" />
          </div>
          <p className="mt-1.5 text-xs text-ink-faint">
            Le chemin <code className="chip-mono">/mcp</code> fait partie de l&apos;adresse. La racine et{" "}
            <code className="chip-mono">/health</code> ne servent qu&apos;aux sondes.
          </p>
        </div>

        <div className="mt-4 rounded-xl border border-warn/30 bg-warn/5 p-3">
          <SousTitre>Un jeton est requis</SousTitre>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">
            Remplacez <code className="chip-mono">VOTRE_JETON</code> par votre{" "}
            <a href="#jeton" className="text-accent-ink underline-offset-2 hover:underline">
              jeton d&apos;API
            </a>
            , le même que pour <code className="chip-mono">/api/v1</code>. Le serveur n&apos;en détient aucun&nbsp;: il{" "}
            <strong>relaie le vôtre</strong> à l&apos;API sans le conserver. Une adresse MCP découverte par un tiers ne
            donne donc rien sans jeton.
          </p>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="min-w-0">
            <SousTitre>Configuration du client (fichier JSON)</SousTitre>
            <div className="mt-1.5">
              <CopyBlock code={configDistante()} label="Copier la configuration" />
            </div>
            <p className="mt-1.5 text-xs text-ink-faint">
              Le champ <code className="chip-mono">&quot;type&quot;: &quot;http&quot;</code> est{" "}
              <strong>obligatoire</strong>&nbsp;: une entrée qui porte <code className="chip-mono">url</code> sans{" "}
              <code className="chip-mono">type</code> est lue comme un serveur local et échoue.
            </p>
          </div>
          <div className="min-w-0">
            <SousTitre>Ou en une commande</SousTitre>
            <div className="mt-1.5">
              <CopyBlock code={commandeCli()} label="Copier" />
            </div>
            <p className="mt-1.5 text-xs text-ink-faint">
              Le client garde alors l&apos;en-tête et l&apos;envoie à chaque appel.
            </p>
          </div>
        </div>

        {/* Pleine largeur : ces lignes sont longues, les serrer dans une colonne
            les rendrait illisibles avant même d'être copiées. */}
        <div className="mt-4">
          <SousTitre>Vérifier soi-même — le troisième appel doit échouer</SousTitre>
          <div className="mt-1.5">
            <CopyBlock code={curlVerification()} label="Copier les tests" />
          </div>
          <p className="mt-1.5 text-xs text-ink-faint">
            Ne tester que le cas qui passe ne dit pas si le serveur est ouvert à tous. Le troisième appel, sans jeton,
            doit répondre <code className="chip-mono">401</code>.
          </p>
        </div>

        <details className="mt-4 rounded-xl border border-line bg-panel2/50 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-ink">
            Sur votre poste plutôt qu&apos;à distance (transport stdio)
          </summary>
          <p className="mt-2 text-xs leading-relaxed text-ink-soft">
            Le serveur tourne alors sur votre poste, depuis une copie du code source, et le jeton vient de
            l&apos;environnement&nbsp;: il n&apos;y a pas de requête HTTP entrante pour le porter.
          </p>
          <div className="mt-2">
            <CopyBlock code={configLocale()} label="Copier la configuration locale" />
          </div>
        </details>

        <div className="mt-4">
          <SousTitre>{OUTILS_MCP.length} outils, tous en lecture</SousTitre>
          <TableDefilante className="mt-1.5 rounded-xl border border-line" label="Outils du serveur MCP">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-line/60">
                {OUTILS_MCP.map((o) => (
                  <tr key={o.nom} className="block transition hover:bg-panel2/60 sm:table-row">
                    <td className={CELLULE_TETE}>{o.nom}</td>
                    <td className={CELLULE_DESC}>{o.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableDefilante>
          <p className="mt-3 text-xs text-ink-faint">
            Ce que le serveur ne fait pas, et le dit au modèle&nbsp;: aucune écriture, trois fenêtres seulement (1&nbsp;h,
            24&nbsp;h, 7&nbsp;jours), et aucun total sur la liste des sessions (les groupes d&apos;erreurs et
            l&apos;Explorer d&apos;événements en fournissent un). Une application demandée hors périmètre est refusée
            (403), jamais remplacée par une autre&nbsp;; et quand le détail d&apos;un groupe d&apos;erreurs ou d&apos;une
            issue porte une autre application que celle demandée, l&apos;outil le signale, pour qu&apos;un chiffre
            d&apos;une autre application ne passe jamais pour celui demandé.
          </p>
        </div>
      </Section>

      {/* 3. API REST ---------------------------------------------------------- */}
      <Section id="api" titre="API REST">
        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="min-w-0 rounded-xl border border-line bg-panel2/50 p-4">
            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent-ink">
              Recommandé pour un partenaire
            </span>
            <h3 className="mt-2 font-mono text-sm font-semibold text-ink">GET /api/rum/summary</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
              <strong>Un seul appel</strong>, une application&nbsp;: trafic, Core Web Vitals, routes et erreurs
              principales, dans une réponse stable. Fenêtre <code className="chip-mono">window=24h|7d|30d</code> (30
              jours par défaut). Avec un <a href="#jeton" className="text-accent-ink underline-offset-2 hover:underline">jeton de lecture</a>.
            </p>
            <a
              href={`${GH_BASE}/RUM_READ_API.md`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-xs font-medium text-accent-ink underline-offset-2 hover:underline"
            >
              Documentation détaillée de la synthèse →
            </a>
          </div>
          <div className="min-w-0 rounded-xl border border-line bg-panel2/50 p-4">
            <span className="rounded-full bg-panel px-2 py-0.5 text-[11px] font-semibold text-ink-soft ring-1 ring-line">
              Détail par domaine
            </span>
            <h3 className="mt-2 font-mono text-sm font-semibold text-ink">/api/v1/*</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
              {lectures} routes de lecture détaillées (vitals en série, carte de santé, traçage…) et une route
              d&apos;écriture, le marqueur de déploiement. Avec un{" "}
              <a href="#jeton" className="text-accent-ink underline-offset-2 hover:underline">jeton d&apos;API</a> ou la
              session de la console. Enveloppe stable <code className="chip-mono">{"{ meta, data }"}</code>. C&apos;est
              cette API que consomme le serveur MCP.
            </p>
            <a
              href={`${GH_BASE}/API_CONSOLE.md`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-xs font-medium text-accent-ink underline-offset-2 hover:underline"
            >
              Documentation détaillée de l&apos;API →
            </a>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="min-w-0">
            <SousTitre>Filtres communs des routes /api/v1</SousTitre>
            <div className="mt-1.5 flex flex-wrap gap-2 text-xs">
              {["app=<application>|all", "period=1h|24h|7d", "from=…&to=… (30 jours au plus)", "device=mobile|desktop|tablet|all"].map(
                (c) => (
                  <span key={c} className="chip-mono">
                    {c}
                  </span>
                ),
              )}
            </div>
          </div>
          <div className="min-w-0">
            <SousTitre>Explorer et tester</SousTitre>
            <ul className="mt-1.5 space-y-1 text-xs">
              <li>
                <a href="/api/v1/docs" target="_blank" rel="noopener noreferrer" className="text-accent-ink underline-offset-2 hover:underline">
                  Swagger UI →
                </a>{" "}
                <span className="text-ink-faint">toutes les routes, leurs paramètres et leurs réponses, testables.</span>
              </li>
              <li>
                <a href="/api/v1/openapi" target="_blank" rel="noopener noreferrer" className="text-accent-ink underline-offset-2 hover:underline">
                  Spécification OpenAPI 3.0 (JSON) →
                </a>{" "}
                <span className="text-ink-faint">à brancher dans un générateur de client, Postman ou Insomnia.</span>
              </li>
            </ul>
          </div>
        </div>
      </Section>

      {/* 4. Routes /api/v1 — une écriture y figure : pas de « lecture seule » ---- */}
      <Section id="routes" titre="Routes /api/v1">
        <TableDefilante className="mt-3 rounded-xl border border-line" label="Routes /api/v1">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line/60">
              {ROUTES.map((e) => (
                <tr
                  key={`${e.method} ${e.path}`}
                  className={`block transition hover:bg-panel2/60 sm:table-row ${e.ecriture ? "bg-panel2/40" : ""}`}
                >
                  <td className={CELLULE_TETE}>
                    {e.method} {e.path}
                    {e.ecriture && (
                      <span className="ml-2 rounded-full bg-warn/15 px-2 py-0.5 font-sans text-[11px] font-semibold text-warn-ink">
                        écriture
                      </span>
                    )}
                  </td>
                  <td className={CELLULE_DESC}>{e.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableDefilante>
      </Section>

      {/* 5. Exemples — le même bloc de code que partout ailleurs sur la page ----- */}
      <Section id="exemples" titre="Exemples">
        <div className="mt-3">
          <CopyBlock
            label="Copier"
            code={[
              "# La synthèse d'une application, en un appel (jeton de lecture)",
              `curl -s -H "Authorization: Bearer $JETON_LECTURE" \\`,
              `  "${CONSOLE_ORIGINE}/api/rum/summary?app=mon-app&window=30d"`,
              "",
              "# Le détail : LCP p75 dans le temps, sur 7 jours (jeton d'API)",
              `curl -s -H "Authorization: Bearer $JETON_API" \\`,
              `  "${CONSOLE_ORIGINE}/api/v1/vitals?app=mon-app&period=7d&series=LCP"`,
            ].join("\n")}
          />
        </div>
        <p className="mt-3 text-xs text-ink-faint">
          La synthèse prend une fenêtre (<code className="chip-mono">window</code>)&nbsp;; les routes{" "}
          <code className="chip-mono">/api/v1</code>, une période (<code className="chip-mono">period</code>) ou une
          plage (<code className="chip-mono">from</code>, <code className="chip-mono">to</code>). La correspondance
          entre les graphiques de la console, les routes et les champs à tracer est détaillée dans la documentation de
          l&apos;API.
        </p>
      </Section>
    </div>
  );
}
