// Inventaire des postes équipés de l'extension navigateur (Ext-D).
//
// Ce que cet écran répond : combien de postes sont équipés, lesquels remontent
// encore, lesquels traînent une vieille version, et quelles applications ils
// alimentent. Ce qu'il ne répond PAS : qui s'en sert. Un poste ne porte un nom
// que si la DSI du client en pousse un par la politique du navigateur ; sinon il reste un
// identifiant d'installation, et c'est le comportement voulu (cf. migration-v52).
//
// Refonte du 01/10/2026 : les chiffres en cases, l'état du parc en alvéoles (une par
// poste, colorée par fraîcheur), un tableau dense ; ce que l'inventaire ignore, replié.
import Link from "next/link";
import { headers } from "next/headers";
import { ECRANS_ADMIN } from "@mip/console-contract";
import { PageHeader } from "@/components/PageHeader";
import { TableDefilante } from "@/components/TableDefilante";
import { KpiTile } from "@/components/charts/KpiTile";
import { KpiLibelle } from "@/components/charts/KpiLibelle";
import { ICON_PATHS, Icon } from "@/components/icons";
import { chargerPostes } from "@/lib/chargeurs/administration";
import { accesAdmin, chargerEcran } from "@/lib/ecran";
import { compareVersions, displayName, fleetVersion, freshness, type Freshness } from "@/lib/extension-installs";
import { fmtInstant, pluriel } from "@/lib/format";
import { BOUTON_LIGNE, LIGNE, LigneVide, Moment, Panneau, Pastille, PUCE_ID, RangeeCases, TD, TH, type TonPastille } from "../_ui/kit";
import { forgetInstallAction } from "./actions";

export const dynamic = "force-dynamic";

const ETAT: Record<Freshness, { libelle: string; pluriel: string; ton: TonPastille; alveole: string }> = {
  actif: { libelle: "Actif", pluriel: "actifs", ton: "bon", alveole: "bg-good" },
  silencieux: { libelle: "Silencieux", pluriel: "silencieux", ton: "attention", alveole: "bg-warn" },
  perdu: { libelle: "Sans signe de vie", pluriel: "sans signe de vie", ton: "eteint", alveole: "bg-ink-faint/40" },
};

/** « 1 actif », « 3 actifs » : le compte d'un état, accordé. */
const compteEtat = (e: Freshness, n: number) => `${n} ${n > 1 ? ETAT[e].pluriel : ETAT[e].libelle.toLowerCase()}`;

const SOURCE = "Déclarations des postes équipés de l'extension (une toutes les 6 h, poste allumé)";

/** Une alvéole hexagonale : la forme dit « un poste », la couleur sa fraîcheur. */
const HEXAGONE = "[clip-path:polygon(25%_4%,75%_4%,100%_50%,75%_96%,25%_96%,0%_50%)]";

export default async function ExtensionInstalls() {
  // Le chargeur : l'administrateur de la plateforme seul — un poste observe plusieurs applications (C9).
  const { postes: rows } = accesAdmin(await chargerEcran(ECRANS_ADMIN.postes, chargerPostes, {}));
  const now = Date.now();

  const reference = fleetVersion(rows.map((r) => r.ext_version));
  const vus = rows.map((r) => ({
    ...r,
    etat: freshness(new Date(r.last_seen_at).getTime(), now),
    // « En retard » se juge contre le parc, pas contre une version codée en dur.
    enRetard: Boolean(reference && r.ext_version && compareVersions(r.ext_version, reference) < 0),
  }));

  // L'adresse que le poste doit pouvoir joindre : celle de cette console, que
  // l'extension contacte pour se déclarer et pour reconnaître les domaines.
  const hote = (await headers()).get("host");
  const compte = (e: Freshness) => vus.filter((r) => r.etat === e).length;
  const actifs = compte("actif");
  const retard = vus.filter((r) => r.enRetard).length;
  const sansApp = vus.filter((r) => r.app_ids.length === 0 && r.etat === "actif").length;
  const nommes = vus.filter((r) => r.label).length;

  return (
    <div className="animate-fade-up">
      <PageHeader title="Postes équipés" />

      {/* Chiffres de tête : les questions d'exploitation d'un parc. Masqués quand aucun
          poste ne s'est déclaré : des cases à zéro passaient avant le seul message
          utile, sous la ligne de flottaison à 390 px (recette du 26/09). */}
      {rows.length > 0 && (
        <RangeeCases testId="postes-cases" colonnes={6}>
          <KpiTile label="Postes équipés" valeur={rows.length} format="count" source={SOURCE} methode="Un poste par installation de l'extension (un profil de navigateur) : deux profils sur la même machine comptent pour deux." />
          <KpiTile label="Postes actifs (vus sous 3 jours)" libelleCase="Actifs · 3 j" valeur={actifs} format="count" source={SOURCE} methode="Vus ces 3 derniers jours : un poste éteint du vendredi soir au lundi matin ne passe pas pour perdu." />
          <KpiLibelle label="Version du parc" texte={reference} raisonNull="aucune version déclarée" lecture="la plus haute version observée sur le parc" />
          <KpiTile
            label="Postes en retard de version"
            libelleCase="En retard"
            valeur={retard}
            format="count"
            alerte={{ si: ">", valeur: 0, regle: "des postes n'ont pas la version du parc" }}
            source={SOURCE}
            methode="Postes dont la version est plus ancienne que la plus haute observée sur le parc."
          />
          <KpiTile
            label="Postes actifs sans remontée"
            libelleCase="Sans remontée"
            valeur={sansApp}
            format="count"
            alerte={{ si: ">", valeur: 0, regle: "actifs, mais n'alimentent aucune application" }}
            source={SOURCE}
            methode="Postes actifs qui n'alimentent aucune application : aucun domaine du registre n'y est visité, ou l'extension n'y est pas activée."
          />
          <KpiTile label="Postes nommés par la DSI" libelleCase="Nommés" valeur={nommes} format="count" source={SOURCE} methode={`Nom poussé par la politique du navigateur de la DSI du client : ${nommes} sur ${rows.length}.`} />
        </RangeeCases>
      )}

      <Panneau
        titre="Parc"
        compte={rows.length}
        className="mb-4"
        aide={
          <>
            Inventaire du parc : quels postes portent l&apos;extension navigateur, depuis quand, et quelles applications ils
            alimentent. Chaque installation se déclare toutes les 6 h — elle n&apos;envoie <strong>jamais</strong> les pages
            visitées.
          </>
        }
        barre={rows.length > 0 ? <Alveoles postes={vus.map((r) => ({ id: r.install_id, nom: displayName(r.label, r.install_id), etat: r.etat }))} /> : undefined}
      >
        {rows.length === 0 ? (
          <LigneVide
            testId="aucun-poste"
            aide={
              <>
                Un poste apparaît ici dès l&apos;installation de l&apos;extension, puis se déclare de nouveau toutes les 6 h. Si vous
                venez de l&apos;installer et que le poste reste absent, vérifiez que ce poste peut joindre{" "}
                <code className="chip-mono break-all">{hote ?? "l'adresse de cette console"}</code> : c&apos;est là que
                l&apos;extension se déclare.
              </>
            }
            geste={
              <Link href="/admin/extension-scope" className="text-brand hover:underline">
                Enregistrer un domaine →
              </Link>
            }
          >
            Aucun poste ne s&apos;est encore déclaré.
          </LigneVide>
        ) : (
          // Sept colonnes, dont l'action « Retirer » en dernier : défilement signalé.
          <TableDefilante label="Postes équipés">
            <table className="w-full text-sm">
              <thead className="bg-panel2">
                <tr>
                  <th className={TH}>Poste</th>
                  <th className={TH}>Navigateur</th>
                  <th className={TH}>Version</th>
                  <th className={TH}>Applications</th>
                  <th className={TH}>Dernier signe</th>
                  <th className={TH}>État</th>
                  <th className={TH}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {vus.map((r) => (
                  <tr key={r.install_id} className={LIGNE} data-testid="install-row">
                    <td className={TD} title={`Équipé depuis le ${fmtInstant(r.first_seen_at, { annee: true })}`}>
                      <span className="font-medium text-ink">{displayName(r.label, r.install_id)}</span>
                      {!r.label && (
                        <span className="ml-2 text-[11px] text-ink-faint" title={r.install_id}>
                          anonyme
                        </span>
                      )}
                    </td>
                    <td className={`${TD} whitespace-nowrap text-ink-soft`}>
                      {r.browser ?? "—"}
                      {r.browser_major != null && <span className="text-ink-faint"> {r.browser_major}</span>}
                      {r.platform && <span className="text-ink-faint"> · {r.platform}</span>}
                    </td>
                    <td className={TD}>
                      <span className={`font-mono text-xs ${r.enRetard ? "text-warn-ink" : "text-ink-soft"}`}>{r.ext_version ?? "—"}</span>
                      {r.enRetard && <span className="ml-1.5 text-[11px] text-warn-ink">en retard</span>}
                    </td>
                    <td className={TD}>
                      {r.app_ids.length ? (
                        <span className="flex flex-wrap gap-1">
                          {r.app_ids.map((a) => (
                            <code key={a} className={PUCE_ID}>
                              {a}
                            </code>
                          ))}
                        </span>
                      ) : (
                        <span className="text-[11px] text-ink-faint">aucune</span>
                      )}
                    </td>
                    <td className={`${TD} text-xs text-ink-soft`}>
                      <Moment date={r.last_seen_at} maintenant={now} />
                    </td>
                    <td className={TD}>
                      <Pastille ton={ETAT[r.etat].ton}>{ETAT[r.etat].libelle}</Pastille>
                    </td>
                    <td className={TD}>
                      <form action={forgetInstallAction}>
                        <input type="hidden" name="install_id" value={r.install_id} />
                        <button type="submit" className={BOUTON_LIGNE} title="Retire la ligne ; un poste toujours équipé se déclarera de nouveau dans les 6 h">
                          Retirer
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableDefilante>
        )}
      </Panneau>

      {/* Ce que l'écran ne dit pas — à lire avant de s'en servir comme d'un registre
          nominatif, ce qu'il n'est pas. Replié : ces vérités restent à un clic, hors de
          la vue (refonte du 01/10/2026). */}
      <details className="card group px-3 py-2" data-testid="inventaire-limites">
        <summary className="flex cursor-pointer select-none list-none items-center gap-2 text-xs font-medium text-ink-soft [&::-webkit-details-marker]:hidden">
          <Icon paths={ICON_PATHS.shield} className="h-3.5 w-3.5 text-perf" strokeWidth={2.2} />
          Ce que cet inventaire sait, et ce qu&apos;il ignore
          <span aria-hidden className="ml-auto text-ink-faint transition group-open:rotate-180">
            ▾
          </span>
        </summary>
        <ul className="mt-2 grid gap-x-6 gap-y-1.5 pb-1 text-xs leading-relaxed text-ink-soft lg:grid-cols-2">
          <li>
            <strong className="text-ink">Un poste, pas une personne.</strong> L&apos;identifiant est tiré au hasard à
            l&apos;installation, et ne dérive d&apos;aucune caractéristique de la machine ni de son utilisateur. Deux profils
            Chrome sur le même poste comptent pour deux.
          </li>
          <li>
            <strong className="text-ink">Les noms viennent de la DSI du client.</strong> Le nom d&apos;un poste est lu dans la
            politique du navigateur que la DSI déploie (clé <code className="chip-mono">poste</code>), jamais fabriqué ici. Sans
            cette politique, l&apos;inventaire reste anonyme.
          </li>
          <li>
            <strong className="text-ink">Aucune page visitée n&apos;est remontée</strong> quand le poste se déclare. La colonne
            « Applications » ne liste que des applications déjà rattachées à un domaine du registre, jamais une navigation hors
            de ce registre.
          </li>
          <li>
            <strong className="text-ink">« Retirer » n&apos;est pas une désinstallation.</strong> La ligne disparaît, mais un
            poste toujours équipé se déclarera de nouveau dans les 6 h. Pour arrêter la collecte, désactivez le domaine dans le
            registre.
          </li>
        </ul>
      </details>
    </div>
  );
}

/**
 * L'état du parc d'un coup d'œil : une alvéole par poste, colorée par fraîcheur, et le
 * compte de chaque état écrit à côté (la couleur ne porte jamais seule le sens).
 */
function Alveoles({ postes }: { postes: { id: string; nom: string; etat: Freshness }[] }) {
  const comptes = (["actif", "silencieux", "perdu"] as const).map((e) => ({ e, n: postes.filter((p) => p.etat === e).length }));
  const resume = comptes.map(({ e, n }) => compteEtat(e, n)).join(", ");
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2" data-testid="alveoles-parc">
      <div role="img" aria-label={`${pluriel(postes.length, "poste")} : ${resume}`} className="flex max-w-full flex-wrap gap-0.5">
        {postes.map((p) => (
          <span key={p.id} title={`${p.nom} · ${ETAT[p.etat].libelle}`} className={`h-3.5 w-4 ${HEXAGONE} ${ETAT[p.etat].alveole}`} />
        ))}
      </div>
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-soft" aria-hidden>
        {comptes.map(({ e, n }) => (
          <li key={e} className="inline-flex items-center gap-1">
            <span className={`h-2.5 w-3 ${HEXAGONE} ${ETAT[e].alveole}`} />
            <span className="tabular-nums text-ink">{n}</span> {n > 1 ? ETAT[e].pluriel : ETAT[e].libelle.toLowerCase()}
          </li>
        ))}
      </ul>
    </div>
  );
}
