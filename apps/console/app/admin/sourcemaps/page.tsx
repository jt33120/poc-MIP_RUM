import Link from "next/link";
import { ECRANS_ADMIN } from "@mip/console-contract";
import { PageHeader } from "@/components/PageHeader";
import { TableDefilante } from "@/components/TableDefilante";
import { CopyBlock } from "@/components/CopyBlock";
import { INPUT_CLASS } from "@/components/forms/Field";
import { SourcemapUploadForm } from "@/components/sourcemaps/SourcemapUploadForm";
import { TokenCreateForm } from "@/components/sourcemaps/TokenCreateForm";
import { TokenRevokeButton } from "@/components/sourcemaps/TokenRevokeButton";
import type { Fil } from "@mip/console-contract";
import { chargerSourcemaps } from "@/lib/chargeurs/administration";
import { accesAdmin, chargerEcran } from "@/lib/ecran";
import type { SearchParams } from "@/lib/filters";
import { fmtDate, pluriel } from "@/lib/format";
import type { ReleaseManifest, SourcemapFileStatus, SourcemapRelease } from "@/lib/queries-sourcemap";
import type { SourcemapToken } from "@/lib/queries-sourcemap-tokens";

export const dynamic = "force-dynamic";

const LINK = "rounded text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf";

type App = { app_id: string; name: string };

type Donnees =
  | {
      kind: "ok";
      apps: App[];
      app: string | null;
      releases: Fil<SourcemapRelease>[];
      manifest: Fil<ReleaseManifest> | null;
      tokens: Fil<SourcemapToken>[];
      deployees: string[];
    }
  | { kind: "schema"; apps: App[]; app: string }
  | { kind: "error"; app: string | null };

const STATUT_FICHIER: Record<SourcemapFileStatus, { label: string; className: string }> = {
  ok: { label: "validée", className: "bg-good/10 text-good-ink" },
  replaced: { label: "remplacée (auditée)", className: "bg-warn/10 text-warn-ink" },
  legacy: { label: "ancienne, non validée", className: "bg-panel2 text-ink-soft" },
};

/** Le privilège d'un jeton, en mots : le code (`sourcemaps:write`) reste celui de l'API. */
const PRIVILEGES: Record<string, string> = {
  "sourcemaps:write": "Envoi de source maps",
  "deploys:write": "Déclaration de déploiements",
};

const param = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim() : null);

function octets(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace(".", ",")} Kio`;
  return `${(n / (1024 * 1024)).toFixed(1).replace(".", ",")} Mio`;
}

/** Source maps et jetons de CI (P5.4) — admin seulement : ni contenu de map, ni secret hors création. */
export default async function SourcemapsAdmin({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const release = param(sp.release);
  // Le chargeur (`lib/chargeurs/administration.ts`) : l'application demandée si elle est
  // dans le périmètre de l'administrateur (C9), sinon la première ; ses releases, le
  // manifeste d'une release, ses jetons de CI.
  const ecran = accesAdmin(await chargerEcran(ECRANS_ADMIN.sourcemaps, chargerSourcemaps, sp));
  const donnees: Donnees =
    ecran.etat === "ok"
      ? { kind: "ok", apps: ecran.apps, app: ecran.app, releases: ecran.releases, manifest: ecran.manifeste, tokens: ecran.jetons, deployees: ecran.deployees }
      : ecran.etat === "schema"
        ? { kind: "schema", apps: ecran.apps, app: ecran.app }
        : { kind: "error", app: ecran.app };
  const { app } = donnees;
  const apps = donnees.kind === "error" ? [] : donnees.apps;
  const maintenant = Date.now();

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Source maps"
        sub={
          <>
            Les source maps rendent lisibles les piles d&apos;erreurs de vos versions publiées (fichiers, lignes,
            noms de fonctions). Leur contenu n&apos;est jamais affiché ; le secret d&apos;un jeton ne l&apos;est
            qu&apos;à sa création.
          </>
        }
      />

      {donnees.kind === "error" && (
        <div role="alert" className="card mb-6 border-bad/30 p-6 text-sm text-bad-ink">
          Impossible de charger les source maps.{" "}
          <a href={`/admin/sourcemaps${app ? `?app=${encodeURIComponent(app)}` : ""}`} className={LINK}>
            Réessayer
          </a>
        </div>
      )}

      {donnees.kind !== "error" && !app && (
        <p className="card p-6 text-sm text-ink-soft">
          Aucune application enregistrée :{" "}
          <Link href="/admin/customers" className={LINK}>
            ajoutez d&apos;abord une application
          </Link>
          .
        </p>
      )}

      {donnees.kind !== "error" && app && (
        <>
          <form method="get" className="card mb-6 flex flex-wrap items-end gap-3 p-4">
            {/* Un sélecteur prend la largeur de sa plus longue option : sans `max-w-full`,
                un nom d'app long fait déborder la page sur mobile. */}
            <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs font-medium text-ink-soft">
              Application
              <select name="app" defaultValue={app} className={`${INPUT_CLASS} max-w-full`}>
                {apps.map((a) => (
                  <option key={a.app_id} value={a.app_id}>
                    {a.name} ({a.app_id})
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn-ghost">
              Afficher
            </button>
          </form>

          {donnees.kind === "schema" && (
            <p role="status" className="mb-6 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink-soft">
              La base n&apos;est pas encore à jour : empreintes, envoi de maps et jetons de CI sont indisponibles.
            </p>
          )}

          {donnees.kind === "ok" && (
            <div className="grid gap-6 xl:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-6">
                <Releases app={app} releases={donnees.releases} courante={release} />
                {release && donnees.manifest && <Manifeste release={release} manifest={donnees.manifest} />}
              </div>
              <div className="flex min-w-0 flex-col gap-6">
                <section className="card p-4" aria-labelledby="upload-title">
                  <h2 id="upload-title" className="mb-3 text-sm font-semibold text-ink">
                    Envoyer des maps
                  </h2>
                  <SourcemapUploadForm appId={app} release={release} suggestions={donnees.deployees} />
                </section>
                <Jetons app={app} tokens={donnees.tokens} maintenant={maintenant} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Releases({ app, releases, courante }: { app: string; releases: SourcemapRelease[]; courante: string | null }) {
  return (
    <section className="card overflow-hidden" aria-labelledby="releases-title">
      <h2 id="releases-title" className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">
        Releases
      </h2>
      {releases.length ? (
        <TableDefilante label="Releases">
          <table className="w-full text-sm">
            <caption className="sr-only">Releases de {app} portant des source maps, la plus récente d&apos;abord</caption>
            <thead className="bg-panel2">
              <tr>
                <th scope="col" className="th">Release</th>
                <th scope="col" className="th">Fichiers</th>
                <th scope="col" className="th">Taille</th>
                <th scope="col" className="th">Dernière mise en ligne</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {releases.map((r) => (
                <tr key={r.release} className={r.release === courante ? "bg-panel2/60" : undefined}>
                  <td className="px-4 py-2">
                    <Link
                      href={`/admin/sourcemaps?app=${encodeURIComponent(app)}&release=${encodeURIComponent(r.release)}`}
                      className={`break-all font-mono text-xs ${LINK}`}
                      aria-current={r.release === courante ? "true" : undefined}
                    >
                      {r.release}
                    </Link>
                  </td>
                  <td className="px-4 py-2 tabular-nums">{r.files}</td>
                  <td className="px-4 py-2 tabular-nums text-ink-soft">{octets(r.size_bytes)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-ink-soft">{fmtDate(r.last_uploaded_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableDefilante>
      ) : (
        // L'enjeu, pas seulement l'absence (recette du 26/09/2026).
        <p className="px-4 py-8 text-center text-sm text-ink-soft" data-testid="sourcemaps-vide">
          Aucune source map pour cette application : ses erreurs s&apos;affichent avec des piles minifiées,
          sans nom de fichier ni de fonction lisible. Envoyez les maps de chaque version depuis la CI, ou avec le
          formulaire « Envoyer des maps ».
        </p>
      )}
    </section>
  );
}

function Manifeste({ release, manifest }: { release: string; manifest: ReleaseManifest }) {
  const anciennes = manifest.files.filter((f) => f.status === "legacy").length;
  return (
    <section className="card overflow-hidden" aria-labelledby="manifest-title" data-testid="sourcemap-manifest">
      <div className="border-b border-line px-4 py-3">
        <h2 id="manifest-title" className="text-sm font-semibold text-ink">
          Manifeste de la release <span className="break-all font-mono">{release}</span>
        </h2>
        <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs text-ink-soft sm:grid-cols-[auto_1fr]">
          <dt>Fichiers</dt>
          <dd className="tabular-nums text-ink">
            {manifest.files.length} · {octets(manifest.size_bytes)}
          </dd>
          <dt>Empreinte</dt>
          <dd className="break-all font-mono text-ink">{manifest.fingerprint}</dd>
          <dt>État</dt>
          <dd>
            {manifest.files.length === 0
              ? "Aucun fichier pour cette release."
              : anciennes
                ? `${pluriel(anciennes, "fichier ancien", "fichiers anciens")} : contenu jamais validé, à renvoyer depuis la CI.`
                : "Toutes les maps ont été validées à l'envoi. Comparez l'empreinte à celle qu'affiche la commande de CI : si elles sont égales, la release est complète."}
          </dd>
        </dl>
      </div>
      {manifest.files.length > 0 && (
        <TableDefilante label="Fichiers de la release">
          <table className="w-full text-sm">
            <caption className="sr-only">Fichiers de la release {release}, par nom</caption>
            <thead className="bg-panel2">
              <tr>
                <th scope="col" className="th">Fichier</th>
                <th scope="col" className="th">Taille</th>
                <th scope="col" className="th">Somme de contrôle</th>
                <th scope="col" className="th">Mise en ligne</th>
                <th scope="col" className="th">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {manifest.files.map((f) => (
                <tr key={f.filename} className="align-top">
                  <td className="px-4 py-2">
                    <span className="break-all font-mono text-xs">{f.filename}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 tabular-nums text-ink-soft">{octets(f.size_bytes)}</td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-soft" title={f.checksum}>
                    {f.checksum.slice(0, 12)}…
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-soft">
                    <span className="whitespace-nowrap">{fmtDate(f.uploaded_at)}</span>
                    <span className="block break-all text-ink-faint">{f.uploaded_by ?? "auteur inconnu"}</span>
                  </td>
                  <td className="px-4 py-2">
                    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_FICHIER[f.status].className}`}>
                      {STATUT_FICHIER[f.status].label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableDefilante>
      )}
    </section>
  );
}

function Jetons({ app, tokens, maintenant }: { app: string; tokens: SourcemapToken[]; maintenant: number }) {
  return (
    <section className="card overflow-hidden" aria-labelledby="tokens-title">
      <div className="border-b border-line p-4">
        <h2 id="tokens-title" className="mb-1 text-sm font-semibold text-ink">
          Jetons de CI
        </h2>
        <p className="mb-3 text-xs text-ink-soft">
          Un jeton par usage, pour {app} : envoyer des source maps, ou déclarer un déploiement (
          <code className="chip-mono">POST /api/v1/deploys</code>). Validité de 1 à 90 jours. Pour le renouveler :
          créez-en un nouveau, placez-le dans la CI, puis révoquez l&apos;ancien. Commande à lancer dans la CI :
        </p>
        {/* Bloc copiable qui défile, plutôt qu'un `break-all` en ligne : la commande
            se coupait au milieu des mots (« n / ode », « --di / r ») et ne se
            copiait qu'à la main (recette 26/09). */}
        <div className="mb-3 min-w-0">
          <CopyBlock code={`node scripts/upload-sourcemaps.mjs --app ${app} --release RELEASE --dir dist --url URL_UPLOAD`} />
        </div>
        <TokenCreateForm appId={app} />
      </div>
      {tokens.length ? (
        <TableDefilante label="Jetons de CI">
          <table className="w-full text-sm">
            <caption className="sr-only">Jetons de CI de {app}, actifs d&apos;abord</caption>
            <thead className="bg-panel2">
              <tr>
                <th scope="col" className="th">Nom</th>
                <th scope="col" className="th">Usage</th>
                <th scope="col" className="th">Expire</th>
                <th scope="col" className="th">Dernier usage</th>
                <th scope="col" className="th">Statut</th>
                <th scope="col" className="th">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {tokens.map((t) => {
                const expire = new Date(t.expiresAt).getTime() <= maintenant;
                const statut = t.revokedAt ? "révoqué" : expire ? "expiré" : "actif";
                return (
                  <tr key={t.id}>
                    <td className="px-4 py-2">
                      <span className="block">{t.name}</span>
                      <span className="block font-mono text-[11px] text-ink-faint">créé le {fmtDate(t.createdAt)}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-ink-soft">{PRIVILEGES[t.scope] ?? t.scope}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-ink-soft">{fmtDate(t.expiresAt)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-ink-soft">
                      {t.lastUsedAt ? fmtDate(t.lastUsedAt) : "jamais"}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          statut === "actif"
                            ? "bg-good/10 text-good-ink"
                            : "bg-bad/10 text-bad-ink"
                        }`}
                      >
                        {statut}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      {!t.revokedAt && <TokenRevokeButton id={t.id} name={t.name} appId={t.appId} scope={t.scope} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableDefilante>
      ) : (
        <p className="px-4 py-6 text-center text-sm text-ink-faint">Aucun jeton de CI pour cette application.</p>
      )}
    </section>
  );
}
