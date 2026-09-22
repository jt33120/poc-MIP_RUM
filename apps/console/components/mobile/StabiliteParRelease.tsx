// Hero de `/mobile` : « Stabilité par release » (F38, W-M6, plan § 5.6.4). Rendu
// serveur : la lecture `mobileParRelease` mise en `ImpactTable`.
//
// UNE LIGNE PAR RELEASE, UNE BARRE = LA PART DES SESSIONS TOUCHÉES par au moins une
// erreur JavaScript. Sur mobile la release est un fait exact de la session : le
// numérateur et le dénominateur parlent de la même population.
//
// CE QU'ELLE N'AFFICHE JAMAIS.
//   - « 0 % » pour une release qui ne déclare pas collecter les erreurs JS : sa part
//     est « — », sa raison écrite sous la table — même si une autre release déclare.
//   - « 0 » occurrence ou « 0 sur N » touchées pour cette même release : un zéro
//     non observé n'est pas un vide réel (V3).
//   - Une moyenne de parts : la référence « Releases déclarantes » est Σ touchées /
//     Σ sessions, sur TOUTES les releases, pas sur les 12 affichées.
//
// L'ORDRE PAR DÉFAUT EST CELUI DE LA SOURCE (première session vue, la plus récente
// en tête) : `tri` absent de l'URL. `tri=gravite` et `tri=volume` reclassent les
// mêmes lignes. La bascule est rendue ICI, au-dessus de la table : `ImpactTable`
// n'en rend pas sous l'ordre « fourni », qui n'est jamais une valeur d'URL.
import { BasculeTri } from "@/components/Breakdown";
import { ImpactTable, type ImpactLigne } from "@/components/ImpactTable";
import { EtatSurface } from "@/components/states/EtatSurface";
import { formater } from "@/lib/fmt-ids";
import { classerParGravite, SEUIL_ECHANTILLON_FAIBLE } from "@/lib/impact";
import { texteRaisonTaux } from "@/lib/mobile-capabilities";
import type { MobileParRelease, MobileReleaseRow } from "@/lib/queries-mobile";
import { intervalleWilson, texteIntervalle } from "@/lib/stats/incertitude";

export type TriStabilite = "fourni" | "gravite" | "volume";

/** Libellé de la ligne d'une release : « Inconnue » pour les sessions sans release. */
export const libelleRelease = (release: string | null) => release ?? "Inconnue";

/**
 * Libellé d'une ligne : la release, suivie de son app dès que plusieurs apps sont
 * lues — deux « 1.0.0 » de deux apps sont deux lignes, et doivent se lire comme telles.
 */
export const libelleLigne = (l: Pick<MobileReleaseRow, "release" | "app_id">, avecApp: boolean) =>
  avecApp ? `${libelleRelease(l.release)} · ${l.app_id}` : libelleRelease(l.release);

/** Lien d'une ligne : l'écran filtré sur la release, et sur son app quand plusieurs sont lues. */
export type HrefDeRelease = (release: string | null, app: string) => string;

const DATE_UTC = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const nombre = (n: number) => n.toLocaleString("fr-FR");

/** « +2,1 pts vs 1.3 » ; « — » sans précédente ou sans part d'un côté. */
function texteEcart(l: MobileReleaseRow): string {
  if (l.ecart_precedente_pts === null || l.release_precedente === null) return "—";
  const v = l.ecart_precedente_pts;
  const arrondi = Math.round(v * 10) / 10;
  const signe = arrondi > 0 ? "+" : arrondi < 0 ? "−" : "±";
  return `${signe}${Math.abs(arrondi).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} pt vs ${l.release_precedente}`;
}

const ORDRES: Record<TriStabilite, string> = {
  fourni: "Ordre : par première session vue sur la fenêtre, la plus récente en tête.",
  gravite:
    "Ordre : par part de sessions touchées, la plus forte en tête ; moins de 30 sessions, puis part non calculable, en fin de liste.",
  volume: "Ordre : par nombre de sessions, le plus grand en tête.",
};

export function lignesStabilite(
  lignes: readonly MobileReleaseRow[],
  hrefDeRelease: HrefDeRelease,
  avecApp = false,
): ImpactLigne[] {
  return lignes.map((l) => {
    const libelle = libelleLigne(l, avecApp);
    const connue = l.part_touchee !== null;
    // Une release qui ne déclare pas collecter : aucun zéro affiché. Un compte
    // positif reste écrit — des erreurs reçues sont un fait, même sans déclaration.
    const occurrencesAffichees = l.occurrences === null || (l.etat_js_errors !== "active" && l.occurrences === 0) ? null : l.occurrences;
    const touchees = connue && l.sessions_touchees !== null ? l.sessions_touchees : null;
    const intervalle = connue && touchees !== null ? texteIntervalle(intervalleWilson(touchees, l.sessions), (v) => formater("pct", v)) : null;
    return {
      // Une clé par (app, release) : deux « 1.0.0 » de deux apps sont deux lignes.
      cle: JSON.stringify([l.app_id, l.release]),
      libelle,
      href: hrefDeRelease(l.release, l.app_id),
      description: connue
        ? `Release ${libelle} : ${formater("pct", l.part_touchee)} des sessions touchées par une erreur JavaScript, ${nombre(touchees ?? 0)} sessions touchées sur ${nombre(l.sessions)}`
        : `Release ${libelle} : part des sessions touchées non calculable (${l.raison_part ?? "raison non lue"}), ${nombre(l.sessions)} sessions`,
      pilote: l.part_touchee,
      volume: l.sessions,
      mesures: [
        {
          cle: "touchees",
          valeur: touchees,
          affichage: touchees === null ? "—" : `${nombre(touchees)} sur ${nombre(l.sessions)}`,
        },
        { cle: "occurrences", valeur: occurrencesAffichees, affichage: formater("count", occurrencesAffichees) },
        { cle: "ecart", valeur: l.ecart_precedente_pts, affichage: texteEcart(l) },
        {
          cle: "demarrage",
          valeur: l.demarrage_froid_p75_ms,
          affichage: `${formater("ms", l.demarrage_froid_p75_ms)} (n = ${nombre(l.demarrage_froid_n)})`,
          n: l.demarrage_froid_n,
        },
        { cle: "premiere", valeur: Date.parse(l.premiere_session), affichage: `${DATE_UTC.format(new Date(l.premiere_session))} UTC` },
      ],
      intervalle,
      echantillonFaible: l.sessions < SEUIL_ECHANTILLON_FAIBLE,
    };
  });
}

export function StabiliteParRelease({
  resultat,
  tri,
  triHref,
  hrefDeRelease,
  plage,
}: {
  resultat: Extract<MobileParRelease, { disponible: true }>;
  tri: TriStabilite;
  /** Liens de la bascule : chronologie (sans `tri`), gravité, volume. */
  triHref: Record<TriStabilite, string>;
  hrefDeRelease: HrefDeRelease;
  /** « 24 h », « du 17/09 10:00 au 17/09 12:00 » : pour l'état vide. */
  plage: string;
}) {
  if (resultat.releases === 0) {
    return (
      <section className="card mb-6 min-w-0 p-4" aria-labelledby="mobile-stabilite-titre">
        <h2 id="mobile-stabilite-titre" className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
          Stabilité par release
        </h2>
        <EtatSurface etat={{ kind: "vide", population: "session React Native", plage }} />
      </section>
    );
  }

  const avecApp = resultat.apps > 1;
  const construites = lignesStabilite(resultat.lignes, hrefDeRelease, avecApp);
  const classees =
    tri === "fourni"
      ? construites
      : classerParGravite(construites, { pilote: (l) => l.pilote, effectif: (l) => l.volume, tri }).lignes;
  const d = resultat.declarantes;
  const part = d.rate === null ? null : 1 - d.rate;
  const sansPart = resultat.lignes.filter((l) => l.part_touchee === null);
  const raisons = [...new Set(sansPart.map((l) => l.raison_part ?? "raison non lue"))].map((raison) => ({
    raison,
    releases: sansPart.filter((l) => (l.raison_part ?? "raison non lue") === raison).map((l) => libelleLigne(l, avecApp)),
  }));

  return (
    <div className="min-w-0" data-testid="mobile-stabilite">
      <div className="mb-2 flex justify-end">
        <BasculeTri
          courant={tri}
          options={[
            { id: "fourni", libelle: "Chronologie", href: triHref.fourni },
            { id: "gravite", libelle: "Gravité", href: triHref.gravite },
            { id: "volume", libelle: "Volume", href: triHref.volume },
          ]}
        />
      </div>
      <ImpactTable
        titre="Stabilité par release"
        tri="fourni"
        triHref={{ gravite: null, volume: null, impact: null, fourni: null }}
        ordreLibelle={`${ORDRES[tri]}${resultat.tronque && tri !== "fourni" ? ` Classement parmi les ${resultat.lignes.length} releases les plus récentes.` : ""}`}
        reference={
          part === null
            ? null
            : {
                libelle: "Releases déclarantes",
                valeurs: {
                  pilote: formater("pct", part),
                  volume: nombre(d.sessions),
                  touchees: `${nombre(d.touchees)} sur ${nombre(d.sessions)}`,
                  ...(d.occurrences !== null ? { occurrences: nombre(d.occurrences) } : {}),
                },
              }
        }
        referenceRaison={d.reason === null ? "raison non lue" : texteRaisonTaux(d.reason)}
        lignes={classees}
        colonnes={["Touchées", "Occurrences", "Écart", "Démarrage à froid p75", "1re session"]}
        unitePilote="pct"
        volumeLibelle="Sessions"
        groupes={resultat.releases}
        tronque={resultat.tronque}
        notice="Part des sessions React Native de chaque release touchées par au moins une erreur JavaScript de la fenêtre, même cohorte que les tuiles. Écart : en points, contre la release précédente de la même app dans l'ordre de première session vue — même fenêtre, sans normalisation de trafic : l'écart mêle le code et le contexte."
      />
      {(raisons.length > 0 || resultat.tronque) && (
        <div className="-mt-4 mb-6 flex flex-col gap-1 px-1 text-xs text-ink-soft" data-testid="mobile-stabilite-notes">
          {raisons.map((r) => (
            <p key={r.raison} data-testid="mobile-stabilite-raison">
              Part « — » pour {r.releases.join(", ")} : {r.raison}
            </p>
          ))}
          {resultat.tronque && (
            <p>
              {resultat.lignes.length} releases affichées sur {nombre(resultat.releases)} ; la ligne de référence porte sur
              toutes.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
