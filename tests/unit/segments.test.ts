// Moteur de segments v1 — logique pure.
import { describe, expect, it } from "vitest";
import {
  buildSegment,
  describeCond,
  parseSegment,
  type SegCond,
  serializeSegment,
} from "../../apps/console/lib/segments";

describe("parseSegment", () => {
  it("parse une conjonction de conditions valides", () => {
    expect(parseSegment("geo==FR;device!=mobile")).toEqual([
      { dim: "geo", op: "==", value: "FR" },
      { dim: "device", op: "!=", value: "mobile" },
    ]);
  });
  it("ignore les dimensions hors allowlist", () => {
    expect(parseSegment("evil==1;geo==FR")).toEqual([{ dim: "geo", op: "==", value: "FR" }]);
  });
  it("ignore les jetons mal formés et les valeurs vides", () => {
    expect(parseSegment("geo==;device;==FR;geo==DE")).toEqual([
      { dim: "geo", op: "==", value: "DE" },
    ]);
  });
  it("tronque les valeurs trop longues et renvoie [] sur entrée vide", () => {
    expect(parseSegment("")).toEqual([]);
    expect(parseSegment(null)).toEqual([]);
    expect(parseSegment(undefined)).toEqual([]);
    const long = parseSegment(`geo==${"A".repeat(200)}`);
    expect(long[0].value).toHaveLength(120);
  });
});

describe("serializeSegment", () => {
  it("round-trip avec parseSegment", () => {
    const raw = "geo==FR;device!=mobile;client==mip";
    expect(serializeSegment(parseSegment(raw))).toBe(raw);
  });
  it("écarte les conditions invalides", () => {
    const conds: SegCond[] = [
      { dim: "geo", op: "==", value: "FR" },
      { dim: "nope", op: "==", value: "x" },
      { dim: "device", op: "==", value: "" },
    ];
    expect(serializeSegment(conds)).toBe("geo==FR");
  });
});

describe("buildSegment", () => {
  it("compile en SQL paramétré à partir de startIndex", () => {
    const seg = buildSegment(parseSegment("geo==FR;device!=mobile"), 3);
    expect(seg.params).toEqual(["FR", "mobile"]);
    expect(seg.where("s")).toBe(" and s.geo_country = $3 and s.device_type <> $4");
  });
  it("réutilise les mêmes binds pour un autre alias (sous-requêtes)", () => {
    const seg = buildSegment(parseSegment("geo==FR"), 5);
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
    const seg = buildSegment(parseSegment("geo==FR' or '1'='1"), 1);
    // la valeur reste un bind, la chaîne SQL ne contient que $1
    expect(seg.where("s")).toBe(" and s.geo_country = $1");
    expect(seg.params).toEqual(["FR' or '1'='1"]);
  });
  it("Ext-A : la dimension source cible rum_session.collection_source", () => {
    const seg = buildSegment(parseSegment("source==extension"), 1);
    expect(seg.where("s")).toBe(" and s.collection_source = $1");
    expect(seg.params).toEqual(["extension"]);
    expect(describeCond({ dim: "source", op: "==", value: "extension" })).toBe(
      "Source = extension",
    );
  });
});

describe("describeCond", () => {
  it("rend un libellé lisible", () => {
    expect(describeCond({ dim: "geo", op: "==", value: "FR" })).toBe("Pays = FR");
    expect(describeCond({ dim: "device", op: "!=", value: "mobile" })).toBe("Appareil ≠ mobile");
  });
});
