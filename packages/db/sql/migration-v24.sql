-- migration-v24.sql — UTI-C : moniteur du solde OpenRouter.
-- Historique des relevés de crédits (poll par Vercel Cron). Un snapshot par relevé ;
-- le statut « low » déclenche l'alerte au franchissement (côté route). Lecture par la
-- console (endpoint /api/v1/ai/credits) et par le poll (dernier statut connu).

create table if not exists openrouter_balance (
  id            bigserial primary key,
  checked_at    timestamptz not null default now(),
  total_credits numeric(14,6),          -- crédits totaux (peut être null si l'API ne le donne pas)
  total_usage   numeric(14,6),          -- consommation cumulée
  balance       numeric(14,6) not null, -- solde restant (unité native du compte = USD)
  threshold     numeric(14,6) not null, -- seuil bas appliqué à ce relevé
  currency      text not null default 'USD',
  status        text not null check (status in ('ok', 'low'))
);

create index if not exists idx_orbal_checked on openrouter_balance (checked_at desc);

-- Accès console (même rôle que les autres tables applicatives).
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    grant select, insert on openrouter_balance to console_ro;
    grant usage, select on sequence openrouter_balance_id_seq to console_ro;
  end if;
end $$;
