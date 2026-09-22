"use client";
// Frontière d'erreur d'une SECTION d'écran (F02, § 3.8 et § 4.2 du plan).
//
// POURQUOI PAR SECTION. Une seule frontière par route (`error.tsx`) remplace tout
// l'écran quand une figure casse : le hero, les tuiles et les tables encore
// justes disparaissent avec elle. Autour de chaque section, une frontière garde
// la panne locale — la section dit « Lecture en échec » et propose de réessayer,
// les autres restent lisibles.
//
// Deux chemins mènent à l'état « erreur » d'une section, et ils rendent le MÊME
// bloc (`EchecLecture`) :
//   - la lecture a échoué (`lire()` → `{ ok: false }`) : la page rend
//     `<EchecLecture titre=… />` à la place de la section, côté serveur ;
//   - le RENDU a levé (un composant client qui casse, une donnée inattendue) :
//     `SectionErreur` l'attrape. Elle n'affiche alors AUCUNE valeur partielle de
//     la section — un chiffre sur deux se lirait comme un résultat.
//
// La `Suspense` intérieure n'est pas décorative : pendant le rendu serveur, React
// ne sait pas s'arrêter sur une frontière d'erreur ; une exception y remonte
// jusqu'à la `Suspense` la plus proche, qui passe la section en rendu client — où
// la frontière, elle, l'attrape. Sans elle, la panne d'une section ferait échouer
// le rendu serveur de tout l'écran.
import { useRouter } from "next/navigation";
import { Component, Suspense, useTransition, type ErrorInfo, type ReactNode } from "react";
import { EtatSurface } from "./EtatSurface";

export function SectionErreur({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <Frontiere titre={titre}>
      <Suspense fallback={<EtatSurface etat={{ kind: "chargement", titre }} />}>{children}</Suspense>
    </Frontiere>
  );
}

/**
 * L'état « erreur » d'une section, bouton compris. Rendu par `SectionErreur` quand
 * le rendu lève, et par la page quand la lecture de la section a échoué.
 */
export function EchecLecture({
  titre,
  digest,
  compact,
  onReset,
}: {
  titre: string;
  digest?: string;
  compact?: boolean;
  /** Remet la frontière à zéro une fois le rendu serveur relancé. */
  onReset?: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-2" data-testid="echec-lecture">
      <div className="w-full">
        <EtatSurface etat={{ kind: "erreur", titre, digest }} compact={compact} />
      </div>
      <Reessayer onReset={onReset} />
    </div>
  );
}

/**
 * « Réessayer » relance le rendu SERVEUR de la page (`router.refresh()`) : les
 * lectures sont refaites, l'état client (défilement, champs saisis) est gardé.
 * La remise à zéro de la frontière est dans la MÊME transition, sinon elle
 * réafficherait les enfants en échec avant que la nouvelle réponse n'arrive.
 */
export function Reessayer({ onReset }: { onReset?: () => void }) {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();
  return (
    <button
      type="button"
      className="btn-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
      disabled={enCours}
      aria-busy={enCours || undefined}
      onClick={() =>
        demarrer(() => {
          router.refresh();
          onReset?.();
        })
      }
    >
      {enCours ? "Nouvelle lecture…" : "Réessayer"}
    </button>
  );
}

type EtatFrontiere = { erreur: (Error & { digest?: string }) | null };

class Frontiere extends Component<{ titre: string; children: ReactNode }, EtatFrontiere> {
  state: EtatFrontiere = { erreur: null };

  static getDerivedStateFromError(erreur: Error & { digest?: string }): EtatFrontiere {
    return { erreur };
  }

  componentDidCatch(erreur: Error, info: ErrorInfo) {
    // Côté navigateur : le serveur a déjà journalisé ses propres échecs (`lire`) ;
    // ceci trace le rendu client, capté par le capteur RUM de la console.
    console.error(`[section] « ${this.props.titre} » en échec`, erreur, info.componentStack);
  }

  private reinitialiser = () => this.setState({ erreur: null });

  render() {
    if (this.state.erreur) {
      return <EchecLecture titre={this.props.titre} digest={this.state.erreur.digest} onReset={this.reinitialiser} />;
    }
    return this.props.children;
  }
}
