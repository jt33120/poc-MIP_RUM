// Vitrine — F50 : le flux `Sankey` et l'entonnoir `FunnelChart` de `/paths`
// (plan § 4.1, § 5.13). Données FIXES écrites ici, passées par les mêmes fonctions
// pures que l'écran (`buildSankey`, `computeFunnel`) : aucune lecture en base.
//
// Fichier propre au lot (les lots d'une même vague ajoutent chacun le leur) : la
// page n'en porte que l'import et une ligne de rendu.
import { FunnelChart } from "@/components/Funnel";
import { Sankey } from "@/components/Sankey";
import { computeFunnel } from "@/lib/funnel";
import { buildSankey } from "@/lib/sankey";

const FLUX = buildSankey([
  { from: "/", to: "/panier", count: 128 },
  { from: "/", to: "/produit/:id", count: 96 },
  { from: "/produit/:id", to: "/panier", count: 54 },
  { from: "/panier", to: "/paiement", count: 31 },
  { from: "/panier", to: "/", count: 12 },
]);

// reached = [120, 48, 31, 12] : la marche 2 perd 72 sessions, c'est la plus perdante.
const ETAPES = computeFunnel(
  [
    ...Array.from({ length: 12 }, () => [1, 2, 3, 4]),
    ...Array.from({ length: 19 }, () => [1, 2, 3, null]),
    ...Array.from({ length: 17 }, () => [1, 2, null, null]),
    ...Array.from({ length: 72 }, () => [1, null, null, null]),
  ],
  ["panier_vu", "paiement_ouvert", "adresse_saisie", "achat"],
);

/** Un entonnoir dont personne n'a franchi la première étape : les taux n'ont pas de dénominateur. */
const ETAPES_SANS_DEPART = computeFunnel([], ["panier_vu", "achat"]);

export function SectionF50() {
  return (
    <section id="sankey-entonnoir" className="mb-10 min-w-0" aria-labelledby="sankey-entonnoir-titre">
      <h2 id="sankey-entonnoir-titre" className="text-base font-semibold text-ink">
        Sankey et FunnelChart
      </h2>
      <p className="mb-4 mt-1 text-sm text-ink-soft">
        Flux : total écrit sur chaque nœud, hauteur proportionnelle au nombre de nœuds, couleurs neutres (nœuds en
        gris de texte, rubans en série principale à 30 %), rubans et nœuds cliquables. Entonnoir : deux taux nommés
        par étape, abandon en nombre, plus forte perte encadrée.
      </p>
      <div className="mb-4 card p-4">
        <Sankey
          model={FLUX}
          ancre="/"
          liens={{ sessions: (route) => `/sessions?qf=route&q=${encodeURIComponent(route)}`, pages: (route) => `/pages?route=${encodeURIComponent(route)}` }}
        />
      </div>
      <div className="mb-4 card p-4">
        <FunnelChart steps={ETAPES} lienJournal={(nom) => `/events?kind=event&name=${encodeURIComponent(nom)}`} />
      </div>
      <p className="mb-2 text-sm text-ink-soft">
        Sans départ : les taux valent « — », jamais « 0 % », et aucune marche n&apos;est désignée.
      </p>
      <div className="card p-4">
        <FunnelChart steps={ETAPES_SANS_DEPART} />
      </div>
    </section>
  );
}
