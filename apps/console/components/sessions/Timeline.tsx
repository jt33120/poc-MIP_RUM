// Rendu d'une ligne de timeline session (puce + offset + badge + corps typé).
// Composants présentationnels purs (serveur), extraits de app/sessions/[id]/page.tsx.
//
// F45 ajoute DEUX réglages, et rien d'autre : le corps typé de chaque nature est
// celui de F44, pour qu'une ligne se lise pareil dans la liste plate d'hier et
// dans le déroulé groupé d'aujourd'hui.
//   · `lien` — la question suivante de la ligne (« Voir la page », « Voir
//     l'erreur groupée »…). Le href est PRÉ-CALCULÉ par la page : ce composant
//     ne construit aucune URL et ne sait pas ce qu'est un périmètre d'app.
//   · `imbrique` — la ligne est déjà rendue SOUS son action (déroulé groupé) :
//     le badge causal « ↳ action » ferait doublon avec l'indentation.
//
// F47 ajoute le rejeu synchronisé, sans rien changer au corps d'une ligne :
//   · `data-ligne` — la ligne que l'îlot `ReplaySynchro` désigne (`aria-current="time"`
//     quand la tête de lecture l'a atteinte, surligné) ;
//   · `instant` — le décalage devient un lien `?tab=deroule&at=<t>#<ancre>` : sans
//     JavaScript, il positionne le lecteur ; avec, l'îlot place la tête sans recharger.
import Link from "next/link";
import { fmtDate, fmtVital } from "@/lib/format";
import type { TimelineItem } from "@/lib/queries";
import { FORME_RATING, RATING_CLASS } from "@/lib/rating";
import { libelleAction, libelleRepere } from "@/lib/libelle-action";
import { KIND_ICON, KIND_STYLE, libelleDeLigne, libelleEvenement, mesureMipDeLigne, noteDeLigne, pointDeLigne } from "@/lib/timeline-constants";
import { ValeurNoteeMip } from "@/components/NoteMip";

/** Types de repère du SDK (`rum_breadcrumb.type`), en français ; un autre type reste tel quel. */
const TYPES_REPERE: Record<string, string> = {
  nav: "navigation",
  click: "clic",
  custom: "personnalisé",
  console: "console",
  fetch: "réseau",
  xhr: "réseau",
};

/** Au-delà, les propriétés d'un événement se replient : un JSON de 400 caractères noyait la ligne. */
const DETAIL_COURT = 60;

/**
 * Propriétés d'un événement : courtes, sur la ligne ; longues, repliées derrière
 * « Détails » (recette du 26/09/2026 : `form.abandon` étalait son JSON brut).
 */
function ProprietesEvenement({ detail }: { detail: string }) {
  if (detail.length <= DETAIL_COURT) {
    return <span className="min-w-0 max-w-full truncate sm:max-w-xl font-mono text-xs text-ink-faint">{detail}</span>;
  }
  return (
    <details className="w-full min-w-0 text-xs">
      <summary className="cursor-pointer rounded text-ink-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf">
        Détails
      </summary>
      <pre className="mt-1 max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded bg-panel2 p-2 font-mono text-[11px] text-ink-soft">
        {detail}
      </pre>
    </details>
  );
}

/** Décalage depuis le début de la session, même règle pour la ligne et pour l'en-tête de vue (F45). */
export function fmtOffset(ms: number): string {
  if (ms < 1000) return `+${Math.round(ms)} ms`;
  if (ms < 60_000) return `+${(ms / 1000).toFixed(1).replace(".", ",")} s`;
  return `+${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

/** Surlignage de la ligne que la tête de lecture a atteinte (`ReplaySynchro`, F47). */
export const LIGNE_COURANTE = "aria-[current=time]:bg-perf/10";

/**
 * Le décalage d'une ligne. Avec un rejeu (`instant`), c'est un lien qui place la tête
 * à l'instant de la ligne (F47) ; sans rejeu, un simple texte.
 *
 * LA COULEUR EST CHOISIE ICI, pas par l'appelant : devenu un lien, le décalage est un
 * CONTRÔLE, et un contrôle de moins de 18 px ne s'écrit pas en `ink-faint` (≈ 2,8:1,
 * réservé au décoratif, § 3.9) mais en `ink-soft`. Sans rejeu, le texte garde sa teinte.
 */
export function Decalage({
  texte,
  ts,
  instant = null,
  className,
}: {
  texte: string;
  ts: Date | string;
  instant?: string | null;
  /** Mise en page seulement (largeur, police) : aucune classe de couleur. */
  className: string;
}) {
  if (!instant) {
    return (
      <span className={`${className} text-ink-faint`} title={fmtDate(ts)}>
        {texte}
      </span>
    );
  }
  return (
    <Link
      href={instant}
      // Même page, autre instant : rien à précharger (une chronologie en a des centaines).
      prefetch={false}
      data-instant=""
      aria-label={`${texte} — placer le rejeu à cet instant`}
      title={`${fmtDate(ts)} — placer le rejeu à cet instant`}
      className={`${className} rounded text-ink-soft hover:text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf`}
    >
      {texte}
    </Link>
  );
}

// `id` : ancre du récit « En bref » (P*.9, `ancreEvenement`) ; la ligne visée
// s'éclaire (`target:`) pour que le fait cité se voie à l'arrivée.
export function TimelineRow({
  item,
  t0,
  id,
  lien = null,
  imbrique = false,
  instant = null,
}: {
  item: TimelineItem;
  t0: number;
  id?: string;
  /** Question suivante de la ligne ; href pré-calculé par la page (aucune fonction en prop). */
  lien?: { href: string; libelle: string } | null;
  /** La ligne est déjà indentée sous son action : le badge causal ferait doublon. */
  imbrique?: boolean;
  /** Lien d'instant du rejeu (`?at=`), pré-calculé par la page ; absent sans rejeu (F47). */
  instant?: string | null;
}) {
  const st = KIND_STYLE[item.kind];
  const offset = new Date(item.ts).getTime() - t0;
  return (
    <li id={id} data-ligne={id} className={`relative scroll-mt-24 rounded-r pb-2 pl-6 last:pb-0 target:bg-brand/10 ${LIGNE_COURANTE}`}>
      <span
        data-point={noteDeLigne(item) ?? ""}
        className={`absolute -left-[9px] top-1 flex h-4 w-4 items-center justify-center rounded-full text-white ${pointDeLigne(item)}`}
      >
        {KIND_ICON[item.kind]}
      </span>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px]">
        <Decalage
          texte={fmtOffset(Math.max(0, offset))}
          ts={item.ts}
          instant={instant}
          className="w-20 shrink-0 font-mono text-xs tabular-nums"
        />
        <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${st.badge}`}>{libelleDeLigne(item)}</span>
        <ItemBody item={item} />
        {item.action_id && item.kind !== "action" && !imbrique && (
          <span className="rounded-full border border-fuchsia-300 bg-fuchsia-50 px-2 py-0.5 text-[11px] font-medium text-fuchsia-800 dark:border-fuchsia-400/30 dark:bg-fuchsia-400/10 dark:text-fuchsia-300">
            ↳ {item.action_name ? libelleAction(item.action_name) : "action"}
          </span>
        )}
        {lien && (
          <Link
            href={lien.href}
            className="rounded text-xs text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
            data-testid="lien-ligne"
          >
            {lien.libelle}
          </Link>
        )}
      </div>
    </li>
  );
}

function ItemBody({ item }: { item: TimelineItem }) {
  switch (item.kind) {
    case "pageview":
      return (
        <>
          <span className="chip-mono min-w-0 max-w-full truncate">{item.title}</span>
          {item.detail && <span className="min-w-0 max-w-full truncate text-xs text-ink-faint">{item.detail}</span>}
        </>
      );
    case "vital": {
      const valeur = item.value != null ? Number(item.value) : null;
      const mesure = mesureMipDeLigne(item);
      if (mesure) {
        // Phase réseau, RTT, débit : règle MIP, écrite à côté de la valeur (R-S amendée).
        return (
          <>
            <span className="font-semibold">{item.title}</span>
            <ValeurNoteeMip mesure={mesure} valeur={valeur} texte={mesure === "DOWNLINK" ? (valeur == null ? "—" : `${valeur.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mbit/s`) : fmtVital(item.title ?? "", valeur)} />
            {item.detail && <span className="min-w-0 max-w-full truncate font-mono text-xs text-ink-faint" title={item.detail}>{item.detail}</span>}
          </>
        );
      }
      const note = noteDeLigne(item);
      const cls = note ? RATING_CLASS[note] : "";
      return (
        <>
          <span className="font-semibold">{item.title}</span>
          <span className={`rounded border px-1.5 py-0.5 text-xs font-medium tabular-nums ${cls}`}>
            {note && <span aria-hidden="true" className="mr-1">{FORME_RATING[note]}</span>}
            {fmtVital(item.title ?? "", valeur)}
          </span>
          {item.detail && <span className="min-w-0 max-w-full truncate font-mono text-xs text-ink-faint" title={item.detail}>{item.detail}</span>}
        </>
      );
    }
    case "error":
      return (
        <>
          <span className="font-semibold text-bad-ink">{item.title}</span>
          <span className="min-w-0 max-w-full truncate sm:max-w-xl text-xs text-ink-soft" title={item.detail ?? ""}>
            {item.detail}
          </span>
        </>
      );
    case "breadcrumb":
      return (
        <>
          <span className="rounded bg-violet-50 px-1.5 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-400/10 dark:text-violet-300">
            {TYPES_REPERE[item.title ?? ""] ?? item.title}
          </span>
          {item.detail && (
            <span className="min-w-0 max-w-full truncate sm:max-w-xl text-xs text-ink-soft" title={item.detail}>
              {libelleRepere(item.detail)}
            </span>
          )}
        </>
      );
    case "longtask":
      return (
        <>
          <span className="font-semibold tabular-nums text-orange-700 dark:text-orange-400">
            {item.value != null ? `${Math.round(Number(item.value))} ms` : "—"}
          </span>
          {item.detail && <span className="min-w-0 max-w-full truncate font-mono text-xs text-ink-faint" title={item.detail}>{item.detail}</span>}
        </>
      );
    case "event":
      return (
        <>
          <span className="font-semibold text-cyan-700 dark:text-cyan-400" title={item.title ?? undefined}>
            {libelleEvenement(item.title)}
          </span>
          {item.detail && item.detail !== "null" && item.detail !== "{}" && <ProprietesEvenement detail={item.detail} />}
        </>
      );
    case "action":
      return (
        <>
          <span className="font-semibold text-fuchsia-700 dark:text-fuchsia-300" title={item.title ?? undefined}>
            {libelleAction(item.title)}
          </span>
          {item.detail && <span className="min-w-0 max-w-full truncate text-xs text-ink-faint" title={item.detail}>{item.detail}</span>}
        </>
      );
    case "resource":
      return (
        <>
          {item.value != null ? (
            <ValeurNoteeMip mesure="RESOURCE" valeur={Number(item.value)} texte={fmtVital("", Number(item.value))} />
          ) : (
            <span className="font-semibold text-ink-soft">{item.title}</span>
          )}
          {item.detail && <span className="min-w-0 max-w-full truncate sm:max-w-xl font-mono text-xs text-ink-faint" title={item.detail}>{item.detail}</span>}
        </>
      );
    case "api":
      // title = 'GET /api/aos', detail = '200 · serveur 211 ms', value = ms total
      return (
        <>
          <span className="chip-mono">{item.title}</span>
          {/* La durée se note par la règle MIP des appels API (`SEUILS_MIP.API`) ; un échec
              (statut ≥ 400 ou nul, `rating = 'poor'` de la requête) est dit en toutes lettres. */}
          <ValeurNoteeMip
            mesure="API"
            valeur={item.value != null ? Number(item.value) : null}
            texte={item.value != null ? fmtVital("", Number(item.value)) : "—"}
          />
          {item.rating === "poor" && <span className="text-xs font-semibold text-bad-ink">échec</span>}
          {item.detail && <span className="min-w-0 max-w-full truncate text-xs text-ink-soft" title={item.detail}>{item.detail}</span>}
        </>
      );
  }
}
