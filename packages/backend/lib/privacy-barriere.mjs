// P8.1 — LA primitive partagée : sérialiser l'écriture et l'effacement.
//
// POURQUOI CE MODULE EXISTE. L'effacement relevait les sessions EXISTANTES, puis
// supprimait leurs lignes. Tout ce qui arrivait après ce relevé les recréait :
// un lot déjà déposé dans `ingest_raw`, un beacon en vol, un chunk de rejeu, un
// log OTel portant la même identité. Le drain aggravait le cas — il tenait un
// verrou de ligne de file sur SA connexion, puis appelait `writeRows(pool, …)`,
// qui ouvrait sa PROPRE transaction sur une AUTRE connexion : les deux écritures
// n'étaient sérialisées avec rien.
//
// Ajouter un verrou au seul formulaire DSAR n'aurait fermé aucun de ces chemins.
// D'où une primitive UNIQUE, que TOUS les writers et l'effacement utilisent :
//
//   1. `withAppIngestTransaction(pool, appId, travail)` ouvre la transaction,
//      pose `lock_timeout`, prend le verrou consultatif de l'application, puis
//      exécute le travail avec CE client-là ;
//   2. `filtrerParBarrieres(client, rows)` retire du lot ce qui se rattache à un
//      sujet effacé — sous le verrou, donc après que l'effacement a commis ou
//      avant qu'il ne commence, jamais « au milieu ».
//
// VERROU DE TRANSACTION, JAMAIS DE SESSION. La chaîne de production passe par le
// pooler transactionnel de Neon (PgBouncer en mode transaction) : chaque
// transaction peut atterrir sur un backend différent, et un verrou de session y
// serait pris sur une connexion puis perdu sur la suivante. La leçon est déjà
// payée par `migrate.mjs` ; `pg_advisory_xact_lock` est la seule forme correcte.
//
// ORDRE DES VERROUS : APPLICATION D'ABORD, FILE ENSUITE. L'effacement prend
// l'app puis la file ; le drain doit faire pareil. L'inverse s'interbloque.
//
// CE QUE CE MODULE NE FAIT PAS. Il ne devine rien. L'égalité repose sur des
// identifiants techniques (session, visiteur) ou des HMAC app-scopés (utilisateur,
// compte) : jamais sur une ressemblance de message, de stack ou d'user-agent. Un
// événement totalement anonyme, nouvelle session, sans aucun identifiant commun
// avec la personne effacée, N'EST PAS rattachable — et ce module ne prétend pas
// le contraire.

/**
 * Espace de noms des verrous consultatifs d'ingestion. Doit valoir exactement
 * `mip_verrou_ingestion_ns()` côté SQL : la console, le noyau d'ingestion et les
 * fonctions PL/pgSQL doivent prendre LE MÊME verrou, sinon chacun se croit seul.
 * 811100 appartient déjà à `migrate.mjs` — un déploiement n'attend pas
 * l'ingestion, et réciproquement.
 */
export const VERROU_INGESTION_NS = 811_801;

/** Les quatre natures de sujet que la barrière sait refuser. */
export const SUJETS_BARRIERE = Object.freeze(["session", "visitor", "user", "account"]);

/**
 * Stratégie d'attente, exposée parce qu'elle est un choix et non un détail.
 *
 * `lock_timeout` de 5 s : au-delà, on rend la main au lieu de tenir une
 * connexion du pooler indéfiniment derrière un effacement long. Deux reprises
 * avec recul, puis un refus IDENTIFIÉ (`ErreurVerrouIngestion`) — jamais un
 * succès silencieux, jamais une écriture qui contourne la barrière.
 */
export const STRATEGIE_VERROU = Object.freeze({
  delaiMs: 5_000,
  tentatives: 3,
  reculMs: Object.freeze([120, 480]),
});

/** SQLSTATE `lock_not_available` — c'est ce que rend un `lock_timeout` épuisé. */
const SQLSTATE_VERROU = "55P03";

/** Attente bornée par le verrou d'application : l'appelant peut rejouer. */
export class ErreurVerrouIngestion extends Error {
  constructor(appIds) {
    super(`verrou d'ingestion indisponible après ${STRATEGIE_VERROU.tentatives} tentatives (${appIds.join(", ")})`);
    this.name = "ErreurVerrouIngestion";
    this.code = SQLSTATE_VERROU;
    this.apps = appIds;
    /** Rejouable : rien n'a été écrit. */
    this.reessayable = true;
  }
}

/**
 * Un identifiant déjà stocké sous une autre application est revendiqué.
 *
 * Ce n'est pas un incident transitoire : c'est une demande hors portée, et la
 * rejouer donnerait le même résultat. On ne la convertit JAMAIS en
 * `on conflict do update` sur l'autre locataire — ce serait écrire chez lui.
 */
export class ErreurPorteeApp extends Error {
  constructor(details) {
    super(`portée d'application : ${details}`);
    this.name = "ErreurPorteeApp";
    this.reessayable = false;
  }
}

// ───────────────────────────── Verrouillage ─────────────────────────────────

/** Applications réellement présentes dans un lot aplati, sans doublon. */
export function appsDuLot(rows) {
  const apps = new Set();
  for (const collection of Object.values(rows ?? {})) {
    if (!Array.isArray(collection)) continue;
    for (const ligne of collection) {
      const app = ligne?.app_id;
      if (typeof app === "string" && app) apps.add(app);
    }
  }
  return [...apps];
}

/**
 * Prend le verrou d'une ou plusieurs applications, dans un ordre DÉTERMINISTE.
 *
 * L'ordre n'est PAS lexical, et c'est délibéré : trier par `app_id` ferait
 * dépendre l'ordre de la collation, et un client qui trie en UTF-16 (JavaScript)
 * ne prendrait pas les verrous dans le même ordre qu'un serveur qui trie en
 * `fr_FR.UTF-8`. Deux lots multi-app s'interbloqueraient. On demande donc au
 * serveur la CLÉ de chaque application, et on verrouille par clé croissante —
 * le seul ordre que tous les chemins calculent à l'identique.
 */
export async function verrouillerApps(client, appIds) {
  const apps = [...new Set((appIds ?? []).filter((a) => typeof a === "string" && a))];
  if (!apps.length) return [];
  if (apps.length === 1) {
    await client.query("select pg_advisory_xact_lock($1::int4, hashtext($2)::int4)", [
      VERROU_INGESTION_NS,
      apps[0],
    ]);
    return apps;
  }
  const { rows } = await client.query(
    `select a as app, hashtext(a)::int4 as cle
       from unnest($1::text[]) as a
      group by a order by 2, 1`,
    [apps],
  );
  for (const ligne of rows) {
    await client.query("select pg_advisory_xact_lock($1::int4, $2::int4)", [
      VERROU_INGESTION_NS,
      ligne.cle,
    ]);
  }
  return rows.map((l) => l.app);
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * LA primitive. Ouvre une transaction, borne l'attente, verrouille la ou les
 * applications, puis exécute `travail(client)`.
 *
 * `appId` accepte une chaîne ou un tableau : un lot multi-app prend tous ses
 * verrous AVANT d'écrire quoi que ce soit, ce qui interdit d'écrire la moitié
 * d'un lot puis d'attendre. Les applications doivent être DÉJÀ authentifiées par
 * l'appelant : ce module ne fait jamais confiance à un `app_id` porté par le
 * seul client pour atteindre une autre application.
 */
export async function withAppIngestTransaction(pool, appId, travail, opts = {}) {
  const apps = Array.isArray(appId) ? appId : [appId];
  // Interpolé et non paramétré : `set` n'accepte pas de paramètre de liaison.
  // La valeur est donc réduite à un entier positif AVANT de toucher au SQL — un
  // NaN produirait `lock_timeout = 'NaNms'`, et une chaîne n'entre jamais ici.
  const delaiMs = Math.max(0, Math.round(Number(opts.delaiVerrouMs ?? STRATEGIE_VERROU.delaiMs)) || 0);
  const tentatives = opts.tentatives ?? STRATEGIE_VERROU.tentatives;
  const client = opts.client ?? (await pool.connect());
  const rendre = opts.client ? () => {} : () => client.release();
  try {
    for (let essai = 1; ; essai++) {
      await client.query("begin");
      try {
        // `set local` : la valeur retombe au commit comme au rollback, donc une
        // connexion rendue au pool ne transporte pas ce réglage à la requête
        // suivante — le défaut exact que `withTenant` documente pour les GUC.
        await client.query(`set local lock_timeout = '${delaiMs}ms'`);
        await verrouillerApps(client, apps);
      } catch (err) {
        await client.query("rollback").catch(() => {});
        if (err?.code !== SQLSTATE_VERROU || essai >= tentatives) {
          if (err?.code === SQLSTATE_VERROU) throw new ErreurVerrouIngestion(apps);
          throw err;
        }
        await dormir(STRATEGIE_VERROU.reculMs[Math.min(essai - 1, STRATEGIE_VERROU.reculMs.length - 1)]);
        continue;
      }
      try {
        const sortie = await travail(client);
        await client.query("commit");
        return sortie;
      } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
      }
    }
  } finally {
    rendre();
  }
}

// ─────────────────────────────── Barrières ──────────────────────────────────

/**
 * La table existe-t-elle sur ce schéma ?
 *
 * Même garde-fou que les colonnes optionnelles de `pg-ingest.mjs`, pour la même
 * raison : le code part en production AVANT que le pré-déploiement n'applique
 * v81, et référencer une table absente ferait rejeter TOUT le lot. Pendant cette
 * fenêtre il n'y a aucune barrière à appliquer — c'est exactement l'état
 * antérieur, pas une régression.
 */
const TTL_PRESENCE_MS = 60_000;
// Cache PAR BASE. Un cache global se tromperait dès qu'un même processus parle à
// deux bases de schémas différents — c'est le cas de toute la recette SQL, qui
// joue la fenêtre de déploiement sur une base restée en version antérieure.
const presence = new Map();

const cleBase = (client) => client?.database ?? client?.connectionParameters?.database ?? "";

async function schemaPorte(client, sonde, sql) {
  const cle = `${cleBase(client)} ${sonde}`;
  const vu = presence.get(cle);
  if (vu && Date.now() - vu.at < TTL_PRESENCE_MS) return vu.ok;
  const { rows } = await client.query(sql);
  const ok = rows[0]?.ok === true;
  presence.set(cle, { at: Date.now(), ok });
  return ok;
}

export function barrieresDisponibles(client) {
  return schemaPorte(
    client,
    "table",
    "select to_regclass('public.privacy_erasure_barrier') is not null as ok",
  );
}

function modeDisponible(client) {
  return schemaPorte(
    client,
    "mode",
    `select exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'app_registry'
                       and column_name = 'privacy_barrier_mode') as ok`,
  );
}

/** Réinitialise le cache de présence (tests). */
export function _resetPresenceBarrieres() {
  presence.clear();
}

/**
 * Sujets CANDIDATS d'un lot, par application.
 *
 * On relève tout ce qui peut rattacher une ligne à une personne : l'identifiant
 * de session (porté par presque toutes les collections), l'identifiant de
 * visiteur (porté par la session) et les HMAC d'identité (portés par la session,
 * les erreurs, les événements et la projection). Rien d'autre : ni message, ni
 * stack, ni user-agent.
 */
export function sujetsDuLot(rows) {
  const parApp = new Map();
  const noter = (app, genre, valeur) => {
    if (typeof app !== "string" || !app) return;
    if (typeof valeur !== "string" || !valeur) return;
    let vu = parApp.get(app);
    if (!vu) {
      vu = { session: new Set(), visitor: new Set(), user: new Set(), account: new Set() };
      parApp.set(app, vu);
    }
    vu[genre].add(valeur);
  };
  for (const collection of Object.values(rows ?? {})) {
    if (!Array.isArray(collection)) continue;
    for (const ligne of collection) {
      if (!ligne || typeof ligne !== "object") continue;
      noter(ligne.app_id, "session", ligne.session_id);
      noter(ligne.app_id, "visitor", ligne.visitor_id);
      noter(ligne.app_id, "user", ligne.user_id_hash);
      noter(ligne.app_id, "account", ligne.account_id_hash);
    }
  }
  return parApp;
}

/**
 * Interroge la barrière pour les sujets candidats d'un lot.
 * @returns {Promise<Map<string, {session:Set,visitor:Set,user:Set,account:Set}>>}
 */
export async function barrieresDuLot(client, candidats) {
  const bloques = new Map();
  for (const [app, sujets] of candidats) {
    const genres = [];
    const cles = [];
    for (const genre of SUJETS_BARRIERE) {
      for (const cle of sujets[genre]) {
        genres.push(genre);
        cles.push(cle);
      }
    }
    if (!genres.length) continue;
    const { rows } = await client.query(
      `select subject_kind, subject_key from privacy_erasure_barrier
        where app_id = $1
          and (subject_kind, subject_key) in (select * from unnest($2::text[], $3::text[]))
          and (expires_at is null or expires_at > now())`,
      [app, genres, cles],
    );
    if (!rows.length) continue;
    const vu = { session: new Set(), visitor: new Set(), user: new Set(), account: new Set() };
    for (const r of rows) vu[r.subject_kind]?.add(r.subject_key);
    bloques.set(app, vu);
  }
  return bloques;
}

/**
 * Retire d'un lot ce qui se rattache à un sujet effacé. PURE et testable.
 *
 * DEUX PASSES, ET LA PREMIÈRE EST INDISPENSABLE. Une barrière de visiteur ou
 * d'identité ne dit rien des identifiants de session : il faut d'abord déduire,
 * du lot lui-même, quelles sessions appartiennent au sujet effacé, puis retirer
 * TOUTES les lignes qui les portent. Sans cette passe, la session serait refusée
 * mais ses pages vues, ses erreurs et son rejeu entreraient quand même — et une
 * clé étrangère en échec ferait perdre le lot entier au lieu d'une personne.
 *
 * Les erreurs SANS session mais portant un HMAC (P5.3, exceptions backend)
 * correspondent directement : c'est leur seul rattachement possible, et il est
 * exact.
 */
export function filtrerLot(rows, bloques) {
  if (!bloques || bloques.size === 0) return { rows, refuses: {}, total: 0 };
  // Passe 1 — quelles sessions de CE lot appartiennent à un sujet effacé ?
  const sessionsRefusees = new Map(); // app -> Set(session_id)
  const ajouter = (app, session) => {
    if (typeof session !== "string" || !session) return;
    let vu = sessionsRefusees.get(app);
    if (!vu) sessionsRefusees.set(app, (vu = new Set()));
    vu.add(session);
  };
  for (const [app, vu] of bloques) for (const s of vu.session) ajouter(app, s);
  for (const collection of Object.values(rows ?? {})) {
    if (!Array.isArray(collection)) continue;
    for (const ligne of collection) {
      const vu = bloques.get(ligne?.app_id);
      if (!vu) continue;
      if (
        vu.visitor.has(ligne.visitor_id) ||
        vu.user.has(ligne.user_id_hash) ||
        vu.account.has(ligne.account_id_hash)
      ) {
        ajouter(ligne.app_id, ligne.session_id);
      }
    }
  }
  // Passe 2 — on retire.
  const refuse = (ligne) => {
    const vu = bloques.get(ligne?.app_id);
    if (!vu) return false;
    if (vu.user.has(ligne.user_id_hash) || vu.account.has(ligne.account_id_hash)) return true;
    if (vu.visitor.has(ligne.visitor_id)) return true;
    const sessions = sessionsRefusees.get(ligne.app_id);
    return sessions != null && typeof ligne.session_id === "string" && sessions.has(ligne.session_id);
  };
  const sortie = {};
  const refuses = {};
  let total = 0;
  for (const [nom, collection] of Object.entries(rows ?? {})) {
    if (!Array.isArray(collection)) {
      sortie[nom] = collection;
      continue;
    }
    const gardees = collection.filter((ligne) => !refuse(ligne));
    const perdues = collection.length - gardees.length;
    if (perdues > 0) {
      refuses[nom] = perdues;
      total += perdues;
    }
    sortie[nom] = gardees;
  }
  return { rows: sortie, refuses, total };
}

/**
 * Lit les barrières applicables au lot et rend le lot filtré.
 *
 * À APPELER SOUS LE VERROU, jamais avant : une lecture antérieure au verrou peut
 * être invalidée par un effacement qui commet entre-temps, et c'est précisément
 * la course que tout ce module ferme.
 */
export async function filtrerParBarrieres(client, rows) {
  if (!(await barrieresDisponibles(client))) return { rows, refuses: {}, total: 0 };
  const candidats = sujetsDuLot(rows);
  if (candidats.size === 0) return { rows, refuses: {}, total: 0 };
  return filtrerLot(rows, await barrieresDuLot(client, candidats));
}

/** Une session précise est-elle sous barrière dans cette application ? */
export async function sessionSousBarriere(client, appId, sessionId) {
  if (!(await barrieresDisponibles(client))) return false;
  const { rows } = await client.query(
    `select 1 from privacy_erasure_barrier
      where app_id = $1 and subject_kind = 'session' and subject_key = $2
        and (expires_at is null or expires_at > now()) limit 1`,
    [appId, sessionId],
  );
  return rows.length > 0;
}

/**
 * L'application a-t-elle ACTIVÉ la protection durable ?
 *
 * `off` par défaut : la décision de politique (durée de conservation des
 * barrières, réactivation, sauvegardes) n'a pas été prise, donc rien n'est
 * conservé d'une personne effacée tant qu'un exploitant ne l'a pas décidé
 * explicitement, application par application. Une barrière est elle-même un
 * identifiant pseudonyme : en retenir un « au cas où » serait exactement ce
 * qu'on reproche par ailleurs à l'ingestion.
 *
 * L'inverse n'est pas vrai : repasser à `off` N'EFFACE PAS les barrières déjà
 * posées. Un retour arrière ne doit pas lever la protection en silence.
 */
export async function barriereActivee(client, appId) {
  // La colonne est vérifiée AVANT d'être citée : PostgreSQL analyse la requête
  // entière, donc un `where exists (…information_schema…)` ne protégerait de
  // rien — la référence à une colonne absente échoue à l'analyse, pas à
  // l'exécution.
  if (!(await modeDisponible(client))) return false;
  const { rows } = await client.query(
    "select privacy_barrier_mode as mode from app_registry where app_id = $1",
    [appId],
  );
  return rows[0]?.mode === "enforce";
}

/**
 * Inscrit des sujets effacés. Idempotent : la première date d'effacement reste.
 *
 * Aucune fonction de LEVÉE n'existe dans ce module, et ce n'est pas un oubli :
 * la réactivation d'un sujet effacé est une décision de politique qui n'a pas
 * été prise. Aucun drapeau du SDK ne peut atteindre cette table.
 */
export async function poserBarrieres(client, appId, genre, cles, requestId = null) {
  const propres = [...new Set((cles ?? []).filter((c) => typeof c === "string" && c))];
  if (!propres.length) return 0;
  const { rows } = await client.query(
    `insert into privacy_erasure_barrier (app_id, subject_kind, subject_key, request_id)
     select $1, $2, cle, $4 from unnest($3::text[]) as cle
     on conflict (app_id, subject_kind, subject_key) do nothing
     returning 1`,
    [appId, genre, propres, requestId],
  );
  return rows.length;
}
