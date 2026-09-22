// Vocabulaire unique des états d'une surface (F02, § 3.8 et § 4.2 du plan).
//
// POURQUOI UN SEUL COMPOSANT. Chaque écran écrivait son propre « Pas de données »,
// et le même gris servait à dire trois choses opposées : rien ne s'est passé (vide
// réel), rien n'a pu être lu (lecture en échec), rien n'est collecté (capacité
// absente). Lu de loin, les trois se confondent — et un « 0 » affiché pendant une
// panne passe pour du calme. Ici, chaque état a SON texte, SON rôle ARIA et SA
// teinte, et aucun ne peut se lire comme un autre.
//
// Composant de rendu pur (SSR) : aucune lecture, aucun état React. Le bouton
// « Réessayer » de l'état `erreur` n'est PAS ici : il vit dans `SectionErreur`
// (client), la seule qui sait relancer le rendu.
import Link from "next/link";
import type { ReactNode } from "react";

export type Etat =
  | {
      kind: "vide";
      /** Groupe nominal accordé avec « Aucune » : « session commencée », « mesure LCP »… */
      population: string;
      plage: string;
      geste?: { libelle: string; href: string };
      /** P*.2 : ce que le zéro exclut, à 95 % (« Aucune erreur sur 210 sessions… »). */
      borne?: string;
    }
  | { kind: "partiel"; raison: string }
  | { kind: "erreur"; titre: string; digest?: string }
  | { kind: "non_collecte"; manque: string }
  | {
      kind: "echantillonne";
      /** Plus petite probabilité d'inclusion de la population ; null = inconnue. */
      probaMin: number | null;
      unite: string;
      biaiseErreurs?: boolean;
      sansTaux?: number;
    }
  | { kind: "chargement"; titre: string };

const NBSP = "\u00a0";

/** Rôle ARIA de chaque état (§ 4.2) : une annonce, une note, ou une alerte. */
export const ROLE_ETAT: Record<Etat["kind"], "status" | "note" | "alert"> = {
  chargement: "status",
  vide: "status",
  partiel: "note",
  echantillonne: "note",
  non_collecte: "note",
  erreur: "alert",
};

type Ton = "erreur" | "attention" | "neutre";

const TONS: Record<Ton, string> = {
  erreur: "border-bad/30 bg-bad/5 text-ink",
  attention: "border-warn/40 bg-warn/10 text-ink-soft",
  neutre: "border-line bg-panel2/60 text-ink-soft",
};

/**
 * Le cadre commun des états. Exporté pour les composants d'état qui existaient
 * avant F02 (`FilterProblemNotice`, `CapaciteFermee`, `TousEteints`,
 * `ExperienceUnavailable`) : ils gardent leur texte et leur API, mais sont rendus
 * dans le même cadre que `EtatSurface` — une teinte de bord par sens, pas une
 * mise en forme par écran.
 */
export function CadreEtat({
  ton,
  role,
  compact = false,
  testId,
  etat,
  className = "",
  children,
}: {
  ton: Ton;
  role: "status" | "note" | "alert";
  compact?: boolean;
  testId?: string;
  /** Valeur de `data-etat`, lue par les tests e2e. */
  etat?: string;
  className?: string;
  children: ReactNode;
}) {
  const taille = compact ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm";
  return (
    <div
      role={role}
      data-testid={testId}
      data-etat={etat}
      className={`rounded-lg border leading-relaxed ${taille} ${TONS[ton]} ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * « au moins p % » : arrondi VERS LE BAS, jamais au plus proche. Une probabilité
 * de 0,9996 ne doit pas s'écrire « 100 % » : elle dirait que rien n'a été écarté.
 */
export function pctAuMoins(p: number): string {
  const pct = p * 100;
  const decimales = pct >= 1 ? 1 : pct >= 0.1 ? 2 : 3;
  const facteur = 10 ** decimales;
  const v = Math.floor(pct * facteur) / facteur;
  return `${v.toLocaleString("fr-FR", { maximumFractionDigits: decimales })}${NBSP}%`;
}

/** Une probabilité d'inclusion qui dit quelque chose : strictement entre 0 et 1. */
function probaConnue(p: number | null): p is number {
  return p != null && Number.isFinite(p) && p > 0 && p < 1;
}

export function EtatSurface({ etat, compact = false }: { etat: Etat; compact?: boolean }) {
  const role = ROLE_ETAT[etat.kind];
  const testId = `etat-${etat.kind}`;

  switch (etat.kind) {
    case "chargement":
      return (
        <div role={role} aria-busy="true" data-testid={testId} data-etat={etat.kind}>
          <span className="sr-only">Chargement de {etat.titre}</span>
          <div
            aria-hidden="true"
            className={`w-full rounded-lg bg-panel2 motion-safe:animate-pulse ${compact ? "h-6" : "h-40"}`}
          />
        </div>
      );

    case "vide":
      return (
        <CadreEtat ton="neutre" role={role} compact={compact} testId={testId} etat={etat.kind} className="text-center">
          <p>
            Aucune {etat.population} sur {etat.plage}.
          </p>
          {etat.borne && <p className="mt-1 text-ink-soft">{etat.borne}</p>}
          {etat.geste && (
            <Link
              href={etat.geste.href}
              className="mt-2 inline-block font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
            >
              {etat.geste.libelle}
            </Link>
          )}
        </CadreEtat>
      );

    case "partiel":
      return (
        <CadreEtat ton="attention" role={role} compact={compact} testId={testId} etat={etat.kind}>
          <p>
            <strong className="font-semibold text-ink">Partiel{NBSP}:</strong> {etat.raison}
          </p>
        </CadreEtat>
      );

    case "erreur":
      return (
        <CadreEtat ton="erreur" role={role} compact={compact} testId={testId} etat={etat.kind}>
          <p>
            <strong className="font-semibold text-bad">Lecture en échec.</strong> La lecture de «{NBSP}
            {etat.titre}
            {NBSP}» a échoué. Les autres blocs restent valides.
          </p>
          {etat.digest && <p className="mt-1 font-mono text-[11px] text-ink-soft">Référence{NBSP}: {etat.digest}</p>}
        </CadreEtat>
      );

    case "non_collecte":
      // Jamais de borne ici : rien n'est collecté, donc rien n'est borné.
      return (
        <CadreEtat ton="neutre" role={role} compact={compact} testId={testId} etat={etat.kind}>
          <p>
            <strong className="font-semibold text-ink">Non collecté{NBSP}:</strong> {etat.manque}
          </p>
        </CadreEtat>
      );

    case "echantillonne": {
      const sansTaux = etat.sansTaux != null && etat.sansTaux > 0 ? etat.sansTaux : 0;
      return (
        <CadreEtat ton="neutre" role={role} compact={compact} testId={testId} etat={etat.kind}>
          <p>
            <strong className="font-semibold text-ink">Échantillonné{NBSP}:</strong>{" "}
            {probaConnue(etat.probaMin)
              ? `chaque ${etat.unite} avait au moins ${pctAuMoins(etat.probaMin)} de chances d'être retenue`
              : // Inconnue n'est pas « toutes » : jamais « 100 % » par défaut (V3, V4).
                `probabilité d'inclusion de chaque ${etat.unite} inconnue`}{" "}
            ; comptes observés, non extrapolés.
          </p>
          {etat.biaiseErreurs && (
            <p className="mt-1">
              Les sessions avec erreur sont sur-représentées{NBSP}: une part de sessions en erreur calculée ici est
              surestimée.
            </p>
          )}
          {sansTaux > 0 && (
            <p className="mt-1">
              {sansTaux.toLocaleString("fr-FR")} {sansTaux > 1 ? "sessions commencées" : "session commencée"} avant le
              09/09/2026{NBSP}: probabilité d&apos;inclusion non enregistrée.
            </p>
          )}
        </CadreEtat>
      );
    }
  }
}
