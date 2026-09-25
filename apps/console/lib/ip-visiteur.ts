// L'adresse du visiteur que la console transmet à console-api (C1), pour son
// débit d'authentification — le service n'en garde qu'un HMAC, jamais l'adresse.
//
// Derrière Vercel, `x-forwarded-for` la porte toujours (première valeur). Sans
// proxy devant la console (poste de développement, E2E), il n'y en a pas : le
// bouclage local plutôt qu'un refus. Une valeur qui n'a pas la forme d'une
// adresse n'entre jamais dans une clé de débit.
const ADRESSE = /^[0-9A-Fa-f.:]{2,45}$/;

export function ipVisiteur(h: Pick<Headers, "get">): string {
  const brute = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim();
  return ADRESSE.test(brute) ? brute : "127.0.0.1";
}
