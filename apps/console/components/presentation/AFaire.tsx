// La page « À faire » (/presentation/a-faire) : d'abord les hypothèses réductrices du
// POC (lib/presentation-hypotheses.ts), puis les chantiers — « Ce qui reste pour un
// vrai outil de RUM » (Reste.tsx, repris tel quel de l'ancien dossier technique, avec
// ses garanties), et les chantiers d'exploitation. Rendu serveur, sans état.
import { Reste } from "@/components/presentation/Reste";
import { CHANTIERS, HYPOTHESES, RELEVE_HYPOTHESES } from "@/lib/presentation-hypotheses";

const LIGNES = [
  { cle: "aujourdhui", libelle: "Aujourd'hui" },
  { cle: "pourquoi", libelle: "Pourquoi ça tient" },
  { cle: "production", libelle: "En production" },
] as const;

function Sommaire() {
  const liens = [
    { href: "#hypotheses", libelle: "Hypothèses réductrices" },
    { href: "#reste-titre", libelle: "Ce qui reste pour un vrai outil" },
    { href: "#chantiers", libelle: "Chantiers d'exploitation" },
  ];
  return (
    <nav aria-label="Sommaire de la page" className="sticky top-16 z-30 border-y border-line bg-panel/85 backdrop-blur-md">
      <ul className="relative mx-auto flex max-w-6xl flex-wrap gap-1 overflow-x-auto px-4 py-2 sm:px-6">
        {liens.map((l) => (
          <li key={l.href}>
            <a href={l.href} className="block whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium text-ink-soft transition hover:bg-panel2 hover:text-ink">
              {l.libelle}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function AFaire() {
  return (
    <>
      <Sommaire />

      <section id="hypotheses" aria-labelledby="hypotheses-titre" className="scroll-mt-28">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:py-20">
          <header className="max-w-3xl">
            <h2 id="hypotheses-titre" className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              Hypothèses réductrices
            </h2>
            <p className="mt-3 leading-relaxed text-ink-soft">
              Ce que le POC a choisi petit, lent ou provisoire parce qu&apos;un POC le permet, et ce qu&apos;une mise en
              service changerait. Relevé du {RELEVE_HYPOTHESES}.
            </p>
          </header>
          <ol className="mt-10 grid gap-4 md:grid-cols-2" data-testid="hypotheses">
            {HYPOTHESES.map((h, i) => (
              <li key={h.id} className="min-w-0">
                <article data-testid="hypothese" data-id={h.id} aria-labelledby={`${h.id}-titre`} className="card flex h-full flex-col p-5">
                  <header className="flex items-baseline gap-2.5">
                    <span aria-hidden className="shrink-0 font-mono text-xs font-bold text-accent-ink">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <h3 id={`${h.id}-titre`} className="text-base font-bold leading-snug tracking-tight text-ink">
                      {h.titre}
                    </h3>
                  </header>
                  <dl className="mt-4 space-y-3 text-sm leading-relaxed">
                    {LIGNES.map(({ cle, libelle }) => (
                      <div key={cle}>
                        <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">{libelle}</dt>
                        <dd className={`mt-0.5 ${cle === "production" ? "text-accent-ink" : "text-ink"}`}>{h[cle]}</dd>
                      </div>
                    ))}
                  </dl>
                </article>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <Reste />

      <section id="chantiers" aria-labelledby="chantiers-titre" className="scroll-mt-28 border-t border-line">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:py-20">
          <header className="max-w-3xl">
            <h2 id="chantiers-titre" className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              Chantiers d&apos;exploitation
            </h2>
            <p className="mt-3 leading-relaxed text-ink-soft">
              Ce qui reste à faire sur la plateforme elle-même, dans l&apos;ordre où ça se fait.
            </p>
          </header>
          <ol className="mt-10 grid gap-3" data-testid="chantiers">
            {CHANTIERS.map((c, i) => (
              <li key={c.id} data-testid="chantier" data-id={c.id} className="card grid gap-1 p-5 sm:grid-cols-[3rem_minmax(0,16rem)_minmax(0,1fr)] sm:gap-4">
                <span aria-hidden className="font-mono text-xs font-bold text-accent-ink">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="text-sm font-bold text-ink">{c.titre}</h3>
                <p className="text-sm leading-relaxed text-ink-soft">{c.texte}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}
