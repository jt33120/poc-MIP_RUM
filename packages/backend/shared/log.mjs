// Logger structuré (JSON lines) — DÉSORMAIS UN RELAIS vers @mip/service-kit.
//
// Pourquoi un relais et pas une copie : ce qui ne doit jamais sortir dans un
// journal (secret, adresse IP, identité brute) se décide à un seul endroit.
// Deux loggers, c'est deux listes d'expurgation qui divergent au premier ajout.
// L'implémentation, ses garanties et leur justification vivent dans
// `packages/service-kit/log.mjs`.
//
// Ce chemin reste, parce qu'il a des appelants partout : les services, le noyau
// (receiver, dispatch-alerts, backfills, error-symbolication), le migrateur et
// trois modules de la console (cron, ingest, error-symbolication). Rien à
// changer chez eux : même signature `createLogger(service)`, même forme de
// ligne ({ts, level, service, msg, ...champs}), mêmes flux (warn/error sur
// stderr). Le kit y ajoute `version`, `replica`, `request_id`/`run_id` quand ils
// existent, la pile complète des erreurs, et l'expurgation des adresses IP.
export { createLogger, LOG_LEVELS } from "@mip/service-kit/log.mjs";
