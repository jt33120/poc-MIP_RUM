// La grammaire commune des écrans d'administration (refonte du 01/10/2026) : un
// panneau à en-tête court, des tableaux denses, des pastilles d'état, une ligne pour
// un état vide, une barre proportionnelle, un instant relatif. Rendu serveur.
//
// POURQUOI UN SEUL VOCABULAIRE. Chaque écran d'administration composait sa carte, son
// en-tête de tableau (lignes de 40 à 60 px), sa pastille et son état vide (grande
// boîte centrée, paragraphe) : onze écrans, onze variantes, et « trop de blanc ».
// Ici : lignes de 32 px, en-têtes de 11 px en capitales, nombres à droite en chiffres
// tabulaires, explications dans la bulle « ? » du panneau — jamais à l'écran.
import type { ReactNode } from "react";
import { InfoTip } from "@/components/InfoTip";
import { fmtInstant } from "@/lib/format";
import { ilYa, versMs } from "./temps";

/** En-tête de colonne dense (11 px, capitales, gris) ; `TH_NUM` pour une colonne chiffrée. */
export const TH = "whitespace-nowrap px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-faint";
export const TH_NUM = `${TH} text-right`;
/** Cellule dense : une ligne de 32 px pour un texte de 13-14 px. */
export const TD = "px-3 py-1.5 align-middle";
export const TD_NUM = `${TD} text-right tabular-nums`;
/** Ligne de tableau : survol teinté, séparateur fin. */
export const LIGNE = "transition hover:bg-panel2/60";
/** Le cadre d'un tableau rangé en bas d'un `Panneau` : il épouse les coins arrondis du panneau. */
export const ARRONDI_BAS = "rounded-b-xl";
/** Un identifiant en chasse fixe dans une cellule (application, version) : 16 px de haut, la ligne reste à 32 px. */
export const PUCE_ID = "chip-mono whitespace-nowrap py-0 text-[11px] leading-4";
/** Bouton d'action de ligne : 22 px de haut, la ligne du tableau reste à 32-34 px. */
export const BOUTON_LIGNE =
  "inline-flex items-center whitespace-nowrap rounded-md border border-line bg-panel px-2 py-0.5 text-[11px] font-medium leading-4 text-ink-soft transition hover:bg-panel2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf";
/** Le même, pour un geste destructeur (déclencheur de `ConfirmationDanger`). */
export const BOUTON_LIGNE_DANGER =
  "inline-flex items-center whitespace-nowrap rounded-md border border-bad/40 bg-panel px-2 py-0.5 text-[11px] font-medium leading-4 text-bad-ink transition hover:bg-bad/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bad/40";
/** Libellé de champ compact (au-dessus du champ). */
export const LIBELLE_CHAMP = "flex min-w-0 max-w-full flex-col gap-1 text-[11px] font-medium text-ink-soft";

/**
 * Un panneau : titre court en petites capitales, compte, bulle d'aide, actions à
 * droite ; puis son contenu, bord à bord (un tableau touche les bords du panneau).
 * Pas de `section` nommée : le tableau porte déjà la région nommée
 * (`TableDefilante`), et deux régions du même nom se confondraient.
 *
 * Pas d'`overflow-hidden` sur le cadre : il rognait la bulle « ? » de l'en-tête d'un
 * panneau court (une ligne vide). Le tableau, dernier enfant, arrondit lui-même ses
 * coins bas (`ARRONDI_BAS`).
 */
export function Panneau({
  titre,
  compte,
  aide,
  actions,
  barre,
  children,
  id,
  testId,
  className = "",
}: {
  titre: ReactNode;
  /** Nombre d'éléments, écrit à côté du titre (« 12 »). */
  compte?: number | string | null;
  /** L'explication (méthode, règle, conséquence) : dans la bulle « ? », pas à l'écran. */
  aide?: ReactNode;
  /** Boutons et liens à droite de l'en-tête. */
  actions?: ReactNode;
  /** Une seconde ligne sous l'en-tête : filtre, formulaire en ligne, pastilles. */
  barre?: ReactNode;
  children?: ReactNode;
  id?: string;
  testId?: string;
  className?: string;
}) {
  return (
    <div id={id} data-testid={testId} className={`card min-w-0 ${className}`}>
      <div className="flex min-h-[2.5rem] flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-3 py-1.5">
        <h2 className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
          <span className="min-w-0 truncate">{titre}</span>
          {compte != null && (
            <span className="rounded-full bg-panel2 px-1.5 py-px text-[11px] font-semibold normal-case tabular-nums tracking-normal text-ink">
              {typeof compte === "number" ? compte.toLocaleString("fr-FR") : compte}
            </span>
          )}
        </h2>
        {aide && (
          <InfoTip label={`Aide : ${typeof titre === "string" ? titre : "ce panneau"}`} align="start">
            {aide}
          </InfoTip>
        )}
        {actions && <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
      </div>
      {barre && <div className="border-b border-line bg-panel2/30 px-3 py-2 last:rounded-b-xl last:border-b-0">{barre}</div>}
      {children}
    </div>
  );
}

export type TonPastille = "bon" | "attention" | "mauvais" | "neutre" | "eteint";

const TONS: Record<TonPastille, { cadre: string; point: string }> = {
  bon: { cadre: "border-good/30 bg-good/10 text-good-ink", point: "bg-good" },
  attention: { cadre: "border-warn/40 bg-warn/10 text-warn-ink", point: "bg-warn" },
  mauvais: { cadre: "border-bad/30 bg-bad/10 text-bad-ink", point: "bg-bad" },
  neutre: { cadre: "border-line bg-panel2 text-ink", point: "bg-ink-faint" },
  eteint: { cadre: "border-line bg-panel2 text-ink-faint", point: "bg-line" },
};

/**
 * Une pastille d'état : un point de couleur ET un mot (la couleur ne porte jamais
 * seule le sens). Le point est décoratif : le nom accessible de la cellule reste le
 * mot (« révoqué »), que les tests lisent tel quel.
 */
export function Pastille({ ton, children, titre }: { ton: TonPastille; children: ReactNode; titre?: string }) {
  const t = TONS[ton];
  return (
    <span
      title={titre}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-px text-[11px] font-medium leading-4 ${t.cadre}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.point}`} />
      {children}
    </span>
  );
}

/**
 * Un état vide : UNE ligne grise dans le panneau (⊘, le fait, le geste suivant). La
 * raison longue passe dans `aide` (bulle), pas dans un paragraphe.
 */
export function LigneVide({
  children,
  aide,
  geste,
  testId,
  role = "status",
}: {
  children: ReactNode;
  aide?: ReactNode;
  geste?: ReactNode;
  testId?: string;
  role?: "status" | "note";
}) {
  return (
    <div role={role} data-testid={testId} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2.5 text-xs text-ink-soft">
      <span aria-hidden className="text-sm leading-none text-ink-faint">
        ⊘
      </span>
      <span className="min-w-0">{children}</span>
      {aide && (
        <InfoTip label="Pourquoi" align="start">
          {aide}
        </InfoTip>
      )}
      {geste && <span className="font-medium">{geste}</span>}
    </div>
  );
}

/**
 * Une barre proportionnelle intégrée à une cellule (volume, part, quota) : piste grise,
 * remplissage neutre — un volume n'est pas un verdict ; `ton` colore seulement un ÉTAT
 * (dépassement, panne). `part` de 0 à 1 ; `null` : pas de barre.
 */
export function Barre({ part, ton = "neutre", largeur = "w-16" }: { part: number | null; ton?: "neutre" | "serie" | "bon" | "attention" | "mauvais"; largeur?: string }) {
  if (part == null || !Number.isFinite(part)) return null;
  const couleur = { neutre: "bg-ink-faint/70", serie: "bg-serie", bon: "bg-good", attention: "bg-warn", mauvais: "bg-bad" }[ton];
  return (
    <span aria-hidden className={`inline-block h-1.5 ${largeur} shrink-0 overflow-hidden rounded-full bg-line align-middle`}>
      <span className={`block h-full rounded-full ${couleur}`} style={{ width: `${Math.round(Math.min(1, Math.max(0, part)) * 100)}%` }} />
    </span>
  );
}

/** Un nombre et sa barre, alignés à droite dans une cellule chiffrée. */
export function NombreBarre({ texte, part, ton }: { texte: ReactNode; part: number | null; ton?: "neutre" | "serie" | "bon" | "attention" | "mauvais" }) {
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="tabular-nums">{texte}</span>
      <Barre part={part} ton={ton} />
    </span>
  );
}

/**
 * Un instant, écrit relatif (« il y a 3 min ») ; l'instant exact, heure de Paris, au
 * survol et pour le lecteur d'écran. `vide` : le mot à écrire sans instant (« jamais »).
 */
export function Moment({ date, maintenant, vide = "—" }: { date: Date | string | null | undefined; maintenant: number; vide?: string }) {
  if (date == null) return <span className="text-ink-faint">{vide}</span>;
  const ms = versMs(date);
  if (!Number.isFinite(ms)) return <span className="text-ink-faint">—</span>;
  const exact = fmtInstant(ms, { annee: true });
  return (
    <time dateTime={new Date(ms).toISOString()} title={exact} className="whitespace-nowrap tabular-nums">
      {ilYa(ms, maintenant)}
      <span className="sr-only"> ({exact})</span>
    </time>
  );
}

/**
 * Une explication repliée DANS le flux : là où une bulle serait rognée (la cellule
 * d'un tableau qui défile), le repli s'ouvre sur place et allonge la ligne.
 */
export function Repli({ libelle, children }: { libelle: string; children: ReactNode }) {
  return (
    <details className="min-w-0 text-xs">
      <summary
        aria-label={libelle}
        title={libelle}
        className="inline-flex cursor-pointer select-none list-none items-center rounded-full text-ink-faint hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf [&::-webkit-details-marker]:hidden"
      >
        <span aria-hidden className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-line text-[10px] font-semibold leading-none">
          ?
        </span>
      </summary>
      <div className="mt-1 max-w-[28rem] leading-relaxed text-ink-soft">{children}</div>
    </details>
  );
}

/** La rangée de cases chiffrées d'un écran d'administration : quatre par rangée, gouttière de 8 px. */
export function RangeeCases({ children, testId, colonnes = 4 }: { children: ReactNode; testId?: string; colonnes?: 3 | 4 | 6 }) {
  const grille = { 3: "sm:grid-cols-3", 4: "sm:grid-cols-4", 6: "sm:grid-cols-3 lg:grid-cols-6" }[colonnes];
  return (
    <div className={`mb-4 grid grid-cols-2 gap-2 ${grille}`} data-testid={testId}>
      {children}
    </div>
  );
}

/** Un message d'erreur de formulaire (paramètre `?error=`), sur une ligne, en tête de page. */
export function Erreur({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="mb-3 flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad-ink">
      <span aria-hidden>✕</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}
