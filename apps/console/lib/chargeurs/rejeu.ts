// LA LECTURE D'UN REJEU (C3) — `GET /api/replay/[sessionId]`, appelé par le lecteur.
//
// Les segments (`replay_chunk`, gzip d'origine cliente) sont décompressés et mis
// bout à bout en événements rrweb. Trois gardes :
//   1. le PÉRIMÈTRE : la session doit appartenir à une app autorisée au principal
//      (liste vide = aucune) — sinon « introuvable », comme une session absente ;
//   2. les segments sont bornés à l'app de la session : un lot d'une autre app qui
//      citerait cet identifiant (émis par le client) ne s'y ajoute jamais ;
//   3. un PLAFOND PAR SESSION : chaque segment est déjà borné à la décompression
//      (`MAX_REPLAY_INFLATED_BYTES`), mais leur nombre ne l'était pas — une session
//      très longue rendait une réponse sans limite. Au-delà du plafond, les segments
//      suivants ne sont ni lus ni décompressés, et le lecteur le DIT (`tronques`).
// Un segment illisible (gzip ou JSON corrompu, ou JSON qui n'est pas une liste)
// reste ignoré et COMPTÉ (`ignores`, B36).
import { gunzipSync } from "node:zlib";
import { MAX_REPLAY_INFLATED_BYTES } from "@mip/backend/shared/limits.mjs";
import { q } from "../db";
import { authorizedAppsOf } from "../query-contract";
import type { Chargeur } from "./commun";

/** Octets COMPRESSÉS lus au plus pour une session (8 segments de taille maximale). */
export const PLAFOND_REJEU_COMPRESSE = 16 * 1024 * 1024;
/** Octets DÉCOMPRESSÉS rendus au plus pour une session. */
export const PLAFOND_REJEU_DECOMPRESSE = 64 * 1024 * 1024;

interface LigneSegment {
  seq: number;
  body: Buffer; // gzip (stocké compressé à l'ingestion)
  total: string; // count(*) : bigint, rendu en texte par node-postgres
}

export const chargerRejeu = (async (principal, _sp, { sessionId }) => {
  const id = sessionId ?? "";
  // Périmètre : la session doit appartenir à une app autorisée (liste vide = aucune).
  const authorized = authorizedAppsOf(principal);
  const owner = await q<{ app_id: string }>(`select app_id from rum_session where session_id = $1`, [id]);
  const appId = owner[0]?.app_id;
  if (!appId || (authorized !== null && !authorized.includes(appId))) return { etat: "introuvable" } as const;

  // Les segments dans l'ordre, jusqu'au plafond compressé : la taille d'un bytea se
  // lit sans le décompresser (en-tête TOAST), et les suivants ne quittent pas la base.
  const lignes = await q<LigneSegment>(
    `select seq, body, total from (
       select seq, body, count(*) over () as total,
              sum(octet_length(body)) over (order by seq rows unbounded preceding) as cumul
         from replay_chunk
        where session_id = $1 and app_id = $2
     ) s
     where cumul <= $3
     order by seq`,
    [id, appId, PLAFOND_REJEU_COMPRESSE],
  );
  const total = lignes.length ? Number(lignes[0].total) : Number((await q<{ n: string }>(
    `select count(*) as n from replay_chunk where session_id = $1 and app_id = $2`,
    [id, appId],
  ))[0]?.n ?? 0);

  const events: unknown[] = [];
  let ignores = 0;
  let lus = 0;
  let octets = 0;
  for (const c of lignes) {
    let brut: Buffer;
    try {
      // Borne de sortie : un chunk stocké reste un gzip d'origine cliente, et rien
      // ne garantit qu'il n'a pas été fabriqué pour gonfler à la lecture. Au-delà,
      // RangeError → segment compté comme illisible, comme un corrompu.
      brut = gunzipSync(c.body, { maxOutputLength: MAX_REPLAY_INFLATED_BYTES });
    } catch {
      ignores += 1;
      lus += 1;
      continue;
    }
    if (octets + brut.length > PLAFOND_REJEU_DECOMPRESSE) break;
    octets += brut.length;
    lus += 1;
    try {
      const parsed: unknown = JSON.parse(brut.toString("utf8"));
      if (Array.isArray(parsed)) events.push(...parsed);
      else ignores += 1; // lisible, mais pas une liste d'événements rrweb
    } catch {
      ignores += 1; // chunk corrompu : ignoré, le reste du replay reste lisible — et compté (B36)
    }
  }
  return { etat: "ok", sessionId: id, chunks: total, events, ignores, tronques: total - lus } as const;
}) satisfies Chargeur<unknown>;
