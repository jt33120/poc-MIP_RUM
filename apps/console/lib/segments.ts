// Moteur de segments v1 — logique PURE, testée (pas d'accès DB ici).
//
// Un segment = une conjonction de conditions `dimension<op>valeur`, portée dans
// l'URL (`?seg=geo==FR;device!=mobile`) et appliquée RÉTROACTIVEMENT à toutes les
// requêtes (elles interrogent les lignes brutes).
//
// Sûreté : les colonnes proviennent EXCLUSIVEMENT de l'allowlist `SEG_DIMENSIONS`
// (jamais d'une entrée utilisateur) et les valeurs sont TOUJOURS des binds `$n`.
// Aucune concaténation de valeur dans le SQL -> pas d'injection possible.
//
// v1 : dimensions portées par `rum_session` (déjà jointe partout via l'alias `s`).
// Le compilateur émet le prédicat pour N'IMPORTE quel alias en réutilisant les
// mêmes index de bind (Postgres autorise `$n` référencé plusieurs fois), ce qui
// permet d'appliquer le même segment à `s`, `ps`, `ls`… dans une requête à
// sous-requêtes sans dupliquer les paramètres.

export type SegOp = "==" | "!=";

export interface SegCond {
  dim: string;
  op: SegOp;
  value: string;
}

/** Allowlist : dimension publique -> colonne (nue) sur `rum_session` + libellé FR.
 *  `col` est une constante de code, jamais une entrée utilisateur. */
export const SEG_DIMENSIONS: Record<string, { col: string; label: string }> = {
  geo: { col: "geo_country", label: "Pays" },
  device: { col: "device_type", label: "Appareil" },
  client: { col: "client_id", label: "Client" },
  // Ext-A : capteur d'origine ('sdk' | 'extension') — segmente/compare les deux
  // modes RUM dans n'importe quelle page (colonne rum_session.collection_source).
  source: { col: "collection_source", label: "Source" },
};

const VALUE_MAX = 120;

/** Parse `geo==FR;device!=mobile` -> conditions valides (les jetons inconnus ou
 *  mal formés sont ignorés, pas d'erreur : robuste au trafiquage d'URL). */
export function parseSegment(raw: string | null | undefined): SegCond[] {
  if (!raw) return [];
  const out: SegCond[] = [];
  for (const tok of raw.split(";")) {
    const m = tok.match(/^([a-z_]+)(==|!=)(.*)$/);
    if (!m) continue;
    const [, dim, op, rawVal] = m;
    if (!(dim in SEG_DIMENSIONS)) continue;
    const value = rawVal.trim().slice(0, VALUE_MAX);
    if (!value) continue;
    out.push({ dim, op: op as SegOp, value });
  }
  return out;
}

/** Sérialise des conditions vers la forme d'URL (round-trip avec parseSegment). */
export function serializeSegment(conds: SegCond[]): string {
  return conds
    .filter((c) => c.dim in SEG_DIMENSIONS && c.value !== "")
    .map((c) => `${c.dim}${c.op}${c.value}`)
    .join(";");
}

export interface CompiledSegment {
  /** Valeurs à passer en binds, DANS L'ORDRE, à partir de `startIndex`. */
  params: string[];
  /** Prédicat SQL (préfixé ` and `) pour un alias de table donné ; "" si vide.
   *  Réutilise les mêmes `$n` à chaque appel -> params ajoutés UNE seule fois. */
  where: (alias: string) => string;
}

/** Compile des conditions en SQL paramétré, binds démarrant à `startIndex`. */
export function buildSegment(conds: SegCond[], startIndex: number): CompiledSegment {
  const valid = conds.filter((c) => c.dim in SEG_DIMENSIONS && c.value !== "");
  const params = valid.map((c) => c.value);
  const where = (alias: string): string =>
    valid
      .map((c, i) => {
        const col = SEG_DIMENSIONS[c.dim].col;
        const sqlOp = c.op === "==" ? "=" : "<>";
        return ` and ${alias}.${col} ${sqlOp} $${startIndex + i}`;
      })
      .join("");
  return { params, where };
}

/** Libellé lisible d'une condition (pour les chips UI). */
export function describeCond(c: SegCond): string {
  const label = SEG_DIMENSIONS[c.dim]?.label ?? c.dim;
  return `${label} ${c.op === "==" ? "=" : "≠"} ${c.value}`;
}
