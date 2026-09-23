// P**.7 — scripts/captures-portail.mjs, sans navigateur (plan § 8.3, cahier des charges).
//
// Le script ne tourne qu'au passage final des captures, sur la pile locale : ce qui
// s'en vérifie ici, ce sont ses fonctions pures — les garde-fous (aucune IP ni adresse
// électronique affichée, poids, dimensions), le choix de l'issue de V-B, et le format
// du manifeste, relu par lib/portail-manifeste.ts. Un écart entre ce que le script
// écrit et ce que la vitrine lit ôterait la date de la légende sans bruit.
import { describe, expect, it } from "vitest";
import {
  COMPTE_DEDIE,
  dimensionsPng,
  entreeManifeste,
  fautesAffichage,
  fautesImages,
  feuilleMasquage,
  HAUTEUR,
  jourDeParis,
  JEU,
  LARGEUR,
  POIDS_MAX,
  premiereIssue,
  VUES,
} from "../../scripts/captures-portail.mjs";
import { analyserManifestePortail, CAPTURES_VUE_ENSEMBLE, dateDesCaptures } from "@/lib/portail-manifeste";

/** Un PNG réduit à sa signature et à son bloc IHDR, complété à `octets`. */
function png(largeur: number, hauteur: number, octets = 64): Buffer {
  const b = Buffer.alloc(Math.max(octets, 33));
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(largeur, 16);
  b.writeUInt32BE(hauteur, 20);
  return b;
}

const ISSUE = "0f8e4a52-3c1d-4b7e-9a60-1d2c3b4a5f6e";

describe("les cinq images du plan", () => {
  it("V-A et V-B en clair et en sombre, V-C en clair seulement", () => {
    const fichiers = VUES.flatMap((v: { nom: string; themes: string[] }) => v.themes.map((t) => `${v.nom}-${t}.png`));
    expect(fichiers.sort()).toEqual(
      ["issue-dark.png", "issue-light.png", "mobile-light.png", "overview-dark.png", "overview-light.png"].sort(),
    );
    expect(fichiers).toEqual(expect.arrayContaining([...CAPTURES_VUE_ENSEMBLE]));
  });

  it("routes : la vue d'ensemble, l'issue choisie, le mobile", () => {
    expect(VUES.map((v: { chemin: (i: string) => string }) => v.chemin(ISSUE))).toEqual([
      "/",
      `/errors/issues/${ISSUE}`,
      "/mobile",
    ]);
  });

  it("1440 × 900, le ratio 8/5 du cadre de la vitrine", () => {
    expect([LARGEUR, HAUTEUR]).toEqual([1440, 900]);
    expect(LARGEUR / HAUTEUR).toBe(8 / 5);
  });
});

describe("garde-fou : ni IP ni adresse électronique à l'écran", () => {
  it("attrape une IPv4 et une adresse, sans recopier la partie locale de l'adresse", () => {
    expect(fautesAffichage("Dernière requête de 192.168.1.20")).toHaveLength(1);
    const f = fautesAffichage("Assignée à jeanne.dupont@exemple.fr");
    expect(f).toHaveLength(1);
    expect(f[0]).toContain("…@exemple.fr");
    expect(f[0]).not.toContain("jeanne");
    expect(fautesAffichage("10.0.0.1 et a@b.co")).toHaveLength(2);
  });

  it("laisse passer versions, dates, paquets et pourcentages", () => {
    expect(fautesAffichage("SDK 0.4.0 · relevé du 23/09/2026 · @mip/rum-sdk · 12,5 % · p75 2.5 s")).toEqual([]);
  });

  it("masque le widget d'avis (ses deux éléments) et la carte du compte connecté", () => {
    const css = feuilleMasquage(COMPTE_DEDIE);
    expect(css).toContain('[data-mip-rum-ui^="feedback-"]');
    expect(css).toContain(`[title="${COMPTE_DEDIE}"]`);
    expect(css.match(/display: none !important/g)).toHaveLength(2);
    // Une adresse ne peut pas sortir de la chaîne du sélecteur.
    expect(feuilleMasquage('a"b@c.fr')).toContain('[title="a\\"b@c.fr"]');
  });
});

describe("images : dimensions lues dans le PNG, poids plafonné", () => {
  it("lit largeur et hauteur dans l'en-tête", () => {
    expect(dimensionsPng(png(1440, 900))).toEqual({ largeur: 1440, hauteur: 900 });
  });

  it("refuse ce qui n'est pas un PNG", () => {
    expect(() => dimensionsPng(Buffer.from("GIF89a, pas un PNG du tout, vraiment"))).toThrow(/PNG/);
    expect(() => dimensionsPng(Buffer.alloc(10))).toThrow(/PNG/);
  });

  it("signale une image trop lourde ou aux mauvaises dimensions, et rien d'autre", () => {
    expect(fautesImages([{ fichier: "ok.png", png: png(1440, 900, POIDS_MAX) }])).toEqual([]);
    const fautes = fautesImages([
      { fichier: "lourde.png", png: png(1440, 900, POIDS_MAX + 1) },
      { fichier: "etroite.png", png: png(1280, 800) },
    ]);
    expect(fautes).toHaveLength(2);
    expect(fautes[0]).toContain("lourde.png");
    expect(fautes[1]).toContain("etroite.png : 1280 × 800");
  });
});

describe("l'issue de V-B : la première de la liste /errors", () => {
  it("prend le premier lien d'issue, requête comprise, et ignore les groupes historiques", () => {
    expect(
      premiereIssue([
        "/errors?app=demo-app",
        "/errors/a1b2c3?app=demo-app",
        `/errors/issues/${ISSUE}?app=demo-app&period=24h`,
        "/errors/issues/11111111-2222-3333-4444-555555555555",
      ]),
    ).toBe(ISSUE);
  });

  it("aucune issue listée (regroupement v2 inactif) : null", () => {
    expect(premiereIssue(["/errors/a1b2c3?app=demo-app", "/errors/issues/pas-un-uuid", "/sessions/x"])).toBeNull();
  });
});

describe("le manifeste : ce que le script écrit, la vitrine le lit", () => {
  it("les entrées du script passent l'analyse de lib/portail-manifeste.ts, et datent la légende", () => {
    const date = jourDeParis(new Date("2026-09-23T10:00:00Z"));
    const entrees = [
      entreeManifeste({ fichier: "overview-light.png", route: "/?app=demo-app", theme: "light", png: png(1440, 900), date, sha: "d46ccc8" }),
      entreeManifeste({ fichier: "overview-dark.png", route: "/?app=demo-app", theme: "dark", png: png(1440, 900), date, sha: "d46ccc8-dirty" }),
    ];
    expect(entrees[0]).toEqual({
      fichier: "overview-light.png",
      route: "/?app=demo-app",
      theme: "light",
      largeur: 1440,
      hauteur: 900,
      date: "2026-09-23",
      sha: "d46ccc8",
      jeu: JEU,
    });
    const lu = analyserManifestePortail(JSON.parse(JSON.stringify(entrees)));
    expect(lu).toEqual(entrees);
    expect(dateDesCaptures(lu, CAPTURES_VUE_ENSEMBLE)).toBe("2026-09-23");
  });

  it("le jour est celui de Paris : 22 h 30 UTC un 22 septembre, c'est déjà le 23", () => {
    expect(jourDeParis(new Date("2026-09-22T22:30:00Z"))).toBe("2026-09-23");
    expect(jourDeParis(new Date("2026-01-15T22:30:00Z"))).toBe("2026-01-15");
  });
});
