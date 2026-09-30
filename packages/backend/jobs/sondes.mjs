// LES SONDES DE LA CHAÎNE DE MESURE — le canari de bout en bout, le journal
// des passages, le registre des fenêtres de collecte et l'alerte d'absence.
//
// POURQUOI. Une coupure de la collecte ne se voyait qu'en regardant un
// graphique vide, des jours plus tard (trous du 24 au 27/09/2026). Désormais,
// chaque tick du scheduler PROUVE que la porte des clients écrit : il envoie un
// lot OTLP synthétique à l'URL PUBLIQUE des capteurs (console Vercel → relais →
// collector → base), puis relit les lignes qu'il doit avoir produites. Le
// verdict est gardé, étage par étage (`sonde_passage`), et les périodes non
// nominales sont tenues dans un registre (`collecte_fenetre`) que les graphiques
// liront. Migration : `packages/db/sql/migration-v103.sql`.
//
// SE GREFFER SUR LE TICK, NE JAMAIS RÉVEILLER LA BASE. Aucune boucle à part :
// l'émission est la PREMIÈRE étape du tick, la vérification la dernière avant la
// livraison, dans la fenêtre où le tick a déjà réveillé Neon.
//
// LA CLÉ. Depuis le 29/09/2026 le collector exige une clé d'API
// (`REQUIRE_API_KEY=true`) et compare `sha256(clé)` à
// `app_registry.api_key_hash`. Aucune clé n'est dans le dépôt, ni dans une
// variable : le scheduler en TIRE une au démarrage, n'en écrit que l'empreinte
// (sur `mip-canari` seulement), et garde le clair en mémoire. Le registre des
// clés est mis en cache 60 s par chaque instance d'ingestion : le premier canari
// qui suit une clé réécrite peut être refusé (403) sans que la chaîne soit en
// cause — il est journalisé `saute`, pas `echec`.
//
// AUCUNE DONNÉE PERSONNELLE. Ni visiteur, ni utilisateur, ni compte, ni texte
// libre, ni rejeu ; URL en `.invalid` (domaine réservé), agent fixe ; jamais
// d'erreur (elle alimenterait les issues et les alertes). Aucun destinataire
// nouveau : Vercel, Railway et Neon sont déjà déclarés.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { safeFetch } from "../lib/net/safe-fetch.mjs";

export const APP_CANARI = "mip-canari";
export const URL_CANARI_DEFAUT = "https://mip-rum-console.vercel.app/api/ingest/v1/traces";
/**
 * C2 : le même lot, en direct sur le domaine public du collector (Railway, déjà
 * déclaré) — la collecte directe (P6b.G) prouvée à part de la console.
 */
export const URL_COLLECTOR_DEFAUT = "https://collector-production-d769.up.railway.app/v1/traces";
export const AGENT_CANARI = "mip-canari/1";
/** Délai total du POST : le relais coupe à 8 s, la marge couvre la réponse. */
export const DELAI_CANARI_MS = 10_000;
/** Seuils de l'écriture C1 (console → relais → collector → base), étude A3 § 2.5. */
export const SEUILS_C1 = Object.freeze({ okMs: 2_000, echecMs: 8_000 });
/** Seuils de l'écriture C2 (collector direct) : son échéance dure est de 4 s. */
export const SEUILS_C2 = Object.freeze({ okMs: 1_500, echecMs: 4_000 });
/** La reconstitution du premier démarrage remonte 30 jours dans `uptime_result`. */
export const JOURS_RECONSTITUTION = 30;
/** Le registre des clés est mis en cache 60 s par instance (pg-ingest) ; la marge. */
export const GRACE_CLE_MS = 70_000;
/** Défaut de l'alerte d'absence par application, en minutes. */
export const SILENCE_APP_MIN_DEFAUT = 60;
/**
 * Une heure d'horloge est HABITUELLE pour une application si elle y a reçu des
 * données au moins 4 des 7 derniers jours (lu dans `rum_rollup_hourly`).
 */
export const HABITUDE = Object.freeze({ jours: 7, minJours: 4 });
/** Les tables où le passage doit avoir laissé sa trace, par clé unique. */
export const TABLES_VERIFIEES = Object.freeze(["rum_session", "rum_pageview", "rum_metric", "rum_span", "rum_event_index"]);
/** Sans elles, rien n'est écrit : la chaîne est interrompue (pas seulement dégradée). */
const TABLES_ESSENTIELLES = new Set(["rum_pageview", "rum_metric"]);
const CHEMINS = new Set(["relais", "local", "direct"]);

const sha256 = (texte) => createHash("sha256").update(texte).digest("hex");

// ═══════════════════════════ Fonctions pures ════════════════════════════════

/** Le trace_id du canari : l'identifiant du passage, en 32 hex. */
export function traceIdDuPassage(passageId) {
  return String(passageId).replace(/-/g, "").toLowerCase();
}

/**
 * Un span_id (16 hex) DÉRIVÉ du passage, du chemin et du rôle : rejouer le même
 * lot est inerte (`on conflict do nothing`), et la vérification sait d'avance
 * quelles clés chercher.
 */
export function idSpan(passageId, chemin, role) {
  return sha256(`${passageId}:${chemin}:${role}`).slice(0, 16);
}

/** `canari-AAAAMMJJHHMM-c1` (UTC) : lisible, et sans rien d'une personne. */
export function sessionCanari(emisA, chemin = "c1") {
  const d = new Date(emisA);
  const p = (n, l = 2) => String(n).padStart(l, "0");
  const horodatage = `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
  return `canari-${horodatage}-${chemin}`;
}

/** Les identifiants d'un passage, ceux que la vérification relira. */
export function idsCanari(passageId, emisA, chemin = "c1") {
  return {
    trace_id: traceIdDuPassage(passageId),
    session_id: sessionCanari(emisA, chemin),
    pageview: idSpan(passageId, chemin, "pageview"),
    vital: idSpan(passageId, chemin, "vital"),
    serveur: idSpan(passageId, chemin, "serveur"),
    vital_uid: `canari-${idSpan(passageId, chemin, "uid")}`,
  };
}

const texte = (key, value) => ({ key, value: { stringValue: String(value) } });
const entier = (key, value) => ({ key, value: { intValue: String(value) } });
const reel = (key, value) => ({ key, value: { doubleValue: value } });

/**
 * Le lot OTLP/HTTP JSON du canari : une page vue, un vital (LCP fixe à
 * 1 000 ms), un span serveur. Quelques centaines d'octets.
 *
 * @param {{ passageId: string, emisA: Date, cle: string, chemin?: string }} p
 * @returns {{ payload: object, ids: ReturnType<typeof idsCanari> }}
 */
export function construireLotCanari({ passageId, emisA, cle, chemin = "c1" }) {
  const ids = idsCanari(passageId, emisA, chemin);
  const ns = String(BigInt(new Date(emisA).getTime()) * 1_000_000n);
  const fin = String(BigInt(new Date(emisA).getTime() + 1) * 1_000_000n);
  const session = texte("mip.session_id", ids.session_id);
  const route = texte("mip.route", "/canari");
  const span = (spanId, name, kind, attributes) => ({
    traceId: ids.trace_id,
    spanId,
    name,
    kind,
    startTimeUnixNano: ns,
    endTimeUnixNano: fin,
    attributes,
  });
  const payload = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            texte("service.name", APP_CANARI),
            texte("mip.app_id", APP_CANARI),
            texte("mip.api_key", cle),
            texte("mip.user_agent", AGENT_CANARI),
          ],
        },
        scopeSpans: [
          {
            scope: { name: APP_CANARI, version: "1" },
            spans: [
              span(ids.pageview, "pageview", 1, [
                session,
                route,
                texte("mip.url", "https://canari.invalid/canari"),
                texte("mip.nav_type", "navigate"),
              ]),
              span(ids.vital, "webvital.LCP", 1, [
                session,
                route,
                texte("webvital.name", "LCP"),
                reel("webvital.value", 1000),
                texte("webvital.id", ids.vital_uid),
              ]),
              span(ids.serveur, "http.server", 2, [
                texte("mip.trace_id", ids.trace_id),
                texte("mip.span_id", ids.serveur),
                route,
                texte("http.method", "GET"),
                entier("http.status_code", 200),
                reel("http.duration_ms", 1),
              ]),
            ],
          },
        ],
      },
    ],
  };
  return { payload, ids };
}

/**
 * Le verdict de l'émission C1. `ok` ≤ 2 s ; `lent` de 2 à 8 s ; `echec` au-delà
 * (délai du relais), sur un statut non 2xx, ou sans réponse.
 */
export function jugerEmission({ statut, latenceMs, erreur = null }, seuils = SEUILS_C1) {
  if (erreur || statut == null) return "echec";
  if (statut < 200 || statut >= 300) return "echec";
  if (latenceMs > seuils.echecMs) return "echec";
  if (latenceMs > seuils.okMs) return "lent";
  return "ok";
}

/**
 * Le verdict de l'écriture, d'après la présence par table. `absent` si une table
 * essentielle manque (page vue, vital) ; `echec` si seule une projection manque
 * (session, span, index) ; `ok` sinon.
 *
 * @param {Record<string, boolean>} presence
 */
export function jugerEcriture(presence) {
  const manquantes = TABLES_VERIFIEES.filter((t) => !presence?.[t]);
  if (!manquantes.length) return { resultat: "ok", manquantes };
  return { resultat: manquantes.some((t) => TABLES_ESSENTIELLES.has(t)) ? "absent" : "echec", manquantes };
}

/**
 * L'état de la chaîne pour ce passage (A3 § 2.4, point 2). Deux chemins : C1
 * (console → relais → collector → base) et C2 (collector direct), chacun jugé
 * par son émission ET son écriture. `interrompue` si TOUS les chemins sondés
 * échouent ; `degradee` si un seul échoue, si l'un est lent, si une projection
 * manque, ou si la console a écrit par son repli local ; `ok` sinon. Un chemin
 * sauté (clé renouvelée) ou absent (`c2` nul) ne compte pas. `null` : rien de
 * sûr, le registre n'est pas touché.
 *
 * @param {{ emission: string|null, ecriture?: string|null, chemin?: string|null,
 *           c2?: { emission: string|null, ecriture?: string|null } | null }} p
 * @returns {"ok" | "degradee" | "interrompue" | null}
 */
export function etatChaine({ emission, ecriture, chemin = null, c2 = null }) {
  const sondes = [{ emission, ecriture }, ...(c2 ? [c2] : [])];
  const chemins = sondes.filter((c) => c.emission != null && c.emission !== "saute");
  if (!chemins.length) return null;
  const echoue = (c) => c.emission === "echec" || c.ecriture === "absent";
  // Un chemin sauté n'a rien prouvé, ni dans un sens ni dans l'autre : l'échec des
  // seuls chemins restants ne suffit pas à dire la chaîne INTERROMPUE (relevé du
  // 30/09/2026 : C1 sauté par le renouvellement de clé au démarrage, C2 en échec,
  // et toute la plateforme hachurée comme coupée).
  if (chemins.every(echoue)) return sondes.some((c) => c.emission === "saute") ? "degradee" : "interrompue";
  if (chemins.some(echoue)) return "degradee";
  if (chemins.some((c) => c.emission === "lent" || c.ecriture === "echec")) return "degradee";
  if (chemin === "local") return "degradee";
  return "ok";
}

/**
 * Ce que le registre doit faire de la fenêtre ouverte, sachant l'état du passage.
 *   ok, pas de fenêtre ............ rien
 *   ok, une fenêtre ouverte ....... la fermer à l'émission de ce passage
 *   même état que la fenêtre ...... la prolonger
 *   autre état .................... fermer l'ancienne, ouvrir la nouvelle
 *
 * @param {{ ouverte: { id: number|string, etat: string } | null, etat: string | null, a: Date,
 *           cause?: string | null, preuve?: string | null }} p
 */
export function planRegistre({ ouverte, etat, a, cause = null, preuve = null }) {
  if (etat == null) return [];
  if (etat === "ok") return ouverte ? [{ op: "fermer", id: ouverte.id, fin: a }] : [];
  if (ouverte && ouverte.etat === etat) return [{ op: "prolonger", id: ouverte.id, preuve }];
  const ops = [];
  if (ouverte) ops.push({ op: "fermer", id: ouverte.id, fin: a });
  ops.push({ op: "ouvrir", etat, debut: a, cause, preuve });
  return ops;
}

/**
 * RECONSTITUER ce qui n'a pas pu s'écrire (A3 § 2.4, point 4). Pendant une
 * coupure de la base, aucun passage ne laisse de ligne. Si le dernier passage
 * journalisé (quel qu'en soit le résultat) est plus vieux que
 * `2 × cadence + 5 min`, le silence entre les deux est une interruption :
 * de `dernier + cadence` à maintenant.
 *
 * @returns {{ debut: Date, fin: Date } | null}
 */
export function planReconstitution({ dernierPassage, maintenant, cadenceMin }) {
  if (!dernierPassage) return null;
  const dernier = new Date(dernierPassage).getTime();
  const fin = new Date(maintenant).getTime();
  const seuil = (2 * cadenceMin + 5) * 60_000;
  if (!(fin - dernier > seuil)) return null;
  return { debut: new Date(dernier + cadenceMin * 60_000), fin: new Date(fin) };
}

/** L'heure d'horloge (0 à 23) d'un instant, dans un fuseau IANA. */
export function heureLocale(instant, fuseau) {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: fuseau, hour: "2-digit", hourCycle: "h23" }).format(new Date(instant)),
  );
}

/**
 * Les heures d'horloge (dans le fuseau) que touche l'intervalle [debut, fin].
 * Un pas d'une heure ne peut pas sauter une heure d'horloge : chacune est vue.
 */
export function heuresTouchees(debut, fin, fuseau) {
  const a = new Date(debut).getTime();
  const b = new Date(fin).getTime();
  const heures = new Set();
  for (let t = a; t < b; t += 3_600_000) heures.add(heureLocale(t, fuseau));
  heures.add(heureLocale(b, fuseau));
  return [...heures];
}

/**
 * L'ALERTE D'ABSENCE : ce qu'il faut faire de la fenêtre `silence` d'une application.
 *
 * Muette depuis `silenceMin` minutes ne suffit pas : une application au trafic
 * de jour se tait chaque soir, et l'alerte de 18 h ruinerait la confiance dans
 * toutes les autres. Le silence est ANORMAL quand chaque heure d'horloge des
 * `silenceMin` DERNIÈRES minutes est une heure habituelle de l'application.
 *
 * Pourquoi la queue du silence, et pas tout le silence : une panne qui commence
 * lundi à 17 h traverse la nuit, heures creuses comprises ; exiger que TOUTES
 * ses heures soient habituelles ne la signalerait jamais. Regarder les
 * dernières minutes la signale mardi à 11 h, quand l'application aurait dû
 * parler — et jamais le soir, quand elle se tait d'habitude.
 *
 * @param {{ dernier: Date|string|null, maintenant: number|Date, silenceMin: number, fuseau: string,
 *           heuresHabituelles: number[], ouverte: boolean, chaineOk?: boolean }} p
 * @returns {{ action: "ouvrir"|"fermer"|"rien", raison?: string, heures?: number[] }}
 */
export function decisionSilence({ dernier, maintenant, silenceMin, fuseau, heuresHabituelles, ouverte, chaineOk = true }) {
  const t = new Date(maintenant).getTime();
  // Jamais de donnée dans l'horizon : rien à juger (une fenêtre ouverte reste ouverte).
  if (dernier == null) return { action: "rien", raison: "aucune donnée récente" };
  const muette = t - new Date(dernier).getTime() >= silenceMin * 60_000;
  if (!muette) return ouverte ? { action: "fermer" } : { action: "rien" };
  // Une alerte par épisode : la fenêtre ouverte l'a déjà levée.
  if (ouverte) return { action: "rien", raison: "épisode en cours" };
  // La chaîne coupée fait taire toutes les apps : sa propre fenêtre le dit.
  if (!chaineOk) return { action: "rien", raison: "chaîne coupée" };
  const habituelles = new Set(heuresHabituelles ?? []);
  const heures = heuresTouchees(t - silenceMin * 60_000, t, fuseau);
  if (!heures.every((h) => habituelles.has(h))) return { action: "rien", raison: "heure creuse", heures };
  return { action: "ouvrir", heures };
}

/** `x-mip-chemin` de la réponse, s'il est posé (relais) — sinon inconnu. */
export function cheminDeReponse(entetes) {
  const brut = typeof entetes?.get === "function" ? entetes.get("x-mip-chemin") : entetes?.["x-mip-chemin"];
  const valeur = typeof brut === "string" ? brut.trim().toLowerCase() : null;
  return valeur && CHEMINS.has(valeur) ? valeur : null;
}

/** Une clé au format des clés de la console (`mip_<32 hex>`). */
export function tirerCle() {
  return `mip_${randomBytes(16).toString("hex")}`;
}

const court = (s, n) => (s == null ? null : String(s).slice(0, n));

// ═══════════════════════════ Le travail du tick ═════════════════════════════

/**
 * Les deux étapes du tick : `emettre` (en tête) et `verifier` (en fin, avant la
 * livraison). Aucune ne lève pour une chaîne en panne : c'est un VERDICT, pas
 * un échec du scheduler — le battement du tick n'en dépend pas. Elles lèvent
 * seulement si la base refuse d'écrire le journal (comme toute autre étape).
 *
 * `urlCollector` : la porte de C2 (collector direct) ; `null` la coupe.
 *
 * @param {{ pool: { query: Function }, url?: string, urlCollector?: string|null, log?: object, cadenceMin?: number,
 *           silenceMin?: number, fetchImpl?: Function, maintenant?: () => number,
 *           cle?: string }} options
 */
export function creerSondes({
  pool,
  url = URL_CANARI_DEFAUT,
  urlCollector = URL_COLLECTOR_DEFAUT,
  log = console,
  cadenceMin = 15,
  silenceMin = SILENCE_APP_MIN_DEFAUT,
  fetchImpl = safeFetch,
  maintenant = Date.now,
  cle: cleImposee = null,
} = {}) {
  // Le clair ne quitte jamais ce processus ; il n'est jamais journalisé.
  const cle = cleImposee ?? tirerCle();
  const empreinte = sha256(cle);
  let cleEcriteA = 0;
  let schemaPresent = false;
  /** La reconstitution depuis `uptime_result` : une fois par processus, réussie. */
  let uptimeReconstitue = false;
  /** Le passage en cours, entre l'émission et la vérification. */
  let courant = null;

  async function schema() {
    if (schemaPresent) return true;
    const { rows } = await pool.query("select to_regclass('public.sonde_passage') is not null as present");
    schemaPresent = Boolean(rows[0]?.present);
    return schemaPresent;
  }

  /** Écrit l'empreinte de NOTRE clé si ce n'est pas elle qui est en base. */
  async function assurerCle() {
    const { rows } = await pool.query(
      `with app as (select 1 from app_registry where app_id = $1),
            maj as (update app_registry set api_key_hash = $2
                     where app_id = $1 and api_key_hash is distinct from $2 returning 1)
       select (select count(*) from app)::int as presente, (select count(*) from maj)::int as ecrite`,
      [APP_CANARI, empreinte],
    );
    if (!rows[0]?.presente) return "absente";
    if (rows[0].ecrite) {
      cleEcriteA = maintenant();
      return "ecrite";
    }
    return "inchangee";
  }

  async function envoyer(cible, payload) {
    const debut = maintenant();
    try {
      const res = await fetchImpl(cible, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": AGENT_CANARI },
        body: JSON.stringify(payload),
        timeoutMs: DELAI_CANARI_MS,
      });
      await res.body?.cancel?.().catch(() => {});
      return { statut: res.status, latenceMs: maintenant() - debut, erreur: null, chemin: cheminDeReponse(res.headers) };
    } catch (err) {
      return { statut: null, latenceMs: maintenant() - debut, erreur: court(err?.name === "TimeoutError" ? "delai" : (err?.code ?? err?.message ?? err), 120), chemin: null };
    }
  }

  const emettre = {
    name: "canari_emettre",
    run: async () => {
      courant = null;
      if (!(await schema())) return { absent: "migration-v103 non appliquée" };
      const passageId = randomUUID();
      const emisA = new Date(maintenant());
      const etatCle = await assurerCle();
      if (etatCle === "absente") {
        courant = { passageId, emisA, ids: null, emission: { resultat: "saute", latence_ms: null, http_status: null, chemin: null, detail: "app mip-canari absente du registre" }, c2: null };
        return { resultat: "saute", raison: "app absente" };
      }
      /** Un chemin : son lot, son envoi, son verdict. */
      const sonder = async (cible, chemin, seuils) => {
        const { payload, ids } = construireLotCanari({ passageId, emisA, cle, chemin });
        const r = await envoyer(cible, payload);
        let resultat = jugerEmission(r, seuils);
        let detail = r.erreur ?? (resultat === "echec" && r.statut != null ? `HTTP ${r.statut}` : null);
        // Une clé réécrite il y a moins d'une minute : le registre en cache chez
        // l'ingestion peut encore porter l'ancienne. Ce refus n'accuse pas la chaîne.
        if (r.statut === 403 && maintenant() - cleEcriteA < GRACE_CLE_MS) {
          resultat = "saute";
          detail = "cle_renouvelee";
        }
        if (resultat !== "ok") log.warn?.("canari : émission non nominale", { chemin, resultat, http_status: r.statut, latence_ms: r.latenceMs, detail });
        return {
          ids,
          emission: {
            resultat,
            latence_ms: Math.max(0, Math.round(r.latenceMs)),
            http_status: r.statut,
            // C2 ne passe par aucun relais : son chemin est connu d'avance.
            chemin: chemin === "c2" ? "direct" : r.chemin,
            detail: court(detail, 200),
          },
        };
      };
      // Les deux chemins partent ensemble : le tick n'attend que le plus lent.
      const [c1, c2] = await Promise.all([
        sonder(url, "c1", SEUILS_C1),
        urlCollector ? sonder(urlCollector, "c2", SEUILS_C2) : Promise.resolve(null),
      ]);
      courant = { passageId, emisA, ids: c1.ids, emission: c1.emission, c2 };
      return {
        resultat: c1.emission.resultat,
        http_status: c1.emission.http_status,
        latence_ms: c1.emission.latence_ms,
        cle: etatCle,
        ...(c2 ? { c2: { resultat: c2.emission.resultat, http_status: c2.emission.http_status, latence_ms: c2.emission.latence_ms } } : {}),
      };
    },
  };

  async function lirePresence(ids) {
    const { rows } = await pool.query(
      `select exists(select 1 from rum_session where app_id = $1 and session_id = $2) as rum_session,
              exists(select 1 from rum_pageview where span_id = $3) as rum_pageview,
              exists(select 1 from rum_metric where span_id = $4) as rum_metric,
              exists(select 1 from rum_span where span_id = $5) as rum_span,
              exists(select 1 from rum_event_index
                      where app_id = $1 and kind = 'pageview' and source_span_id = $3) as rum_event_index`,
      [APP_CANARI, ids.session_id, ids.pageview, ids.vital, ids.serveur],
    );
    return rows[0] ?? {};
  }

  /**
   * `ingest_console` (émission C1), `ecriture` (les lignes de C1) et, si C2 est
   * sondé, `ingest_collector` : l'étage 4 prouve que la collecte directe ÉCRIT,
   * son verdict porte donc aussi ses lignes (`absent` si elles manquent).
   */
  async function journaliser(c, ecriture, verifieA, c2) {
    const lignes = [
      ["ingest_console", c.emisA, null, c.emission.resultat, c.emission.latence_ms, c.emission.chemin, c.emission.http_status, c.emission.detail],
      ["ecriture", c.emisA, verifieA, ecriture.resultat, null, null, null, court(ecriture.detail, 200)],
    ];
    if (c2) {
      lignes.push(["ingest_collector", c.emisA, verifieA, c2.resultat, c2.latence_ms, "direct", c2.http_status, court(c2.detail, 200)]);
    }
    const valeurs = [];
    const params = [c.passageId];
    for (const l of lignes) {
      const base = params.length;
      params.push(...l);
      valeurs.push(`($1, $${base + 1}, '*', $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`);
    }
    await pool.query(
      `insert into sonde_passage (passage_id, etage, portee, emis_at, verifie_at, resultat, latence_ms, chemin, http_status, detail)
       values ${valeurs.join(", ")}
       on conflict (passage_id, etage, portee) do nothing`,
      params,
    );
  }

  async function tenirRegistre({ etat, c, cause, preuve, reconstitution }) {
    const lire = async () =>
      (await pool.query(
        "select id, etat, debut from collecte_fenetre where portee = '*' and etage = 'chaine' and fin is null",
      )).rows[0] ?? null;
    let ouverte = await lire();
    if (reconstitution) {
      // L'ancienne fenêtre ne peut pas courir à travers le silence : elle
      // s'arrête où la reconstitution commence.
      if (ouverte) {
        await pool.query(
          "update collecte_fenetre set fin = greatest($2::timestamptz, debut + interval '1 millisecond'), updated_at = now() where id = $1 and fin is null",
          [ouverte.id, reconstitution.debut],
        );
        ouverte = null;
      }
      await pool.query(
        `insert into collecte_fenetre (portee, etage, etat, debut, fin, cause, preuve, source)
         values ('*', 'chaine', 'interrompue', $1, $2, 'base ou scheduler injoignable : aucun passage journalisé', $3, 'reconstitution')
         on conflict (portee, etage, debut) where source <> 'sonde' do nothing`,
        [reconstitution.debut, reconstitution.fin, court(`aucune ligne de sonde entre deux passages ; reprise au passage ${c.passageId}`, 300)],
      );
    }
    let fenetreId = null;
    for (const op of planRegistre({ ouverte, etat, a: c.emisA, cause, preuve })) {
      if (op.op === "fermer") {
        await pool.query(
          "update collecte_fenetre set fin = greatest($2::timestamptz, debut + interval '1 millisecond'), updated_at = now() where id = $1 and fin is null",
          [op.id, op.fin],
        );
      } else if (op.op === "prolonger") {
        await pool.query("update collecte_fenetre set updated_at = now(), preuve = coalesce($2, preuve) where id = $1", [op.id, court(op.preuve, 300)]);
        fenetreId = op.id;
      } else if (op.op === "ouvrir") {
        const { rows } = await pool.query(
          `insert into collecte_fenetre (portee, etage, etat, debut, cause, preuve, source)
           values ('*', 'chaine', $1, $2, $3, $4, 'sonde')
           on conflict (portee, etage) where fin is null do nothing
           returning id`,
          [op.etat, op.debut, court(op.cause, 120), court(op.preuve, 300)],
        );
        fenetreId = rows[0]?.id ?? (await lire())?.id ?? null;
      }
    }
    return fenetreId;
  }

  /** Deux passages de suite où rien ne s'est écrit : une alerte, une seule par épisode. */
  async function alerterSiDeuxEchecs(fenetreId, preuve) {
    if (fenetreId == null) return null;
    // Un passage est en échec quand C1 échoue ET que C2, s'il a été sondé, aussi.
    const { rows } = await pool.query(
      `select passage_id,
              bool_or((etage = 'ingest_console' and resultat = 'echec') or (etage = 'ecriture' and resultat = 'absent'))
                and (not bool_or(etage = 'ingest_collector')
                     or bool_or(etage = 'ingest_collector' and resultat in ('echec', 'absent'))) as echec
         from sonde_passage
        where portee = '*' and etage in ('ingest_console', 'ecriture', 'ingest_collector') and emis_at > now() - interval '1 day'
        group by passage_id
        order by max(emis_at) desc
        limit 2`,
    );
    if (rows.length < 2 || !rows.every((r) => r.echec)) return null;
    const msg = `Canari en échec deux passages de suite — ni la console ni le collector n'écrivent plus la mesure. ${preuve ?? ""}`.trim();
    const { rows: ev } = await pool.query("select sonde_alerter($1, $2, 'critical', $3, $4::jsonb) as id", [
      fenetreId,
      APP_CANARI,
      msg,
      JSON.stringify({ kind: "canari_echec", url, url_collector: urlCollector, text: msg }),
    ]);
    return ev[0]?.id ?? null;
  }

  /**
   * Les faits en UNE requête (`sonde_etat_silence` : dernière donnée, heures
   * habituelles, fenêtre ouverte), la décision ici (`decisionSilence`), une
   * écriture seulement quand une fenêtre s'ouvre ou se ferme.
   */
  async function traiterSilences(chaineOk) {
    const { rows } = await pool.query("select * from sonde_etat_silence($1, $2)", [HABITUDE.jours, HABITUDE.minJours]);
    const bilan = { ouvertes: 0, fermees: 0, alertes: 0, heures_creuses: 0 };
    const t = maintenant();
    for (const app of rows) {
      const d = decisionSilence({
        dernier: app.dernier,
        maintenant: t,
        silenceMin,
        fuseau: app.fuseau || "Europe/Paris",
        heuresHabituelles: app.heures_habituelles,
        ouverte: app.fenetre_id != null,
        chaineOk,
      });
      if (d.action === "fermer") {
        const { rows: r } = await pool.query("select sonde_fermer_silence($1) as ok", [app.fenetre_id]);
        if (r[0]?.ok) bilan.fermees++;
      } else if (d.action === "ouvrir") {
        const { rows: r } = await pool.query("select sonde_ouvrir_silence($1, $2, $3, $4::int[]) as alerte", [
          app.app_id,
          app.dernier,
          silenceMin,
          d.heures,
        ]);
        // NULL : une fenêtre était déjà ouverte (autre instance) — rien de levé.
        if (r[0]?.alerte != null) {
          bilan.ouvertes++;
          bilan.alertes++;
        }
      } else if (d.raison === "heure creuse") {
        bilan.heures_creuses++;
      }
    }
    return bilan;
  }

  /**
   * PREMIER DÉMARRAGE (A3 § 2.4, point 5) : les 30 jours d'avant le journal,
   * lus dans `uptime_result` par la base (`sonde_reconstituer_uptime`,
   * rejouable). Une fois par processus ; un échec se retente au tick suivant
   * sans faire échouer celui-ci. Rend le nombre de fenêtres posées, ou null.
   */
  async function reconstituerUptime() {
    if (uptimeReconstitue) return null;
    try {
      const { rows } = await pool.query("select sonde_reconstituer_uptime($1, $2) as n", [JOURS_RECONSTITUTION, cadenceMin]);
      uptimeReconstitue = true;
      const n = Number(rows[0]?.n ?? 0);
      if (n > 0) log.info?.("sondes : fenêtres reconstituées depuis uptime_result", { fenetres: n });
      return n;
    } catch (err) {
      log.warn?.("sondes : reconstitution depuis uptime_result en échec", { err: court(err?.message ?? err, 200) });
      return null;
    }
  }

  const verifier = {
    name: "canari_verifier",
    run: async () => {
      const c = courant;
      courant = null;
      if (!c) return { absent: "aucune émission à vérifier" };
      let ecriture;
      if (c.emission.resultat === "saute" || !c.ids) {
        ecriture = { resultat: "saute", detail: null };
      } else {
        const juge = jugerEcriture(await lirePresence(c.ids));
        ecriture = { resultat: juge.resultat, detail: juge.manquantes.length ? `manque : ${juge.manquantes.join(", ")}` : null };
      }
      // C2 : ses lignes ne se relisent que si le collector a répondu 2xx.
      let c2 = null;
      if (c.c2) {
        const e = c.c2.emission;
        const juge = e.resultat === "ok" || e.resultat === "lent" ? jugerEcriture(await lirePresence(c.c2.ids)) : null;
        c2 = {
          ...e,
          emission: e.resultat,
          ecriture: juge?.resultat ?? null,
          resultat: juge?.resultat === "absent" ? "absent" : e.resultat,
          detail: juge?.manquantes.length ? `manque : ${juge.manquantes.join(", ")}` : e.detail,
        };
      }
      const verifieA = new Date(maintenant());
      const etat = etatChaine({
        emission: c.emission.resultat,
        ecriture: ecriture.resultat,
        chemin: c.emission.chemin,
        c2: c2 ? { emission: c2.emission, ecriture: c2.ecriture } : null,
      });

      // Le dernier passage AVANT celui-ci, pour la reconstitution.
      const { rows: precedent } = await pool.query(
        "select max(emis_at) as dernier from sonde_passage where etage = 'ingest_console' and portee = '*'",
      );
      await journaliser(c, ecriture, verifieA, c2);
      const reconstitueUptime = await reconstituerUptime();

      const preuve = court(
        [
          `passage ${c.passageId}`,
          c.emission.http_status != null ? `HTTP ${c.emission.http_status}` : null,
          c.emission.latence_ms != null ? `${c.emission.latence_ms} ms` : null,
          c.emission.detail,
          ecriture.detail,
          c2 ? `C2 ${c2.resultat}${c2.http_status != null ? ` HTTP ${c2.http_status}` : ""}${c2.latence_ms != null ? ` ${c2.latence_ms} ms` : ""}` : null,
        ].filter(Boolean).join(" ; "),
        300,
      );
      const c1Echoue = c.emission.resultat === "echec" || ecriture.resultat === "absent";
      const c2Echoue = c2 != null && (c2.resultat === "echec" || c2.resultat === "absent");
      const cause =
        etat === "interrompue"
          ? c2
            ? "le canari n'a été écrit ni par la console ni par le collector"
            : "le canari n'a pas été écrit (console → relais → collector → base)"
          : etat === "degradee"
            ? c1Echoue
              ? "chemin console en échec, collecte directe en service"
              : c2Echoue
                ? "collecte directe (collector) en échec, chemin console en service"
                : "canari lent, écrit par le repli local, ou projection manquante"
            : null;
      const reconstitution = planReconstitution({ dernierPassage: precedent[0]?.dernier ?? null, maintenant: c.emisA, cadenceMin });
      const fenetreId = await tenirRegistre({ etat, c, cause, preuve, reconstitution });
      const alerte = etat === "interrompue" ? await alerterSiDeuxEchecs(fenetreId, preuve) : null;

      // L'alerte d'absence par application : muette quand la chaîne elle-même
      // est coupée (sa fenêtre le dit déjà, une fois pour toutes les apps).
      const silence = await traiterSilences(etat !== "interrompue");
      return {
        etat: etat ?? "inconnu",
        emission: c.emission.resultat,
        ecriture: ecriture.resultat,
        ...(c2 ? { collector: c2.resultat } : {}),
        reconstitution: Boolean(reconstitution),
        reconstitution_uptime: reconstitueUptime,
        alerte_canari: alerte,
        silence,
      };
    },
  };

  return { emettre, verifier, traiterSilences, empreinte };
}
