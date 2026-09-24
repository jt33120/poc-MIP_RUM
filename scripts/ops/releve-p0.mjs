// Relevé P0 — l'état de la production, en lecture seule.
//
// POURQUOI CE SCRIPT. Cinq portes du plan de réorganisation dépendent de chiffres
// que personne n'avait relevés : le registre des migrations (est-il vrai que v83
// est appliquée, ou est-ce une déduction des journaux ?), le dernier événement
// reçu par app (la ligne de base vaut-elle zéro ?), les apps sans clé d'API
// (passeront-elles en 403 le jour où `REQUIRE_API_KEY` sera vrai ?), la provenance
// du pays, et la taille des files de livraison. Les affirmer sans les lire, c'est
// exactement ce qui a fait croire pendant douze jours que l'ingestion tournait.
//
// LECTURE SEULE, ET RIEN D'AUTRE : que des `select`. Aucune écriture, aucun DDL.
//
// Usage :
//   railway run --service scheduler node scripts/ops/releve-p0.mjs
//   DATABASE_URL=… node scripts/ops/releve-p0.mjs
import pg from "pg";
import { creerPool, cible } from "../../packages/backend/lib/serveur.mjs";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL absent — passer par `railway run --service scheduler`.");
  process.exit(2);
}

const pool = creerPool(pg, { max: 2 });

/** Une question, sa requête, et ce qu'elle décide dans le plan. */
const RELEVES = [
  {
    titre: "Migrations appliquées (les 8 dernières)",
    decide: "R2 — v83 et v85 sont-elles lues en base, ou seulement déduites des journaux ?",
    sql: `select filename, applied_at, applied_by
            from schema_migration order by filename desc limit 8`,
  },
  {
    titre: "Taille du registre des migrations",
    decide: "P1 — le migrateur annonce `modifiees=N` à chaque passage : ce total sert de repère.",
    sql: `select count(*)::int as fichiers_enregistres from schema_migration`,
  },
  {
    titre: "Dernier événement par application",
    decide: "R1 — la ligne de base d'ingestion vaut-elle zéro ? P3 compare ±10 % à ce chiffre.",
    sql: `select app_id, count(*)::int as evenements, max(ts) as dernier
            from rum_event group by 1 order by 3 desc nulls last limit 10`,
  },
  {
    titre: "Applications enregistrées et clé d'API",
    decide: "R8a — quelles apps prendraient 403 le jour où le collecteur exige la clé ?",
    sql: `select app_id, (api_key_hash is null) as sans_cle, active
            from app_registry order by app_id`,
  },
  {
    titre: "Provenance du pays des sessions (30 derniers jours)",
    decide: "R6 — état de départ avant d'activer la résolution par adresse IP.",
    sql: `select coalesce(geo_source, '(nul)') as source, count(*)::int as sessions
            from rum_session where started_at > now() - interval '30 days'
            group by 1 order by 2 desc`,
  },
  {
    titre: "Files de livraison",
    decide: "P5 — état des outbox avant de sortir la livraison du scheduler.",
    sql: `select status, count(*)::int as lignes
            from alert_delivery group by 1 order by 2 desc`,
  },
  {
    titre: "Intégrations de tickets",
    decide: "P5 — `TICKET_SECRET_KEY` et les références `env:` sont-ils nécessaires dès maintenant ?",
    sql: `select id, provider, state, credential_ref from ticket_integration order by id`,
  },
  {
    titre: "Administrateurs au périmètre restreint",
    decide: "C8/C9 — combien de comptes la règle de portée changerait-elle ?",
    sql: `select email, role, apps from console_user
            where role = 'admin' and apps is not null order by email`,
  },
  {
    titre: "Sondes de disponibilité",
    decide: "P1 — deux sondes sur trois étaient DOWN le 23/09 : lesquelles, et depuis quand ?",
    sql: `select c.id, c.name, c.url, c.enabled, d.ok, d.status_code, d.error, d.ts as depuis
            from uptime_check c
            left join lateral (
              select r.ok, r.status_code, r.error, r.ts from uptime_result r
               where r.check_id = c.id order by r.ts desc limit 1
            ) d on true
            order by c.id`,
  },
  {
    titre: "Connexions ouvertes, par application cliente",
    decide: "C0 — budget de connexions Neon avant d'ajouter collector, api et console-api.",
    sql: `select coalesce(nullif(application_name, ''), '(sans nom)') as client,
                 state, count(*)::int as connexions
            from pg_stat_activity where datname = current_database()
            group by 1, 2 order by 3 desc`,
  },
  {
    titre: "Taille de la base, et des objets volumineux",
    decide: "ADR-0009 / ADR-0014 — sortir le rejeu de Postgres au-delà de la moitié du stockage (0,5 Go sur l'offre gratuite).",
    sql: `select pg_size_pretty(pg_database_size(current_database())) as base,
                 pg_size_pretty(pg_total_relation_size('replay_chunk')) as rejeu,
                 pg_size_pretty(pg_total_relation_size('sourcemap')) as source_maps,
                 pg_size_pretty(pg_total_relation_size('rum_event')) as evenements`,
  },
  {
    titre: "Cadence publiée par le scheduler",
    decide: "ADR-0014 — la vitrine lit cette valeur ; absente avant le premier tick d'un scheduler à jour.",
    sql: `select key, value, updated_at, updated_by from platform_flag order by key`,
  },
  {
    titre: "Plafond de connexions",
    decide: "C0 — la somme des pools doit rester sous ce chiffre.",
    sql: `select setting as max_connections from pg_settings where name = 'max_connections'`,
  },
];

const lignes = [];
for (const releve of RELEVES) {
  try {
    const { rows } = await pool.query(releve.sql);
    lignes.push({ ...releve, rows });
  } catch (err) {
    lignes.push({ ...releve, erreur: String(err?.message ?? err) });
  }
}
await pool.end().catch(() => {});

console.log("# Relevé P0 —", new Date().toISOString());
console.log("Base :", JSON.stringify(cible()), "\n");
for (const l of lignes) {
  console.log("## " + l.titre);
  console.log("   décide : " + l.decide);
  if (l.erreur) console.log("   ERREUR : " + l.erreur);
  else if (!l.rows.length) console.log("   (aucune ligne)");
  else for (const r of l.rows) console.log("   " + JSON.stringify(r));
  console.log("");
}
