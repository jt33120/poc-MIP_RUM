// « Scripts qui bloquent le fil principal » (§ 5.4.2, écran /ux) : classement en barres
// du blocage CUMULÉ, la mesure qui décide de l'INP. Sorti de `app/ux/page.tsx` le
// 30/09/2026 pour être testé seul (`tests/unit/scripts-bloquants.test.tsx`).
//
// POURQUOI DES BARRES, ET PAS LA TABLE D'AVANT. La question n'est pas « combien de
// millisecondes exactement », c'est « lequel de ces scripts pèse le plus » : une
// longueur se compare d'un coup d'œil, cinq colonnes de chiffres non. Les chiffres
// restent : blocage cumulé sur la barre, frames et pire cas en sous-texte, et
// l'alternative textuelle de la figure rend les colonnes de la table précédente.
//
// DURÉE NOTÉE, BLOCAGE NEUTRE (suite de la vague 4, amendement de R-S, plan § 1.5).
// Seules les trames longues (LoAF) portent une adresse de script : chaque ligne est
// une LoAF. La règle `SEUILS_MIP.LOAF` porte sur la DURÉE p75 d'une trame, pas sur
// son temps de blocage : la durée p75 de chaque script est donc notée (pastille,
// forme, règle écrite une fois en tête de figure), et le blocage — longueur de barre,
// cumul, pire cas — reste sans couleur de verdict, ce que la figure dit en toutes
// lettres. Les barres portent la série principale, rien d'autre.
//
// Composant de présentation pur (aucun hook, aucune lecture) : rendu serveur.
import { Figure } from "@/components/charts/Figure";
import { RankBar, type RankDatum } from "@/components/charts/RankBar";
import { RegleMip, ValeurNoteeMip } from "@/components/NoteMip";
import { formater } from "@/lib/fmt-ids";
import { decouperUrlScript, pluriel } from "@/lib/format";
import type { SectionLue } from "@/lib/lecture";
import { noteAffichee } from "@/lib/notes-mip";
import type { ScriptBloquant } from "@/lib/queries-frustration";

/** La règle MIP qui note la durée d'une ligne : toutes sont des trames longues. */
const MESURE_DUREE = "LOAF";

/** Ce que la figure dit du blocage : aucune règle MIP ne le vise. */
export const PHRASE_BLOCAGE_NEUTRE_SCRIPTS = "Le temps de blocage n'a pas de règle MIP : il reste neutre.";

/** « 212 ms (à améliorer) » pour l'alternative textuelle ; la valeur seule sans note. */
function dureeTextuelle(ms: number | null): string {
  const note = noteAffichee(MESURE_DUREE, ms);
  const valeur = formater("ms", ms);
  return note ? `${valeur} (${note.libelle.toLowerCase()})` : valeur;
}

export function ScriptsBloquants({ scripts, label }: { scripts: SectionLue<ScriptBloquant[]>; label: string }) {
  const titre = "Scripts qui bloquent le fil principal (trames longues)";
  if (!scripts.ok) return <Figure titre={titre} id="scripts-bloquants" etat={{ kind: "erreur", titre }} />;

  // Un script intégré à la page n'a pas de fichier : la lecture le regroupe par
  // fonction sur toutes les pages (recette du 26/09/2026 : la même fonction
  // occupait huit lignes, une par URL de page), ses routes passent en détail.
  const routesDe = (s: ScriptBloquant) =>
    s.nbRoutes === 0
      ? null
      : s.nbRoutes === 1
        ? `route ${s.routes[0]}`
        : `${s.nbRoutes.toLocaleString("fr-FR")} routes (${s.routes.join(", ")}${s.nbRoutes > s.routes.length ? "…" : ""})`;
  const fonction = (s: ScriptBloquant) => s.quoi ?? "exécution au chargement";
  // La durée p75, notée ; la règle n'est pas répétée sur chaque ligne (écrite en tête).
  const duree = (s: ScriptBloquant) => (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1">
      <span>durée p75</span>
      <ValeurNoteeMip mesure={MESURE_DUREE} valeur={s.dureeP75Ms} texte={formater("ms", s.dureeP75Ms)} regle={false} />
    </span>
  );
  const lignes: RankDatum[] = scripts.data.map((s) => {
    const trames = `${pluriel(s.n, "trame")} · pire ${formater("ms", s.worstMs)}`;
    if (s.url === null) {
      const routes = routesDe(s);
      return {
        label: s.quoi ?? "Script de la page, au chargement",
        value: s.totalMs,
        display: formater("ms", s.totalMs),
        title: `Script intégré à la page — ${fonction(s)}${routes ? ` — ${routes}` : ""}`,
        sub: (
          <>
            script intégré à la page{routes ? ` · ${routes}` : ""} · {trames} · {duree(s)}
          </>
        ),
      };
    }
    // Nom de fichier en évidence, hôte en sous-texte : une troncature de fin n'aurait
    // montré que le préfixe, identique pour tous les scripts du même site. L'URL
    // entière et la fonction restent en infobulle de la ligne.
    const { fichier, hote } = decouperUrlScript(s.url);
    return {
      label: `${fichier} · ${fonction(s)}`,
      value: s.totalMs,
      display: formater("ms", s.totalMs),
      title: `${s.url} — ${fonction(s)}`,
      sub: (
        <>
          {hote ? `${hote} · ` : ""}
          {trames} · {duree(s)}
        </>
      ),
    };
  });

  return (
    <Figure
      titre={titre}
      id="scripts-bloquants"
      meta={
        <>
          <span>{pluriel(scripts.data.length, "paire script et fonction", "paires script et fonction")}, 20 au plus</span>
          <span>{label}</span>
          <span>classement par blocage cumulé</span>
        </>
      }
      etat={
        lignes.length === 0
          ? { kind: "vide", population: "trame bloquante attribuée à un script", plage: label }
          : undefined
      }
      lecture={
        <>
          Classé par blocage <strong>cumulé</strong>, pas par pire cas : un script qui bloque 400 ms une fois est un
          incident, un script qui bloque 60 ms à chaque frappe est le problème — et c&apos;est le second qui décide de
          l&apos;INP. Un cumul de visiteurs différents n&apos;est le temps vécu de personne. La mesure des trames
          longues n&apos;existe que sur Chromium : les visiteurs Safari et Firefox n&apos;en produisent pas, et une
          absence de ligne ne veut donc pas dire qu&apos;ils n&apos;attendent pas.
        </>
      }
      alternative={
        lignes.length > 0
          ? {
              legende: `Blocage attribué par script et par fonction, ${label}`,
              colonnes: ["Script", "Fonction / invocation", "Routes", "Trames", "Blocage cumulé", "Pire", "Durée p75 (note MIP)"],
              lignes: scripts.data.map((s) => [
                s.url ?? "intégré à la page",
                fonction(s),
                routesDe(s) ?? "—",
                s.n,
                formater("ms", s.totalMs),
                formater("ms", s.worstMs),
                dureeTextuelle(s.dureeP75Ms),
              ]),
            }
          : undefined
      }
    >
      <div className="flex min-w-0 flex-col gap-3">
        {/* `relative` : les libellés `sr-only` des notes (position absolue) restent dans
            la figure, jamais placés par rapport à la page (piège 16). */}
        <div className="relative min-w-0 text-[11px] text-ink-soft [overflow-wrap:anywhere]" data-testid="scripts-regle">
          <p className="min-w-0">
            Durée p75 des trames de chaque script, notée : <RegleMip mesure={MESURE_DUREE} />.
          </p>
          <p className="min-w-0 text-ink-faint" data-testid="blocage-neutre">
            {PHRASE_BLOCAGE_NEUTRE_SCRIPTS} Les barres, le cumul et le pire cas n&apos;ont pas de couleur de verdict.
          </p>
        </div>
        <div className="relative min-w-0">
          <RankBar data={lignes} alternative={false} legende="Blocage cumulé par script et par fonction" />
        </div>
      </div>
    </Figure>
  );
}
