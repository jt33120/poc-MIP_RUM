// C12 — LA CONSOLE SANS BASE, GARDÉE PAR SON PROPRE BUILD. Avec
// `MIP_CONSOLE_SANS_BASE=1` (posée à la bascule, sur Vercel et dans l'image), le
// build REFUSE de se faire si l'environnement porte encore une base ou un secret
// d'identité : une console qui les aurait n'en aurait pas besoin, et un déploiement
// qui les garderait pourrait encore s'en servir. Liste blanche par préfixe, pas une
// liste de valeurs : un `PGHOST` ajouté demain est refusé comme `DATABASE_URL`.
// Relevé des autres gardes : `node scripts/ci/console-sans-base.mjs`.
const VARIABLES_DE_BASE = /^(DATABASE_URL|DATABASE_URL_.*|PG[A-Z_]*|POSTGRES_.*|NEON_.*|IDENTITY_HASH_SECRET|TICKET_SECRET_KEY|AUTH_SECRET)$/;
if (process.env.MIP_CONSOLE_SANS_BASE === "1") {
  const presentes = Object.keys(process.env).filter((nom) => VARIABLES_DE_BASE.test(nom) && process.env[nom]);
  if (presentes.length) {
    throw new Error(`console sans base : ces variables ne doivent plus exister ici — ${presentes.join(", ")}`);
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pg"],
  // Le contrat de console-api (piste C) est un paquet du dépôt en TypeScript, sans
  // étape de build : Next le compile avec la console.
  transpilePackages: ["@mip/console-contract"],
  // La vitrine date sa capture par le manifeste des captures, lu sur le disque à
  // chaque requête (lib/portail-manifeste.ts). Un fichier de public/ est servi à
  // part, pas embarqué dans la fonction serveur : on l'y ajoute nommément. Absent
  // (avant le passage de scripts/captures-portail.mjs), rien n'est ajouté et la
  // légende reste sans date.
  outputFileTracingIncludes: {
    "/presentation": ["./public/portail/manifest.json"],
  },
};

export default nextConfig;
