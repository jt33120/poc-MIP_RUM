"use client";

// LA SCÈNE DE L'APERÇU : une console MIP RUM dessinée en HTML, pas des captures, et
// qui se transforme d'un écran à l'autre (dynamique de basedb, eodia.github.io/basedb).
//
// Sept « éléments » la traversent, toujours les mêmes : les barres du trafic sur la
// santé deviennent les lignes du tableau des pages, puis les barres des erreurs, les
// étapes d'une session, les segments d'une trace, et enfin le petit graphique que
// l'assistant IA rend. Chacun a une géométrie par écran (GEOMETRIE) ; changer d'écran
// change son style, et une transition CSS (0,8 s, décalée de 55 ms par élément) fait
// le reste. Autour d'eux, chaque écran a sa couche (titres, tuiles, rejeu, fil de
// discussion), en fondu, dont les animations ne partent que quand elle devient active.
//
// ILLUSTRATION. Les chiffres sont ceux d'une boutique fictive : la légende de la
// section le dit. La démo, elle, montre les vraies mesures.
//
// Tout est dessiné sur une scène fixe de 1 080 × 640, mise à l'échelle du cadre
// (`--k`, mesuré au ResizeObserver) : les positions restent des entiers lisibles.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { VueScene } from "@/lib/vitrine";

export const LARGEUR_SCENE = 1080;
export const HAUTEUR_SCENE = 640;

type Boite = { x: number; y: number; w: number; h: number };

/** Les sept routes de la boutique fictive, et leur LCP p75 (secondes). */
const ROUTES = ["/", "/produits", "/produit/:id", "/panier", "/commande", "/compte", "/recherche"] as const;
const LCP = [1.6, 2.1, 2.4, 3.1, 1.9, 1.4, 2.8] as const;
/** Le rang de chaque route dans le tableau des pages : la plus lente en tête. */
const RANG_PAGES = [5, 3, 2, 0, 4, 6, 1] as const;

const barres = (x0: number, pas: number, w: number, base: number, hauteurs: readonly number[]): Boite[] =>
  hauteurs.map((h, i) => ({ x: x0 + i * pas, y: base - h, w, h }));

/** La géométrie de chaque élément, écran par écran (coordonnées de la scène). */
const GEOMETRIE: Record<VueScene, Boite[]> = {
  sante: barres(254, 110, 62, 598, [70, 104, 88, 132, 118, 84, 124]),
  pages: RANG_PAGES.map((r) => ({ x: 216, y: 188 + r * 50, w: 844, h: 42 })),
  erreurs: barres(262, 110, 56, 592, [34, 50, 42, 232, 96, 62, 46]),
  session: ROUTES.map((_, i) => ({ x: 716, y: 164 + i * 60, w: 344, h: 48 })),
  tracing: [
    { x: 432, y: 238, w: 580, h: 22 },
    { x: 432, y: 280, w: 56, h: 22 },
    { x: 488, y: 322, w: 128, h: 22 },
    { x: 506, y: 364, w: 74, h: 22 },
    { x: 584, y: 406, w: 26, h: 22 },
    { x: 616, y: 448, w: 316, h: 22 },
    { x: 932, y: 490, w: 80, h: 22 },
  ],
  assistant: barres(626, 46, 32, 584, [38, 40, 36, 42, 86, 104, 116]),
};

/** Le texte que porte chaque élément, sur les écrans où il en porte. */
const ETAPES_SESSION = [
  ["00:00", "Page", "/"],
  ["00:04", "Page", "/produits"],
  ["00:11", "Page", "/produit/42"],
  ["00:18", "Clic", "« Ajouter au panier »"],
  ["00:18", "Appel", "GET /api/panier · 1,2 s"],
  ["00:19", "Erreur", "TypeError : panier indisponible"],
  ["00:24", "Page", "/panier"],
] as const;

const SEGMENTS_TRACE = [
  "Navigateur · GET /api/panier",
  "Connexion",
  "Serveur · panier-api",
  "Base · select panier",
  "Service prix",
  "Transfert de la réponse",
  "Rendu",
] as const;

const NAV = ["Performance", "Robot et réel", "Usages", "Fiabilité", "Explorer", "Logs", "Supervision IA", "API et MCP"] as const;
const NAV_ACTIVE: Record<VueScene, (typeof NAV)[number]> = {
  sante: "Performance",
  pages: "Performance",
  erreurs: "Performance",
  session: "Usages",
  tracing: "Robot et réel",
  assistant: "API et MCP",
};

/** Les onglets de chaque domaine, et celui de l'écran ; le soulignement glisse de l'un à l'autre. */
const ONGLETS: Record<VueScene, { domaine: string; onglets: readonly string[]; actif: number }> = {
  sante: { domaine: "PERFORMANCE", onglets: ["Vue d'ensemble", "Pages", "Erreurs", "Interactions", "Satisfaction"], actif: 0 },
  pages: { domaine: "PERFORMANCE", onglets: ["Vue d'ensemble", "Pages", "Erreurs", "Interactions", "Satisfaction"], actif: 1 },
  erreurs: { domaine: "PERFORMANCE", onglets: ["Vue d'ensemble", "Pages", "Erreurs", "Interactions", "Satisfaction"], actif: 2 },
  session: { domaine: "USAGES", onglets: ["Sessions", "Parcours", "Conversions", "Formulaires", "Rétention"], actif: 0 },
  tracing: { domaine: "ROBOT ET RÉEL", onglets: ["Robot et réel", "Tracing", "Carte"], actif: 1 },
  assistant: { domaine: "API ET MCP", onglets: ["API v1", "Serveur MCP", "Jetons"], actif: 1 },
};

const fr = new Intl.NumberFormat("fr-FR");

function useReduit(): boolean {
  const [reduit, setReduit] = useState(false);
  useEffect(() => setReduit(window.matchMedia("(prefers-reduced-motion: reduce)").matches), []);
  return reduit;
}

/** Un nombre qui monte de 0 à `cible` quand son écran devient actif (tout de suite sans mouvement). */
function Compteur({ cible, actif, decimales = 0, suffixe = "" }: { cible: number; actif: boolean; decimales?: number; suffixe?: string }) {
  const reduit = useReduit();
  const [v, setV] = useState(cible);
  useEffect(() => {
    if (!actif || reduit) {
      setV(cible);
      return;
    }
    let image = 0;
    const debut = performance.now();
    const pas = (t: number) => {
      const p = Math.min(1, (t - debut) / 1100);
      setV(cible * (1 - (1 - p) ** 3));
      if (p < 1) image = requestAnimationFrame(pas);
    };
    setV(0);
    image = requestAnimationFrame(pas);
    return () => cancelAnimationFrame(image);
  }, [actif, cible, reduit]);
  const texte = decimales ? v.toFixed(decimales).replace(".", ",") : fr.format(Math.round(v));
  return (
    <>
      {texte}
      {suffixe}
    </>
  );
}

/** Un texte qui s'écrit lettre à lettre, `apres` ms après l'activation de son écran. */
function Frappe({ texte, actif, apres = 0, vitesse = 28 }: { texte: string; actif: boolean; apres?: number; vitesse?: number }) {
  const reduit = useReduit();
  const [n, setN] = useState(texte.length);
  useEffect(() => {
    if (!actif || reduit) {
      setN(texte.length);
      return;
    }
    setN(0);
    let i = 0;
    let minuteur: ReturnType<typeof setTimeout>;
    const suivant = () => {
      i += 1;
      setN(i);
      if (i < texte.length) minuteur = setTimeout(suivant, vitesse);
    };
    minuteur = setTimeout(suivant, apres);
    return () => clearTimeout(minuteur);
  }, [actif, texte, apres, vitesse, reduit]);
  const fini = n >= texte.length;
  return (
    <span>
      {texte.slice(0, n)}
      {!fini && actif && <i className="scene-caret" aria-hidden />}
    </span>
  );
}

function Tuile({ x, y, w, h, children }: Boite & { children: React.ReactNode }) {
  return (
    <div className="scene-carte" style={{ left: x, top: y, width: w, height: h }}>
      {children}
    </div>
  );
}

function Couche({ vue, actuelle, children }: { vue: VueScene; actuelle: VueScene; children: React.ReactNode }) {
  return (
    <div className="scene-couche" data-actif={vue === actuelle}>
      {children}
    </div>
  );
}

function Titre({ sur, titre, question }: { sur?: string; titre: string; question: string }) {
  return (
    <div className="scene-titre">
      {sur && <p className="scene-sur">● {sur}</p>}
      <p className="scene-h1">{titre}</p>
      <p className="scene-question">{question}</p>
    </div>
  );
}

export function SceneConsole({ vue }: { vue: VueScene }) {
  const cadre = useRef<HTMLDivElement>(null);
  const [k, setK] = useState<number | null>(null);

  useEffect(() => {
    const el = cadre.current;
    if (!el) return;
    const mesurer = () => setK(el.clientWidth / LARGEUR_SCENE);
    mesurer();
    const ro = new ResizeObserver(mesurer);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onglets = ONGLETS[vue];
  const actif = (v: VueScene) => v === vue;

  return (
    <div ref={cadre} className="relative w-full overflow-hidden bg-[#f6f7f9]" style={{ aspectRatio: `${LARGEUR_SCENE} / ${HAUTEUR_SCENE}` }}>
      <div
        className="scene"
        data-vue={vue}
        aria-hidden
        style={{ transform: `scale(${k ?? 1})`, opacity: k === null ? 0 : 1 } as CSSProperties}
      >
        {/* La coquille : barre latérale, barre du haut, onglets. */}
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
              <p key={n} data-actif={NAV_ACTIVE[vue] === n}>
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
          <span className="scene-puces">
            <i data-actif>Tous</i>
            <i>Ordinateur</i>
            <i>Mobile</i>
          </span>
          <span className="scene-live">● LIVE · 5 s</span>
        </header>
        <div className="scene-onglets">
          <span className="scene-domaine">{onglets.domaine}</span>
          {onglets.onglets.map((o, i) => (
            <span key={`${onglets.domaine}-${o}`} data-actif={i === onglets.actif}>
              {o}
            </span>
          ))}
        </div>

        {/* ── Santé ─────────────────────────────────────────────────────────── */}
        <Couche vue="sante" actuelle={vue}>
          <Titre sur="PERFORMANCE" titre="Vue d'ensemble" question="Les vrais visiteurs vont-ils bien sur cette période, et sinon, où et depuis quand ?" />
          <Tuile x={216} y={168} w={228} h={218}>
            <svg className="scene-anneau" viewBox="0 0 120 120" width="120" height="120">
              <circle cx="60" cy="60" r="50" stroke="#e7eaf0" strokeWidth="11" fill="none" />
              <circle cx="60" cy="60" r="50" stroke="#059669" strokeWidth="11" fill="none" strokeLinecap="round" pathLength={100} strokeDasharray="92 100" transform="rotate(-90 60 60)" />
            </svg>
            <p className="scene-note">
              <b>
                <Compteur cible={92} actif={actif("sante")} />
              </b>
              <small>/ 100</small>
            </p>
            <p className="scene-pastille scene-bon" style={{ left: 64, top: 168 }}>
              Excellent
            </p>
          </Tuile>
          {[
            { t: "Sessions commencées", v: 12480, d: "↑ +8 % vs veille" },
            { t: "Pages vues", v: 48210, d: "↑ +5 % vs veille" },
            { t: "Erreurs pour 100 pages vues", v: 0.8, dec: 1, d: "↓ −0,3 vs veille" },
          ].map((k, i) => (
            <Tuile key={k.t} x={460 + i * 204} y={168} w={192} h={100}>
              <p className="scene-etiquette">{k.t}</p>
              <p className="scene-valeur">
                <Compteur cible={k.v} decimales={k.dec} actif={actif("sante")} />
              </p>
              <p className="scene-delta">{k.d}</p>
              <svg className="scene-trace" viewBox="0 0 160 24" width="64" height="20" preserveAspectRatio="none">
                <path d="M0 18 L20 16 L40 17 L60 12 L80 14 L100 9 L120 11 L140 6 L160 8" fill="none" stroke="#f89101" strokeWidth="2" pathLength={100} />
              </svg>
            </Tuile>
          ))}
          {[
            ["LCP p75", "1,9 s"],
            ["INP p75", "140 ms"],
            ["CLS p75", "0,04"],
          ].map(([t, v], i) => (
            <Tuile key={t} x={460 + i * 204} y={280} w={192} h={106}>
              <p className="scene-etiquette">{t}</p>
              <p className="scene-pastille scene-bon" style={{ right: 12, top: 10 }}>
                Bon
              </p>
              <p className="scene-valeur">{v}</p>
              <p className="scene-delta">au 75e centile, sur 24 h</p>
            </Tuile>
          ))}
          <Tuile x={216} y={400} w={844} h={216}>
            <p className="scene-etiquette-maj">PAGES VUES, HEURE PAR HEURE</p>
          </Tuile>
        </Couche>

        {/* ── Pages ─────────────────────────────────────────────────────────── */}
        <Couche vue="pages" actuelle={vue}>
          <Titre sur="PERFORMANCE" titre="Pages" question="Quelles pages font attendre, pour qui, et depuis quand ?" />
          <div className="scene-entete-table" style={{ top: 166 }}>
            <span>Route</span>
            <span>LCP p75</span>
            <span>Verdict</span>
          </div>
        </Couche>

        {/* ── Erreurs ───────────────────────────────────────────────────────── */}
        <Couche vue="erreurs" actuelle={vue}>
          <Titre sur="PERFORMANCE" titre="Erreurs JS" question="Quelles erreurs touchent le plus de sessions, depuis quand, et après quelle version ?" />
          {[
            { t: "Occurrences", v: 1284 },
            { t: "Sessions touchées", v: 3.2, dec: 1, s: " %" },
            { t: "Groupes apparus", v: 6 },
          ].map((k, i) => (
            <Tuile key={k.t} x={216 + i * 286} y={168} w={272} h={78}>
              <p className="scene-etiquette">{k.t}</p>
              <p className="scene-valeur">
                <Compteur cible={k.v} decimales={k.dec} suffixe={k.s} actif={actif("erreurs")} />
              </p>
            </Tuile>
          ))}
          <Tuile x={216} y={260} w={844} h={356}>
            <p className="scene-etiquette-maj">OCCURRENCES DANS LE TEMPS, PAR JOUR</p>
          </Tuile>
          <div className="scene-release">
            <span>release 70a8b2b</span>
          </div>
          <div className="scene-axe" style={{ top: 598 }}>
            {["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."].map((j, i) => (
              <span key={j} style={{ left: 262 + i * 110 }}>
                {j}
              </span>
            ))}
          </div>
        </Couche>

        {/* ── Session : le rejeu, et son récit à droite ─────────────────────── */}
        <Couche vue="session" actuelle={vue}>
          <Titre sur="USAGES" titre="Session 4f2a…" question="Que s'est-il passé dans cette session, dans quel ordre, et qu'a vu le visiteur ?" />
          <div className="scene-rejeu">
            <div className="scene-rejeu-barre">
              <i />
              <i />
              <i />
              <span>boutique-demo.fr/produit/42</span>
            </div>
            <div className="scene-site">
              <div className="scene-site-image" />
              <p className="scene-site-titre">Veste imperméable</p>
              <p className="scene-site-prix">89,00 €</p>
              <p className="scene-site-bouton">Ajouter au panier</p>
              <div className="scene-site-lignes">
                <i />
                <i />
                <i />
              </div>
            </div>
            <p className="scene-toast">⚠ Le panier est indisponible, réessayez.</p>
            <svg className="scene-curseur" width="22" height="22" viewBox="0 0 24 24">
              <path d="M4 2l16 9-7 2-3 7z" fill="#0e1b45" stroke="#fff" strokeWidth="1.5" />
            </svg>
            <span className="scene-onde" />
            <div className="scene-lecture">
              <span>▶</span>
              <i>
                <b />
              </i>
              <span>00:19 / 00:31</span>
            </div>
          </div>
        </Couche>

        {/* ── Tracing : la cascade ──────────────────────────────────────────── */}
        <Couche vue="tracing" actuelle={vue}>
          <Titre sur="ROBOT ET RÉEL" titre="Tracing" question="Quand un appel est lent, le temps part-il dans le serveur ou dans le trajet ?" />
          <Tuile x={216} y={184} w={844} h={352}>
            <p className="scene-etiquette-maj">GET /API/PANIER · UNE TRACE, DU NAVIGATEUR AU SERVEUR</p>
          </Tuile>
          {SEGMENTS_TRACE.map((s, i) => (
            <p key={s} className="scene-segment" style={{ top: GEOMETRIE.tracing[i].y + 3 }}>
              {s}
            </p>
          ))}
          <div className="scene-resume-trace">
            <span>
              Navigateur <b>1 240 ms</b>
            </span>
            <span>
              Serveur <b>270 ms</b>
            </span>
            <span className="scene-pastille-inline" data-verdict="moyen">
              le trajet pèse 78 %
            </span>
          </div>
        </Couche>

        {/* ── Assistant : l'IA interroge les mesures par le serveur MCP ─────── */}
        <Couche vue="assistant" actuelle={vue}>
          <Titre sur="API ET MCP" titre="Serveur MCP" question="Branchez un assistant IA sur vos mesures." />
          <Tuile x={216} y={168} w={326} h={448}>
            <p className="scene-etiquette-maj">OUTILS EXPOSÉS, EN LECTURE</p>
            <ul className="scene-outils-liste">
              {[
                "mip_rum_get_overview",
                "mip_rum_list_slow_pages",
                "mip_rum_list_errors",
                "mip_rum_get_session",
                "mip_rum_get_tracing",
                "mip_rum_get_trends",
                "mip_rum_list_detections",
                "mip_rum_query_explorer",
              ].map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          </Tuile>
          <div className="scene-chat">
            <p className="scene-chat-tete">
              <span className="scene-logo scene-logo-petit">✦</span> Assistant IA · serveur MCP MIP RUM
            </p>
            <p className="scene-bulle-q">
              <Frappe texte="Quelles pages se sont dégradées cette semaine, et sur quels appareils ?" actif={actif("assistant")} apres={300} vitesse={24} />
            </p>
            <p className="scene-outils">
              <i>mip_rum_get_trends</i>
              <i>mip_rum_list_slow_pages</i>
            </p>
            <p className="scene-pense">
              <i />
              <i />
              <i />
            </p>
            <p className="scene-bulle-r">
              <Frappe
                texte="/panier : LCP p75 passé de 1,8 s à 3,1 s depuis jeudi, surtout sur mobile Android. La hausse suit la release 70a8b2b ; l'appel GET /api/panier en porte l'essentiel."
                actif={actif("assistant")}
                apres={3300}
                vitesse={14}
              />
            </p>
            <p className="scene-legende-barres">LCP p75 de /panier, 7 jours</p>
          </div>
        </Couche>

        {/* Les sept éléments qui traversent tous les écrans. */}
        {GEOMETRIE[vue].map((b, i) => (
          <div
            key={ROUTES[i]}
            className="scene-el"
            data-i={i}
            style={{ transform: `translate(${b.x}px, ${b.y}px)`, width: b.w, height: b.h, transitionDelay: `${i * 55}ms` }}
          >
            <div className="scene-el-pages">
              <span className="scene-route">{ROUTES[i]}</span>
              <span className="scene-lcp-barre">
                <i style={{ width: `${(LCP[i] / 4) * 100}%` }} data-verdict={LCP[i] > 2.5 ? "moyen" : "bon"} />
              </span>
              <span className="scene-lcp">{LCP[i].toFixed(1).replace(".", ",")} s</span>
              <span className="scene-pastille-inline" data-verdict={LCP[i] > 2.5 ? "moyen" : "bon"}>
                {LCP[i] > 2.5 ? "À améliorer" : "Bon"}
              </span>
            </div>
            <div className="scene-el-session" data-erreur={ETAPES_SESSION[i][1] === "Erreur"}>
              <span className="scene-heure">{ETAPES_SESSION[i][0]}</span>
              <b>{ETAPES_SESSION[i][1]}</b>
              <span>{ETAPES_SESSION[i][2]}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
