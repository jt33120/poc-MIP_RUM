// « Qui sont ces sessions » (F41, § 5.11.4) en FACETTES (refonte du 30/09/2026,
// charte § 3.5 et capture 06) : la colonne de gauche de la liste. Une ligne par
// groupe — pictogramme (logo, drapeau, appareil), nom, compte, part — et une barre
// proportionnelle sous la ligne. Un clic filtre l'écran sur le groupe.
//
// POURQUOI PAS `Breakdown`. Le découpage partagé écrit sa notice en paragraphe au-dessus
// des barres et range ses colonnes pour une pleine largeur ; en facette de 270 px, la
// notice passe dans une bulle et la ligne tient sur 28 px. Les repères de test restent
// ceux du découpage (`breakdown-tab-<dimension>`, `breakdown-row`) : les e2e les désignent.
//
// Rendu serveur ; les liens sont calculés par la page (aucune fonction en prop client).
import Link from "next/link";
import { OngletsDecoupage, type OngletDecoupage } from "@/components/Breakdown";
import { InfoTip } from "@/components/InfoTip";
import { TableAlternative } from "@/components/charts/Figure";
import { PictoDimension } from "@/components/sessions/Pictos";

export interface GroupeRepartition {
  /** Clé de rendu ; « Inconnu » a la sienne, distincte de toute valeur réelle. */
  cle: string;
  /** Valeur brute (code pays, famille de navigateur…) : choisit le pictogramme. `null` : inconnue. */
  valeur: string | null;
  libelle: string;
  sessions: number;
  /** Compte écrit (« 1 234 »). */
  compte: string;
  /** Part du tout, écrite (« 42,0 % »). */
  part: string;
  href: string;
  /** Libellé complet annoncé par le lien. */
  description: string;
}

export function RepartitionSessions({
  titre,
  dimension,
  onglets,
  groupes,
  notice,
  reste,
  precision,
  vide,
  legende,
}: {
  titre: string;
  dimension: string;
  onglets: OngletDecoupage[];
  groupes: GroupeRepartition[];
  /** Ce que vaut la dimension (provenance, total, règle du clic) : dans la bulle du titre. */
  notice: string;
  /** Sessions des groupes non affichés, déjà écrites (« 12 sessions (3,1 %) »), ou `null`. */
  reste: string | null;
  /** Provenance chiffrée du pays estimé, sous « Pays estimé » seulement. */
  precision?: string | null;
  vide: string;
  /** Légende de l'alternative textuelle. */
  legende: string;
}) {
  const max = Math.max(1, ...groupes.map((g) => g.sessions));
  const indisponibles = onglets.filter((o) => !o.available && o.reason);
  return (
    <section className="card min-w-0 p-3" data-testid="repartition-sessions" aria-labelledby="repartition-sessions-titre">
      <h2
        id="repartition-sessions-titre"
        className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-soft"
      >
        <span className="min-w-0 truncate">{titre}</span>
        <InfoTip label={`À propos : ${titre}`} align="start">
          <span data-testid="repartition-notice">{notice}</span>
        </InfoTip>
      </h2>
      <OngletsDecoupage titre={titre} onglets={onglets} />
      {groupes.length === 0 ? (
        <p className="flex items-center gap-1.5 py-1 text-xs text-ink-soft">
          <span aria-hidden="true" className="text-ink-faint">
            ⊘
          </span>
          {vide}
        </p>
      ) : (
        <ul className="-mx-1 flex flex-col">
          {groupes.map((g) => (
            <li key={g.cle}>
              <Link
                href={g.href}
                aria-label={`${g.description} — filtrer l'écran sur ce groupe`}
                data-testid="breakdown-row"
                className="group block rounded-md px-1 py-1 transition hover:bg-panel2/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
              >
                <span className="flex min-w-0 items-center gap-1.5 text-xs">
                  <PictoDimension dimension={dimension} valeur={g.valeur} />
                  <span className="min-w-0 flex-1 truncate text-ink" title={g.libelle}>
                    {g.libelle}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-ink">{g.compte}</span>
                  <span className="w-12 shrink-0 text-right tabular-nums text-ink-soft">{g.part}</span>
                </span>
                {/* La barre proportionnelle, sous la ligne : une piste commune à tous les groupes. */}
                <span aria-hidden="true" className="mt-0.5 block h-1 overflow-hidden rounded-full bg-panel2">
                  <span
                    className="block h-full rounded-full bg-accent/70 transition group-hover:bg-accent"
                    style={{ width: `${Math.max(2, (g.sessions / max) * 100)}%` }}
                  />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {reste && (
        <p className="mt-1.5 text-[11px] text-ink-faint" data-testid="repartition-reste">
          + autres groupes : {reste}
        </p>
      )}
      {precision && (
        <p className="mt-1.5 text-[11px] text-ink-soft" data-testid="breakdown-precision">
          {precision}
        </p>
      )}
      {indisponibles.length > 0 && (
        <ul className="sr-only">
          {indisponibles.map((o) => (
            <li key={o.dimension}>{o.reason}</li>
          ))}
        </ul>
      )}
      {groupes.length > 0 && (
        <TableAlternative
          titre="Alternative textuelle"
          alternative={{
            legende,
            colonnes: ["Groupe", "Sessions commencées", "Part"],
            lignes: groupes.map((g) => [g.libelle, g.compte, g.part]),
          }}
        />
      )}
    </section>
  );
}
