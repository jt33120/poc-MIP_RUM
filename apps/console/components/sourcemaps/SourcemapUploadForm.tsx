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
import { useId, useState } from "react";
import { INPUT_CLASS } from "@/components/forms/Field";
import { pluriel } from "@/lib/format";

const LIMITE_CONSOLE = 4 * 1024 * 1024;

type Resultat =
  | { kind: "succes"; created: number; unchanged: number; replaced: number; fingerprint: string }
  | { kind: "conflit"; fichiers: string[] }
  | { kind: "erreur"; message: string };

export function SourcemapUploadForm({
  appId,
  release,
  suggestions = [],
}: {
  appId: string;
  release: string | null;
  /** Versions déjà déployées par l'application, proposées pour la release. */
  suggestions?: string[];
}) {
  const router = useRouter();
  const ids = useId();
  const [envoi, setEnvoi] = useState(false);
  const [resultat, setResultat] = useState<Resultat | null>(null);
  const [choisis, setChoisis] = useState<string[]>([]);

  async function envoyer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const donnees = new FormData(event.currentTarget);
    const fichiers = donnees.getAll("maps").filter((f): f is File => f instanceof File && f.size > 0);
    if (!fichiers.length) {
      setResultat({ kind: "erreur", message: "Choisissez au moins un fichier .map." });
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
            "Plus de 4 Mio : trop lourd pour un envoi depuis la console. Envoyez ces maps depuis la CI, avec la commande indiquée sous « Jetons de CI ».",
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
        setResultat({ kind: "erreur", message: reponse?.error ?? `Échec de l'envoi (erreur ${res.status})` });
      }
    } catch {
      setResultat({ kind: "erreur", message: "Réseau indisponible : réessayez." });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div>
      {/* Formulaire rendu dans une fenêtre (refonte du 01/10/2026) : libellés courts,
          la précision de chaque champ au survol (`title`) et pour le lecteur d'écran. */}
      <form onSubmit={envoyer} className="flex flex-col gap-3" data-testid="upload-sourcemaps">
        <label className="flex flex-col gap-1 text-[11px] font-medium text-ink-soft">
          <span>
            Release <span className="font-normal text-ink-faint">— la valeur exacte déclarée par le code de suivi</span>
          </span>
          <input
            name="release"
            required
            maxLength={120}
            defaultValue={release ?? ""}
            placeholder={suggestions[0] ? `ex. ${suggestions[0]}` : undefined}
            list={suggestions.length ? `${ids}-releases` : undefined}
            className={INPUT_CLASS}
          />
          {suggestions.length > 0 && (
            <datalist id={`${ids}-releases`}>
              {suggestions.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          )}
          {suggestions.length > 0 && (
            <span className="flex min-w-0 flex-wrap items-center gap-1 font-normal text-ink-faint">
              Déployées récemment :
              {suggestions.slice(0, 3).map((v) => (
                <code key={v} className="chip-mono">
                  {v}
                </code>
              ))}
              {suggestions.length > 3 ? "…" : ""}
            </span>
          )}
        </label>
        {/* Le sélecteur natif s'écrit dans la langue du navigateur (« Choose Files /
            No file chosen », même en fr-FR : recette du 26/09/2026). Le champ reste
            natif — clavier, lecteur d'écran — mais visuellement caché derrière son
            libellé, qui sert de bouton ; l'état est écrit en français à côté. */}
        <div className="flex flex-col gap-1 text-[11px] font-medium text-ink-soft">
          <span id={`${ids}-maps-titre`}>Fichiers .map</span>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {/* `peer` : le champ caché garde le focus clavier, son libellé en montre l'anneau. */}
            <input
              id={`${ids}-maps`}
              name="maps"
              type="file"
              accept=".map,application/json"
              multiple
              aria-labelledby={`${ids}-maps-titre`}
              aria-describedby={`${ids}-maps-etat`}
              onChange={(e) => setChoisis(Array.from(e.currentTarget.files ?? []).map((f) => f.name))}
              className="peer sr-only"
            />
            <label
              htmlFor={`${ids}-maps`}
              className="btn-ghost cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40"
            >
              Choisir des fichiers
            </label>
            <span id={`${ids}-maps-etat`} className="min-w-0 break-all font-normal text-ink-soft" data-testid="maps-choisis">
              {choisis.length === 0
                ? "Aucun fichier choisi"
                : choisis.length === 1
                  ? choisis[0]
                  : `${pluriel(choisis.length, "fichier choisi", "fichiers choisis")}`}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs text-ink-soft">
            <input name="replace" type="checkbox" />
            Remplacer un contenu déjà présent <span className="text-ink-faint">(inscrit au journal d&apos;audit)</span>
          </label>
          <button type="submit" className="btn-accent" disabled={envoi}>
            {envoi ? "Envoi…" : "Envoyer les maps"}
          </button>
        </div>
      </form>
      {resultat?.kind === "succes" && (
        <p role="status" className="mt-3 text-sm text-ink-soft">
          {pluriel(resultat.created, "créée", "créées")}, {pluriel(resultat.unchanged, "inchangée", "inchangées")},{" "}
          {pluriel(resultat.replaced, "remplacée", "remplacées")}. Empreinte du
          manifeste : <code className="chip-mono break-all">{resultat.fingerprint}</code>
        </p>
      )}
      {resultat?.kind === "conflit" && (
        <p role="alert" className="mt-3 text-sm text-bad-ink">
          Rien n&apos;a été écrit : un contenu différent est déjà présent pour {resultat.fichiers.join(", ")}. Cochez
          « Remplacer » seulement si ce contenu doit vraiment remplacer l&apos;existant.
        </p>
      )}
      {resultat?.kind === "erreur" && (
        <p role="alert" className="mt-3 text-sm text-bad-ink">
          {resultat.message}
        </p>
      )}
    </div>
  );
}
