// Compte de démonstration de la vitrine publique — un seul point de vérité,
// partagé par la route qui ouvre la session (app/demo/route.ts) et par la
// section qui décide d'afficher, ou non, le bouton (components/presentation/Demo.tsx).
//
// Non configuré = fonctionnalité fermée : pas de bouton sur la vitrine, et la
// route renvoie vers /login. Il n'y a rien à désactiver après un déploiement.

/** Compte démo configuré, en minuscules, ou null si la démo n'est pas ouverte. */
export function demoEmail(env: NodeJS.ProcessEnv = process.env): string | null {
  const e = env.DEMO_USER_EMAIL?.trim().toLowerCase();
  return e ? e : null;
}
