// Dé-minification des stacks d'erreur (P0 #3) — moteur de symbolication source map
// v3, PUR et ZÉRO DÉPENDANCE (pas de wasm, importable côté serveur Next). Décode
// les `mappings` (base64 VLQ), résout une position générée → position d'origine,
// et réécrit une stack minifiée en stack lisible (fichier/ligne/fonction source).

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const CHAR_TO_INT: Record<string, number> = {};
for (let i = 0; i < B64.length; i++) CHAR_TO_INT[B64[i]] = i;

/** Décode la suite de VLQ base64 d'un segment en entiers signés. */
function decodeVlqs(segment: string): number[] {
  const out: number[] = [];
  let shift = 0;
  let value = 0;
  for (const c of segment) {
    const int = CHAR_TO_INT[c];
    if (int === undefined) throw new Error("base64 invalide dans mappings");
    value += (int & 31) << shift;
    if (int & 32) {
      shift += 5;
    } else {
      const negate = value & 1;
      value >>>= 1;
      out.push(negate ? -value : value);
      value = 0;
      shift = 0;
    }
  }
  return out;
}

export interface Segment {
  genCol: number; // colonne générée (0-based), relative au début de ligne
  srcIdx: number; // -1 si segment sans source
  origLine: number; // 0-based
  origCol: number; // 0-based
  nameIdx: number | null;
}

/** Parse le champ `mappings` en tableau (par ligne générée) de segments cumulés. */
export function parseMappings(mappings: string): Segment[][] {
  const lines: Segment[][] = [];
  let srcIdx = 0;
  let origLine = 0;
  let origCol = 0;
  let nameIdx = 0;
  for (const lineStr of mappings.split(";")) {
    const segs: Segment[] = [];
    let genCol = 0; // RESET à chaque ligne générée
    if (lineStr) {
      for (const segStr of lineStr.split(",")) {
        if (!segStr) continue;
        const f = decodeVlqs(segStr);
        genCol += f[0];
        if (f.length >= 4) {
          srcIdx += f[1];
          origLine += f[2];
          origCol += f[3];
          let nm: number | null = null;
          if (f.length >= 5) {
            nameIdx += f[4];
            nm = nameIdx;
          }
          segs.push({ genCol, srcIdx, origLine, origCol, nameIdx: nm });
        } else {
          segs.push({ genCol, srcIdx: -1, origLine: -1, origCol: -1, nameIdx: null });
        }
      }
    }
    lines.push(segs);
  }
  return lines;
}

export interface RawSourceMap {
  version: number;
  sources: string[];
  names?: string[];
  mappings: string;
  sourceRoot?: string;
}

export interface OrigPos {
  source: string | null;
  line: number | null; // 1-based (présentation)
  column: number | null; // 0-based (comme la spec)
  name: string | null;
}
const EMPTY: OrigPos = { source: null, line: null, column: null, name: null };

/** Consommateur d'une source map : position générée (ligne 1-based, col 0-based) → origine. */
export function createConsumer(map: RawSourceMap) {
  const lines = parseMappings(map.mappings || "");
  const names = map.names ?? [];
  const root = map.sourceRoot ? map.sourceRoot.replace(/\/$/, "") + "/" : "";
  return {
    originalPositionFor(genLine1: number, genCol0: number): OrigPos {
      const segs = lines[genLine1 - 1];
      if (!segs || !segs.length) return EMPTY;
      // plus grand segment dont genCol <= genCol0 (recherche dichotomique)
      let lo = 0;
      let hi = segs.length - 1;
      let found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (segs[mid].genCol <= genCol0) {
          found = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      if (found < 0 || segs[found].srcIdx < 0) return EMPTY;
      const s = segs[found];
      return {
        source: map.sources[s.srcIdx] != null ? root + map.sources[s.srcIdx] : null,
        line: s.origLine + 1,
        column: s.origCol,
        name: s.nameIdx != null ? (names[s.nameIdx] ?? null) : null,
      };
    },
  };
}

export interface StackFrame {
  fn: string | null;
  file: string;
  line: number;
  col: number;
}

// Chrome : "    at fn (url:line:col)" ou "    at url:line:col"
const CHROME = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/;
// Firefox/Safari : "fn@url:line:col"
const FIREFOX = /^\s*(?:(.*?)@)?(.+?):(\d+):(\d+)\s*$/;

/** Parse une ligne de stack en frame, ou null si la ligne n'est pas un frame. */
export function parseStackLine(line: string): StackFrame | null {
  const m = CHROME.exec(line) || FIREFOX.exec(line);
  if (!m) return null;
  return { fn: m[1] || null, file: m[2], line: Number(m[3]), col: Number(m[4]) };
}

const basename = (p: string): string => p.split(/[/\\]/).pop()?.split("?")[0] ?? p;

/**
 * Réécrit une stack minifiée en stack source à l'aide des maps fournies (clé =
 * nom de fichier minifié, ex. "main.abc.js"). Les lignes non résolues sont
 * conservées telles quelles. Retourne la stack réécrite + le nb de frames résolus.
 */
export function symbolicateStack(
  stack: string,
  maps: Record<string, RawSourceMap>,
): { stack: string; resolved: number } {
  const consumers = new Map<string, ReturnType<typeof createConsumer>>();
  const consumerFor = (file: string) => {
    const key = basename(file);
    if (!consumers.has(key)) {
      const map = maps[key] ?? maps[file];
      consumers.set(key, map ? createConsumer(map) : null!);
    }
    return consumers.get(key) ?? null;
  };

  let resolved = 0;
  const out = stack.split("\n").map((line) => {
    const frame = parseStackLine(line);
    if (!frame) return line;
    const consumer = consumerFor(frame.file);
    if (!consumer) return line;
    const pos = consumer.originalPositionFor(frame.line, frame.col - 1); // col stack 1-based
    if (pos.source == null || pos.line == null) return line;
    resolved++;
    const fn = pos.name || frame.fn || "?";
    return `    at ${fn} (${pos.source}:${pos.line}:${(pos.column ?? 0) + 1})`;
  });
  return { stack: out.join("\n"), resolved };
}
