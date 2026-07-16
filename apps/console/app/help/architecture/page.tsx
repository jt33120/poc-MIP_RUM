// Page de référence « Architecture & fonctionnement » — la source de vérité que
// l'assistant IA CITE. Chaque carte porte une ancre (#id) : une citation [n] de
// l'assistant pointe vers /help/architecture#<id>, où le fait est écrit
// littéralement. Rendue depuis le MÊME corpus (lib/assistant-kb) que les sources
// de l'assistant, donc texte affiché == texte cité, par construction.
import type { Metadata } from "next";
import { KB_GROUPS, cardsInGroup } from "@/lib/assistant-kb";

export const metadata: Metadata = {
  title: "Architecture & fonctionnement — MIP RUM",
};

export default function ArchitecturePage() {
  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-8">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-line bg-panel2 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          Référence produit
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          Architecture &amp; fonctionnement
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">
          Comment MIP RUM est construit, de la collecte navigateur jusqu&apos;au stockage
          souverain. Cette page est aussi la référence que l&apos;assistant IA cite : chaque
          réponse renvoie ici, à la section exacte d&apos;où vient l&apos;information.
        </p>
      </header>

      <nav className="mb-10 flex flex-wrap gap-2" aria-label="Sommaire">
        {KB_GROUPS.map((g) => (
          <a
            key={g}
            href={`#grp-${slug(g)}`}
            className="rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-medium text-ink-soft transition hover:border-accent/40 hover:text-ink"
          >
            {g}
          </a>
        ))}
      </nav>

      <div className="flex flex-col gap-12">
        {KB_GROUPS.map((group) => {
          const cards = cardsInGroup(group);
          if (!cards.length) return null;
          return (
            <section key={group} id={`grp-${slug(group)}`} className="scroll-mt-20">
              <h2 className="mb-4 border-b border-line pb-2 text-sm font-semibold uppercase tracking-[0.14em] text-ink-faint">
                {group}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {cards.map((c) => (
                  <article
                    key={c.id}
                    id={c.id}
                    className="scroll-mt-20 rounded-xl border border-line bg-panel p-4 shadow-card"
                  >
                    <h3 className="mb-1.5 text-sm font-semibold text-ink">{c.title}</h3>
                    <p className="text-[13px] leading-relaxed text-ink-soft">{c.body}</p>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <p className="mt-12 rounded-xl border border-line bg-panel2 p-4 text-xs leading-relaxed text-ink-faint">
        Les questions sur <strong className="text-ink-soft">vos données</strong> (sessions,
        erreurs, santé…) sont, elles, citées directement vers la page de la console qui affiche
        le chiffre — vous cliquez sur la source et vous voyez la donnée en direct.
      </p>
    </div>
  );
}

/** Slug d'ancre stable pour un titre de groupe (sans dépendance). */
function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
