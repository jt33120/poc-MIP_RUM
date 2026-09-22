// Classes de badge par état synthétique (ok / warn / incident), partagées entre
// la carte de corrélation et le tableau des angles morts. Rendu serveur.
export const STATE_CLASS: Record<string, string> = {
  ok: "bg-good/10 text-good-ink",
  warn: "bg-warn/10 text-warn-ink",
  incident: "bg-bad/10 text-bad-ink",
};
