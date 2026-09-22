import Link from "next/link";
import { LEGAL_DOCS, LEGAL_UPDATED } from "@/lib/legal";

export const dynamic = "force-static";

export const metadata = {
  title: "MIP RUM — Documents légaux",
  description: "CGU, CGV et politique de confidentialité.",
};

export default function LegalHub() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-ink">
      <h1 className="text-2xl font-bold">Documents légaux</h1>
      <p className="mt-2 text-sm text-ink-faint">Mise à jour : {LEGAL_UPDATED}</p>

      <div className="mt-4 rounded-lg border border-warn/40 bg-warn/5 px-4 py-3 text-sm text-ink-soft">
        <strong className="text-warn">Modèles à compléter et à faire valider par un conseil juridique.</strong>{" "}
        Les champs entre crochets <code>[…]</code> (raison sociale, SIREN, adresse, DPO…) sont à renseigner avant
        toute mise en production.
      </div>

      <ul className="mt-8 space-y-3">
        {LEGAL_DOCS.map((d) => (
          <li key={d.slug}>
            <Link
              href={`/legal/${d.slug}`}
              className="block rounded-xl border border-line bg-panel p-4 transition hover:border-accent/40 hover:shadow-pop"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-ink">{d.title}</span>
                <span className="text-accent-deep dark:text-accent">→</span>
              </div>
              <p className="mt-1 text-sm text-ink-faint">{d.desc}</p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
