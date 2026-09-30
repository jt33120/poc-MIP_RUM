// Les trois parcours de `/installer`, chacun en check-list : les prérequis propres à
// l'application, un geste par étape, puis le test « ça arrive ». Rendu serveur : les
// étapes (textes, codes préremplis) sont calculées ici et confiées à la check-list
// (client), qui n'en garde que les cases cochées.
//
// Tout code qui porte la clé passe par `CodeAvecSecret` : si la clé vient d'être
// remise dans cet onglet (création, régénération), elle remplace le repère
// `COLLE_ICI_LA_CLE_API` ; sinon le repère reste, et l'étape dit où trouver la clé.
// `guillemets: false` : le repère se remplace tel quel, qu'il soit entre guillemets
// (code de suivi), échappé (Worker Cloudflare) ou nu (variables OTEL_*) — une clé
// `mip_` suivie d'hexadécimal n'a rien à échapper.
import Link from "next/link";
import type { ReactNode } from "react";
import { CopyBlock } from "@/components/CopyBlock";
import { ICON_PATHS, Icon } from "@/components/icons";
import { ChecklistParcours, type EtapeChecklist } from "@/components/installer/ChecklistParcours";
import { CopierPourIA } from "@/components/installer/CopierPourIA";
import { EtatSondageEnDirect } from "@/components/installer/ParcoursInstallation";
import { CodeAvecSecret } from "@/components/secret/SecretUnique";
import { CadreEtat, EtatSurface } from "@/components/states/EtatSurface";
import { BackendStep } from "@/components/wizard/BackendStep";
import {
  DOC_DEPLOIEMENT_EXTENSION,
  ZIP_EXTENSION,
  strategieExtension,
  strategieNommage,
} from "@/lib/extension-deploiement";
import {
  REGLE_EXTENSION_SANS_CLE,
  type DomaineExtension,
  type Verification,
} from "@/lib/installer";
import type { InjectionArtifacts } from "@/lib/onboarding";
import { REPERE_CLE_API, nomDeService, type RecettesAgents } from "@/lib/recettes-agents-otel";

const LIEN = "font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf";
const BLOC = "min-w-0 rounded-lg border border-line bg-panel px-3 py-2";
const RESUME = "cursor-pointer text-xs font-semibold text-ink";

/** Ce que les parcours partagent : l'application, sa configuration, l'état de la sonde. */
export interface ContexteParcours {
  app: string;
  nomSecret: string;
  /** Un administrateur de l'application : la page lui montre les liens vers la fiche. */
  administrable: boolean;
  aUneCle: boolean;
  active: boolean;
  suspendue: boolean;
  origines: string[];
  /** `null` : la lecture des domaines de l'extension a échoué. */
  domainesExtension: DomaineExtension[] | null;
  /** La sonde n'a pas pu être lue : les cases restent en attente, et la page le dit. */
  sondeEnEchec: boolean;
  verifications: Verification[];
}

function Code({ ctx, code }: { ctx: ContexteParcours; code: string }) {
  return <CodeAvecSecret nom={ctx.nomSecret} code={code} repere={REPERE_CLE_API} rendu="copie" guillemets={false} />;
}

/** Ce que l'administrateur fait, ou à qui le client le demande. */
function Administrateur({ ctx, href, action, demande }: { ctx: ContexteParcours; href: string; action: string; demande: string }) {
  return ctx.administrable ? (
    <Link href={href} className={LIEN}>
      {action} →
    </Link>
  ) : (
    <span>{demande}</span>
  );
}

function etapesSonde(ctx: ContexteParcours): EtapeChecklist[] {
  return ctx.verifications.map((v) => ({
    id: v.id,
    groupe: "verification",
    titre: v.libelle,
    sonde: { ok: v.ok, detail: v.detail, aide: v.aide },
  }));
}

function AvantVerification({ ctx, consigne }: { ctx: ContexteParcours; consigne: ReactNode }) {
  return (
    <div className="grid gap-2">
      <p className="text-xs leading-relaxed text-ink-soft">{consigne}</p>
      {ctx.sondeEnEchec && <EtatSurface compact etat={{ kind: "erreur", titre: "test « ça arrive »" }} />}
      <EtatSondageEnDirect />
    </div>
  );
}

/** L'état de la clé : elle ne se réaffiche jamais, MIP n'en garde qu'une empreinte. */
function EtatCle({ ctx }: { ctx: ContexteParcours }) {
  const fiche = `/admin/customers/${encodeURIComponent(ctx.app)}`;
  return (
    <div className="grid gap-2">
      {ctx.aUneCle ? (
        <p>
          Une clé existe pour <code className="chip-mono">{ctx.app}</code>. Elle vous a été remise une seule fois, à la
          création de l&apos;application ou à sa dernière régénération : MIP n&apos;en garde qu&apos;une empreinte et ne
          peut pas la réafficher.
        </p>
      ) : (
        <CadreEtat ton="attention" role="note" compact>
          Aucune clé pour l&apos;instant : depuis le 29/09/2026, la collecte refuse toute mesure sans clé.
        </CadreEtat>
      )}
      <p>
        Perdue ou absente ? Une nouvelle clé se génère depuis la fiche de l&apos;application ; l&apos;ancienne cesse
        aussitôt de fonctionner, sur le site comme sur le serveur.{" "}
        <Administrateur
          ctx={ctx}
          href={fiche}
          action={ctx.aUneCle ? "Régénérer la clé sur la fiche" : "Générer la clé sur la fiche"}
          demande="Demandez-la à votre administrateur MIP."
        />
      </p>
    </div>
  );
}

/**
 * Le bandeau « Copier pour mon IA de code » en tête d'un parcours, quand la page en
 * fournit le prompt (la console, où l'application est connue ; jamais la
 * documentation publique, qui décrit sans installer).
 */
function BandeauIA({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2.5" data-testid="bandeau-ia">
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-ink">
        <strong className="font-semibold">Installation assistée :</strong> copiez un prompt qui explique à votre IA de code
        quoi installer, où et avec quelles valeurs. La clé d&apos;API n&apos;y figure pas.
      </p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

// ─── Code de suivi ───────────────────────────────────────────────────────────

export function ParcoursSnippet({
  ctx,
  snippet,
  snippetConsent,
  codeAppRouter,
  codePagesRouter,
  injection,
  csp,
  parLaConsole = null,
  promptIA = null,
}: {
  ctx: ContexteParcours;
  snippet: string;
  snippetConsent: string;
  codeAppRouter: string;
  codePagesRouter: string;
  injection: InjectionArtifacts;
  csp: { scriptSrc: string; connectSrc: string };
  /**
   * Collecte directe ouverte (P6b.G) : le code principal vise le collecteur, et
   * celui-ci, par la console, reste pour un site dont la CSP fige `connect-src`.
   * `null` : la collecte passe par la console, un seul code.
   */
  parLaConsole?: { snippet: string; connectSrc: string } | null;
  /** Le prompt « pour mon IA de code » (lib/prompts-ia.ts) ; `null` : pas de bandeau. */
  promptIA?: string | null;
}) {
  const fiche = `/admin/customers/${encodeURIComponent(ctx.app)}`;
  const etapes: EtapeChecklist[] = [
    {
      id: "domaines",
      groupe: "prerequis",
      titre: "Vos domaines sont déclarés auprès de MIP",
      corps: (
        <div className="grid gap-2" data-testid="domaines-declares">
          {!ctx.active && (
            <CadreEtat ton="erreur" role="alert" compact>
              L&apos;application est désactivée : la collecte refuse ses mesures tant que son administrateur ne l&apos;a pas
              réactivée.
            </CadreEtat>
          )}
          {ctx.suspendue && (
            <CadreEtat ton="erreur" role="alert" compact>
              La collecte de cette application est suspendue : ses mesures sont refusées jusqu&apos;à sa reprise.
            </CadreEtat>
          )}
          <p>Seuls ces domaines peuvent envoyer des mesures ; le navigateur bloque tout autre site (CORS).</p>
          {ctx.origines.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {ctx.origines.map((o) => (
                <li
                  key={o}
                  className="flex min-w-0 items-center gap-1.5 rounded-full border border-good/30 bg-good/10 px-2.5 py-0.5 text-ink"
                >
                  <code className="min-w-0 font-mono [overflow-wrap:anywhere]">{o}</code>
                  <span className="shrink-0 text-good-ink">autorisé</span>
                </li>
              ))}
            </ul>
          ) : (
            <CadreEtat ton="attention" role="note" compact>
              Aucun domaine déclaré : toutes les mesures seront refusées.
            </CadreEtat>
          )}
          <p>
            Un domaine à ajouter (préproduction, nouveau site) ? C&apos;est pris en compte en moins d&apos;une minute.{" "}
            <Administrateur ctx={ctx} href={fiche} action="Modifier les domaines sur la fiche" demande="Demandez-le à votre administrateur MIP." />
          </p>
        </div>
      ),
    },
    { id: "cle", groupe: "prerequis", titre: "Vous avez la clé d'API de l'application", corps: <EtatCle ctx={ctx} /> },
    {
      id: "copier",
      groupe: "installation",
      titre: "Copier le code de suivi",
      corps: (
        <div className="grid gap-2">
          <p>
            Déjà rempli pour <code className="chip-mono">{ctx.app}</code> : adresse du script, adresse de collecte,
            identifiant. Web Vitals, erreurs, sessions et appels réseau sont ensuite mesurés sans autre code.
          </p>
          <Code ctx={ctx} code={snippet} />
          {parLaConsole && (
            <>
              <p data-testid="voie-directe">
                Ce code envoie directement au collecteur de MIP : le pays des visiteurs vient de leur adresse IP, qui
                n&apos;est jamais gardée.
              </p>
              <details className="rounded-lg border border-line bg-panel2/60 px-3 py-2" data-testid="voie-console">
                <summary className="cursor-pointer text-ink">
                  Votre CSP ne peut pas autoriser le collecteur ? Le code par la console
                </summary>
                <div className="mt-2 grid gap-2">
                  <p>
                    Il envoie à la console, qui relaie au collecteur sans l&apos;adresse IP : le pays est alors estimé
                    (fuseau horaire), ou inconnu.
                  </p>
                  <Code ctx={ctx} code={parLaConsole.snippet} />
                </div>
              </details>
            </>
          )}
        </div>
      ),
    },
    {
      id: "poser-cle",
      groupe: "installation",
      titre: `Remplacer ${REPERE_CLE_API} par votre clé`,
      corps: (
        <p>
          Dans la ligne <code>apiKey</code>. Sans clé, ou avec une clé fausse, chaque envoi est refusé (erreur 403). Posée
          dans la page, la clé est lisible par tout visiteur : elle identifie l&apos;application, elle ne protège rien.
        </p>
      ),
    },
    {
      id: "coller",
      groupe: "installation",
      titre: "Coller les deux balises en tête du <head>, avant tout autre script",
      corps: (
        <div className="grid gap-2" data-testid="piles">
          <p>Selon votre site :</p>
          <details className={BLOC} open>
            <summary className={RESUME}>HTML, Vite, Create React App</summary>
            <p className="mt-2">
              Dans le <code>&lt;head&gt;</code> de <code>index.html</code>, tel quel.
            </p>
          </details>
          <details className={BLOC}>
            <summary className={RESUME}>Next.js (App Router)</summary>
            <div className="mt-2 grid gap-2">
              <p>
                Dans le layout racine. Deux balises ordinaires : le script en ligne s&apos;exécute après le chargement du
                premier, dans l&apos;ordre du document.
              </p>
              <Code ctx={ctx} code={codeAppRouter} />
            </div>
          </details>
          <details className={BLOC}>
            <summary className={RESUME}>Next.js (Pages Router)</summary>
            <div className="mt-2">
              <Code ctx={ctx} code={codePagesRouter} />
            </div>
          </details>
          <details className={BLOC}>
            <summary className={RESUME}>CMS ou gestionnaire de balises</summary>
            <div className="mt-2 grid gap-2">
              <p>
                Un tag « HTML personnalisé » déclenché sur toutes les pages (dans Google Tag Manager : « Initialization -
                All Pages »). Chargé plus tard, il peut manquer les toutes premières mesures, et il ne corrige pas la CSP
                (étape suivante).
              </p>
              <Code ctx={ctx} code={injection.gtm} />
            </div>
          </details>
          <details className={BLOC}>
            <summary className={RESUME}>Sans toucher au code du site</summary>
            <div className="mt-2 grid gap-3">
              <p>
                Logiciel du marché, application gérée par un tiers : les deux balises se posent depuis
                l&apos;infrastructure.
              </p>
              <div className="grid gap-1">
                <p className="font-semibold text-ink">Cloudflare Worker — injecte les balises et assouplit la CSP</p>
                <Code ctx={ctx} code={injection.worker} />
              </div>
              <div className="grid gap-1">
                <p className="font-semibold text-ink">nginx — si le HTML passe par un nginx que vous opérez</p>
                <Code ctx={ctx} code={injection.nginx} />
              </div>
            </div>
          </details>
        </div>
      ),
    },
    {
      id: "csp",
      groupe: "installation",
      titre: "Autoriser MIP dans la politique de sécurité (CSP) du site, s'il en a une",
      corps: (
        <div className="grid gap-2" data-testid="csp">
          <p>Ajoutez ces deux origines aux directives existantes, sans remplacer la politique du site :</p>
          <CopyBlock code={`${csp.scriptSrc}\n${csp.connectSrc}`} />
          {parLaConsole && (
            <p>
              Avec le code par la console, la collecte vise la console : <code>{parLaConsole.connectSrc}</code>.
            </p>
          )}
          <p>
            Le bloc d&apos;initialisation est un script en ligne : la CSP doit l&apos;autoriser (un nonce, ou
            &apos;unsafe-inline&apos;), sinon placez <code>MIPRum.init(…)</code> dans un fichier JavaScript du site.
            Autre possibilité : héberger <code>mip-rum.js</code> sur le domaine du site ; le rejeu charge alors{" "}
            <code>mip-rum-replay.js</code> depuis la même origine, à poser à côté.
          </p>
        </div>
      ),
    },
    {
      id: "consentement",
      groupe: "installation",
      titre: "Brancher le consentement, si votre bannière l'exige",
      facultatif: true,
      corps: (
        <div className="grid gap-2">
          <p>
            Avec <code>requireConsent</code>, rien ne part tant que votre outil de consentement n&apos;a pas appelé{" "}
            <code>MIPRum.consent(true)</code>. Cette version remplace celle de l&apos;étape 3.
          </p>
          <Code ctx={ctx} code={snippetConsent} />
        </div>
      ),
    },
    {
      id: "en-ligne",
      groupe: "installation",
      titre: "Mettre en ligne, puis ouvrir le site et naviguer",
      corps: (
        <p>
          Changez de page, cliquez : les mesures partent au fil de l&apos;eau et au départ de l&apos;onglet. INP et CLS
          n&apos;arrivent qu&apos;une fois la page masquée ou quittée.
        </p>
      ),
    },
    ...etapesSonde(ctx),
  ];
  return (
    <ChecklistParcours
      parcours="snippet"
      titre="SDK JavaScript — tous les visiteurs"
      etapes={etapes}
      entete={
        promptIA ? (
          <BandeauIA>
            <CopierPourIA prompt={promptIA} testId="ia-snippet" />
          </BandeauIA>
        ) : undefined
      }
      avantVerification={
        <AvantVerification ctx={ctx} consigne="Gardez cet onglet ouvert : les cases passent au vert d'elles-mêmes, à mesure que les données arrivent." />
      }
    />
  );
}

// ─── Extension ───────────────────────────────────────────────────────────────

const ETAT_DOMAINE: Record<DomaineExtension["etat"], { libelle: string; ton: string }> = {
  actif: { libelle: "observé", ton: "border-good/30 bg-good/10 text-good-ink" },
  coupe: { libelle: "coupé", ton: "border-warn/30 bg-warn/10 text-warn-ink" },
  non_enregistre: { libelle: "non enregistré", ton: "border-line bg-panel2 text-ink-soft" },
};

export function ParcoursExtension({
  ctx,
  storeUrl,
  updateUrl,
  promptIA = null,
}: {
  ctx: ContexteParcours;
  storeUrl: string | null;
  updateUrl: string | null;
  promptIA?: string | null;
}) {
  const domaines = ctx.domainesExtension ?? [];
  const actifs = domaines.filter((d) => d.etat === "actif");
  // La stratégie accorde d'avance les domaines enregistrés, ou, à défaut, ceux qu'il
  // faudrait enregistrer : le service informatique la corrigera d'un domaine plutôt
  // que de repartir d'un exemple.
  const hotes = (actifs.length ? actifs : domaines).map((d) => d.domaine);
  const etapes: EtapeChecklist[] = [
    {
      id: "domaine",
      groupe: "prerequis",
      titre: "Le domaine du site est enregistré côté MIP",
      corps: (
        <div className="grid gap-2" data-testid="domaines-extension">
          {ctx.domainesExtension === null ? (
            <EtatSurface compact etat={{ kind: "erreur", titre: "domaines de l'extension" }} />
          ) : domaines.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {domaines.map((d) => (
                <li
                  key={d.domaine}
                  className={`flex min-w-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 ${ETAT_DOMAINE[d.etat].ton}`}
                  data-etat={d.etat}
                >
                  <code className="min-w-0 font-mono text-ink [overflow-wrap:anywhere]">{d.domaine}</code>
                  <span className="shrink-0">{ETAT_DOMAINE[d.etat].libelle}</span>
                </li>
              ))}
            </ul>
          ) : (
            <CadreEtat ton="attention" role="note" compact>
              Aucun domaine enregistré : l&apos;extension n&apos;observera rien pour cette application.
            </CadreEtat>
          )}
          <p>
            L&apos;extension n&apos;observe que les domaines enregistrés, jamais les autres ; l&apos;enregistrement ajoute
            aussi le domaine à ceux qui peuvent envoyer des mesures.{" "}
            <Administrateur
              ctx={ctx}
              href="/admin/extension-scope"
              action="Enregistrer un domaine"
              demande="Pour en enregistrer un, demandez-le à votre administrateur MIP."
            />
          </p>
        </div>
      ),
    },
    {
      id: "installer",
      groupe: "installation",
      titre: "Installer l'extension sur les postes",
      corps: (
        <div className="grid gap-3">
          <div className="grid gap-2">
            <p className="font-semibold text-ink">Quelques postes (pilote)</p>
            {storeUrl ? (
              <a href={storeUrl} target="_blank" rel="noopener noreferrer" className="btn-accent inline-flex w-fit px-3 py-1.5 text-xs">
                Ajouter à Chrome →
              </a>
            ) : (
              <>
                <a
                  href={ZIP_EXTENSION}
                  download
                  className="btn-accent inline-flex w-fit items-center gap-1.5 px-3 py-1.5 text-xs"
                  data-testid="telecharger-extension"
                >
                  <Icon paths={ICON_PATHS.download} className="h-3.5 w-3.5" strokeWidth={2.2} />
                  Télécharger l&apos;extension (.zip)
                </a>
                <ol className="list-decimal space-y-1 pl-5">
                  <li>Dézippez le fichier dans un dossier stable : ne le supprimez pas ensuite.</li>
                  <li>
                    Ouvrez <code className="chip-mono">chrome://extensions</code> (Chrome) ou{" "}
                    <code className="chip-mono">edge://extensions</code> (Edge).
                  </li>
                  <li>Activez le mode développeur (Chrome : en haut à droite ; Edge : dans le panneau de gauche).</li>
                  <li>
                    Cliquez « Charger l&apos;extension non empaquetée » (Edge : « Charger l&apos;élément décompressé »),
                    puis choisissez le dossier.
                  </li>
                  <li>Épinglez l&apos;icône MIP RUM dans la barre d&apos;outils, pour l&apos;avoir sous la main.</li>
                </ol>
              </>
            )}
          </div>
          <div className="grid gap-2">
            <p className="font-semibold text-ink">Tout un parc géré (service informatique)</p>
            <p>
              Poussez cette stratégie <code className="chip-mono">ExtensionSettings</code> (GPO, Microsoft Intune ou
              Google Admin ; Chrome et Edge) : elle installe l&apos;extension d&apos;office et accorde d&apos;avance
              l&apos;accès aux domaines. L&apos;employé n&apos;a rien à faire.
            </p>
            <CopyBlock code={strategieExtension(hotes, updateUrl)} />
            <p>
              {updateUrl ? (
                <>
                  <code>update_url</code> pointe vers l&apos;hébergement du paquet signé.
                </>
              ) : (
                <>
                  Remplacez <code>update_url</code> par l&apos;adresse où votre service informatique héberge le paquet
                  signé (<code>.crx</code>) et son fichier <code>update.xml</code>. Le paquet signé est préparé par MIP,
                  qui détient sa clé de signature.
                </>
              )}{" "}
              <a href={DOC_DEPLOIEMENT_EXTENSION} target="_blank" rel="noopener noreferrer" className={LIEN}>
                Empaquetage et mise à jour →
              </a>
            </p>
          </div>
        </div>
      ),
    },
    {
      id: "nommer",
      groupe: "installation",
      titre: "Nommer les postes dans l'inventaire (parc géré)",
      facultatif: true,
      corps: (
        <div className="grid gap-2">
          <p>
            Sans cette seconde stratégie, chaque poste apparaît sous un identifiant anonyme. Le libellé vient de votre
            outil d&apos;administration : MIP ne le fabrique jamais.
          </p>
          <CopyBlock code={strategieNommage()} />
          <p>
            Remplacez <code className="chip-mono">{"${machine_name}"}</code> par la variable de votre outil :{" "}
            <code className="chip-mono">%COMPUTERNAME%</code> (GPO, Intune), <code className="chip-mono">$COMPUTERNAME</code>{" "}
            (Jamf). Un nom de machine reste un inventaire de parc ; un nom de personne en fait un traitement de données
            personnelles, à déclarer comme tel.
          </p>
        </div>
      ),
    },
    {
      id: "autoriser",
      groupe: "installation",
      titre: "Autoriser le site d'un clic, sur chaque poste",
      corps: (
        <p>
          Sur le site enregistré, cliquez l&apos;icône MIP RUM, puis « Activer sur ce domaine », et acceptez la demande du
          navigateur. Le menu affiche ensuite « MIP RUM observe ce domaine. ». Inutile sur un parc dont la stratégie a déjà
          accordé l&apos;accès.
        </p>
      ),
    },
    {
      id: "naviguer",
      groupe: "installation",
      titre: "Ouvrir le site sur un poste équipé, et naviguer",
    },
    ...etapesSonde(ctx),
  ];
  return (
    <ChecklistParcours
      parcours="extension"
      titre="Extension navigateur — les postes équipés"
      etapes={etapes}
      entete={
        <div className="mb-4 grid gap-2">
          {promptIA && (
            <BandeauIA>
              <CopierPourIA prompt={promptIA} testId="ia-extension" />
            </BandeauIA>
          )}
          {/* Sans clé, c'est le domaine enregistré qui ouvre la collecte : le client doit le lire avant l'étape 1. */}
          <CadreEtat ton="neutre" role="note" testId="regle-extension" etat="information">
            <strong className="font-semibold text-ink">À savoir : </strong>
            {REGLE_EXTENSION_SANS_CLE}
          </CadreEtat>
          <p className="text-xs leading-relaxed text-ink-soft">
            L&apos;extension injecte le même code de suivi, sans toucher au site, mais seulement dans les navigateurs où
            elle est installée : jamais l&apos;ensemble des visiteurs.
          </p>
        </div>
      }
      avantVerification={
        <AvantVerification ctx={ctx} consigne="Gardez cet onglet ouvert pendant que vous naviguez sur un poste équipé." />
      }
    />
  );
}

// ─── Serveur ─────────────────────────────────────────────────────────────────

export function ParcoursServeur({
  ctx,
  recettes,
  promptsIA = [],
}: {
  ctx: ContexteParcours;
  recettes: RecettesAgents;
  /** Un prompt par langage à recette dédiée (lib/prompts-ia.ts) ; vide : pas de bandeau. */
  promptsIA?: readonly { id: string; langage: string; prompt: string }[];
}) {
  const etapes: EtapeChecklist[] = [
    { id: "cle", groupe: "prerequis", titre: "Vous avez la clé d'API de l'application", corps: <EtatCle ctx={ctx} /> },
    {
      id: "code-suivi",
      groupe: "prerequis",
      titre: "Le code de suivi est posé sur le site",
      corps: (
        <p>
          C&apos;est lui qui ajoute l&apos;en-tête <code>traceparent</code> aux appels du navigateur : sans lui, les temps
          serveur arrivent, mais aucun appel n&apos;est relié à sa part serveur.
        </p>
      ),
    },
    {
      id: "recette",
      groupe: "installation",
      titre: "Choisir le langage du serveur et copier sa recette",
      corps: <BackendStep recettes={recettes} nomSecret={ctx.nomSecret} />,
    },
    {
      id: "poser-cle",
      groupe: "installation",
      titre: "Poser la clé dans mip.api_key, et adapter le nom du service",
      corps: (
        <p>
          Remplacez le repère <code>{REPERE_CLE_API}</code> par la clé ; elle reste côté serveur. Le nom du service (
          <code>OTEL_SERVICE_NAME</code>, prérempli à <code className="chip-mono">{nomDeService(ctx.app)}</code>) est celui
          qu&apos;affichera le Tracing.
        </p>
      ),
    },
    {
      id: "lancer",
      groupe: "installation",
      titre: "Relancer l'application sous l'agent",
      corps: <p>La dernière ligne de la recette. Aucun changement de code : l&apos;agent instrumente le serveur au démarrage.</p>,
    },
    {
      id: "cors",
      groupe: "installation",
      titre: "API sur une autre origine que le site : accepter traceparent et tracestate",
      facultatif: true,
      corps: (
        <div className="grid gap-2">
          <p>Sans cela, le navigateur bloque l&apos;appel. Côté API, en réponse au préflight :</p>
          <CopyBlock code="Access-Control-Allow-Headers: traceparent, tracestate" />
          <p>
            Côté code de suivi, ajoutez l&apos;origine de l&apos;API à l&apos;option <code>trace</code> : par défaut, seuls les
            appels vers l&apos;origine du site portent l&apos;en-tête.
          </p>
          <CopyBlock code={`trace: ["https://api.exemple.fr"],`} />
        </div>
      ),
    },
    {
      id: "appeler",
      groupe: "installation",
      titre: "Ouvrir une page du site qui appelle l'API",
    },
    ...etapesSonde(ctx),
  ];
  return (
    <ChecklistParcours
      parcours="serveur"
      titre="Serveur — la part serveur de chaque appel"
      etapes={etapes}
      entete={
        <>
          {promptsIA.length > 0 && (
            <BandeauIA>
              {promptsIA.map((p) => (
                <CopierPourIA key={p.id} prompt={p.prompt} libelle={p.langage} testId={`ia-serveur-${p.id}`} />
              ))}
            </BandeauIA>
          )}
        <p className="mb-4 text-xs leading-relaxed text-ink-soft">
          Recommandé : la mesure du navigateur fonctionne sans lui, mais avec lui chaque appel est suivi jusqu&apos;au
          serveur, et sa lenteur localisée. Rien à télécharger chez MIP : l&apos;agent
          OpenTelemetry officiel de votre langage, réglé par quelques variables d&apos;environnement.
        </p>
        </>
      }
      avantVerification={
        <AvantVerification ctx={ctx} consigne="Gardez cet onglet ouvert pendant que vous appelez l'API depuis le site." />
      }
    />
  );
}
