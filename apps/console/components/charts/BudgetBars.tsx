// Barres de budget d'erreur alignées (F56, plan § 4.3 et § 5.18.2) — rendu serveur,
// divs à largeur en %, aucun JavaScript client.
//
// POURQUOI DES BARRES ET PAS DES JAUGES. Dix jauges côte à côte ne se comparent pas
// d'un coup d'œil, et une jauge 0-100 ne sait pas dire un dépassement (le budget
// consommé va jusqu'à 999 %). Ici, une échelle COMMUNE de 0 à `echelleMax` (150 %),
// des repères communs à toutes les lignes, et la valeur toujours écrite.
//
// UNE SEULE COULEUR DE VERDICT. « Consommé ≥ 100 % = budget épuisé » est une
// définition ; les repères 50 et 75 % viennent d'une source rapportée avec prudence
// (IP-Label). Donc : barre neutre (jeton `ink-soft`) sous `epuise`, `bad` à partir de
// `epuise`, repères 50 / 75 en traits gris nommés « repère » (R-S, P15). Le verdict
// est aussi ÉCRIT (« dans le budget », « épuisé ») : rien ne tient à la seule couleur.
//
// L'ABSENCE N'EST PAS UN ZÉRO. `consomme = null` (aucune mesure sur la fenêtre) :
// aucune barre — une barre de longueur nulle se lirait « rien consommé » — et la
// raison écrite à la place (V3). Une atteinte négative (`error_rate` : plus
// d'occurrences d'erreurs que de pages vues) n'est pas interprétable : barre pleine
// hachurée, grise, et la raison.
//
// Chaque barre est un lien (drill « qu'est-ce qui consomme ») : le bloc est donc une
// liste, pas un `role="img"` qui masquerait les liens (même règle que `RankBar`) ;
// le dessin de chaque barre porte son `role="img"` et son `aria-label`.
import Link from "next/link";
import { TableAlternative } from "./Figure";
import { EtatSurface } from "../states/EtatSurface";
import { formater } from "@/lib/fmt-ids";

export interface BudgetLigne {
  /** slo_id. */
  cle: string;
  /** Nom du SLO. */
  libelle: string;
  /** « LCP · /checkout · 28 j · objectif 95 % ». */
  detail: string;
  /** burned_pct (0..999) ; null = non mesurable. */
  consomme: number | null;
  /** 0..1 (peut être < 0 pour error_rate : voir raison). */
  atteinte: number | null;
  /** 0..1. */
  objectif: number;
  /** fast_burn. */
  brule: boolean | null;
  /** Obligatoire si consomme === null ou atteinte < 0. */
  raison?: string;
  /** Drill « qu'est-ce qui consomme ». */
  href: string;
}

export interface BudgetBarsProps {
  /** Déjà triées (consommé décroissant, null en dernier). */
  lignes: BudgetLigne[];
  /** Défaut [50, 75] : traits gris « repère », sans couleur de verdict. */
  reperes?: number[];
  /** Défaut 100 : seul seuil coloré (bad) et nommé « épuisé ». */
  epuise?: number;
  /** Défaut 150 ; au-delà : hachures + valeur écrite. */
  echelleMax?: number;
  ariaLabel: string;
  /** false : l'alternative est portée par la `Figure` englobante (`alternativeBudget`). */
  alternative?: boolean;
}

const NBSP = String.fromCharCode(0xa0);

/** « 312 % », « 80 % », « 0,4 % » : un pourcentage de budget (déjà en %, pas une part). */
export function pctBudget(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toLocaleString("fr-FR", { maximumFractionDigits: v < 10 ? 1 : 0 })}${NBSP}%`;
}

type Statut = "non_mesurable" | "non_interpretable" | "dans_budget" | "epuise";

/** L'état d'une ligne, dans l'ordre où il se décide. */
export function statutBudget(l: Pick<BudgetLigne, "consomme" | "atteinte">, epuise = 100): Statut {
  if (l.consomme == null || !Number.isFinite(l.consomme)) return "non_mesurable";
  if (l.atteinte != null && l.atteinte < 0) return "non_interpretable";
  return l.consomme >= epuise ? "epuise" : "dans_budget";
}

const VERDICT: Record<Statut, string> = {
  non_mesurable: "non mesurable",
  non_interpretable: "non interprétable",
  dans_budget: "dans le budget",
  epuise: "épuisé",
};

/** Phrase d'atteinte : « atteinte 96,4 % pour un objectif de 95,0 % ». */
function phraseAtteinte(l: BudgetLigne): string | null {
  if (l.atteinte == null || l.atteinte < 0) return null;
  return `atteinte ${formater("pct", l.atteinte)} pour un objectif de ${formater("pct", l.objectif)}`;
}

/** Texte complet d'une ligne : ce que dit la barre, sans la voir. */
function texteLigne(l: BudgetLigne, epuise: number): string {
  const statut = statutBudget(l, epuise);
  if (statut === "non_mesurable") return `${l.libelle} : non mesurable — ${l.raison ?? "aucune mesure sur la fenêtre"}`;
  const atteinte = phraseAtteinte(l);
  return [
    `${l.libelle} : ${pctBudget(l.consomme)} du budget consommé, ${VERDICT[statut]}`,
    statut === "non_interpretable" ? l.raison ?? "atteinte négative" : null,
    atteinte,
    l.brule ? "brûle vite" : null,
  ]
    .filter(Boolean)
    .join(" ; ");
}

/** L'alternative textuelle : une ligne par SLO, les mêmes que les barres. */
export function alternativeBudget(lignes: BudgetLigne[], epuise = 100) {
  return {
    legende: `Budget d'erreur consommé par SLO ; « épuisé » à partir de ${pctBudget(epuise)}.`,
    colonnes: ["SLO", "Consommé", "Verdict", "Atteinte", "Objectif", "Brûle vite"],
    lignes: lignes.map((l) => {
      const statut = statutBudget(l, epuise);
      return [
        l.libelle,
        pctBudget(l.consomme),
        statut === "non_mesurable" || statut === "non_interpretable" ? `${VERDICT[statut]} : ${l.raison ?? "—"}` : VERDICT[statut],
        l.atteinte == null ? "—" : formater("pct", l.atteinte),
        formater("pct", l.objectif),
        l.brule == null ? "inconnu" : l.brule ? "oui" : "non",
      ];
    }),
  };
}

/** Hachures en CSS (pas d'identifiant SVG à rendre unique) ; la teinte vient de `currentColor`. */
const HACHURES = "repeating-linear-gradient(135deg, currentColor 0 3px, transparent 3px 6px)";

/** Colonnes partagées par les lignes et l'axe : libellé | barre | valeur. */
const COLONNES = "grid min-w-0 gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_4.5rem] sm:items-center";

export function BudgetBars({
  lignes,
  reperes = [50, 75],
  epuise = 100,
  echelleMax = 150,
  ariaLabel,
  alternative = true,
}: BudgetBarsProps) {
  // Aucun SLO : l'état vide, jamais un axe sans barre (l'écran y ajoute son geste).
  if (lignes.length === 0) return <EtatSurface etat={{ kind: "vide", population: "SLO actif", plage: "ce périmètre" }} />;
  const pos = (v: number) => `${(Math.min(Math.max(v, 0), echelleMax) / echelleMax) * 100}%`;
  const reperesVisibles = reperes.filter((r) => r > 0 && r < echelleMax && r !== epuise);

  /** Les traits verticaux communs, posés dans chaque piste (même échelle partout). */
  const traits = (
    <>
      {reperesVisibles.map((r) => (
        <span
          key={r}
          aria-hidden="true"
          data-repere={r}
          className="absolute inset-y-0 w-px bg-ink-faint/60"
          style={{ left: pos(r) }}
        />
      ))}
      {epuise < echelleMax && (
        <span aria-hidden="true" data-repere="epuise" className="absolute -inset-y-0.5 w-0.5 bg-bad" style={{ left: pos(epuise) }} />
      )}
    </>
  );

  return (
    <div className="min-w-0" data-testid="budget-bars">
      <ul aria-label={ariaLabel} className="flex min-w-0 flex-col gap-3">
        {lignes.map((l) => {
          const statut = statutBudget(l, epuise);
          const atteinte = phraseAtteinte(l);
          const valeur = l.consomme ?? 0;
          const deborde = valeur > echelleMax;
          return (
            <li key={l.cle} className={COLONNES} data-testid="budget-ligne" data-statut={statut}>
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <span className="block min-w-0 truncate text-sm font-medium text-ink" title={l.libelle}>
                    {l.libelle}
                  </span>
                  {l.brule && (
                    <span className="shrink-0 rounded border border-bad/30 bg-bad/10 px-1 text-[10px] font-medium text-bad-ink">
                      brûle vite
                    </span>
                  )}
                </div>
                <p className="min-w-0 break-words text-[11px] text-ink-soft">
                  {l.detail}
                  {atteinte ? ` · ${atteinte}` : ""}
                </p>
              </div>

              {statut === "non_mesurable" ? (
                <p className="min-w-0 text-xs text-ink-soft sm:col-span-2" data-testid="budget-raison">
                  <strong className="font-medium text-ink">Non mesurable</strong> :{" "}
                  {l.raison ?? "aucune mesure sur la fenêtre"}
                </p>
              ) : (
                <>
                  <Link
                    href={l.href}
                    className="group block min-w-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
                  >
                    <span
                      role="img"
                      aria-label={texteLigne(l, epuise)}
                      className="relative block h-4 rounded-sm bg-panel2 ring-1 ring-inset ring-line group-hover:ring-ink-faint"
                    >
                      {statut === "non_interpretable" ? (
                        // Atteinte négative : pleine et hachurée, sans teinte de verdict.
                        <span
                          data-barre="hachuree"
                          className="absolute inset-y-0 left-0 w-full rounded-sm text-ink-faint"
                          style={{ backgroundImage: HACHURES }}
                        />
                      ) : (
                        <>
                          <span
                            data-barre={statut}
                            className={`absolute inset-y-0 left-0 rounded-sm ${statut === "epuise" ? "bg-bad" : "bg-ink-soft"}`}
                            style={{ width: pos(Math.min(valeur, epuise)) }}
                          />
                          {/* La part au-delà de l'épuisement : hachurée, jusqu'au bord de l'échelle. */}
                          {valeur > epuise && (
                            <span
                              data-barre="depassement"
                              className="absolute inset-y-0 rounded-r-sm bg-bad/25 text-bad"
                              style={{ left: pos(epuise), width: `calc(${pos(valeur)} - ${pos(epuise)})`, backgroundImage: HACHURES }}
                            />
                          )}
                          {deborde && (
                            <span aria-hidden="true" className="absolute -right-0.5 top-1/2 -translate-y-1/2 text-[10px] font-bold leading-none text-bad-ink">
                              ›
                            </span>
                          )}
                        </>
                      )}
                      {traits}
                    </span>
                  </Link>
                  <p className="min-w-0 text-xs tabular-nums sm:text-right">
                    <span className={`font-semibold ${statut === "epuise" ? "text-bad-ink" : "text-ink"}`} data-testid="budget-valeur">
                      {pctBudget(l.consomme)}
                    </span>{" "}
                    <span className="text-ink-soft">{VERDICT[statut]}</span>
                  </p>
                </>
              )}
              {statut === "non_interpretable" && (
                <p className="min-w-0 text-[11px] text-ink-soft sm:col-span-3" data-testid="budget-raison">
                  {l.raison ?? "atteinte négative : non interprétable"}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {/* Axe commun : 0, les repères, « épuisé », le bord de l'échelle. */}
      <div className={`${COLONNES} mt-2`} aria-hidden="true">
        <span className="hidden sm:block" />
        <div className="relative h-8 min-w-0 text-[10px] tabular-nums text-ink-soft" data-testid="budget-axe">
          <span className="absolute left-0 top-0">0</span>
          {reperesVisibles.map((r) => (
            <span key={r} className="absolute top-0 -translate-x-1/2 text-center leading-tight" style={{ left: pos(r) }}>
              {pctBudget(r)}
              <br />
              repère
            </span>
          ))}
          {epuise < echelleMax && (
            <span className="absolute top-0 -translate-x-1/2 text-center font-medium leading-tight text-bad-ink" style={{ left: pos(epuise) }}>
              {pctBudget(epuise)}
              <br />
              épuisé
            </span>
          )}
          <span className="absolute right-0 top-0 text-right leading-tight">
            {pctBudget(echelleMax)}
            <br />
            et +
          </span>
        </div>
        <span className="hidden sm:block" />
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
        Barre grise sous {pctBudget(epuise)} ; rouge à partir de {pctBudget(epuise)} (budget épuisé, seul seuil défini). La part
        au-delà de {pctBudget(epuise)} est hachurée ; au-delà de {pctBudget(echelleMax)}, la barre s&apos;arrête au bord et la
        valeur est écrite. Les repères {reperesVisibles.map((r) => pctBudget(r)).join(" et ")} ne sont pas des verdicts.
      </p>

      {alternative && <TableAlternative alternative={alternativeBudget(lignes, epuise)} />}
    </div>
  );
}
