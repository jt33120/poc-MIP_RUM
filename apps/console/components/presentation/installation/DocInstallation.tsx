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
import { cheminParcours } from "@/lib/vitrine-navigation";

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

/** Les trois parcours en cartes, qui mènent chacune à sa page. */
export function CartesParcours({ courant }: { courant?: Parcours }) {
  return (
    <ul className="grid gap-4 md:grid-cols-3" data-testid="doc-parcours">
      {PARCOURS.map((p, i) => (
        <li key={p} className="min-w-0">
          <Link
            href={cheminParcours(p)}
            aria-current={courant === p ? "page" : undefined}
            className={`group flex h-full flex-col rounded-2xl border p-5 transition hover:-translate-y-0.5 hover:border-[#f89101]/60 ${
              courant === p ? "border-[#f89101]/70 bg-[#f89101]/10" : "border-white/10 bg-white/[0.03]"
            }`}
          >
            <span className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-[#fbbc64]">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-base font-bold text-white">{LIBELLE_PARCOURS[p]}</span>
              <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/75">
                {CARTES_PARCOURS[p].badge}
              </span>
            </span>
            <span className="mt-3 flex-1 text-sm leading-relaxed text-white/65">{CARTES_PARCOURS[p].texte}</span>
            <span className="mt-4 text-sm font-semibold text-[#fbbc64] transition group-hover:translate-x-1">Lire le parcours →</span>
          </Link>
        </li>
      ))}
    </ul>
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
