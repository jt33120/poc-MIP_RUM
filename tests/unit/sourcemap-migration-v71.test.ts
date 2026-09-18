// P5.4 — ce que migration-v71 doit garder vrai, lu dans le fichier.
//
// Le comportement est prouvé sur PostgreSQL (tests/integration/sourcemaps-p54-sql.test.ts).
// Ici on verrouille les propriétés que seul le TEXTE garantit, et qu'une migration
// ultérieure pourrait défaire sans qu'aucun test d'exécution ne le remarque :
// l'ordre des verrous, l'absence de validation sous verrou, et la présence des
// jetons dans CHAQUE redéfinition future de la purge et de l'effacement.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SQL = join(__dirname, "..", "..", "apps", "ingest", "sql");
const V71 = readFileSync(join(SQL, "migration-v71.sql"), "utf8");
const version = (f: string) => Number(f.match(/\d+/)![0]);

/**
 * Corps d'une fonction RECOPIÉE dans un fichier, jusqu'à sa fin `end $$;`.
 *
 * ANCRÉ EN DÉBUT DE LIGNE, et c'est une distinction de fond. Depuis v83, une
 * migration peut INSÉRER une instruction dans la définition COURANTE — `execute
 * 'create or replace function …' || quote_literal(replace(prosrc, ancre, ajout))`
 * — au lieu de recopier cent lignes. Cette forme-là ne peut RIEN perdre : elle
 * part du corps en place, quel qu'il soit. Ce garde-fou vise les RECOPIES, qui,
 * elles, le peuvent — c'est ainsi que v80 a repris la définition d'avant v79 et
 * perdu deux tables. `patchEnPlace` ci-dessous vérifie que toute occurrence non
 * ancrée est bien de la forme qui préserve.
 */
function corps(sql: string, fonction: string): string | null {
  const debut = sql.search(new RegExp(`^create or replace function ${fonction}\\(`, "m"));
  if (debut < 0) return null;
  const bloc = sql.slice(debut);
  return bloc.slice(0, bloc.indexOf("end $$;"));
}

/** Le fichier modifie-t-il la fonction EN PLACE, à partir de `prosrc` ? */
function patchEnPlace(sql: string, fonction: string): boolean {
  return new RegExp(`execute[^;]*create or replace function ${fonction}`, "s").test(sql)
    && /quote_literal\(replace\(src,/.test(sql);
}

describe("migration-v71", () => {
  it("borne l'attente de verrou dès la première instruction", () => {
    const instructions = V71.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--"));
    expect(instructions[0]).toBe("set local lock_timeout = '5s';");
  });

  it("ne prend le verrou exclusif de rum_error qu'en dernier, sans valider sa contrainte", () => {
    const alterErreur = V71.indexOf("alter table rum_error");
    for (const avant of ["update sourcemap", "create table if not exists sourcemap_upload_token", "create or replace function erase_app_data"]) {
      expect(V71.indexOf(avant), avant).toBeGreaterThan(-1);
      expect(V71.indexOf(avant), avant).toBeLessThan(alterErreur);
    }
    expect(V71.slice(alterErreur)).toContain(") not valid;");
    expect(V71).not.toMatch(/validate constraint/i);
  });

  it("met la table des jetons sous RLS tenant et ne donne à console_ro ni suppression ni réécriture du hash", () => {
    expect(V71).toContain("alter table sourcemap_upload_token enable row level security;");
    expect(V71).toContain("using (app_id = any (current_app_ids()))");
    expect(V71).toContain("grant select, insert on sourcemap_upload_token to console_ro;");
    expect(V71).toContain("grant update (revoked_at, revoked_by, last_used_at) on sourcemap_upload_token to console_ro;");
    expect(V71).not.toMatch(/grant[^;]*delete[^;]*sourcemap_upload_token/i);
  });

  it("calcule empreinte, taille et date par déclencheur, pour tout écrivain", () => {
    expect(V71).toContain("before insert or update on sourcemap");
    expect(V71).toContain("encode(sha256(convert_to(new.content, 'UTF8')), 'hex')");
  });
});

describe("toute redéfinition, v71 comprise, emporte les jetons", () => {
  const fichiers = readdirSync(SQL).filter((f) => /^migration-v\d+\.sql$/.test(f) && version(f) >= 71);

  it.each(["purge_rum_app", "erase_app_data"])("%s supprime sourcemap_upload_token", (fonction) => {
    const definitions = fichiers
      .map((f) => [f, corps(readFileSync(join(SQL, f), "utf8"), fonction)] as const)
      .filter(([, bloc]) => bloc !== null);
    expect(definitions.map(([f]) => f)).toContain("migration-v71.sql");
    for (const [f, bloc] of definitions) {
      expect(bloc, f).toMatch(/delete from sourcemap_upload_token\s+where app_id = p_app_id/);
    }
  });

  /**
   * L'autre forme, et la seule autre autorisée : la modification EN PLACE.
   *
   * Un fichier qui nomme `create or replace function erase_app_data` sans être
   * une recopie ancrée doit partir de `prosrc`. Sinon, une recopie indentée —
   * dans un `do $$` par exemple — passerait sous le garde-fou ci-dessus.
   */
  it("une redéfinition non recopiée part de la définition COURANTE", () => {
    for (const f of fichiers) {
      const sql = readFileSync(join(SQL, f), "utf8");
      for (const fonction of ["purge_rum_app", "erase_app_data"]) {
        if (!sql.includes(`create or replace function ${fonction}`)) continue;
        if (corps(sql, fonction) !== null) continue;
        expect(patchEnPlace(sql, fonction), `${f} / ${fonction}`).toBe(true);
      }
    }
  });
});
