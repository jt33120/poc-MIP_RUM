// LE REGISTRE DES FENÊTRES DE COLLECTE (`collecte_fenetre`), en lecture.
//
// Le scheduler y date les périodes où la chaîne de mesure n'était pas nominale
// (`degradee`, `interrompue` ; « ouverte » est l'absence de fenêtre). Les écrans en
// ont besoin pour ne plus dire « 0 » là où rien n'a été mesuré, et la comparaison
// à la période précédente pour ne pas calculer d'écart contre une panne
// (`comparaison.ts`, sixième règle).
//
// LA TABLE PEUT MANQUER. Elle arrive par une migration livrée à part : tant qu'elle
// n'est pas appliquée (42P01), qu'une colonne manque (42703) ou que le rôle de
// lecture n'a pas encore son droit (42501), la lecture rend `[]` — le registre est
// une aide à la lecture des séries, pas une donnée : son absence ne met aucun écran
// en échec. Toute autre erreur remonte (une panne se dit, F02).
//
// UNE LECTURE PAR ÉCRAN, PAS PAR TUILE. Un écran évalue la couverture de plusieurs
// sources en parallèle ; la même plage et le même périmètre partagent une seule
// promesse pendant `DUREE_CACHE_MS` (Neon se paie au réveil : pas de lecture en
// double pour une poignée de lignes).
import { q } from "./db";
import type { FenetreCollecte } from "./series";

/** SQLSTATE d'un registre absent ou pas encore lisible : rendre `[]`, sans erreur. */
const REGISTRE_ABSENT: ReadonlySet<string> = new Set(["42P01", "42703", "42501"]);

export function registreCollecteAbsent(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && REGISTRE_ABSENT.has(code);
}

/** Au plus ce nombre de fenêtres par lecture : quelques lignes par mois en régime normal. */
const LIMITE = 200;
const DUREE_CACHE_MS = 30_000;
const cache = new Map<string, { expire: number; promesse: Promise<FenetreCollecte[]> }>();

/**
 * Fenêtres de la synthèse de la chaîne (`etage = 'chaine'`) qui recoupent
 * [from, to), pour la plateforme (`portee = '*'`) et les applications du périmètre.
 * `apps = null` (toutes les applications) : la plateforme seule — la panne d'une
 * application ne rend pas « non mesuré » le total de toutes.
 */
export async function lireFenetresCollecte(
  range: { from: string; to: string },
  apps: readonly string[] | null,
): Promise<FenetreCollecte[]> {
  const portees = apps === null ? [] : [...apps].sort();
  const cle = `${range.from}|${range.to}|${portees.join(",")}|${apps === null ? "*" : ""}`;
  const maintenant = Date.now();
  const connu = cache.get(cle);
  if (connu && connu.expire > maintenant) return connu.promesse;
  const promesse = lire(range, portees);
  cache.set(cle, { expire: maintenant + DUREE_CACHE_MS, promesse });
  // Un échec ne reste pas en cache : la lecture suivante réessaie.
  promesse.catch(() => cache.delete(cle));
  if (cache.size > 500) for (const [k, v] of cache) if (v.expire <= maintenant) cache.delete(k);
  return promesse;
}

async function lire(range: { from: string; to: string }, portees: string[]): Promise<FenetreCollecte[]> {
  try {
    const rows = await q<{ debut: Date | string; fin: Date | string | null; etat: string }>(
      `select debut, fin, etat
         from collecte_fenetre
        where etage = 'chaine'
          and etat in ('degradee', 'interrompue')
          and (portee = '*' or portee = any($3::text[]))
          and debut < $2::timestamptz
          and (fin is null or fin > $1::timestamptz)
        order by debut
        limit ${LIMITE}`,
      [range.from, range.to, portees],
    );
    return rows.map((r) => ({
      debut: new Date(r.debut).toISOString(),
      fin: r.fin === null ? null : new Date(r.fin).toISOString(),
      etat: r.etat === "interrompue" ? "interrompue" : "degradee",
    }));
  } catch (err) {
    if (registreCollecteAbsent(err)) return [];
    throw err;
  }
}

/** Pour les tests : vide le cache des lectures. */
export function viderCacheFenetresCollecte(): void {
  cache.clear();
}
