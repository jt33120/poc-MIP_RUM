// « Installer » : poser MIP RUM sur l'application sélectionnée, pas à pas, selon
// trois parcours — le code de suivi (tous les visiteurs), l'extension navigateur
// (les postes équipés), le serveur (facultatif) —, chacun terminé par un test
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
import { PageHeader } from "@/components/PageHeader";
import { ChoixParcours } from "@/components/installer/ChoixParcours";
import { ParcoursExtension, ParcoursServeur, ParcoursSnippet, type ContexteParcours } from "@/components/installer/Parcours";
import { ParcoursInstallation } from "@/components/installer/ParcoursInstallation";
import { TableauxPersonnalisation } from "@/components/installer/TableauPersonnalisation";
import { SecretFourni } from "@/components/secret/SecretUnique";
import { CadreEtat, EtatSurface } from "@/components/states/EtatSurface";
import { chargerInstaller } from "@/lib/chargeurs/installer";
import { chargerEcran } from "@/lib/ecran";
import type { SearchParams } from "@/lib/filters";
import { ingestEndpoint } from "@/lib/ingest-endpoint";
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
  const endpoint = ingestEndpoint("traces", host);
  const endpointLogs = ingestEndpoint("logs", host);

  const base = { sdkUrl, endpoint, appId: app, clientId: c.client_id };
  const snippet = buildSnippet({ ...base, withConsent: false });
  const snippetConsent = buildSnippet({ ...base, withConsent: true });
  const injection = buildInjectionArtifacts(base);
  const init = appelInit(base);
  const recettes = recettesAgentsOtel({ appId: app, adresses: { traces: endpoint, logs: endpointLogs } });

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
      endpoint,
      endpointLogs,
      domaines: domainesExt ?? [],
    }),
  );
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
      <div className="min-w-0 max-w-4xl animate-fade-up" data-testid="installer">
        <PageHeader
          title={TITRE}
          domain="integrations"
          sub={
            <>
              Poser MIP RUM sur <strong className="font-semibold text-ink">{c.name}</strong>{" "}
              <code className="chip-mono">{app}</code>, pas à pas. Chaque parcours finit par un test en direct : les cases
              passent au vert quand les données arrivent.
            </>
          }
        >
          {administrable && (
            <Link href={`/admin/customers/${encodeURIComponent(app)}`} className="btn-ghost" data-testid="lien-fiche">
              Fiche de l&apos;application
            </Link>
          )}
        </PageHeader>

        <section className="mb-8" aria-labelledby="titre-choisir">
          <h2 id="titre-choisir" className="mb-3 text-sm font-semibold text-ink">
            Lequel choisir ?
          </h2>
          <ChoixParcours vert={vert} />
        </section>

        <section className="mb-8" aria-labelledby="titre-personnalisation">
          <h2 id="titre-personnalisation" className="mb-1 text-sm font-semibold text-ink">
            Ce qui est propre à votre application, ce qui est pareil pour tous
          </h2>
          <p className="mb-3 text-xs text-ink-soft">
            Les codes de cette page sont déjà remplis avec ces valeurs ; seule la clé d&apos;API reste à poser.
          </p>
          <TableauxPersonnalisation app={app} lignes={lignes} />
        </section>

        <section aria-labelledby="titre-parcours">
          <h2 id="titre-parcours" className="mb-3 text-sm font-semibold text-ink">
            Les parcours, pas à pas
          </h2>
          <ParcoursInstallation
            vert={vert}
            panneaux={{
              snippet: (
                <ParcoursSnippet
                  ctx={contexte("snippet")}
                  snippet={snippet}
                  snippetConsent={snippetConsent}
                  codeAppRouter={codeNextAppRouter(sdkUrl, init)}
                  codePagesRouter={codeNextPagesRouter(sdkUrl, init)}
                  injection={injection}
                  csp={directivesCsp({ sdkUrl, endpoint, appId: app })}
                />
              ),
              extension: (
                <ParcoursExtension
                  ctx={contexte("extension")}
                  storeUrl={process.env.CHROME_STORE_URL ?? null}
                  updateUrl={process.env.EXTENSION_UPDATE_URL ?? null}
                />
              ),
              serveur: <ParcoursServeur ctx={contexte("serveur")} recettes={recettes} />,
            }}
          />
        </section>
      </div>
    </SecretFourni>
  );
}
