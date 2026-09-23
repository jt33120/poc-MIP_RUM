// P**.7 — Le manifeste des captures de la vitrine (lib/portail-manifeste.ts) : ce qu'il
// accepte, et la date qu'il donne à la légende de l'en-tête (plan § 8.2, PS0).
//
// La règle tenue : une date ne s'affiche que si le manifeste date TOUTES les images
// montrées, le même jour. Absent, illisible, mal formé, incomplet ou discordant : pas
// de date — la légende n'en invente pas.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyserManifestePortail,
  CAPTURES_VUE_ENSEMBLE,
  CHEMIN_MANIFESTE_PORTAIL,
  dateAffichee,
  dateDesCaptures,
  lireManifestePortail,
  type CapturePortail,
} from "@/lib/portail-manifeste";

const entree = (surcharge: Partial<CapturePortail> = {}): CapturePortail => ({
  fichier: "overview-light.png",
  route: "/?app=demo-app",
  theme: "light",
  largeur: 1440,
  hauteur: 900,
  date: "2026-09-23",
  sha: "d46ccc8",
  jeu: "scripts/gen-traffic.mjs",
  ...surcharge,
});

const complet = [
  entree(),
  entree({ fichier: "overview-dark.png", theme: "dark" }),
  entree({ fichier: "mobile-light.png", route: "/mobile?app=demo-app" }),
];

/** Un répertoire de console jetable, avec (ou sans) manifeste. */
function console_(contenu?: string): string {
  const racine = mkdtempSync(join(tmpdir(), "portail-manifeste-"));
  if (contenu !== undefined) {
    mkdirSync(join(racine, "public/portail"), { recursive: true });
    writeFileSync(join(racine, CHEMIN_MANIFESTE_PORTAIL), contenu);
  }
  return racine;
}

describe("analyserManifestePortail — le format qu'écrit scripts/captures-portail.mjs", () => {
  it("rend les entrées d'un manifeste bien formé, dans l'ordre", () => {
    expect(analyserManifestePortail(complet)).toEqual(complet);
    expect(analyserManifestePortail([entree({ sha: "d46ccc8-dirty" })])).not.toBeNull();
  });

  it("rejette le tout sur une seule entrée fautive", () => {
    const fautifs: unknown[] = [
      null,
      {},
      [],
      [entree({ fichier: "../secret.png" })],
      [entree({ fichier: "overview-light.jpg" })],
      [entree(), entree()], // un fichier deux fois
      [entree({ route: "https://ailleurs.example/" })],
      [{ ...entree(), theme: "sombre" }],
      [entree({ largeur: 0 })],
      [entree({ hauteur: 900.5 })],
      [entree({ date: "2026-02-31" })],
      [entree({ date: "23/09/2026" })],
      [entree({ sha: "HEAD" })],
      [entree({ jeu: " " })],
      [...complet, "overview-dark.png"],
    ];
    for (const f of fautifs) expect(analyserManifestePortail(f), JSON.stringify(f)).toBeNull();
  });
});

describe("lireManifestePortail — sur le disque de la console", () => {
  it("absent : null", () => {
    expect(lireManifestePortail(console_())).toBeNull();
  });

  it("illisible ou mal formé : null, comme absent — la page ne casse pas", () => {
    expect(lireManifestePortail(console_("{ pas du json"))).toBeNull();
    expect(lireManifestePortail(console_(JSON.stringify([entree({ date: "hier" })])))).toBeNull();
  });

  it("bien formé : ses entrées", () => {
    expect(lireManifestePortail(console_(JSON.stringify(complet, null, 2)))).toEqual(complet);
  });
});

describe("dateDesCaptures — la date de la légende", () => {
  it("les deux captures de la vue d'ensemble, prises le même jour : ce jour", () => {
    expect(dateDesCaptures(complet, CAPTURES_VUE_ENSEMBLE)).toBe("2026-09-23");
  });

  it("sans manifeste : aucune date", () => {
    expect(dateDesCaptures(null, CAPTURES_VUE_ENSEMBLE)).toBeNull();
  });

  it("une des deux absente du manifeste (image ancienne, de date inconnue) : aucune date", () => {
    expect(dateDesCaptures([entree()], CAPTURES_VUE_ENSEMBLE)).toBeNull();
  });

  it("prises à des jours différents : aucune date, plutôt qu'une qui ne vaut que pour un thème", () => {
    expect(dateDesCaptures([entree(), entree({ fichier: "overview-dark.png", date: "2026-09-24" })], CAPTURES_VUE_ENSEMBLE)).toBeNull();
  });

  it("aucune image demandée : aucune date", () => {
    expect(dateDesCaptures(complet, [])).toBeNull();
  });
});

describe("dateAffichee", () => {
  it("AAAA-MM-JJ → JJ/MM/AAAA, la forme du relevé", () => {
    expect(dateAffichee("2026-09-23")).toBe("23/09/2026");
  });
});
