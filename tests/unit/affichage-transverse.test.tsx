// Corrections transverses de la recette du 26/09/2026 : un seul fuseau d'affichage
// (heure de Paris), des nombres à la française, des pluriels calculés, la méthode
// derrière l'aide, et la période précédente incomplète dite une fois par rangée.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KpiTile } from "@/components/charts/KpiTile";
import { BandeauComparaison, MASQUE_SILENCE_REPETE, RangeeKpi, raisonsIncompletes } from "@/components/charts/RangeeKpi";
import { CapaciteFermee } from "@/components/CapaciteFermee";
import { accord, fmtDate, fmtHeure, fmtInstant, fmtJour, fmtPct, fmtPlage, fmtVital, pluriel } from "@/lib/format";
import { FUSEAU_AFFICHAGE, nomFuseau } from "@/lib/fuseau-local";

const NBSP = " ";
const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ");

describe("fuseau d'affichage unique", () => {
  it("Europe/Paris, nommé « heure de Paris » ; UTC reste UTC ; un autre fuseau garde son identifiant", () => {
    expect(FUSEAU_AFFICHAGE).toBe("Europe/Paris");
    expect(nomFuseau("Europe/Paris")).toBe("heure de Paris");
    expect(nomFuseau("Etc/UTC")).toBe("UTC");
    expect(nomFuseau("America/New_York")).toBe("America/New_York");
  });

  it("les formateurs partagés écrivent l'heure de Paris, été comme hiver, sans ISO", () => {
    expect(fmtDate("2026-09-26T12:03:27Z")).toBe("26/09 14:03");
    expect(fmtDate("2026-01-15T12:03:27Z")).toBe("15/01 13:03");
    expect(fmtHeure("2026-09-26T12:03:27Z", { secondes: true })).toBe("14:03:27");
    expect(fmtInstant("2026-09-26T12:03:27Z")).toBe("26/09 à 14:03");
    expect(fmtInstant("2026-09-26T12:03:27Z", { annee: true, sansA: true })).toBe("26/09/2026 14:03");
    expect(fmtJour("2026-09-25T22:30:00Z")).toBe("26/09");
    expect(fmtPlage("2026-09-20T12:00:00Z", "2026-09-21T12:00:00Z")).toBe("20/09 14:00 → 21/09 14:00");
  });

  it("un instant illisible s'écrit « — », jamais « Invalid Date »", () => {
    expect(fmtDate("pas une date")).toBe("—");
    expect(fmtInstant(Number.NaN)).toBe("—");
  });
});

describe("nombres et pluriels à la française", () => {
  it("CLS à la virgule, espace insécable avant « % »", () => {
    expect(fmtVital("CLS", 0.172)).toBe("0,172");
    expect(fmtPct(0.124)).toBe(`12,4${NBSP}%`);
  });

  it("singulier sous 2, pluriel au-delà ; nombre en chiffres français", () => {
    expect(pluriel(0, "mesure")).toBe(`0${NBSP}mesure`);
    expect(pluriel(1, "mesure")).toBe(`1${NBSP}mesure`);
    expect(pluriel(3, "mesure")).toBe(`3${NBSP}mesures`);
    expect(pluriel(1240, "session")).toBe(`1${String.fromCharCode(0x202f)}240${NBSP}sessions`);
    expect(accord(2, "travail", "travaux")).toBe("travaux");
  });
});

describe("KpiTile — la méthode derrière l'aide « ? »", () => {
  const base = { label: "Occurrences", valeur: 77, format: "count" as const };

  // Le mode détaillé (`epure={false}`) ; la case épurée, par défaut depuis le
  // 30/09/2026, range la méthode dans sa fenêtre (test suivant).
  it("tuile simple : la méthode vit dans la bulle, pas sous le chiffre", () => {
    const html = renderToStaticMarkup(<KpiTile {...base} epure={false} methode="somme des occurrences" />);
    expect(html).toContain('aria-label="Méthode : Occurrences"');
    expect(html).toContain('role="tooltip"');
    expect(html).toContain('data-testid="kpi-methode"');
  });

  it("tuile-lien : pas de bouton dans le lien, la méthode passe dans l'infobulle native", () => {
    const html = renderToStaticMarkup(<KpiTile {...base} epure={false} methode="somme des occurrences" href="/errors" />);
    expect(html).not.toContain("<button");
    expect(html).toContain('title="somme des occurrences"');
  });

  it("case épurée : la méthode est dans la fenêtre, jamais sous le chiffre", () => {
    const html = renderToStaticMarkup(<KpiTile {...base} methode="somme des occurrences" href="/errors" />);
    const [cas, fenetre] = html.split("<dialog");
    expect(cas).not.toContain("somme des occurrences");
    expect(fenetre).toMatch(/data-testid="kpi-methode"[^>]*>somme des occurrences</);
  });
});

describe("RangeeKpi — la période précédente incomplète, dite une fois", () => {
  const incomplete = { etat: "partielle" as const, raison: "erreurs collectées depuis le 26/09 à 14:02 seulement" };

  it("raisons distinctes, dans l'ordre ; les couvertures complètes et absentes sont ignorées", () => {
    expect(
      raisonsIncompletes([incomplete, undefined, { etat: "complete", raison: null }, incomplete, null]),
    ).toEqual([incomplete.raison]);
  });

  it("un seul bandeau au-dessus, et la phrase de chaque tuile masquée dans la rangée", () => {
    const tuile = (label: string) => (
      <KpiTile
        key={label}
        label={label}
        valeur={10}
        format="count"
        precedent={8}
        reference="vs 24 h précédentes (20/09 14:00 → 21/09 14:00)"
        couverturePrecedente={incomplete}
      />
    );
    const html = renderToStaticMarkup(
      <RangeeKpi couvertures={[incomplete, incomplete]} className="grid">
        {tuile("A")}
        {tuile("B")}
      </RangeeKpi>,
    );
    expect(html.match(/data-testid="bandeau-comparaison"/g)).toHaveLength(1);
    expect(texte(html)).toContain("Écarts non affichés — période précédente incomplète : erreurs collectées depuis le 26/09 à 14:02 seulement.");
    expect(html.replace(/&amp;/g, "&")).toContain(MASQUE_SILENCE_REPETE);
    // La tuile garde sa phrase (lue par son nom annoncé), marquée pour être masquée.
    expect(html.match(/data-motif="periode-incomplete"/g)).toHaveLength(2);
  });

  it("rien d'incomplet : ni bandeau, ni masque", () => {
    const html = renderToStaticMarkup(<RangeeKpi couvertures={[{ etat: "complete", raison: null }]} className="grid" />);
    expect(html).not.toContain("bandeau-comparaison");
    expect(html.replace(/&amp;/g, "&")).not.toContain(MASQUE_SILENCE_REPETE);
    expect(renderToStaticMarkup(<BandeauComparaison couvertures={[]} />)).toBe("");
  });
});

describe("CapaciteFermee — ce que l'écran apportera, et comment le demander", () => {
  it("dit l'apport et le geste pour l'ouvrir", () => {
    const t = texte(
      renderToStaticMarkup(
        <CapaciteFermee titre="Logs" sujet="Les journaux envoyés par vos serveurs, et non par le navigateur des visiteurs." />,
      ),
    );
    expect(t).toContain("Ce qu'il apportera :");
    expect(t).toContain("Pour l'ouvrir : demandez-le à votre interlocuteur MIP");
    expect(t).not.toMatch(/Capacité annoncée|accès non ouvert/);
  });
});
