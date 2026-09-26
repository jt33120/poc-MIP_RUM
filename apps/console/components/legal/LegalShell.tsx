import Link from "next/link";
import type { ReactNode } from "react";
import { ICON_PATHS, Icon } from "@/components/icons";
import { LEGAL_UPDATED } from "@/lib/legal";
import { PrintButton } from "./PrintButton";

// Coquille commune des pages légales — l'index /legal, les trois documents ET la
// politique de l'extension (/extension-privacy) : même en-tête, même bandeau
// « modèle à compléter », au même endroit.
//
// POURQUOI UN EN-TÊTE AVEC LA MARQUE. Ces pages se rendent sans la coquille de la
// console (lib/chemins-publics.ts) : rien n'y ramenait un utilisateur connecté, et
// la politique de l'extension n'avait ni logo ni lien vers les autres documents
// (recette du 26/09/2026). La marque mène à « / » : la console pour qui est
// connecté, la vitrine pour les autres (middleware.ts).
//
// POURQUOI LE BANDEAU SOUS LE TITRE. Il passait AVANT le fil d'Ariane et le titre
// sur les documents, APRÈS sur l'index : deux lectures pour la même mise en garde.

/** Marque MIP RUM, réduite à l'en-tête d'un document. */
function Marque() {
  return (
    <span className="flex items-center gap-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent-deep">
        <Icon paths={ICON_PATHS.activity} className="h-4 w-4 text-white" strokeWidth={2.4} />
      </span>
      <span className="text-sm font-bold tracking-tight text-ink">
        MIP <span className="text-accent">RUM</span>
      </span>
    </span>
  );
}

/** Bandeau d'honnêteté : ces documents sont des MODÈLES, masqué à l'impression. */
export function BandeauModele() {
  return (
    <div
      role="note"
      data-testid="legal-bandeau-modele"
      className="rounded-lg border border-warn/40 bg-warn/5 px-4 py-3 text-sm text-ink-soft print:hidden"
    >
      <strong className="text-warn-ink">Modèle à compléter et à faire valider.</strong> Les champs entre
      crochets <code>[…]</code> doivent être renseignés (raison sociale, SIREN, adresse, contact du délégué à la
      protection des données, conditions commerciales…). Ce document est un modèle de départ&nbsp;; il doit être{" "}
      <strong>relu par un conseil juridique</strong> avant toute mise en production ou signature.
    </div>
  );
}

export function LegalShell({
  title,
  intro,
  printable = false,
  sommaire = false,
  children,
}: {
  title: string;
  intro?: ReactNode;
  printable?: boolean;
  /** L'index lui-même : pas de lien « Documents légaux » vers la page où l'on est. */
  sommaire?: boolean;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 text-ink sm:px-6 sm:py-10">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4 print:hidden">
        <Link href="/" aria-label="MIP RUM — accueil" className="rounded-lg">
          <Marque />
        </Link>
        {!sommaire && (
          <Link href="/legal" className="text-sm text-ink-soft hover:text-ink">
            ← Documents légaux
          </Link>
        )}
      </header>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="mt-1 text-sm text-ink-faint">Dernière mise à jour&nbsp;: {LEGAL_UPDATED}</p>
        </div>
        {printable && <PrintButton />}
      </div>

      <div className="mb-8">
        <BandeauModele />
      </div>

      {intro && <div className="mb-8 text-sm leading-relaxed text-ink-soft">{intro}</div>}

      <div className="legal-body space-y-6 text-sm leading-relaxed">{children}</div>
    </main>
  );
}

// Sous-titre de section, réutilisé par tous les documents.
export function LegalSection({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-base font-semibold text-ink">
        {n}. {title}
      </h2>
      <div className="space-y-2 text-ink-soft">{children}</div>
    </section>
  );
}

/** Lien interne entre documents légaux, un seul style. */
export function LienLegal({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-accent-ink underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}
