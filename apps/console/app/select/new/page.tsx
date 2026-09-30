// Ajout d'un projet à mesurer (le « + » de /select), et installation du capteur d'un
// projet existant (`?app=`). Plein écran, sans coquille (comme /select). Deux temps :
// (1) formulaire minimal nom + adresse ; (2) l'intégration en deux méthodes — le SDK
// embarqué (site dont on contrôle le code) OU un favori de test (n'importe quelle
// page, pour simuler un parcours) — puis un guide de simulation et la vérification en
// direct. Création réservée à l'administrateur de la plateforme ; l'intégration, à
// quiconque a le site dans son périmètre — le LECTEUR d'une inscription en libre-service
// y reçoit sa clé (30/09/2026) —, les liens d'administration à ses seuls administrateurs.
//
// Refonte du 30/09/2026 : chaque étape tient dans un écran, sans défilement. Le
// formulaire se réduit au nom, à l'adresse et au mode ; l'installation au code à
// poser et à la vérification en direct. Le reste (favori de test, serveur,
// stratégies de parc, nommage des postes) est replié ou renvoie au guide
// `/installer`, qui le détaille pour les trois parcours.
//
// Vocabulaire aligné sur la présentation (recette du 26/09/2026) : « SDK embarqué »
// et « extension navigateur », « favori de test » plutôt que « bookmarklet », sans
// renvoi vers un fichier du code que l'utilisateur ne peut pas ouvrir.
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { ECRANS_SESSION } from "@mip/console-contract";
import { ICON_PATHS, Icon } from "@/components/icons";
import { ThemeToggle } from "@/components/ThemeToggle";
import { OnboardingPoll } from "@/components/OnboardingPoll";
import { CodeAvecSecret, FormulaireSecret, SecretAffiche, SecretFourni } from "@/components/secret/SecretUnique";
import { BackendStep } from "@/components/wizard/BackendStep";
import { WizardBadge } from "@/components/wizard/WizardStep";
import { ZIP_EXTENSION } from "@/lib/extension-deploiement";
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

// Modes de collecte proposés à l'étape 1 : une ligne chacun, le détail est au guide.
const MODES = [
  {
    value: "sdk",
    title: "SDK embarqué",
    desc: "Deux balises dans la page. Tous les visiteurs, les données les plus riches.",
  },
  {
    value: "extension",
    title: "Extension navigateur",
    desc: "Rien à toucher dans le code. Seuls les postes équipés sont mesurés.",
  },
] as const;

/** Langages du serveur proposés à l'étape 1 : ceux des recettes, plus « autre ». */
const SERVEURS = [
  { value: "python", label: "Python" },
  { value: "node", label: "Node.js" },
  { value: "java", label: "Java" },
  { value: "dotnet", label: ".NET" },
  { value: "autre", label: "Autre" },
] as const;
type Serveur = (typeof SERVEURS)[number]["value"];

function serveurDe(v: unknown): Serveur | null {
  return SERVEURS.find((s) => s.value === v)?.value ?? null;
}

export default async function AddSite({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // Le chargeur (`lib/chargeurs/projets.ts`, C9) : le formulaire à la plateforme ;
  // l'intégration d'un site à qui l'a dans son périmètre. Hors de là, retour aux projets.
  const ecran = await chargerEcran(ECRANS_SESSION.nouveauSite, chargerNouveauSite, sp);
  if (ecran.etat === "sans_session") redirect("/login");
  if (ecran.etat === "interdit") redirect("/select");
  if (ecran.etat === "introuvable") redirect("/select/new");

  return (
    <main className="min-h-screen bg-panel px-4 py-8 sm:px-6">
      <div className={`mx-auto w-full ${ecran.etat === "integration" ? "max-w-6xl" : "max-w-xl"}`}>
        <header className="mb-8 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-deep">
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
          <Integration ecran={ecran} cree={sp.cree === "1"} serveur={serveurDe(sp.serveur)} />
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
      <h1 className="text-2xl font-bold tracking-tight text-ink">Nouveau projet</h1>

      {error && (
        <div className="mt-5 rounded-lg border border-bad/30 bg-bad/10 px-4 py-2.5 text-sm text-bad-ink">
          {ERRORS[error] ?? "Vérifiez les champs."}
        </div>
      )}

      {/* La clé générée est rendue au formulaire, qui la remet à l'étape 2 (C9c). */}
      <FormulaireSecret action={createSiteAction} className="mt-6 grid gap-5">
        <label className="text-sm font-medium text-ink">
          Nom
          <input name="name" required autoFocus placeholder="Ma boutique" className="field mt-1.5 w-full" />
        </label>
        <label className="text-sm font-medium text-ink">
          Adresse
          <input
            name="url"
            type="url"
            required
            placeholder="https://ma-boutique.fr"
            className="field mt-1.5 w-full"
          />
        </label>

        {/* Mode de collecte : 2 cartes radio (sélection sans JS via peer-checked). */}
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-ink">Mesurer par</legend>
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
                <div className="h-full rounded-xl border border-line p-3.5 transition hover:border-ink-faint/50 peer-checked:border-accent peer-checked:ring-2 peer-checked:ring-accent/20 peer-focus-visible:ring-2 peer-focus-visible:ring-perf">
                  <span className="text-sm font-semibold text-ink">{m.title}</span>
                  <p className="mt-1 text-xs leading-relaxed text-ink-soft">{m.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Serveur facultatif : un langage choisi ajoute sa recette à l'étape 2. */}
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-ink">
            Serveur <span className="font-normal text-ink-soft">(facultatif)</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {[{ value: "", label: "Aucun" }, ...SERVEURS].map((o) => (
              <label key={o.value} className="cursor-pointer">
                <input type="radio" name="serveur" value={o.value} defaultChecked={o.value === ""} className="peer sr-only" />
                <span className="inline-block rounded-full border border-line px-3 py-1 text-xs font-medium text-ink-soft transition hover:border-ink-faint/50 peer-checked:border-accent peer-checked:bg-accent/10 peer-checked:text-ink peer-focus-visible:ring-2 peer-focus-visible:ring-perf">
                  {o.label}
                </span>
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-ink-soft">
            Relie chaque appel du navigateur à son exécution serveur, par l&apos;agent OpenTelemetry officiel.
          </p>
        </fieldset>

        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-medium text-ink-soft">Identifiant personnalisé (facultatif)</summary>
          <input
            name="app_id"
            placeholder="ma-boutique"
            className="field mt-2 w-full font-mono"
          />
          <span className="mt-1 block text-xs text-ink-soft">
            Par défaut dérivé du nom. Il accompagne chaque mesure : court et stable.
          </span>
        </details>
        <div className="flex items-center justify-end gap-3">
          <Link href="/select" className="btn-ghost px-4 py-2">
            Annuler
          </Link>
          <button type="submit" className="btn-accent px-4 py-2">
            Créer le projet
          </button>
        </div>
      </FormulaireSecret>
    </>
  );
}

/** Étape 2 — configuration selon le mode + simulation + checklist live. */
async function Integration({
  ecran,
  cree,
  serveur,
}: {
  ecran: Extract<Fil<Awaited<ReturnType<typeof chargerNouveauSite>>>, { etat: "integration" }>;
  /** Juste après la création (`cree=1`, posé par l'action) : sinon, c'est un projet existant. */
  cree: boolean;
  /** Langage du serveur choisi à l'étape 1 : sa recette devient une étape ; null, elle reste repliée. */
  serveur: Serveur | null;
}) {
  // Domaines observés par l'extension (dérivés des origines CORS de l'app), avec
  // leur statut réel dans le registre extension_scope : lus par le chargeur.
  const { app: appId, mode, client: customer, sonde: probe, domaines: extensionDomains, administrable } = ecran;
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
  // Le langage choisi : sa seule recette (« autre » : le socle commun et les liens).
  const recettesChoisies = serveur
    ? { ...recettesServeur, agents: recettesServeur.agents.filter((a) => a.id === serveur) }
    : null;

  // La clé n'est exigée que si la collecte ferme l'accès sans clé ; lu ici plutôt
  // qu'importé de lib/ingest.ts, qui tirerait la base dans cet écran (cliquet de la
  // piste C). Même variable, même règle.
  const cleExigee = process.env.REQUIRE_API_KEY === "true";

  return (
    <SecretFourni nom={nomCle}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-ink">
          {cree && (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-good/15 text-sm text-good-ink">✓</span>
          )}
          {cree ? `« ${customer.name} » est créé` : `Installer le capteur — ${customer.name}`}
        </h1>
        <p className="text-sm text-ink-soft">
          <code className="chip-mono">{appId}</code> · {mode === "extension" ? "extension navigateur" : "SDK embarqué"} ·{" "}
          <Link
            href={`/select/new?app=${encodeURIComponent(appId)}&mode=${mode === "extension" ? "sdk" : "extension"}`}
            className="text-accent-ink underline-offset-2 hover:underline"
          >
            {mode === "extension" ? "passer au SDK embarqué" : "passer à l'extension"}
          </Link>
        </p>
      </div>

      <SecretAffiche
        nom={nomCle}
        testid="one-time-key"
        testidValeur="generated-key"
        className="mt-4 rounded-lg border border-warn/30 bg-warn/10 px-4 py-2.5 text-sm text-ink"
        codeClassName="rounded bg-panel px-2 py-0.5 font-mono text-ink"
        prefixe="Clé d'API de"
        suffixe="(affichée une seule fois, déjà dans le code ci-dessous) :"
      />

      <div className={`mt-5 grid gap-5 ${recettesChoisies ? "lg:grid-cols-3" : "lg:grid-cols-5"}`}>
        {/* 1 — poser le capteur */}
        <section className={`min-w-0 rounded-xl border border-line p-5 ${recettesChoisies ? "" : "lg:col-span-3"}`}>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Etape n={1} />
            {mode === "extension" ? "Installer l'extension" : "Coller ces balises dans le <head>"}
          </h2>
          {mode === "extension" ? (
            <ExtensionConfig
              appId={appId}
              domains={extensionDomains}
              administrable={administrable}
              storeUrl={process.env.CHROME_STORE_URL ?? null}
            />
          ) : (
            <>
              <div className="mt-3">
                <CodeAvecSecret nom={nomCle} code={snippet} repere={REPERE_CLE} rendu="copie" />
              </div>
              <p className="mt-2 text-xs leading-relaxed text-ink-soft" data-testid="cle-facultative">
                Avant tout autre script.{" "}
                {cleExigee
                  ? "La clé d'API est exigée par la collecte."
                  : "La clé d'API est facultative tant que la collecte ne l'exige pas : sans clé, retirez la ligne apiKey."}{" "}
                Elle identifie le projet, elle ne protège rien.
              </p>
              {voie === "directe" && (
                <p className="mt-1.5 text-xs leading-relaxed text-ink-soft" data-testid="voie-directe">
                  Collecte directe. Une page dont la CSP fige <code>connect-src</code> prend le code « par la
                  console » {administrable ? "de la fiche du projet" : "de la page Installer"}.
                </p>
              )}
            </>
          )}

          {/* Le reste, replié : utile, jamais nécessaire pour commencer. */}
          <details className="mt-4 border-t border-line pt-3 text-xs">
            <summary className="cursor-pointer font-medium text-ink-soft">Plus d&apos;options</summary>
            <div className="mt-3 grid gap-4 text-ink-soft">
              {mode !== "extension" && (
                <div className="hidden md:block">
                  <p className="font-semibold text-ink">Favori de test</p>
                  <p className="mt-1">
                    Glissez-le dans la barre de favoris, ouvrez n&apos;importe quelle page et cliquez-le : la
                    mesure démarre le temps de l&apos;onglet, sans toucher au code.
                  </p>
                  <div className="mt-2">
                    <CodeAvecSecret nom={nomCle} code={bookmarklet} repere={REPERE_CLE} rendu="bookmarklet" label={`Mesurer le projet ${appId}`} />
                  </div>
                </div>
              )}
              {!recettesChoisies && (
                <div>
                  <p className="font-semibold text-ink">Brancher le serveur</p>
                  <div className="mt-2">
                    <BackendStep recettes={recettesServeur} nomSecret={nomCle} />
                  </div>
                </div>
              )}
            </div>
          </details>
        </section>

        {/* 2 — le serveur, quand un langage a été choisi */}
        {recettesChoisies && (
          <section className="min-w-0 rounded-xl border border-line p-5" data-testid="etape-serveur">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Etape n={2} />
              Brancher le serveur
            </h2>
            <div className="mt-3 max-h-[26rem] overflow-y-auto">
              <BackendStep recettes={recettesChoisies} nomSecret={nomCle} />
            </div>
          </section>
        )}

        {/* Dernière étape — vérifier en direct */}
        <section className={`flex min-w-0 flex-col rounded-xl border border-line p-5 ${recettesChoisies ? "" : "lg:col-span-2"}`}>
          <OnboardingPoll live={status.live} />
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Etape n={recettesChoisies ? 3 : 2} />
              Ouvrir le site et naviguer
            </h2>
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${status.live ? "bg-good/15 text-good-ink" : "bg-warn/15 text-warn-ink"}`}>
              {status.live ? "Données reçues" : "En attente"}
            </span>
          </div>
          <p className="mt-1 text-xs text-ink-soft">
            {status.live ? "Heures de Paris." : "Vérifié toutes les 5 s, gardez cet onglet ouvert."}
          </p>
          <div className="mt-3 grid gap-2">
            <CheckRow label="Web Vitals" state={status.snippet}>
              {probe.first_metric_at ? fmtInstant(probe.first_metric_at) : "en attente"}
            </CheckRow>
            {/* « actives » : commencées ou poursuivies sur la fenêtre — d'où un compte qui
                peut dépasser celui des sessions commencées de la vue d'ensemble. */}
            <CheckRow label="Sessions sur 24 h" state={status.traffic}>
              {probe.sessions_24h ? pluriel(probe.sessions_24h, "session") : "aucune"}
            </CheckRow>
            <CheckRow label="Appels réseau" state={status.tracingFront}>
              {probe.first_front_span_at ? fmtInstant(probe.first_front_span_at) : "en attente"}
            </CheckRow>
          </div>
          <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-5">
            <form action={selectProjectAction}>
              <input type="hidden" name="app" value={appId} />
              <button type="submit" className="btn-accent px-4 py-2" data-testid="supervise-project">
                Ouvrir la console →
              </button>
            </form>
            {/* Le guide pas à pas, lisible aussi par l'équipe du client : à transmettre à qui pose le capteur. */}
            <Link
              href={`/installer?app=${encodeURIComponent(appId)}`}
              className="text-sm font-medium text-perf underline-offset-2 hover:underline"
              data-testid="lien-installer"
            >
              Guide complet
            </Link>
          </div>
        </section>
      </div>
    </SecretFourni>
  );
}

/** Pastille numérotée d'une étape. */
function Etape({ n }: { n: number }) {
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-perf/10 text-[11px] font-bold text-perf">
      {n}
    </span>
  );
}

// Le paquet de l'extension : `lib/extension-deploiement.ts`, partagé avec `/installer`.
const EXT_ZIP = ZIP_EXTENSION;

/**
 * Étape 2 — mode extension, l'essentiel : les domaines observés, et l'installation
 * sur un poste (Store dès qu'il est publié, sinon le .zip). Le déploiement sur un
 * parc (stratégie ExtensionSettings) et le nommage des postes sont au guide.
 */
function ExtensionConfig({
  appId,
  domains,
  administrable,
  storeUrl,
}: {
  appId: string;
  domains: { host: string; registered: boolean }[];
  /** Les domaines se gèrent à l'administration : le lien n'est montré qu'à qui peut la suivre. */
  administrable: boolean;
  storeUrl: string | null;
}) {
  return (
    <>
      {/* Hors des domaines enregistrés, l'extension n'observe rien. */}
      {domains.length ? (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Domaines observés">
          {domains.map((d) => (
            <li
              key={d.host}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${
                d.registered ? "border-good/30 bg-good/10 text-ink" : "border-warn/30 bg-warn/10 text-ink"
              }`}
            >
              <span className={d.registered ? "text-good-ink" : "text-warn-ink"}>{d.registered ? "✓" : "•"}</span>
              <code className="font-mono">{d.host}</code>
              <span className="text-ink-soft">{d.registered ? "observé" : "non enregistré"}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-ink-soft">Aucun domaine détecté depuis l&apos;adresse.</p>
      )}
      {administrable ? (
        <Link href="/admin/extension-scope" className="mt-2 inline-block text-xs font-medium text-accent-ink underline-offset-2 hover:underline">
          Gérer les domaines
        </Link>
      ) : (
        <p className="mt-2 text-xs text-ink-soft">Les domaines observés sont gérés par l&apos;administrateur du projet.</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {storeUrl ? (
          <a href={storeUrl} target="_blank" rel="noopener noreferrer" className="btn-accent inline-flex items-center gap-1.5 px-4 py-2">
            Ajouter à Chrome →
          </a>
        ) : (
          <a href={EXT_ZIP} download className="btn-accent inline-flex items-center gap-1.5 px-4 py-2">
            <Icon paths={ICON_PATHS.download} className="h-4 w-4" strokeWidth={2.2} />
            Télécharger l&apos;extension
          </a>
        )}
        <Link
          href={`/installer?app=${encodeURIComponent(appId)}`}
          className="text-xs font-medium text-perf underline-offset-2 hover:underline"
        >
          Déployer sur un parc (IT)
        </Link>
      </div>
      {!storeUrl && (
        <p className="mt-2 text-xs leading-relaxed text-ink-soft">
          Dézippez, ouvrez <code className="chip-mono">chrome://extensions</code>, activez le mode développeur,
          puis « Charger l&apos;extension non empaquetée ». Dans la fenêtre de l&apos;extension : « Activer sur
          ce domaine ».
        </p>
      )}
    </>
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
    <div className="flex items-center justify-between gap-2 rounded-lg bg-panel2 px-3 py-2">
      <span className="text-sm text-ink">{label}</span>
      <WizardBadge state={state}>{children}</WizardBadge>
    </div>
  );
}
