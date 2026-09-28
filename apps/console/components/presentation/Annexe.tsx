// Dernière partie du dossier technique — « Le détail, ligne par ligne » (plan § 8.2, PS11).
//
// Deux blocs, dans cet ordre.
//
// 1. LE REGISTRE DES CAPACITÉS : toutes les lignes du document de couverture, une
//    famille par `<details>` (les titres « ### 4.x » du document), colonnes « # ·
//    Capacité · Verdict · Sa limite ». Identifiants, capacités, verdicts et familles
//    viennent de lib/couverture.ts, l'extraction versionnée du document : aucune
//    ligne, aucun verdict, aucun décompte n'est écrit ici, et un nouveau relevé change
//    le registre au build suivant. Le nom d'une capacité est du Markdown brut ;
//    lib/markdown-en-ligne.ts en lit le code, le gras et l'italique, et le rendu ne
//    produit que des éléments React — jamais de HTML injecté.
//
//    LA LIMITE N'EST PLUS RECOPIÉE (recette du 26/09/2026). La cellule « Limite » du
//    document est une note de travail : chemins du code, variables d'environnement,
//    noms de tables, codes de vague — illisible pour un visiteur, et parfois en
//    retard sur le code (F1 à F3). Chaque ligne renvoie à l'endroit de cette page qui
//    dit sa limite en français courant, et que les tests confrontent au document : la
//    carte de « Ce qu'il sait faire » qui la porte, le point de « Ce qui reste »
//    qui la cite, ou, depuis le 28/09/2026, le point sorti de la liste parce qu'il est
//    fait (R2, la reprise : D8 et D9). Une ligne sans renvoi fait échouer
//    tests/unit/Annexe.test.tsx.
//
// 2. LES SPECS (Specs.tsx), sous une frontière <Suspense> : c'est la seule partie
//    de la page qui lit la base (l'état du planificateur). Le reste de la page part
//    sans l'attendre — le pool `pg` n'a pas de délai de connexion : sans frontière,
//    une base lente retiendrait toute la vitrine — et Specs suit dans la même
//    réponse. Cette frontière ne rejoue pas le piège des écrans de la console (une
//    Suspense au-dessus d'un écran casse la navigation par query, `router.replace`) :
//    les onglets de Specs sont des radios CSS, sans URL ni script, et la vitrine ne
//    navigue par query nulle part.
//
// La date du chapeau est CELLE DU RELEVÉ (lib/couverture.ts), jamais tapée ici.
//
// À 390 px, une table de quatre colonnes de prose ne se lit pas, et la faire défiler
// de côté obligerait à défiler à chaque ligne : sous `lg`, chaque ligne s'empile
// (identifiant et capacité, puis verdict, puis limite). La table garde des rôles
// ARIA explicites : changer le `display` d'une table en efface la sémantique dans
// certains navigateurs (WebKit), et les rôles la rétablissent.
import { Fragment, Suspense } from "react";
import { ICON_PATHS, Icon } from "@/components/icons";
import { Partie } from "@/components/presentation/Partie";
import { ancreDuPoint, idCarte } from "@/components/presentation/SaitFaire";
import { Specs } from "@/components/presentation/Specs";
import { RELEVE, VERDICT_LABEL, parFamille, type Capacite } from "@/lib/couverture";
import { lireEnLigne, type Noeud } from "@/lib/markdown-en-ligne";
import { POINTS_FAITS, POINTS_RESTE } from "@/lib/presentation-reste";
import { CARTES } from "@/lib/presentation-sait-faire";

/**
 * Lignes que « Ce qui reste » traite sans les citer en source : F1 (construire le
 * dépôt) et F3 (les bancs en CI). Leurs défauts sont levés depuis le 24/09/2026, et
 * R9 le dit (« Une chaîne de livraison qui dit vrai ») ; il ne les cite plus parce
 * que ce qu'elles disaient manquer est fait (lib/presentation-reste.ts).
 */
const TRAITEES_PAR: Readonly<Record<string, string>> = { F1: "R9", F3: "R9" };

/** Où cette page dit la limite d'une ligne du registre, en français courant ; `null` si nulle part. */
export function renvoiLimite(id: string): { href: string; libelle: string } | null {
  const carte = CARTES.find((c) => c.limites.some((l) => l.id === id));
  if (carte) return { href: `#${idCarte(carte.id)}`, libelle: `Ce qu'il sait faire : « ${carte.titre} »` };
  const point = POINTS_RESTE.find((p) => p.sources.includes(id)) ?? POINTS_RESTE.find((p) => p.id === TRAITEES_PAR[id]);
  if (point) return { href: `#${ancreDuPoint(point.id)}`, libelle: `Ce qui reste : « ${point.titre} »` };
  // Un point fait, sorti de la liste (28/09/2026) : sa phrase datée dit l'état de la ligne.
  const fait = POINTS_FAITS.find((p) => p.sources.includes(id));
  if (fait) return { href: `#${ancreDuPoint(fait.id)}`, libelle: `Sorti de la liste : « ${fait.titre} »` };
  return null;
}

/** Le Markdown en ligne d'une cellule, rendu en éléments : du texte que React échappe. */
function Rendu({ noeuds }: { noeuds: Noeud[] }) {
  return (
    <>
      {noeuds.map((n, i) => {
        switch (n.type) {
          case "texte":
            return <Fragment key={i}>{n.texte}</Fragment>;
          case "code":
            return (
              <code
                key={i}
                className="rounded bg-panel2 px-1 py-px font-mono text-[0.92em] text-ink [overflow-wrap:anywhere]"
              >
                {n.texte}
              </code>
            );
          case "gras":
            return (
              <strong key={i} className="font-semibold text-ink">
                <Rendu noeuds={n.enfants} />
              </strong>
            );
          case "italique":
            return (
              <em key={i}>
                <Rendu noeuds={n.enfants} />
              </em>
            );
        }
      })}
    </>
  );
}

function Cellule({ source }: { source: string }) {
  return <Rendu noeuds={lireEnLigne(source)} />;
}

/** Une cellule en mode table, à partir de `lg` ; en dessous, la ligne est une grille. */
const CELLULE_LG = "lg:table-cell lg:px-3 lg:py-3 lg:align-top";

function TableFamille({ famille, capacites }: { famille: string; capacites: Capacite[] }) {
  return (
    <table
      role="table"
      className="block w-full border-t border-line text-left text-[13px] leading-relaxed lg:table lg:table-fixed lg:border-collapse"
    >
      <caption className="sr-only">{famille} : chaque capacité, son verdict et où lire sa limite</caption>
      <thead role="rowgroup" className="sr-only lg:not-sr-only">
        {/* `text-left` sur chaque en-tête : le navigateur centre un <th> par une règle
            qui lui est propre, que l'alignement hérité de la table ne corrige pas. */}
        <tr
          role="row"
          className="border-b border-line bg-panel2 text-[11px] uppercase tracking-wider text-ink-soft"
        >
          <th role="columnheader" scope="col" className="w-16 py-2.5 pl-5 pr-3 text-left font-semibold">
            <span aria-hidden="true">#</span>
            <span className="sr-only">Identifiant</span>
          </th>
          <th role="columnheader" scope="col" className="w-[32%] px-3 py-2.5 text-left font-semibold">
            Capacité
          </th>
          <th role="columnheader" scope="col" className="w-44 px-3 py-2.5 text-left font-semibold">
            Verdict
          </th>
          <th role="columnheader" scope="col" className="py-2.5 pl-3 pr-5 text-left font-semibold">
            Sa limite
          </th>
        </tr>
      </thead>
      <tbody role="rowgroup" className="block divide-y divide-line lg:table-row-group">
        {capacites.map((c) => {
          const renvoi = renvoiLimite(c.id);
          return (
          <tr
            key={c.id}
            role="row"
            data-testid="annexe-capacite"
            data-id={c.id}
            data-verdict={c.verdict}
            className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 py-3.5 sm:px-5 lg:table-row lg:p-0"
          >
            <th
              role="rowheader"
              scope="row"
              className="text-left font-normal lg:table-cell lg:py-3 lg:pl-5 lg:pr-3 lg:align-top"
            >
              <span className="chip-mono whitespace-nowrap">{c.id}</span>
            </th>
            <td role="cell" className={`min-w-0 font-semibold text-ink ${CELLULE_LG}`}>
              <Cellule source={c.capacite} />
            </td>
            <td role="cell" className={`col-start-2 ${CELLULE_LG}`}>
              {/* Le verdict est ÉCRIT, avec les mots du document : aucune teinte ne
                  le porte, pour ne rien lui ajouter (« déployé » n'est pas « bon »). */}
              <span className="inline-block rounded-md border border-line bg-panel2 px-2 py-0.5 text-[11px] font-semibold leading-snug text-ink-soft">
                {VERDICT_LABEL[c.verdict]}
              </span>
            </td>
            <td
              role="cell"
              className="col-start-2 min-w-0 text-ink-soft [overflow-wrap:anywhere] lg:table-cell lg:py-3 lg:pl-3 lg:pr-5 lg:align-top"
            >
              <span
                aria-hidden="true"
                className="mr-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-soft lg:hidden"
              >
                Sa limite
              </span>
              {renvoi ? (
                <a
                  href={renvoi.href}
                  className="rounded-sm text-ink underline decoration-line underline-offset-2 transition hover:decoration-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
                >
                  {renvoi.libelle}
                </a>
              ) : (
                "Non détaillée sur cette page"
              )}
            </td>
          </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * Les capacités du document de couverture, une famille par `<details>`, fermées :
 * l'annexe est le détail qu'on ouvre, les parties précédentes en donnent la lecture.
 * `familles` n'est un paramètre que pour les tests : la page lit le relevé.
 */
export function DetailCouverture({
  familles = parFamille(),
}: {
  familles?: { famille: string; capacites: Capacite[] }[];
}) {
  return (
    <div data-testid="annexe-couverture" className="mt-10 grid gap-3">
      {familles.map(({ famille, capacites }) => (
        <details
          key={famille}
          data-testid="annexe-famille"
          className="group relative rounded-xl border border-line bg-panel shadow-card"
        >
          <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3.5 transition-colors hover:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-perf group-open:rounded-b-none sm:px-5 [&::-webkit-details-marker]:hidden">
            <Icon
              paths={ICON_PATHS.chevronRight}
              className="h-4 w-4 shrink-0 text-ink-soft transition-transform group-open:rotate-90 motion-reduce:transition-none"
            />
            <span className="min-w-0 flex-1 font-semibold text-ink">{famille}</span>
            <span className="shrink-0 text-xs text-ink-soft">
              {capacites.length} {capacites.length > 1 ? "capacités" : "capacité"}
            </span>
          </summary>
          <TableFamille famille={famille} capacites={capacites} />
        </details>
      ))}
    </div>
  );
}

/**
 * Ce qui tient la place des Specs pendant leur lecture en base (plan § 8.2, PS11) :
 * annoncé comme occupé (`aria-busy`), à peu près de leur taille pour que la page ne
 * saute pas quand elles arrivent. Sans animation si le mouvement est réduit.
 */
export function SpecsChargement() {
  const bloc = "animate-pulse bg-panel2 motion-reduce:animate-none";
  return (
    <div
      role="status"
      aria-busy="true"
      data-testid="specs-chargement"
      className="mt-16 border-t border-line pt-12"
    >
      <p className="text-sm text-ink-soft">Chargement du détail technique</p>
      <div aria-hidden="true" className="mt-5 space-y-3">
        <div className={`h-7 w-72 max-w-full rounded-lg ${bloc}`} />
        <div className={`h-4 w-full max-w-2xl rounded ${bloc}`} />
        <div className="flex flex-wrap gap-2 pt-7">
          {["w-36", "w-32", "w-40"].map((w) => (
            <div key={w} className={`h-14 ${w} rounded-xl ${bloc}`} />
          ))}
        </div>
        <div className={`h-64 w-full rounded-2xl ${bloc}`} />
      </div>
    </div>
  );
}

export function Annexe() {
  return (
    <Partie
      id="detail"
      chapeau={
        <>
          Le registre des capacités au {RELEVE} : une ligne par capacité, son verdict, et où cette
          page dit sa limite. Puis les spécifications techniques.
        </>
      }
    >
      <DetailCouverture />
      <Suspense fallback={<SpecsChargement />}>
        <Specs />
      </Suspense>
    </Partie>
  );
}
