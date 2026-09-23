// /mobile — les déploiements posés sur la série React Native (revue de fin de vague
// 8, point 7).
//
// Un marqueur de déploiement ne dit pas son runtime (`deploy_marker`, v32). L'écran
// posait les 20 derniers marqueurs de TOUT le périmètre — versions web comprises —,
// chacun menant à `/mobile?release=<version>` : la cohorte React Native d'une
// version qu'aucune session mobile ne porte, donc vide, sans le dire. Seuls les
// marqueurs rattachés à la cohorte (`de_la_cohorte`, lu en SQL par
// `mobileDeploiements`) sont posés ; les écartés de la fenêtre sont comptés et dits.
import { describe, expect, it } from "vitest";
import { annotationsDeploiements, RAISON_B1 } from "@/lib/annotations";
import {
  annotationsDeploiementsCohorte,
  raisonDeploiementsEcartes,
  type MarqueurCohorte,
} from "@/lib/mobile-capabilities";

const RANGE = { from: "2026-09-23T00:00:00.000Z", to: "2026-09-24T00:00:00.000Z", preset: "24h" as const };
const a = (heure: number) => new Date(Date.parse(RANGE.from) + heure * 3_600_000);

const marqueur = (heure: number, version: string | null, app_id: string, de_la_cohorte: boolean): MarqueurCohorte => ({
  ts: a(heure),
  version,
  app_id,
  de_la_cohorte,
});

const lien = (release: string, app: string) => `/mobile?app=${app}&release=${release}`;

describe("annotationsDeploiementsCohorte", () => {
  it("un déploiement web n'est pas posé sur la série React Native ; il est compté sous la figure", () => {
    const r = annotationsDeploiementsCohorte(
      {
        disponible: true,
        marqueurs: [
          marqueur(20, "web-7.3", "boutique-web", false), // app web du périmètre
          marqueur(18, "4.2", "appli-rn", true),
          marqueur(12, "web-7.2", "appli-rn", false), // version web d'une app qui émet des deux runtimes
        ],
      },
      RANGE,
      lien,
    );
    expect(r.annotations.map((x) => x.libelle)).toEqual(["4.2"]);
    // Le lien pose l'app DU marqueur : une release n'existe que dans son app (F38).
    expect(r.annotations[0].href).toBe("/mobile?app=appli-rn&release=4.2");
    expect(r.indisponible).toBe(raisonDeploiementsEcartes(2));
    expect(r.indisponible).toContain("2 déploiements de la fenêtre");
  });

  it("aucun écarté dans la fenêtre : aucune phrase ; un écarté HORS fenêtre ne compte pas", () => {
    const r = annotationsDeploiementsCohorte(
      { disponible: true, marqueurs: [marqueur(3, "4.2", "appli-rn", true), marqueur(-30, "web-7.1", "boutique-web", false)] },
      RANGE,
      lien,
    );
    expect(r.annotations).toHaveLength(1);
    expect(r.indisponible).toBeNull();
  });

  it("un seul écarté : la phrase au singulier ; un marqueur sans version n'est pas rattachable", () => {
    const r = annotationsDeploiementsCohorte({ disponible: true, marqueurs: [marqueur(5, null, "appli-rn", false)] }, RANGE, lien);
    expect(r.annotations).toEqual([]);
    expect(r.indisponible).toBe(
      "1 déploiement de la fenêtre : sa version n'est pas une release React Native de la cohorte affichée (déploiement web, ou version sans session mobile)",
    );
  });

  it("plage personnalisée (B1) : aucun marqueur, la raison B1 seule", () => {
    const r = annotationsDeploiementsCohorte(
      { disponible: true, marqueurs: [marqueur(5, "web-7.3", "boutique-web", false)] },
      { ...RANGE, preset: null },
      lien,
    );
    expect(r).toEqual({ annotations: [], liste: [], indisponible: RAISON_B1 });
  });

  it("lecture non rattachable (schéma) : la raison est dite, rien n'est posé", () => {
    const r = annotationsDeploiementsCohorte({ disponible: false, raison: "colonne absente" }, RANGE, lien);
    expect(r.annotations).toEqual([]);
    expect(r.indisponible).toBe("déploiements non rattachables à la cohorte React Native (colonne absente)");
  });
});

describe("annotationsDeploiements — l'app du marqueur passe au lien quand la lecture la porte", () => {
  it("avec `app_id` : troisième argument ; sans : `undefined` (les écrans qui l'ignorent sont inchangés)", () => {
    const vus: (string | undefined)[] = [];
    annotationsDeploiements(
      [
        { ts: a(2), version: "1.1", app_id: "app-a" },
        { ts: a(1), version: "1.0" },
      ],
      RANGE,
      {
        lien: (relB, _relA, app) => {
          vus.push(app);
          return `/x?rel_b=${relB}`;
        },
      },
    );
    // Parcours du plus récent au plus ancien.
    expect(vus).toEqual(["app-a", undefined]);
  });
});
