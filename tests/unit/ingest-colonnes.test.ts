// Construction de l'écriture de session quand la migration n'est pas encore
// passée. Sur ce projet le déploiement est automatique et la migration MANUELLE :
// entre les deux, l'INSERT référencerait une colonne absente, et Postgres
// rejetterait la requête ENTIÈRE — donc la transaction, donc tout le lot. Ce
// n'est pas le champ nouveau qui se perdrait, c'est TOUTE la télémétrie.
import { describe, expect, it } from "vitest";
// @ts-expect-error — module JS sans types, importé tel quel par la route d'ingestion
import { clauseConflitSession, colonnesInsert } from "../../apps/ingest/lib/pg-ingest.mjs";

const TOUTES = new Set(["collection_source", "release", "net_type"]);
const AUCUNE = new Set<string>();

describe("colonnesInsert", () => {
  it("écrit les colonnes optionnelles quand la base les porte", () => {
    const c = colonnesInsert(TOUTES) as string[];
    expect(c).toContain("collection_source");
    expect(c).toContain("release");
    expect(c).toContain("net_type");
  });

  it("les omet quand la migration n'est pas passée, sans toucher au reste", () => {
    const c = colonnesInsert(AUCUNE) as string[];
    expect(c).not.toContain("release");
    expect(c).not.toContain("net_type");
    // le socle reste intact : c'est lui qui porte la télémétrie
    expect(c).toEqual([
      "session_id", "app_id", "client_id", "user_hash", "user_agent",
      "device_type", "geo_country", "is_bot", "started_at", "last_seen_at", "page_count",
    ]);
  });

  it("gère une migration à moitié appliquée", () => {
    const c = colonnesInsert(new Set(["release"])) as string[];
    expect(c).toContain("release");
    expect(c).not.toContain("net_type");
  });
});

describe("clauseConflitSession", () => {
  // Bug réellement commis : la clause était une chaîne à trous, et
  // `last_seen_at` s'y retrouvait assigné deux fois — Postgres rejette
  // l'INSERT entier avec « multiple assignments to same column ».
  it("n'assigne jamais deux fois la même colonne", () => {
    for (const dispo of [TOUTES, AUCUNE, new Set(["net_type"])]) {
      const cols = (clauseConflitSession(dispo) as string)
        .replace(/^on conflict \(session_id\) do update set /, "")
        .split(", ")
        .map((c) => c.split("=")[0].trim());
      expect(new Set(cols).size).toBe(cols.length);
    }
  });

  // Autre bug commis : une clause optionnelle vide laissait une virgule orpheline.
  it("ne laisse ni virgule orpheline ni clause vide", () => {
    for (const dispo of [TOUTES, AUCUNE]) {
      const sql = clauseConflitSession(dispo) as string;
      expect(sql).not.toMatch(/,\s*,/);
      expect(sql).not.toMatch(/,\s*$/);
      expect(sql).not.toMatch(/set\s*,/);
    }
  });

  it("n'écrase jamais release ni net_type une fois posés", () => {
    const sql = clauseConflitSession(TOUTES) as string;
    expect(sql).toContain("release = coalesce(rum_session.release, excluded.release)");
    expect(sql).toContain("net_type = coalesce(rum_session.net_type, excluded.net_type)");
  });

  // La source de collecte est figée à la première vue de la session : la
  // remettre à jour ferait basculer une session d'extension vers 'sdk' au
  // premier lot suivant qui ne porte pas l'attribut.
  it("ne met jamais collection_source à jour", () => {
    expect(clauseConflitSession(TOUTES) as string).not.toContain("collection_source");
  });
});
