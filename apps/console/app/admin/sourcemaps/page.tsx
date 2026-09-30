import Link from "next/link";
import { ECRANS_ADMIN } from "@mip/console-contract";
import { PageHeader } from "@/components/PageHeader";
import { TableDefilante } from "@/components/TableDefilante";
import { CopyBlock } from "@/components/CopyBlock";
import { KpiTile } from "@/components/charts/KpiTile";
import { SourcemapUploadForm } from "@/components/sourcemaps/SourcemapUploadForm";
import { TokenCreateForm } from "@/components/sourcemaps/TokenCreateForm";
import { TokenRevokeButton } from "@/components/sourcemaps/TokenRevokeButton";
import type { Fil } from "@mip/console-contract";
import { chargerSourcemaps } from "@/lib/chargeurs/administration";
import { accesAdmin, chargerEcran } from "@/lib/ecran";
import type { SearchParams } from "@/lib/filters";
import { pluriel } from "@/lib/format";
import type { ReleaseManifest, SourcemapFileStatus, SourcemapRelease } from "@/lib/queries-sourcemap";
import type { SourcemapToken } from "@/lib/queries-sourcemap-tokens";
import { Fenetre } from "../_ui/Fenetre";
import { Barre, Erreur, LIGNE, LigneVide, Moment, NombreBarre, Panneau, Pastille, RangeeCases, TD, TD_NUM, TH, TH_NUM, type TonPastille } from "../_ui/kit";
import { partRestante } from "../_ui/temps";

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

const STATUT_FICHIER: Record<SourcemapFileStatus, { label: string; ton: TonPastille }> = {
  ok: { label: "validée", ton: "bon" },
  replaced: { label: "remplacée (auditée)", ton: "attention" },
  legacy: { label: "ancienne, non validée", ton: "eteint" },
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

const SOURCE = "Source maps et jetons de CI enregistrés par la console pour cette application";

/**
 * Source maps et jetons de CI (P5.4) — admin seulement : ni contenu de map, ni secret hors création.
 *
 * Refonte du 01/10/2026 (capture du responsable : une colonne gauche presque vide, un
 * formulaire à droite, deux paragraphes). Désormais : les chiffres en cases, puis des
 * panneaux pleine largeur — releases, manifeste, jetons — chacun avec son état vide sur
 * une ligne ; l'envoi manuel en fenêtre, la création d'un jeton en ligne ; les
 * explications dans les bulles « ? ».
 */
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
      <PageHeader title="Source maps">
        {donnees.kind !== "error" && app && (
          // Le choix de l'application, dans l'en-tête : un sélecteur prend la largeur de
          // sa plus longue option — borné (`max-w-full`), il ne fait plus déborder 390 px.
          <form method="get" className="flex min-w-0 max-w-full items-center gap-2">
            <label htmlFor="sourcemaps-app" className="sr-only">
              Application
            </label>
            <select id="sourcemaps-app" name="app" defaultValue={app} className="field min-w-0 max-w-full py-1 text-xs sm:max-w-[20rem]">
              {apps.map((a) => (
                <option key={a.app_id} value={a.app_id}>
                  {a.name} ({a.app_id})
                </option>
              ))}
            </select>
            <button type="submit" className="btn-ghost">
              Afficher
            </button>
          </form>
        )}
      </PageHeader>

      {donnees.kind === "error" && (
        <Erreur>
          Impossible de charger les source maps.{" "}
          <a href={`/admin/sourcemaps${app ? `?app=${encodeURIComponent(app)}` : ""}`} className={LINK}>
            Réessayer
          </a>
        </Erreur>
      )}

      {donnees.kind !== "error" && !app && (
        <div className="card">
          <LigneVide geste={<Link href="/admin/customers" className={LINK}>Ajouter une application →</Link>}>Aucune application enregistrée.</LigneVide>
        </div>
      )}

      {donnees.kind === "schema" && (
        <p role="status" className="mb-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-ink-soft">
          La base n&apos;est pas encore à jour : empreintes, envoi de maps et jetons de CI sont indisponibles.
        </p>
      )}

      {donnees.kind === "ok" && app && (
        <Contenu
          app={app}
          releases={donnees.releases}
          manifest={donnees.manifest}
          courante={release}
          tokens={donnees.tokens}
          deployees={donnees.deployees}
          maintenant={maintenant}
        />
      )}
    </div>
  );
}

function Contenu({
  app,
  releases,
  manifest,
  courante,
  tokens,
  deployees,
  maintenant,
}: {
  app: string;
  releases: SourcemapRelease[];
  manifest: ReleaseManifest | null;
  courante: string | null;
  tokens: SourcemapToken[];
  deployees: string[];
  maintenant: number;
}) {
  const fichiers = releases.reduce((s, r) => s + r.files, 0);
  const volume = releases.reduce((s, r) => s + r.size_bytes, 0);
  const actifs = tokens.filter((t) => !t.revokedAt && new Date(t.expiresAt).getTime() > maintenant).length;
  return (
    <>
      {/* Les chiffres en cases, seulement s'il y a quelque chose à compter : quatre
          cases à zéro repoussaient le seul message utile (recette du 26/09/2026). */}
      {(releases.length > 0 || tokens.length > 0) && (
        <RangeeCases testId="sourcemaps-cases">
          <KpiTile label="Releases avec source maps" libelleCase="Releases" valeur={releases.length} format="count" source={SOURCE} methode="Une release compte dès qu'elle porte au moins une source map." />
          <KpiTile label="Fichiers .map" valeur={fichiers} format="count" source={SOURCE} methode="Somme des fichiers de toutes les releases." />
          <KpiTile label="Volume des source maps" libelleCase="Volume" valeur={volume} format="bytes" source={SOURCE} methode="Taille cumulée des maps enregistrées, toutes releases confondues." />
          <KpiTile
            label="Jetons de CI actifs"
            valeur={actifs}
            format="count"
            source={SOURCE}
            methode="Ni révoqués ni expirés. Un jeton par usage : envoi de source maps, ou déclaration de déploiements."
          />
        </RangeeCases>
      )}

      <div className="grid gap-4">
        <Panneau
          titre="Releases"
          compte={releases.length}
          aide={
            <>
              Les source maps rendent lisibles les piles d&apos;erreurs de vos versions publiées (fichiers, lignes,
              noms de fonctions). Leur contenu n&apos;est jamais affiché ; le secret d&apos;un jeton ne l&apos;est
              qu&apos;à sa création. Choisissez une release pour lire son manifeste.
            </>
          }
          actions={
            <Fenetre libelle="Envoyer des maps" titre={`Envoyer des source maps · ${app}`} variante="discret" testId="ouvrir-envoi-maps">
              <SourcemapUploadForm appId={app} release={courante} suggestions={deployees} />
            </Fenetre>
          }
        >
          {releases.length ? (
            <TableReleases app={app} releases={releases} courante={courante} maintenant={maintenant} />
          ) : (
            // L'enjeu, pas seulement l'absence (recette du 26/09/2026) : dans la bulle.
            <LigneVide
              testId="sourcemaps-vide"
              aide={
                <>
                  Ses erreurs s&apos;affichent avec des piles minifiées, sans nom de fichier ni de fonction lisible.
                  Envoyez les maps de chaque version depuis la CI (jeton ci-dessous), ou avec « Envoyer des maps ».
                </>
              }
            >
              Aucune source map pour cette application : piles d&apos;erreurs minifiées.
            </LigneVide>
          )}
        </Panneau>

        {courante && manifest && <Manifeste release={courante} manifest={manifest} maintenant={maintenant} />}

        <Jetons app={app} tokens={tokens} maintenant={maintenant} />
      </div>
    </>
  );
}

function TableReleases({ app, releases, courante, maintenant }: { app: string; releases: SourcemapRelease[]; courante: string | null; maintenant: number }) {
  const max = Math.max(...releases.map((r) => r.size_bytes), 1);
  return (
    <TableDefilante label="Releases">
      <table className="w-full text-sm">
        <caption className="sr-only">Releases de {app} portant des source maps, la plus récente d&apos;abord</caption>
        <thead className="bg-panel2">
          <tr>
            <th scope="col" className={TH}>Release</th>
            <th scope="col" className={TH_NUM}>Fichiers</th>
            <th scope="col" className={TH_NUM}>Taille</th>
            <th scope="col" className={TH}>Dernier envoi</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/60">
          {releases.map((r) => (
            <tr key={r.release} className={`${LIGNE} ${r.release === courante ? "bg-panel2/60" : ""}`}>
              <td className={TD}>
                <Link
                  href={`/admin/sourcemaps?app=${encodeURIComponent(app)}&release=${encodeURIComponent(r.release)}`}
                  className={`break-all font-mono text-xs ${LINK}`}
                  aria-current={r.release === courante ? "true" : undefined}
                >
                  {r.release}
                </Link>
              </td>
              <td className={TD_NUM}>{r.files.toLocaleString("fr-FR")}</td>
              <td className={TD_NUM}>
                <NombreBarre texte={octets(r.size_bytes)} part={r.size_bytes / max} />
              </td>
              <td className={`${TD} text-xs text-ink-soft`}>
                <Moment date={r.last_uploaded_at} maintenant={maintenant} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableDefilante>
  );
}

function Manifeste({ release, manifest, maintenant }: { release: string; manifest: ReleaseManifest; maintenant: number }) {
  const anciennes = manifest.files.filter((f) => f.status === "legacy").length;
  const etat =
    manifest.files.length === 0
      ? { ton: "eteint" as const, texte: "aucun fichier" }
      : anciennes
        ? { ton: "attention" as const, texte: `${pluriel(anciennes, "fichier ancien", "fichiers anciens")} à renvoyer` }
        : { ton: "bon" as const, texte: "toutes validées" };
  return (
    <Panneau
      testId="sourcemap-manifest"
      titre={
        <>
          Manifeste · <span className="break-all font-mono normal-case tracking-normal text-ink">{release}</span>
        </>
      }
      compte={manifest.files.length}
      aide={
        anciennes ? (
          <>Un fichier ancien a été mis en ligne avant la validation à l&apos;envoi : son contenu n&apos;a jamais été vérifié. Renvoyez-le depuis la CI.</>
        ) : (
          <>
            Toutes les maps ont été validées à l&apos;envoi. Comparez l&apos;empreinte à celle qu&apos;affiche la commande de CI : si elles sont
            égales, la release est complète.
          </>
        )
      }
      barre={
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-ink-soft">
          <Pastille ton={etat.ton}>{etat.texte}</Pastille>
          <span className="tabular-nums">
            {pluriel(manifest.files.length, "fichier")} · {octets(manifest.size_bytes)}
          </span>
          <span className="flex min-w-0 items-center gap-1">
            <span className="text-ink-faint">Empreinte</span>
            <code className="chip-mono min-w-0 truncate" title={manifest.fingerprint}>
              {manifest.fingerprint}
            </code>
          </span>
        </div>
      }
    >
      {manifest.files.length > 0 && (
        <TableDefilante label="Fichiers de la release">
          <table className="w-full text-sm">
            <caption className="sr-only">Fichiers de la release {release}, par nom</caption>
            <thead className="bg-panel2">
              <tr>
                <th scope="col" className={TH}>Fichier</th>
                <th scope="col" className={TH_NUM}>Taille</th>
                <th scope="col" className={TH}>Somme de contrôle</th>
                <th scope="col" className={TH}>Mise en ligne</th>
                <th scope="col" className={TH}>Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {manifest.files.map((f) => (
                <tr key={f.filename} className={LIGNE}>
                  <td className={TD}>
                    <span className="break-all font-mono text-xs">{f.filename}</span>
                  </td>
                  <td className={`${TD_NUM} whitespace-nowrap text-ink-soft`}>{octets(f.size_bytes)}</td>
                  <td className={`${TD} font-mono text-xs text-ink-soft`} title={f.checksum}>
                    {f.checksum.slice(0, 12)}…
                  </td>
                  <td className={`${TD} text-xs text-ink-soft`}>
                    <Moment date={f.uploaded_at} maintenant={maintenant} />
                    <span className="ml-1.5 text-ink-faint">{f.uploaded_by ?? "auteur inconnu"}</span>
                  </td>
                  <td className={TD}>
                    <Pastille ton={STATUT_FICHIER[f.status].ton}>{STATUT_FICHIER[f.status].label}</Pastille>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableDefilante>
      )}
    </Panneau>
  );
}

function Jetons({ app, tokens, maintenant }: { app: string; tokens: SourcemapToken[]; maintenant: number }) {
  return (
    <Panneau
      titre="Jetons de CI"
      compte={tokens.length}
      aide={
        <>
          Un jeton par usage, pour {app} : envoyer des source maps, ou déclarer un déploiement (
          <code className="chip-mono">POST /api/v1/deploys</code>). Validité de 1 à 90 jours. Pour le renouveler :
          créez-en un nouveau, placez-le dans la CI, puis révoquez l&apos;ancien. Le secret ne s&apos;affiche
          qu&apos;une fois, à la création.
        </>
      }
      barre={
        <div className="flex min-w-0 flex-col gap-2">
          <TokenCreateForm appId={app} />
          {/* Bloc copiable qui défile, plutôt qu'un `break-all` en ligne : la commande
              se coupait au milieu des mots (« n / ode », « --di / r ») et ne se
              copiait qu'à la main (recette 26/09). Replié : elle sert une fois. */}
          <details className="group min-w-0">
            <summary className="inline-flex cursor-pointer select-none list-none items-center gap-1 text-xs font-medium text-brand [&::-webkit-details-marker]:hidden">
              <span aria-hidden className="transition group-open:rotate-90">
                ▸
              </span>
              Commande à lancer dans la CI
            </summary>
            <div className="mt-2 min-w-0">
              <CopyBlock code={`node scripts/upload-sourcemaps.mjs --app ${app} --release RELEASE --dir dist --url URL_UPLOAD`} />
            </div>
          </details>
        </div>
      }
    >
      {tokens.length ? (
        <TableDefilante label="Jetons de CI">
          <table className="w-full text-sm">
            <caption className="sr-only">Jetons de CI de {app}, actifs d&apos;abord</caption>
            <thead className="bg-panel2">
              <tr>
                <th scope="col" className={TH}>Nom</th>
                <th scope="col" className={TH}>Usage</th>
                <th scope="col" className={TH}>Échéance</th>
                <th scope="col" className={TH}>Dernier usage</th>
                <th scope="col" className={TH}>Statut</th>
                <th scope="col" className={TH}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {tokens.map((t) => {
                const expire = new Date(t.expiresAt).getTime() <= maintenant;
                const statut = t.revokedAt ? "révoqué" : expire ? "expiré" : "actif";
                const reste = statut === "actif" ? partRestante(t.createdAt, t.expiresAt, maintenant) : null;
                return (
                  <tr key={t.id} className={LIGNE}>
                    <td className={TD}>
                      <span className="font-medium text-ink">{t.name}</span>
                      <span className="ml-2 text-[11px] text-ink-faint">
                        créé <Moment date={t.createdAt} maintenant={maintenant} />
                      </span>
                    </td>
                    <td className={`${TD} whitespace-nowrap text-xs text-ink-soft`}>{PRIVILEGES[t.scope] ?? t.scope}</td>
                    <td className={`${TD} text-xs text-ink-soft`}>
                      <span className="inline-flex items-center gap-2">
                        <Moment date={t.expiresAt} maintenant={maintenant} />
                        {/* La validité qui reste, en barre : un jeton qui s'éteint se voit avant de casser la CI. */}
                        <Barre part={reste} ton={reste != null && reste < 0.15 ? "attention" : "neutre"} largeur="w-12" />
                      </span>
                    </td>
                    <td className={`${TD} text-xs text-ink-soft`}>
                      <Moment date={t.lastUsedAt} maintenant={maintenant} vide="jamais" />
                    </td>
                    <td className={TD}>
                      <Pastille ton={statut === "actif" ? "bon" : "mauvais"}>{statut}</Pastille>
                    </td>
                    <td className={`${TD} text-right`}>
                      {!t.revokedAt && <TokenRevokeButton id={t.id} name={t.name} appId={t.appId} scope={t.scope} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableDefilante>
      ) : (
        <LigneVide>Aucun jeton de CI pour cette application.</LigneVide>
      )}
    </Panneau>
  );
}
