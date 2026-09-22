// Cascade — axe horizontal partagé pour une trace, une vue ou une session (F07,
// plan § 4.2 ; référence : la « waterfall » Datadog). Rendu serveur, zéro JS.
//
// CE QUE LA CASCADE MONTRE. Où est passé le temps : chaque élément est placé à son
// début RÉEL sur un axe commun et s'étend sur sa durée ; un élément sans durée est un
// instant (losange). Les repères (FCP, LCP…) sont des verticales qui traversent tout
// le dessin, avec leur verdict écrit quand un seuil nommé existe (`lib/rating.ts`).
//
// DEUX LECTURES, COMME DATADOG. En tête, un aperçu PAR PISTE (« Navigateur »,
// « Serveur », « Ressources », « Tâches longues »…) : une ligne par piste, tous ses
// éléments dessus — on voit d'un coup d'œil quelle piste occupe l'axe. Dessous, une
// ligne par élément, dans l'ordre chronologique ; un enfant suit son parent, indenté
// (`parentId`). En hauteur « réduite » (dans un panneau), seul l'aperçu est rendu :
// le panneau liste ses événements à part et renvoie à la page pour le détail.
//
// LA COULEUR PORTE LA SÉVÉRITÉ, PAS LE STATUT (P15). Gris = rien à signaler ; vert,
// ambre, rouge = verdict ; « erreur » = rouge HACHURÉ, pour ne pas se confondre avec
// « mauvais ». Et jamais la couleur seule (§ 3.9) : la sévérité est aussi écrite sous
// le libellé, et dans l'alternative. La piste est écrite sous le libellé à toutes les
// largeurs — à 390 px il n'y a pas la place d'une colonne de plus, et la cascade doit
// rester horizontale.
//
// `partiel` EN TÊTE. La collecte de ressources est volontairement partielle (300 ms,
// 20 par vue) : le dire AVANT le dessin, sinon une cascade incomplète se lit comme
// complète (contre-exemple : le « 32 out of 32 » de Datadog, qui n'a rien à avouer).
//
// L'alternative textuelle est intégrée (même motif que `RankBar`) : libellé, piste,
// début, durée, sévérité — les mêmes lignes que le dessin, dans le même ordre, repères
// compris.
import Link from "next/link";
import type { CSSProperties } from "react";
import { EtatSurface } from "../states/EtatSurface";
import { TableAlternative } from "./Figure";
import { formatDuVital, formater, type VitalName } from "@/lib/fmt-ids";
import { RATING_BAR, RATING_LABEL, rating2026, type Rating } from "@/lib/rating";

/** Sévérité d'un élément — jamais un statut (un 404 attendu n'est pas « rouge » par nature). */
export type TonCascade = "neutre" | "good" | "warn" | "poor" | "erreur";

export interface PisteCascade {
  cle: string;
  libelle: string;
}

export interface ElementCascade {
  id: string;
  piste: string;
  libelle: string;
  /** Début relatif à l'origine de l'axe, en ms. */
  debutMs: number;
  /** `null` = instantané (marqueur), pas « inconnu ». */
  dureeMs: number | null;
  ton: TonCascade;
  parentId?: string | null;
  href?: string;
  /** Précision courte, écrite sous le libellé (« HTTP 503 », « 18 Ko »). */
  detail?: string;
}

export interface MarqueurCascade {
  t: number;
  libelle: string;
  vital?: VitalName;
  valeur?: number;
}

/** La sévérité en toutes lettres : ce que dit la couleur, pour qui ne la voit pas. */
export const TON_LIBELLE: Record<TonCascade, string> = {
  neutre: "aucune",
  good: "bon",
  warn: "à surveiller",
  poor: "mauvais",
  erreur: "erreur",
};

/** Remplissage de la barre : jetons de F01, qui suivent le mode sombre. */
const TON_BARRE: Record<TonCascade, string> = {
  neutre: "bg-ink-faint",
  good: "bg-good",
  warn: "bg-warn",
  poor: "bg-bad",
  erreur: "bg-bad",
};

/** Texte de la sévérité, à 4,5:1 sur le fond du panneau. */
const TON_TEXTE: Record<TonCascade, string> = {
  neutre: "text-ink-soft",
  good: "text-good-ink",
  warn: "text-warn-ink",
  poor: "text-bad-ink",
  erreur: "text-bad-ink",
};

/**
 * Le MOTIF de l'erreur (§ 3.9 : une sévérité doublée d'un motif). Des hachures de la
 * couleur du fond, pas une couleur de donnée : elles suivent le mode sombre.
 */
const MOTIF_ERREUR: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(135deg, rgb(var(--c-panel) / 0.7) 0 2px, transparent 2px 6px)",
};

// Les trois colonnes d'une ligne. Les calques (repères, graduations) reprennent
// EXACTEMENT les mêmes largeurs : une verticale de repère tombe au bon endroit de
// chaque ligne parce que la colonne du dessin commence au même pixel partout.
const COL_LIBELLE = "w-[38%] shrink-0 min-w-0 sm:w-[30%] lg:w-[26%]";
const COL_DUREE = "w-14 shrink-0 sm:w-16";
const RANGEE = "flex items-center gap-3 px-3";

/** Une durée lisible : « < 1 ms » (un span de base de données), « 820 ms », « 6 min 12 s ». */
export function texteDuree(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms > 0 && ms < 1) return "< 1 ms";
  return formater(Math.abs(ms) >= 60_000 ? "s-auto" : "ms", ms);
}

/**
 * Ordre de lecture : chronologique, et chaque enfant sous son parent (parcours en
 * profondeur, frères triés par début). Un parent absent de la liste, ou une boucle
 * de parents, ne fait perdre aucun élément : il est rangé comme une racine.
 */
export function ordonnerCascade(elements: readonly ElementCascade[]): { element: ElementCascade; profondeur: number }[] {
  const ids = new Set(elements.map((e) => e.id));
  const rang = new Map(elements.map((e, i) => [e, i] as const));
  const avant = (a: ElementCascade, b: ElementCascade) =>
    (finiOuZero(a.debutMs) - finiOuZero(b.debutMs)) || rang.get(a)! - rang.get(b)!;
  const enfants = new Map<string, ElementCascade[]>();
  const racines: ElementCascade[] = [];
  for (const e of elements) {
    const parent = e.parentId && e.parentId !== e.id && ids.has(e.parentId) ? e.parentId : null;
    if (parent === null) racines.push(e);
    else enfants.set(parent, [...(enfants.get(parent) ?? []), e]);
  }
  const vus = new Set<ElementCascade>();
  const sortie: { element: ElementCascade; profondeur: number }[] = [];
  const visiter = (e: ElementCascade, profondeur: number) => {
    if (vus.has(e)) return;
    vus.add(e);
    sortie.push({ element: e, profondeur });
    for (const enfant of [...(enfants.get(e.id) ?? [])].sort(avant)) visiter(enfant, profondeur + 1);
  };
  for (const r of [...racines].sort(avant)) visiter(r, 0);
  // Une boucle de parents (a → b → a) n'a pas de racine : ses éléments restent dus.
  for (const e of [...elements].sort(avant)) visiter(e, 0);
  return sortie;
}

function finiOuZero(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

/** Position en % de l'axe, bornée à [0 ; 100] : rien ne sort du dessin. */
function pct(v: number, echelle: number): number {
  return Math.min(Math.max((finiOuZero(v) / echelle) * 100, 0), 100);
}

function pos(v: number): string {
  return `${Number(v.toFixed(3))}%`;
}

/** Ancrage d'une étiquette posée sur l'axe : jamais au-delà des bords (390 px). */
function ancrage(p: number): string {
  if (p <= 12) return "left-0";
  if (p >= 88) return "right-0";
  return "-translate-x-1/2";
}

interface Repere {
  m: MarqueurCascade;
  p: number;
  verdict: Rating | null;
  texte: string;
}

function lireRepere(m: MarqueurCascade, echelle: number): Repere {
  const verdict = m.vital && m.valeur != null && Number.isFinite(m.valeur) ? rating2026(m.vital, m.valeur) : null;
  let texte: string;
  if (m.vital && m.valeur != null && Number.isFinite(m.valeur)) {
    const format = formatDuVital(m.vital);
    const valeur = formater(format, m.valeur);
    // Un FCP de 1,2 s tombe à 1,2 s : une seule fois le nombre. Un CLS, lui, n'est pas un instant.
    texte = format === "ms" && Math.abs(m.valeur - m.t) < 1 ? `${m.libelle} ${valeur}` : `${m.libelle} ${valeur} à ${texteDuree(m.t)}`;
  } else {
    texte = `${m.libelle} à ${texteDuree(m.t)}`;
  }
  if (verdict) texte += ` · ${RATING_LABEL[verdict]}`;
  return { m, p: pct(m.t, echelle), verdict, texte };
}

/** Verticales des repères, sur la colonne du dessin (calque sans événement de pointeur). */
function CalqueReperes({ reperes }: { reperes: Repere[] }) {
  if (!reperes.length) return null;
  return (
    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 ${RANGEE}`}>
      <div className={COL_LIBELLE} />
      <div className="relative h-full min-w-0 flex-1">
        {reperes.map((r, i) => (
          <div
            key={i}
            className={`absolute inset-y-0 w-px ${r.verdict ? RATING_BAR[r.verdict] : "bg-ink-soft"}`}
            style={{ left: pos(r.p) }}
          />
        ))}
      </div>
      <div className={COL_DUREE} />
    </div>
  );
}

/** Étiquettes courtes des repères, au-dessus de l'axe ; deux rangs si deux repères se touchent. */
function EtiquettesReperes({ reperes }: { reperes: Repere[] }) {
  if (!reperes.length) return null;
  const rangs: number[] = [];
  const dernier = [-Infinity, -Infinity];
  for (const r of reperes) {
    const rang = r.p - dernier[0] >= 14 ? 0 : r.p - dernier[1] >= 14 ? 1 : 0;
    dernier[rang] = r.p;
    rangs.push(rang);
  }
  const hauteur = rangs.includes(1) ? "h-8" : "h-4";
  return (
    <div aria-hidden="true" className={`${RANGEE} mb-0.5`}>
      <div className={COL_LIBELLE} />
      <div className={`relative min-w-0 flex-1 ${hauteur}`}>
        {reperes.map((r, i) => (
          <span
            key={i}
            className={`absolute whitespace-nowrap text-[10px] font-semibold leading-4 text-ink-soft ${ancrage(r.p)} ${rangs[i] ? "top-4" : "top-0"}`}
            style={r.p <= 12 || r.p >= 88 ? undefined : { left: pos(r.p) }}
          >
            {r.m.libelle}
          </span>
        ))}
      </div>
      <div className={COL_DUREE} />
    </div>
  );
}

/** Graduations de l'axe : 0, ½, fin ; les quarts à partir de 640 px. */
function Axe({ echelle, libelleColonne }: { echelle: number; libelleColonne: string }) {
  const graduations = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div className={`${RANGEE} border-b border-line pb-1.5 text-[11px] font-semibold text-ink-soft`}>
      <span className={`${COL_LIBELLE} uppercase tracking-wider`}>{libelleColonne}</span>
      <div className="relative h-4 min-w-0 flex-1 tabular-nums">
        {graduations.map((g) => (
          <span
            key={g}
            className={`absolute top-0 whitespace-nowrap font-medium ${g === 0 ? "left-0" : g === 1 ? "right-0" : "-translate-x-1/2"} ${
              g === 0.25 || g === 0.75 ? "hidden sm:block" : ""
            }`}
            style={g === 0 || g === 1 ? undefined : { left: pos(g * 100) }}
          >
            {texteDuree(g * echelle)}
          </span>
        ))}
      </div>
      <span className={`${COL_DUREE} text-right uppercase tracking-wider`}>Durée</span>
    </div>
  );
}

/** La marque d'un élément sur l'axe : barre (durée) ou losange (instant). */
function Marque({
  element,
  echelle,
  fine = false,
  selectionnee = false,
}: {
  element: ElementCascade;
  echelle: number;
  fine?: boolean;
  selectionnee?: boolean;
}) {
  const gauche = pct(element.debutMs, echelle);
  const bord = selectionnee ? "ring-2 ring-perf ring-offset-1 ring-offset-panel" : "";
  const titre = `${element.libelle} — début ${texteDuree(element.debutMs)}, ${
    element.dureeMs == null ? "instant" : `durée ${texteDuree(element.dureeMs)}`
  }`;
  if (element.dureeMs == null || !Number.isFinite(element.dureeMs)) {
    return (
      <span
        title={titre}
        className={`cascade-ton-${element.ton} absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1px] ${
          fine ? "h-2 w-2" : "h-2.5 w-2.5"
        } ${TON_BARRE[element.ton]} ${bord}`}
        style={{ left: pos(gauche), ...(element.ton === "erreur" ? MOTIF_ERREUR : {}) }}
      />
    );
  }
  const largeur = Math.min(Math.max(pct(element.dureeMs, echelle), 0.6), 100 - gauche);
  return (
    <span
      title={titre}
      className={`cascade-ton-${element.ton} absolute top-1/2 -translate-y-1/2 rounded-sm ${fine ? "h-2" : "h-3"} ${
        TON_BARRE[element.ton]
      } ${bord}`}
      // 2 px au moins : une requête de 0,4 ms sur un axe de 3 s reste visible.
      style={{ left: pos(gauche), width: pos(largeur), minWidth: "2px", ...(element.ton === "erreur" ? MOTIF_ERREUR : {}) }}
    />
  );
}

function pluriel(n: number, mot: string): string {
  return `${n.toLocaleString("fr-FR")} ${mot}${n > 1 ? "s" : ""}`;
}

export function Cascade({
  totalMs,
  pistes,
  elements,
  marqueurs = [],
  partiel,
  selection = null,
  hauteur = "normale",
}: {
  totalMs: number;
  /** « Navigateur », « Serveur », « Ressources », « Tâches longues »… dans l'ordre d'affichage. */
  pistes: PisteCascade[];
  elements: ElementCascade[];
  /** Repères verticaux (FCP / LCP) ; verdict écrit si `vital` et `valeur`. */
  marqueurs?: MarqueurCascade[];
  /** Raison d'une collecte incomplète, affichée EN TÊTE. */
  partiel?: string;
  /** Élément mis en évidence (`?span=`). */
  selection?: string | null;
  /** « reduite » dans un panneau : l'aperçu par piste seul. */
  hauteur?: "normale" | "reduite";
}) {
  const bandeau = partiel ? <EtatSurface etat={{ kind: "partiel", raison: partiel }} compact /> : null;
  if (!elements.length) {
    return (
      <div data-testid="cascade" className="min-w-0 space-y-2">
        {bandeau}
        <p className="py-6 text-center text-sm text-ink-soft">Aucun élément à placer sur l&apos;axe.</p>
      </div>
    );
  }

  // L'axe couvre au moins `totalMs`, et tout ce qu'on lui donne : un élément qui
  // déborderait serait coupé sans le dire.
  const fins = elements.map((e) => finiOuZero(e.debutMs) + finiOuZero(e.dureeMs ?? 0));
  const echelle = Math.max(finiOuZero(totalMs), ...fins, ...marqueurs.map((m) => finiOuZero(m.t)), 1);
  const reperes = [...marqueurs].sort((a, b) => a.t - b.t).map((m) => lireRepere(m, echelle));
  const ordre = ordonnerCascade(elements);

  const libellePiste = new Map(pistes.map((p) => [p.cle, p.libelle] as const));
  const nomPiste = (cle: string) => libellePiste.get(cle) ?? cle;
  // Pistes de l'aperçu : celles déclarées, dans leur ordre, puis celles qu'on n'a pas
  // déclarées (un élément n'est jamais caché parce que sa piste manque à la liste).
  const clesPistes = [...pistes.map((p) => p.cle), ...elements.map((e) => e.piste)].filter(
    (cle, i, toutes) => toutes.indexOf(cle) === i && elements.some((e) => e.piste === cle),
  );
  const reduite = hauteur === "reduite";
  const apercu = reduite || clesPistes.length > 1;

  const resume = [
    ...clesPistes.map((cle) => `${nomPiste(cle)}, ${pluriel(elements.filter((e) => e.piste === cle).length, "élément")}`),
  ].join(" ; ");
  const nomApercu = `Aperçu par piste sur ${texteDuree(echelle)} : ${resume}${
    reperes.length ? `. Repères : ${reperes.map((r) => r.texte).join(" ; ")}` : ""
  }.`;

  const alternative = {
    legende: `Éléments de la cascade, dans l'ordre du dessin (axe de 0 à ${texteDuree(echelle)})`,
    colonnes: ["Élément", "Piste", "Début", "Durée", "Sévérité"],
    lignes: [
      ...ordre.map(({ element: e }) => [
        e.detail ? `${e.libelle} (${e.detail})` : e.libelle,
        nomPiste(e.piste),
        texteDuree(e.debutMs),
        e.dureeMs == null ? "instant" : texteDuree(e.dureeMs),
        TON_LIBELLE[e.ton],
      ]),
      ...reperes.map((r) => [`Repère ${r.m.libelle}`, "—", texteDuree(r.m.t), "instant", r.verdict ? RATING_LABEL[r.verdict] : "—"]),
    ],
  };

  return (
    <div data-testid="cascade" data-hauteur={hauteur} className="min-w-0 space-y-3 overflow-hidden">
      {bandeau}

      {reperes.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft" aria-label="Repères">
          {reperes.map((r, i) => (
            <li key={i} className="flex min-w-0 items-center gap-1.5">
              <span aria-hidden="true" className={`h-3 w-px shrink-0 ${r.verdict ? RATING_BAR[r.verdict] : "bg-ink-soft"}`} />
              <span className="min-w-0 break-words">{r.texte}</span>
            </li>
          ))}
        </ul>
      )}

      {apercu && (
        <div role="img" aria-label={nomApercu} data-testid="cascade-apercu" className="relative">
          <EtiquettesReperes reperes={reperes} />
          <div className="relative space-y-1">
            {clesPistes.map((cle) => {
              const dela = elements.filter((e) => e.piste === cle);
              return (
                <div key={cle} className={RANGEE}>
                  <span className={`${COL_LIBELLE} truncate text-xs text-ink-soft`}>{nomPiste(cle)}</span>
                  <div className={`relative min-w-0 flex-1 rounded-sm bg-panel2 ${reduite ? "h-3" : "h-4"}`}>
                    {dela.map((e) => (
                      <Marque key={e.id} element={e} echelle={echelle} fine selectionnee={e.id === selection} />
                    ))}
                  </div>
                  <span className={`${COL_DUREE} text-right text-xs tabular-nums text-ink-soft`}>{dela.length}</span>
                </div>
              );
            })}
            <CalqueReperes reperes={reperes} />
          </div>
        </div>
      )}

      {!reduite && (
        <div className="relative">
          {!apercu && <EtiquettesReperes reperes={reperes} />}
          <Axe echelle={echelle} libelleColonne="Élément" />
          <div className="relative">
            <ol data-testid="cascade-elements" aria-label="Éléments, dans l'ordre chronologique">
              {ordre.map(({ element: e, profondeur }) => {
                const choisi = e.id === selection;
                const sous = [nomPiste(e.piste), e.detail].filter(Boolean).join(" · ");
                return (
                  <li
                    key={e.id}
                    data-testid="cascade-element"
                    data-ton={e.ton}
                    aria-current={choisi ? "true" : undefined}
                    className={`${RANGEE} border-t border-line/60 py-2 first:border-t-0 ${
                      choisi ? "bg-perf/10 ring-1 ring-inset ring-perf" : ""
                    }`}
                  >
                    <div className={COL_LIBELLE} style={profondeur ? { paddingLeft: `${Math.min(profondeur, 5) * 10}px` } : undefined}>
                      {e.href ? (
                        <Link
                          href={e.href}
                          scroll={false}
                          className="block truncate rounded-sm text-sm font-medium text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
                          title={e.libelle}
                        >
                          {e.libelle}
                        </Link>
                      ) : (
                        <span className="block truncate text-sm font-medium text-ink" title={e.libelle}>
                          {e.libelle}
                        </span>
                      )}
                      <span className="block truncate text-[11px] text-ink-soft">
                        {sous}
                        {e.ton !== "neutre" && (
                          <>
                            {" · "}
                            <span className={`font-semibold ${TON_TEXTE[e.ton]}`}>{TON_LIBELLE[e.ton]}</span>
                          </>
                        )}
                      </span>
                    </div>
                    <div className="relative h-5 min-w-0 flex-1">
                      <span aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px bg-line" />
                      <Marque element={e} echelle={echelle} />
                    </div>
                    <span className={`${COL_DUREE} text-right text-sm font-semibold tabular-nums text-ink`}>
                      {e.dureeMs == null ? <span className="text-xs font-medium text-ink-soft">instant</span> : texteDuree(e.dureeMs)}
                    </span>
                  </li>
                );
              })}
            </ol>
            <CalqueReperes reperes={reperes} />
          </div>
        </div>
      )}

      <TableAlternative alternative={alternative} />
    </div>
  );
}
