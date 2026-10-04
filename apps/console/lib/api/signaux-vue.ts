// Les signaux de VUE du SDK web ≥ 0.6, servis par l'API v1 : `GET /api/v1/engagement`,
// `/spa-loads`, `/page-weight` et `/user-timings`. Ce qui est commun aux quatre routes,
// sans la base : la limite de la liste rendue.
//
// Les lectures sont celles de l'écran /pages (`lib/queries-engagement.ts`) : l'API
// ne recalcule rien, elle rend la même photographie, bornée.

/** Lignes rendues par défaut (routes, ou noms de repère) : une réponse qu'un agent lit. */
export const SIGNAUX_VUE_DEFAUT = 50;
/** Plafond : celui de la lecture par route de l'écran (`ROUTES_MAX`). */
export const SIGNAUX_VUE_MAX = 200;
