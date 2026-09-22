// Segments enregistrés du navigateur — lecture et écriture partagées par
// `SegmentBar` et `PresetBar` (F08). Client seulement : `localStorage` n'est lu qu'au
// montage (jamais au rendu serveur, sinon l'hydratation diverge).
//
// Un seul magasin (`SAVED_SEGMENTS_KEY`, v2) pour les deux barres : une vue
// personnelle enregistrée depuis l'une apparaît dans l'autre. L'événement
// `EVENEMENT_SEGMENTS` prévient l'autre barre du même onglet (l'événement `storage`
// natif ne part que vers les AUTRES onglets).
import {
  SAVED_SEGMENTS_KEY,
  SAVED_SEGMENTS_KEY_V1,
  migrateSavedSegments,
  type SavedSegment,
} from "@/lib/query-contract";

export const EVENEMENT_SEGMENTS = "mip-segments-enregistres";

export function lireSegmentsEnregistres(): { items: SavedSegment[]; dropped: number } {
  try {
    const rawV2 = window.localStorage.getItem(SAVED_SEGMENTS_KEY);
    const { store, dropped } = migrateSavedSegments(rawV2, window.localStorage.getItem(SAVED_SEGMENTS_KEY_V1));
    // Première lecture après la migration : le magasin v2 est écrit, la clé v1 reste.
    if (rawV2 === null && store.items.length) window.localStorage.setItem(SAVED_SEGMENTS_KEY, JSON.stringify(store));
    return { items: store.items, dropped };
  } catch {
    return { items: [], dropped: 0 };
  }
}

export function ecrireSegmentsEnregistres(items: SavedSegment[]): void {
  try {
    window.localStorage.setItem(SAVED_SEGMENTS_KEY, JSON.stringify({ version: 2, items }));
  } catch {
    /* quota ou navigation privée : l'appelant garde l'état en mémoire */
  }
  window.dispatchEvent(new Event(EVENEMENT_SEGMENTS));
}

/** Ajoute (ou remplace, même nom) un segment ; rend la nouvelle liste. */
export function ajouterSegment(items: readonly SavedSegment[], nom: string, seg: string): SavedSegment[] {
  const name = nom.trim().slice(0, 100);
  return [...items.filter((s) => s.name !== name), { name, seg }];
}
