"use client";
// TableDefilante — un tableau large qui défile dans sa propre zone, et le SIGNALE.
//
// Pourquoi (recette du 26/09/2026) :
//   - à 390 px, les tableaux rangés dans une carte `overflow-hidden` perdaient leurs
//     colonnes de droite, souvent les ACTIONS (Guide, Désactiver, Réinitialiser),
//     sans aucun moyen de les atteindre : Audit, Clients, Consommation,
//     Utilisateurs, Uptime… ;
//   - ceux déjà en `overflow-x-auto` cachaient des colonnes clés derrière un
//     défilement que rien n'annonçait (« Alertes sur 7 j », « Actif » et « Actions »
//     des SLO, même à 1 440 px ; Session, Rejeu et Trace des occurrences d'erreur).
// Ce cadre fait défiler le tableau à l'intérieur de la zone (la page, elle, ne
// s'élargit jamais) et montre ce qui reste hors champ : une ombre sur le bord
// concerné (gauche, droite ou les deux) et une courte consigne, seulement quand le
// contenu déborde.
//
// Rendu serveur : « déborde » vaut faux au premier rendu, côté serveur comme à
// l'hydratation (aucun écart possible) ; la mesure n'a lieu qu'après montage, puis
// à chaque défilement et redimensionnement. Le ResizeObserver suit la zone ET son
// contenu : une police chargée tard ou des lignes ajoutées élargissent le tableau
// sans changer la largeur de la zone.
//
// Accessibilité : la zone est focalisable (tabIndex 0) pour défiler au clavier, et
// nommée (`role="region"` + `aria-label`). Ombres et consigne sont décoratives
// (`aria-hidden`) et `pointer-events-none` pour ne jamais intercepter un clic : un
// lecteur d'écran parcourt les cellules, le débordement ne concerne que l'œil.
//
// Le cadre (`className` : `card`, bordures, arrondis, marges) garde
// `overflow-hidden` : l'en-tête coloré du tableau suit ainsi les coins arrondis.
// C'est la zone intérieure qui défile, jamais le cadre.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

/** Ce qui reste hors champ, de chaque côté de la zone visible. */
export type Debordement = { gauche: boolean; droite: boolean };

const AUCUN: Debordement = { gauche: false, droite: false };

/**
 * Lit le débordement d'un élément défilant. Tolérance d'un pixel : les largeurs
 * fractionnaires (zoom, sous-pixels) laissent parfois 0,5 px « à défiler » qui
 * afficheraient une ombre sur un tableau entièrement visible.
 */
export function mesurerDebordement(el: { scrollLeft: number; scrollWidth: number; clientWidth: number }): Debordement {
  const resteADroite = el.scrollWidth - el.clientWidth - el.scrollLeft;
  return { gauche: el.scrollLeft > 1, droite: resteADroite > 1 };
}

/**
 * Suit le débordement horizontal de `ref` après montage. `cle` relance
 * l'abonnement quand l'élément observé change (rangée rendue sous condition,
 * contenu remplacé) ; sans elle, l'observateur resterait sur l'ancien contenu.
 */
export function useDebordementHorizontal(ref: RefObject<HTMLElement | null>, cle?: unknown): Debordement {
  const [etat, setEtat] = useState<Debordement>(AUCUN);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mesurer = () => {
      const suivant = mesurerDebordement(el);
      // Même état : on garde l'objet, pour ne pas re-rendre à chaque pixel défilé.
      setEtat((avant) => (avant.gauche === suivant.gauche && avant.droite === suivant.droite ? avant : suivant));
    };
    mesurer();
    el.addEventListener("scroll", mesurer, { passive: true });
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", mesurer);
      return () => {
        el.removeEventListener("scroll", mesurer);
        window.removeEventListener("resize", mesurer);
      };
    }
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(el);
    for (const enfant of Array.from(el.children)) observateur.observe(enfant);
    return () => {
      el.removeEventListener("scroll", mesurer);
      observateur.disconnect();
    };
  }, [ref, cle]);

  return etat;
}

/**
 * Ombre d'un bord : décorative, elle ne capte ni le focus ni les clics. `z-20` :
 * au-dessus des colonnes collantes (`sticky left-0 z-10`) des tableaux, qu'elle
 * passerait sinon sous l'en-tête.
 */
const OMBRE = "pointer-events-none absolute inset-y-0 z-20 w-6 from-navy-950/15 to-transparent dark:from-black/60";

export function TableDefilante({
  children,
  className = "",
  label = "Tableau défilant",
  testId,
}: {
  children: ReactNode;
  /** Classes du cadre (`card`, bordures, arrondis, marges) : seul le débordement est géré ici. */
  className?: string;
  /** Nom accessible de la zone défilante. */
  label?: string;
  /** `data-testid` du cadre — celui que portait l'ancien conteneur. */
  testId?: string;
}) {
  const zone = useRef<HTMLDivElement>(null);
  const { gauche, droite } = useDebordementHorizontal(zone);
  const deborde = gauche || droite;

  return (
    <div className={`relative overflow-hidden ${className}`} data-testid={testId}>
      {deborde && (
        <p
          aria-hidden="true"
          data-testid="table-defilante-indice"
          className="px-3 pb-1 pt-1.5 text-right text-[11px] text-ink-soft"
        >
          {droite ? "Faites défiler pour voir toutes les colonnes →" : "← Faites défiler pour revenir aux premières colonnes"}
        </p>
      )}
      <div className="relative">
        {/* `relative` sur la zone : les textes `sr-only` (position absolue) des
            cellules se rangent DANS la zone défilante ; rangés par rapport à un
            ancêtre, ils échapperaient au défilement et élargiraient la page. */}
        <div
          ref={zone}
          role="region"
          aria-label={label}
          tabIndex={0}
          className="relative overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-perf"
        >
          {children}
        </div>
        {gauche && (
          <span aria-hidden="true" data-testid="table-defilante-ombre-gauche" className={`${OMBRE} left-0 bg-gradient-to-r`} />
        )}
        {droite && (
          <span aria-hidden="true" data-testid="table-defilante-ombre-droite" className={`${OMBRE} right-0 bg-gradient-to-l`} />
        )}
      </div>
    </div>
  );
}
