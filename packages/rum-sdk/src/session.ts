const STORAGE_KEY = "mip_rum_session";
const INACTIVITY_TTL_MS = 30 * 60 * 1000;

// ─────────────────────────── L'identifiant de visiteur ────────────────────────
//
// CE QU'IL ÉTAIT, ET POURQUOI C'ÉTAIT FAUX. `user_hash` valait
// `fnv1a(userAgent | langue | résolution | décalage UTC)` — aucun aléa, aucun sel,
// aucune persistance d'un tirage. Deux personnes sur le même modèle de poste, la
// même version de navigateur, la même langue, la même résolution et le même
// fuseau obtenaient donc LE MÊME identifiant. Ce n'était pas une collision
// improbable : c'était le comportement nominal.
//
// Sur le créneau visé — portails de service public, parcs gérés par une DSI —
// c'est le cas MAJORITAIRE : mêmes postes, même navigateur poussé par politique,
// mêmes écrans, même fuseau. Des milliers d'agents partageaient une poignée de
// valeurs. « Utilisateurs uniques » comptait des configurations ; « nouveaux vs
// revenants » déclarait tout le monde revenant dès qu'une classe d'appareil avait
// été vue une fois ; et l'effacement RGPD par cet identifiant détruisait les
// données d'autres personnes pendant que l'export leur en communiquait.
//
// Le mot « anonymisé » qui accompagnait ce champ était faux au sens du RGPD :
// c'est du fingerprinting de terminal, et un hachage non salé de 32 bits sur un
// espace d'entrée aussi étroit s'inverse par force brute en quelques secondes.
//
// CE QU'IL EST MAINTENANT. Un tirage aléatoire, persisté. Il ne dit RIEN du
// terminal — c'est précisément ce qui en fait un identifiant de visiteur et non
// une empreinte : deux personnes sur des postes identiques ont deux valeurs
// différentes, et la même personne garde la sienne d'une session à l'autre.
//
// LE SDK N'ÉMET PLUS D'EMPREINTE DE TERMINAL. Pas de repli, pas de double
// émission : produire cette donnée était le problème. L'ingestion continue
// d'accepter `mip.user_hash` des SDK déjà posés chez des clients, et marque ces
// sessions comme telles (`id_kind = 'device_class'`) — voir migration-v57.
//
// CE QUI N'EST PAS RÉGLÉ ICI. Cette clé est écrite dans le stockage local AVANT
// la barrière de consentement, comme l'identifiant de session à côté d'elle.
// C'est un défaut distinct (finding 1.11 de l'audit), qui porte désormais sur une
// clé de plus. Il demande de réordonner l'initialisation et de purger au refus.
const VISITOR_KEY = "mip_rum_visitor";

export interface Session {
  sessionId: string;
  /** Identifiant de visiteur : un tirage aléatoire, jamais dérivé du terminal. */
  visitorId: string;
}

function uuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** Stable session id with 30 min inactivity TTL, persisted in localStorage. */
export function getOrCreateSession(): Session {
  const now = Date.now();
  let stored: { sid: string; last: number } | null = null;
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    /* storage unavailable or corrupt -> new session */
  }
  const sid =
    stored && now - stored.last < INACTIVITY_TTL_MS ? stored.sid : uuid();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sid, last: now }));
  } catch {
    /* private mode: session lives for the page only */
  }
  return { sessionId: sid, visitorId: getOrCreateVisitor() };
}

/**
 * L'identifiant de visiteur, tiré une fois et gardé.
 *
 * Stocké À PART de la session, sous sa propre clé : la session expire au bout de
 * 30 minutes d'inactivité, le visiteur non — c'est toute la différence entre
 * « une visite » et « quelqu'un qui revient ». Les mêler ferait repartir le
 * compteur de revenants à chaque pause déjeuner.
 *
 * En navigation privée, ou si le stockage est refusé, le tirage vit le temps de
 * la page : le visiteur est alors compté comme nouveau à chaque chargement. On
 * l'assume — l'alternative serait de le dériver du terminal, c'est-à-dire de
 * refaire exactement ce qu'on vient de retirer.
 */
export function getOrCreateVisitor(): string {
  let vid: string | null = null;
  try {
    vid = localStorage.getItem(VISITOR_KEY);
  } catch {
    /* stockage indisponible : identifiant volatil, le temps de la page */
  }
  // Un identifiant corrompu ou tronqué ne se répare pas : on retire.
  if (!vid || vid.length < 16) {
    vid = uuid();
    try {
      localStorage.setItem(VISITOR_KEY, vid);
    } catch {
      /* mode privé : le visiteur sera compté comme nouveau au prochain chargement */
    }
  }
  return vid;
}

/** Oublie l'identifiant de visiteur — refus de consentement, ou demande d'effacement. */
export function forgetVisitor(): void {
  try {
    localStorage.removeItem(VISITOR_KEY);
  } catch {
    /* rien à oublier */
  }
}

/** Refresh the inactivity window (called on each emitted event). */
export function touchSession(session: Session): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ sid: session.sessionId, last: Date.now() }),
    );
  } catch {
    /* ignore */
  }
}
