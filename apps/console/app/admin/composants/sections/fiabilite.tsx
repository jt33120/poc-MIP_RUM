// Vitrine — composants du domaine fiabilité (F56, plan § 4.2 et § 4.3) : BudgetBars,
// MatriceConcordance, FriseDeclenchements, FriseEtats. Composant serveur, rendu par
// app/admin/composants/page.tsx.
//
// Données FIXES, sauf l'ancrage dans le temps (les frises finissent maintenant, comme
// à l'écran). Chaque état que la démo ne produit pas forcément est là : budget non
// mesurable, dépassement au-delà de l'échelle, atteinte négative ; cellule à 0 ;
// piste vide mais franchie, déclenchements non livrés / en attente / non acquittés,
// troncature, plus de 12 pistes ; case inconnue, case sans passage, regroupement.
//
// Aucune `Figure` n'est rendue ici avec un `etat` : la vitrine en montre déjà un par
// état (compté par l'e2e de F03). Les états vides des composants sont rendus seuls.
import type { ReactNode } from "react";
import { BudgetBars, type BudgetLigne } from "@/components/charts/BudgetBars";
import { Figure } from "@/components/charts/Figure";
import { FriseDeclenchements, type PisteDeclenchements } from "@/components/charts/FriseDeclenchements";
import { FriseEtats, type CaseEtat, type EtatDef } from "@/components/charts/FriseEtats";
import { MatriceConcordance } from "@/components/charts/MatriceConcordance";
import { ThresholdSeries } from "@/components/charts/ThresholdSeries";
import { formater } from "@/lib/fmt-ids";
import { grilleIso, type PointSerie } from "@/lib/series";

const HEURE = 3_600_000;
const JOUR = 24 * HEURE;
/** Les zooms de la vitrine restent sur la vitrine. */
const ZOOM = "/admin/composants?from={from}&to={to}#frise-etats";

function Bloc({ id, titre, sous, children }: { id: string; titre: string; sous: string; children: ReactNode }) {
  return (
    <section id={id} className="mb-10 min-w-0" aria-labelledby={`${id}-titre`}>
      <h2 id={`${id}-titre`} className="text-base font-semibold text-ink">
        {titre}
      </h2>
      <p className="mb-4 mt-1 text-sm text-ink-soft">{sous}</p>
      {children}
    </section>
  );
}

function Exemple({ etat, children }: { etat: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-xs font-medium text-ink-soft">{etat}</p>
      {children}
    </div>
  );
}

// ─────────────────────────────── BudgetBars ───────────────────────────────

const BUDGETS: BudgetLigne[] = [
  {
    cle: "slo-checkout",
    libelle: "LCP du tunnel de paiement",
    detail: "LCP · /checkout · 28 j · objectif 95 %",
    consomme: 312,
    atteinte: 0.844,
    objectif: 0.95,
    brule: true,
    href: "/admin/composants?slo=slo-checkout#budget-bars",
  },
  {
    cle: "slo-cent",
    libelle: "INP recherche",
    detail: "INP · /search · 7 j · objectif 90 %",
    consomme: 100,
    atteinte: 0.9,
    objectif: 0.9,
    brule: false,
    href: "/admin/composants?slo=slo-cent#budget-bars",
  },
  {
    cle: "slo-accueil",
    libelle: "LCP de l'accueil, route la plus visitée du site",
    detail: "LCP · / · 28 j · objectif 95 %",
    consomme: 80,
    atteinte: 0.96,
    objectif: 0.95,
    brule: false,
    href: "/admin/composants?slo=slo-accueil#budget-bars",
  },
  {
    cle: "slo-fiche",
    libelle: "CLS fiche produit",
    detail: "CLS · /produit/[id] · 28 j · objectif 99 %",
    consomme: 12,
    atteinte: 0.9988,
    objectif: 0.99,
    brule: null,
    href: "/admin/composants?slo=slo-fiche#budget-bars",
  },
  {
    cle: "slo-erreurs",
    libelle: "Erreurs du panier",
    detail: "1 − occurrences d'erreurs par page vue · /panier · 7 j · objectif 99 %",
    consomme: 999,
    atteinte: -0.42,
    objectif: 0.99,
    brule: true,
    raison: "plus d'occurrences d'erreurs que de pages vues : atteinte non interprétable",
    href: "/admin/composants?slo=slo-erreurs#budget-bars",
  },
  {
    cle: "slo-compte",
    libelle: "LCP espace client",
    detail: "LCP · /compte · 28 j · objectif 95 %",
    consomme: null,
    atteinte: null,
    objectif: 0.95,
    brule: null,
    raison: "aucune mesure LCP sur 28 j",
    href: "/admin/composants?slo=slo-compte#budget-bars",
  },
];

// ─────────────────────────────── FriseEtats ───────────────────────────────

const ETATS_ROBOT: EtatDef[] = [
  { cle: "ok", libelle: "ok", forme: "basse", ton: "neutre" },
  { cle: "warn", libelle: "avertissement", forme: "moyenne", glyphe: "!", ton: "warn" },
  { cle: "incident", libelle: "incident", forme: "haute", glyphe: "×", ton: "bad" },
  { cle: "inconnu", libelle: "état inconnu", forme: "contour", ton: "vide" },
  { cle: "absent", libelle: "aucun passage", forme: "hachure", ton: "vide" },
];

/** État robot d'une heure, déterministe : surtout ok, quelques alertes, trous et inconnus. */
function etatRobot(i: number): string | null {
  if (i % 11 === 4) return null; // aucun passage
  if (i % 17 === 9) return "inconnu";
  if (i % 13 === 7) return "incident";
  if (i % 7 === 3) return "warn";
  return "ok";
}

function casesRobot(grille: string[]): CaseEtat[] {
  return grille.map((t, i) => {
    const etat = etatRobot(i);
    const latence = 800 + ((i * 97) % 1400) + (etat === "incident" ? 2600 : 0);
    return {
      t,
      etat: etat ?? "absent",
      detail:
        etat == null
          ? "aucun passage du robot"
          : etat === "inconnu"
            ? "état non renseigné par le robot"
            : `premier chargement ${formater("ms", latence)} · ${1 + (i % 3)} scénario(s)`,
    };
  });
}

// ─────────────────────────────── FriseDeclenchements ───────────────────────────────

function pistesDeclenchements(t0: number): PisteDeclenchements[] {
  const a = (jours: number, heures = 0) => new Date(t0 + jours * JOUR + heures * HEURE).toISOString();
  const evt = (id: number) => `/admin/composants?evt=${id}#frise-declenchements`;
  return [
    {
      cle: "r-lcp",
      libelle: "LCP p75 /checkout > 4 s",
      href: "/admin/composants#regle-r-lcp",
      groupe: "regle",
      etatActuel: { libelle: "Franchie", ton: "bad" },
      marqueurs: [
        { t: a(2, 3), severite: "critical", livre: true, enAttente: false, acquitte: true, href: evt(1) },
        { t: a(9, 14), severite: "critical", livre: false, enAttente: false, acquitte: false, href: evt(2) },
        { t: a(21, 8), severite: "critical", livre: false, enAttente: true, acquitte: false, href: evt(3) },
        { t: a(28, 20), severite: "critical", livre: true, enAttente: false, acquitte: false, href: evt(4) },
      ],
    },
    {
      cle: "r-erreurs",
      libelle: "Occurrences d'erreurs pour 100 pages vues, écart à l'habitude (baseline)",
      href: "/admin/composants#regle-r-erreurs",
      groupe: "regle",
      etatActuel: { libelle: "Normale", ton: "good" },
      marqueurs: [
        { t: a(5, 1), severite: "warning", livre: true, enAttente: false, acquitte: true, href: evt(5) },
        { t: a(5, 9), severite: "warning", livre: true, enAttente: false, acquitte: true, href: evt(6) },
        { t: a(17, 2), severite: "info", livre: false, enAttente: false, acquitte: true, href: evt(7) },
      ],
    },
    {
      cle: "r-inp",
      libelle: "INP p75 /search > 500 ms",
      href: "/admin/composants#regle-r-inp",
      groupe: "regle",
      etatActuel: { libelle: "Franchie", ton: "bad", raison: "franchie à la dernière évaluation, aucun déclenchement sur 30 j" },
      marqueurs: [],
    },
    {
      cle: "r-logs",
      libelle: "Erreurs de journaux",
      href: "/admin/composants#regle-r-logs",
      groupe: "regle",
      etatActuel: { libelle: "Données insuffisantes", ton: "neutre", raison: "jamais évaluée" },
      marqueurs: [],
    },
    {
      cle: "slo-checkout",
      libelle: "SLO LCP du tunnel de paiement",
      href: "/admin/composants#budget-bars",
      groupe: "slo",
      etatActuel: null,
      marqueurs: [
        { t: a(26, 4), severite: "critical", livre: true, enAttente: false, acquitte: false, href: evt(8) },
        { t: a(29, 12), severite: "critical", livre: true, enAttente: false, acquitte: false, href: evt(9) },
        // Avant la période : non posé, jamais collé au bord.
        { t: new Date(t0 - 3 * JOUR).toISOString(), severite: "critical", livre: true, enAttente: false, acquitte: true, href: evt(10) },
      ],
    },
    {
      cle: "issue-7f3a",
      libelle: "Issue TypeError: cannot read properties of undefined (reading 'total')",
      href: "/admin/composants#frise-declenchements",
      groupe: "issue",
      etatActuel: null,
      marqueurs: [{ t: a(12, 16), severite: "warning", livre: false, enAttente: false, acquitte: false, href: evt(11) }],
    },
  ];
}

export function SectionsFiabilite() {
  // Ancrages : la frise horaire finit à l'heure en cours ; la frise de 30 jours, maintenant.
  const heureCourante = Math.floor(Date.now() / HEURE) * HEURE;
  const debuts24 = Array.from({ length: 24 }, (_v, i) => heureCourante - (23 - i) * HEURE);
  const grille24 = grilleIso(debuts24);
  const debuts300 = Array.from({ length: 300 }, (_v, i) => heureCourante - (299 - i) * HEURE);
  const grille300 = grilleIso(debuts300);
  const cases24 = casesRobot(grille24);
  const pointsRobot: PointSerie[] = grille24
    .map((t, i) => ({ t, lcp: etatRobot(i) == null ? null : 1600 + ((i * 131) % 2600), n: 40 + ((i * 7) % 60) }))
    .filter((p) => p.lcp !== null);

  const fin = Math.floor(Date.now() / 60_000) * 60_000;
  const debut = fin - 30 * JOUR;
  const pistes = pistesDeclenchements(debut);
  const beaucoup: PisteDeclenchements[] = Array.from({ length: 14 }, (_v, i) => ({
    cle: `r-${i}`,
    libelle: `Règle de démonstration ${i + 1}`,
    href: "/admin/composants#frise-declenchements",
    groupe: "regle",
    etatActuel: { libelle: i % 4 === 0 ? "Franchie" : "Normale", ton: i % 4 === 0 ? "bad" : "good" },
    marqueurs: Array.from({ length: i % 4 }, (_w, j) => ({
      t: new Date(debut + (3 + i + j * 7) * JOUR).toISOString(),
      severite: (["info", "warning", "critical"] as const)[(i + j) % 3],
      livre: (i + j) % 3 !== 0,
      enAttente: false,
      acquitte: j % 2 === 0,
      href: "/admin/composants#frise-declenchements",
    })),
  }));

  return (
    <>
      <Bloc
        id="budget-bars"
        titre="BudgetBars"
        sous="Budget d'erreur par SLO sur une échelle commune de 0 à 150 % : neutre sous 100 %, rouge à partir de 100 % (seul seuil défini), repères 50 / 75 % gris ; la valeur toujours écrite ; non mesurable sans barre."
      >
        <div className="grid min-w-0 gap-4">
          <Figure
            titre="Budget d'erreur consommé, par SLO"
            meta={<span>instantané calculé à la lecture ; chaque SLO sur sa fenêtre glissante jusqu&apos;à maintenant</span>}
          >
            <BudgetBars lignes={BUDGETS} ariaLabel="Budget d'erreur consommé par SLO, échelle 0 à 150 %" />
          </Figure>
          <Exemple etat="Aucun SLO : état vide (l'écran y ajoute son geste)">
            <BudgetBars lignes={[]} ariaLabel="Budget d'erreur consommé par SLO" />
          </Exemple>
        </div>
      </Bloc>

      <Bloc
        id="matrice-concordance"
        titre="MatriceConcordance"
        sous="Table robot × réel : intensité séquentielle sans verdict, « 0 » écrit, seules les cases nommées portent une teinte de sens ; ce qui sort de la matrice est compté à côté."
      >
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <Figure titre="Concordance des états, par heure et par route" meta={<span>heures × route avec au moins 30 mesures LCP</span>}>
            <MatriceConcordance
              lignes={[
                { cle: "ok", libelle: "ok" },
                { cle: "warn", libelle: "avertissement" },
                { cle: "incident", libelle: "incident" },
              ]}
              colonnes={[
                { cle: "good", libelle: "Bon" },
                { cle: "needs-improvement", libelle: "À améliorer" },
                { cle: "poor", libelle: "Mauvais" },
              ]}
              cellules={{
                ok: { good: 412, "needs-improvement": 38, poor: 9 },
                warn: { good: 21, "needs-improvement": 14, poor: 6 },
                incident: { good: 3, poor: 11 },
              }}
              nommees={[
                { ligne: "ok", colonne: "poor", nom: "angle mort", href: "/admin/composants#matrice-concordance", ton: "bad" },
                { ligne: "incident", colonne: "good", nom: "alerte robot non ressentie", ton: "warn" },
              ]}
              horsMatrice={[
                { libelle: "heures robot seul", n: 57 },
                { libelle: "heures réel seul", n: 1204 },
                { libelle: "heures au réel insuffisant (moins de 30 mesures)", n: 386 },
                { libelle: "état robot inconnu", n: 0 },
              ]}
              unite="heures × route"
            />
          </Figure>
          <Exemple etat="Cellules à 0 et une seule case remplie : pas de fond sous un zéro">
            <MatriceConcordance
              lignes={[
                { cle: "ok", libelle: "ok" },
                { cle: "incident", libelle: "incident" },
              ]}
              colonnes={[
                { cle: "good", libelle: "Bon" },
                { cle: "poor", libelle: "Mauvais" },
              ]}
              cellules={{ ok: { good: 2 } }}
              nommees={[{ ligne: "ok", colonne: "poor", nom: "angle mort", ton: "bad" }]}
              horsMatrice={[]}
              unite="heures × route"
            />
          </Exemple>
        </div>
      </Bloc>

      <Bloc
        id="frise-declenchements"
        titre="FriseDeclenchements"
        sous="Une piste par source, 30 jours : rond plein = livré, creux = non livré, losange = en attente, contour épais = non acquitté ; couleur et taille = sévérité ; état actuel à droite."
      >
        <div className="grid min-w-0 gap-4">
          <Figure titre="Déclenchements par règle" meta={<span>30 jours fixes, jusqu&apos;à maintenant</span>}>
            <FriseDeclenchements
              debut={new Date(debut).toISOString()}
              fin={new Date(fin).toISOString()}
              pistes={pistes}
              tronque="2 000 déclenchements affichés sur 30 j"
            />
          </Figure>
          <Exemple etat="14 sources : 12 pistes visibles, les autres repliées (P14)">
            <FriseDeclenchements debut={new Date(debut).toISOString()} fin={new Date(fin).toISOString()} pistes={beaucoup} />
          </Exemple>
        </div>
      </Bloc>

      <Bloc
        id="frise-etats"
        titre="FriseEtats"
        sous="Une case par seau, alignée sur la série au-dessus (mêmes marges) : l'état se lit par la hauteur, le glyphe, le contour ou les hachures ; aucune bande ; un seul arrêt de tabulation, flèches de case en case."
      >
        <div className="grid min-w-0 gap-4">
          <Figure titre="Robot et réel, par heure" meta={<span>24 h, seau d&apos;une heure, UTC</span>}>
            <ThresholdSeries
              grille={grille24}
              points={pointsRobot}
              series={[{ cle: "lcp", libelle: "LCP p75 réel", role: "principale", effectifCle: "n" }]}
              format="ms"
              vital="LCP"
              seauSecondes={3600}
              fuseau="UTC"
              hauteur={180}
              ariaLabel="LCP p75 réel par heure, 24 h"
            />
            <FriseEtats
              grille={grille24}
              seauSecondes={3600}
              cases={cases24}
              etats={ETATS_ROBOT}
              zoomHref={ZOOM}
              ariaLabel="Robot · état par heure, 24 h"
            />
            <p className="mt-1 text-[11px] text-ink-soft">État du robot, pas une note du LCP.</p>
          </Figure>
          <Exemple etat="300 heures : sous 2 px par case (390 px), cases regroupées par 3 seaux, pire état">
            <FriseEtats
              grille={grille300}
              seauSecondes={3600}
              cases={casesRobot(grille300)}
              etats={ETATS_ROBOT}
              ariaLabel="Robot · état par heure, 300 h"
            />
          </Exemple>
        </div>
      </Bloc>
    </>
  );
}
