// PS9 — Où se situe ce POC, face à un outil du marché (plan § 8.2, partie 2 ; lot P**.4).
//
// UNE TABLE FACTUELLE, SANS SUPERLATIF. La colonne « IP-Label Ekara » n'admet que
// des éléments étiquetés « documenté » dans les notes de lecture de ses pages
// publiques (tenues hors du dépôt), jamais un
// élément « rapporté (prudence) » : ceux-là viennent d'un résumé d'outil non recoupé.
// Le SDK mobile natif n'y figure donc pas (sa seule source est de cette sorte), et
// rien sur Datadog : les comparaisons Datadog appartiennent aux écrans de la
// console, pas à la vitrine.
//
// La colonne « Ce POC » ne dit que ce que le relevé de couverture ou le dépôt
// établit. Chaque ligne garde ses sources (`sources`), que tests/unit/SaitFaire.test.tsx
// résout dans le dépôt ; le contenu, lui, se relit à la main (P**.8, relecture n° 3).
//
// « Ce POC » est la DEUXIÈME colonne (recette du 26/09/2026) : en troisième, elle
// tombait hors champ à 390 px, et le lecteur ne voyait que le concurrent. La table
// défile dans un cadre qui le signale (TableDefilante), première colonne fixée.

import { TableDefilante } from "@/components/TableDefilante";

/** Une ligne de la table ; chaque source s'écrit « chemin:ligne » depuis la racine du dépôt. */
export interface LignePositionnement {
  critere: string;
  ekara: string;
  poc: string;
  sources: { poc: string[] };
}

/** En-tête de la colonne Ekara, texte exact du plan : ce qui a été lu, et quand. */
export const EN_TETE_EKARA = "IP-Label Ekara, d'après ses pages publiques consultées en septembre 2026";

export const POSITIONNEMENT: readonly LignePositionnement[] = [
  {
    critere: "Découpage par opérateur et type de réseau",
    ekara: "Documenté (Orange, SFR, 4G, Wi-Fi…)",
    // Le plan écrivait « Prévu, non branché » ; le dépôt dit autre chose : l'opérateur
    // est déclaré indisponible (aucun navigateur ne l'expose), et le découpage de B2
    // ne compte ni l'opérateur ni le type de réseau.
    poc: "Non : aucun navigateur n'expose l'opérateur, et le type de réseau n'est pas un axe de découpage",
    sources: {
      poc: [
        "apps/console/lib/dashboard-blocs.ts:76-80",
        "packages/db/sql/migration-v53.sql:14-21",
      ],
    },
  },
  {
    critere: "Robots synthétiques rapprochés du RUM",
    ekara: "Documenté comme principe",
    poc: "Un écran de corrélation existe, hors du relevé de couverture",
    sources: {
      poc: ["apps/console/app/correlation/page.tsx:1"],
    },
  },
  {
    critere: "Extension navigateur pour postes gérés",
    ekara: "Documenté (Chrome/Edge, déploiement GPO/Intune)",
    poc: "Extension MV3, non publiée au Chrome Web Store",
    sources: {
      poc: ["apps/extension/manifest.json:2"],
    },
  },
  {
    critere: "Hébergement en UE",
    ekara: "Documenté comme option",
    poc: "Données en UE, hébergeurs de droit américain",
    sources: {
      poc: ["apps/console/lib/specs.ts:98-101"],
    },
  },
];

const TITRE_ID = "positionnement-titre";

export function Positionnement() {
  return (
    <div data-testid="positionnement" className="mt-14">
      <h3 id={TITRE_ID} className="text-xl font-bold tracking-tight text-ink">
        Où se situe ce POC
      </h3>
      <TableDefilante className="mt-5 rounded-xl border border-line bg-panel" label="Où se situe ce POC">
        <table className="w-full min-w-[36rem] border-collapse text-left text-sm" aria-labelledby={TITRE_ID}>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="sticky left-0 z-10 w-36 bg-panel px-3 py-3 align-bottom font-semibold text-ink-soft sm:w-48 sm:px-4">
                Critère
              </th>
              <th scope="col" className="px-4 py-3 align-bottom font-semibold text-ink-soft">
                Ce POC
              </th>
              <th scope="col" className="px-4 py-3 align-bottom font-semibold text-ink-soft">
                {EN_TETE_EKARA}
              </th>
            </tr>
          </thead>
          <tbody>
            {POSITIONNEMENT.map((l) => (
              <tr key={l.critere} className="border-b border-line/70 align-top last:border-0">
                <th scope="row" className="sticky left-0 z-10 w-36 bg-panel px-3 py-3 font-medium text-ink sm:w-48 sm:px-4">
                  {l.critere}
                </th>
                <td className="px-4 py-3 leading-relaxed text-ink">{l.poc}</td>
                <td className="px-4 py-3 leading-relaxed text-ink-soft">{l.ekara}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableDefilante>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">
        Cette table compare ce qui est publié, pas ce qui a été essayé : nous n&apos;avons pas utilisé
        Ekara.
      </p>
    </div>
  );
}
