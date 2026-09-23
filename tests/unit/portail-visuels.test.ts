// P**.7 — Les images de la vitrine (plan § 8.3 et § 8.4) : chaque fichier de
// apps/console/public/portail/ est cité par le code de la console ou par le manifeste
// des captures, et pèse au plus 250 Ko.
//
// Pourquoi. public/ est publié tel quel, que quelque chose le demande ou non : un
// fichier que rien ne cite est un poids mort exposé (VS14 : une visite vidéo de
// 1,7 Mo et son affiche, référencées nulle part, retirées par ce lot). Dans l'autre
// sens, une image citée par un composant doit exister : sinon la page publique
// affiche une image cassée — les captures V-B et V-C ne sont branchées qu'une fois
// prises.
//
// VRAI DANS LES DEUX ÉTATS. Avant le passage de scripts/captures-portail.mjs : pas de
// manifeste, les deux captures de la vue d'ensemble citées par
// components/presentation/Landing.tsx. Après : les images d'issue et du mobile sont
// citées par le manifeste, le manifeste par lib/portail-manifeste.ts, et chacune doit
// avoir les dimensions que le manifeste lui prête.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dimensionsPng, POIDS_MAX } from "../../scripts/captures-portail.mjs";
import { analyserManifestePortail, CHEMIN_MANIFESTE_PORTAIL, type CapturePortail } from "@/lib/portail-manifeste";

const CONSOLE = join(process.cwd(), "apps/console");
const PORTAIL = join(CONSOLE, "public/portail");
const MANIFESTE = join(CONSOLE, CHEMIN_MANIFESTE_PORTAIL);

/** 250 Ko du plan (§ 8.3, point 6), en octets — les captures d'avant P**.7 font 120 à 122 Ko. */
const PLAFOND = 250_000;

/** Le texte du code de la console qui peut citer un fichier public : app/, components/, lib/. */
function codeConsole(): string {
  return ["app", "components", "lib"]
    .flatMap((dossier) =>
      (readdirSync(join(CONSOLE, dossier), { recursive: true }) as string[])
        .filter((f) => /\.tsx?$/.test(f))
        .map((f) => readFileSync(join(CONSOLE, dossier, f), "utf8")),
    )
    .join("\n");
}

/** Le manifeste versionné : `brut` null s'il n'existe pas ; `entrees` null s'il ne se lit pas. */
function manifesteVersionne(): { brut: string | null; entrees: CapturePortail[] | null } {
  if (!existsSync(MANIFESTE)) return { brut: null, entrees: null };
  const brut = readFileSync(MANIFESTE, "utf8");
  try {
    return { brut, entrees: analyserManifestePortail(JSON.parse(brut)) };
  } catch {
    return { brut, entrees: null };
  }
}

const fichiers = readdirSync(PORTAIL).filter((f) => statSync(join(PORTAIL, f)).isFile());
const { brut: manifesteBrut, entrees: manifeste } = manifesteVersionne();
const code = codeConsole();

describe("P**.7 — public/portail/ : rien de publié sans raison, rien de cité qui manque", () => {
  it("le plafond du script est celui du plan", () => {
    expect(POIDS_MAX).toBe(PLAFOND);
  });

  it("le manifeste, s'il existe, est bien formé", () => {
    if (manifesteBrut === null) return;
    expect(manifeste, `${CHEMIN_MANIFESTE_PORTAIL} ne suit pas le format de lib/portail-manifeste.ts`).not.toBeNull();
  });

  it("chaque fichier est cité par le code de la console ou par le manifeste", () => {
    const cites = new Set(manifeste?.map((c) => c.fichier) ?? []);
    const orphelins = fichiers.filter((f) => !code.includes(`portail/${f}`) && !cites.has(f));
    expect(orphelins, "fichiers publiés que rien ne cite : les retirer, ou les citer").toEqual([]);
  });

  it("chaque fichier pèse au plus 250 Ko", () => {
    const lourds = fichiers
      .map((f) => ({ f, octets: statSync(join(PORTAIL, f)).size }))
      .filter(({ octets }) => octets > PLAFOND)
      .map(({ f, octets }) => `${f} : ${octets} octets`);
    expect(lourds).toEqual([]);
  });

  it("chaque image citée par le code existe : aucune image cassée sur la page publique", () => {
    const citees = [...code.matchAll(/\/portail\/([\w.-]+\.(?:png|jpe?g|webp|avif|gif|svg|mp4|webm))/g)].map((m) => m[1]);
    expect(citees.length, "la vitrine cite au moins sa capture de la vue d'ensemble").toBeGreaterThan(0);
    expect([...new Set(citees)].filter((f) => !fichiers.includes(f))).toEqual([]);
  });

  it("le manifeste ne décrit que des images présentes, aux dimensions qu'il leur prête", () => {
    for (const c of manifeste ?? []) {
      expect(fichiers, `${c.fichier} : dans le manifeste, absent du dossier`).toContain(c.fichier);
      const { largeur, hauteur } = dimensionsPng(readFileSync(join(PORTAIL, c.fichier)));
      expect(`${largeur} × ${hauteur}`, c.fichier).toBe(`${c.largeur} × ${c.hauteur}`);
    }
  });
});
