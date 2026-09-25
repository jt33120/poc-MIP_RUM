// LE CHARGEUR DE LA « Supervision IA » (C5) — `app/ai/page.tsx`.
//
// Espace PARTENAIRE : lecture seule via la façade xSOM (`fetchAiSummary`), app par
// app — ZÉRO donnée IA stockée côté MIP. Le jeton de la façade (`XSOM_AI_TOKEN`)
// est lu par le processus qui exécute ce chargeur : la console aujourd'hui,
// console-api après la bascule (et plus Vercel). CAPACITÉ FERMÉE
// (`lib/capacites.ts`) : tant qu'elle l'est, aucun appel à la façade n'est émis.
import { estFermee } from "../capacites";
import { analyserFiltres } from "../filtres-ecran";
import { periodLabel, v2FiltersOf } from "../queries-v2";
import { fetchAiSummary } from "../xsom-ai";
import type { Chargeur } from "./commun";

export const chargerAi = (async (principal, sp) => {
  if (estFermee("/ai")) return { etat: "fermee" } as const;
  const ecran = await analyserFiltres(principal, sp, "/ai");
  if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
  const f = v2FiltersOf(ecran.query);
  // xSOM expose 24h/7d/30d ; on mappe la période console (1h/24h/7d).
  const windowKey = f.period === "7d" ? "7d" : "24h";
  // Lecture façade — app-scopée par le token xSOM ; null (échec/non couvert) => état « indisponible ».
  const ai = f.app ? await fetchAiSummary(f.app, windowKey) : null;
  return { etat: "ok", app: f.app, periode: periodLabel(f), ai } as const;
}) satisfies Chargeur<unknown>;
