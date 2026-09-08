// Compte de démonstration de la vitrine publique — un seul point de vérité,
// partagé par la route qui ouvre la session (app/demo/route.ts) et par la
// section qui décide d'afficher, ou non, le bouton (components/presentation/Demo.tsx).
//
// TOUT VIENT DE L'ENVIRONNEMENT, rien de la base. C'est délibéré : la démo
// s'ouvre et se ferme avec une variable Vercel, sans ligne à créer dans
// console_user, sans script à lancer contre la production. Une porte publique
// doit pouvoir se refermer en une action, depuis l'endroit où on la surveille.
//
// Trois propriétés que ce module tient, et qui ne dépendent donc d'aucune
// donnée en base correctement formée :
//
//   1. FERMÉE PAR DÉFAUT. Sans DEMO_USER_APPS, il n'y a pas de démo : la route
//      renvoie vers /login et le bouton n'est pas rendu.
//   2. SCOPE OBLIGATOIRE ET EXPLICITE. La liste des applications visibles est la
//      variable elle-même. Il n'existe aucun chemin par lequel la démo verrait
//      « toutes les applications » — ce qui exposerait les vrais clients.
//   3. VIEWER, TOUJOURS. Le rôle n'est pas configurable (cf. route.ts) : même
//      pointée sur l'adresse d'un administrateur, la session ouverte est une
//      session viewer, en lecture seule (cf. middleware.ts).

export interface DemoConfig {
  /** Identité portée par la session — sert d'étiquette au journal d'audit. */
  email: string;
  /** Applications que le visiteur pourra consulter. Jamais vide. */
  apps: string[];
}

const EMAIL_PAR_DEFAUT = "demo@mip-rum.local";

/**
 * Configuration de la démo, ou null si elle n'est pas ouverte.
 *
 * `DEMO_USER_APPS` est l'interrupteur : une liste d'app_id séparés par des
 * virgules (« mip-rum-console,insight-performance »). `DEMO_USER_EMAIL` est
 * facultative et ne sert qu'à nommer la session dans le journal.
 */
export function demoConfig(env: NodeJS.ProcessEnv = process.env): DemoConfig | null {
  const apps = (env.DEMO_USER_APPS ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  if (apps.length === 0) return null; // pas de scope => pas de démo

  const email = (env.DEMO_USER_EMAIL ?? EMAIL_PAR_DEFAUT).trim().toLowerCase() || EMAIL_PAR_DEFAUT;
  return { email, apps };
}
