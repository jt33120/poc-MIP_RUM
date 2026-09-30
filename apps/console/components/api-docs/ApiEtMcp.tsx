// La page « API et MCP », resserrée (recette du 30/09/2026 : « à simplifier et rendre
// propre, avec en haut installer en MCP et le lien des swagger, trop long sinon »).
//
// L'ORDRE EST CELUI DU BESOIN. En haut, côte à côte, les deux manières de sortir la
// donnée : brancher un agent IA (adresse, commande d'une ligne, état en ligne) et
// l'API REST (adresse de base, Swagger UI, spécification OpenAPI). Puis les trois
// jetons, une ligne chacun. Le reste — routes, exemples, autres clients, outils —
// est REPLIÉ : une ligne chacun tant qu'on ne l'ouvre pas.
//
// AUCUNE PHRASE À L'ÉCRAN. Ce qui explique (le protocole, le relais du jeton, la
// session du navigateur, le champ « type » obligatoire, le troisième appel qui doit
// échouer) passe dans une bulle ou dans le repli qui le concerne : ces vérités se
// déplacent, elles ne se suppriment pas.
//
// Rendu serveur sans état : l'état en ligne du serveur MCP arrive par `etatMcp`,
// que la page enveloppe d'un <Suspense> — la sonde ne retient pas l'affichage.
import type { ReactNode } from "react";
import { OUTILS } from "@mip/mcp-tools/lib/catalogue.mjs";
import { CopyBlock } from "@/components/CopyBlock";
import { InfoTip } from "@/components/InfoTip";
import { TableDefilante } from "@/components/TableDefilante";
import { ICON_PATHS, Icon, type IconName } from "@/components/icons";
import { ChampCopiable } from "@/components/api-docs/ChampCopiable";
import {
  FILTRES_API,
  JETONS,
  MARQUE_JETON,
  adresseMcp,
  appelsDeVerification,
  baseApi,
  commandeClaudeCode,
  configurationJson,
  configurationStdio,
  exemplesApi,
  routesApi,
} from "@/lib/api-docs";
import { DEPOT_GITHUB } from "@/lib/vitrine-navigation";

const DOC = (fichier: string) => `${DEPOT_GITHUB}/blob/master/docs/${fichier}`;

const SURTITRE = "text-[11px] font-semibold uppercase tracking-wider text-ink-faint";
const PUCE = "inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-line bg-panel2 px-1.5 py-0.5 text-[11px] text-ink-soft";
const LIEN_EXTERNE =
  "inline-flex items-center justify-center gap-1 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-perf/40 hover:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf";
const TH = "px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-faint";
const TD = "px-3 py-1.5 align-top";

/** Un lien qui quitte la console : ↗ après le libellé (charte § 3.10), dit aussi aux lecteurs d'écran. */
function LienExterne({ href, children, className = LIEN_EXTERNE, testId }: { href: string; children: ReactNode; className?: string; testId?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className} data-testid={testId}>
      {children}
      <span aria-hidden>↗</span>
      <span className="sr-only"> (nouvel onglet)</span>
    </a>
  );
}

function EnTeteBloc({ icone, id, titre, aide, droite }: { icone: IconName; id: string; titre: string; aide: ReactNode; droite?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-perf/10 text-perf">
        <Icon paths={ICON_PATHS[icone]} className="h-4 w-4" />
      </span>
      <h2 id={id} className="min-w-0 text-sm font-semibold text-ink">
        {titre}
      </h2>
      <InfoTip label={`À propos : ${titre}`} align="start">
        {aide}
      </InfoTip>
      {droite && <span className="ml-auto shrink-0">{droite}</span>}
    </div>
  );
}

function Champ({ libelle, aide, children }: { libelle: string; aide?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className={`mb-1 flex items-center gap-1.5 ${SURTITRE}`}>
        {libelle}
        {aide && (
          <InfoTip label={`Aide : ${libelle}`} align="start">
            {aide}
          </InfoTip>
        )}
      </div>
      {children}
    </div>
  );
}

/** Un repli d'une ligne : titre, compte, et ce qu'il contient en petit à droite. */
function Repli({ titre, compte, resume, testId, children }: { titre: string; compte?: number; resume: string; testId: string; children: ReactNode }) {
  return (
    <details className="card group min-w-0 overflow-hidden" data-testid={testId}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-perf [&::-webkit-details-marker]:hidden">
        <Icon paths={ICON_PATHS.chevronRight} className="h-4 w-4 shrink-0 text-ink-faint transition-transform group-open:rotate-90" />
        <span className="min-w-0 truncate">{titre}</span>
        {compte !== undefined && <span className="shrink-0 tabular-nums text-ink-faint">{compte}</span>}
        <span className="ml-auto hidden truncate text-xs font-normal text-ink-faint sm:inline">{resume}</span>
      </summary>
      <div className="border-t border-line">{children}</div>
    </details>
  );
}

function PastilleMethode({ methode, ecriture }: { methode: string; ecriture?: boolean }) {
  // Pas de couleur de verdict (charte § 3.11) : la lecture est neutre, le POST porte
  // la teinte du domaine ; l'écriture le dit en toutes lettres.
  return (
    <span
      className={`inline-block w-11 rounded px-1 py-0.5 text-center font-mono text-[10px] font-semibold ${
        methode === "GET" ? "bg-panel2 text-ink-soft" : "bg-perf/10 text-perf"
      }`}
    >
      {methode}
      {ecriture && <span className="sr-only"> (écriture)</span>}
    </span>
  );
}

export function ApiEtMcp({
  origine,
  origineMcp,
  etatMcp,
}: {
  /** Origine publique de la console (`https://…`). */
  origine: string;
  /** Origine du serveur MCP distant. */
  origineMcp: string;
  /** Pastille d'état du serveur MCP (rendue par la page, sous <Suspense>). */
  etatMcp?: ReactNode;
}) {
  const adresse = adresseMcp(origineMcp);
  const base = baseApi(origine);
  const routes = routesApi();
  const lectures = routes.filter((r) => !r.ecriture).length;
  const ecritures = routes.length - lectures;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="grid min-w-0 gap-2 lg:grid-cols-2">
        {/* ── Brancher un agent IA ─────────────────────────────────────────── */}
        <section className="card flex min-w-0 flex-col gap-3 p-4" aria-labelledby="bloc-mcp-titre" data-testid="bloc-mcp">
          <EnTeteBloc
            icone="ai"
            id="bloc-mcp-titre"
            titre="Brancher un agent IA (MCP)"
            droite={etatMcp}
            aide={
              <>
                Le Model Context Protocol est la prise standard entre un modèle et un système : Claude, Cursor,
                VS Code ou tout client compatible. Le serveur ne détient aucun jeton : il relaie le vôtre à
                l&apos;API sans le conserver, et ne voit donc que les applications de votre jeton.
              </>
            }
          />
          <Champ libelle="Adresse du serveur">
            <ChampCopiable valeur={adresse} libelle="Adresse du serveur MCP" testId="mcp-adresse" />
          </Champ>
          <Champ
            libelle="Claude Code, en une commande"
            aide={
              <>
                Remplacez {MARQUE_JETON} par votre jeton d&apos;API, le même que pour /api/v1. Un jeton
                d&apos;accès (synthèse d&apos;une application) n&apos;ouvre pas ce serveur.
              </>
            }
          >
            <ChampCopiable valeur={commandeClaudeCode(adresse)} libelle="Commande Claude Code" testId="mcp-commande" />
          </Champ>
          <ul className="mt-auto flex flex-wrap items-center gap-1.5" aria-label="Le serveur MCP en bref">
            <li className={PUCE}>
              <span className="font-semibold tabular-nums text-ink">{OUTILS.length}</span> outils
            </li>
            <li className={PUCE}>lecture seule</li>
            <li className={PUCE}>jeton d&apos;API</li>
            <li className={PUCE} title="Aucun outil n'accepte de dates libres ; les tendances portent sur les 14 derniers jours complets.">
              1 h · 24 h · 7 j
            </li>
            <li className="ml-auto">
              <LienExterne href={DOC("MCP.md")} className="text-xs font-medium text-perf hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf">
                Documentation
              </LienExterne>
            </li>
          </ul>
        </section>

        {/* ── API REST ─────────────────────────────────────────────────────── */}
        <section className="card flex min-w-0 flex-col gap-3 p-4" aria-labelledby="bloc-api-titre" data-testid="bloc-api">
          <EnTeteBloc
            icone="fileCode"
            id="bloc-api-titre"
            titre="API REST"
            aide={
              <>
                Enveloppe stable {"{ meta, data }"} : meta dit l&apos;application, la période et les filtres
                réellement appliqués. Connecté à la console, votre navigateur appelle aussi les routes de lecture
                /api/v1 avec votre session, dans la limite de vos applications. La synthèse prend une fenêtre
                (window) ; les routes /api/v1, une période (period) ou une plage (from, to).
              </>
            }
          />
          <Champ libelle="Adresse de base">
            <ChampCopiable valeur={base} libelle="Adresse de base de l'API" testId="api-base" />
          </Champ>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <LienExterne href="/api/v1/docs" testId="api-swagger">
              Swagger UI
            </LienExterne>
            <LienExterne href="/api/v1/openapi" testId="api-openapi">
              OpenAPI 3.0 (JSON)
            </LienExterne>
          </div>
          <ul className="mt-auto flex flex-wrap items-center gap-1.5" aria-label="L'API en bref">
            <li className={PUCE}>
              <span className="font-semibold tabular-nums text-ink">{lectures}</span> lectures
            </li>
            <li className={PUCE}>
              <span className="font-semibold tabular-nums text-ink">{ecritures}</span> écriture
            </li>
            <li className={PUCE}>JSON</li>
            <li className="ml-auto">
              <LienExterne href={DOC("API_CONSOLE.md")} className="text-xs font-medium text-perf hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf">
                Documentation
              </LienExterne>
            </li>
          </ul>
        </section>
      </div>

      {/* ── Les trois jetons ───────────────────────────────────────────────── */}
      <section className="card min-w-0 overflow-hidden" aria-labelledby="jetons-titre" data-testid="jetons">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <Icon paths={ICON_PATHS.key} className="h-4 w-4 shrink-0 text-ink-faint" />
          <h2 id="jetons-titre" className="text-sm font-semibold text-ink">
            Jetons
          </h2>
          <code className="chip-mono">Authorization: Bearer &lt;jeton&gt;</code>
          <InfoTip label="À propos des jetons" align="start">
            Trois jetons, trois usages. Chacun se passe dans cet en-tête, d&apos;un serveur à un autre : un jeton
            reste côté serveur, jamais dans une page web. Un jeton d&apos;accès ou de CI ne s&apos;affiche
            qu&apos;une fois, à sa création : copiez-le à ce moment.
          </InfoTip>
        </div>
        <TableDefilante label="Jetons">
          {/* Largeurs fixées : en disposition automatique, les colonnes courtes
              s'élargissaient et les longues passaient sur trois lignes. */}
          <table className="w-full min-w-[880px] table-fixed text-[13px]">
            <caption className="sr-only">Les trois jetons : usage, droits, applications couvertes, validité et où les obtenir</caption>
            <colgroup>
              <col className="w-[10%]" />
              <col className="w-[26%]" />
              <col className="w-[22%]" />
              <col className="w-[13%]" />
              <col className="w-[9%]" />
              <col className="w-[20%]" />
            </colgroup>
            <thead className="bg-panel2/60">
              <tr>
                <th scope="col" className={TH}>Jeton</th>
                <th scope="col" className={TH}>Sert à</th>
                <th scope="col" className={TH}>Droits</th>
                <th scope="col" className={TH}>Applications</th>
                <th scope="col" className={TH}>Validité</th>
                <th scope="col" className={TH}>Où l&apos;obtenir</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {JETONS.map((j) => (
                <tr key={j.nom} data-testid="jeton-ligne">
                  <th scope="row" className={`${TD} whitespace-nowrap text-left font-semibold text-ink`}>
                    {j.nom}
                    {j.prefixe && <span className="block font-mono text-[11px] font-normal text-ink-faint">{j.prefixe}…</span>}
                  </th>
                  <td className={`${TD} text-ink-soft`}>
                    {j.usage}
                    <span className="block font-mono text-[11px] text-ink-faint">{j.ouvre}</span>
                  </td>
                  <td className={`${TD} text-ink-soft`}>
                    {j.droits}
                    {j.privileges && <span className="block font-mono text-[11px] text-ink-faint">{j.privileges}</span>}
                  </td>
                  <td className={`${TD} text-ink-soft`}>{j.portee}</td>
                  <td className={`${TD} whitespace-nowrap tabular-nums text-ink-soft`}>{j.validite}</td>
                  <td className={TD}>
                    {j.source.href ? (
                      <a href={j.source.href} className="whitespace-nowrap font-medium text-perf hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf">
                        {j.source.libelle}
                      </a>
                    ) : (
                      <span className="text-ink-soft">{j.source.libelle}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableDefilante>
      </section>

      {/* ── Le détail, replié ──────────────────────────────────────────────── */}
      <Repli titre="Routes de l'API v1" compte={routes.length} resume="méthode, chemin, rôle · filtres communs" testId="api-routes">
        <TableDefilante label="Routes de l'API v1">
          <table className="w-full min-w-[640px] text-xs">
            <caption className="sr-only">Routes de l&apos;API v1 : {lectures} lectures et {ecritures} écriture</caption>
            <thead className="bg-panel2/60">
              <tr>
                <th scope="col" className={TH}>Méthode</th>
                <th scope="col" className={TH}>Chemin</th>
                <th scope="col" className={TH}>Rôle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {routes.map((r) => (
                <tr key={`${r.methode} ${r.chemin}`}>
                  <td className={TD}>
                    <PastilleMethode methode={r.methode} ecriture={r.ecriture} />
                  </td>
                  <td className={`${TD} whitespace-nowrap font-mono text-ink`}>{r.chemin}</td>
                  <td className={`${TD} text-ink-soft`}>
                    {r.description}
                    {r.ecriture && <span className="ml-1.5 rounded bg-panel2 px-1 text-[10px] font-semibold uppercase text-ink-soft">écriture</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableDefilante>
        <div className="border-t border-line px-4 py-3">
          <div className={`mb-1.5 ${SURTITRE}`}>Filtres communs des routes /api/v1</div>
          <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[max-content_1fr]">
            {FILTRES_API.map(([cle, sens]) => (
              <div key={cle} className="contents">
                <dt className="font-mono text-ink">{cle}</dt>
                <dd className="text-ink-soft">{sens}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Repli>

      <Repli titre="Exemples d'appels" compte={3} resume="curl, un par jeton" testId="api-exemples">
        <div className="p-3">
          <CopyBlock code={exemplesApi(origine)} label="Copier les exemples" />
        </div>
      </Repli>

      <Repli titre="Autres clients MCP, vérification, poste local" resume="configuration JSON · trois appels de contrôle · transport stdio" testId="mcp-autres">
        <div className="grid min-w-0 gap-3 p-3 lg:grid-cols-2">
          <div className="min-w-0">
            <Champ
              libelle="Configuration JSON (Claude Desktop, Cursor, VS Code…)"
              aide={
                <>
                  Le champ &quot;type&quot;: &quot;http&quot; est obligatoire : une entrée qui porte url sans type est
                  lue comme un serveur local, et échoue.
                </>
              }
            >
              <CopyBlock code={configurationJson(adresse)} label="Copier la configuration" />
            </Champ>
          </div>
          <div className="min-w-0">
            <Champ
              libelle="Vérifier soi-même : le troisième appel doit échouer"
              aide={<>Ne tester que le cas qui passe ne dit pas si le serveur est ouvert à tous : sans jeton, il doit répondre 401.</>}
            >
              <CopyBlock code={appelsDeVerification(origineMcp)} label="Copier les appels" />
            </Champ>
          </div>
          <div className="min-w-0 lg:col-span-2">
            <Champ
              libelle="Sur votre poste plutôt qu'à distance (transport stdio)"
              aide={
                <>
                  Depuis un clone du dépôt, après pnpm install : le client lance le serveur lui-même. L&apos;adresse de
                  la console et le jeton d&apos;API passent par l&apos;environnement ; sans eux, le serveur refuse de
                  démarrer.
                </>
              }
            >
              <CopyBlock code={configurationStdio(origine)} label="Copier la configuration locale" />
            </Champ>
          </div>
        </div>
      </Repli>

      <Repli titre="Outils du serveur MCP" compte={OUTILS.length} resume="tous en lecture · les mêmes routes que l'API" testId="mcp-outils">
        <TableDefilante label="Outils du serveur MCP">
          <table className="w-full min-w-[640px] text-xs">
            <caption className="sr-only">Les {OUTILS.length} outils du serveur MCP, tous en lecture</caption>
            <thead className="bg-panel2/60">
              <tr>
                <th scope="col" className={TH}>Outil</th>
                <th scope="col" className={TH}>Lit</th>
                <th scope="col" className={TH}>Route</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {OUTILS.map((o) => (
                <tr key={o.nom}>
                  <td className={`${TD} whitespace-nowrap font-mono text-ink`}>{o.nom}</td>
                  <td className={`${TD} text-ink-soft`}>{o.titre}</td>
                  <td className={`${TD} whitespace-nowrap font-mono text-ink-faint`}>{o.chemin}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableDefilante>
      </Repli>
    </div>
  );
}
