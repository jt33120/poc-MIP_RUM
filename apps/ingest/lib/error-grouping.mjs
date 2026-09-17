// Regroupement v2 à l'écriture (P5.5, migration-v72). Appelé par ecrireErreurs,
// DANS la transaction du lot : une issue n'existe que si au moins une de ses
// occurrences est réellement écrite avec elle.
//
// DEUX RÉGIMES, UNE CLÉ. La clé v2 est calculée pour CHAQUE erreur, dans toutes
// les apps : c'est l'ombre qui permet de mesurer scissions et fusions avant
// d'activer (error_grouping_shadow_stats). Une issue n'est attribuée que dans une
// app où `error_grouping_config.active_version = 2` ; ailleurs, rien n'est créé
// ni modifié hors de la ligne elle-même.
//
// CE QUI GARANTIT « REJOUER UN LOT NE CHANGE RIEN ».
//   • Les lignes déjà écrites (même `span_id`) sont écartées AVANT toute création
//     d'issue : un rejeu ne peut pas faire naître une issue fantôme.
//   • Première et dernière vue ne suivent que les lignes renvoyées par RETURNING,
//     et seulement quand elles les repoussent ; `revision` ne bouge que sur un
//     changement de statut.
//
// CONCURRENCE. Deux lots qui créent la même clé passent par l'unicité
// (app_id, grouping_version, grouping_key) : un seul insère, l'autre relit l'issue
// dans une instruction suivante (qui voit la ligne validée). Les mises à jour
// d'issues sont faites en FIN de transaction, une issue à la fois dans l'ordre
// des identifiants : le verrou de ligne d'une issue chaude n'est tenu que le
// temps du commit, et deux lots ne se l'échangent jamais dans le désordre.
//
// L'HISTORIQUE. Une clé v2 qui recouvre une empreinte historique DÉJÀ VUE naît
// `migration`, jamais « nouveau bug » : c'est ce qui empêche de renotifier des
// groupes connus au basculement. Son statut suit les groupes historiques touchés
// (unanimes : leur statut ; divergents : `for_review`), et leur première et
// dernière vue sont lues par deux lectures bornées sur l'index
// (app_id, fingerprint, ts). Les notes de `error_status` ne sont ni copiées ni
// supprimées : l'issue les relit par ses alias.
import { errorGrouping, GROUPING_VERSION } from "../supabase/functions/_shared/error-normalize.mjs";

/** Empreintes historiques consultées par lot, au plus. Au-delà : rattachées sans historique. */
export const MAX_GROUPES_HISTORIQUES_PAR_LOT = 64;

/** Longueur maximale d'une empreinte historique (contrainte `error_issue_alias_v72`). */
const EMPREINTE_MAX = 64;

const cle = (app, valeur) => `${app}\u0000${valeur}`;
const instant = (ts) => new Date(ts).getTime();

/**
 * Clé v2 de chaque erreur et, dans les apps activées, l'issue de chaque occurrence
 * nouvelle. `symbolicated_frames` (positions source de la symbolication, P5.4) est
 * lu s'il est présent sur la ligne ; il n'est jamais écrit.
 *
 * @returns {Promise<{ lignes: object[], plan: null | { apps: Map<string,string>, divergences: Map<string,Set<string>> } }>}
 */
export async function regrouperErreurs(client, erreurs) {
  if (!erreurs.length) return { lignes: erreurs, plan: null };
  const { rows: configs } = await client.query(
    "select app_id, active_version, vendor_paths from error_grouping_config where app_id = any($1::text[])",
    [[...new Set(erreurs.map((e) => e.app_id))]],
  );
  const config = new Map(configs.map((c) => [c.app_id, c]));
  const lignes = erreurs.map((e) => {
    const g = errorGrouping({
      appId: e.app_id,
      errorType: e.error_type,
      message: e.message,
      stack: e.stack,
      overrideHash: e.fingerprint_override_hash ?? null,
      symbolicatedFrames: e.symbolicated_frames ?? null,
      vendorPaths: config.get(e.app_id)?.vendor_paths ?? [],
    });
    return { ...e, grouping_version: g.version, grouping_key: g.key, grouping_basis: g.basis, issue_id: null };
  });

  const actives = lignes.filter((e) => config.get(e.app_id)?.active_version === GROUPING_VERSION);
  if (!actives.length) return { lignes, plan: null };
  const { rows: dejaEcrites } = await client.query(
    "select span_id from rum_error where span_id = any($1::text[])",
    [actives.map((e) => e.span_id)],
  );
  const deja = new Set(dejaEcrites.map((r) => r.span_id));
  const fraiches = actives.filter((e) => !deja.has(e.span_id));
  if (!fraiches.length) return { lignes, plan: null };

  // Une entrée par (app, clé) : empreintes historiques et occurrences extrêmes du lot.
  const cles = new Map();
  for (const e of fraiches) {
    const k = cle(e.app_id, e.grouping_key);
    const c = cles.get(k) ?? {
      app_id: e.app_id, grouping_key: e.grouping_key, grouping_basis: e.grouping_basis,
      empreintes: new Set(), premiere: e, derniere: e,
    };
    if (typeof e.fingerprint === "string" && e.fingerprint.length <= EMPREINTE_MAX) c.empreintes.add(e.fingerprint);
    if (instant(e.ts) < instant(c.premiere.ts)) c.premiere = e;
    if (instant(e.ts) > instant(c.derniere.ts)) c.derniere = e;
    cles.set(k, c);
  }
  const toutes = [...cles.values()];
  const ids = await issuesExistantes(client, toutes);

  // Alias déjà connus des issues existantes : seules les empreintes nouvelles pour
  // une issue demandent un historique.
  const paires = toutes.flatMap((c) => (ids.has(cle(c.app_id, c.grouping_key))
    ? [...c.empreintes].map((fp) => ({ app_id: c.app_id, fp, issue_id: ids.get(cle(c.app_id, c.grouping_key)) }))
    : []));
  const connues = new Set();
  if (paires.length) {
    const { rows } = await client.query(
      `select app_id, legacy_fingerprint, issue_id from error_issue_alias
        where (app_id, legacy_fingerprint, issue_id) in (select * from unnest($1::text[], $2::text[], $3::uuid[]))`,
      [paires.map((p) => p.app_id), paires.map((p) => p.fp), paires.map((p) => p.issue_id)],
    );
    for (const r of rows) connues.add(cle(r.app_id, `${r.legacy_fingerprint}\u0000${r.issue_id}`));
  }
  const nouvellesPaires = paires.filter((p) => !connues.has(cle(p.app_id, `${p.fp}\u0000${p.issue_id}`)));
  const manquantes = toutes.filter((c) => !ids.has(cle(c.app_id, c.grouping_key)));

  const aConsulter = new Map();
  for (const { app_id, fp } of [
    ...manquantes.flatMap((c) => [...c.empreintes].map((fp) => ({ app_id: c.app_id, fp }))),
    ...nouvellesPaires,
  ]) {
    if (aConsulter.size < MAX_GROUPES_HISTORIQUES_PAR_LOT) aConsulter.set(cle(app_id, fp), { app_id, fp });
  }
  const historique = await groupesHistoriques(client, [...aConsulter.values()]);

  const creees = await creerIssues(client, manquantes, historique);
  for (const [k, id] of creees) ids.set(k, id);
  const restantes = manquantes.filter((c) => !creees.has(cle(c.app_id, c.grouping_key)));
  if (restantes.length) for (const [k, id] of await issuesExistantes(client, restantes)) ids.set(k, id);

  // Alias : toutes les empreintes des issues créées ici ; pour les autres, celles
  // qui n'étaient pas encore rattachées (une issue créée par un lot concurrent
  // reçoit les siennes, le conflit les rend inertes).
  const alias = [];
  for (const c of toutes) {
    const id = ids.get(cle(c.app_id, c.grouping_key));
    const creeeIci = creees.has(cle(c.app_id, c.grouping_key));
    for (const fp of c.empreintes) {
      if (!creeeIci && ids.has(cle(c.app_id, c.grouping_key)) && connues.has(cle(c.app_id, `${fp}\u0000${id}`))) continue;
      const h = historique.get(cle(c.app_id, fp));
      alias.push({ app_id: c.app_id, fp, issue_id: id, creeeIci, statut: h?.first_seen ? h.status : null, resolue: h?.first_seen ? h.resolved_at : null });
    }
  }
  const divergences = new Map();
  if (alias.length) {
    const { rows } = await client.query(
      `insert into error_issue_alias (app_id, legacy_fingerprint, issue_id, legacy_status, legacy_resolved_at)
       select * from unnest($1::text[], $2::text[], $3::uuid[], $4::text[], $5::timestamptz[])
       on conflict (app_id, legacy_fingerprint, issue_id) do nothing
       returning issue_id, legacy_status`,
      [alias.map((a) => a.app_id), alias.map((a) => a.fp), alias.map((a) => a.issue_id), alias.map((a) => a.statut), alias.map((a) => a.resolue)],
    );
    const creeesIci = new Set(creees.values());
    for (const r of rows) {
      // Une issue créée ici a déjà dérivé son statut de ces mêmes groupes.
      if (!r.legacy_status || creeesIci.has(r.issue_id)) continue;
      divergences.set(r.issue_id, (divergences.get(r.issue_id) ?? new Set()).add(r.legacy_status));
    }
  }

  const apps = new Map();
  for (const e of fraiches) {
    e.issue_id = ids.get(cle(e.app_id, e.grouping_key));
    apps.set(e.issue_id, e.app_id);
  }
  return { lignes, plan: { apps, divergences } };
}

/** Identifiants des issues déjà présentes pour ces clés : Map(app + clé → id). */
async function issuesExistantes(client, cles) {
  const { rows } = await client.query(
    `select id, app_id, grouping_key from error_issue
      where grouping_version = $1 and (app_id, grouping_key) in (select * from unnest($2::text[], $3::text[]))`,
    [GROUPING_VERSION, cles.map((c) => c.app_id), cles.map((c) => c.grouping_key)],
  );
  return new Map(rows.map((r) => [cle(r.app_id, r.grouping_key), r.id]));
}

/**
 * Première et dernière occurrence, statut et résolution de chaque groupe
 * historique touché, lus AVANT l'écriture du lot : une empreinte sans occurrence
 * antérieure n'est pas un groupe historique (`first_seen` NULL).
 *
 * Deux lectures `order by ts limit 1` par empreinte sur (app_id, fingerprint, ts) :
 * bornées quelle que soit la taille du groupe. Le résolveur historique est un
 * email ; il n'est retenu que s'il désigne un compte de la console.
 */
async function groupesHistoriques(client, empreintes) {
  if (!empreintes.length) return new Map();
  const { rows } = await client.query(
    `select f.app_id, f.fingerprint,
            premiere.ts as first_seen, premiere.release as first_release,
            derniere.ts as last_seen, derniere.release as last_release,
            case when st.status in ('open', 'resolved', 'ignored') then st.status else 'open' end as status,
            st.resolved_at, u.id as resolved_by_user_id
       from unnest($1::text[], $2::text[]) as f (app_id, fingerprint)
       left join lateral (
         select e.ts, e.release from rum_error e
          where e.app_id = f.app_id and e.fingerprint = f.fingerprint
          order by e.ts asc limit 1
       ) premiere on true
       left join lateral (
         select e.ts, e.release from rum_error e
          where e.app_id = f.app_id and e.fingerprint = f.fingerprint
          order by e.ts desc limit 1
       ) derniere on true
       left join error_status st on st.app_id = f.app_id and st.fingerprint = f.fingerprint
       left join console_user u on u.email = st.resolved_by`,
    [empreintes.map((e) => e.app_id), empreintes.map((e) => e.fp)],
  );
  return new Map(rows.map((r) => [cle(r.app_id, r.fingerprint), r]));
}

/**
 * Crée les issues absentes, initialisées depuis les groupes historiques touchés.
 * `on conflict do nothing` : une issue créée au même instant par un autre lot
 * garde ses valeurs, et celles calculées ici sont abandonnées.
 *
 * @returns {Promise<Map<string,string>>} app + clé → id, pour les issues créées ICI
 */
async function creerIssues(client, manquantes, historique) {
  if (!manquantes.length) return new Map();
  const nouvelles = manquantes.map((c) => {
    const groupes = [...c.empreintes].map((fp) => historique.get(cle(c.app_id, fp))).filter((h) => h?.first_seen);
    const statuts = new Set(groupes.map((h) => h.status));
    const statut = statuts.size === 0 ? "open" : statuts.size === 1 ? [...statuts][0] : "for_review";
    let premiere = { ts: c.premiere.ts, release: c.premiere.release ?? null };
    let derniere = { ts: c.derniere.ts, release: c.derniere.release ?? null };
    for (const h of groupes) {
      if (instant(h.first_seen) < instant(premiere.ts)) premiere = { ts: h.first_seen, release: h.first_release };
      if (instant(h.last_seen) > instant(derniere.ts)) derniere = { ts: h.last_seen, release: h.last_release };
    }
    const resolution = statut === "resolved"
      ? groupes.filter((h) => h.resolved_at).sort((a, b) => instant(b.resolved_at) - instant(a.resolved_at))[0]
      : null;
    return {
      ...c,
      origin: groupes.length ? "migration" : "new",
      status: statut,
      status_source: statuts.size === 0 ? "system" : "migration",
      premiere,
      derniere,
      resolved_at: resolution?.resolved_at ?? null,
      resolved_by_user_id: resolution?.resolved_by_user_id ?? null,
    };
  });
  const { rows } = await client.query(
    `insert into error_issue (app_id, grouping_version, grouping_key, grouping_basis, origin, status, status_source,
                              first_seen, last_seen, first_release, last_release, resolved_at, resolved_by_user_id)
     select app_id, $1, grouping_key, grouping_basis, origin, status, status_source,
            first_seen, last_seen, first_release, last_release, resolved_at, resolved_by_user_id
       from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[],
                   $8::timestamptz[], $9::timestamptz[], $10::text[], $11::text[], $12::timestamptz[], $13::bigint[])
         as n (app_id, grouping_key, grouping_basis, origin, status, status_source,
               first_seen, last_seen, first_release, last_release, resolved_at, resolved_by_user_id)
     on conflict (app_id, grouping_version, grouping_key) do nothing
     returning id, app_id, grouping_key`,
    [
      GROUPING_VERSION,
      nouvelles.map((n) => n.app_id),
      nouvelles.map((n) => n.grouping_key),
      nouvelles.map((n) => n.grouping_basis),
      nouvelles.map((n) => n.origin),
      nouvelles.map((n) => n.status),
      nouvelles.map((n) => n.status_source),
      nouvelles.map((n) => new Date(n.premiere.ts)),
      nouvelles.map((n) => new Date(n.derniere.ts)),
      nouvelles.map((n) => n.premiere.release),
      nouvelles.map((n) => n.derniere.release),
      nouvelles.map((n) => n.resolved_at),
      nouvelles.map((n) => n.resolved_by_user_id),
    ],
  );
  return new Map(rows.map((r) => [cle(r.app_id, r.grouping_key), r.id]));
}

/** Divergence avec l'état courant de l'issue, évaluée sur la ligne verrouillée. */
const DIVERGE = `(status_source <> 'user' and status <> 'for_review'
  and exists (select 1 from unnest($7::text[]) as historique where historique <> status))`;

/**
 * Fin de transaction : première et dernière vue des issues d'après les lignes
 * RÉELLEMENT insérées, et passage en `for_review` d'une issue qu'un groupe
 * historique rattaché ici contredit. Une issue par instruction, dans l'ordre des
 * identifiants ; une issue que rien ne change n'est ni modifiée ni verrouillée.
 */
export async function finaliserIssues(client, plan, inserees) {
  if (!plan) return;
  const parIssue = new Map();
  for (const r of inserees) {
    if (!r.issue_id) continue;
    const t = instant(r.ts);
    const u = parIssue.get(r.issue_id) ?? { app_id: r.app_id, premiere: null, derniere: null };
    if (!u.premiere || t < instant(u.premiere.ts)) u.premiere = { ts: r.ts, release: r.release ?? null };
    if (!u.derniere || t > instant(u.derniere.ts)) u.derniere = { ts: r.ts, release: r.release ?? null };
    parIssue.set(r.issue_id, u);
  }
  for (const id of plan.divergences.keys()) {
    if (!parIssue.has(id)) parIssue.set(id, { app_id: plan.apps.get(id), premiere: null, derniere: null });
  }
  for (const id of [...parIssue.keys()].sort()) {
    const u = parIssue.get(id);
    const statuts = plan.divergences.get(id);
    await client.query(
      `update error_issue
          set first_seen = case when $3::timestamptz < first_seen then $3::timestamptz else first_seen end,
              first_release = case when $3::timestamptz < first_seen then $4::text else first_release end,
              last_seen = case when $5::timestamptz > last_seen then $5::timestamptz else last_seen end,
              last_release = case when $5::timestamptz > last_seen then $6::text else last_release end,
              status = case when ${DIVERGE} then 'for_review' else status end,
              status_source = case when ${DIVERGE} then 'migration' else status_source end,
              revision = revision + case when ${DIVERGE} then 1 else 0 end,
              updated_at = now()
        where app_id = $1 and id = $2
          and ($3::timestamptz < first_seen or $5::timestamptz > last_seen or ${DIVERGE})`,
      [
        u.app_id,
        id,
        u.premiere ? new Date(u.premiere.ts) : null,
        u.premiere?.release ?? null,
        u.derniere ? new Date(u.derniere.ts) : null,
        u.derniere?.release ?? null,
        statuts ? [...statuts] : null,
      ],
    );
  }
}
