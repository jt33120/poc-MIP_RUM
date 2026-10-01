// La section « Escalade » de /alerts (migration-v108) : une ligne par étape, le
// détail au clic, le grain du planificateur écrit, et rien d'écrivable pour qui ne
// peut pas écrire (V9). Un écran vide dit pourquoi en une ligne, avec le geste.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EscaladeSection } from "@/components/alerts/EscaladeSection";

const creer = async () => {};
const supprimer = async () => {};

const CANAUX = [
  { id: 12, app_id: "boutique", kind: "webhook", target: "https://hooks.exemple.fr/n1", active: true },
  { id: 13, app_id: null, kind: "slack", target: "https://hooks.exemple.fr/slack/n2", active: true },
  { id: 14, app_id: "boutique", kind: "email", target: "astreinte@exemple.fr", active: false },
];

const ETAPES = [
  {
    id: 1,
    app_id: "boutique",
    severity_min: "warning",
    level: 1,
    delay_minutes: 15,
    channel_id: 12,
    repeat_minutes: null,
    repeat_max: null,
    created_at: "2026-10-01T08:00:00.000Z",
    created_by: "ops@exemple.fr",
    canal_kind: "webhook",
    canal_target: "https://hooks.exemple.fr/n1",
    canal_actif: true,
    envois_30j: 3,
  },
  {
    id: 2,
    app_id: "boutique",
    severity_min: "critical",
    level: 2,
    delay_minutes: 60,
    channel_id: 14,
    repeat_minutes: 30,
    repeat_max: 4,
    created_at: "2026-10-01T08:05:00.000Z",
    created_by: null,
    canal_kind: "email",
    canal_target: "astreinte@exemple.fr",
    canal_actif: false,
    envois_30j: 0,
  },
  {
    id: 3,
    app_id: null,
    severity_min: "critical",
    level: 3,
    delay_minutes: 120,
    channel_id: 13,
    repeat_minutes: 60,
    repeat_max: 2,
    created_at: "2026-10-01T08:10:00.000Z",
    created_by: "plateforme@exemple.fr",
    canal_kind: "slack",
    canal_target: "https://hooks.exemple.fr/slack/n2",
    canal_actif: true,
    envois_30j: 1,
  },
];

const texte = (html: string) =>
  html
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ");

const rendre = (o: Partial<Parameters<typeof EscaladeSection>[0]> = {}) =>
  renderToStaticMarkup(
    <EscaladeSection
      disponible
      etapes={ETAPES}
      canaux={CANAUX}
      apps={[{ app_id: "boutique", name: "Boutique" }]}
      admin
      global
      cadenceMin={15}
      creer={creer}
      supprimer={supprimer}
      {...o}
    />,
  );

describe("EscaladeSection", () => {
  it("une ligne par étape, groupée par portée — toutes les applications d'abord —, le détail au clic", () => {
    const html = rendre();
    const t = texte(html);
    expect(html).toContain('id="escalade"');
    expect(t.indexOf("Toutes les applications")).toBeLessThan(t.indexOf("Application boutique"));
    for (const e of ETAPES) expect(html).toContain(`data-testid="etape-${e.id}"`);
    // Chaque ligne est un <details> : son <summary> est la ligne dense, le reste le détail.
    expect(html.match(/<details class="group/g)).toHaveLength(3);
    expect(t).toContain("N1 après 15 min");
    expect(t).toContain("3 envois · 30 j");
    expect(t).toContain("0 envoi · 30 j");
    expect(t).toContain(
      "un incident de l'application boutique, de sévérité avertissement ou plus, encore non acquitté 15 min après son premier déclenchement",
    );
    expect(t).toContain("par ops@exemple.fr");
  });

  it("l'auteur d'une étape est une adresse de compte : jamais montrée à un lecteur ni à une démonstration", () => {
    const html = rendre({ admin: false, global: false });
    expect(html).not.toContain("ops@exemple.fr");
    expect(html).not.toContain("plateforme@exemple.fr");
  });

  it("le grain du planificateur, la cadence lue, en tête de section et dans le détail", () => {
    const t = texte(rendre({ cadenceMin: 30 }));
    expect(t).toContain(
      "3 étapes · vérifiée à chaque passage du planificateur, toutes les 30 min : chaque délai part au premier passage qui suit son échéance · s'arrête à l'acquittement",
    );
  });

  it("un canal désactivé se voit sur la ligne ; une relance muette sous un niveau plus haut aussi", () => {
    const html = rendre();
    const t = texte(html);
    expect(t).toContain("canal désactivé");
    expect(t).toContain("— désactivé : rien ne part");
    // Le niveau 2 de « boutique » vise un canal désactivé : sa relance ne part pas.
    expect(t).toContain("relance à 30 min d'intervalle, 4 fois au plus, muette : son canal est désactivé");
    expect(html).toMatch(/line-through[^>]*>relance 30\s*min × 4/);
    // L'état en mots, lisible sans le trait ni le title.
    expect(t).toMatch(/relance 30\s*min × 4 · muette/);
    // Le niveau 3 global : dernier niveau, sa relance est active.
    expect(t).toContain("relance à 1 h d'intervalle, 2 fois au plus");
  });

  it("administrateur : le formulaire et la suppression confirmée ; la portée globale réservée à la plateforme", () => {
    const html = rendre();
    expect(html).toContain('data-testid="form-etape"');
    expect(html).toContain('data-testid="delete-etape-1"');
    expect(html).toMatch(/<option value=""[^>]*>toutes les applications<\/option>/);
    // Seuls les canaux ACTIFS se choisissent.
    expect(html).toMatch(/<option value="12"[^>]*>/);
    expect(html).not.toMatch(/<option value="14"/);
    // Le niveau proposé suit le plus haut existant.
    expect(html).toMatch(/name="level"[^>]*value="4"/);
    expect(rendre({ global: false })).not.toContain(">toutes les applications</option>");
  });

  it("lecteur (V9) : les étapes et leur détail, aucun formulaire ni bouton", () => {
    const html = rendre({ admin: false, global: false });
    expect(html).toContain('data-testid="etape-1"');
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Supprimer");
  });

  it("aucune étape : une ligne qui dit l'effet, et le geste pour un administrateur", () => {
    const admin = texte(rendre({ etapes: [] }));
    expect(admin).toContain("Aucune étape : un déclenchement non acquitté ne monte d'aucun niveau. + Créer une étape");
    const lecteur = texte(rendre({ etapes: [], admin: false, global: false }));
    expect(lecteur).toContain(
      "Aucune étape d'escalade : un déclenchement non acquitté ne monte d'aucun niveau. Demandez à un administrateur d'en créer une.",
    );
    // L'ancienne phrase était fausse : une règle franchie relève un déclenchement à chaque fenêtre.
    expect(admin + lecteur).not.toContain("n'est envoyé qu'une fois");
  });

  it("aucun canal actif : pas de formulaire, le lien vers les canaux", () => {
    const html = rendre({ etapes: [], canaux: [{ ...CANAUX[2] }] });
    expect(html).not.toContain('data-testid="form-etape"');
    expect(texte(html)).toContain("Une étape envoie vers un canal actif : aucun n'existe. Ajouter un canal");
    expect(html).toContain('href="#canaux"');
  });

  it("un refus de création revient en une ligne, formulaire ouvert", () => {
    const html = rendre({ refus: "le canal choisi n'est pas à la portée de l'étape." });
    expect(html).toContain('data-testid="escalade-refus"');
    expect(texte(html)).toContain("Étape non créée — le canal choisi n'est pas à la portée de l'étape.");
    expect(html).toMatch(/<details[^>]*id="nouvelle-etape"[^>]*open=""/);
    expect(rendre()).not.toContain('data-testid="escalade-refus"');
  });

  it("une base sans v108 : une ligne, sans formulaire ni nom de table", () => {
    const html = rendre({ disponible: false, etapes: [] });
    expect(texte(html)).toContain("Escalade indisponible : la base n'enregistre pas encore les étapes.");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("alert_escalation_step");
  });
});
