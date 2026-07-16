-- migration-v36 — corrige un oubli de la migration-v34 : `ai_briefing` (cache du
-- briefing d'accueil) n'avait qu'une policy SELECT pour console_ro, sur
-- l'hypothèse erronée que l'écriture passait par service_role. En réalité
-- /api/briefing est une route Next.js CONSOLE (comme tout le reste) : elle lit
-- ET écrit (upsert) via le pool `console_ro`. Résultat en prod depuis le 13/07 :
-- "permission denied for table ai_briefing" sur CHAQUE écriture de cache (42501,
-- ~40 occurrences/8 comptes) → la synthèse IA d'accueil ne s'affiche jamais
-- (le fetch échoue, BriefingCard se masque — ou reste en squelette si l'échec
-- survient après un remount).
--
-- Fix : mêmes grants/policy « for all » que les tables sœurs (read_tokens,
-- extension_scope) déjà dans la même migration-v34 — aucune raison que
-- ai_briefing seule soit traitée différemment.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    grant select, insert, update on ai_briefing to console_ro;

    drop policy if exists cro_sel_ai_briefing on ai_briefing;
    if not exists (select 1 from pg_policies where tablename='ai_briefing' and policyname='cro_all_ai_briefing') then
      create policy cro_all_ai_briefing on ai_briefing for all to console_ro using (true) with check (true);
    end if;
  end if;
end $$;
