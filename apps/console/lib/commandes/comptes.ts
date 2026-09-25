// LES COMPTES DE LA CONSOLE (C9) — `app/admin/users/actions.ts`, l'écran `/admin/users`.
//
// Créer un compte, l'activer ou le désactiver, réinitialiser son mot de passe :
// l'ADMINISTRATEUR DE LA PLATEFORME seul (rôle admin, aucune liste). Un
// administrateur d'une liste créerait sinon un compte aux applications de son
// choix — un administrateur sans liste, par exemple : une élévation de privilège.
//
// Le mot de passe est généré ici (18 caractères URL-safe, ~107 bits), haché
// (bcrypt, coût 10) et RENDU UNE FOIS par la décision de la commande : la console
// l'affiche au seul administrateur qui l'a demandé, et il n'est écrit nulle part en
// clair — ni en base, ni au journal, ni dans l'audit.
//
// DÉSACTIVER OU RÉINITIALISER RÉVOQUE LES SESSIONS du compte (`console_session`,
// migration-v90, quand elle est appliquée) : un compte coupé ne garde pas la
// session qu'il avait ouverte. Un administrateur ne se désactive pas lui-même
// (anti-verrouillage).
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { booleen, chaine, objet, parmi } from "@mip/console-contract";
import { tx } from "../db";
import type { ClientEcriture } from "../requete";
import { commande } from "./commun";

const EMAIL = chaine({ max: 200 });
const FORME_EMAIL = /^[^@\s]+@[^@\s]+$/;

/** 18 caractères URL-safe (~107 bits d'entropie). */
function motDePasse(): string {
  return randomBytes(16).toString("base64url").slice(0, 18);
}

/** « demo-app, gip-plateforme » → ['demo-app', 'gip-plateforme'] ; vide → null (toutes). */
function applications(brut: string): string[] | null {
  const apps = brut
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return apps.length ? apps : null;
}

/** Révoque les sessions ouvertes d'un compte, si la table des sessions existe (migration-v90). */
async function revoquerSessions(c: ClientEcriture, email: string): Promise<number> {
  const { rows } = await c.query("select to_regclass('public.console_session') is not null as v90");
  if (!(rows as { v90: boolean }[])[0]?.v90) return 0;
  const r = await c.query(
    `update console_session set revoked_at = now(), revoked_reason = 'admin'
      where revoked_at is null and user_id = (select id from console_user where email = $1)`,
    [email],
  );
  return (r as { rowCount?: number | null }).rowCount ?? 0;
}

export const creerCompte = commande(
  {
    regle: { auth: "admin-plateforme", portee: "globale", audit: "user.create" },
    corps: objet({ email: EMAIL, role: parmi(["admin", "viewer"] as const), apps: chaine({ min: 0, max: 2000 }) }),
  },
  async ({ corps, auditer }) => {
    const email = corps.email.trim().toLowerCase();
    if (!FORME_EMAIL.test(email)) return { etat: "email_invalide" } as const;
    const apps = applications(corps.apps);
    const clair = motDePasse();
    const hache = await bcrypt.hash(clair, 10);
    const cree = await tx(async (c) => {
      const { rowCount } = await c.query(
        `insert into console_user (email, password_hash, role, apps) values ($1, $2, $3, $4) on conflict (email) do nothing`,
        [email, hache, corps.role, apps],
      );
      if (!rowCount) return false;
      await auditer(c, `${email} role=${corps.role} apps=${apps?.join("|") ?? "toutes"}`);
      return true;
    });
    return cree ? ({ etat: "cree", email, motDePasse: clair } as const) : ({ etat: "existe" } as const);
  },
);

export const activerCompte = commande(
  {
    regle: { auth: "admin-plateforme", portee: "globale", audit: "user.set_active" },
    corps: objet({ email: EMAIL, active: booleen() }),
  },
  async ({ principal, corps, auditer }) => {
    const email = corps.email.trim().toLowerCase();
    // Anti-verrouillage : on ne se désactive pas soi-même.
    if (email === principal.email.toLowerCase() && !corps.active) return { etat: "soi_meme" } as const;
    return tx(async (c) => {
      const { rows } = await c.query<{ active: boolean }>("update console_user set active = $2 where email = $1 returning active", [email, corps.active]);
      if (!rows[0]) return { etat: "introuvable" } as const;
      const revoquees = corps.active ? 0 : await revoquerSessions(c, email);
      await auditer(c, `${email} active=${corps.active}${revoquees ? ` sessions_revoquees=${revoquees}` : ""}`);
      return { etat: "ok" } as const;
    });
  },
);

export const reinitialiserMotDePasse = commande(
  {
    regle: { auth: "admin-plateforme", portee: "globale", audit: "user.reset_password" },
    corps: objet({ email: EMAIL }),
  },
  async ({ corps, auditer }) => {
    const email = corps.email.trim().toLowerCase();
    const clair = motDePasse();
    const hache = await bcrypt.hash(clair, 10);
    const fait = await tx(async (c) => {
      const { rowCount } = await c.query("update console_user set password_hash = $2 where email = $1", [email, hache]);
      if (!rowCount) return false;
      const revoquees = await revoquerSessions(c, email);
      await auditer(c, `${email}${revoquees ? ` sessions_revoquees=${revoquees}` : ""}`);
      return true;
    });
    return fait ? ({ etat: "ok", email, motDePasse: clair } as const) : ({ etat: "introuvable" } as const);
  },
);
