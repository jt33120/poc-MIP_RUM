// P5.6, suivi de revue — ce que migration-v74 doit garder vrai, lu dans le fichier.
//
// Le comportement est prouvé sur PostgreSQL (tests/integration/error-issues-sql.test.ts).
// Ici : un fichier de corrections qui ne touche aucune table, un verrou d'issue qui
// n'attend plus les clés étrangères, des releases bornées avant d'entrer dans une
// charge ou une activité, et un watermark qui ne lâche que les issues déjà notifiées.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SQL = join(__dirname, "..", "..", "apps", "ingest", "sql");
const V74 = readFileSync(join(SQL, "migration-v74.sql"), "utf8");

/** Corps d'une fonction, de son `create or replace` jusqu'à la fin de son bloc dollar. */
function corps(fonction: string): string {
  const debut = V74.indexOf(`create or replace function ${fonction}(`);
  expect(debut, fonction).toBeGreaterThan(-1);
  const bloc = V74.slice(debut);
  const delimiteur = bloc.match(/as (\$\w*\$)/)![1];
  const ouverture = bloc.indexOf(delimiteur);
  return bloc.slice(0, bloc.indexOf(delimiteur, ouverture + delimiteur.length));
}

const instructions = V74.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--"));

describe("migration-v74", () => {
  it("borne l'attente de verrou, exige v73 et ne redéfinit que quatre fonctions", () => {
    expect(instructions[0]).toBe("set local lock_timeout = '5s';");
    expect(V74).toContain("if to_regclass('public.error_issue_notification') is null then");
    expect(V74).not.toMatch(/^\s*(create|alter|drop) (table|index|policy|trigger)/im);
    expect([...V74.matchAll(/create or replace function (\w+)\(/g)].map((m) => m[1])).toEqual([
      "error_issue_notify_new_v73",
      "error_issue_record_occurrences",
      "check_new_errors",
      "issue_metric_baseline",
    ]);
  });

  it("la notification d'une nouvelle issue ne recopie qu'une release courte", () => {
    const fonction = corps("error_issue_notify_new_v73");
    expect(fonction).toContain("when octet_length(new.first_release) between 1 and 200 and new.first_release !~ '[[:cntrl:]]'");
    expect(fonction).not.toContain("new.first_release,");
    expect(fonction).toContain("on conflict (event_key) do nothing");
  });

  it("la régression verrouille sans attendre les clés étrangères et ne confirme que des releases bornées", () => {
    const fonction = corps("error_issue_record_occurrences");
    expect(fonction).toMatch(/and status = 'resolved'\s+for no key update;/);
    expect(fonction).not.toMatch(/for update;/);
    expect(fonction).toContain("octet_length(i.resolved_release) between 1 and 200");
    expect(fonction).toContain("octet_length(i.resolved_env) between 1 and 120");
    expect(fonction).toContain("and octet_length(o.release) between 1 and 200 and o.release !~ '[[:cntrl:]]'");
    // Toujours l'ordre des marqueurs, jamais celui des chaînes.
    expect(fonction).not.toMatch(/release\s*[<>]|order by [^;]*release/);
  });

  it("check_new_errors n'écarte que les lignes d'une issue déjà notifiée", () => {
    const fonction = corps("check_new_errors");
    expect(fonction).toContain("rum_new_error_watermark");
    expect(fonction).not.toContain("and e.issue_id is null");
    expect(fonction).toMatch(/not exists \(\s+select 1 from error_issue_notification n\s+where n.event_key = 'new:' \|\| e.issue_id\s+\)/);
  });

  it("une issue non suivie n'a aucune fenêtre comparable", () => {
    expect(corps("issue_metric_baseline")).toContain("select case when suivi.depuis is not null then greatest(");
  });
});
