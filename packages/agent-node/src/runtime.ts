// Runtime de l'agent : instrumentation (http/https, pg, console), contexte de
// requête (AsyncLocalStorage), files bornées et expédition OTLP. La logique pure
// vit dans core.ts ; les entrées publiques (register.ts, index.ts) n'ont ici que
// des appels.
//
// POURQUOI UN SINGLETON GLOBAL. `register.ts` (préchargé par `node -r`) et
// `index.ts` (importé par l'application) sont deux bundles distincts : chacun
// embarque sa copie de ce fichier. Sans point de rendez-vous, l'application
// obtiendrait un second AsyncLocalStorage, une seconde file et un second patch
// de console/http/pg — donc deux fois chaque span et un `withContext` invisible
// depuis l'instrumentation. Le registre global de symboles est ce rendez-vous :
// la première copie chargée crée l'état, les suivantes s'y attachent.
import { randomBytes } from "node:crypto";
import httpMod from "node:http";
import httpsMod from "node:https";
import { AsyncLocalStorage } from "node:async_hooks";
import Module from "node:module";
import {
  type AgentConfig,
  buildConfig,
  buildDbSpan,
  buildHttpServerSpan,
  buildLogPayload,
  buildLogRecord,
  buildPayload,
  describeError,
  describeThrown,
  type ExceptionInput,
  type LogLevel,
  logsEndpoint,
  normalizeRoute,
  normalizeSql,
  parseTraceparent,
  passesLevel,
  positiveNumber,
  resolveLogLevel,
  SEVERITY,
  sessionFromTracestate,
  sqlOperation,
} from "./core";

/** Contexte de la requête courante, propagé par AsyncLocalStorage. */
export interface ReqCtx {
  traceId: string;
  spanId: string;
  sessionId: string | null;
  route: string | null;
  userId: string | null;
  accountId: string | null;
  /** Attributs métier du scope (`mip.context`). */
  attributes: Record<string, unknown>;
  /**
   * Scope RACINE de la requête — celui dont le span sera émis.
   *
   * Un scope imbriqué a sa propre vue lexicale (restaurée en sortant), mais ce
   * qu'il DÉCLARE appartient à la requête : sans ce lien, un `withContext` posé
   * dans une fonction appelée n'arriverait jamais sur le span, et l'exception
   * qu'il décrit partirait sans son contexte.
   */
  racine: ReqCtx;
  /** Exceptions de la requête, émises avec son span http.server. */
  exceptions: ExceptionInput[];
  /** Identifiants déjà portés par ce span : la même Error n'y entre qu'une fois. */
  vues: Set<string>;
  /** Émet le span http.server, une seule fois. */
  emettre: (fin: "reponse" | "fermeture" | "fatale") => void;
}

/** Envoi d'un lot : `true` si le collecteur l'a accepté. Injectable pour les tests. */
export type Transport = (url: string, body: string, timeoutMs: number) => Promise<boolean>;

export interface AgentOptions {
  endpoint?: string;
  appId?: string;
  apiKey?: string | null;
  env?: string;
  service?: string;
  flushIntervalMs?: number;
  maxQueue?: number;
  logs?: boolean;
  logLevel?: string;
  logsEndpoint?: string;
  shutdownTimeoutMs?: number;
  /** Supprime la bannière de démarrage (tests, sorties machine). */
  quiet?: boolean;
  /** Horloge injectable : les tests la rendent déterministe. */
  clock?: () => number;
  transport?: Transport;
}

export interface Diagnostics {
  enabled: boolean;
  installed: boolean;
  queuedSpans: number;
  queuedLogs: number;
  droppedSpans: number;
  droppedLogs: number;
  /** Événements `track` refusés à l'émission (nom vide ou hors limites). */
  droppedEvents: number;
  failedFlushes: number;
}

export interface Etat {
  readonly version: 1;
  cfg: AgentConfig;
  quiet: boolean;
  clock: () => number;
  transport: Transport;
  als: AsyncLocalStorage<ReqCtx>;
  diagnostics: Diagnostics;
  globalContext: Record<string, unknown>;
  configurer(options: AgentOptions): void;
  installer(): void;
  enqueueSpan(span: Record<string, unknown>): void;
  enqueueLog(record: Record<string, unknown>): void;
  /** Vide les deux files sous un budget total. `true` = tout est parti. */
  flushTout(timeoutMs?: number): Promise<boolean>;
  exceptionIdPour(valeur: unknown): string;
  /** Ajoute l'exception au span de la requête ; `false` si son ID y est déjà. */
  ajouterAuSpan(ctx: ReqCtx, exception: ExceptionInput): boolean;
  journaliserException(level: LogLevel, exception: ExceptionInput, ctx: ReqCtx | null): boolean;
  arreter(timeoutMs?: number): Promise<boolean>;
}

const CLE = Symbol.for("@mip/agent-node.runtime.v1");
const MAX_BATCH = 128;

const hex = (n: number): string => randomBytes(n).toString("hex");
const header = (v: string | string[] | undefined): string | null =>
  (Array.isArray(v) ? v[0] : v) ?? null;

/** Transport par défaut : POST OTLP/HTTP JSON, BORNÉ dans le temps.
 *  Sans `signal`, un collecteur muet tiendrait la promesse d'un flush d'arrêt
 *  jusqu'au SIGKILL — exactement l'attente indéfinie qu'on veut interdire. */
const transportParDefaut: Transport = async (url, body, timeoutMs) => {
  const reponse = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return reponse.ok;
};

function creerEtat(): Etat {
  const als = new AsyncLocalStorage<ReqCtx>();
  const spanBuffer: Record<string, unknown>[] = [];
  const logBuffer: Record<string, unknown>[] = [];
  const identifiants = new WeakMap<object, string>();
  const diagnostics: Diagnostics = {
    enabled: false,
    installed: false,
    queuedSpans: 0,
    queuedLogs: 0,
    droppedSpans: 0,
    droppedLogs: 0,
    droppedEvents: 0,
    failedFlushes: 0,
  };
  let timer: ReturnType<typeof setInterval> | null = null;
  let inBridge = false; // garde de ré-entrance du pont de logs
  let interrompue: ReqCtx | null = null;
  let arret = false;

  const etat: Etat = {
    version: 1,
    cfg: buildConfig(process.env),
    quiet: false,
    clock: Date.now,
    transport: transportParDefaut,
    als,
    diagnostics,
    globalContext: {},
    configurer,
    installer,
    enqueueSpan,
    enqueueLog,
    flushTout,
    exceptionIdPour,
    ajouterAuSpan,
    journaliserException,
    arreter,
  };

  // --- configuration ---------------------------------------------------------
  function configurer(options: AgentOptions): void {
    const cfg = etat.cfg;
    if (typeof options.endpoint === "string" && options.endpoint.trim()) cfg.endpoint = options.endpoint.trim();
    if (typeof options.appId === "string" && options.appId.trim()) cfg.appId = options.appId.trim();
    if (options.apiKey !== undefined) cfg.apiKey = typeof options.apiKey === "string" && options.apiKey.trim() ? options.apiKey.trim() : null;
    if (typeof options.env === "string" && options.env.trim()) cfg.env = options.env.trim();
    if (typeof options.service === "string" && options.service.trim()) cfg.service = options.service.trim();
    if (options.flushIntervalMs !== undefined) cfg.flushMs = positiveNumber(options.flushIntervalMs, cfg.flushMs, 300_000);
    if (options.maxQueue !== undefined) cfg.maxQueue = positiveNumber(options.maxQueue, cfg.maxQueue, 100_000) || cfg.maxQueue;
    if (options.logs !== undefined) cfg.logs = options.logs !== false;
    if (options.logLevel !== undefined) cfg.logLevel = resolveLogLevel(options.logLevel);
    if (options.shutdownTimeoutMs !== undefined) cfg.shutdownTimeoutMs = positiveNumber(options.shutdownTimeoutMs, cfg.shutdownTimeoutMs, 30_000);
    // Dérivé de l'endpoint de traces, sauf surcharge explicite : un endpoint
    // reconfiguré ne doit pas laisser les logs pointer sur l'ancien déploiement.
    cfg.logsEndpoint = typeof options.logsEndpoint === "string" && options.logsEndpoint.trim()
      ? options.logsEndpoint.trim()
      : logsEndpoint(cfg.endpoint, process.env.MIP_RUM_LOGS_ENDPOINT);
    cfg.enabled = Boolean(cfg.endpoint && cfg.appId);
    if (options.quiet !== undefined) etat.quiet = options.quiet === true;
    if (typeof options.clock === "function") etat.clock = options.clock;
    if (typeof options.transport === "function") etat.transport = options.transport;
    diagnostics.enabled = cfg.enabled;
    if (diagnostics.installed) programmerTimer();
  }

  // --- files bornées ---------------------------------------------------------
  // Un collecteur injoignable ne doit pas faire grossir la mémoire de
  // l'application instrumentée : au plafond, le plus ancien part et se compte.
  function pousser(file: Record<string, unknown>[], item: Record<string, unknown>, perdus: "droppedSpans" | "droppedLogs"): void {
    if (file.length >= etat.cfg.maxQueue) {
      file.splice(0, file.length - etat.cfg.maxQueue + 1);
      diagnostics[perdus]++;
    }
    file.push(item);
  }

  function enqueueSpan(span: Record<string, unknown>): void {
    if (!etat.cfg.enabled) return;
    pousser(spanBuffer, span, "droppedSpans");
    diagnostics.queuedSpans = spanBuffer.length;
    if (spanBuffer.length >= MAX_BATCH) void flushSpans(etat.cfg.shutdownTimeoutMs);
  }

  function enqueueLog(record: Record<string, unknown>): void {
    if (!etat.cfg.enabled || !etat.cfg.logs) return;
    pousser(logBuffer, record, "droppedLogs");
    diagnostics.queuedLogs = logBuffer.length;
    if (logBuffer.length >= MAX_BATCH) void flushLogs(etat.cfg.shutdownTimeoutMs);
  }

  // --- expédition ------------------------------------------------------------
  /** Trace d'exploitation (MIP_RUM_DEBUG). Passe par le flux d'erreur standard,
   *  sous la garde de ré-entrance : elle ne se capture jamais elle-même. */
  function tracer(message: string): void {
    if (!process.env.MIP_RUM_DEBUG) return;
    const avant = inBridge;
    inBridge = true;
    try {
      console.warn(`[mip-agent] ${message}`);
    } finally {
      inBridge = avant;
    }
  }

  async function envoyer(
    file: Record<string, unknown>[],
    url: string,
    enveloppe: (lot: Record<string, unknown>[]) => unknown,
    timeoutMs: number,
  ): Promise<boolean> {
    if (!file.length || !etat.cfg.enabled) return true;
    const lot = file.splice(0, file.length);
    diagnostics.queuedSpans = spanBuffer.length;
    diagnostics.queuedLogs = logBuffer.length;
    try {
      // Best-effort assumé : un lot perdu n'impacte jamais l'app instrumentée,
      // et n'est pas rejoué (un rejeu sans acquittement durable doublerait les
      // signaux plus souvent qu'il n'en sauverait).
      const ok = await etat.transport(url, JSON.stringify(enveloppe(lot)), Math.max(1, timeoutMs));
      if (!ok) {
        diagnostics.failedFlushes++;
        tracer(`lot refusé par ${url}`);
      }
      return ok;
    } catch (erreur) {
      diagnostics.failedFlushes++;
      // Diagnostic d'exploitant, jamais le corps du lot : un échec d'envoi ne
      // doit pas recracher dans les journaux ce qu'on venait d'en extraire.
      tracer(`envoi impossible vers ${url} : ${(erreur as { message?: string })?.message ?? "inconnu"}`);
      return false;
    }
  }

  const flushSpans = (timeoutMs: number): Promise<boolean> =>
    envoyer(spanBuffer, etat.cfg.endpoint, (lot) => buildPayload(etat.cfg, lot), timeoutMs);

  const flushLogs = (timeoutMs: number): Promise<boolean> =>
    etat.cfg.logs
      ? envoyer(logBuffer, etat.cfg.logsEndpoint, (lot) => buildLogPayload(etat.cfg, lot), timeoutMs)
      : Promise.resolve(true);

  async function flushTout(timeoutMs?: number): Promise<boolean> {
    const budget = positiveNumber(timeoutMs, etat.cfg.shutdownTimeoutMs, 60_000) || etat.cfg.shutdownTimeoutMs;
    // Les deux signaux partent en parallèle : ils partagent le budget plutôt
    // que de le consommer l'un après l'autre.
    const [spans, logs] = await Promise.all([flushSpans(budget), flushLogs(budget)]);
    return spans && logs;
  }

  function programmerTimer(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (!etat.cfg.enabled || arret || etat.cfg.flushMs <= 0) return;
    timer = setInterval(() => {
      void flushSpans(etat.cfg.shutdownTimeoutMs);
      void flushLogs(etat.cfg.shutdownTimeoutMs);
    }, etat.cfg.flushMs);
    // Ne retient JAMAIS le processus : un agent de supervision qui empêche un
    // script de se terminer est un bug, pas une garantie de livraison.
    timer.unref?.();
  }

  // --- contexte de requête ---------------------------------------------------
  function onRequest(req: any, res: any): ReqCtx {
    const start = etat.clock();
    const tp = parseTraceparent(header(req?.headers?.traceparent));
    const traceId = tp?.traceId ?? hex(16);
    const parentSpanId = tp?.spanId ?? null;
    const spanId = hex(8); // identité du span http.server (parent des spans DB)
    const sessionId = sessionFromTracestate(header(req?.headers?.tracestate));
    const route = normalizeRoute(String(req?.url ?? "/"));
    let emis = false;
    const ctx: ReqCtx = {
      traceId,
      spanId,
      sessionId,
      route,
      userId: null,
      accountId: null,
      attributes: {},
      racine: null as unknown as ReqCtx, // renseigné juste après (racine = soi)
      exceptions: [],
      vues: new Set<string>(),
      emettre(fin) {
        // Sans réponse complète, seul un span porteur d'exception est émis : une
        // requête simplement abandonnée par le client n'en produisait pas.
        if (emis || (fin !== "reponse" && !ctx.exceptions.length)) return;
        emis = true;
        try {
          enqueueSpan(
            buildHttpServerSpan({
              traceId,
              spanId,
              parentSpanId,
              method: String(req?.method ?? "GET"),
              // `withContext` peut affiner la route (template du routeur) ;
              // il ne peut pas l'effacer.
              route: ctx.route ?? route,
              url: null,
              // Aucun en-tête parti : il n'existe pas de statut, pas même un 500.
              status: fin === "reponse" || res?.headersSent ? Number(res?.statusCode ?? 0) : null,
              sessionId: ctx.sessionId,
              startMs: start,
              durationMs: Math.max(0, etat.clock() - start),
              exceptions: ctx.exceptions,
              userId: ctx.userId,
              accountId: ctx.accountId,
              attributes: { ...etat.globalContext, ...ctx.attributes },
            }),
          );
        } catch {
          /* ignore */
        }
      },
    };
    ctx.racine = ctx;
    res?.on?.("finish", () => ctx.emettre("reponse"));
    res?.on?.("close", () => ctx.emettre("fermeture"));
    return ctx;
  }

  function patchHttp(mod: any): void {
    const proto = mod?.Server?.prototype;
    if (!proto || proto.__mipPatched) return;
    const origEmit = proto.emit;
    proto.emit = function (this: unknown, event: string, ...args: unknown[]) {
      if (event === "request") {
        let ctx: ReqCtx | null = null;
        try {
          ctx = onRequest(args[0], args[1]);
        } catch {
          /* ne jamais casser le serveur */
        }
        // Le traitement de la requête (et ses appels DB asynchrones) tourne dans
        // le contexte ALS -> les spans DB retrouvent leur parent http.server.
        if (ctx) {
          const courant = ctx;
          let termine = false;
          try {
            const retour = als.run(courant, () => origEmit.call(this, event, ...args));
            termine = true;
            return retour;
          } finally {
            // Pas de `catch` : l'exception d'un gestionnaire poursuit son chemin
            // intacte, sans relance qui déplacerait le message de crash de Node
            // vers ce fichier. Le moniteur la recevra avec ce contexte.
            if (!termine) requeteInterrompue(courant);
          }
        }
      }
      return origEmit.call(this, event, ...args);
    };
    proto.__mipPatched = true;
  }

  // --- exceptions (contrat P5.3) ---------------------------------------------
  // Trois voies automatiques, un même identifiant : l'exception levée par un
  // gestionnaire de requête, l'exception non interceptée du processus, et
  // `console.error(err)`. `captureException` (API publique) est la quatrième et
  // réutilise le MÊME identifiant : une Error capturée à la main puis relancée
  // ne produit pas deux erreurs.
  //
  // AUCUN handler `uncaughtException` ni `unhandledRejection` : en poser un
  // transformerait un crash en processus survivant. `uncaughtExceptionMonitor`
  // OBSERVE sans rien décider : Node termine le processus comme sans l'agent.
  function exceptionIdPour(valeur: unknown): string {
    if (valeur === null || (typeof valeur !== "object" && typeof valeur !== "function")) return hex(16);
    let id = identifiants.get(valeur as object);
    if (!id) {
      id = hex(16);
      identifiants.set(valeur as object, id);
    }
    return id;
  }

  /**
   * Requête dont le gestionnaire vient de lever. En sortant de `als.run`, le
   * contexte n'est plus actif : si personne n'intercepte l'exception, le moniteur
   * la reçoit dans la foulée, avant toute autre tâche, et la rattache à ce contexte.
   */
  function requeteInterrompue(ctx: ReqCtx): void {
    interrompue = ctx;
    // Interceptée plus haut, l'exception ne reviendra jamais au moniteur : le
    // contexte ne doit pas survivre pour être prêté à une exception ultérieure.
    setImmediate(() => {
      if (interrompue === ctx) interrompue = null;
    }).unref();
  }

  function surveillerExceptions(): void {
    process.on("uncaughtExceptionMonitor", (err: unknown) => {
      try {
        // Sans handler applicatif, Node termine le processus juste après ce moniteur.
        const fatale =
          process.listenerCount("uncaughtException") === 0 && !process.hasUncaughtExceptionCaptureCallback();
        const ctx = interrompue ?? als.getStore() ?? null;
        interrompue = null;
        const exception: ExceptionInput = {
          error: describeThrown(err),
          tsMs: etat.clock(),
          exceptionId: exceptionIdPour(err),
          handled: false,
          fatal: fatale ? true : null,
        };
        if (ctx) ajouterAuSpan(ctx, exception);
        else journaliserException(fatale ? "fatal" : "error", exception, null);
        if (fatale) {
          // Le processus ne répondra plus : le lot part maintenant ou jamais.
          ctx?.emettre("fatale");
          void flushTout(etat.cfg.shutdownTimeoutMs);
        }
      } catch {
        /* ignore */
      }
    });
  }

  /** Ajoute l'exception au span de la requête, une seule fois par identifiant. */
  function ajouterAuSpan(ctx: ReqCtx, exception: ExceptionInput): boolean {
    if (ctx.vues.has(exception.exceptionId)) return false;
    ctx.vues.add(exception.exceptionId);
    ctx.exceptions.push(exception);
    return true;
  }

  // --- pont de journalisation (signal LOGS) ----------------------------------
  /** Arguments console -> une ligne de texte (les objets sont sérialisés). */
  function formatArgs(args: unknown[]): string {
    return args
      .map((a) => {
        if (typeof a === "string") return a;
        // La stack ne va pas dans le corps : elle voyage en `exception.stacktrace`.
        const erreur = describeError(a);
        if (erreur) return erreur.type ? `${erreur.type}: ${erreur.message}` : erreur.message;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(" ");
  }

  /**
   * Exception structurée d'un `console.error(…, err)` : la première Error passée.
   * Du texte seul reste un log — « texte » n'est pas une exception —, et un
   * avertissement n'entre pas dans le suivi d'erreurs.
   */
  function exceptionJournalisee(level: LogLevel, args: unknown[], tsMs: number): ExceptionInput | null {
    if (SEVERITY[level] < SEVERITY.error) return null;
    for (const arg of args) {
      const error = describeError(arg);
      // `handled` reste inconnu : journaliser une Error ne dit pas si elle est relancée.
      if (error) return { error, tsMs, exceptionId: exceptionIdPour(arg), handled: null, fatal: null };
    }
    return null;
  }

  /**
   * Log d'une exception, avec le contexte de requête s'il y en a un.
   *
   * Le plancher `MIP_RUM_LOG_LEVEL` ne s'applique PAS ici : il règle la
   * verbosité de `console.*`, pas le suivi d'erreurs. Une exception non
   * interceptée ou capturée explicitement n'est pas du bavardage. En revanche,
   * couper le pont (`MIP_RUM_LOGS=false`) ferme bien cette route : hors requête,
   * il n'en existe pas d'autre, et l'appelant reçoit `false`.
   */
  function journaliserException(level: LogLevel, exception: ExceptionInput, ctx: ReqCtx | null): boolean {
    if (!etat.cfg.enabled || !etat.cfg.logs) return false;
    const { type, message } = exception.error;
    enqueueLog(
      buildLogRecord({
        level,
        body: type ? `${type}: ${message}` : message,
        tsMs: exception.tsMs,
        traceId: ctx?.traceId ?? null,
        spanId: ctx?.spanId ?? null,
        sessionId: ctx?.sessionId ?? null,
        route: ctx?.route ?? null,
        userId: ctx?.userId ?? null,
        accountId: ctx?.accountId ?? null,
        attributes: { ...etat.globalContext, ...(ctx?.attributes ?? {}) },
        exception,
      }),
    );
    return true;
  }

  function captureLog(level: LogLevel, args: unknown[]): void {
    if (inBridge || !etat.cfg.logs || !passesLevel(level, etat.cfg.logLevel)) return;
    inBridge = true;
    try {
      const ctx = als.getStore();
      const body = formatArgs(args);
      if (!body) return;
      const tsMs = etat.clock();
      enqueueLog(
        buildLogRecord({
          level,
          body,
          tsMs,
          traceId: ctx?.traceId ?? null,
          spanId: ctx?.spanId ?? null,
          sessionId: ctx?.sessionId ?? null,
          route: ctx?.route ?? null,
          userId: ctx?.userId ?? null,
          accountId: ctx?.accountId ?? null,
          attributes: { ...etat.globalContext, ...(ctx?.attributes ?? {}) },
          exception: exceptionJournalisee(level, args, tsMs),
        }),
      );
    } catch {
      /* ignore */
    } finally {
      inBridge = false;
    }
  }

  function patchConsole(): void {
    const c = console as unknown as Record<string, unknown> & { __mipLogPatched?: boolean };
    if (c.__mipLogPatched) return;
    const map: Array<[string, LogLevel]> = [
      ["debug", "debug"],
      ["log", "info"],
      ["info", "info"],
      ["warn", "warn"],
      ["error", "error"],
    ];
    for (const [method, level] of map) {
      const orig = c[method];
      if (typeof orig !== "function") continue;
      c[method] = function (this: unknown, ...args: unknown[]) {
        const out = (orig as (...a: unknown[]) => unknown).apply(this, args);
        captureLog(level, args); // après l'écriture réelle : jamais bloquant
        return out;
      };
    }
    c.__mipLogPatched = true;
  }

  // --- instrumentation pg (node-postgres) ------------------------------------
  function emitDbSpan(ctx: ReqCtx, sql: string, startMs: number, durationMs: number): void {
    try {
      enqueueSpan(
        buildDbSpan({
          traceId: ctx.traceId,
          spanId: hex(8),
          parentSpanId: ctx.spanId,
          system: "postgresql",
          statement: normalizeSql(sql),
          operation: sqlOperation(sql),
          startMs,
          durationMs,
        }),
      );
    } catch {
      /* ignore */
    }
  }

  // Patch Client.prototype.query (couvre aussi Pool.query, qui délègue à un Client).
  // Supporte les deux formes : Promise (pg >= 7) et callback. Hors requête tracée
  // (pas de contexte ALS) ou SQL non-string -> passe-plat.
  function patchPg(pg: any): void {
    const proto = pg?.Client?.prototype;
    if (!proto || proto.__mipQueryPatched) return;
    const origQuery = proto.query;
    if (typeof origQuery !== "function") return;
    proto.query = function (this: unknown, ...args: any[]) {
      const ctx = als.getStore();
      const config = args[0];
      const sql = typeof config === "string" ? config : config?.text;
      if (!ctx || typeof sql !== "string") return origQuery.apply(this, args);
      const start = etat.clock();
      const done = () => emitDbSpan(ctx, sql, start, Math.max(0, etat.clock() - start));
      const last = args[args.length - 1];
      if (typeof last === "function") {
        const origCb = last;
        args[args.length - 1] = function (this: unknown, ...a: unknown[]) {
          done();
          return origCb.apply(this, a);
        };
        return origQuery.apply(this, args);
      }
      const ret = origQuery.apply(this, args);
      if (ret && typeof ret.then === "function") {
        return ret.then(
          (r: unknown) => {
            done();
            return r;
          },
          (e: unknown) => {
            done();
            throw e;
          },
        );
      }
      done();
      return ret;
    };
    proto.__mipQueryPatched = true;
  }

  // Hook require : patche `pg` au chargement, sans en dépendre (agent zéro-dépendance).
  function hookRequire(): void {
    const M = Module as any;
    const orig = M._load;
    if (typeof orig !== "function" || M.__mipHooked) return;
    M._load = function (...a: any[]) {
      const loaded = orig.apply(this, a);
      if (a[0] === "pg") {
        try {
          patchPg(loaded);
        } catch {
          /* ignore */
        }
      }
      return loaded;
    };
    M.__mipHooked = true;
  }

  // --- arrêt borné -----------------------------------------------------------
  /**
   * SIGTERM : poser un écouteur SUPPRIME la terminaison par défaut de Node. Un
   * agent qui en pose un sans rien décider transforme donc `docker stop` en
   * attente de dix secondes suivie d'un SIGKILL. On ne prend la main que si
   * personne d'autre ne l'a prise, et on rend alors le comportement d'origine en
   * réémettant le signal après un flush BORNÉ.
   */
  const surSigterm = (): void => {
    // Mesuré AU MOMENT du signal : l'application peut avoir posé son propre
    // écouteur bien après le préchargement de l'agent.
    const seul = process.listenerCount("SIGTERM") <= 1;
    const fin = () => {
      if (!seul) return; // l'application décide de sa terminaison, pas nous
      process.removeListener("SIGTERM", surSigterm);
      process.kill(process.pid, "SIGTERM");
    };
    arret = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    flushTout(etat.cfg.shutdownTimeoutMs).then(fin, fin);
  };
  const surBeforeExit = (): void => {
    void flushTout(etat.cfg.shutdownTimeoutMs);
  };

  function surveillerArret(): void {
    process.on("SIGTERM", surSigterm);
    // `beforeExit` ne retient pas le processus : il ne se déclenche que lorsque
    // la boucle d'événements est déjà vide.
    process.on("beforeExit", surBeforeExit);
  }

  async function arreter(timeoutMs?: number): Promise<boolean> {
    arret = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    // Les crochets posés par MIP repartent avec lui ; ceux de l'application et
    // les patches installés après nous restent intacts.
    process.removeListener("SIGTERM", surSigterm);
    process.removeListener("beforeExit", surBeforeExit);
    return flushTout(timeoutMs);
  }

  // --- installation ----------------------------------------------------------
  function installer(): void {
    diagnostics.enabled = etat.cfg.enabled;
    // Sans endpoint ni app_id : aucun patch, aucun crochet, aucun surcoût.
    if (!etat.cfg.enabled) return;
    arret = false;
    if (diagnostics.installed) {
      programmerTimer();
      return;
    }
    diagnostics.installed = true;
    patchHttp(httpMod);
    patchHttp(httpsMod);
    hookRequire();
    surveillerExceptions();
    surveillerArret();
    programmerTimer();
    if (!etat.quiet) {
      // La bannière est écrite AVANT le patch console : elle ne se capture pas
      // elle-même, et l'exploitant voit tout de suite si le pont logs est actif.
      console.log(
        `[mip-agent] actif -> ${etat.cfg.endpoint} (app ${etat.cfg.appId}, env ${etat.cfg.env})` +
          (etat.cfg.logs ? ` · logs >= ${etat.cfg.logLevel} -> ${etat.cfg.logsEndpoint}` : " · logs désactivés"),
      );
    }
    if (etat.cfg.logs) patchConsole();
  }

  return etat;
}

/** État partagé du processus : créé une fois, réutilisé par tous les bundles. */
export function runtime(): Etat {
  const global = globalThis as unknown as Record<symbol, Etat | undefined>;
  const existant = global[CLE];
  if (existant && existant.version === 1) return existant;
  const etat = creerEtat();
  global[CLE] = etat;
  return etat;
}
