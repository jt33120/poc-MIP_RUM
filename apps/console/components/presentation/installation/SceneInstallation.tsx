"use client";

// La scène des tutoriels d'installation (TutorielInstallation) : la page Installer de
// la console, dessinée avec la coquille de l'aperçu de la vitrine (classes `.scene-*`
// de SceneConsole), puis la fenêtre d'une IA de code, puis ce qu'on obtient. Cinq
// vues, une par étape (lib/installation-faits.ts) ; les calques se relaient en fondu et
// leurs éléments s'animent quand leur vue s'ouvre (classes `.si-*`, globals.css).
//
// Les libellés de la page Installer sont ceux de la console : onglets (LIBELLE_PARCOURS),
// bouton « Copier pour mon IA de code », cases du test « ça arrive » (verificationsDe),
// états du sondage. Les chiffres du résultat sont ceux de l'aperçu de la vitrine.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { LIBELLE_PARCOURS, PARCOURS, verificationsDe, type Parcours } from "@/lib/installer";
import type { VueTutoriel } from "@/lib/installation-faits";

export const LARGEUR_SCENE_INSTALLATION = 1080;
export const HAUTEUR_SCENE_INSTALLATION = 640;

const NAV = ["Performance", "Usages", "Fiabilité", "Explorer", "Supervision IA", "API et MCP", "Installer"] as const;
const NAV_RESULTAT: Record<Parcours, (typeof NAV)[number]> = { snippet: "Performance", extension: "Usages", serveur: "Fiabilité" };

/** Ce que l'IA de code écrit, parcours par parcours : ses constats, puis le diff. */
const IA: Record<Parcours, { fichiers: string[]; prompt: string; lignes: string[]; diff: { fichier: string; plus: string[] } }> = {
  snippet: {
    fichiers: ["app/layout.tsx", "next.config.js", ".env.example", "package.json"],
    prompt: "Installe le SDK navigateur de MIP RUM (Real User Monitoring, au format OpenTelemetry) dans ce projet web…",
    lignes: [
      "Pile détectée : Next.js, App Router.",
      "SDK posé dans app/layout.tsx, avant tout autre script.",
      "CSP mise à jour dans next.config.js : script-src et connect-src.",
      "NEXT_PUBLIC_MIP_RUM_API_KEY ajoutée à .env.example.",
      "Il me faut la clé d'API : collez-la dans votre .env.",
    ],
    diff: {
      fichier: "app/layout.tsx",
      plus: ['<Script src="…/mip-rum.js" strategy="beforeInteractive" />', "MIPRum.init({ appId: \"boutique-demo\", … })"],
    },
  },
  extension: {
    fichiers: ["intune/extension-settings.json", "intune/nommage-postes.json", "README-deploiement.md"],
    prompt: "Aide-moi à déployer l'extension navigateur MIP RUM sur un parc de postes Chrome ou Edge gérés…",
    lignes: [
      "Outil de parc : Microsoft Intune, Chrome et Edge.",
      "Stratégie ExtensionSettings traduite : installation forcée.",
      "Domaine accordé d'avance : boutique.exemple.fr.",
      "Postes nommés par %COMPUTERNAME%.",
      "Adresse du paquet signé (update_url) : à me donner.",
    ],
    diff: { fichier: "intune/extension-settings.json", plus: ['"installation_mode": "force_installed",', '"runtime_allowed_hosts": ["*://boutique.exemple.fr"]'] },
  },
  serveur: {
    fichiers: ["Dockerfile", "requirements.txt", "deploy/env.yaml", "app/main.py"],
    prompt: "Instrumente ce service Python (FastAPI, Django, Flask…) avec l'agent OpenTelemetry OFFICIEL…",
    lignes: [
      "Service Python (FastAPI), démarré par le Dockerfile.",
      "opentelemetry-distro ajouté à requirements.txt.",
      "Lancement sous opentelemetry-instrument.",
      "Variables OTEL_* dans deploy/env.yaml ; la clé, dans les secrets.",
      "CORS : traceparent et tracestate autorisés.",
    ],
    diff: { fichier: "Dockerfile", plus: ["RUN opentelemetry-bootstrap -a install", 'CMD ["opentelemetry-instrument", "uvicorn", "app.main:app"]'] },
  },
};

const TITRE_CHECKLIST: Record<Parcours, string> = {
  snippet: "SDK JavaScript — tous les visiteurs",
  extension: "Extension navigateur — les postes équipés",
  serveur: "Serveur — la part serveur de chaque appel",
};

const ETAPES_INSTALLATION: Record<Parcours, string[]> = {
  snippet: ["Copier le SDK", "Remplacer le repère par votre clé", "Coller les deux balises en tête du <head>"],
  extension: ["Installer l'extension sur les postes", "Nommer les postes (parc géré)", "Autoriser le site d'un clic"],
  serveur: ["Choisir le langage et copier sa recette", "Poser la clé dans mip.api_key", "Relancer l'application sous l'agent"],
};

function Couche({ vues, vue, children }: { vues: readonly VueTutoriel[]; vue: VueTutoriel; children: ReactNode }) {
  return (
    <div className="scene-couche si-couche" data-actif={vues.includes(vue)} data-vue={vue}>
      {children}
    </div>
  );
}

function Case({ faite, verte }: { faite?: boolean; verte?: boolean }) {
  return (
    <span className="si-case" data-faite={faite} data-verte={verte}>
      <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </span>
  );
}

function Curseur({ trajet }: { trajet: "onglet" | "bouton" }) {
  return (
    <svg className={`si-curseur si-curseur--${trajet}`} viewBox="0 0 24 24" width="22" height="22">
      <path d="M4 2l15 9-6.5 1.6L9.8 19z" fill="#111827" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

export function SceneInstallation({ parcours, vue }: { parcours: Parcours; vue: VueTutoriel }) {
  const cadre = useRef<HTMLDivElement>(null);
  const [k, setK] = useState<number | null>(null);

  useEffect(() => {
    const el = cadre.current;
    if (!el) return;
    const mesurer = () => setK(el.clientWidth / LARGEUR_SCENE_INSTALLATION);
    mesurer();
    const ro = new ResizeObserver(mesurer);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ia = IA[parcours];
  const verifs = verificationsDe(parcours, null);
  const surPage = vue !== "resultat";
  const navActive = surPage ? "Installer" : NAV_RESULTAT[parcours];

  return (
    <div
      ref={cadre}
      className="relative w-full overflow-hidden bg-[#f6f7f9]"
      style={{ aspectRatio: `${LARGEUR_SCENE_INSTALLATION} / ${HAUTEUR_SCENE_INSTALLATION}` }}
    >
      <div
        className="scene si"
        data-vue={vue}
        data-parcours={parcours}
        aria-hidden
        style={{ transform: `scale(${k ?? 1})`, opacity: k === null ? 0 : 1 } as CSSProperties}
      >
        <aside className="scene-laterale">
          <div className="scene-marque">
            <span className="scene-logo">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12h4l3-8 4 16 3-8h4" />
              </svg>
            </span>
            <span>
              <b>
                MIP <em>RUM</em>
              </b>
              <small>REAL USER MONITORING</small>
            </span>
          </div>
          <div className="scene-projet">
            <small>● PROJET</small>
            <b>Boutique démo</b>
          </div>
          <nav>
            {NAV.map((n) => (
              <p key={n} data-actif={navActive === n}>
                {n}
              </p>
            ))}
          </nav>
        </aside>
        <header className="scene-haut">
          <span className="scene-puces">
            <i>1 h</i>
            <i data-actif>24 h</i>
            <i>7 j</i>
          </span>
          <span className="scene-live">● LIVE</span>
        </header>

        {/* La page Installer : les onglets, le bandeau IA, la check-list et son test en direct. */}
        <Couche vues={["installer", "copier", "ia", "verifier"]} vue={vue}>
          <div className="scene-titre">
            <p className="scene-sur">INTÉGRATIONS</p>
            <p className="scene-h1">Installer</p>
            <p className="si-sous">Poser MIP RUM sur Boutique démo, pas à pas. Chaque parcours finit par un test en direct.</p>
          </div>
          <div className="si-onglets">
            {PARCOURS.map((p) => (
              <span key={p} data-actif={p === parcours}>
                {LIBELLE_PARCOURS[p]}
              </span>
            ))}
          </div>
          <div className="si-carte" data-vert={vue === "verifier"}>
            <div className="si-carte-tete">
              <b>{TITRE_CHECKLIST[parcours]}</b>
              <i className="si-compteur">
                <span className="si-compteur-avant">0 / 5</span>
                <span className="si-compteur-apres">5 / 5</span>
              </i>
            </div>
            <div className="si-bandeau">
              <p>
                <b>Installation assistée :</b> copiez un prompt qui explique à votre IA de code quoi installer, où et avec
                quelles valeurs. La clé d&apos;API n&apos;y figure pas.
              </p>
              <span className="si-bouton">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 4h6v3H9z" />
                  <path d="M9 5.5H7a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h5" />
                  <path d="M15 5.5h2a2 2 0 0 1 2 2V11" />
                  <path d="M17.5 14l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z" fill="currentColor" />
                </svg>
                <em className="si-bouton-avant">Copier pour mon IA de code</em>
                <em className="si-bouton-apres">Prompt copié ✓</em>
              </span>
            </div>
            <p className="si-groupe">INSTALLATION</p>
            {ETAPES_INSTALLATION[parcours].map((t, i) => (
              <p key={t} className="si-ligne si-ligne--installation" style={{ ["--i" as string]: i }}>
                <Case faite />
                {t}
              </p>
            ))}
            <p className="si-groupe">VÉRIFIER</p>
            <p className="si-sondage">
              <i />
              <span className="si-sondage-cours">Vérification en direct toutes les 5 secondes. Encore 9 min au plus.</span>
              <span className="si-sondage-vert">Tout est arrivé : la vérification s&apos;est arrêtée.</span>
            </p>
            {verifs.map((v, i) => (
              <p key={v.id} className="si-ligne si-ligne--verif" style={{ ["--i" as string]: i }}>
                <Case verte />
                {v.libelle}
              </p>
            ))}
          </div>
          <Curseur trajet={vue === "installer" ? "onglet" : "bouton"} />
          <span className="si-onde" />
          <p className="si-toast">Collez-le dans Claude Code, Cursor ou Copilot, à la racine du projet.</p>
        </Couche>

        {/* L'IA de code : le prompt collé, ses constats un à un, le diff. */}
        <Couche vues={["ia"]} vue={vue}>
          <div className="si-voile" />
          <div className="si-ide">
            <div className="si-ide-barre">
              <span>
                <i />
                <i />
                <i />
              </span>
              <b>votre-projet — assistant de code</b>
            </div>
            <div className="si-ide-corps">
              <ul className="si-arbre">
                {ia.fichiers.map((f, i) => (
                  <li key={f} data-touche={i < 2}>
                    {f}
                  </li>
                ))}
              </ul>
              <div className="si-chat">
                <p className="si-bulle">
                  <small>Prompt collé depuis MIP RUM</small>
                  {ia.prompt}
                </p>
                <div className="si-pense">
                  <i />
                  <i />
                  <i />
                </div>
                {ia.lignes.map((l, i) => (
                  <p key={l} className="si-constat" style={{ ["--i" as string]: i }}>
                    <span>✓</span>
                    {l}
                  </p>
                ))}
                <div className="si-diff">
                  <small>{ia.diff.fichier}</small>
                  {ia.diff.plus.map((l, i) => (
                    <code key={l} style={{ ["--i" as string]: i }}>
                      + {l}
                    </code>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Couche>

        {/* Le résultat, propre à chaque parcours. */}
        <Couche vues={["resultat"]} vue={vue}>
          {parcours === "snippet" && (
            <div className="si-resultat">
              <div className="scene-titre">
                <p className="scene-sur">PERFORMANCE</p>
                <p className="scene-h1">Santé du site</p>
              </div>
              <div className="si-note">
                <svg viewBox="0 0 120 120" width="150" height="150">
                  <circle cx="60" cy="60" r="50" fill="none" stroke="#e4e8ee" strokeWidth="11" />
                  <circle className="si-anneau" cx="60" cy="60" r="50" fill="none" stroke="#10b981" strokeWidth="11" strokeLinecap="round" pathLength={100} transform="rotate(-90 60 60)" />
                </svg>
                <b>92</b>
                <small>sur 100</small>
              </div>
              {[
                ["LCP", "1,9 s"],
                ["INP", "140 ms"],
                ["CLS", "0,04"],
              ].map(([n, v], i) => (
                <div key={n} className="si-vital" style={{ ["--i" as string]: i }}>
                  <small>{n}</small>
                  <b>{v}</b>
                  <span>● bon</span>
                </div>
              ))}
            </div>
          )}
          {parcours === "extension" && (
            <div className="si-resultat">
              <div className="si-navigateur">
                <div className="si-navigateur-barre">
                  <span className="si-url">boutique.exemple.fr</span>
                  <span className="si-ext">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 12h4l3-8 4 16 3-8h4" />
                    </svg>
                  </span>
                </div>
                <div className="si-page">
                  <i style={{ width: 220 }} />
                  <i style={{ width: 380 }} />
                  <i style={{ width: 320 }} />
                </div>
                <div className="si-popup">
                  <b>MIP RUM</b>
                  <p>MIP RUM observe ce domaine.</p>
                  <span className="si-interrupteur" />
                </div>
              </div>
            </div>
          )}
          {parcours === "serveur" && (
            <div className="si-resultat">
              <div className="scene-titre">
                <p className="scene-sur">FIABILITÉ</p>
                <p className="scene-h1">Tracing</p>
              </div>
              <div className="si-trace">
                <p>
                  <small>POST /api/panier</small>
                  <b>1 240 ms</b>
                </p>
                <div className="si-barres">
                  <span className="si-seg si-seg--nav">Navigateur</span>
                  <span className="si-seg si-seg--trajet">Trajet</span>
                  <span className="si-seg si-seg--serveur">Serveur 270 ms</span>
                </div>
                <p className="si-verdict">Le trajet pèse 78 % : la lenteur n&apos;est pas dans le serveur.</p>
              </div>
            </div>
          )}
        </Couche>
      </div>
    </div>
  );
}
