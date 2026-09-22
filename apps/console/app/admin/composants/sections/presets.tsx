// Vitrine — composants de F08 : vues préréglées, constats, releases, annotations
// (plan § 3.6, § 3.7, § 4.2). Données FIXES écrites ici, aucune lecture en base, sauf
// l'ancrage dans le temps des séries (la grille horaire finit à l'heure en cours).
//
// La première `PresetBar` est la matière de tests/e2e/presets.spec.ts : appliquer
// « Mobile » ne modifie que `device` dans l'URL de la vitrine.
//
// Fichier propre au lot : la page n'en porte que l'import et une ligne de rendu.
import type { ReactNode } from "react";
import { InsightStrip, type Constat } from "@/components/InsightStrip";
import { PresetBar } from "@/components/PresetBar";
import { ReleaseCompare, statsDeVersion, type ReleaseStats } from "@/components/ReleaseCompare";
import { VersionsTable } from "@/components/VersionsTable";
import { Figure } from "@/components/charts/Figure";
import { ThresholdSeries } from "@/components/charts/ThresholdSeries";
import { annotationsDeploiements } from "@/lib/annotations";
import { formater } from "@/lib/fmt-ids";
import { choisirReleases, vuesProduit } from "@/lib/presets";
import type { VersionRow } from "@/lib/queries-deploys";
import { grilleIso, libelleSeauComplet, type PointSerie } from "@/lib/series";

const CHEMIN = "/admin/composants";
const HEURE = 3_600_000;

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

// ─────────────────────────────── Releases ───────────────────────────────

/** Triées par sessions, comme `comparaisonVersions` (CP3 : le volume n'est pas la date). */
const VERSIONS: VersionRow[] = [
  { version: "1.4.1", sessions: 5210, lcp: 2380, inp: 190, erreurs: 212, sessionsEnErreur: 148 },
  { version: "1.4.2", sessions: 1840, lcp: 2710, inp: 240, erreurs: 96, sessionsEnErreur: 71 },
  { version: "(non renseignée)", sessions: 420, lcp: 2500, inp: 200, erreurs: 12, sessionsEnErreur: 9 },
  { version: "1.3.9", sessions: 210, lcp: 2290, inp: 170, erreurs: 4, sessionsEnErreur: 4 },
];
/** Du plus récent au plus ancien, comme `listDeploys` ; un redéploiement de 1.4.2. */
const DEPLOYS = [{ version: "1.4.2" }, { version: "1.4.2" }, { version: "1.4.1" }, { version: "1.3.9" }];

// ─────────────────────────────── Constats ───────────────────────────────

const REGLES = [
  "anomalie : z-score > 3 sur la moyenne horaire des 7 derniers jours, au moins 5 h d'historique",
  "dernier déploiement : +20 % ou plus sur le LCP p75 ou les erreurs, ±2 h",
  "alertes non acquittées",
  "groupes d'erreurs régressés",
];

const CONSTATS: Constat[] = [
  {
    type: "anomalie",
    titre: `LCP /checkout : ${formater("ms", 4800)} à 14 h (moyenne 7 j : ${formater("ms", 2100)})`,
    regle: "z-score > 3 sur la moyenne horaire des 7 derniers jours",
    href: `${CHEMIN}#constats`,
  },
  {
    type: "regression",
    titre: "Déploiement 1.4.2 : LCP p75 +22 % (1 204 pages vues avant, 1 380 après)",
    regle: "+20 % ou plus, ±2 h autour du déploiement, filtres de population non appliqués",
    href: `${CHEMIN}?cmp=release&rel_b=1.4.2&rel_a=1.4.1#constats`,
  },
  {
    type: "alerte",
    titre: "2 alertes non acquittées",
    regle: "règles d'alerte actives, déclenchées et non acquittées",
    href: "/alerts",
  },
];

// ─────────────────────────────── Annotations ───────────────────────────────

const LCP = [2300, 2350, 2280, 2400, 2450, 2580, 2610, 2490, 2550, 2700, 2820, 2760, 2690, 2640, 2710, 2980, 3150, 4200, 3900, 3300, 2860, 2720, 2690, 2700];

const lienDeploiement = (relB: string, relA: string | null) =>
  `${CHEMIN}?${new URLSearchParams({ cmp: "release", rel_b: relB, ...(relA ? { rel_a: relA } : {}) })}#annotations`;

export function SectionsPresets() {
  const choix = choisirReleases(DEPLOYS, VERSIONS);
  const vues = vuesProduit({
    releases: { valeur: choix },
    navigateurs: {
      valeur: [
        { valeur: "Chrome", lcp_p75: 2400, lcp_n: 3120 },
        { valeur: "Safari", lcp_p75: 2900, lcp_n: 840 },
        { valeur: "Samsung Internet", lcp_p75: 5200, lcp_n: 12 },
        { valeur: null, lcp_p75: 3100, lcp_n: 60 },
      ],
    },
    pays: { valeur: [{ valeur: "FR", volume: 4120 }, { valeur: "BE", volume: 610 }, { valeur: null, volume: 900 }] },
    extension: { segActuel: null },
  });
  const vuesIndisponibles = vuesProduit({
    releases: { valeur: choisirReleases([], [VERSIONS[0]]) },
    navigateurs: { valeur: [{ valeur: "Firefox", lcp_p75: 3100, lcp_n: 18 }] },
    pays: { indisponible: "lecture des pays en échec" },
  });

  const b = VERSIONS.find((v) => v.version === choix.relB)!;
  const a = VERSIONS.find((v) => v.version === choix.relA)!;
  const sansSession: ReleaseStats = { release: "1.5.0-rc1", sessions: 0, lcp_p75: null, inp_p75: null, sessionsEnErreur: null };

  const heureCourante = Math.floor(Date.now() / HEURE) * HEURE;
  const debuts = Array.from({ length: 24 }, (_v, i) => heureCourante - (23 - i) * HEURE);
  const grille = grilleIso(debuts);
  const range = { from: grille[0], to: new Date(heureCourante + HEURE).toISOString(), preset: "24h" as const };
  const points: PointSerie[] = grille.map((t, i) => ({ t, lcp: LCP[i] }));
  const marqueur = (h: number, min: number, version: string | null) => ({ ts: new Date(debuts[h] + min * 60_000), version });
  // Du plus récent au plus ancien ; le dernier est hors de la fenêtre (écarté, mais il
  // sert de « version précédente » au premier marqueur de la fenêtre).
  const peu = annotationsDeploiements(
    [marqueur(17, 5, "1.4.2"), marqueur(9, 40, null), marqueur(4, 20, "1.4.1"), { ts: new Date(debuts[0] - 5 * HEURE), version: "1.3.9" }],
    range,
    { lien: lienDeploiement },
  );
  const beaucoup = annotationsDeploiements(
    Array.from({ length: 8 }, (_v, k) => marqueur(21 - k * 2, 10, `2.0.${8 - k}`)),
    range,
    { lien: lienDeploiement, lienListe: "#vitrine-deploiements" },
  );
  const personnalisee = annotationsDeploiements([marqueur(17, 5, "1.4.2")], { ...range, preset: null }, { lien: lienDeploiement });
  const ligne = (i: number) => libelleSeauComplet(grille[i], 3600, "UTC");
  const serie = (id: string, titre: string, ann: typeof peu, meta: string) => (
    <Figure
      titre={titre}
      id={id}
      meta={<span>{meta}</span>}
      alternative={{
        legende: "LCP p75 par heure",
        colonnes: ["Seau", "LCP p75"],
        lignes: grille.map((_t, i) => [ligne(i), formater("ms", LCP[i])]),
      }}
    >
      <ThresholdSeries
        grille={grille}
        points={points}
        series={[{ cle: "lcp", libelle: "LCP p75", role: "principale" }]}
        format="ms"
        vital="LCP"
        annotations={ann.annotations}
        annotationsIndisponibles={ann.indisponible ?? undefined}
        seauSecondes={3600}
        fuseau="UTC"
        ariaLabel={`LCP p75 par heure, 24 h, ${ann.annotations.length} annotation(s)`}
      />
    </Figure>
  );

  return (
    <>
      <Bloc
        id="vues-prereglees"
        titre="PresetBar"
        sous="Vues préréglées : un lien par vue, qui ne change que des paramètres du contrat (+ cmp) ; une vue incalculable reste affichée, désactivée, avec sa raison ; « Enregistrer la vue » ouvre un champ en ligne."
      >
        <div className="flex min-w-0 flex-col gap-4">
          <Exemple etat={`Vues produit calculées — releases : ${choix.regle}`}>
            <div id="vitrine-presets" className="min-w-0">
              <PresetBar vues={vues} actif={null} />
            </div>
          </Exemple>
          <Exemple etat="Vues incalculables : une seule release, navigateurs sous 30 mesures, lecture des pays en échec">
            <div id="vitrine-presets-indisponibles" className="min-w-0">
              <PresetBar vues={vuesIndisponibles} actif={null} />
            </div>
          </Exemple>
        </div>
      </Bloc>

      <Bloc
        id="constats"
        titre="InsightStrip"
        sous="Constats à règle publiée, repliés, compte en tête ; zéro constat est une ligne qui cite les règles ; les statuts des détecteurs restent visibles."
      >
        <div className="flex min-w-0 flex-col gap-4">
          <Exemple etat="Trois constats (replié), statuts des détecteurs">
            <InsightStrip
              constats={CONSTATS}
              regles={REGLES}
              fenetre="24 h fixes"
              statuts={[
                { detecteur: "Anomalies LCP horaires", etat: "teste", raison: "412 heures × route avec au moins 5 h d'historique" },
                { detecteur: "Anomalies quotidiennes", etat: "non_testable", raison: "moins de 4 jours avec au moins 30 pages vues" },
              ]}
            />
          </Exemple>
          <Exemple etat="Aucun constat">
            <InsightStrip constats={[]} regles={REGLES} fenetre="24 h fixes" />
          </Exemple>
        </div>
      </Bloc>

      <Bloc
        id="release-compare"
        titre="ReleaseCompare"
        sous="Release candidate face à la référence, même fenêtre ; la règle de choix est écrite ; effectif sous chaque valeur ; CLS non lu par comparaisonVersions."
      >
        <div className="grid min-w-0 gap-4 xl:grid-cols-2">
          <Exemple etat="Dernier déploiement face au précédent">
            <ReleaseCompare
              a={statsDeVersion(a)}
              b={statsDeVersion(b)}
              plage="24 h (21/09 14:00 → 22/09 14:00 UTC)"
              source="occurrence"
              regleChoix={choix.regle}
              hrefs={{ a: `${CHEMIN}?release=${a.version}`, b: `${CHEMIN}?release=${b.version}` }}
              toutesLesVersions={<VersionsTable comparaison={{ rows: VERSIONS, source: "occurrence" }} periodLabel="24 h" />}
            />
          </Exemple>
          <Exemple etat="Candidate sans session sur la fenêtre, CLS lu, release de session">
            <ReleaseCompare
              a={{ ...statsDeVersion(a), cls_p75: 0.08 }}
              b={{ ...sansSession, cls_p75: null }}
              plage="7 j"
              source="session"
              regleChoix="1.5.0-rc1 : choisie dans l'URL (rel_b) ; 1.4.1 : choisie dans l'URL (rel_a)"
              hrefs={{ a: `${CHEMIN}?release=1.4.1`, b: `${CHEMIN}?release=1.5.0-rc1` }}
            />
          </Exemple>
        </div>
      </Bloc>

      <Bloc
        id="annotations"
        titre="Annotations de déploiement"
        sous="lib/annotations.ts : marqueurs filtrés sur [from, to) ; au-delà de 6, un seul « N déploiements » qui mène à la liste ; sous plage personnalisée, le message B1 à la place des traits."
      >
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          {serie("vitrine-annotations-peu", "Trois marqueurs dans la fenêtre", peu, "4 marqueurs lus, 3 dans la fenêtre")}
          <div className="min-w-0">
            {serie("vitrine-annotations-groupe", "Huit marqueurs : regroupés", beaucoup, "8 marqueurs dans la fenêtre")}
            <ul id="vitrine-deploiements" className="mt-2 text-xs text-ink-soft" data-testid="liste-deploiements">
              {beaucoup.liste.map((d) => (
                <li key={d.t}>
                  {d.libelle} — {libelleSeauComplet(d.t, 60, "UTC")}
                </li>
              ))}
            </ul>
          </div>
          {serie("vitrine-annotations-b1", "Plage personnalisée", personnalisee, "plage personnalisée")}
        </div>
      </Bloc>
    </>
  );
}
