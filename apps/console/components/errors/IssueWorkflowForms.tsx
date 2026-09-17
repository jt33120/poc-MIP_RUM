"use client";
// Formulaires du workflow d'une issue (P5.6) : triage, commentaire, lien de ticket.
// Chacun poste vers son endpoint v1 avec la révision lue par la page. Sur 409,
// l'issue a changé entre-temps : on le dit et on propose de recharger, la saisie
// en cours reste dans le formulaire. Rendus seulement pour un admin (la page
// décide) ; l'API refuse de toute façon viewer, démo et jeton.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { INPUT_CLASS } from "@/components/forms/Field";

type Etat =
  | { kind: "repos" }
  | { kind: "envoi" }
  | { kind: "succes"; message: string }
  | { kind: "conflit"; message: string }
  | { kind: "erreur"; message: string };

const CHAMP = "flex min-w-0 max-w-full flex-col gap-1 text-xs font-medium text-ink-soft";

function useMutation(issueId: string, action: "triage" | "comments" | "links") {
  const router = useRouter();
  const [etat, setEtat] = useState<Etat>({ kind: "repos" });

  async function envoyer(corps: Record<string, unknown>, succes: string): Promise<boolean> {
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
        return false;
      }
      if (!res.ok) {
        setEtat({ kind: "erreur", message: reponse?.error ?? `Échec de l'enregistrement (HTTP ${res.status})` });
        return false;
      }
      setEtat({ kind: "succes", message: succes });
      router.refresh();
      return true;
    } catch {
      setEtat({ kind: "erreur", message: "Réseau indisponible : réessayer." });
      return false;
    }
  }

  function recharger() {
    setEtat({ kind: "repos" });
    router.refresh();
  }

  return { etat, envoyer, recharger };
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
  if (etat.kind === "succes") {
    return (
      <p role="status" className="mt-3 text-sm text-ink-soft">
        {etat.message}
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
 * jamais le statut. La sélection survit à un rechargement après conflit : elle se
 * renvoie alors avec la révision relue.
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
  const { etat, envoyer, recharger } = useMutation(issueId, "triage");
  const [statut, setStatut] = useState(status);
  const [assigne, setAssigne] = useState(assigneeUserId ?? "");
  const inchange = statut === status && assigne === (assigneeUserId ?? "");

  async function soumettre(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const corps: Record<string, unknown> = { app: appId, expectedRevision: revision };
    if (statut !== status) corps.status = statut;
    if (assigne !== (assigneeUserId ?? "")) corps.assigneeUserId = assigne || null;
    await envoyer(corps, "Triage enregistré.");
  }

  return (
    <form onSubmit={soumettre} aria-label="Triage de l'issue" data-testid="issue-triage-form" data-revision={revision}>
      <div className="flex flex-wrap items-end gap-3">
        <label className={CHAMP}>
          Statut
          <select
            name="status"
            value={statut}
            onChange={(e) => setStatut(e.target.value)}
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
            value={assigne}
            onChange={(e) => setAssigne(e.target.value)}
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
        <button
          type="submit"
          className="btn-accent"
          disabled={etat.kind === "envoi" || inchange}
          data-testid="issue-triage-submit"
        >
          {etat.kind === "envoi" ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
      <Retour etat={etat} recharger={recharger} testid="issue-triage" />
    </form>
  );
}

/** Commentaire : masqué côté serveur (e-mails, secrets), 2 000 caractères une fois masqué. */
export function IssueCommentForm({ issueId, appId, revision }: { issueId: string; appId: string; revision: string }) {
  const { etat, envoyer, recharger } = useMutation(issueId, "comments");
  const [texte, setTexte] = useState("");

  async function soumettre(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await envoyer({ app: appId, body: texte, expectedRevision: revision }, "Commentaire ajouté.")) setTexte("");
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
          className={`${INPUT_CLASS} w-full`}
          data-testid="issue-comment-body"
        />
      </label>
      <p className="mt-1 text-xs text-ink-faint">
        Les adresses e-mail, jetons et longues suites de chiffres sont masqués à l&apos;enregistrement. Rien n&apos;est
        envoyé à un outil de tickets.
      </p>
      <button type="submit" className="btn-accent mt-2" disabled={etat.kind === "envoi"} data-testid="issue-comment-submit">
        {etat.kind === "envoi" ? "Envoi…" : "Commenter"}
      </button>
      <Retour etat={etat} recharger={recharger} testid="issue-comment" />
    </form>
  );
}

/** Lien de ticket manuel : HTTPS seulement, libellé court. */
export function IssueLinkForm({ issueId, appId, revision }: { issueId: string; appId: string; revision: string }) {
  const { etat, envoyer, recharger } = useMutation(issueId, "links");

  async function soumettre(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const donnees = new FormData(form);
    const ok = await envoyer(
      { app: appId, url: String(donnees.get("url") ?? ""), label: String(donnees.get("label") ?? ""), expectedRevision: revision },
      "Lien ajouté.",
    );
    if (ok) form.reset();
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
            className={`${INPUT_CLASS} w-40 max-w-full`}
            data-testid="issue-link-label"
          />
        </label>
        <button type="submit" className="btn-ghost border border-line" disabled={etat.kind === "envoi"}>
          {etat.kind === "envoi" ? "Ajout…" : "Lier"}
        </button>
      </div>
      <Retour etat={etat} recharger={recharger} testid="issue-link" />
    </form>
  );
}
