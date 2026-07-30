// Containment NET — le seul chiffre de résolution qu'on puisse défendre.
//
// Le containment BRUT compte les appels que le SVI a terminés sans transfert.
// Il ignore que l'appelant peut rappeler le lendemain pour le même motif : le
// problème n'était pas résolu, il était différé. Un acheteur du domaine connaît
// ce biais, et un tableau de bord qui n'affiche que le brut passe pour naïf.
//
// NET = appels résolus SANS rappel du même appelant sous 7 jours.
//
// Deux limites assumées, affichées plutôt que dissimulées :
//
//  1. Un appel sans empreinte d'appelant (`caller_hash` absent) ne peut PAS être
//     évalué. On le compte comme non rappelé — donc le net est une BORNE
//     SUPÉRIEURE, jamais une sous-estimation. Le nombre d'appels concernés est
//     rendu pour que le lecteur juge.
//  2. L'empreinte est un HMAC : après rotation de clé, le même appelant produit
//     une empreinte différente. Un rappel qui enjambe une rotation est donc
//     invisible — même direction de biais.
//
// On n'extrapole jamais le taux de rappel des appels évaluables vers les autres :
// cela produirait un chiffre plus flatteur ET plus faux.

export interface ContainmentCounts {
  /** Appels clos sur la période — dénominateur de tous les taux. */
  closed: number;
  /** Appels d'issue « contained » (résolus en apparence). */
  contained: number;
  /** Parmi eux, ceux suivis d'un rappel du même appelant sous 7 jours. */
  recalled: number;
  /** Parmi eux, ceux sans empreinte d'appelant : rappel non vérifiable. */
  unevaluable: number;
}

export interface Containment {
  /** Taux brut, en pourcentage. À ne JAMAIS afficher seul. */
  brut: number;
  /** Taux net, en pourcentage. Borne supérieure (cf. limites ci-dessus). */
  net: number;
  /** Écart brut − net, en points de pourcentage. */
  ecartPoints: number;
  /** Nombre d'appels résolus dont le rappel n'a pas pu être vérifié. */
  unevaluable: number;
  /** true si le net est une estimation haute (des appels non évaluables existent). */
  borneSuperieure: boolean;
}

export function containment(c: ContainmentCounts): Containment {
  if (c.closed <= 0)
    return { brut: 0, net: 0, ecartPoints: 0, unevaluable: 0, borneSuperieure: false };

  const brut = (c.contained / c.closed) * 100;
  // `recalled` est un sous-ensemble de `contained` : la soustraction ne peut pas
  // passer sous zéro sur des données cohérentes, mais on borne quand même —
  // une donnée incohérente doit produire un chiffre absurde-mais-borné plutôt
  // qu'un taux négatif affiché tel quel.
  const net = (Math.max(c.contained - c.recalled, 0) / c.closed) * 100;

  return {
    brut,
    net,
    ecartPoints: brut - net,
    unevaluable: c.unevaluable,
    borneSuperieure: c.unevaluable > 0,
  };
}

/**
 * Phrase de lecture du containment. Écrite ici et non dans la page pour être
 * testée : c'est elle qui porte la nuance, et une nuance non testée disparaît
 * à la première refonte d'interface.
 */
export function containmentReading(c: Containment, closed: number): string {
  if (closed === 0) return "Aucun appel clos sur la période : le containment n'est pas calculable.";

  const base = `${c.net.toFixed(1)} % des ${closed.toLocaleString("fr-FR")} appels clos ont été résolus sans rappel sous 7 jours`;
  const ecart =
    c.ecartPoints >= 0.05
      ? ` — soit ${c.ecartPoints.toFixed(1)} point(s) de moins que le taux apparent de ${c.brut.toFixed(1)} %`
      : "";
  const borne = c.borneSuperieure
    ? `. ${c.unevaluable.toLocaleString("fr-FR")} appel(s) résolu(s) sans empreinte d'appelant n'ont pas pu être vérifiés : le taux net est une borne supérieure.`
    : ".";
  return base + ecart + borne;
}
