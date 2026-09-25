// LA BASCULE VERS console-api (après P6b) : pour chaque écran et chaque écriture,
// qui sert — console-api, ou la console elle-même, comme avant ?
//
// SERVEUR SEULEMENT (il lit l'environnement et, par `platform-flag`, la base).
//
// Dans cet ordre, le premier « non » garde le chemin LOCAL, inchangé :
//   1. console-api branché (`lib/backend.ts` : les trois variables Vercel) ;
//   2. une session de console-api — un jeton ES256. Un jeton HS256 (signé par la
//      console avec `AUTH_SECRET`) n'existe pas pour le service : il reste local
//      jusqu'à son expiration, ou jusqu'au retrait d'`AUTH_SECRET` ;
//   3. le jeton se vérifie (clé PUBLIQUE, sans appel) ;
//   4. disjoncteur fermé ;
//   5. le tirage : la session tombe dans la part servie par console-api
//      (`platform_flag.console_api_ecrans_pct` pour les lectures,
//      `console_api_commandes_pct` pour les écritures ; cache 30 s ; défauts
//      `CONSOLE_API_ECRANS_PCT` / `CONSOLE_API_COMMANDES_PCT`, 0). Le tirage est
//      STABLE par session (empreinte de son identifiant) : 10 % veut dire un
//      dixième des sessions, toujours les mêmes — pas un rendu sur dix.
//
// LE MODE STRICT (`CONSOLE_API_STRICT=1`, après le rodage à 100 %) : toute session
// de console-api est servie par le service, le tirage et le disjoncteur sont
// ignorés, et AUCUN échec ne retombe sur la base — c'est ce qui permet ensuite de
// retirer la base de Vercel (C12). Sans console-api branché, le mode strict ne
// peut rien servir : il est ignoré et le journal le dit.
//
// Le geste d'urgence : `update platform_flag set value = '0' where key = 'console_api_ecrans_pct'`
// (ou `…_commandes_pct`), effectif en 30 s.
import { createLogger } from "./journal";

export type Famille = "ecrans" | "commandes";

/** Pourquoi la console sert elle-même. */
export type RaisonLocale = "non_branche" | "sans_session" | "session_locale" | "disjoncteur" | "tirage";

export type Voie =
  | { readonly distante: true; readonly jeton: string; readonly strict: boolean }
  | { readonly distante: false; readonly raison: RaisonLocale; readonly strict: boolean };

/** Disjoncteur par famille et par instance : 5 échecs en 30 s → la console sert seule pendant 60 s. */
export const DISJONCTEUR = Object.freeze({ fenetreMs: 30_000, echecsMax: 5, coupureMs: 60_000 });

/** Le seau (0 à 99) d'une session : les 32 premiers bits du SHA-256 de son identifiant. */
export async function seauDe(sid: string): Promise<number> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sid)));
  return (((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0) % 100;
}

type Journal = { warn: (m: string, c?: Record<string, unknown>) => void; error: (m: string, c?: Record<string, unknown>) => void };

export function creerAiguillage(deps: {
  env?: () => Record<string, string | undefined>;
  /** console-api est-il branché ? (`backend().estBranche`). */
  branche: () => boolean;
  /** L'algorithme annoncé par le jeton, sans vérification (`algorithmeDuJeton`). */
  algorithme: (jeton: string) => string | null;
  /** La signature ES256 du jeton : son identifiant de session, ou `null`. */
  verifier: (jeton: string) => Promise<{ readonly sid: string } | null>;
  pourcentage: (famille: Famille) => Promise<number>;
  maintenant?: () => number;
  journal?: Journal;
}) {
  const env = deps.env ?? (() => process.env);
  const maintenant = deps.maintenant ?? Date.now;
  const journal: Journal = deps.journal ?? createLogger("aiguillage-console-api");
  const disjoncteurs: Record<Famille, { echecs: number[]; coupeJusqua: number }> = {
    ecrans: { echecs: [], coupeJusqua: 0 },
    commandes: { echecs: [], coupeJusqua: 0 },
  };
  let strictSansBrancheSignale = false;

  async function voie(famille: Famille, jeton: string | null): Promise<Voie> {
    const strict = env().CONSOLE_API_STRICT === "1";
    if (!deps.branche()) {
      if (strict && !strictSansBrancheSignale) {
        strictSansBrancheSignale = true;
        journal.error("CONSOLE_API_STRICT sans console-api branché : ignoré, la console sert elle-même");
      }
      return { distante: false, raison: "non_branche", strict: false };
    }
    if (!jeton) return { distante: false, raison: "sans_session", strict };
    if (deps.algorithme(jeton) !== "ES256") return { distante: false, raison: "session_locale", strict };
    const verifie = await deps.verifier(jeton);
    if (!verifie) return { distante: false, raison: "sans_session", strict };
    if (strict) return { distante: true, jeton, strict };
    if (maintenant() < disjoncteurs[famille].coupeJusqua) return { distante: false, raison: "disjoncteur", strict };
    const pct = await deps.pourcentage(famille).catch(() => 0);
    if (pct <= 0 || (await seauDe(verifie.sid)) >= pct) return { distante: false, raison: "tirage", strict };
    return { distante: true, jeton, strict };
  }

  /** Un échec de TRANSPORT (service injoignable, 5xx, échéance) : compté, il peut ouvrir le disjoncteur. */
  function echec(famille: Famille): void {
    const d = disjoncteurs[famille];
    const t = maintenant();
    d.echecs = d.echecs.filter((x) => t - x < DISJONCTEUR.fenetreMs);
    d.echecs.push(t);
    if (d.echecs.length >= DISJONCTEUR.echecsMax) {
      d.coupeJusqua = t + DISJONCTEUR.coupureMs;
      d.echecs = [];
      journal.warn("disjoncteur ouvert : la console sert seule", { famille, pendant_ms: DISJONCTEUR.coupureMs });
    }
  }

  return { voie, echec, etat: (f: Famille) => ({ coupeJusqua: disjoncteurs[f].coupeJusqua, echecs: disjoncteurs[f].echecs.length }) };
}

export type Aiguillage = ReturnType<typeof creerAiguillage>;
