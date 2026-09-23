// Rejeu synchronisé du détail de session (F47, plan § 4.3 `ReplaySynchro`, § 5.12.4)
// — logique PURE, testée (tests/unit/replay-synchro.test.ts). L'îlot client
// l'importe : aucun module serveur ici, le type de ligne est importé en type.
//
// CE QUE LE LECTEUR ÉCRIT, ET CE QU'IL NE PROMET PAS.
//   · Le masquage est une garantie de vie privée, donc il se dit EXACTEMENT : les
//     saisies le sont toujours ; le texte et les médias, au réglage par DÉFAUT du
//     SDK (`replayMask: "all"`). Une application peut démasquer le texte
//     (`"media"`) ou le texte et les médias (`"inputs"`), et ce réglage n'est pas
//     transmis avec la session : écrire « texte et médias masqués » pour toutes
//     les sessions serait une promesse que la console ne peut pas tenir.
//   · L'enregistrement s'arrête après 2 minutes ou 1 Mo compressé : bornes du SDK
//     (`packages/rum-sdk/src/replay.ts`), recopiées ici parce que la console ne
//     dépend pas du SDK, et vérifiées par test — elles ne peuvent pas diverger.
//   · La tête de lecture désigne une ligne de la chronologie par recherche
//     DICHOTOMIQUE : la dernière commencée à ou avant l'instant lu.
import { formater } from "./fmt-ids";
import type { TimelineItem } from "./queries";

/** Durée maximale d'un enregistrement (`REPLAY_MAX_MS` du SDK). */
export const REJEU_MAX_MS = 120_000;
/** Volume compressé maximal d'un enregistrement (`REPLAY_MAX_COMPRESSED_BYTES` du SDK). */
export const REJEU_MAX_OCTETS = 1024 * 1024;
/** Rétention par défaut de la purge (`purge_rum(retention_days default 30)`, migration v09). */
export const REJEU_CONSERVATION_JOURS = 30;

/** En-tête du lecteur, écrit dans TOUS ses états (§ 5.12.4). */
export const TEXTE_COUVERTURE =
  "Saisies toujours masquées à l'enregistrement ; texte et médias aussi, au réglage par défaut du SDK " +
  "(une application peut les démasquer, et ce réglage n'est pas transmis avec la session) · " +
  `conservé ${REJEU_CONSERVATION_JOURS} jours par défaut · enregistrement limité aux ` +
  `${REJEU_MAX_MS / 60_000} premières minutes ou ${REJEU_MAX_OCTETS / (1024 * 1024)} Mo compressé`;

/** Vitesses proposées (§ 5.12.4) : `Replayer.setConfig({ speed })` de `@rrweb/replay` 2.0.1. */
export const VITESSES = [1, 2, 4] as const;
export type Vitesse = (typeof VITESSES)[number];

export type TonMarqueur = "erreur" | "frustration" | "vue" | "action";
/** Un repère de la barre de progression (§ 4.3) ; `t` en epoch ms, comme `?at=`. */
export type Marqueur = { t: number; ton: TonMarqueur; libelle: string };

/** Une ligne de la chronologie SSR que la tête peut désigner : `[data-ligne="<ancre>"]`. */
export interface LigneSynchro {
  id: string;
  /** Instant de la ligne, epoch ms. */
  t: number;
  ancre: string;
}

/** Libellés des signaux du SDK (`frustration.<kind>`, packages/rum-sdk/src/frustration.ts). */
const SIGNAUX: Record<string, string> = {
  rage: "Salve de clics",
  dead: "Clic sans réaction",
  error: "Erreur pendant une action",
};

/**
 * Repères de la barre, lus dans la chronologie : erreurs, signaux de frustration,
 * pages vues, actions. Les Web Vitals n'en sont pas : leur instant est celui de
 * leur RAPPORT (souvent à la fermeture de la page), pas de ce qu'ils mesurent.
 */
export function marqueursDeSession(items: readonly TimelineItem[]): Marqueur[] {
  return items.flatMap((it): Marqueur[] => {
    const t = new Date(it.ts).getTime();
    if (!Number.isFinite(t)) return [];
    switch (it.kind) {
      case "error":
        return [{ t, ton: "erreur", libelle: it.title ?? "Erreur" }];
      case "pageview":
        return [{ t, ton: "vue", libelle: it.title ?? "Route inconnue" }];
      case "action":
        return [{ t, ton: "action", libelle: it.title ?? it.action_name ?? "Action sans nom" }];
      case "event": {
        if (!it.title?.startsWith("frustration.")) return [];
        return [{ t, ton: "frustration", libelle: SIGNAUX[it.title.slice("frustration.".length)] ?? it.title }];
      }
      default:
        return [];
    }
  });
}

/**
 * Lignes que la tête peut désigner, dans l'ordre du temps (celui de la lecture
 * SQL). Le rang reste celui de la chronologie LUE : l'ancre `evt-<rang>` ne dépend
 * d'aucun filtre. `garder` retire les lignes absentes de l'écran (filtre `voir=`).
 * Les Web Vitals sont écartés, pour la même raison que des repères.
 */
export function lignesSynchro(
  items: readonly TimelineItem[],
  ancre: (rang: number) => string,
  garder: (item: TimelineItem) => boolean = () => true,
): LigneSynchro[] {
  return items.flatMap((it, rang) => {
    const t = new Date(it.ts).getTime();
    return it.kind !== "vital" && Number.isFinite(t) && garder(it) ? [{ id: String(rang), t, ancre: ancre(rang) }] : [];
  });
}

/**
 * Ligne active à l'instant `t` : la DERNIÈRE ligne commencée à ou avant `t`, par
 * recherche dichotomique sur des lignes triées par instant (la tête avance quatre
 * fois par seconde, sur 500 lignes au plus). −1 avant la première ligne.
 */
export function ligneActive(lignes: readonly { t: number }[], t: number): number {
  let bas = 0;
  let haut = lignes.length - 1;
  let trouvee = -1;
  while (bas <= haut) {
    const milieu = (bas + haut) >> 1;
    if (lignes[milieu].t <= t) {
      trouvee = milieu;
      bas = milieu + 1;
    } else {
      haut = milieu - 1;
    }
  }
  return trouvee;
}

/** Position d'un instant sur la barre, en % de l'enregistrement ; `null` hors de lui. */
export function positionSurBarre(t: number, debut: number, fin: number): number | null {
  if (!(fin > debut)) return t === debut ? 0 : null;
  if (t < debut || t > fin) return null;
  return ((t - debut) / (fin - debut)) * 100;
}

/** D'où vient une demande de positionnement. */
export type SourcePosition = "url" | "ligne" | "marqueur";

/**
 * L'annonce du lecteur une fois placé. « À l'instant de l'erreur » seulement si une
 * ERREUR de la session tombe à cet instant (à la seconde près) : un lien venu d'une
 * trace, ou une ligne choisie, n'est pas une erreur. Le décalage est compté depuis
 * le début de l'ENREGISTREMENT.
 */
export function messagePosition(source: SourcePosition, t: number, marqueurs: readonly Marqueur[], debut: number): string {
  const dans = `+${formater("s-auto", Math.max(0, t - debut))} dans l'enregistrement`;
  if (source === "url") {
    return marqueurs.some((m) => m.ton === "erreur" && Math.abs(m.t - t) <= 1000)
      ? "Replay positionné à l'instant de l'erreur"
      : `Replay positionné à l'instant demandé (${dans})`;
  }
  return source === "ligne"
    ? `Replay positionné sur la ligne choisie (${dans})`
    : `Replay positionné sur le repère choisi (${dans})`;
}

/** `ignores` de `GET /api/replay/[sessionId]` (B36) : un entier positif, sinon 0. */
export function lireIgnores(v: unknown): number {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : 0;
}

/** « 1 segment illisible ignoré », « 3 segments illisibles ignorés ». */
export function texteIgnores(n: number): string {
  return n > 1 ? `${formater("count", n)} segments illisibles ignorés` : "1 segment illisible ignoré";
}
