#!/bin/bash
# Initialisation de la base MIP RUM dans le conteneur Postgres (self-host).
# Exécuté UNE fois par l'entrypoint postgres, sur volume vierge, en superuser via
# le socket local. Reproduit fidèlement le schéma de prod :
#   1) rôle console_ro (moindre-privilège de la console) — créé AVANT les
#      migrations pour que les policies GARDÉES de migration-v16 s'appliquent ;
#   2) schema.sql (tables de base) ;
#   3) migration-v02..v28 dans l'ordre. Les blocs cloud (pg_cron, rôles d'API
#      Supabase anon/authenticated/service_role) s'auto-sautent : chaque migration
#      teste `if exists (...)` avant, et journalise « bloc sauté » sur un Postgres
#      local. ON_ERROR_STOP=1 : une vraie erreur casse l'init (pas de schéma partiel).
set -euo pipefail

SQL_DIR=/sql
run() { psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" "$@"; }

# 1) console_ro : rôle de connexion restreint de la console (comme en prod). Créé
#    seulement si un mot de passe est fourni. Les GRANT/policies détaillés sont
#    portés par migration-v16 (gardée sur l'existence du rôle).
if [ -n "${CONSOLE_RO_PASSWORD:-}" ]; then
  echo "initdb: création du rôle console_ro"
  run -v pw="$CONSOLE_RO_PASSWORD" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'console_ro') then
    create role console_ro login;
  end if;
end $$;
SQL
  run -v pw="$CONSOLE_RO_PASSWORD" -c "alter role console_ro password :'pw';"
  run -c "grant connect on database \"$POSTGRES_DB\" to console_ro; grant usage on schema public to console_ro;"
else
  echo "initdb: CONSOLE_RO_PASSWORD absent — rôle console_ro non créé (blocs parité sautés)"
fi

# 2) Schéma de base.
echo "initdb: application de schema.sql"
run -f "$SQL_DIR/schema.sql"

# 3) Migrations dans l'ordre (noms zéro-paddés v02..v28 => tri lexical = numérique).
for f in $(ls "$SQL_DIR"/migration-v*.sql | sort); do
  echo "initdb: migration $(basename "$f")"
  run -f "$f"
done

echo "initdb: terminé."
