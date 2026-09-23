// P1 — garde CI « une migration fusionnée ne se modifie plus »
// (`scripts/ci/migrations-figees.mjs`).
//
// Le migrateur ne rejoue jamais un fichier modifié après application : il le
// signale, et la production diverge d'une base neuve sans autre bruit. Ces
// tests tiennent la règle ligne à ligne (fonction pure), puis de bout en bout
// sur un vrai dépôt git jetable : c'est la forme sous laquelle la CI l'appelle.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  analyser,
  estFige,
  lireDiffRaw,
  main,
  verifierMigrationsFigees,
} from "../../scripts/ci/migrations-figees.mjs";

const A = "a".repeat(40);
const B = "b".repeat(40);
const Z = "0".repeat(40);
const e = (statut: string, chemin: string, avant = A, apres = B) => ({ statut, chemin, avant, apres });

describe("migrations figées — la règle", () => {
  it("ne fige que schema.sql et les migration-vNN.sql à la racine du dossier du registre", () => {
    expect(estFige("packages/db/sql/migration-v86.sql")).toBe(true);
    expect(estFige("packages/db/sql/schema.sql")).toBe(true);
    expect(estFige("apps/ingest/sql/migration-v02.sql")).toBe(true);
    expect(estFige("packages/db/sql/predeploy-v82-indexes.sql")).toBe(false);
    expect(estFige("packages/db/sql/pending/migration-v44-drop-deprecated-ai.sql")).toBe(false);
    expect(estFige("labs/clickhouse/schema.sql")).toBe(false);
    expect(estFige("packages/db/sql/migration-v86.sql.bak")).toBe(false);
  });

  it("accepte un ajout au-delà de la dernière migration de la base", () => {
    const r = analyser([e("A", "packages/db/sql/migration-v87.sql", Z, B)], { maxBase: 86 });
    expect(r.violations).toEqual([]);
    expect(r.ajoutees).toEqual(["packages/db/sql/migration-v87.sql"]);
  });

  // v87 d'une branche arrivée après la v88 d'une autre : en production elle
  // passerait après v88, sur une base neuve avant. Même chose pour un trou.
  it("refuse un ajout qui ne dépasse pas la dernière migration de la base", () => {
    for (const nom of ["migration-v86.sql", "migration-v44.sql"]) {
      const r = analyser([e("A", `packages/db/sql/${nom}`, Z, B)], { maxBase: 86 });
      expect(r.violations).toHaveLength(1);
      expect(r.violations[0].raison).toMatch(/renuméroter/);
    }
  });

  it("refuse une modification, un changement de type et une suppression", () => {
    const r = analyser(
      [
        e("M", "packages/db/sql/migration-v84.sql"),
        e("T", "packages/db/sql/migration-v85.sql"),
        e("D", "packages/db/sql/migration-v83.sql", A, Z),
        e("M", "packages/db/sql/schema.sql"),
      ],
      { maxBase: 86 },
    );
    expect(r.violations.map((v) => v.chemin)).toEqual([
      "packages/db/sql/migration-v84.sql",
      "packages/db/sql/migration-v85.sql",
      "packages/db/sql/migration-v83.sql",
      "packages/db/sql/schema.sql",
    ]);
  });

  // Le déménagement de P1 : apps/ingest/sql → packages/db/sql, contenu identique.
  it("accepte un déplacement à contenu identique et nom inchangé", () => {
    const r = analyser(
      [
        e("D", "apps/ingest/sql/migration-v02.sql", A, Z),
        e("A", "packages/db/sql/migration-v02.sql", Z, A),
      ],
      { maxBase: 86 },
    );
    expect(r.violations).toEqual([]);
    expect(r.deplacees).toEqual([{ de: "apps/ingest/sql/migration-v02.sql", vers: "packages/db/sql/migration-v02.sql" }]);
    expect(r.ajoutees).toEqual([]);
  });

  it("refuse un déplacement qui modifie, et un renommage", () => {
    const deplaceModifie = analyser(
      [e("D", "apps/ingest/sql/schema.sql", A, Z), e("A", "packages/db/sql/schema.sql", Z, B)],
      { maxBase: 86 },
    );
    expect(deplaceModifie.violations).toEqual([
      { chemin: "packages/db/sql/schema.sql", raison: "déplacée depuis apps/ingest/sql/schema.sql ET modifiée" },
    ]);
    // v50 → v51 : le registre garde v50, et appliquerait « v51 » une seconde fois.
    const renomme = analyser(
      [e("D", "packages/db/sql/migration-v50.sql", A, Z), e("A", "packages/db/sql/migration-v51.sql", Z, A)],
      { maxBase: 86 },
    );
    expect(renomme.violations.map((v) => v.chemin)).toEqual([
      "packages/db/sql/migration-v50.sql",
      "packages/db/sql/migration-v51.sql",
    ]);
  });

  it("ignore les scripts de pré-déploiement et pending/", () => {
    const r = analyser(
      [
        e("M", "packages/db/sql/predeploy-v82-indexes.sql"),
        e("D", "packages/db/sql/pending/migration-v44-drop-deprecated-ai.sql", A, Z),
      ],
      { maxBase: 86 },
    );
    expect(r).toEqual({ violations: [], deplacees: [], ajoutees: [] });
  });

  it("lit la sortie brute de git diff --raw -z", () => {
    const sortie =
      `:000000 100644 ${Z} ${B} A\0packages/db/sql/migration-v87.sql\0` +
      `:100644 100644 ${A} ${B} M\0packages/db/sql/migration-v84.sql\0`;
    expect(lireDiffRaw(sortie)).toEqual([
      { statut: "A", chemin: "packages/db/sql/migration-v87.sql", avant: Z, apres: B },
      { statut: "M", chemin: "packages/db/sql/migration-v84.sql", avant: A, apres: B },
    ]);
    expect(lireDiffRaw("")).toEqual([]);
  });
});

// De bout en bout, sur un dépôt git jetable : exactement ce que fait la CI.
describe("migrations figées — sur un vrai dépôt git", () => {
  // Lancés depuis un crochet git, ces tests hériteraient de GIT_DIR et
  // viseraient le dépôt du projet au lieu du dépôt jetable.
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete process.env[k];
  const depot = mkdtempSync(join(tmpdir(), "migrations-figees-"));
  afterAll(() => rmSync(depot, { recursive: true, force: true }));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@test.local", "-c", "commit.gpgsign=false", ...args], {
      cwd: depot,
      encoding: "utf8",
    });
  const ecrire = (chemin: string, contenu: string) => {
    mkdirSync(dirname(join(depot, chemin)), { recursive: true });
    writeFileSync(join(depot, chemin), contenu);
  };
  const commit = (message: string) => {
    git("add", "-A");
    git("commit", "-q", "--allow-empty", "-m", message);
  };
  const silencieux = () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    return () => (log.mockRestore(), err.mockRestore());
  };

  git("init", "-q", "-b", "master");
  // L'ancien emplacement, comme origin/master avant P1.
  ecrire("apps/ingest/sql/schema.sql", "create table t (id int);\n");
  ecrire("apps/ingest/sql/migration-v01.sql", "alter table t add column a int;\n");
  ecrire("apps/ingest/sql/migration-v02.sql", "alter table t add column b int;\n");
  ecrire("apps/ingest/sql/predeploy-v02-indexes.sql", "-- chemin ancien\n");
  commit("base");

  it("accepte le déménagement du dossier et une migration nouvelle", () => {
    git("checkout", "-q", "-b", "p1");
    mkdirSync(join(depot, "packages/db"), { recursive: true });
    renameSync(join(depot, "apps/ingest/sql"), join(depot, "packages/db/sql"));
    // Le déménagement réécrit les commentaires du pré-déploiement : permis.
    ecrire("packages/db/sql/predeploy-v02-indexes.sql", "-- chemin nouveau\n");
    ecrire("packages/db/sql/migration-v03.sql", "alter table t add column c int;\n");
    commit("déménagement");
    const r = verifierMigrationsFigees({ base: "master", cwd: depot });
    expect(r.maxBase).toBe(2);
    expect(r.violations).toEqual([]);
    expect(r.deplacees).toHaveLength(3);
    expect(r.ajoutees).toEqual(["packages/db/sql/migration-v03.sql"]);
    const retablir = silencieux();
    try {
      expect(main(["master"], { cwd: depot, env: {} })).toBe(0);
    } finally {
      retablir();
    }
  });

  it("refuse une migration fusionnée modifiée, et le dit par une annotation en CI", () => {
    ecrire("packages/db/sql/migration-v01.sql", "alter table t add column a bigint;\n");
    commit("modification");
    const r = verifierMigrationsFigees({ base: "master", cwd: depot });
    expect(r.violations).toEqual([
      { chemin: "packages/db/sql/migration-v01.sql", raison: "déplacée depuis apps/ingest/sql/migration-v01.sql ET modifiée" },
    ]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(main(["master"], { cwd: depot, env: { GITHUB_ACTIONS: "true" } })).toBe(1);
      expect(log.mock.calls.flat().join("\n")).toContain("::error file=packages/db/sql/migration-v01.sql::");
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
  });

  it("une fois le déménagement fusionné, refuse modification et suppression dans le nouveau dossier", () => {
    git("checkout", "-q", "master");
    git("merge", "-q", "--ff-only", "p1");
    git("checkout", "-q", "-b", "suite");
    ecrire("packages/db/sql/schema.sql", "create table t (id bigint);\n");
    unlinkSync(join(depot, "packages/db/sql/migration-v02.sql"));
    commit("suite");
    const r = verifierMigrationsFigees({ base: "master", cwd: depot });
    expect(r.violations.map((v) => v.chemin).sort()).toEqual([
      "packages/db/sql/migration-v02.sql",
      "packages/db/sql/schema.sql",
    ]);
  });

  it("une base introuvable est un échec (code 2), jamais un succès", () => {
    const retablir = silencieux();
    try {
      expect(main(["origin/inexistante"], { cwd: depot, env: {} })).toBe(2);
      expect(main([], { cwd: depot, env: {} })).toBe(2);
    } finally {
      retablir();
    }
    expect(() => verifierMigrationsFigees({ base: "origin/inexistante", cwd: depot })).toThrow(/fetch-depth: 0/);
  });
});
