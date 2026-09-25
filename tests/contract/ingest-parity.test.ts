// P2 — CONTRAT DE PARITÉ DE LA COLLECTE : la console (routes Next) et le
// collector (`creerReceveur`) rendent le MÊME statut et écrivent les MÊMES
// lignes, pour la même requête.
//
// POURQUOI CE TEST. En P3, la console relaie chaque beacon vers le collector et
// ne garde son propre chemin d'écriture qu'en REPLI (erreur de connexion, 502,
// 504…). Pendant des semaines, une même requête peut donc être traitée par l'un
// OU par l'autre, selon un pourcentage tiré en base. Si les deux ne répondaient
// pas pareil, le SDK verrait deux contrats à la fois (un 500 ici, un 503 là ; un
// 413 d'un côté, un 200 de l'autre), et les écrans liraient deux jeux de lignes
// qui ne se recoupent pas. Les deux copies de la couche HTTP (plan, « Faits
// vérifiés », Collecte) ont déjà divergé une fois ; ce fichier est ce qui les
// empêche de recommencer sans que personne le voie.
//
// COMMENT. Deux bases Postgres 17 migrées par le migrateur de production
// (`services/scheduler/migrate.mjs`), UNE PAR CÔTÉ, amorcées à l'identique.
// Chaque cas envoie les MÊMES octets aux deux côtés, puis compare : statut,
// `retry-after`, corps JSON de la réponse, et ce que l'envoi a changé dans
// TOUTES les tables (delta entre deux instantanés complets de chaque base).
// Comparer tout — et pas « la table que le cas est censé écrire » — attrape
// aussi l'écriture parasite : un compteur, une ligne de session minimale, une
// trace d'audit que l'un des deux côtés ajouterait seul.
//
//   - Côté console : les route handlers appelés comme par Next, avec une
//     `Request` web (même méthode que `identity-ingest-ports.test.ts`), sur le
//     VRAI `@/lib/db` pointé sur sa base. Aucun module n'est simulé.
//   - Côté collector : `creerReceveur` derrière un vrai `node:http`, requêtes
//     envoyées par `http.request` pour maîtriser les en-têtes au bit près
//     (`content-length` annoncé, ou corps en flux sans longueur). Le chemin
//     envoyé est le chemin HISTORIQUE de la console (`/api/ingest/v1/*`,
//     `/api/sourcemaps`) : c'est celui que le relais de P3 et les clients
//     existants emprunteront.
//
// CE QUI N'EST PAS COMPARÉ, ET POURQUOI (plan, P2 « Tests ») :
//   - les colonnes GÉO de `rum_session` : la console lit l'en-tête pays du CDN,
//     le collector ne le croit que relayé et signé (bord de confiance) et fait
//     son propre GeoIP — deux provenances par construction ;
//   - les HORODATAGES D'ÉCRITURE (`COLONNES_EXCLUES`, chacun justifié) : ils
//     disent QUAND un côté a écrit, pas CE qu'il a écrit, et les deux côtés
//     n'écrivent pas à la même milliseconde ;
//   - `rate_counter` ligne à ligne : il est rangé par minute d'ARRIVÉE ; on
//     compare à la place le total de coups par app (même nombre de beacons
//     comptés des deux côtés, y compris ceux refusés en 429) ;
//   - `schema_migration` : écrit par le migrateur, jamais par l'ingestion.
//
// ÉCARTS VOULUS, un cas chacun en fin de fichier (bloc « écarts voulus ») :
// source map au-delà de 4 Mio (plafond Vercel), upload sans jeton (porte admin
// de la console), secret d'identité vide sur Vercel (décision du 23/09) ; plus
// le nommage `/v1/*` que seul le collector sert (cas « logs nominaux »).
//
// ÉCARTS CORRIGÉS grâce à ce contrat (la console s'aligne sur le collector) :
//   - corps OTLP sans longueur annoncée au-delà de 2 Mo : 200 console, 413
//     collector → lecture bornée partagée (`shared/limits.mjs`, `lireCorpsBorne`) ;
//   - base injoignable au moment d'écrire : 500 console, 503 + retry-after
//     collector → prédicat partagé (`shared/retry.mjs`, `estIndisponibilite`),
//     branché dans `refusIngestion` (`apps/console/lib/ingest.ts`).
//
// DÉFAUT COMMUN CORRIGÉ DES DEUX CÔTÉS : un chunk de rejeu sans `x-mip-seq`
// partait en séquence 0 (`Number(null) === 0`) → 400 partout, par le même
// `lireSequenceReplay` ; et la console lit le corps du rejeu borné.
//
// LANCEMENT (Docker, jamais la production — le test REFUSE un hôte non local) :
//   docker run -d --rm --name mip-parite -e POSTGRES_PASSWORD=postgres -p 55451:5432 postgres:17
//   psql … -c 'create database parite_next' -c 'create database parite_collector'
//   DATABASE_URL=postgres://postgres:postgres@localhost:55451/parite_next node services/scheduler/migrate.mjs
//   DATABASE_URL=postgres://postgres:postgres@localhost:55451/parite_collector node services/scheduler/migrate.mjs
//   CONTRACT_NEXT_DATABASE_URL=…/parite_next CONTRACT_COLLECTOR_DATABASE_URL=…/parite_collector pnpm test:contract
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, request as requeteHttp, type Server } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// AVANT TOUT IMPORT DE LA CONSOLE. `@/lib/db` lit DATABASE_URL, et `@/lib/ingest`
// lit REQUIRE_API_KEY et RATE_LIMIT_PER_MIN, AU CHARGEMENT du module : les poser
// après les imports n'aurait aucun effet. DATABASE_URL est écrasée même quand
// le contrat est ignoré — une variable héritée du shell (le `.env` de
// production, par exemple) ne doit jamais atteindre un pool que ce fichier
// importe, même inutilisé.
const ENV = vi.hoisted(() => {
  const next = process.env.CONTRACT_NEXT_DATABASE_URL || null;
  const collector = process.env.CONTRACT_COLLECTOR_DATABASE_URL || null;
  // Ce test ÉCRIT dans ses bases : il refuse tout hôte non local.
  for (const url of [next, collector]) {
    if (!url) continue;
    const hote = new URL(url).hostname;
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(hote)) {
      throw new Error(`contrat de parité : base non locale refusée (${hote}) — Docker uniquement`);
    }
  }
  if (next && collector && next === collector) {
    throw new Error("contrat de parité : une base PAR CÔTÉ, pas la même deux fois");
  }
  process.env.DATABASE_URL = next ?? "postgres://parite:absente@127.0.0.1:9/parite_absente";
  // La configuration de production du collector (`railway.ts`) : clé exigée.
  process.env.REQUIRE_API_KEY = "true";
  process.env.RATE_LIMIT_PER_MIN = "600";
  process.env.IDENTITY_HASH_SECRET = "parite-secret-identite";
  // C11 — un jeton d'API HISTORIQUE (CONSOLE_API_TOKENS), scopé sur l'app A : la
  // console l'accepte encore pour un marqueur de déploiement, le collector non.
  process.env.CONSOLE_API_TOKENS = "parite-jeton-historique@parite-a";
  return { next, collector, secret: "parite-secret-identite", limite: 600 };
});

import { POST as POST_LOGS } from "../../apps/console/app/api/ingest/v1/logs/route";
import { POST as POST_REPLAY } from "../../apps/console/app/api/ingest/v1/replay/route";
import { POST as POST_TRACES } from "../../apps/console/app/api/ingest/v1/traces/route";
import { POST as POST_SOURCEMAPS } from "../../apps/console/app/api/sourcemaps/route";
import { POST as POST_BATTEMENT } from "../../apps/console/app/api/extension/heartbeat/route";
import { GET as GET_RESOLVE } from "../../apps/console/app/api/extension/resolve/route";
import { POST as POST_DEPLOIEMENT } from "../../apps/console/app/api/v1/deploys/route";
import { pool as poolConsole } from "../../apps/console/lib/db";
// @ts-expect-error module ESM partagé, sans déclarations
import { VERROU_INGESTION_NS } from "../../packages/backend/lib/privacy-barriere.mjs";
// @ts-expect-error module ESM partagé, sans déclarations
import { creerReceveur } from "../../packages/backend/lib/receiver.mjs";
// @ts-expect-error module ESM partagé, sans déclarations
import { genererJetonUpload } from "../../packages/backend/lib/sourcemap-upload.mjs";

// En CI, l'absence des bases est une panne de câblage, pas une raison de sauter :
// un contrat qui se skippe en silence ne protège rien (même leçon que les bases
// `pre_v*` de `ci.yml`).
if (process.env.CI && !(ENV.next && ENV.collector)) {
  throw new Error("CI : CONTRACT_NEXT_DATABASE_URL et CONTRACT_COLLECTOR_DATABASE_URL sont requis");
}
const suite = ENV.next && ENV.collector ? describe : describe.skip;

// ───────────────────────────── Amorce commune ──────────────────────────────

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

type App = { id: string; cle: string | null };

const APP = {
  a: { id: "parite-a", cle: "parite-cle-a" },
  b: { id: "parite-b", cle: "parite-cle-b" },
  debit: { id: "parite-debit", cle: "parite-cle-debit" },
  verrou: { id: "parite-verrou", cle: "parite-cle-verrou" },
  suspendue: { id: "parite-suspendue", cle: "parite-cle-suspendue" },
  enforce: { id: "parite-enforce", cle: "parite-cle-enforce" },
  identite: { id: "parite-identite", cle: "parite-cle-identite" },
} as const;

/**
 * Horloge commune, FIGÉE au chargement : chaque charge utile est construite une
 * fois et envoyée telle quelle aux deux côtés. Deux minutes dans le passé, dans
 * la fenêtre que `nanosToDate` accepte, pour qu'aucun horodatage ne soit
 * remplacé par « maintenant » — ce qui différerait d'un côté à l'autre.
 */
const T0 = Date.now() - 120_000;
/** Instant d'amorce des lignes de référence (app_registry, jetons). */
const AMORCE = new Date(T0 - 86_400_000).toISOString();
const nanos = (ms: number) => (BigInt(ms) * 1_000_000n).toString();

/** Jeton d'upload de source maps : MÊME id et même empreinte dans les deux bases. */
const JETON = genererJetonUpload() as { id: string; jeton: string; empreinte: string };
/** C11 — jeton de CI `deploys:write` de l'app A (migration-v92), de même. */
const JETON_DEPLOIEMENT = genererJetonUpload() as { id: string; jeton: string; empreinte: string };
/** C11 — le domaine de l'extension rattaché à l'app A. */
const DOMAINE_A = "parite-a.exemple.fr";

/**
 * Ce que les MIGRATIONS sèment elles-mêmes (apps `demo-app`, `gip-plateforme`… ;
 * singletons `alert_config`, `rum_new_error_watermark`…) porte l'instant où
 * CHAQUE base a été migrée : les deux bases différeraient avant le premier cas.
 * On recale tout horodatage non nul de ce semis sur la même horloge. Générique,
 * pour qu'une migration future qui sème une ligne horodatée ne casse pas le
 * contrat pour une raison qui n'a rien à voir avec l'ingestion.
 */
async function recalerSemis(db: pg.Pool) {
  const { rows } = await db.query<{ table_name: string; colonnes: string[] }>(
    `select c.table_name, array_agg(c.column_name::text order by c.column_name) as colonnes
       from information_schema.columns c
       join information_schema.tables t using (table_schema, table_name)
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
        and c.data_type in ('timestamp with time zone', 'timestamp without time zone')
      group by 1`,
  );
  for (const { table_name: table, colonnes } of rows) {
    if (TABLES_IGNOREES.has(table)) continue;
    const affectations = colonnes.map((c) => `"${c}" = case when "${c}" is null then null else $1::timestamptz end`);
    await db.query(`update "${table}" set ${affectations.join(", ")}`, [AMORCE]);
  }
}

async function amorcer(db: pg.Pool) {
  await recalerSemis(db);
  for (const app of Object.values(APP)) {
    await db.query(
      `insert into app_registry (app_id, name, api_key_hash, active, created_at, privacy_barrier_mode,
                                 ingestion_suspended_at, ingestion_suspended_by)
       values ($1, $1, $2, true, $3, $4, $5, $6)`,
      [
        app.id,
        sha256(app.cle),
        AMORCE,
        app.id === APP.enforce.id ? "enforce" : "off",
        app.id === APP.suspendue.id ? AMORCE : null,
        app.id === APP.suspendue.id ? "parite@test" : null,
      ],
    );
  }
  await db.query(
    `insert into sourcemap_upload_token (id, app_id, name, secret_hash, created_by, created_at, expires_at)
     values ($1, $2, 'CI parité', $3, 'parite@test', $4, $4::timestamptz + interval '30 days')`,
    [JETON.id, APP.a.id, JETON.empreinte, AMORCE],
  );
  await db.query(
    `insert into sourcemap_upload_token (id, app_id, name, secret_hash, scope, created_by, created_at, expires_at)
     values ($1, $2, 'CI parité — déploiements', $3, 'deploys:write', 'parite@test', $4, $4::timestamptz + interval '30 days')`,
    [JETON_DEPLOIEMENT.id, APP.a.id, JETON_DEPLOIEMENT.empreinte, AMORCE],
  );
  await db.query("insert into extension_scope (domain, app_id, created_at) values ($1, $2, $3)", [DOMAINE_A, APP.a.id, AMORCE]);
  // Débit : l'app `debit` a DÉJÀ consommé sa minute, et les quatre suivantes —
  // les cas 429 tombent quelques secondes après l'amorce, mais peuvent chevaucher
  // un changement de minute entre les deux côtés, ou arriver sur un poste lent.
  await db.query(
    `insert into rate_counter (app_id, minute, hits)
     select $1, date_trunc('minute', now()) + g * interval '1 minute', $2
       from generate_series(0, 4) g`,
    [APP.debit.id, ENV.limite],
  );
}

// ───────────────────────────── Charges utiles ──────────────────────────────

const ECHANTILLON = JSON.parse(
  readFileSync(join(__dirname, "..", "fixtures", "otlp-sample-v2.json"), "utf8"),
) as { resourceSpans: Array<Record<string, any>> };

const attr = (key: string, value: string) => ({ key, value: { stringValue: value } });

/**
 * Lot OTLP traces : l'échantillon v2 du SDK (pageview, cinq vitals, deux
 * exceptions, ressource, longtask, fils d'Ariane, événement métier) réécrit pour
 * l'app, la clé et la session du cas, recalé sur T0 — plus une ACTION portant
 * une identité brute, pour que le hachage d'identité soit comparé lui aussi.
 */
function traces(app: App, session: string, n: number) {
  const lot = structuredClone(ECHANTILLON);
  const rs = lot.resourceSpans[0];
  rs.resource.attributes = rs.resource.attributes
    .filter((a: { key: string }) => a.key !== "mip.api_key")
    .map((a: { key: string }) => (a.key === "mip.app_id" ? attr("mip.app_id", app.id) : a));
  if (app.cle) rs.resource.attributes.push(attr("mip.api_key", app.cle));
  const spans = rs.scopeSpans[0].spans as Array<Record<string, any>>;
  const origine = Number(BigInt(spans[0].startTimeUnixNano) / 1_000_000n);
  const prefixe = n.toString(16).padStart(4, "0");
  const traceId = `${prefixe}${"0".repeat(24)}a001`;
  for (const [i, span] of spans.entries()) {
    span.traceId = traceId;
    span.spanId = `${prefixe}${(i + 1).toString(16).padStart(12, "0")}`;
    for (const cle of ["startTimeUnixNano", "endTimeUnixNano"]) {
      span[cle] = nanos(T0 + (Number(BigInt(span[cle]) / 1_000_000n) - origine));
    }
    for (const a of span.attributes) {
      if (a.key === "mip.session_id") a.value = { stringValue: session };
    }
  }
  spans.push({
    traceId,
    spanId: `${prefixe}${"f".repeat(12)}`,
    name: "rum.action",
    kind: 1,
    startTimeUnixNano: nanos(T0 + 5_000),
    endTimeUnixNano: nanos(T0 + 5_000),
    attributes: [
      attr("mip.session_id", session),
      attr("mip.event_type", "action"),
      attr("mip.event_name", "checkout"),
      attr("mip.action_id", `action-${session}`),
      attr("mip.identity.user_id", "alice@example.test"),
    ],
  });
  return lot;
}

/** Lot OTLP logs : un log d'information et une exception backend (P5.3). */
function logs(app: App, session: string, n: number) {
  const ressource = [attr("mip.app_id", app.id), attr("service.name", "billing")];
  if (app.cle) ressource.push(attr("mip.api_key", app.cle));
  const prefixe = n.toString(16).padStart(4, "0");
  return {
    resourceLogs: [{
      resource: { attributes: ressource },
      scopeLogs: [{
        scope: { name: "opentelemetry.sdk._logs" },
        logRecords: [
          {
            timeUnixNano: nanos(T0 + 1_000),
            observedTimeUnixNano: nanos(T0 + 1_010),
            severityNumber: 9,
            severityText: "INFO",
            body: { stringValue: "facture émise" },
            traceId: `${prefixe}${"0".repeat(24)}b001`,
            spanId: `${prefixe}${"0".repeat(11)}1`,
            attributes: [attr("mip.session_id", session), attr("mip.route", "/factures")],
          },
          {
            timeUnixNano: nanos(T0 + 2_000),
            observedTimeUnixNano: nanos(T0 + 2_010),
            severityNumber: 17,
            severityText: "ERROR",
            body: { stringValue: "échec facturation" },
            traceId: `${prefixe}${"0".repeat(24)}b001`,
            spanId: `${prefixe}${"0".repeat(11)}2`,
            attributes: [
              attr("mip.session_id", session),
              attr("exception.type", "ValueError"),
              attr("exception.message", "montant négatif"),
              attr("exception.stacktrace", 'Traceback (most recent call last):\n  File "billing.py", line 42, in emettre\nValueError: montant négatif'),
            ],
          },
        ],
      }],
    }],
  };
}

/** Chunk rrweb gzip, tel que le SDK l'envoie. */
function chunk(evenements = 3) {
  const liste = Array.from({ length: evenements }, (_, i) => ({ type: 3, data: { source: 1, i }, timestamp: T0 + i }));
  return gzipSync(Buffer.from(JSON.stringify(liste)));
}

/**
 * Chunk gzip d'EXACTEMENT `cible` octets — la frontière du plafond de 2 Mio.
 * Niveau 0 (blocs stockés) : la taille compressée suit le brut à quelques octets
 * près, et l'on ajuste le rembourrage jusqu'à tomber juste.
 */
function chunkExact(cible: number) {
  let rembourrage = cible - 256;
  for (let essai = 0; essai < 20; essai++) {
    const brut = Buffer.from(JSON.stringify([{ type: 5, data: { tag: "p", payload: "x".repeat(rembourrage) }, timestamp: T0 }]));
    const gz = gzipSync(brut, { level: 0 });
    if (gz.length === cible) return gz;
    rembourrage += cible - gz.length;
  }
  throw new Error(`chunk de ${cible} octets introuvable`);
}

/** Corps d'upload de source maps (contrat `lireRequeteUpload`). */
function uploadMaps(appId: string, { mappings = "AAAA", release = "1.0.0", sourcesContent }: { mappings?: string; release?: string; sourcesContent?: string } = {}) {
  const map = {
    version: 3,
    sources: ["webpack:///./src/app.ts"],
    names: ["f"],
    mappings,
    ...(sourcesContent ? { sourcesContent: [sourcesContent] } : {}),
  };
  // `filename` nomme le BUNDLE minifié, pas le fichier .map (contrat v71).
  return { appId, release, maps: [{ filename: "app.min.js", content: JSON.stringify(map) }] };
}

// ─────────────────────────────── Transport ─────────────────────────────────

interface Envoi {
  /** Même chemin des deux côtés : l'alias historique pour le collector. */
  chemin: string;
  /**
   * Chemin CANONIQUE du collector (`/v1/*`), à la place de l'alias. ÉCART VOULU
   * de nommage : la console ne sert que `/api/ingest/v1/*` et `/api/sourcemaps`,
   * le collector sert les deux formes (`normaliserChemin`) — même traitement.
   */
  cheminCollector?: string;
  entetes: Record<string, string>;
  corps: Buffer;
  /** Corps en flux, SANS `content-length` (transfert par morceaux). */
  sansLongueur?: boolean;
  /** C11 — la résolution d'un domaine est un GET (sans corps). Défaut : POST. */
  methode?: "GET" | "POST";
}

interface Reponse {
  statut: number;
  retryAfter: string | null;
  corps: unknown;
}

const json = (valeur: unknown, entetes: Record<string, string> = {}): Pick<Envoi, "entetes" | "corps"> => ({
  entetes: { "content-type": "application/json", ...entetes },
  corps: Buffer.from(JSON.stringify(valeur)),
});

const lireJson = (texte: string) => {
  if (!texte) return null;
  try {
    return JSON.parse(texte);
  } catch {
    return { texte };
  }
};

/** Le corps en deux morceaux : ce qu'un client en transfert « chunked » enverrait. */
const moities = (b: Buffer) => [b.subarray(0, b.length >> 1), b.subarray(b.length >> 1)];

/** Côté console : la `Request` web que Next remettrait au handler. */
async function appelerConsole(e: Envoi): Promise<Reponse> {
  const url = `https://mip-rum-console.vercel.app${e.chemin}`;
  const entetes = new Headers(e.entetes);
  // Sur le réseau, le client annonce la longueur ; une `Request` construite en
  // mémoire ne la porte pas d'elle-même. Sans cette ligne, la garde 413 sur
  // longueur annoncée ne serait jamais exercée côté console.
  const lecture = e.methode === "GET";
  if (!e.sansLongueur && !lecture) entetes.set("content-length", String(e.corps.length));
  const corps = e.sansLongueur ? (Readable.toWeb(Readable.from(moities(e.corps))) as ReadableStream) : e.corps;
  const brute = lecture
    ? new Request(url, { method: "GET", headers: entetes })
    : new Request(url, { method: "POST", headers: entetes, body: corps, duplex: "half" } as RequestInit);
  let res: Response;
  const chemin = e.chemin.split("?")[0];
  if (chemin === "/api/extension/resolve") res = await GET_RESOLVE(brute as never);
  else if (chemin === "/api/extension/heartbeat") res = await POST_BATTEMENT(brute as never);
  else if (chemin === "/api/v1/deploys") res = await POST_DEPLOIEMENT(brute);
  else if (e.chemin === "/api/ingest/v1/traces") res = await POST_TRACES(brute);
  else if (e.chemin === "/api/ingest/v1/logs") res = await POST_LOGS(brute);
  else if (e.chemin === "/api/ingest/v1/replay") res = await POST_REPLAY(brute);
  else if (e.chemin === "/api/sourcemaps") {
    // Ce que NextRequest ajoute à la requête web : `nextUrl` et `cookies`.
    const req = Object.assign(brute, { nextUrl: new URL(url), cookies: { get: () => undefined } });
    res = await POST_SOURCEMAPS(req as never);
  } else throw new Error(`chemin sans route console : ${e.chemin}`);
  return { statut: res.status, retryAfter: res.headers.get("retry-after"), corps: lireJson(await res.text()) };
}

/** Côté collector : une vraie requête HTTP, en-têtes maîtrisés. */
function appelerCollector(port: number, e: Envoi): Promise<Reponse> {
  return new Promise((resoudre, rejeter) => {
    const entetes: Record<string, string> = { ...e.entetes };
    const lecture = e.methode === "GET";
    if (!e.sansLongueur && !lecture) entetes["content-length"] = String(e.corps.length);
    const req = requeteHttp(
      { host: "127.0.0.1", port, method: lecture ? "GET" : "POST", path: e.cheminCollector ?? e.chemin, headers: entetes },
      (res) => {
        const morceaux: Buffer[] = [];
        res.on("data", (c: Buffer) => morceaux.push(c));
        res.on("end", () =>
          resoudre({
            statut: res.statusCode ?? 0,
            retryAfter: (res.headers["retry-after"] as string | undefined) ?? null,
            corps: lireJson(Buffer.concat(morceaux).toString("utf8")),
          }));
        res.on("error", rejeter);
      },
    );
    // Un refus AVANT la fin de l'envoi (413 sur longueur annoncée) peut couper
    // la socket sous l'émetteur : ce n'est pas une erreur du cas, la réponse
    // est déjà là (ou arrive).
    let repondu = false;
    req.on("response", () => (repondu = true));
    req.on("error", (err) => {
      if (!repondu) rejeter(err);
    });
    if (lecture) req.end();
    else if (e.sansLongueur) {
      const [debut, fin] = moities(e.corps);
      req.write(debut);
      req.end(fin);
    } else req.end(e.corps);
  });
}

// ─────────────────────────────── Instantané ────────────────────────────────

/** Tables hors comparaison ligne à ligne (voir l'en-tête). */
const TABLES_IGNOREES = new Set(["schema_migration", "rate_counter"]);

/**
 * Colonnes GÉO et HORODATAGES D'ÉCRITURE : ce qu'un côté ne peut pas écrire à
 * l'identique de l'autre, par construction. Chaque entrée dit pourquoi.
 */
const COLONNES_EXCLUES: Record<string, readonly string[]> = {
  // Géo : CDN côté console, bord de confiance + GeoIP côté collector.
  rum_session: ["geo_country", "geo_source", "geo_db_version"],
  // `clock_timestamp()` par défaut : l'instant d'INSERTION, lu par le filigrane
  // des nouvelles erreurs. L'horodatage de l'erreur elle-même (`ts`) est comparé.
  rum_error: ["ingested_at"],
  // `now()` par défaut : quand la ligne a été écrite, pas quand le log a eu lieu
  // (`ts`, comparé).
  rum_log: ["created_at"],
  replay_chunk: ["created_at"],
  // Première apparition d'une route dans le registre : `now()` de l'écriture.
  route_registry: ["first_seen_at"],
  // Date de dépôt d'une map (`now()` et déclencheur de v71) ; empreinte, taille
  // et contenu restent comparés.
  sourcemap: ["created_at", "uploaded_at"],
  // `now()` au moment où le jeton sert.
  sourcemap_upload_token: ["last_used_at"],
  // C11 — `now()` de l'écriture : quand un poste s'est déclaré, quand un marqueur
  // a été inscrit. Le poste, son navigateur, ses applications et l'instant du
  // déploiement (`ts`, donné par le corps) restent comparés.
  extension_install: ["first_seen_at", "last_seen_at"],
  extension_install_app: ["first_seen_at", "last_seen_at"],
  deploy_marker: ["created_at"],
};

type Instantane = Map<string, string[]>;

/** Sérialisation canonique (clés triées) : deux lignes égales s'écrivent pareil. */
function canonique(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonique).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonique(o[k])}`).join(",")}}`;
}

async function instantane(db: pg.Pool, enPlus: Record<string, readonly string[]> = {}): Promise<Instantane> {
  const { rows: colonnes } = await db.query<{ table_name: string; column_name: string; data_type: string }>(
    `select c.table_name, c.column_name, c.data_type
       from information_schema.columns c
       join information_schema.tables t using (table_schema, table_name)
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
      order by 1, 2`,
  );
  const parTable = new Map<string, Array<{ nom: string; type: string }>>();
  for (const c of colonnes) {
    if (TABLES_IGNOREES.has(c.table_name)) continue;
    if (!parTable.has(c.table_name)) parTable.set(c.table_name, []);
    parTable.get(c.table_name)!.push({ nom: c.column_name, type: c.data_type });
  }
  const sortie: Instantane = new Map();
  for (const [table, cols] of parTable) {
    // Un `bytea` (chunk de rejeu : 2 Mio) est comparé par son empreinte, pas
    // relu en hexadécimal à chaque cas.
    const binaires = cols.filter((c) => c.type === "bytea").map((c) => c.nom);
    const selection = binaires.length
      ? `to_jsonb(t) - $1::text[] || jsonb_build_object(${binaires.map((b) => `'${b}_md5', md5(t."${b}")`).join(", ")})`
      : "to_jsonb(t)";
    const { rows } = await db.query<{ j: Record<string, unknown> }>(
      `select ${selection} as j from "${table}" t`,
      binaires.length ? [binaires] : [],
    );
    if (!rows.length) continue;
    const exclues = [...(COLONNES_EXCLUES[table] ?? []), ...(enPlus[table] ?? [])];
    sortie.set(
      table,
      rows
        .map(({ j }) => {
          for (const c of exclues) delete j[c];
          return canonique(j);
        })
        .sort(),
    );
  }
  return sortie;
}

/** Différence de deux multi-ensembles de lignes : [propres à `a`, propres à `b`]. */
function difference(a: readonly string[], b: readonly string[]): [string[], string[]] {
  const reste = new Map<string, number>();
  for (const l of b) reste.set(l, (reste.get(l) ?? 0) + 1);
  const seulA: string[] = [];
  for (const l of a) {
    const n = reste.get(l) ?? 0;
    if (n > 0) reste.set(l, n - 1);
    else seulA.push(l);
  }
  return [seulA, [...reste].flatMap(([l, n]) => Array<string>(n).fill(l))];
}

/**
 * Ce qu'UN envoi a changé dans une base : lignes ajoutées (`+`) et retirées
 * (`-`), table par table — une mise à jour apparaît comme un retrait et un
 * ajout. Comparer des DELTAS, et non l'état complet, isole chaque cas : un
 * écart dans un cas ne fait pas rougir tous les suivants par accumulation.
 *
 * Limite assumée : les identifiants de SÉQUENCE (`rum_error.id`…) restent
 * comparés, parce que des lignes égales doivent se référencer pareil. Après un
 * cas où un seul côté a écrit, les séquences divergent et un cas ULTÉRIEUR qui
 * écrit peut rougir à son tour : lire le PREMIER échec.
 */
function delta(avant: Instantane, apres: Instantane): Instantane {
  const sortie: Instantane = new Map();
  for (const table of new Set([...avant.keys(), ...apres.keys()])) {
    const [ajoutees, retirees] = difference(apres.get(table) ?? [], avant.get(table) ?? []);
    const lignes = [...ajoutees.map((l) => `+ ${l}`), ...retirees.map((l) => `- ${l}`)].sort();
    if (lignes.length) sortie.set(table, lignes);
  }
  return sortie;
}

/** Différence lisible de deux instantanés : table par table, lignes propres à chaque côté. */
function ecarts(console_: Instantane, collector: Instantane): string[] {
  const lignes: string[] = [];
  for (const table of new Set([...console_.keys(), ...collector.keys()])) {
    const a = console_.get(table) ?? [];
    const b = collector.get(table) ?? [];
    const [seulConsole, seulCollector] = difference(a, b);
    if (!seulConsole.length && !seulCollector.length) continue;
    lignes.push(`${table} : ${a.length} ligne(s) console, ${b.length} collector`);
    for (const l of seulConsole.slice(0, 3)) lignes.push(`  console seule   ${l.slice(0, 700)}`);
    for (const l of seulCollector.slice(0, 3)) lignes.push(`  collector seul  ${l.slice(0, 700)}`);
  }
  return lignes;
}

/** Coups de débit comptés par app — indépendant de la minute d'arrivée. */
async function coups(db: pg.Pool): Promise<Map<string, number>> {
  const { rows } = await db.query<{ app_id: string; coups: number }>(
    "select app_id, sum(hits)::int as coups from rate_counter group by 1",
  );
  return new Map(rows.map((r) => [r.app_id, r.coups]));
}

/** Coups ajoutés par UN envoi, par app (même raison que `delta` : pas d'accumulation). */
function coupsAjoutes(avant: Map<string, number>, apres: Map<string, number>) {
  const sortie: Record<string, number> = {};
  for (const [app, n] of apres) if (n !== (avant.get(app) ?? 0)) sortie[app] = n - (avant.get(app) ?? 0);
  return sortie;
}

/** Les deux bases, avant ou après un envoi : lignes et coups de débit. */
async function releve() {
  const [console_, collector, coupsConsole, coupsCollector] = await Promise.all([
    instantane(baseConsole),
    instantane(baseCollector),
    coups(baseConsole),
    coups(baseCollector),
  ]);
  return { console: console_, collector, coupsConsole, coupsCollector };
}

type Releve = Awaited<ReturnType<typeof releve>>;

/** Écarts entre ce que l'envoi a écrit d'un côté et de l'autre (vide = parité). */
function ecartsDuCas(avant: Releve, apres: Releve): string[] {
  return ecarts(delta(avant.console, apres.console), delta(avant.collector, apres.collector));
}

// ─────────────────────────────── Scénario ──────────────────────────────────

/** Tient le verrou d'ingestion d'une app, comme un effacement RGPD en cours. */
async function tenirVerrou(db: pg.Pool, app: string) {
  const client = await db.connect();
  await client.query("begin");
  await client.query("select pg_advisory_xact_lock($1::int4, hashtext($2)::int4)", [VERROU_INGESTION_NS, app]);
  return async () => {
    await client.query("rollback");
    client.release();
  };
}

/**
 * Base injoignable AU MOMENT D'ÉCRIRE : le registre et le compteur de débit ont
 * répondu, puis plus aucune connexion ne s'ouvre. Seule la forme promesse de
 * `connect()` échoue — `pool.query` passe par la forme à rappel, qui reste
 * saine, exactement comme un pooler qui refuse les nouvelles connexions.
 */
function couperConnexions(pool: pg.Pool) {
  const origine = pool.connect.bind(pool);
  const espion = vi.spyOn(pool, "connect").mockImplementation(((rappel?: unknown) => {
    if (typeof rappel === "function") return origine(rappel as never);
    return Promise.reject(Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" }));
  }) as never);
  return async () => espion.mockRestore();
}

type Cote = "console" | "collector";

interface Cas {
  nom: string;
  envoi: Envoi;
  /** Statut attendu, le même des deux côtés. */
  statut: number;
  /** Préparation propre à chaque côté (verrou tenu, base coupée…) ; rend sa remise en état. */
  pendant?: (cote: Cote, base: pg.Pool) => Promise<() => Promise<void>>;
  delai?: number;
}

const SESSION = (n: number) => `parite-session-${n}`;
const DELAI = 30_000;

/** En-têtes d'un chunk de rejeu. */
const rejeu = (session: string, app: App, seq: number) => ({
  "content-type": "application/octet-stream",
  "x-mip-session": session,
  "x-mip-app": app.id,
  "x-mip-seq": String(seq),
  ...(app.cle ? { "x-mip-key": app.cle } : {}),
});

const bearer = (jeton = JETON.jeton) => ({ authorization: `Bearer ${jeton}` });

/** C11 — un battement de poste de l'extension, User-Agent compris (la route l'inscrit). */
const UA_POSTE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const battement = (installId: string, appIds: string[] = [APP.a.id]) => ({
  ...json({ install_id: installId, version: "1.4.0", label: "Parc parité", app_ids: [...appIds, "app-inventee"] }),
  entetes: { "content-type": "application/json", "user-agent": UA_POSTE },
});
const POSTE = "4f1c2b8e-6a3d-4c7e-9b10-2d5e8f7a9c01";
/** C11 — un marqueur de déploiement, à l'instant fixé (T0) pour que les deux côtés écrivent le même. */
const marqueur = (appId: string, version = "2026.09.25") => ({ app_id: appId, version, env: "prod", ts: new Date(T0).toISOString() });

const CAS: Cas[] = [
  // ── 200 nominaux ──────────────────────────────────────────────────────────
  {
    nom: "traces nominales → 200",
    envoi: { chemin: "/api/ingest/v1/traces", ...json(traces(APP.a, SESSION(1), 1)) },
    statut: 200,
  },
  {
    // Côté collector, le chemin CANONIQUE : l'alias et lui mènent au même
    // traitement (écart de nommage voulu, voir `Envoi.cheminCollector`).
    nom: "logs nominaux (dont une exception), /v1/logs côté collector → 200",
    envoi: { chemin: "/api/ingest/v1/logs", cheminCollector: "/v1/logs", ...json(logs(APP.a, SESSION(1), 2)) },
    statut: 200,
  },
  {
    nom: "replay nominal sur une session ancrée → 200",
    envoi: { chemin: "/api/ingest/v1/replay", entetes: rejeu(SESSION(1), APP.a, 0), corps: chunk() },
    statut: 200,
  },
  {
    nom: "rejeu du même lot de traces (idempotence) → 200, rien de plus",
    envoi: { chemin: "/api/ingest/v1/traces", ...json(traces(APP.a, SESSION(1), 1)) },
    statut: 200,
  },
  {
    nom: "replay à EXACTEMENT 2 Mio → 200",
    envoi: { chemin: "/api/ingest/v1/replay", entetes: rejeu(SESSION(1), APP.a, 1), corps: chunkExact(2 * 1024 * 1024) },
    statut: 200,
  },
  // ── 400 ───────────────────────────────────────────────────────────────────
  {
    nom: "traces : corps qui n'est pas du JSON → 400",
    envoi: { chemin: "/api/ingest/v1/traces", entetes: { "content-type": "application/json" }, corps: Buffer.from("{pas du json") },
    statut: 400,
  },
  {
    nom: "logs : corps qui n'est pas du JSON → 400",
    envoi: { chemin: "/api/ingest/v1/logs", entetes: { "content-type": "application/json" }, corps: Buffer.from("[1,") },
    statut: 400,
  },
  {
    // Une BOM UTF-8 en tête : `req.json()` la retirait (décodage WHATWG), le
    // collector non. Les deux lisent désormais les mêmes octets de la même façon
    // (`lireCorpsBorne` + `toString("utf8")`) et refusent. Si l'on veut un jour
    // la tolérer, c'est aux DEUX ports à la fois — ce cas le rappellera.
    nom: "traces : JSON précédé d'une BOM UTF-8 → 400",
    envoi: {
      chemin: "/api/ingest/v1/traces",
      entetes: { "content-type": "application/json" },
      corps: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(traces(APP.a, SESSION(11), 15)))]),
    },
    statut: 400,
  },
  {
    nom: "replay sans x-mip-session → 400",
    envoi: {
      chemin: "/api/ingest/v1/replay",
      entetes: { "x-mip-app": APP.a.id, "x-mip-seq": "9", "x-mip-key": APP.a.cle },
      corps: chunk(),
    },
    statut: 400,
  },
  {
    // Corrigé des DEUX côtés (`lireSequenceReplay`, shared/limits.mjs) :
    // `Number(null)` valait 0, et un chunk sans séquence partait en séquence 0
    // — prenant la place du vrai chunk 0, jeté ensuite par `on conflict`.
    nom: "replay sans x-mip-seq → 400 (plus « séquence 0 »)",
    envoi: {
      chemin: "/api/ingest/v1/replay",
      entetes: { "x-mip-session": SESSION(1), "x-mip-app": APP.a.id, "x-mip-key": APP.a.cle },
      corps: chunk(),
    },
    statut: 400,
  },
  {
    nom: "replay dont x-mip-seq n'est pas décimal (« 1e3 ») → 400",
    envoi: {
      chemin: "/api/ingest/v1/replay",
      entetes: { "x-mip-session": SESSION(1), "x-mip-app": APP.a.id, "x-mip-seq": "1e3", "x-mip-key": APP.a.cle },
      corps: chunk(),
    },
    statut: 400,
  },
  {
    nom: "replay dont x-mip-seq dépasse l'int4 de la colonne → 400 (plus 500)",
    envoi: {
      chemin: "/api/ingest/v1/replay",
      entetes: { "x-mip-session": SESSION(1), "x-mip-app": APP.a.id, "x-mip-seq": "2147483648", "x-mip-key": APP.a.cle },
      corps: chunk(),
    },
    statut: 400,
  },
  {
    nom: "replay dont le corps n'est pas du gzip → 400",
    envoi: { chemin: "/api/ingest/v1/replay", entetes: rejeu(SESSION(1), APP.a, 2), corps: Buffer.from(JSON.stringify([{ type: 3 }])) },
    statut: 400,
  },
  {
    nom: "replay : bombe gzip (33 Mio décompressés, ~33 Kio envoyés) → 400",
    envoi: {
      chemin: "/api/ingest/v1/replay",
      entetes: rejeu(SESSION(1), APP.a, 3),
      corps: gzipSync(Buffer.alloc(33 * 1024 * 1024, 0x20), { level: 9 }),
    },
    statut: 400,
  },
  // ── 403 ───────────────────────────────────────────────────────────────────
  {
    nom: "traces d'une app inconnue → 403",
    envoi: { chemin: "/api/ingest/v1/traces", ...json(traces({ id: "parite-inconnue", cle: "x" }, SESSION(3), 3)) },
    statut: 403,
  },
  {
    nom: "traces avec une clé invalide → 403",
    envoi: { chemin: "/api/ingest/v1/traces", ...json(traces({ id: APP.a.id, cle: "mauvaise-cle" }, SESSION(3), 4)) },
    statut: 403,
  },
  {
    nom: "traces sans clé, sous REQUIRE_API_KEY → 403",
    envoi: { chemin: "/api/ingest/v1/traces", ...json(traces({ id: APP.a.id, cle: null }, SESSION(3), 5)) },
    statut: 403,
  },
  {
    nom: "logs d'une app inconnue → 403",
    envoi: { chemin: "/api/ingest/v1/logs", ...json(logs({ id: "parite-inconnue", cle: "x" }, SESSION(3), 6)) },
    statut: 403,
  },
  {
    nom: "replay avec une clé invalide → 403",
    envoi: { chemin: "/api/ingest/v1/replay", entetes: rejeu(SESSION(1), { id: APP.a.id, cle: "mauvaise-cle" }, 4), corps: chunk() },
    statut: 403,
  },
  {
    nom: "traces d'une app à l'ingestion suspendue (effacement) → 403",
    envoi: { chemin: "/api/ingest/v1/traces", ...json(traces(APP.suspendue, SESSION(4), 7)) },
    statut: 403,
  },
  // ── 409 ───────────────────────────────────────────────────────────────────
  {
    nom: "traces de B revendiquant une session de A → 409",
    envoi: { chemin: "/api/ingest/v1/traces", ...json(traces(APP.b, SESSION(1), 8)) },
    statut: 409,
  },
  {
    nom: "replay de B sur une session de A → 409",
    envoi: { chemin: "/api/ingest/v1/replay", entetes: rejeu(SESSION(1), APP.b, 5), corps: chunk() },
    statut: 409,
  },
  // ── 413 ───────────────────────────────────────────────────────────────────
  {
    nom: "traces au-delà de 2 Mo, longueur annoncée → 413",
    envoi: {
      chemin: "/api/ingest/v1/traces",
      entetes: { "content-type": "application/json" },
      corps: Buffer.from(JSON.stringify(traces(APP.a, SESSION(5), 9)) + " ".repeat(2_000_000)),
    },
    statut: 413,
  },
  {
    nom: "logs au-delà de 2 Mo, longueur annoncée → 413",
    envoi: {
      chemin: "/api/ingest/v1/logs",
      entetes: { "content-type": "application/json" },
      corps: Buffer.from(JSON.stringify(logs(APP.a, SESSION(5), 10)) + " ".repeat(2_000_000)),
    },
    statut: 413,
  },
  {
    nom: "traces au-delà de 2 Mo, en flux SANS longueur annoncée → 413",
    envoi: {
      chemin: "/api/ingest/v1/traces",
      entetes: { "content-type": "application/json" },
      corps: Buffer.from(JSON.stringify(traces(APP.a, SESSION(6), 11)) + " ".repeat(2_000_000)),
      sansLongueur: true,
    },
    statut: 413,
  },
  {
    nom: "replay à 2 Mio + 1 octet → 413",
    envoi: { chemin: "/api/ingest/v1/replay", entetes: rejeu(SESSION(1), APP.a, 6), corps: chunkExact(2 * 1024 * 1024 + 1) },
    statut: 413,
  },
  {
    // La console lisait `req.arrayBuffer()` en entier AVANT de mesurer ; elle
    // lit désormais bornée, comme le collector (`lireCorpsBorne`).
    nom: "replay à 2 Mio + 1 octet, en flux SANS longueur annoncée → 413",
    envoi: { chemin: "/api/ingest/v1/replay", entetes: rejeu(SESSION(1), APP.a, 9), corps: chunkExact(2 * 1024 * 1024 + 1), sansLongueur: true },
    statut: 413,
  },
  {
    nom: "replay au corps vide → 413",
    envoi: { chemin: "/api/ingest/v1/replay", entetes: rejeu(SESSION(1), APP.a, 7), corps: Buffer.alloc(0) },
    statut: 413,
  },
  // ── 425 (barrière de confidentialité en mode enforce) ─────────────────────
  {
    nom: "replay avant son ancre OTLP, app en enforce → 425 + retry-after",
    envoi: { chemin: "/api/ingest/v1/replay", entetes: rejeu(SESSION(7), APP.enforce, 0), corps: chunk() },
    statut: 425,
  },
  // ── 429 ───────────────────────────────────────────────────────────────────
  {
    nom: "traces d'une app au-delà de son débit → 429 + retry-after",
    envoi: { chemin: "/api/ingest/v1/traces", ...json(traces(APP.debit, SESSION(8), 12)) },
    statut: 429,
  },
  {
    nom: "replay d'une app au-delà de son débit → 429 + retry-after",
    envoi: { chemin: "/api/ingest/v1/replay", entetes: rejeu(SESSION(8), APP.debit, 0), corps: chunk() },
    statut: 429,
  },
  // ── 503 ───────────────────────────────────────────────────────────────────
  {
    // La console attend sa stratégie par défaut (5 s × 3 ≈ 15,6 s), le
    // collector son budget (1,5 s × 2 ≈ 3,1 s) : même refus, pas même délai.
    nom: "traces pendant qu'un effacement tient le verrou de l'app → 503 + retry-after",
    envoi: { chemin: "/api/ingest/v1/traces", ...json(traces(APP.verrou, SESSION(9), 13)) },
    statut: 503,
    pendant: (_cote, base) => tenirVerrou(base, APP.verrou.id),
    delai: 60_000,
  },
  // Base injoignable au moment d'écrire : les trois signaux, parce que le
  // correctif (`refusIngestion` ← `estIndisponibilite`) sert les trois routes.
  {
    nom: "traces quand la base refuse toute nouvelle connexion → 503 + retry-after",
    envoi: { chemin: "/api/ingest/v1/traces", ...json(traces(APP.a, SESSION(10), 14)) },
    statut: 503,
    pendant: async (cote) => couperConnexions(cote === "console" ? poolConsole : poolCollector),
  },
  {
    nom: "logs quand la base refuse toute nouvelle connexion → 503 + retry-after",
    envoi: { chemin: "/api/ingest/v1/logs", ...json(logs(APP.a, SESSION(10), 16)) },
    statut: 503,
    pendant: async (cote) => couperConnexions(cote === "console" ? poolConsole : poolCollector),
  },
  {
    nom: "replay quand la base refuse toute nouvelle connexion → 503 + retry-after",
    envoi: { chemin: "/api/ingest/v1/replay", entetes: rejeu(SESSION(1), APP.a, 8), corps: chunk() },
    statut: 503,
    pendant: async (cote) => couperConnexions(cote === "console" ? poolConsole : poolCollector),
  },
  // ── Source maps par jeton (branche jeton de /api/sourcemaps) ──────────────
  {
    nom: "source map par jeton → 200",
    envoi: { chemin: "/api/sourcemaps", ...json(uploadMaps(APP.a.id), bearer()) },
    statut: 200,
  },
  {
    nom: "source map identique renvoyée (idempotence) → 200, rien de plus",
    envoi: { chemin: "/api/sourcemaps", ...json(uploadMaps(APP.a.id), bearer()) },
    statut: 200,
  },
  {
    nom: "source map au contenu différent sous le même nom → 409",
    envoi: { chemin: "/api/sourcemaps", ...json(uploadMaps(APP.a.id, { mappings: "AACA" }), bearer()) },
    statut: 409,
  },
  {
    nom: "source map avec un jeton inconnu → 401",
    envoi: { chemin: "/api/sourcemaps", ...json(uploadMaps(APP.a.id), bearer(`msu_${"1".repeat(32)}_${"2".repeat(64)}`)) },
    statut: 401,
  },
  {
    nom: "source map pour une autre app que celle du jeton → 403",
    envoi: { chemin: "/api/sourcemaps", ...json(uploadMaps(APP.b.id), bearer()) },
    statut: 403,
  },
  {
    nom: "source map : remplacement demandé par un jeton → 403",
    envoi: { chemin: "/api/sourcemaps", ...json({ ...uploadMaps(APP.a.id, { mappings: "AACA" }), replace: true }, bearer()) },
    statut: 403,
  },
  {
    nom: "source map : JSON illisible → 400",
    envoi: { chemin: "/api/sourcemaps", entetes: { "content-type": "application/json", ...bearer() }, corps: Buffer.from("{") },
    statut: 400,
  },
  // ── C11 — les routes machine : l'extension navigateur ────────────────────
  {
    nom: "extension : résolution d'un domaine enregistré → 200",
    envoi: { chemin: `/api/extension/resolve?domain=${DOMAINE_A}`, methode: "GET", entetes: {}, corps: Buffer.alloc(0) },
    statut: 200,
  },
  {
    nom: "extension : domaine non enregistré → 404",
    envoi: { chemin: "/api/extension/resolve?domain=inconnu.exemple.fr", methode: "GET", entetes: {}, corps: Buffer.alloc(0) },
    statut: 404,
  },
  {
    nom: "extension : domaine qui n'a pas la forme d'un nom d'hôte → 400",
    envoi: { chemin: "/api/extension/resolve?domain=pas%20un%20domaine", methode: "GET", entetes: {}, corps: Buffer.alloc(0) },
    statut: 400,
  },
  {
    nom: "extension : battement d'un poste (applications filtrées par le registre) → 200",
    envoi: { chemin: "/api/extension/heartbeat", ...battement(POSTE) },
    statut: 200,
  },
  {
    nom: "extension : second battement du même poste (upsert) → 200",
    envoi: { chemin: "/api/extension/heartbeat", ...battement(POSTE) },
    statut: 200,
  },
  {
    nom: "extension : install_id qui n'est pas un UUID → 400",
    envoi: { chemin: "/api/extension/heartbeat", ...json({ install_id: "poste-42" }) },
    statut: 400,
  },
  {
    nom: "extension : battement de plus de 4 Kio → 413",
    envoi: { chemin: "/api/extension/heartbeat", ...json({ install_id: POSTE, label: "x".repeat(5000) }) },
    statut: 413,
  },
  // ── C11 — les marqueurs de déploiement, au jeton de CI `deploys:write` ────
  {
    nom: "déploiement : marqueur au jeton de CI deploys:write → 201",
    envoi: { chemin: "/api/v1/deploys", ...json(marqueur(APP.a.id), bearer(JETON_DEPLOIEMENT.jeton)) },
    statut: 201,
  },
  {
    nom: "déploiement : jeton de source maps (autre privilège) → 401",
    envoi: { chemin: "/api/v1/deploys", ...json(marqueur(APP.a.id), bearer()) },
    statut: 401,
  },
  {
    nom: "déploiement : pour une autre app que celle du jeton → 403",
    envoi: { chemin: "/api/v1/deploys", ...json(marqueur(APP.b.id), bearer(JETON_DEPLOIEMENT.jeton)) },
    statut: 403,
  },
  {
    nom: "déploiement : sans jeton → 401",
    envoi: { chemin: "/api/v1/deploys", ...json(marqueur(APP.a.id)) },
    statut: 401,
  },
  {
    nom: "déploiement : sans app_id → 400",
    envoi: { chemin: "/api/v1/deploys", ...json({ version: "x" }, bearer(JETON_DEPLOIEMENT.jeton)) },
    statut: 400,
  },
];

// ─────────────────────────────── Exécution ─────────────────────────────────

let baseConsole: pg.Pool;
let baseCollector: pg.Pool;
let poolCollector: pg.Pool;
let serveur: Server | undefined;
let port = 0;

async function envoyerDesDeuxCotes(envoi: Envoi, pendant?: Cas["pendant"]) {
  const remettreConsole = await pendant?.("console", baseConsole);
  let reponseConsole: Reponse;
  try {
    reponseConsole = await appelerConsole(envoi);
  } finally {
    await remettreConsole?.();
  }
  const remettreCollector = await pendant?.("collector", baseCollector);
  let reponseCollector: Reponse;
  try {
    reponseCollector = await appelerCollector(port, envoi);
  } finally {
    await remettreCollector?.();
  }
  return { console: reponseConsole, collector: reponseCollector };
}

suite("contrat de parité — console (routes Next) ↔ collector (creerReceveur)", () => {
  beforeAll(async () => {
    // Pools d'OBSERVATION, distincts de ceux des deux côtés : un cas qui coupe
    // les connexions d'un côté ne doit pas aveugler l'instantané.
    baseConsole = new pg.Pool({ connectionString: ENV.next!, max: 2 });
    baseCollector = new pg.Pool({ connectionString: ENV.collector!, max: 2 });
    for (const base of [baseConsole, baseCollector]) {
      const { rows } = await base.query(
        "select (select count(*) from rum_session) + (select count(*) from app_registry where app_id like 'parite-%') as n",
      );
      if (Number(rows[0].n) !== 0) throw new Error("contrat de parité : la base doit être VIERGE (fraîchement migrée)");
      await amorcer(base);
    }
    expect(ecarts(await instantane(baseConsole), await instantane(baseCollector)), "amorce").toEqual([]);

    poolCollector = new pg.Pool({ connectionString: ENV.collector!, max: 4, application_name: "parite-collector" });
    const muet = { debug() {}, info() {}, warn() {}, error() {} };
    const receveur = creerReceveur(poolCollector, {
      requireApiKey: true,
      rateLimitPerMin: ENV.limite,
      identityHashSecret: ENV.secret,
      nom: "collector",
      log: muet,
      env: {},
    });
    serveur = createServer(receveur.handler);
    await new Promise<void>((r) => serveur!.listen(0, "127.0.0.1", r));
    port = (serveur.address() as { port: number }).port;
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((r) => (serveur ? serveur.close(() => r()) : r()));
    await Promise.all([poolCollector?.end(), baseConsole?.end(), baseCollector?.end(), poolConsole.end()]);
  });

  for (const cas of CAS) {
    it(cas.nom, async () => {
      const avant = await releve();
      const r = await envoyerDesDeuxCotes(cas.envoi, cas.pendant);
      const apres = await releve();
      expect(
        { console: r.console.statut, collector: r.collector.statut },
        JSON.stringify({ console: r.console.corps, collector: r.collector.corps }),
      ).toEqual({ console: cas.statut, collector: cas.statut });
      expect(r.collector.retryAfter, "retry-after").toBe(r.console.retryAfter);
      expect(r.collector.corps, "corps de réponse").toEqual(r.console.corps);
      expect(ecartsDuCas(avant, apres), "lignes écrites par ce cas").toEqual([]);
      expect(coupsAjoutes(avant.coupsCollector, apres.coupsCollector), "coups de débit de ce cas")
        .toEqual(coupsAjoutes(avant.coupsConsole, apres.coupsConsole));
    }, cas.delai ?? DELAI);
  }

  // Les deltas isolent chaque cas ; ce cas-ci prouve en plus qu'après tous les
  // cas de parité, les deux bases sont TOUJOURS identiques, compteurs compris.
  it("après tous les cas de parité : les deux bases sont identiques", async () => {
    const etat = await releve();
    expect(ecarts(etat.console, etat.collector)).toEqual([]);
    expect(Object.fromEntries(etat.coupsCollector)).toEqual(Object.fromEntries(etat.coupsConsole));
  }, DELAI);

  // ─────────────────────────── ÉCARTS VOULUS ──────────────────────────────
  //
  // Chaque cas ci-dessous dit la différence ATTENDUE, la vérifie telle quelle,
  // puis RÉALIGNE ce que l'envoi a écrit et prouve qu'il ne reste rien d'autre :
  // un écart voulu ne doit pas servir de paravent à un écart qui ne l'est pas.
  // (Le nommage des chemins, `/v1/*` servi par le collector seul, est couvert
  // par le cas « logs nominaux » plus haut.)
  describe("écarts voulus", () => {
    it("source map de 5 Mio : 413 console (plafond Vercel 4,5 Mo), 200 collector (port direct, 20 Mio)", async () => {
      // POURQUOI C'EST VOULU. Une fonction Vercel refuse tout corps au-delà de
      // 4,5 Mo : la console borne à 4 Mio et RENVOIE vers le port direct dans son
      // message. Le collector, lui, est ce port direct (`corpsDirect`, 20 Mio).
      const envoi = {
        chemin: "/api/sourcemaps",
        ...json(uploadMaps(APP.a.id, { release: "2.0.0-gros", sourcesContent: "x".repeat(5 * 1024 * 1024) }), bearer()),
      };
      const avant = await releve();
      const r = await envoyerDesDeuxCotes(envoi);
      expect({ console: r.console.statut, collector: r.collector.statut }).toEqual({ console: 413, collector: 200 });
      expect(JSON.stringify(r.console.corps)).toContain("/v1/sourcemaps");
      // Une seule table diffère, d'une seule ligne, côté collector : la map de 5 Mio.
      const ecart = ecartsDuCas(avant, await releve());
      expect(ecart.filter((l) => !l.startsWith("  "))).toEqual(["sourcemap : 0 ligne(s) console, 1 collector"]);
      const gros = (db: pg.Pool) =>
        db.query("select size_bytes from sourcemap where app_id = $1 and release = '2.0.0-gros'", [APP.a.id]);
      expect((await gros(baseConsole)).rows).toEqual([]);
      expect((await gros(baseCollector)).rows[0]?.size_bytes).toBeGreaterThan(5 * 1024 * 1024);
      // Réalignement : la map que seul le collector a acceptée ; plus rien ne diffère.
      await baseCollector.query("delete from sourcemap where app_id = $1 and release = '2.0.0-gros'", [APP.a.id]);
      expect(ecartsDuCas(avant, await releve())).toEqual([]);
    }, DELAI);

    it("upload sans jeton : même 401, pas le même motif (la console essaie la session admin)", async () => {
      // POURQUOI C'EST VOULU. `/api/sourcemaps` de la console a deux portes (jeton
      // de CI OU cookie admin) ; l'alias du collector ne mène qu'à la porte jeton
      // (`normaliserChemin`) — l'admin reste l'affaire de la console. Sans rien,
      // chacun décrit la porte qu'il connaît.
      const avant = await releve();
      const r = await envoyerDesDeuxCotes({ chemin: "/api/sourcemaps", ...json(uploadMaps(APP.a.id)) });
      expect({ console: r.console.statut, collector: r.collector.statut }).toEqual({ console: 401, collector: 401 });
      expect(r.console.corps).toEqual({ error: "session requise" });
      expect(r.collector.corps).toEqual({ error: "jeton d'upload de source maps invalide, expiré ou révoqué" });
      expect(ecartsDuCas(avant, await releve())).toEqual([]);
    }, DELAI);

    it("déploiement au jeton d'API historique : la console l'accepte jusqu'à la fin annoncée (Sunset), le collector le refuse", async () => {
      // POURQUOI C'EST VOULU (C11). Le collector ne lit que les jetons de CI en base
      // (`deploys:write`) ; CONSOLE_API_TOKENS est une variable de Vercel, qu'il n'a
      // pas. La console garde l'ancien chemin pendant une fenêtre DATÉE, et le dit à
      // chaque réponse (`Deprecation`, `Sunset`, RFC 8594).
      const envoi = { chemin: "/api/v1/deploys", ...json(marqueur(APP.a.id, "historique"), bearer("parite-jeton-historique")) };
      const avant = await releve();
      const r = await envoyerDesDeuxCotes(envoi);
      expect({ console: r.console.statut, collector: r.collector.statut }).toEqual({ console: 201, collector: 401 });
      expect(r.collector.corps).toEqual({ error: "jeton de CI « deploys:write » invalide, expiré ou révoqué" });
      const ecart = ecartsDuCas(avant, await releve());
      expect(ecart.filter((l) => !l.startsWith("  "))).toEqual(["deploy_marker : 1 ligne(s) console, 0 collector"]);
      // Réalignement : le marqueur que seule la console a accepté ; plus rien ne diffère.
      await baseConsole.query("delete from deploy_marker where app_id = $1 and version = 'historique'", [APP.a.id]);
      await baseConsole.query("select setval('deploy_marker_id_seq', (select coalesce(max(id), 1) from deploy_marker))");
      expect(ecartsDuCas(avant, await releve())).toEqual([]);
    }, DELAI);

    it("identité : secret VIDE sur Vercel (23/09), posé sur le collector — donnée manquante, jamais incohérente", async () => {
      // POURQUOI C'EST VOULU (plan, P2 « Identité »). `IDENTITY_HASH_SECRET` est
      // vide sur Vercel et y restera : la console RETIRE l'identité, le collector
      // la HACHE. Le même lot laisse donc `user_id_hash` nul d'un côté, haché de
      // l'autre — et RIEN d'autre ne diffère. C'est un écart de CONFIGURATION :
      // à secret égal, tous les cas plus haut prouvent le même hachage.
      const envoi = { chemin: "/api/ingest/v1/traces", ...json(traces(APP.identite, SESSION(20), 20)) };
      const { rows: tables } = await baseConsole.query<{ table_name: string }>(
        "select table_name from information_schema.columns where table_schema = 'public' and column_name = 'user_id_hash'",
      );
      const sansIdentite = Object.fromEntries(tables.map((t) => [t.table_name, ["user_id_hash"]]));
      const sans = async () => ({
        console: await instantane(baseConsole, sansIdentite),
        collector: await instantane(baseCollector, sansIdentite),
      });
      const avant = await releve();
      const avantSans = await sans();
      const secret = process.env.IDENTITY_HASH_SECRET;
      process.env.IDENTITY_HASH_SECRET = "";
      let r: Awaited<ReturnType<typeof envoyerDesDeuxCotes>>;
      try {
        r = await envoyerDesDeuxCotes(envoi);
      } finally {
        process.env.IDENTITY_HASH_SECRET = secret;
      }
      expect({ console: r.console.statut, collector: r.collector.statut }).toEqual({ console: 200, collector: 200 });

      // L'identité de l'action atterrit sur la session (`rum_session.user_id_hash`).
      const lire = (db: pg.Pool) =>
        db.query<{ user_id_hash: string | null }>(
          "select user_id_hash from rum_session where app_id = $1 and session_id = $2",
          [APP.identite.id, SESSION(20)],
        );
      expect((await lire(baseConsole)).rows).toEqual([{ user_id_hash: null }]);
      expect((await lire(baseCollector)).rows[0]?.user_id_hash).toMatch(/^[0-9a-f]{64}$/);

      // Tout le reste est identique : mêmes lignes écrites, `user_id_hash` mis à part.
      const apresSans = await sans();
      expect(ecarts(delta(avantSans.console, apresSans.console), delta(avantSans.collector, apresSans.collector))).toEqual([]);

      // Réalignement : l'identité que seul le collector a hachée ; plus rien ne diffère.
      for (const { table_name: table } of tables) {
        await baseCollector.query(`update "${table}" set user_id_hash = null where app_id = $1`, [APP.identite.id]);
      }
      expect(ecartsDuCas(avant, await releve())).toEqual([]);
    }, DELAI);
  });
});
