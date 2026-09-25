"use client";
// Création d'un jeton de CI (P5.4) : upload de source maps, ou — C11 — marqueur
// de déploiement (`deploys:write`), un privilège par jeton. Le secret n'existe
// que dans l'état de ce composant, le temps de le copier : la base n'en garde que
// le hash, et un rafraîchissement de la page le fait disparaître.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { creerJetonSourcemapAction } from "@/app/admin/sourcemaps/actions";
import { CopyBlock } from "@/components/CopyBlock";
import { INPUT_CLASS } from "@/components/forms/Field";

export function TokenCreateForm({ appId }: { appId: string }) {
  const router = useRouter();
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ value: string; name: string; privilege: string } | null>(null);

  async function creer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const donnees = new FormData(form);
    setEnvoi(true);
    setErreur(null);
    setSecret(null);
    try {
      // C9 : la server action appelle la commande (plus la route /api/admin/sourcemap-tokens).
      const privilege = donnees.get("scope") === "deploys:write" ? "deploys:write" : "sourcemaps:write";
      const retour = await creerJetonSourcemapAction(appId, String(donnees.get("name") ?? ""), Number(donnees.get("expiresInDays")), privilege);
      if (!retour.ok) {
        setErreur(retour.erreur);
        return;
      }
      setSecret({ value: retour.secret, name: retour.nom, privilege: retour.privilege });
      form.reset();
      router.refresh();
    } catch {
      setErreur("Réseau indisponible : réessayer.");
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div>
      <form onSubmit={creer} className="flex flex-wrap items-end gap-3" data-testid="create-sourcemap-token">
        <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs font-medium text-ink-soft">
          Nom du jeton
          <input
            name="name"
            required
            maxLength={100}
            placeholder="CI GitHub — production"
            className={`${INPUT_CLASS} w-56 max-w-full`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          Privilège
          <select name="scope" defaultValue="sourcemaps:write" className={`${INPUT_CLASS} w-52`}>
            <option value="sourcemaps:write">source maps (sourcemaps:write)</option>
            <option value="deploys:write">marqueurs de déploiement (deploys:write)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          Validité (jours)
          <input name="expiresInDays" type="number" required min={1} max={90} defaultValue={30} className={`${INPUT_CLASS} w-24`} />
        </label>
        <button type="submit" className="btn-accent" disabled={envoi}>
          {envoi ? "Création…" : "Créer le jeton"}
        </button>
      </form>
      {erreur && (
        <p role="alert" className="mt-3 text-sm text-bad-ink">
          {erreur}
        </p>
      )}
      {secret && (
        <div
          role="status"
          data-testid="sourcemap-token-secret"
          className="mt-4 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn-ink"
        >
          <p className="mb-2">
            Jeton <strong>{secret.name}</strong> : affiché une seule fois, copie-le maintenant. À placer dans la variable
            secrète{" "}
            <code className="chip-mono">{secret.privilege === "deploys:write" ? "MIP_DEPLOY_TOKEN" : "MIP_SOURCEMAP_TOKEN"}</code> de la
            CI, jamais dans le dépôt ni dans un bundle client.
          </p>
          <CopyBlock code={secret.value} />
        </div>
      )}
    </div>
  );
}
