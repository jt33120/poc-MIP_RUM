// Corps de l'étape 2 du wizard d'onboarding : pose du SDK dans la page + guides
// dépliables (placement, CSP, consentement RGPD, injection sans toucher au code).
// Rendu serveur. Extrait de app/admin/customers/[appId]/page.tsx.
//
// Recette du 26/09/2026 : la clé d'API est dite facultative tant que la collecte ne
// l'exige pas (le code la demandait sans dire où la trouver) ; plus de nom de client,
// plus d'émoji, le vouvoiement partout, et les jetons du thème pour le mode sombre.
import { CopyBlock } from "@/components/CopyBlock";

const BLOC = "rounded-lg border border-line px-3 py-2";
const RESUME = "cursor-pointer text-xs font-medium text-ink";
const TEXTE = "text-xs leading-relaxed text-ink-soft";
import type { InjectionArtifacts } from "@/lib/onboarding";

/** Étape 2 : instructions d'intégration du snippet front (présentationnel). */
export function SnippetStep({
  snippet,
  snippetConsent,
  sdkUrl,
  endpoint,
  injection,
}: {
  snippet: string;
  snippetConsent: string;
  sdkUrl: string;
  endpoint: string;
  injection: InjectionArtifacts;
}) {
  return (
    <>
      <p className="mb-3 text-xs text-ink-soft">
        Deux balises dans le <code>&lt;head&gt;</code>, avant tout autre script. Rien
        d&apos;autre à modifier : Web Vitals, erreurs, sessions et appels réseau sont mesurés
        sans autre code.
      </p>
      <CopyBlock code={snippet} />
      <p className={`mt-2 ${TEXTE}`} data-testid="cle-facultative">
        La ligne <code>apiKey</code> est facultative tant que la collecte n&apos;exige pas de clé : sans
        clé, retirez-la ; sinon, remplacez le repère par la clé du projet. Posée dans la page, la clé est
        lisible par tout visiteur : elle identifie le projet, elle ne protège rien.
      </p>
      <div className="mt-3 grid gap-2 text-sm">
        <details className={BLOC}>
          <summary className={RESUME}>Où le poser ? (HTML statique, React/Vite, Next.js)</summary>
          <ul className={`mt-2 list-disc pl-5 ${TEXTE}`}>
            <li><strong>HTML statique, application Vite ou CRA</strong> : dans le <code>&lt;head&gt;</code> de <code>index.html</code>.</li>
            <li><strong>Next.js (App Router)</strong> : deux <code>&lt;Script strategy=&quot;beforeInteractive&quot;&gt;</code> dans <code>app/layout.tsx</code>, ou les balises dans <code>pages/_document.tsx</code> (Pages Router).</li>
            <li><strong>CMS / tag manager</strong> : un tag « Custom HTML » déclenché sur toutes les pages fait l&apos;affaire.</li>
          </ul>
        </details>
        <details className={BLOC}>
          <summary className={RESUME}>Le site a une politique de sécurité (CSP) stricte ?</summary>
          <p className={`mt-2 ${TEXTE}`}>
            Ajouter à la CSP : <code>script-src {sdkUrl.replace("/mip-rum.js", "")}</code> et{" "}
            <code>connect-src {new URL(endpoint).origin}</code>. Autre possibilité, recommandée :
            héberger <code>mip-rum.js</code> sur le domaine du client (un seul fichier statique) — le
            script ne dépend alors plus d&apos;une origine externe.
          </p>
        </details>
        <details className={BLOC}>
          <summary className={RESUME}>RGPD : le client a une bannière de consentement ?</summary>
          <p className={`mb-2 mt-2 ${TEXTE}`}>
            Version <code>requireConsent</code> : rien ne part tant que l&apos;outil de consentement
            n&apos;a pas appelé <code>MIPRum.consent(true)</code>.
          </p>
          <CopyBlock code={snippetConsent} />
        </details>
        <details className={BLOC}>
          <summary className={RESUME}>
            Injection sans toucher au code — le client ne peut (ou ne veut) pas modifier son site
          </summary>
          <p className={`mb-2 mt-2 ${TEXTE}`}>
            Logiciel du marché, application ancienne ou gérée par un tiers : les deux balises se posent
            depuis l&apos;infrastructure, sans toucher au code source. Choisissez le point d&apos;injection
            selon l&apos;hébergement du client.
          </p>
          <div className="grid gap-3">
            <div>
              <p className="mb-1 text-xs font-semibold text-ink">
                Cloudflare Worker{" "}
                <span className="font-normal text-ink-soft">
                  — recommandé : injecte <em>et</em> assouplit la CSP automatiquement
                </span>
              </p>
              <CopyBlock code={injection.worker} />
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-ink">
                nginx{" "}
                <span className="font-normal text-ink-soft">
                  — si le HTML passe par un nginx que vous opérez (module ngx_http_sub_module)
                </span>
              </p>
              <CopyBlock code={injection.nginx} />
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-ink">
                Google Tag Manager{" "}
                <span className="font-normal text-ink-soft">
                  — si le client l&apos;utilise déjà (sans intervention ; ne corrige pas la CSP)
                </span>
              </p>
              <CopyBlock code={injection.gtm} />
            </div>
            <p className={TEXTE}>
              <strong>Application statique (Vercel, Netlify, S3)</strong> : aucun relais HTML dans la
              chaîne. Placer Cloudflare devant le domaine (Worker ci-dessus) ou poser les balises à la
              construction.
              <br />
              CSP à autoriser si vous l&apos;ajoutez à la main :{" "}
              <code>script-src {injection.scriptOrigin}</code> ·{" "}
              <code>connect-src {injection.connectOrigin}</code>.
            </p>
          </div>
        </details>
      </div>
    </>
  );
}
