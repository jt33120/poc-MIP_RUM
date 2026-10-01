import { accesTerminalAutorise, CLE_SESSION, CLE_VISITEUR } from "./consent";
import { marqueIdentite, type MarquesIdentite } from "./identite-session";

const STORAGE_KEY = CLE_SESSION;
const INACTIVITY_TTL_MS = 30 * 60 * 1000;

// ─────────────────────────── La durée maximale ───────────────────────────────
//
// Finding 2.12 b de docs/AUDIT_RUM_EXTERNE.md. Seul le délai d'inactivité fermait
// une session : un poste de supervision ou un affichage mural qui garde l'onglet
// ouvert gardait LA MÊME session pendant des semaines, avec un début figé. Les
// lectures bornées sur le début cessaient de la voir, celles bornées sur la
// dernière activité la comptaient, et la purge de rétention ne la touchait jamais.
//
// Une session dure donc au plus 4 heures, même active (le standard des outils
// d'analyse d'audience). Au-delà, l'événement suivant ouvre une session neuve,
// avec le même visiteur : un poste mural compte une session toutes les 4 heures,
// et c'est voulu.
const SESSION_MAX_MS = 4 * 60 * 60 * 1000;

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
// ET LE CONSENTEMENT (finding 1.11, réglé le 01/10/2026). Cette clé et celle de la
// session étaient écrites AVANT la barrière de consentement, et survivaient au
// refus. Désormais, tant que l'accès au terminal n'est pas autorisé
// (`accesTerminalAutorise`, ./consent.ts), session et visiteur sont tirés en
// mémoire, sans rien lire ni écrire ; l'accord les écrit, ou reprend ceux que le
// stockage garde déjà ; un refus les efface.
const VISITOR_KEY = CLE_VISITEUR;

export interface Session {
  sessionId: string;
  /** Identifiant de visiteur : un tirage aléatoire, jamais dérivé du terminal. */
  visitorId: string;
  /**
   * Marques des identités métier rattachées à la session (voir `marqueIdentite`),
   * persistées avec elle. Absentes : session anonyme jusqu'ici.
   */
  identites?: MarquesIdentite;
  /** Début de la session (epoch ms) : la durée maximale se compte depuis lui. */
  debut?: number;
  /** Dernière activité (epoch ms) : le délai d'inactivité se compte depuis elle. */
  derniere?: number;
  /**
   * Instant (epoch ms) à partir duquel la session ne se prolonge plus, même
   * active : son début plus 4 heures. Absent, la session n'a pas de borne.
   */
  echeance?: number;
}

// Les marques d'identité (qui décident quand une identité métier ouvre une nouvelle
// session) : ./identite-session.ts.

/** Écrit la session — jamais sans accès au terminal (consentement attendu ou refusé). */
function ecrire(session: Session): void {
  if (!accesTerminalAutorise()) return;
  const maintenant = Date.now();
  const enregistrement: Record<string, unknown> = {
    sid: session.sessionId,
    last: maintenant,
    start: session.debut ?? maintenant,
  };
  if (session.identites?.user) enregistrement.u = session.identites.user;
  if (session.identites?.account) enregistrement.a = session.identites.account;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(enregistrement));
}

function uuid(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues === "function") {
    return Array.from(cryptoApi.getRandomValues(new Uint8Array(16)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.slice(0, 32).padEnd(32, "0");
}

function ouvrir(sessionId: string, visitorId: string, identites: MarquesIdentite, debut: number): Session {
  return { sessionId, visitorId, identites, debut, derniere: debut, echeance: debut + SESSION_MAX_MS };
}

/** Une session en mémoire a-t-elle fini, par inactivité ou par durée ? Sans repère, non. */
function echue(session: Session, maintenant: number): boolean {
  return (
    (session.derniere != null && maintenant - session.derniere >= INACTIVITY_TTL_MS) ||
    (session.echeance != null && maintenant >= session.echeance)
  );
}

/**
 * La session à poursuivre : celle du stockage si elle a servi il y a moins de
 * 30 minutes ET commencé il y a moins de 4 heures, sinon `candidate` si elle vaut
 * encore, sinon une neuve.
 *
 * `candidate` est la session que la page a en mémoire. Deux appels en ont une :
 * l'accord, qui écrit la session tirée en mémoire en attendant (les événements
 * retenus gardent alors leur identifiant) ; et la restauration depuis le cache
 * du navigateur, qui reprend la session de la page si elle n'a pas expiré
 * pendant l'absence.
 *
 * Sans accès au terminal, rien n'est lu ni écrit : la session vit en mémoire.
 */
export function getOrCreateSession(candidate?: Session): Session {
  const now = Date.now();
  const candidateValable = candidate != null && !echue(candidate, now);
  if (!accesTerminalAutorise()) {
    if (candidateValable) return candidate;
    return ouvrir(uuid(), candidate?.visitorId ?? uuid(), { user: null, account: null }, now);
  }
  let stored: { sid?: unknown; last?: unknown; start?: unknown; u?: unknown; a?: unknown } | null = null;
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    /* storage unavailable or corrupt -> new session */
  }
  // Un enregistrement d'avant la durée maximale n'a pas de début : on le compte
  // depuis maintenant. Un début dans le futur (horloge reculée) aussi.
  const debutStocke = typeof stored?.start === "number" && stored.start <= now ? stored.start : now;
  const reprise =
    stored != null &&
    typeof stored.sid === "string" &&
    typeof stored.last === "number" &&
    now - stored.last < INACTIVITY_TTL_MS &&
    now - debutStocke < SESSION_MAX_MS;
  // Les marques d'identité ne valent que pour LEUR session : une session neuve est anonyme.
  const marque = (v: unknown) => (typeof v === "string" ? v : null);
  const visiteur = getOrCreateVisitor(candidate?.visitorId);
  let session: Session;
  if (reprise) {
    session = ouvrir(stored!.sid as string, visiteur, { user: marque(stored!.u), account: marque(stored!.a) }, debutStocke);
  } else if (candidateValable) {
    session = { ...candidate, visitorId: visiteur };
  } else {
    session = ouvrir(uuid(), visiteur, { user: null, account: null }, now);
  }
  session.derniere = now;
  try {
    ecrire(session);
  } catch {
    /* private mode: session lives for the page only */
  }
  return session;
}

/** Ouvre une nouvelle session technique en conservant le visiteur. Utilisé
 * quand l'identité métier change pour qu'une session ne mélange jamais A/B, et
 * quand la session atteint sa durée maximale. */
export function rotateSession(visitorId: string, identites: { user: string | null; account: string | null } = { user: null, account: null }): Session {
  const sessionId = uuid();
  // Les identités en cours sont rattachées à la nouvelle session, marquées pour ELLE.
  const session = ouvrir(
    sessionId,
    visitorId,
    { user: marqueIdentite(sessionId, "user", identites.user), account: marqueIdentite(sessionId, "account", identites.account) },
    Date.now(),
  );
  try {
    ecrire(session);
  } catch {
    /* session volatile */
  }
  return session;
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
 *
 * `candidat` : l'identifiant tiré en mémoire avant l'accord. Il n'est écrit que si
 * le stockage n'en garde pas déjà un — sinon celui du stockage prime, et le
 * visiteur reste le même d'une visite à l'autre.
 */
export function getOrCreateVisitor(candidat?: string): string {
  const valable = (v: string | null | undefined): v is string => typeof v === "string" && v.length >= 16;
  if (!accesTerminalAutorise()) return valable(candidat) ? candidat : uuid();
  let vid: string | null = null;
  try {
    vid = localStorage.getItem(VISITOR_KEY);
  } catch {
    /* stockage indisponible : identifiant volatil, le temps de la page */
  }
  // Un identifiant corrompu ou tronqué ne se répare pas : on retire.
  if (!valable(vid)) {
    vid = valable(candidat) ? candidat : uuid();
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
  session.derniere = Date.now();
  try {
    // Les marques d'identité voyagent avec la session : sans elles, la page suivante
    // prendrait la session pour anonyme.
    ecrire(session);
  } catch {
    /* ignore */
  }
}
