"use client";

// La cartographie interactive du graphe technique : React Flow (@xyflow/react, MIT)
// pour le déplacement, le zoom, la mini-carte et le tracé des liens ; tout le reste
// — le contenu, le code couleur, les parcours — vient de lib/cartographie.
//
// Rien ne se déplace à la souris : c'est une carte qu'on lit, pas un éditeur. Un clic
// sur un élément ouvre son panneau (faits, sources, voisins) et estompe tout ce qui ne
// lui est pas relié ; un parcours guidé met en avant, étape par étape, le chemin d'une
// mesure, d'une alerte, d'une lecture ou d'un déploiement, et y cadre la vue.
//
// LA MOLETTE FAIT DÉFILER LA PAGE, pas zoomer la carte : sans cela, on resterait
// coincé dans la carte en descendant la page. On zoome au pincement, avec Ctrl (ou ⌘)
// et la molette, ou aux boutons ; en plein écran, la molette zoome.
import "@xyflow/react/dist/style.css";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type NodeMouseHandler,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CARTOGRAPHIE } from "@/lib/cartographie/donnees";
import {
  FAMILLES,
  HAUTEUR_ELEMENT,
  LARGEUR_ELEMENT,
  NATURES,
  ORDRE_FAMILLES,
  idLien,
  type Element,
  type Famille,
} from "@/lib/cartographie/types";
import { ElementCarte, ZoneCarte, useNiveau, type Eclairage, type NoeudElement, type NoeudZone } from "./noeuds";
import { PanneauElement } from "./PanneauElement";

const TYPES_NOEUDS = { element: ElementCarte, zone: ZoneCarte };

const PAR_ID = new Map(CARTOGRAPHIE.elements.map((e) => [e.id, e]));

const centre = (e: Element) => ({
  x: e.x + (e.largeur ?? LARGEUR_ELEMENT) / 2,
  y: e.y + (e.hauteur ?? HAUTEUR_ELEMENT) / 2,
});

/** Les côtés qui se font face : dessus-dessous si l'écart est surtout vertical. */
function cotes(de: Element, vers: Element): [string, string] {
  const a = centre(de);
  const b = centre(vers);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dy) > Math.abs(dx) * 0.6) return dy > 0 ? ["bas", "haut"] : ["haut", "bas"];
  return dx > 0 ? ["droite", "gauche"] : ["gauche", "droite"];
}

interface MiseEnAvant {
  elements: ReadonlySet<string>;
  liens: ReadonlySet<string>;
}

function autourDe(id: string): MiseEnAvant {
  const elements = new Set([id]);
  const liens = new Set<string>();
  for (const l of CARTOGRAPHIE.liens) {
    if (l.de === id || l.vers === id) {
      elements.add(l.de);
      elements.add(l.vers);
      liens.add(idLien(l));
    }
  }
  return { elements, liens };
}

function ensemble(ids: readonly string[]): MiseEnAvant {
  const elements = new Set(ids);
  const liens = new Set(CARTOGRAPHIE.liens.filter((l) => elements.has(l.de) && elements.has(l.vers)).map(idLien));
  return { elements, liens };
}

const sansAccents = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Les éléments qui répondent à une recherche : le titre d'abord, puis le reste de la fiche. */
export function chercher(requete: string): Element[] {
  const q = sansAccents(requete.trim());
  if (q.length < 2) return [];
  const rang = (e: Element) => {
    const titre = sansAccents(e.titre);
    if (titre.startsWith(q)) return 0;
    if (titre.includes(q)) return 1;
    if (sansAccents([e.sousTitre, ...(e.etiquettes ?? [])].join(" ")).includes(q)) return 2;
    if (e.liste?.entrees.some((x) => sansAccents(`${x.nom} ${x.role}`).includes(q))) return 3;
    if (sansAccents([e.resume, ...e.faits.map((f) => f.texte)].join(" ")).includes(q)) return 4;
    return -1;
  };
  return CARTOGRAPHIE.elements
    .map((e) => ({ e, r: rang(e) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r)
    .slice(0, 8)
    .map((x) => x.e);
}

export function Cartographie({ depot }: { depot: string }) {
  return (
    <ReactFlowProvider>
      <Carte depot={depot} />
    </ReactFlowProvider>
  );
}

function Carte({ depot }: { depot: string }) {
  const { fitView, setCenter, getZoom } = useReactFlow();
  // Les libellés des liens vivent dans le plan de la carte : de loin, ils grossissent
  // pour rester lisibles.
  const niveau = useNiveau();
  const taillelibelle = niveau === 0 ? 32 : niveau === 1 ? 16 : 12;
  const [choisi, setChoisi] = useState<string | null>(null);
  const [masquees, setMasquees] = useState<ReadonlySet<Famille>>(new Set());
  const [parcours, setParcours] = useState<{ id: string; etape: number } | null>(null);
  const [pleinEcran, setPleinEcran] = useState(false);
  const [requete, setRequete] = useState("");

  const parcoursCourant = parcours ? CARTOGRAPHIE.parcours.find((p) => p.id === parcours.id) ?? null : null;
  const etape = parcoursCourant && parcours ? parcoursCourant.etapes[parcours.etape] : null;

  const avant = useMemo<MiseEnAvant | null>(() => {
    if (etape) return ensemble(etape.elements);
    if (choisi) return autourDe(choisi);
    return null;
  }, [etape, choisi]);

  const voler = useCallback(
    (ids: readonly string[], zoomMax = 1.15) =>
      // Laisse React poser l'état (le panneau, l'éclairage) avant de cadrer.
      window.requestAnimationFrame(() =>
        fitView({ nodes: ids.map((id) => ({ id })), duration: 750, padding: 0.35, maxZoom: zoomMax }),
      ),
    [fitView],
  );

  /**
   * Centre la vue sur un élément, décalé vers la gauche pour que sa fiche, ouverte à
   * droite, ne le cache pas (sur un écran étroit, la fiche est en bas : pas de décalage).
   */
  const cadrerSur = useCallback(
    (id: string, zoom: number) => {
      const e = PAR_ID.get(id);
      if (!e) return;
      const { x, y } = centre(e);
      const decalage = window.innerWidth > 640 ? 190 / zoom : 0;
      window.requestAnimationFrame(() => setCenter(x + decalage, y, { zoom, duration: 750 }));
    },
    [setCenter],
  );

  const choisir = useCallback(
    (id: string) => {
      setParcours(null);
      setChoisi(id);
      setRequete("");
      cadrerSur(id, Math.max(getZoom(), 0.95));
    },
    [cadrerSur, getZoom],
  );

  useEffect(() => {
    if (etape) voler(etape.elements, 1);
  }, [etape, voler]);

  useEffect(() => {
    const touche = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        if (parcours) setParcours(null);
        else if (choisi) setChoisi(null);
        else setPleinEcran(false);
      }
    };
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, [parcours, choisi]);

  useEffect(() => {
    if (!pleinEcran) return;
    const avant = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = avant;
    };
  }, [pleinEcran]);

  const noeuds = useMemo(() => {
    const zones: NoeudZone[] = CARTOGRAPHIE.zones.map((z) => ({
      id: `zone:${z.id}`,
      type: "zone",
      position: { x: z.x, y: z.y },
      data: { zone: z, estompee: avant !== null },
      width: z.largeur,
      height: z.hauteur,
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: -1,
    }));
    const elements: NoeudElement[] = CARTOGRAPHIE.elements.map((e) => {
      const eclairage: Eclairage = !avant ? "repos" : avant.elements.has(e.id) ? "avant" : "estompe";
      return {
        id: e.id,
        type: "element",
        position: { x: e.x, y: e.y },
        data: { element: e, eclairage, choisi: e.id === choisi },
        width: e.largeur ?? LARGEUR_ELEMENT,
        height: e.hauteur ?? HAUTEUR_ELEMENT,
        hidden: masquees.has(e.famille),
        draggable: false,
        connectable: false,
        ariaLabel: `${FAMILLES[e.famille].libelle} : ${e.titre}`,
      };
    });
    return [...zones, ...elements];
  }, [avant, choisi, masquees]);

  const aretes = useMemo<Edge[]>(
    () =>
      CARTOGRAPHIE.liens.map((l) => {
        const nature = NATURES[l.nature];
        const id = idLien(l);
        const de = PAR_ID.get(l.de)!;
        const vers = PAR_ID.get(l.vers)!;
        const [s, t] = cotes(de, vers);
        const enAvant = avant?.liens.has(id) ?? false;
        const estompe = avant !== null && !enAvant;
        return {
          id,
          source: l.de,
          target: l.vers,
          sourceHandle: `s-${s}`,
          targetHandle: `t-${t}`,
          type: "smoothstep",
          pathOptions: { borderRadius: 18 },
          animated: nature.flux && !estompe,
          hidden: masquees.has(de.famille) || masquees.has(vers.famille),
          selectable: false,
          focusable: false,
          zIndex: enAvant ? 5 : 0,
          // React Flow ne remesure le fond d'un libellé que si son TEXTE change : une
          // espace sans chasse par niveau de zoom le force à suivre la taille de police.
          label: enAvant ? `${l.libelle ?? nature.libelle}${"\u200b".repeat(niveau)}` : undefined,
          labelStyle: { fill: "#e2e8f0", fontSize: taillelibelle, fontWeight: 600 },
          labelBgStyle: { fill: "#07122e", stroke: nature.couleur, strokeWidth: 1 },
          labelBgPadding: [7, 4] as [number, number],
          labelBgBorderRadius: 7,
          style: {
            stroke: nature.couleur,
            strokeWidth: enAvant ? 2.6 : 1.5,
            strokeDasharray: nature.flux ? undefined : nature.pointille,
            opacity: estompe ? 0.07 : enAvant ? 1 : 0.5,
          },
          markerEnd: { type: MarkerType.ArrowClosed, color: nature.couleur, width: 14, height: 14 },
        };
      }),
    [avant, masquees, niveau, taillelibelle],
  );

  // De loin, un clic rapproche aussi la vue : sans cela, la fiche s'ouvre sur une
  // carte illisible. De près, la vue ne bouge pas sous la souris.
  const auClic = useCallback<NodeMouseHandler>(
    (_, n) => {
      if (n.type !== "element") return;
      setParcours(null);
      const deja = choisi === n.id;
      setChoisi(deja ? null : n.id);
      if (!deja && getZoom() < 0.55) cadrerSur(n.id, 0.8);
    },
    [choisi, cadrerSur, getZoom],
  );

  const basculerFamille = (f: Famille) =>
    setMasquees((m) => {
      const n = new Set(m);
      if (n.has(f)) n.delete(f);
      else n.add(f);
      return n;
    });

  const resultats = useMemo(() => chercher(requete), [requete]);
  const element = choisi ? PAR_ID.get(choisi) ?? null : null;

  return (
    <div className={pleinEcran ? "carte-cadre carte-cadre-plein" : "carte-cadre"} data-testid="cartographie" data-plein-ecran={pleinEcran || undefined}>
      {/* La barre : chercher, suivre un parcours, filtrer par famille. */}
      <div className="carte-barre">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <label htmlFor="carte-recherche" className="sr-only">
            Chercher un élément, une table, un outil
          </label>
          <input
            id="carte-recherche"
            data-testid="carte-recherche"
            type="search"
            value={requete}
            onChange={(ev) => setRequete(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" && resultats[0]) choisir(resultats[0].id);
            }}
            placeholder="Chercher : collector, rum_span, CSP…"
            autoComplete="off"
            className="carte-recherche"
          />
          {resultats.length > 0 && (
            <ul className="carte-resultats" data-testid="carte-resultats">
              {resultats.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => choisir(r.id)}>
                    <span className="carte-pastille" style={{ background: FAMILLES[r.famille].couleur }} aria-hidden />
                    <span className="truncate">{r.titre}</span>
                    <small>{FAMILLES[r.famille].libelle}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="carte-parcours" role="group" aria-label="Parcours guidés">
          <span className="carte-parcours-libelle">Suivre</span>
          {CARTOGRAPHIE.parcours.map((p) => (
            <button
              key={p.id}
              type="button"
              data-testid={`carte-parcours-${p.id}`}
              aria-pressed={parcours?.id === p.id}
              title={p.resume}
              onClick={() => {
                setChoisi(null);
                setParcours(parcours?.id === p.id ? null : { id: p.id, etape: 0 });
              }}
            >
              {p.titre}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button type="button" className="carte-bouton" onClick={() => fitView({ duration: 600, padding: 0.06 })}>
            Tout voir
          </button>
          <button
            type="button"
            className="carte-bouton"
            data-testid="carte-plein-ecran"
            aria-pressed={pleinEcran}
            onClick={() => setPleinEcran((p) => !p)}
          >
            {pleinEcran ? "Quitter le plein écran" : "Plein écran"}
          </button>
        </div>
      </div>

      <ul className="carte-legende" aria-label="Code couleur : cliquer pour masquer une famille">
        {ORDRE_FAMILLES.map((f) => (
          <li key={f}>
            <button
              type="button"
              data-testid={`carte-famille-${f}`}
              aria-pressed={!masquees.has(f)}
              onClick={() => basculerFamille(f)}
              title={FAMILLES[f].explication}
            >
              <span className="carte-pastille" style={{ background: FAMILLES[f].couleur }} aria-hidden />
              {FAMILLES[f].libelle}
            </button>
          </li>
        ))}
      </ul>

      <div className="carte-toile">
        <ReactFlow
          nodes={noeuds}
          edges={aretes}
          nodeTypes={TYPES_NOEUDS}
          onNodeClick={auClic}
          onPaneClick={() => setChoisi(null)}
          colorMode="dark"
          fitView
          fitViewOptions={{ padding: 0.06 }}
          minZoom={0.08}
          maxZoom={2.2}
          nodesDraggable={false}
          nodesConnectable={false}
          // Quatre-vingts arrêts de tabulation de plus sur la page : au clavier, la
          // recherche mène à un élément (taper, Entrée), et la version texte dit tout.
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          zoomOnScroll={pleinEcran}
          preventScrolling={pleinEcran}
          zoomOnDoubleClick
          attributionPosition="bottom-left"
        >
          <Background variant={BackgroundVariant.Dots} gap={28} size={1.2} color="#1c2a52" />
          <Controls showInteractive={false} position="bottom-left" className="carte-controles" />
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            className="carte-mini"
            maskColor="rgba(4, 10, 28, 0.72)"
            bgColor="#07122e"
            nodeColor={(n) => (n.type === "element" ? FAMILLES[(n as NoeudElement).data.element.famille].couleur : "rgba(255,255,255,0.04)")}
            nodeStrokeWidth={0}
            nodeBorderRadius={8}
          />
        </ReactFlow>

        {!element && !etape && (
          <p className="carte-aide" aria-hidden>
            Glisser pour explorer · pincer, Ctrl + molette ou boutons pour zoomer · cliquer un élément
          </p>
        )}

        {etape && parcoursCourant && parcours && (
          <div className="carte-etape" data-testid="carte-etape" aria-live="polite">
            <p className="carte-etape-compteur">
              {parcoursCourant.titre} · étape {parcours.etape + 1} sur {parcoursCourant.etapes.length}
            </p>
            <p className="carte-etape-titre">{etape.titre}</p>
            <p className="carte-etape-texte">{etape.texte}</p>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                className="carte-bouton"
                disabled={parcours.etape === 0}
                onClick={() => setParcours({ id: parcours.id, etape: parcours.etape - 1 })}
              >
                Précédente
              </button>
              {parcours.etape < parcoursCourant.etapes.length - 1 ? (
                <button
                  type="button"
                  className="carte-bouton carte-bouton-plein"
                  data-testid="carte-etape-suivante"
                  onClick={() => setParcours({ id: parcours.id, etape: parcours.etape + 1 })}
                >
                  Suivante
                </button>
              ) : (
                <button type="button" className="carte-bouton carte-bouton-plein" onClick={() => setParcours(null)}>
                  Terminer
                </button>
              )}
              <button type="button" className="carte-bouton ml-auto" onClick={() => setParcours(null)}>
                Quitter
              </button>
            </div>
          </div>
        )}

        {element && (
          <PanneauElement element={element} depot={depot} onChoisir={(id) => choisir(id)} onFermer={() => setChoisi(null)} />
        )}
      </div>
    </div>
  );
}
