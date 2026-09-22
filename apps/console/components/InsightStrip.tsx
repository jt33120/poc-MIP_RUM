// Constats automatiques (F08, plan § 4.2) — SSR. Le pendant honnête des « Watchdog
// Insights » : chaque constat porte la RÈGLE qui l'a produit (« z-score > 3 sur la
// moyenne horaire des 7 derniers jours »), jamais une « cause suspectée ».
//
// Trois décisions :
//
//   1. REPLIÉ PAR DÉFAUT, LE COMPTE EN TÊTE. La bande ne pousse pas le hero sous le
//      pli ; « Constats (3) » se lit sans l'ouvrir.
//   2. ZÉRO CONSTAT EST UNE INFORMATION. Une ligne « Aucun constat automatique
//      (règles : …) » est rendue, jamais un bandeau caché : sans elle, on ne sait pas
//      si rien n'a été trouvé ou si rien n'a été cherché.
//   3. LES STATUTS DES DÉTECTEURS (P*.3) SONT TOUJOURS VISIBLES. Un détecteur qui n'a
//      pas pu tester (trop peu d'historique) le dit, même quand la liste est repliée.
//
// Aucun lien ne porte `fired=` : c'est le NOMBRE d'alertes émises par « Évaluer
// maintenant », pas un identifiant (§ 3.1). Une alerte précise se désigne par `evt`.
import Link from "next/link";

export type TypeConstat = "anomalie" | "regression" | "alerte" | "erreur_nouvelle" | "surrepresentation" | "rupture";

export interface Constat {
  type: TypeConstat;
  /** « LCP /checkout : 4,8 s à 14 h (moyenne 7 j : 2,1 s) » */
  titre: string;
  /** « z-score > 3 sur la moyenne horaire des 7 derniers jours » */
  regle: string;
  href: string;
}

export interface StatutDetecteur {
  detecteur: string;
  etat: "teste" | "non_testable";
  raison: string;
}

const LIBELLE_TYPE: Record<TypeConstat, string> = {
  anomalie: "Anomalie",
  regression: "Régression",
  alerte: "Alerte",
  erreur_nouvelle: "Erreur nouvelle",
  surrepresentation: "Sur-représentation",
  rupture: "Rupture",
};

/** La phrase du zéro constat : ce qui a été cherché, et que rien n'a été trouvé. */
export function phraseAucunConstat(regles: readonly string[]): string {
  return regles.length
    ? `Aucun constat automatique (règles : ${regles.join(" ; ")}).`
    : "Aucun constat automatique (aucune règle évaluée sur cet écran).";
}

function Statuts({ statuts }: { statuts: StatutDetecteur[] }) {
  return (
    <ul className="mt-2 flex flex-col gap-0.5 text-xs text-ink-soft" data-testid="constats-statuts">
      {statuts.map((s) => (
        <li key={s.detecteur} className="min-w-0 break-words">
          <span className="font-medium text-ink">{s.detecteur}</span> :{" "}
          {s.etat === "teste" ? "testé" : "non testable"} — {s.raison}
        </li>
      ))}
    </ul>
  );
}

export function InsightStrip({
  constats,
  regles,
  statuts,
  fenetre,
  ouvertParDefaut = false,
}: {
  constats: Constat[];
  /**
   * Règles évaluées sur l'écran, citées quand il n'y a aucun constat (« z > 3 sur
   * 24 h », « +20 % ou plus, ±2 h »…). Ajout F08 : une liste vide de constats ne
   * dit pas quelles règles ont été cherchées.
   */
  regles: string[];
  statuts?: StatutDetecteur[];
  /** « 24 h fixes » si la fenêtre des constats diffère de la plage de l'écran. */
  fenetre: string;
  ouvertParDefaut?: boolean;
}) {
  const aStatuts = !!statuts && statuts.length > 0;

  if (constats.length === 0) {
    return (
      <div className="card min-w-0 px-4 py-3" data-testid="constats" data-compte={0}>
        <p className="min-w-0 break-words text-sm text-ink-soft" role="note" data-testid="constats-aucun">
          <span className="font-semibold text-ink">Constats (0)</span> · {fenetre} · {phraseAucunConstat(regles)}
        </p>
        {aStatuts && <Statuts statuts={statuts} />}
      </div>
    );
  }

  return (
    <div className="card min-w-0 px-4 py-3" data-testid="constats" data-compte={constats.length}>
      <details open={ouvertParDefaut || undefined}>
        <summary className="cursor-pointer text-sm">
          <span className="font-semibold text-ink">Constats ({constats.length})</span>
          <span className="text-ink-soft"> · {fenetre}</span>
        </summary>
        <ul className="mt-2 flex flex-col divide-y divide-line/60">
          {constats.map((c, i) => (
            <li key={`${c.type}-${i}`} className="min-w-0 py-2" data-testid="constat">
              <span className="mr-2 inline-block rounded border border-line px-1.5 py-px text-[11px] font-medium text-ink-soft">
                {LIBELLE_TYPE[c.type]}
              </span>
              <Link href={c.href} className="break-words font-medium text-perf underline-offset-2 hover:underline">
                {c.titre}
              </Link>
              <span className="mt-0.5 block break-words text-xs text-ink-soft">Règle : {c.regle}</span>
            </li>
          ))}
        </ul>
      </details>
      {aStatuts && <Statuts statuts={statuts} />}
    </div>
  );
}
