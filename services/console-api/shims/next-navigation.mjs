// `next/navigation` DANS LE SERVICE `console-api` : `unstable_rethrow`, que
// `lire()` appelle pour ne pas avaler les signaux de contrôle de Next
// (`notFound()`, `redirect()`). Hors de Next, il n'y en a pas : rien à relancer.
export function unstable_rethrow() {}
