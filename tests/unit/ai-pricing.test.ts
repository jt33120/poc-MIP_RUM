// v0.8 — coût LLM estimé à l'ingestion (table de prix, portée de xsom-ai-guard).
import { describe, expect, it } from "vitest";
import { aiCostUsd } from "../../apps/ingest/supabase/functions/_shared/ai-pricing.mjs";

describe("aiCostUsd", () => {
  it("openai gpt-4o : in*2.5/1M + out*10/1M", () => {
    // 1000*2.5/1e6 + 500*10/1e6 = 0.0025 + 0.005
    expect(aiCostUsd("openai", "gpt-4o", 1000, 500)).toBeCloseTo(0.0075, 6);
  });
  it("préfixe le plus spécifique gagne (gpt-4o-mini ≠ gpt-4o)", () => {
    expect(aiCostUsd("openai", "gpt-4o-mini", 1_000_000, 0)).toBeCloseTo(0.15, 6);
    expect(aiCostUsd("openai", "gpt-4o", 1_000_000, 0)).toBeCloseTo(2.5, 6);
  });
  it("suffixe de version toléré (préfixe)", () => {
    expect(aiCostUsd("anthropic", "claude-sonnet-4-20250514", 1_000_000, 0)).toBeCloseTo(3, 6);
  });
  it("modèle inconnu d'un provider connu -> tarif défaut du provider", () => {
    expect(aiCostUsd("mistral", "modele-x", 1_000_000, 0)).toBeCloseTo(1, 6);
  });
  it("provider inconnu -> 0", () => {
    expect(aiCostUsd("provider-x", "m", 1000, 1000)).toBe(0);
  });
  it("tokens absents -> 0 ; insensible à la casse", () => {
    expect(aiCostUsd("openai", "gpt-4o", null, undefined)).toBe(0);
    expect(aiCostUsd("OpenAI", "GPT-4O", 1_000_000, 0)).toBeCloseTo(2.5, 6);
  });
});
