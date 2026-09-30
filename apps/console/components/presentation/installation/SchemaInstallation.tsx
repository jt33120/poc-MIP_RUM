"use client";

// Le schéma de /presentation/installation (30/09/2026) : le navigateur à gauche, le
// serveur à droite, la collecte MIP au milieu. Survoler un côté (ou le toucher, ou y
// arriver au clavier) déplie ce qu'il offre :
//   · navigateur — le code de suivi ou l'extension, chacun en une phrase, et les
//     navigateurs que l'extension prend en charge (cadenas sur les autres) ;
//   · serveur — les langages dont l'agent OpenTelemetry officiel a une recette
//     éprouvée en production, cadenas sur ceux qui ne l'ont pas encore.
//
// Rien n'est affirmé ici qui ne soit ailleurs : les langages suivent
// lib/recettes-agents-otel.ts (recettes dédiées, `etat` « éprouvé en production ») et
// ses `autres` (Go, PHP, Ruby : point R11 de « Ce qui reste ») ; les navigateurs, le
// périmètre de l'extension (Chrome et Edge en Manifest V3, Firefox hors périmètre :
// docs/CADRAGE_EXTENSION.md). tests/unit/schema-installation.test.tsx les confronte.
import Link from "next/link";
import { useRef, useState, type FocusEvent, type ReactNode } from "react";
import { LOGOS, type Marque } from "@/lib/logos-marques";
import { cheminParcours } from "@/lib/vitrine-navigation";

type Cote = "navigateur" | "serveur";

/** Les langages du côté serveur, dans l'ordre des recettes ; `ouvert` : recette éprouvée. */
export const LANGAGES: readonly { marque: Marque; nom: string; ouvert: boolean }[] = [
  { marque: "python", nom: "Python", ouvert: true },
  { marque: "node", nom: "Node.js · TypeScript", ouvert: true },
  { marque: "java", nom: "Java", ouvert: true },
  { marque: "dotnet", nom: ".NET", ouvert: true },
  { marque: "go", nom: "Go", ouvert: false },
  { marque: "php", nom: "PHP", ouvert: false },
  { marque: "ruby", nom: "Ruby", ouvert: false },
];

/** Les navigateurs de l'extension : Manifest V3 sur Chrome et Edge, Firefox hors périmètre. */
export const NAVIGATEURS_EXTENSION: readonly { cle: "chrome" | "edge" | "firefox"; nom: string; ouvert: boolean }[] = [
  { cle: "chrome", nom: "Chrome", ouvert: true },
  { cle: "edge", nom: "Edge", ouvert: true },
  { cle: "firefox", nom: "Firefox", ouvert: false },
];

function Cadenas() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function Coche() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** Un logo de marque, blanc sur une pastille de sa couleur ; éteint quand il est fermé. */
function Pastille({ marque, ouvert, taille = "h-9 w-9" }: { marque: Marque | "edge"; ouvert: boolean; taille?: string }) {
  const fond = marque === "edge" ? "linear-gradient(135deg,#0c59a4,#35c1f1)" : LOGOS[marque].couleur;
  return (
    <span
      aria-hidden
      className={`grid ${taille} shrink-0 place-items-center rounded-xl transition ${ouvert ? "" : "opacity-35 grayscale"}`}
      style={{ background: fond }}
    >
      {marque === "edge" ? (
        // Plus de tracé Edge dans Simple Icons : un monogramme, aux couleurs du navigateur.
        <span className="text-base font-black leading-none text-white">e</span>
      ) : (
        <svg viewBox="0 0 24 24" className="h-[55%] w-[55%]" fill="white">
          <path d={LOGOS[marque].trace} />
        </svg>
      )}
    </span>
  );
}

function Etat({ ouvert }: { ouvert: boolean }) {
  return ouvert ? (
    <span className="grid h-5 w-5 place-items-center rounded-full bg-[#f89101] text-[#040a1c]" title="Pris en charge">
      <Coche />
    </span>
  ) : (
    <span className="grid h-5 w-5 place-items-center rounded-full bg-white/10 text-white/60" title="Pas encore disponible">
      <Cadenas />
    </span>
  );
}

// ─── Les illustrations ────────────────────────────────────────────────────────

function DessinNavigateur() {
  return (
    <svg aria-hidden viewBox="0 0 320 200" className="h-full w-full" fill="none">
      <rect x="20" y="14" width="280" height="172" rx="14" fill="#0b1735" stroke="rgba(255,255,255,.14)" />
      <path d="M20 28a14 14 0 0 1 14-14h252a14 14 0 0 1 14 14v18H20z" fill="#0f1f45" />
      {[38, 52, 66].map((x, i) => (
        <circle key={x} cx={x} cy="30" r="4" fill={["#ff5f57", "#febc2e", "#28c840"][i]} opacity=".85" />
      ))}
      <rect x="86" y="22" width="190" height="16" rx="8" fill="rgba(255,255,255,.07)" />
      <text x="98" y="35" fontSize="9" fill="rgba(255,255,255,.5)" fontFamily="ui-monospace,monospace">
        boutique.exemple.fr
      </text>
      <rect x="40" y="64" width="120" height="12" rx="6" fill="rgba(255,255,255,.16)" />
      <rect x="40" y="84" width="170" height="8" rx="4" fill="rgba(255,255,255,.08)" />
      <rect x="40" y="98" width="150" height="8" rx="4" fill="rgba(255,255,255,.08)" />
      {[0, 1, 2].map((i) => (
        <rect key={i} x={40 + i * 82} y="118" width="70" height="48" rx="8" fill="rgba(255,255,255,.05)" stroke="rgba(255,255,255,.08)" />
      ))}
      {/* Le code de suivi, dans la page : il bat, et ses mesures partent vers la droite. */}
      <g className="schema-pouls">
        <rect x="222" y="62" width="58" height="22" rx="11" fill="#f89101" />
        <text x="251" y="77" fontSize="10" fontWeight="700" textAnchor="middle" fill="#040a1c">
          SDK
        </text>
      </g>
      <path d="M280 73 H318" stroke="#f89101" strokeWidth="2" strokeDasharray="4 6" className="schema-flux" />
    </svg>
  );
}

function DessinServeur() {
  return (
    <svg aria-hidden viewBox="0 0 320 200" className="h-full w-full" fill="none">
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(70 ${24 + i * 54})`}>
          <rect width="180" height="42" rx="10" fill="#0b1735" stroke="rgba(255,255,255,.14)" />
          {[0, 1, 2, 3].map((j) => (
            <rect key={j} x={18 + j * 14} y="12" width="6" height="18" rx="3" fill="rgba(255,255,255,.12)" />
          ))}
          <circle cx="150" cy="21" r="4" fill="#28c840" className="schema-led" style={{ animationDelay: `${i * 0.4}s` }} />
          <circle cx="136" cy="21" r="4" fill="#f89101" className="schema-led" style={{ animationDelay: `${i * 0.4 + 0.2}s` }} />
        </g>
      ))}
      <g className="schema-pouls">
        <rect x="104" y="170" width="112" height="22" rx="11" fill="#f89101" />
        <text x="160" y="185" fontSize="10" fontWeight="700" textAnchor="middle" fill="#040a1c">
          OpenTelemetry
        </text>
      </g>
      <path d="M70 45 H2" stroke="#f89101" strokeWidth="2" strokeDasharray="4 6" className="schema-flux schema-flux--inverse" />
    </svg>
  );
}

// ─── Les deux côtés ───────────────────────────────────────────────────────────

function Volet({
  cote,
  ouvert,
  onOuvrir,
  onFermer,
  surtitre,
  titre,
  resume,
  dessin,
  detail,
}: {
  cote: Cote;
  ouvert: boolean;
  onOuvrir: () => void;
  onFermer: () => void;
  surtitre: string;
  titre: string;
  resume: string;
  dessin: ReactNode;
  detail: ReactNode;
}) {
  const racine = useRef<HTMLDivElement>(null);
  const quitter = (e: FocusEvent) => {
    if (!racine.current?.contains(e.relatedTarget as Node | null)) onFermer();
  };
  return (
    <div
      ref={racine}
      tabIndex={0}
      role="group"
      aria-label={`${titre} : survoler ou toucher pour voir les options`}
      data-testid={`schema-${cote}`}
      data-ouvert={ouvert}
      onMouseEnter={onOuvrir}
      onMouseLeave={onFermer}
      onFocus={onOuvrir}
      onBlur={quitter}
      onClick={onOuvrir}
      className="schema-volet group relative isolate min-h-[32rem] sm:min-h-[27rem] overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-6 outline-none transition duration-300 focus-visible:ring-2 focus-visible:ring-[#f89101] data-[ouvert=true]:border-[#f89101]/50"
    >
      <div className={`transition duration-500 ${ouvert ? "scale-[0.97] opacity-25 blur-[2px]" : ""}`}>
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#fbbc64]">{surtitre}</p>
        <h3 className="mt-2 text-2xl font-extrabold tracking-tight text-white">{titre}</h3>
        <p className="mt-1 text-sm text-white/60">{resume}</p>
        <div className="mt-6 h-56">{dessin}</div>
      </div>
      <div
        aria-hidden={!ouvert}
        className={`schema-detail absolute inset-0 flex flex-col justify-center bg-[#07122e]/70 p-6 backdrop-blur-xl transition duration-500 ${
          ouvert ? "visible translate-y-0 opacity-100" : "invisible translate-y-6 opacity-0"
        }`}
      >
        {detail}
      </div>
      {/* L'invite : un point orange qui pulse, tant que le volet est fermé. */}
      <span aria-hidden className={`absolute right-5 top-5 flex items-center gap-2 text-[11px] font-medium text-white/50 transition ${ouvert ? "opacity-0" : ""}`}>
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#f89101] opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#f89101]" />
        </span>
        Survoler
      </span>
    </div>
  );
}

function Choix({ titre, badge, phrase, href, children }: { titre: string; badge: string; phrase: string; href: string; children?: ReactNode }) {
  return (
    <li className="schema-choix rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-bold text-white">{titre}</span>
        <span className="rounded-full bg-[#f89101]/15 px-2 py-0.5 text-[10px] font-semibold text-[#fbbc64]">{badge}</span>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-white/70">{phrase}</p>
      {children}
      <Link href={href} className="mt-2 inline-block text-sm font-semibold text-[#fbbc64] transition hover:translate-x-1">
        Lire le parcours →
      </Link>
    </li>
  );
}

export function SchemaInstallation() {
  const [ouvert, setOuvert] = useState<Cote | null>(null);
  const fermer = (c: Cote) => () => setOuvert((o) => (o === c ? null : o));

  return (
    <div data-testid="schema-installation" className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1fr)]">
      <Volet
        cote="navigateur"
        ouvert={ouvert === "navigateur"}
        onOuvrir={() => setOuvert("navigateur")}
        onFermer={fermer("navigateur")}
        surtitre="Côté navigateur"
        titre="Le SDK"
        resume="Ce que vivent vos visiteurs : vitesse, erreurs, parcours."
        dessin={<DessinNavigateur />}
        detail={
          <>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#fbbc64]">Deux façons de le poser</p>
            <ul className="mt-3 grid gap-3">
              <Choix
                titre="SDK JavaScript"
                badge="Recommandé"
                phrase="Deux balises dans vos pages : chaque visiteur est mesuré, quel que soit son navigateur."
                href={cheminParcours("snippet")}
              />
              <Choix
                titre="Extension navigateur"
                badge="Sans toucher au site"
                phrase="Ne touche pas au site, mais ne mesure que les postes où elle est installée."
                href={cheminParcours("extension")}
              >
                <ul className="mt-2.5 flex flex-wrap gap-3" aria-label="Navigateurs de l'extension">
                  {NAVIGATEURS_EXTENSION.map((n) => (
                    <li key={n.cle} className="flex items-center gap-1.5" data-testid="schema-extension-navigateur" data-ouvert={n.ouvert}>
                      <Pastille marque={n.cle} ouvert={n.ouvert} taille="h-7 w-7" />
                      <span className={`text-xs font-medium ${n.ouvert ? "text-white" : "text-white/45"}`}>{n.nom}</span>
                      <Etat ouvert={n.ouvert} />
                      {!n.ouvert && <span className="sr-only">(pas encore disponible)</span>}
                    </li>
                  ))}
                </ul>
              </Choix>
            </ul>
          </>
        }
      />

      {/* Le milieu : la collecte MIP, où convergent les deux flux. */}
      <div aria-hidden className="relative hidden flex-col items-center justify-center lg:flex">
        <svg viewBox="0 0 144 240" className="absolute inset-0 h-full w-full" preserveAspectRatio="none" fill="none">
          <path d="M0 120 H144" stroke="rgba(248,145,1,.25)" strokeWidth="2" />
          <path d="M0 120 H72" stroke="#f89101" strokeWidth="2" strokeDasharray="4 8" className="schema-flux" />
          <path d="M144 120 H72" stroke="#f89101" strokeWidth="2" strokeDasharray="4 8" className="schema-flux" />
        </svg>
        <div className="schema-foyer relative grid h-24 w-24 place-items-center rounded-full border border-[#f89101]/60 bg-[#040a1c] text-center shadow-[0_0_60px_-10px_rgba(248,145,1,.7)]">
          <span className="text-[11px] font-bold leading-tight text-white">
            Collecte
            <br />
            <span className="text-[#f89101]">MIP RUM</span>
          </span>
        </div>
      </div>

      <Volet
        cote="serveur"
        ouvert={ouvert === "serveur"}
        onOuvrir={() => setOuvert("serveur")}
        onFermer={fermer("serveur")}
        surtitre="Côté serveur · facultatif"
        titre="L'agent OpenTelemetry"
        resume="Relie chaque appel du navigateur à sa part côté serveur."
        dessin={<DessinServeur />}
        detail={
          <>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#fbbc64]">L&apos;agent officiel de votre langage</p>
            <p className="mt-2 text-sm leading-relaxed text-white/70">
              Aucun code MIP sur vos serveurs : l&apos;agent standard, réglé par quelques variables.
            </p>
            <ul className="mt-4 grid grid-cols-2 gap-2" aria-label="Langages">
              {LANGAGES.map((l) => (
                <li
                  key={l.marque}
                  data-testid="schema-langage"
                  data-ouvert={l.ouvert}
                  className={`schema-choix flex items-center gap-2.5 rounded-xl border p-2 ${
                    l.ouvert ? "border-white/10 bg-white/[0.05]" : "border-dashed border-white/10"
                  }`}
                >
                  <Pastille marque={l.marque} ouvert={l.ouvert} taille="h-8 w-8" />
                  <span className={`min-w-0 flex-1 text-xs font-semibold ${l.ouvert ? "text-white" : "text-white/45"}`}>{l.nom}</span>
                  <Etat ouvert={l.ouvert} />
                  {!l.ouvert && <span className="sr-only">(pas encore disponible)</span>}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-white/45">Cadenas : recette pas encore éprouvée en production.</p>
            <Link href={cheminParcours("serveur")} className="mt-2 inline-block text-sm font-semibold text-[#fbbc64] transition hover:translate-x-1">
              Lire le parcours →
            </Link>
          </>
        }
      />
    </div>
  );
}
