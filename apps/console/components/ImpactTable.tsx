// Classement de segments « les plus dégradés » (F05, plan § 4.2, P3) — IP-Label
// « top offenders », avec l'écart à l'ensemble. Rendu serveur, sans JS client.
//
// CE QUE LE CLASSEMENT DIT, ET CE QU'IL NE FAIT JAMAIS.
//   - Les lignes arrivent DÉJÀ classées (`classerParGravite`, lib/impact.ts) : le
//     composant n'ordonne rien, il dit l'ordre (bascule de tri, ou `ordreLibelle`
//     quand l'ordre est celui de la source).
//   - La référence « Ensemble » est une LIGNE DE TABLE distincte, jamais une barre :
//     elle ne se classe pas parmi les segments, elle se lit à côté.
//   - Aucune ligne « Autres », aucun total : un p75 ne s'additionne pas (V5).
//   - Une valeur pilote inconnue n'a pas de barre (une barre nulle se lirait « le
//     meilleur ») ; un échantillon faible est écrit, pas seulement grisé.
//   - Un verdict (Bon / À améliorer / Mauvais) n'est posé que sur une mesure qui
//     porte `vital` — l'appelant ne le donne qu'à un p75 (R-V) — et toujours en
//     texte à côté de la teinte (§ 3.9).
//
// Accessibilité : la grammaire de `Breakdown` — la ligne EST le lien (un arrêt de
// tabulation), les rectangles sont décoratifs, le tableau replié donne tout.
import Link from "next/link";
import type { ReactNode } from "react";
import { BasculeTri, LIBELLES_TRI, MarqueFaible, OngletsDecoupage, type OngletDecoupage } from "./Breakdown";
import { TableAlternative } from "./charts/Figure";
import { formater, type FormatId, type VitalName } from "@/lib/fmt-ids";
import type { TriClassement } from "@/lib/impact";
import { RATING_CLASS, RATING_LABEL, rating2026 } from "@/lib/rating";
import { TRIS_INDISPONIBLES } from "@/lib/view-state";

export interface ImpactMesure {
  cle: string;
  valeur: number | null;
  affichage: string;
  /** Pose un verdict : réservé à un p75 de vital (R-V). */
  vital?: VitalName;
  n?: number | null;
}

export interface ImpactLigne {
  /** « Inconnu » a sa clé propre. */
  cle: string;
  libelle: string;
  /** Drill-down (§ 3.3) ; null = ligne non cliquable, raison dans l'alternative. */
  href: string | null;
  /** Libellé complet annoncé par le lien. */
  description: string;
  /** Valeur qui trie et dessine la barre. */
  pilote: number | null;
  /** Effectif de la ligne (mesures, sessions, appels…). */
  volume: number | null;
  /** Colonnes additionnelles, dans l'ordre de `colonnes`. */
  mesures: ImpactMesure[];
  /** « +1,2 s vs ensemble » : un écart de p75, jamais une contribution. */
  ecart?: { valeur: number | null; affichage: string };
  /** P*.1 : « 2,1 – 3,0 s ». */
  intervalle?: string | null;
  echantillonFaible: boolean;
}

export type TriImpact = TriClassement;

const FORMATS: readonly string[] = ["ms", "s-auto", "cls", "pct", "count", "bytes", "score", "ratio", "pour100"];

/** Valeur pilote affichée : `unitePilote` est un `FormatId`, ou une unité libre (« appels »). */
function affichePilote(unitePilote: string, v: number | null): string {
  if (FORMATS.includes(unitePilote)) return formater(unitePilote as FormatId, v);
  return v == null || !Number.isFinite(v) ? "—" : `${v.toLocaleString("fr-FR")} ${unitePilote}`;
}

/** Raison d'un ordre indisponible (`triHref[id] === null`). */
function raisonTri(id: "gravite" | "volume" | "impact"): string {
  if (id === "impact") return TRIS_INDISPONIBLES.impact ?? "le classement par impact n'est pas proposé ici";
  return "ordre non proposé sur cet écran";
}

/** Une mesure, avec son verdict écrit quand elle en porte un. */
function Mesure({ m, libelle }: { m: ImpactMesure; libelle: string }) {
  const verdict = m.vital && m.valeur != null ? rating2026(m.vital, m.valeur) : null;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-ink-soft">{libelle}</span>
      {verdict ? (
        <>
          <span className={`rounded border px-1 py-px font-medium tabular-nums ${RATING_CLASS[verdict]}`}>{m.affichage}</span>
          <span className="text-[10px] text-ink-soft">{RATING_LABEL[verdict]}</span>
        </>
      ) : (
        <span className="tabular-nums text-ink">{m.valeur == null ? "—" : m.affichage}</span>
      )}
    </span>
  );
}

/** Texte d'une mesure pour l'alternative : valeur et verdict en toutes lettres. */
function texteMesure(m: ImpactMesure): string {
  if (m.valeur == null) return "—";
  const verdict = m.vital ? rating2026(m.vital, m.valeur) : null;
  return verdict ? `${m.affichage} (${RATING_LABEL[verdict]})` : m.affichage;
}

export function ImpactTable({
  titre,
  onglets,
  tri,
  triHref,
  ordreLibelle,
  reference,
  referenceRaison,
  lignes,
  colonnes,
  unitePilote,
  volumeLibelle,
  groupes,
  tronque,
  notice,
  compact = false,
}: {
  titre: string;
  /** Dimensions, mêmes règles que `Breakdown` (raison si indisponible). */
  onglets?: OngletDecoupage[];
  tri: TriImpact;
  /** null = ordre indisponible (raison en title et en texte lu) ; `fourni` : toujours null. */
  triHref: Record<TriImpact, string | null>;
  /** OBLIGATOIRE si tri === "fourni" : l'ordre, écrit sous le titre. */
  ordreLibelle?: string;
  /** Ligne « Ensemble », non classée ; `valeurs` indexées par `cle` de mesure, plus `pilote` et `volume`. */
  reference: { libelle: string; valeurs: Record<string, string> } | null;
  /** OBLIGATOIRE si reference === null : dit à la place de la ligne. */
  referenceRaison?: string;
  /** Déjà classées côté serveur (lib/impact.ts), sauf tri « fourni ». */
  lignes: ImpactLigne[];
  /** En-têtes des `mesures`, dans leur ordre. */
  colonnes: string[];
  /** Format de la valeur pilote (`FormatId`) ou unité libre. */
  unitePilote: string;
  /** « Mesures LCP », « Sessions », « Appels ». */
  volumeLibelle: string;
  /** Nombre réel de groupes. */
  groupes: number;
  tronque: boolean;
  /** Provenance de la dimension (BREAKDOWN_NOTICES). */
  notice: string;
  /** Carte de tableau de bord. */
  compact?: boolean;
}) {
  const pilotes = lignes.map((l) => l.pilote).filter((p): p is number => p != null && Number.isFinite(p));
  const max = Math.max(1, ...pilotes);
  const avecEcart = lignes.some((l) => l.ecart !== undefined);
  const avecIntervalle = lignes.some((l) => l.intervalle != null);
  const avecFaible = lignes.some((l) => l.echantillonFaible);
  const avecSansLien = lignes.some((l) => l.href === null);
  const nombre = (n: number | null) => (n == null ? "—" : n.toLocaleString("fr-FR"));

  const enTetes = [
    "Groupe",
    `Valeur classée (${unitePilote})`,
    volumeLibelle,
    ...colonnes,
    ...(avecEcart ? ["Écart à l'ensemble"] : []),
    ...(avecIntervalle ? ["Intervalle"] : []),
    ...(avecFaible ? ["Échantillon"] : []),
    ...(avecSansLien ? ["Lien"] : []),
  ];
  const ligneAlternative = (l: ImpactLigne): ReactNode[] => [
    l.libelle,
    affichePilote(unitePilote, l.pilote),
    nombre(l.volume),
    ...colonnes.map((_c, i) => (l.mesures[i] ? texteMesure(l.mesures[i]) : null)),
    ...(avecEcart ? [l.ecart?.affichage ?? null] : []),
    ...(avecIntervalle ? [l.intervalle ?? null] : []),
    ...(avecFaible ? [l.echantillonFaible ? "faible" : ""] : []),
    ...(avecSansLien ? [l.href ? "oui" : "non cliquable"] : []),
  ];
  const cleMesures = lignes[0]?.mesures.map((m) => m.cle) ?? [];
  const ligneReference: ReactNode[] | null = reference
    ? [
        reference.libelle,
        reference.valeurs.pilote ?? null,
        reference.valeurs.volume ?? null,
        ...colonnes.map((_c, i) => (cleMesures[i] ? (reference.valeurs[cleMesures[i]] ?? null) : null)),
        ...(avecEcart ? ["référence"] : []),
        ...(avecIntervalle ? [null] : []),
        ...(avecFaible ? [""] : []),
        ...(avecSansLien ? ["—"] : []),
      ]
    : null;

  return (
    <section className={`card min-w-0 ${compact ? "p-3" : "mb-6 p-4"}`} data-testid="impact-table" data-tri={tri}>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="min-w-0 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">{titre}</h2>
        {tri !== "fourni" && (
          <div className="sm:ml-auto">
            <BasculeTri
              courant={tri}
              options={(["gravite", "volume", "impact"] as const).map((id) => ({
                id,
                libelle: LIBELLES_TRI[id],
                href: triHref[id],
                raison: triHref[id] === null ? raisonTri(id) : undefined,
              }))}
            />
          </div>
        )}
      </div>
      {tri === "fourni" && ordreLibelle && (
        <p className="-mt-2 mb-3 text-xs text-ink-soft" data-testid="impact-ordre">
          {ordreLibelle}
        </p>
      )}

      {onglets && <OngletsDecoupage titre={titre} onglets={onglets} />}
      <p className={`mb-3 leading-relaxed text-ink-soft ${compact ? "text-[11px]" : "text-xs"}`}>{notice}</p>

      {reference ? (
        <div
          className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-dashed border-line px-2 py-1.5 text-xs"
          data-testid="impact-reference"
        >
          <span className="min-w-0 basis-full font-semibold text-ink sm:basis-44">{reference.libelle}</span>
          {reference.valeurs.pilote && <span className="tabular-nums text-ink">{reference.valeurs.pilote}</span>}
          {reference.valeurs.volume && (
            <span className="tabular-nums text-ink-soft">
              {volumeLibelle} {reference.valeurs.volume}
            </span>
          )}
          {cleMesures.map((cle, i) =>
            reference.valeurs[cle] ? (
              <span key={cle} className="tabular-nums text-ink-soft">
                {colonnes[i]} {reference.valeurs[cle]}
              </span>
            ) : null,
          )}
          <span className="text-[11px] text-ink-soft sm:ml-auto">référence, non classée</span>
        </div>
      ) : (
        <p className="mb-2 text-xs text-ink-soft" data-testid="impact-reference-absente">
          Pas de ligne « Ensemble » : {referenceRaison}
        </p>
      )}

      {lignes.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-soft">Aucun groupe à classer sur la fenêtre.</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {lignes.map((l) => {
            const contenu = (
              <>
                <span className="min-w-0 basis-full truncate font-mono text-xs text-ink sm:basis-44" title={l.libelle}>
                  {l.libelle}
                </span>
                <span className="relative h-5 min-w-24 flex-1 overflow-hidden rounded bg-panel2">
                  {l.pilote != null && Number.isFinite(l.pilote) && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-0 left-0 rounded bg-accent/70"
                      style={{ width: `${Math.max(2, (l.pilote / max) * 100)}%` }}
                    />
                  )}
                  <span className="absolute inset-y-0 right-2 flex items-center">
                    <span className="rounded bg-panel/90 px-1 text-xs font-semibold tabular-nums text-ink">
                      {affichePilote(unitePilote, l.pilote)}
                    </span>
                  </span>
                </span>
                <span className="flex min-w-0 basis-full flex-wrap items-center gap-x-3 gap-y-0.5 text-xs sm:basis-auto">
                  <span className="tabular-nums text-ink-soft">
                    {volumeLibelle} <span className="text-ink">{nombre(l.volume)}</span>
                  </span>
                  {l.mesures.map((m, i) => (
                    <Mesure key={m.cle} m={m} libelle={colonnes[i] ?? m.cle} />
                  ))}
                  {l.ecart && (
                    <span className="tabular-nums text-ink" data-testid="impact-ecart">
                      {l.ecart.affichage}
                    </span>
                  )}
                  {l.intervalle && <span className="tabular-nums text-ink-soft">{l.intervalle}</span>}
                  {l.echantillonFaible && <MarqueFaible />}
                </span>
              </>
            );
            const classe =
              "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-1.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf";
            return (
              <li key={l.cle} data-testid="impact-ligne" data-faible={l.echantillonFaible ? "1" : undefined}>
                {l.href ? (
                  <Link
                    href={l.href}
                    aria-label={`${l.description}${l.echantillonFaible ? ", échantillon faible" : ""} — ouvrir le détail`}
                    className={`${classe} hover:bg-panel2/70`}
                  >
                    {contenu}
                  </Link>
                ) : (
                  <div className={classe}>{contenu}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {lignes.length > 0 && (
        <TableAlternative
          alternative={{
            legende: `${titre} — ${lignes.length.toLocaleString("fr-FR")} groupe(s) affiché(s) sur ${groupes.toLocaleString("fr-FR")}${
              tri === "fourni" ? `, ${ordreLibelle ?? "ordre de la source"}` : `, classés par ${LIBELLES_TRI[tri].toLowerCase()}`
            }`,
            colonnes: enTetes,
            lignes: [...(ligneReference ? [ligneReference] : []), ...lignes.map(ligneAlternative)],
          }}
        />
      )}

      <p className="mt-2 text-xs text-ink-soft" data-testid="impact-couverture">
        {groupes.toLocaleString("fr-FR")} groupe(s) sur la fenêtre, {lignes.length.toLocaleString("fr-FR")} affiché(s)
        {tronque
          ? " — les autres ne sont ni repliés dans « Autres », ni additionnés : un p75 ne s'additionne pas."
          : "."}
      </p>
    </section>
  );
}
