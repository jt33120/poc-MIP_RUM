"use client";

// Les deux sortes de nœuds de la cartographie : l'élément (une carte au code couleur
// de sa famille) et la zone (l'hébergeur ou le lieu qui les regroupe, dessinée
// derrière).
//
// ZOOM SÉMANTIQUE. Un nœud ne lit pas le zoom exact, qui change à chaque image d'un
// geste : il lit un NIVEAU (loin, moyen, près), et ne se redessine que quand le
// niveau change. De loin, le titre seul, en grand ; de plus près, le sous-titre, les
// pastilles et les listes (les tables d'un domaine, par exemple).
import { Handle, Position, useStore, type Node, type NodeProps, type ReactFlowState } from "@xyflow/react";
import { memo } from "react";
import { FAMILLES, STATUTS, type Element, type Zone } from "@/lib/cartographie/types";

export type Niveau = 0 | 1 | 2;

/** Au-delà, la liste ne tient pas sur la carte : elle reste dans la fiche. */
export const LISTE_SUR_CARTE = 16;

const niveauDe = (s: ReactFlowState): Niveau => {
  const zoom = s.transform[2];
  return zoom < 0.42 ? 0 : zoom < 0.95 ? 1 : 2;
};

export const useNiveau = () => useStore(niveauDe);

/** Mis en avant, estompé (hors de la sélection ou du parcours), ou au repos. */
export type Eclairage = "avant" | "estompe" | "repos";

export type NoeudElement = Node<{ element: Element; eclairage: Eclairage; choisi: boolean }, "element">;
export type NoeudZone = Node<{ zone: Zone; estompee: boolean }, "zone">;

const COTES = [
  ["haut", Position.Top],
  ["bas", Position.Bottom],
  ["gauche", Position.Left],
  ["droite", Position.Right],
] as const;

/** Une poignée d'entrée et une de sortie par côté : le lien choisit le côté qui fait face. */
function Poignees() {
  return (
    <>
      {COTES.map(([nom, position]) => (
        <Handle key={`s-${nom}`} id={`s-${nom}`} type="source" position={position} className="carte-poignee" isConnectable={false} />
      ))}
      {COTES.map(([nom, position]) => (
        <Handle key={`t-${nom}`} id={`t-${nom}`} type="target" position={position} className="carte-poignee" isConnectable={false} />
      ))}
    </>
  );
}

export const ElementCarte = memo(function ElementCarte({ data }: NodeProps<NoeudElement>) {
  const { element: e, eclairage, choisi } = data;
  const niveau = useNiveau();
  const famille = FAMILLES[e.famille];
  const statut = e.statut && e.statut !== "en-service" ? STATUTS[e.statut] : null;
  return (
    <div
      className="carte-element"
      data-testid={`carte-element-${e.id}`}
      data-eclairage={eclairage}
      data-choisi={choisi || undefined}
      data-statut={e.statut ?? "en-service"}
      style={{ "--famille": famille.couleur } as React.CSSProperties}
    >
      <Poignees />
      {niveau === 0 ? (
        <div className="carte-element-loin">
          <span>{e.titre}</span>
          {e.liste && <small>{e.liste.entrees.length}</small>}
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <p className="carte-element-famille">{famille.libelle}</p>
            {statut && <span className="carte-element-statut">{statut}</span>}
          </div>
          <p className="carte-element-titre">{e.titre}</p>
          <p className="carte-element-sous-titre">{e.sousTitre}</p>
          {e.liste && e.liste.entrees.length <= LISTE_SUR_CARTE ? (
            <ul className="carte-element-liste" aria-label={e.liste.titre}>
              {e.liste.entrees.map((x) => (
                <li key={x.nom} title={x.role}>
                  {x.nom}
                </li>
              ))}
            </ul>
          ) : (
            e.etiquettes && (
              <ul className="carte-element-etiquettes">
                {e.etiquettes.map((t) => (
                  <li key={t}>{t}</li>
                ))}
                {e.liste && (
                  <li>
                    {e.liste.entrees.length} {e.liste.titre.toLowerCase()} dans la fiche
                  </li>
                )}
              </ul>
            )
          )}
        </>
      )}
    </div>
  );
});

export const ZoneCarte = memo(function ZoneCarte({ data }: NodeProps<NoeudZone>) {
  const { zone, estompee } = data;
  const niveau = useNiveau();
  return (
    <div className="carte-zone" data-zone={zone.id} data-estompee={estompee || undefined} data-niveau={niveau}>
      <p className="carte-zone-titre">{zone.titre}</p>
      <p className="carte-zone-sous-titre">{zone.sousTitre}</p>
    </div>
  );
});
