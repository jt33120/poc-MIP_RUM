// Frise d'états par seau (F56, plan § 4.2 et § 5.7 CR7-b) — rendu serveur, SVG
// déterministe ; seul le clavier passe par un îlot client (`FriseEtatsClavier`).
//
// UNE CASE PAR SEAU, ALIGNÉE AU PIXEL SUR LA SÉRIE AU-DESSUS. Axe x en TEMPS sur
// [grille[0], dernier début + seau], dans la zone de tracé des `SERIE_MARGES`
// (importées de lib/series.ts : une constante d'un module client arriverait ici comme
// une référence). `ThresholdSeries` découpe la même zone en autant de bandes égales
// que de seaux : le centre de la case i tombe sur le centre du seau i.
//
// L'ÉTAT SE LIT PAR LA FORME ET LE TEXTE, PAS PAR LA COULEUR. Hauteur (basse /
// moyenne / haute), glyphe (« ! », « × »), contour pointillé (état inconnu), case
// vide hachurée (aucun passage) ; la couleur (`ton`) ne fait que doubler. Et chaque
// case a son libellé complet : heure UTC, état en toutes lettres, détail.
//
// AUCUNE BANDE, AUCUNE ÉCHELLE DE VALEUR. L'état d'un robot n'a pas de référence
// (R-S) : rien ici ne se lit comme un seuil.
//
// ÉTROIT. Quand une case ferait moins de `regrouperSousPx` px, les seaux sont
// regroupés par 3 (pire état du groupe, dit dans la légende). Le serveur ne connaît
// pas la largeur rendue : les deux couches sont rendues, et une requête de CONTENEUR
// (seuil calculé ici : seaux × px minimum + marges) montre l'une ou l'autre. Même
// mécanique pour les glyphes, masqués sous 9 px de case.
import { useId, type ReactNode } from "react";
import { TableAlternative } from "./Figure";
import { FriseEtatsClavier } from "./FriseEtatsClavier";
import { SERIE_MARGES, hrefZoom, libelleSeauComplet } from "@/lib/series";

export interface EtatDef {
  /** "ok" | "warn" | "incident" | "inconnu" | "absent". */
  cle: string;
  /** « ok », « avertissement », « incident », « état inconnu », « aucun passage ». */
  libelle: string;
  /** La forme porte l'état. */
  forme: "basse" | "moyenne" | "haute" | "contour" | "hachure";
  /** « ! » pour warn, « × » pour incident. */
  glyphe?: string;
  /** Couleur, jamais seule porteuse du sens. */
  ton: "neutre" | "warn" | "bad" | "vide";
}

export interface CaseEtat {
  t: string;
  etat: string;
  detail: string;
}

export interface FriseEtatsProps {
  /** Mêmes débuts de seau que la ThresholdSeries au-dessus. */
  grille: string[];
  seauSecondes: number;
  /** Une par élément de grille. */
  cases: CaseEtat[];
  etats: EtatDef[];
  /** Même gabarit que ThresholdSeries ({from}, {to}). */
  zoomHref?: string;
  /** Défaut 2 : cases regroupées (pire état) si plus étroites. */
  regrouperSousPx?: number;
  /** Défaut 44. */
  hauteur?: number;
  ariaLabel: string;
}

/** Seaux par groupe quand la frise est trop étroite (« regroupées par 3 h », § 5.7). */
export const REGROUPEMENT = 3;
/** Largeur de case sous laquelle les glyphes sont masqués. */
const GLYPHE_SOUS_PX = 9;

const TEINTE: Record<EtatDef["ton"], string> = {
  neutre: "text-ink-soft",
  warn: "text-warn",
  bad: "text-bad",
  vide: "text-ink-faint",
};

const PART_HAUTEUR: Record<EtatDef["forme"], number> = { basse: 0.35, moyenne: 0.65, haute: 1, contour: 1, hachure: 1 };

/** Une case posée : position et largeur en % de la zone de tracé. */
export interface CasePlacee {
  t: string;
  /** Durée couverte, en secondes (un seau, ou un groupe de seaux). */
  secondes: number;
  x: number;
  largeur: number;
  def: EtatDef;
  detail: string;
}

/** Définition d'un état ; un état inconnu du dictionnaire est dit tel quel, en contour. */
function definition(etats: EtatDef[], cle: string): EtatDef {
  return etats.find((e) => e.cle === cle) ?? { cle, libelle: cle, forme: "contour", ton: "vide" };
}

/** Rang de gravité, pour le « pire état » d'un groupe : ton d'abord, puis forme. */
export function gravite(def: EtatDef): number {
  const ton = { bad: 3, warn: 2, neutre: 1, vide: 0 }[def.ton];
  const forme = { haute: 4, moyenne: 3, basse: 2, contour: 1, hachure: 0 }[def.forme];
  return ton * 10 + forme;
}

/**
 * Pose les cases sur l'axe du temps. Une case absente de `cases` pour un élément de
 * la grille devient « absent » (aucun passage) : un seau sans ligne n'est pas un
 * seau « ok ».
 */
export function placerCases(grille: string[], seauSecondes: number, cases: CaseEtat[], etats: EtatDef[]): CasePlacee[] {
  if (grille.length === 0) return [];
  const debut = Date.parse(grille[0]);
  const fin = Date.parse(grille[grille.length - 1]) + seauSecondes * 1000;
  const duree = Math.max(fin - debut, 1);
  const parT = new Map(cases.map((c) => [c.t, c]));
  return grille.map((t) => {
    const c = parT.get(t);
    const ms = Date.parse(t);
    return {
      t,
      secondes: seauSecondes,
      x: ((ms - debut) / duree) * 100,
      largeur: ((seauSecondes * 1000) / duree) * 100,
      def: definition(etats, c?.etat ?? "absent"),
      detail: c?.detail ?? "aucune donnée",
    };
  });
}

/** Regroupe les cases par `k` seaux consécutifs ; chaque groupe prend le pire état. */
export function regrouperCases(placees: CasePlacee[], k = REGROUPEMENT): CasePlacee[] {
  const groupes: CasePlacee[] = [];
  for (let i = 0; i < placees.length; i += k) {
    const bloc = placees.slice(i, i + k);
    const pire = bloc.reduce((p, c) => (gravite(c.def) > gravite(p.def) ? c : p));
    groupes.push({
      t: bloc[0].t,
      secondes: bloc.reduce((s, c) => s + c.secondes, 0),
      x: bloc[0].x,
      largeur: bloc.reduce((s, c) => s + c.largeur, 0),
      def: pire.def,
      detail: `pire état des ${bloc.length} seaux ; ${bloc.map((c) => c.def.libelle).join(", ")}`,
    });
  }
  return groupes;
}

/** Libellé complet d'une case : heure UTC, état en toutes lettres, détail. */
export function libelleCase(c: CasePlacee): string {
  return `${libelleSeauComplet(c.t, c.secondes, "UTC")} : ${c.def.libelle} — ${c.detail}`;
}

/** Le dessin d'un état, dans une case de `hauteur` px. */
function FormeCase({ c, zone, haut, motif }: { c: CasePlacee; zone: number; haut: number; motif: string }) {
  const h = Math.max(zone * PART_HAUTEUR[c.def.forme], 2);
  const y = haut + zone - h;
  const x = `${c.x}%`;
  const w = `${c.largeur}%`;
  const plein = c.def.forme === "basse" || c.def.forme === "moyenne" || c.def.forme === "haute";
  return (
    <g className={TEINTE[c.def.ton]} data-etat={c.def.cle} data-forme={c.def.forme} data-plein={plein ? "true" : "false"}>
      {plein && <rect x={x} y={y} width={w} height={h} fill="currentColor" stroke="rgb(var(--c-panel))" strokeWidth={1} />}
      {c.def.forme === "contour" && (
        <rect x={x} y={y} width={w} height={h} fill="none" stroke="currentColor" strokeWidth={1} strokeDasharray="2 2" />
      )}
      {c.def.forme === "hachure" && (
        <rect x={x} y={y} width={w} height={h} fill={`url(#${motif})`} stroke="rgb(var(--c-panel))" strokeWidth={1} />
      )}
      {c.def.glyphe && (
        <text
          x={`${c.x + c.largeur / 2}%`}
          y={y + 10}
          fontSize={10}
          fontWeight={700}
          textAnchor="middle"
          fill={plein ? "rgb(var(--c-panel))" : "currentColor"}
          className="fe-glyphe"
        >
          {c.def.glyphe}
        </text>
      )}
      {/* Cadre de focus, visible seulement au clavier (règle dans le <style> de la frise). */}
      <rect x={x} y={1} width={w} height={haut + zone} fill="none" stroke="rgb(var(--c-brand))" strokeWidth={2} className="fe-focus" />
    </g>
  );
}

export function FriseEtats({
  grille,
  seauSecondes,
  cases,
  etats,
  zoomHref,
  regrouperSousPx = 2,
  hauteur = 44,
  ariaLabel,
}: FriseEtatsProps) {
  // Identifiant sûr pour un sélecteur CSS et un url(#…) (useId rend « «r0» » ou « :r0: »).
  const uid = `fe${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const motif = `${uid}-hachure`;
  const placees = placerCases(grille, seauSecondes, cases, etats);
  const groupees = placees.length > REGROUPEMENT ? regrouperCases(placees) : null;
  const marges = SERIE_MARGES.gauche + SERIE_MARGES.droite;
  const maintenant = Date.now();
  const haut = 3;
  const zone = hauteur - haut - 2;

  // Seuils de largeur du CONTENEUR (marges comprises) sous lesquels une couche change.
  const seuilGroupe = placees.length * regrouperSousPx + marges;
  const seuilGlyphe = placees.length * GLYPHE_SOUS_PX + marges;
  const seuilGlypheGroupe = (groupees?.length ?? 0) * GLYPHE_SOUS_PX + marges;
  const css = [
    `.${uid}{container-type:inline-size}`,
    `.${uid} .fe-groupe{display:none}`,
    `.${uid} .fe-focus{visibility:hidden}`,
    `.${uid} [data-case]:focus{outline:none}`,
    `.${uid} [data-case]:focus-visible .fe-focus{visibility:visible}`,
    `@container (max-width:${seuilGlyphe - 0.02}px){.${uid} .fe-detail .fe-glyphe{display:none}}`,
    `@container (max-width:${seuilGlypheGroupe - 0.02}px){.${uid} .fe-groupe .fe-glyphe{display:none}}`,
    groupees ? `@container (max-width:${seuilGroupe - 0.02}px){.${uid} .fe-detail{display:none}.${uid} .fe-groupe{display:block}}` : "",
  ].join("");

  const couche = (liste: CasePlacee[], classe: string, regroupee: boolean): ReactNode => (
    <div className={classe} style={{ paddingLeft: SERIE_MARGES.gauche, paddingRight: SERIE_MARGES.droite }} data-couche={regroupee ? "groupe" : "detail"}>
      <svg width="100%" height={hauteur} className="block overflow-visible" role="group" aria-label={ariaLabel}>
        {liste.map((c, i) => {
          const libelle = libelleCase(c);
          const forme = <FormeCase c={c} zone={zone} haut={haut} motif={motif} />;
          const href = zoomHref ? hrefZoom(zoomHref, c.t, c.secondes, maintenant) : null;
          return href ? (
            <a key={c.t} href={href} data-case="" tabIndex={i === 0 ? 0 : -1} aria-label={libelle}>
              <title>{libelle}</title>
              {forme}
            </a>
          ) : (
            <g key={c.t} data-case="" tabIndex={i === 0 ? 0 : -1} role="img" aria-label={libelle}>
              <title>{libelle}</title>
              {forme}
            </g>
          );
        })}
      </svg>
    </div>
  );

  return (
    <div className={`${uid} min-w-0`} data-testid="frise-etats" data-cases={placees.length}>
      <style>{css}</style>
      {/* Le motif prend la couleur de SON contexte (ce SVG), pas celle de la case qui le cite. */}
      <svg width="0" height="0" className="absolute text-ink-faint" aria-hidden="true" focusable="false">
        <defs>
          <pattern id={motif} patternUnits="userSpaceOnUse" width={4} height={4} patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={4} stroke="currentColor" strokeWidth={1} />
          </pattern>
        </defs>
      </svg>
      <FriseEtatsClavier>
        {couche(placees, "fe-detail", false)}
        {groupees && couche(groupees, "fe-groupe", true)}
      </FriseEtatsClavier>

      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-soft" data-testid="frise-etats-legende">
        {etats.map((e) => (
          <li key={e.cle} className="flex items-center gap-1">
            <svg width={10} height={12} aria-hidden="true" className={TEINTE[e.ton]}>
              {e.forme === "contour" ? (
                <rect x={0.5} y={0.5} width={9} height={11} fill="none" stroke="currentColor" strokeDasharray="2 2" />
              ) : e.forme === "hachure" ? (
                <rect x={0} y={0} width={10} height={12} fill={`url(#${motif})`} />
              ) : (
                <rect x={0} y={12 - 12 * PART_HAUTEUR[e.forme]} width={10} height={12 * PART_HAUTEUR[e.forme]} fill="currentColor" />
              )}
            </svg>
            {e.libelle}
            {e.glyphe ? ` (${e.glyphe})` : ""}
          </li>
        ))}
        {groupees && (
          <li className="fe-groupe" data-testid="frise-etats-regroupee">
            cases regroupées par {REGROUPEMENT} seaux : pire état du groupe
          </li>
        )}
      </ul>

      <TableAlternative
        alternative={{
          legende: `${ariaLabel} — un seau par ligne (UTC).`,
          colonnes: ["Seau (UTC)", "État", "Détail"],
          lignes: placees.map((c) => [libelleSeauComplet(c.t, c.secondes, "UTC"), c.def.libelle, c.detail]),
        }}
      />
    </div>
  );
}
