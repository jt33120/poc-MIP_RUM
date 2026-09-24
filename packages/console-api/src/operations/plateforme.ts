// PUBLIC : l'état de la plateforme que montre la vitrine anonyme (`/presentation`).
//
// Les MÊMES lectures que `apps/console/lib/queries-planifie.ts`, à la requête
// près : `tests/integration/console-api-plateforme-sql.test.ts` les fait tourner
// côte à côte sur la même base. Une lecture qui échoue rend `illisible` — jamais
// « jamais exécuté » : on ne prouve rien sur la foi d'une panne.
import { cadencePubliee, ETAT_PLATEFORME, type EtatPlateforme, type LecturePlanifie } from "@mip/console-contract";
import type { Lecteur } from "../contexte";
import { servir, type Enregistrement } from "../politique";

async function dernierPassageQuotidien(db: Lecteur): Promise<LecturePlanifie> {
  try {
    const { rows } = await db.query<{ t: string | null }>("select max(metered_at)::text as t from tenant_usage_daily");
    return { etat: "lu", date: rows[0]?.t ? new Date(rows[0].t) : null };
  } catch {
    return { etat: "illisible" };
  }
}

async function cadenceTick(db: Lecteur): Promise<number | null> {
  try {
    const { rows } = await db.query<{ value: string }>("select value from platform_flag where key = 'scheduler_tick_min'");
    return cadencePubliee(rows[0]?.value);
  } catch {
    return null;
  }
}

async function dernierTick(db: Lecteur): Promise<LecturePlanifie> {
  let date: Date | null;
  try {
    const { rows } = await db.query<{ t: string | null }>("select max(expires_at)::text as t from scheduler_lease where job = 'tick'");
    date = rows[0]?.t ? new Date(rows[0].t) : null;
  } catch {
    return { etat: "illisible" };
  }
  return { etat: "lu", date, cadenceMin: await cadenceTick(db) };
}

export async function lireEtatPlateforme(db: Lecteur): Promise<EtatPlateforme> {
  const [quotidien, tick] = await Promise.all([dernierPassageQuotidien(db), dernierTick(db)]);
  return { quotidien, tick };
}

export function operationsPlateforme(d: { db: Lecteur }): Enregistrement[] {
  return [servir(ETAT_PLATEFORME, { auth: "public", portee: "globale", demo: "lecture" }, () => lireEtatPlateforme(d.db))];
}
