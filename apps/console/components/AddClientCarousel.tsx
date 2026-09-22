"use client";
// Carrousel pas-à-pas « Ajouter un client » — explique concrètement comment
// brancher un nouveau site et le rendre monitorable. Décalque fidèle du wizard
// réel (admin → Clients → fiche client) : création + clé, snippet front, backend
// optionnel, vérification live, accès scopé. Contenu statique (tutoriel), une
// seule entrée dynamique : `isAdmin` décide du call-to-action vers l'écran admin.
import Link from "next/link";
import { EXAMPLE_SNIPPET } from "@/lib/onboarding";
import { SDK_POIDS_TEXTE } from "@/lib/sdk-poids";
import { useState } from "react";
import { CopyBlock } from "./CopyBlock";
import { ICON_PATHS, Icon, type IconName } from "./icons";

interface Step {
  icon: IconName;
  title: string;
  optional?: boolean;
  body: React.ReactNode;
}

const STEPS: Step[] = [
  {
    icon: "users",
    title: "Créer le client dans l'outil",
    body: (
      <>
        <p>
          <strong>Administration → Clients → « Ajouter un client »</strong>. On renseigne le nom, un{" "}
          <strong>identifiant</strong> (<code className="chip-mono">app_id</code> : minuscules, chiffres
          et tirets — ex. <code className="chip-mono">plateforme-client</code>) et les{" "}
          <strong>domaines du site</strong> (les origines autorisées pour le CORS).
        </p>
        <p className="mt-2 text-ink-faint">
          À la validation, l'outil génère la <strong>clé d'API</strong> (affichée une seule fois !) et
          autorise le domaine — pris en compte en ≤ 60 s, sans redéploiement.
        </p>
        <p className="mt-2 text-ink-faint">
          Tant que l'ingestion n'est pas fermée par défaut, une requête sans clé valide n'est pas
          forcément refusée.
        </p>
      </>
    ),
  },
  {
    icon: "activity",
    title: "Copier le snippet d'intégration",
    body: (
      <>
        <p>
          La fiche du client ouvre un guide qui génère <strong>deux balises</strong>{" "}
          <code className="chip-mono">&lt;script&gt;</code> pré-remplies : le SDK ({SDK_POIDS_TEXTE}) et l'appel{" "}
          <code className="chip-mono">MIPRum.init</code> (endpoint, <code className="chip-mono">app_id</code>,
          clé). Exemple :
        </p>
        <div className="mt-3">
          <CopyBlock code={EXAMPLE_SNIPPET} />
        </div>
      </>
    ),
  },
  {
    icon: "list",
    title: "Poser le snippet sur le site",
    body: (
      <>
        <p>
          Coller les deux balises dans le <code className="chip-mono">&lt;head&gt;</code>,{" "}
          <strong>avant tout autre script</strong>. Ça marche pour du HTML statique, du React/Vite, du
          Next.js (<code className="chip-mono">&lt;Script beforeInteractive&gt;</code>) ou via un tag
          « HTML personnalisé » d'un tag manager.
        </p>
        <p className="mt-2">
          Rien d'autre à coder : <strong>Web Vitals, erreurs JS, sessions et tracing des appels API</strong>{" "}
          sont captés automatiquement.
        </p>
        <p className="mt-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-ink-soft">
          🚀 Le client ne peut (ou ne veut) pas modifier son code ? <strong>Injection zéro-touch</strong>{" "}
          depuis l'infra : Cloudflare Worker, nginx (<code className="chip-mono">sub_filter</code>) ou
          Google Tag Manager — configs générées dans le guide de la fiche client.
        </p>
      </>
    ),
  },
  {
    icon: "trace",
    title: "Brancher le backend",
    optional: true,
    body: (
      <>
        <p>
          Pour décomposer chaque appel API en <strong>navigateur / réseau / serveur</strong> (tracing
          front → back, la démo qui vend), poser un middleware prêt à l'emploi (<strong>FastAPI</strong> ou{" "}
          <strong>Express</strong>) ou lancer l'app sous l'<strong>auto-instrumentation OpenTelemetry</strong>{" "}
          (Python, Java, .NET, Go, Node…).
        </p>
        <p className="mt-2 text-ink-faint">
          Étape facultative : sans elle, la mesure côté navigateur fonctionne ; seul le lien vers
          l'exécution serveur manque.
        </p>
      </>
    ),
  },
  {
    icon: "gauge",
    title: "Vérifier que les données remontent",
    body: (
      <>
        <p>
          La <strong>checklist live</strong> de la fiche client passe au vert toute seule
          (rafraîchissement 5 s) : premières Web Vitals, sessions sur 24 h, spans front/back. Il suffit
          d'ouvrir le site du client dans un onglet et de la regarder se remplir.
        </p>
        <p className="mt-2">
          Les données apparaissent ensuite dans <strong>Vue d'ensemble</strong>, <strong>Sessions</strong>{" "}
          et <strong>Tracing</strong> une fois le projet sélectionné.
        </p>
      </>
    ),
  },
  {
    icon: "user",
    title: "Donner un accès au client",
    optional: true,
    body: (
      <p>
        Créer un compte <strong>viewer scopé</strong> : il ne voit que cette app (dashboards, sessions,
        erreurs, tracing), rien d'autre. Pratique pour offrir au client un accès en lecture à ses propres
        données, en toute étanchéité.
      </p>
    ),
  },
];

export function AddClientCarousel({ isAdmin }: { isAdmin: boolean }) {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  return (
    <section
      className="card overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      tabIndex={0}
      aria-roledescription="carrousel"
      aria-label="Tutoriel : ajouter un client"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") setI((v) => Math.min(STEPS.length - 1, v + 1));
        else if (e.key === "ArrowLeft") setI((v) => Math.max(0, v - 1));
      }}
    >
      <header className="flex items-center gap-3 border-b border-line bg-panel2/60 px-5 py-3.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-deep text-white shadow-glow">
          <Icon paths={ICON_PATHS[step.icon]} className="h-5 w-5" strokeWidth={2.2} />
        </span>
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            Ajouter un client · étape {i + 1} / {STEPS.length}
            {step.optional && <span className="ml-1.5 text-ink-faint/70">(optionnel)</span>}
          </div>
          <h3 className="truncate text-base font-bold tracking-tight text-ink">
            {i + 1}. {step.title}
          </h3>
        </div>
      </header>

      <div className="min-h-[200px] px-5 py-4 text-sm leading-relaxed text-ink-soft">{step.body}</div>

      {/* progression cliquable */}
      <div className="flex items-center gap-1.5 px-5">
        {STEPS.map((_s, idx) => (
          <button
            key={idx}
            type="button"
            aria-label={`Aller à l'étape ${idx + 1}`}
            onClick={() => setI(idx)}
            className={`h-1.5 flex-1 rounded-full transition ${idx <= i ? "bg-accent" : "bg-line"}`}
          />
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 px-5 py-4">
        {isAdmin ? (
          <Link
            href="/admin/customers"
            className="flex items-center gap-1.5 text-xs font-semibold text-accent-ink transition hover:underline"
          >
            Ouvrir l'écran Clients
            <Icon paths={ICON_PATHS.chevronRight} className="h-3.5 w-3.5" />
          </Link>
        ) : (
          <span className="text-xs text-ink-faint">
            Demandez à un administrateur de créer le client.
          </span>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setI((v) => Math.max(0, v - 1))}
            disabled={i === 0}
            className="flex items-center gap-1 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-medium text-ink-soft transition hover:bg-panel2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon paths={ICON_PATHS.chevronLeft} className="h-3.5 w-3.5" />
            Précédent
          </button>
          <button
            type="button"
            onClick={() => setI((v) => Math.min(STEPS.length - 1, v + 1))}
            disabled={last}
            className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-navy-950 shadow-sm transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40"
          >
            Suivant
            <Icon paths={ICON_PATHS.chevronRight} className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </section>
  );
}
