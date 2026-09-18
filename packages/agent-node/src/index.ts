// API publique de l'agent Node (P7.4).
//
// Elle ne réinstrumente RIEN : `init()` installe le même runtime que le
// préchargement `node -r @mip/agent-node/register`, et les deux se rejoignent
// sur le registre global de symboles. Une application qui précharge l'agent PUIS
// importe ce module obtient donc un seul patch de console/http/pg, un seul
// contexte de requête et une seule file d'envoi.
//
// Aucune fonction de ce module ne lève dans l'application hôte : chacune renvoie
// `false` quand elle n'a rien émis (agent désactivé, entrée invalide, route non
// ouverte), jamais une exception.
import { randomBytes } from "node:crypto";
import {
  boundedName,
  boundedObject,
  buildTrackSpan,
  describeThrown,
  type ExceptionInput,
  type RequestContextInput,
  validateGlobalContext,
  validateRequestContext,
} from "./core";
import { type AgentOptions, type Diagnostics, type ReqCtx, runtime } from "./runtime";

export type { AgentOptions, Diagnostics, RequestContextInput };
export type { AgentConfig, LogLevel } from "./core";

/** Vue en lecture du contexte de la requête courante. */
export interface CurrentContext {
  traceId: string;
  spanId: string;
  sessionId: string | null;
  route: string | null;
  userId: string | null;
  accountId: string | null;
  attributes: Record<string, unknown>;
}

const PROPS_MAX_BYTES = 12 * 1024;

/**
 * Configure et installe l'agent. Sans endpoint ni app_id (option ou
 * `MIP_RUM_ENDPOINT`/`MIP_RUM_APP_ID`), l'agent reste inactif : aucun patch,
 * aucun crochet, aucun surcoût. Appelable plusieurs fois — la configuration est
 * mise à jour, l'instrumentation n'est jamais posée deux fois.
 */
export function init(options: AgentOptions = {}): void {
  const agent = runtime();
  agent.configurer(options);
  agent.installer();
}

/**
 * Attributs de SERVICE stables du processus, ajoutés à chaque signal.
 *
 * Refuse en bloc (retour `false`, rien n'est modifié) toute clé qui varie d'une
 * requête à l'autre — utilisateur, compte, client, session, commande. Un
 * identifiant posé ici serait attribué à toutes les requêtes suivantes, y compris
 * celles d'autres personnes : c'est `withContext` qui porte ces valeurs-là.
 */
export function setGlobalContext(attributes: Record<string, unknown>): boolean {
  const valides = validateGlobalContext(attributes);
  if (!valides) return false;
  runtime().globalContext = valides;
  return true;
}

/** Vide le contexte global de service. */
export function clearGlobalContext(): void {
  runtime().globalContext = {};
}

/**
 * Exécute `fn` dans un contexte de requête isolé (`AsyncLocalStorage`).
 *
 * Fonction synchrone ou `async` : la valeur de retour est rendue telle quelle,
 * une exception ou un rejet traversent intacts. Le contexte précédent est
 * restauré dans un `finally` — donc aussi quand `fn` lève, et quand sa promesse
 * est rejetée : rien ne fuit vers la requête suivante.
 *
 * Imbriqué dans un contexte existant, il en HÉRITE : trace, session et attributs
 * du parent restent, les champs fournis les remplacent. Un `traceparent`
 * malformé ne rattache rien — il est ignoré, il n'invente pas de trace.
 */
export function withContext<T>(context: RequestContextInput, fn: () => T): T {
  const agent = runtime();
  const parent = agent.als.getStore() ?? null;
  const patch = validateRequestContext(context);
  const traceId = patch.traceId ?? parent?.traceId ?? randomBytes(16).toString("hex");
  const ctx: ReqCtx = {
    traceId,
    // Un scope manuel n'a pas de span serveur à lui : il reprend celui de la
    // requête hôte quand il y en a une, pour que les spans enfants (DB) se
    // rattachent au bon parent plutôt qu'à un span qui n'existe nulle part.
    spanId: parent && !patch.traceId ? parent.spanId : (patch.parentSpanId ?? randomBytes(8).toString("hex")),
    sessionId: patch.sessionId ?? parent?.sessionId ?? null,
    route: patch.route ?? parent?.route ?? null,
    userId: patch.userId ?? parent?.userId ?? null,
    accountId: patch.accountId ?? parent?.accountId ?? null,
    attributes: { ...(parent?.attributes ?? {}), ...patch.attributes },
    racine: null as unknown as ReqCtx,
    // Les exceptions et le span http.server restent ceux de la requête hôte :
    // un scope manuel enrichit son contexte, il ne crée pas un second span
    // serveur pour la même requête.
    exceptions: parent?.exceptions ?? [],
    vues: parent?.vues ?? new Set<string>(),
    emettre: parent?.emettre ?? (() => {}),
  };
  ctx.racine = parent?.racine ?? ctx;
  // Ce que le scope DÉCLARE appartient à la requête : sans cette remontée, un
  // `withContext` posé dans une fonction appelée n'arriverait jamais sur le span
  // émis, et l'exception qu'il décrit partirait sans son contexte.
  if (ctx.racine !== ctx) {
    Object.assign(ctx.racine.attributes, patch.attributes);
    if (patch.sessionId) ctx.racine.sessionId = patch.sessionId;
    if (patch.route) ctx.racine.route = patch.route;
    if (patch.userId) ctx.racine.userId = patch.userId;
    if (patch.accountId) ctx.racine.accountId = patch.accountId;
  }
  return agent.als.run(ctx, fn);
}

/** Contexte de la requête courante, ou `null` en dehors de toute requête. */
export function getContext(): CurrentContext | null {
  const ctx = runtime().als.getStore();
  if (!ctx) return null;
  return {
    traceId: ctx.traceId,
    spanId: ctx.spanId,
    sessionId: ctx.sessionId,
    route: ctx.route,
    userId: ctx.userId,
    accountId: ctx.accountId,
    attributes: { ...ctx.attributes },
  };
}

/**
 * Événement métier, même enveloppe que `track()` du SDK web. `false` si rien
 * n'est parti : agent inactif, nom vide ou hors limites.
 *
 * Dans une requête, l'événement hérite de sa trace, de sa route et du contexte
 * du scope, et devient un enfant du span `http.server`. Hors requête (tâche
 * planifiée, consommateur de file), il part quand même.
 *
 * JAMAIS DE SESSION DÉCLARÉE, même quand le navigateur en propage une : le
 * front reste seul maître de `rum_session`, comme pour le span `http.server`.
 * Un émetteur backend qui revendiquerait une session ferait écrire une ligne de
 * session incomplète — et, si elle n'existait pas encore, ferait échouer tout le
 * lot sur sa clé étrangère. La corrélation passe par la trace du span parent,
 * qui, elle, porte la session.
 *
 * Aucune causalité DOM n'est reconstituée : un événement backend est déclaré par
 * l'application, il n'est pas déduit d'une interaction.
 */
export function track(name: string, props: Record<string, unknown> = {}): boolean {
  try {
    const agent = runtime();
    const nom = boundedName(name);
    if (!agent.cfg.enabled || !nom) {
      if (agent.cfg.enabled) agent.diagnostics.droppedEvents++;
      return false;
    }
    const ctx = agent.als.getStore() ?? null;
    agent.enqueueSpan(
      buildTrackSpan({
        name: nom,
        props: boundedObject(props, PROPS_MAX_BYTES),
        traceId: ctx?.traceId ?? randomBytes(16).toString("hex"),
        spanId: randomBytes(8).toString("hex"),
        parentSpanId: ctx?.spanId ?? null,
        sessionId: null, // voir ci-dessus : jamais revendiquée par le backend
        route: ctx?.route ?? null,
        userId: ctx?.userId ?? null,
        accountId: ctx?.accountId ?? null,
        attributes: { ...agent.globalContext, ...(ctx?.attributes ?? {}) },
        tsMs: agent.clock(),
      }),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Capture manuelle d'une exception, au contrat P5.3.
 *
 * Dans une requête : événement `exception` de son span `http.server`, avec la
 * stack. Hors requête : log d'exception corrélé à rien d'autre que lui-même.
 *
 * DÉDUPLICATION. L'identifiant `mip.exception_id` est attaché à l'objet `Error`
 * lui-même, comme pour les captures automatiques : la même `Error` capturée à la
 * main puis relancée, ou journalisée par `console.error`, garde le même
 * identifiant et l'ingestion n'écrit qu'une erreur. Deux `Error` distinctes
 * décrivant le même incident n'ont, elles, aucun identifiant commun : elles
 * restent deux erreurs, et c'est volontaire — on ne devine pas une égalité.
 */
export function captureException(error: unknown, context: Record<string, unknown> = {}): boolean {
  try {
    const agent = runtime();
    if (!agent.cfg.enabled) return false;
    const ctx = agent.als.getStore() ?? null;
    const supplement = boundedObject(context, 16 * 1024);
    const exception: ExceptionInput = {
      error: describeThrown(error),
      tsMs: agent.clock(),
      exceptionId: agent.exceptionIdPour(error),
      // Capturée à la main : le code l'a interceptée. C'est ce qui la distingue
      // d'une exception qui a échappé au gestionnaire de requête.
      handled: true,
      fatal: null,
    };
    if (ctx) {
      // Le contexte d'appel enrichit le scope de la requête : c'est lui que
      // l'ingestion lit comme snapshot (`mip.context` du span porteur).
      if (Object.keys(supplement).length) {
        Object.assign(ctx.attributes, supplement);
        Object.assign(ctx.racine.attributes, supplement);
      }
      return agent.ajouterAuSpan(ctx, exception);
    }
    return agent.journaliserException("error", exception, null);
  } catch {
    return false;
  }
}

/**
 * Vide les files d'envoi. `true` si tout est parti sous le budget.
 *
 * BORNÉ par construction : l'envoi porte un `AbortSignal` de `timeoutMs`, donc
 * un collecteur muet ne peut pas retenir un arrêt de processus.
 */
export function flush(options: { timeoutMs?: number } = {}): Promise<boolean> {
  try {
    return runtime().flushTout(options.timeoutMs);
  } catch {
    return Promise.resolve(false);
  }
}

/**
 * Arrêt : coupe le timer périodique, retire les crochets d'arrêt posés par MIP,
 * puis vide les files sous le même budget. Les patches d'instrumentation, eux,
 * restent en place — les retirer casserait tout patch installé après nous.
 */
export function shutdown(options: { timeoutMs?: number } = {}): Promise<boolean> {
  try {
    return runtime().arreter(options.timeoutMs);
  } catch {
    return Promise.resolve(false);
  }
}

/** État observable de l'agent : files, pertes, échecs d'envoi. */
export function getDiagnostics(): Diagnostics {
  return { ...runtime().diagnostics };
}
