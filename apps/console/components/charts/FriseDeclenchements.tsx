// Frise des déclenchements d'alerte, une piste par source (F56, plan § 4.3 et § 5.19
// A5) — rendu serveur, SVG déterministe, aucun JavaScript client.
//
// CHAQUE ÉVÉNEMENT RESTE DISTINCT (« status history » de Grafana). Ce n'est PAS une
// « state timeline » : il faudrait l'historique des évaluations (B51), que la base ne
// garde pas. Un marqueur = un `alert_event`, posé à son `fired_at`.
//
// RIEN N'EST PORTÉ PAR LA SEULE COULEUR (§ 3.9) :
//   - la FORME dit la livraison : rond plein = livré, rond creux = non livré,
//     losange = en attente ;
//   - le CONTOUR dit l'acquittement : épais = non acquitté ;
//   - la couleur ET la taille disent la sévérité (`SEVERITE` de lib/palette.ts :
//     critique > avertissement > information) ;
//   - et chaque marqueur a son libellé complet (lien, `aria-label`, infobulle).
//
// ALIGNEMENT. La piste occupe la même zone de tracé que les barres par jour
// au-dessus (`StackedBars`) : marges `SERIE_MARGES`, abscisse en temps sur
// [debut, fin]. Le libellé de la piste est donc AU-DESSUS d'elle (pas dans la marge
// gauche de 56 px, où il ne tiendrait pas), à toutes les largeurs.
//
// AU PLUS `maxPistes` PISTES VISIBLES (P14) ; les autres derrière « Voir les N
// autres sources ». Les pistes SLO sont groupées sous l'intertitre `id="pistes-slo"`
// (cible de /slo), chaque piste SLO porte `id="slo-<cle>"`.
import Link from "next/link";
import { TableAlternative } from "./Figure";
import { EtatSurface } from "../states/EtatSurface";
import { SEVERITE } from "@/lib/palette";
import { SERIE_MARGES } from "@/lib/series";

export type Severite = "info" | "warning" | "critical";

export interface MarqueurDeclenchement {
  /** fired_at, ISO UTC. */
  t: string;
  severite: Severite;
  livre: boolean;
  enAttente: boolean;
  acquitte: boolean;
  /** /alerts?evt=<id>#evt-<id>. */
  href: string;
}

export interface PisteDeclenchements {
  cle: string;
  libelle: string;
  /** Règle (A7), SLO ou issue. */
  href: string;
  groupe: "regle" | "slo" | "issue";
  etatActuel: { libelle: string; ton: "good" | "bad" | "neutre"; raison?: string } | null;
  marqueurs: MarqueurDeclenchement[];
}

export interface FriseDeclenchementsProps {
  /** ISO UTC, 30 jours. */
  debut: string;
  fin: string;
  pistes: PisteDeclenchements[];
  /** Défaut 12 (P14). */
  maxPistes?: number;
  /** Raison si le plafond de lecture est atteint. */
  tronque?: string;
}

const GROUPES: { cle: PisteDeclenchements["groupe"]; titre: string }[] = [
  { cle: "regle", titre: "Règles" },
  { cle: "slo", titre: "SLO" },
  { cle: "issue", titre: "Issues sans règle" },
];

/** Classe de texte (donc de `currentColor`) de chaque jeton de sévérité. */
const TEINTE: Record<(typeof SEVERITE)[Severite]["jeton"], string> = {
  bad: "text-bad",
  warn: "text-warn",
  "ink-soft": "text-ink-soft",
};

/** Rayon selon la sévérité : second canal, pour qui ne distingue pas les teintes. */
const RAYON: Record<Severite, number> = { critical: 5.5, warning: 4.5, info: 3.5 };

const TON_ETAT: Record<"good" | "bad" | "neutre", string> = {
  good: "border-good/30 bg-good/10 text-good-ink",
  bad: "border-bad/30 bg-bad/10 text-bad-ink",
  neutre: "border-line bg-panel2 text-ink-soft",
};

const HAUTEUR_PISTE = 18;

const HEURE_UTC = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const JOUR_UTC = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "2-digit", month: "2-digit" });

/** « 12/09 14:03 UTC ». */
export function instantUtc(t: string): string {
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? `${HEURE_UTC.format(ms)} UTC` : t;
}

/** La livraison en toutes lettres, dans l'ordre où elle se décide. */
export function livraison(m: Pick<MarqueurDeclenchement, "livre" | "enAttente">): "livré" | "en attente" | "non livré" {
  if (m.livre) return "livré";
  return m.enAttente ? "en attente" : "non livré";
}

/** Tout ce que dit un marqueur, en une phrase. */
export function texteMarqueur(m: MarqueurDeclenchement): string {
  return `Déclenchement du ${instantUtc(m.t)} : ${SEVERITE[m.severite].libelle}, ${livraison(m)}, ${m.acquitte ? "acquitté" : "non acquitté"}`;
}

/** L'alternative textuelle : une ligne par source, compte et dernier déclenchement. */
export function alternativeDeclenchements(pistes: PisteDeclenchements[]) {
  return {
    legende: "Déclenchements par source, sur la période de la frise.",
    colonnes: ["Source", "Déclenchements", "Non livrés", "Non acquittés", "Dernier", "État actuel"],
    lignes: pistes.map((p) => {
      const dernier = p.marqueurs.reduce<string | null>((d, m) => (d == null || Date.parse(m.t) > Date.parse(d) ? m.t : d), null);
      return [
        p.libelle,
        p.marqueurs.length,
        p.marqueurs.filter((m) => livraison(m) === "non livré").length,
        p.marqueurs.filter((m) => !m.acquitte).length,
        dernier ? instantUtc(dernier) : "aucun",
        p.etatActuel ? p.etatActuel.libelle : "—",
      ];
    }),
  };
}

/** Le dessin d'un marqueur, centré sur (0, 0). */
function Forme({ m }: { m: MarqueurDeclenchement }) {
  const r = RAYON[m.severite];
  const trait = m.acquitte ? 1 : 2.5;
  const forme = livraison(m);
  if (forme === "en attente") {
    const d = r + 1;
    return (
      <path
        d={`M0 ${-d} L${d} 0 L0 ${d} L${-d} 0 Z`}
        fill="currentColor"
        fillOpacity={0.35}
        stroke="currentColor"
        strokeWidth={trait}
        data-forme="losange"
      />
    );
  }
  return (
    <circle
      r={r}
      fill={forme === "livré" ? "currentColor" : "rgb(var(--c-panel))"}
      stroke="currentColor"
      strokeWidth={trait}
      data-forme={forme === "livré" ? "plein" : "creux"}
    />
  );
}

export function FriseDeclenchements({ debut, fin, pistes, maxPistes = 12, tronque }: FriseDeclenchementsProps) {
  const t0 = Date.parse(debut);
  const t1 = Date.parse(fin);
  const duree = Math.max(t1 - t0, 1);
  /** Position en % de la zone de tracé ; hors de [debut, fin] → null (jamais posé au bord). */
  const x = (t: string): number | null => {
    const ms = Date.parse(t);
    if (!Number.isFinite(ms) || ms < t0 || ms > t1) return null;
    return ((ms - t0) / duree) * 100;
  };

  if (pistes.length === 0) {
    return <EtatSurface etat={{ kind: "vide", population: "source de déclenchement", plage: "la période" }} />;
  }

  // Ordre stable : règles, SLO, issues ; l'ordre de l'appelant dans chaque groupe.
  const ordonnees = GROUPES.flatMap((g) => pistes.filter((p) => p.groupe === g.cle));
  const visibles = ordonnees.slice(0, maxPistes);
  const cachees = ordonnees.slice(maxPistes);
  const marges = { paddingLeft: SERIE_MARGES.gauche, paddingRight: SERIE_MARGES.droite };

  const piste = (p: PisteDeclenchements) => {
    const places = p.marqueurs
      .map((m) => ({ m, px: x(m.t) }))
      .filter((v): v is { m: MarqueurDeclenchement; px: number } => v.px != null)
      // Les critiques en dernier : dessinées par-dessus les autres.
      .sort((a, b) => RAYON[a.m.severite] - RAYON[b.m.severite]);
    return (
      <li key={p.cle} id={p.groupe === "slo" ? `slo-${p.cle}` : undefined} className="min-w-0" data-testid="piste-declenchements">
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 text-xs">
          <Link href={p.href} className="block min-w-0 truncate font-medium text-ink hover:underline" title={p.libelle}>
            {p.libelle}
          </Link>
          <span className="flex shrink-0 items-baseline gap-1.5">
            <span className="tabular-nums text-ink-soft">{p.marqueurs.length.toLocaleString("fr-FR")} décl.</span>
            {p.etatActuel && (
              <span
                className={`rounded border px-1 text-[10px] font-medium ${TON_ETAT[p.etatActuel.ton]}`}
                title={p.etatActuel.raison}
                data-testid="etat-actuel"
              >
                {p.etatActuel.libelle}
              </span>
            )}
          </span>
        </div>
        {p.etatActuel?.raison && <p className="min-w-0 break-words text-[10px] text-ink-soft">{p.etatActuel.raison}</p>}
        <div style={marges} className="min-w-0">
          <svg
            width="100%"
            height={HAUTEUR_PISTE}
            className="block overflow-visible"
            role="group"
            aria-label={`${p.libelle} : ${p.marqueurs.length} déclenchement(s)`}
          >
            <line x1="0" x2="100%" y1={HAUTEUR_PISTE / 2} y2={HAUTEUR_PISTE / 2} stroke="currentColor" strokeWidth={1} className="text-line" />
            {places.length === 0 && (
              <text x="50%" y={HAUTEUR_PISTE / 2 - 3} fontSize={9} textAnchor="middle" fill="currentColor" className="text-ink-faint">
                aucun déclenchement sur la période
              </text>
            )}
            {places.map(({ m, px }, i) => (
              // Un SVG imbriqué posé en % : la forme se dessine en pixels autour de son centre.
              <svg key={`${m.t}-${i}`} x={`${px}%`} y={HAUTEUR_PISTE / 2} overflow="visible" className={TEINTE[SEVERITE[m.severite].jeton]}>
                <a href={m.href} aria-label={texteMarqueur(m)} data-marqueur={livraison(m)} data-severite={m.severite}>
                  <title>{texteMarqueur(m)}</title>
                  <Forme m={m} />
                </a>
              </svg>
            ))}
          </svg>
        </div>
      </li>
    );
  };

  const groupes = (liste: PisteDeclenchements[], avecAncres: boolean) =>
    GROUPES.map((g) => {
      const dans = liste.filter((p) => p.groupe === g.cle);
      if (dans.length === 0) return null;
      return (
        <div key={g.cle} className="min-w-0">
          <h3
            id={avecAncres && g.cle === "slo" ? "pistes-slo" : undefined}
            className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wider text-ink-soft"
          >
            {g.titre}
          </h3>
          <ul className="flex min-w-0 flex-col gap-2">{dans.map(piste)}</ul>
        </div>
      );
    });

  // L'intertitre SLO ancré est celui du premier bloc qui en contient.
  const sloVisible = visibles.some((p) => p.groupe === "slo");
  const jours = [0, 0.5, 1].map((f) => t0 + f * duree);

  return (
    <div className="min-w-0" data-testid="frise-declenchements">
      {tronque && (
        <div className="mb-2">
          <EtatSurface etat={{ kind: "partiel", raison: tronque }} compact />
        </div>
      )}
      {groupes(visibles, true)}
      {cachees.length > 0 && (
        <details className="mt-3" data-testid="pistes-cachees">
          <summary className="cursor-pointer select-none text-xs font-medium text-ink-soft hover:text-ink">
            Voir les {cachees.length} autres sources
          </summary>
          {groupes(cachees, !sloVisible)}
        </details>
      )}

      {/* Axe commun, dans la même zone de tracé que les pistes. */}
      <div style={marges} className="mt-2 min-w-0" aria-hidden="true">
        <div className="relative h-4 border-t border-line text-[10px] tabular-nums text-ink-soft">
          <span className="absolute left-0 top-0.5">{JOUR_UTC.format(jours[0])}</span>
          <span className="absolute left-1/2 top-0.5 -translate-x-1/2">{JOUR_UTC.format(jours[1])}</span>
          <span className="absolute right-0 top-0.5">{JOUR_UTC.format(jours[2])} UTC</span>
        </div>
      </div>

      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-soft" data-testid="frise-legende">
        <span>● livré</span>
        <span>○ non livré</span>
        <span>◆ en attente</span>
        <span>contour épais : non acquitté</span>
        <span>
          taille et couleur : {SEVERITE.critical.libelle} &gt; {SEVERITE.warning.libelle} &gt; {SEVERITE.info.libelle}
        </span>
      </p>

      <TableAlternative alternative={alternativeDeclenchements(ordonnees)} />
    </div>
  );
}
