// LE JOURNAL DE LA CONSOLE : un seul point d'import du journal structuré
// (`@mip/service-kit`, par `@mip/backend` dont la console dépend encore).
//
// Les modules de la console qui journalisent passent par ici plutôt que par
// `@mip/backend` : la décommission (C12) retire `@mip/backend` des dépendances de
// la console, et ce fichier sera le seul à changer.
export { createLogger } from "@mip/backend/shared/log.mjs";
