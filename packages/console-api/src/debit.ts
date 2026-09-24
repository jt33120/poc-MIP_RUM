// LE DÉBIT, PAR PRINCIPAL ET PAR RÉPLIQUE : une fenêtre fixe d'une minute.
//
// Calibré sur le régime RÉEL de la console : `AutoRefresh` rejoue 53 écrans sur
// 57 toutes les 5 s, soit 12 rendus par minute et par onglet, chacun avec ses
// sections et, s'il est ouvert, son panneau. La limite compte des APPELS de la
// console (un par rendu d'écran, plus un par panneau), pas des requêtes SQL.
// En mémoire, par réplique : une barrière contre l'emballement d'un onglet ou
// d'une boucle, pas une garantie distribuée.

export interface Debit {
  /** Rend `null` si l'appel passe, sinon les secondes avant la fenêtre suivante. */
  consommer(cle: string): number | null;
}

export function creerDebit({ parMinute, horloge = () => Date.now() }: { parMinute: number; horloge?: () => number }): Debit {
  const fenetres = new Map<string, { debut: number; n: number }>();
  let dernierMenage = 0;
  return {
    consommer(cle) {
      if (parMinute <= 0) return null;
      const t = horloge();
      // Ménage au plus une fois par minute : la table ne grossit pas avec les sessions passées.
      if (t - dernierMenage > 60_000) {
        for (const [k, f] of fenetres) if (t - f.debut >= 60_000) fenetres.delete(k);
        dernierMenage = t;
      }
      const f = fenetres.get(cle);
      if (!f || t - f.debut >= 60_000) {
        fenetres.set(cle, { debut: t, n: 1 });
        return null;
      }
      if (f.n >= parMinute) return Math.max(1, Math.ceil((f.debut + 60_000 - t) / 1000));
      f.n++;
      return null;
    },
  };
}
