// Dérivations pures des issues d'appel. Aucune requête ici : ces fonctions sont
// le seul endroit où containment, abandon et transfert sont calculés, et elles
// sont testées — un taux faux se voit rarement à l'œil sur un tableau de bord.

export interface OutcomeCounts {
  total: number;
  contained: number;
  transferred: number;
  abandoned: number;
  failed: number;
  open: number;
}

export interface OutcomeRates {
  /** Base réellement utilisée : les appels CLOS. Un appel en cours n'a pas
   *  d'issue, l'inclure au dénominateur ferait baisser tous les taux à mesure
   *  que du trafic arrive — un artefact, pas un signal. */
  closed: number;
  contained: number;   // en pourcentage, 0..100
  transferred: number;
  abandoned: number;
  failed: number;
}

/**
 * Taux d'issue en pourcentage, sur la base des appels CLOS.
 *
 * Les quatre taux somment à 100 % (à l'arrondi près) par construction : les
 * issues sont exhaustives et mutuellement exclusives. Le test le vérifie sur des
 * jeux dégénérés — c'est la propriété qui garantit qu'aucun appel ne « disparaît »
 * d'un tableau de bord.
 */
export function outcomeRates(c: OutcomeCounts): OutcomeRates {
  const closed = c.contained + c.transferred + c.abandoned + c.failed;
  if (closed === 0)
    return { closed: 0, contained: 0, transferred: 0, abandoned: 0, failed: 0 };
  const pct = (x: number) => (x / closed) * 100;
  return {
    closed,
    contained: pct(c.contained),
    transferred: pct(c.transferred),
    abandoned: pct(c.abandoned),
    failed: pct(c.failed),
  };
}

/**
 * Part des appels pour lesquels le niveau « parcours » est disponible.
 *
 * Sert à AFFICHER la couverture, jamais à extrapoler. Un entonnoir de menu
 * calculé sur 34 % des appels ne doit pas se présenter comme s'il portait sur la
 * totalité : c'est le principal moyen qu'a ce produit de mentir sans le vouloir.
 */
export function journeyCoverage(total: number, withJourney: number): number {
  if (total <= 0) return 0;
  return Math.min(100, (withJourney / total) * 100);
}

/** Libellé français d'une issue. `null` = appel encore en cours. */
export function outcomeLabel(o: string | null): string {
  switch (o) {
    case "contained": return "résolu par le SVI";
    case "transferred": return "transféré";
    case "abandoned": return "abandonné";
    case "failed": return "échec technique";
    default: return "en cours";
  }
}

/** Durée en millisecondes -> « 2 min 05 s », « 12 s », « — ». */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${String(s % 60).padStart(2, "0")} s`;
}
