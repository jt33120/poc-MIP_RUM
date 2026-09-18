"use client";
// Formulaires du workflow d'une issue (P5.6) : triage, commentaire, lien de ticket.
// Chacun poste vers son endpoint v1 avec la révision lue par la page.
//
// APRÈS UNE ÉCRITURE, LA PAGE EST RECHARGÉE. Un `router.refresh()` relirait l'issue
// (le blocage de navigation client de P5 est levé en P6.2) mais garderait l'état
// local des formulaires : statut et assigné initialisés depuis l'ancienne lecture,
// saisie en cours. Le rechargement complet remet chaque champ sur l'issue relue,
// son historique et sa révision, sans état client périmé.
//
// 409 : l'issue a changé depuis sa lecture. On le dit et on propose de recharger.
// Ce que l'utilisateur avait saisi — et seulement cela — traverse le rechargement
// (sessionStorage, lu une fois) : un champ de triage qu'il n'a pas touché suit
// l'issue relue, il n'écrase jamais la décision d'un autre.
//
// Avant l'hydratation, les champs sont désactivés : une saisie faite avant que
// React ne prenne la main ne serait ni contrôlée ni envoyée. Rendus pour un admin
// seulement (la page décide) ; l'API refuse de toute façon viewer, démo et jeton.
import { useEffect, useState } from "react";
import { INPUT_CLASS } from "@/components/forms/Field";

type Etat =
  | { kind: "repos" }
  | { kind: "envoi" }
  | { kind: "rechargement" }
  | { kind: "conflit"; message: string }
  | { kind: "erreur"; message: string };

const CHAMP = "flex min-w-0 max-w-full flex-col gap-1 text-xs font-medium text-ink-soft";

/** Vrai une fois le composant monté côté client. */
function useHydrate(): boolean {
  const [pret, setPret] = useState(false);
  useEffect(() => setPret(true), []);
  return pret;
}

/**
 * Saisie gardée le temps d'un rechargement proposé après un 409, puis rendue une
 * seule fois. Stockage indisponible (navigation privée, quota) : la saisie est
 * perdue, jamais l'écriture ni l'écran.
 */
function useBrouillon<T>(issueId: string, formulaire: string): [T | null, (brouillon: T) => void] {
  const cle = `mip-rum:issue-brouillon:${issueId}:${formulaire}`;
  const [repris, setRepris] = useState<T | null>(null);
  useEffect(() => {
    try {
      const brut = window.sessionStorage.getItem(cle);
      window.sessionStorage.removeItem(cle);
      if (brut) setRepris(JSON.parse(brut) as T);
    } catch {
      /* rien à reprendre */
    }
  }, [cle]);
  function garderPuisRecharger(brouillon: T) {
    try {
      window.sessionStorage.setItem(cle, JSON.stringify(brouillon));
    } catch {
      /* la saisie ne traversera pas le rechargement */
    }
    window.location.reload();
  }
  return [repris, garderPuisRecharger];
}

function useMutation(issueId: string, action: "triage" | "comments" | "links") {
  const [etat, setEtat] = useState<Etat>({ kind: "repos" });

  async function envoyer(corps: Record<string, unknown>): Promise<void> {
    setEtat({ kind: "envoi" });
    try {
      const res = await fetch(`/api/v1/issues/${encodeURIComponent(issueId)}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(corps),
      });
      const reponse = (await res.json().catch(() => null)) as { error?: string } | null;
      if (res.status === 409) {
        setEtat({ kind: "conflit", message: reponse?.error ?? "L'issue a été modifiée entre-temps." });
      } else if (!res.ok) {
        setEtat({ kind: "erreur", message: reponse?.error ?? `Échec de l'enregistrement (HTTP ${res.status})` });
      } else {
        setEtat({ kind: "rechargement" });
        window.location.reload();
      }
    } catch {
      setEtat({ kind: "erreur", message: "Réseau indisponible : réessayer." });
    }
  }

  return { etat, envoyer, occupe: etat.kind === "envoi" || etat.kind === "rechargement" };
}

function Retour({ etat, recharger, testid }: { etat: Etat; recharger: () => void; testid: string }) {
  if (etat.kind === "conflit") {
    return (
      <div role="alert" data-testid={`${testid}-conflict`} className="mt-3 flex flex-wrap items-center gap-2 text-sm text-bad">
        <span>{etat.message}</span>
        <button type="button" className="btn-ghost border border-line px-2 py-1 text-xs" onClick={recharger}>
          Recharger l&apos;issue
        </button>
      </div>
    );
  }
  if (etat.kind === "erreur") {
    return (
      <p role="alert" className="mt-3 text-sm text-bad">
        {etat.message}
      </p>
    );
  }
  if (etat.kind === "rechargement") {
    return (
      <p role="status" className="mt-3 text-sm text-ink-soft">
        Enregistré — relecture de l&apos;issue…
      </p>
    );
  }
  return null;
}

export interface Choix {
  value: string;
  label: string;
}

/**
 * Statut et assigné : seuls les champs modifiés partent ; l'assignation ne change
 * jamais le statut. Un champ non modifié vaut `null` et suit l'issue lue ; après un
 * 409 et le rechargement, seuls les champs modifiés sont reproposés.
 */
export function IssueTriageForm({
  issueId,
  appId,
  revision,
  status,
  assigneeUserId,
  statuts,
  comptes,
}: {
  issueId: string;
  appId: string;
  revision: string;
  status: string;
  assigneeUserId: string | null;
  statuts: Choix[];
  comptes: Choix[];
}) {
  const pret = useHydrate();
  const { etat, envoyer, occupe } = useMutation(issueId, "triage");
  const [statut, setStatut] = useState<string | null>(null);
  const [assigne, setAssigne] = useState<string | null>(null);
  const assigneLu = assigneeUserId ?? "";
  const [repris, garder] = useBrouillon<{ status: string | null; assignee: string | null }>(issueId, "triage");
  useEffect(() => {
    if (!repris) return;
    setStatut(repris.status);
    setAssigne(repris.assignee);
  }, [repris]);

  const changements: Record<string, unknown> = {};
  if (statut !== null && statut !== status) changements.status = statut;
  if (assigne !== null && assigne !== assigneLu) changements.assigneeUserId = assigne || null;
  const inchange = Object.keys(changements).length === 0;
  const inactif = !pret || occupe;

  async function soumettre(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!inchange) await envoyer({ app: appId, expectedRevision: revision, ...changements });
  }

  return (
    <form onSubmit={soumettre} aria-label="Triage de l'issue" data-testid="issue-triage-form" data-revision={revision}>
      <div className="flex flex-wrap items-end gap-3">
        <label className={CHAMP}>
          Statut
          <select
            name="status"
            value={statut ?? status}
            onChange={(e) => setStatut(e.target.value === status ? null : e.target.value)}
            disabled={inactif}
            className={`${INPUT_CLASS} max-w-full`}
            data-testid="issue-triage-status"
          >
            {statuts.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className={CHAMP}>
          Assignée à
          <select
            name="assignee"
            value={assigne ?? assigneLu}
            onChange={(e) => setAssigne(e.target.value === assigneLu ? null : e.target.value)}
            disabled={inactif}
            className={`${INPUT_CLASS} w-64 max-w-full`}
            data-testid="issue-triage-assignee"
          >
            <option value="">Personne</option>
            {comptes.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn-accent" disabled={inactif || inchange} data-testid="issue-triage-submit">
          {occupe ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
      <Retour etat={etat} recharger={() => garder({ status: statut, assignee: assigne })} testid="issue-triage" />
    </form>
  );
}

/** Commentaire : masqué côté serveur (e-mails, secrets), 2 000 caractères une fois masqué. */
export function IssueCommentForm({ issueId, appId, revision }: { issueId: string; appId: string; revision: string }) {
  const pret = useHydrate();
  const { etat, envoyer, occupe } = useMutation(issueId, "comments");
  const [texte, setTexte] = useState("");
  const [repris, garder] = useBrouillon<{ body: string }>(issueId, "commentaire");
  useEffect(() => {
    if (repris) setTexte(repris.body);
  }, [repris]);
  const inactif = !pret || occupe;

  async function soumettre(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await envoyer({ app: appId, body: texte, expectedRevision: revision });
  }

  return (
    <form onSubmit={soumettre} aria-label="Commenter l'issue" data-testid="issue-comment-form">
      <label className={`${CHAMP} w-full`}>
        Commentaire
        <textarea
          name="body"
          required
          maxLength={2000}
          rows={3}
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          disabled={inactif}
          className={`${INPUT_CLASS} w-full`}
          data-testid="issue-comment-body"
        />
      </label>
      <p className="mt-1 text-xs text-ink-faint">
        Les adresses e-mail, jetons et longues suites de chiffres sont masqués à l&apos;enregistrement. Rien n&apos;est
        envoyé à un outil de tickets.
      </p>
      <button type="submit" className="btn-accent mt-2" disabled={inactif} data-testid="issue-comment-submit">
        {occupe ? "Envoi…" : "Commenter"}
      </button>
      <Retour etat={etat} recharger={() => garder({ body: texte })} testid="issue-comment" />
    </form>
  );
}

/** Lien de ticket manuel : HTTPS seulement, libellé court. */
export function IssueLinkForm({ issueId, appId, revision }: { issueId: string; appId: string; revision: string }) {
  const pret = useHydrate();
  const { etat, envoyer, occupe } = useMutation(issueId, "links");
  const [url, setUrl] = useState("");
  const [libelle, setLibelle] = useState("");
  const [repris, garder] = useBrouillon<{ url: string; label: string }>(issueId, "lien");
  useEffect(() => {
    if (!repris) return;
    setUrl(repris.url);
    setLibelle(repris.label);
  }, [repris]);
  const inactif = !pret || occupe;

  async function soumettre(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await envoyer({ app: appId, url, label: libelle, expectedRevision: revision });
  }

  return (
    <form onSubmit={soumettre} aria-label="Lier un ticket" data-testid="issue-link-form">
      <div className="flex flex-wrap items-end gap-3">
        <label className={CHAMP}>
          URL du ticket
          <input
            name="url"
            type="url"
            required
            maxLength={2048}
            pattern="https://.+"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={inactif}
            className={`${INPUT_CLASS} w-72 max-w-full`}
            data-testid="issue-link-url"
          />
        </label>
        <label className={CHAMP}>
          Libellé
          <input
            name="label"
            required
            maxLength={120}
            placeholder="PROJ-123"
            value={libelle}
            onChange={(e) => setLibelle(e.target.value)}
            disabled={inactif}
            className={`${INPUT_CLASS} w-40 max-w-full`}
            data-testid="issue-link-label"
          />
        </label>
        <button type="submit" className="btn-ghost border border-line" disabled={inactif}>
          {occupe ? "Ajout…" : "Lier"}
        </button>
      </div>
      <Retour etat={etat} recharger={() => garder({ url, label: libelle })} testid="issue-link" />
    </form>
  );
}
