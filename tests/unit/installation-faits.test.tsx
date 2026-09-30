// Les pages publiques des parcours (lib/installation-faits.ts) affichent des chiffres :
// ils se remesurent ici sur les fichiers que la console sert, et un chiffre qui dérive
// fait échouer le test plutôt que de mentir sur la page.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SceneInstallation } from "@/components/presentation/installation/SceneInstallation";
import { NAVIGATEURS_EXTENSION } from "@/components/presentation/installation/SchemaInstallation";
import { BUDGET_SDK_KO, FICHES, POIDS_KO } from "@/lib/installation-faits";
import { PARCOURS, verificationsDe } from "@/lib/installer";
import { recettesAgentsOtel } from "@/lib/recettes-agents-otel";

const RACINE = join(__dirname, "..", "..");
const PUBLIC = join(RACINE, "apps/console/public");
const gzipKo = (f: string) => gzipSync(readFileSync(join(PUBLIC, f)), { level: 9 }).length / 1024;

describe("l'essentiel de chaque parcours : des chiffres remesurés", () => {
  it("le poids du SDK et du rejeu, gzip, à une demi-Ko près", () => {
    expect(Math.abs(gzipKo("mip-rum.js") - POIDS_KO.sdk)).toBeLessThan(0.5);
    expect(Math.abs(gzipKo("mip-rum-replay.js") - POIDS_KO.rejeu)).toBeLessThan(1);
  });

  it("le budget annoncé est celui que le build du SDK fait respecter, et le SDK tient dedans", () => {
    const build = readFileSync(join(RACINE, "packages/rum-sdk/build.mjs"), "utf8");
    expect(build).toContain(`core.gz > ${BUDGET_SDK_KO} * 1024`);
    expect(POIDS_KO.sdk).toBeLessThan(BUDGET_SDK_KO);
  });

  it("le poids de l'archive de l'extension, à une Ko près", () => {
    const ko = statSync(join(PUBLIC, "downloads/mip-rum-extension.zip")).size / 1024;
    expect(Math.abs(ko - POIDS_KO.extension)).toBeLessThan(1);
  });

  it("les langages annoncés sont ceux des recettes éprouvées ; les navigateurs, ceux du schéma", () => {
    const { agents } = recettesAgentsOtel({ appId: "x", adresses: { traces: "", logs: "" } });
    expect(FICHES.serveur.faits.map((f) => f.valeur)).toContain(`${agents.length} langages`);
    const ouverts = NAVIGATEURS_EXTENSION.filter((n) => n.ouvert).map((n) => n.nom).join(" · ");
    expect(FICHES.extension.faits.map((f) => f.valeur)).toContain(ouverts);
  });
});

describe("le tutoriel de chaque parcours", () => {
  it("cinq étapes, dans l'ordre : Installer, prompt, IA, vérifier, résultat", () => {
    for (const p of PARCOURS) {
      expect(FICHES[p].etapes.map((e) => e.nom), p).toEqual(["installer", "copier", "ia", "verifier", "resultat"]);
    }
  });

  it("la scène dit les cases du test en direct de la console, et le bouton du prompt", () => {
    for (const p of PARCOURS) {
      const html = renderToStaticMarkup(<SceneInstallation parcours={p} vue="verifier" />);
      for (const v of verificationsDe(p, null)) expect(html, `${p} : ${v.libelle}`).toContain(v.libelle.replace(/'/g, "&#x27;"));
      expect(html).toContain("Copier pour mon IA de code");
      expect(html).toMatch(/aria-hidden="true"/);
    }
  });
});
