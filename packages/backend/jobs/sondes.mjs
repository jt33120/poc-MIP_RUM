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
// liront. Migration : `packages/db/sql/migration-v99.sql`.
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
export const AGENT_CANARI = "mip-canari/1";
/** Délai total du POST : le relais coupe à 8 s, la marge couvre la réponse. */
export const DELAI_CANARI_MS = 10_000;
/** Seuils de l'écriture C1 (console → relais → collector → base), étude A3 § 2.5. */
export const SEUILS_C1 = Object.freeze({ okMs: 2_000, echecMs: 8_000 });
/** Le registre des clés est mis en cache 60 s par instance (pg-ingest) ; la marge. */
export const GRACE_CLE_MS = 70_000;
/** Défaut de l'alerte d'absence par application, en minutes. */
export const SILENCE_APP_MIN_DEFAUT = 60;
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
 * L'état de la chaîne pour ce passage (A3 § 2.4, point 2, un seul chemin sondé).
 * `null` : rien de sûr (émission sautée), le registre n'est pas touché.
 *
 * @returns {"ok" | "degradee" | "interrompue" | null}
 */
export function etatChaine({ emission, ecriture, chemin = null }) {
  if (emission === "saute" || emission == null) return null;
  if (emission === "echec" || ecriture === "absent") return "interrompue";
  if (emission === "lent" || ecriture === "echec" || chemin === "local") return "degradee";
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
 * @param {{ pool: { query: Function }, url?: string, log?: object, cadenceMin?: number,
 *           silenceMin?: number, fetchImpl?: Function, maintenant?: () => number,
 *           cle?: string }} options
 */
export function creerSondes({
  pool,
  url = URL_CANARI_DEFAUT,
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

  async function envoyer(payload) {
    const debut = maintenant();
    try {
      const res = await fetchImpl(url, {
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
      if (!(await schema())) return { absent: "migration-v99 non appliquée" };
      const passageId = randomUUID();
      const emisA = new Date(maintenant());
      const etatCle = await assurerCle();
      if (etatCle === "absente") {
        courant = { passageId, emisA, ids: null, emission: { resultat: "saute", latence_ms: null, http_status: null, chemin: null, detail: "app mip-canari absente du registre" } };
        return { resultat: "saute", raison: "app absente" };
      }
      const { payload, ids } = construireLotCanari({ passageId, emisA, cle });
      const r = await envoyer(payload);
      let resultat = jugerEmission(r);
      let detail = r.erreur ?? (resultat === "echec" && r.statut != null ? `HTTP ${r.statut}` : null);
      // Une clé réécrite il y a moins d'une minute : le registre en cache chez
      // l'ingestion peut encore porter l'ancienne. Ce refus n'accuse pas la chaîne.
      if (r.statut === 403 && maintenant() - cleEcriteA < GRACE_CLE_MS) {
        resultat = "saute";
        detail = "cle_renouvelee";
      }
      courant = {
        passageId,
        emisA,
        ids,
        emission: { resultat, latence_ms: Math.max(0, Math.round(r.latenceMs)), http_status: r.statut, chemin: r.chemin, detail: court(detail, 200) },
      };
      if (resultat !== "ok") log.warn?.("canari : émission non nominale", { resultat, http_status: r.statut, latence_ms: r.latenceMs, detail });
      return { resultat, http_status: r.statut, latence_ms: courant.emission.latence_ms, cle: etatCle };
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

  async function journaliser(c, ecriture, verifieA) {
    const lignes = [
      ["ingest_console", c.emisA, null, c.emission.resultat, c.emission.latence_ms, c.emission.chemin, c.emission.http_status, c.emission.detail],
      ["ecriture", c.emisA, verifieA, ecriture.resultat, null, null, null, court(ecriture.detail, 200)],
    ];
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
         values ('*', 'chaine', 'interrompue', $1, $2, 'base ou scheduler injoignable : aucun passage journalisé', $3, 'reconstitution')`,
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
    const { rows } = await pool.query(
      `select passage_id,
              bool_or((etage = 'ingest_console' and resultat = 'echec') or (etage = 'ecriture' and resultat = 'absent')) as echec
         from sonde_passage
        where portee = '*' and etage in ('ingest_console', 'ecriture') and emis_at > now() - interval '1 day'
        group by passage_id
        order by max(emis_at) desc
        limit 2`,
    );
    if (rows.length < 2 || !rows.every((r) => r.echec)) return null;
    const msg = `Canari en échec deux passages de suite — la chaîne de mesure (console → relais → collector → base) n'écrit plus. ${preuve ?? ""}`.trim();
    const { rows: ev } = await pool.query("select sonde_alerter($1, $2, 'critical', $3, $4::jsonb) as id", [
      fenetreId,
      APP_CANARI,
      msg,
      JSON.stringify({ kind: "canari_echec", url, text: msg }),
    ]);
    return ev[0]?.id ?? null;
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
      const verifieA = new Date(maintenant());
      const etat = etatChaine({ emission: c.emission.resultat, ecriture: ecriture.resultat, chemin: c.emission.chemin });

      // Le dernier passage AVANT celui-ci, pour la reconstitution.
      const { rows: precedent } = await pool.query(
        "select max(emis_at) as dernier from sonde_passage where etage = 'ingest_console' and portee = '*'",
      );
      await journaliser(c, ecriture, verifieA);

      const preuve = court(
        [
          `passage ${c.passageId}`,
          c.emission.http_status != null ? `HTTP ${c.emission.http_status}` : null,
          c.emission.latence_ms != null ? `${c.emission.latence_ms} ms` : null,
          c.emission.detail,
          ecriture.detail,
        ].filter(Boolean).join(" ; "),
        300,
      );
      const cause =
        etat === "interrompue"
          ? "le canari n'a pas été écrit (console → relais → collector → base)"
          : etat === "degradee"
            ? "canari lent, écrit par le repli local, ou projection manquante"
            : null;
      const reconstitution = planReconstitution({ dernierPassage: precedent[0]?.dernier ?? null, maintenant: c.emisA, cadenceMin });
      const fenetreId = await tenirRegistre({ etat, c, cause, preuve, reconstitution });
      const alerte = etat === "interrompue" ? await alerterSiDeuxEchecs(fenetreId, preuve) : null;

      // L'alerte d'absence par application : muette quand la chaîne elle-même
      // est coupée (sa fenêtre le dit déjà, une fois pour toutes les apps).
      const { rows: silence } = await pool.query("select check_collecte_silence($1, $2) as r", [silenceMin, etat !== "interrompue"]);
      return {
        etat: etat ?? "inconnu",
        emission: c.emission.resultat,
        ecriture: ecriture.resultat,
        reconstitution: Boolean(reconstitution),
        alerte_canari: alerte,
        silence: silence[0]?.r ?? null,
      };
    },
  };

  return { emettre, verifier, empreinte };
}
