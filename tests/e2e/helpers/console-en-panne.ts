// Console « base coupée » : le mécanisme de `tests/e2e/etats.spec.ts` (F02), extrait
// par F54 pour les specs qui simulent une panne de base.
//
// COMMENT LA PANNE EST SIMULÉE — SANS AUCUN INTERRUPTEUR DANS LE CODE DE PRODUCTION.
// La console déjà construite (`apps/console/.next`, build de production) est lancée
// sur un port à part, avec une `DATABASE_URL` qui vise un port fermé : c'est une
// vraie base injoignable (ECONNREFUSED), pas une imitation. La console partagée
// (port 3000) et sa base ne sont pas touchées.
//
// L'authentification ne passe pas par /login, qui lit la base : le jeton de session
// HS256 est signé avec le secret de CETTE console — ce que fait `signJwt`
// (apps/console/lib/auth.ts), sans rien contourner côté serveur.
//
// `etats.spec.ts` garde sa propre copie (comme `debordements`, extrait par F09 : les
// specs qui en ont une copie la gardent jusqu'à ce que leur lot les reprenne).
//
// PRÉREQUIS : un build de la console de CETTE branche (`pnpm --filter console build`).
// Le `webServer` de playwright.config.ts le produit quand il démarre la console de
// test ; s'il réutilise une console déjà lancée, construire avant.
import { spawn, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

const CONSOLE_DIR = join(process.cwd(), "apps/console");
/** Port 1 : rien n'y écoute, la connexion est refusée immédiatement. */
const BASE_INDISPONIBLE = "postgres://postgres:postgres@127.0.0.1:1/base_indisponible";

export interface ConsoleEnPanne {
  /** « http://127.0.0.1:<port> » : les `page.goto` prennent une URL absolue. */
  base: string;
  /** Cookie de session admin (toutes les apps), à poser sur le contexte du test. */
  cookie: { name: string; value: string; url: string };
  /** Arrête la console et attend sa sortie : un redémarrage de worker retrouve le port libre. */
  arreter(): Promise<void>;
}

/** Jeton de session au format de `signJwt` (lib/auth.ts) : HS256, admin, toutes les apps. */
function jetonSession(secret: string, email: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const maintenant = Math.floor(Date.now() / 1000);
  const corps = `${b64({ alg: "HS256" })}.${b64({ email, role: "admin", apps: null, iat: maintenant, exp: maintenant + 3600 })}`;
  return `${corps}.${createHmac("sha256", secret).update(corps).digest("base64url")}`;
}

function attendreSortie(serveur: ChildProcess, ms: number): Promise<boolean> {
  if (serveur.exitCode !== null || serveur.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const minuterie = setTimeout(() => resolve(false), ms);
    serveur.once("exit", () => {
      clearTimeout(minuterie);
      resolve(true);
    });
  });
}

/**
 * Lance la console de production sur `port`, base injoignable, et attend qu'elle
 * réponde (60 s au plus). `secret` signe les sessions de CETTE console seulement.
 */
export async function demarrerConsoleEnPanne(opts: { port: number; secret: string; email: string }): Promise<ConsoleEnPanne> {
  if (!existsSync(join(CONSOLE_DIR, ".next", "BUILD_ID"))) {
    throw new Error("la console de panne exige un build : lancer `pnpm --filter console build` d'abord.");
  }
  const base = `http://127.0.0.1:${opts.port}`;
  // Un port déjà servi ferait répondre une AUTRE console (celle d'un worker précédent,
  // ou la pile locale) à la sonde de démarrage : on le dit plutôt que de tester à côté.
  const occupe = await fetch(`${base}/mip-rum.js`).then(
    () => true,
    () => false,
  );
  if (occupe) throw new Error(`le port ${opts.port} répond déjà : la console de panne ne peut pas s'y lancer.`);
  let journal = "";
  const serveur = spawn(
    process.execPath,
    [join(CONSOLE_DIR, "node_modules/next/dist/bin/next"), "start", "-p", String(opts.port), "-H", "127.0.0.1"],
    {
      cwd: CONSOLE_DIR,
      env: {
        ...process.env,
        NODE_ENV: "production",
        AUTH_SECRET: opts.secret,
        DATABASE_URL: BASE_INDISPONIBLE,
        // Les journaux de la console de panne ne partent nulle part : ils ne
        // doivent pas polluer la page /logs de la console partagée.
        CONSOLE_LOGS_ENDPOINT: "http://127.0.0.1:1/journaux-indisponibles",
        PGPOOL_MAX: "2",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  serveur.stdout?.on("data", (d) => (journal += String(d)));
  serveur.stderr?.on("data", (d) => (journal += String(d)));

  const arreter = async () => {
    serveur.kill("SIGTERM");
    if (!(await attendreSortie(serveur, 10_000))) {
      serveur.kill("SIGKILL");
      await attendreSortie(serveur, 5_000);
    }
  };

  // Prête dès qu'elle répond, quel que soit le statut : un fichier public, hors porte
  // d'authentification, qui ne lit pas la base.
  const limite = Date.now() + 60_000;
  while (Date.now() < limite) {
    if (serveur.exitCode !== null) break;
    try {
      await fetch(`${base}/mip-rum.js`);
      return {
        base,
        cookie: { name: "mip_session", value: jetonSession(opts.secret, opts.email), url: base },
        arreter,
      };
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  await arreter();
  throw new Error(`console de panne injoignable sur ${base}\n${journal.slice(-3000)}`);
}
