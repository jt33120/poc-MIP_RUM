// Vitrine — composants de F05 : distributions, classements, fuseaux (plan § 4.1,
// § 4.2). Rendus dans chacun de leurs états sur des données FIXES écrites ici :
// aucune lecture en base. Preuve de fin de F05 sur /admin/composants.
//
// Fichier propre au lot (les lots d'une même vague ajoutent chacun le leur) : la
// page n'en porte que l'import et une ligne de rendu.
import type { ReactNode } from "react";
import { Breakdown, type BreakdownItem, type OngletDecoupage } from "@/components/Breakdown";
import { PercentileTable } from "@/components/Distribution";
import { ImpactTable, type ImpactLigne } from "@/components/ImpactTable";
import { ContrastBars } from "@/components/charts/ContrastBars";
import { DistributionSeuils, bacsDeHistogramme } from "@/components/charts/DistributionSeuils";
import { HealthHeatmap, type CaseSante } from "@/components/charts/HealthHeatmap";
import type { BreakdownTab } from "@/lib/breakdowns";
import { formater } from "@/lib/fmt-ids";
import { classerParGravite, ecartALaReference, estFaible } from "@/lib/impact";
import { paramReader } from "@/lib/query-contract";
import { lireTri } from "@/lib/view-state";

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

function Exemple({ etat, children }: { etat: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-xs font-medium text-ink-soft">{etat}</p>
      {children}
    </div>
  );
}

const ANCRE = "/admin/composants";

// ──────────────────────────── DistributionSeuils ─────────────────────────────

/** Sortie de `width_bucket` : bacs 1 à 20 puis 21 = « ≥ plafond ». */
const histo = (comptes: number[]) => comptes.map((count, i) => ({ bucket: i + 1, count }));

const LCP_COMPTES = [4, 18, 42, 88, 130, 150, 138, 120, 96, 80, 64, 50, 40, 31, 24, 18, 14, 10, 8, 6, 22];
const LCP_BACS = bacsDeHistogramme(histo(LCP_COMPTES), 6000);
const LCP_N = LCP_COMPTES.reduce((s, c) => s + c, 0);

const INP_COMPTES = [30, 120, 210, 260, 240, 190, 150, 110, 80, 64, 50, 40, 31, 24, 19, 15, 12, 9, 7, 5, 26];
const INP_BACS = bacsDeHistogramme(histo(INP_COMPTES), 320);
const INP_N = INP_COMPTES.reduce((s, c) => s + c, 0);

const CLS_BACS = bacsDeHistogramme(histo([20, 8, 5, 3, 2, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 1);

// ─────────────────────────────── Classements ─────────────────────────────────

interface Route {
  route: string | null;
  lcp: number | null;
  n: number;
  inp: number | null;
  cls: number | null;
}

const ROUTES: Route[] = [
  { route: "/produit/[id]", lcp: 2240, n: 3980, inp: 150, cls: 0.03 },
  { route: "/panier", lcp: 2900, n: 1204, inp: 180, cls: 0.12 },
  { route: "/checkout", lcp: 4100, n: 412, inp: 240, cls: 0.08 },
  { route: "/compte/historique-des-commandes-archivees", lcp: 6200, n: 12, inp: 310, cls: 0.3 },
  { route: null, lcp: null, n: 0, inp: 90, cls: 0.02 },
];
const ENSEMBLE_LCP = 2480;
const signe = (e: number | null) =>
  e == null ? null : `${e > 0 ? "+" : e < 0 ? "−" : "±"}${formater("ms", Math.abs(e))}`;
const libelle = (r: Route) => r.route ?? "Inconnu";

const CLASSEES = classerParGravite(ROUTES, { tri: "gravite", pilote: (r) => r.lcp, effectif: (r) => r.n }).lignes;

const LIGNES_IMPACT: ImpactLigne[] = CLASSEES.map((r) => {
  const ecart = ecartALaReference(r.lcp, ENSEMBLE_LCP);
  return {
    cle: r.route === null ? " inconnu" : `v:${r.route}`,
    libelle: libelle(r),
    href: r.route === null ? `/pages?seg=v2%3Aroute%3Ais_null` : `/pages?panel=route%3A${encodeURIComponent(r.route)}`,
    description: `Route ${libelle(r)} — LCP p75 ${formater("ms", r.lcp)}, ${r.n} mesures`,
    pilote: r.lcp,
    volume: r.n,
    mesures: [
      { cle: "lcp", valeur: r.lcp, affichage: formater("ms", r.lcp), vital: "LCP", n: r.n },
      { cle: "inp", valeur: r.inp, affichage: formater("ms", r.inp), vital: "INP" },
      { cle: "cls", valeur: r.cls, affichage: formater("cls", r.cls), vital: "CLS" },
    ],
    ecart: { valeur: ecart, affichage: ecart == null ? "—" : `${signe(ecart)} vs ensemble` },
    echantillonFaible: estFaible(r.n),
  };
});

const ONGLETS: OngletDecoupage[] = [
  { dimension: "route", label: "Route", available: true, reason: null, current: true, href: `${ANCRE}#impact-table` },
  { dimension: "browser", label: "Navigateur", available: true, reason: null, current: false, href: `${ANCRE}#impact-table` },
  {
    dimension: "release",
    label: "Release",
    available: false,
    reason: "Release : pas encore collectée sur ce déploiement (colonne absente).",
    current: false,
    href: null,
  },
];

const RELEASES: ImpactLigne[] = [
  { v: "1.4.0", taux: 0.021, sessions: 812 },
  { v: "1.4.1", taux: null, sessions: 6 },
  { v: "1.4.2", taux: 0.064, sessions: 1430 },
].map((r) => ({
  cle: r.v,
  libelle: r.v,
  href: `/mobile?release=${r.v}`,
  description: `Release ${r.v} — ${r.sessions} sessions`,
  pilote: r.taux,
  volume: r.sessions,
  mesures: [{ cle: "taux", valeur: r.taux, affichage: formater("pct", r.taux) }],
  echantillonFaible: estFaible(r.sessions),
}));

// Breakdown : les mêmes routes, classées, dans la grammaire « barre = lien ».
const ITEMS_GRAVITE: BreakdownItem[] = CLASSEES.map((r) => ({
  key: r.route === null ? " inconnu" : `v:${r.route}`,
  label: libelle(r),
  value: r.lcp,
  display: formater("ms", r.lcp),
  href: `/pages?route=${encodeURIComponent(r.route ?? "")}`,
  description: `Route ${libelle(r)} — ${r.n} mesure(s) LCP, LCP p75 ${formater("ms", r.lcp)}`,
  cells: [
    { label: "Mesures LCP", value: r.n.toLocaleString("fr-FR") },
    { label: "INP", value: formater("ms", r.inp) },
  ],
  ecart: signe(ecartALaReference(r.lcp, ENSEMBLE_LCP)),
  echantillonFaible: estFaible(r.n),
}));

const ITEMS_VOLUME: BreakdownItem[] = classerParGravite(ROUTES, { tri: "volume", pilote: (r) => r.lcp, effectif: (r) => r.n }).lignes.map(
  (r) => ({
    key: r.route === null ? " inconnu" : `v:${r.route}`,
    label: libelle(r),
    value: r.n,
    display: r.n.toLocaleString("fr-FR"),
    href: `/pages?route=${encodeURIComponent(r.route ?? "")}`,
    description: `Route ${libelle(r)} — ${r.n} mesure(s) LCP`,
    cells: [{ label: "LCP", value: formater("ms", r.lcp) }],
    echantillonFaible: estFaible(r.n),
  }),
);

const TABS: BreakdownTab[] = [
  { dimension: "route", label: "Route", available: true, reason: null, current: true, href: `${ANCRE}#breakdown` },
  { dimension: "browser", label: "Navigateur", available: true, reason: null, current: false, href: `${ANCRE}#breakdown` },
];
const ONGLETS_SESSIONS: OngletDecoupage[] = [
  ...TABS,
  { dimension: "source", label: "Capteur", available: true, reason: null, current: false, href: `${ANCRE}#breakdown` },
];

// ────────────────────────────── HealthHeatmap ────────────────────────────────

const JOURS = ["2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20", "2026-09-21"];
// Rendu « à » 22:30 à Paris le 21/09 : l'heure 22 est en cours (30 minutes écoulées).
const MAINTENANT = Date.parse("2026-09-21T20:30:00Z");
const CASES: CaseSante[] = JOURS.flatMap((jour, j) =>
  Array.from({ length: 16 }, (_v, i) => i + 7)
    // Le week-end, presque rien avant 10 h ; une heure sans mesure reste un trou.
    .filter((h) => !(j >= 4 && j <= 5 && h < 10) && !(j === 2 && h === 13))
    .map((h) => {
      const total = 20 + ((h * 7 + j * 3) % 30);
      const bon = Math.round(total * (0.35 + (((h + j * 5) % 13) / 13) * 0.65));
      return { day: jour, hour: h, good_w: bon, total_w: total };
    }),
);

// ─────────────────────────────── Page ────────────────────────────────────────

export function SectionsDistributions() {
  const triImpossible = lireTri("/", paramReader({ tri: "impact" })).ignore;

  return (
    <>
      <Section
        id="distribution-seuils"
        titre="DistributionSeuils"
        sous="La forme d'une population : barres colorées par la zone de seuil de chaque mesure (coupées au seuil), repères p50 / p75 / p95, dernière barre « ≥ plafond » dite."
      >
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <Exemple etat="LCP : nominal, plafond d'affichage par défaut">
            <div className="card p-4">
              <DistributionSeuils
                vital="LCP"
                bacs={LCP_BACS}
                plafond={6000}
                percentiles={{ p50: 2100, p75: 2900, p95: 5200 }}
                n={LCP_N}
              />
            </div>
          </Exemple>
          <Exemple etat="INP : plafond adaptatif, valeur marquée, intervalle du p75">
            <div className="card p-4">
              <DistributionSeuils
                vital="INP"
                bacs={INP_BACS}
                plafond={320}
                plafondLibelle="plafond d'affichage : p99 arrondi (320 ms)"
                percentiles={{ p50: 96, p75: 150, p95: 290 }}
                n={INP_N}
                valeurMarquee={{ valeur: 240, libelle: "cette interaction :" }}
                intervalleP75={{ bas: 138, haut: 164 }}
              />
            </div>
          </Exemple>
          <Exemple etat="CLS : percentiles non calculables">
            <div className="card p-4">
              <DistributionSeuils vital="CLS" bacs={CLS_BACS} plafond={1} percentiles={null} n={40} />
            </div>
          </Exemple>
          <Exemple etat="Aucune mesure (n = 0)">
            <div className="card p-4">
              <DistributionSeuils vital="TTFB" bacs={[]} plafond={3000} percentiles={null} n={0} />
            </div>
          </Exemple>
        </div>
      </Section>

      <Section
        id="impact-table"
        titre="ImpactTable"
        sous="Segments classés par gravité (lib/impact.ts) : l'ensemble en ligne de référence, jamais une barre ; un échantillon faible en fin, écrit ; l'inconnu en dernier ; pas de ligne « Autres »."
      >
        <div className="grid min-w-0 gap-4">
          <Exemple etat="Tri gravité, écart à l'ensemble, impact indisponible (B2), onglet indisponible">
            <ImpactTable
              titre="Segments les plus dégradés"
              onglets={ONGLETS}
              tri="gravite"
              triHref={{ gravite: `${ANCRE}#impact-table`, volume: `${ANCRE}#impact-table`, impact: null, fourni: null }}
              reference={{
                libelle: "Ensemble",
                valeurs: { pilote: formater("ms", ENSEMBLE_LCP), volume: "5 608", lcp: formater("ms", ENSEMBLE_LCP), inp: "170 ms", cls: "0,060" },
              }}
              lignes={LIGNES_IMPACT}
              colonnes={["LCP p75", "INP p75", "CLS p75"]}
              unitePilote="ms"
              volumeLibelle="Mesures LCP"
              groupes={5}
              tronque={false}
              notice="Route normalisée au moment de la mesure (jamais l'URL brute)."
            />
          </Exemple>
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <Exemple etat="Ordre fourni (chronologie), sans ligne « Ensemble », compact, tronqué">
              <ImpactTable
                titre="Stabilité par release"
                tri="fourni"
                triHref={{ gravite: null, volume: null, impact: null, fourni: null }}
                ordreLibelle="Releases dans l'ordre chronologique, la plus récente en bas."
                reference={null}
                referenceRaison="aucune part « toutes releases » n'est lue par cette comparaison."
                lignes={RELEASES}
                colonnes={["Sessions en erreur"]}
                unitePilote="pct"
                volumeLibelle="Sessions"
                groupes={14}
                tronque
                notice="Release déclarée par l'émetteur sur chaque session."
                compact
              />
            </Exemple>
            <Exemple etat="Aucun groupe">
              <ImpactTable
                titre="Services classés"
                tri="volume"
                triHref={{ gravite: `${ANCRE}#impact-table`, volume: `${ANCRE}#impact-table`, impact: null, fourni: null }}
                reference={null}
                referenceRaison="aucune p75 « tous appels » n'est servie, et une moyenne des p75 est interdite."
                lignes={[]}
                colonnes={[]}
                unitePilote="ms"
                volumeLibelle="Appels"
                groupes={0}
                tronque={false}
                notice="Appels tracés côté serveur."
                compact
              />
            </Exemple>
          </div>
        </div>
      </Section>

      <Section
        id="contrast-bars"
        titre="ContrastBars"
        sous="Ce qu'ont en commun les touchés : part parmi eux, part dans la base, rapport écrit ; « non disponible » tant que les dénominateurs par groupe (B3) manquent."
      >
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <Exemple etat="Indisponible (B3 non livré)">
            <ContrastBars
              dimensionLibelle="Navigateur"
              populationTouchee="sessions avec cette erreur"
              populationBase="toutes les sessions de la fenêtre"
              lignes={[]}
              indisponible="les lectures ne rendent pas encore, par navigateur, le nombre de sessions de la fenêtre (backend B3)."
            />
          </Exemple>
          <Exemple etat="Avec dénominateurs et test (P*.6)">
            <div className="card p-4">
              <ContrastBars
                dimensionLibelle="Navigateur"
                populationTouchee="sessions avec cette erreur"
                populationBase="toutes les sessions de la fenêtre"
                testees={18}
                regle="test exact de Fisher unilatéral, Benjamini-Hochberg 5 %."
                lignes={[
                  { valeur: "Safari", nTouches: 20, nBase: 1500, partTouches: 0.24, partBase: 0.31, href: "/errors?browser=Safari", test: { pAjuste: 0.8, retenu: false } },
                  { valeur: "Inconnu", nTouches: 8, nBase: 40, partTouches: 0.1, partBase: 0.008, href: "/errors?seg=v2%3Abrowser%3Ais_null" },
                  { valeur: "Chrome Mobile", nTouches: 48, nBase: 1200, partTouches: 0.6, partBase: 0.24, href: "/errors?browser=Chrome%20Mobile", test: { pAjuste: 0.0004, retenu: true } },
                  { valeur: "Firefox", nTouches: 4, nBase: 300, partTouches: 0.05, partBase: 0.06, href: "/errors?browser=Firefox" },
                  { valeur: "Navigateur intégré", nTouches: 12, nBase: 0, partTouches: 0.15, partBase: null, href: "/errors?browser=Navigateur%20int%C3%A9gr%C3%A9" },
                ]}
              />
            </div>
          </Exemple>
        </div>
      </Section>

      <Section
        id="breakdown"
        titre="Breakdown (tri, écart, échantillon faible)"
        sous="Découpage classé par gravité ou par volume (bascule = liens), écart à l'ensemble, échantillon faible écrit ; `onglets` remplace la liste par défaut."
      >
        <div className="grid min-w-0 gap-4 xl:grid-cols-2">
          <Exemple etat="Gravité (défaut), réglage ignoré signalé">
            <Breakdown
              title="Web Vitals par dimension"
              tabs={TABS}
              notice="Route normalisée au moment de la mesure (jamais l'URL brute)."
              items={ITEMS_GRAVITE}
              columns={["Mesures LCP", "INP p75"]}
              groups={5}
              truncated={false}
              emptyLabel="Aucune mesure sur 24 h."
              measureLabel="LCP p75"
              tri="gravite"
              triHref={{ gravite: `${ANCRE}#breakdown`, volume: `${ANCRE}#breakdown` }}
              avertissement={triImpossible}
              reference={`Écart au LCP p75 de l'ensemble (toute la population filtrée) : ${formater("ms", ENSEMBLE_LCP)} sur 5 608 mesures.`}
            />
          </Exemple>
          <Exemple etat="Volume, onglets propres à l'écran (Capteur)">
            <Breakdown
              title="Sessions par dimension"
              tabs={TABS}
              onglets={ONGLETS_SESSIONS}
              notice="Capteur déclaré par la session (navigateur, extension, application)."
              items={ITEMS_VOLUME}
              columns={["LCP p75"]}
              groups={9}
              truncated
              emptyLabel="Aucune mesure sur 24 h."
              measureLabel="Mesures"
              tri="volume"
              triHref={{ gravite: `${ANCRE}#breakdown`, volume: `${ANCRE}#breakdown` }}
            />
          </Exemple>
        </div>
      </Section>

      <Section
        id="health-heatmap"
        titre="HealthHeatmap"
        sous="Intensité sans verdict (échelle séquentielle) ; jours et heures du fuseau de l'app ; chaque case mesurée ouvre son heure, bornes converties en UTC ; l'heure en cours s'ouvre jusqu'à la minute écoulée."
      >
        <div className="grid min-w-0 gap-4">
          <Exemple etat="Europe/Paris, cases-liens, rendu à 22:30 le 21/09">
            <div className="card p-4">
              <HealthHeatmap
                jours={JOURS}
                cellules={CASES}
                fuseau="Europe/Paris"
                zoomHref="/?from={from}&to={to}"
                maintenant={MAINTENANT}
              />
            </div>
          </Exemple>
          <Exemple etat="Heures ouvrées, sans lien">
            <div className="card p-4">
              <HealthHeatmap jours={JOURS} cellules={CASES} fuseau="Europe/Paris" businessOnly maintenant={MAINTENANT} />
            </div>
          </Exemple>
        </div>
      </Section>

      <Section
        id="percentile-table"
        titre="PercentileTable"
        sous="p50 → p99 et effectif ; en-têtes déclarés (scope) ; verdict écrit au p75 seulement (R-V)."
      >
        <PercentileTable
          rows={[
            { name: "LCP", pcts: [2100, 2900, 3900, 5200, 7400], n: 1240 },
            { name: "INP", pcts: [96, 150, 240, 290, 610], n: 1810 },
            { name: "CLS", pcts: [0.02, 0.08, 0.14, 0.22, 0.41], n: 1190 },
            { name: "TTFB", pcts: [420, 680, 1100, 1500, 2600], n: 1240 },
          ]}
        />
      </Section>
    </>
  );
}
