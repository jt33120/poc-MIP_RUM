// Ajout self-service d'un site à monitorer (le « + » de /select). Plein écran,
// sans coquille (comme /select). Deux temps : (1) formulaire minimal nom+URL ;
// (2) après création, l'intégration en 2 méthodes — injection JS (site qu'on
// contrôle) OU bookmarklet (n'importe quel site, pour simuler un parcours) —
// + un guide de simulation et la checklist live. Création réservée aux admins.
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { CopyBlock } from "@/components/CopyBlock";
import { ICON_PATHS, Icon } from "@/components/icons";
import { Bookmarklet } from "@/components/onboarding/Bookmarklet";
import { OnboardingPoll } from "@/components/OnboardingPoll";
import { WizardBadge } from "@/components/wizard/WizardStep";
import { ingestEndpoint } from "@/lib/ingest-endpoint";
import { getUser, popSecret } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { buildSnippet, deriveStatus } from "@/lib/onboarding";
import { getCustomer, probeOnboarding } from "@/lib/queries-customers";
import { resolveExtensionScope } from "@/lib/queries-extension-scope";
import type { SearchParams } from "@/lib/filters";
import { selectProjectAction } from "../actions";
import { createSiteAction } from "./actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  name: "Donnez un nom à l'application.",
  app_id: "Identifiant invalide (minuscules, chiffres et tirets, 3–40 caractères).",
  url: "Adresse invalide — attendez une URL http(s) complète (ex. https://mon-app.fr).",
  exists: "Cet identifiant est déjà pris — choisissez-en un autre.",
};

// Modes de collecte proposés à l'étape 1 (récap avantages / inconvénients).
const MODES = [
  {
    value: "sdk",
    badge: "1 ligne de code",
    title: "Injection JS",
    desc: "Un snippet dans le <head> de l'application. Web Vitals, erreurs, sessions et tracing automatiques.",
    pros: ["Couvre tous vos visiteurs réels", "Données les plus complètes (replay, tracing)", "Permanent"],
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
  const user = await getUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/select"); // création réservée aux admins

  const sp = await searchParams;
  const appId = typeof sp.app === "string" ? sp.app : null;

  return (
    <main className="min-h-screen bg-app px-6 py-14">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-8 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-deep shadow-glow">
            <Icon paths={ICON_PATHS.activity} className="h-5 w-5 text-white" strokeWidth={2.4} />
          </span>
          <div className="leading-tight">
            <div className="text-base font-bold tracking-tight text-ink">
              MIP <span className="text-accent">RUM</span>
            </div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-ink-faint">Ajouter une application</div>
          </div>
          <Link href="/select" className="btn-ghost ml-auto">
            ← Projets
          </Link>
        </header>

        {appId ? (
          <Integration
            appId={appId}
            ktToken={typeof sp.kt === "string" ? sp.kt : null}
            mode={sp.mode === "extension" ? "extension" : "sdk"}
          />
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
      <h1 className="text-2xl font-bold tracking-tight text-ink">Brancher une nouvelle application</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        Un site web, une web app, une plateforme… Donnez-lui un nom et son adresse, choisissez comment
        collecter les données, et on vous montre la configuration — en une ligne de code, ou sans toucher au
        code du tout.
      </p>

      {error && (
        <div className="mt-6 rounded-lg border border-bad/30 bg-bad/10 px-4 py-2.5 text-sm text-bad">
          {ERRORS[error] ?? "Vérifiez les champs."}
        </div>
      )}

      <form action={createSiteAction} className="mt-6 grid gap-4">
        <label className="text-sm font-medium text-ink-soft">
          Nom de l&apos;application
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
          <span className="mt-1 block text-xs text-ink-faint">
            Sert d&apos;origine autorisée (CORS) pour l&apos;injection JS, et de domaine observé pour
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
                    <span className="rounded-full bg-panel2 px-2 py-0.5 text-[10px] font-medium text-ink-faint">
                      {m.badge}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">{m.desc}</p>
                  <ul className="mt-2.5 space-y-1 text-[11px]">
                    {m.pros.map((p) => (
                      <li key={p} className="flex gap-1.5 text-ink-soft">
                        <span className="text-good">✓</span>
                        {p}
                      </li>
                    ))}
                    {m.cons.map((c) => (
                      <li key={c} className="flex gap-1.5 text-ink-faint">
                        <span className="text-warn">–</span>
                        {c}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2.5 border-t border-line pt-2 text-[11px] leading-relaxed text-ink-faint">
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
          <span className="mt-1 block text-xs text-ink-faint">
            Par défaut dérivé du nom. Il apparaît dans chaque mesure — court et stable.
          </span>
        </details>
        <button type="submit" className="btn-accent mt-1 w-fit px-4 py-2">
          Créer le projet →
        </button>
      </form>
    </>
  );
}

/** Étape 2 — configuration selon le mode + simulation + checklist live. */
async function Integration({
  appId,
  ktToken,
  mode,
}: {
  appId: string;
  ktToken: string | null;
  mode: "sdk" | "extension";
}) {
  const customer = await getCustomer(appId);
  if (!customer) redirect("/select/new");
  const probe = await probeOnboarding(appId);
  const status = deriveStatus(probe);
  const oneTimeKey = ktToken ? popSecret(ktToken) : null;
  // Domaines observés par l'extension (dérivés des origines CORS de l'app), avec
  // leur statut réel dans le registre extension_scope (enregistré à cet app_id ?).
  const hosts = Array.from(
    new Set(customer.allowed_origins.map(originHost).filter((h): h is string => !!h)),
  );
  const extensionDomains =
    mode === "extension"
      ? await Promise.all(
          hosts.map(async (host) => {
            const s = await resolveExtensionScope(host);
            return { host, registered: !!s && s.app_id === appId && s.active };
          }),
        )
      : [];

  const host = (await headers()).get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  const sdkUrl = `${proto}://${host}/mip-rum.js`;
  const endpoint = ingestEndpoint("traces", host);

  const snippet = buildSnippet({ sdkUrl, endpoint, appId, clientId: null, withConsent: false });
  // Bookmarklet : injecte le SDK sur la page courante puis démarre la mesure —
  // pour monitorer/simuler un parcours sur un site qu'on ne contrôle pas. La clé
  // est embarquée (l'enforcement l'exige) : la vraie si on l'a encore sous la
  // main (juste après création), sinon un placeholder à remplacer.
  const bmKey = oneTimeKey ?? "COLLE_ICI_LA_CLE_API";
  const bookmarklet =
    `javascript:(function(){var s=document.createElement('script');s.src=${JSON.stringify(sdkUrl)};` +
    `s.onload=function(){window.MIPRum&&MIPRum.init({endpoint:${JSON.stringify(endpoint)},` +
    `appId:${JSON.stringify(appId)},clientId:'mip',env:'prod',apiKey:${JSON.stringify(bmKey)}});};` +
    `document.head.appendChild(s);})();`;
  // Backend (optionnel) : l'agent Node zéro-config instrumente le serveur SANS
  // changement de code -> spans http.server corrélés au front (waterfall « cause
  // backend »). C'est la « démo qui vend », désormais accessible dès le self-service.
  const agentCmd =
    `MIP_RUM_ENDPOINT=${JSON.stringify(endpoint)} MIP_RUM_APP_ID=${JSON.stringify(appId)} ` +
    `MIP_RUM_API_KEY=${JSON.stringify(oneTimeKey ?? "COLLE_ICI_LA_CLE_API")} \\\n  ` +
    `node -r @mip/agent-node/register app.js`;

  return (
    <>
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-good/15 text-good">✓</span>
        <h1 className="text-2xl font-bold tracking-tight text-ink">{customer.name} est créé</h1>
      </div>
      <p className="mt-1.5 text-sm text-ink-soft">
        Projet <code className="chip-mono">{appId}</code> · mode{" "}
        <strong>{mode === "extension" ? "extension navigateur" : "injection JS"}</strong>.{" "}
        {mode === "extension"
          ? "Le domaine est enregistré : installez l'extension puis testez."
          : "Posez le capteur, puis simulez un parcours."}{" "}
        <Link href={`/select/new?app=${encodeURIComponent(appId)}&mode=${mode === "extension" ? "sdk" : "extension"}`} className="text-accent-deep underline-offset-2 hover:underline dark:text-accent">
          Voir l&apos;autre mode
        </Link>
      </p>

      {ktToken && (
        <div className="mt-5 rounded-lg border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-ink">
          {oneTimeKey ? (
            <>
              <strong>Clé d&apos;API</strong> (affichée une seule fois) :{" "}
              <code className="rounded bg-panel px-2 py-0.5 font-mono text-ink">{oneTimeKey}</code>
              <span className="mt-1 block text-xs text-ink-soft">
                Déjà incluse dans le snippet ci-dessous. Notez-la pour instrumenter un backend plus tard.
              </span>
            </>
          ) : (
            <>Clé déjà affichée. Régénérez-la depuis l&apos;administration si elle est perdue.</>
          )}
        </div>
      )}

      {mode === "extension" ? (
        <ExtensionConfig
          appId={appId}
          domains={extensionDomains}
          storeUrl={process.env.CHROME_STORE_URL ?? null}
          updateUrl={process.env.EXTENSION_UPDATE_URL ?? null}
        />
      ) : (
        <>
          {/* Méthode 1 — injection JS */}
          <section className="card mt-6 p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-perf/10 text-xs font-bold text-perf">1</span>
              Injection JS — vous contrôlez le code de l&apos;application
            </h2>
            <p className="mt-2 text-xs text-ink-soft">
              Collez ces deux balises dans le <code>&lt;head&gt;</code>, avant tout autre script. Web Vitals,
              erreurs, sessions et tracing des appels API sont ensuite automatiques.
            </p>
            <div className="mt-3">
              <CopyBlock code={snippet} />
            </div>
          </section>

          {/* Méthode 2 — bookmarklet */}
          <section className="card mt-5 p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ai/10 text-xs font-bold text-ai">2</span>
              Bookmarklet — n&apos;importe quelle page, sans toucher au code
            </h2>
            <p className="mt-2 text-xs text-ink-soft">
              Idéal pour une démo ou pour <strong>simuler un parcours client</strong> sur une application que
              vous ne contrôlez pas : glissez le bouton dans votre barre de favoris, ouvrez la page cible,
              cliquez le favori — le SDK s&apos;injecte et la mesure démarre pour{" "}
              <code className="chip-mono">{appId}</code>.
            </p>
            <div className="mt-3">
              <Bookmarklet code={bookmarklet} label={`Monitorer ${appId}`} />
            </div>
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer font-medium text-ink-soft">Voir le code / limites</summary>
              <div className="mt-2 grid gap-2 text-ink-soft">
                <CopyBlock code={bookmarklet} />
                <p className="text-ink-faint">
                  Créez un favori manuellement et collez ce code comme URL si le glisser-déposer n&apos;est pas
                  possible. {!oneTimeKey && <>Remplacez <code>COLLE_ICI_LA_CLE_API</code> par la clé du projet. </>}
                  Une application à <strong>CSP stricte</strong> peut bloquer l&apos;injection : dans ce cas,
                  utilisez la méthode 1 (ou le mode extension). C&apos;est une mesure <strong>temporaire</strong>{" "}
                  (le temps de l&apos;onglet), parfaite pour tester ; l&apos;injection JS est le mode permanent.
                </p>
              </div>
            </details>
          </section>

          {/* Simuler un parcours */}
          <section className="card mt-5 p-5">
            <h2 className="text-sm font-semibold text-ink">Simuler un parcours client</h2>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-ink-soft">
              <li>Ouvrez l&apos;application (avec le snippet posé, ou après avoir cliqué le bookmarklet).</li>
              <li>Naviguez comme un vrai visiteur : changez de page, cliquez, remplissez un champ, provoquez une erreur.</li>
              <li>Laissez ~5 s : les mesures partent en continu (et au départ de l&apos;onglet).</li>
              <li>Revenez ici — la checklist ci-dessous passe au vert, puis les données s&apos;affichent dans la console.</li>
            </ol>
          </section>
        </>
      )}

      {/* Brancher le backend (optionnel) — le waterfall « cause backend » */}
      <section className="card mt-5 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          Brancher le backend <span className="rounded-full bg-panel2 px-2 py-0.5 text-[11px] font-medium text-ink-faint">optionnel</span>
        </h2>
        <p className="mt-2 text-xs text-ink-soft">
          Pour relier chaque appel du navigateur à son <strong>exécution serveur</strong> (le waterfall
          « cause backend »). Le plus simple sur Node : l&apos;<strong>agent zéro-config</strong>, aucun
          changement de code —
        </p>
        <div className="mt-3">
          <CopyBlock code={agentCmd} />
        </div>
        <p className="mt-2 text-xs text-ink-faint">
          Autres stacks (FastAPI, Express, agent OpenTelemetry standard) : voir{" "}
          <code className="chip-mono">docs/INTEGRATION.md</code> ou la fiche{" "}
          <Link href={`/admin/customers/${encodeURIComponent(appId)}`} className="text-accent-deep underline-offset-2 hover:underline dark:text-accent">
            Administration → Clients
          </Link>{" "}
          (recettes middleware + injection zéro-touch). App mobile : <code className="chip-mono">@mip/rum-mobile</code> (React Native).
        </p>
      </section>

      {/* Checklist live */}
      <section className="card mt-5 p-5">
        <OnboardingPoll live={status.live} />
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Les données arrivent-elles ?</h2>
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${status.live ? "bg-good/15 text-good" : "bg-warn/15 text-warn"}`}>
            {status.live ? "● live" : "en attente"}
          </span>
        </div>
        <p className="mt-1 text-xs text-ink-faint">
          {status.live
            ? "À jour."
            : "Rafraîchissement automatique toutes les 5 s — gardez cet onglet ouvert."}
        </p>
        <div className="mt-3 grid gap-2">
          <CheckRow label="Premières Web Vitals reçues" state={status.snippet}>
            {probe.first_metric_at ? fmtDate(probe.first_metric_at) : "en attente"}
          </CheckRow>
          <CheckRow label="Session sur les dernières 24 h" state={status.traffic}>
            {probe.sessions_24h || "aucune"}
          </CheckRow>
          <CheckRow label="Appels API tracés (spans front)" state={status.tracingFront}>
            {probe.first_front_span_at ? fmtDate(probe.first_front_span_at) : "en attente"}
          </CheckRow>
        </div>
      </section>

      <form action={selectProjectAction} className="mt-6">
        <input type="hidden" name="app" value={appId} />
        <button type="submit" className="btn-accent px-4 py-2" data-testid="supervise-project">
          Superviser ce projet →
        </button>
      </form>
    </>
  );
}

/** Hostname d'une origine CORS ("https://ma-boutique.fr" -> "ma-boutique.fr"). */
function originHost(origin: string): string | null {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

// ID stable de l'extension (dérivé de la clé publique du manifest — cf.
// docs/DEPLOY_EXTENSION.md). Référencé tel quel par la policy d'entreprise.
const EXT_ID = "gglpcalhlkfhgipfmemfiedjomifefba";
const EXT_ZIP = "/downloads/mip-rum-extension.zip";
const GH_DOC = "https://github.com/jt33120/mip-rum/blob/master/docs/DEPLOY_EXTENSION.md";

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
  const allowedHosts = domains.length ? domains.map((d) => `*://${d.host}`) : ["*://app.client.fr"];
  const policy = JSON.stringify(
    {
      [EXT_ID]: {
        installation_mode: "force_installed",
        update_url: updateUrl ?? "https://<votre-hebergement>/update.xml",
        runtime_allowed_hosts: allowedHosts,
      },
    },
    null,
    2,
  );

  return (
    <>
      {/* Domaine(s) enregistrés — hors périmètre, l'extension n'observe rien. */}
      <section className="card mt-6 p-5">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full ${allRegistered ? "bg-good/15 text-good" : "bg-warn/15 text-warn"}`}
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
                  <span className={d.registered ? "text-good" : "text-warn"}>{d.registered ? "✓" : "•"}</span>
                  <code className="font-mono">{d.host}</code>
                  <span className="text-ink-faint">{d.registered ? "observé" : "non enregistré"}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-ink-soft">
              Mapping domaine → <code className="chip-mono">{appId}</code>. En dehors des domaines enregistrés,
              l&apos;extension n&apos;observe <strong>rien</strong>.
            </p>
          </>
        ) : (
          <p className="mt-2 text-xs text-ink-soft">
            Aucun domaine détecté depuis l&apos;URL — ajoutez-le dans la gestion des domaines ci-dessous.
          </p>
        )}
        <Link href="/admin/extension-scope" className="mt-3 inline-block text-xs font-medium text-accent-deep underline-offset-2 hover:underline dark:text-accent">
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
          <span className="rounded-full bg-panel2 px-2 py-0.5 text-[10px] font-medium text-ink-faint">1 poste · test / démo</span>
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
          <span className="rounded-full bg-panel2 px-2 py-0.5 text-[10px] font-medium text-ink-faint">parc géré · sans geste utilisateur</span>
        </div>
        <p className="mt-2 text-xs text-ink-soft">
          Collez cette policy <code className="chip-mono">ExtensionSettings</code> dans votre console
          d&apos;administration (GPO Windows, Microsoft Intune ou Google Admin). Elle force l&apos;installation
          et pré-accorde l&apos;accès aux domaines enregistrés — l&apos;employé n&apos;a <strong>rien</strong> à
          faire. Déjà pré-remplie avec l&apos;ID de l&apos;extension et vos domaines :
        </p>
        <div className="mt-3">
          <CopyBlock code={policy} />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
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
          <a href={GH_DOC} target="_blank" rel="noopener noreferrer" className="font-medium text-accent-deep underline-offset-2 hover:underline dark:text-accent">
            Packaging avancé (.crx, update.xml) →
          </a>
        </p>
      </section>

      {/* Vérifier la remontée. */}
      <section className="card mt-5 p-5">
        <h2 className="text-sm font-semibold text-ink">Tester la remontée</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-ink-soft">
          <li>Extension installée et accès accordé au domaine (popup de l&apos;extension, ou policy).</li>
          <li>Ouvrez le domaine enregistré et naviguez comme un vrai visiteur.</li>
          <li>Revenez ici — la checklist ci-dessous passe au vert.</li>
        </ol>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
          Même pipeline que l&apos;injection JS : comparez les deux capteurs via le filtre{" "}
          <strong>source</strong> (sdk / extension) dans n&apos;importe quelle page de la console.
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
