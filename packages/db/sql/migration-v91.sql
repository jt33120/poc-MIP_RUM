-- migration-v91 — C1 : un compte SSO est lié à son identité chez l'IdP, pas à un e-mail.
--
-- Additive et rejouable, PostgreSQL 15 à 17. v90 (sessions) est le fichier
-- précédent. Le plan réservait v91 aux rôles de C13 (`mip_console`,
-- `mip_identity`) : ils glissent à v92.
--
-- LE DÉFAUT CORRIGÉ. La connexion SSO d'aujourd'hui (`/api/auth/oidc/callback`)
-- retrouve le compte par son E-MAIL — celui du jeton de l'IdP, ou à défaut son
-- `preferred_username` — sans regarder `email_verified`. Un IdP qui laisse un
-- utilisateur choisir son adresse (ou un second IdP configuré par erreur) ouvre
-- donc le compte console de quiconque porte cette adresse. Et un compte
-- désactivé dans la console était RÉACTIVÉ à la connexion suivante
-- (`on conflict … set active = true`).
--
-- CE QUI CHANGE (console-api, C1c). Un compte SSO porte le couple (`oidc_iss`,
-- `oidc_sub`) — l'émetteur épinglé et l'identifiant stable du sujet chez lui,
-- que l'IdP ne réattribue pas. Une fois lié, c'est ce couple qui le retrouve,
-- jamais plus l'e-mail. Le premier lien avec un compte existant n'est permis que
-- si ce compte a été pré-provisionné pour le SSO, ou si l'IdP atteste l'adresse
-- (`email_verified`) dans un domaine autorisé. Un compte désactivé le reste.
alter table console_user add column if not exists oidc_iss text;
alter table console_user add column if not exists oidc_sub text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'console_user_oidc_v91') then
    -- Les deux ensemble, ou aucun : un sujet sans émetteur ne désigne personne.
    alter table console_user add constraint console_user_oidc_v91
      check ((oidc_iss is null) = (oidc_sub is null)
             and (oidc_iss is null or (char_length(oidc_iss) between 1 and 512 and char_length(oidc_sub) between 1 and 255)));
  end if;
end $$;

-- Un sujet de l'IdP désigne UN compte.
create unique index if not exists console_user_oidc_v91_uniq
  on console_user (oidc_iss, oidc_sub) where oidc_iss is not null;
