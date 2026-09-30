// La vitrine PUBLIQUE (/presentation), refondue le 30/09/2026 pour la démo : droit au
// but, trois écrans.
//
//   1. le film d'accueil (FilmAccueil) : le produit en quinze secondes ;
//   2. deux entrées (Entrees) : le compte démo, ou la connexion et l'inscription ;
//   3. l'aperçu défilant (ApercuDefilant) : la console, capture après capture.
//
// Le texte de la vitrine précédente n'est pas perdu : il est archivé dans
// archive/LandingArchive.tsx (/presentation/archive), en attendant sa nouvelle place.
//
// Toujours en thème sombre (classe `dark` sur la racine de la page) : le film et
// l'aperçu sont pensés sur le marine de MIP, quel que soit le thème de la console. Le
// pied de page reste celui de toutes les pages publiques (Cadre.tsx) : il porte
// l'attribution de la base GeoIP, que sa licence veut visible.
import Link from "next/link";
import { BrandMark, Pied } from "@/components/presentation/Cadre";
import { ApercuDefilant } from "@/components/presentation/vitrine/ApercuDefilant";
import { Entrees } from "@/components/presentation/vitrine/Entrees";
import { FilmAccueil } from "@/components/presentation/vitrine/FilmAccueil";
import type { SessionUser } from "@/lib/auth";
import { ETAPES_APERCU, FILM_ACCUEIL } from "@/lib/vitrine";

export function Landing({ user, demoOuverte }: { user: SessionUser | null; demoOuverte: boolean }) {
  return (
    <div className="dark vitrine min-h-screen bg-[#040a1c] text-ink [color-scheme:dark]">
      <main>
        <FilmAccueil
          film={FILM_ACCUEIL}
          suite="entrer"
          entete={
            <Link href="/presentation" aria-label="MIP RUM — présentation">
              <BrandMark />
            </Link>
          }
        />
        <Entrees id="entrer" user={user} demoOuverte={demoOuverte} />
        <ApercuDefilant etapes={ETAPES_APERCU} />
      </main>
      <Pied />
    </div>
  );
}
