// Heatmap calendaire « tenue dans la durée » — une ligne = un jour, une colonne
// = une heure, une case colorée = la part de mesures « Bon » de ce créneau (LCP ×2,
// comme le score de santé). Rendu 100 % serveur (divs + CSS grid, zéro JS client).
//
// ÉCHELLE SÉQUENTIELLE, PAS DE VERDICT (F01, règle R-S du plan). Les cases étaient
// vertes au-dessus de 90 % de mesures « Bon », ambre au-dessus de 50 %, rouges en
// dessous : deux seuils sans aucune source, peints aux couleurs des verdicts
// web.dev. Une part de mesures « Bon » est une intensité ; elle se lit sur une
// teinte unique, et sa valeur exacte est dans l'alternative textuelle.
//
// JOURS ET HEURES DE L'APPLICATION (F05, R-T). `healthGrid` découpe dans le fuseau
// de l'app : `date_trunc('day', ts at time zone <tz>)` est un `timestamp` SANS
// fuseau, que node-postgres rend en `Date` à minuit LOCAL du processus. L'ancienne
// clé (`toISOString().slice(0, 10)`) décalait donc chaque case d'une rangée dès que
// Node ne tournait pas en UTC. La clé est lue par `cleJour` (composantes locales,
// celles que le pilote a posées) et l'axe par `joursLocaux` : même repère des deux
// côtés.
//
// UNE CASE EST UN LIEN (F05, § 3.3). Elle ouvre l'écran sur SON heure : les bornes
// locales sont converties en instants UTC ici, au rendu serveur
// (`bornesHeureLocale`) — une heure de Paris l'été n'est pas l'heure UTC du même
// numéro. Une rangée est un groupe de liens, chaque case un arrêt de tabulation ;
// une case vide ne mène nulle part.
import Link from "next/link";
import { TableAlternative } from "./Figure";
import { formater } from "@/lib/fmt-ids";
import { cleJour } from "@/lib/forecast";
import { bornesHeureLocale, libelleDeuxFuseaux } from "@/lib/fuseau";
import { PALIERS_SEQUENTIELLE, SEQUENTIELLE } from "@/lib/palette";

/** Une case telle que la rend `healthGrid` : jour et heure LOCAUX (fuseau de l'app). */
export interface CaseSante {
  /** Début de journée locale : `Date` à minuit local (pilote pg) ou « AAAA-MM-JJ… ». */
  day: Date | string;
  /** Heure locale, 0-23. */
  hour: number;
  good_w: number;
  total_w: number;
}

/** Plus petit seau du contrat (5 min) : une heure en cours plus courte n'ouvre rien. */
const SEAU_MIN_MS = 5 * 60_000;

/** Part pondérée de mesures « Bon » d'une case, ou null sans mesure. */
function partBon(c: CaseSante | undefined): number | null {
  return c && c.total_w > 0 ? c.good_w / c.total_w : null;
}

/** « mer. 10/09 » : le jour est une date civile, lue en UTC pour ne pas glisser. */
function libelleJour(jour: string): string {
  return new Date(`${jour}T00:00:00Z`).toLocaleDateString("fr-FR", {
    timeZone: "UTC",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

const HEURES = Array.from({ length: 24 }, (_v, h) => h);
// Heures ouvrées : 8h → 19h inclus (créneaux 08:00–19:59).
const HEURES_OUVREES = Array.from({ length: 12 }, (_v, i) => i + 8);
const ouvre = (jour: string): boolean => {
  const d = new Date(`${jour}T00:00:00Z`).getUTCDay(); // 0 = dimanche, 6 = samedi
  return d >= 1 && d <= 5;
};

/**
 * Remplit le gabarit `zoomHref` : `{from}` et `{to}`, tels quels ou déjà encodés
 * par `URLSearchParams` (`%7Bfrom%7D`), reçoivent les instants UTC encodés.
 */
function remplir(gabarit: string, from: string, to: string): string {
  return gabarit
    .replace(/\{from\}|%7Bfrom%7D/gi, encodeURIComponent(from))
    .replace(/\{to\}|%7Bto%7D/gi, encodeURIComponent(to));
}

/** `href: null` : la case ne mène nulle part, `raison` dit pourquoi (vide si aucun gabarit). */
type Lien = { href: string | null; raison: string; libelle: string };

/** Le lien d'une case mesurée, ou pourquoi elle n'en a pas. */
function lienDeCase(jour: string, heure: number, fuseau: string, zoomHref: string | undefined, maintenant: number): Lien {
  const bornes = bornesHeureLocale(jour, heure, fuseau);
  const from = Date.parse(bornes.from);
  // `to ≤ maintenant` (contrat) : l'heure en cours s'ouvre jusqu'à la minute écoulée.
  const to = Math.min(Date.parse(bornes.to), Math.floor(maintenant / 60_000) * 60_000);
  const toIso = new Date(to).toISOString().replace(/\.\d{3}Z$/, "Z");
  const libelle = libelleDeuxFuseaux(bornes.from, bornes.to, fuseau);
  if (!zoomHref) return { href: null, raison: "", libelle };
  if (to - from < SEAU_MIN_MS) return { href: null, raison: "heure en cours : moins de 5 minutes écoulées", libelle };
  return { href: remplir(zoomHref, bornes.from, toIso), raison: "", libelle };
}

export function HealthHeatmap({
  jours,
  cellules,
  fuseau,
  zoomHref,
  businessOnly = false,
  maintenant = Date.now(),
  alternative = true,
}: {
  /** Axe vertical : jours LOCAUX « AAAA-MM-JJ », du plus ancien au plus récent (`joursLocaux`). */
  jours: string[];
  /** Cases de `healthGrid`, jour et heure dans le fuseau de l'app. */
  cellules: CaseSante[];
  /** Fuseau de l'app : celui des jours, des heures et des liens. */
  fuseau: string;
  /** Gabarit d'URL avec `{from}` et `{to}` (instants UTC) ; absent : cases non cliquables. */
  zoomHref?: string;
  /** Heures ouvrées : ne montre que Lun–Ven, 8h–19h (créneaux où l'on attend du trafic). */
  businessOnly?: boolean;
  /** Instant de rendu (ms) : borne le lien de l'heure en cours. */
  maintenant?: number;
  /** false : l'alternative est portée par la `Figure` englobante (pas de doublon). */
  alternative?: boolean;
}) {
  const parCase = new Map<string, CaseSante>();
  for (const c of cellules) parCase.set(`${cleJour(c.day)}|${Number(c.hour)}`, c);
  const heures = businessOnly ? HEURES_OUVREES : HEURES;
  const rangees = businessOnly ? jours.filter(ouvre) : jours;
  // Colonnes : étiquette de jour (auto) + N heures de largeur égale.
  const gridCols = `minmax(4.5rem, auto) repeat(${heures.length}, minmax(0, 1fr))`;
  const texteCase = (part: number) => `${formater("pct", part)} de mesures « Bon » (pondéré)`;

  return (
    <div className="min-w-0">
      <div className="overflow-x-auto">
        <div
          className="min-w-[640px]"
          role="group"
          aria-label={`Historique de santé : ${rangees.length} jours × ${heures.length} heures, fuseau ${fuseau}`}
          data-testid="heatmap"
        >
          {/* en-tête : repères horaires tous les 3 h */}
          <div className="grid items-end gap-[3px] pb-1" style={{ gridTemplateColumns: gridCols }} aria-hidden="true">
            <span />
            {heures.map((h) => (
              <span key={h} className="text-center text-[9px] tabular-nums text-ink-soft">
                {h % 3 === 0 ? `${h}h` : ""}
              </span>
            ))}
          </div>

          {rangees.map((jour) => (
            <div
              key={jour}
              role="group"
              aria-label={libelleJour(jour)}
              className="grid items-center gap-[3px] py-[1.5px]"
              style={{ gridTemplateColumns: gridCols }}
            >
              <span aria-hidden="true" className="pr-2 text-right text-[10px] capitalize tabular-nums text-ink-soft">
                {libelleJour(jour)}
              </span>
              {heures.map((h) => {
                const part = partBon(parCase.get(`${jour}|${h}`));
                if (part == null) {
                  return (
                    <span
                      key={h}
                      aria-hidden="true"
                      data-testid="heatmap-case-vide"
                      className="h-4 rounded-[3px] bg-panel2 opacity-60"
                      title={`${libelleJour(jour)} · ${h}h — aucune donnée`}
                    />
                  );
                }
                const lien = lienDeCase(jour, h, fuseau, zoomHref, maintenant);
                const annonce = `${lien.libelle} : ${texteCase(part)}`;
                const style = { backgroundColor: SEQUENTIELLE(part) };
                // Le `title` est à la fois l'infobulle et le nom accessible du lien (une
                // case n'a pas de texte) : pas d'`aria-label` en double, la heatmap porte
                // 336 cases et l'écran se relit toutes les 5 s.
                return lien.href ? (
                  <Link
                    key={h}
                    href={lien.href}
                    prefetch={false}
                    scroll={false}
                    title={annonce}
                    data-testid="heatmap-case"
                    className="block h-4 rounded-[3px] transition hover:ring-2 hover:ring-ink/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
                    style={style}
                  />
                ) : (
                  <span
                    key={h}
                    role="img"
                    aria-label={lien.raison ? `${annonce} (${lien.raison})` : annonce}
                    title={lien.raison ? `${annonce} — ${lien.raison}` : annonce}
                    data-testid="heatmap-case"
                    className="h-4 rounded-[3px]"
                    style={style}
                  />
                );
              })}
            </div>
          ))}

          {/* légende */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-ink-soft">
            <span className="flex items-center gap-1.5">
              % de mesures « Bon » (pondéré) :<span>0 %</span>
              {PALIERS_SEQUENTIELLE.map((c) => (
                <span key={c} className="h-3 w-3 rounded-[3px]" style={{ backgroundColor: c }} aria-hidden="true" />
              ))}
              <span>100 %</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-[3px] bg-panel2 opacity-60" aria-hidden="true" />
              aucune donnée
            </span>
            <span className="sm:ml-auto">
              jours et heures en {fuseau}
              {zoomHref ? " · une case ouvre son heure (bornes converties en UTC)" : ""} · LCP pondéré ×2
            </span>
          </div>
        </div>
      </div>
      {alternative && (
        <TableAlternative
          alternative={{
            legende: `Part pondérée de mesures « Bon » par jour et par heure (${fuseau}) ; « — » : aucune donnée`,
            colonnes: ["Jour", ...heures.map((h) => `${h} h`)],
            lignes: rangees.map((jour) => [
              libelleJour(jour),
              ...heures.map((h) => {
                const part = partBon(parCase.get(`${jour}|${h}`));
                return part == null ? null : formater("pct", part);
              }),
            ]),
          }}
        />
      )}
    </div>
  );
}
