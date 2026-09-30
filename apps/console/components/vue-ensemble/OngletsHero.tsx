"use client";
// Onglets du graphique principal de `/` (spec A2 § 6.1, R2) : « Web Vitals | Erreurs
// | Trafic », Web Vitals par défaut. Les trois contenus sont rendus au SERVEUR ; ce
// composant ne fait que choisir lequel monter.
//
// UN SEUL PANNEAU DANS LE DOM. Monter les trois et cacher les deux autres ferait
// compter à la page des graphiques qu'on ne voit pas (réticule partagé, pinceau,
// repères e2e `#hero-LCP`…), et recharts mesurerait des conteneurs de 0 px.
//
// L'onglet suit l'URL (`serie=`, A2 § 5.2) par `history.replaceState` : un lien
// partagé rouvre le même onglet, et changer d'onglet ne relance pas les lectures de
// l'écran (aucune navigation).
//
// Clavier (motif « tabs » de l'APG, activation automatique) : flèches gauche et
// droite, Début et Fin ; un seul arrêt de tabulation, l'onglet actif.
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { OngletHero } from "@/lib/vue-ensemble";

export interface OngletContenu {
  cle: OngletHero;
  libelle: string;
  contenu: ReactNode;
}

/** L'onglet voisin au clavier (bouclage aux bouts) ; `null` : touche sans effet. */
export function ongletVoisin(cles: readonly string[], actuel: string, touche: string): string | null {
  const i = cles.indexOf(actuel);
  if (i < 0 || cles.length === 0) return null;
  if (touche === "ArrowRight") return cles[(i + 1) % cles.length];
  if (touche === "ArrowLeft") return cles[(i - 1 + cles.length) % cles.length];
  if (touche === "Home") return cles[0];
  if (touche === "End") return cles[cles.length - 1];
  return null;
}

export function OngletsHero({ onglets, initial }: { onglets: OngletContenu[]; initial: OngletHero }) {
  const [actif, setActif] = useState<OngletHero>(onglets.some((o) => o.cle === initial) ? initial : onglets[0].cle);
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const boutons = useRef<Record<string, HTMLButtonElement | null>>({});
  const idOnglet = (cle: string) => `onglet-hero-${cle}-${base}`;
  const idPanneau = (cle: string) => `panneau-hero-${cle}-${base}`;

  function choisir(cle: OngletHero) {
    setActif(cle);
    try {
      const url = new URL(window.location.href);
      if (cle === onglets[0].cle) url.searchParams.delete("serie");
      else url.searchParams.set("serie", cle);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // Sans historique (aperçu, test), l'onglet change quand même.
    }
  }

  function clavier(e: KeyboardEvent<HTMLDivElement>) {
    const voisin = ongletVoisin(
      onglets.map((o) => o.cle),
      actif,
      e.key,
    ) as OngletHero | null;
    if (!voisin) return;
    e.preventDefault();
    choisir(voisin);
    boutons.current[voisin]?.focus();
  }

  const courant = onglets.find((o) => o.cle === actif) ?? onglets[0];
  return (
    <div className="min-w-0" data-testid="onglets-hero" data-onglet={courant.cle}>
      <div
        role="tablist"
        aria-label="Série du graphique principal"
        className="mb-2 flex min-w-0 flex-wrap gap-1 border-b border-line"
        onKeyDown={clavier}
      >
        {onglets.map((o) => {
          const choisi = o.cle === courant.cle;
          return (
            <button
              key={o.cle}
              ref={(el) => {
                boutons.current[o.cle] = el;
              }}
              type="button"
              role="tab"
              id={idOnglet(o.cle)}
              aria-selected={choisi}
              // Seul le panneau actif existe : un aria-controls vers un id absent est invalide.
              aria-controls={choisi ? idPanneau(o.cle) : undefined}
              tabIndex={choisi ? 0 : -1}
              data-onglet={o.cle}
              onClick={() => choisir(o.cle)}
              className={`-mb-px min-w-0 border-b-2 px-3 py-1 text-sm [overflow-wrap:anywhere] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                choisi ? "border-brand font-semibold text-ink" : "border-transparent text-ink-soft hover:text-ink"
              }`}
            >
              {o.libelle}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={idPanneau(courant.cle)} aria-labelledby={idOnglet(courant.cle)} className="min-w-0">
        {courant.contenu}
      </div>
    </div>
  );
}
