// Bandeau R0 de la Vue d'ensemble (spec A2 § 5.2-5.3) — « Ça va ? » en une ligne :
// le score de santé, UNE phrase tirée du constat le plus prioritaire, le nombre de
// constats et le dernier déploiement. Rendu serveur, sans lecture propre : tout
// vient de ce que l'écran a déjà lu (aucune requête de plus).
//
// Deux règles tenues :
//   · l'absence de constat se dit « Aucun constat sur la période », jamais « tout va
//     bien » : ne rien trouver n'est pas une preuve (A2 § 5.3) ;
//   · une lecture en échec se dit (« santé non lue », « constats partiels ») : un
//     bandeau muet se lirait comme un bandeau calme.
import Link from "next/link";
import { HEALTH_CLASS, type HealthLabel } from "@/lib/health-libelles";
import { fmtInstant, pluriel } from "@/lib/format";

export interface ProprietesBandeauR0 {
  /** Score et libellé ; `null` = pas de score calculable ; `"echec"` = santé non lue. */
  sante: { score: number; label: HealthLabel } | null | "echec";
  /** Le constat le plus prioritaire (le premier de la liste), ou aucun. */
  constat: { titre: string; href: string } | null;
  nbConstats: number;
  /** Une des lectures des constats a échoué : le compte est un minimum. */
  constatsPartiels: boolean;
  /** Dernier déploiement du périmètre ; `null` = aucun ; `"echec"` = non lu. */
  deploiement: { version: string | null; ts: Date | string } | null | "echec";
  /** Ancre du bandeau de santé, s'il est rendu (bloc allumé). */
  hrefSante?: string;
  /** Ancre de la comparaison de releases de l'écran, si la section est rendue. */
  hrefDeploiement?: string;
}

const LIEN = "rounded-sm text-perf-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf dark:text-perf";

export function BandeauR0({
  sante,
  constat,
  nbConstats,
  constatsPartiels,
  deploiement,
  hrefSante,
  hrefDeploiement,
}: ProprietesBandeauR0) {
  const Score = hrefSante ? "a" : "span";
  return (
    <section
      aria-label="En bref"
      data-testid="bandeau-r0"
      className="card mb-4 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 text-sm xl:flex-nowrap"
    >
      <Score
        href={hrefSante}
        className="flex shrink-0 items-center gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
        data-testid="r0-sante"
      >
        {sante === "echec" ? (
          <span className="text-ink-soft">Santé non lue</span>
        ) : sante === null ? (
          <span className="text-ink-soft">
            Santé <span className="text-ink">—</span>
          </span>
        ) : (
          <>
            <span className="font-semibold tabular-nums text-ink">
              {sante.score}
              <span className="text-xs font-normal text-ink-soft"> / 100</span>
            </span>
            <span className={`rounded-full border px-2 py-px text-xs font-semibold ${HEALTH_CLASS[sante.label]}`}>{sante.label}</span>
          </>
        )}
      </Score>
      <span aria-hidden className="hidden h-4 w-px shrink-0 bg-line sm:block" />
      {/* La phrase prend la place qui reste ; une ligne à 1440 px (le texte entier en
          infobulle), plusieurs à 390 px plutôt qu'un débordement. */}
      <p className="min-w-0 flex-1 basis-60 [overflow-wrap:anywhere] xl:truncate" data-testid="r0-phrase">
        {constat ? (
          <Link href={constat.href} className={`font-medium ${LIEN}`} title={constat.titre}>
            {constat.titre}
          </Link>
        ) : (
          <span className="text-ink-soft">Aucun constat sur la période</span>
        )}
      </p>
      <a href="#constats" className={`shrink-0 text-xs font-medium ${LIEN}`} data-testid="r0-constats">
        {constatsPartiels ? "constats partiels" : pluriel(nbConstats, "constat", "constats")}
      </a>
      <span className="shrink-0 text-xs text-ink-soft" data-testid="r0-deploiement">
        {deploiement === "echec" ? (
          "Déploiements non lus"
        ) : deploiement === null ? (
          "Aucun déploiement"
        ) : (
          <>
            Dernier déploiement :{" "}
            {hrefDeploiement ? (
              <a href={hrefDeploiement} className={`font-medium ${LIEN}`}>
                {deploiement.version ?? "sans version"}
              </a>
            ) : (
              <span className="font-medium text-ink">{deploiement.version ?? "sans version"}</span>
            )}{" "}
            · {fmtInstant(deploiement.ts)}
          </>
        )}
      </span>
    </section>
  );
}
