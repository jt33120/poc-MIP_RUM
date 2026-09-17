"use client";
// Upload manuel de source maps depuis la console (P5.4) — même route et même
// contrat que le CLI de CI : toutes les maps validées avant la première écriture,
// une transaction, 409 si un fichier existe avec un autre contenu. Le
// remplacement est une case explicite, auditée côté serveur.
//
// Le fichier `main.abc.js.map` est envoyé pour le bundle `main.abc.js` : c'est le
// nom que citent les stacks. Au-delà de 4 Mio de requête, le port console refuse
// (plafond Vercel) : le CLI et le backend direct prennent le relais.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { INPUT_CLASS } from "@/components/forms/Field";

const LIMITE_CONSOLE = 4 * 1024 * 1024;

type Resultat =
  | { kind: "succes"; created: number; unchanged: number; replaced: number; fingerprint: string }
  | { kind: "conflit"; fichiers: string[] }
  | { kind: "erreur"; message: string };

export function SourcemapUploadForm({ appId, release }: { appId: string; release: string | null }) {
  const router = useRouter();
  const [envoi, setEnvoi] = useState(false);
  const [resultat, setResultat] = useState<Resultat | null>(null);

  async function envoyer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const donnees = new FormData(event.currentTarget);
    const fichiers = donnees.getAll("maps").filter((f): f is File => f instanceof File && f.size > 0);
    if (!fichiers.length) {
      setResultat({ kind: "erreur", message: "Choisir au moins un fichier .map." });
      return;
    }
    setEnvoi(true);
    setResultat(null);
    try {
      const maps = await Promise.all(
        fichiers.map(async (f) => ({ filename: f.name.replace(/\.map$/, ""), content: await f.text() })),
      );
      const corps = JSON.stringify({
        appId,
        release: String(donnees.get("release") ?? ""),
        maps,
        replace: donnees.get("replace") === "on",
      });
      if (new Blob([corps]).size > LIMITE_CONSOLE) {
        setResultat({
          kind: "erreur",
          message:
            "Plus de 4 Mio : trop lourd pour la console. Utiliser le CLI scripts/upload-sourcemaps.mjs avec le backend direct.",
        });
        return;
      }
      const res = await fetch("/api/sourcemaps", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: corps,
      });
      const reponse = await res.json().catch(() => null);
      if (res.ok) {
        setResultat({
          kind: "succes",
          created: reponse.created,
          unchanged: reponse.unchanged,
          replaced: reponse.replaced,
          fingerprint: reponse.release.fingerprint,
        });
        router.refresh();
      } else if (res.status === 409) {
        setResultat({ kind: "conflit", fichiers: (reponse?.conflicts ?? []).map((c: { filename: string }) => c.filename) });
      } else {
        setResultat({ kind: "erreur", message: reponse?.error ?? `Échec de l'upload (HTTP ${res.status})` });
      }
    } catch {
      setResultat({ kind: "erreur", message: "Réseau indisponible : réessayer." });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div>
      <form onSubmit={envoyer} className="flex flex-col gap-3" data-testid="upload-sourcemaps">
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          Release (valeur exacte de mip.release dans le SDK)
          <input name="release" required maxLength={200} defaultValue={release ?? ""} className={INPUT_CLASS} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          Fichiers .map
          <input
            name="maps"
            type="file"
            accept=".map,application/json"
            multiple
            required
            className="max-w-full text-sm text-ink"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-ink-soft">
          <input name="replace" type="checkbox" />
          Remplacer un fichier déjà présent avec un autre contenu (audité)
        </label>
        <div>
          <button type="submit" className="btn-accent" disabled={envoi}>
            {envoi ? "Envoi…" : "Envoyer les maps"}
          </button>
        </div>
      </form>
      {resultat?.kind === "succes" && (
        <p role="status" className="mt-3 text-sm text-ink-soft">
          {resultat.created} créée(s), {resultat.unchanged} inchangée(s), {resultat.replaced} remplacée(s). Empreinte du
          manifeste : <code className="chip-mono break-all">{resultat.fingerprint}</code>
        </p>
      )}
      {resultat?.kind === "conflit" && (
        <p role="alert" className="mt-3 text-sm text-bad">
          Rien n&apos;a été écrit : contenu différent déjà présent pour {resultat.fichiers.join(", ")}. Cocher
          « Remplacer » seulement si ce contenu doit vraiment remplacer l&apos;existant.
        </p>
      )}
      {resultat?.kind === "erreur" && (
        <p role="alert" className="mt-3 text-sm text-bad">
          {resultat.message}
        </p>
      )}
    </div>
  );
}
