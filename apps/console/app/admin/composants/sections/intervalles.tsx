// Vitrine — P*.1 : l'intervalle sur chaque chiffre clé (plan § 7.2). Rendus sur
// des données FIXES écrites ici, calculées par les fonctions de lib/stats (aucune
// lecture en base) : la tuile, la carte de vital et la table des percentiles dans
// chacun de leurs états d'incertitude.
//
// Fichier propre au lot (les lots d'une même vague ajoutent chacun le leur) : la
// page n'en porte que l'import et une ligne de rendu.
import type { ReactNode } from "react";
import { PercentileTable } from "@/components/Distribution";
import { VitalCard } from "@/components/VitalCard";
import { KpiTile } from "@/components/charts/KpiTile";
import { fmtVital } from "@/lib/format";
import { ecartP75, ecartProportions, intervalleQuantile, intervalleWilson } from "@/lib/stats/incertitude";

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

// 20 mesures LCP : rangs EXACTS (11, 19) de la règle à queues égales.
const LCP_20 = Array.from({ length: 20 }, (_, i) => 1700 + i * 60);
const I20 = intervalleQuantile(LCP_20);
const INTERVALLE_20 = I20.ok ? { bas: I20.bas, haut: I20.haut, niveau: 0.95 as const, methode: I20.methode } : { indisponible: I20.raison };
const PRECEDENT = { bas: 2050, haut: 2600, niveau: 0.95 as const, methode: "quantile_normal" as const };
const REFERENCE = "vs 24 h précédentes";
const COMPLETE = { etat: "complete", raison: null, n: 400 } as const;

export function SectionIntervalles() {
  const sansErreur = intervalleWilson(27, 30);
  return (
    <Section
      id="intervalles"
      titre="Intervalles à 95 % (P*.1)"
      sous="Chaque chiffre clé dit de combien il bougerait avec d'autres visiteurs de la même période : rangs binomiaux pour une p75, Wilson pour une part ; un écart à la période précédente n'est affirmé que s'il est établi."
    >
      <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Exemple etat="VitalCard — 20 mesures, rangs exacts, écart non établi (intervalles qui se chevauchent)">
          <VitalCard
            name="LCP"
            p75={2340}
            median={2250}
            prev={2210}
            n={20}
            periodLabel="24 h"
            intervalle={INTERVALLE_20}
            ecart={ecartP75(INTERVALLE_20, PRECEDENT, (v) => fmtVital("LCP", v))}
          />
        </Exemple>
        <Exemple etat="VitalCard — 7 mesures : intervalle non calculable, verdict non établi">
          <VitalCard name="INP" p75={180} median={150} n={7} periodLabel="1 h" intervalle={{ indisponible: "7 mesures, 13 requises" }} />
        </Exemple>
        <Exemple etat="KpiTile — part de sessions sans erreur, Wilson, échantillon faible">
          <KpiTile
            label="Sessions sans erreur JS"
            valeur={0.9}
            format="pct"
            sensMeilleur="haut"
            couverture={{ n: 30, unite: "sessions", faibleSous: 30 }}
            intervalle={sansErreur ?? undefined}
          />
        </Exemple>
        <Exemple etat="KpiTile — écart de part non établi (Newcombe, zéro compris)">
          <KpiTile
            label="Sessions sans erreur JS"
            valeur={0.9}
            format="pct"
            sensMeilleur="haut"
            precedent={0.88}
            reference={REFERENCE}
            couverturePrecedente={COMPLETE}
            couverture={{ n: 400, unite: "sessions", faibleSous: 30 }}
            intervalle={intervalleWilson(360, 400) ?? undefined}
            ecart={ecartProportions(360, 400, 352, 400)}
          />
        </Exemple>
        <Exemple etat="KpiTile — écart de part établi">
          <KpiTile
            label="Sessions sans erreur JS"
            valeur={0.9}
            format="pct"
            sensMeilleur="haut"
            precedent={0.7}
            reference={REFERENCE}
            couverturePrecedente={COMPLETE}
            couverture={{ n: 400, unite: "sessions", faibleSous: 30 }}
            intervalle={intervalleWilson(360, 400) ?? undefined}
            ecart={ecartProportions(360, 400, 280, 400)}
          />
        </Exemple>
        <Exemple etat="KpiTile — part sans dénominateur : « — », aucun intervalle">
          <KpiTile
            label="Sessions sans erreur JS"
            valeur={null}
            raisonNull="aucune session sur la période"
            format="pct"
            intervalle={intervalleWilson(0, 0) ?? undefined}
          />
        </Exemple>
      </div>
      <div className="mt-4 min-w-0">
        <Exemple etat="PercentileTable — verdict du p75 teinté seulement s'il tient sur tout l'intervalle">
          <PercentileTable
            rows={[
              { name: "LCP", pcts: [2250, 2340, 2700, 2800, 2840], n: 20, intervalle: INTERVALLE_20 },
              { name: "INP", pcts: [150, 180, 240, 260, 300], n: 7, intervalle: { indisponible: "7 mesures, 13 requises" } },
              {
                name: "CLS",
                pcts: [0.02, 0.04, 0.08, 0.12, 0.2],
                n: 400,
                intervalle: { bas: 0.035, haut: 0.047, niveau: 0.95, methode: "quantile_normal" },
              },
            ]}
          />
        </Exemple>
      </div>
    </Section>
  );
}
