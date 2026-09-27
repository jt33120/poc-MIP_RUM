import Link from "next/link";
import { LegalShell } from "@/components/legal/LegalShell";
import { LEGAL_DOCS } from "@/lib/legal";

export const dynamic = "force-static";

export const metadata = {
  title: "MIP RUM — Documents légaux",
  description: "CGU, CGV, politique de confidentialité et politique de l'extension navigateur.",
};

// L'index se rend dans la même coquille que les documents : même en-tête, même
// bandeau « modèle », au même endroit (recette du 26/09/2026).
export default function LegalHub() {
  return (
    <LegalShell title="Documents légaux" sommaire>
      <ul className="space-y-3">
        {LEGAL_DOCS.map((d) => (
          <li key={d.href}>
            <Link
              href={d.href}
              className="block rounded-xl border border-line bg-panel p-4 transition hover:border-accent/40 hover:shadow-pop"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-ink">{d.title}</span>
                <span className="text-accent-ink" aria-hidden="true">
                  →
                </span>
              </div>
              <p className="mt-1 text-sm text-ink-faint">{d.desc}</p>
            </Link>
          </li>
        ))}
      </ul>
    </LegalShell>
  );
}
