// Journal d'audit lisible (recette du 26/09/2026) : libellés français, familles de
// filtre, détail mis en forme. Logique pure.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  actionConnue,
  cleAction,
  detailAudit,
  familleAudit,
  FAMILLES_AUDIT,
  libelleAction,
  motifFamille,
} from "../../apps/console/lib/audit-libelles";

/** Les actions déclarées par les règles des commandes et de l'identité (`audit: "…"`). */
function actionsDeclarees(): string[] {
  const dossier = "apps/console/lib/commandes";
  const sources = [
    ...readdirSync(dossier).map((f) => join(dossier, f)),
    "packages/console-api/src/operations/identite.ts",
  ];
  const actions = new Set<string>();
  for (const s of sources) {
    for (const m of readFileSync(s, "utf8").matchAll(/audit: "([a-z_.]+)"/g)) actions.add(m[1]);
  }
  return [...actions];
}

describe("libellés des actions", () => {
  it("les deux générations de codes se lisent pareil", () => {
    expect(cleAction("app.create")).toBe("app_create");
    expect(libelleAction("app.create")).toBe("Application créée");
    expect(libelleAction("app_create")).toBe("Application créée");
    expect(libelleAction("dashboard.clone_template")).toBe("Tableau de bord créé depuis un modèle");
    expect(libelleAction("demo_session")).toBe("Ouverture d'une démonstration");
    expect(libelleAction("seed_admin")).toBe("Compte administrateur initialisé");
  });

  it("chaque action déclarée par une règle a un libellé français", () => {
    const declarees = actionsDeclarees();
    expect(declarees.length).toBeGreaterThan(30);
    expect(declarees.filter((a) => !actionConnue(a))).toEqual([]);
  });

  it("une bascule dit son sens quand le détail le porte", () => {
    expect(libelleAction("app.set_active", false)).toBe("Application désactivée");
    expect(libelleAction("app.set_active", true)).toBe("Application réactivée");
    expect(libelleAction("app.set_active")).toBe("Application activée ou désactivée");
  });

  it("un code inconnu reste lisible, jamais muet", () => {
    expect(libelleAction("isolation.test")).toBe("isolation test");
  });
});

describe("familles du filtre", () => {
  it("chaque famille a une clé d'URL unique", () => {
    const cles = FAMILLES_AUDIT.map((f) => f.cle);
    expect(new Set(cles).size).toBe(cles.length);
    expect(familleAudit("connexions")?.libelle).toBe("Connexions");
    expect(familleAudit("'; drop table audit_log; --")).toBeNull();
    expect(familleAudit(undefined)).toBeNull();
  });

  it("le motif couvre les deux formes et une seule famille par action déclarée", () => {
    const motifs = FAMILLES_AUDIT.map((f) => ({ cle: f.cle, re: new RegExp(motifFamille(f)) }));
    const connexions = motifs.find((m) => m.cle === "connexions")!.re;
    for (const a of ["login", "auth.login", "logout", "demo_session", "auth.demo", "seed_admin", "login_failed"]) {
      expect(connexions.test(a), a).toBe(true);
    }
    expect(connexions.test("app.create")).toBe(false);
    for (const a of [...actionsDeclarees(), "app_create", "dsar_erase", "ticket_request", "sourcemap_replace"]) {
      const familles = motifs.filter((m) => m.re.test(a)).map((m) => m.cle);
      expect(familles, a).toHaveLength(1);
    }
  });
});

describe("détail mis en forme", () => {
  it("un JSON devient des champs nommés", () => {
    const d = detailAudit('{"ip":"::1","apps":["demo-app"]}');
    expect(d.texte).toBeNull();
    expect(d.champs).toEqual([
      { libelle: "Adresse IP", valeur: "::1" },
      { libelle: "Applications", valeur: "demo-app" },
    ]);
  });

  it("l'ajout de site perd son chemin interne, garde son mode et son domaine", () => {
    const d = detailAudit("demo-app (Démo) via /select · mode sdk · domaine demo.fr");
    expect(d.texte).toBe("demo-app (Démo) — ajout de site");
    expect(d.champs).toEqual([
      { libelle: "Mode", valeur: "SDK" },
      { libelle: "Domaine", valeur: "demo.fr" },
    ]);
  });

  it("les paires clé=valeur sont rangées en champs, le sens d'une bascule est lu", () => {
    const d = detailAudit("julie@exemple.fr role=viewer apps=a|b sessions_revoquees=2");
    expect(d.texte).toBe("julie@exemple.fr");
    expect(d.champs).toEqual([
      { libelle: "Rôle", valeur: "lecture seule" },
      { libelle: "Applications", valeur: "a, b" },
      { libelle: "Sessions révoquées", valeur: "2" },
    ]);
    expect(detailAudit("demo-app active=false").actif).toBe(false);
    expect(detailAudit('{"id":3,"active":true}').actif).toBe(true);
  });

  it("un détail vide ne rend rien", () => {
    expect(detailAudit(null)).toEqual({ texte: null, champs: [], actif: null });
    expect(detailAudit("  ")).toEqual({ texte: null, champs: [], actif: null });
  });
});
