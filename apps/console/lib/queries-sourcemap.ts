// Source maps côté console (P5.4) : releases et fichiers d'une app, sans jamais
// relire le contenu. L'écriture passe par le contrat partagé
// `@mip/backend/lib/sourcemap-upload.mjs`, le même pour la console et le backend direct.
import { empreinteManifeste } from "@mip/backend/lib/sourcemap-upload.mjs";
import { q } from "./db";

export interface SourcemapRelease {
  release: string;
  files: number;
  size_bytes: number;
  last_uploaded_at: Date | string;
}

/**
 * `legacy` : mise en ligne avant v71, sans validation ni auteur connu ;
 * `replaced` : contenu remplacé depuis le premier upload (audité) ; `ok` sinon.
 */
export type SourcemapFileStatus = "ok" | "replaced" | "legacy";

export interface SourcemapFile {
  filename: string;
  size_bytes: number;
  checksum: string;
  created_at: Date | string;
  uploaded_at: Date | string;
  uploaded_by: string | null;
  status: SourcemapFileStatus;
}

export interface ReleaseManifest {
  files: SourcemapFile[];
  size_bytes: number;
  /** Même calcul que le CLI : deux empreintes égales, release complète. */
  fingerprint: string;
}

/** Colonne ou table absente : console publiée avant migration-v71. */
export function schemaSourcemapAbsent(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "42703" || code === "42P01";
}

/** Releases d'une app, la plus récemment mise en ligne d'abord. */
export async function listSourcemapReleases(appId: string): Promise<SourcemapRelease[]> {
  return q<SourcemapRelease>(
    `select release, count(*)::int as files, sum(size_bytes)::float8 as size_bytes,
            max(uploaded_at) as last_uploaded_at
       from sourcemap where app_id = $1
      group by release
      order by max(uploaded_at) desc, release
      limit 100`,
    [appId],
  );
}

/** Fichiers d'une release et empreinte de son manifeste. */
export async function releaseManifest(appId: string, release: string): Promise<ReleaseManifest> {
  const rows = await q<Omit<SourcemapFile, "status">>(
    `select filename, size_bytes, checksum, created_at, uploaded_at, uploaded_by
       from sourcemap where app_id = $1 and release = $2
      order by filename`,
    [appId, release],
  );
  const files = rows.map((row) => ({
    ...row,
    status: (row.uploaded_by === null
      ? "legacy"
      : new Date(row.uploaded_at).getTime() > new Date(row.created_at).getTime()
        ? "replaced"
        : "ok") as SourcemapFileStatus,
  }));
  return {
    files,
    size_bytes: files.reduce((total, file) => total + file.size_bytes, 0),
    fingerprint: empreinteManifeste(files),
  };
}
