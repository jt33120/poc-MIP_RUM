// Corps d'une carte de tableau de bord (F36, W-B2 à W-B11). Rendu serveur ; seules
// les séries (recharts) sont des îlots client, et elles ne reçoivent que des
// chaînes et des nombres.
//
// AUCUNE FIGURE N'EST INVENTÉE ICI. Une carte v2 passe par `ResultatAnalyse`, la
// traduction UNIQUE « résultat Explorer → figure » (§ 4.3) : la carte et l'écran
// Explorer disent donc exactement la même chose du même chiffre. Les cartes v1
// réutilisent les mêmes briques que le reste de la console — `KpiTile`,
// `ThresholdSeries`, `ImpactTable`, `Sparkline` — plutôt qu'un graphique à elles.
//
// L'INCONNU RESTE INCONNU. Un total `null` est « — » avec sa raison (V3) ; un seau
// sans mesure est un trou ; une valeur non calculable ne devient jamais une barre à
// zéro, qui se lirait « le meilleur » (CE1, CE2).
//
// LE VERDICT SUIT R-V. La prop `vital` ne reçoit que ce que `vitalDeVerdict` a
// autorisé — le p75 d'un Web Vital. Une moyenne ou un p95 n'a ni badge, ni bande,
// et la carte écrit pourquoi.
import Link from "next/link";
import { ImpactTable, type ImpactLigne } from "@/components/ImpactTable";
import { KpiTile } from "@/components/charts/KpiTile";
import { Sparkline } from "@/components/charts/Sparkline";
import { ThresholdSeries } from "@/components/charts/ThresholdSeries";
import { ResultatAnalyse } from "@/components/explorer/ResultatAnalyse";
import { groupeHref } from "@/lib/explorer-page-params";
import { formater } from "@/lib/fmt-ids";
import { classerParGravite, ecartALaReference, estFaible } from "@/lib/impact";
import { hrefWithQuery, type AnalyticsQuery } from "@/lib/query-contract";
import type { WidgetData, WidgetErreur, WidgetRoutes } from "@/lib/widget-data";

export function WidgetBody({ data, query }: { data: WidgetData; query: AnalyticsQuery }) {
  if (data.kind === "invalid" || data.kind === "error") {
    return (
      <div role="note" className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-3 text-sm text-ink-soft">
        <p className="font-semibold text-ink">
          {data.kind === "invalid" ? "Configuration illisible" : "Mesure indisponible"}
        </p>
        <p className="mt-1 break-words">{data.reason}</p>
        {data.sub && <p className="mt-1 text-xs text-ink-faint">{data.sub}</p>}
      </div>
    );
  }

  // Carte v2 : une seule traduction, celle de l'Explorer. Les liens sont calculés
  // CÔTÉ SERVEUR — aucune fonction ne franchit la frontière client (§ 0.3).
  if (data.analyse) {
    const { plan, meta, data: resultat, precedent } = data.analyse;
    return (
      <div className="min-w-0">
        <ResultatAnalyse
          plan={plan}
          meta={meta}
          data={resultat}
          precedent={precedent}
          hrefs={{ groupe: (key) => groupeHref(query, plan, key, {}) }}
          taille="carte"
        />
        <Notes notes={data.notes} />
      </div>
    );
  }

  const vide =
    !data.rows?.length &&
    !data.routes?.lignes.length &&
    !data.erreurs?.length &&
    !data.trafic?.grille.length &&
    data.total === undefined;
  if (vide) {
    return <p className="py-6 text-center text-sm text-ink-faint">aucune donnée</p>;
  }

  return (
    <div className="min-w-0">
      {/* W-B6 / W-B11 — une tuile : la valeur en nombre, son verdict s'il est permis,
          son effectif, et la raison de son absence quand elle manque (CE4). */}
      {data.total !== undefined && (
        <KpiTile
          label={data.effectif ? "Valeur mesurée" : "Valeur"}
          valeur={data.total}
          format={data.format ?? "count"}
          raisonNull={data.total === null ? (data.raisonNull ?? "valeur non calculable") : undefined}
          vital={data.vital}
          {...(data.samples !== undefined ? { couverture: { n: data.samples, unite: "mesures" } } : {})}
          {...(data.effectif ? { lecture: data.effectif } : {})}
        />
      )}

      {data.trafic && <PanneauxTrafic trafic={data.trafic} />}
      {data.routes && <ClassementRoutes routes={data.routes} query={query} />}
      {data.erreurs && <ListeErreurs lignes={data.erreurs} query={query} />}

      {/* Table v1 conservée (W-B10) : une cible de frustration est un texte long,
          qu'un classement en barres tronquerait. */}
      {!data.trafic && !data.routes && !data.erreurs && data.columns?.length ? (
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {data.columns.map((c) => (
                  <th key={c} scope="col" className="th text-left">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.rows ?? []).map((row, ri) => (
                <tr key={ri} className="border-t border-line/60">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-1.5 tabular-nums">
                      {cell === "" ? "—" : cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {data.sansVerdict && (
        <p role="note" className="mt-2 text-xs text-ink-soft">
          {data.sansVerdict}
        </p>
      )}
      <Notes notes={data.notes} />
    </div>
  );
}

function Notes({ notes }: { notes?: string[] }) {
  return (
    <>
      {notes?.map((note) => (
        <p key={note} role="note" className="mt-2 text-xs text-ink-faint">
          {note}
        </p>
      ))}
    </>
  );
}

/**
 * W-B7 — deux panneaux empilés sur la MÊME grille de jours : pages vues, puis
 * occurrences d'erreurs. Deux populations, deux axes (P5) : superposées sur un
 * axe partagé, elles se liraient comme une corrélation qu'aucune n'affirme. La
 * dernière barre est la journée en cours, incomplète : `ThresholdSeries` la rend
 * creuse et la nomme en légende dès que le dernier jour est aujourd'hui dans le
 * fuseau de l'app.
 */
function PanneauxTrafic({ trafic }: { trafic: NonNullable<WidgetData["trafic"]> }) {
  const JOUR = 86_400;
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="widget-trafic">
      <div className="min-w-0">
        <p className="mb-1 text-[11px] font-medium text-ink-soft">Pages vues</p>
        <ThresholdSeries
          grille={trafic.grille}
          points={trafic.points}
          series={[{ cle: "pageviews", libelle: "Pages vues", role: "categorie", categorieIndex: 0, forme: "barres", additive: true }]}
          format="count"
          seauSecondes={JOUR}
          fuseau={trafic.fuseau}
          hauteur={120}
          legendeAnnotations={false}
          synchro="widget-trafic"
          ariaLabel={`Pages vues par jour, ${trafic.grille.length} jours`}
        />
      </div>
      <div className="min-w-0">
        <p className="mb-1 text-[11px] font-medium text-ink-soft">Occurrences d’erreurs</p>
        <ThresholdSeries
          grille={trafic.grille}
          points={trafic.points}
          series={[{ cle: "errors", libelle: "Occurrences d’erreurs", role: "categorie", categorieIndex: 1, forme: "barres", additive: true }]}
          format="count"
          seauSecondes={JOUR}
          fuseau={trafic.fuseau}
          hauteur={120}
          synchro="widget-trafic"
          ariaLabel={`Occurrences d’erreurs par jour, ${trafic.grille.length} jours`}
        />
      </div>
    </div>
  );
}

/**
 * W-B8 — un classement de PERCENTILES : l'écart se lit contre le LCP p75 de l'app
 * entière, jamais comme une part d'un total (des p75 ne s'additionnent pas). Le
 * verdict est permis : ce sont bien des p75 (R-V).
 */
function ClassementRoutes({ routes, query }: { routes: WidgetRoutes; query: AnalyticsQuery }) {
  const { lignes } = classerParGravite<ImpactLigne>(
    routes.lignes.map((r) => ({
      cle: r.route,
      libelle: r.route,
      href: hrefWithQuery("/pages", query, { route: r.route }),
      description: `Route ${r.route}`,
      pilote: r.lcp_p75,
      volume: r.views,
      mesures: [
        { cle: "inp", valeur: r.inp_p75, affichage: formater("ms", r.inp_p75), vital: "INP" as const },
        { cle: "cls", valeur: r.cls_p75, affichage: formater("cls", r.cls_p75), vital: "CLS" as const },
      ],
      ecart: {
        valeur: ecartALaReference(r.lcp_p75, routes.referenceLcp),
        affichage:
          r.lcp_p75 === null || routes.referenceLcp === null
            ? "—"
            : formater("ms", r.lcp_p75 - routes.referenceLcp),
      },
      echantillonFaible: estFaible(r.views),
    })),
    // Gravité : le LCP p75 le plus haut d'abord, les échantillons faibles ensuite,
    // les routes sans mesure en dernier — jamais mêlées aux mesurées (P3).
    { tri: "gravite", pilote: (l) => l.pilote, effectif: (l) => l.volume },
  );
  return (
    <ImpactTable
      titre="Routes les plus lentes"
      tri="gravite"
      triHref={{ gravite: null, volume: null, impact: null, fourni: null }}
      reference={
        routes.referenceLcp === null
          ? null
          : {
              libelle: "Ensemble de la population",
              valeurs: {
                pilote: formater("ms", routes.referenceLcp),
                volume: routes.referenceN === null ? "—" : routes.referenceN.toLocaleString("fr-FR"),
              },
            }
      }
      referenceRaison={
        routes.referenceLcp === null ? "LCP p75 de l’app non calculable : aucun écart n’est affiché" : undefined
      }
      lignes={lignes}
      colonnes={["INP p75", "CLS p75"]}
      unitePilote="ms"
      volumeLibelle="Vues"
      groupes={routes.lignes.length}
      tronque={routes.tronque}
      notice="Routes lues sur les pages vues de la fenêtre ; LCP, INP et CLS au p75."
      compact
    />
  );
}

/**
 * W-B9 — une ligne par groupe d'erreurs : sa tendance, ses occurrences (une SOMME,
 * V1), les sessions touchées (une autre population, V2 : jamais additionnées) et
 * son statut. Sans assez de seaux mesurés, la sparkline est remplacée par sa
 * raison — une ligne plate se lirait « stable ».
 */
function ListeErreurs({ lignes, query }: { lignes: WidgetErreur[]; query: AnalyticsQuery }) {
  if (!lignes.length) return <p className="py-6 text-center text-sm text-ink-faint">aucune erreur sur la fenêtre</p>;
  return (
    <ul className="flex flex-col gap-2" data-testid="widget-erreurs">
      {lignes.map((l) => (
        <li key={l.fingerprint} className="flex min-w-0 flex-wrap items-center gap-2 border-t border-line/60 pt-2 first:border-0 first:pt-0">
          <Link
            href={hrefWithQuery("/errors", query, { panel: `error:${l.fingerprint}` })}
            className="min-w-0 flex-1 basis-full truncate text-sm font-medium text-ink hover:text-accent hover:underline sm:basis-0"
            title={l.libelle}
          >
            {l.libelle}
          </Link>
          <span className="shrink-0 text-[11px] text-ink-faint">{l.statut}</span>
          <span className="shrink-0 tabular-nums text-xs text-ink-soft">
            {l.occurrences.toLocaleString("fr-FR")} occ. · {l.sessions.toLocaleString("fr-FR")} sessions
          </span>
          <span className="shrink-0">
            {l.serie ? (
              <Sparkline valeurs={l.serie} label={`Tendance de ${l.libelle}`} />
            ) : (
              <span className="text-[11px] text-ink-faint">pas assez de points</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
