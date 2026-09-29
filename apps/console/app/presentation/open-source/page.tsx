// Page « Composants open source » (/presentation/open-source) : les dépendances, images,
// actions, agents et données de tiers dont le produit se sert, pour qu'on puisse les
// vérifier (demande du propriétaire du produit, 29/09/2026).
//
// Chemin PUBLIC, comme la vitrine et son dossier (lib/chemins-publics.ts) : lisible
// sans compte, jamais dans la coquille de la console. Page STATIQUE : ni session, ni
// base — tout vient du JSON généré (./inventaire.ts) et de lib/legal.ts, que les pages
// légales lisent déjà. Aucun chiffre n'est tapé ici : ils sont comptés sur le JSON.
//
// Les services hébergés ne sont pas redits : ce sont les sous-traitants de
// lib/legal.ts, la même liste que la politique de confidentialité.
import type { Metadata } from "next";
import Link from "next/link";
import { EnTete, Pied } from "@/components/presentation/Cadre";
import { DATA_SOURCES, SUBPROCESSORS } from "@/lib/legal";
import { Catalogue } from "./Catalogue";
import { CATEGORIES, COMPOSANTS, INVENTAIRE, ancreCategorie, licences, vigilance } from "./inventaire";

export const metadata: Metadata = { title: "MIP RUM — Composants open source" };

const LIEN = "font-medium text-ink underline decoration-line underline-offset-2 hover:decoration-ink";
const FORT = "font-semibold text-ink";

export default function ComposantsOpenSource() {
  const parLicence = licences();
  const aSurveiller = parLicence.filter((l) => vigilance(l.licence));
  return (
    <div id="haut" className="mip-sci flex min-h-screen flex-col">
      <EnTete />

      <main className="flex-1 pb-12">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:py-14">
          <Link href="/presentation" className={`text-sm ${LIEN}`}>
            ← Présentation
          </Link>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-ink sm:text-4xl">Composants open source</h1>
          <p className="mt-4 max-w-3xl text-lg leading-relaxed text-ink-soft">
            Ce que le produit emprunte à des projets tiers : bibliothèques, images de conteneur, actions de
            CI, agents recommandés aux clients et données. La liste est relevée dans les manifestes du dépôt,
            pas recopiée à la main ; chaque ligne renvoie au dépôt source, pour lire la licence et le code.
          </p>
          <p data-testid="open-source-releve" className="mt-5 max-w-3xl text-sm leading-relaxed text-ink-soft">
            Relevé du <strong className={FORT}>{INVENTAIRE.releveLe}</strong> :{" "}
            <strong className={FORT}>{COMPOSANTS.length}</strong> composants directs,{" "}
            <strong className={FORT}>{parLicence.length}</strong> licences distinctes. Avec leurs propres
            dépendances, l&apos;arbre npm compte <strong className={FORT}>{INVENTAIRE.paquetsDuLockfile}</strong>{" "}
            paquets, à titre indicatif.
          </p>

          <ul className="mt-5 flex flex-wrap gap-2" aria-label="Licences">
            {parLicence.map((l) => (
              <li
                key={l.licence}
                className={`rounded-md border px-2 py-1 font-mono text-xs ${
                  vigilance(l.licence) ? "border-warn/50 bg-warn/10 text-warn-ink" : "border-line bg-panel text-ink-soft"
                }`}
              >
                {l.licence} · {l.n}
              </li>
            ))}
          </ul>
          {aSurveiller.length > 0 && (
            <div className="card mt-5 max-w-3xl p-4" data-testid="open-source-vigilance">
              <h2 className="text-sm font-semibold text-ink">Licences à regarder de près</h2>
              <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-ink-soft">
                {aSurveiller.map((l) => (
                  <li key={l.licence}>
                    <span className="font-mono text-xs font-semibold text-warn-ink">{l.licence}</span> —{" "}
                    {vigilance(l.licence)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <nav aria-label="Catégories" className="mt-6">
            <ul className="flex flex-wrap gap-1">
              {INVENTAIRE.categories.map((id) => (
                <li key={id}>
                  <a
                    href={`#${ancreCategorie(id)}`}
                    className="block rounded-lg px-3 py-1.5 text-sm font-medium text-ink-soft transition hover:bg-panel2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
                  >
                    {CATEGORIES[id].titre}
                  </a>
                </li>
              ))}
              <li>
                <a
                  href="#os-heberges"
                  className="block rounded-lg px-3 py-1.5 text-sm font-medium text-ink-soft transition hover:bg-panel2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
                >
                  Services hébergés
                </a>
              </li>
            </ul>
          </nav>
        </div>

        <Catalogue />

        <section id="os-heberges" aria-labelledby="os-heberges-titre" className="mt-12 scroll-mt-6">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 id="os-heberges-titre" className="text-xl font-bold tracking-tight text-ink sm:text-2xl">
              Services hébergés (non open source)
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-soft">
              Le produit tourne aussi chez des hébergeurs, dont le code n&apos;est pas ouvert. Ce sont les
              sous-traitants que déclare la{" "}
              <Link href="/legal/confidentialite" className={LIEN}>
                politique de confidentialité
              </Link>
              , qui dit aussi où ils traitent les données et sous quelles garanties.
            </p>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2" data-testid="open-source-heberges">
              {SUBPROCESSORS.map((s) => (
                <li key={s.name} className="card p-4">
                  <p className="font-semibold text-ink">{s.name}</p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-soft">{s.role}</p>
                </li>
              ))}
            </ul>
            <p className="mt-6 max-w-3xl text-xs leading-relaxed text-ink-soft">
              {DATA_SOURCES.map((d) => (
                <span key={d.name}>
                  {d.name} ({d.licence}) :{" "}
                  <a href={d.url} className={LIEN} rel="noopener noreferrer">
                    {d.attribution}
                  </a>
                  .{" "}
                </span>
              ))}
            </p>
          </div>
        </section>

        <p className="mx-auto mt-10 max-w-6xl px-4 text-sm sm:px-6">
          <a href="#haut" className={LIEN}>
            ↑ Haut de page
          </a>
        </p>
      </main>

      <Pied />
    </div>
  );
}
