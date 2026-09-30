// LES CONSTATS DÉTECTÉS PAR CALCUL, EN CARTES (A2 § 7.6, vague 3b) — rendu serveur.
//
// Colonne « constats » de R2, AU-DESSUS de la bande historique (`InsightStrip`) : les
// constats ouverts de `signal_detecte`, triés par priorité (5 au plus). Chaque carte
// porte un fait chiffré en titre, sa preuve, son effectif, et sa méthode repliée
// (« Afficher la méthode ») : la règle publiée, la référence, la priorité.
//
// Fond `panel`, filet gauche 3 px `signal` — jamais du rouge : le rouge dit un seuil
// web.dev franchi, pas un écart à l'habitude (A2 § 8.5). Aucun badge « IA », aucun mot
// qui prête une intention au calcul (A2 § 8.8–8.9).
//
// Rien trouvé n'est pas « tout va bien » (A2 § 8.14) : l'état vide dit ce qui a été
// cherché, et une lecture en échec se dit comme telle.
import type { CarteConstat } from "@/lib/detections-ecran";

const LIBELLE_PRIORITE: Record<CarteConstat["niveauPriorite"], string> = {
  haute: "Priorité haute",
  moyenne: "Priorité moyenne",
  basse: "Priorité basse",
};

export type EtatConstatsDetectes =
  | { kind: "echec" }
  | { kind: "absent" }
  | { kind: "ok"; cartes: CarteConstat[]; ouverts: number; clos: number };

function Carte({ c }: { c: CarteConstat }) {
  return (
    <li
      id={`constat-detecte-${c.id}`}
      data-testid="constat-detecte"
      data-priorite={c.priorite}
      className="min-w-0 scroll-mt-16 rounded-md border border-line border-l-[3px] border-l-signal bg-panel px-3 py-2"
    >
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <p className="min-w-0 text-sm font-medium text-ink [overflow-wrap:anywhere]">
          <span aria-hidden="true" className="mr-1 text-signal">
            ◆
          </span>
          {c.titre}
        </p>
        <span className="shrink-0 text-[11px] text-ink-soft">
          {LIBELLE_PRIORITE[c.niveauPriorite]} · calculé
        </span>
      </div>
      {c.preuve && <p className="mt-0.5 min-w-0 text-xs tabular-nums text-ink [overflow-wrap:anywhere]">{c.preuve}</p>}
      {c.effectif && <p className="mt-0.5 min-w-0 text-xs text-ink-soft [overflow-wrap:anywhere]">{c.effectif}</p>}
      <details className="mt-1 min-w-0 text-xs text-ink-soft" data-testid="constat-methode">
        <summary className="cursor-pointer select-none text-ink-soft hover:text-ink">Afficher la méthode</summary>
        {c.phrase && <p className="mt-1 min-w-0 [overflow-wrap:anywhere]">{c.phrase}</p>}
        <dl className="mt-1 grid min-w-0 grid-cols-1 gap-x-2 gap-y-0.5 sm:grid-cols-[auto_1fr]">
          {c.methode.map((m) => (
            <div key={m.libelle} className="contents">
              <dt className="font-medium text-ink">{m.libelle}</dt>
              <dd className="min-w-0 [overflow-wrap:anywhere]">{m.valeur}</dd>
            </div>
          ))}
        </dl>
      </details>
    </li>
  );
}

export function ConstatsDetectes({ etat }: { etat: EtatConstatsDetectes }) {
  return (
    <section className="mb-3 min-w-0" aria-labelledby="constats-detectes-titre" data-testid="constats-detectes">
      <h3 id="constats-detectes-titre" className="mb-1 text-xs font-semibold text-ink">
        Détectés par calcul{etat.kind === "ok" && etat.ouverts > 0 ? ` (${etat.ouverts})` : ""}
      </h3>
      {etat.kind === "echec" ? (
        <p className="text-xs text-ink-soft" data-testid="constats-detectes-etat">
          Détection horaire : lecture en échec (rien n&apos;est affirmé sur la période).
        </p>
      ) : etat.kind === "absent" ? (
        <p className="text-xs text-ink-soft" data-testid="constats-detectes-etat">
          Détection horaire : pas encore en place sur cette base.
        </p>
      ) : etat.cartes.length === 0 ? (
        <p className="min-w-0 text-xs text-ink-soft [overflow-wrap:anywhere]" data-testid="constats-detectes-etat">
          Aucun épisode ouvert hors de la plage habituelle sur la période (règle : plus de 3 écarts robustes deux heures de suite)
          {etat.clos > 0 ? ` ; ${etat.clos === 1 ? "un épisode clos, marqué" : `${etat.clos} épisodes clos, marqués`} sur le graphique` : ""}.
        </p>
      ) : (
        <>
          <ol className="flex min-w-0 flex-col gap-2">
            {etat.cartes.map((c) => (
              <Carte key={c.id} c={c} />
            ))}
          </ol>
          {(etat.ouverts > etat.cartes.length || etat.clos > 0) && (
            <p className="mt-1 min-w-0 text-xs text-ink-soft [overflow-wrap:anywhere]">
              {etat.ouverts > etat.cartes.length ? `${etat.cartes.length} sur ${etat.ouverts} constats ouverts, par priorité.` : ""}
              {etat.clos > 0 ? ` ${etat.clos === 1 ? "Un épisode clos" : `${etat.clos} épisodes clos`} sur la période, marqué${etat.clos > 1 ? "s" : ""} sur le graphique.` : ""}
            </p>
          )}
        </>
      )}
    </section>
  );
}
