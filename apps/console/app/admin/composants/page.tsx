// Vitrine des composants (F03, plan § 6.4) — réservée aux administrateurs.
//
// POURQUOI UNE PAGE. Un composant se relit dans TOUS ses états, pas seulement dans
// celui que la base de démonstration produit ce jour-là : une valeur inconnue, une
// référence nulle, une période précédente purgée, un échantillon faible, une
// alerte. Ici, chaque état est rendu sur des données FIXES écrites dans la page —
// aucune lecture en base, rien qui dépende du trafic. C'est la preuve de fin de
// F03, et celle des lots qui y ajouteront leurs composants (F04, F05, F07, F08, F56).
//
// Pas sous `app/demo` : cette route est l'accès de démonstration.
import type { ReactNode } from "react";
import { PageHeader } from "@/components/PageHeader";
import { DeltaBadge, HeroStat } from "@/components/SupervisionHero";
import { VitalCard } from "@/components/VitalCard";
import { Donut } from "@/components/charts/Donut";
import { Figure } from "@/components/charts/Figure";
import { KpiLibelle } from "@/components/charts/KpiLibelle";
import { KpiTile } from "@/components/charts/KpiTile";
import { LineTrend, type LineTrendPoint } from "@/components/charts/LineTrend";
import { RankBar, type RankDatum } from "@/components/charts/RankBar";
import { ScatterPlot, type ScatterPoint } from "@/components/charts/ScatterPlot";
import { Sparkline } from "@/components/charts/Sparkline";
import { requireAdmin } from "@/lib/auth";
import { formater, type FormatId } from "@/lib/fmt-ids";
import { CATEGORIELLE, RATING_HEX } from "@/lib/palette";
import { THRESHOLDS, rating2026 } from "@/lib/rating";
import { SectionPanneau } from "./sections/panneau";
import { SectionsDistributions } from "./sections/distributions";
import { SectionsPresets } from "./sections/presets";
import { SectionsFiabilite } from "./sections/fiabilite";
import { SectionsSeries } from "./sections/series";
import { SectionIntervalles } from "./sections/intervalles";
import { SectionF49 } from "./sections/f49";
import { SectionF38 } from "./sections/f38";
import { SectionF50 } from "./sections/f50";

export const dynamic = "force-dynamic";

// ─────────────────────────────── Données fixes ───────────────────────────────

const REFERENCE = "vs 24 h précédentes (20/09 14:00 → 21/09 14:00 UTC)";
const COMPLETE = { etat: "complete", raison: null, n: 1180 } as const;

/** LCP p75 par heure, 24 seaux, deux heures sans mesure (des trous, pas des zéros). */
const SERIE_LCP: (number | null)[] = [
  2300, 2350, 2280, 2420, 2610, 2580, null, null, 2490, 2550, 2700, 2820, 2760, 2690, 2640, 2710, 2780, 2900,
  2850, 2800, 2760, 2720, 2690, 2700,
];
const SERIE_SESSIONS: (number | null)[] = [
  40, 38, 35, 30, 28, 26, 31, 45, 60, 72, 80, 84, 86, 83, 79, 77, 75, 73, 70, 64, 58, 52, 47, 43,
];

const FORMATS: { id: FormatId; valeur: number | null }[] = [
  { id: "ms", valeur: 820 },
  { id: "ms", valeur: 2700 },
  { id: "s-auto", valeur: 372_000 },
  { id: "cls", valeur: 0.0312 },
  { id: "pct", valeur: 0.124 },
  { id: "count", valeur: 1240 },
  { id: "bytes", valeur: 18_432 },
  { id: "score", valeur: 72 },
  { id: "ratio", valeur: 3 },
  { id: "pour100", valeur: 150 },
  { id: "pour100", valeur: 2.43 },
  { id: "pct", valeur: null },
];

const CLASSEMENT: RankDatum[] = [
  { label: "/checkout", value: 3420, display: formater("ms", 3420), sub: "412 mesures", href: "/pages?route=%2Fcheckout" },
  { label: "/panier", value: 2710, display: formater("ms", 2710), sub: "1 204 mesures", href: "/pages?route=%2Fpanier" },
  { label: "/produit/[id]", value: 2240, display: formater("ms", 2240), sub: "3 980 mesures", href: "/pages?route=%2Fproduit%2F%5Bid%5D" },
  { label: "/compte/historique-des-commandes-archivees", value: null, sub: "12 mesures · échantillon faible" },
].map((d) => ({ ...d, color: d.value == null ? undefined : RATING_HEX[rating2026("LCP", d.value) ?? "good"] }));

const CANAUX: RankDatum[] = [
  { label: "Direct", value: 540, segments: [{ value: 540, color: CATEGORIELLE[0], label: "Direct" }] },
  { label: "Recherche", value: 320, segments: [{ value: 320, color: CATEGORIELLE[1], label: "Recherche" }] },
  { label: "Réseaux sociaux", value: 0, segments: [{ value: 0, color: CATEGORIELLE[2], label: "Réseaux sociaux" }] },
];

const ELEMENTS: ScatterPoint[] = [
  { x: 1840, y: 620, label: "button#payer", href: "/ux?cible=button%23payer" },
  { x: 920, y: 340, label: "input#code-promo", href: "/ux?cible=input%23code-promo" },
  { x: 2400, y: 180, label: "a.menu" },
  { x: 310, y: 710, label: "select#livraison", href: "/ux?cible=select%23livraison" },
  { x: 150, y: 90, label: "button.fermer" },
].map((p) => ({ ...p, color: RATING_HEX[rating2026("INP", p.y) ?? "good"] }));

const ROUTES_LCP: ScatterPoint[] = [
  { x: 1900, y: 0.8, label: "/" },
  { x: 2600, y: 2.1, label: "/panier" },
  { x: 3400, y: 4.2, label: "/checkout" },
  { x: 4600, y: 1.2, label: "/compte" },
];

const TENDANCE: LineTrendPoint[] = [
  { label: "S-5", reel: 42, precedente: 40, robot: 45 },
  { label: "S-4", reel: 44, precedente: 41, robot: 45 },
  { label: "S-3", reel: null, precedente: 43, robot: 46 },
  { label: "S-2", reel: 47, precedente: 44, robot: null },
  { label: "S-1", reel: 49, precedente: 45, robot: 47 },
  { label: "S", reel: 51, precedente: 46, robot: 48 },
];

const SIX_SERIES: LineTrendPoint[] = TENDANCE.map((p, i) => ({
  label: p.label,
  a: 10 + i,
  b: 12 + i,
  c: 8 + i,
  d: 14 - i,
  e: 9 + (i % 2),
  f: 11,
}));

// ─────────────────────────────── Mise en page ───────────────────────────────

function Section({ id, titre, sous, children }: { id: string; titre: string; sous: string; children: ReactNode }) {
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

/** Un exemple : l'état qu'il montre, écrit au-dessus. */
function Exemple({ etat, children }: { etat: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-xs font-medium text-ink-soft">{etat}</p>
      {children}
    </div>
  );
}

const GRILLE = "grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3";

export default async function VitrineComposants() {
  await requireAdmin();

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Vitrine des composants"
        sub="Chaque composant de la bibliothèque, dans chacun de ses états, sur des données fixes écrites dans cette page : aucune lecture en base."
      />

      <Section id="formats" titre="Formats nommés" sous="lib/fmt-ids.ts : un identifiant en chaîne, jamais une fonction ; null → « — ».">
        <div className="card overflow-x-auto">
          <table className="w-full min-w-max text-sm">
            <caption className="sr-only">Rendu de chaque format pour une valeur d&apos;exemple</caption>
            <thead className="bg-panel2">
              <tr>
                <th scope="col" className="th">
                  Format
                </th>
                <th scope="col" className="th text-right">
                  Valeur brute
                </th>
                <th scope="col" className="th text-right">
                  Rendu
                </th>
              </tr>
            </thead>
            <tbody>
              {FORMATS.map((f, i) => (
                <tr key={i} className="border-t border-line/60">
                  <th scope="row" className="px-4 py-2 text-left font-mono text-xs font-normal text-ink">
                    {f.id}
                  </th>
                  <td className="px-4 py-2 text-right font-mono text-xs text-ink-soft">{String(f.valeur)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink" data-testid={`format-${f.id}`}>
                    {formater(f.id, f.valeur)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        id="kpi-tile"
        titre="KpiTile"
        sous="Tuile chiffre-clé : un delta seulement contre une référence nommée, complète, non nulle et suffisamment mesurée ; une couleur seulement pour un vital au p75 ou une alerte à règle écrite."
      >
        <div className={GRILLE}>
          <Exemple etat="Vital au p75, delta, sparkline, lien">
            <KpiTile
              label="LCP p75"
              valeur={2700}
              format="ms"
              vital="LCP"
              precedent={2490}
              reference={REFERENCE}
              couverturePrecedente={COMPLETE}
              couverture={{ n: 1240, unite: "mesures" }}
              serie={SERIE_LCP}
              href="/pages?vital=LCP"
            />
          </Exemple>
          <Exemple etat="Valeur inconnue (null)">
            <KpiTile
              label="Occurrences d'erreurs pour 100 pages vues"
              valeur={null}
              format="pour100"
              raisonNull="aucune page vue sur la période : pas de dénominateur"
              precedent={2.1}
              reference={REFERENCE}
              couverturePrecedente={COMPLETE}
            />
          </Exemple>
          <Exemple etat="Précédent null">
            <KpiTile
              label="Sessions commencées"
              valeur={1240}
              format="count"
              precedent={null}
              reference={REFERENCE}
              couverturePrecedente={COMPLETE}
              couverture={{ n: 1240, unite: "sessions", faibleSous: 30 }}
              serie={SERIE_SESSIONS}
            />
          </Exemple>
          <Exemple etat="Précédent 0">
            <KpiTile
              label="Occurrences d'erreurs"
              valeur={12}
              format="count"
              sensMeilleur="bas"
              precedent={0}
              reference={REFERENCE}
              couverturePrecedente={COMPLETE}
              couverture={{ n: 1240, unite: "pages vues", faibleSous: 30 }}
            />
          </Exemple>
          <Exemple etat="Période précédente incomplète">
            <KpiTile
              label="Pages vues"
              valeur={5320}
              format="count"
              precedent={3100}
              reference={REFERENCE}
              couverturePrecedente={{
                etat: "partielle",
                raison: "période précédente hors rétention (30 jours) : les données les plus anciennes ont été purgées",
              }}
            />
          </Exemple>
          <Exemple etat="Échantillon faible">
            <KpiTile
              label="INP p75"
              valeur={240}
              format="ms"
              vital="INP"
              precedent={210}
              reference={REFERENCE}
              couverturePrecedente={COMPLETE}
              couverture={{ n: 40, unite: "mesures" }}
              lecture="médiane 180 ms"
            />
          </Exemple>
          <Exemple etat="Alerte vraie (valeur > 0)">
            <KpiTile
              label="Règles d'alerte sans canal"
              valeur={3}
              format="count"
              alerte={{ si: ">", valeur: 0, regle: "aucun canal : personne n'est prévenu" }}
            />
          </Exemple>
          <Exemple etat="Alerte fausse (valeur = 0) : aucun ton">
            <KpiTile
              label="Règles d'alerte sans canal"
              valeur={0}
              format="count"
              alerte={{ si: ">", valeur: 0, regle: "aucun canal : personne n'est prévenu" }}
            />
          </Exemple>
          <Exemple etat="Intervalle qui chevauche un seuil : verdict incertain">
            <KpiTile
              label="LCP p75"
              valeur={2400}
              format="ms"
              vital="LCP"
              couverture={{ n: 180, unite: "mesures" }}
              intervalle={{ bas: 2100, haut: 3000, niveau: 0.95, methode: "quantile_normal" }}
            />
          </Exemple>
          <Exemple etat="Intervalle indisponible : verdict non établi">
            <KpiTile
              label="INP p75"
              valeur={180}
              format="ms"
              vital="INP"
              couverture={{ n: 9, unite: "mesures" }}
              intervalle={{ indisponible: "moins de 13 mesures" }}
            />
          </Exemple>
          <Exemple etat="Mieux vers le haut, intervalle de Wilson">
            <KpiTile
              label="Sessions sans erreur"
              valeur={0.962}
              format="pct"
              sensMeilleur="haut"
              precedent={0.9}
              reference={REFERENCE}
              couverturePrecedente={COMPLETE}
              couverture={{ n: 1240, unite: "sessions", faibleSous: 30 }}
              intervalle={{ bas: 0.95, haut: 0.972, niveau: 0.95, methode: "wilson" }}
            />
          </Exemple>
          <Exemple etat="Delta stable (sous ±2 %), volume neutre">
            <KpiTile
              label="Pages vues"
              valeur={5320}
              format="count"
              precedent={5260}
              reference="vs release 1.4.1 (même fenêtre)"
              couverture={{ n: 5320, unite: "pages vues", faibleSous: 30 }}
            />
          </Exemple>
        </div>
      </Section>

      <Section id="kpi-libelle" titre="KpiLibelle" sous="Tuile dont la valeur est un texte : même gabarit, sans delta ni verdict.">
        <div className={GRILLE}>
          <Exemple etat="Texte">
            <KpiLibelle label="Page d'entrée n°1" texte="/partners · 28 sessions sur 28" lecture="sessions commencées sur 24 h" />
          </Exemple>
          <Exemple etat="Inconnu (null)">
            <KpiLibelle label="Service le plus sollicité" texte={null} raisonNull="aucun appel tracé sur la période" />
          </Exemple>
          <Exemple etat="Texte long, lien">
            <KpiLibelle
              label="Route la plus lente"
              texte="/compte/historique-des-commandes-archivees/2026/septembre · 412 mesures"
              href="/pages?route=%2Fcompte"
            />
          </Exemple>
        </div>
      </Section>

      <Section id="sparkline" titre="Sparkline" sous="Un trou reste un trou ; l'axe part de 0 ; moins de deux points, rien n'est tracé.">
        <div className={GRILLE}>
          <Exemple etat="Série avec deux seaux sans mesure">
            <Sparkline valeurs={SERIE_LCP} label="LCP p75, 24 seaux d'une heure" />
          </Exemple>
          <Exemple etat="Bande « Bon » (seuils LCP)">
            <Sparkline valeurs={SERIE_LCP} label="LCP p75, 24 seaux d'une heure" seuils={THRESHOLDS.LCP} largeur={160} hauteur={32} />
          </Exemple>
          <Exemple etat="Points isolés entre des trous">
            <Sparkline valeurs={[1, null, 3, null, 2]} label="Occurrences, 5 seaux" />
          </Exemple>
          <Exemple etat="Pas assez de points">
            <Sparkline valeurs={[null, 4, null, null]} label="Occurrences, 4 seaux" />
          </Exemple>
          <Exemple etat="Échelle commune d'une liste (max 90)">
            <div className="flex flex-col gap-1">
              <Sparkline valeurs={[10, 20, 15, 30]} label="Groupe A, 4 seaux" max={90} />
              <Sparkline valeurs={[60, 90, 75, 80]} label="Groupe B, 4 seaux" max={90} />
            </div>
          </Exemple>
        </div>
      </Section>

      <Section id="figure" titre="Figure" sous="Titre, méta, lecture, alternative textuelle ; un état remplace le dessin.">
        <div className={GRILLE}>
          <Exemple etat="Avec données">
            <Figure
              titre="Quelles routes ont le LCP le plus lent ?"
              aide="LCP"
              id="vitrine-figure-donnees"
              meta={
                <>
                  <span>5 608 mesures</span>
                  <span>24 h (UTC)</span>
                  <span>4 routes, 4 affichées</span>
                </>
              }
              lecture="Classement par p75 décroissant ; une route sous 30 mesures est rangée en fin, sans valeur."
              explorer="/explorer?dataset=vitals&measure=p75&run=1"
              alternative={{
                legende: "LCP p75 par route, 24 h",
                colonnes: ["Route", "LCP p75", "Mesures"],
                lignes: [
                  ["/checkout", formater("ms", 3420), 412],
                  ["/panier", formater("ms", 2710), 1204],
                  ["/produit/[id]", formater("ms", 2240), 3980],
                  ["/compte/historique-des-commandes-archivees", null, 12],
                ],
              }}
            >
              <RankBar data={CLASSEMENT} alternative={false} labelWidth="10rem" />
            </Figure>
          </Exemple>
          <Exemple etat="État vide">
            <Figure titre="Erreurs par navigateur" etat={{ kind: "vide", population: "erreur", plage: "24 h" }} />
          </Exemple>
          <Exemple etat="État partiel">
            <Figure titre="Sessions par pays estimé" etat={{ kind: "partiel", raison: "200 pays affichés sur 212 lus" }} />
          </Exemple>
          <Exemple etat="État erreur">
            <Figure titre="Occurrences par heure" etat={{ kind: "erreur", titre: "Occurrences par heure" }} />
          </Exemple>
          <Exemple etat="État non collecté">
            <Figure
              titre="Signaux de frustration"
              etat={{ kind: "non_collecte", manque: "le SDK mobile n'émet pas de signaux de frustration" }}
            />
          </Exemple>
          <Exemple etat="État échantillonné">
            <Figure titre="Sessions commencées" etat={{ kind: "echantillonne", probaMin: 0.2, unite: "session", biaiseErreurs: true }} />
          </Exemple>
          <Exemple etat="État chargement">
            <Figure titre="LCP p75 par heure" etat={{ kind: "chargement", titre: "LCP p75 par heure" }} />
          </Exemple>
        </div>
      </Section>

      <Section id="scatter" titre="ScatterPlot" sous="Nuage de points : bandes de seuils sur y seulement, repère vertical nommé, étiquettes des points les plus hauts.">
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <Figure
            titre="Éléments lents à l'INP"
            meta={<span>5 éléments · 24 h</span>}
            lecture="Un point = un élément ; les trois plus lents sont étiquetés ; un point sans lien n'ouvre rien."
            alternative={{
              legende: "Éléments interactifs : interactions et INP p75",
              colonnes: ["Élément", "Interactions", "INP p75", "Lien"],
              lignes: ELEMENTS.map((p) => [p.label, p.x, formater("ms", p.y), p.href ? "oui" : "non cliquable"]),
            }}
          >
            <ScatterPlot
              points={ELEMENTS}
              xLabel="Interactions"
              yLabel="INP p75"
              yUnit=" ms"
              yFormat="int"
              etiquettes={3}
              bandesY={{ vital: "INP" }}
              height={260}
              ariaLabel="Éléments lents à l'INP : 5 éléments, interactions × INP p75, bandes de seuils INP"
            />
          </Figure>
          <Figure
            titre="Taux d'erreur selon le LCP des routes"
            meta={<span>4 routes · 24 h</span>}
            alternative={{
              legende: "Routes : LCP p75 et occurrences pour 100 pages vues",
              colonnes: ["Route", "LCP p75", "Occurrences pour 100 pages vues"],
              lignes: ROUTES_LCP.map((p) => [p.label, formater("ms", p.x), formater("pour100", p.y)]),
            }}
          >
            <ScatterPlot
              points={ROUTES_LCP}
              xLabel="LCP p75 (ms)"
              yLabel="Pour 100 pages vues"
              xFormat="int"
              repereX={{ valeur: THRESHOLDS.LCP[0], libelle: "LCP « Bon »" }}
              height={260}
              ariaLabel="Routes : LCP p75 × occurrences pour 100 pages vues, repère du seuil LCP Bon"
            />
          </Figure>
        </div>
      </Section>

      <Section id="line-trend" titre="LineTrend" sous="Séries nommées par rôle (≤ 5) : réel orange, référence grise pointillée, robot bleu pointillé.">
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <Figure
            titre="Taux de rétention hebdomadaire"
            meta={<span>6 semaines · un trou en S-3 (réel) et S-2 (robot)</span>}
            alternative={{
              legende: "Rétention par semaine",
              colonnes: ["Semaine", "Réel", "Période précédente", "Robot"],
              lignes: TENDANCE.map((p) => [p.label, p.reel ?? null, p.precedente ?? null, p.robot ?? null]),
            }}
          >
            <LineTrend
              data={TENDANCE}
              valueName="Rétention"
              valueUnit=" %"
              height={220}
              series={[
                { cle: "reel", libelle: "Réel", role: "principale" },
                { cle: "precedente", libelle: "Période précédente", role: "reference" },
                { cle: "robot", libelle: "Robot", role: "robot" },
              ]}
            />
          </Figure>
          <Figure
            titre="Six séries demandées"
            lecture="Au-delà de cinq séries, les suivantes ne sont pas tracées, et la figure le dit."
            alternative={{
              legende: "Six séries par semaine",
              colonnes: ["Semaine", "A", "B", "C", "D", "E", "F"],
              lignes: SIX_SERIES.map((p) => [p.label, p.a ?? null, p.b ?? null, p.c ?? null, p.d ?? null, p.e ?? null, p.f ?? null]),
            }}
          >
            <LineTrend
              data={SIX_SERIES}
              valueName="Valeur"
              height={220}
              series={["a", "b", "c", "d", "e", "f"].map((cle) => ({
                cle,
                libelle: `Série ${cle.toUpperCase()}`,
                role: "categorie" as const,
              }))}
            />
          </Figure>
        </div>
      </Section>

      <Section id="rank-bar" titre="RankBar" sous="Classement en barres ; alternative textuelle intégrée ; libellés à 7rem au plus sous 640 px.">
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <Exemple etat="Lignes-liens, sous-textes, valeur inconnue">
            <div className="card p-4">
              <RankBar data={CLASSEMENT} legende="LCP p75 par route, 24 h" />
            </div>
          </Exemple>
          <Exemple etat="Sans lien (image), part à 0">
            <div className="card p-4">
              <RankBar data={CANAUX} legende="Sessions par canal d'acquisition" />
            </div>
          </Exemple>
          <Exemple etat="Vide">
            <div className="card p-4">
              <RankBar data={[]} />
            </div>
          </Exemple>
        </div>
      </Section>

      <SectionsDistributions />

      <Section id="donut" titre="Donut" sous="Parts d'un compte additif seulement ; la part inconnue est nommée ; les parts à 0 restent dans la légende.">
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <Exemple etat="Trois parts, dont l'inconnue">
            <div className="card p-4">
              <Donut
                slices={[
                  { label: "Nouvelles", value: 610, color: CATEGORIELLE[0] },
                  { label: "Revenantes", value: 240, color: CATEGORIELLE[1] },
                  { label: "Via un lien partagé", value: 0, color: CATEGORIELLE[2] },
                ]}
                inconnu={{ label: "Non identifiées", value: 150 }}
                centerValue="1 000"
                centerLabel="sessions actives"
                size={160}
                thickness={28}
              />
            </div>
          </Exemple>
          <Exemple etat="Total nul">
            <div className="card p-4">
              <Donut
                slices={[
                  { label: "Nouvelles", value: 0, color: CATEGORIELLE[0] },
                  { label: "Revenantes", value: 0, color: CATEGORIELLE[1] },
                ]}
                centerValue="0"
                centerLabel="sessions actives"
                size={160}
                thickness={28}
              />
            </div>
          </Exemple>
        </div>
      </Section>

      <Section id="vital-card" titre="VitalCard" sous="Carte d'un Web Vital : fenêtre écrite, jauge des seuils décrite, sparkline, intervalle à 95 %.">
        <div className={GRILLE}>
          <Exemple etat="Nominal, sparkline, lien">
            <VitalCard name="LCP" p75={2700} median={2100} n={1240} prev={2490} periodLabel="24 h" serie={SERIE_LCP} href="/pages?vital=LCP" />
          </Exemple>
          <Exemple etat="Intervalle qui chevauche un seuil">
            <VitalCard
              name="LCP"
              p75={2400}
              n={180}
              periodLabel="7 j"
              intervalle={{ bas: 2100, haut: 3000, niveau: 0.95, methode: "quantile_normal" }}
            />
          </Exemple>
          <Exemple etat="Échantillon faible, intervalle indisponible">
            <VitalCard name="INP" p75={180} median={150} n={9} periodLabel="1 h" intervalle={{ indisponible: "moins de 13 mesures" }} />
          </Exemple>
          <Exemple etat="Aucune mesure">
            <VitalCard name="CLS" p75={null} n={0} periodLabel="24 h" />
          </Exemple>
        </div>
      </Section>

      <Section id="delta" titre="DeltaBadge et HeroStat" sous="Un écart s'écrit avec sa référence, visible ; sous ±2 %, « → » sans couleur.">
        <div className={GRILLE}>
          <Exemple etat="Dégradation (mieux vers le bas)">
            <DeltaBadge pct={12.4} reference={REFERENCE} lowerIsBetter />
          </Exemple>
          <Exemple etat="Amélioration (mieux vers le haut)">
            <DeltaBadge pct={6} reference="release 1.4.1 (même fenêtre)" />
          </Exemple>
          <Exemple etat="Volume : flèche sans couleur">
            <DeltaBadge pct={-18} reference="période précédente" sensMeilleur="neutre" />
          </Exemple>
          <Exemple etat="HeroStat avec delta">
            <HeroStat label="Pages vues" value="5 320" delta={{ pct: 1.2, reference: "période précédente" }} />
          </Exemple>
        </div>
      </Section>
      <SectionPanneau />
      <SectionsSeries />
      <SectionIntervalles />
      <SectionsPresets />
      <SectionsFiabilite />
      <SectionF49 />
      <SectionF38 />
      <SectionF50 />
    </div>
  );
}
