// La documentation PUBLIQUE d'installation (/presentation/installation/…) : les trois
// parcours de /installer, rendus par les MÊMES composants, sur une application
// d'exemple. Une seule source pour les étapes : ce que lit un visiteur est ce que
// suivra le client une fois connecté, où /installer remplit les valeurs à sa place
// et ajoute le test « ça arrive » en direct.
//
// Les valeurs d'exemple ne sont pas des secrets : l'identifiant est un repère, la clé
// reste son repère (`COLLE_ICI_LA_CLE_API`), et les adresses sont celles de cette
// console, déjà publiques.
import Link from "next/link";
import { CARTES_PARCOURS } from "@/components/installer/ChoixParcours";
import { ParcoursExtension, ParcoursServeur, ParcoursSnippet, type ContexteParcours } from "@/components/installer/Parcours";
import { ingestEndpoint, voieRecommandee } from "@/lib/ingest-endpoint";
import { LIBELLE_PARCOURS, PARCOURS, appelInit, codeNextAppRouter, codeNextPagesRouter, directivesCsp, type Parcours } from "@/lib/installer";
import { buildInjectionArtifacts, buildSnippet } from "@/lib/onboarding";
import { recettesAgentsOtel } from "@/lib/recettes-agents-otel";
import { CHEMIN_INSTALLATION, cheminParcours } from "@/lib/vitrine-navigation";

/** L'application d'exemple : un repère à remplacer, jamais un projet réel. */
export const APP_EXEMPLE = "votre-application";

const CONTEXTE: ContexteParcours = {
  app: APP_EXEMPLE,
  // Aucun secret n'est remis sur une page publique : le repère reste dans le code.
  nomSecret: "exemple-public",
  administrable: false,
  aUneCle: false,
  active: true,
  suspendue: false,
  origines: ["https://www.votre-site.fr"],
  domainesExtension: [],
  sondeEnEchec: false,
  verifications: [],
};

/**
 * Les sous-onglets de la page Installation : la vue d'ensemble, puis les trois
 * parcours. Une barre à plat, collée sous la barre de navigation, et non plus des
 * cartes : on change de parcours comme on change d'onglet, sans relire leur résumé
 * (le schéma de la vue d'ensemble le donne). La page courante porte le trait orange.
 */
export function OngletsInstallation({ courant }: { courant: Parcours | "apercu" }) {
  const onglets = [
    { cle: "apercu" as const, href: CHEMIN_INSTALLATION, libelle: "Vue d'ensemble", badge: null },
    ...PARCOURS.map((p) => ({ cle: p, href: cheminParcours(p), libelle: LIBELLE_PARCOURS[p], badge: CARTES_PARCOURS[p].badge })),
  ];
  return (
    <nav aria-label="Installation" className="sticky top-16 z-30 border-y border-white/10 bg-[#040a1c]/85 backdrop-blur-md">
      <ul className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 sm:px-6" data-testid="onglets-installation">
        {onglets.map((o, i) => {
          const actif = o.cle === courant;
          return (
            <li key={o.cle} className="shrink-0">
              <Link
                href={o.href}
                aria-current={actif ? "page" : undefined}
                data-testid={`onglet-${o.cle}`}
                className={`onglet-installation group relative flex items-center gap-2 whitespace-nowrap px-3 py-3.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#f89101] ${
                  actif ? "text-white" : "text-white/60 hover:text-white"
                }`}
              >
                {i > 0 && (
                  <span className={`font-mono text-[11px] font-bold ${actif ? "text-[#f89101]" : "text-white/35 group-hover:text-[#fbbc64]"}`}>
                    {String(i).padStart(2, "0")}
                  </span>
                )}
                {o.libelle}
                {o.badge && (
                  <span className="hidden rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] font-semibold text-white/55 md:inline">{o.badge}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Le panneau d'un parcours, sur l'application d'exemple. */
export function PanneauParcours({ parcours, host }: { parcours: Parcours; host: string }) {
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  const sdkUrl = `${proto}://${host}/mip-rum.js`;
  const voie = voieRecommandee();
  const endpoint = ingestEndpoint("traces", host, voie);
  const endpointConsole = ingestEndpoint("traces", host);
  const base = { sdkUrl, endpoint, appId: APP_EXEMPLE, clientId: null };

  if (parcours === "extension") {
    return (
      <ParcoursExtension
        ctx={CONTEXTE}
        storeUrl={process.env.CHROME_STORE_URL ?? null}
        updateUrl={process.env.EXTENSION_UPDATE_URL ?? null}
      />
    );
  }
  if (parcours === "serveur") {
    const recettes = recettesAgentsOtel({
      appId: APP_EXEMPLE,
      adresses: { traces: endpointConsole, logs: ingestEndpoint("logs", host) },
    });
    return <ParcoursServeur ctx={CONTEXTE} recettes={recettes} />;
  }
  const init = appelInit(base);
  return (
    <ParcoursSnippet
      ctx={CONTEXTE}
      snippet={buildSnippet({ ...base, withConsent: false, voie })}
      snippetConsent={buildSnippet({ ...base, withConsent: true, voie })}
      codeAppRouter={codeNextAppRouter(sdkUrl, init)}
      codePagesRouter={codeNextPagesRouter(sdkUrl, init)}
      injection={buildInjectionArtifacts(base)}
      csp={directivesCsp({ sdkUrl, endpoint, appId: APP_EXEMPLE })}
      parLaConsole={
        voie === "directe"
          ? {
              snippet: buildSnippet({ ...base, endpoint: endpointConsole, withConsent: false }),
              connectSrc: directivesCsp({ sdkUrl, endpoint: endpointConsole, appId: APP_EXEMPLE }).connectSrc,
            }
          : null
      }
    />
  );
}
