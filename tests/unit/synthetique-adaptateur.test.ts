// L'adaptateur de source synthétique — la partie où l'information se perd.
//
// LE TEST CENTRAL de ce fichier est celui de la NON-PERTE : l'adaptateur d'origine
// projetait une métrique sur six et jetait les cinq autres en silence. On ne
// corrèle pas ce qu'on n'a pas gardé, et une perte silencieuse ne se voit dans
// aucun journal.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — module .mjs sans déclaration de types
import {
  ETATS_CONNUS,
  lignesDepuisExport,
  ligneDepuisExecution,
  nombreOuNull,
  normaliserEtat,
  scoreDepuisEtat,
} from "../../apps/sync-synthetic/src/adaptateurs.mjs";
import { surEchec } from "../outils/diagnostic";

const RACINE = join(__dirname, "..", "..");
const EXPORT_REEL = JSON.parse(
  readFileSync(join(RACINE, "apps/sync-synthetic/data/mippoc-sample.json"), "utf8"),
);
const RATTACHEMENT = { app_id: "tvmonaco", site: "TVMonaco", route_hint: "/" };

describe("aucun champ de la source n'est perdu", () => {
  it("les SIX métriques de l'export réel survivent au passage", () => {
    // L'assertion qui compte. L'adaptateur d'origine gardait first_load_time et
    // abandonnait completion_time, dns_time, nb_requests, nb_requests_ko et
    // http_status — sans rien dire.
    const attendues = Object.keys(EXPORT_REEL.executions[0].details.metrics);
    const { lignes } = lignesDepuisExport(EXPORT_REEL, RATTACHEMENT);
    const conservees = Object.keys(lignes[0].metrics);
    surEchec("les métriques de la source doivent toutes arriver", () => ({
      attendues,
      conservees,
      abandonnées: attendues.filter((k) => !conservees.includes(k)),
    }));
    expect(attendues.length).toBe(6);
    expect(conservees.sort()).toEqual(attendues.sort());
  });

  it("le type de mesure et l'état BRUT sont conservés", () => {
    const { lignes } = lignesDepuisExport(EXPORT_REEL, RATTACHEMENT);
    expect(lignes[0].measure_type).toBe("ASA_DESKTOP");
    // Sans l'état brut, une valeur inconnue de la source serait écrasée sur un
    // état choisi par nous, et plus rien ne permettrait de s'en apercevoir.
    expect(lignes[0].state_source).toBe("OK");
  });

  it("`id` est traité comme l'identifiant de la MESURE, pas du passage", () => {
    // MESURÉ, pas supposé : il vaut 483 sur les neuf exécutions du fichier.
    // La première version de la migration en avait fait une clé d'unicité de
    // passage — les neuf lignes s'écrasaient l'une l'autre et il n'en restait
    // qu'une. C'est l'import réel qui l'a montré.
    const ids = EXPORT_REEL.executions.map((e: { id: number }) => e.id);
    surEchec("le champ id du fichier d'exemple", () => ({ ids }));
    expect(new Set(ids).size).toBe(1);
    const { lignes } = lignesDepuisExport(EXPORT_REEL, RATTACHEMENT);
    expect(new Set(lignes.map((l: { measure_id: string }) => l.measure_id)).size).toBe(1);
    // Ce qui distingue deux passages est leur horodatage, et rien d'autre.
    expect(new Set(lignes.map((l: { captured_at: Date }) => l.captured_at.toISOString())).size).toBe(9);
    expect(lignes.every((l: { execution_id: null }) => l.execution_id === null)).toBe(true);
  });

  it("latency_ms est first_load_time, jamais completion_time", () => {
    // completion_time vaut 10001 à 10015 ms sur les neuf exécutions : une
    // constante à 14 ms près, parce qu'elle mesure surtout les temporisations du
    // script. La confondre avec un temps de chargement produirait une série
    // plate corrélée à rien.
    const { lignes } = lignesDepuisExport(EXPORT_REEL, RATTACHEMENT);
    const completions = EXPORT_REEL.executions.map((e: { details: { metrics: { completion_time: string } } }) =>
      Number(e.details.metrics.completion_time),
    );
    surEchec("completion_time est une constante, pas une durée de chargement", () => ({
      completions,
      etendue: Math.max(...completions) - Math.min(...completions),
      latences: lignes.map((l: { latency_ms: number }) => l.latency_ms),
    }));
    expect(Math.max(...completions) - Math.min(...completions)).toBeLessThan(50);
    for (const l of lignes) {
      expect(completions).not.toContain(l.latency_ms);
    }
  });
});

describe("un état inconnu ne se déguise pas en incident", () => {
  it.each(Object.entries(ETATS_CONNUS))("%s → %s", (brut, attendu) => {
    expect(normaliserEtat(brut)).toBe(attendu);
  });

  it("insensible à la casse et aux espaces", () => {
    expect(normaliserEtat(" ok ")).toBe("ok");
    expect(normaliserEtat("Warning")).toBe("warn");
  });

  it.each(["SKIPPED", "PENDING", "", "  ", "42"])("« %s » rend null, PAS « incident »", (brut) => {
    // L'ancien code écrivait `state === 'OK' ? 'ok' : state === 'WARNING' ? 'warn'
    // : 'incident'` : n'importe quel état non prévu devenait une panne déclarée.
    // Une panne inventée est pire qu'une absence de mesure.
    expect(normaliserEtat(brut)).toBeNull();
  });

  it.each([null, undefined, 42, {}])("une valeur non textuelle rend null", (brut) => {
    expect(normaliserEtat(brut as never)).toBeNull();
  });

  it("le score suit l'état, et un état inconnu ne vaut pas zéro", () => {
    // Zéro se lirait « pire note possible » alors que la vérité est « on ne sait pas ».
    expect(scoreDepuisEtat("ok")).toBe(100);
    expect(scoreDepuisEtat("warn")).toBe(50);
    expect(scoreDepuisEtat("incident")).toBe(0);
    expect(scoreDepuisEtat(null)).toBeNull();
  });
});

describe("nombreOuNull ne laisse jamais passer NaN", () => {
  it.each([
    ["281", 281],
    [281, 281],
    ["0", 0],
    ["", null],
    ["200 - OK", null],
    [null, null],
    [undefined, null],
  ])("%s → %s", (entree, attendu) => {
    expect(nombreOuNull(entree as never)).toBe(attendu);
  });
});

describe("une exécution illisible ne fait pas tomber les autres", () => {
  it("est REJETÉE et NOMMÉE, jamais avalée", () => {
    // Une exécution sans horodatage ne doit pas annuler l'import des huit autres,
    // et ne doit pas non plus disparaître : un format qui change se lirait sinon
    // « le robot s'est arrêté ».
    const abime = {
      ...EXPORT_REEL,
      executions: [
        ...EXPORT_REEL.executions.slice(0, 2),
        { id: 483, type: "ASA_DESKTOP", details: { time: "pas-une-date", state: "OK", metrics: {} } },
      ],
    };
    const { lignes, rejets, vues } = lignesDepuisExport(abime, RATTACHEMENT);
    surEchec("une exécution illisible", () => ({ vues, retenues: lignes.length, rejets }));
    expect(vues).toBe(3);
    expect(lignes).toHaveLength(2);
    expect(rejets).toHaveLength(1);
    expect(rejets[0].motif).toContain("horodatage illisible");
  });

  it("un export sans measure_name rejette tout en le disant", () => {
    const { lignes, rejets } = lignesDepuisExport({ executions: EXPORT_REEL.executions }, RATTACHEMENT);
    expect(lignes).toHaveLength(0);
    expect(rejets).toHaveLength(9);
    expect(rejets[0].motif).toContain("measure_name");
  });

  it("un export vide ne lève pas", () => {
    expect(lignesDepuisExport({}, RATTACHEMENT)).toEqual({
      lignes: [],
      rejets: [],
      measureName: null,
      vues: 0,
    });
  });

  it("une métrique manquante rend latency_ms null, pas 0", () => {
    // 0 ms de chargement se lirait « instantané », ce qui est le meilleur score
    // possible pour une mesure qui n'existe pas.
    const l = ligneDepuisExecution(
      { id: 1, type: "X", details: { time: "2026-06-10T10:00:00Z", state: "OK", metrics: {} } },
      "M",
      RATTACHEMENT,
    );
    expect(l.latency_ms).toBeNull();
  });
});
