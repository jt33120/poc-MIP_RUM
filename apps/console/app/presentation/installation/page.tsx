// « Installation » (/presentation/installation) : les trois façons de poser MIP RUM,
// lisibles sans compte ; chacune a sa page (components/presentation/installation/).
import type { Metadata } from "next";
import { OngletsInstallation } from "@/components/presentation/installation/OngletsInstallation";
import { SchemaInstallation } from "@/components/presentation/installation/SchemaInstallation";
import { PageVitrine } from "@/components/presentation/vitrine/PageVitrine";
import { getUser } from "@/lib/auth";
import { methodesConnexion } from "@/lib/methodes-connexion";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "MIP RUM — Installation" };

export default async function Installation() {
  const [user, methodes] = await Promise.all([getUser(), methodesConnexion()]);
  return (
    <PageVitrine
      connecte={user !== null}
      demoOuverte={methodes.demo}
      testId="page-installation"
      surtitre="Installation"
      titre={
        <>
          Comment installer le RUM
          <br />
          <span className="text-[#f89101]">sur votre application.</span>
        </>
      }
      chapeau={
        <>
          Côté navigateur, le SDK mesure ce que vivent vos visiteurs ; côté serveur, l&apos;agent OpenTelemetry relie
          chaque appel à sa part serveur. Survolez chaque côté pour voir les options.
        </>
      }
    >
      <OngletsInstallation courant="apercu" />
      <section className="mx-auto max-w-6xl px-4 pb-20 pt-12 sm:px-6">
        <SchemaInstallation />
        {/* Le prompt pour l'IA de code vit dans la console : il porte les valeurs de
            l'application, qu'une page publique ne connaît pas (lib/prompts-ia.ts). */}
        <div
          data-testid="annonce-prompt-ia"
          className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-[#f89101]/30 bg-[#f89101]/[0.08] px-5 py-4"
        >
          <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#f89101] text-[#040a1c]">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 4h6v3H9z" />
              <path d="M9 5.5H7a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h5" />
              <path d="M15 5.5h2a2 2 0 0 1 2 2V11" />
              <path d="M17.5 14l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z" fill="currentColor" />
            </svg>
          </span>
          <p className="min-w-0 flex-1 text-sm leading-relaxed text-white/80">
            <strong className="font-semibold text-white">Installation assistée par IA.</strong> Dans la console, chaque parcours
            se copie en un prompt pour votre IA de code (Claude Code, Cursor, Copilot…), avec les valeurs de votre
            application : elle installe, vous relisez.
          </p>
          {/* <a> : la console a sa propre coquille, qu'une navigation client ne monterait pas. */}
          <a href="/installer" className="rounded-full bg-[#f89101] px-4 py-2 text-sm font-semibold text-[#040a1c] transition hover:brightness-110">
            Ouvrir dans la console →
          </a>
        </div>
        <p className="mt-8 text-sm text-white/60">
          Connecté, la page <strong className="font-semibold text-white/85">Installer</strong> de la console reprend ces
          parcours avec les valeurs de votre application, et un test en direct qui passe au vert quand les données
          arrivent.
        </p>
      </section>
    </PageVitrine>
  );
}
