// « Dernier déploiement : avant / après » (§ 5.8, T11) — rendu serveur, sans lecture.
// Liste les déploiements récents et, pour le dernier, dit si une régression (LCP
// p75 ou occurrences d'erreurs) a suivi, selon une règle ÉCRITE (§ 3.2).
//
// SANS DÉPLOIEMENT, LE PANNEAU RESTE (F60). Il disparaissait (`return null`) : un
// écran sans marqueur ne disait pas qu'il pouvait en recevoir, ni comment. Il dit
// désormais « Non collecté » et nomme le geste : POST /api/v1/deploys depuis la CI.
//
// Les lectures sont faites par la page (`lire()`, F02) : une lecture en échec rend
// l'état « erreur » de CETTE section, jamais une page entière en panne.
import Link from "next/link";
import { EtatSurface } from "@/components/states/EtatSurface";
import { formater } from "@/lib/fmt-ids";
import type { DeployRow } from "@/lib/queries-deploys";
import { verdictDeploiement, type DeployImpact } from "@/lib/deploys-verdict";

/** Règle du verdict, écrite telle quelle (§ 3.2, `assessRegression` ratio 1,2). */
export const REGLE_DEPLOIEMENT = "+20 % ou plus, ±2 h, filtres de population non appliqués";

/** Texte de l'état « non collecté » : ce qui manque, et le geste qui le fournit. */
export const MANQUE_DEPLOIEMENT = "aucun déploiement déclaré : POST /api/v1/deploys depuis la CI";

// Heure en UTC, écrite : une heure sans fuseau se lirait dans celui du lecteur.
const HEURE_UTC = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function quand(ts: Date | string): string {
  return `${HEURE_UTC.format(new Date(ts))} UTC`;
}

const TON = {
  regression: "border-bad/60 bg-bad/10 text-bad-ink",
  incomplet: "border-line bg-panel2 text-ink-soft",
  stable: "border-good/60 bg-good/10 text-good-ink",
} as const;

function Version({ version, lien }: { version: string | null; lien: (v: string) => string }) {
  if (!version) return <>déploiement sans version</>;
  return (
    <Link href={lien(version)} className="font-medium underline-offset-2 hover:underline">
      {version}
    </Link>
  );
}

export function DeployPanel({
  deploys,
  impact,
  lienVersion,
}: {
  /** Marqueurs récents du périmètre (au plus six affichés). */
  deploys: DeployRow[];
  impact: DeployImpact | null;
  /** Une version → la comparaison de releases de la Vue d'ensemble (`/?cmp=release&rel_b=<v>`). */
  lienVersion: (version: string) => string;
}) {
  if (!deploys.length) return <EtatSurface etat={{ kind: "non_collecte", manque: MANQUE_DEPLOIEMENT }} />;

  const verdict = impact ? verdictDeploiement(impact) : null;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-ink-soft">
        App du marqueur, fenêtre de 2 h avant et de 2 h après le dernier déploiement. Règle :{" "}
        <span className="font-medium text-ink">{REGLE_DEPLOIEMENT}</span>.
      </p>

      {impact?.deploy_ts && verdict && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${TON[verdict.etat]}`} data-testid="deploy-verdict" data-etat={verdict.etat}>
          {verdict.etat === "regression" ? (
            <>
              <strong>Régression détectée</strong> après le déploiement du {quand(impact.deploy_ts)} (
              <Version version={impact.version} lien={lienVersion} />) —{" "}
              {[
                verdict.lcp.regressed && verdict.lcp.deltaPct != null && (
                  <span key="lcp">
                    LCP p75 <strong>+{verdict.lcp.deltaPct}&nbsp;%</strong> ({formater("ms", impact.lcp_before)} →{" "}
                    {formater("ms", impact.lcp_after)})
                  </span>
                ),
                verdict.erreurs.regressed && verdict.erreurs.deltaPct != null && (
                  <span key="err">
                    occurrences d&apos;erreurs <strong>+{verdict.erreurs.deltaPct}&nbsp;%</strong> ({formater("count", impact.errors_before)} →{" "}
                    {formater("count", impact.errors_after)})
                  </span>
                ),
                verdict.erreursApparues && (
                  <span key="app">
                    erreurs <strong>apparues</strong> (0 → {formater("count", impact.errors_after)} occurrences)
                  </span>
                ),
              ]
                .filter(Boolean)
                .flatMap((el, i) => (i ? [" · ", el] : [el]))}
              .
            </>
          ) : verdict.etat === "incomplet" ? (
            <>
              <strong>Comparaison impossible</strong> pour le déploiement du {quand(impact.deploy_ts)} (
              <Version version={impact.version} lien={lienVersion} />) : {verdict.manques.join(", ")}.
            </>
          ) : (
            <>
              <strong>Aucune régression</strong> après le déploiement du {quand(impact.deploy_ts)} (
              <Version version={impact.version} lien={lienVersion} />) — LCP p75 {formater("ms", impact.lcp_before)} →{" "}
              {formater("ms", impact.lcp_after)}.
            </>
          )}
          <span className="mt-1 block text-xs">
            Pages vues : {formater("count", impact.pageviews_before)} avant · {formater("count", impact.pageviews_after)} après ;
            occurrences d&apos;erreurs : {formater("count", impact.errors_before)} avant · {formater("count", impact.errors_after)} après.
          </span>
        </div>
      )}

      <ul className="flex flex-col gap-1.5">
        {deploys.slice(0, 6).map((d) => (
          <li key={d.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-panel2 px-3 py-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-sm text-ink">
              <Version version={d.version} lien={lienVersion} />
            </span>
            <span className="rounded border border-line bg-panel px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
              {d.env}
            </span>
            <span className="rounded border border-line bg-panel px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
              {d.source}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-ink-soft">{quand(d.ts)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
