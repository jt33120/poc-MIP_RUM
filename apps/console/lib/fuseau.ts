// Le fuseau dans lequel une application découpe ses JOURNÉES.
//
// Finding 2.8 de docs/AUDIT_RUM_EXTERNE.md. Trente `date_trunc` dans ce dossier,
// aucun `at time zone`, et aucune fixation de fuseau sur la connexion : les
// bornes étaient celles du serveur PostgreSQL, en pratique UTC — sous une
// interface entièrement en français.
//
// CE QUE ÇA DONNAIT. En été, la colonne « 9 h » de la heatmap contient le trafic
// de 11 h à Paris. La journée coupe à 2 h du matin, ce qui déplace toute la
// soirée sur le lendemain. Et les deux dimanches de changement d'heure
// produisent une journée de 23 h et une de 25 h, que le z-score saisonnier
// compare l'une à l'autre comme si elles étaient de même longueur.
import { q } from "./db";

/** Fuseau retenu quand l'application est inconnue, ou quand on regarde « toutes ». */
export const FUSEAU_DEFAUT = "Europe/Paris";

// Cache court : ce champ change une fois dans la vie d'une application, et la
// requête servirait sinon à chaque bloc de chaque écran.
const CACHE_MS = 60_000;
let cache = new Map<string, string>();
let chargeA = 0;

/**
 * Fuseau d'une application. `null` (toutes les applications) rend le défaut :
 * il n'existe pas de journée commune à des applications de fuseaux différents,
 * et en inventer une serait pire que d'en choisir une et de le dire.
 */
export async function fuseauDe(app: string | null): Promise<string> {
  if (!app) return FUSEAU_DEFAUT;
  const maintenant = Date.now();
  if (maintenant - chargeA > CACHE_MS || cache.size === 0) {
    try {
      const rows = await q<{ app_id: string; timezone: string }>(
        "select app_id, timezone from app_registry",
      );
      cache = new Map(rows.map((r) => [r.app_id, r.timezone]));
      chargeA = maintenant;
    } catch {
      // Colonne absente (base non migrée) ou base indisponible : le défaut vaut
      // mieux qu'un écran vide. C'est le comportement d'avant ce chantier.
      return FUSEAU_DEFAUT;
    }
  }
  return cache.get(app) ?? FUSEAU_DEFAUT;
}

/** Vide le cache — pour les tests, et après une modification d'application. */
export function oublierFuseaux(): void {
  cache = new Map();
  chargeA = 0;
}
