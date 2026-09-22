// Vitrine — séries temporelles (F04, plan § 4.2) : ThresholdSeries, StackedBars
// (nouvelle et ancienne forme), VitalsTimeseries, TrafficTimeseries, et le panneau
// de volume de LineTrend. Composant serveur, rendu par app/admin/composants/page.tsx.
//
// Données FIXES, sauf l'ancrage dans le temps : la grille horaire finit à l'heure en
// cours, pour que le « seau en cours » (point creux, légende) se voie aussi. Chaque
// état que la démo ne produit pas forcément est là : trous, points creux, seau en
// cours, borne « Mauvais » hors échelle, annotations et leur absence motivée,
// projection et bande d'incertitude, comptes à 0, six séries demandées, point hors
// grille.
import type { ReactNode } from "react";
import { Figure } from "@/components/charts/Figure";
import { LineTrend, type LineTrendPoint } from "@/components/charts/LineTrend";
import { StackedBars } from "@/components/charts/StackedBars";
import { ThresholdSeries } from "@/components/charts/ThresholdSeries";
import { TrafficTimeseries } from "@/components/charts/TrafficTimeseries";
import { VitalsTimeseries } from "@/components/charts/VitalsTimeseries";
import { formater } from "@/lib/fmt-ids";
import { CATEGORIELLE } from "@/lib/palette";
import { grilleIso, joursLocaux, libelleSeauComplet, type Annotation, type PointSerie } from "@/lib/series";

const HEURE = 3_600_000;
const FUSEAU_JOURS = "Europe/Paris";
/** Les zooms de la vitrine restent sur la vitrine. */
const ZOOM = "/admin/composants?from={from}&to={to}#threshold-series";

/** LCP p75 par heure : deux heures sans mesure, des effectifs faibles en début de journée. */
const LCP = [
  2300, 2350, 2280, null, null, 2580, 2610, 2490, 2550, 2700, 2820, 2760, 2690, 2640, 2710, 2980, 3150, 4200, 3900,
  3300, 2860, 2720, 2690, 2700,
];
const LCP_N = [12, 18, 25, 0, 0, 44, 61, 80, 96, 120, 131, 140, 138, 126, 118, 110, 104, 98, 92, 85, 70, 55, 41, 22];
const INP = [180, 190, 175, 210, 240, 260, 230, 220, 205, 198, 190, 188, 186, 201, 215, 230, 250, 280, 310, 290, 260, 230, 210, 200];
const INP_PREC = [170, 176, 181, 190, 199, 210, 214, 208, 200, 195, 192, 190, 188, 190, 196, 205, 214, 226, 240, 238, 225, 210, 200, 190];
const OCCURRENCES = [4, 2, null, 0, 1, 7, 12, 9, 5, 3, 8, 14, 22, 17, 9, 6, 4, 3, 2, 5, 11, 6, 3, 1];

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

const DEUX_COLONNES = "grid min-w-0 gap-4 lg:grid-cols-2";

export function SectionsSeries() {
  // Ancrage : la grille horaire finit à l'heure en cours (dernier seau partiel).
  const heureCourante = Math.floor(Date.now() / HEURE) * HEURE;
  const debuts = Array.from({ length: 24 }, (_v, i) => heureCourante - (23 - i) * HEURE);
  const grille = grilleIso(debuts);
  const ligne = (i: number) => libelleSeauComplet(grille[i], 3600, "UTC");

  const pointsLcp: PointSerie[] = grille
    .map((t, i) => ({ t, lcp: LCP[i], n: LCP_N[i] }))
    // Les heures sans mesure sont ABSENTES de la lecture, comme en base : la grille en fait des trous.
    .filter((p) => p.lcp !== null);
  const annotations: Annotation[] = [
    { t: new Date(debuts[7] + 25 * 60_000).toISOString(), libelle: "v1.4.2", type: "deploiement", href: "/admin/composants?cmp=release#threshold-series" },
    { t: new Date(debuts[16] + 40 * 60_000).toISOString(), libelle: "v1.4.3", type: "deploiement" },
    { t: new Date(debuts[17] + 5 * 60_000).toISOString(), libelle: "Alerte LCP /checkout", type: "alerte", href: "/alerts" },
    // Hors de la fenêtre : écarté, jamais posé au bord.
    { t: new Date(debuts[0] - 3 * HEURE).toISOString(), libelle: "v1.4.1", type: "deploiement" },
  ];

  const pointsInp: PointSerie[] = grille.map((t, i) => ({ t, reel: INP[i], precedente: INP_PREC[i] }));
  const pointsRobot: PointSerie[] = grille
    .map((t, i) => ({ t, robot: i % 5 === 3 ? null : 800 + ((i * 37) % 260) }))
    .filter((p) => p.robot !== null);
  const pointsBon: PointSerie[] = grille.map((t, i) => ({ t, lcp: 1200 + ((i * 53) % 900) }));
  const pointsCls: PointSerie[] = grille.map((t, i) => ({ t, cls: i === 12 ? null : 0.04 + ((i * 7) % 20) / 100 }));
  const pointsOcc: PointSerie[] = grille
    .map((t, i) => ({ t, occurrences: OCCURRENCES[i] }))
    .filter((p) => p.occurrences !== null);

  // Tendances (§ 5.20) : 14 jours observés dans le fuseau de l'app, puis 3 jours projetés.
  const joursObserves = joursLocaux(14, FUSEAU_JOURS, Date.now());
  const dernierObserve = Date.parse(joursObserves[13]);
  const joursProjetes = [1, 2, 3].map((k) => new Date(dernierObserve + k * 86_400_000).toISOString().slice(0, 10));
  const grilleJours = [...joursObserves, ...joursProjetes];
  const pente = 55;
  const pointsTendance: PointSerie[] = grilleJours.map((t, i) => {
    const ajuste = 2100 + pente * i;
    const observe = i < 14 && i !== 5 ? ajuste + ((i * 173) % 400) - 200 : null;
    const projete = i >= 13 ? ajuste : null;
    return {
      t,
      observe,
      n: i < 14 ? (i === 2 ? 18 : 240 + i * 10) : null,
      ajuste: i < 14 ? ajuste : null,
      projection: projete,
      bas: projete === null ? null : projete - 260 - (i - 13) * 60,
      haut: projete === null ? null : projete + 260 + (i - 13) * 60,
    };
  });

  const sixSeries: PointSerie[] = grille.map((t, i) => ({ t, a: 10 + i, b: 12 + (i % 4), c: 8 + (i % 3), d: 20 - (i % 5), e: 9, f: 11 }));
  // Un point dont `t` n'est pas un début de seau : un appelant mal aligné se voit.
  sixSeries.push({ t: new Date(debuts[3] + 15 * 60_000).toISOString(), a: 99 });

  const pointsAlertes: PointSerie[] = grille
    .map((t, i) => ({ t, critique: i % 6 === 0 ? 2 : i % 7 === 1 ? 1 : 0, avert: (i * 5) % 4, info: (i * 3) % 5 }))
    .filter((_p, i) => i % 8 !== 4);
  const pointsVues: PointSerie[] = grille
    .map((t, i) => ({ t, chargements: 40 + ((i * 29) % 70), spa: 15 + ((i * 17) % 40) }))
    .filter((_p, i) => i !== 9);

  const joursTrafic = joursLocaux(14, FUSEAU_JOURS, Date.now());
  const pointsTrafic = joursTrafic.map((t, i) => ({
    t,
    pageviews: i === 6 ? 0 : 900 + ((i * 211) % 700),
    errors: i === 6 ? 0 : 5 + ((i * 13) % 30),
  }));
  const pointsVital = grille.map((t, i) => ({
    t,
    p75: i === 4 ? null : INP[i],
    n: i < 3 ? 14 + i : 120,
  }));

  const satisfaction: LineTrendPoint[] = joursTrafic.slice(0, 10).map((t, i) => ({
    label: `${t.slice(8, 10)}/${t.slice(5, 7)}`,
    value: i === 4 ? null : 72 + ((i * 7) % 15),
    volume: i === 4 ? 0 : 20 + ((i * 11) % 30),
  }));

  return (
    <>
      <Bloc
        id="threshold-series"
        titre="ThresholdSeries"
        sous="Série sur grille obligatoire : un seau absent est un trou (ou 0 pour un compte), jamais une droite ; bandes pleines Bon / À améliorer / Mauvais lues dans lib/rating.ts ; un seul axe y."
      >
        <div className={DEUX_COLONNES}>
          <Figure
            titre="LCP p75 par heure"
            aide="LCP"
            id="vitrine-serie-lcp"
            meta={
              <>
                <span>24 seaux d&apos;une heure (UTC)</span>
                <span>2 heures sans mesure</span>
                <span>4 annotations reçues, 3 dans la fenêtre</span>
              </>
            }
            lecture="Trous aux heures sans mesure ; point creux sous 30 mesures et pour le seau en cours ; un clic sur un seau zoome sur sa plage ; le triangle d'une annotation mène à sa destination."
            alternative={{
              legende: "LCP p75 et mesures par heure",
              colonnes: ["Seau", "LCP p75", "Mesures"],
              lignes: grille.map((_t, i) => [ligne(i), formater("ms", LCP[i]), LCP_N[i]]),
            }}
          >
            <ThresholdSeries
              grille={grille}
              points={pointsLcp}
              series={[{ cle: "lcp", libelle: "LCP p75", role: "principale", effectifCle: "n" }]}
              format="ms"
              vital="LCP"
              annotations={annotations}
              seauSecondes={3600}
              fuseau="UTC"
              zoomHref={ZOOM}
              ariaLabel="LCP p75 par heure, 24 h, 3 zones de seuil, 2 heures sans mesure"
            />
          </Figure>

          <Figure
            titre="INP p75 face à la période précédente"
            meta={<span>24 seaux d&apos;une heure (UTC) · cmp=prev</span>}
            alternative={{
              legende: "INP p75 par heure, période courante et précédente",
              colonnes: ["Seau", "INP p75", "Période précédente"],
              lignes: grille.map((_t, i) => [ligne(i), formater("ms", INP[i]), formater("ms", INP_PREC[i])]),
            }}
          >
            <ThresholdSeries
              grille={grille}
              points={pointsInp}
              series={[
                { cle: "reel", libelle: "INP p75", role: "principale" },
                { cle: "precedente", libelle: "Période précédente", role: "reference" },
              ]}
              format="ms"
              vital="INP"
              seauSecondes={3600}
              fuseau="UTC"
              ariaLabel="INP p75 par heure et période précédente, 3 zones de seuil"
            />
          </Figure>

          <Figure
            titre="Tout est « Bon » : la borne Mauvais sort du cadre"
            meta={<span>24 seaux d&apos;une heure (UTC)</span>}
            lecture="Le domaine garde la bande « Bon » visible ; la borne « Mauvais » n'étire pas l'axe, elle est écrite sous la figure."
            alternative={{
              legende: "LCP p75 par heure",
              colonnes: ["Seau", "LCP p75"],
              lignes: pointsBon.map((p, i) => [ligne(i), formater("ms", p.lcp as number)]),
            }}
          >
            <ThresholdSeries
              grille={grille}
              points={pointsBon}
              series={[{ cle: "lcp", libelle: "LCP p75", role: "principale" }]}
              format="ms"
              vital="LCP"
              seauSecondes={3600}
              fuseau="UTC"
              hauteur={180}
              ariaLabel="LCP p75 par heure, toutes les valeurs dans la zone Bon"
            />
          </Figure>

          <Figure
            titre="CLS p75, annotations indisponibles"
            meta={<span>plage personnalisée</span>}
            alternative={{
              legende: "CLS p75 par heure",
              colonnes: ["Seau", "CLS p75"],
              lignes: pointsCls.map((p, i) => [ligne(i), formater("cls", p.cls as number | null)]),
            }}
          >
            <ThresholdSeries
              grille={grille}
              points={pointsCls}
              series={[{ cle: "cls", libelle: "CLS p75", role: "principale" }]}
              format="cls"
              vital="CLS"
              annotationsIndisponibles="déploiements non affichés sur une plage personnalisée (lecture non migrée)"
              seauSecondes={3600}
              fuseau="UTC"
              hauteur={180}
              ariaLabel="CLS p75 par heure, 3 zones de seuil, un seau sans mesure"
            />
          </Figure>

          <Figure
            titre="Occurrences d'erreurs par heure"
            meta={<span>compte additif : une heure absente de la lecture vaut 0</span>}
            lecture="Un compte n'a pas de seuil publié : aucune bande, aucune couleur de verdict."
            alternative={{
              legende: "Occurrences d'erreurs par heure",
              colonnes: ["Seau", "Occurrences"],
              lignes: grille.map((_t, i) => [ligne(i), OCCURRENCES[i] ?? 0]),
            }}
          >
            <ThresholdSeries
              grille={grille}
              points={pointsOcc}
              series={[{ cle: "occurrences", libelle: "Occurrences d'erreurs", role: "categorie", categorieIndex: 1, forme: "barres", additive: true }]}
              format="count"
              seauSecondes={3600}
              fuseau="UTC"
              hauteur={160}
              ariaLabel="Occurrences d'erreurs par heure, en barres"
            />
          </Figure>

          <Figure
            titre="Latence de la sonde synthétique"
            meta={<span>robot seul : sa latence n&apos;est jamais sur l&apos;axe du LCP</span>}
            alternative={{
              legende: "Latence robot par heure",
              colonnes: ["Seau", "Latence"],
              lignes: grille.map((t, i) => [ligne(i), formater("ms", (pointsRobot.find((p) => p.t === t)?.robot as number | undefined) ?? null)]),
            }}
          >
            <ThresholdSeries
              grille={grille}
              points={pointsRobot}
              series={[{ cle: "robot", libelle: "Robot · latence moyenne", role: "robot" }]}
              format="ms"
              seauSecondes={3600}
              fuseau="UTC"
              hauteur={160}
              ariaLabel="Latence de la sonde synthétique par heure, sans seuil"
            />
          </Figure>

          <Figure
            titre="LCP p75 quotidien et sa tendance"
            meta={<span>14 jours ({FUSEAU_JOURS}) + 3 jours projetés</span>}
            lecture="Droite ajustée grise ; projection en pointillé après le dernier jour observé, dans sa bande ± 1 écart type ; un jour sans mesure reste un trou."
            alternative={{
              legende: "LCP p75 quotidien, ajustement et projection",
              colonnes: ["Jour", "Observé", "Mesures", "Ajusté", "Projection"],
              lignes: pointsTendance.map((p) => [
                libelleSeauComplet(p.t, 86_400, FUSEAU_JOURS),
                formater("ms", p.observe as number | null),
                p.n as number | null,
                formater("ms", p.ajuste as number | null),
                formater("ms", p.projection as number | null),
              ]),
            }}
          >
            <ThresholdSeries
              grille={grilleJours}
              points={pointsTendance}
              series={[
                { cle: "observe", libelle: "LCP p75 observé", role: "principale", effectifCle: "n" },
                { cle: "ajuste", libelle: "Droite ajustée", role: "reference" },
                { cle: "projection", libelle: "Projection", role: "projection" },
              ]}
              bande={{ basseCle: "bas", hauteCle: "haut", libelle: "± 1 écart type des résidus" }}
              format="ms"
              vital="LCP"
              seauSecondes={86_400}
              fuseau={FUSEAU_JOURS}
              ariaLabel="LCP p75 quotidien sur 14 jours, droite ajustée et projection à 3 jours avec sa bande, 3 zones de seuil"
            />
          </Figure>

          <Figure
            titre="Six séries demandées, un point hors grille"
            lecture="Au-delà de cinq séries, les suivantes sont nommées sous la figure, pas tracées ; un point qui ne tombe pas sur un début de seau est compté."
            alternative={{
              legende: "Six séries par heure",
              colonnes: ["Seau", "A", "B", "C", "D", "E", "F"],
              lignes: grille.map((_t, i) => [ligne(i), ...["a", "b", "c", "d", "e", "f"].map((k) => sixSeries[i][k] as number)]),
            }}
          >
            <ThresholdSeries
              grille={grille}
              points={sixSeries}
              series={["a", "b", "c", "d", "e", "f"].map((cle) => ({ cle, libelle: `Série ${cle.toUpperCase()}`, role: "categorie" as const }))}
              format="count"
              seauSecondes={3600}
              fuseau="UTC"
              hauteur={180}
              ariaLabel="Six séries demandées, cinq tracées"
            />
          </Figure>
        </div>
      </Bloc>

      <Bloc
        id="stacked-bars"
        titre="StackedBars"
        sous="Le seul composant qui empile, réservé aux comptes : seau absent = 0 ; tons de sévérité doublés d'un motif ; une série peut mener à sa destination ; mêmes marges que ThresholdSeries."
      >
        <div className={DEUX_COLONNES}>
          <Figure
            titre="Déclenchements d'alerte par heure et sévérité"
            meta={<span>24 seaux d&apos;une heure (UTC) · 3 heures sans déclenchement lu</span>}
            lecture="Critique plein, avertissement hachuré, information pointillé ; un clic sur un segment critique ouvre les alertes, un clic ailleurs dans le seau zoome."
            alternative={{
              legende: "Déclenchements par heure et sévérité",
              colonnes: ["Seau", "Critique", "Avertissement", "Information"],
              lignes: grille.map((t, i) => {
                const p = pointsAlertes.find((x) => x.t === t);
                return [ligne(i), (p?.critique as number) ?? 0, (p?.avert as number) ?? 0, (p?.info as number) ?? 0];
              }),
            }}
          >
            <StackedBars
              grille={grille}
              points={pointsAlertes}
              series={[
                { cle: "critique", libelle: "Critique", ton: "bad", href: "/alerts" },
                { cle: "avert", libelle: "Avertissement", ton: "warn" },
                { cle: "info", libelle: "Information", ton: "neutre" },
              ]}
              format="count"
              annotations={annotations}
              seauSecondes={3600}
              fuseau="UTC"
              zoomHref={ZOOM}
              ariaLabel="Déclenchements d'alerte par heure, empilés par sévérité"
            />
          </Figure>

          <Figure
            titre="Pages vues : chargements et changements de route SPA"
            meta={<span>24 seaux d&apos;une heure (UTC) · une heure sans vue (0)</span>}
            alternative={{
              legende: "Pages vues par heure et type",
              colonnes: ["Seau", "Chargements", "Changements de route SPA"],
              lignes: grille.map((t, i) => {
                const p = pointsVues.find((x) => x.t === t);
                return [ligne(i), (p?.chargements as number) ?? 0, (p?.spa as number) ?? 0];
              }),
            }}
          >
            <StackedBars
              grille={grille}
              points={pointsVues}
              series={[
                { cle: "chargements", libelle: "Chargements", categorieIndex: 0 },
                { cle: "spa", libelle: "Changements de route SPA", categorieIndex: 1 },
              ]}
              format="count"
              seauSecondes={3600}
              fuseau="UTC"
              hauteur={180}
              ariaLabel="Pages vues par heure, chargements et changements de route SPA empilés"
            />
          </Figure>

          <Figure
            titre="Ancienne forme (data, xKey), acceptée jusqu'à F69"
            lecture="Les écrans passent à la nouvelle forme dans leur propre lot."
            alternative={{
              legende: "Erreurs par heure et groupe",
              colonnes: ["Heure", "TypeError", "ReferenceError"],
              lignes: [
                ["10:00", 3, 1],
                ["11:00", 5, null],
                ["12:00", 2, 4],
              ],
            }}
          >
            <StackedBars
              data={[
                { h: "10:00", g0: 3, g1: 1 },
                { h: "11:00", g0: 5, g1: null },
                { h: "12:00", g0: 2, g1: 4 },
              ]}
              xKey="h"
              series={[
                { key: "g0", name: "TypeError", color: CATEGORIELLE[0] },
                { key: "g1", name: "ReferenceError", color: CATEGORIELLE[1] },
              ]}
              height={180}
            />
          </Figure>
        </div>
      </Bloc>

      <Bloc
        id="vitals-timeseries"
        titre="VitalsTimeseries et TrafficTimeseries"
        sous="VitalsTimeseries enveloppe ThresholdSeries pour un vital ; TrafficTimeseries empile deux panneaux (pages vues, occurrences) sur un axe x partagé, sans axe secondaire."
      >
        <div className={DEUX_COLONNES}>
          <Figure
            titre="INP p75 par heure"
            meta={<span>24 seaux d&apos;une heure (UTC) · 3 seaux sous 30 mesures</span>}
            alternative={{
              legende: "INP p75 et mesures par heure",
              colonnes: ["Seau", "INP p75", "Mesures"],
              lignes: pointsVital.map((p, i) => [ligne(i), formater("ms", p.p75), p.n]),
            }}
          >
            <VitalsTimeseries vital="INP" grille={grille} points={pointsVital} seauSecondes={3600} fuseau="UTC" hauteur={220} />
          </Figure>

          <Figure
            titre="Pages vues et occurrences d'erreurs par jour"
            meta={<span>14 jours ({FUSEAU_JOURS}) · un jour sans trafic (0)</span>}
            alternative={{
              legende: "Pages vues et occurrences d'erreurs par jour",
              colonnes: ["Jour", "Pages vues", "Occurrences"],
              lignes: pointsTrafic.map((p) => [libelleSeauComplet(p.t, 86_400, FUSEAU_JOURS), p.pageviews, p.errors]),
            }}
          >
            <TrafficTimeseries grille={joursTrafic} points={pointsTrafic} seauSecondes={86_400} fuseau={FUSEAU_JOURS} />
          </Figure>

          <Figure
            titre="LineTrend : le volume en panneau bas"
            meta={<span>10 jours · un jour sans avis</span>}
            lecture="Plus d'axe secondaire : le nombre d'avis a son propre panneau, sous la courbe, sur le même axe x."
            alternative={{
              legende: "Satisfaction et avis par jour",
              colonnes: ["Jour", "Satisfaction", "Avis"],
              lignes: satisfaction.map((p) => [p.label, p.value ?? null, p.volume ?? null]),
            }}
          >
            <LineTrend data={satisfaction} valueName="Satisfaction" valueUnit=" %" volumeName="avis" domain={[0, 100]} height={240} />
          </Figure>
        </div>
      </Bloc>
    </>
  );
}
