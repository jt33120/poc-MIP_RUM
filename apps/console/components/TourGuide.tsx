"use client";
// Tutoriel de navigation — s'ouvre au premier passage (localStorage), ré-ouvrable
// à tout moment via le bouton « Guide » de l'en-tête. Vit dans le layout : l'état
// survit à la navigation, donc « Ouvrir cette page » charge la page derrière la
// fenêtre sans interrompre le tour.
import Link from "next/link";
import { useEffect, useState } from "react";
import { ICON_PATHS, Icon, type IconName } from "./icons";

const SEEN_KEY = "mip-tour-seen-v1";

interface Step {
  icon: IconName;
  title: string;
  href?: string;
  body: React.ReactNode;
}

const STEPS: Step[] = [
  {
    icon: "activity",
    title: "Bienvenue dans MIP RUM",
    body: (
      <>
        <p>
          MIP RUM mesure la performance et les erreurs <strong>vécues par vos vrais utilisateurs</strong> en
          production (Real User Monitoring), pas une simulation en laboratoire.
        </p>
        <p className="mt-2">
          Socle <strong>OpenTelemetry-natif</strong> et <strong>souverain UE</strong> : navigateur → OTLP →
          Postgres → cette console. Ce guide fait le tour des écrans en 1 minute.
        </p>
      </>
    ),
  },
  {
    icon: "gauge",
    title: "Overview — le poste de pilotage",
    href: "/",
    body: (
      <>
        <p>
          La page d'accueil donne un <strong>score de santé /100</strong> (un bulletin unique), les{" "}
          <strong>Core Web Vitals au p75</strong> (LCP, INP, CLS…) et les <strong>anomalies</strong> détectées
          automatiquement.
        </p>
        <p className="mt-2 text-ink-faint">
          Astuce : chaque indicateur porte un « ? » — survolez-le pour l'explication technique <em>et</em>{" "}
          commerciale.
        </p>
      </>
    ),
  },
  {
    icon: "timer",
    title: "Pages lentes",
    href: "/pages",
    body: (
      <p>
        Le classement des routes les plus lentes <strong>pour de vrais visiteurs</strong>. On attaque d'abord
        celles qui pèsent sur le plus de monde — priorisation par impact, pas au doigt mouillé.
      </p>
    ),
  },
  {
    icon: "alert",
    title: "Erreurs JS",
    href: "/errors",
    body: (
      <p>
        Les erreurs JavaScript <strong>regroupées par cause</strong> (fingerprint), pas en vrac. « 12 problèmes
        distincts » triés par impact plutôt que 5 000 lignes de bruit.
      </p>
    ),
  },
  {
    icon: "users",
    title: "Sessions & replay",
    href: "/sessions",
    body: (
      <p>
        Les <strong>parcours réels</strong> des visiteurs. Le <strong>session replay</strong> reconstruit
        visuellement ce qu'ils ont vécu (instantanés du DOM, pas de vidéo) pour comprendre un abandon — sans
        donnée personnelle identifiante.
      </p>
    ),
  },
  {
    icon: "trace",
    title: "Tracing front → back",
    href: "/tracing",
    body: (
      <p>
        Chaque appel API du navigateur est <strong>relié à son exécution serveur</strong> (standard W3C
        traceparent). Répond à « c'est lent : réseau, serveur ou code ? » sans deviner.
      </p>
    ),
  },
  {
    icon: "bell",
    title: "Alertes",
    href: "/alerts",
    body: (
      <p>
        Des <strong>règles de seuil</strong> qui préviennent automatiquement (Slack, Teams…) quand un indicateur
        dérape. On passe du curatif au préventif.
      </p>
    ),
  },
  {
    icon: "compare",
    title: "Corrélation robot vs réel",
    href: "/correlation",
    body: (
      <p>
        Compare le <strong>monitoring synthétique</strong> (sondes automatiques) au <strong>RUM</strong>{" "}
        (utilisateurs réels). Quand le labo dit « tout va bien » mais que le terrain souffre, l'écart le révèle.
      </p>
    ),
  },
  {
    icon: "info",
    title: "Repères de l'en-tête",
    body: (
      <>
        <p>
          En haut : les <strong>filtres globaux</strong> (application, appareil, période) s'appliquent à tous
          les écrans, le badge <strong>LIVE · 5 s</strong> rafraîchit les données en continu, et le bouton
          thème bascule clair/sombre.
        </p>
        <p className="mt-2 text-ink-faint">
          Rouvrez ce guide quand vous voulez via le bouton <strong>Guide</strong>.
        </p>
      </>
    ),
  },
];

export function TourGuide() {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);

  // ouverture automatique au tout premier passage
  useEffect(() => {
    try {
      if (!localStorage.getItem(SEEN_KEY)) setOpen(true);
    } catch {
      /* localStorage indisponible (mode privé strict) : pas de tour auto */
    }
  }, []);

  // navigation clavier quand le tour est ouvert
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") setI((v) => Math.min(STEPS.length - 1, v + 1));
      else if (e.key === "ArrowLeft") setI((v) => Math.max(0, v - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function close() {
    setOpen(false);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  function start() {
    setI(0);
    setOpen(true);
  }

  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  return (
    <>
      <button
        type="button"
        onClick={start}
        className="flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 text-[11px] font-semibold text-ink-soft transition hover:border-accent/40 hover:text-accent"
        title="Ouvrir le guide de navigation"
      >
        <Icon paths={ICON_PATHS.compass} className="h-3.5 w-3.5" />
        Guide
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-navy-950/55 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Guide de navigation MIP RUM"
          onClick={close}
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-panel shadow-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-line bg-panel2/60 px-5 py-3.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-deep text-white shadow-glow">
                <Icon paths={ICON_PATHS[step.icon]} className="h-5 w-5" strokeWidth={2.2} />
              </span>
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                  Guide · étape {i + 1} / {STEPS.length}
                </div>
                <h2 className="truncate text-base font-bold tracking-tight text-ink">{step.title}</h2>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Fermer le guide"
                className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-faint transition hover:bg-panel2 hover:text-ink"
              >
                <Icon paths={ICON_PATHS.close} className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 py-4 text-sm leading-relaxed text-ink-soft">
              {step.body}
              {step.href && (
                <Link
                  href={step.href}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent-deep transition hover:bg-accent/20 dark:text-accent"
                >
                  Ouvrir cette page
                  <Icon paths={ICON_PATHS.chevronRight} className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>

            {/* progression */}
            <div className="flex items-center gap-1.5 px-5">
              {STEPS.map((_s, idx) => (
                <button
                  key={idx}
                  type="button"
                  aria-label={`Aller à l'étape ${idx + 1}`}
                  onClick={() => setI(idx)}
                  className={`h-1.5 flex-1 rounded-full transition ${
                    idx <= i ? "bg-accent" : "bg-line"
                  }`}
                />
              ))}
            </div>

            <div className="flex items-center justify-between gap-2 px-5 py-4">
              <button
                type="button"
                onClick={close}
                className="text-xs font-medium text-ink-faint transition hover:text-ink"
              >
                Passer
              </button>
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
                {last ? (
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-navy-950 shadow-sm transition hover:bg-accent-soft"
                  >
                    Terminer
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setI((v) => Math.min(STEPS.length - 1, v + 1))}
                    className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-navy-950 shadow-sm transition hover:bg-accent-soft"
                  >
                    Suivant
                    <Icon paths={ICON_PATHS.chevronRight} className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
