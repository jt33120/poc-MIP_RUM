// Le DOSSIER TECHNIQUE (/presentation/dossier) : le détail vérifiable que la
// présentation résume — ce qu'il contient, ce qu'il sait faire (et ses limites), ce
// qui reste pour un vrai outil de RUM, puis le registre des capacités et les
// spécifications.
//
// Séparé de la vitrine par la recette du 26/09/2026 : une DSI lit la présentation en
// deux minutes ; une équipe technique vient ici vérifier. Les garanties de l'ancienne
// page publique suivent le contenu : chaque carte, chaque point et le registre sont
// toujours confrontés au document de couverture par les tests (couverture-site,
// SaitFaire, Reste, Annexe, e2e presentation.spec.ts).
//
// Le dossier ne redit pas l'hébergement : il renvoie au tableau de la présentation.
import Link from "next/link";
import { Ancres } from "@/components/presentation/Ancres";
import { Annexe } from "@/components/presentation/Annexe";
import { EnTete, Pied } from "@/components/presentation/Cadre";
import { Contient } from "@/components/presentation/Contient";
import { Actions } from "@/components/presentation/Landing";
import { Releve } from "@/components/presentation/Releve";
import { Reste } from "@/components/presentation/Reste";
import { SaitFaire } from "@/components/presentation/SaitFaire";
import type { SessionUser } from "@/lib/auth";

const LIEN = "font-medium text-ink underline decoration-line underline-offset-2 hover:decoration-ink";

export function Dossier({ user, demoOuverte }: { user: SessionUser | null; demoOuverte?: boolean }) {
  return (
    <div id="haut" className="mip-sci flex min-h-screen flex-col">
      <EnTete>
        <Actions size="sm" user={user} demoOuverte={demoOuverte} />
      </EnTete>

      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:py-14">
          <Link href="/presentation" className={`text-sm ${LIEN}`}>
            ← Présentation
          </Link>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-ink sm:text-4xl">Dossier technique</h1>
          <p className="mt-4 max-w-3xl text-lg leading-relaxed text-ink-soft">
            Le détail vérifiable du POC : ce qu&apos;il contient, ce qu&apos;il sait faire et ses limites,
            ce qui reste à faire, puis le registre des capacités et les spécifications.
          </p>
          <Releve />
        </div>

        <Ancres />
        <Contient user={user} demoOuverte={demoOuverte} />
        <SaitFaire />
        <Reste />
        <Annexe />

        <p className="mx-auto max-w-6xl px-4 pb-10 text-sm sm:px-6">
          <a href="#haut" className={LIEN}>
            ↑ Haut de page
          </a>
        </p>
      </main>

      <Pied />
    </div>
  );
}
