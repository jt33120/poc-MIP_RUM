// Ajout d'un projet à mesurer (le « + » de /select), et installation du capteur d'un
// projet existant (`?app=`). Plein écran, sans coquille (comme /select). Deux temps :
// (1) formulaire minimal nom + adresse ; (2) l'intégration en deux méthodes — le SDK
// embarqué (site dont on contrôle le code) OU un favori de test (n'importe quelle
// page, pour simuler un parcours) — puis un guide de simulation et la vérification en
// direct. Création réservée aux administrateurs.
//
// Vocabulaire aligné sur la présentation (recette du 26/09/2026) : « SDK embarqué »
// et « extension navigateur », « favori de test » plutôt que « bookmarklet », sans
// renvoi vers un fichier du code que l'utilisateur ne peut pas ouvrir.
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { ECRANS_ADMIN } from "@mip/console-contract";
import { CopyBlock } from "@/components/CopyBlock";
import { ICON_PATHS, Icon } from "@/components/icons";
import { ThemeToggle } from "@/components/ThemeToggle";
import { OnboardingPoll } from "@/components/OnboardingPoll";
import { CodeAvecSecret, FormulaireSecret, SecretAffiche, SecretFourni } from "@/components/secret/SecretUnique";
import { BackendStep } from "@/components/wizard/BackendStep";
import { WizardBadge } from "@/components/wizard/WizardStep";
import {
  DOC_DEPLOIEMENT_EXTENSION,
  EXTENSION_ID,
  ZIP_EXTENSION,
  strategieExtension,
  strategieNommage,
} from "@/lib/extension-deploiement";
import { ingestEndpoint, voieRecommandee } from "@/lib/ingest-endpoint";
import { recettesAgentsOtel } from "@/lib/recettes-agents-otel";
import { chargerNouveauSite } from "@/lib/chargeurs/projets";
import { chargerEcran } from "@/lib/ecran";
import { fmtInstant, pluriel } from "@/lib/format";
import { buildSnippet, deriveStatus } from "@/lib/onboarding";
import { cleDe } from "@/lib/secret-remis";
import type { SearchParams } from "@/lib/filters";
import type { Fil } from "@mip/console-contract";
import { selectProjectAction } from "../actions";
import { createSiteAction } from "./actions";

export const dynamic = "force-dynamic";

/** Le repère de la clé d'API dans un code à copier, tant qu'elle n'a pas été remise. */
const REPERE_CLE = "COLLE_ICI_LA_CLE_API";

const ERRORS: Record<string, string> = {
  name: "Donnez un nom au projet.",
  app_id: "Identifiant invalide (minuscules, chiffres et tirets, 3–40 caractères).",
  url: "Adresse invalide — attendez une URL http(s) complète (ex. https://mon-app.fr).",
  exists: "Cet identifiant est déjà pris — choisissez-en un autre.",
};

// Modes de collecte proposés à l'étape 1 (récap avantages / inconvénients).
const MODES = [
  {
    value: "sdk",
    badge: "deux balises dans la page",
    title: "SDK embarqué",
    desc: "Deux balises dans le <head> de l'application. Web Vitals, erreurs, sessions et appels réseau sont ensuite mesurés sans autre code.",
    pros: ["Couvre tous vos visiteurs réels", "Les données les plus riches (rejeu, traces)", "Permanent"],
    cons: ["Nécessite d'accéder au code de l'application"],
    when: "Vous contrôlez le code et voulez mesurer l'expérience de tous vos utilisateurs.",
  },
  {
    value: "extension",
    badge: "sans toucher au code",
    title: "Extension navigateur",
    desc: "Une extension installée sur les postes ; elle injecte le capteur sur le domaine enregistré, sans modifier l'application.",
    pros: ["Zéro code sur l'application", "Déployable par politique d'entreprise sur un parc"],
    cons: ["Ne couvre que les postes équipés (pas le grand public)", "Le domaine doit être enregistré"],
    when: "Vous ne contrôlez pas le code, ou vous suivez l'expérience d'un parc interne (employés).",
  },
] as const;

export default async function AddSite({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // Le chargeur (`lib/chargeurs/projets.ts`, C9) : le formulaire à la plateforme ;
  // l'intégration d'un site à ses administrateurs. Hors de là, retour aux projets.
  const ecran = await chargerEcran(ECRANS_ADMIN.nouveauSite, chargerNouveauSite, sp);
  if (ecran.etat === "sans_session") redirect("/login");
  if (ecran.etat === "interdit") redirect("/select");
  if (ecran.etat === "introuvable") redirect("/select/new");

  return (
    <main className="mip-sci min-h-screen px-6 py-14">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-8 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-deep shadow-glow">
            <Icon paths={ICON_PATHS.activity} className="h-5 w-5 text-white" strokeWidth={2.4} />
          </span>
          <div className="leading-tight">
            <div className="text-base font-bold tracking-tight text-ink">
              MIP <span className="text-accent">RUM</span>
            </div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-ink-soft">
              {ecran.etat === "integration" ? "Installer le capteur" : "Ajouter un projet"}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2.5">
            <ThemeToggle />
            <Link href="/select" className="btn-ghost">
              ← Projets
            </Link>
          </div>
        </header>

        {ecran.etat === "integration" ? (
          <Integration ecran={ecran} cree={sp.cree === "1"} />
        ) : (
          <CreateForm error={typeof sp.error === "string" ? sp.error : null} />
        )}
      </div>
    </main>
  );
}

/** Étape 1 — nom, adresse, et choix du mode de collecte. */
function CreateForm({ error }: { error: string | null }) {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight text-ink">Ajouter un projet</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        Un site, une application web, une plateforme… Donnez-lui un nom et son adresse, choisissez comment
        mesurer, et la page suivante vous donne la configuration — deux balises dans la page, ou rien à
        toucher dans le code.
      </p>

      {error && (
        <div className="mt-6 rounded-lg border border-bad/30 bg-bad/10 px-4 py-2.5 text-sm text-bad-ink">
          {ERRORS[error] ?? "Vérifiez les champs."}
        </div>
      )}

      {/* La clé générée est rendue au formulaire, qui la remet à l'étape 2 (C9c). */}
      <FormulaireSecret action={createSiteAction} className="mt-6 grid gap-4">
        <label className="text-sm font-medium text-ink-soft">
          Nom du projet
          <input name="name" required autoFocus placeholder="Ma boutique" className="field mt-1 w-full" />
        </label>
        <label className="text-sm font-medium text-ink-soft">
          Adresse (URL)
          <input
            name="url"
            type="url"
            required
            placeholder="https://ma-boutique.fr"
            className="field mt-1 w-full"
          />
          <span className="mt-1 block text-xs text-ink-soft">
            Sert d&apos;origine autorisée pour le SDK embarqué, et de domaine observé pour
            l&apos;extension. Ajoutez d&apos;autres domaines plus tard si besoin.
          </span>
        </label>

        {/* Mode de collecte : 2 cartes radio (sélection sans JS via peer-checked). */}
        <fieldset className="mt-1">
          <legend className="mb-2 text-sm font-medium text-ink-soft">Mode d&apos;installation</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {MODES.map((m, i) => (
              <label key={m.value} className="relative block cursor-pointer">
                <input
                  type="radio"
                  name="mode"
                  value={m.value}
                  defaultChecked={i === 0}
                  className="peer sr-only"
                />
                <div className="h-full rounded-xl border border-line bg-panel p-4 transition peer-checked:border-accent peer-checked:bg-accent/[0.04] peer-checked:ring-2 peer-checked:ring-accent/20 hover:border-ink-faint/40">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-ink">{m.title}</span>
                    <span className="rounded-full bg-panel2 px-2 py-0.5 text-[10px] font-medium text-ink-soft">
                      {m.badge}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">{m.desc}</p>
                  <ul className="mt-2.5 space-y-1 text-[11px]">
                    {m.pros.map((p) => (
                      <li key={p} className="flex gap-1.5 text-ink-soft">
                        <span className="text-good-ink">✓</span>
                        {p}
                      </li>
                    ))}
                    {m.cons.map((c) => (
                      <li key={c} className="flex gap-1.5 text-ink-soft">
                        <span className="text-warn-ink">–</span>
                        {c}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2.5 border-t border-line pt-2 text-[11px] leading-relaxed text-ink-soft">
                    <strong className="font-semibold text-ink-soft">Quand :</strong> {m.when}
                  </p>
                </div>
              </label>
            ))}
          </div>
        </fieldset>

        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-medium text-ink-soft">Identifiant personnalisé (optionnel)</summary>
          <input
            name="app_id"
            placeholder="ma-boutique"
            className="field mt-2 w-full font-mono"
          />
          <span className="mt-1 block text-xs text-ink-soft">
            Par défaut dérivé du nom. Il accompagne chaque mesure : court et stable.
          </span>
        </details>
        <button type="submit" className="btn-accent mt-1 w-fit px-4 py-2">
          Créer le projet →
        </button>
      </FormulaireSecret>
    </>
  );
}

/** Étape 2 — configuration selon le mode + simulation + checklist live. */
async function Integration({
  ecran,
  cree,
}: {
  ecran: Extract<Fil<Awaited<ReturnType<typeof chargerNouveauSite>>>, { etat: "integration" }>;
  /** Juste après la création (`cree=1`, posé par l'action) : sinon, c'est un projet existant. */
  cree: boolean;
}) {
  // Domaines observés par l'extension (dérivés des origines CORS de l'app), avec
  // leur statut réel dans le registre extension_scope : lus par le chargeur.
  const { app: appId, mode, client: customer, sonde: probe, domaines: extensionDomains } = ecran;
  const status = deriveStatus(probe);
  // La clé d'API, juste après la création : rendue au formulaire de l'étape 1 et
  // remise ici (C9c) — le bandeau l'affiche, le bookmarklet et les recettes des
  // agents serveur la portent à la place de leur repère. Sinon, le repère reste.
  const nomCle = cleDe(appId);

  const host = (await headers()).get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  const sdkUrl = `${proto}://${host}/mip-rum.js`;
  // Collecte directe (P6b.G) : le collecteur par défaut dès que sa variable est
  // posée, comme la fiche du projet, qui garde aussi le code par la console pour
  // une CSP figée. Sans elle, `voie` vaut « console » et rien ne change.
  const voie = voieRecommandee();
  const endpoint = ingestEndpoint("traces", host, voie);

  const snippet = buildSnippet({ sdkUrl, endpoint, appId, clientId: null, withConsent: false, voie });
  // Bookmarklet : injecte le SDK sur la page courante puis démarre la mesure —
  // pour monitorer/simuler un parcours sur un site qu'on ne contrôle pas. La clé
  // est embarquée (l'enforcement l'exige) : la vraie si elle vient d'être remise
  // (juste après création), sinon un placeholder à remplacer.
  const bmKey = REPERE_CLE;
  const bookmarklet =
    `javascript:(function(){var s=document.createElement('script');s.src=${JSON.stringify(sdkUrl)};` +
    `s.onload=function(){window.MIPRum&&MIPRum.init({endpoint:${JSON.stringify(endpoint)},` +
    `appId:${JSON.stringify(appId)},clientId:'mip',env:'prod',apiKey:${JSON.stringify(bmKey)}});};` +
    `document.head.appendChild(s);})();`;
  // Serveur (facultatif) : l'agent OpenTelemetry officiel du langage, sans
  // changement de code — ses spans serveur se rattachent à l'appel du navigateur.
  // Plus de capteur maison depuis le 29/09/2026 (lib/recettes-agents-otel.ts).
  // Toujours par la console : l'adresse d'un serveur ne dit rien d'un visiteur.
  const recettesServeur = recettesAgentsOtel({
    appId,
    adresses: { traces: ingestEndpoint("traces", host), logs: ingestEndpoint("logs", host) },
  });

  // La clé n'est exigée que si la collecte ferme l'accès sans clé ; lu ici plutôt
  // qu'importé de lib/ingest.ts, qui tirerait la base dans cet écran (cliquet de la
  // piste C). Même variable, même règle.
  const cleExigee = process.env.REQUIRE_API_KEY === "true";

  return (
    <SecretFourni nom={nomCle}>
      {cree ? (
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-good/15 text-good-ink">✓</span>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Le projet « {customer.name} » est créé</h1>
        </div>
      ) : (
        <h1 className="text-2xl font-bold tracking-tight text-ink">Installer le capteur — {customer.name}</h1>
      )}
      <p className="mt-1.5 text-sm text-ink-soft">
        Projet <code className="chip-mono">{appId}</code> · mode{" "}
        <strong>{mode === "extension" ? "extension navigateur" : "SDK embarqué"}</strong>.{" "}
        {mode === "extension"
          ? "Le domaine est enregistré : installez l'extension puis testez."
          : "Posez le capteur, puis simulez un parcours."}{" "}
        <Link href={`/select/new?app=${encodeURIComponent(appId)}&mode=${mode === "extension" ? "sdk" : "extension"}`} className="text-accent-ink underline-offset-2 hover:underline">
          Voir l&apos;autre mode
        </Link>
      </p>

      <SecretAffiche
        nom={nomCle}
        testid="one-time-key"
        testidValeur="generated-key"
        className="mt-5 rounded-lg border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-ink"
        codeClassName="rounded bg-panel px-2 py-0.5 font-mono text-ink"
        prefixe="Clé d'API de"
        suffixe="(affichée une seule fois) :"
        note={
          <span className="mt-1 block text-xs text-ink-soft">
            Déjà incluse dans le code à copier ci-dessous. Notez-la pour la suite.
          </span>
        }
      />

      {mode === "extension" ? (
        <ExtensionConfig
          appId={appId}
          domains={extensionDomains}
          storeUrl={process.env.CHROME_STORE_URL ?? null}
          updateUrl={process.env.EXTENSION_UPDATE_URL ?? null}
        />
      ) : (
        <>
          {/* Méthode 1 — SDK embarqué */}
          <section className="card mt-6 p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-perf/10 text-xs font-bold text-perf">1</span>
              SDK embarqué — vous contrôlez le code de l&apos;application
            </h2>
            <p className="mt-2 text-xs text-ink-soft">
              Collez ces deux balises dans le <code>&lt;head&gt;</code>, avant tout autre script. Web Vitals,
              erreurs, sessions et appels réseau sont ensuite mesurés sans autre code.
            </p>
            <div className="mt-3">
              <CodeAvecSecret nom={nomCle} code={snippet} repere={REPERE_CLE} rendu="copie" />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-ink-soft" data-testid="cle-facultative">
              {cleExigee ? (
                <>La clé d&apos;API est exigée par la collecte : remplacez le repère par la clé du projet. </>
              ) : (
                <>
                  La clé d&apos;API est facultative tant que la collecte ne l&apos;exige pas : sans clé, retirez
                  la ligne <code>apiKey</code>.{" "}
                </>
              )}
              Une clé posée dans la page est lisible par tout visiteur : elle identifie le projet, elle ne
              protège rien. Pour en générer une nouvelle :{" "}
              <Link href={`/admin/customers/${encodeURIComponent(appId)}`} className="text-accent-ink underline-offset-2 hover:underline">
                fiche du projet
              </Link>
              .
            </p>
            {voie === "directe" && (
              <p className="mt-2 text-xs leading-relaxed text-ink-soft" data-testid="voie-directe">
                Collecte directe : le collecteur déduit le pays des visiteurs de leur adresse IP, sans la conserver.
                Un site dont la politique de sécurité (CSP) fige <code>connect-src</code> prend plutôt le code
                « par la console » de la fiche du projet.
              </p>
            )}
          </section>

          {/* Méthode 2 — favori de test. Masqué sous 768 px : un favori à glisser dans
              une barre de favoris n'a pas de sens sur un téléphone. */}
          <section className="card mt-5 hidden p-5 md:block">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ai/10 text-xs font-bold text-ai">2</span>
              Favori de test — n&apos;importe quelle page, sans toucher au code
            </h2>
            <p className="mt-2 text-xs text-ink-soft">
              Idéal pour une démo ou pour <strong>simuler un parcours client</strong> sur une application que
              vous ne contrôlez pas : glissez le bouton dans votre barre de favoris, ouvrez la page cible,
              cliquez le favori — le SDK s&apos;injecte et la mesure démarre pour{" "}
              <code className="chip-mono">{appId}</code>.
            </p>
            <div className="mt-3">
              <CodeAvecSecret nom={nomCle} code={bookmarklet} repere={REPERE_CLE} rendu="bookmarklet" label={`Mesurer le projet ${appId}`} />
            </div>
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer font-medium text-ink-soft">Voir le code / limites</summary>
              <div className="mt-2 grid gap-2 text-ink-soft">
                <CodeAvecSecret nom={nomCle} code={bookmarklet} repere={REPERE_CLE} rendu="copie" />
                <p className="text-ink-soft">
                  Créez un favori manuellement et collez ce code comme adresse si le glisser-déposer n&apos;est
                  pas possible. Sans la clé affichée ci-dessus, remplacez <code>{REPERE_CLE}</code> par la clé du
                  projet, ou retirez-la si la collecte ne l&apos;exige pas. Une application à{" "}
                  <strong>politique de sécurité stricte</strong> (CSP) peut bloquer l&apos;injection : dans ce cas,
                  utilisez la méthode 1 (ou le mode extension). C&apos;est une mesure <strong>temporaire</strong>{" "}
                  (le temps de l&apos;onglet), faite pour tester ; le SDK embarqué est le mode permanent.
                </p>
              </div>
            </details>
          </section>

          {/* Simuler un parcours */}
          <section className="card mt-5 p-5">
            <h2 className="text-sm font-semibold text-ink">Simuler un parcours client</h2>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-ink-soft">
              <li>Ouvrez l&apos;application (avec le SDK posé, ou après avoir cliqué le favori de test).</li>
              <li>Naviguez comme un vrai visiteur : changez de page, cliquez, remplissez un champ, provoquez une erreur.</li>
              <li>Laissez ~5 s : les mesures partent en continu (et au départ de l&apos;onglet).</li>
              <li>Revenez ici — la vérification ci-dessous passe au vert, puis les données s&apos;affichent dans la console.</li>
            </ol>
          </section>
        </>
      )}

      {/* Brancher le backend (optionnel) — la part du serveur dans chaque appel */}
      <section className="card mt-5 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          Brancher le serveur <span className="rounded-full bg-panel2 px-2 py-0.5 text-[11px] font-medium text-ink-soft">facultatif</span>
        </h2>
        <p className="mt-2 text-xs text-ink-soft">
          Pour relier chaque appel du navigateur à son <strong>exécution serveur</strong>, et voir la part du
          serveur dans un appel lent.
        </p>
        <div className="mt-3">
          <BackendStep recettes={recettesServeur} nomSecret={nomCle} />
        </div>
        <p className="mt-2 text-xs text-ink-soft">
          Injection du code de suivi sans toucher au code du site : le guide d&apos;intégration de la{" "}
          <Link href={`/admin/customers/${encodeURIComponent(appId)}`} className="text-accent-ink underline-offset-2 hover:underline">
            fiche du projet
          </Link>
          . Application mobile React Native : un SDK dédié existe, sur demande (il n&apos;est pas encore publié).
        </p>
      </section>

      {/* Vérification en direct */}
      <section className="card mt-5 p-5">
        <OnboardingPoll live={status.live} />
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Les données arrivent-elles ?</h2>
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${status.live ? "bg-good/15 text-good-ink" : "bg-warn/15 text-warn-ink"}`}>
            {status.live ? "Données reçues" : "En attente"}
          </span>
        </div>
        <p className="mt-1 text-xs text-ink-soft">
          {status.live
            ? "À jour. Heures de Paris."
            : "Rafraîchissement automatique toutes les 5 s — gardez cet onglet ouvert. Heures de Paris."}
        </p>
        <div className="mt-3 grid gap-2">
          <CheckRow label="Premières Web Vitals reçues" state={status.snippet}>
            {probe.first_metric_at ? fmtInstant(probe.first_metric_at) : "en attente"}
          </CheckRow>
          {/* « actives » : commencées ou poursuivies sur la fenêtre — d'où un compte qui
              peut dépasser celui des sessions commencées de la vue d'ensemble. */}
          <CheckRow label="Sessions actives sur les dernières 24 h" state={status.traffic}>
            {probe.sessions_24h ? pluriel(probe.sessions_24h, "session") : "aucune"}
          </CheckRow>
          <CheckRow label="Appels réseau tracés côté navigateur" state={status.tracingFront}>
            {probe.first_front_span_at ? fmtInstant(probe.first_front_span_at) : "en attente"}
          </CheckRow>
        </div>
      </section>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <form action={selectProjectAction}>
          <input type="hidden" name="app" value={appId} />
          <button type="submit" className="btn-accent px-4 py-2" data-testid="supervise-project">
            Superviser ce projet →
          </button>
        </form>
        {/* Le guide pas à pas, lisible aussi par l'équipe du client (trois parcours,
            chacun avec son test en direct) : à transmettre à qui pose le capteur. */}
        <Link href={`/installer?app=${encodeURIComponent(appId)}`} className="btn-ghost px-4 py-2" data-testid="lien-installer">
          Guide d&apos;installation pas à pas
        </Link>
      </div>
    </SecretFourni>
  );
}

// L'identifiant, le paquet et les stratégies de l'extension : `lib/extension-deploiement.ts`,
// partagé avec `/installer` — deux copies de l'identifiant pouvaient diverger.
const EXT_ID = EXTENSION_ID;
const EXT_ZIP = ZIP_EXTENSION;
const GH_DOC = DOC_DEPLOIEMENT_EXTENSION;

/**
 * Étape 2 — mode extension. Deux VOIES d'installation, tout dans la console
 * (plus de renvoi vers un doc GitHub comme chemin principal) :
 *   A. Poste individuel — « Ajouter à Chrome » (Store, dès qu'il est publié) ou
 *      téléchargement du .zip + chargement « non empaqueté » (utilisable tout de suite).
 *   B. Parc entreprise — policy ExtensionSettings pré-remplie (ID + domaines réels),
 *      copiable, à coller dans GPO / Intune / Google Admin (zéro geste utilisateur).
 */
function ExtensionConfig({
  appId,
  domains,
  storeUrl,
  updateUrl,
}: {
  appId: string;
  domains: { host: string; registered: boolean }[];
  storeUrl: string | null;
  updateUrl: string | null;
}) {
  const allRegistered = domains.length > 0 && domains.every((d) => d.registered);
  // Policy ExtensionSettings pré-remplie : l'ID de l'extension + les domaines
  // réellement enregistrés (runtime_allowed_hosts). L'IT n'a qu'à coller.
  const policy = strategieExtension(
    domains.map((d) => d.host),
    updateUrl,
  );
  // Nommage des postes dans l'inventaire : une policy SÉPARÉE d'ExtensionSettings
  // (`strategieNommage`). MIP ne fabrique jamais ce libellé — sans cette policy,
  // l'inventaire reste anonyme.
  const nommage = strategieNommage();

  return (
    <>
      {/* Domaine(s) enregistrés — hors périmètre, l'extension n'observe rien. */}
      <section className="card mt-6 p-5">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full ${allRegistered ? "bg-good/15 text-good-ink" : "bg-warn/15 text-warn-ink"}`}
          >
            {allRegistered ? "✓" : "!"}
          </span>
          <h2 className="text-sm font-semibold text-ink">
            {allRegistered ? "Domaine enregistré" : "Domaine à enregistrer"}
          </h2>
        </div>
        {domains.length ? (
          <>
            <ul className="mt-2 flex flex-wrap gap-2">
              {domains.map((d) => (
                <li
                  key={d.host}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${
                    d.registered
                      ? "border-good/30 bg-good/10 text-ink"
                      : "border-warn/30 bg-warn/10 text-ink"
                  }`}
                >
                  <span className={d.registered ? "text-good-ink" : "text-warn-ink"}>{d.registered ? "✓" : "•"}</span>
                  <code className="font-mono">{d.host}</code>
                  <span className="text-ink-soft">{d.registered ? "observé" : "non enregistré"}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-ink-soft">
              Ces domaines sont rattachés au projet <code className="chip-mono">{appId}</code>. En dehors des
              domaines enregistrés, l&apos;extension n&apos;observe <strong>rien</strong>.
            </p>
          </>
        ) : (
          <p className="mt-2 text-xs text-ink-soft">
            Aucun domaine détecté depuis l&apos;URL — ajoutez-le dans la gestion des domaines ci-dessous.
          </p>
        )}
        <Link href="/admin/extension-scope" className="mt-3 inline-block text-xs font-medium text-accent-ink underline-offset-2 hover:underline">
          Gérer les domaines observés →
        </Link>
      </section>

      {/* Voie A — poste individuel : Store (1 clic) ou .zip (dès maintenant). */}
      <section className="card mt-5 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-perf/10 text-xs font-bold text-perf">A</span>
            Installer sur un poste
          </h2>
          <span className="rounded-full bg-panel2 px-2 py-0.5 text-[10px] font-medium text-ink-soft">1 poste · test / démo</span>
        </div>

        {storeUrl ? (
          <>
            <p className="mt-2 text-xs text-ink-soft">
              L&apos;extension est publiée : installation en un clic, mises à jour automatiques.
            </p>
            <a href={storeUrl} target="_blank" rel="noopener noreferrer" className="btn-accent mt-3 inline-flex w-fit items-center gap-1.5 px-4 py-2">
              Ajouter à Chrome →
            </a>
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer font-medium text-ink-soft">Sans le Store (poste hors ligne, autre navigateur)</summary>
              <ZipInstall />
            </details>
          </>
        ) : (
          <>
            <p className="mt-2 text-xs text-ink-soft">
              Publication Chrome Web Store à venir (installation « Ajouter à Chrome » en un clic). En
              attendant, l&apos;extension est <strong>utilisable dès maintenant</strong> par téléchargement :
            </p>
            <a href={EXT_ZIP} download className="btn-accent mt-3 inline-flex w-fit items-center gap-1.5 px-4 py-2">
              <Icon paths={ICON_PATHS.download} className="h-4 w-4" strokeWidth={2.2} />
              Télécharger l&apos;extension (.zip)
            </a>
            <ZipInstall />
          </>
        )}
      </section>

      {/* Voie B — parc entreprise : policy pré-remplie, zéro geste utilisateur. */}
      <section className="card mt-5 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ai/10 text-xs font-bold text-ai">B</span>
            Déployer sur un parc (IT)
          </h2>
          <span className="rounded-full bg-panel2 px-2 py-0.5 text-[10px] font-medium text-ink-soft">parc géré · sans geste utilisateur</span>
        </div>
        <p className="mt-2 text-xs text-ink-soft">
          Collez cette stratégie <code className="chip-mono">ExtensionSettings</code> dans votre console
          d&apos;administration (GPO Windows, Microsoft Intune ou Google Admin). Elle force l&apos;installation
          et pré-accorde l&apos;accès aux domaines enregistrés — l&apos;employé n&apos;a <strong>rien</strong> à
          faire. Déjà pré-remplie avec l&apos;ID de l&apos;extension et vos domaines :
        </p>
        <div className="mt-3">
          <CopyBlock code={policy} />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
          {updateUrl ? (
            <>
              <code className="chip-mono">update_url</code> pointe vers votre hébergement du <code>.crx</code>.
            </>
          ) : (
            <>
              Remplacez <code className="chip-mono">update_url</code> par l&apos;URL où vous hébergez le{" "}
              <code>.crx</code> + <code>update.xml</code> (packaging à faire une fois).
            </>
          )}{" "}
          <a href={GH_DOC} target="_blank" rel="noopener noreferrer" className="font-medium text-accent-ink underline-offset-2 hover:underline">
            Empaquetage avancé (.crx, update.xml) →
          </a>
        </p>
      </section>

      {/* Voie B bis — nommer les postes dans l'inventaire. Facultatif et à la main
          du client : c'est lui qui décide si son parc est nominatif ou anonyme. */}
      <section className="card mt-5 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-perf/10 text-xs font-bold text-perf">
              B+
            </span>
            Nommer les postes (facultatif)
          </h2>
          <span className="rounded-full bg-panel2 px-2 py-0.5 text-[10px] font-medium text-ink-soft">
            sinon : inventaire anonyme
          </span>
        </div>
        <p className="mt-2 text-xs text-ink-soft">
          Par défaut, chaque poste apparaît dans <strong>Postes équipés</strong> sous un identifiant
          d&apos;installation anonyme. Cette seconde stratégie y fait afficher un nom lisible. Le libellé
          vient de <strong>votre</strong> console d&apos;administration : MIP ne le fabrique jamais et
          n&apos;a aucun autre moyen de nommer un poste.
        </p>
        <div className="mt-3">
          <CopyBlock code={nommage} />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
          Remplacez <code className="chip-mono">{"${machine_name}"}</code> par la variable de votre
          outil — <code className="chip-mono">%COMPUTERNAME%</code> (GPO/Intune),{" "}
          <code className="chip-mono">$COMPUTERNAME</code> (Jamf). Sur Windows, la même valeur se pose
          en registre sous{" "}
          <code className="chip-mono">
            HKLM\Software\Policies\Google\Chrome\3rdparty\extensions\{EXT_ID}\policy
          </code>
          . Un nom de <strong>machine</strong> reste un inventaire de parc ; un nom de{" "}
          <strong>personne</strong> en fait un traitement de données personnelles, à déclarer comme
          tel.
        </p>
      </section>

      {/* Vérifier la remontée. */}
      <section className="card mt-5 p-5">
        <h2 className="text-sm font-semibold text-ink">Tester la remontée</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-ink-soft">
          <li>Extension installée et accès accordé au domaine (fenêtre de l&apos;extension, ou stratégie d&apos;entreprise).</li>
          <li>Ouvrez le domaine enregistré et naviguez comme un vrai visiteur.</li>
          <li>Revenez ici — la checklist ci-dessous passe au vert.</li>
        </ol>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
          Même chaîne de traitement que le SDK embarqué : comparez les deux capteurs avec le filtre{" "}
          <strong>Source de collecte</strong> dans n&apos;importe quel écran de la console.
        </p>
      </section>
    </>
  );
}

/** Étapes de chargement « non empaqueté » du .zip (voie A sans le Store). */
function ZipInstall() {
  return (
    <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-ink-soft">
      <li>Dézippez le fichier téléchargé dans un dossier stable (ne le supprimez pas ensuite).</li>
      <li>
        Ouvrez <code className="chip-mono">chrome://extensions</code> (ou{" "}
        <code className="chip-mono">edge://extensions</code>) et activez le <strong>mode développeur</strong>.
      </li>
      <li>
        Cliquez <strong>« Charger l&apos;extension non empaquetée »</strong> et sélectionnez le dossier dézippé.
      </li>
      <li>
        Cliquez l&apos;icône MIP RUM, puis <strong>« Activer sur ce domaine »</strong> dans le popup (accorde
        la permission navigateur pour le domaine enregistré).
      </li>
    </ol>
  );
}

function CheckRow({
  label,
  state,
  children,
}: {
  label: string;
  state: "done" | "waiting";
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-line bg-panel2 px-3 py-2">
      <span className="text-sm text-ink">{label}</span>
      <WizardBadge state={state}>{children}</WizardBadge>
    </div>
  );
}
