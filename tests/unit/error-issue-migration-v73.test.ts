// P5.6 — ce que migration-v73 doit garder vrai, lu dans le fichier.
//
// Le comportement est prouvé sur PostgreSQL (tests/integration/error-issues-sql.test.ts).
// Ici on verrouille des propriétés que seul le TEXTE garantit et qu'une migration
// ultérieure pourrait défaire sans qu'un test d'exécution ne le remarque : aucun
// curseur d'identifiants pour notifier, aucun verrou de session, aucun ordre
// lexical de releases, et un cycle de vie porté par les clés étrangères plutôt
// que par une énième redéfinition de la purge.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SQL = join(__dirname, "..", "..", "apps", "ingest", "sql");
const V73 = readFileSync(join(SQL, "migration-v73.sql"), "utf8");

/** Corps d'une fonction, de son `create or replace` jusqu'à la fin de son bloc dollar. */
function corps(fonction: string): string {
  const debut = V73.indexOf(`create or replace function ${fonction}(`);
  expect(debut, fonction).toBeGreaterThan(-1);
  const bloc = V73.slice(debut);
  const delimiteur = bloc.match(/as (\$\w*\$)/)![1];
  const ouverture = bloc.indexOf(delimiteur);
  return bloc.slice(0, bloc.indexOf(delimiteur, ouverture + delimiteur.length));
}

const instructions = V73.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--"));

describe("migration-v73 — déploiement", () => {
  it("borne l'attente de verrou dès la première instruction et exige v72", () => {
    expect(instructions[0]).toBe("set local lock_timeout = '5s';");
    expect(V73).toContain("if to_regclass('public.error_issue') is null then");
  });

  it("ne redéfinit ni la purge ni l'effacement : les trois tables suivent leur issue en cascade", () => {
    expect(V73).not.toMatch(/create or replace function (purge_rum_app|erase_app_data|purge_rum_tenants)\(/);
    for (const table of ["error_issue_ticket", "error_issue_activity", "error_issue_notification"]) {
      const debut = V73.indexOf(`create table if not exists ${table} (`);
      const definition = V73.slice(debut, V73.indexOf(");\n", debut));
      expect(definition, table).toMatch(/foreign key \(app_id, issue_id\)\s+references error_issue \(app_id, id\) on delete cascade/);
    }
  });

  it("n'utilise que des verrous de transaction : le pooler Neon perd un verrou de session", () => {
    expect(V73).not.toMatch(/pg_advisory_lock\(|pg_try_advisory_lock\(/);
    expect(corps("route_error_issue_notifications")).toContain("for update skip locked");
    expect(corps("check_alerts")).toContain("perform pg_advisory_xact_lock(r.id);");
  });
});

describe("migration-v73 — RLS et droits", () => {
  it("met les trois tables sous RLS tenant ; la console n'écrit jamais l'outbox", () => {
    for (const table of ["error_issue_ticket", "error_issue_activity", "error_issue_notification"]) {
      expect(V73).toContain(`alter table ${table} enable row level security;`);
    }
    expect(V73).toContain("grant select, insert on error_issue_ticket, error_issue_activity to console_ro;");
    expect(V73).toContain("grant select on error_issue_notification to console_ro;");
    expect(V73).not.toMatch(/grant[^;]*(update|delete)[^;]*on error_issue_(activity|ticket|notification)/i);
    expect(V73).toMatch(/grant update \(status, status_source, assignee_user_id, resolved_at, resolved_by_user_id,\s+resolved_release, resolved_env, revision, updated_at\) on error_issue to console_ro;/);
    expect(V73).toContain("create policy tenant_triage on error_issue\n  for update to console_ro");
  });
});

describe("migration-v73 — notifications sans curseur", () => {
  it("une nouvelle issue notifie par déclencheur, seulement si elle est vraiment nouvelle", () => {
    expect(V73).toContain("for each row when (new.origin = 'new')");
    expect(corps("error_issue_notify_new_v73")).toContain("on conflict (event_key) do nothing");
  });

  it("check_new_errors garde son watermark pour l'historique mais ignore les lignes d'une issue", () => {
    const fonction = corps("check_new_errors");
    expect(fonction).toContain("rum_new_error_watermark");
    expect(fonction).toContain("and e.issue_id is null");
  });

  it("la régression se décide sous verrou de l'issue, par l'ordre des marqueurs de déploiement", () => {
    const fonction = corps("error_issue_record_occurrences");
    // Seule une issue résolue est verrouillée : une issue ouverte d'un lot ne coûte aucun verrou.
    expect(fonction).toMatch(/from error_issue\s+where app_id = p_app_id and id = p_issue_id and status = 'resolved'\s+for update;/);
    expect(fonction).toContain("from deploy_marker m");
    expect(fonction).toContain("m.env = i.resolved_env");
    // Jamais de comparaison de releases comme chaînes : seul l'instant du premier marqueur ordonne.
    expect(fonction).not.toMatch(/release\s*[<>]|order by [^;]*release/);
    expect(fonction).toContain("occ.deployed_at > (");
  });

  it("le pic d'une issue part dans l'outbox sous une clé de fenêtre, après le même délai de grâce", () => {
    const fonction = corps("check_alerts");
    expect(fonction).toContain("format('spike:%s:%s', r.id, floor(extract(epoch from now()) / (r.window_minutes * 60))::bigint)");
    expect(fonction).toContain("where n.rule_id = r.id and n.state = 'pending'");
    expect(fonction).toContain("last_state = case when no_data is not null then 'no_data' when breached then 'breached' else 'ok' end");
    // Alignement P4 : minimum de 4 comparables, MAD=0 permis.
    expect(fonction).toContain("if b.n >= 4 and b.mad is not null then");
  });

  it("l'arriéré sans règle est soldé une fois, daté par la première application", () => {
    expect(V73).toContain("set rule_less_dispatch_since = coalesce(rule_less_dispatch_since, now())");
    expect(V73).toContain("e.rule_id is null and c.singleton and e.fired_at < c.rule_less_dispatch_since");
  });
});
