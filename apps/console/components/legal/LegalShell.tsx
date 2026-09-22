import Link from "next/link";
import type { ReactNode } from "react";
import { LEGAL_UPDATED } from "@/lib/legal";
import { PrintButton } from "./PrintButton";

// Coquille commune des pages légales : bandeau « modèle à compléter/relire »,
// titre, date de mise à jour, retour au sommaire, styles d'impression.
export function LegalShell({
  title,
  intro,
  printable = false,
  children,
}: {
  title: string;
  intro?: ReactNode;
  printable?: boolean;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-ink">
      {/* Bandeau d'honnêteté : ces documents sont des MODÈLES. Non masqué à l'impression
          du DPA volontairement retiré via print:hidden pour un rendu signable propre. */}
      <div className="mb-8 rounded-lg border border-warn/40 bg-warn/5 px-4 py-3 text-sm text-ink-soft print:hidden">
        <strong className="text-warn-ink">Modèle à compléter et à faire valider.</strong> Les champs entre
        crochets <code>[…]</code> doivent être renseignés (raison sociale, SIREN, adresse, contact DPO…). Ce
        document est un modèle de départ&nbsp;; il doit être <strong>relu par un conseil juridique</strong> avant
        toute mise en production ou signature.
      </div>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint print:hidden">
            <Link href="/legal" className="hover:text-ink">
              ← Documents légaux
            </Link>
          </p>
          <h1 className="mt-1 text-2xl font-bold">{title}</h1>
          <p className="mt-1 text-sm text-ink-faint">Dernière mise à jour : {LEGAL_UPDATED}</p>
        </div>
        {printable && <PrintButton />}
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
