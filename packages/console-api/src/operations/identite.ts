// IDENTITÉ (C1) : ouvrir une session, en ouvrir une de démonstration, la fermer,
// dire qui l'on est.
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
import { chaine, CONNEXION, DECONNEXION, DEMO, MOI, objet, type SessionOuverte } from "@mip/console-contract";
import type { Trousseau } from "../cles";
import type { Contexte, Lecteur, Transacteur } from "../contexte";
import type { DebitAuth } from "../debit-auth";
import { ErreurContrat } from "../erreurs";
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

async function auditer(c: Lecteur, ctx: Contexte, a: { email: string | null; action: string; acteur: "user" | "demo"; detail?: string | null }) {
  await c.query(
    "insert into audit_log (user_email, action, detail, request_id, actor_kind) values ($1, $2, $3, $4, $5)",
    [a.email, a.action, a.detail ?? null, ctx.requestId, a.acteur],
  );
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
        jeton: await emettreJetonSession(d.trousseau, { sid: s.id, iat: s.iat, exp: s.exp }),
        expire_le: new Date(s.exp * 1000).toISOString(),
        connexion_precedente: null,
      };
      return reponse;
    }),

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
  ];
}
