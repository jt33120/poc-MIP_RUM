// LES CHARGEURS DU CHOIX DE PROJET (C9) — `app/select/page.tsx` et `app/select/new/page.tsx`.
//
// `/select` : les projets du principal (son périmètre — depuis C9, un administrateur
// d'une liste ne voit que la sienne) et leurs trois signaux (mode de collecte,
// domaines, anomalie en cours), en trois requêtes pour toute la liste. Écran de
// SESSION sans portée (`ECRANS_SESSION`) : on le visite avant d'avoir choisi une app.
//
// `/select/new` : l'assistant d'ajout d'un site. Écran d'ADMINISTRATION. Sans
// `?app=`, le formulaire de création (la plateforme seule, comme la commande) ; avec,
// l'intégration du site : son état (sonde d'intégration) et, en mode extension, les
// domaines observés — chacun avec son statut réel dans le registre.
// L'hôte de la console (URL du SDK, de l'ingestion) reste à la page.
import { projectsForUser } from "../project-liste";
import { getCustomer, probeOnboarding } from "../queries-customers";
import { resolveExtensionScope } from "../queries-extension-scope";
import { signauxProjets } from "../queries-projects";
import type { Chargeur } from "./commun";

export const chargerProjets = (async (principal) => {
  if (!principal) return { etat: "sans_session" } as const;
  const projets = await projectsForUser(principal);
  const signaux = await signauxProjets(projets.map((p) => p.app_id));
  // Ajouter un site crée une application : l'administrateur de la plateforme seul (C9).
  const creation = principal.role === "admin" && principal.apps === null && !principal.demo;
  return { etat: "ok", email: principal.email, projets, signaux, creation } as const;
}) satisfies Chargeur<unknown>;

/** Hostname d'une origine CORS (« https://ma-boutique.fr » → « ma-boutique.fr »). */
function hote(origine: string): string | null {
  try {
    return new URL(origine).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export const chargerNouveauSite = (async (principal, sp) => {
  if (!principal) return { etat: "sans_session" } as const;
  if (principal.role !== "admin" || principal.demo) return { etat: "interdit" } as const;
  const app = typeof sp.app === "string" && sp.app ? sp.app : null;
  // Le formulaire crée une application : la commande `creerSite` est à la plateforme.
  // L'intégration d'un site existant, à tout administrateur de ce site.
  if (!app) return principal.apps === null ? ({ etat: "creation" } as const) : ({ etat: "interdit" } as const);
  if (principal.apps !== null && !principal.apps.includes(app)) return { etat: "introuvable" } as const;
  const client = await getCustomer(app);
  if (!client) return { etat: "introuvable" } as const;
  const mode = sp.mode === "extension" ? "extension" : "sdk";
  const [sonde, domaines] = await Promise.all([
    probeOnboarding(app),
    mode === "extension"
      ? Promise.all(
          [...new Set(client.allowed_origins.map(hote).filter((h): h is string => !!h))].map(async (host) => {
            const s = await resolveExtensionScope(host);
            return { host, registered: !!s && s.app_id === app && s.active };
          }),
        )
      : Promise.resolve([] as { host: string; registered: boolean }[]),
  ]);
  return { etat: "integration", app, mode, client, sonde, domaines } as const;
}) satisfies Chargeur<unknown>;
