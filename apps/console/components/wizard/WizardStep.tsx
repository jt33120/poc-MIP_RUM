// Primitives présentationnelles du wizard d'onboarding client (badge d'état +
// section numérotée). Extraites de app/admin/customers/[appId]/page.tsx.
import type { ReactNode } from "react";
import type { StepState } from "@/lib/onboarding";

/** Badge d'état d'une case de la checklist d'onboarding (fait / en attente). */
export function WizardBadge({ state, children }: { state: StepState; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        state === "done" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
      }`}
    >
      {state === "done" ? "✅" : "⏳"} {children}
    </span>
  );
}

/** Section numérotée du wizard (étape N + titre + contenu). */
export function WizardStep({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}
