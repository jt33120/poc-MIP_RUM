import { accesTerminalAutorise, CLE_SESSION, CLE_VISITEUR } from "./consent";
import { marqueIdentite, type MarquesIdentite } from "./identite-session";

const STORAGE_KEY = CLE_SESSION;
const INACTIVITY_TTL_MS = 30 * 60 * 1000;

// Une session dure au plus 4 heures, même active : sans borne, un écran mural
// garderait la même session des semaines, hors des lectures et de la purge de
// rétention (finding 2.12 b, docs/AUDIT_RUM_EXTERNE.md).
const SESSION_MAX_MS = 4 * 60 * 60 * 1000;

// Le visiteur est un tirage aléatoire persisté, jamais dérivé du terminal : sur
// des parcs homogènes, une empreinte confondrait des milliers d'agents et serait
// du fingerprinting au sens du RGPD. Sans accès au terminal (./consent.ts), session
// et visiteur vivent en mémoire ; l'accord les écrit, un refus les efface.
const VISITOR_KEY = CLE_VISITEUR;

export interface Session {
  sessionId: string;
  /** Identifiant de visiteur : un tirage aléatoire, jamais dérivé du terminal. */
  visitorId: string;
  /** Marques des identités métier de la session (`marqueIdentite`) ; absentes : session anonyme. */
  identites?: MarquesIdentite;
  /** Début de la session (epoch ms) : la durée maximale se compte depuis lui. */
  debut?: number;
  /** Dernière activité (epoch ms) : le délai d'inactivité se compte depuis elle. */
  derniere?: number;
  /** Fin forcée (epoch ms) : début + 4 heures, même active. Absente : pas de borne. */
  echeance?: number;
}

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

/**
 * La session a-t-elle fini, par inactivité ou par durée ? Consultée avant chaque
 * événement, car une session se ferme aussi dans une page restée ouverte.
 */
export function echue(session: Session, maintenant: number): boolean {
  return (
    (session.derniere != null && maintenant - session.derniere >= INACTIVITY_TTL_MS) ||
    (session.echeance != null && maintenant >= session.echeance)
  );
}

/**
 * La session à poursuivre : celle du stockage (active < 30 min, commencée < 4 h),
 * sinon `candidate` (la session en mémoire, à l'accord ou au retour du cache du navigateur)
 * si elle vaut encore, sinon une neuve. Sans accès au terminal, rien n'est lu ni écrit.
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
    /* stockage indisponible ou corrompu : session neuve */
  }
  // Sans début stocké (ancien format) ou début futur (horloge reculée) : maintenant.
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
    /* mode privé : la session vit le temps de la page */
  }
  return session;
}

/** Nouvelle session, même visiteur, quand l'identité métier change. Une session
 * échue passe par `getOrCreateSession` : un autre onglet a pu ouvrir la suivante. */
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
 * L'identifiant de visiteur, tiré une fois et gardé sous sa propre clé : il
 * survit à l'expiration de la session, sinon tout revenant compterait comme nouveau.
 * Sans stockage, il vit le temps de la page (assumé : pas d'empreinte en repli).
 * `candidat`, tiré avant l'accord, n'est écrit que si le stockage n'en a pas.
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

/** Relance le délai d'inactivité (à chaque événement émis). */
export function touchSession(session: Session): void {
  session.derniere = Date.now();
  try {
    // Réécrit aussi les marques d'identité : sans elles, la page suivante la croirait anonyme.
    ecrire(session);
  } catch {
    /* ignore */
  }
}
