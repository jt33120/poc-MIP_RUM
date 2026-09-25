// DSAR (Data Subject Access Request) — logique PURE et testée (Lot 5, souveraineté).
//
// Toutes les données d'une personne sont ancrées sur rum_session.visitor_id. Les
// tables enfant les rattachent par session_id. Ce module est la DÉFINITION DE
// RÉFÉRENCE du périmètre couvert (export & effacement) et de l'ordre de
// suppression SÛR au regard des clés étrangères — le SQL (queries-dsar.ts) la
// reflète.
//
// Les noms de tables/colonnes sont des CONSTANTES (allowlist compile-time),
// jamais des entrées utilisateur : seuls app_id et l'identifiant sont paramétrés.
//
// ═══════ POURQUOI CE MODULE REFUSE DE RÉPONDRE À CERTAINES DEMANDES ═══════════
//
// Jusqu'au 09/09/2026, l'ancre était `user_hash` : un FNV-1a de (user-agent +
// langue + résolution + fuseau). Cet identifiant ne désigne pas UNE personne. Sur
// un parc géré par une DSI — le créneau exact de ce produit — des dizaines de
// postes identiques partagent la même valeur.
//
// Conséquence, et c'est la raison d'être de ce garde-fou : l'outil censé assurer
// la conformité PRODUISAIT la violation.
//
//   * un export art. 15 sur cette clé communiquait à un demandeur les parcours,
//     erreurs et rejeux de TOUS ses collègues ;
//   * un effacement art. 17 sur cette clé supprimait les données d'AUTRES
//     personnes, qui n'avaient rien demandé.
//
// L'historique n'est pas convertible : l'information « qui était derrière ce
// hash » n'a jamais existé. On ne peut donc ni la retrouver, ni la deviner. Le
// seul comportement défendable est de REFUSER, en le disant. Répondre
// PARTIELLEMENT à une demande d'accès (« nous n'avons rien sur cette clé depuis
// le 09/09 ») est un manquement discutable ; communiquer les données d'un tiers
// est une violation caractérisée. On choisit le premier.

/** Table qui porte visitor_id — supprimée en DERNIER (les enfants la référencent). */
export const DSAR_ANCHOR = "rum_session" as const;

/**
 * LA colonne sur laquelle un export ou un effacement s'exécute. Constante, jamais
 * une entrée : c'est ce qui rend impossible, structurellement, de viser
 * `user_hash` depuis ce chemin de code.
 */
export const DSAR_ID_COLUMN = "visitor_id" as const;

/**
 * Hors périmètre PAR CONSTRUCTION : les issues d'erreurs et leur workflow
 * (error_issue, error_issue_alias, error_issue_activity, error_issue_ticket,
 * error_issue_notification). Ni session, ni visiteur, ni identité, ni message ou
 * stack : des clés de regroupement, des releases, des comptes console et du texte
 * d'opérateur scrubbé. Effacer les occurrences d'une personne n'y laisse donc rien
 * d'elle — prouvé par tests/integration/error-issues-sql.test.ts. Ces tables
 * suivent la rétention et l'effacement de leur app par clé étrangère.
 *
 * Tables enfant reliées par session_id, dans un ordre de suppression SÛR.
 * Contrainte FK vérifiée en base : rum_metric/rum_error → rum_pageview, et
 * toutes → rum_session. rum_ai.session_id n'a pas de FK (nullable). L'ordre
 * ci-dessous supprime donc metric/error AVANT pageview, et tout AVANT l'ancre.
 */
export const DSAR_CHILD_TABLES = [
  "rum_metric",
  "rum_error",
  "rum_pageview",
  "rum_event_index",
  "rum_action",
  "rum_span",
  "rum_event",
  "rum_breadcrumb",
  "rum_longtask",
  "rum_resource",
  // P5.3 (v70) : un log OTel porte `session_id`. Il MANQUAIT de cette liste —
  // un export art. 15 ne le rendait pas, un effacement art. 17 le laissait. La
  // liste est désormais comparée au catalogue par un test SQL : toute table
  // portant `session_id` doit y figurer ou être justifiée.
  "rum_log",
  "rum_ai",
  "replay_chunk",
] as const;

export type DsarTable = (typeof DSAR_CHILD_TABLES)[number] | typeof DSAR_ANCHOR;

/** Toutes les tables du périmètre DSAR (enfants + ancre). */
export const DSAR_TABLES: readonly string[] = [...DSAR_CHILD_TABLES, DSAR_ANCHOR];

/** Ordre de suppression : enfants (déjà ordonnés FK) puis l'ancre en dernier. */
export function dsarDeleteOrder(): DsarTable[] {
  return [...DSAR_CHILD_TABLES, DSAR_ANCHOR];
}

/**
 * Arêtes FK connues À L'INTÉRIEUR du périmètre DSAR (enfant → parent) : l'enfant
 * doit être supprimé AVANT son parent. Garde-fou testable de l'ordre.
 */
export const DSAR_FK_EDGES: ReadonlyArray<readonly [DsarTable, DsarTable]> = [
  ["rum_metric", "rum_pageview"],
  ["rum_metric", "rum_session"],
  ["rum_error", "rum_pageview"],
  ["rum_error", "rum_session"],
  ["rum_pageview", "rum_session"],
  ["rum_span", "rum_session"],
  ["rum_event", "rum_session"],
  ["rum_breadcrumb", "rum_session"],
  ["rum_longtask", "rum_session"],
  ["rum_resource", "rum_session"],
];

/**
 * Vrai si l'ordre supprime chaque enfant AVANT son parent (toutes les arêtes FK
 * respectées) — invariant de sûreté de dsarDeleteOrder().
 */
export function isSafeDeleteOrder(
  order: readonly string[],
  edges: ReadonlyArray<readonly [string, string]> = DSAR_FK_EDGES,
): boolean {
  const rank = new Map(order.map((t, i) => [t, i]));
  return edges.every(([child, parent]) => {
    const c = rank.get(child);
    const p = rank.get(parent);
    return c != null && p != null && c < p;
  });
}

// ══════════════════════════ Recevabilité d'une demande ═══════════════════════
//
// Trois issues, et une seule exécute quoi que ce soit.

export const DSAR_VERDICTS = ["execute", "refus_empreinte", "inconnu"] as const;
export type DsarVerdict = (typeof DSAR_VERDICTS)[number];

/**
 * Décide, à partir du seul décompte des lignes, si la demande peut s'exécuter.
 * Pure : la couche I/O fournit les deux nombres, cette fonction tranche.
 *
 * `heritees` = sessions dont le `user_hash` vaut l'identifiant saisi. On les
 * compte UNIQUEMENT pour pouvoir dire pourquoi on refuse — jamais pour les
 * exporter ni les effacer.
 */
export function dsarVerdict(n: { visiteur: number; heritees: number }): DsarVerdict {
  if (n.visiteur > 0) return "execute";
  if (n.heritees > 0) return "refus_empreinte";
  return "inconnu";
}

/** Ce qu'on affiche, et ce qu'on trace dans l'audit, pour chaque verdict. */
export const DSAR_MESSAGES: Record<DsarVerdict, string> = {
  execute: "Identifiant de visiteur reconnu — export et effacement autorisés sur ce périmètre.",
  refus_empreinte:
    "REFUS. Cet identifiant est une ancienne empreinte de classe d'appareil (user_hash), " +
    "pas un identifiant de personne : plusieurs visiteurs d'un parc homogène partagent la " +
    "même valeur. Exporter reviendrait à communiquer les données de tiers, effacer à " +
    "supprimer celles de personnes qui n'ont rien demandé. Ces sessions ne sont ni " +
    "exportables ni effaçables individuellement ; elles disparaissent d'elles-mêmes à " +
    "l'échéance de rétention.",
  inconnu: "Aucune session sous cet identifiant de visiteur sur ce périmètre.",
};

/** Levée par la couche I/O quand la demande n'est pas recevable. */
export class DsarRefus extends Error {
  constructor(readonly verdict: Exclude<DsarVerdict, "execute">) {
    super(DSAR_MESSAGES[verdict]);
    this.name = "DsarRefus";
  }
}

/**
 * Document d'export DSAR — forme portable et stable (une clé par table).
 *
 * VERSION 3 (C10) : les colonnes binaires sortent en base64 (`binaire`).
 *
 * VERSION 2 (09/09/2026) : la clé d'ancrage passe de `user_hash` à `visitor_id`.
 * Ce n'est pas un renommage cosmétique — les deux champs ne désignent pas la
 * même chose (le premier, une classe d'appareil ; le second, un visiteur), donc
 * le numéro de version bouge pour qu'un consommateur ne les confonde pas.
 */
export interface DsarExport {
  kind: "mip-rum-dsar-export";
  version: 3;
  /** Les colonnes binaires (`bytea` : le corps d'un chunk de rejeu) : en base64. */
  binaire: "base64";
  app: string;
  visitor_id: string;
  generated_at: string;
  session_count: number;
  summary: Record<string, number>;
  tables: Record<string, unknown[]>;
}

export const DSAR_IDENTITY_KINDS = ["user", "account"] as const;
export type DsarIdentityKind = (typeof DSAR_IDENTITY_KINDS)[number];

export function isDsarIdentityHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export interface DsarIdentityExport {
  kind: "mip-rum-dsar-identity-export";
  version: 2;
  /** Les colonnes binaires (`bytea` : le corps d'un chunk de rejeu) : en base64. */
  binaire: "base64";
  app: string;
  identity_kind: DsarIdentityKind;
  identity_hash: string;
  generated_at: string;
  tables: Record<string, unknown[]>;
}

export function buildDsarIdentityExport(input: {
  app: string;
  identityKind: DsarIdentityKind;
  identityHash: string;
  generatedAt: string;
  tables: Record<string, unknown[]>;
}): DsarIdentityExport {
  if (!isDsarIdentityHash(input.identityHash)) throw new Error("invalid identity hash");
  return {
    kind: "mip-rum-dsar-identity-export",
    version: 2,
    binaire: "base64",
    app: input.app,
    identity_kind: input.identityKind,
    identity_hash: input.identityHash,
    generated_at: input.generatedAt,
    tables: portable(input.tables),
  };
}

/**
 * Les lignes telles qu'un document JSON les porte. Une colonne `bytea` arrive en
 * `Buffer`, que JSON sérialisait en `{ type: "Buffer", data: [octet, …] }` — six
 * à huit caractères par octet, et une forme propre à Node. Elle sort en base64
 * (versions 3 et 2 des deux documents) : le document le dit (`binaire`).
 */
export function portable(tables: Record<string, unknown[]>): Record<string, unknown[]> {
  const valeur = (v: unknown): unknown => (v instanceof Uint8Array ? Buffer.from(v).toString("base64") : v);
  return Object.fromEntries(
    Object.entries(tables).map(([t, lignes]) => [
      t,
      lignes.map((l) =>
        l && typeof l === "object" && !Array.isArray(l)
          ? Object.fromEntries(Object.entries(l as Record<string, unknown>).map(([k, v]) => [k, valeur(v)]))
          : l,
      ),
    ]),
  );
}

/** Compte de lignes par table (résumé lisible du volume exporté/à effacer). */
export function summarizeCounts(tables: Record<string, unknown[]>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [t, rows] of Object.entries(tables)) out[t] = rows.length;
  return out;
}

/** Assemble le document d'export à partir des lignes brutes par table. */
export function buildDsarExport(input: {
  app: string;
  visitorId: string;
  generatedAt: string;
  tables: Record<string, unknown[]>;
}): DsarExport {
  const summary = summarizeCounts(input.tables);
  return {
    kind: "mip-rum-dsar-export",
    version: 3,
    binaire: "base64",
    app: input.app,
    visitor_id: input.visitorId,
    generated_at: input.generatedAt,
    session_count: input.tables[DSAR_ANCHOR]?.length ?? 0,
    summary,
    tables: portable(input.tables),
  };
}

// ═══════════════════ Ce que la garantie couvre, et ce qu'elle ne couvre pas ═══
//
// Ces phrases sont affichées À L'ÉCRAN dans le rapport DSAR, pas seulement
// écrites dans un journal d'implémentation. Une garantie que l'opérateur croit
// plus large qu'elle ne l'est vaut moins que pas de garantie du tout.

/** Nature de la protection durable, telle qu'elle est réellement configurée. */
export type EtatBarriere = "enforce" | "off" | "indisponible";

export const DSAR_LIMITES: readonly string[] = [
  "La preuve porte sur les identifiants FOURNIS ou DÉJÀ LIÉS : identifiant de session, " +
    "identifiant de visiteur, HMAC utilisateur ou compte, tous cloisonnés par application. " +
    "Un événement totalement anonyme — nouvelle session, aucun identifiant commun — ne peut " +
    "pas être attribué à cette personne, et ce produit ne le prétend pas.",
  "L'égalité repose sur des identifiants techniques ou des HMAC app-scopés. Aucune suppression " +
    "n'est décidée d'après une ressemblance de message, de stack ou d'user-agent.",
  "La même empreinte dans une AUTRE application est une autre personne au regard de ce produit : " +
    "le HMAC est cloisonné par application. Elle n'apparaît ni dans ce rapport, ni dans cet effacement.",
  "La barrière d'effacement est elle-même une donnée pseudonyme : elle conserve l'identifiant " +
    "effacé pour pouvoir le refuser. Elle n'a pas d'expiration par défaut.",
];

export const DSAR_BARRIERE_MESSAGES: Record<EtatBarriere, string> = {
  enforce:
    "Protection durable ACTIVE sur cette application : après l'effacement, tout writer refuse " +
    "les données rattachables aux identifiants supprimés. Les identifiants de session effacés " +
    "restent refusés pour toujours.",
  off:
    "Protection durable NON ACTIVÉE sur cette application. L'effacement est sérialisé avec " +
    "l'ingestion — aucun writer ne peut recréer de ligne pendant l'opération, et les lots encore " +
    "en file sont nettoyés — mais aucune barrière n'est conservée : un événement ultérieur " +
    "portant le même identifiant serait de nouveau collecté. L'activation attend une décision de " +
    "politique sur la conservation des barrières, leur réactivation et le traitement des sauvegardes.",
  indisponible:
    "État de la protection durable inconnu : la migration v81 n'est pas encore appliquée sur cette " +
    "base. L'effacement reste sérialisé avec l'ingestion ; aucune barrière n'est enregistrée.",
};

/** Nom de fichier d'export : horodaté et tronqué (identifiant long, pas de PII). */
export function dsarExportFilename(visitorId: string, generatedAt: string): string {
  const stamp = generatedAt.replace(/[:.]/g, "-");
  const court = visitorId.slice(0, 12).replace(/[^a-zA-Z0-9]/g, "");
  return `dsar-${court || "user"}-${stamp}.json`;
}
