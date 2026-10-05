"use client";
// « Réglages et conformité » (« À faire » X11) : sous les trois parcours de la page
// « Installer », le client choisit son outil de consentement, son rejeu et son
// masquage, son filtre de données personnelles, son échantillonnage et sa chaîne de
// construction ; la page lui écrit les fichiers correspondants, prêts à coller
// (`lib/kit-installation.ts`, où chaque code est exécuté par les tests).
//
// Aucun réglage n'est enregistré par la console : ils vivent dans le code du client.
// Le composant ne fait que composer ce code, à ses valeurs, sans appel réseau.
import { useMemo, useState, type ReactNode } from "react";
import { CopyBlock } from "@/components/CopyBlock";
import { CodeAvecSecret } from "@/components/secret/SecretUnique";
import { CadreEtat } from "@/components/states/EtatSurface";
import {
  EXEMPLE_ZONES,
  FICHIER_INIT,
  IDENTIFIANT_OUTIL_DEFAUT,
  JETON_PAR_PLATEFORME,
  LIBELLE_MASQUAGE,
  LIBELLE_OUTIL,
  NIVEAUX_MASQUAGE,
  OUTILS_BUILD,
  OUTILS_CONSENTEMENT,
  REGLAGES_PAR_DEFAUT,
  REGLAGE_SOURCEMAPS,
  TAUX_ECHANTILLONNAGE,
  TAUX_REJEU,
  balisesEnTete,
  commandeBuild,
  echantillonnageConseille,
  fichierInit,
  mentionConfidentialite,
  pourcent,
  scriptSourcemaps,
  type NiveauMasquage,
  type OutilBuild,
  type OutilConsentement,
  type ReglagesKit,
} from "@/lib/kit-installation";
import { REPERE_CLE_API } from "@/lib/recettes-agents-otel";

export interface JetonARenouveler {
  nom: string;
  nature: string;
  joursRestants: number;
}

export interface ProprietesKit {
  app: string;
  nomSecret: string;
  nomSite: string;
  sdkUrl: string;
  endpoint: string;
  clientId: string | null;
  urlSourcemaps: string;
  retentionJours: number;
  /** Sessions du code de suivi sur 24 h (plafonnées par la sonde), `null` si illisibles. */
  sessions24h: number | null;
  /** Seulement pour l'administrateur de l'application : les jetons proches de l'échéance. */
  jetons: JetonARenouveler[] | null;
  administrable: boolean;
}

function Reglage({ libelle, aide, children }: { libelle: string; aide?: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs">
      <span className="font-medium text-ink">{libelle}</span>
      {children}
      {aide && <span className="text-[11px] leading-snug text-ink-faint">{aide}</span>}
    </label>
  );
}

function Bloc({ titre, resume, ouvert = false, testId, children }: { titre: string; resume: string; ouvert?: boolean; testId: string; children: ReactNode }) {
  return (
    <details className="card group min-w-0 px-3 py-2" open={ouvert} data-testid={testId}>
      <summary className="flex cursor-pointer select-none list-none flex-wrap items-center gap-x-2 gap-y-1 text-xs [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-ink-faint transition group-open:rotate-90">
          ▸
        </span>
        <span className="font-semibold text-ink">{titre}</span>
        <span className="text-ink-faint">{resume}</span>
      </summary>
      <div className="mt-2 grid min-w-0 gap-2 text-xs text-ink-soft">{children}</div>
    </details>
  );
}

export function KitInstallation(p: ProprietesKit) {
  const conseil = echantillonnageConseille(p.sessions24h);
  const [r, setR] = useState<ReglagesKit>({ ...REGLAGES_PAR_DEFAUT, echantillonnage: conseil.taux });
  const maj = (partiel: Partial<ReglagesKit>) => setR((avant) => ({ ...avant, ...partiel }));

  const init = useMemo(() => fichierInit({ endpoint: p.endpoint, appId: p.app, clientId: p.clientId }, r), [p.endpoint, p.app, p.clientId, r]);
  const mention = useMemo(() => mentionConfidentialite({ nomSite: p.nomSite, retentionJours: p.retentionJours, reglages: r }), [p.nomSite, p.retentionJours, r]);
  const reglageBuild = REGLAGE_SOURCEMAPS[r.outilBuild];
  const script = useMemo(
    () => scriptSourcemaps({ appId: p.app, urlEnvoi: p.urlSourcemaps, dossier: reglageBuild.dossier }),
    [p.app, p.urlSourcemaps, reglageBuild.dossier],
  );
  const avecOutil = r.consentement !== "aucun" && r.consentement !== "autre";
  const rejeu = r.rejeu > 0;

  return (
    <div className="grid min-w-0 gap-2" data-testid="kit-installation">
      {p.jetons && p.jetons.length > 0 && (
        <CadreEtat ton="attention" role="status" compact testId="kit-jetons-a-renouveler">
          <span className="font-semibold text-ink">Jetons à renouveler</span>
          <ul className="mt-1 grid gap-0.5 text-ink-soft">
            {p.jetons.map((j) => (
              <li key={`${j.nature}-${j.nom}`} className="[overflow-wrap:anywhere]">
                {j.nature} · {j.nom} ·{" "}
                <span className="font-medium text-ink">{j.joursRestants < 0 ? `expiré depuis ${-j.joursRestants} j` : `expire dans ${j.joursRestants} j`}</span>
              </li>
            ))}
          </ul>
          <a href={`/admin/sourcemaps?app=${encodeURIComponent(p.app)}`} className="mt-1 inline-block font-medium text-brand hover:underline">
            En créer un nouveau, puis révoquer l&apos;ancien
          </a>
        </CadreEtat>
      )}

      <div className="card grid min-w-0 gap-3 px-3 py-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="kit-reglages">
        <Reglage libelle="Outil de consentement" aide={r.consentement === "aucun" ? "La mesure démarre sans bandeau : la base légale est la vôtre." : "Rien ne part avant l'accord du visiteur."}>
          <select
            className="field w-full min-w-0"
            value={r.consentement}
            data-testid="kit-consentement"
            onChange={(e) => {
              const outil = e.target.value as OutilConsentement;
              maj({ consentement: outil, identifiantOutil: IDENTIFIANT_OUTIL_DEFAUT[outil] });
            }}
          >
            {OUTILS_CONSENTEMENT.map((o) => (
              <option key={o} value={o}>
                {LIBELLE_OUTIL[o]}
              </option>
            ))}
          </select>
        </Reglage>
        {avecOutil && (
          <Reglage libelle="Nom de MIP RUM dans l'outil" aide="Tel que déclaré dans votre outil (service, fournisseur).">
            <input className="field w-full min-w-0 font-mono" value={r.identifiantOutil} onChange={(e) => maj({ identifiantOutil: e.target.value })} data-testid="kit-identifiant-outil" />
          </Reglage>
        )}
        <Reglage libelle="Rejeu de session" aide="Une vidéo de la visite, reconstruite depuis la page.">
          <select className="field w-full min-w-0" value={r.rejeu} onChange={(e) => maj({ rejeu: Number(e.target.value) })} data-testid="kit-rejeu">
            {TAUX_REJEU.map((t) => (
              <option key={t} value={t}>
                {t === 0 ? "Coupé" : `${pourcent(t)} des sessions`}
              </option>
            ))}
          </select>
        </Reglage>
        {rejeu && (
          <Reglage libelle="Masquage du rejeu" aide="Les saisies restent toujours masquées.">
            <select className="field w-full min-w-0" value={r.masquage} onChange={(e) => maj({ masquage: e.target.value as NiveauMasquage })} data-testid="kit-masquage">
              {NIVEAUX_MASQUAGE.map((n) => (
                <option key={n} value={n}>
                  {LIBELLE_MASQUAGE[n]}
                </option>
              ))}
            </select>
          </Reglage>
        )}
        {rejeu && r.masquage !== "inputs" && (
          <Reglage libelle="Zones montrées en clair (sélecteur CSS)" aide="Facultatif ; ou la classe mip-rum-unmask dans le HTML.">
            <input className="field w-full min-w-0 font-mono" placeholder="nav, .menu" value={r.zonesDemasquees} onChange={(e) => maj({ zonesDemasquees: e.target.value })} data-testid="kit-zones" />
          </Reglage>
        )}
        <Reglage libelle="Sessions mesurées" aide={`Conseil : ${pourcent(conseil.taux)}. ${conseil.raison}`}>
          <select className="field w-full min-w-0" value={r.echantillonnage} onChange={(e) => maj({ echantillonnage: Number(e.target.value) })} data-testid="kit-echantillonnage">
            {TAUX_ECHANTILLONNAGE.map((t) => (
              <option key={t} value={t}>
                {pourcent(t)}
              </option>
            ))}
          </select>
        </Reglage>
        <Reglage libelle="Construction du site" aide="Pour les source maps et la version déployée.">
          <select className="field w-full min-w-0" value={r.outilBuild} onChange={(e) => maj({ outilBuild: e.target.value as OutilBuild })} data-testid="kit-build">
            {OUTILS_BUILD.map((o) => (
              <option key={o} value={o}>
                {o === "vite" ? "Vite" : "webpack"}
              </option>
            ))}
          </select>
        </Reglage>
        <div className="flex min-w-0 flex-col gap-1.5 text-xs">
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={r.filtreDonnees} onChange={(e) => maj({ filtreDonnees: e.target.checked })} data-testid="kit-filtre" className="mt-0.5 shrink-0" />
            <span className="min-w-0">
              <span className="font-medium text-ink">Filtrer e-mails et longs numéros</span>{" "}
              <span className="text-ink-faint">avant l&apos;envoi (beforeSend)</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={r.release} onChange={(e) => maj({ release: e.target.checked })} data-testid="kit-release" className="mt-0.5 shrink-0" />
            <span className="min-w-0">
              <span className="font-medium text-ink">Version déployée et source maps</span>{" "}
              <span className="text-ink-faint">erreurs lues dans le code source</span>
            </span>
          </label>
        </div>
      </div>

      <Bloc titre="1 · Le fichier de configuration" resume={`${FICHIER_INIT}, servi par votre site à côté de ses pages`} ouvert testId="kit-bloc-init">
        <p>Dans l&apos;en-tête de chaque page, à la place du code de suivi de l&apos;onglet « SDK JavaScript » :</p>
        <CopyBlock code={balisesEnTete(p.sdkUrl)} />
        <p>
          Puis ce fichier, à la racine publique du site (<code className="chip-mono">public/{FICHIER_INIT}</code> sous Vite ou Next.js). La clé
          d&apos;ingestion y est déjà si elle vient d&apos;être remise dans cet onglet.
        </p>
        <CodeAvecSecret nom={p.nomSecret} code={init} repere={REPERE_CLE_API} rendu="copie" />
        {r.consentement === "tarteaucitron" && <p>tarteaucitron.js doit être chargé avant ce fichier.</p>}
      </Bloc>

      {rejeu && (
        <Bloc titre="2 · Rejeu : marquer les zones" resume="facultatif : montrer un menu, exclure un bloc sensible" testId="kit-bloc-zones">
          <p>
            Sous « {LIBELLE_MASQUAGE[r.masquage]} », deux classes affinent ce que le rejeu montre. Les champs de saisie restent masqués quoi
            qu&apos;il arrive.
          </p>
          <CopyBlock code={EXEMPLE_ZONES} />
        </Bloc>
      )}

      {r.release && (
        <Bloc titre={`${rejeu ? 3 : 2} · Version déployée et source maps`} resume="une erreur lue dans votre code source, pas dans le bundle minifié" testId="kit-bloc-sourcemaps">
          <p>
            <code className="chip-mono">{reglageBuild.fichier}</code> : produire les maps sans les publier.
          </p>
          <CopyBlock code={reglageBuild.code} />
          <p>
            <code className="chip-mono">package.json</code> : lancer le script après la construction.
          </p>
          <CopyBlock code={commandeBuild(r.outilBuild)} />
          <p>
            <code className="chip-mono">scripts/mip-sourcemaps.mjs</code> : écrit la version dans {FICHIER_INIT}, envoie les maps à MIP si un jeton est
            posé, puis les retire toujours des fichiers publics. Il ne fait jamais échouer la construction.
          </p>
          <CopyBlock code={script} />
          <p>
            Le jeton (<code className="chip-mono">msu_…</code>, 90 jours au plus) se crée{" "}
            {p.administrable ? (
              <a href={`/admin/sourcemaps?app=${encodeURIComponent(p.app)}`} className="font-medium text-brand hover:underline">
                dans la page des source maps
              </a>
            ) : (
              "par l'administrateur de l'application, dans la page des source maps"
            )}
            , puis se pose dans la plateforme de construction :
          </p>
          <div className="grid min-w-0 gap-2 lg:grid-cols-2">
            {JETON_PAR_PLATEFORME.map((j) => (
              <div key={j.id} className="min-w-0">
                <p className="mb-1 font-medium text-ink">{j.titre}</p>
                <CopyBlock code={j.code} />
              </div>
            ))}
          </div>
        </Bloc>
      )}

      <Bloc
        titre={`${1 + (rejeu ? 1 : 0) + (r.release ? 1 : 0) + 1} · Mention de confidentialité`}
        resume={`à ajouter à la politique de ${p.nomSite} ; suit vos réglages`}
        testId="kit-bloc-mention"
      >
        <p>À relire par votre délégué à la protection des données ; l&apos;accord de traitement avec MIP en fixe le cadre.</p>
        <CopyBlock code={mention} />
      </Bloc>
    </div>
  );
}
