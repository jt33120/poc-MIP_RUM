// Classes de badge par état synthétique (ok / warn / incident), partagées entre
// la carte de corrélation et le tableau des angles morts. Rendu serveur.
export const STATE_CLASS: Record<string, string> = {
  ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300",
  incident: "bg-red-100 text-red-800 dark:bg-red-400/10 dark:text-red-300",
};
