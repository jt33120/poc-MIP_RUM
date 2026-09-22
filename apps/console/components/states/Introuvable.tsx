// Page « introuvable » d'un détail (F02, § 3.8 règle 4) : le corps commun des
// `not-found.tsx` en français. Remplace le 404 anglais de Next (« This page could
// not be found »), qui ne disait ni POURQUOI ni OÙ repartir.
//
// Le texte ne distingue JAMAIS « n'existe pas » de « existe hors de votre
// périmètre » : le dire révélerait qu'un identifiant d'un autre tenant est réel.
// Les causes possibles sont donc énumérées ensemble, dans une seule phrase.
import Link from "next/link";
import { CadreEtat } from "./EtatSurface";

export function Introuvable({
  titre,
  message,
  retour,
}: {
  titre: string;
  message: string;
  retour: { href: string; libelle: string };
}) {
  return (
    <section className="animate-fade-up" data-testid="introuvable">
      <h1 className="mb-4 text-xl font-bold tracking-tight text-ink">{titre}</h1>
      <CadreEtat ton="neutre" role="status" etat="introuvable" className="max-w-2xl">
        <p>{message}</p>
        <Link
          href={retour.href}
          className="mt-3 inline-block font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
        >
          {retour.libelle}
        </Link>
      </CadreEtat>
    </section>
  );
}
