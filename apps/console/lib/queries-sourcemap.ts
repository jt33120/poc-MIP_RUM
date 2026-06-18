// Accès aux source maps (table sourcemap, migration-v13). Lecture pour la
// dé-minification des stacks à l'affichage ; upsert pour l'upload (/api/sourcemaps).
import { q } from "./db";
import type { RawSourceMap } from "./sourcemap";

/** Source maps d'une (app, release), indexées par nom de fichier minifié. JSON déjà parsé. */
export async function getSourceMaps(
  appId: string,
  release: string,
): Promise<Record<string, RawSourceMap>> {
  if (!appId || !release) return {};
  const rows = await q<{ filename: string; content: string }>(
    `select filename, content from sourcemap where app_id = $1 and release = $2`,
    [appId, release],
  );
  const out: Record<string, RawSourceMap> = {};
  for (const r of rows) {
    try {
      out[r.filename] = JSON.parse(r.content) as RawSourceMap;
    } catch {
      /* map illisible : ignorée (la stack brute reste affichée) */
    }
  }
  return out;
}

/** Upsert d'une source map (upload). Remplace toute version existante du même fichier. */
export async function upsertSourceMap(
  appId: string,
  release: string,
  filename: string,
  content: string,
): Promise<void> {
  await q(
    `insert into sourcemap (app_id, release, filename, content, size_bytes)
     values ($1, $2, $3, $4, $5)
     on conflict (app_id, release, filename) do update
       set content = excluded.content, size_bytes = excluded.size_bytes, created_at = now()`,
    [appId, release, filename, content, Buffer.byteLength(content, "utf8")],
  );
}

export interface SourceMapMeta {
  release: string;
  filename: string;
  size_bytes: number;
  created_at: Date;
}

/** Liste des source maps d'une app (pour l'admin), sans le contenu. */
export async function listSourceMaps(appId: string): Promise<SourceMapMeta[]> {
  return q<SourceMapMeta>(
    `select release, filename, size_bytes, created_at
     from sourcemap where app_id = $1 order by created_at desc limit 200`,
    [appId],
  );
}
