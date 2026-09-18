// Workflow des issues d'erreurs hors console (P5.6, migration-v73) : texte
// d'activité et reprise des notes de triage des groupes historiques.
//
// La décision de régression et l'outbox des nouvelles issues vivent en SQL
// (error_issue_record_occurrences, déclencheur error_issue_notify_new_v73) : elles
// doivent tenir dans la transaction de l'écrivain, quel qu'il soit.
import { scrubText } from "../supabase/functions/_shared/scrub.mjs";

/** Longueur maximale d'un commentaire d'activité, en caractères (contrainte error_issue_activity_v73). */
export const COMMENTAIRE_MAX = 2000;

/**
 * Texte d'activité tel qu'il peut être stocké : scrubbé comme un message d'erreur
 * (secrets, e-mails, longues suites de chiffres), sans NUL que PostgreSQL refuse,
 * espaces de bord retirés. `null` s'il ne reste rien. La longueur n'est PAS bornée
 * ici : la console refuse un commentaire trop long, la reprise d'une note le tronque.
 * @param {unknown} texte
 * @returns {string|null}
 */
export function texteActivite(texte) {
  const propre = scrubText(texte)?.replaceAll("\u0000", "").trim();
  return propre ? propre : null;
}

/** Tronque à `max` caractères (points de code, comme `char_length` de PostgreSQL). */
export function tronquerCaracteres(texte, max) {
  const points = [...texte];
  return points.length > max ? points.slice(0, max).join("") : texte;
}

/**
 * En-tête posé sur la note d'un groupe historique SCINDÉ entre plusieurs issues.
 *
 * P8.2 : une note écrite à propos d'un groupe de 2024 qui se scinde en trois
 * issues v2 n'est pas le diagnostic de chacune des trois. Recopiée telle quelle,
 * elle se lit comme tel — et un opérateur refermera deux issues sur la foi d'une
 * analyse qui ne les concernait pas. Elle est donc ANNONCÉE comme héritée, et le
 * nombre d'issues concernées est dit : c'est ce qui permet au lecteur de faire
 * la part des choses lui-même.
 */
export const ENTETE_HERITEE = (empreinte, issues) =>
  `[hérité du groupe historique ${empreinte}, scindé en ${issues} issues — cette note décrit le groupe, pas cette issue en particulier]\n`;

/**
 * Importe UNE fois, en commentaire système, la note de triage de chaque groupe
 * historique rattaché à une issue (error_issue_alias). La clé d'événement
 * `legacy_note:<empreinte>` est unique par issue : rejouer — ou lancer deux
 * déclencheurs en même temps — n'importe rien de plus. Une empreinte répartie sur
 * deux issues donne sa note à chacune, PRÉFIXÉE de `ENTETE_HERITEE` : le groupe
 * a été scindé, la note décrit le groupe. La note garde sa date de dernière mise
 * à jour ; elle est scrubbée et tronquée à 2 000 caractères.
 *
 * Sans migration-v73, rien à faire : l'étape le dit au lieu d'échouer.
 * @returns {Promise<{importees: number, heritees?: number} | {absent: string}>}
 */
export async function importerNotesHistoriques(pool, { limite = 200 } = {}) {
  const { rows: [schema] } = await pool.query(
    "select to_regclass('public.error_issue_activity') is not null as v73",
  );
  if (!schema.v73) return { absent: "migration-v73 non appliquée" };
  const { rows } = await pool.query(
    `select a.app_id, a.issue_id, a.legacy_fingerprint, st.note, st.updated_at,
            (select count(*) from error_issue_alias b
              where b.app_id = a.app_id and b.legacy_fingerprint = a.legacy_fingerprint)::int as issues
       from error_issue_alias a
       join error_status st on st.app_id = a.app_id and st.fingerprint = a.legacy_fingerprint
      where st.note ~ '[^[:space:]]'
        and not exists (
          select 1 from error_issue_activity x
           where x.app_id = a.app_id and x.issue_id = a.issue_id
             and x.event_key = 'legacy_note:' || a.legacy_fingerprint)
      order by a.created_at, a.app_id, a.legacy_fingerprint, a.issue_id
      limit $1`,
    [limite],
  );
  const notes = rows
    .map((r) => {
      const corps = texteActivite(r.note);
      // Groupe scindé : la note est ANNONCÉE comme héritée du groupe. Elle
      // n'est pas le diagnostic de cette issue-ci, et se lirait comme tel.
      return { ...r, corps: corps === null || r.issues <= 1 ? corps : ENTETE_HERITEE(r.legacy_fingerprint, r.issues) + corps };
    })
    .filter((r) => r.corps !== null);
  const heritees = notes.filter((n) => n.issues > 1).length;
  if (!notes.length) return { importees: 0, heritees: 0 };
  const { rowCount } = await pool.query(
    `insert into error_issue_activity
       (app_id, issue_id, kind, actor_kind, body, legacy_fingerprint, event_key, created_at)
     select n.app_id, n.issue_id, 'comment', 'system', n.corps, n.empreinte, 'legacy_note:' || n.empreinte, n.date
       from unnest($1::text[], $2::uuid[], $3::text[], $4::text[], $5::timestamptz[])
         as n (app_id, issue_id, empreinte, corps, date)
     on conflict (app_id, issue_id, event_key) where event_key is not null do nothing`,
    [
      notes.map((n) => n.app_id),
      notes.map((n) => n.issue_id),
      notes.map((n) => n.legacy_fingerprint),
      notes.map((n) => tronquerCaracteres(n.corps, COMMENTAIRE_MAX)),
      notes.map((n) => n.updated_at),
    ],
  );
  return { importees: rowCount ?? 0, heritees };
}
