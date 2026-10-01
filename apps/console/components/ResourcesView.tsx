// Vue des ressources (P6.3) : durée, taille, type et origine, bornées et
// annoncées comme un échantillon. Rendu serveur ; les règles (seuil du SDK,
// partage première/tierce partie) vivent dans lib/resources.ts.
//
// Resserrée le 01/10/2026 (« pas de blanc, bien aligné, pas de phrases ») : l'encadré
// d'avertissement et ses deux paragraphes deviennent une pastille dont la phrase s'ouvre
// en bulle ; le partage première / tierce partie rejoint la carte « Par origine » ; les
// deux tableaux ont les mêmes colonnes, le même en-tête d'une ligne, le même bas.
import type { ReactNode } from "react";
import { InfoTip } from "@/components/InfoTip";
import { RegleMip, ValeurNoteeMip } from "@/components/NoteMip";
import { fmtVital } from "@/lib/format";
import {
  PARTY_HINTS,
  PARTY_LABELS,
  RESOURCE_THRESHOLD_NOTICE,
  fmtOctets,
  type ResourceParty,
} from "@/lib/resources";
import type { ResourceGroupe, ResourcesVue } from "@/lib/queries-resources";

const PARTY_ORDER: ResourceParty[] = ["first", "third", "unknown"];
/** La partie d'un hôte, en pastille courte ; le libellé entier pour les lecteurs d'écran. */
const PARTY_COURT: Record<ResourceParty, string> = { first: "1re", third: "tierce", unknown: "?" };

const TH = "whitespace-nowrap px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-faint";
const TD = "px-3 py-1.5 align-middle";
const SURTITRE = "text-[11px] font-semibold uppercase tracking-wider text-ink-soft";

/**
 * Durée p75 d'un groupe, notée par la règle MIP des ressources (amendement de R-S,
 * 29/09/2026). La règle est écrite UNE fois, dans l'en-tête de la section (`RegleMip`) :
 * la répéter sur chaque ligne noierait le tableau.
 */
function Duree({ ms }: { ms: number | null }) {
  return ms == null ? (
    <span className="text-ink-faint/60">—</span>
  ) : (
    <ValeurNoteeMip mesure="RESOURCE" valeur={Number(ms)} texte={fmtVital("dur", Number(ms))} regle={false} />
  );
}

function Tableau({
  legende,
  entete,
  lignes,
  total,
  tronque,
  vide,
  avecParty,
  avant,
  aide,
}: {
  legende: string;
  entete: string;
  lignes: ResourceGroupe[];
  total: number;
  tronque: boolean;
  vide: string;
  avecParty?: boolean;
  /** Ce que la carte montre avant le tableau (le partage des parties). */
  avant?: ReactNode;
  /** La méthode de la carte, dans la bulle « ? » de son en-tête. */
  aide?: ReactNode;
}) {
  return (
    // `min-w-0` : sans lui, la taille minimale automatique d'un élément de
    // grille vaut le min-content de son contenu — ici la largeur entière du
    // tableau. Le conteneur défilant en dessous ne sert alors à rien : c'est la
    // PAGE qui s'élargit, jusqu'à 621 px sur une fenêtre de 390.
    <div className="card flex min-w-0 flex-col">
      <div className="flex min-h-[2.25rem] flex-wrap items-center gap-x-2 border-b border-line px-3 py-1.5">
        <h3 className={SURTITRE}>{legende}</h3>
        {/* La troncature, chiffrée sur une ligne : « 12 sur 31 ». */}
        {tronque && (
          <span className="text-[11px] tabular-nums text-ink-faint" title={`${total} valeurs distinctes sur la fenêtre ; les ${lignes.length} plus fréquentes sont affichées.`}>
            {lignes.length} sur {total.toLocaleString("fr-FR")}
          </span>
        )}
        {aide && (
          <InfoTip label={`Méthode : ${legende.toLowerCase()}`} align="end" className="ml-auto">
            {aide}
          </InfoTip>
        )}
      </div>
      {avant}
      {/* `relative` : les `sr-only` du tableau (légende, note des pastilles) restent
          bornés par ce conteneur défilant (piège 16). */}
      <div className="relative overflow-x-auto">
        <table className="w-full text-xs">
          <caption className="sr-only">{legende}</caption>
          <thead className="bg-panel2">
            <tr>
              <th scope="col" className={TH}>{entete}</th>
              <th scope="col" className={`${TH} text-right`}>Nombre</th>
              <th scope="col" className={`${TH} text-right`}>Durée p75</th>
              <th scope="col" className={`${TH} text-right`}>Transféré</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((ligne) => (
              <tr key={`${ligne.cle ?? " "}|${ligne.party ?? ""}`} className="border-t border-line/60 transition hover:bg-panel2/60">
                <td className={`${TD} max-w-[14rem]`}>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 truncate font-mono text-ink" title={ligne.cle ?? undefined}>
                      {ligne.cle ?? "Inconnu"}
                    </span>
                    {avecParty && ligne.party && (
                      <span
                        className="shrink-0 rounded-full bg-panel2 px-1.5 text-[10px] leading-4 text-ink-soft"
                        title={`${PARTY_LABELS[ligne.party]} — ${PARTY_HINTS[ligne.party]}`}
                      >
                        <span aria-hidden>{PARTY_COURT[ligne.party]}</span>
                        <span className="sr-only">{PARTY_LABELS[ligne.party]}</span>
                      </span>
                    )}
                  </span>
                </td>
                <td className={`${TD} text-right tabular-nums text-ink-soft`}>{ligne.n.toLocaleString("fr-FR")}</td>
                <td className={`${TD} text-right tabular-nums`}><Duree ms={ligne.p75_ms} /></td>
                <td className={`${TD} whitespace-nowrap text-right tabular-nums text-ink-soft`}>{fmtOctets(ligne.octets)}</td>
              </tr>
            ))}
            {!lignes.length && (
              <tr>
                <td colSpan={4} className={`${TD} text-ink-faint`}>
                  <span aria-hidden className="mr-1.5">⊘</span>
                  {vide}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Le partage première / tierce partie : une barre par partie, sur une ligne chacune. */
function Partage({ vue }: { vue: ResourcesVue }) {
  if (!vue.partageCalculable) {
    return (
      <p className="flex items-center gap-1.5 border-b border-line px-3 py-1.5 text-xs text-ink-faint" data-testid="ressources-sans-origines">
        <span aria-hidden>⊘</span>
        Partage première / tierce partie non calculable
        <InfoTip label="Pourquoi le partage manque" align="end">
          Aucune origine n&apos;est déclarée pour cette application (champ « origines autorisées » du registre), ou aucune
          URL collectée ne porte d&apos;hôte lisible. Le serveur ne résout jamais une URL de ressource pour le deviner —
          seules les origines déclarées font foi.
        </InfoTip>
      </p>
    );
  }
  const parties = PARTY_ORDER.map((party) => vue.parParty.find((ligne) => ligne.party === party)).filter(
    (ligne): ligne is ResourceGroupe => ligne !== undefined,
  );
  return (
    <ul className="grid gap-1 border-b border-line px-3 py-2" aria-label="Première partie ou tierce partie">
      {parties.map((ligne) => {
        const party = ligne.party ?? "unknown";
        const part = vue.total > 0 ? (ligne.n / vue.total) * 100 : 0;
        return (
          <li key={party} className="grid grid-cols-[7.5rem_minmax(0,1fr)_4.5rem] items-center gap-2 text-xs">
            <span className="truncate font-medium text-ink" title={PARTY_HINTS[party]}>
              {PARTY_LABELS[party]}
            </span>
            <span className="relative h-4 min-w-0 overflow-hidden rounded bg-panel2">
              {/* Remplissage à 40 % : le compte s'écrit PAR-DESSUS la barre ; à 70 %, en sombre,
                  il tombait à 3,3:1 (axe, 01/10/2026). */}
              <span aria-hidden="true" className="absolute inset-y-0 left-0 rounded bg-accent/40" style={{ width: `${Math.max(2, part)}%` }} />
              <span className="absolute inset-y-0 right-1.5 flex items-center text-[11px] font-semibold tabular-nums text-ink">
                {ligne.n.toLocaleString("fr-FR")} · {part.toFixed(0)} %
              </span>
            </span>
            <span className="text-right tabular-nums text-ink-soft">{fmtOctets(ligne.octets)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function ResourcesView({ vue, periodLabel }: { vue: ResourcesVue; periodLabel: string }) {
  return (
    <section className="mb-4" data-testid="ressources" aria-labelledby="ressources-titre">
      <div className="mb-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="ressources-titre" className={SURTITRE}>
          Ressources
        </h2>
        {/* L'AVERTISSEMENT AVANT LES CHIFFRES : lus sans lui, ces totaux passeraient
            pour un inventaire du réseau alors qu'ils décrivent un échantillon
            volontairement biaisé vers le lent. Une pastille neutre ; la phrase entière
            dans la bulle (recette du 01/10/2026), toujours lue par les lecteurs d'écran. */}
        <span
          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-panel2 px-2.5 py-0.5 text-[11px] text-ink-soft"
          data-testid="ressources-seuil"
        >
          <span aria-hidden className="text-ink-faint">◔</span>
          <span className="font-medium text-ink">Ressources retenues par le capteur</span>
          <span aria-hidden className="hidden text-ink-faint sm:inline">· échantillon, non extrapolé</span>
          <InfoTip label="Ce que le capteur retient" align="start">
            {RESOURCE_THRESHOLD_NOTICE}
          </InfoTip>
        </span>
        <span className="text-[11px] tabular-nums text-ink-faint">
          {vue.total.toLocaleString("fr-FR")} ressources · {periodLabel}
        </span>
        {/* La règle de couleur de la colonne « Durée p75 », écrite une fois pour les deux tableaux. */}
        <RegleMip mesure="RESOURCE" className="sm:ml-auto" />
      </div>

      {vue.total === 0 ? (
        <p className="card flex items-center gap-1.5 px-3 py-2.5 text-xs text-ink-soft">
          <span aria-hidden className="text-ink-faint">⊘</span>
          Aucune ressource retenue sur {periodLabel}
          <InfoTip label="Pourquoi aucune ressource" align="start">
            Aucune n&apos;a dépassé le seuil du SDK, ou la collecte des ressources n&apos;est pas activée.
          </InfoTip>
        </p>
      ) : (
        // Deux cartes de même bas (`items-stretch`) : le partage des parties monte dans
        // la carte « Par origine », plus courte, au lieu d'une carte pleine largeur à part.
        <div className="grid min-w-0 items-stretch gap-2 lg:grid-cols-2 [&>.card]:h-full">
          <Tableau
            legende="Par type de ressource"
            entete="Type"
            lignes={vue.parType}
            total={vue.typesTotal}
            tronque={vue.typesTronques}
            vide={`Aucun type sur ${periodLabel}`}
          />
          <Tableau
            legende="Par origine"
            entete="Hôte"
            lignes={vue.parOrigine}
            total={vue.originesTotal}
            tronque={vue.originesTronquees}
            vide={`Aucune origine sur ${periodLabel}`}
            avecParty
            aide={
              <>
                La part se lit sur les origines <strong className="font-semibold">déclarées</strong> de l&apos;application,
                comparées à l&apos;hôte de l&apos;URL déjà collectée. Aucune requête sortante n&apos;est émise : une URL
                arbitraire ne déclenche aucun appel serveur.
              </>
            }
            avant={<Partage vue={vue} />}
          />
        </div>
      )}
    </section>
  );
}
