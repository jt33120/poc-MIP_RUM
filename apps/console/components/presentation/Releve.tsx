// Ligne de relevé de la vitrine (plan § 8.2, PS0) : de quand date l'état que la
// page décrit, sur quel commit, et combien de capacités il compte.
//
// AUCUN CHIFFRE N'EST TAPÉ ICI. Date, commit, total et nombre de capacités
// déployées sont CALCULÉS par lib/couverture.ts depuis le document de couverture
// (docs/RUM_PARITY_STATUS.md) : un nouveau relevé change cette ligne au build
// suivant, et tests/unit/couverture-site.test.ts refuse un décompte écrit en dur
// dans un composant de la vitrine.
//
// « aucune éprouvée » n'est pas une opinion : le vocabulaire du document n'a aucun
// verdict meilleur que « déployé, non éprouvé », et l'extracteur échoue sur un
// verdict qu'il ne connaît pas — un humain décide alors de ce que la page en dit.
//
// Un relevé vieillit : au-delà de RELEVE_PERIME_JOURS, la ligne le dit. La page est
// rendue à chaque requête (`force-dynamic`), l'âge est donc celui du jour.
import { CAPACITES, RELEVE, SHA, compte } from "@/lib/couverture";

/** Au-delà de ce nombre de jours, la ligne prévient que l'état a pu changer. */
export const RELEVE_PERIME_JOURS = 30;

const JOUR_MS = 86_400_000;

/**
 * Le relevé « JJ/MM/AAAA » a-t-il plus de `jours` jours à l'instant `maintenant` ?
 * Une date illisible compte comme périmée : un âge inconnu ne se présente pas
 * comme frais.
 */
export function relevePerime(releve: string, maintenant: Date, jours: number = RELEVE_PERIME_JOURS): boolean {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(releve);
  if (!m) return true;
  const debut = Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  if (Number.isNaN(debut)) return true;
  return maintenant.getTime() - debut > jours * JOUR_MS;
}

export function Releve({ maintenant = new Date() }: { maintenant?: Date }) {
  const total = CAPACITES.length;
  const deployees = compte("deploye_non_eprouve");
  const perime = relevePerime(RELEVE, maintenant);
  return (
    <p data-testid="presentation-releve" className="mt-5 max-w-xl text-sm leading-relaxed text-ink-soft">
      État relevé le <strong className="font-semibold text-ink">{RELEVE}</strong> sur{" "}
      <code className="rounded bg-app/70 px-1.5 py-0.5 font-mono text-[13px] text-ink">{SHA}</code> :{" "}
      <strong className="font-semibold text-ink">{total}</strong> capacités recensées,{" "}
      <strong className="font-semibold text-ink">{deployees}</strong> déployées,{" "}
      <strong className="font-semibold text-ink">aucune</strong> éprouvée sur des données réellement
      ingérées.
      {perime && (
        <>
          {" "}
          <span data-testid="presentation-releve-perime">
            Ce relevé a plus de {RELEVE_PERIME_JOURS} jours ; l&apos;état réel peut avoir changé.
          </span>
        </>
      )}
    </p>
  );
}
