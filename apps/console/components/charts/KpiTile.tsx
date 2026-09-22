// KpiTile — la tuile chiffre-clé de toutes les rangées de KPI (F03, plan § 4.2,
// § 3.12). Rendu serveur.
//
// CE QU'ELLE REFUSE D'AFFIRMER, dans l'ordre où elle le vérifie :
//   - une valeur inconnue : « — » et sa raison, sans delta, sans verdict, sans
//     alerte (V3) — un « 0 » se lirait « rien ne s'est passé » ;
//   - un delta sans référence nommée (P4) : la référence est écrite en toutes
//     lettres à côté du chiffre, jamais seulement dans un `title` ;
//   - un delta contre une période précédente INCOMPLÈTE (§ 3.2) : l'écart mesurerait
//     la collecte, pas le site — la tuile écrit pourquoi elle se tait ;
//   - un delta contre ZÉRO : « +∞ % » n'est pas une mesure, c'est une division ;
//   - un delta sur un échantillon faible, d'un côté ou de l'autre ;
//   - une couleur de verdict hors d'un Web Vital au p75 (R-S, R-V) : la seule autre
//     voie vers le rouge est une `alerte`, dont la règle s'écrit sous la valeur.
//
// Un seul lien quand `href` est fourni : la tuile entière, un seul arrêt de
// tabulation, et un libellé annoncé complet (valeur, verdict, delta, effectif).
import Link from "next/link";
import type { ReactNode } from "react";
import { DeltaBadge } from "../SupervisionHero";
import { Sparkline } from "./Sparkline";
import type { CouverturePrecedente } from "@/lib/comparaison";
import { formater, referenceSansVs, libelleReference, type FormatId, type VitalName } from "@/lib/fmt-ids";
import { RATING_CLASS, RATING_LABEL, THRESHOLDS } from "@/lib/rating";
import type { IntervalleP75 } from "@/lib/stats/incertitude";
import { lireVital, texteVerdict } from "@/lib/vital-lecture";

export type SensMeilleur = "bas" | "haut" | "neutre";

/** Sous ce nombre de mesures, « échantillon faible » (§ 3.12 : 100 pour un vital). */
export const FAIBLE_SOUS_DEFAUT = 100;

/** Sous ±2 %, un delta est « stable » : reprise de `DeltaBadge`. */
const SEUIL_STABLE_PCT = 2;

export const TEXTE_REFERENCE_NULLE = "pas de mesure de référence non nulle";
export const TEXTE_ECHANTILLON_DELTA = "delta non affiché : échantillon faible sur l'une des deux périodes";

export interface AlerteTuile {
  si: ">" | ">=" | "<";
  valeur: number;
  /** La règle, écrite sous la valeur : « aucun canal : personne n'est prévenu ». */
  regle: string;
}

/** Ce que la tuile dit de la comparaison : un delta chiffré, ou pourquoi il n'y en a pas. */
export type Comparaison =
  | { kind: "delta"; pct: number; reference: string }
  | { kind: "silence"; texte: string }
  | null;

function alerteVraie(valeur: number, a: AlerteTuile): boolean {
  if (a.si === ">") return valeur > a.valeur;
  if (a.si === ">=") return valeur >= a.valeur;
  return valeur < a.valeur;
}

const sousLeSeuil = (n: number | null | undefined, seuil: number) => n != null && n < seuil;

/**
 * La comparaison d'une tuile — logique pure, exportée pour les tests.
 *
 * Ordre : la couverture d'abord. Une période précédente purgée par la rétention
 * rend aussi `precedent: null` ; « pas de mesure sur la période précédente » en
 * masquerait la cause, qu'on connaît.
 */
export function comparaisonDeTuile({
  valeur,
  precedent,
  reference,
  couverturePrecedente,
  n,
  faibleSous,
}: {
  valeur: number | null;
  precedent: number | null | undefined;
  reference: string | undefined;
  couverturePrecedente: CouverturePrecedente | undefined;
  n: number | null | undefined;
  faibleSous: number;
}): Comparaison {
  // Aucune comparaison demandée (cmp=none), ou aucune référence à écrire (P4 :
  // pas de delta sans libellé visible), ou rien à comparer.
  if (precedent === undefined || !reference || valeur == null) return null;
  if (couverturePrecedente && couverturePrecedente.etat !== "complete") {
    return {
      kind: "silence",
      texte: `période précédente incomplète : ${couverturePrecedente.raison ?? "raison non lue"}`,
    };
  }
  if (precedent === null) return { kind: "silence", texte: `pas de mesure sur ${referenceSansVs(reference)}` };
  if (precedent === 0) return { kind: "silence", texte: TEXTE_REFERENCE_NULLE };
  if (sousLeSeuil(n, faibleSous) || sousLeSeuil(couverturePrecedente?.n, faibleSous)) {
    return { kind: "silence", texte: TEXTE_ECHANTILLON_DELTA };
  }
  return { kind: "delta", pct: ((valeur - precedent) / Math.abs(precedent)) * 100, reference };
}

/** Le texte d'un delta tel qu'un lecteur d'écran l'annonce : « +8 % vs 24 h précédentes ». */
function texteDelta(pct: number, reference: string): string {
  const arrondi = Math.round(pct);
  const stable = Math.abs(pct) < SEUIL_STABLE_PCT;
  return `${stable ? "stable, " : ""}${arrondi > 0 ? "+" : ""}${arrondi} % ${libelleReference(reference)}`;
}

/**
 * Le cadre commun des tuiles (`KpiTile`, `KpiLibelle`) : une carte, ou un lien qui
 * EST la carte. Le libellé complet est porté par le lien, ou par un groupe.
 */
export function CadreTuile({
  href,
  ariaLabel,
  alerte = false,
  testId,
  children,
}: {
  href?: string;
  ariaLabel: string;
  alerte?: boolean;
  testId: string;
  children: ReactNode;
}) {
  const classes = `card flex min-w-0 flex-col gap-1 p-4 ${alerte ? "border-bad/50" : ""}`;
  if (href) {
    return (
      <Link
        href={href}
        aria-label={ariaLabel}
        data-testid={testId}
        data-ton={alerte ? "bad" : "neutre"}
        className={`${classes} transition hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf`}
      >
        {children}
      </Link>
    );
  }
  return (
    <div role="group" aria-label={ariaLabel} data-testid={testId} data-ton={alerte ? "bad" : "neutre"} className={classes}>
      {children}
    </div>
  );
}

export function KpiTile({
  label,
  valeur,
  format,
  raisonNull,
  vital,
  precedent,
  reference,
  couverturePrecedente,
  sensMeilleur,
  serie,
  couverture,
  lecture,
  alerte,
  intervalle,
  href,
}: {
  /** « LCP p75 », « Sessions commencées ». */
  label: string;
  valeur: number | null;
  format: FormatId;
  /** Obligatoire si valeur === null. */
  raisonNull?: string;
  /** Badge de verdict via rating2026 — SEULEMENT un p75 (R-V, `vitalDeVerdict`). */
  vital?: VitalName;
  /** Valeur de référence. */
  precedent?: number | null;
  /** « vs 24 h précédentes (…) » ; requis si precedent !== undefined. */
  reference?: string;
  /** § 3.2 ; requis si precedent !== undefined et cmp=prev. */
  couverturePrecedente?: CouverturePrecedente;
  /** Défaut "bas" pour un vital, "neutre" sinon. */
  sensMeilleur?: SensMeilleur;
  /** Sparkline, même population que valeur (R-P). */
  serie?: (number | null)[];
  /** Effectif ; défaut faibleSous 100. */
  couverture?: { n: number | null; unite: string; faibleSous?: number };
  /** Phrase sous la valeur (définition, sous-texte chiffré). */
  lecture?: string;
  /** Ton bad SEULEMENT si la condition est vraie, avec la règle écrite. */
  alerte?: AlerteTuile;
  /** Intervalle à 95 % (P*.1), ou pourquoi il n'est pas calculé. */
  intervalle?: IntervalleP75;
  /** La tuile entière est un lien. */
  href?: string;
}) {
  const connue = valeur != null && Number.isFinite(valeur);
  const faibleSous = couverture?.faibleSous ?? FAIBLE_SOUS_DEFAUT;
  const sens: SensMeilleur = sensMeilleur ?? (vital ? "bas" : "neutre");
  const texteValeur = formater(format, connue ? valeur : null);

  // Verdict (vital au p75 seulement) : la logique de VitalCard, partagée.
  const verdict =
    connue && vital ? lireVital(vital, valeur, couverture?.n ?? 0, intervalle).verdict : null;
  const intervalleCalcule = connue && intervalle && !("indisponible" in intervalle) ? intervalle : null;
  const texteIntervalle = intervalleCalcule
    ? `entre ${formater(format, intervalleCalcule.bas)} et ${formater(format, intervalleCalcule.haut)} (95 %)`
    : connue && intervalle && "indisponible" in intervalle && !vital
      ? `intervalle non calculable : ${intervalle.indisponible}`
      : null;

  const comparaison = comparaisonDeTuile({
    valeur: connue ? valeur : null,
    precedent,
    reference,
    couverturePrecedente,
    n: couverture?.n,
    faibleSous,
  });

  const enAlerte = connue && alerte != null && alerteVraie(valeur, alerte);
  const echantillonFaible = connue && sousLeSeuil(couverture?.n, faibleSous);
  const texteEffectif =
    couverture == null
      ? null
      : couverture.n == null
        ? `effectif inconnu (${couverture.unite})`
        : `${formater("count", couverture.n)} ${couverture.unite}`;

  const ariaLabel = [
    `${label} ${texteValeur}`,
    !connue ? raisonNull : null,
    verdict ? texteVerdict(verdict) : null,
    comparaison?.kind === "delta" ? texteDelta(comparaison.pct, comparaison.reference) : comparaison?.texte,
    enAlerte ? `alerte : ${alerte?.regle}` : null,
    texteEffectif,
    echantillonFaible ? "échantillon faible" : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <CadreTuile href={href} ariaLabel={ariaLabel} alerte={enAlerte} testId="kpi-tile">
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <span className="min-w-0 break-words text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
          {label}
        </span>
        {verdict?.kind === "etabli" && (
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${RATING_CLASS[verdict.rating]}`}
            data-testid="kpi-verdict"
          >
            {RATING_LABEL[verdict.rating]}
          </span>
        )}
      </div>

      <span
        className={`text-2xl font-bold tabular-nums tracking-tight ${enAlerte ? "text-bad-ink" : "text-ink"}`}
        data-testid="kpi-valeur"
      >
        {texteValeur}
      </span>

      {!connue && raisonNull && (
        <p className="text-xs text-ink-soft" data-testid="kpi-raison">
          {raisonNull}
        </p>
      )}

      {verdict && verdict.kind !== "etabli" && (
        // Un verdict qui ne tient pas sur tout l'intervalle n'a pas de couleur.
        <p className="text-xs text-ink-soft" data-testid="kpi-verdict">
          {texteVerdict(verdict)}
        </p>
      )}

      {texteIntervalle && (
        <p className="text-xs text-ink-soft" data-testid="kpi-intervalle">
          {texteIntervalle}
        </p>
      )}

      {comparaison?.kind === "delta" && (
        <DeltaBadge pct={comparaison.pct} reference={comparaison.reference} sensMeilleur={sens} />
      )}
      {comparaison?.kind === "silence" && (
        <p className="text-xs text-ink-soft" data-testid="kpi-comparaison">
          {comparaison.texte}
        </p>
      )}

      {enAlerte && (
        <p className="text-xs font-medium text-bad-ink" data-testid="kpi-alerte">
          {alerte?.regle}
        </p>
      )}

      {lecture && <p className="text-xs text-ink-soft">{lecture}</p>}

      {(texteEffectif || echantillonFaible) && (
        <p className="text-xs text-ink-soft" data-testid="kpi-couverture">
          {texteEffectif}
          {echantillonFaible && (
            <>
              {texteEffectif && " · "}
              <span className="font-medium text-warn-ink">échantillon faible</span>
            </>
          )}
        </p>
      )}

      {serie && serie.length > 0 && (
        <div className="mt-1">
          <Sparkline
            valeurs={serie}
            label={`${label}, évolution sur ${serie.length} seaux`}
            seuils={vital ? THRESHOLDS[vital] : undefined}
          />
        </div>
      )}
    </CadreTuile>
  );
}
