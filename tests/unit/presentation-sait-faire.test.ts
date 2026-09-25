// P**.4 — Les données de « Ce qu'il sait faire » (plan § 8.2, PS7 et PS8).
//
// Ce que ces tests tiennent, sans rendu :
//   - les cartes : K1 à K15 dans l'ordre, chacune au verdict « déployé, non éprouvé »
//     LU dans le document (verdictCarte), un texte pour chaque champ, et K15 (F2)
//     avec ses deux réserves ;
//   - les passages du document que citent les cartes et le bloc « Méthode » disent
//     encore ce qu'on leur fait dire : un relevé qui renumérote le document fait
//     échouer ce test au lieu de laisser une source pointer ailleurs ;
//   - la barre de couverture : une répartition COMPTÉE, égale aux décomptes du
//     document, dans l'ordre de sa phrase de répartition, accordée au nombre ;
//   - le bloc « Méthode » : quatre énoncés, chacun sourcé, jamais dans une ligne d'un
//     autre verdict.
// La provenance des cartes (identifiants, sources, une puce par identifiant) est le
// contrôle n° 3 de tests/unit/couverture-site.test.ts ; le rendu, SaitFaire.test.tsx.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CAPACITES, VERDICTS, compte, type Capacite } from "../../apps/console/lib/couverture";
import { DEPLOYEES_INERTES, VERDICT_MONTRABLE, lireFichierCite } from "../../apps/console/lib/couverture-controle";
import { CARTES, METHODE, repartitionCouverture, verdictCarte } from "../../apps/console/lib/presentation-sait-faire";
// Revue de fin de vague 7 (B6) : la borne d'un tableau, lue dans le code.
import { MAX_WIDGETS, layoutPlein, normalizeLayout } from "../../apps/console/lib/dashboards";

const RACINE = join(__dirname, "..", "..");
const DOC = readFileSync(join(RACINE, "docs/RUM_PARITY_STATUS.md"), "utf8");
const DOC_LIGNES = DOC.split("\n");
const ligneDoc = (n: number) => DOC_LIGNES[n - 1] ?? "";

describe("PS7 — les cartes", () => {
  it("K1 à K15, dans l'ordre", () => {
    expect(CARTES.map((c) => c.id)).toEqual(Array.from({ length: 15 }, (_, i) => `K${i + 1}`));
  });

  it("chaque carte a un titre, ce qu'elle fait et au moins une puce de limite, toutes non vides", () => {
    for (const c of CARTES) {
      expect(c.titre.trim(), c.id).not.toBe("");
      expect(c.faitQuoi.trim(), c.id).not.toBe("");
      expect(c.limites.length, c.id).toBeGreaterThan(0);
      for (const l of c.limites) expect(l.texte.trim(), `${c.id} ${l.id}`).not.toBe("");
    }
  });

  it("le verdict de chaque carte, lu dans le document, est « déployé, non éprouvé »", () => {
    for (const c of CARTES) expect(verdictCarte(c), c.id).toBe(VERDICT_MONTRABLE);
  });

  it("un relevé qui déclasse une ligne se lit sur la carte ; des verdicts mêlés ou inconnus rendent null", () => {
    const declasse = CAPACITES.map((c) =>
      c.id === "A1" ? ({ ...c, verdict: "livre_avec_defaut_connu" } as Capacite) : c,
    );
    expect(verdictCarte(CARTES[0], declasse)).toBe("livre_avec_defaut_connu");
    expect(verdictCarte({ limites: [{ id: "A1", texte: "x" }, { id: "D7", texte: "y" }] })).toBeNull();
    expect(verdictCarte({ limites: [{ id: "Z9", texte: "x" }] })).toBeNull();
  });

  it("une puce par ligne « déployé, non éprouvé », sauf les inertes — dont A4 et F2", () => {
    const puces = CARTES.flatMap((c) => c.limites.map((l) => l.id));
    expect(new Set(puces).size).toBe(puces.length);
    expect(puces.length).toBe(compte("deploye_non_eprouve") - DEPLOYEES_INERTES.length);
    expect(puces).toContain("A4");
    expect(puces).toContain("F2");
    for (const id of DEPLOYEES_INERTES) expect(puces).not.toContain(id);
  });

  it("K15 (F2) garde les deux réserves de sa ligne, et ne dit pas « paquets publiés »", () => {
    const k15 = CARTES.find((c) => c.id === "K15")!;
    expect(k15.limites.map((l) => l.id)).toEqual(["F2"]);
    expect(ligneDoc(CAPACITES.find((c) => c.id === "F2")!.ligne)).toContain("L'extension navigateur");
    expect(k15.limites[0].texte).toContain("L'extension navigateur n'est pas typée par l'intégration continue");
    expect(k15.limites[0].texte).toContain("n'arrête une fusion que si l'on attend son verdict");
    // Le paquet React Native n'est pas publié (C9) : l'intitulé de l'étape de CI ne se reprend pas tel quel.
    expect(`${k15.titre} ${k15.faitQuoi}`).not.toMatch(/publiés?/);
  });

  it("la recette e2e lit les identifiants des cartes dans ce fichier : une ligne `id: \"K…\",` par carte", () => {
    const source = readFileSync(join(RACINE, "apps/console/lib/presentation-sait-faire.ts"), "utf8");
    const ids = [...source.matchAll(/^\s+id: "(K\d+)",$/gm)].map((m) => m[1]);
    expect(ids).toEqual(CARTES.map((c) => c.id));
  });
});

// Ce que chaque passage cité doit encore contenir. Le relevé du 23/09 a gardé la
// numérotation des §§ 1 à 11 ; un relevé qui la changerait ferait pointer ces
// sources ailleurs — ce test le dit au lieu de le laisser passer.
const PASSAGES: Record<number, string> = {
  43: "Une table vide n'est pas un zéro.",
  44: "« Non collecté »",
  253: "somme des répétitions **effectivement reçues**",
  254: "Aucun multiplicateur automatique",
  255: "pas sur le taux de session",
  312: "Les populations ne s'additionnent pas",
  313: "Une métrique sans dénominateur rend `null`, pas `0`.",
  317: "fuseau horaire du terminal",
  318: "l'en-tête pays posé par celui-ci",
  319: "« Pays estimé » partout",
  320: "Ce n'est **pas** une géolocalisation.",
  326: "Aucune adresse IP n'est stockée",
  340: "Un seul framework backend, un seul saut de tracing",
  341: "données.",
  390: "attendre le verdict de la CI **du commit de fusion**",
  503: "quatre paquets et la console",
  504: "seule l'extension, verte à la main, n'est typée par aucun workflow",
};

describe("sources — les passages cités disent encore ce qu'on leur fait dire", () => {
  const cites = [...CARTES.flatMap((c) => c.sources), ...METHODE.flatMap((e) => e.sources)].flatMap((s) =>
    "passage" in s ? [s.passage] : [],
  );

  it("chaque passage cité a son repère, et le document le contient à cette ligne", () => {
    for (const n of new Set(cites)) {
      expect(PASSAGES[n], `:${n} est cité sans repère dans ce test`).toBeDefined();
      expect(ligneDoc(n), `docs/RUM_PARITY_STATUS.md:${n}`).toContain(PASSAGES[n]);
    }
  });

  it("chaque fichier cité existe et a les lignes citées", () => {
    const fichiers = [...CARTES.flatMap((c) => c.sources), ...METHODE.flatMap((e) => e.sources)].flatMap((s) =>
      "fichier" in s ? [s.fichier] : [],
    );
    expect(fichiers.length).toBeGreaterThan(0);
    for (const f of fichiers) {
      const lu = lireFichierCite(f);
      expect(lu, f).not.toBeNull();
      const chemin = [join(RACINE, lu!.chemin), join(RACINE, "apps/console", lu!.chemin)].find((p) => existsSync(p));
      expect(chemin, f).toBeDefined();
      expect(readFileSync(chemin!, "utf8").split("\n").length, f).toBeGreaterThanOrEqual(lu!.fin);
    }
  });

  it("les lignes citées par K2 et K13 disent « Inconnu » et « rôle propriétaire »", () => {
    const lignes = (chemin: string, debut: number, fin: number) =>
      readFileSync(join(RACINE, chemin), "utf8").split("\n").slice(debut - 1, fin).join("\n");
    expect(lignes("apps/console/lib/error-view.ts", 90, 93)).toContain('"Inconnu"');
    expect(lignes("DEPLOY.md", 272, 278)).toContain("`neondb_owner`, PAS `console_ro`");
    expect(lignes("apps/console/components/presentation/Specs.tsx", 166, 170)).toContain("rôle propriétaire");
  });
});

describe("V-E — la répartition de la barre de couverture", () => {
  it("chaque nombre est compté dans le document ; leur somme est le total ; rien de vide n'est dessiné", () => {
    const parts = repartitionCouverture();
    for (const p of parts) expect(p.nombre, p.verdict).toBe(compte(p.verdict));
    expect(parts.reduce((n, p) => n + p.nombre, 0)).toBe(CAPACITES.length);
    expect(parts.map((p) => p.verdict).sort()).toEqual(VERDICTS.filter((v) => compte(v) > 0).sort());
  });

  it("dans l'ordre de la phrase de répartition du document", () => {
    const section4 = DOC.slice(DOC.indexOf("## 4."));
    const phrase = section4.slice(section4.indexOf("Répartition des verdicts"), section4.indexOf("Le verdict `en_revue`"));
    const ordre = [...phrase.matchAll(/`(\w+)` \*\*(\d+)\*\*/g)].map((m) => m[1]);
    expect(repartitionCouverture().map((p) => p.verdict)).toEqual(ordre);
  });

  it("du plus au moins nombreux, à égalité dans l'ordre du vocabulaire, accordé au nombre", () => {
    const fictives = [
      { id: "X1", verdict: "non_retenu" },
      { id: "X2", verdict: "non_commence" },
      { id: "X3", verdict: "non_commence" },
      { id: "X4", verdict: "non_commence" },
      { id: "X5", verdict: "livre_non_deploye" },
    ] as Capacite[];
    expect(repartitionCouverture(fictives)).toEqual([
      { verdict: "non_commence", nombre: 3, libelle: "non commencées" },
      { verdict: "livre_non_deploye", nombre: 1, libelle: "livrée, non déployée" },
      { verdict: "non_retenu", nombre: 1, libelle: "non retenue" },
    ]);
    expect(repartitionCouverture([])).toEqual([]);
  });
});

describe("PS8 — une façon de compter", () => {
  it("quatre énoncés, textes exacts du plan", () => {
    expect(METHODE.map((e) => `${e.titre} ${e.texte}`)).toEqual([
      "Inconnu n'est pas zéro. Une valeur qu'on ne connaît pas s'affiche « Inconnu » ; une mesure sans dénominateur n'a pas de valeur ; seul un compteur réellement vide vaut 0.",
      "Une capacité absente n'affiche pas de zéro. Il n'existe aucune table de crash natif : l'écran mobile dit « Non collecté » plutôt qu'un taux sans crash qui ne reposerait sur rien.",
      "L'échantillonnage est dit, pas corrigé. Les comptes sont ceux reçus, sans multiplicateur ; l'écran indique la probabilité qu'une erreur avait d'être retenue.",
      "Aucune adresse IP n'est conservée. Le pays est estimé, et nommé « Pays estimé » partout.",
    ]);
  });

  it("chaque énoncé est sourcé dans le document, jamais dans une ligne d'un autre verdict", () => {
    const parId = new Map(CAPACITES.map((c) => [c.id, c]));
    const parLigne = new Map(CAPACITES.map((c) => [c.ligne, c]));
    for (const e of METHODE) {
      expect(e.sources.some((s) => "passage" in s || "ligne" in s), e.titre).toBe(true);
      for (const s of e.sources) {
        if ("ligne" in s) expect(parId.get(s.ligne)?.verdict, `${e.titre} ${s.ligne}`).toBe(VERDICT_MONTRABLE);
        if ("passage" in s) {
          const cap = parLigne.get(s.passage);
          if (cap) expect(cap.verdict, `${e.titre} :${s.passage}`).toBe(VERDICT_MONTRABLE);
        }
      }
    }
  });
});

// Revue de fin de vague 7 : des cartes disaient plus, ou autre chose, que le code. Le
// document a été corrigé d'abord, la carte suit ; chaque test pose le FAIT tel que la
// ligne l'écrit, puis le texte de la carte — un nouveau relevé qui change la ligne
// rougit ici, et quelqu'un relit la carte.
describe("revue de fin de vague 7 — les cartes suivent leurs lignes corrigées", () => {
  const ligneDe = (id: string) => CAPACITES.find((c) => c.id === id)!;
  const carte = (id: string) => CARTES.find((c) => c.id === id)!;
  const puce = (id: string) => CARTES.flatMap((c) => c.limites).find((l) => l.id === id)!;

  it("K14 suit E3 : la démo n'écrit rien, un viewer écrit le sien, le triage reste aux administrateurs", () => {
    const e3 = ligneDe("E3");
    expect(e3.verdict).toBe(VERDICT_MONTRABLE);
    expect(e3.limite).toContain("**La session démo n'écrit rien**");
    expect(e3.limite).toContain("**Un viewer écrit ce qui est à lui, dans son périmètre**");
    expect(e3.limite).toContain("`apps/console/lib/dashboard-access.ts:117-135`");
    // C7 : les écritures quittent l'API v1 — la règle est celle de la commande.
    expect(e3.limite).toContain("`apps/console/lib/commandes/vues.ts:33`");
    expect(e3.limite).toContain("**Le triage d'une issue** (`A8`) reste réservé à l'administrateur de l'application de l'issue");
    // L'ancienne limite, que le code contredisait déjà sur le commit relevé.
    expect(e3.limite).not.toContain("ne gagnent **aucun** droit d'écriture");

    const k14 = carte("K14");
    expect(k14.faitQuoi).not.toContain("réservées aux sessions d'administration");
    expect(puce("E3").texte).toContain("La session de démonstration n'écrit rien");
    expect(puce("E3").texte).toContain("un viewer ne crée et ne modifie que ses propres tableaux de bord et vues");
    expect(puce("E3").texte).toContain("le triage des issues est réservé aux administrateurs");
    expect(puce("E3").texte).not.toMatch(/aucun droit d'écriture/);
  });

  it("la puce B6 de K7 suit B6 : 24 éléments par tableau, sections comprises, depuis F37", () => {
    const b6 = ligneDe("B6");
    expect(b6.verdict).toBe(VERDICT_MONTRABLE);
    expect(b6.limite).toContain(`${MAX_WIDGETS} éléments par tableau, **sections comprises**`);
    expect(b6.preuve).toContain("`layoutPlein`");
    expect(b6.limite).not.toContain("24 cartes par tableau");
    // Le code : une section prend la place d'une carte, et le tableau est plein à la borne.
    const section = { type: "section", title: "Où ?" };
    const cartes = Array.from({ length: MAX_WIDGETS - 1 }, () => ({ type: "traffic" }));
    expect(layoutPlein(normalizeLayout([section, ...cartes]))).toBe(true);
    expect(layoutPlein(normalizeLayout(cartes))).toBe(false);

    const texte = puce("B6").texte;
    expect(texte).toContain(`${MAX_WIDGETS} éléments par tableau, sections comprises`);
    expect(texte).not.toContain("cartes par tableau");
    expect(carte("K7").limites.map((l) => l.id)).toContain("B6");
  });
});
