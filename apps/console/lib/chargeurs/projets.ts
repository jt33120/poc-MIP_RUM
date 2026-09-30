// LES CHARGEURS DU CHOIX DE PROJET (C9) — `app/select/page.tsx` et `app/select/new/page.tsx`.
//
// `/select` : les projets du principal (son périmètre — depuis C9, un administrateur
// d'une liste ne voit que la sienne) et leurs trois signaux (mode de collecte,
// domaines, anomalie en cours), en trois requêtes pour toute la liste. Écran de
// SESSION sans portée (`ECRANS_SESSION`) : on le visite avant d'avoir choisi une app.
//
// `/select/new` : l'assistant d'ajout d'un site. Écran de SESSION (depuis le
// 30/09/2026 ; d'administration avant). Sans `?app=`, le formulaire de création (la
// plateforme seule, comme la commande) ; avec, l'intégration du site : son état (sonde
// d'intégration) et, en mode extension, les domaines observés — chacun avec son
// statut réel dans le registre.
//
// L'intégration s'ouvre au LECTEUR du site : le compte d'une inscription en
// libre-service l'est, et c'est ici qu'il reçoit sa clé, au sortir du formulaire. Il
// n'y lit rien de plus que ce que `/installer` lui montre déjà — la configuration de
// `configInstallation` (pas les notes ni l'auteur de la fiche), la sonde, les
// domaines — et `administrable` retire de la page les liens d'administration.
// L'hôte de la console (URL du SDK, de l'ingestion) reste à la page.
import { projectsForUser } from "../project-liste";
import { configInstallation, probeOnboarding } from "../queries-customers";
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
  // Une démo ne crée rien et n'installe rien : elle regarde les projets de la vitrine.
  if (principal.demo) return { etat: "interdit" } as const;
  const app = typeof sp.app === "string" && sp.app ? sp.app : null;
  // Le formulaire crée une application : la commande `creerSite` est à la plateforme.
  if (!app) return principal.role === "admin" && principal.apps === null ? ({ etat: "creation" } as const) : ({ etat: "interdit" } as const);
  // L'intégration d'un site existant : à qui l'a dans son périmètre, lecteur compris.
  if (principal.apps !== null && !principal.apps.includes(app)) return { etat: "introuvable" } as const;
  const client = await configInstallation(app);
  if (!client) return { etat: "introuvable" } as const;
  const administrable = principal.role === "admin";
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
  return { etat: "integration", app, mode, client, sonde, domaines, administrable } as const;
}) satisfies Chargeur<unknown>;
