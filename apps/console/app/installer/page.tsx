// « Installer » : poser MIP RUM sur l'application sélectionnée, pas à pas, selon
// trois parcours — le code de suivi (tous les visiteurs), l'extension navigateur
// (les postes équipés), le serveur (recommandé en complément) —, chacun terminé par un test
// « ça arrive » en direct.
//
// LECTEUR : l'équipe technique du client, et son service informatique pour
// l'extension ; pas un opérateur MIP. D'où une page qui suit l'application
// sélectionnée (le client y a accès, `resolveScope`), et non la fiche d'un client,
// réservée aux administrateurs. Les valeurs sont préremplies ; ce que seul
// l'administrateur peut faire (clé, domaines) est dit, avec le lien s'il est là.
//
// LE TEST « ÇA ARRIVE » relit la page toutes les 5 s (`ParcoursInstallation`), et
// s'arrête au vert ou après 10 minutes : la base est payée à l'usage.
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ECRANS } from "@mip/console-contract";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { InfoTip } from "@/components/InfoTip";
import { PageHeader } from "@/components/PageHeader";
import { ChoixParcours } from "@/components/installer/ChoixParcours";
import { ParcoursExtension, ParcoursServeur, ParcoursSnippet, type ContexteParcours } from "@/components/installer/Parcours";
import { ParcoursInstallation } from "@/components/installer/ParcoursInstallation";
import { TableauPersonnalisation } from "@/components/installer/TableauPersonnalisation";
import { SecretFourni } from "@/components/secret/SecretUnique";
import { CadreEtat, EtatSurface } from "@/components/states/EtatSurface";
import { chargerInstaller } from "@/lib/chargeurs/installer";
import { chargerEcran } from "@/lib/ecran";
import { ZIP_EXTENSION, strategieExtension, strategieNommage } from "@/lib/extension-deploiement";
import type { SearchParams } from "@/lib/filters";
import { ingestEndpoint, voieRecommandee } from "@/lib/ingest-endpoint";
import {
  PARCOURS,
  appelInit,
  codeNextAppRouter,
  codeNextPagesRouter,
  directivesCsp,
  domainesExtension,
  personnalisation,
  toutVert,
  verificationsDe,
  type Parcours,
  type SondeInstallation,
} from "@/lib/installer";
import { buildInjectionArtifacts, buildSnippet } from "@/lib/onboarding";
import { promptExtension, promptSdk, promptServeur } from "@/lib/prompts-ia";
import { recettesAgentsOtel } from "@/lib/recettes-agents-otel";
import { cleDe } from "@/lib/secret-remis";

export const dynamic = "force-dynamic";

const TITRE = "Installer";

/** Un objet par parcours, dans l'ordre des parcours. */
const parParcours = <T,>(f: (p: Parcours) => T) => Object.fromEntries(PARCOURS.map((p) => [p, f(p)])) as Record<Parcours, T>;

export default async function Installer({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const sp = (await searchParams) ?? {};
  const ecran = await chargerEcran(ECRANS.installer, chargerInstaller, sp);
  if (ecran.etat === "refus") return <FilterProblemNotice title={TITRE} problem={ecran.problem} />;
  // Le middleware pose toujours `?app=` sur un écran de console ; sans lui, le choix du projet.
  if (ecran.etat === "sans_app") redirect("/select");
  if (ecran.etat === "introuvable") {
    return (
      <div className="min-w-0 max-w-4xl animate-fade-up" data-testid="installer">
        <PageHeader title={TITRE} domain="integrations" />
        <CadreEtat ton="neutre" role="status" testId="application-inconnue">
          L&apos;application <code className="chip-mono">{ecran.app}</code> n&apos;existe pas dans le registre de MIP.{" "}
          <Link href="/select" className="font-medium text-brand hover:underline">
            Choisir un projet
          </Link>
        </CadreEtat>
      </div>
    );
  }

  const { app, administrable, config, domaines, sonde } = ecran;
  // Sans sa configuration, la page n'a rien de juste à préremplir. (Une application
  // absente du registre est déjà rendue « introuvable » par le chargeur.)
  const c = config.ok ? config.data : null;
  if (!c) {
    return (
      <div className="min-w-0 max-w-4xl animate-fade-up" data-testid="installer">
        <PageHeader title={TITRE} domain="integrations" />
        <EtatSurface etat={{ kind: "erreur", titre: "configuration de l'application" }} />
      </div>
    );
  }

  // Les adresses publiques, comme la fiche d'un client : le SDK est servi par cette
  // console, la collecte vient d'`ingestEndpoint` (aucune adresse écrite en dur).
  const host = (await headers()).get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  const sdkUrl = `${proto}://${host}/mip-rum.js`;
  // Collecte directe (P6b.G), comme la fiche d'un client : dès que sa variable est
  // posée, le code du navigateur vise le collecteur (le pays vient de l'adresse IP),
  // et celui par la console reste à côté pour une CSP qui fige `connect-src`. Le
  // serveur passe TOUJOURS par la console : son adresse ne dit rien d'un visiteur.
  const voie = voieRecommandee();
  const endpoint = ingestEndpoint("traces", host, voie);
  const endpointConsole = ingestEndpoint("traces", host);
  const endpointLogs = ingestEndpoint("logs", host);

  const base = { sdkUrl, endpoint, appId: app, clientId: c.client_id };
  const snippet = buildSnippet({ ...base, withConsent: false, voie });
  const snippetConsent = buildSnippet({ ...base, withConsent: true, voie });
  const injection = buildInjectionArtifacts(base);
  const init = appelInit(base);
  const recettes = recettesAgentsOtel({ appId: app, adresses: { traces: endpointConsole, logs: endpointLogs } });
  const parLaConsole =
    voie === "directe"
      ? {
          snippet: buildSnippet({ ...base, endpoint: endpointConsole, withConsent: false }),
          connectSrc: directivesCsp({ sdkUrl, endpoint: endpointConsole, appId: app }).connectSrc,
        }
      : null;

  const domainesExt = domaines.ok ? domainesExtension(domaines.data, c.allowed_origins) : null;
  const lueSonde: SondeInstallation | null = sonde.ok ? (sonde.data as SondeInstallation) : null;
  const vert = parParcours((p) => toutVert(p, lueSonde));
  const lignes = parParcours((p) =>
    personnalisation(p, {
      appId: app,
      clientId: c.client_id,
      aUneCle: c.has_key,
      origines: c.allowed_origins,
      sdkUrl,
      // Le serveur écrit toujours par la console (voir plus haut).
      endpoint: p === "serveur" ? endpointConsole : endpoint,
      endpointLogs,
      domaines: domainesExt ?? [],
    }),
  );
  // « Copier pour mon IA de code » : les mêmes codes que les blocs de la page, avec
  // les vraies valeurs de l'application, jamais la clé (lib/prompts-ia.ts).
  const csp = directivesCsp({ sdkUrl, endpoint, appId: app });
  const codeAppRouter = codeNextAppRouter(sdkUrl, init);
  const codePagesRouter = codeNextPagesRouter(sdkUrl, init);
  // Comme la stratégie du parcours : les domaines actifs, à défaut ceux à enregistrer.
  const actifsExt = (domainesExt ?? []).filter((d) => d.etat === "actif");
  const hotesExtension = (actifsExt.length ? actifsExt : (domainesExt ?? [])).map((d) => d.domaine);
  const prompts = {
    snippet: promptSdk({ app, nom: c.name, origines: c.allowed_origins, snippet, snippetConsent, codeAppRouter, codePagesRouter, csp }),
    extension: promptExtension({
      nom: c.name,
      zip: `${proto}://${host}${ZIP_EXTENSION}`,
      strategie: strategieExtension(hotesExtension, process.env.EXTENSION_UPDATE_URL ?? null),
      nommage: strategieNommage(),
      hotes: hotesExtension,
    }),
    serveur: recettes.agents.map((r) => ({ id: r.id, langage: r.titre.replace(/ \(.*\)$/, ""), prompt: promptServeur(r, c.name) })),
  };
  const contexte = (p: Parcours): ContexteParcours => ({
    app,
    nomSecret: cleDe(app),
    administrable,
    aUneCle: c.has_key,
    active: c.active,
    suspendue: c.suspendue,
    origines: c.allowed_origins,
    domainesExtension: domainesExt,
    sondeEnEchec: !sonde.ok,
    verifications: verificationsDe(p, lueSonde),
  });

  return (
    // La clé remise dans cet onglet (création, régénération) est lue UNE fois pour
    // toute la page : plusieurs codes la portent à la place de leur repère.
    <SecretFourni nom={cleDe(app)}>
      {/* Pleine largeur (refonte du 01/10/2026) : la colonne de 896 px laissait un quart de
          l'écran vide à droite. Les valeurs de chaque parcours ouvrent son onglet. */}
      <div className="min-w-0 animate-fade-up" data-testid="installer">
        <PageHeader title={TITRE} domain="integrations">
          <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-ink-soft">
            <span className="truncate font-medium text-ink">{c.name}</span>
            <code className="chip-mono">{app}</code>
            <InfoTip label="Aide : installer" align="end">
              Poser MIP RUM sur {c.name}, pas à pas. Chaque parcours finit par un test en direct : les cases passent au vert quand
              les données arrivent.
            </InfoTip>
          </span>
          {administrable && (
            <Link href={`/admin/customers/${encodeURIComponent(app)}`} className="btn-ghost" data-testid="lien-fiche">
              Fiche de l&apos;application
            </Link>
          )}
        </PageHeader>

        <section className="mb-4" aria-labelledby="titre-choisir">
          <h2 id="titre-choisir" className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
            Lequel choisir ?
          </h2>
          <ChoixParcours vert={vert} />
        </section>

        <section aria-labelledby="titre-parcours">
          <h2 id="titre-parcours" className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
            Les parcours, pas à pas
          </h2>
          <ParcoursInstallation
            vert={vert}
            entetes={parParcours((p) => <TableauPersonnalisation app={app} parcours={p} lignes={lignes[p]} dansSonOnglet />)}
            panneaux={{
              snippet: (
                <ParcoursSnippet
                  ctx={contexte("snippet")}
                  snippet={snippet}
                  snippetConsent={snippetConsent}
                  codeAppRouter={codeAppRouter}
                  codePagesRouter={codePagesRouter}
                  injection={injection}
                  csp={csp}
                  parLaConsole={parLaConsole}
                  promptIA={prompts.snippet}
                />
              ),
              extension: (
                <ParcoursExtension
                  ctx={contexte("extension")}
                  storeUrl={process.env.CHROME_STORE_URL ?? null}
                  updateUrl={process.env.EXTENSION_UPDATE_URL ?? null}
                  promptIA={prompts.extension}
                />
              ),
              serveur: <ParcoursServeur ctx={contexte("serveur")} recettes={recettes} promptsIA={prompts.serveur} />,
            }}
          />
        </section>
      </div>
    </SecretFourni>
  );
}
