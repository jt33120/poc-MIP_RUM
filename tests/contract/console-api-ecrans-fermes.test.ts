// C5 — LES CAPACITÉS FERMÉES (SVI, logs, IA), OUVERTES POUR LE TEST.
//
// Tant que `lib/capacites.ts` les liste, leurs chargeurs ne lisent rien (la
// matrice d'autorisations le vérifie : état `fermee`). Ce fichier les ROUVRE — le
// module est simulé — et exécute leurs chargeurs sur une base migrée : le jour où
// une capacité rouvre, son chargeur a déjà tourné sur le vrai schéma.
//
//   CONSOLE_API_AUTHZ_DATABASE_URL=<base migrée> pnpm test:contract
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/capacites", () => ({ CAPACITES_FERMEES: [], estFermee: () => false }));

const url = process.env.CONSOLE_API_AUTHZ_DATABASE_URL || null;
if (process.env.CI && !url) throw new Error("CI : CONSOLE_API_AUTHZ_DATABASE_URL est requise");

const APP = "fermes-app-a";
const principal = { email: "fermes@test.local", role: "viewer" as const, apps: [APP] };

(url ? describe : describe.skip)("C5 — capacités fermées : leurs chargeurs, rouverts, tournent sur la base", () => {
  const pool = new pg.Pool({ connectionString: url ?? undefined, max: 2 });
  let chargeurs: typeof import("../../apps/console/lib/chargeurs/svi") &
    typeof import("../../apps/console/lib/chargeurs/logs") &
    typeof import("../../apps/console/lib/chargeurs/ai");

  beforeAll(async () => {
    await pool.query("insert into app_registry (app_id, name) values ($1, $1) on conflict do nothing", [APP]);
    // La couche de données de la console lit `DATABASE_URL` : la base de la matrice.
    process.env.DATABASE_URL = url!;
    chargeurs = {
      ...(await import("../../apps/console/lib/chargeurs/svi")),
      ...(await import("../../apps/console/lib/chargeurs/logs")),
      ...(await import("../../apps/console/lib/chargeurs/ai")),
    };
  });

  afterAll(async () => {
    await pool.query("delete from app_registry where app_id = $1", [APP]);
    await pool.end();
  });

  it("SVI : vue d'ensemble, appels ; un appel inconnu est introuvable", async () => {
    expect((await chargeurs.chargerSvi(principal, { app: APP }, {})).etat).toBe("ok");
    expect((await chargeurs.chargerSviAppels(principal, { app: APP }, {})).etat).toBe("ok");
    expect((await chargeurs.chargerSviAppel(principal, { app: APP }, { callId: "appel-inconnu" })).etat).toBe("introuvable");
  });

  it("logs : toutes sévérités, et sous un niveau", async () => {
    expect((await chargeurs.chargerLogs(principal, { app: APP }, {})).etat).toBe("ok");
    expect((await chargeurs.chargerLogs(principal, { app: APP, level: "error" }, {})).etat).toBe("ok");
  });

  it("IA : sans jeton xSOM, la façade ne répond rien — l'écran dit « indisponible », jamais une panne", async () => {
    const lu = await chargeurs.chargerAi(principal, { app: APP }, {});
    expect(lu.etat).toBe("ok");
    expect(lu.etat === "ok" ? lu.ai : "non lu").toBeNull();
  });
});
