// Corps de l'étape 2 du wizard d'onboarding : pose du snippet front + guides
// dépliables (placement, CSP, consentement RGPD, injection zéro-touch). Rendu
// 100 % serveur. Extrait de app/admin/customers/[appId]/page.tsx.
import { CopyBlock } from "@/components/CopyBlock";
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
      <p className="mb-3 text-xs text-slate-500">
        Deux balises dans le <code>&lt;head&gt;</code>, avant tout autre script. Rien
        d&apos;autre à modifier — Web Vitals, erreurs, sessions et tracing des appels API
        sont automatiques.
      </p>
      <CopyBlock code={snippet} />
      <div className="mt-3 grid gap-2 text-sm">
        <details className="rounded border border-slate-200 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-slate-700">
            Où le poser ? (HTML statique, React/Vite, Next.js)
          </summary>
          <ul className="mt-2 list-disc pl-5 text-xs leading-relaxed text-slate-600">
            <li><strong>HTML statique / SPA Vite ou CRA</strong> : dans le <code>&lt;head&gt;</code> de <code>index.html</code> (c&apos;est l&apos;intégration faite sur plateforme.groupement-it.com).</li>
            <li><strong>Next.js (App Router)</strong> : deux <code>&lt;Script strategy=&quot;beforeInteractive&quot;&gt;</code> dans <code>app/layout.tsx</code>, ou les balises dans <code>pages/_document.tsx</code> (Pages Router).</li>
            <li><strong>CMS / tag manager</strong> : un tag « Custom HTML » déclenché sur toutes les pages fait l&apos;affaire.</li>
          </ul>
        </details>
        <details className="rounded border border-slate-200 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-slate-700">
            Le site a une CSP stricte ?
          </summary>
          <p className="mt-2 text-xs leading-relaxed text-slate-600">
            Ajouter à la CSP : <code>script-src {sdkUrl.replace("/mip-rum.js", "")}</code> et{" "}
            <code>connect-src {new URL(endpoint).origin}</code>. Alternative recommandée :
            auto-héberger <code>mip-rum.js</code> sur le domaine du client (fichier statique
            unique) — plus de dépendance CSP externe pour le script.
          </p>
        </details>
        <details className="rounded border border-slate-200 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-slate-700">
            RGPD : le client a une bannière de consentement ?
          </summary>
          <p className="mb-2 mt-2 text-xs leading-relaxed text-slate-600">
            Version <code>requireConsent</code> : rien ne part tant que la CMP n&apos;a pas
            appelé <code>MIPRum.consent(true)</code>.
          </p>
          <CopyBlock code={snippetConsent} />
        </details>
        <details className="rounded border border-blue-200 bg-blue-50/40 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-blue-800">
            🚀 Injection zéro-touch — le client ne peut (ou ne veut) pas modifier son code
          </summary>
          <p className="mb-2 mt-2 text-xs leading-relaxed text-slate-600">
            Sites COTS, legacy ou gérés par un tiers : on pose le snippet depuis
            l&apos;infrastructure, sans toucher au code source. Choisis le point d&apos;injection
            selon l&apos;hébergement du client.
          </p>
          <div className="grid gap-3">
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-700">
                Cloudflare Worker{" "}
                <span className="font-normal text-slate-500">
                  — recommandé : injecte <em>et</em> relâche la CSP automatiquement
                </span>
              </p>
              <CopyBlock code={injection.worker} />
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-700">
                nginx{" "}
                <span className="font-normal text-slate-500">
                  — si le HTML passe par un nginx que tu opères (ngx_http_sub_module)
                </span>
              </p>
              <CopyBlock code={injection.nginx} />
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-700">
                Google Tag Manager{" "}
                <span className="font-normal text-slate-500">
                  — si le client a déjà GTM (self-service ; ne corrige pas la CSP)
                </span>
              </p>
              <CopyBlock code={injection.gtm} />
            </div>
            <p className="text-xs leading-relaxed text-slate-500">
              <strong>SPA statique (Vercel/Netlify/S3)</strong> : pas de proxy HTML dans la
              chaîne → mettre un Cloudflare devant le domaine (Worker ci-dessus) ou injecter au
              build. C&apos;est le cas de plateforme.groupement-it.com, où le snippet en dur
              reste le plus simple.
              <br />
              CSP à autoriser si tu l&apos;ajoutes à la main :{" "}
              <code>script-src {injection.scriptOrigin}</code> ·{" "}
              <code>connect-src {injection.connectOrigin}</code>.
            </p>
          </div>
        </details>
      </div>
    </>
  );
}
