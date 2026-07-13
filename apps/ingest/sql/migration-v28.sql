-- Migration v28 — cache du briefing IA d'accueil (résumé structuré de l'état de
-- l'app depuis la dernière connexion, généré au login puis mis en cache pour
-- maîtriser le coût LLM : ~1 génération par (app, utilisateur, fenêtre de login)).
-- Idempotente. Aucune PII (agrégats + texte généré à partir d'agrégats).

create table if not exists ai_briefing (
  id           bigserial primary key,
  app_id       text not null,
  user_email   text not null,
  window_start timestamptz not null,        -- borne « depuis la dernière connexion »
  status       text not null default 'ok',  -- ok | watch | critical
  payload      jsonb not null,              -- {headline, bullets[], focus, source}
  generated_at timestamptz not null default now(),
  -- une seule entrée de cache par app/utilisateur : régénérée quand la fenêtre change
  unique (app_id, user_email)
);

create index if not exists idx_ai_briefing_lookup on ai_briefing (app_id, user_email);
