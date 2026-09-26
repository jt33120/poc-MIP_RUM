// Libellé d'une action tel qu'un utilisateur le lit — logique PURE, testée
// (tests/unit/libelle-action.test.ts), sans accès base.
//
// POURQUOI (recette du 26/09/2026). Le SDK nomme une action automatique par la
// balise de l'élément cliqué suivie de son nom accessible (`automaticActionName`,
// packages/rum-sdk/src/actions.ts) : `button "Afficher la fiche SIRET"`,
// `input:text "Raison sociale"`, `a "Accueil"`. Affiché tel quel, ce préfixe
// technique (« button », « input:text ») encombrait les pastilles des occurrences
// d'erreur, la chronologie d'une session et le classement des actions. Le nom
// stocké ne change pas (il reste la clé de regroupement) : seul l'affichage le lit.
//
// Un nom manuel (`filtre_region`, `data-mip-action-name`) n'a pas cette forme : il
// est rendu tel quel.

/** Balises de champ : leur nom accessible est une étiquette, pas une action. */
const CHAMPS: Record<string, string> = {
  input: "Champ",
  select: "Liste",
  textarea: "Zone de texte",
};

/** Nature d'un élément sans nom accessible (le SDK n'envoie alors que la balise). */
const NATURES: Record<string, string> = {
  ...CHAMPS,
  button: "Bouton",
  a: "Lien",
  label: "Libellé",
  summary: "Section repliable",
};

/** `balise`, `balise:type` et, éventuellement, ` "nom accessible"`. */
const FORME_SDK = /^([a-z][a-z0-9-]*)(?::[a-z0-9-]+)?(?: "(.*)")?$/s;

export function libelleAction(nom: string | null | undefined): string {
  const brut = nom?.trim() ?? "";
  if (!brut) return "Action sans nom";
  const m = FORME_SDK.exec(brut);
  if (!m) return brut;
  const [, balise, texte] = m;
  if (texte !== undefined && texte.trim() !== "") {
    return CHAMPS[balise] ? `${CHAMPS[balise]} « ${texte.trim()} »` : texte.trim();
  }
  // Sans nom accessible : la nature de l'élément si elle est connue ; sinon le nom
  // tel quel — un nom manuel d'un seul mot (« checkout ») a la même forme.
  return NATURES[balise] ? `${NATURES[balise]} sans libellé` : brut;
}
