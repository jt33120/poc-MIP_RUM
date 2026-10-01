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
import type { Ecart, IntervalleP75 } from "@mip/stats/incertitude";
import { GlossaryTip } from "../GlossaryTip";
import { InfoTip } from "../InfoTip";
import { pluriel } from "@/lib/format";
import { lireVital, texteVerdict } from "@/lib/vital-lecture";
import { ValeurNoteeMip } from "../NoteMip";
import { noteMip as noterMip } from "@/lib/seuils";
import { FicheMesure } from "./FicheMesure";
import { ApercuFond, GrapheMesure, JaugeSeuils } from "./GrapheMesure";

export type SensMeilleur = "bas" | "haut" | "neutre";

/** Sous ce nombre de mesures, « échantillon faible » (§ 3.12 : 100 pour un vital). */
export const FAIBLE_SOUS_DEFAUT = 100;

/** Espace insécable : « ≈ » ne se sépare jamais du chiffre en fin de ligne. */
const NBSP = String.fromCharCode(0xa0);

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

/**
 * Ce que la tuile dit de la comparaison : un delta chiffré, ou pourquoi il n'y en a
 * pas. `motif: "periode-incomplete"` marque le silence dû à une période précédente
 * incomplète : c'est la raison qu'une rangée dit UNE fois au-dessus de ses tuiles
 * (`RangeeKpi`), plutôt que chaque tuile la répète.
 */
export type Comparaison =
  | { kind: "delta"; pct: number; reference: string }
  | { kind: "silence"; texte: string; motif?: "periode-incomplete" }
  | null;

/**
 * La forme qui double la couleur du verdict (spec A2 § 3.4) : disque, triangle, carré.
 * En pseudo-élément CSS : le texte du badge reste le seul libellé (« Bon »), la forme
 * n'est ni lue ni recopiée. Classes écrites en toutes lettres (Tailwind ne détecte pas
 * les classes construites).
 */
const FORME_VERDICT: Record<keyof typeof RATING_LABEL, string> = {
  good: "before:mr-1 before:content-['●']",
  "needs-improvement": "before:mr-1 before:content-['▲']",
  poor: "before:mr-1 before:content-['■']",
};

/** Voyant du verdict établi d'une tuile épurée. */
const POINT_VERDICT: Record<keyof typeof RATING_LABEL, string> = {
  good: "bg-good",
  "needs-improvement": "bg-warn",
  poor: "bg-bad",
};

/**
 * Sépare le nombre de son unité (« 2,6 s » → « 2,6 » + « s ») pour les dessiner à
 * deux tailles. Pure, exportée pour les tests ; sans unité reconnue, tout reste nombre.
 */
export function separerUnite(texte: string): { nombre: string; unite: string | null } {
  const m = /^(.*\d)[\s\u00a0\u202f](pour[\s\u00a0\u202f]100|%|ms|s|min|h|j|Ko|Mo|Go)$/.exec(texte);
  // L'unité ressort avec une espace ordinaire : « pour 100 » se compare sans piège.
  return m ? { nombre: m[1], unite: m[2].replace(/[\u00a0\u202f]/g, " ") } : { nombre: texte, unite: null };
}

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
      motif: "periode-incomplete",
    };
  }
  // Un précédent non fini (un 0/0 calculé en amont) n'est pas une mesure : il se
  // tait comme null, sinon il s'afficherait « ↓ NaN % », coloré.
  if (precedent === null || !Number.isFinite(precedent)) {
    return { kind: "silence", texte: `pas de mesure sur ${referenceSansVs(reference)}` };
  }
  if (precedent === 0) return { kind: "silence", texte: TEXTE_REFERENCE_NULLE };
  if (sousLeSeuil(n, faibleSous) || sousLeSeuil(couverturePrecedente?.n, faibleSous)) {
    return { kind: "silence", texte: TEXTE_ECHANTILLON_DELTA };
  }
  return { kind: "delta", pct: ((valeur - precedent) / Math.abs(precedent)) * 100, reference };
}

/** Le texte d'un delta tel qu'un lecteur d'écran l'annonce : « +8 % vs 24 h précédentes ». */
function texteDelta(pct: number, reference: string): string {
  const arrondi = Math.round(pct);
  // Décidé sur l'écart AFFICHÉ : 1,5 % s'écrit « +2 % », il ne peut pas être « stable »
  // quand 2,0 % ne l'est pas.
  const stable = Math.abs(arrondi) < SEUIL_STABLE_PCT;
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
  titre,
  compact = false,
  children,
}: {
  href?: string;
  ariaLabel: string;
  alerte?: boolean;
  testId: string;
  /** Infobulle native d'une tuile-lien (sa méthode, qu'un bouton « ? » ne peut pas porter). */
  titre?: string;
  /** Tuile de rangée KPI (spec A2 § 3.1) : 12 px de marge, rayon 8 px, pas d'ombre la nuit. */
  compact?: boolean;
  children: ReactNode;
}) {
  // Compact : le même gabarit que la case épurée (30/09/2026), pour qu'une tuile texte
  // (`KpiLibelle`) et une case chiffrée s'alignent dans la même rangée.
  const classes = compact
    ? `relative flex h-full min-h-[6.5rem] min-w-0 flex-col justify-between gap-1 rounded-xl border bg-panel px-3.5 py-3 ${alerte ? "border-bad/50" : "border-line"}`
    : `card flex min-w-0 flex-col gap-1 p-4 ${alerte ? "border-bad/50" : ""}`;
  if (href) {
    return (
      <Link
        href={href}
        aria-label={ariaLabel}
        title={titre}
        data-testid={testId}
        data-ton={alerte ? "bad" : "neutre"}
        className={`${classes} transition hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf`}
      >
        {children}
      </Link>
    );
  }
  return (
    <div role="group" aria-label={ariaLabel} title={titre} data-testid={testId} data-ton={alerte ? "bad" : "neutre"} className={classes}>
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
  methode,
  alerte,
  intervalle,
  ecart,
  href,
  testid,
  approchee = false,
  compact = false,
  epure = true,
  source,
  categorie,
  libelleCase,
  grapheDebuts,
  titreAxeY,
  noteMip,
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
  /** Phrase sous la valeur : un sous-texte CHIFFRÉ court (« 42 sur 1 240 sessions »). */
  lecture?: string;
  /**
   * La méthode (définition, pondération, ce que le chiffre laisse de côté), rangée
   * DERRIÈRE l'aide « ? » à côté du libellé : la recette du 26/09/2026 a relevé des
   * tuiles de 6 à 18 lignes où le chiffre se perdait. Dans une tuile-lien, pas de
   * bouton (HTML invalide) : la méthode passe dans l'infobulle native du lien.
   */
  methode?: string;
  /** Ton bad SEULEMENT si la condition est vraie, avec la règle écrite. */
  alerte?: AlerteTuile;
  /**
   * Note par une RÈGLE MIP d'une grandeur liée à la tuile (amendement de R-S du
   * 29/09/2026) : pastille colorée + forme + règle écrite, sous la valeur. La valeur
   * notée peut différer de celle de la tuile (un compte de signaux est noté par la
   * PART de sessions touchées) : `texte` la dit, en toutes lettres.
   */
  noteMip?: { mesure: string; valeur: number | null; texte: string };
  /** Intervalle à 95 % (P*.1), ou pourquoi il n'est pas calculé. */
  intervalle?: IntervalleP75;
  /**
   * L'écart à `precedent` est-il établi (P*.1) ? Newcombe pour une proportion
   * (`ecartProportions`), intervalles comparés pour une p75 (`ecartP75`). Non
   * établi : le delta reste écrit, sans flèche ni couleur, avec sa règle.
   */
  ecart?: Ecart | null;
  /** La tuile entière est un lien. */
  href?: string;
  /**
   * Repère de test posé sur la VALEUR (ajout F20) : un écran qui remplace une
   * ancienne tuile par celle-ci garde l'adresse que ses e2e désignent, sans
   * l'attacher au cadre (dont le texte porte aussi le libellé et la lecture).
   */
  testid?: string;
  /**
   * Valeur lue sur une distribution par tranches, pas mesure par mesure : le chiffre
   * s'écrit « ≈ 93 ms », et le lecteur d'écran dit « environ ». Une mention sous la
   * valeur (« ≈ valeur approchée ») se lisait comme une ligne de plus, détachée du
   * chiffre qu'elle qualifie (recette du 26/09/2026).
   */
  approchee?: boolean;
  /**
   * Tuile de rangée KPI (spec A2 § 4, audit A1 « À garder ») : les MÊMES refus, dans
   * une tuile de ~112 px. Une seule ligne visible dit l'essentiel (raison du « — »,
   * delta, ou pourquoi il se tait) ; le reste (intervalle, verdict non établi,
   * effectif) passe dans l'infobulle de la tuile et reste lu par les lecteurs d'écran
   * — la tuile LCP empilait six lignes pour un chiffre (283 px).
   */
  compact?: boolean;
  /**
   * Case ÉPURÉE — LE MODE PAR DÉFAUT depuis le 30/09/2026, sur toute la console : le
   * libellé, la valeur et son unité, un voyant de verdict, la source en une étiquette,
   * l'aperçu de la courbe en fond — rien d'autre. Un clic ouvre la fenêtre de la mesure
   * (`FicheMesure`) : graphique grand format aux axes chiffrés, verdict, intervalle,
   * variation, effectif, note MIP, méthode, source. Les MÊMES refus que le mode
   * détaillé (`epure={false}`) : seule la mise en page change, et tout ce que la tuile
   * sait reste dans la page pour les lecteurs d'écran.
   */
  epure?: boolean;
  /** D'où vient la mesure (capteur, API du navigateur, table) : écrite dans la fiche. */
  source?: string;
  /** Étiquette courte de la source, en pied de case (« Navigateur · Core Web Vitals »). */
  categorie?: string;
  /** Libellé court de la case, quand `label` est trop long pour elle ; `label` reste lu. */
  libelleCase?: string;
  /** Début ISO de chaque point de `serie` : sans eux, pas de graphique grand format. */
  grapheDebuts?: string[];
  /** Titre de l'axe vertical du graphique grand format (grandeur et unité). */
  titreAxeY?: string;
}) {
  const connue = valeur != null && Number.isFinite(valeur);
  const faibleSous = couverture?.faibleSous ?? FAIBLE_SOUS_DEFAUT;
  const sens: SensMeilleur = sensMeilleur ?? (vital ? "bas" : "neutre");
  const brute = formater(format, connue ? valeur : null);
  // « — » n'est pas approché : un inconnu reste un inconnu.
  const approche = approchee && connue;
  const texteValeur = approche ? `≈${NBSP}${brute}` : brute;

  // Verdict (vital au p75 seulement) : la logique de VitalCard, partagée.
  const verdict =
    connue && vital ? lireVital(vital, valeur, couverture?.n ?? 0, intervalle).verdict : null;
  const intervalleCalcule = connue && intervalle && !("indisponible" in intervalle) ? intervalle : null;
  // Un vital sans intervalle calculable l'écrit AUSSI (critère de recette P*.1) :
  // le verdict « non établi » dit ce qui manque au verdict, cette ligne ce qui
  // manque à la valeur.
  const texteIntervalle = intervalleCalcule
    ? `entre ${formater(format, intervalleCalcule.bas)} et ${formater(format, intervalleCalcule.haut)} (95 %)`
    : connue && intervalle && "indisponible" in intervalle
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

  // Un delta que l'incertitude n'établit pas n'a ni flèche ni couleur : il est
  // écrit, suivi de la règle qui le laisse ouvert.
  const deltaNonEtabli = comparaison?.kind === "delta" && ecart != null && !ecart.etabli;
  const texteComparaison =
    comparaison?.kind === "delta"
      ? deltaNonEtabli
        ? `${texteDelta(comparaison.pct, comparaison.reference)} — ${ecart!.regle}`
        : texteDelta(comparaison.pct, comparaison.reference)
      : (comparaison?.texte ?? null);

  const enAlerte = connue && alerte != null && alerteVraie(valeur, alerte);
  const echantillonFaible = connue && sousLeSeuil(couverture?.n, faibleSous);
  const texteEffectif =
    couverture == null
      ? null
      : couverture.n == null
        ? `effectif inconnu (${couverture.unite})`
        : `${formater("count", couverture.n)} ${couverture.unite}`;

  const ariaLabel = [
    `${label} ${approche ? `environ ${brute}` : brute}`,
    !connue ? raisonNull : null,
    verdict ? texteVerdict(verdict) : null,
    texteIntervalle,
    texteComparaison,
    enAlerte ? `alerte : ${alerte?.regle}` : null,
    texteEffectif,
    echantillonFaible ? "échantillon faible" : null,
  ]
    .filter(Boolean)
    .join(", ");

  // Les lignes secondaires, avec leurs repères de test. En tuile compacte, elles
  // restent dans le document (lecteurs d'écran, e2e) mais hors de la vue : la tuile
  // n'en montre qu'une, la plus utile, et range le reste dans son infobulle.
  const secondaires = (
    <>
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
        // La bulle OUVRE la ligne (elle s'ouvre vers l'intérieur à 390 px) ; dans une
        // tuile-lien, pas de bulle : un bouton dans un lien est un HTML invalide. Pas
        // non plus dans la case épurée, qui EST un bouton : le parseur HTML fermerait
        // la case au bouton imbriqué, et l'hydratation casserait (relevé sur /pages).
        <p className="flex min-w-0 items-start gap-1 text-xs text-ink-soft" data-testid="kpi-intervalle">
          {!href && !compact && !epure && <GlossaryTip id="intervalle" />}
          <span className="min-w-0 break-words">{texteIntervalle}</span>
        </p>
      )}

      {deltaNonEtabli && (
        // `data-ecart` distingue un ÉCART écrit sans flèche (P*.1 : intervalles qui se
        // chevauchent) du SILENCE de la tuile (« période précédente incomplète »…) :
        // les deux sont un `<p>`, un seul est un écart, et les e2e les séparent.
        <p className="text-xs text-ink-soft" data-testid="kpi-comparaison" data-ecart="non-etabli">
          {texteComparaison}
        </p>
      )}
      {comparaison?.kind === "silence" && (
        <p className="text-xs text-ink-soft" data-testid="kpi-comparaison" data-ecart="silence" data-motif={comparaison.motif}>
          {comparaison.texte}
        </p>
      )}

      {enAlerte && (
        <p className="text-xs font-medium text-bad-ink" data-testid="kpi-alerte">
          {alerte?.regle}
        </p>
      )}

      {lecture && <p className="text-xs text-ink-soft">{lecture}</p>}

      {noteMip && (
        <p className="min-w-0 text-xs text-ink-soft" data-testid="kpi-note-mip">
          <ValeurNoteeMip mesure={noteMip.mesure} valeur={noteMip.valeur} texte={noteMip.texte} />
        </p>
      )}

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
    </>
  );

  // Tuile compacte : la ligne visible, dans l'ordre de ce qui compte le plus — pourquoi
  // il n'y a pas de chiffre, l'alerte, pourquoi le verdict ou le delta se taisent.
  const resume = !compact
    ? null
    : !connue
      ? (raisonNull ?? null)
      : enAlerte
        ? (alerte?.regle ?? null)
        : verdict && verdict.kind !== "etabli"
          ? texteVerdict(verdict)
          : deltaNonEtabli || comparaison?.kind === "silence"
            ? texteComparaison
            : null;
  const infobulle = compact
    ? [methode, !connue ? raisonNull : null, verdict ? texteVerdict(verdict) : null, texteIntervalle, texteComparaison, lecture, texteEffectif]
        .filter(Boolean)
        .join("\n")
    : href
      ? methode
      : undefined;
  const pied = compact ? [texteEffectif, echantillonFaible ? "échantillon faible" : null].filter(Boolean).join(" · ") : null;

  if (epure) {
    // « pour 100 » est un pourcentage : « 0 % » (recette du 30/09/2026). Le ratio peut
    // dépasser 100 % (plusieurs erreurs sur une page) ; c'est écrit dans la méthode.
    const brut = separerUnite(texteValeur);
    const { nombre, unite } = brut.unite === "pour 100" ? { nombre: brut.nombre, unite: "%" } : brut;
    const valeurAffichee = unite ? `${nombre} ${unite}` : nombre;
    const lignes: [string, string][] = [
      ["Verdict", verdict ? texteVerdict(verdict) : ""],
      ["Intervalle", texteIntervalle ?? ""],
      ["Variation", texteComparaison ?? ""],
      ["Alerte", enAlerte ? (alerte?.regle ?? "") : ""],
      ["Lecture", [!connue ? raisonNull : null, lecture].filter(Boolean).join(" · ")],
      ["Effectif", [texteEffectif, echantillonFaible ? "échantillon faible" : null].filter(Boolean).join(" · ")],
      ["Méthode", methode ?? ""],
      ["Source", source ?? ""],
    ].filter((l): l is [string, string] => l[1] !== "");
    // Le voyant : le verdict d'un Web Vital au p75, sinon la note d'une règle MIP (la
    // part des sessions touchées, par exemple), sinon l'alerte. Rien d'autre ne colore.
    const noteRegle = noteMip ? noterMip(noteMip.mesure, noteMip.valeur) : null;
    const couleurPoint =
      verdict?.kind === "etabli"
        ? POINT_VERDICT[verdict.rating]
        : noteRegle
          ? POINT_VERDICT[noteRegle]
          : enAlerte
            ? "bg-bad"
            : null;
    return (
      <FicheMesure
        titre={label}
        ariaLabel={ariaLabel}
        alerte={enAlerte}
        fond={serie ? <ApercuFond valeurs={serie} /> : undefined}
        case={
          <>
            <span className="flex min-w-0 items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[11px] font-medium text-ink-soft">{libelleCase ?? label}</span>
              {couleurPoint && <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${couleurPoint}`} />}
            </span>
            {/* Le repère de test porte le NOMBRE en texte direct (les e2e et les tests
                lisent « 2 », « — »), l'unité suit en plus petit après une espace insécable. */}
            <span
              className={`whitespace-nowrap text-[26px] font-semibold leading-8 tabular-nums tracking-tight ${enAlerte ? "text-bad-ink" : echantillonFaible ? "text-ink-soft" : "text-ink"}`}
              data-testid={testid ?? "kpi-valeur"}
            >
              {nombre}
              {unite && (
                <>
                  {NBSP}
                  <span className="text-sm font-medium text-ink-soft">{unite}</span>
                </>
              )}
            </span>
            {/* Tout ce que la tuile sait, juste après la valeur : lu dans l'ordre par un
                lecteur d'écran (« Sessions touchées — Inconnu : … »), hors de la vue. */}
            <span className="sr-only">
              {secondaires}
              {verdict?.kind === "etabli" && <span data-testid="kpi-verdict">{RATING_LABEL[verdict.rating]}</span>}
              {comparaison?.kind === "delta" && !deltaNonEtabli && <span>{texteComparaison}</span>}
            </span>
            {categorie && <span className="truncate text-[10px] text-ink-faint">{categorie}</span>}
          </>
        }
      >
        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="flex items-baseline gap-1 tabular-nums tracking-tight">
            <span className="text-4xl font-semibold">{nombre}</span>
            {unite && <span className="text-lg font-medium text-ink-soft">{unite}</span>}
          </span>
          {verdict?.kind === "etabli" && (
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${RATING_CLASS[verdict.rating]} ${FORME_VERDICT[verdict.rating]}`}>
              {RATING_LABEL[verdict.rating]}
            </span>
          )}
          {comparaison?.kind === "delta" && !deltaNonEtabli && (
            <DeltaBadge pct={comparaison.pct} reference={comparaison.reference} sensMeilleur={sens} />
          )}
        </div>
        {vital && connue && (
          <div className="mt-4">
            <JaugeSeuils
              seuils={THRESHOLDS[vital]}
              valeur={valeur}
              format={format}
              intervalle={intervalleCalcule}
              effectif={texteEffectif}
            />
          </div>
        )}
        {serie && serie.length > 1 && (
          <div className="mt-4">
            <GrapheMesure
              valeurs={serie}
              debuts={grapheDebuts}
              format={format}
              titreY={titreAxeY ?? label}
              seuils={vital ? THRESHOLDS[vital] : undefined}
            />
          </div>
        )}
        <dl className="mt-4 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 border-t border-line pt-3 text-xs leading-snug">
          {lignes.map(([cle, texte]) => (
            <div key={cle} className="contents">
              <dt className="text-ink-faint">{cle}</dt>
              <dd
                className="min-w-0 whitespace-pre-line text-ink-soft [overflow-wrap:anywhere]"
                data-testid={cle === "Méthode" ? "kpi-methode" : undefined}
              >
                {texte}
              </dd>
            </div>
          ))}
          {noteMip && (
            <div className="contents">
              <dt className="text-ink-faint">Règle MIP</dt>
              <dd className="min-w-0 text-ink-soft [overflow-wrap:anywhere]">
                <ValeurNoteeMip mesure={noteMip.mesure} valeur={noteMip.valeur} texte={noteMip.texte} />
              </dd>
            </div>
          )}
        </dl>
        {href && (
          <Link href={href} className="mt-4 inline-flex text-sm font-medium text-perf underline-offset-2 hover:underline">
            Écran détaillé →
          </Link>
        )}
        {/* La valeur telle qu'affichée, pour la cohérence case ↔ fenêtre. */}
        <span className="sr-only">{valeurAffichee}</span>
      </FicheMesure>
    );
  }

  return (
    <CadreTuile href={href} ariaLabel={ariaLabel} alerte={enAlerte} testId="kpi-tile" titre={infobulle} compact={compact}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-2 gap-y-1">
        {/* Libellé de tuile : 12 px, casse de phrase (spec A2 § 3.9) — les capitales
            espacées de 11 px sont le style des en-têtes de tableau. */}
        <span className="flex min-w-0 items-start gap-1 text-xs font-medium text-ink-soft [overflow-wrap:anywhere]">
          <span className="min-w-0">{label}</span>
          {methode && !href && (
            <InfoTip label={`Méthode : ${label}`} align="start" className="shrink-0">
              <span data-testid="kpi-methode">{methode}</span>
            </InfoTip>
          )}
        </span>
        {verdict?.kind === "etabli" && (
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${RATING_CLASS[verdict.rating]} ${FORME_VERDICT[verdict.rating]}`}
            data-testid="kpi-verdict"
          >
            {RATING_LABEL[verdict.rating]}
          </span>
        )}
      </div>

      {/* Valeur KPI : 28 / 32 px, chiffres tabulaires (§ 3.9). Sur un échantillon faible,
          en `ink-soft` : le chiffre existe, il ne s'affirme pas (§ 4.3). */}
      <span
        className={`text-[28px] font-semibold leading-8 tabular-nums tracking-tight [overflow-wrap:anywhere] ${
          enAlerte ? "text-bad-ink" : echantillonFaible && compact ? "text-ink-soft" : "text-ink"
        }`}
        data-testid={testid ?? "kpi-valeur"}
      >
        {texteValeur}
      </span>

      {comparaison?.kind === "delta" && !deltaNonEtabli && (
        <DeltaBadge pct={comparaison.pct} reference={comparaison.reference} sensMeilleur={sens} />
      )}

      {compact ? (
        <>
          {resume && (
            <p aria-hidden="true" className={`line-clamp-2 text-xs [overflow-wrap:anywhere] ${enAlerte ? "font-medium text-bad-ink" : "text-ink-soft"}`}>
              {resume}
            </p>
          )}
          <div className="sr-only">{secondaires}</div>
        </>
      ) : (
        secondaires
      )}

      {serie && serie.length > 0 && (
        <div className="mt-1">
          <Sparkline
            valeurs={serie}
            label={`${label}, évolution sur ${pluriel(serie.length, "période")}`}
            seuils={vital ? THRESHOLDS[vital] : undefined}
          />
        </div>
      )}

      {pied && (
        // Pied de tuile, 11 px (§ 3.9) : l'effectif, et s'il est faible.
        <p aria-hidden="true" className="mt-auto truncate pt-0.5 text-[11px] text-ink-faint">
          {pied}
        </p>
      )}
    </CadreTuile>
  );
}
