// Les SLO en cases (recette du 30/09/2026) : une case par objectif, de même gabarit,
// avec l'atteinte en grand, la cible écrite et une JAUGE CHIFFRÉE du budget d'erreur
// consommé ; un clic ouvre la fenêtre du SLO (verdict, formule, burn, alertes, source,
// « qu'est-ce qui consomme »). Rendu serveur ; seule la fenêtre (`FicheMesure`) est client.
//
// LES MÊMES RÈGLES QUE LES BARRES (`BudgetBars`, `statutBudget`) :
//   - une échelle COMMUNE de 0 à 150 % pour toutes les jauges, le trait « épuisé » à 100 % ;
//   - une seule couleur de verdict, `bad`, à partir de 100 % (seule définition, R-S) ; sous
//     100 %, la jauge est neutre — aucun vert, aucun ambre sans source ;
//   - un SLO sans mesure n'a PAS de jauge (une jauge vide se lirait « rien consommé ») :
//     « Non mesurable » et sa raison ; une atteinte négative : jauge hachurée, grise.
// Repères de test gardés : `budget-ligne` (et `data-statut`), `budget-valeur`, `data-barre`
// — posés sur la CASE seulement, pour qu'un repère ne désigne jamais deux éléments.
import Link from "next/link";
import type { ReactNode } from "react";
import { FicheMesure } from "@/components/charts/FicheMesure";
import { pctBudget, statutBudget, type BudgetLigne } from "@/components/charts/BudgetBars";
import { formater } from "@/lib/fmt-ids";

type Statut = ReturnType<typeof statutBudget>;

const VERDICT: Record<Statut, string> = {
  non_mesurable: "non mesurable",
  non_interpretable: "non interprétable",
  dans_budget: "dans le budget",
  epuise: "épuisé",
};

/** Échelle commune des jauges, en % du budget ; au-delà, la jauge est pleine et hachurée. */
const ECHELLE_MAX = 150;
const EPUISE = 100;
/** Hachures en CSS (pas d'identifiant SVG à rendre unique) ; la teinte vient de `currentColor`. */
const HACHURES = "repeating-linear-gradient(135deg, currentColor 0 3px, transparent 3px 6px)";

const pos = (v: number) => `${(Math.min(Math.max(v, 0), ECHELLE_MAX) / ECHELLE_MAX) * 100}%`;

export interface InfoSlo {
  metrique: string;
  /** La formule de la métrique, en clair. */
  metriqueEnClair: string;
  route: string | null;
  app: string;
  fenetreJours: number;
  /** Déclenchements de ce SLO sur la fenêtre des alertes ; `null` : lecture en échec. */
  alertes: number | null;
  /** Lien « Créer une alerte » (administrateur seulement), sinon `null`. */
  creerAlerte: string | null;
}

/**
 * La jauge d'une case. `repere` : les attributs `data-barre` (lus par les e2e) ne sont
 * posés que sur la jauge de la case, jamais sur celle de la fenêtre.
 */
function Jauge({ l, statut, grande = false }: { l: BudgetLigne; statut: Statut; grande?: boolean }) {
  const valeur = l.consomme ?? 0;
  const attr = (v: string) => (grande ? {} : { "data-barre": v });
  return (
    <span aria-hidden className={`relative block w-full overflow-hidden rounded-sm bg-panel2 ring-1 ring-inset ring-line ${grande ? "h-3" : "h-1.5"}`}>
      {statut === "non_interpretable" ? (
        <span {...attr("hachuree")} className="absolute inset-y-0 left-0 w-full text-ink-faint" style={{ backgroundImage: HACHURES }} />
      ) : (
        <>
          <span
            {...attr(statut)}
            className={`absolute inset-y-0 left-0 ${statut === "epuise" ? "bg-bad" : "bg-ink-soft"}`}
            style={{ width: pos(Math.min(valeur, EPUISE)) }}
          />
          {valeur > EPUISE && (
            <span
              {...attr("depassement")}
              className="absolute inset-y-0 bg-bad/25 text-bad"
              style={{ left: pos(EPUISE), width: `calc(${pos(valeur)} - ${pos(EPUISE)})`, backgroundImage: HACHURES }}
            />
          )}
        </>
      )}
      {grande &&
        [50, 75].map((r) => <span key={r} className="absolute inset-y-0 w-px bg-ink-faint/60" style={{ left: pos(r) }} />)}
      <span className="absolute -inset-y-0.5 w-0.5 bg-bad" style={{ left: pos(EPUISE) }} />
    </span>
  );
}

function Ligne({ cle, children }: { cle: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-ink-faint">{cle}</dt>
      <dd className="min-w-0 text-ink-soft [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export function CasesSlo({
  lignes,
  infos,
  luA,
}: {
  /** Déjà triées (`lignesBudget`) : consommé décroissant, non mesurables en dernier. */
  lignes: BudgetLigne[];
  infos: ReadonlyMap<string, InfoSlo>;
  /** L'heure de l'instantané (`slo_status()`), heure de Paris. */
  luA: string;
}) {
  return (
    <ul aria-label="Budget d'erreur consommé par SLO, échelle commune de 0 à 150 %" className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {lignes.map((l) => {
        const statut = statutBudget(l);
        const info = infos.get(l.cle);
        const mesurable = statut !== "non_mesurable";
        const atteinte = l.atteinte != null && l.atteinte >= 0 ? formater("pct", l.atteinte) : "—";
        const resume = [
          `${l.libelle} : ${mesurable ? `${pctBudget(l.consomme)} du budget consommé, ${VERDICT[statut]}` : `non mesurable — ${l.raison ?? "aucune mesure sur la fenêtre"}`}`,
          l.atteinte != null && l.atteinte >= 0 ? `atteinte ${atteinte} pour un objectif de ${formater("pct", l.objectif)}` : null,
          l.brule ? "brûle vite" : null,
        ]
          .filter(Boolean)
          .join(" ; ");
        return (
          <li key={l.cle} className="min-w-0" data-testid="budget-ligne" data-statut={statut}>
            <FicheMesure
              titre={l.libelle}
              ariaLabel={resume}
              alerte={statut === "epuise"}
              testId="slo-case"
              case={
                <>
                  <span className="flex min-w-0 items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[11px] font-medium text-ink-soft" title={l.libelle}>
                      {l.libelle}
                    </span>
                    {l.brule && (
                      <span className="shrink-0 rounded border border-bad/30 bg-bad/10 px-1 text-[10px] font-medium text-bad-ink">brûle vite</span>
                    )}
                  </span>
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="whitespace-nowrap text-[24px] font-semibold leading-8 tabular-nums tracking-tight text-ink">
                      {atteinte}
                    </span>
                    <span className="truncate text-[11px] text-ink-soft">
                      atteint · cible {formater("pct", l.objectif)}
                    </span>
                  </span>
                  {mesurable ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <Jauge l={l} statut={statut} />
                      <span className="shrink-0 whitespace-nowrap text-[11px] tabular-nums">
                        <span className={`font-semibold ${statut === "epuise" ? "text-bad-ink" : "text-ink"}`} data-testid="budget-valeur">
                          {pctBudget(l.consomme)}
                        </span>{" "}
                        <span className="text-ink-soft">{statut === "non_interpretable" ? "non interprétable" : statut === "epuise" ? "épuisé" : "consommé"}</span>
                      </span>
                    </span>
                  ) : (
                    <span className="truncate text-[11px] text-ink-soft" data-testid="budget-raison">
                      <span className="font-medium text-ink">Non mesurable</span> : {l.raison ?? "aucune mesure sur la fenêtre"}
                    </span>
                  )}
                  <span className="truncate text-[10px] text-ink-faint">{l.detail}</span>
                </>
              }
            >
              <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="flex items-baseline gap-1 tabular-nums tracking-tight">
                  <span className="text-4xl font-semibold">{atteinte}</span>
                  <span className="text-lg font-medium text-ink-soft">atteint</span>
                </span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                    statut === "epuise" ? "border-bad/30 bg-bad/10 text-bad-ink" : "border-line bg-panel2 text-ink-soft"
                  }`}
                >
                  {VERDICT[statut]}
                </span>
                {l.brule && <span className="rounded-full border border-bad/30 bg-bad/10 px-2 py-0.5 text-[11px] font-medium text-bad-ink">brûle vite</span>}
              </div>
              {mesurable && (
                <figure className="m-0 mt-4" aria-label={`Budget consommé : ${pctBudget(l.consomme)}, épuisé à partir de 100 %`}>
                  <Jauge l={l} statut={statut} grande />
                  {/* Les graduations de l'échelle commune, sous la jauge. */}
                  <figcaption className="relative mt-1 h-4 text-[10px] tabular-nums text-ink-soft">
                    {[0, 50, 75, 100, 150].map((r) => (
                      <span
                        key={r}
                        className={`absolute ${r === 0 ? "" : r === 150 ? "-translate-x-full" : "-translate-x-1/2"} ${r === 100 ? "font-semibold text-bad-ink" : ""}`}
                        style={{ left: pos(r) }}
                      >
                        {r} %{r === 100 ? " épuisé" : ""}
                      </span>
                    ))}
                  </figcaption>
                </figure>
              )}
              <dl className="mt-4 grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1.5 border-t border-line pt-3 text-xs leading-snug">
                <Ligne cle="Budget consommé">
                  {mesurable ? `${pctBudget(l.consomme)} — (1 − atteinte) ÷ (1 − objectif)` : `non mesurable : ${l.raison ?? "aucune mesure sur la fenêtre"}`}
                </Ligne>
                {statut === "non_interpretable" && <Ligne cle="Lecture">{l.raison ?? "atteinte négative : non interprétable"}</Ligne>}
                <Ligne cle="Objectif">
                  {formater("pct", l.objectif)}
                  {info ? ` sur ${info.fenetreJours} j glissants, jusqu'à maintenant` : ""}
                </Ligne>
                {info && <Ligne cle="Métrique">{info.metriqueEnClair}</Ligne>}
                {info && (
                  <Ligne cle="Périmètre">
                    {info.route ?? "toutes routes"} · app {info.app}
                  </Ligne>
                )}
                <Ligne cle="Brûle vite">
                  {l.brule == null
                    ? "inconnu : aucune mesure sur la dernière heure"
                    : l.brule
                      ? "oui : sur la dernière heure, le budget part au moins 14,4 fois trop vite"
                      : "non, sur la dernière heure"}
                </Ligne>
                {info && <Ligne cle="Alertes sur 7 j">{info.alertes == null ? "— (lecture en échec)" : formater("count", info.alertes)}</Ligne>}
                <Ligne cle="Source">
                  Fonction slo_status() : part des mesures notées Bon (web-vitals, seuils web.dev) ou 1 − erreurs navigateur ÷
                  pages vues ; instantané calculé à {luA}.
                </Ligne>
              </dl>
              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm font-medium">
                {mesurable && (
                  <Link href={l.href} className="text-perf underline-offset-2 hover:underline">
                    Ce qui consomme ce budget →
                  </Link>
                )}
                {info?.creerAlerte && (
                  <Link href={info.creerAlerte} className="text-perf underline-offset-2 hover:underline">
                    Créer une alerte
                  </Link>
                )}
              </div>
            </FicheMesure>
          </li>
        );
      })}
    </ul>
  );
}
