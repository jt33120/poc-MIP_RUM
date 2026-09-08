// Sélection de projet (= app) — étape préliminaire. Le RUM et l'analyse IA sont
// propres à UN projet : on ne mélange jamais deux applications dans une même vue.
// Le projet courant est porté par un cookie (persistance entre visites) ET par le
// paramètre d'URL `?app` (partage de lien, source de vérité d'une requête). Le
// middleware réconcilie les deux : cookie -> URL, et redirige vers /select quand
// aucun projet n'est choisi.
import { cookies } from "next/headers";
import type { AppItem } from "./queries";
import { listApps } from "./queries";
import type { SessionUser } from "./auth";

export const PROJECT_COOKIE = "mip-project";
export const PROJECT_COOKIE_MAX_AGE = 180 * 24 * 3600; // 180 j

/** Projets visibles par l'utilisateur (RBAC : viewer scopé à ses apps). */
export async function projectsForUser(user: SessionUser): Promise<AppItem[]> {
  const all = await listApps();
  if (user.role === "admin" || !user.apps?.length) return all;
  return all.filter((a) => user.apps!.includes(a.app_id));
}

/** Id du projet courant (cookie), ou null si aucun n'est sélectionné. */
export async function selectedProjectId(): Promise<string | null> {
  return (await cookies()).get(PROJECT_COOKIE)?.value ?? null;
}

// Habillage éditorial des projets connus — sous-titre FACTUEL (rôle du projet),
// pas une paraphrase du nom. Un projet inconnu retombe sur un descriptif neutre.
const KNOWN: Record<string, { tag: string; hint: string }> = {
  "mip-rum-console": {
    tag: "Dogfooding",
    hint: "La console RUM s'observe elle-même — trafic interne de l'équipe.",
  },
  "gip-plateforme": {
    tag: "Production",
    hint: "Plateforme UTI (plateforme.groupement-it.com) — utilisateurs réels.",
  },
  "insight-performance": {
    tag: "Extension",
    hint: "Site MIP (insight-performance.com) — observé par l'extension navigateur, sans SDK posé dans le site.",
  },
};

export function describeProject(appId: string): { tag: string; hint: string } {
  return KNOWN[appId] ?? { tag: "Application", hint: "Monitoring temps réel des utilisateurs de ce projet." };
}
