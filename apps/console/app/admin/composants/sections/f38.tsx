// Vitrine — F38 : l'étendue de percentiles (démarrage mobile) et le hero
// « Stabilité par release » de `/mobile` (plan § 4.2, § 5.6.4). Données FIXES
// écrites ici, aucune lecture en base.
//
// Fichier propre au lot (les lots d'une même vague ajoutent chacun le leur) : la
// page n'en porte que l'import et une ligne de rendu.
import type { ReactNode } from "react";
import { EtenduePercentiles } from "@/components/charts/EtenduePercentiles";
import { StabiliteParRelease } from "@/components/mobile/StabiliteParRelease";
import { ERROR_FREE_REASONS, chainerReleases, tauxSansErreurDeclarant } from "@/lib/mobile-capabilities";
import type { MobileReleaseRow } from "@/lib/queries-mobile";

const CHEMIN = "/admin/composants";

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

/** Quatre releases : 1.4 et 1.3 déclarent les erreurs JS, 1.2 non, et des sessions sans release. */
const RELEASES: MobileReleaseRow[] = chainerReleases(
  [
    { release: "1.4", sessions: 340, touchees: 12, occ: 31, etat: "active", p75: 910, n: 280, premiere: "2026-09-21T08:12:00.000Z" },
    { release: "1.3", sessions: 1210, touchees: 29, occ: 64, etat: "active", p75: 870, n: 1030, premiere: "2026-09-15T09:40:00.000Z" },
    { release: "1.2", sessions: 96, touchees: 0, occ: 0, etat: "unknown", p75: 1020, n: 80, premiere: "2026-09-02T14:05:00.000Z" },
    { release: null, sessions: 14, touchees: 0, occ: 0, etat: "unknown", p75: null, n: 0, premiere: "2026-09-10T11:00:00.000Z" },
  ].map((r) => {
    const active = r.etat === "active";
    return {
      app_id: "demo-rn",
      release: r.release,
      sessions: r.sessions,
      sessions_touchees: r.touchees,
      occurrences: r.occ,
      etat_js_errors: r.etat as MobileReleaseRow["etat_js_errors"],
      part_touchee: active ? r.touchees / r.sessions : null,
      raison_part: active ? null : ERROR_FREE_REASONS.capability_unknown,
      demarrage_froid_p75_ms: r.p75,
      demarrage_froid_n: r.n,
      premiere_session: r.premiere,
    };
  }),
);

const TAUX = tauxSansErreurDeclarant(RELEASES);
const HREF = (release: string | null) =>
  release === null ? `${CHEMIN}?seg=v2%3Arelease%3Ais_null#stabilite-release` : `${CHEMIN}?release=${encodeURIComponent(release)}#stabilite-release`;

export function SectionF38() {
  return (
    <>
      <Section
        id="etendue-percentiles"
        titre="EtenduePercentiles"
        sous="p50 → p75 → p95 sur un axe commun ; une extrémité inconnue n'a pas de moustache et le dit ; aucune couleur de verdict."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Exemple etat="Démarrage à froid et à chaud, même axe">
            <EtenduePercentiles
              format="ms"
              lignes={[
                { libelle: "À froid", n: 412, p50: 640, p75: 820, p95: 1480 },
                { libelle: "À chaud", n: 96, p50: 110, p75: 160, p95: 390 },
              ]}
            />
          </Exemple>
          <Exemple etat="p95 non calculable, échantillon faible, non mesuré">
            <EtenduePercentiles
              format="ms"
              lignes={[
                { libelle: "À froid", n: 12, p50: 700, p75: 790, p95: null },
                { libelle: "À chaud", n: 0, p50: null, p75: null, p95: null },
              ]}
            />
          </Exemple>
        </div>
      </Section>
      <Section
        id="stabilite-release"
        titre="Stabilité par release (hero de /mobile)"
        sous="Part des sessions touchées par une erreur JS, par release ; « — » et sa raison pour une release qui ne déclare pas collecter ; référence sur les releases déclarantes."
      >
        <StabiliteParRelease
          resultat={{
            disponible: true,
            lignes: RELEASES,
            releases: RELEASES.length,
            apps: 1,
            tronque: false,
            declarantes: { ...TAUX, occurrences: 95 },
          }}
          tri="fourni"
          triHref={{
            fourni: `${CHEMIN}#stabilite-release`,
            gravite: `${CHEMIN}?tri=gravite#stabilite-release`,
            volume: `${CHEMIN}?tri=volume#stabilite-release`,
          }}
          hrefDeRelease={HREF}
          plage="24 h"
        />
      </Section>
    </>
  );
}
