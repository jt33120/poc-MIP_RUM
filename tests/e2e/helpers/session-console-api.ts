// UNE SESSION DE console-api, FABRIQUÉE POUR L'E2E (la bascule).
//
// Une session HS256 forgée avec `AUTH_SECRET` n'existe pas pour console-api : la
// console la sert elle-même, quel que soit l'aiguillage. Pour que le crawl passe par
// le service, il lui faut ce que la connexion produit — une ligne `console_session`
// et un jeton ES256 signé par la clé de l'E2E (`E2E_SESSION_SIGNING_KEYS`, fabriquée
// à l'exécution par playwright.config.ts). Sans passer par le formulaire : pas de
// mot de passe, pas de débit d'authentification, et une démo sans rouvrir
// `DEMO_USER_APPS` (TP9 suppose la démo fermée).
import { createPrivateKey, sign } from "node:crypto";
import type pg from "pg";

export interface ProfilSession {
  readonly email: string;
  readonly role: "admin" | "viewer";
  readonly apps: readonly string[] | null;
  readonly demo?: true;
}

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");

/** Inscrit la session du profil (et son compte, s'il n'est pas une démo) et rend son jeton ES256. */
export async function sessionConsoleApi(pool: pg.Pool, profil: ProfilSession): Promise<string> {
  let sid: string;
  if (profil.demo) {
    ({
      rows: [{ id: sid }],
    } = await pool.query<{ id: string }>(
      `insert into console_session (demo, demo_email, demo_apps, expires_at) values (true, $1, $2, now() + interval '1 day') returning id`,
      [profil.email, profil.apps],
    ));
  } else {
    // Un compte sans mot de passe utilisable : on n'y entre que par ce jeton.
    const {
      rows: [{ id: userId }],
    } = await pool.query<{ id: string }>(
      `insert into console_user (email, password_hash, role, apps, active) values ($1, '!', $2, $3, true)
       on conflict (email) do update set role = excluded.role, apps = excluded.apps, active = true
       returning id`,
      [profil.email, profil.role, profil.apps],
    );
    ({
      rows: [{ id: sid }],
    } = await pool.query<{ id: string }>(`insert into console_session (user_id, expires_at) values ($1, now() + interval '1 day') returning id`, [userId]));
  }
  const jeu = JSON.parse(process.env.E2E_SESSION_SIGNING_KEYS ?? '{"keys":[]}') as { keys: (Record<string, string> & { kid: string })[] };
  const cle = jeu.keys[0];
  if (!cle?.d) throw new Error("E2E_SESSION_SIGNING_KEYS absent : lancer l'E2E par playwright.config.ts");
  const maintenant = Math.floor(Date.now() / 1000);
  const corps = `${b64({ alg: "ES256", typ: "JWT", kid: cle.kid })}.${b64({
    iss: "mip-console-api",
    aud: "mip-console",
    sid,
    iat: maintenant,
    exp: maintenant + 24 * 3600,
    ...(profil.demo ? { demo: true } : {}),
  })}`;
  const signature = sign("sha256", Buffer.from(corps), { key: createPrivateKey({ key: cle, format: "jwk" }), dsaEncoding: "ieee-p1363" });
  return `${corps}.${signature.toString("base64url")}`;
}
