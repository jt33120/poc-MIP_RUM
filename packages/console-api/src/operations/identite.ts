// IDENTITÉ (C1) : ouvrir une session, en ouvrir une de démonstration, la fermer,
// dire qui l'on est — et, depuis le 30/09/2026, s'inscrire.
//
// CE QUI CHANGE PAR RAPPORT À LA CONSOLE D'AUJOURD'HUI (`app/login/actions.ts`) :
//   · une session est une LIGNE en base (`console_session`) : la déconnexion la
//     révoque, un compte désactivé ne passe plus — le jeton seul ne suffit plus ;
//   · les échecs se comptent en base, pour toutes les répliques, et par trois
//     clés (IP + e-mail, IP, e-mail) — plus seulement par instance serverless ;
//   · la démo n'écrit plus l'adresse IP du visiteur dans le journal d'audit.
//
// CE QUI NE CHANGE PAS : refus générique (le message ne dit pas si le compte
// existe) et hachage systématique (un e-mail inconnu coûte le même bcrypt qu'un
// mauvais mot de passe, contre un hachage factice) — ni le texte ni le temps ne
// permettent d'énumérer les comptes.
import {
  chaine,
  CONNEXION,
  DEBUT_SSO,
  DECONNEXION,
  DEMO,
  FIN_SSO,
  identifiantSite,
  INSCRIPTION,
  METHODES,
  MOI,
  objet,
  verifierInscription,
  type SessionOuverte,
} from "@mip/console-contract";
import type { Trousseau } from "../cles";
import type { Contexte, Lecteur, Transacteur } from "../contexte";
import { adresseDeDebit, type DebitAuth } from "../debit-auth";
import { ErreurContrat } from "../erreurs";
import { domaineAutorise, RefusSso, type ConfigOidc, type IdentiteSso, type Oidc } from "../oidc";
import { servir, type Enregistrement } from "../politique";
import { emettreJetonSession } from "../session";

/** Durée d'une session : celle de la console d'aujourd'hui. */
export const DUREE_SESSION_S = 8 * 3600;

export interface DependancesIdentite {
  readonly trousseau: Trousseau;
  readonly db: Lecteur;
  readonly transacteur: Transacteur;
  readonly debit: DebitAuth;
  /** bcrypt, fourni par le service (le paquet reste « Web standard ») ; borné en concurrence ici. */
  readonly verifierMotDePasse: (clair: string, hache: string) => Promise<boolean>;
  /** Un hachage bcrypt valide d'un secret jetable : ce que l'on compare quand le compte n'existe pas. */
  readonly hachageFactice: string;
  /** La démo : son étiquette et son périmètre (`DEMO_USER_EMAIL`, `DEMO_USER_APPS`). `null` : fermée. */
  readonly demo: { readonly email: string; readonly apps: readonly string[] } | null;
  /** Oublier une session du cache du vérificateur (une révocation faite par CETTE réplique). */
  readonly oublierSession: (sid: string) => void;
  /** Hachages bcrypt simultanés au plus (défaut 4) : au-delà, on attend son tour. */
  readonly bcryptSimultanes?: number;
  /** Le SSO (C1c) : `null` s'il n'est pas configuré sur le service. */
  readonly oidc?: { readonly client: Oidc; readonly config: ConfigOidc } | null;
  /** L'inscription en libre-service (migration-v107) : `null` ou absente, fermée (404). */
  readonly inscription?: ReglesInscription | null;
}

/** Les plafonds de l'inscription, et le hachage (bcrypt, fourni par le service). */
export interface ReglesInscription {
  /** Inscriptions admises sur 24 h glissantes, pour toute la plateforme. */
  readonly parJour: number;
  /** Le débit de collecte du site créé, en événements par minute (`app_registry.debit_max_min`). */
  readonly debitMaxMin: number;
  readonly hacherMotDePasse: (clair: string) => Promise<string>;
}

/** `n` octets aléatoires, en hexadécimal. */
const hexAleatoire = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((o) => o.toString(16).padStart(2, "0")).join("");

async function sha256Hex(texte: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte)));
  return [...h].map((o) => o.toString(16).padStart(2, "0")).join("");
}

/** Un sémaphore minimal : bcrypt est coûteux, une rafale ne doit pas saturer la réplique. */
function borner(n: number) {
  let enCours = 0;
  const file: (() => void)[] = [];
  return async function <T>(fn: () => Promise<T>): Promise<T> {
    if (enCours >= n) await new Promise<void>((r) => file.push(r));
    enCours++;
    try {
      return await fn();
    } finally {
      enCours--;
      file.shift()?.();
    }
  };
}

function exigerIp(ctx: Contexte): string {
  if (!ctx.ipVisiteur) {
    // La console la transmet toujours ; son absence est une faute d'appel, pas un
    // visiteur anonyme — sinon tous les appels sans IP partageraient un compteur.
    throw new ErreurContrat("entree_invalide", "adresse du visiteur requise (x-mip-visitor-ip)", { details: { champ: "x-mip-visitor-ip" } });
  }
  return ctx.ipVisiteur;
}

async function refuserSiBloque(d: DependancesIdentite, cles: readonly string[]): Promise<void> {
  const attente = await d.debit.attente(d.db, cles);
  if (attente > 0) {
    throw new ErreurContrat("debit_depasse", "trop de tentatives, réessayer plus tard", { entetes: { "retry-after": String(attente) } });
  }
}

async function ouvrir(
  c: Lecteur,
  ligne: { user_id: string | null; demo_email: string | null; demo_apps: readonly string[] | null },
): Promise<{ id: string; iat: number; exp: number }> {
  const { rows } = await c.query<{ id: string; iat: number; exp: number }>(
    `insert into console_session (user_id, demo, demo_email, demo_apps, expires_at)
     values ($1, $2, $3, $4, now() + make_interval(secs => $5))
     returning id::text, floor(extract(epoch from created_at))::int as iat, floor(extract(epoch from expires_at))::int as exp`,
    [ligne.user_id, ligne.user_id === null, ligne.demo_email, ligne.demo_apps, DUREE_SESSION_S],
  );
  return rows[0];
}

async function auditer(
  c: Lecteur,
  ctx: Contexte,
  a: { email: string | null; action: string; acteur: "user" | "demo"; detail?: string | null; app?: string | null },
) {
  await c.query(
    "insert into audit_log (user_email, action, detail, request_id, actor_kind, app_id) values ($1, $2, $3, $4, $5, $6)",
    [a.email, a.action, a.detail ?? null, ctx.requestId, a.acteur, a.app ?? null],
  );
}

interface CompteSso {
  id: string;
  email: string;
  active: boolean;
  role: "admin" | "viewer";
  apps: string[] | null;
  last_login_at: Date | null;
}

/**
 * Le compte d'une identité SSO, dans la transaction de la connexion.
 *   1. Déjà lié : retrouvé par (émetteur, sujet), jamais plus par l'e-mail.
 *   2. Un compte porte cette adresse : lié seulement s'il a été pré-provisionné
 *      pour le SSO (`password_hash = 'sso:oidc'`, les comptes créés par le SSO
 *      d'avant), ou si l'IdP ATTESTE l'adresse dans un domaine autorisé.
 *   3. Personne : créé (JIT) aux mêmes conditions, sans aucune application tant
 *      qu'un administrateur ou le claim d'applications n'en donne pas.
 * Un compte désactivé LE RESTE (le SSO d'avant le réactivait). L'IdP peut fixer
 * le rôle et la liste d'applications, jamais la portée plateforme (`apps` nul).
 */
async function compteSso(c: Lecteur, id: IdentiteSso, cfg: ConfigOidc): Promise<CompteSso & { lien: "sujet" | "existant" | "cree" }> {
  const colonnes = "id::text, email, active, role, apps, last_login_at";
  const parSujet = await c.query<CompteSso>(`select ${colonnes} from console_user where oidc_iss = $1 and oidc_sub = $2 for update`, [id.iss, id.sub]);
  let compte = parSujet.rows[0];
  let lien: "sujet" | "existant" | "cree" = "sujet";
  if (!compte) {
    if (!id.email) throw new RefusSso("email_absent");
    const atteste = id.emailVerifie && domaineAutorise(id.email, cfg);
    const raisonNonAtteste = id.emailVerifie ? "domaine_non_autorise" : "email_non_verifie";
    const parEmail = await c.query<CompteSso & { pour_sso: boolean; oidc_iss: string | null }>(
      `select ${colonnes}, password_hash = 'sso:oidc' as pour_sso, oidc_iss from console_user where email = $1 for update`,
      [id.email],
    );
    const existant = parEmail.rows[0];
    if (existant) {
      if (existant.oidc_iss !== null) throw new RefusSso("compte_lie_a_un_autre_sujet");
      if (!existant.pour_sso && !atteste) throw new RefusSso(raisonNonAtteste);
      await c.query("update console_user set oidc_iss = $2, oidc_sub = $3 where id = $1", [existant.id, id.iss, id.sub]);
      compte = existant;
      lien = "existant";
    } else {
      if (!atteste) throw new RefusSso(raisonNonAtteste);
      const cree = await c.query<CompteSso>(
        `insert into console_user (email, password_hash, role, apps, active, oidc_iss, oidc_sub)
         values ($1, 'sso:oidc', $2, $3, true, $4, $5) returning ${colonnes}`,
        [id.email, id.role ?? "viewer", id.apps ? [...id.apps] : [], id.iss, id.sub],
      );
      compte = cree.rows[0];
      lien = "cree";
    }
  }
  if (compte.active !== true) throw new RefusSso("compte_desactive");
  const role = id.role ?? compte.role;
  const apps = id.apps !== undefined ? [...id.apps] : compte.apps;
  await c.query("update console_user set role = $2, apps = $3, last_login_at = now() where id = $1", [compte.id, role, apps]);
  return { ...compte, role, apps, lien };
}

export function operationsIdentite(d: DependancesIdentite): Enregistrement[] {
  const bcrypt = borner(d.bcryptSimultanes ?? 4);

  return [
    servir(
      CONNEXION,
      {
        auth: "public",
        portee: "globale",
        demo: "refus",
        audit: "auth.login",
        corpsMax: 4096,
        entree: { corps: objet({ email: chaine({ min: 3, max: 254 }), mot_de_passe: chaine({ min: 1, max: 1024 }) }) },
      },
      async (ctx) => {
        const ip = exigerIp(ctx);
        const email = ctx.corps.email.trim().toLowerCase();
        const cles = {
          ipEmail: await d.debit.cle("ip_email", `${ip}\n${email}`),
          ip: await d.debit.cle("ip", ip),
          email: await d.debit.cle("email", email),
        };
        await refuserSiBloque(d, [cles.ipEmail, cles.ip, cles.email]);

        const { rows } = await d.db.query<{ id: string; email: string; password_hash: string; active: boolean; last_login_at: Date | null }>(
          "select id::text, email, password_hash, active, last_login_at from console_user where email = $1",
          [email],
        );
        const compte = rows[0];
        // TOUJOURS un bcrypt, même sans compte : le temps de réponse ne dit rien.
        const bon = await bcrypt(() => d.verifierMotDePasse(ctx.corps.mot_de_passe, compte?.password_hash ?? d.hachageFactice));
        if (!bon || !compte || compte.active !== true) {
          await d.transacteur.transaction(async (c) => {
            const attentes = [
              await d.debit.compter(c, cles.ipEmail, "ip_email"),
              await d.debit.compter(c, cles.ip, "ip"),
              await d.debit.compter(c, cles.email, "email"),
            ];
            // `login_blocked` : cet échec vient de déclencher un blocage.
            const action = Math.max(...attentes) > 0 ? "auth.login_blocked" : "auth.login_failed";
            await auditer(c, ctx, { email: email.slice(0, 200), action, acteur: "user" });
          });
          throw new ErreurContrat("identifiants_refuses", "e-mail ou mot de passe incorrect");
        }

        const s = await d.transacteur.transaction(async (c) => {
          const ouverte = await ouvrir(c, { user_id: compte.id, demo_email: null, demo_apps: null });
          await c.query("update console_user set last_login_at = now() where id = $1", [compte.id]);
          await d.debit.effacer(c, [cles.ipEmail, cles.email]);
          await auditer(c, ctx, { email: compte.email, action: "auth.login", acteur: "user" });
          return ouverte;
        });
        const reponse: SessionOuverte = {
          jeton: await emettreJetonSession(d.trousseau, { sid: s.id, iat: s.iat, exp: s.exp }),
          expire_le: new Date(s.exp * 1000).toISOString(),
          connexion_precedente: compte.last_login_at ? new Date(compte.last_login_at).toISOString() : null,
        };
        return reponse;
      },
    ),

    servir(DEMO, { auth: "public", portee: "globale", demo: "refus", audit: "auth.demo" }, async (ctx) => {
      // Fermée : l'opération n'existe pas — le même 404 qu'un chemin inconnu.
      if (!d.demo) throw new ErreurContrat("route_inconnue", "opération inconnue");
      const demo = d.demo;
      const cle = await d.debit.cle("demo_ip", exigerIp(ctx));
      await refuserSiBloque(d, [cle]);
      const s = await d.transacteur.transaction(async (c) => {
        await d.debit.compter(c, cle, "demo_ip");
        const ouverte = await ouvrir(c, { user_id: null, demo_email: demo.email, demo_apps: demo.apps });
        // Le périmètre, jamais l'adresse du visiteur (la console d'avant l'écrivait).
        await auditer(c, ctx, { email: demo.email, action: "auth.demo", acteur: "demo", detail: JSON.stringify({ apps: demo.apps }) });
        return ouverte;
      });
      const reponse: SessionOuverte = {
        // `demo: true` dans le jeton : le middleware de la console refuse toute
        // écriture à cette session sans avoir à appeler le service.
        jeton: await emettreJetonSession(d.trousseau, { sid: s.id, iat: s.iat, exp: s.exp, demo: true }),
        expire_le: new Date(s.exp * 1000).toISOString(),
        connexion_precedente: null,
      };
      return reponse;
    }),

    servir(
      INSCRIPTION,
      {
        auth: "public",
        portee: "globale",
        demo: "refus",
        audit: "auth.signup",
        corpsMax: 8192,
        entree: {
          corps: objet({
            email: chaine({ min: 3, max: 254 }),
            mot_de_passe: chaine({ min: 1, max: 1024 }),
            nom_site: chaine({ min: 1, max: 200 }),
            url_site: chaine({ min: 1, max: 2048 }),
          }),
        },
      },
      async (ctx) => {
        // Fermée : l'opération n'existe pas — le même 404 qu'un chemin inconnu, comme la démo.
        if (!d.inscription) throw new ErreurContrat("route_inconnue", "opération inconnue");
        const regles = d.inscription;
        const v = verifierInscription(ctx.corps);
        if (!v.ok) throw new ErreurContrat("entree_invalide", `saisie refusée : ${v.champ}`, { details: { champ: v.champ } });
        const { email, nom, origine } = v.valeur;

        // Trois tentatives par heure et par IP — une IPv6 comptée par son /64
        // (`adresseDeDebit`). Chacune compte, dans sa propre transaction : un refus
        // (adresse déjà inscrite) ne l'annule pas, sans quoi sonder les adresses
        // inscrites serait gratuit.
        const cleIp = await d.debit.cle("inscription_ip", adresseDeDebit(exigerIp(ctx)));
        await refuserSiBloque(d, [cleIp]);
        await d.transacteur.transaction((c) => d.debit.compter(c, cleIp, "inscription_ip"));

        // L'adresse déjà inscrite se dit AVANT le hachage : le 409 la dit de toute
        // façon, inutile de payer un bcrypt pour la dire. Lecture légère, hors verrou ;
        // la vérification qui fait foi reste dans la transaction (deux inscriptions de
        // la même adresse au même instant).
        const deja = await d.db.query("select 1 from console_user where email = $1", [email]);
        if (deja.rows.length) throw new ErreurContrat("conflit", "un compte porte déjà cette adresse");

        const hache = await bcrypt(() => regles.hacherMotDePasse(ctx.corps.mot_de_passe));
        // La clé d'ingestion : le format de la console (`mip_` + 32 hex), dont on ne
        // garde que l'empreinte ; elle n'est rendue qu'ici, une fois.
        const cle = `mip_${hexAleatoire(16)}`;
        const empreinte = await sha256Hex(cle);

        const fait = await d.transacteur.transaction(async (c) => {
          // Une inscription à la fois : le plafond du jour se compte juste.
          await c.query("select pg_advisory_xact_lock(hashtext('mip:inscription'))");
          const jour = await c.query<{ n: number }>("select count(*)::int as n from console_user where inscrit_le > now() - interval '24 hours'");
          if ((jour.rows[0]?.n ?? 0) >= regles.parJour) {
            throw new ErreurContrat("debit_depasse", "les inscriptions du jour sont épuisées, réessayer demain", { entetes: { "retry-after": "3600" } });
          }
          const existant = await c.query("select 1 from console_user where email = $1", [email]);
          if (existant.rows.length) throw new ErreurContrat("conflit", "un compte porte déjà cette adresse");

          // Le site : `mip_identity` n'a que l'INSERT (v107), pas le `on conflict`
          // (qui demande la lecture). Un identifiant déjà pris — improbable, le
          // suffixe est aléatoire — se retente sous un autre suffixe.
          let app: string | null = null;
          for (let essai = 0; essai < 3 && app === null; essai++) {
            const candidat = identifiantSite(nom, hexAleatoire(2));
            await c.query("savepoint site");
            try {
              await c.query(
                `insert into app_registry (app_id, name, api_key_hash, active, allowed_origins, created_by, debit_max_min)
                 values ($1, $2, $3, true, $4, $5, $6)`,
                [candidat, nom, empreinte, [origine], email, regles.debitMaxMin],
              );
              app = candidat;
            } catch (e) {
              if ((e as { code?: string }).code !== "23505") throw e;
              await c.query("rollback to savepoint site");
            }
          }
          if (app === null) throw new ErreurContrat("conflit", "identifiant de site indisponible, réessayer");

          // LECTEUR de son SEUL site (moindre privilège, 30/09/2026) : ni la portée
          // plateforme (`apps` nul), ni l'administration du site — un essai n'a besoin
          // ni de déclarer des domaines à l'extension, ni de réactiver un site, ni de
          // sondes ou de canaux vers des cibles de son choix. La clé, les origines et
          // les domaines restent à la plateforme.
          const cree = await c.query<{ id: string }>(
            `insert into console_user (email, password_hash, role, apps, active, inscrit_le, last_login_at)
             values ($1, $2, 'viewer', $3, true, now(), now()) on conflict (email) do nothing returning id::text`,
            [email, hache, [app]],
          );
          const compte = cree.rows[0];
          if (!compte) throw new ErreurContrat("conflit", "un compte porte déjà cette adresse");
          const s = await ouvrir(c, { user_id: compte.id, demo_email: null, demo_apps: null });
          await auditer(c, ctx, { email, action: "auth.signup", acteur: "user", detail: JSON.stringify({ origine }), app });
          return { s, app };
        });
        return {
          session: {
            jeton: await emettreJetonSession(d.trousseau, { sid: fait.s.id, iat: fait.s.iat, exp: fait.s.exp }),
            expire_le: new Date(fait.s.exp * 1000).toISOString(),
            connexion_precedente: null,
          },
          app: fait.app,
          cle,
        };
      },
    ),

    servir(DECONNEXION, { auth: "session", portee: "globale", demo: "lecture", audit: "auth.logout" }, async (ctx) => {
      if (ctx.principal.kind !== "session") throw new ErreurContrat("session_requise", "session requise");
      const p = ctx.principal;
      const revoquee = await d.transacteur.transaction(async (c) => {
        const { rows } = await c.query(
          "update console_session set revoked_at = now(), revoked_reason = 'logout' where id = $1::uuid and revoked_at is null returning id",
          [p.sessionId],
        );
        await auditer(c, ctx, { email: p.email, action: "auth.logout", acteur: p.demo ? "demo" : "user" });
        return rows.length > 0;
      });
      d.oublierSession(p.sessionId);
      return { revoquee };
    }),

    servir(MOI, { auth: "session", portee: "globale", demo: "lecture" }, async ({ principal: p }) => {
      if (p.kind !== "session") throw new ErreurContrat("session_requise", "session requise");
      return { email: p.email, role: p.role, apps: p.apps, demo: p.demo };
    }),

    servir(METHODES, { auth: "public", portee: "globale", demo: "lecture" }, async () => ({
      mot_de_passe: true as const,
      sso: Boolean(d.oidc),
      demo: d.demo !== null,
      inscription: Boolean(d.inscription),
    })),

    servir(DEBUT_SSO, { auth: "public", portee: "globale", demo: "lecture" }, async () => {
      if (!d.oidc) throw new ErreurContrat("route_inconnue", "opération inconnue");
      try {
        return await d.oidc.client.debut();
      } catch {
        // Découverte injoignable ou détournée : ce n'est pas au visiteur d'en savoir plus.
        throw new ErreurContrat("indisponible", "fournisseur d'identité injoignable");
      }
    }),

    servir(
      FIN_SSO,
      {
        auth: "public",
        portee: "globale",
        demo: "refus",
        audit: "auth.oidc",
        corpsMax: 8192,
        entree: {
          corps: objet({
            code: chaine({ min: 1, max: 2048 }),
            state: chaine({ min: 1, max: 128 }),
            transaction: chaine({ min: 1, max: 4096 }),
          }),
        },
      },
      async (ctx) => {
        if (!d.oidc) throw new ErreurContrat("route_inconnue", "opération inconnue");
        const { client, config } = d.oidc;
        const refuser = async (raison: string, email: string | null): Promise<never> => {
          // La raison au journal d'audit ; au navigateur, le refus générique.
          await d.transacteur.transaction((c) =>
            auditer(c, ctx, { email, action: "auth.oidc_refused", acteur: "user", detail: JSON.stringify({ raison, fournisseur: config.issuer }) }),
          );
          throw new ErreurContrat("identifiants_refuses", "connexion SSO refusée");
        };
        let identite: IdentiteSso;
        try {
          identite = await client.fin(ctx.corps);
        } catch (e) {
          return refuser(e instanceof RefusSso ? e.raison : "echec_idp", null);
        }
        let ouverte: { s: { id: string; iat: number; exp: number }; compte: CompteSso };
        try {
          ouverte = await d.transacteur.transaction(async (c) => {
            const compte = await compteSso(c, identite, config);
            const s = await ouvrir(c, { user_id: compte.id, demo_email: null, demo_apps: null });
            await auditer(c, ctx, {
              email: compte.email,
              action: "auth.oidc",
              acteur: "user",
              detail: JSON.stringify({ fournisseur: identite.iss, lien: compte.lien }),
            });
            return { s, compte };
          });
        } catch (e) {
          if (e instanceof RefusSso) return refuser(e.raison, identite.email);
          throw e;
        }
        const reponse: SessionOuverte = {
          jeton: await emettreJetonSession(d.trousseau, { sid: ouverte.s.id, iat: ouverte.s.iat, exp: ouverte.s.exp }),
          expire_le: new Date(ouverte.s.exp * 1000).toISOString(),
          connexion_precedente: ouverte.compte.last_login_at ? new Date(ouverte.compte.last_login_at).toISOString() : null,
        };
        return reponse;
      },
    ),
  ];
}
