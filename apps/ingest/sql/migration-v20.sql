-- v20 : usage & performance IA (appels LLM) -> table rum_ai.
-- Un row par appel LLM, émis par le back (conventions OTel GenAI `gen_ai.*`),
-- ingéré par v1-traces. `session_id` nullable SANS FK (comme rum_span) : un appel
-- backend peut précéder l'upsert de session ; corrélation logique par session_id/trace_id.
-- Additif & idempotent. Coût estimé calculé à l'ingestion (table de prix).

create table if not exists rum_ai (
  id                bigint generated always as identity primary key,
  span_id           text unique not null,
  trace_id          text,
  session_id        text,
  app_id            text not null,
  route             text,
  provider          text,
  model             text,
  operation         text,
  prompt_tokens     integer,
  completion_tokens integer,
  total_tokens      integer,
  cost_usd          numeric(12,6),
  latency_ms        double precision,
  ttft_ms           double precision,
  status            text not null default 'ok',   -- 'ok' | 'error'
  error_type        text,
  ts                timestamptz not null default now()
);

create index if not exists idx_ai_app_ts on rum_ai (app_id, ts desc);
create index if not exists idx_ai_model   on rum_ai (app_id, model);
create index if not exists idx_ai_route   on rum_ai (app_id, route);
create index if not exists brin_ai_ts     on rum_ai using brin (ts);

alter table rum_ai enable row level security;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    grant select on rum_ai to console_ro;
    if not exists (select 1 from pg_policies where tablename = 'rum_ai' and policyname = 'cro_sel_rum_ai') then
      create policy cro_sel_rum_ai on rum_ai for select to console_ro using (true);
    end if;
  end if;
end $$;

comment on table rum_ai is 'Appels LLM (usage & performance IA), conventions OTel GenAI. v20.';
-- Suivi rétention : ajouter rum_ai à purge_rum()/purge_rum_app()/erase_app_data()/erase_session()
-- (30 j) dans une migration dédiée — non bloquant pour l'ingestion/la lecture.
