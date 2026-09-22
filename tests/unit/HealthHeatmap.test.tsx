// HealthHeatmap (F05, plan § 4.1, R-S, R-T) : une intensité sans verdict, des cases
// qui ouvrent LEUR heure en instants UTC, et des jours lus dans le repère de l'app.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HealthHeatmap, type CaseSante } from "@/components/charts/HealthHeatmap";
import { RATING_HEX } from "@/lib/palette";

const PARIS = "Europe/Paris";
const JOURS = ["2026-07-13", "2026-07-14", "2026-07-15"]; // lundi, mardi, mercredi
// Rendu à 18:00 à Paris le 15/07 : toutes les cases du matin sont des heures closes.
const MAINTENANT = Date.parse("2026-07-15T16:00:00Z");
const GABARIT = "/?app=demo&from={from}&to={to}";

const decode = (html: string) => html.replace(/&amp;/g, "&");
const liens = (html: string) =>
  [...decode(html).matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => decodeURIComponent(m[1]));

function rendu(cellules: CaseSante[], extra: Partial<Parameters<typeof HealthHeatmap>[0]> = {}) {
  return renderToStaticMarkup(
    <HealthHeatmap jours={JOURS} cellules={cellules} fuseau={PARIS} zoomHref={GABARIT} maintenant={MAINTENANT} {...extra} />,
  );
}

describe("HealthHeatmap — échelle séquentielle, aucun verdict", () => {
  it("aucune classe ni couleur de verdict (vert / ambre / rouge)", () => {
    const html = rendu([
      { day: "2026-07-15", hour: 9, good_w: 1, total_w: 1 },
      { day: "2026-07-15", hour: 10, good_w: 1, total_w: 2 },
      { day: "2026-07-15", hour: 11, good_w: 0, total_w: 3 },
    ]);
    expect(html).not.toMatch(/\b(?:bg|text|border|ring|fill|from|to)-(?:good|warn|bad)\b/);
    expect(html).not.toMatch(/emerald-|amber-|red-\d/);
    for (const hex of Object.values(RATING_HEX)) expect(html.toLowerCase()).not.toContain(hex.toLowerCase());
    // La légende dit l'échelle, pas un verdict.
    expect(html).toContain("% de mesures « Bon » (pondéré)");
  });
});

describe("HealthHeatmap — une case ouvre SON heure, en instants UTC", () => {
  it("Europe/Paris, case 9 h un jour d'été → from=…T07:00:00Z, to=…T08:00:00Z", () => {
    const html = rendu([{ day: "2026-07-15", hour: 9, good_w: 7, total_w: 8 }]);
    expect(liens(html)).toEqual(["/?app=demo&from=2026-07-15T07:00:00Z&to=2026-07-15T08:00:00Z"]);
    // L'annonce dit les deux fuseaux et la valeur exacte.
    expect(decode(html)).toContain("15/07 09:00-10:00 Europe/Paris (07:00-08:00 UTC) : 87,5");
  });

  it("gabarit déjà encodé par URLSearchParams (%7Bfrom%7D) : même lien", () => {
    const html = rendu([{ day: "2026-07-15", hour: 9, good_w: 1, total_w: 1 }], {
      zoomHref: "/?app=demo&from=%7Bfrom%7D&to=%7Bto%7D",
    });
    expect(liens(html)).toEqual(["/?app=demo&from=2026-07-15T07:00:00Z&to=2026-07-15T08:00:00Z"]);
  });

  it("une case vide est inactive : aucun lien, « aucune donnée »", () => {
    const html = rendu([{ day: "2026-07-14", hour: 9, good_w: 0, total_w: 0 }]);
    expect(liens(html)).toEqual([]);
    expect(html).toContain("aucune donnée");
  });

  it("une rangée = un groupe de liens, une case mesurée = un lien", () => {
    const html = rendu([
      { day: "2026-07-15", hour: 8, good_w: 1, total_w: 1 },
      { day: "2026-07-15", hour: 9, good_w: 1, total_w: 1 },
      { day: "2026-07-13", hour: 9, good_w: 1, total_w: 1 },
    ]);
    expect(liens(html)).toHaveLength(3);
    expect(html.match(/role="group"/g)).toHaveLength(1 + JOURS.length);
  });

  it("l'heure en cours s'ouvre jusqu'à la minute écoulée ; sous 5 minutes, elle n'ouvre rien", () => {
    const cellule: CaseSante[] = [{ day: "2026-07-15", hour: 18, good_w: 1, total_w: 1 }];
    const encours = rendu(cellule, { maintenant: Date.parse("2026-07-15T16:40:30Z") });
    expect(liens(encours)).toEqual(["/?app=demo&from=2026-07-15T16:00:00Z&to=2026-07-15T16:40:00Z"]);
    const debut = rendu(cellule, { maintenant: Date.parse("2026-07-15T16:03:00Z") });
    expect(liens(debut)).toEqual([]);
    expect(debut).toContain("moins de 5 minutes écoulées");
  });

  it("sans gabarit, aucune case n'est un lien", () => {
    const html = rendu([{ day: "2026-07-15", hour: 9, good_w: 1, total_w: 1 }], { zoomHref: undefined });
    expect(liens(html)).toEqual([]);
  });
});

describe("HealthHeatmap — le jour d'une case est lu dans le repère de l'app", () => {
  let tz: string | undefined;
  beforeEach(() => {
    tz = process.env.TZ;
    // Un processus Node à l'est d'UTC : minuit local = la veille en UTC.
    process.env.TZ = "Asia/Tokyo";
  });
  afterEach(() => {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  });

  it("un `Date` à minuit LOCAL (pilote pg) tombe sur son jour, pas sur la veille", () => {
    // `date_trunc('day', ts at time zone 'Europe/Paris')` = 2026-07-15 00:00, rendu
    // en Date locale. L'ancien `toISOString().slice(0, 10)` le rangeait au 14.
    const html = rendu([{ day: new Date(2026, 6, 15), hour: 9, good_w: 1, total_w: 1 }]);
    expect(liens(html)).toEqual(["/?app=demo&from=2026-07-15T07:00:00Z&to=2026-07-15T08:00:00Z"]);
    expect(decode(html)).toMatch(/mer\. 15\/07[^|]*?100,0/);
  });
});

describe("HealthHeatmap — alternative textuelle et heures ouvrées", () => {
  it("la valeur exacte de chaque case est dans l'alternative, « — » pour une case vide", () => {
    const html = rendu([{ day: "2026-07-15", hour: 9, good_w: 2, total_w: 3 }]);
    const alternative = decode(html).split('data-testid="alternative"')[1] ?? "";
    expect(alternative).toContain("66,7");
    expect(alternative).toContain("—");
    expect(alternative).toContain("Europe/Paris");
  });

  it("heures ouvrées : lundi-vendredi, 8 h-19 h seulement", () => {
    const html = rendu(
      [
        { day: "2026-07-15", hour: 7, good_w: 1, total_w: 1 },
        { day: "2026-07-15", hour: 9, good_w: 1, total_w: 1 },
      ],
      { jours: ["2026-07-11", "2026-07-15"], businessOnly: true },
    );
    expect(liens(html)).toHaveLength(1);
    expect(html).not.toContain("sam. 11/07");
  });
});
