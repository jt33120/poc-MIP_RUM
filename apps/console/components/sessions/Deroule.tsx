// Déroulé d'une session, GROUPÉ PAR VUE (F45, plan § 5.12.4) — composant serveur,
// sans état, sans fonction en prop : tous les href sont pré-calculés par la page.
//
// CE QUE LE GROUPEMENT CHANGE À L'ÉCRAN, par rapport à la liste plate de F44 :
//   · une page vue devient un TITRE de section (route, type de navigation,
//     décalage), pas une ligne noyée entre deux erreurs ;
//   · ses Web Vitals sont des PASTILLES sur ce titre, avec leur verdict lu dans
//     `lib/rating.ts` — plus une ligne « Vital LCP » de plus ;
//   · les phases réseau (DNS, TCP, TLS, RTT…) sont REPLIÉES en « Phases réseau
//     (8) ». Elles n'ont pas de seuil publié : les étiqueter « Vital » disait
//     qu'un RTT peut être bon ou mauvais dans l'absolu, ce qui est faux (§ 5.12.6) ;
//   · les effets d'une action sont IMBRIQUÉS sous elle : la causalité se lit à
//     l'indentation, plus au badge « ↳ » qu'il fallait relier de l'œil.
//
// CE QU'IL NE MONTRE PAS, ET LE DIT. Les ancres restent celles de la chronologie
// LUE (`ancreEvenement(rang)`, P*.9) : le récit « En bref » et les liens « Voir
// au rejeu » des onglets pointent des rangs, et le groupement ne les déplace pas.
// Une chronologie tronquée à 500 lignes le déclare (`tronque`), et un filtre
// `voir=` qui ne laisse rien le dit aussi, plutôt que de rendre une liste vide.
//
// F47 — `instants` (optionnel, pré-calculé par la page quand un rejeu existe) : le
// décalage de chaque ligne et de chaque vue devient un lien `?at=` qui place le
// lecteur ; l'îlot `ReplaySynchro` le fait sans recharger et surligne la ligne
// courante (`data-ligne`, `aria-current="time"`). Écart au § 4.3 : une prop de plus.
import Link from "next/link";
import { Fragment } from "react";
import { EtatSurface } from "@/components/states/EtatSurface";
import { Decalage, LIGNE_COURANTE, TimelineRow, fmtOffset } from "@/components/sessions/Timeline";
import { elementsDuGroupe, filtrerParNature, grouperParVue } from "@/lib/deroule";
import { fmtVital } from "@/lib/format";
import type { TimelineItem } from "@/lib/queries";
import { RATING_CLASS, type Rating, rating2026 } from "@/lib/rating";
import { LIMITE_CHRONOLOGIE, ancreEvenement } from "@/lib/recit-session";
import { KIND_STYLE } from "@/lib/timeline-constants";
import type { NatureChronologie } from "@/lib/view-state";

export function Deroule({
  items,
  t0,
  voir,
  liens,
  tronque,
  instants,
}: {
  items: TimelineItem[];
  /** Début de la session (epoch ms) : origine des décalages affichés. */
  t0: number;
  /** Natures affichées ; `null` = toutes (§ 3.1, `NATURES_CHRONOLOGIE`). */
  voir: NatureChronologie[] | null;
  /** Rang de la ligne dans la chronologie LUE → href de sa question suivante. */
  liens: Record<number, string>;
  tronque: boolean;
  /** Rang → lien d'instant du rejeu (`?at=`) ; absent sans rejeu (F47). */
  instants?: Record<number, string>;
}) {
  // Rang d'origine : l'ancre d'une ligne ne dépend ni du groupe ni du filtre.
  const rangs = new Map<TimelineItem, number>();
  items.forEach((it, i) => rangs.set(it, i));
  const rang = (it: TimelineItem) => rangs.get(it) ?? -1;
  const ancre = (it: TimelineItem) => ancreEvenement(rang(it));
  const lienDe = (it: TimelineItem): { href: string; libelle: string } | null => {
    const href = liens[rang(it)];
    return href ? { href, libelle: LIBELLE_LIEN[it.kind] ?? "Voir" } : null;
  };
  const instantDe = (it: TimelineItem) => instants?.[rang(it)] ?? null;

  const visibles = filtrerParNature(items, voir);
  const groupes = grouperParVue(visibles);

  return (
    <>
      {tronque && (
        <div className="mb-4">
          <EtatSurface compact etat={{ kind: "partiel", raison: `chronologie tronquée à ${LIMITE_CHRONOLOGIE} événements` }} />
        </div>
      )}
      {visibles.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-soft" data-testid="deroule-vide">
          {items.length === 0
            ? "Aucun événement enregistré pour cette session"
            : "Aucun événement de cette nature dans cette session"}
        </p>
      ) : (
        <ol className="min-w-0 space-y-5" data-testid="timeline">
          {groupes.map((g, gi) => (
            // L'ANCRE D'UNE VUE EST PORTÉE PAR LE `li` : le récit « En bref »
            // (P*.9) vérifie que chaque lien désigne un `li#evt-N` de la
            // chronologie. Le groupement déplace le rendu, jamais les ancres.
            <li
              key={gi}
              id={g.vue ? ancreEvenement(rang(g.vue)) : undefined}
              className="min-w-0 scroll-mt-24 rounded target:bg-brand/10"
              data-testid="groupe-vue"
            >
              {g.vue ? (
                <EnteteVue
                  vue={g.vue}
                  vitals={g.vitals}
                  t0={t0}
                  ancre={ancre}
                  lien={lienDe(g.vue)}
                  instant={instantDe(g.vue)}
                />
              ) : (
                // Vitals rapportés sans vue connue : ils restent visibles, sans
                // titre à porter — jamais escamotés parce qu'on n'a pas de vue.
                g.vitals.length > 0 && <PastillesVitals vitals={g.vitals} ancre={ancre} />
              )}
              {g.phases.length > 0 && <PhasesReseau phases={g.phases} ancre={ancre} />}
              {(g.actions.length > 0 || g.autres.length > 0) && (
                <ol className="relative ml-2 mt-3 border-l-2 border-line">
                  {elementsDuGroupe(g).map((e, ei) =>
                    e.type === "ligne" ? (
                      <TimelineRow
                        key={ei}
                        id={ancreEvenement(rang(e.item))}
                        item={e.item}
                        t0={t0}
                        lien={lienDe(e.item)}
                        instant={instantDe(e.item)}
                      />
                    ) : (
                      <Fragment key={ei}>
                        <TimelineRow
                          id={ancreEvenement(rang(e.entree.action))}
                          item={e.entree.action}
                          t0={t0}
                          instant={instantDe(e.entree.action)}
                        />
                        {e.entree.effets.length > 0 && (
                          <li className="mb-4 ml-6 min-w-0" data-testid="effets-action">
                            <p className="mb-1 text-[11px] uppercase tracking-wider text-ink-faint">
                              Déclenché par cette action
                            </p>
                            <ol className="relative ml-2 border-l-2 border-line/60">
                              {e.entree.effets.map((effet, fi) => (
                                <TimelineRow
                                  key={fi}
                                  id={ancreEvenement(rang(effet))}
                                  item={effet}
                                  t0={t0}
                                  lien={lienDe(effet)}
                                  instant={instantDe(effet)}
                                  imbrique
                                />
                              ))}
                            </ol>
                          </li>
                        )}
                      </Fragment>
                    ),
                  )}
                </ol>
              )}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

/** Libellé de la question suivante, par nature de ligne. */
const LIBELLE_LIEN: Partial<Record<TimelineItem["kind"], string>> = {
  pageview: "Cette page pour tous",
  error: "Voir l'erreur groupée",
  api: "Voir la trace",
};

/**
 * Titre d'une section : la page vue, son type de navigation, son décalage, et
 * ses Web Vitals en pastilles (verdict lu dans `lib/rating.ts`, P2 / V8).
 */
function EnteteVue({
  vue,
  vitals,
  t0,
  ancre,
  lien,
  instant,
}: {
  vue: TimelineItem;
  vitals: TimelineItem[];
  t0: number;
  /** Ancre d'une ligne LUE : les pastilles en portent une, le récit y mène. */
  ancre: (item: TimelineItem) => string;
  lien: { href: string; libelle: string } | null;
  /** Lien d'instant du rejeu (F47) ; `null` sans rejeu. */
  instant: string | null;
}) {
  return (
    <div
      // L'ancre `evt-N` reste sur le `li` du groupe (récit P*.9) ; la LIGNE que la tête
      // de lecture désigne est ce titre, pas toute la section.
      data-ligne={ancre(vue)}
      className={`flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 rounded-t border-b border-line pb-2 ${LIGNE_COURANTE}`}
      data-testid="entete-vue"
    >
      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${KIND_STYLE.pageview.badge}`}>
        {KIND_STYLE.pageview.label}
      </span>
      {/* `truncate` ne coupe qu'un bloc : la route est un `block` dans un conteneur `min-w-0`. */}
      <h3 className="min-w-0 max-w-full basis-full font-mono text-sm font-semibold sm:basis-auto">
        {lien ? (
          <Link
            href={lien.href}
            className="block truncate rounded text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
            title={vue.title ?? undefined}
          >
            {vue.title ?? "Route inconnue"}
          </Link>
        ) : (
          <span className="block truncate" title={vue.title ?? undefined}>
            {vue.title ?? "Route inconnue"}
          </span>
        )}
      </h3>
      {vue.detail && <span className="text-xs text-ink-faint">{vue.detail}</span>}
      <Decalage
        texte={fmtOffset(Math.max(0, new Date(vue.ts).getTime() - t0))}
        ts={vue.ts}
        instant={instant}
        className="font-mono text-xs tabular-nums text-ink-faint"
      />
      {vitals.length > 0 && <PastillesVitals vitals={vitals} ancre={ancre} />}
    </div>
  );
}

/**
 * Web Vitals d'une vue : une pastille par mesure, verdict lu dans `lib/rating.ts`
 * (V8). Ce sont des `li` PARCE QUE les liens du récit (P*.9) désignent des lignes
 * de la chronologie : une mesure citée doit rester une ancre atteignable.
 */
function PastillesVitals({ vitals, ancre }: { vitals: TimelineItem[]; ancre: (item: TimelineItem) => string }) {
  return (
    <ul className="flex min-w-0 flex-wrap items-baseline gap-1.5">
      {vitals.map((v, i) => {
        const valeur = v.value == null ? null : Number(v.value);
        const verdict: Rating | null = valeur == null || v.title == null ? null : rating2026(v.title, valeur);
        return (
          <li
            key={i}
            id={ancre(v)}
            className={`scroll-mt-24 rounded border px-1.5 py-0.5 text-xs font-medium tabular-nums target:ring-2 target:ring-brand ${verdict ? RATING_CLASS[verdict] : "border-line text-ink-soft"}`}
            data-testid="pastille-vital"
          >
            {v.title} {fmtVital(v.title ?? "", valeur)}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Phases réseau d'une vue, repliées. Elles n'ont pas de seuil publié (elles ne
 * sont pas dans `CORE_VITALS`) : aucune couleur de verdict, aucune étiquette
 * « Vital » — seulement leur nom et leur durée.
 */
function PhasesReseau({ phases, ancre }: { phases: TimelineItem[]; ancre: (item: TimelineItem) => string }) {
  return (
    <details className="mt-2" data-testid="phases-reseau">
      <summary className="cursor-pointer rounded text-xs text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf">
        Phases réseau ({phases.length})
      </summary>
      <p className="mt-1 text-[11px] text-ink-faint">
        Étapes de la navigation (DNS, connexion, TLS, requête, réponse) : aucun seuil publié, donc aucun verdict.
      </p>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {phases.map((p, i) => (
          <li key={i} id={ancre(p)} className="chip-mono scroll-mt-24">
            {p.title} {p.value == null ? "—" : `${Math.round(Number(p.value))} ms`}
          </li>
        ))}
      </ul>
    </details>
  );
}
