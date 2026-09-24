// LE PIPELINE DE console-api : chaque requête passe les mêmes gardes, dans le même ordre.
//
//   1. identifiant de requête et échéance (`x-mip-deadline-ms`, bornée 200–15 000 ms) ;
//   2. SECRET CLIENT, en temps constant : absent ou faux → 404 nu, avant toute
//      lecture. Le service ne se révèle pas à qui ne le connaît pas. Seules la
//      poignée de main et les clés publiques s'en passent (`secretClient: "aucun"`) ;
//   3. tout en-tête `Origin` → 403 : un navigateur en pose toujours un en
//      cross-origin, le serveur de la console jamais. Aucun en-tête CORS n'est
//      jamais émis : ce service n'a pas de client navigateur ;
//   4. route (404 / 405) ;
//   5. session (`Authorization: Bearer`), vérifiée par le service — rôle et
//      périmètre viennent de la BASE (C0c), jamais du jeton seul ;
//   6. démo, rôle, portée — AVANT le traitement : l'app demandée est confrontée
//      au périmètre, `app=all` résolu en périmètre effectif ;
//   7. entrée : requête et corps validés, champ inconnu ou répété refusé (400) ;
//   8. débit par principal (429) ;
//   8 bis. RESSOURCE du chemin (portée `ressource`) : son application lue en
//      base, confrontée au périmètre — 404 si elle n'existe pas OU si elle est
//      ailleurs, indiscernables. Après le débit : c'est la seule garde qui
//      interroge la base pour une requête déjà authentifiée ;
//   9. traitement, sous l'échéance ;
//  10. enveloppe `{ meta: { request_id }, data }`, `no-store`, signée `x-mip-console-api`.
//
// Ce qui n'est PAS ici, à dessein : le processus (sondes, arrêt propre, pool,
// journal d'accès, plafond de corps du serveur) appartient au kit ; ce module ne
// connaît que `Request` et `Response`, et s'appelle tel quel dans les tests.
import {
  ENTETE_CLIENT,
  ENTETE_ECHEANCE,
  ENTETE_REQUETE,
  ENTETE_SERVICE,
  type Probleme,
  type Succes,
} from "@mip/console-contract";
import { egaliteConstante } from "./cles";
import type { Contexte, Journal, Lecteur, Principal } from "./contexte";
import { creerDebit } from "./debit";
import { ErreurContrat } from "./erreurs";
import { verifierTable, type Enregistrement } from "./politique";
import { creerRouteur } from "./routeur";

export interface OptionsConsoleApi {
  readonly table: readonly Enregistrement[];
  /** Le secret client : 1 valeur, ou 2 pendant une rotation. Chacune ≥ 32 caractères. */
  readonly secretsClient: readonly string[];
  readonly journal: Journal;
  /** Vérifie un jeton de session et rend son principal (`creerVerificateurSession`). Absent : aucune opération à session n'est servie. */
  readonly verifierSession?: (jeton: string) => Promise<Principal | null>;
  /** La base, pour résoudre les ressources du chemin (portée `ressource`). Exigée si la table en déclare une. */
  readonly lecteur?: Lecteur;
  /** Appels par minute et par principal, par réplique (défaut 600 ; 0 = sans limite). */
  readonly debitParMinute?: number;
  /** Plafond de corps par défaut, en octets (défaut 64 Kio). */
  readonly corpsMaxDefaut?: number;
  /** Échéance quand l'appelant n'en donne pas (défaut 8 s, le délai de lecture de la console). */
  readonly echeanceDefautMs?: number;
  readonly horloge?: () => number;
  /** Chaque réponse, pour les métriques du service. */
  readonly surReponse?: (m: { operation: string; statut: number; dureeMs: number }) => void;
}

export const ECHEANCE_MIN_MS = 200;
export const ECHEANCE_MAX_MS = 15_000;
const ID_REQUETE = /^[A-Za-z0-9._-]{8,64}$/;
const APP = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ENTIER = /^[1-9][0-9]{0,17}$/;
const METHODES_A_CORPS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const ENTETES_COMMUNS = { "cache-control": "no-store", "x-content-type-options": "nosniff" } as const;

function json(statut: number, corps: unknown, requestId: string, entetes: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...ENTETES_COMMUNS,
      [ENTETE_REQUETE]: requestId,
      [ENTETE_SERVICE]: "1",
      ...entetes,
    },
  });
}

function probleme(e: ErreurContrat, requestId: string): Response {
  const corps: Probleme = {
    meta: { request_id: requestId },
    error: { code: e.code, message: e.message, ...(e.details === undefined ? {} : { details: e.details }) },
  };
  return json(e.statut, corps, requestId, { ...(e.entetes ?? {}) });
}

/** L'échéance demandée, bornée ; défaut si absente ou illisible. */
export function echeanceDemandee(brut: string | null, defaut: number): number {
  if (!brut || !/^\d{1,6}$/.test(brut)) return defaut;
  return Math.min(ECHEANCE_MAX_MS, Math.max(ECHEANCE_MIN_MS, Number(brut)));
}

/** Lit le corps sous plafond, même sans `content-length` (flux découpé). */
async function lireCorps(req: Request, max: number): Promise<string> {
  const annonce = req.headers.get("content-length");
  if (annonce !== null && (!/^\d+$/.test(annonce) || Number(annonce) > max)) {
    throw new ErreurContrat("corps_trop_grand", `corps de plus de ${max} octets`);
  }
  if (!req.body) return "";
  const lecteur = req.body.getReader();
  const morceaux: Uint8Array[] = [];
  let taille = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    taille += value.byteLength;
    if (taille > max) {
      await lecteur.cancel().catch(() => {});
      throw new ErreurContrat("corps_trop_grand", `corps de plus de ${max} octets`);
    }
    morceaux.push(value);
  }
  const tout = new Uint8Array(taille);
  let i = 0;
  for (const m of morceaux) {
    tout.set(m, i);
    i += m.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(tout);
}

/** Les paramètres de requête, un par nom : un nom répété est ambigu, donc refusé. */
function parametres(url: URL): Record<string, string> {
  const sortie: Record<string, string> = {};
  for (const [cle, valeur] of url.searchParams) {
    if (cle in sortie) throw new ErreurContrat("entree_invalide", `paramètre « ${cle} » répété`, { details: { champ: cle } });
    sortie[cle] = valeur;
  }
  return sortie;
}

export function creerConsoleApi(options: OptionsConsoleApi): (req: Request) => Promise<Response> {
  const fautes = verifierTable(options.table);
  if (fautes.length) throw new Error(`table des opérations refusée : ${fautes.join(" ; ")}`);
  const secrets = options.secretsClient;
  if (secrets.length < 1 || secrets.length > 2 || secrets.some((s) => s.length < 32)) {
    throw new Error("secret client : 1 ou 2 valeurs de 32 caractères au moins");
  }
  const lecteur = options.lecteur;
  if (!lecteur && options.table.some((e) => e.politique.portee === "ressource")) {
    throw new Error("la table déclare des ressources du chemin : le pipeline exige `lecteur` pour les résoudre");
  }
  const horloge = options.horloge ?? (() => Date.now());
  const routeur = creerRouteur(options.table);
  const debit = creerDebit({ parMinute: options.debitParMinute ?? 600, horloge });
  const corpsMaxDefaut = options.corpsMaxDefaut ?? 64 * 1024;
  const echeanceDefaut = options.echeanceDefautMs ?? 8_000;
  const journal = options.journal;

  async function secretConnu(presente: string): Promise<boolean> {
    // Les DEUX valeurs sont toujours comparées : le temps ne dit pas laquelle a répondu.
    const verdicts = await Promise.all(secrets.map((s) => egaliteConstante(presente, s)));
    return verdicts.some(Boolean);
  }

  return async function servir(req: Request): Promise<Response> {
    const t0 = horloge();
    const recu = req.headers.get(ENTETE_REQUETE);
    const requestId = recu && ID_REQUETE.test(recu) ? recu : crypto.randomUUID();
    let operationId = "(aucune)";
    const fin = (res: Response): Response => {
      options.surReponse?.({ operation: operationId, statut: res.status, dureeMs: horloge() - t0 });
      return res;
    };

    try {
      const url = new URL(req.url);
      const aiguillage = routeur(req.method, url.pathname);
      const sansSecret = aiguillage.trouve && aiguillage.enregistrement.politique.secretClient === "aucun";

      // 2. Le secret client, avant tout : un 404 NU, indiscernable d'un chemin inconnu.
      if (!sansSecret) {
        const secret = req.headers.get(ENTETE_CLIENT);
        if (!secret || !(await secretConnu(secret))) {
          return fin(new Response(null, { status: 404, headers: { ...ENTETES_COMMUNS } }));
        }
      }

      // 3. Aucun navigateur.
      if (req.headers.has("origin")) {
        throw new ErreurContrat("origine_refusee", "console-api ne sert pas de navigateur : l'appel passe par le serveur de la console");
      }

      // 4. La route.
      if (!aiguillage.trouve) {
        if (aiguillage.statut === 405) {
          throw new ErreurContrat("methode_refusee", "méthode non servie sur ce chemin", { entetes: { allow: aiguillage.permises.join(", ") } });
        }
        throw new ErreurContrat("route_inconnue", "opération inconnue");
      }
      const { enregistrement, params } = aiguillage;
      const { operation, politique } = enregistrement;
      operationId = operation.id;

      // 1 bis. L'échéance : ce qu'il reste à l'appelant, bornée.
      const echeance = t0 + echeanceDemandee(req.headers.get(ENTETE_ECHEANCE), echeanceDefaut);

      // 5. La session.
      let principal: Principal = { kind: "anonyme" };
      if (politique.auth !== "public") {
        const jeton = req.headers.get("authorization")?.match(/^Bearer\s+(\S{16,4096})$/)?.[1];
        if (!jeton) throw new ErreurContrat("session_requise", "session requise");
        if (!options.verifierSession) throw new ErreurContrat("session_requise", "session requise : ce service ne sert pas encore les sessions");
        const verifie = await options.verifierSession(jeton);
        if (!verifie || verifie.kind !== "session") throw new ErreurContrat("session_invalide", "session expirée, révoquée ou inconnue");
        principal = verifie;
      }

      // 6. Démo, rôle, portée.
      if (principal.kind === "session") {
        if (principal.demo && politique.demo === "refus") throw new ErreurContrat("demo_refusee", "action refusée en démonstration");
        if ((politique.auth === "admin" || politique.auth === "admin-plateforme") && principal.role !== "admin") {
          throw new ErreurContrat("role_insuffisant", "réservé aux administrateurs");
        }
        if (politique.auth === "admin-plateforme" && principal.apps !== null) {
          throw new ErreurContrat("role_insuffisant", "réservé aux administrateurs de la plateforme");
        }
      }
      const brut = parametres(url);
      let apps: readonly string[] | null = null;
      if (politique.portee === "app") {
        const demandee = brut.app;
        delete brut.app;
        if (!demandee || !APP.test(demandee)) throw new ErreurContrat("entree_invalide", "paramètre « app » requis", { details: { champ: "app" } });
        // Principal session garanti ici : une opération publique n'a pas de portée (règle de table).
        const perimetre = principal.kind === "session" ? principal.apps : [];
        if (perimetre !== null && perimetre.length === 0) throw new ErreurContrat("hors_perimetre", "aucune application dans votre périmètre");
        if (demandee === "all") apps = perimetre;
        else if (perimetre === null || perimetre.includes(demandee)) apps = [demandee];
        else throw new ErreurContrat("hors_perimetre", "application hors de votre périmètre");
      }

      // 7. L'entrée.
      let requete: unknown = {};
      if (politique.entree?.requete) {
        const v = politique.entree.requete(brut, "requete");
        if (!v.ok) throw new ErreurContrat("entree_invalide", v.error.message, { details: { champ: v.error.champ } });
        requete = v.value;
      } else if (Object.keys(brut).length) {
        const [inconnu] = Object.keys(brut);
        throw new ErreurContrat("entree_invalide", `paramètre « ${inconnu} » inconnu`, { details: { champ: inconnu } });
      }
      let corps: unknown = undefined;
      if (METHODES_A_CORPS.has(req.method)) {
        const texte = await lireCorps(req, politique.corpsMax ?? corpsMaxDefaut);
        if (texte) {
          if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
            throw new ErreurContrat("entree_invalide", "corps JSON attendu (content-type: application/json)");
          }
          try {
            corps = JSON.parse(texte);
          } catch {
            throw new ErreurContrat("entree_invalide", "corps JSON illisible");
          }
        }
        if (politique.entree?.corps) {
          const v = politique.entree.corps(corps, "corps");
          if (!v.ok) throw new ErreurContrat("entree_invalide", v.error.message, { details: { champ: v.error.champ } });
          corps = v.value;
        } else if (corps !== undefined) {
          throw new ErreurContrat("entree_invalide", "cette opération ne prend pas de corps");
        }
      }

      // 8. Le débit.
      const cleDebit = principal.kind === "session" ? `session:${principal.sessionId}` : sansSecret ? "sans-secret" : "client";
      const attente = debit.consommer(cleDebit);
      if (attente !== null) throw new ErreurContrat("debit_depasse", "trop d'appels, réessayer plus tard", { entetes: { "retry-after": String(attente) } });

      // 8 bis. La ressource du chemin : son application, AVANT le traitement.
      if (politique.portee === "ressource" && politique.ressource && lecteur) {
        const r = politique.ressource;
        const id = (params as Record<string, string>)[r.parametre] ?? "";
        const inconnue = () => new ErreurContrat("ressource_inconnue", "ressource inconnue");
        if (!(r.format === "uuid" ? UUID.test(id) : ENTIER.test(id))) throw inconnue();
        const { rows } = await lecteur.query<{ app_id: string | null }>(
          `select app_id from ${r.table} where ${r.colonne ?? "id"} = $1 limit 1`,
          [id],
        );
        const app = rows[0]?.app_id;
        const perimetre = principal.kind === "session" ? principal.apps : [];
        if (!app || (perimetre !== null && !perimetre.includes(app))) throw inconnue();
        apps = [app];
      }

      // 9. Le traitement, sous l'échéance.
      const ctx: Contexte = { requestId, principal, params, requete, corps, echeance, apps, journal };
      const reste = echeance - horloge();
      let minuterie: ReturnType<typeof setTimeout> | undefined;
      const delai = new Promise<never>((_, rejeter) => {
        minuterie = setTimeout(() => rejeter(new ErreurContrat("echeance_depassee", "échéance dépassée")), Math.max(0, reste));
      });
      let resultat: unknown;
      try {
        resultat = await Promise.race([enregistrement.traitement(ctx), delai]);
      } finally {
        clearTimeout(minuterie);
      }

      // 10. L'enveloppe — ou la réponse brute d'un format imposé (JWKS), signée elle aussi.
      if (resultat instanceof Response) {
        const entetes = new Headers(resultat.headers);
        for (const [k, v] of Object.entries(ENTETES_COMMUNS)) if (!entetes.has(k)) entetes.set(k, v);
        entetes.set(ENTETE_REQUETE, requestId);
        entetes.set(ENTETE_SERVICE, "1");
        return fin(new Response(resultat.body, { status: resultat.status, headers: entetes }));
      }
      const succes: Succes<unknown> = { meta: { request_id: requestId }, data: resultat };
      return fin(json(200, succes, requestId));
    } catch (e) {
      if (e instanceof ErreurContrat) {
        if (e.code === "echeance_depassee") journal.warn("échéance dépassée", { operation: operationId, request_id: requestId });
        return fin(probleme(e, requestId));
      }
      // Une PANNE : la pile au journal, un message générique dans la réponse.
      journal.error("traitement en échec", { operation: operationId, request_id: requestId, err: e instanceof Error ? e.stack ?? e.message : String(e) });
      return fin(probleme(new ErreurContrat("erreur_interne", `erreur interne (réf. ${requestId})`), requestId));
    }
  };
}
