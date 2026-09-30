// ImpactTable (F05, plan § 4.2, P3) : la référence est une ligne, pas une barre ;
// l'échantillon faible est écrit ; l'inconnu n'a pas de barre ; un tri indisponible
// dit pourquoi ; l'ordre « fourni » est écrit ; aucune ligne « Autres ».
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { decouperEcart, drapeau, ImpactTable, type ImpactLigne } from "@/components/ImpactTable";

const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");

const LIGNE = (cle: string, pilote: number | null, volume: number, faible = false): ImpactLigne => ({
  cle,
  libelle: cle,
  href: `/pages?route=${encodeURIComponent(cle)}`,
  description: `Route ${cle}`,
  pilote,
  volume,
  mesures: [{ cle: "lcp", valeur: pilote, affichage: pilote == null ? "—" : `${pilote} ms`, vital: "LCP" }],
  echantillonFaible: faible,
});

const BASE = {
  titre: "Segments les plus dégradés",
  triHref: { gravite: "/?", volume: "/?tri=volume", impact: null, fourni: null },
  colonnes: ["LCP p75"],
  unitePilote: "ms",
  volumeLibelle: "Mesures LCP",
  groupes: 3,
  tronque: false,
  notice: "Route normalisée.",
} as const;

describe("ImpactTable", () => {
  const html = renderToStaticMarkup(
    <ImpactTable
      {...BASE}
      tri="gravite"
      reference={{ libelle: "Ensemble", valeurs: { pilote: "2,5 s", volume: "5 608", lcp: "2,5 s" } }}
      lignes={[LIGNE("/checkout", 4100, 412), LIGNE("/rare", 6200, 12, true), LIGNE("Inconnu", null, 0, true)]}
    />,
  );

  it("la référence « Ensemble » est une ligne distincte, jamais une barre", () => {
    expect(html).toContain('data-testid="impact-reference"');
    expect(texte(html)).toContain("référence, non classée");
    expect(html.match(/data-testid="impact-ligne"/g)).toHaveLength(3);
  });

  it("échantillon faible écrit ; pilote inconnu : « — » et aucune barre", () => {
    expect(html.match(/échantillon faible/g)?.length).toBeGreaterThanOrEqual(2);
    // Deux barres pour trois lignes : la ligne sans pilote n'en a pas.
    expect(html.match(/data-barre=""/g)).toHaveLength(2);
  });

  it("verdict écrit à côté de la teinte, seulement pour une mesure qui porte `vital`", () => {
    // La colonne « LCP p75 » double la valeur classée : elle n'est pas répétée, son
    // verdict passe sur la valeur (et la barre prend la teinte du verdict).
    expect(texte(html)).toContain("4,1 s Mauvais");
    expect(texte(html)).not.toContain("LCP p75 4100 ms");
    expect(html).toContain("bg-bad opacity-80");
  });

  it("pistes de largeur FIXE : une grille commune faite de longueurs, choisie par la largeur de la TABLE", () => {
    // Refonte du 30/09/2026 : l'en-tête, la référence et chaque ligne partagent la MÊME
    // grille (variables CSS de la table), faite de longueurs et de fractions — jamais
    // du contenu (`auto`, `min-content`) : une barre plus longue veut dire une valeur
    // plus grande. Elle est choisie par la largeur de la table (`@container`), pas de
    // la fenêtre, sur des plages disjointes.
    expect(html).toContain("[container-type:inline-size]");
    for (const nom of ["--grille-etroite", "--grille-moyenne", "--grille-large"]) {
      const valeur = new RegExp(`${nom}:([^;"]+)`).exec(html)?.[1] ?? "";
      expect(valeur, nom).toMatch(/^(?:(?:minmax\(\d+(?:\.\d+)?rem,\d+(?:\.\d+)?fr\)|minmax\(0,\d+(?:\.\d+)?fr\)|\d+(?:\.\d+)?rem) ?)+$/);
      expect(valeur, nom).not.toMatch(/auto|content/);
    }
    // En-tête + référence + trois lignes : cinq grilles identiques.
    expect(html.match(/\[grid-template-columns:var\(--grille-etroite\)\]/g)).toHaveLength(5);
    expect(html).toContain("[@container_(min-width:28rem)_and_(max-width:");
    expect(html).not.toMatch(/\b(sm|lg):grid-cols-/);
    expect(html).not.toContain("flex-1");
    // L'alternative garde toutes les colonnes, doublon compris.
    const alternative = html.split('data-testid="alternative"')[1] ?? "";
    expect(texte(alternative)).toContain("4100 ms (Mauvais)");
  });

  it("colonnePilote = null : aucune colonne n'est retirée", () => {
    const tout = renderToStaticMarkup(
      <ImpactTable {...BASE} tri="gravite" reference={null} referenceRaison="—" lignes={[LIGNE("/a", 900, 40)]} colonnePilote={null} />,
    );
    // L'en-tête nomme la colonne, et la ligne porte la valeur deux fois : classée, puis
    // dans sa colonne « LCP p75 ». Par défaut, la colonne qui double la valeur est retirée.
    const [entete] = tout.split('data-testid="impact-reference-absente"');
    expect(texte(entete)).toContain("LCP p75");
    const ligne = tout.split('data-testid="impact-ligne"')[1]?.split("</li>")[0] ?? "";
    expect(texte(ligne).match(/900 ms/g)).toHaveLength(2);
    const defaut = renderToStaticMarkup(
      <ImpactTable {...BASE} tri="gravite" reference={null} referenceRaison="—" lignes={[LIGNE("/a", 900, 40)]} />,
    );
    const ligneDefaut = defaut.split('data-testid="impact-ligne"')[1]?.split("</li>")[0] ?? "";
    expect(texte(ligneDefaut).match(/900 ms/g)).toHaveLength(1);
  });

  // Recette du 26/09/2026 : « Impact » barré en permanence. Un ordre que l'écran ne
  // propose pas n'est pas montré ; les ordres proposés restent des liens.
  it("un ordre non proposé (impact) n'est pas affiché ; l'ordre proposé est un lien", () => {
    expect(html).not.toContain('data-testid="tri-impact"');
    expect(html).toContain('data-testid="tri-gravite"');
    expect(html).toContain('href="/?tri=volume"');
  });

  it("un seul ordre possible : il est écrit, pas proposé comme un choix", () => {
    const seul = renderToStaticMarkup(
      <ImpactTable
        {...BASE}
        tri="gravite"
        triHref={{ gravite: "/?", volume: null, impact: null, fourni: null }}
        reference={null}
        referenceRaison="—"
        lignes={[LIGNE("/a", 900, 40)]}
      />,
    );
    expect(seul).not.toContain('data-testid="bascule-tri"');
    expect(texte(seul)).toContain("Classés par gravité");
  });

  it("un sélecteur de l'écran (le vital) se pose dans la même rangée que l'ordre", () => {
    const avec = renderToStaticMarkup(
      <ImpactTable
        {...BASE}
        tri="gravite"
        commandes={<nav data-testid="choix-vital">Vital : LCP p75</nav>}
        reference={null}
        referenceRaison="—"
        lignes={[LIGNE("/a", 900, 40)]}
      />,
    );
    const rangee = avec.split('data-testid="impact-commandes"')[1]?.split("</div>")[0] ?? "";
    expect(rangee).toContain('data-testid="choix-vital"');
    expect(rangee).toContain('data-testid="bascule-tri"');
  });

  it("une notice vide ne laisse aucun paragraphe vide", () => {
    const sans = renderToStaticMarkup(
      <ImpactTable {...BASE} notice="" tri="gravite" reference={null} referenceRaison="—" lignes={[LIGNE("/a", 900, 40)]} />,
    );
    expect(sans).not.toMatch(/<p[^>]*><\/p>/);
  });

  it("valeur approchée : la valeur classée s'écrit « ≈ »", () => {
    const approchee = renderToStaticMarkup(
      <ImpactTable {...BASE} approchee tri="gravite" reference={null} referenceRaison="—" lignes={[LIGNE("/a", 93, 40)]} />,
    );
    expect(texte(approchee)).toContain("≈ 93 ms");
  });

  // Recette du 26/09/2026 : la tuile disait « verdict incertain » pour 304 ms, la table
  // « À améliorer ». Avec son intervalle, la table suit la règle des tuiles.
  it("verdict avec intervalle : affirmé s'il tient sur tout l'intervalle, sinon « incertain » sans couleur", () => {
    const ligne = (cle: string, pilote: number, bas: number, haut: number): ImpactLigne => ({
      ...LIGNE(cle, pilote, 400),
      mesures: [
        {
          cle: "inp",
          valeur: pilote,
          affichage: `${pilote} ms`,
          vital: "INP",
          n: 400,
          intervalle: { bas, haut, niveau: 0.95, methode: "quantile_normal" },
        },
      ],
    });
    const rendu = renderToStaticMarkup(
      <ImpactTable
        {...BASE}
        colonnes={["INP p75"]}
        tri="gravite"
        reference={null}
        referenceRaison="—"
        lignes={[ligne("/incertain", 304, 180, 330), ligne("/etabli", 320, 260, 380)]}
      />,
    );
    const lignes = rendu.split('data-testid="impact-ligne"').slice(1);
    expect(texte(lignes[0])).toContain("verdict incertain : entre Bon et À améliorer");
    expect(lignes[0]).not.toMatch(/bg-warn|bg-good|bg-bad/);
    expect(texte(lignes[1])).toContain("À améliorer");
    expect(lignes[1]).toContain('data-verdict="etabli"');
  });

  // Contre-recette du 26/09/2026 : « Côté » et « Tendance » de /map valaient « — » partout.
  it("une mesure textuelle s'écrit telle quelle ; une valeur nulle sans ce drapeau reste « — »", () => {
    const ligne: ImpactLigne = {
      ...LIGNE("/api/items/:id", 120, 80),
      mesures: [
        { cle: "cote", valeur: null, affichage: "serveur", texte: true },
        { cle: "err", valeur: null, affichage: "12 %" },
      ],
    };
    const rendu = renderToStaticMarkup(
      <ImpactTable {...BASE} colonnes={["Côté", "Taux d'erreur"]} tri="gravite" reference={null} referenceRaison="—" lignes={[ligne]} colonnePilote={null} />,
    );
    // Les en-têtes nomment les colonnes ; chaque cellule porte sa valeur, alignée dessous.
    expect(texte(rendu.split('data-testid="impact-ligne"')[0])).toMatch(/Côté Taux d'erreur/);
    const [, corps] = rendu.split('data-testid="impact-ligne"');
    const cellule = (cle: string) => {
      const apres = corps.split(`data-colonne="${cle}"`)[1] ?? "";
      return texte(apres.slice(apres.indexOf(">") + 1).split("</span>")[0]).trim();
    };
    expect(cellule("cote")).toBe("serveur");
    expect(cellule("err")).toBe("—");
  });

  it("une barre sans verdict affirmé est neutre, jamais l'orange de marque", () => {
    const sansVital: ImpactLigne = { ...LIGNE("/a", 300, 40), mesures: [] };
    const rendu = renderToStaticMarkup(
      <ImpactTable {...BASE} colonnes={[]} tri="gravite" reference={null} referenceRaison="—" lignes={[sansVital]} />,
    );
    const barre = /<span[^>]*class="([^"]*)"[^>]*data-barre=""/.exec(rendu)?.[1] ?? "";
    expect(barre).toContain("bg-ink-faint/50");
    expect(barre).not.toContain("bg-accent");
  });

  it("aucune ligne « Autres », aucun total", () => {
    expect(texte(html)).not.toMatch(/\bAutres\b(?! »)|Total/);
  });

  // Charte § 3.5 : dix lignes, puis « Voir les N autres » (repli natif, sans JS) ; les
  // lignes repliées restent dans le document (liens, alternative, lecteurs d'écran).
  it("dix lignes, puis « Voir les N autres » : le reste replié, jamais retiré", () => {
    const douze = Array.from({ length: 12 }, (_v, i) => LIGNE(`/r${i}`, 1000 + i, 100 + i));
    const rendu = renderToStaticMarkup(<ImpactTable {...BASE} tri="gravite" reference={null} referenceRaison="—" lignes={douze} />);
    const [avant, reste] = rendu.split('data-testid="impact-reste"');
    expect(avant.match(/data-testid="impact-ligne"/g)).toHaveLength(10);
    expect(reste.match(/data-testid="impact-ligne"/g)).toHaveLength(2);
    expect(texte(reste)).toContain("Voir les 2 autres");
    expect(rendu).toContain('<ol start="11"');
    // L'alternative garde les douze.
    expect(texte(rendu.split('data-testid="alternative"')[1] ?? "")).toContain("/r11");
    // Dix lignes ou moins : aucun repli.
    expect(html).not.toContain('data-testid="impact-reste"');
  });

  // Une ligne = 32 px, pas une phrase : ce qu'elle disait en toutes lettres (verdict
  // incertain, « vs ensemble ») passe en bulle au survol et en texte lu.
  it("aucune phrase visible dans une ligne : verdict incertain en bulle, « vs ensemble » lu", () => {
    const ligne: ImpactLigne = {
      ...LIGNE("/lent", 304, 400),
      mesures: [
        {
          cle: "inp",
          valeur: 304,
          affichage: "304 ms",
          vital: "INP",
          n: 400,
          intervalle: { bas: 180, haut: 330, niveau: 0.95, methode: "quantile_normal" },
        },
      ],
      ecart: { valeur: 1200, affichage: "+1,2 s vs ensemble" },
    };
    const rendu = renderToStaticMarkup(
      <ImpactTable {...BASE} colonnes={["INP p75"]} tri="gravite" reference={null} referenceRaison="—" lignes={[ligne]} />,
    );
    const corps = rendu.split('data-testid="impact-ligne"')[1] ?? "";
    // La bulle de la valeur dit le verdict ; la pastille est un cercle vide, sans couleur.
    expect(corps).toContain('title="verdict incertain : entre Bon et À améliorer"');
    expect(corps).toContain("○");
    expect(corps).not.toMatch(/text-(good|warn|bad)\b/);
    // L'écart : la valeur dans la cellule, la référence nommée lue et en bulle.
    const ecart = corps.split('data-testid="impact-ecart"')[1]?.split("</span></span>")[0] ?? "";
    expect(ecart).toContain('title="+1,2 s vs ensemble"');
    expect(texte(ecart)).toContain("+1,2 s");
    const lu = ecart.split('<span class="sr-only">')[1] ?? "";
    expect(texte(lu)).toContain("vs ensemble");
    expect(decouperEcart("−4,1 s vs ensemble")).toEqual({ valeur: "−4,1 s", reference: "vs ensemble" });
    expect(decouperEcart("—")).toEqual({ valeur: "—", reference: null });
  });

  it("pictogrammes : logo du navigateur ou du système, drapeau du pays, jamais un <span> avant le libellé", () => {
    const segment = (libelle: string): ImpactLigne => ({ ...LIGNE(libelle, 2000, 300), libelle, mesures: [] });
    const nav = renderToStaticMarkup(
      <ImpactTable
        {...BASE}
        dimension="browser"
        colonnes={[]}
        tri="gravite"
        reference={null}
        referenceRaison="—"
        lignes={["Chrome", "Edge", "Inconnu"].map(segment)}
      />,
    );
    const lignes = nav.split('data-testid="impact-ligne"').slice(1);
    // Chrome : le tracé Simple Icons, à sa couleur ; Edge (sans tracé) : un monogramme neutre.
    expect(lignes[0]).toContain('fill="#4285F4"');
    expect(texte(lignes[1])).toMatch(/^\s*[^<]*e\s+Edge/);
    expect(texte(lignes[2])).toContain("?");
    // Le premier <span> d'une ligne est son libellé (les e2e le lisent) : le pictogramme
    // est un <svg> ou un <i>.
    for (const [i, nom] of ["Chrome", "Edge", "Inconnu"].entries()) {
      expect(/<span[^>]*>([^<]*)</.exec(lignes[i])?.[1]).toBe(nom);
    }
    // L'en-tête de la première colonne nomme la dimension.
    expect(texte(nav.split('data-testid="impact-reference-absente"')[0])).toContain("Navigateur");

    const pays = renderToStaticMarkup(
      <ImpactTable {...BASE} dimension="country" colonnes={[]} tri="gravite" reference={null} referenceRaison="—" lignes={[segment("FR")]} />,
    );
    expect(pays).toContain("🇫🇷");
    expect(drapeau("FR")).toBe("🇫🇷");
    expect(drapeau("Inconnu")).toBeNull();
    // Une route : ses paramètres grisés, le libellé entier gardé.
    const route = renderToStaticMarkup(
      <ImpactTable {...BASE} colonnes={[]} tri="gravite" reference={null} referenceRaison="—" lignes={[segment("/items/:id")]} />,
    );
    expect(route).toMatch(/title="\/items\/:id">\/items\/<span class="text-ink-faint">:id<\/span>/);
  });

  it("ordre fourni : écrit sous le titre, pas de bascule ; sans référence, la raison", () => {
    const fourni = renderToStaticMarkup(
      <ImpactTable
        {...BASE}
        tri="fourni"
        ordreLibelle="Releases dans l'ordre chronologique."
        reference={null}
        referenceRaison="aucune part « toutes releases » n'est lue."
        lignes={[LIGNE("1.4.0", 10, 400), LIGNE("1.4.1", 30, 500)]}
      />,
    );
    expect(texte(fourni)).toContain("Releases dans l'ordre chronologique.");
    expect(fourni).not.toContain('data-testid="bascule-tri"');
    expect(texte(fourni)).toContain("Pas de ligne « Ensemble » : aucune part « toutes releases » n'est lue.");
    // L'ordre reçu est rendu tel quel.
    expect(fourni.indexOf("1.4.0")).toBeLessThan(fourni.indexOf("1.4.1"));
  });
});
