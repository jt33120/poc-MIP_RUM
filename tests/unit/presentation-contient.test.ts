// P**.3 — Ce que la partie « Ce qu'il contient » lit dans le document de couverture
// (lib/presentation-contient.ts) au lieu de l'écrire à la main.
//
// L'INCIDENT QUI FONDE CE TEST. Le plan (§ 8.2, PS6) faisait dire à la vitrine « la
// CI ne vérifie pas les types » : vrai au relevé du 18/09/2026, faux à celui du
// 23/09 (F2 est passée « déployé, non éprouvé »). Chaque réserve de « Ce que ces
// chiffres ne disent pas » porte désormais la ligne qui la fonde et le verdict
// qu'elle suppose ; un nouveau relevé qui change ce verdict fait échouer le test n° 2,
// en nommant la ligne à relire.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CAPACITES, type Capacite } from "../../apps/console/lib/couverture";
import {
  BANC_CLICKHOUSE,
  FAMILLES_API_V1,
  OUTILS_MCP,
  RESERVES_CHAINE,
  nombreDansPreuve,
  reservesPerimees,
} from "../../apps/console/lib/presentation-contient";

const RACINE = join(__dirname, "..", "..");
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), "utf8");

/** Les capacités du document, avec une ligne réécrite. */
function avec(id: string, change: Partial<Capacite>): Capacite[] {
  return CAPACITES.map((c) => (c.id === id ? { ...c, ...change } : c));
}

describe("1 — les nombres des accès programmatiques sont lus dans le document", () => {
  it("E1 : familles de routes ; E2 : outils MCP (repères du relevé du 23/09/2026)", () => {
    expect(FAMILLES_API_V1).toBe(18);
    expect(OUTILS_MCP).toBe(16);
  });

  it("un nombre qui disparaît de sa cellule est tu, pas gardé", () => {
    const sansNombre = avec("E2", { preuve: "`packages/mcp-tools/lib/catalogue.mjs`, service Railway `mcp`" });
    expect(nombreDansPreuve("E2", /\*\*(\d+) outils\*\*/, sansNombre)).toBeNull();
    expect(nombreDansPreuve("Z9", /(\d+)/)).toBeNull();
    // Un nouveau relevé qui recompte suit, sans toucher la vitrine.
    const recompte = avec("E2", { preuve: "`packages/mcp-tools/lib/catalogue.mjs` — **17 outils**, recomptés" });
    expect(nombreDansPreuve("E2", /\*\*(\d+) outils\*\*/, recompte)).toBe(17);
  });
});

describe("2 — « Ce que ces chiffres ne disent pas » suit le verdict de F2 et F3", () => {
  it("au relevé d'aujourd'hui, chaque réserve dit encore vrai", () => {
    expect(reservesPerimees()).toEqual([]);
    // F1 n'a plus de réserve depuis la relecture du 26/09 : la CI construit le dépôt
    // depuis un clone propre (job « Construction depuis un dépôt propre »).
    expect(RESERVES_CHAINE.map((r) => r.source)).toEqual(["F3", "F2"]);
    for (const r of RESERVES_CHAINE) expect(r.texte.trim(), r.source).not.toBe("");
  });

  it("le cas du 23/09 : F2 qui change de verdict rend sa phrase fausse, et le test le dit", () => {
    // Le relevé du 18/09 : F2 « livré avec un défaut connu », la CI ne typait rien.
    const au18 = avec("F2", { verdict: "livre_avec_defaut_connu" });
    expect(reservesPerimees(RESERVES_CHAINE, au18)).toEqual([
      "F2 est passée de « deploye_non_eprouve » à « livre_avec_defaut_connu » : réécrire « le JavaScript du backend n'est typé par rien » depuis sa ligne",
    ]);
  });

  it("des bancs rejoués en CI, ou une ligne retirée du document, sont signalés", () => {
    const bancsEnCi = avec("F3", { verdict: "deploye_non_eprouve" });
    expect(reservesPerimees(RESERVES_CHAINE, bancsEnCi)[0]).toMatch(/^F3 est passée de « livre_avec_defaut_connu »/);
    const sansF2 = CAPACITES.filter((c) => c.id !== "F2");
    expect(reservesPerimees(RESERVES_CHAINE, sansF2)).toEqual([
      "F2 n'est plus une ligne du document : réécrire « le JavaScript du backend n'est typé par rien »",
    ]);
  });

  it("chaque réserve dit ce que dit la CI (relecture du 26/09/2026)", () => {
    // Les lignes F1 à F3 du document datent du 23/09 ; la CI du 24/09 (PR #281) les
    // a dépassées. Le fait se lit donc dans .github/workflows/ci.yml.
    const ci = lire(".github/workflows/ci.yml");
    expect(ci).toContain("name: Bancs de mesure (Explorer P6.6, /mobile P7.5)");
    expect(ci).toContain("Aucun seuil de LATENCE");
    expect(ci).toContain("pnpm --filter extension typecheck");
    expect(ci).toContain("Reste HORS typage, et c'est connu : le JavaScript du backend");
    expect(ci).toContain("name: Construction depuis un dépôt propre");
    const textes = RESERVES_CHAINE.map((r) => r.texte).join(" ; ");
    // Les trois phrases que la CI du 24/09 a rendues fausses.
    expect(textes).not.toMatch(/ne tournent jamais en CI|types de l'extension|fraîchement installé/);
  });
});

describe("3 — le banc ClickHouse cité est celui des notes d'infrastructure", () => {
  it("date, égalité des p75 à 1 ms près, ×15 à données identiques", () => {
    const notes = lire("labs/clickhouse/NOTES.md");
    expect(notes).toContain(`## Bench réel (${BANC_CLICKHOUSE.le}, local)`);
    expect(notes).toContain("tolérance 1 ms sur les p75");
    expect(notes).toContain(`**×${BANC_CLICKHOUSE.compacite}** plus compact à données identiques`);
  });
});
