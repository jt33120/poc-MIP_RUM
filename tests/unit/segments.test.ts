// Moteur de segments v1 — compilateur historique (lectures non migrées), logique pure.
// La lecture des segments d'URL (v1 et v2) est testée avec le contrat commun
// (tests/unit/query-contract.test.ts) ; `legacySegment` fait le pont.
import { describe, expect, it } from "vitest";
import { legacySegment } from "../../apps/console/lib/filters";
import { parseSegmentParam } from "../../apps/console/lib/query-contract";
import { buildSegment, type SegCond } from "../../apps/console/lib/segments";

/** Segment d'URL -> conditions historiques, comme le reçoivent les lectures non migrées. */
function depuisUrl(raw: string): SegCond[] {
  const parsed = parseSegmentParam(raw);
  if (!parsed.ok) throw new Error(parsed.error.code);
  return legacySegment(parsed.value);
}

describe("legacySegment — pont contrat -> lectures historiques", () => {
  it("rend les conditions v1 d'un segment v1 ou v2", () => {
    const attendu = [
      { dim: "geo", op: "==", value: "FR" },
      { dim: "device", op: "!=", value: "mobile" },
    ];
    expect(depuisUrl("geo==FR;device!=mobile")).toEqual(attendu);
    expect(depuisUrl("v2:country:eq:FR;device:neq:mobile")).toEqual(attendu);
  });

  it("n'invente rien pour ce que le modèle historique ne sait pas dire", () => {
    // « Inconnu » et les dimensions P6 n'ont pas d'équivalent v1 : l'écran les refuse en amont.
    expect(depuisUrl("v2:country:is_null;browser:eq:Firefox")).toEqual([]);
  });
});

describe("buildSegment", () => {
  it("compile en SQL paramétré à partir de startIndex", () => {
    const seg = buildSegment(depuisUrl("geo==FR;device!=mobile"), 3);
    expect(seg.params).toEqual(["FR", "mobile"]);
    expect(seg.where("s")).toBe(" and s.geo_country = $3 and s.device_type <> $4");
  });
  it("réutilise les mêmes binds pour un autre alias (sous-requêtes)", () => {
    const seg = buildSegment(depuisUrl("geo==FR"), 5);
    expect(seg.where("s")).toBe(" and s.geo_country = $5");
    expect(seg.where("ps")).toBe(" and ps.geo_country = $5");
    expect(seg.where("ls")).toBe(" and ls.geo_country = $5");
    expect(seg.params).toEqual(["FR"]); // params UNE seule fois
  });
  it("segment vide -> where() vide et aucun param", () => {
    const seg = buildSegment([], 2);
    expect(seg.params).toEqual([]);
    expect(seg.where("s")).toBe("");
  });
  it("les valeurs ne sont jamais concaténées dans le SQL (anti-injection)", () => {
    const seg = buildSegment(depuisUrl("geo==FR' or '1'='1"), 1);
    // la valeur reste un bind, la chaîne SQL ne contient que $1
    expect(seg.where("s")).toBe(" and s.geo_country = $1");
    expect(seg.params).toEqual(["FR' or '1'='1"]);
  });
  it("Ext-A : la dimension source cible rum_session.collection_source", () => {
    const seg = buildSegment(depuisUrl("source==extension"), 1);
    expect(seg.where("s")).toBe(" and s.collection_source = $1");
    expect(seg.params).toEqual(["extension"]);
  });
  it("ignore une dimension hors allowlist (défense en profondeur)", () => {
    const seg = buildSegment([{ dim: "evil", op: "==", value: "1" }], 1);
    expect(seg.where("s")).toBe("");
    expect(seg.params).toEqual([]);
  });
});
