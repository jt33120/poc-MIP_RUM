"use client";
// CONFIRMER SUR PLACE UN GESTE QUI NE SE DÉFAIT PAS (recette du 26/09/2026,
// revues E et F : « actions destructrices sans garde-fou »).
//
// Désactiver une application, régénérer sa clé, réinitialiser un mot de passe,
// désactiver un compte, retirer une carte, supprimer un objectif : ces gestes
// partaient en UN clic, d'un bouton aussi neutre que « Guide » ou « Monter », posé
// juste à côté. Un clic de trop coupait la collecte d'un client ou fermait les
// sessions d'un collègue, sans retour possible.
//
// DANS LA PAGE, PAS `window.confirm()`. La boîte du navigateur est modale, hors du
// thème, titrée selon le navigateur, et un test doit l'« accepter » à l'aveugle.
// L'encadré en ligne NOMME la cible et dit la conséquence, à l'endroit du geste,
// dans la langue et les couleurs de la console.
//
// DEUX USAGES, UN SEUL COMPOSANT.
//   · Posé dans un `<form action={…}>` (server action) : la confirmation est un
//     `submit`, elle envoie le formulaire PARENT, champs cachés compris — la page,
//     le formulaire et l'action ne changent pas. L'encadré se referme quand l'envoi
//     est fini (`useFormStatus`), pas au clic : retirer le bouton du document avant
//     que le navigateur n'ait traité le clic annulerait l'envoi.
//   · Avec `onConfirmer` (gestionnaire client) : la confirmation appelle la
//     fonction, attend sa promesse, puis referme.
//
// ACCESSIBILITÉ. Le déclencheur porte `aria-expanded` et `aria-controls`. À
// l'ouverture, le focus va sur l'encadré (`role="group"`, nommé par sa question,
// décrit par sa conséquence) : un lecteur d'écran lit la cible et la conséquence
// avant les boutons. Échap ou « Annuler » referment et rendent le focus au
// déclencheur. Pas d'`alertdialog` : l'encadré n'est pas modal, le reste de la
// page reste utilisable, et un rôle de dialogue sans piège à focus mentirait.
//
// UN GESTE INTERDIT RESTE VISIBLE ET DIT POURQUOI (`desactive`, `raisonDesactive`) :
// cacher « Désactiver » sur sa propre ligne laisserait croire à un oubli. Le bouton
// est grisé mais focalisable (`aria-disabled`, pas `disabled`), la raison est au
// survol (`title`), lue par le lecteur d'écran (`aria-describedby`) et affichée au
// toucher, où aucune infobulle n'existe.
//
// RENDU SERVEUR. Fermé au premier rendu, identifiants tirés de `useId` : le HTML du
// serveur et celui de l'hydratation sont identiques.
import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from "react";
import { useFormStatus } from "react-dom";

/** Style « danger » du déclencheur : un contour, pas un aplat — le geste n'est pas encore fait. */
export const CLASSE_DECLENCHEUR_DANGER =
  "rounded-lg border border-bad/40 bg-panel px-2 py-1 text-xs font-medium text-bad-ink transition hover:bg-bad/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bad/40";

/**
 * Le nom d'une cible entre guillemets français, espaces insécables comprises : la
 * question se lit « Supprimer l'objectif « Inscription » ? » sans que le
 * navigateur ne coupe la ligne entre le guillemet et le nom.
 */
export const entreGuillemets = (nom: string) => `«\u00a0${nom}\u00a0»`;

const CLASSE_CONFIRMER =
  "rounded-lg bg-bad-fond px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-bad-fond/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bad/40 focus-visible:ring-offset-1 disabled:cursor-wait disabled:opacity-70";

export interface ConfirmationDangerProps {
  /** Libellé visible du déclencheur (« Désactiver », « ✕ »). */
  libelle: ReactNode;
  /** Nom accessible du déclencheur quand le libellé ne nomme pas la cible (un « ✕ »). */
  libelleAccessible?: string;
  /** La question, qui NOMME la cible : « Désactiver l'application « Mini-site de démo » ? » */
  question: string;
  /** La conséquence, en une phrase. */
  consequence: string;
  /** Libellé du bouton qui exécute (« Désactiver l'application »). */
  confirmer: string;
  /** Libellé du bouton pendant l'envoi. */
  enCours?: string;
  /** Gestionnaire client ; sans lui, la confirmation soumet le formulaire parent. */
  onConfirmer?: () => unknown;
  /** Geste interdit ici : le déclencheur est grisé et n'ouvre rien. */
  desactive?: boolean;
  /** Pourquoi le geste est interdit (infobulle, lecteur d'écran, toucher). */
  raisonDesactive?: string;
  /**
   * L'encadré se pose SOUS le déclencheur, par-dessus le contenu, au lieu de pousser
   * ce qui suit : pour un en-tête serré (les flèches et le « ✕ » d'une carte).
   */
  flottant?: boolean;
  /** Classes du déclencheur, à la place du style « danger » par défaut. */
  classeDeclencheur?: string;
  /** `data-testid` du déclencheur ; la confirmation porte `<testid>-confirmer`. */
  testid?: string;
}

export function ConfirmationDanger({
  libelle,
  libelleAccessible,
  question,
  consequence,
  confirmer,
  enCours = "En cours…",
  onConfirmer,
  desactive = false,
  raisonDesactive,
  flottant = false,
  classeDeclencheur = CLASSE_DECLENCHEUR_DANGER,
  testid,
}: ConfirmationDangerProps) {
  const base = useId();
  const ids = { encadre: `${base}-encadre`, question: `${base}-question`, consequence: `${base}-consequence`, raison: `${base}-raison` };
  const [ouvert, setOuvert] = useState(false);
  const [raisonVisible, setRaisonVisible] = useState(false);
  const [envoiClient, setEnvoiClient] = useState(false);
  const { pending } = useFormStatus();
  const envoi = onConfirmer ? envoiClient : pending;
  const declencheur = useRef<HTMLButtonElement>(null);
  const encadre = useRef<HTMLDivElement>(null);

  const fermer = () => {
    setOuvert(false);
    declencheur.current?.focus();
  };

  // Le focus suit l'ouverture : sans lui, un utilisateur au clavier ou au lecteur
  // d'écran ne saurait pas qu'une question vient d'apparaître.
  useEffect(() => {
    if (ouvert) encadre.current?.focus();
  }, [ouvert]);

  // Envoi du formulaire parent terminé : l'encadré se referme (la page a été relue).
  // Le focus revient au déclencheur s'il était dans l'encadré (ou perdu avec le
  // bouton qu'on vient de griser) — jamais volé à un champ où l'on tape déjà.
  const etaitEnvoi = useRef(false);
  useEffect(() => {
    if (etaitEnvoi.current && !pending) {
      const actif = document.activeElement;
      const focusDedans = !actif || actif === document.body || !!encadre.current?.contains(actif);
      setOuvert(false);
      if (focusDedans) declencheur.current?.focus();
    }
    etaitEnvoi.current = pending;
  }, [pending]);

  async function confirmerClient() {
    if (!onConfirmer) return;
    setEnvoiClient(true);
    try {
      await onConfirmer();
    } finally {
      setEnvoiClient(false);
      fermer();
    }
  }

  if (desactive) {
    return (
      <span className="inline-flex flex-col items-start gap-1">
        <button
          type="button"
          aria-disabled="true"
          aria-label={libelleAccessible}
          aria-describedby={raisonDesactive ? ids.raison : undefined}
          title={raisonDesactive}
          onClick={() => setRaisonVisible((v) => !v)}
          data-testid={testid}
          className={`${classeDeclencheur} cursor-not-allowed opacity-50`}
        >
          {libelle}
        </button>
        {raisonDesactive && (
          <span id={ids.raison} className={raisonVisible ? "max-w-[14rem] text-[11px] leading-snug text-ink-soft" : "sr-only"}>
            {raisonDesactive}
          </span>
        )}
      </span>
    );
  }

  return (
    <div
      className={flottant ? "relative inline-block" : "inline-flex flex-col items-start"}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !ouvert) return;
        e.preventDefault();
        e.stopPropagation();
        fermer();
      }}
    >
      <button
        ref={declencheur}
        type="button"
        aria-expanded={ouvert}
        aria-controls={ids.encadre}
        aria-label={libelleAccessible}
        onClick={() => setOuvert((o) => !o)}
        data-testid={testid}
        className={`${classeDeclencheur}${ouvert ? " bg-bad/10" : ""}`}
      >
        {libelle}
      </button>
      <EncadreConfirmation
        ref={encadre}
        id={ids.encadre}
        idQuestion={ids.question}
        idConsequence={ids.consequence}
        ouvert={ouvert}
        flottant={flottant}
        question={question}
        consequence={consequence}
        confirmer={confirmer}
        enCours={enCours}
        envoi={envoi}
        soumettre={!onConfirmer}
        onConfirmer={confirmerClient}
        onAnnuler={fermer}
        testid={testid}
      />
    </div>
  );
}

/**
 * L'encadré lui-même, sans état : rendu seul par les tests (sans navigateur, on ne
 * peut pas cliquer le déclencheur), et par `ConfirmationDanger`.
 *
 * Fermé, il reste dans le document (vide et masqué) : `aria-controls` du
 * déclencheur désigne un élément qui existe. Ses boutons n'y sont rendus qu'ouvert —
 * un `submit` masqué resterait le bouton par défaut du formulaire.
 */
export function EncadreConfirmation({
  ref,
  id,
  idQuestion,
  idConsequence,
  ouvert,
  flottant,
  question,
  consequence,
  confirmer,
  enCours,
  envoi,
  soumettre,
  onConfirmer,
  onAnnuler,
  testid,
}: {
  ref?: Ref<HTMLDivElement>;
  id: string;
  idQuestion: string;
  idConsequence: string;
  ouvert: boolean;
  flottant: boolean;
  question: string;
  consequence: string;
  confirmer: string;
  enCours: string;
  envoi: boolean;
  /** Vrai : la confirmation soumet le formulaire parent ; faux : elle appelle `onConfirmer`. */
  soumettre: boolean;
  onConfirmer?: () => void;
  onAnnuler?: () => void;
  testid?: string;
}) {
  if (!ouvert) return <div id={id} ref={ref} className="hidden" />;
  const place = flottant
    ? "absolute right-0 top-full z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] shadow-pop"
    : "mt-2 w-64 max-w-full shadow-card";
  return (
    <div
      id={id}
      ref={ref}
      role="group"
      aria-labelledby={idQuestion}
      aria-describedby={idConsequence}
      tabIndex={-1}
      data-testid={testid ? `${testid}-encadre` : undefined}
      className={`${place} whitespace-normal break-words rounded-lg border border-bad/40 bg-panel p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-ink-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-bad/40`}
    >
      <p id={idQuestion} className="font-semibold text-ink">
        {question}
      </p>
      <p id={idConsequence} className="mt-1">
        {consequence}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type={soumettre ? "submit" : "button"}
          onClick={soumettre ? undefined : onConfirmer}
          disabled={envoi}
          data-testid={testid ? `${testid}-confirmer` : undefined}
          className={CLASSE_CONFIRMER}
        >
          {envoi ? enCours : confirmer}
        </button>
        <button type="button" onClick={onAnnuler} disabled={envoi} className="btn-ghost disabled:opacity-50">
          Annuler
        </button>
      </div>
    </div>
  );
}
