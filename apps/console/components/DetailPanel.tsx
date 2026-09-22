// Panneau latéral de détail (F07, plan § 3.5 et § 4.2). Rendu serveur.
//
// QUALIFIER SANS QUITTER LA LISTE. Un clic sur une ligne (route, erreur, session…)
// ouvre ce panneau par l'URL (`panel=<type>:<id>`, lib/view-state.ts) : il est donc
// partageable, et fonctionne SANS JavaScript — « Fermer », « Précédent », « Suivant »
// et « Ouvrir en page » sont de vrais liens. L'îlot `DetailPanelKeys` n'ajoute que
// le clavier (Échap, ↑ / ↓) et le focus sur le titre.
//
// LARGEUR. À partir de 1280 px, la moitié de la zone de contenu (100 vw moins la
// barre latérale de 16 rem) : la liste reste lisible à gauche — Datadog en recouvre
// 60 à 70 %. En dessous, plein écran, « Fermer » en tête.
//
// CE QUE LE PANNEAU NE FAIT PAS. Il n'a pas de fenêtre de temps propre : il lit la
// plage de l'écran, et c'est à l'écran de l'écrire dans le contenu (§ 3.5). Il ne
// lit rien lui-même : l'écran lui passe titre, puces, onglets et contenu.
//
// ONGLETS COMPTÉS. Chaque onglet porte son compte avant le clic ; un compte inconnu
// s'écrit « (—) », jamais « (0) » (V3). Le rendu des onglets est celui de `TabLink`,
// réutilisé tel quel.
import Link from "next/link";
import type { ReactNode } from "react";
import { DetailPanelKeys } from "./DetailPanelKeys";
import { TabLink } from "./sessions/TabLink";
import type { TypePanneau } from "@/lib/view-state";

/** Badge de type, en toutes lettres. */
export const LIBELLE_TYPE_PANNEAU: Record<TypePanneau, string> = {
  route: "Route",
  error: "Erreur",
  issue: "Issue",
  session: "Session",
  trace: "Trace",
  event: "Événement",
  action: "Action",
  noeud: "Nœud",
};

export interface PuceDetail {
  label: string;
  valeur: string;
  /** Provenance d'une valeur estimée (pays estimé : « géolocalisation IP »…). */
  provenance?: string;
}

export interface OngletDetail {
  cle: string;
  libelle: string;
  /** `null` = compte inconnu → « (—) », jamais « (0) ». */
  compte: number | null;
  href: string;
  actif: boolean;
}

/** « Erreurs (3) », « Erreurs (—) ». */
export function libelleOnglet(o: Pick<OngletDetail, "libelle" | "compte">): string {
  const compte = o.compte == null || !Number.isFinite(o.compte) ? "—" : o.compte.toLocaleString("fr-FR");
  return `${o.libelle} (${compte})`;
}

/** Un seul panneau à la fois : l'identifiant du titre est fixe. */
export const TITRE_PANNEAU_ID = "panneau-detail-titre";

const LIEN =
  "inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1 text-xs font-medium text-ink-soft transition hover:bg-panel2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf";

/** Précédent / suivant : un lien, ou un bouton éteint en bout de liste (jamais masqué : la liste a une fin). */
function Pas({ href, libelle, fleche, touche }: { href: string | null | undefined; libelle: string; fleche: string; touche: string }) {
  if (!href) {
    return (
      <span aria-disabled="true" className={`${LIEN} cursor-not-allowed opacity-60`}>
        <span aria-hidden="true">{fleche}</span>
        {libelle}
      </span>
    );
  }
  return (
    <Link href={href} scroll={false} aria-keyshortcuts={touche} className={LIEN}>
      <span aria-hidden="true">{fleche}</span>
      {libelle}
    </Link>
  );
}

export function DetailPanel({
  type,
  titre,
  puces = [],
  fermerHref,
  pageHref,
  precedentHref,
  suivantHref,
  onglets,
  children,
}: {
  type: TypePanneau;
  titre: string;
  puces?: PuceDetail[];
  fermerHref: string;
  /** « Ouvrir en page ». */
  pageHref: string;
  /** `undefined` : pas de liste à parcourir ; `null` : bout de la liste. */
  precedentHref?: string | null;
  suivantHref?: string | null;
  onglets?: OngletDetail[];
  children: ReactNode;
}) {
  const parcours = precedentHref !== undefined || suivantHref !== undefined;
  return (
    <aside
      aria-labelledby={TITRE_PANNEAU_ID}
      data-testid="detail-panel"
      data-type={type}
      className="fixed inset-0 z-40 flex flex-col bg-panel shadow-pop xl:left-auto xl:w-[calc((100vw-16rem)/2)] xl:border-l xl:border-line"
    >
      <header className="shrink-0 border-b border-line px-4 pb-3 pt-3 sm:px-5">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-panel2 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
            {LIBELLE_TYPE_PANNEAU[type]}
          </span>
          <Link
            href={fermerHref}
            scroll={false}
            aria-keyshortcuts="Escape"
            className={`${LIEN} ml-auto`}
            data-testid="detail-panel-fermer"
          >
            <span aria-hidden="true">✕</span>
            Fermer
          </Link>
        </div>

        <h2
          id={TITRE_PANNEAU_ID}
          tabIndex={-1}
          className="mt-2 break-words rounded-sm text-lg font-semibold leading-snug text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-perf"
        >
          {titre}
        </h2>

        {puces.length > 0 && (
          <dl className="mt-2 flex flex-wrap gap-1.5" data-testid="detail-panel-puces">
            {puces.map((p, i) => (
              <div key={`${p.label}-${i}`} className="flex min-w-0 max-w-full items-baseline gap-1 rounded-md bg-panel2 px-2 py-0.5 text-xs">
                <dt className="shrink-0 text-ink-soft">{p.label}</dt>
                <dd className="min-w-0 truncate font-medium text-ink" title={p.provenance ? `${p.valeur} (provenance : ${p.provenance})` : p.valeur}>
                  {p.valeur}
                  {p.provenance && <span className="font-normal text-ink-soft"> (provenance : {p.provenance})</span>}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link href={pageHref} className={LIEN} data-testid="detail-panel-page">
            Ouvrir en page
          </Link>
          {parcours && (
            <nav aria-label="Parcourir la liste" className="flex flex-wrap items-center gap-2">
              <Pas href={precedentHref} libelle="Précédent" fleche="↑" touche="ArrowUp" />
              <Pas href={suivantHref} libelle="Suivant" fleche="↓" touche="ArrowDown" />
            </nav>
          )}
          <span className="hidden text-[11px] text-ink-soft sm:inline">
            {parcours ? "↑ / ↓ : parcourir · Échap : fermer" : "Échap : fermer"}
          </span>
        </div>
      </header>

      {onglets && onglets.length > 0 && (
        <nav aria-label="Onglets du panneau" className="flex shrink-0 overflow-x-auto border-b border-line px-1 sm:px-2">
          {onglets.map((o) => (
            <TabLink key={o.cle} href={o.href} active={o.actif}>
              <span className="whitespace-nowrap">{libelleOnglet(o)}</span>
              {o.actif && <span className="sr-only"> — onglet affiché</span>}
            </TabLink>
          ))}
        </nav>
      )}

      {/* La réserve basse laisse la place au bouton « Votre avis ? », fixé en bas à droite. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-24 pt-4 sm:px-5">{children}</div>

      <DetailPanelKeys
        titreId={TITRE_PANNEAU_ID}
        cle={pageHref}
        fermerHref={fermerHref}
        precedentHref={precedentHref}
        suivantHref={suivantHref}
      />
    </aside>
  );
}
