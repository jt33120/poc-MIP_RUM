// Recherche dans un tableau d'administration : casse, accents et espaces ignorés
// (« Désactivé » se trouve en tapant « desactive »). Pure, partagée par le champ de
// filtre et ses tests.
export function normaliserRecherche(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
