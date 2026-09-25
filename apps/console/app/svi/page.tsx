// Vue d'ensemble SVI — incrément I2. Le chiffre dominant est le containment NET,
// jamais le brut.
//
// Règle d'affichage tenue par cette page : le taux apparent n'apparaît JAMAIS
// sans le net à côté, et il est libellé « apparent ». Un containment brut affiché
// seul est un chiffre de complaisance — l'appelant qui rappelle le lendemain
// n'avait pas son problème résolu, il l'avait différé.
//
// La garde est un test de SOURCE (tests/unit/svi-recall.test.ts), pas un test de
// DOM : elle vérifie que ce fichier n'affiche pas `c.brut` sans `c.net` ni sans
// le mot « apparent ». Elle attrape la régression probable — une refonte qui
// simplifie en ne gardant que le gros chiffre — mais elle ne prouve pas le rendu.
import Link from "next/link";
import { CapaciteFermee, estFermee } from "@/components/CapaciteFermee";
import { PageHeader } from "@/components/PageHeader";
import { SupervisionHero, HeroStat, HeroReading } from "@/components/SupervisionHero";
import { Donut } from "@/components/charts/Donut";
import { RankBar } from "@/components/charts/RankBar";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import type { SearchParams } from "@/lib/filters";
import { chargerSvi } from "@/lib/chargeurs/svi";
import { chargerEcran } from "@/lib/ecran-local";
import { fmtDuration, journeyCoverage } from "@/lib/svi-outcome";
import { containment, containmentReading } from "@/lib/svi-recall";

export const dynamic = "force-dynamic";

const COULEURS = {
  contained: "#10b981",
  transferred: "#0ea5e9",
  abandoned: "#f59e0b",
  failed: "#ef4444",
};

export default async function VueEnsembleSvi({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  if (estFermee("/svi")) {
    return (
      <CapaciteFermee
        titre="Supervision SVI"
        sujet="Supervision du serveur vocal interactif."
      />
    );
  }

  // Le chargeur (`lib/chargeurs/svi.ts`) lit la synthèse, le containment et les sorties.
  const ecran = await chargerEcran(chargerSvi, (await searchParams) ?? {});
  if (ecran.etat === "fermee") return <CapaciteFermee titre="Supervision SVI" sujet="Supervision du serveur vocal interactif." />;
  if (ecran.etat === "refus") return <FilterProblemNotice title="Supervision SVI" problem={ecran.problem} />;
  const { sum, cont, sorties, periode } = ecran;

  const c = containment(cont);
  const couverture = journeyCoverage(sum.total, sum.with_journey);

  const slices = [
    { label: "résolus", value: sum.contained, color: COULEURS.contained },
    { label: "transférés", value: sum.transferred, color: COULEURS.transferred },
    { label: "abandonnés", value: sum.abandoned, color: COULEURS.abandoned },
    { label: "échecs", value: sum.failed, color: COULEURS.failed },
  ].filter((s) => s.value > 0);

  return (
    <>
      <PageHeader
        title="Supervision SVI"
        sub={`Vue d'ensemble du serveur vocal — ${periode}`}
      />

      <SupervisionHero
        chartTitle={`Issues des appels clos — ${periode}`}
        chartHelp="containment_net"
        chartMeta={
          <Link className="text-xs text-ink-soft hover:underline" href="/svi/appels">
            Voir les appels →
          </Link>
        }
        chart={
          slices.length === 0 ? (
            <p className="p-6 text-sm text-ink-soft">Aucun appel clos sur la période.</p>
          ) : (
            <div className="flex justify-center py-2">
              <Donut
                slices={slices}
                centerValue={cont.closed.toLocaleString("fr-FR")}
                centerLabel="appels clos"
              />
            </div>
          )
        }
      >
        {/* Le NET domine. Le brut n'est qu'un repère, explicitement « apparent ». */}
        <HeroStat
          label="Containment net"
          value={cont.closed > 0 ? `${c.net.toFixed(1)} %` : "—"}
        />
        <HeroStat
          label="dont apparent"
          value={cont.closed > 0 ? `${c.brut.toFixed(1)} %` : "—"}
        />
        <HeroStat label="Attente moyenne" value={fmtDuration(sum.avg_wait_ms)} />
        <HeroStat label="Durée moyenne" value={fmtDuration(sum.avg_duration_ms)} />
        <HeroReading>{containmentReading(c, cont.closed)}</HeroReading>
      </SupervisionHero>

      {couverture < 100 && (
        <p className="mt-4 rounded border border-line bg-panel p-3 text-xs text-ink-soft">
          <strong>Couverture du parcours : {couverture.toFixed(0)} %</strong> des appels portent le
          niveau « journey ». Les motifs de sortie ci-dessous ne sont détaillés que pour ceux-là ;
          les autres apparaissent sous « non instrumenté ». Instrumenter le flow du SVI est ce qui
          rend l'entonnoir de menu calculable.
        </p>
      )}

      <section className="mt-6">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          Où les appels quittent le SVI
        </h2>
        <RankBar
          data={sorties.map((s) => ({
            label: s.exit_node,
            value: s.total,
            display: `${s.total} appel(s)`,
            title: `${s.abandoned} abandon(s), ${s.transferred} transfert(s)`,
            segments: [
              { value: s.abandoned, color: COULEURS.abandoned, label: "abandonnés" },
              { value: s.transferred, color: COULEURS.transferred, label: "transférés" },
              {
                value: s.total - s.abandoned - s.transferred,
                color: COULEURS.contained,
                label: "résolus",
              },
            ].filter((seg) => seg.value > 0),
          }))}
          emptyLabel="Aucun appel clos sur la période."
        />
      </section>
    </>
  );
}
