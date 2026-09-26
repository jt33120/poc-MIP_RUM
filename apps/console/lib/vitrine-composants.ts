// La vitrine des composants (`/admin/composants`) est une page de DÉVELOPPEMENT :
// noms de composants, chemins de code, codes de lots, états forcés. La recette du
// 26/09/2026 l'a trouvée ouverte aux administrateurs de la production — donc
// montrable en démonstration. Elle n'est plus servie qu'hors production.
//
// `VERCEL_ENV` vaut « production » sur le déploiement de production seul : les
// aperçus Vercel, la CI (les tests E2E jouent la vitrine) et le poste local la
// gardent. Aucune variable à ajouter ni à oublier.

/** La vitrine est-elle servie dans cet environnement ? */
export function vitrineOuverte(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV !== "production";
}
