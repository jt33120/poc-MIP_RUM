import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { INPUT_CLASS } from "@/components/forms/Field";
import { SourcemapUploadForm } from "@/components/sourcemaps/SourcemapUploadForm";
import { TokenCreateForm } from "@/components/sourcemaps/TokenCreateForm";
import { TokenRevokeButton } from "@/components/sourcemaps/TokenRevokeButton";
import { requireAdmin } from "@/lib/auth";
import type { SearchParams } from "@/lib/filters";
import { fmtDate } from "@/lib/format";
import { registeredApps } from "@/lib/queries";
import {
  listSourcemapReleases,
  type ReleaseManifest,
  releaseManifest,
  schemaSourcemapAbsent,
  type SourcemapFileStatus,
  type SourcemapRelease,
} from "@/lib/queries-sourcemap";
import { listSourcemapTokens, type SourcemapToken } from "@/lib/queries-sourcemap-tokens";

export const dynamic = "force-dynamic";

const LINK = "rounded text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf";

type App = { app_id: string; name: string };

type Donnees =
  | {
      kind: "ok";
      apps: App[];
      app: string | null;
      releases: SourcemapRelease[];
      manifest: ReleaseManifest | null;
      tokens: SourcemapToken[];
    }
  | { kind: "schema"; apps: App[]; app: string }
  | { kind: "error"; app: string | null };

const STATUT_FICHIER: Record<SourcemapFileStatus, { label: string; className: string }> = {
  ok: { label: "validée", className: "bg-good/10 text-good-ink" },
  replaced: { label: "remplacée (auditée)", className: "bg-warn/10 text-warn-ink" },
  legacy: { label: "antérieure à v71", className: "bg-panel2 text-ink-soft" },
};

const param = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim() : null);

function octets(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace(".", ",")} Kio`;
  return `${(n / (1024 * 1024)).toFixed(1).replace(".", ",")} Mio`;
}

/** L'app demandée si elle est enregistrée, sinon la première du registre. */
async function charger(demandee: string | null, release: string | null): Promise<Donnees> {
  let apps: App[];
  try {
    apps = await registeredApps();
  } catch {
    return { kind: "error", app: demandee };
  }
  const app = apps.find((a) => a.app_id === demandee)?.app_id ?? apps[0]?.app_id ?? null;
  if (!app) return { kind: "ok", apps, app, releases: [], manifest: null, tokens: [] };
  try {
    const [releases, manifest, tokens] = await Promise.all([
      listSourcemapReleases(app),
      release ? releaseManifest(app, release) : null,
      listSourcemapTokens(app),
    ]);
    return { kind: "ok", apps, app, releases, manifest, tokens };
  } catch (err) {
    if (schemaSourcemapAbsent(err)) return { kind: "schema", apps, app };
    console.error("[admin/sourcemaps]", err);
    return { kind: "error", app };
  }
}

/** Source maps et jetons de CI (P5.4) — admin seulement : ni contenu de map, ni secret hors création. */
export default async function SourcemapsAdmin({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const sp = await searchParams;
  const release = param(sp.release);
  const donnees = await charger(param(sp.app), release);
  const { app } = donnees;
  const apps = donnees.kind === "error" ? [] : donnees.apps;
  const maintenant = Date.now();

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Source maps"
        sub={
          <>
            Maps par application et release, empreintes et jetons de CI. Le contenu des maps n&apos;est jamais
            affiché ; un secret de jeton ne l&apos;est qu&apos;à sa création.
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
        <p className="card p-6 text-sm text-ink-soft">Aucune application enregistrée : créer d&apos;abord un client.</p>
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
              Migration v71 en attente : empreintes, upload et jetons de CI indisponibles jusqu&apos;à son application.
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
                  <SourcemapUploadForm appId={app} release={release} />
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
        <div className="relative overflow-x-auto">
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
        </div>
      ) : (
        <p className="px-4 py-8 text-center text-sm text-ink-faint">Aucune source map pour cette application.</p>
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
                ? `${anciennes} fichier(s) antérieur(s) à v71 : contenu jamais validé, à renvoyer par la CI.`
                : "Toutes les maps ont été validées à l'upload. Comparer l'empreinte à celle affichée par le CLI : égales, la release est complète."}
          </dd>
        </dl>
      </div>
      {manifest.files.length > 0 && (
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Fichiers de la release {release}, par nom</caption>
            <thead className="bg-panel2">
              <tr>
                <th scope="col" className="th">Fichier</th>
                <th scope="col" className="th">Taille</th>
                <th scope="col" className="th">Checksum</th>
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
        </div>
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
          Privilège unique <code className="chip-mono">sourcemaps:write</code> sur {app}, expiration de 1 à 90 jours.
          Rotation : créer un nouveau jeton, basculer la CI, révoquer l&apos;ancien. En CI :{" "}
          <code className="chip-mono break-all">
            node scripts/upload-sourcemaps.mjs --app {app} --release RELEASE --dir dist --url URL_UPLOAD
          </code>
        </p>
        <TokenCreateForm appId={app} />
      </div>
      {tokens.length ? (
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Jetons de CI de {app}, actifs d&apos;abord</caption>
            <thead className="bg-panel2">
              <tr>
                <th scope="col" className="th">Nom</th>
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
                const expire = t.expiresAt.getTime() <= maintenant;
                const statut = t.revokedAt ? "révoqué" : expire ? "expiré" : "actif";
                return (
                  <tr key={t.id}>
                    <td className="px-4 py-2">
                      <span className="block">{t.name}</span>
                      <span className="block font-mono text-[11px] text-ink-faint">créé le {fmtDate(t.createdAt)}</span>
                    </td>
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
                      {!t.revokedAt && <TokenRevokeButton id={t.id} name={t.name} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-6 text-center text-sm text-ink-faint">Aucun jeton de CI pour cette application.</p>
      )}
    </section>
  );
}
