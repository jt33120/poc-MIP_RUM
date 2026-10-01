// La carte « Santé de la chaîne de mesure » de `/admin/health` (étude A3 § 2.6,
// lot L2). Rendu seul : les données viennent du chargeur de la page
// (`chargerSante`, section `chaine`), la règle de `lib/chaine-mesure.ts`.
//
// UNE LIGNE PAR FAIT (recette du 01/10/2026) : le verdict tient sur une ligne, sa phrase
// d'explication (« Le scheduler n'a encore journalisé… ») s'ouvre au clic ; une fenêtre
// hors collecte aussi, avec sa cause et sa preuve repliées. Ce sont des vérités : elles
// se replient, elles ne disparaissent pas.
import { FriseEtats } from "@/components/charts/FriseEtats";
import {
  ETAGES_CHAINE,
  ETATS_FRISE_CHAINE,
  casesFrise,
  debutsFrise,
  depuis,
  duree,
  libelleEtage,
  libelleLatences,
  libelleResultat,
  libelleSource,
  niveauResultat,
  tauxAboutis,
  verdictChaine,
  type NiveauChaine,
} from "@/lib/chaine-mesure";
import type { SanteChaineBrute } from "@/lib/queries-chaine";
import { grilleIso } from "@/lib/series";

const TON: Record<NiveauChaine, string> = {
  ok: "border-good/30 bg-good/10 text-good-ink",
  attention: "border-warn/40 bg-warn/10 text-warn-ink",
  incident: "border-bad/40 bg-bad/10 text-bad-ink",
  inconnu: "border-line bg-panel text-ink-soft",
};

/** La forme double la couleur : lisible sans elle. */
const PASTILLE: Record<NiveauChaine, string> = { ok: "●", attention: "▲", incident: "■", inconnu: "○" };

const PARIS = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const date = (iso: string) => PARIS.format(new Date(iso));

export function SanteChaine({
  brute,
  cadenceMin,
  maintenant,
}: {
  brute: SanteChaineBrute | null;
  cadenceMin: number | null;
  maintenant: number;
}) {
  const verdict = verdictChaine(brute, maintenant, cadenceMin);
  const etages = new Map((brute?.etages ?? []).map((e) => [e.etage, e]));
  const taux = brute ? tauxAboutis(brute.taux7j) : null;
  const notifier = brute?.battements.find((b) => b.service === "notifier") ?? null;
  const grille = grilleIso(debutsFrise(maintenant));

  return (
    <section className="card mb-6 px-4 py-3" data-testid="sante-chaine" data-niveau={verdict.niveau}>
      <div className={`rounded-lg border px-3 py-1.5 text-sm ${TON[verdict.niveau]}`} role={verdict.niveau === "incident" ? "alert" : "status"}>
        {verdict.detail ? (
          <details className="group" data-testid="sante-chaine-verdict">
            <summary className="flex min-w-0 cursor-pointer list-none items-center gap-1.5 font-semibold [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true">{PASTILLE[verdict.niveau]}</span>
              <span className="min-w-0 truncate" title={verdict.titre}>
                {verdict.titre}
              </span>
              <span aria-hidden="true" className="ml-auto shrink-0 text-[11px] font-medium opacity-70 group-open:hidden">
                Pourquoi
              </span>
            </summary>
            <p className="mt-0.5 text-xs">{verdict.detail}</p>
          </details>
        ) : (
          <p className="flex min-w-0 items-center gap-1.5 font-semibold" data-testid="sante-chaine-verdict">
            <span aria-hidden="true">{PASTILLE[verdict.niveau]}</span>
            <span className="min-w-0 truncate" title={verdict.titre}>
              {verdict.titre}
            </span>
          </p>
        )}
      </div>

      {brute?.dernier && (
        <>
          <div className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
            Dernier passage du canari · {date(brute.dernier.emis_at)} (heure de Paris)
          </div>
          <ul className="mt-1 grid gap-2 sm:grid-cols-3" data-testid="sante-chaine-etages">
            {ETAGES_CHAINE.map(({ etage, libelle, aide }) => {
              const e = etages.get(etage);
              const niveau = niveauResultat(e?.resultat);
              return (
                <li key={etage} className={`rounded-lg border px-3 py-2 text-xs ${TON[niveau]}`} title={aide}>
                  <div className="font-semibold">
                    <span aria-hidden="true">{PASTILLE[niveau]} </span>
                    {libelle}
                  </div>
                  <div>
                    {e ? libelleResultat(e.resultat) : "non sondé"}
                    {e?.latence_ms != null && <> · {e.latence_ms} ms</>}
                    {e?.http_status != null && <> · HTTP {e.http_status}</>}
                    {e?.chemin && etage === "ingest_console" && <> · {e.chemin}</>}
                  </div>
                  {e?.detail && (
                    <div className="mt-0.5 truncate" title={e.detail}>
                      {e.detail}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
            Sur 7 jours, heure par heure (pire passage de l&apos;heure)
          </div>
          <div className="mt-1 grid min-w-0 gap-3" data-testid="sante-chaine-frise">
            {ETAGES_CHAINE.map(({ etage, libelle }) => {
              const latences = libelleLatences(brute.latences7j.find((l) => l.etage === etage));
              return (
                <div key={etage} className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 text-xs">
                    <span className="font-semibold text-ink">{libelle}</span>
                    <span className="min-w-0 text-ink-soft [overflow-wrap:anywhere]" data-testid={`sante-chaine-latences-${etage}`}>
                      {latences ?? "aucune latence mesurée"}
                    </span>
                  </div>
                  <FriseEtats
                    grille={grille}
                    seauSecondes={3600}
                    cases={casesFrise(brute.heures, etage)}
                    etats={ETATS_FRISE_CHAINE}
                    hauteur={28}
                    ariaLabel={`${libelle} : résultat du canari heure par heure, sur 7 jours`}
                  />
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-ink-soft">
            {taux === null
              ? "Aucun canari vérifié sur 7 jours."
              : `Canaris aboutis sur 7 jours : ${taux.toLocaleString("fr-FR")} % (${brute.taux7j.aboutis} sur ${brute.taux7j.total}).`}{" "}
            {notifier
              ? `Battement du notifier : ${depuis(notifier.dernier_ok, maintenant)}.`
              : "Battement du notifier : pas encore publié."}
          </p>
        </>
      )}

      {brute && (
        <>
          {/* Le titre et, sans fenêtre, le « 0 » sur la même ligne. */}
          <div className="mt-3 flex flex-wrap items-baseline gap-x-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
            <span title="Ouvertes, et closes depuis 30 jours">Fenêtres hors collecte · 30 j</span>
            {brute.fenetres.length === 0 && (
              <span className="text-xs font-semibold normal-case tracking-normal text-good-ink" data-testid="sante-chaine-fenetres-aucune">
                <span aria-hidden="true">● </span>0
                <span className="sr-only"> : aucune fenêtre ouverte, ni close depuis 30 jours ; la collecte a été nominale sur la période.</span>
              </span>
            )}
          </div>
          {brute.fenetres.length > 0 && (
            <ul className="mt-1 divide-y divide-line text-xs" data-testid="sante-chaine-fenetres">
              {brute.fenetres.map((f) => {
                const ligne = (
                  <>
                    <span className={f.etat === "interrompue" ? "font-semibold text-bad-ink" : "font-semibold text-warn-ink"}>
                      {f.etat === "interrompue" ? "Interrompue" : "Dégradée"}
                    </span>{" "}
                    {f.portee === "*" ? "plateforme" : f.portee}
                    {f.etage !== "chaine" && <> ({libelleEtage(f.etage)})</>} · du {date(f.debut)} {f.fin ? <>au {date(f.fin)}</> : <>— en cours</>} ·{" "}
                    {duree(f.debut, f.fin, maintenant)} · {libelleSource(f.source)}
                  </>
                );
                return (
                  <li key={f.id} className="py-1">
                    {f.cause || f.preuve ? (
                      <details>
                        <summary className="cursor-pointer">{ligne}</summary>
                        {f.cause && <div className="mt-0.5 text-ink-soft">{f.cause}</div>}
                        {f.preuve && <div className="text-ink-faint [overflow-wrap:anywhere]">{f.preuve}</div>}
                      </details>
                    ) : (
                      ligne
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
