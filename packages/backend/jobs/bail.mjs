// Bail d'exclusion pour les travaux planifiés : une seule instance à la fois.
//
// POURQUOI PAS UN VERROU CONSULTATIF. C'était la première version, et elle ne
// tenait pas : la connexion de production passe par l'endpoint « pooler » de
// Neon, un PgBouncer en mode TRANSACTION. Un `pg_advisory_lock` de session y est
// pris sur un backend et perdu au suivant — deux instances se croient donc
// seules toutes les deux. Le même piège a fait échouer le migrateur le
// 08/09/2026 ; ici les conséquences seraient pires : des sondes uptime en
// double, et surtout des webhooks d'alerte envoyés deux fois au client.
//
// Un bail est une LIGNE. Il ne dépend d'aucune propriété de session, donc il
// traverse n'importe quel pooler, et il survit à la mort du process : la date
// d'expiration le libère, sans que personne ait à nettoyer.
//
// CE QU'IL NE GARANTIT PAS. Ce n'est pas de l'exclusion mutuelle stricte : si un
// travail dépasse la durée du bail, un second peut démarrer pendant que le
// premier tourne encore. Les durées sont donc prises TRÈS au-dessus du temps
// observé, et les travaux restent idempotents. Un verrou parfait exigerait une
// session stable, que le pooler ne donne pas.

/**
 * DDL du bail. LA SOURCE DE VÉRITÉ EST `sql/migration-v54.sql`, pas cette
 * constante : le schéma se décrit dans les migrations, sinon une base
 * reconstruite depuis le dépôt n'est pas celle de la production.
 *
 * Cette table naissait ici, et NULLE PART AILLEURS. La console la lit pourtant
 * (`dernierTickScheduler`, pour la ligne « Latence d'alerte » de la vitrine
 * PUBLIQUE) : tant que le scheduler n'avait pas tourné, chaque visite anonyme
 * provoquait un `relation "scheduler_lease" does not exist`. En échec doux,
 * donc invisible — mais c'est une erreur Postgres déclenchable par n'importe qui.
 *
 * L'appel reste exécuté au démarrage : il est `if not exists`, donc gratuit, et
 * garde le scheduler déployable seul sur une base non migrée. Un test compare
 * cette DDL à celle de la migration pour qu'elles ne divergent pas.
 */
export const SQL_TABLE = `
create table if not exists scheduler_lease (
  job        text primary key,
  holder     text        not null,
  expires_at timestamptz not null
)`;

/**
 * Tente de prendre le bail, et rend le BATTEMENT qu'il portait avant la prise.
 *
 * L'upsert avec `where expires_at < now()` fait tout le travail en UNE requête
 * atomique : soit personne ne tient le bail (ou il a expiré) et on le prend,
 * soit il est tenu et la clause `where` bloque la mise à jour — aucune ligne
 * n'est renvoyée. Pas de lecture-puis-écriture, donc pas de fenêtre de course.
 *
 * POURQUOI RENDRE L'ANCIEN `expires_at`. Prendre le bail écrase la ligne, donc
 * le battement (l'heure du dernier passage ABOUTI, cf. `rendreBail`). Si le
 * travail échoue, `abandonnerBail` doit remettre ce battement tel qu'il était :
 * sans lui, la seule issue serait d'écrire `now()` — et un échec passerait pour
 * un succès auprès de la vitrine (`dernierTickScheduler`) et de /ready. La CTE
 * est lue sur l'instantané du DÉBUT de l'instruction, avant l'upsert : c'est
 * bien la valeur remplacée (vérifié sur Postgres 17).
 *
 * @returns {Promise<{ tenu: boolean, battementPrecedent: Date | null }>}
 *   `battementPrecedent` : null si la ligne n'existait pas (jamais exécuté).
 */
export async function prendreBailDetaille(client, { job, porteur, secondes }) {
  const { rows } = await client.query(
    `with precedent as (select expires_at from scheduler_lease where job = $1)
     insert into scheduler_lease (job, holder, expires_at)
     values ($1, $2, now() + make_interval(secs => $3))
     on conflict (job) do update
       set holder = excluded.holder, expires_at = excluded.expires_at
       where scheduler_lease.expires_at < now()
     returning holder, (select expires_at from precedent) as precedent`,
    [job, porteur, secondes],
  );
  const tenu = rows.length > 0 && rows[0].holder === porteur;
  return { tenu, battementPrecedent: tenu ? (rows[0].precedent ?? null) : null };
}

/** Tente de prendre le bail. Renvoie true si on l'a obtenu. */
export async function prendreBail(client, options) {
  return (await prendreBailDetaille(client, options)).tenu;
}

/**
 * Rend le bail — en le faisant EXPIRER, pas en supprimant la ligne.
 *
 * La clause sur `holder` est essentielle : si notre bail a expiré et qu'un autre
 * l'a repris entre-temps, on ne doit surtout pas libérer LE SIEN — ça ouvrirait
 * la porte à une troisième instance.
 *
 * POURQUOI EXPIRER PLUTÔT QUE SUPPRIMER. La sémantique est identique pour la
 * prise suivante (`expires_at < now()` est vrai dans les deux cas), mais la
 * ligne SURVIT — et devient un battement de cœur gratuit : `max(expires_at)`
 * pour une cadence donne l'heure de son dernier passage abouti. La vitrine s'en
 * sert pour dire la latence d'alerte RÉELLE au lieu de l'affirmer en dur, comme
 * elle le fait déjà pour la purge de rétention. Une ligne supprimée n'aurait
 * rien laissé à lire.
 *
 * SUR SUCCÈS SEULEMENT. Écrire `now()` ici, c'est affirmer « passage abouti ».
 * Jusqu'en P1, le worker le faisait aussi après un travail en échec : une
 * cadence qui échouait à chaque passage restait « fraîche » pour la vitrine.
 * Un échec rend désormais le bail par `abandonnerBail`.
 */
export async function rendreBail(client, { job, porteur }) {
  await client.query(
    "update scheduler_lease set expires_at = now() where job = $1 and holder = $2",
    [job, porteur],
  );
}

/**
 * Rend le bail SANS battement — après un travail en échec.
 *
 * Le bail doit être libéré quand même : le garder jusqu'à son expiration
 * (10 min pour le tick) ferait sauter le passage suivant, sur cette instance
 * comme sur une autre. Mais la ligne ne doit pas dire « passage abouti » :
 * on y remet le battement d'avant la prise (`prendreBailDetaille`), borné à
 * `now()` pour que le bail soit bien reprenable. S'il n'y en avait pas (la
 * cadence n'a jamais abouti), la ligne est supprimée : `max(expires_at)` rend
 * alors null, soit « aucun passage constaté » — ce qui est exact.
 *
 * Même garde que `rendreBail` : on ne touche qu'à NOTRE bail.
 *
 * LIMITE CONNUE. Si le bail précédent avait expiré sans être rendu (processus
 * tué en plein travail), son `expires_at` n'est pas un battement mais une
 * échéance ; c'est pourtant lui qu'on remet. L'écart est borné par la durée
 * du bail, et le cas suppose deux pannes de suite.
 *
 * @param {{ query: Function }} client
 * @param {{ job: string, porteur: string, battement: Date | null }} options
 */
export async function abandonnerBail(client, { job, porteur, battement }) {
  if (battement == null) {
    await client.query("delete from scheduler_lease where job = $1 and holder = $2", [job, porteur]);
    return;
  }
  await client.query(
    "update scheduler_lease set expires_at = least($3::timestamptz, now()) where job = $1 and holder = $2",
    [job, porteur, battement],
  );
}

/**
 * Durée du bail par cadence, en secondes. Largement au-dessus du temps observé
 * (un tick complet prend ~20 ms sur une base réelle) : le bail protège contre
 * le chevauchement, il n'a pas à être serré. Trop court serait le pire des deux
 * mondes — il expirerait pendant un travail lent, et autoriserait exactement le
 * doublon qu'il est censé empêcher.
 */
export const DUREES = { tick: 600, horaire: 900, quotidien: 3600 };
