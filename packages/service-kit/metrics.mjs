// Métriques au format texte Prometheus (exposition 0.0.4) : compteurs et jauges.
//
// POURQUOI PAS prom-client. Il tire une dépendance, un registre global et une
// trentaine de métriques par défaut ; un service du kit en expose une dizaine.
// Le format texte tient en quelques règles d'échappement, écrites ici.
//
// POURQUOI UN PLAFOND DE SÉRIES. Chaque combinaison d'étiquettes est une série
// gardée en mémoire pour toujours. Une étiquette nourrie par une entrée client
// (un chemin, un app_id inventé) fait grossir le processus sans limite — une
// fuite mémoire qu'un tiers peut déclencher. Passé `maxSeries` par métrique,
// les nouvelles combinaisons sont ignorées et comptées dans
// `metrics_series_dropped_total` : la supervision voit la fuite évitée.
//
// Ce module n'expose rien lui-même : `http.mjs` sert `render()` sur /metrics,
// derrière un jeton.

const NOM = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const ETIQUETTE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

/** Échappement d'une valeur d'étiquette : antislash, guillemet, saut de ligne. */
function echapperValeur(v) {
  return String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/** Échappement du texte d'aide : antislash et saut de ligne seulement. */
function echapperAide(v) {
  return String(v).replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
}

/** Nombre au format Prometheus : +Inf, -Inf, NaN en toutes lettres. */
function formaterNombre(n) {
  if (Number.isNaN(n)) return "NaN";
  if (n === Infinity) return "+Inf";
  if (n === -Infinity) return "-Inf";
  return String(n);
}

/**
 * @param {{ prefix?: string, maxSeries?: number }} [options]
 *   `prefix` est ajouté à chaque nom (ex. « mip_collector_ ») ;
 *   `maxSeries` borne les combinaisons d'étiquettes par métrique (défaut 500).
 */
export function createMetrics({ prefix = "", maxSeries = 500 } = {}) {
  /** @type {Map<string, { nom: string, aide: string, type: "counter"|"gauge", etiquettes: string[], series: Map<string, {labels: Record<string,string>, valeur: number}>, collect?: Function }>} */
  const metriques = new Map();
  let seriesIgnorees = 0;

  function declarer(type, nom, aide, { labels = [], collect } = {}) {
    const complet = `${prefix}${nom}`;
    if (!NOM.test(complet)) throw new TypeError(`métrique : nom invalide « ${complet} »`);
    for (const l of labels) {
      if (!ETIQUETTE.test(l) || l.startsWith("__")) throw new TypeError(`métrique ${complet} : étiquette invalide « ${l} »`);
    }
    const existante = metriques.get(complet);
    if (existante) {
      // Redéclarer à l'identique rend la même métrique (deux modules qui
      // comptent la même chose) ; redéclarer autrement est une faute.
      if (existante.type !== type || existante.etiquettes.join() !== labels.join()) {
        throw new TypeError(`métrique ${complet} déjà déclarée avec un autre type ou d'autres étiquettes`);
      }
      return existante;
    }
    const m = { nom: complet, aide, type, etiquettes: [...labels], series: new Map(), collect };
    metriques.set(complet, m);
    return m;
  }

  /** La série d'une combinaison d'étiquettes, créée au besoin (ou null si plafond atteint). */
  function serie(m, valeursEtiquettes = {}) {
    const labels = {};
    for (const l of m.etiquettes) labels[l] = valeursEtiquettes[l] == null ? "" : String(valeursEtiquettes[l]);
    const cle = m.etiquettes.map((l) => labels[l]).join("\u0000");
    let s = m.series.get(cle);
    if (!s) {
      if (m.series.size >= maxSeries) {
        seriesIgnorees += 1;
        return null;
      }
      s = { labels, valeur: 0 };
      m.series.set(cle, s);
    }
    return s;
  }

  /**
   * Compteur : ne fait que monter (remis à zéro au redémarrage, ce que
   * Prometheus sait lire).
   * @param {string} nom  suffixe `_total` conseillé
   * @param {string} aide
   * @param {{ labels?: string[] }} [options]
   */
  function counter(nom, aide, options) {
    const m = declarer("counter", nom, aide, options);
    return {
      inc(labels, valeur = 1) {
        if (typeof labels === "number") [labels, valeur] = [undefined, labels];
        if (!(valeur >= 0)) throw new RangeError(`compteur ${m.nom} : incrément négatif ou invalide`);
        const s = serie(m, labels);
        if (s) s.valeur += valeur;
      },
      get(labels) {
        return serie(m, labels)?.valeur ?? 0;
      },
    };
  }

  /**
   * Jauge : une valeur instantanée. Avec `collect`, elle est calculée au moment
   * du rendu (taille du pool, âge du dernier succès) — pas de minuterie à tenir.
   * `collect` rend un nombre, ou une liste de `{ labels, value }`.
   * @param {string} nom
   * @param {string} aide
   * @param {{ labels?: string[], collect?: () => number | {labels?: object, value: number}[] | Promise<any> }} [options]
   */
  function gauge(nom, aide, options) {
    const m = declarer("gauge", nom, aide, options);
    return {
      set(labels, valeur) {
        if (typeof labels === "number") [labels, valeur] = [undefined, labels];
        const s = serie(m, labels);
        if (s) s.valeur = Number(valeur);
      },
      inc(labels, valeur = 1) {
        if (typeof labels === "number") [labels, valeur] = [undefined, labels];
        const s = serie(m, labels);
        if (s) s.valeur += valeur;
      },
      dec(labels, valeur = 1) {
        if (typeof labels === "number") [labels, valeur] = [undefined, labels];
        const s = serie(m, labels);
        if (s) s.valeur -= valeur;
      },
      get(labels) {
        return serie(m, labels)?.valeur ?? 0;
      },
    };
  }

  function ligne(nom, labels, valeur) {
    const cles = Object.keys(labels);
    const texte = cles.length ? `{${cles.map((k) => `${k}="${echapperValeur(labels[k])}"`).join(",")}}` : "";
    return `${nom}${texte} ${formaterNombre(valeur)}`;
  }

  /**
   * Le texte d'exposition. Une `collect` qui lève ne fait pas tomber /metrics :
   * sa métrique sort sans échantillon, et `metrics_collect_errors_total` monte.
   * @returns {Promise<string>}
   */
  async function render() {
    const sortie = [];
    let erreursCollecte = 0;
    for (const m of metriques.values()) {
      if (m.collect) {
        try {
          const r = await m.collect();
          const echantillons = typeof r === "number" ? [{ labels: {}, value: r }] : Array.isArray(r) ? r : [];
          for (const { labels, value } of echantillons) {
            const s = serie(m, labels);
            if (s) s.valeur = Number(value);
          }
        } catch {
          erreursCollecte += 1;
        }
      }
      sortie.push(`# HELP ${m.nom} ${echapperAide(m.aide)}`, `# TYPE ${m.nom} ${m.type}`);
      for (const s of m.series.values()) sortie.push(ligne(m.nom, s.labels, s.valeur));
    }
    // Les deux compteurs de santé du registre lui-même, toujours présents.
    sortie.push(
      `# HELP ${prefix}metrics_series_dropped_total Combinaisons d'étiquettes ignorées (plafond de séries atteint).`,
      `# TYPE ${prefix}metrics_series_dropped_total counter`,
      `${prefix}metrics_series_dropped_total ${seriesIgnorees}`,
      `# HELP ${prefix}metrics_collect_errors Collectes en échec lors de ce rendu.`,
      `# TYPE ${prefix}metrics_collect_errors gauge`,
      `${prefix}metrics_collect_errors ${erreursCollecte}`,
    );
    return `${sortie.join("\n")}\n`;
  }

  return { counter, gauge, render, contentType: PROMETHEUS_CONTENT_TYPE };
}

/**
 * Les jauges du processus Node : mémoire et ancienneté. De quoi voir une fuite
 * ou un redémarrage en boucle sans rien d'autre que /metrics.
 * @param {ReturnType<typeof createMetrics>} registre
 */
export function registerProcessMetrics(registre) {
  const debut = Date.now();
  registre.gauge("process_uptime_seconds", "Secondes depuis le démarrage du processus.", {
    collect: () => (Date.now() - debut) / 1000,
  });
  registre.gauge("process_resident_memory_bytes", "Mémoire résidente du processus.", {
    collect: () => process.memoryUsage().rss,
  });
  registre.gauge("nodejs_heap_used_bytes", "Tas V8 utilisé.", {
    collect: () => process.memoryUsage().heapUsed,
  });
}
