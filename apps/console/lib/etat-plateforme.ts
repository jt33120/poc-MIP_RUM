// L'ÉTAT DE LA PLATEFORME QUE MONTRE LA VITRINE : console-api s'il est branché,
// la base sinon (piste C, C0b).
//
// C'est la première lecture de la console qui passe par console-api. Tant que le
// service n'est pas déployé et branché (`lib/backend.ts`), la vitrine lit la base
// comme avant ; branché, elle lit console-api, et retombe sur la base si l'appel
// échoue (une lecture se rejoue sans risque — même règle que le relais de l'API
// v1). La lecture locale et son repli disparaissent dans la PR qui suit la mise en
// service : c'est elle qui fera sortir `/presentation` du cliquet de la piste C
// (docs/architecture/console-api/cliquet.json).
import { ETAT_PLATEFORME, type EtatPlateforme, type Fil, type LecturePlanifie } from "@mip/console-contract";
import { backend } from "./backend";
import { dernierPassagePlanifie, dernierTickScheduler } from "./queries-planifie";

/** Une lecture reçue de console-api : ses dates redeviennent des `Date`. */
export function lecturePlanifieDepuisFil(f: Fil<LecturePlanifie>): LecturePlanifie {
  return f.etat === "illisible" ? { etat: "illisible" } : { ...f, date: f.date ? new Date(f.date) : null };
}

async function lectureLocale(): Promise<EtatPlateforme> {
  const [quotidien, tick] = await Promise.all([dernierPassagePlanifie(), dernierTickScheduler()]);
  return { quotidien, tick };
}

export async function lireEtatPlateforme(client: Pick<ReturnType<typeof backend>, "appeler" | "estBranche"> = backend()): Promise<EtatPlateforme> {
  if (!client.estBranche()) return lectureLocale();
  // Indépendante de l'utilisateur : servie par le cache de Next une minute.
  const r = await client.appeler(ETAT_PLATEFORME, {}, { revalider: 60 });
  if (!r.ok) return lectureLocale();
  return { quotidien: lecturePlanifieDepuisFil(r.data.quotidien), tick: lecturePlanifieDepuisFil(r.data.tick) };
}
