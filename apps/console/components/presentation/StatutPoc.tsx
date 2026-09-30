// « Où en est le POC » : trois lignes datées, dans le premier écran de la présentation.
//
// POURQUOI CE BLOC (recette du 26/09/2026). La vitrine s'ouvrait sur « N déployées,
// aucune éprouvée sur des données réellement ingérées » : juste, mais placé en tête,
// l'aveu devenait le message. Ces trois lignes disent la même chose dans l'ordre où
// une DSI la lit — ce qui tourne, ce qui est livré, ce qui vient — sans rien retirer :
// « la prochaine étape est de les éprouver » dit qu'elles ne le sont pas encore. Le
// relevé détaillé, ses verdicts et ses limites suivent, sur la même page (graphe technique).
//
// AUCUN CHIFFRE N'EST TAPÉ ICI : date du relevé et décomptes viennent du registre des
// capacités (lib/couverture.ts), la date de la topologie de lib/presentation-topologie.ts.
// tests/unit/couverture-site.test.ts refuse un décompte écrit en dur dans ce dossier.
import Link from "next/link";
import { RELEVE_PERIME_JOURS, relevePerime } from "@/components/presentation/Releve";
import { CAPACITES, RELEVE, compte } from "@/lib/couverture";
import { TOPOLOGIE_RELEVEE } from "@/lib/presentation-topologie";
import { CHEMIN_A_FAIRE } from "@/lib/vitrine-navigation";

export function StatutPoc({ maintenant = new Date() }: { maintenant?: Date }) {
  const total = CAPACITES.length;
  const deployees = compte("deploye_non_eprouve");
  const lignes: { quand: string; texte: string }[] = [
    {
      quand: TOPOLOGIE_RELEVEE.railway,
      texte: "En production : la console, la collecte des mesures et les travaux planifiés (alertes, objectifs de service, purge).",
    },
    {
      quand: RELEVE,
      texte: `${deployees} capacités sur ${total} déployées, chacune avec sa limite écrite plus bas.`,
    },
    {
      quand: "Prochaine étape",
      texte: "Les éprouver sur le trafic réel d'une application cliente.",
    },
  ];
  return (
    <section aria-labelledby="statut-titre" data-testid="presentation-statut" className="card p-5 sm:p-6">
      <h2 id="statut-titre" className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-soft">
        Où en est le POC
      </h2>
      <ol className="mt-4 space-y-4">
        {lignes.map((l) => (
          <li key={l.quand + l.texte} className="grid gap-1 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-3">
            <span className="text-sm font-semibold tabular-nums text-ink">{l.quand}</span>
            <span className="text-sm leading-relaxed text-ink-soft">{l.texte}</span>
          </li>
        ))}
      </ol>
      {relevePerime(RELEVE, maintenant) && (
        <p className="mt-4 text-xs text-ink-soft" data-testid="presentation-statut-perime">
          Ce relevé a plus de {RELEVE_PERIME_JOURS} jours ; l&apos;état réel peut avoir changé.
        </p>
      )}
      <p className="mt-5 border-t border-line pt-4 text-sm">
        <Link href={CHEMIN_A_FAIRE} className="font-medium text-ink underline decoration-line underline-offset-2 hover:decoration-ink">
          Ce qui reste à faire
        </Link>
        <span className="text-ink-soft"> : les hypothèses réductrices du POC, et les chantiers.</span>
      </p>
    </section>
  );
}
